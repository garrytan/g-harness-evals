# Working on harness-evals

This repository compares agent harnesses. A harness is everything around the model: the tools, prompts, context management, channels, memory, scheduling and permissions that turn a chat model into an agent. We hold the model fixed and vary the harness, on tasks that look like the work these harnesses are sold for.

There is no home team. OpenClaw, Hermes Agent, QM, Claude Code and Codex get the same treatment: the same tasks, the same graders, the same report structure, and the same "what to use and what to avoid" paragraph. A result a harness's maintainers would dispute is published with the evidence that supports it and the limit that qualifies it.

## Read first

- [docs/plans/2026-10-21-harness-eval-v0/plan.md](docs/plans/2026-10-21-harness-eval-v0/plan.md): the approved plan, decisions D1 to D10, milestones M0 to M5.
- [docs/methodology.md](docs/methodology.md): the trial contract every runner and grader implements.
- [TODOS.md](TODOS.md): open work from the plan review, each item with its finding id.
- [compendium.md](compendium.md): what has been published before, and what to reuse.
- [docs/gbrain-evals-conventions.md](docs/gbrain-evals-conventions.md): where our conventions come from.

## Write for the engineer choosing a harness for a team

Explain the task, the setting that changed the outcome, and the limit of the result in ordinary words. "Keep Alice's private notes out of Bob's answer" says more than "scope isolation". Define a term when it first matters. Short paragraphs, active verbs, no marketing language, no em dashes. Keep technical names in code formatting so a reader can find the implementation.

## Repository map

- `docs/plans/`: plans and their review records, one folder per plan.
- `docs/benchmarks/`: preregistrations, runbooks and reports, one folder per counted run; `preregistrations.json` and `preregistrations.d/` register experiments for the order check.
- `findings/`: one file per public claim, each tied to receipts at a pinned commit; `findings/README.md` is the index.
- `runner/stats/`: the statistics kit (vendored from gbrain-evals, MIT).
- `runner/prereg/`: the preregistration-order checker.
- `tests/`: `bun test tests/`.
- `scripts/`: documentation checks.
- `world/`: the simulated company: `seed/` (messy-company-v1 import, `world.json`, manifest), `services/` (Slack mock, clock, event log, one process per trial), `world-mcp/` (the MCP server every harness gets).
- `sealed/`: `recipient.txt`, the public age recipient of the held-out custody identity, one line; `tests/sealed-recipient.test.ts` checks its shape. The identity itself is not in the repository.
- `harnesses/<name>/`: each harness's image, adapter and `pin.json`. `tasks/`: the task sets with their oracles and seals. `runner/proxy/` and `runner/ledger/`: the metering proxy and the budget ledger.
- Planned (see the plan's repository layout): `runner/egress/`. Run results live under `docs/benchmarks/<run>/results/`, not in a top-level `results/`.

## Shape of a top-level document

README.md and the hub pages in `docs/` have two parts: the current state on top, in present tense, never naming the current release version (point at `VERSION` and `CHANGELOG.md` instead; a past version an older page opens with is history and stays as it is); and a `## Changelog` at the bottom, newest first, one dated entry per change saying what changed on that page and why. A page changelog entry carries no version number, and a change that only moves the version adds no entry: a version written into a page changes whenever a pull request is renumbered after another one merges, and gstack then counts the page as changed product and will not carry the /ship receipt across the base merge (`.gstack/ship-policy.json` lists the files that may differ by a version stamp). Replace a superseded claim instead of appending an update beside it, and add the changelog entry in the same commit.

## Shape of a benchmark report

1. The finding: the conclusion, the tested configuration, the date, the main measurement, and whether it is a recommendation or inconclusive.
2. The concrete case: what the task asks, what the harness has to do, invented examples labelled as such.
3. The experiment and results: world, arms, metric, denominator, sample size, the head-to-head table with intervals, the settings that changed behavior.
4. What to use and what to avoid, written identically for every harness, with losses, errors and incomplete measurements beside the claims they qualify.
5. Reproduce and inspect: repository-root commands, pins, keys, output paths, observed time and cost, links to raw results.

## Evidence rules

- Grade world state and evaluator-owned event logs, never the agent's reply. The reply gets its own rubric score, reported separately.
- Name the denominator. Pass rate, pass^k, pass@k, consent-violation rate and cost per success answer different questions; never combine them.
- Report intervals and n beside every figure; cluster by task; a harness at ceiling or floor is uninformative, not a tie. No ranks, no composite.
- Record termination, grade and effects as separate fields. A harness error is the harness's fault but not a wrong answer; a model or infrastructure error is excluded with its count published.
- Preregister before the first counted cell. Amendments are dated and committed before the cells they affect. A changed allowlist, model revision or pin is a new run.
- Spend through the ledger. A cap stop is an incomplete run, recorded as such, never backfilled or retried to change a verdict.
- Keep provenance. Every published number has a row in the receipts manifest pointing at a hashed artifact.
- Hold out. Dev-split tasks are public; held-out task bodies and hidden facts stay in sealed custody with a committed digest until a run spends them. From v0.3 a held-out set is sealed: only the custodian holds the key and opens it, and every other thread works from the public export ([docs/sealed-custody.md](docs/sealed-custody.md)).
- Never publish secrets, real personal data, or the agent's raw traces without the redaction boundary.

## Choose models

The controlled arm runs one fixed model for every harness (plan D1). The sensitivity and inner-harness cells use the newest frontier model of each family at the time of the preregistration; a newer release replaces its predecessor only through a dated amendment with its price registered. Do not run older generations beside newer ones.

## Running and publishing work

Start with the keyless checks (`bun test tests/`, `bunx tsc --noEmit`, `python3 scripts/check-links.py`, `bun runner/prereg/prereg.ts`). Before a paid run: write the preregistration, initialise the ledger with the authorised cap, run the dry-run matrix, and only then dispatch. Save raw output, resolved settings and code identities with the run. Write the report from the results, including the cells that failed.

This guide does not authorise pushing, merging, spending or publishing; follow the current task's instructions for those.
