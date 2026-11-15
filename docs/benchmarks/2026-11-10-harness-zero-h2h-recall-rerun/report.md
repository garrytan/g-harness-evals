# Cross-member recall rerun on harness-zero-h2h cr-01 to cr-04 (dev check)

**Takeaways**

- **Letting every member recall what the model saved in a channel did not help gbrain on these tasks.** The saved facts did reach other members (45 reads by another member returned one), but each spliced gbrain reading rose only 1.7 points and every 95% interval still includes zero.
- **The defect was not what held gbrain back on these tasks.** On cr-02 to cr-04, where the earlier ceiling came from, every arm passed 0 of 9, with or without gbrain and with the fix on.
- **If you build on gbrain's member scoping:** a fact saved by one member is private to that member unless you write it to the channel's source. That is a real limit for multi-user agents, but on these four tasks something else is the binding failure.

This is a dev check, not a counted run. It follows the dated pre-data note [recall-rerun-pre-data.md](../../corrections/2026-11-09/recall-rerun-pre-data.md), committed before any trial, and its outcome is reported in [correction 7](../../corrections/2026-11-09/README.md#7-cross-member-gbrain-recall-in-member-sources-cells). The h2h report stays as published, and its verdict "gbrain, scoped and told: FIX-METHOD (dev)" stands for all three arms.

## What ran

- **Tasks:** cr-01 to cr-04 from v0.3 dev, as published in [harness-zero-h2h](../2026-11-06-harness-zero-h2h/report.md), 3 repetitions each, Claude Opus 5.5.
- **gbrain arms, one setting changed:** `gbrain.channel_remember: "conversation"`, so a `remember` in a shared channel is written to that channel's source. Ingestion stays off, as published.
- **Baselines rerun alongside:** lean and Claude Code with no brain, so each reading is paired within this rerun.
- **60 trials, all completed.** No trial ended in a model, infra or exam error. Five shards on Ubicloud, one cell each, each shard's VM destroyed when it finished.

## Results

**Exposure.** Every `remember` went to a channel source (62 of 62, none private), and the saved facts were read back by other members:

| Cell | Remembers | Channel saves read by another member | Reads by another member that returned one | Trials with such a read |
|---|---:|---:|---:|---:|
| lean + MCP instructions + gbrain | 25 | 12 | 13 | 6 of 12 |
| lean + gbrain | 24 | 20 | 20 | 11 of 12 |
| Claude Code + gbrain | 13 | 12 | 12 | 9 of 12 |

**Passes (of 3 per task).**

| Cell | cr-01 | cr-02 | cr-03 | cr-04 | Total |
|---|---:|---:|---:|---:|---:|
| lean, no brain | 3 | 0 | 0 | 0 | 3 of 12 |
| lean + gbrain | 2 | 0 | 0 | 0 | 2 of 12 |
| lean + MCP instructions + gbrain | 2 | 0 | 0 | 0 | 2 of 12 |
| Claude Code, no brain | 3 | 0 | 0 | 0 | 3 of 12 |
| Claude Code + gbrain | 3 | 0 | 0 | 0 | 3 of 12 |

**Readings (points, gbrain arm minus its baseline, paired by task and repetition, 95% intervals).** "Spliced" is the published 60 pairs with cr-01 to cr-04 replaced by this rerun's pairs for both arms.

| Reading | Published (60 pairs) | Rerun alone (12 pairs) | Spliced (60 pairs) | Ceiling from correction 7 | Share of the gap to the ceiling recovered |
|---|---|---|---|---:|---:|
| lean + MCP instructions + gbrain minus lean | +5.0 [-8.3, +21.7] | -8.3 [-25, 0] | +6.7 [-5.0, +23.3] | +20.0 | 11% |
| lean + gbrain minus lean | +1.7 [-10, +15] | -8.3 [-25, 0] | +3.3 [-8.3, +16.7] | +16.7 | 11% |
| Claude Code + gbrain minus Claude Code | +3.3 [-6.7, +15] | 0 [0, 0] | +5.0 [-3.3, +15] | +10.0 | 25% |

On the same four tasks the published runs read -16.7, -16.7 and -8.3 points, so with the fix on each gbrain arm gained one pass out of 12 against its baseline. The two lean gbrain arms still trail lean by one pass, on cr-01.

**Verdict, by the pre-data note's rule.** Exposure is confirmed, but no spliced interval lies entirely above zero, so FIX-METHOD (dev) stands for all three arms. The ceiling was an upper bound that assumed every affected failure would pass; the rerun shows those failures have another cause.

## Method and receipts

- **Statistics:** the h2h report's method, `clusteredPairedDelta` in [runner/stats/paired.ts](../../../runner/stats/paired.ts), clustered by task, seed 7, 10,000 draws. Rebuild keylessly with `bun scripts/corrections/recall-rerun-analysis.ts --rerun docs/benchmarks/2026-11-10-harness-zero-h2h-recall-rerun/results --published docs/benchmarks/2026-11-06-harness-zero-h2h/results --out <dir>`; [analysis/analysis.md](analysis/analysis.md) is its output.
- **Configuration:** [prereg.json](prereg.json) lists the five cells. The run's commit was main at 6aab4a298d plus the channel_remember switch (which lands on main in the same change as this page), this config and the pre-data note; the gbrain image was built from `gbrain/` at that commit. Because that commit sits on a dev branch and not on main, this run is not listed in docs/benchmarks/preregistrations.json and is not a counted run.
- **Receipts:** [results/](results/) holds the merged trials, each shard's ledger, proxy usage and run log, and each shard's one-trial smoke under `<shard>.smoke.*`. [fanout-manifest.json](fanout-manifest.json) is the shard plan.
