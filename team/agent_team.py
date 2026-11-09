"""Run from the checkout root with python -m team.agent_team."""
import argparse
import json
from pathlib import Path
import sqlite3
import subprocess

from .workflow import Records, estimate, proposal


def add_rates(parser):
    parser.add_argument("--input-rate", required=True, help="USD per million input tokens")
    parser.add_argument("--output-rate", required=True, help="USD per million output tokens")
    parser.add_argument("--ceiling", required=True, help="Hypothetical live ceiling in USD")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path(__file__).parent / "state" / "team.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    add_rates(commands.add_parser("estimate"))
    plan = commands.add_parser("milestone")
    plan.add_argument("--goal", required=True)
    plan.add_argument("--evidence", required=True, help="Curated, non-sensitive evidence excerpt")
    add_rates(plan)
    commands.add_parser("show").add_argument("id")
    decide = commands.add_parser("decide")
    decide.add_argument("id")
    decide.add_argument("--digest", required=True)
    decide.add_argument("--decision", choices=("approve", "reject"), required=True)
    decide.add_argument("--ceo", required=True, help="Name attested by the trusted operator")
    decide.add_argument("--note", required=True)
    args = parser.parse_args(argv)

    try:
        records = Records(args.state)
        if args.command in {"estimate", "milestone"}:
            result = estimate(args.input_rate, args.output_rate, args.ceiling)
            if args.command == "milestone":
                commit = subprocess.check_output(
                    ["git", "rev-parse", "--verify", "HEAD^{commit}"], text=True,
                    cwd=Path(__file__).resolve().parent.parent,
                ).strip()
                record = proposal(args.goal, commit, args.evidence, result)
                records.save(record)
                result = records.show(record["id"])
        else:
            if args.command == "decide":
                records.decide(args.id, args.digest, args.decision, args.ceo, args.note)
            result = records.show(args.id)
    except (ValueError, OSError, sqlite3.Error, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
