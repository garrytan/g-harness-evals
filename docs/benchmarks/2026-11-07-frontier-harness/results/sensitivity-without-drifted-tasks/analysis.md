# Frontier harness analysis: frontier-harness-2026-11

Method: task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p. Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 15 points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. 3 trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.

## Verdict tags

Each cell gets the first tag whose rule holds, in this order:

- **home**: the model's home harness; every other cell of the model is compared with it.
- **incomplete**: the cell or its home cell has a planned trial with no record, or the pair has fewer than min_paired_tasks (10 by default) tasks with an attempt scored in both cells: reported from what exists, no claim.
- **descriptive**: an extension cell (descriptive in the spec, for example one attempt per task): estimate and intervals only, no test and no non-inferiority claim.
- **behind**: a primary pair whose two-sided task-level sign-flip p, Holm-adjusted across the model's primary pairs, is at or below alpha with the cell below its home.
- **within-15**: a primary pair that is not behind and whose one-sided non-inferiority p at a 15-point margin (the share of task-bootstrap draws of cell minus home at or below -15 points), Holm-adjusted across the model's primary pairs, is at or below alpha.
- **saturated**: a primary pair that is neither behind nor within-15 and whose home cell averages at least saturated_at (95% by default) on the paired tasks, or where no paired task differs: a ceiling, not a tie.
- **inconclusive**: every other primary pair: the data show neither that the cell is within 15 points of its home nor that it is behind.

## Harness x model

Each cell: pass rate [95% CI]; cost per solve [95% CI]; median wall time (contended); verdict.

| Harness | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| claude-code | 89.8% [80.6%, 96.9%]<br>$0.6442 per solve [$0.4183, $0.9255]<br>250.7 s median (contended)<br>**home** | not run |
| hermes | 82.7% [72.4%, 91.8%]<br>$0.9057 per solve [$0.5446, $1.4296]<br>427.0 s median (contended)<br>**within-15** | 85.7% [76.5%, 93.9%]<br>$0.4236 per solve [$0.2962, $0.5998]<br>424.2 s median (contended)<br>**within-15** |
| openclaw | 76.5% [65.3%, 86.7%]<br>$0.9049 per solve [$0.5835, $1.3512]<br>282.6 s median (contended)<br>**behind** | 75.5% [64.3%, 86.7%]<br>$0.6162 per solve [$0.3890, $0.9776]<br>319.5 s median (contended)<br>**within-15** |
| pi | 82.3% [72.9%, 91.7%]<br>$0.6378 per solve [$0.3533, $0.9865]<br>193.0 s median (contended)<br>**within-15** | 79.2% [67.7%, 88.5%]<br>$0.2269 per solve [$0.1662, $0.3097]<br>212.7 s median (contended)<br>**within-15** |
| codex | not run | 82.7% [72.4%, 91.8%]<br>$0.3409 per solve [$0.2437, $0.4757]<br>258.5 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | opus-cc | 82.7% / 89.8% | -7.1 [-14.3, -1.0] | -13.3 | 49 (0) | 0.0918 | 0.1278 | 0.0222 | 0.0444 | 10.2% [4.1%, 17.3%] | 1.41x [1.05x, 1.83x] | within-15 |
| Opus 5.5 | opus-openclaw | opus-cc | 76.5% / 89.8% | -13.3 [-23.5, -5.1] | -21.4 | 49 (0) | 0.0124 | 0.0372 | 0.3581 | 0.3581 | 16.3% [8.2%, 25.5%] | 1.40x [1.19x, 1.71x] | behind |
| Opus 5.5 | opus-pi | opus-cc | 83.3% / 89.6% | -6.3 [-12.5, -1.0] | -11.5 | 48 (1) | 0.0639 | 0.1278 | 0.0033 | 0.0099 | 8.3% [3.1%, 14.6%] | 0.97x [0.74x, 1.18x] | within-15 |
| GPT-6.1 Sol | sol-hermes | sol-codex | 85.7% / 82.7% | +3.1 [-3.1, +10.2] | -2.0 | 49 (0) | 0.5630 | 1.0000 | 0.0001 | 0.0003 | 9.2% [3.1%, 15.3%] | 1.24x [1.01x, 1.52x] | within-15 |
| GPT-6.1 Sol | sol-openclaw | sol-codex | 75.5% / 82.7% | -7.1 [-14.3, -1.0] | -13.3 | 49 (0) | 0.0610 | 0.1830 | 0.0155 | 0.0160 | 9.2% [4.1%, 15.3%] | 1.81x [1.50x, 2.20x] | within-15 |
| GPT-6.1 Sol | sol-pi | sol-codex | 79.2% / 82.3% | -3.1 [-12.5, +6.3] | -11.5 | 48 (1) | 0.6845 | 1.0000 | 0.0080 | 0.0160 | 16.7% [8.3%, 26.0%] | 0.65x [0.48x, 0.84x] | within-15 |

