# Loop preregistration: harness-zero

This is the R7 preregistration ([methodology](../methodology.md), item 14) of internal-task's Phase C: the loop that decides which Harness Zero switches earn their keep. It follows [the loop template](TEMPLATE.md). The run that feeds it is [harness-zero-select-2026-11](../benchmarks/2026-10-31-harness-zero-select/PREREGISTRATION.md), which has the cells, leases, shards and receipts. This file holds the rules.

**In one line:** drop one switch at a time from `zero-full`, measure the effect on Opus 5.5 against a measured noise floor, and label each switch keep, cut or can't tell.

## What the loop changes and why

- **Owner:** internal-task (Harness Zero), which took over from internal-task on 2026-11-03. The system it steers is [harnesses/harness-zero](../../harnesses/harness-zero/README.md), a harness whose every feature beyond the bare loop is a named switch.
- **Question:** which Harness Zero switches earn their keep on the 20 public v0.3 dev tasks at frontier models, judged on pass rate and cost?
- **Proposer:** a fixed schedule, not a model. Every change the loop measures is named here before the first trial: one ablation cell per tested switch, plus one bundled cell for the five prompt layers. internal-task applies the verdict rules below mechanically and writes the result. No change is added after the first trial except by a dated amendment.

## Writable paths

- `harnesses/harness-zero/config/candidates.json`, and only its `zero-lean`, `zero-conservative` and `zero-control` sets (plus `zero-lean-sol` and `zero-conservative-sol` when Sol's own verdicts differ; see "Candidates"). The loop writes it once, in PR 3, after every Phase C cell has finished.

Anything else in a proposed change is refused before it is measured. `config/features.json`, which defines `zero-min`, `zero-full`, `zero-full-minus-layers`, every `zero-full-no-<slug>` and every knob, is frozen.

## Frozen surface

- **Paths:** `tasks/multiuser/v0.3/dev/`, `tasks/multiuser/_shared/preamble.md`, `world/`, `runner/grade/`, `runner/proxy/`, `runner/pricing/`, `runner/ledger/`, `runner/trial/`, `runner/stats/`, `scripts/summarize-run.ts`, `scripts/compare-run.ts`, and in `harnesses/harness-zero/`: `zero.ts`, `adapter.sh`, `Dockerfile`, `pin.json`, `config/features.json`, `config/prompts/`. `scripts/merge-shards.ts` is not in the hash; PR 3 runs it at the merge commit.
- **Hash:** sha256 of the `git ls-tree -r` listing of those paths at the run's preregistration merge commit on main, computed with:

```sh
git ls-tree -r <commit> -- tasks/multiuser/v0.3/dev tasks/multiuser/_shared/preamble.md world runner/grade runner/proxy \
  runner/pricing runner/ledger runner/trial runner/stats harnesses/harness-zero/zero.ts harnesses/harness-zero/adapter.sh \
  harnesses/harness-zero/Dockerfile harnesses/harness-zero/pin.json harnesses/harness-zero/config/features.json \
  harnesses/harness-zero/config/prompts scripts/summarize-run.ts scripts/compare-run.ts | sha256sum
```

- **Value:** recorded at the merge commit in the run log's first line and in the PR 3 report. On the preregistration base `896f2534b` (main after #277; 217 entries) it is `5233f36825c8951b5c295a01c48da6415652b505e182f028b3452e1a0f1af339`. The value changes when the branch is rebased onto main, so only the merge-commit value binds.

## Data the loop sees

- **Dev set:** the 20 public dev tasks of v0.3, all diagnostics allowed (failing cases, transcripts, per-task counts). Every task is public, so every verdict is labelled dev.
- **Held-out or sealed set:** none. The loop opens no held-out set and has no `heldout` block, so R4 holds trivially.
- **Exposures:** none to record.

## Candidate hash (R5)

`candidate_sha256` is the hash `zero.ts` prints in `ready` and `explain`: sha256 over `zero.ts`, the set's features with every knob value, every prompt file the set loads, `adapter.sh`, the `Dockerfile`, and `pin.json`'s base image digest and Bun version. The set's name is not part of it. `tests/harness-zero-*.test.ts` changes each input and checks the hash changes. PR 3 records the hash of every frozen candidate.

## Noise floor (R1)

- **Measured by:** a second `zero-full` cell on Opus 5.5 (`zero-full-b`), with the same 20 tasks and 5 repetitions as the reference cell `zero-full-a`, on its own VM.
- **Floor value:** F = the half-width of the task-clustered paired 95% interval of `zero-full-b` minus `zero-full-a` in pass-rate points (tasks resampled with replacement, 10,000 draws, seed 7, paired by task and repetition, as `scripts/compare-run.ts --baseline` computes it, #277). The value and its receipt come in PR 3.
- **Prior guide, not the floor:** in #145, paired intervals between harnesses at 20 tasks by 5 repetitions had half-widths of about 4 to 17 points.

## Keep rule (R1, R2)

Every ablation cell is paired with `zero-full-a` by task and repetition. "Dropping X" means the ablation cell minus `zero-full-a`.

- **Pass-rate difference:** the paired difference and its task-clustered 95% interval, as for the floor.
- **Cost per success:** total spend over passes, ablation over reference, with a task-clustered bootstrap interval of that ratio (same draws and seed).
- **Broken and fixed tasks (R2):** a task is broken when it passes in at least 3 of 5 repetitions of `zero-full-a` and at most 2 of 5 in the ablation. A task is fixed in the reverse case. Breaks and fixes are counted and reported apart.

Verdicts:

- **keep:** dropping it lowers pass rate with an interval wholly below zero. Or dropping it raises cost per success by more than 10% (ratio above 1.10, interval excluding 1.00) while the pass-rate difference is not below -F.
- **cut:** dropping it leaves cost per trial level or lower (the paired cost difference is at or below zero, or its interval includes zero), the pass-rate difference is within ±F, and it breaks at most 2 tasks. A drop that breaks more than 2 tasks is never cut, whatever its cost gain.
- **can't tell:** everything else. It is reported as can't tell, never as cut.

The verdicts are tried in order: keep, then cut, then can't tell. A switch whose drop shows harm is never cut.

**Ceiling gate.** `zero-full-a` runs first, on its own, and its pass rate is recorded before any other Phase C cell starts. If it is below 10% or above 90%, selection is cost-only for the whole loop:

- **keep:** dropping it raises cost per trial by more than 10% (ratio above 1.10, interval excluding 1.00).
- **cut:** cost per trial level or lower, as above, and at most 2 broken tasks.
- **can't tell:** everything else.

The gate only switches the rule. Every preregistered cell still runs.

**Switches without an ablation cell.**

- **`caching` on Opus.** No cell, because caching does not change outputs. `zero-full-a`'s priced proxy lines are repriced with every input token at the plain input rate (the proxy's `input_tokens` include cache reads and writes). That gives a no-caching cost per trial. Keep when repriced over actual is above 1.10 with an interval excluding 1.00. Cut when the ratio is at or below 1.00. Otherwise can't tell. The cache-read share is reported by the gap since the trial's previous request (under and over the 5-minute TTL).
- **`caching` on Sol.** The switch only sets `prompt_cache_key`, and OpenAI caches long prompts with or without it, so repricing measures OpenAI's own caching, not the switch. Instead, the cached share of input tokens in `zero-full` Sol is compared with `zero-min` Sol (key off). Keep when it is at least 10 points higher with an interval excluding zero; otherwise can't tell. The two cells differ in every other switch too, and the report says so.
- **`mcp-instructions`.** The world server sends no instructions, so without gbrain the switch adds nothing (measured on the [anatomy page](../harness-anatomy/harness-zero.md)). Verdict: can't tell in Phase C. Phase D tests it on and off in the gbrain trio.
- **`output-cap`.** No sibling verdict (internal-task's waterfall has not landed, so its fallback, Harness Zero's own count_tokens capture, applies). That capture's history probe used a small world read, so it does not show how large v0.3's biggest tool results are. Verdict: can't tell.
- **The five `layer-*` switches.** internal-task's per-layer list has not landed, so they are tested together in one cell, `zero-full-minus-layers`. Each layer takes the bundle's verdict, cited. internal-task's list is cited beside it when it lands and does not change this loop's verdicts.

**Sol.** Sol inherits every Opus verdict except `caching` (above) and `effort-high`. If Opus keeps `effort-high`, the conditional cell `zero-full-no-effort-high` on Sol runs (3 repetitions). It decides Sol's verdict with the rules above, paired against Sol `zero-full`, using Opus's F (Sol has no second `zero-full` cell, so the floor is borrowed and labelled so). A Sol task is broken at 2 or more passes of 3 against at most 1 of 3. If Opus does not keep `effort-high`, the cell does not run and Sol inherits the Opus verdict.

## Candidates

Frozen at the end of Phase C, in PR 3, in `config/candidates.json`:

- **lean:** `zero-full` minus every cut and can't-tell switch.
- **conservative:** `zero-full` minus cut switches only. Omitted when equal to lean.
- **`zero-full`:** the one-shot baseline (R6).
- **`zero-min`:** the pre-loop baseline (R6).
- **`zero-control`:** equal to lean, with its `candidate_sha256` and a version policy (build requirement 15): any change to its features, knobs, prompt files or the other hash inputs gives it a new name and hash.
- When Sol's `caching` or `effort-high` verdict differs from Opus's, Sol gets `zero-lean-sol` and `zero-conservative-sol`.

## Budget and stopping rule

- **Budget:** one pass. Every preregistered cell runs once: 7 Opus cells of 100 trials, 2 Sol cells of 60, and the conditional Sol cell of 60. Leases and the cap are in the run's preregistration. The cap is $213, which covers the leases ($212.50) (raised by the Captain on 2026-11-01 from the $161 first drafted, because Opus `zero-min` measured $0.38 a trial against the plan's $0.20). The whole plan's model cap stays $500.
- **Stop when:** every cell has run, or a shard's lease is spent. A cell stopped by its lease is partial (HE-BUDGET-001), and every verdict that depends on it is can't tell. No ablation is added, rerun or extended in this loop.

## Re-confirmation and release (R3, R6)

- **Fresh draw (R3):** lean, conservative, `zero-full` and `zero-min` run again in Phase D on a new public dev draw of 20 tasks from `scripts/v03/gen-tasks.ts` with a new seed, 3 repetitions. It shares v0.3's fact pool and templates, so it is labelled "dev, same item pool" and never called independent confirmation.
- **Confirmation:** a champion's confirmation is a counted run on a set it was not developed against, under its own preregistration (Phase D, PR 4b).
- **Baselines (R6):** every report shows `zero-min` and `zero-full` beside lean and conservative.
- **Release schedule:** during the run, only the ceiling gate's value is published (in the run log). PR 3 publishes the verdict table with receipts, the frozen candidates with their hashes, and the design sensitivity for Phase D. Nothing is published per cell before then.

## Amendments

Dated, newest last, each committed before the iterations it affects.
