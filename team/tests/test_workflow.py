import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from team.workflow import Records, estimate, proposal


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.path = Path(directory) / "team.sqlite3"
        self.records = Records(self.path)
        self.budget = estimate("2", "10", "0.10")

    def save_proposal(self):
        record = proposal("Review referral milestone", "a" * 40, "Demo only", self.budget)
        self.records.save(record)
        return self.records.show(record["id"])

    def test_role_order_and_provider_handoffs(self):
        class FakeProvider:
            def generate(self, role, phase, goal, evidence, handoffs):
                self_test.assertEqual(goal, "Review referral milestone")
                self_test.assertEqual(evidence, "Demo only")
                self_test.assertEqual(handoffs, tuple(seen))
                output = f"{role} {phase}"
                seen.append(output)
                return output

        self_test = self
        seen = []
        with patch("socket.socket", side_effect=AssertionError("Network is forbidden")):
            record = proposal("Review referral milestone", "a" * 40, "Demo only",
                              self.budget, FakeProvider())
            offline = self.save_proposal()
        self.assertEqual(seen, [
            "Chief of Staff intake", "CTO review", "Developer review", "QA review",
            "Security review", "CFO review", "Chief of Staff synthesis",
        ])
        self.assertEqual(record["approval_scope"], "milestone_scope_only")
        self.assertIsNone(offline["decision"])
        self.assertEqual(offline["commit"], "a" * 40)

    def test_full_run_budget_and_ceiling(self):
        self.assertEqual(self.budget["scenarios"], {
            "lean": {"input_tokens": 15000, "output_tokens": 3100,
                     "estimated_usd": "0.061", "within_ceiling": True},
            "robust": {"input_tokens": 34000, "output_tokens": 6900,
                       "estimated_usd": "0.137", "within_ceiling": False},
        })
        self.assertFalse(self.budget["live_use_authorized"])
        for rate in ("NaN", "Infinity", "-1", "invalid"):
            with self.subTest(rate=rate), self.assertRaises(ValueError):
                estimate(rate, "10", "0.10")

    def test_failed_provider_does_not_produce_proposal(self):
        class FailingProvider:
            def generate(self, role, phase, goal, evidence, handoffs):
                if role == "Developer":
                    raise RuntimeError("failed review")
                return "pending"

        with self.assertRaisesRegex(RuntimeError, "failed review"):
            self.records.save(proposal("Review", "a" * 40, "", self.budget, FailingProvider()))
        self.assertFalse(self.path.exists())

    def test_digest_and_duplicate_decision(self):
        record = self.save_proposal()
        identifier = record["id"]
        with self.assertRaisesRegex(ValueError, "digest"):
            self.records.decide(identifier, "wrong", "approve", "CEO", "Scope only")
        self.assertIsNone(self.records.show(identifier)["decision"])
        self.records.decide(identifier, record["digest"], "approve", "CEO", "Scope only")
        with self.assertRaisesRegex(ValueError, "already"):
            self.records.decide(identifier, record["digest"], "reject", "CEO", "Changed mind")
        decision = self.records.show(identifier)["decision"]
        self.assertEqual(decision["decision"], "approve")
        self.assertEqual(decision["actor"], "CEO")

    def test_concurrent_decisions_have_one_winner(self):
        record = self.save_proposal()

        def decide(choice):
            try:
                self.records.decide(record["id"], record["digest"], choice, "CEO", "Scope")
            except ValueError as exc:
                self.assertIn("already", str(exc))
                return None
            return choice

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(decide, ("approve", "reject")))
        recorded = self.records.show(record["id"])["decision"]["decision"]
        self.assertCountEqual(results, [recorded, None])

    def test_cli_milestone_and_rejection(self):
        command = [sys.executable, "-B", "-m", "team.agent_team", "--state", str(self.path)]
        result = subprocess.check_output(command + [
            "milestone", "--goal", "Review referral milestone", "--evidence", "Demo only",
            "--input-rate", "2", "--output-rate", "10", "--ceiling", "0.10",
        ], text=True)
        record = json.loads(result)
        self.assertRegex(record["commit"], "^[0-9a-f]{40}$")
        result = subprocess.check_output(command + [
            "decide", record["id"], "--digest", record["digest"], "--decision",
            "reject", "--ceo", "Example CEO", "--note", "Request narrower scope",
        ], text=True)
        self.assertEqual(json.loads(result)["decision"]["decision"], "reject")


if __name__ == "__main__":
    unittest.main()
