"""Offline milestone planning and decision records for TruFolks."""
import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Protocol
from uuid import uuid4


ROLES = {
    "Chief of Staff": "Scope the milestone and assemble the decision brief.",
    "CTO": "Identify the smallest change, dependencies, and rollback criteria.",
    "Developer": "Plan the change and identify affected entry points.",
    "QA": "Define acceptance criteria and distinguish observed checks from planned checks.",
    "Security": "Review access, secrets, customer data, and external side effects.",
    "CFO": "Distinguish verified cash from forecasts and review spend assumptions.",
}

# Per-call (input, output) allowances. Chief of Staff runs at intake and synthesis.
ALLOWANCES = {
    "lean": ((1200, 300), (2500, 500), (2500, 500), (2000, 400),
             (2000, 400), (1800, 400), (3000, 600)),
    "robust": ((2500, 600), (5500, 1100), (5500, 1100), (4500, 900),
               (4500, 900), (4000, 800), (7500, 1500)),
}
STEPS = tuple((role, "review") for role in ROLES if role != "Chief of Staff")
STEPS = (("Chief of Staff", "intake"), *STEPS, ("Chief of Staff", "synthesis"))


def decimal_value(value):
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Use a finite, nonnegative decimal.") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("Use a finite, nonnegative decimal.")
    return result


def estimate(input_rate, output_rate, ceiling):
    """Rates are caller-supplied USD per million tokens, never live pricing."""
    input_rate, output_rate, ceiling = map(
        decimal_value, (input_rate, output_rate, ceiling)
    )
    scenarios = {}
    for name, allowances in ALLOWANCES.items():
        input_tokens = sum(pair[0] for pair in allowances)
        output_tokens = sum(pair[1] for pair in allowances)
        cost = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
        scenarios[name] = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_usd": str(cost),
            "within_ceiling": cost <= ceiling,
        }
    return {
        "scenarios": scenarios,
        "input_usd_per_million": str(input_rate),
        "output_usd_per_million": str(output_rate),
        "proposed_ceiling_usd": str(ceiling),
        "pilot_spending_ceiling_usd": "0",
        "live_use_authorized": False,
    }


class RoleProvider(Protocol):
    """Provider boundary. The shipped CLI constructs only OfflineProvider."""

    def generate(self, role: str, phase: str, goal: str, evidence: str,
                 handoffs: tuple[str, ...]) -> str: ...


class OfflineProvider:
    def generate(self, role, phase, goal, evidence, handoffs):
        if phase == "intake":
            return f"Proposed scope: {goal}. Use only the supplied evidence."
        if phase == "synthesis":
            return "Review the role checklist and evidence before deciding scope."
        return f"Planned review: {ROLES[role]}"


def proposal(goal, commit, evidence, budget, provider=None):
    provider = OfflineProvider() if provider is None else provider
    if not goal.strip() or len(goal) > 1000 or len(evidence) > 8000:
        raise ValueError("Provide a goal of 1–1000 characters and up to 8000 characters of evidence.")
    reports = []
    for role, phase in STEPS:
        handoffs = tuple(report["text"] for report in reports)
        result = provider.generate(role, phase, goal, evidence, handoffs)
        if not isinstance(result, str) or not result.strip() or len(result) > 4000:
            raise ValueError("Role output must be nonempty text of up to 4000 characters.")
        reports.append({"role": role, "phase": phase, "text": result})
    return {
        "id": uuid4().hex,
        "created_at": timestamp(),
        "goal": goal,
        "commit": commit,
        "evidence": evidence,
        "reports": reports,
        "budget": budget,
        "approval_scope": "milestone_scope_only",
    }


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def proposal_digest(encoded):
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class Records:
    """SQLite serializes decisions and prevents overwriting a recorded decision."""

    def __init__(self, path):
        self.path = path

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path)
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS proposals (
                id TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS decisions (
                id TEXT PRIMARY KEY REFERENCES proposals(id),
                decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject')),
                actor TEXT NOT NULL, note TEXT NOT NULL, decided_at TEXT NOT NULL
            );
        """)
        return db

    def save(self, record):
        body = json.dumps(record, sort_keys=True)
        with closing(self.connect()) as db, db:
            db.execute("INSERT INTO proposals VALUES (?, ?, ?)",
                       (record["id"], body, proposal_digest(body)))

    def show(self, identifier):
        with closing(self.connect()) as db:
            row = db.execute("""
                SELECT body, digest, decision, actor, note, decided_at
                FROM proposals LEFT JOIN decisions USING (id) WHERE id = ?
            """, (identifier,)).fetchone()
        if row is None:
            raise ValueError("Unknown proposal ID.")
        body, digest, decision, actor, note, decided_at = row
        if proposal_digest(body) != digest:
            raise ValueError("Proposal digest mismatch.")
        record = json.loads(body)
        record["digest"] = digest
        record["decision"] = (
            {"decision": decision, "actor": actor, "note": note, "at": decided_at}
            if decision else None
        )
        return record

    def decide(self, identifier, digest, decision, actor, note):
        if not actor.strip() or not note.strip():
            raise ValueError("Record the CEO's name and decision note.")
        if decision not in {"approve", "reject"}:
            raise ValueError("Decision must be approve or reject.")
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            body, expected = self._proposal_for_decision(db, identifier)
            if digest != expected or proposal_digest(body) != expected:
                raise ValueError("Decision must reference the reviewed proposal digest.")
            cursor = db.execute("""
                INSERT INTO decisions VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
            """, (identifier, decision, actor.strip(), note.strip(), timestamp()))
            if cursor.rowcount != 1:
                raise ValueError("This proposal already has a recorded decision.")

    @staticmethod
    def _proposal_for_decision(db, identifier):
        row = db.execute("SELECT body, digest FROM proposals WHERE id = ?",
                         (identifier,)).fetchone()
        if row is None:
            raise ValueError("Unknown proposal ID.")
        return row
