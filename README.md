# harness-evals

A reproducible comparison of agent harnesses: [OpenClaw](https://docs.openclaw.ai/), [Hermes Agent](https://github.com/nousresearch/hermes-agent), [QM](https://github.com/yc-software/qm), [[name withheld]](https://docs.[name withheld]/[name withheld]/overview) and [[name withheld]](https://ai.meta.com/[name withheld]/). The question is what the harness contributes when the model is held fixed, on the work these harnesses are sold for: several people sharing one agent in Slack-style channels, per-person scoped memory and files, org-level rules, continuity across sessions, and ordinary work tasks. Coding appears only as a small calibration cell against published numbers.

The one-page account of the v0.1 result, with its limits, interests and receipts, is [docs/report-v0.1.md](docs/report-v0.1.md); the publishing audit and checklist for making this repository public are [docs/publishing-checklist.md](docs/publishing-checklist.md). The first counted comparison has run: the v0.1 multi-user cell on 20 sealed held-out tasks, OpenClaw, Hermes Agent and QM (Pi) on one fixed model, 300 trials. Its report is [docs/benchmarks/2026-10-24-m3-heldout/report.md](docs/benchmarks/2026-10-24-m3-heldout/report.md): pass rates are not distinguished (96%, 91%, 89% over the capable families, every pairwise interval crossing zero, 13 of 16 tasks at ceiling for all three), no consent violation or leak in 300 trials, and a two-to-three-fold difference in tokens, cost and time per trial. The sensitivity cell on a weaker model ([docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md)) shows the model moving the result more than the harness: every harness lost 13 to 19 points going from Sonnet to Haiku, while the harness gaps on Haiku (80%, 79%, 70%) stay within noise. The pilot that preceded both is [docs/benchmarks/2026-10-23-m2-pilot/report.md](docs/benchmarks/2026-10-23-m2-pilot/report.md). This repository holds the approved plan, the research it rests on, the evaluation machinery (world, runner, adapters, tasks, graders) and every receipt. Everything above [Changelog](#changelog) describes the repository as it stands at `VERSION`.

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
| Task sets: how a second set such as v0.2 lives beside the v0.1 tasks and is selected by a cell (internal-task) | [docs/tasks.md](docs/tasks.md), "Task sets" |
| Contracts shared by runner, adapters, graders and scripted solutions | [runner/contracts.ts](runner/contracts.ts) |
| Harness images and adapters (`run` and `serve`), the adapter protocol, and the serve-mode smoke driver | [harnesses/README.md](harnesses/README.md), [docs/adapters.md](docs/adapters.md) |
| Error codes | [docs/errors.md](docs/errors.md) |
| Preregistration-order checker: a preregistration must be committed before any file matching its result globs | [runner/prereg/prereg.ts](runner/prereg/prereg.ts), [docs/benchmarks/preregistrations.json](docs/benchmarks/preregistrations.json) |
| M3 held-out run (v0.1 multi-user cell): preregistration, report and receipts | [docs/benchmarks/2026-10-24-m3-heldout/](docs/benchmarks/2026-10-24-m3-heldout/) |
| M3 sensitivity cell (same tasks, claude-haiku-5-5): preregistration, report and receipts | [docs/benchmarks/2026-10-24-m3-sensitivity-haiku/](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/) |
| M2 pilot: preregistration, report and receipts (dev split, three harnesses, five repetitions) | [docs/benchmarks/2026-10-23-m2-pilot/](docs/benchmarks/2026-10-23-m2-pilot/) |
| The gbrain arm: a gbrain sidecar per trial beside the world tools, the world's `/gbrain` tap, runner and adapter wiring, smoke evidence | [docs/gbrain-arm.md](docs/gbrain-arm.md), [gbrain/](gbrain/README.md) |
| The v0.1 report, one page: finding, limits, interests, tables with intervals, taxonomy and spend summary, the gbrain arm marked pending | [docs/report-v0.1.md](docs/report-v0.1.md) |
| Publishing audit (`bun scripts/publish-audit.ts`: token scan over the working tree, every decoded receipt and every blob in history; personal-data and receipts checks) and the checklist for going public | [docs/publishing-checklist.md](docs/publishing-checklist.md), [scripts/publish-audit.ts](scripts/publish-audit.ts) |
| Failure taxonomy of the three v0.1 runs: every failed predicate labelled with an observed mode and one line of evidence, with a hand-labelled calibration sample (`bun scripts/taxonomy.ts --results <dir>`) | [scripts/taxonomy.ts](scripts/taxonomy.ts), `results/taxonomy.md` under each run above, taxonomy section of each report |
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

None of these calls a model API. A paid run is `bun runner/run.ts plan --prereg <file>` then `run --manifest <file>` after the preregistration is committed (runner/README.md); it spends through the proxy's lease ledger and lands its receipts under `docs/benchmarks/<run>/results/`. `bun scripts/summarize-run.ts --results <dir>` prints a run's tables and `bun scripts/regrade.ts` re-reads its evidence with the current grader.

**What is and is not proven about spend.** Every published dollar figure is the metering proxy's list-price meter. For every counted trial the proxy's meter agrees with its own usage log (`reconcile.json` per trial), and for every counted run the usage log, the per-trial `usage.json` sums and the lease ledger agree to the cent (`bun scripts/reconcile-provider.ts --results <dir>`, written to `results/spend-reconciliation.json`). What is not proven is that the provider billed the same: that check needs an Anthropic Admin API key, which the v0.1 runs did not have, so each run's `spend-reconciliation.json` says "not performed" and carries the per-day sheet to check against the console by hand. Per-trial reconciliation against the provider is not possible with one upstream key (docs/methodology.md, item 3 as amended on 2026-10-24).

## Changelog

### 2026-10-24: v0.1 report page and publishing checklist (internal-task)

harness-evals v0.0.5. `docs/report-v0.1.md` is the first page for the v0.1 result and the opening paragraph points at it; `docs/publishing-checklist.md` and `scripts/publish-audit.ts` record what was checked before the repository can be made public and what remains for the owner to decide.

### 2026-10-24: Failure taxonomy (internal-task)

harness-evals v0.0.5. `scripts/taxonomy.ts` labels every failed required predicate of a graded run with an observed failure mode from `events.jsonl`, `turns.jsonl` and the task's oracle, one line of evidence each, and records the facts behind the label and the classifier's provenance (rule order, patterns, digests of every task and oracle read). Each v0.1 report gains a taxonomy section; pass rates are unchanged. A 30-failure hand-labelled sample agrees with the script on all 30 after two rule changes it prompted (25 before).

### 2026-10-24: Spend reconciliation (internal-task)

harness-evals v0.0.5. The checks section gains "What is and is not proven about spend": the proxy-side checks that hold for every counted trial and run, the provider-side check that needs an Admin API key and has not been performed, and the amendment of methodology item 3 to per run and per key-day. `scripts/reconcile-provider.ts` is new (runner/README.md, report tooling).

### 2026-10-24: gbrain arm preregistered

harness-evals v0.0.5. Run `gbrain-arm-2026-10` is preregistered ([docs/benchmarks/2026-10-24-gbrain-arm/PREREGISTRATION.md](docs/benchmarks/2026-10-24-gbrain-arm/PREREGISTRATION.md)): each harness with and without gbrain on Haiku and Sonnet, plus a Haiku arm whose preamble carries gbrain's brain-first rule; cells may name their own preamble.

### 2026-10-24: From the gbrain arm, lane D

harness-evals v0.0.5. New row for the gbrain arm (sidecar image, world tap, runner and adapter wiring; smoke: OpenClaw, Hermes and QM each discovered gbrain's 33 tools on one held-out task and none called one). Details in [docs/gbrain-arm.md](docs/gbrain-arm.md) and CHANGELOG.md.

### 2026-10-23: From the gbrain arm, lane E

harness-evals v0.0.5. Grading and report tooling for the gbrain arm: the grader counts gbrain reads for scope through their page slugs (docs/tasks.md, "gbrain reads"), `summarize-run.ts` reports gbrain usage per cell, `compare-run.ts --pair gbrain` pairs each harness with and without gbrain within a run, and `paired-mdd.ts` states the design's minimum detectable difference (runner/README.md, report tooling).

### 2026-10-23: Sensitivity cell reported

harness-evals v0.0.5. The opening paragraph adds the Haiku result; new row for the sensitivity folder.

### 2026-10-23: M3 held-out run reported

harness-evals v0.0.5. The opening paragraph states the v0.1 multi-user result and links the report; new row for the M3 folder.

### 2026-10-23: M2 pilot run and reported

harness-evals v0.0.4. The opening paragraph says one pilot has run; new rows for the pilot folder; the checks section names how a paid run is started and summarised.

### 2026-10-22: M1 lane A, trial dispatch

harness-evals v0.0.3. The runner row names `run` and its harness modes; the test line names the trial loop. Details in [runner/README.md](runner/README.md) and CHANGELOG.md.

### 2026-10-22: M1 lane B, multi-user tasks and grader

harness-evals v0.0.3. Added the 30 multi-user tasks with oracles and mutation matrices, the shared preamble, the held-out manifest, and `runner/grade/` (task parser, predicate library, `gradeTrial`, in-process player); the task matrix runs keyless in CI.

### 2026-10-22: M1 lane C, adapter serve

Added the harness images and adapter protocol row; `serve` is implemented for every harness and proven live on OpenClaw, Hermes and QM (harnesses/README.md).

### 2026-10-22: M0 runner, proxy and ledger

harness-evals v0.0.2. Added the metering proxy, budget ledger and price table vendored from gbrain-evals and gbrain, the `runner/run.ts` plan and dry-run CLI, the error-code table and the M0 smoke preregistration with the D1 model amendment.

### 2026-10-22: Repository created with the approved plan

harness-evals v0.0.1. Plan v2 approved by Garry Tan after two gstack autoplan review rounds (CEO, DX and Eng phases; native voice Claude Fable 5.1, outside voice GPT-6.1 Sol). Added the research compendium, the gbrain-evals conventions note, the trial contract, the vendored statistics kit with its tests, the preregistration-order checker, TODOS from the review's open tasks, and keyless CI.
