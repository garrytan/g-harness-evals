# Preregistration: tooling validation of the rerun path, on H1 OpenClaw (HARN-24)

**This is tooling validation, not a replication of a publishable finding.** H1 replays a Sonnet 5.5 cell, and H1 is withdrawn from publication under R54 (gstack and gbrain evals test only Opus 5.5, GPT-6.1 Sol and at most one named low-cost primary; Sonnet is never a model under test). The rerun checks that `scripts/replicate.ts` works with a real key and a real cap; its verdict says nothing about any harness, gstack or gbrain.

**Question.** Does `scripts/replicate.ts`, run as an outsider would run it, rerun one cell of H1 under a hard cap and give a band verdict? And does today's OpenClaw cell, at the rerun commit, land inside the band the published run predicts?

**It is also an insider validation, not a new result.** The repository is private, so the validation machine clones with our credentials and passes the archive with `--bundle`. Nothing here changes a published number.

## What runs

| Step | Command (`docs/replicate.md`'s command with its documented `--reps`, `--yes` and `--allow-short-cap` options) | Cap | What it proves |
|---|---|---|---|
| 1. Free checks | `--reanalyze`, then `--estimate-only` | $0 | the bundle reproduces H1's tables; the estimate prints |
| 2. Cap-stop test | `--cell openclaw-sonnet-mu-heldout --reps 1 --max-usd 0.60 --allow-short-cap --yes` | $0.60 | the cap holds with a real key: INCOMPLETE, exit 3, ledger spend at or under $0.60 |
| 3. The 1-rep rerun | `--cell openclaw-sonnet-mu-heldout --reps 1 --max-usd 5 --yes` | $5.00 | the default outsider path end to end, with a band verdict |

- **Cell:** `openclaw-sonnet-mu-heldout` of `m3-heldout-2026-10` (OpenClaw 2026.10.6, `anthropic:claude-sonnet-5-5`, the 20 v0.1 held-out tasks).
- **Planning:** `bun runner/run.ts plan --replication-of m3-heldout-2026-10`, called by the tool. The v0.1 set is spent and plaintext, so the runs **open nothing**: no openings-ledger row, no change under `tasks/`.
- **Rerun commit:** the first main commit that holds both `scripts/replicate.ts` and this file. Each run records it in `replicate-state.json`, and a resume loads the same commit.
- **Bundle:** built on main at the rerun commit with `bun scripts/bundle.ts build --run docs/benchmarks/2026-10-24-m3-heldout --finding h1 --analysis summarize-run,compare-run --rerun-commit <rerun commit> --out <dir>`, checked with `verify --rebuild`. Its sha256 goes in the run log and the report, and every step passes it with `--sha256`.
- **Machine:** a fresh Capy machine, a clean clone, every step started with `env -i` plus only `PATH`, `HOME` and `ANTHROPIC_API_KEY`, as a background job with `--yes` (no terminal). Each step is timed for the doc.

## The band and the verdict

- **Band:** the central 95% of the posterior-predictive total, each task's rate drawn from Beta(k + 1/2, n - k + 1/2) on its published k of 5, endpoints included, seed 20261101.
- **For this cell at 1 rep the band is 12 to 17 passes of 20** (attained 97.5%). Its simulated coverage is 98.3% (gate 93%), committed as `docs/replicate/band-coverage-m3-heldout-openclaw.json`.
- **Verdict:** the tool's own line, WITHIN BAND or OUTSIDE BAND, with the task-paired difference (rerun minus published) and its interval beside it.

## Stop rules

- **The equivalence check refuses, or the regrade changes any published H1 grade:** stop before any paid step, and bring it to HARN-1 with plan decision 1 option (b) (rerun at the original run commit).
- **Step 2 spends more than its cap, or does not end INCOMPLETE with exit 3:** stop; the cap is broken. No step 3.
- **`--reanalyze` reports a mismatch (exit 4), or any step ends in a refusal (exit 2, an HE-REPL or HE-BUNDLE code):** stop before any further paid step, and bring the code and its fix line to HARN-1. This includes HE-REPL-007 (the estimate at the rerun commit is over the step's cap) and HE-REPL-012 (an image build or runner step failed). No `--resume`, cap change or new run id without HARN-1, except the machine-restart resume below.
- **Step 3 is OUTSIDE BAND:** report it as it is, and bring it to HARN-1 with decision 1 option (b) before any finding cites the rerun path.
- **Step 3 ends INCOMPLETE** (a trial ended in a model, infra or exam error, a request was refused for the cap, or the run was interrupted): report it as it is, with the tool's reason. A resume is allowed only after a machine restart (below); any other second paid attempt goes to HARN-1 first.
- **Step 3 prints NO BAND:** report the difference and its interval as the tool prints them, and bring it to HARN-1; no verdict is claimed.
- **A machine restart:** resume the same run id with `--resume` at the recorded commit, never a new lease; record the restart and the commit each process loaded.

## Money

- **Cap: $25 for the whole validation** (the lane cap). The two paid steps cap at $5.60 together. A `--resume` keeps the same lease and cap, so it spends none of the other $19.40; that money is unallocated and held for any second paid attempt HARN-1 approves.
- Every request goes through the metering proxy under the step's own lease in a local ledger. Spend is read from those ledgers and recorded in the Captain's ledger notes.
- **Expected:** about $3.50 for step 3 (H1's own per-trial cost repriced at this commit, `--estimate-only`) and under $0.60 for step 2.

## Deviations from plan revision 2

- **No 5-rep step.** The band's coverage check fails at 5 reps for this cell (92.0%, under the 93% gate), so a 5-rep rerun would print NO BAND and only the difference. Its smallest cap ($20.36) would also take the validation past the $25 lane cap. Decision 1's flip condition is read from the 1-rep band and the regrade instead.
- **Cap $25, not $40,** set by the Captain for this lane.
- **Labelled tooling validation (R54, 2026-11-01).** The cell's model is Sonnet 5.5, which R54 rules out as a model under test, so the report labels every number as tooling validation. When the first frontier finding merges, docs/replicate.md's example moves to it.
- **No smokes or preflight probes are paid:** this cell has no gbrain sidecar, so `preflight` makes no model call.

## Results

`results/` (each step's `replicate-report.json`, `runner.log`, `ledger.sqlite` and the rerun bundle's digest) and `report.md`, in a later pull request.