### Power
- opus-hermes vs opus-cc: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1001; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.6 points.
- opus-openclaw vs opus-cc: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1341; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +15.5 points.
- opus-pi vs opus-cc: at alpha 0.05: with 48 pairs in 48 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0794; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +9.2 points.
- sol-hermes vs sol-codex: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0950; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.0 points.
- sol-openclaw vs sol-codex: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0913; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +10.5 points.
- sol-pi vs sol-codex: at alpha 0.05: with 48 pairs in 48 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1409; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +16.3 points.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 9.9% [4.4%, 16.0%] (49) | 14.8% [8.8%, 20.7%] (49) | +4.9 |
| GPT-6.1 Sol | 9.0% [4.8%, 13.6%] (49) | 14.5% [8.7%, 20.9%] (49) | +5.4 |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-cc | 91.7% / 87.5% | -4.2 [-10.4, +0.0] | 48 | within threshold |
| GPT-6.1 Sol | sol-codex | 83.7% / 81.6% | -2.0 [-8.2, +4.1] | 49 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 2 | 87.5% [77.1%, 95.8%] | 91.7% [83.3%, 97.9%] | 4.2% [0.0%, 10.4%] | 49 / 97 | 1 / 0 / 0 | 4 | 0 | 1 | 0 | $56.0487 |
| Hermes | 2 | 77.6% [65.3%, 87.8%] | 87.8% [77.6%, 95.9%] | 10.2% [2.0%, 18.4%] | 49 / 98 | 0 / 0 / 0 | 5 | 0 | 0 | 0 | $73.3584 |
| OpenClaw | 2 | 71.4% [59.2%, 83.7%] | 81.6% [69.4%, 91.8%] | 10.2% [2.0%, 18.4%] | 49 / 98 | 0 / 0 / 0 | 6 | 0 | 0 | 0 | $67.8702 |
| Pi | 2 | 75.0% [62.5%, 87.5%] | 89.6% [81.3%, 97.9%] | 14.6% [6.3%, 25.0%] | 48 / 96 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $50.3885 |
| Codex | 2 | 79.6% [67.3%, 89.8%] | 85.7% [75.5%, 93.9%] | 6.1% [0.0%, 14.3%] | 49 / 98 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $27.6164 |
| Hermes | 2 | 81.3% [68.8%, 91.7%] | 89.6% [81.3%, 97.9%] | 8.3% [2.1%, 16.7%] | 49 / 97 | 1 / 0 / 0 | 2 | 1 | 1 | 0 | $35.1615 |
| OpenClaw | 2 | 71.4% [59.2%, 83.7%] | 79.6% [67.3%, 89.8%] | 8.2% [2.0%, 16.3%] | 49 / 98 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $45.5968 |
| Pi | 2 | 72.9% [60.4%, 85.4%] | 85.4% [75.0%, 93.8%] | 12.5% [4.2%, 22.9%] | 48 / 96 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $17.2425 |

## Tasks dropped from pairs
- opus-pi vs opus-cc: pytorch-model-recovery (no scored attempt in opus-pi)
- sol-pi vs sol-codex: pytorch-model-recovery (no scored attempt in sol-pi)
