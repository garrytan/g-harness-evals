# docs/

harness-evals v0.0.12. The index of this directory: one line per page, saying what the page answers. The repository's own front page is [../README.md](../README.md); the writing rules every page follows are in [../CLAUDE.md](../CLAUDE.md). Every published number on these pages is tied to a committed receipt, and [receipts-manifest.json](receipts-manifest.json) is the machine-readable list of those receipts.

## Pages

- [adapters.md](adapters.md): the adapter protocol. What a harness's `adapter.sh` receives, how a `run` turn and a `serve` trial proceed, which exit codes mean what, and how the conformance test checks an adapter against the fake harness.
- [benchmarks/](benchmarks/): one folder per counted run, each with `PREREGISTRATION.md`, `prereg.json`, and for every run that has executed, `report.md` and `results/`. The order check reads `preregistrations.json` and `preregistrations.d/`. Folders, by run id and the dates the trials ran (UTC):
  - [2026-10-22-m0-smoke/](benchmarks/2026-10-22-m0-smoke/PREREGISTRATION.md): `m0-smoke-2026-10`, preregistered 2026-10-22; the M0 smoke, preregistration only, no results directory.
  - [2026-10-23-m2-pilot/](benchmarks/2026-10-23-m2-pilot/report.md): `m2-pilot-2026-10`, 2026-10-22 to 2026-10-23; the dev-split pilot, three harnesses on Sonnet, 150 trials, a pilot and not a comparison.
  - [2026-10-24-m3-heldout/](benchmarks/2026-10-24-m3-heldout/report.md): `m3-heldout-2026-10`, 2026-10-23; the first counted comparison, 20 sealed held-out tasks, three harnesses on Sonnet, 300 trials.
  - [2026-10-24-m3-sensitivity-haiku/](benchmarks/2026-10-24-m3-sensitivity-haiku/report.md): `m3-sensitivity-haiku-2026-10`, 2026-10-23; the same exam with the model fixed to Haiku, 300 trials.
  - [2026-10-24-gbrain-arm/](benchmarks/2026-10-24-gbrain-arm/report.md): `gbrain-arm-2026-10`, 2026-10-24 to 2026-10-25; each harness with and without gbrain installed and unmentioned on Haiku and Sonnet, plus a told cell per harness on Haiku; 15 cells, 1,500 trials.
  - [2026-10-25-company-brain/](benchmarks/2026-10-25-company-brain/report.md): `company-brain-2026-10`, 2026-10-24 to 2026-10-25; scope leaks through an unscoped company brain against gbrain-side scoping, three harnesses on Haiku, 900 trials.
  - [2026-10-25-gbrain-ladder/](benchmarks/2026-10-25-gbrain-ladder/report.md): `gbrain-ladder-2026-10`, 2026-10-24 to 2026-10-25; the install ladder: `none`, `mcp` and five rungs (`told`, `docs`, `verbs-told`, `semantic-told`, `docs-semantic`) for OpenClaw and Hermes on Haiku, 14 cells, 1,400 trials.
  - [2026-10-25-gbrain-verbs/](benchmarks/2026-10-25-gbrain-verbs/report.md): `gbrain-verbs-2026-10`, 2026-10-25; told against verbs-told at ten repetitions, 800 trials.
  - [2026-10-25-gbrain-installer/](benchmarks/2026-10-25-gbrain-installer/report.md): `gbrain-installer-2026-10`, 2026-10-25; told against gbrain's own installer output, 400 trials.
  - [2026-10-25-gbrain-installer-hook/](benchmarks/2026-10-25-gbrain-installer-hook/report.md): `gbrain-installer-hook-2026-10`, 2026-10-26; the installer with its per-turn hook against told, the first run on the Ubicloud lane, 400 trials.
  - [2026-10-25-gbrain-scoped/](benchmarks/2026-10-25-gbrain-scoped/report.md): `gbrain-scoped-2026-10`, 2026-10-26; per-request scope (told-scoped) against told-company, 400 trials.
  - [2026-10-25-qm-inner-harness/](benchmarks/2026-10-25-qm-inner-harness/report.md): `qm-inner-harness-2026-10`, 2026-10-25; QM's Pi engine against its Claude Agent SDK integration on Haiku, 200 trials.
  - [2026-10-25-qm-probes/](benchmarks/2026-10-25-qm-probes/report.md): `qm-probes-2026-10`, 2026-10-25; nine QM product claims, each its own check, 96 trials, nothing pooled.
  - [2026-10-25-qm-probes-qp07/](benchmarks/2026-10-25-qm-probes-qp07/report.md): `qm-probes-qp07-2026-10`, 2026-10-25; the `qp-07` sandbox probe rerun with the directory seeded, 6 trials.
  - [2026-10-25-v02-pilot/](benchmarks/2026-10-25-v02-pilot/report.md): `v02-pilot-2026-10`, 2026-10-25; the v0.2 dev-split pilot on Haiku, four cells, 180 trials.
  - [2026-10-25-v02-heldout/](benchmarks/2026-10-25-v02-heldout/report.md): `v02-heldout-2026-10`, 2026-10-26; gbrain-told against none on the 15 sealed v0.2 tasks, three harnesses on Sonnet and Haiku, 900 trials.
  - [2026-10-26-gbrain-memory/](benchmarks/2026-10-26-gbrain-memory/PREREGISTRATION.md): `gbrain-memory-2026-10`, preregistered 2026-10-26 (#89); a member brain that fills during the scenario against none, three harnesses on Sonnet and Haiku, 12 cells, 900 trials planned; preregistration only, no results directory yet.
- [budget-ledger.md](budget-ledger.md): the program's spend ledger, one row per lane of paid work (written 2026-10-26 beside this index).
- [comparing-runs.md](comparing-runs.md): how two cells or two runs are compared: the paired, task-clustered estimator, the sign-flip test, Holm, the minimum detectable difference, what "not distinguished at N tasks" means, each comparison script's flags and outputs, and the exact commands every counted run's report names.
- [decisions.md](decisions.md): the decisions by Garry Tan and the Captain that shaped a counted run, one line each (written 2026-10-26 beside this index).
- [errors.md](errors.md): every error code the runner, proxy and adapters print, what it means, the fix, and where it lives.
- [gbrain-arm.md](gbrain-arm.md): the gbrain arm: what a sidecar per trial runs, the world's `/gbrain` tap, the install ladder, how the arm is wired into the runner and adapters, the smoke evidence, and the status of each gbrain run.
- [gbrain-evals-conventions.md](gbrain-evals-conventions.md): which conventions this repository takes from gbrain-evals as they are, which it adapts, and which it leaves out, with the reason for each.
- [methodology.md](methodology.md): the trial contract, the normative copy of the plan's contract section: isolation, metering, grading, termination and grade as separate fields, metrics, budget, artifacts, with its amendments in the changelog.
- [plans/](plans/2026-10-21-harness-eval-v0/plan.md): the approved plan (v2), its review record, decisions D1 to D10, findings, open tasks and every reviewer file, one folder per plan.
- [publishing-checklist.md](publishing-checklist.md): what was audited before the repository can be made public (`bun scripts/publish-audit.ts`), how to run it again, the merge record, and what the owner still decides.
- [qm-findings.md](qm-findings.md): product observations about QM v0.1.15 from the source read, the smokes, the inner-harness run and the probe suite, each with its trials and smallest reproduction.
- [receipts-manifest.json](receipts-manifest.json): the machine-readable receipts list, one entry per counted run with its preregistration commits and hashed artifacts (generated 2026-10-26 beside this index).
- [report-v0.1.md](report-v0.1.md): the one-page account of the v0.1 multi-user cell: finding, limits, interests, tables with intervals, taxonomy and spend, with every number copied from a named receipt.
- [tasks.md](tasks.md): the multi-user task format: families, the access model, the predicate library, oracles and the mutation contract, task sets (v0.1, v0.2, the QM probes) and how a cell selects one.
- [ubicloud.md](ubicloud.md): the Ubicloud shard lane: the scripts that put one shard per VM, how a run fans out and comes back, the check lane, costs and limits.

## Changelog

### 2026-10-26: first version (internal-task)

harness-evals v0.0.12. The index did not exist before; pages were reachable only from the repository README's table. Written with [comparing-runs.md](comparing-runs.md) in the same change, beside the budget ledger, decisions page and receipts manifest other internal-task work added the same day.
