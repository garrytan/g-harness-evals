# H1 OpenClaw cell, rerun from its published bundle (2026-11-19)

- **We learned that a stranger can recheck this run with one command per step.** A fresh clone of the public copy, the published bundle and an Anthropic key were enough to rerun one cell and get a verdict.
- **The rerun landed where the published run predicts.** 15 of 20 tasks passed against 77 of 100 published, inside the band of 12 to 17, so the verdict is `WITHIN BAND` (exit 0).
- **This checks the tool, not a harness.** The cell runs Claude Sonnet 5.5, which these evals no longer test, so the result says nothing new about OpenClaw.

## What ran

| | |
|---|---|
| Run rechecked | `m3-heldout-2026-10` ([report](../../benchmarks/2026-10-24-m3-heldout/report.md)) |
| Cell | `openclaw-sonnet-mu-heldout`, 20 held-out tasks, 1 repetition |
| Bundle | [2026-10-24-m3-heldout.bundle.tar.gz](https://github.com/garrytan/g-harness-evals/releases/download/data-2026-10-24-m3-heldout/2026-10-24-m3-heldout.bundle.tar.gz), sha256 `1d39a3e5b97fcf85f6c47a1865ca0235b9dbaf1c06724f5d91c123ccf186c78b` |
| Checkout | fresh clone of `garrytan/g-harness-evals` at `f4dc3dff41f1edc39beedfbe71b50cb0245209d7` (the bundle's `rerun_commit`), `bun install --frozen-lockfile` |
| Cap | `--max-usd 6` (smallest the tool accepts: $4.69) |

Commands, in order, all from the checkout: [docs/replicate.md](../../replicate.md#the-commands).

## What it found

- `--reanalyze`: `MATCH`, exit 0. The analyzers reproduced the bundle's tables byte for byte.
- `--estimate-only`: expected $3.47, high $3.92, smallest cap $4.69, about 30 minutes.
- Equivalence (keyless): task files, preamble, seed world and the OpenClaw pin unchanged since the run commit; the grader regraded all 100 published trials of the cell with 0 changes.
- Rerun: 15 of 20 passed (75.0%, 95% CI 55.0% to 90.0%). Published: 77 of 100 (77.0%).
- Rerun minus published: -2.0 points, task-paired 95% interval -14.0 to +7.0.
- Band: 12 to 17 of 20 (coverage 98.3% from [band-coverage-m3-heldout-openclaw.json](../band-coverage-m3-heldout-openclaw.json)). **`WITHIN BAND`**, exit 0.
- Complete: 20 of 20 trials kept, no cap stop, no error termination.
- Spend: $3.00 committed against the $6 cap, through the metering proxy under one lease in the rerun's own ledger.

## Limits

- One repetition per task. One miss would be a signal to look, not a refutation; one hit is not proof the run is right.
- The lease in the rerun's local ledger is still open after a complete run (`spend.lease_open: true`); it holds no more money than was spent.
- The rerun bundle path in [replicate-report.json](replicate-report.json) ends in `rerun.bundle.tar.gz/replicate-openclaw-sonnet-mu-heldout.bundle.tar.gz`: at this commit the tool wrote a folder named `rerun.bundle.tar.gz` holding the archive. Later commits write the archive itself at `rerun.bundle.tar.gz`.
- Paths in the report are the rerun machine's own.
