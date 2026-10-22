# harness-evals

A reproducible comparison of agent harnesses: [OpenClaw](https://docs.openclaw.ai/), [Hermes Agent](https://github.com/nousresearch/hermes-agent), [QM](https://github.com/yc-software/qm), [[name withheld]](https://docs.[name withheld]/[name withheld]/overview) and [[name withheld]](https://ai.meta.com/[name withheld]/). The question is what the harness contributes when the model is held fixed, on the work these harnesses are sold for: several people sharing one agent in Slack-style channels, per-person scoped memory and files, org-level rules, continuity across sessions, and ordinary work tasks. Coding appears only as a small calibration cell against published numbers.

Nothing has been measured yet. This repository holds the approved plan, the research it rests on, and the first pieces of the evaluation machinery. Everything above [Changelog](#changelog) describes the repository as it stands at `VERSION`.

## What is here

| Item | Where |
|---|---|
| The approved plan (v2, two review rounds, 172 findings), its review record, findings, open tasks and every reviewer file | [docs/plans/2026-10-21-harness-eval-v0/](docs/plans/2026-10-21-harness-eval-v0/) |
| Survey of every published harness comparison and the agent benchmarks the five harnesses could run against | [compendium.md](compendium.md) |
| The conventions taken from [gbrain-evals](https://github.com/garrytan/gbrain-evals), and which ones were adapted or left out | [docs/gbrain-evals-conventions.md](docs/gbrain-evals-conventions.md) |
| The trial contract: isolation, metering, grading, termination and grade as separate fields, metrics, budget, artifacts | [docs/methodology.md](docs/methodology.md) |
| Statistics kit (exact / noninferiority / superiority / exploratory gates, Holm correction, task-clustered paired bootstrap), vendored from gbrain-evals | [runner/stats/](runner/stats/) |
| The runner: `plan` / `dry-run` / `preflight` / `run` (trial dispatch with a world per trial, a metering proxy per run, docker, process and scripted harness modes), plus the vendored proxy, budget ledger and price table | [runner/README.md](runner/README.md), [runner/run.ts](runner/run.ts) |
| Multi-user task format, access model, predicate library, oracle and mutation contract | [docs/tasks.md](docs/tasks.md) |
| The 30 multi-user tasks (10 dev, 20 held-out) with oracles and mutation matrices, and the grader that scores them from world state | [tasks/multiuser/README.md](tasks/multiuser/README.md), [runner/grade/](runner/grade/) |
| Contracts shared by runner, adapters, graders and scripted solutions | [runner/contracts.ts](runner/contracts.ts) |
| Error codes | [docs/errors.md](docs/errors.md) |
| Preregistration-order checker: a preregistration must be committed before any file matching its result globs | [runner/prereg/prereg.ts](runner/prereg/prereg.ts), [docs/benchmarks/preregistrations.json](docs/benchmarks/preregistrations.json) |
| Open work carried out of the plan review | [TODOS.md](TODOS.md) |

## How the comparison works, in short

Three open harnesses (OpenClaw, Hermes Agent, QM through its Pi adapter) run headlessly on one frozen model inside one frozen simulated company, five trials per task. The company is seeded from gbrain-evals' `messy-company-v1`: 14 employees, 16 accounts, chats, email, tickets, contracts and private notes. The headline slice is multi-user: scope isolation between members, two members in one channel, an admin rule that must hold for everyone, handoffs, scheduled team work. Around it sit a single-user work slice, a continuity slice with a reset-state counterfactual on a frozen clock, a 21-task coding calibration cell, a frontier-model sensitivity cell, and a QM cell that separates its multi-user layer from its inner engine.

Grading reads the world's state and evaluator-owned event logs, never the agent's own account of what it did. Every number is reported with its interval and sample size; there are no ranks and no composite. [name withheld] and [name withheld] expose no headless API, so they are measured as products, with their own models, only on tasks a week-one connectivity probe proves they can reach, in a separate table that says so.

The full design, decisions and milestones are in the [plan](docs/plans/2026-10-21-harness-eval-v0/plan.md).

## Run the checks

```sh
bun install --frozen-lockfile
bun test tests/            # statistics kit, preregistration checker, world, proxy, grader and task matrix, the trial loop with a fixture adapter
bunx tsc --noEmit
python3 scripts/check-links.py
bun runner/prereg/prereg.ts
```

None of these calls a model API. Paid runs do not exist yet; when they do, they will spend through a budget ledger and land receipts here.

## Changelog

### 2026-10-22: M1 lane A, trial dispatch

harness-evals v0.0.3. The runner row names `run` and its harness modes; the test line names the trial loop. Details in [runner/README.md](runner/README.md) and CHANGELOG.md.

### 2026-10-22: M1 lane B, multi-user tasks and grader

harness-evals v0.0.3. Added the 30 multi-user tasks with oracles and mutation matrices, the shared preamble, the held-out manifest, and `runner/grade/` (task parser, predicate library, `gradeTrial`, in-process player); the task matrix runs keyless in CI.

### 2026-10-22: M0 runner, proxy and ledger

harness-evals v0.0.2. Added the metering proxy, budget ledger and price table vendored from gbrain-evals and gbrain, the `runner/run.ts` plan and dry-run CLI, the error-code table and the M0 smoke preregistration with the D1 model amendment.

### 2026-10-22: Repository created with the approved plan

harness-evals v0.0.1. Plan v2 approved by Garry Tan after two gstack autoplan review rounds (CEO, DX and Eng phases; native voice Claude Fable 5.1, outside voice GPT-6.1 Sol). Added the research compendium, the gbrain-evals conventions note, the trial contract, the vendored statistics kit with its tests, the preregistration-order checker, TODOS from the review's open tasks, and keyless CI.
