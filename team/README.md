# TruFolks executive team pilot

Run from the repository root with Python 3.12+ and Git. This internal CLI uses
the standard library and deterministic offline role checklists. The public
TanStack application and its build, auth, database, and deployment paths are
separate from the CLI. CI runs only the offline tests.

```sh
python -B -m unittest discover -s team/tests -v
python -B -m team.agent_team estimate --input-rate 2 --output-rate 10 --ceiling 0.10
python -B -m team.agent_team milestone --goal "Assess a referral milestone" --evidence "Offer route is a demo" --input-rate 2 --output-rate 10 --ceiling 0.10
python -B -m team.agent_team show PROPOSAL_ID
python -B -m team.agent_team decide PROPOSAL_ID --digest REVIEWED_DIGEST --decision approve --ceo "CEO name" --note "Scope approved for this milestone"
```

Chief of Staff frames the goal. CTO, Developer, QA, Security, and CFO produce
review checklists, then Chief of Staff consolidates the decision brief. Offline
outputs describe planned reviews. Supply short, manually curated evidence
corresponding to the recorded Git commit. Exclude customer data and credentials.

Use the decision command only after receiving an explicit CEO decision. The
operator attests the CEO's name. This is a local audit record and relies on
trusted workstation access. The proposal digest binds the decision to the
reviewed content, and the database allows one decision per proposal. A revised
scope requires a new proposal. State is local in the ignored `team/state/`
directory by default. Use `--state PATH` before the subcommand for another
database. Keep state private and back it up if the audit record must persist.
Scope approval does not authorize API calls, spend, code execution, or release.

## Cost review before live work

The pilot spending ceiling is **USD 0**. A later provider can implement
`RoleProvider`; the CLI currently ships only the offline provider. Before a
live task, obtain an explicit decision on the task and its budget after
presenting both scenarios, expected cost at verified rates, and a recommended
ceiling. Include prompts, context, role handoffs, reasoning/output, and any
allowed retries in the estimate.

| Scenario | Input | Output | Example cost |
| --- | ---: | ---: | ---: |
| Lean, targeted evidence and compact handoffs | 15,000 | 3,100 | $0.061 |
| Robust, more evidence and detailed review across the same roles | 34,000 | 6,900 | $0.137 |

Example costs assume $2 and $10 per million input and output tokens,
respectively. These are illustrative rates. At those rates, $0.10 is a
proposed ceiling for a single future lean run, pending CEO approval. The
estimator sums all seven calls, compares each scenario to the proposed ceiling,
and reports budget fit. A live adapter would need to enforce the approved
whole-run ceiling and record actual usage before being enabled.
