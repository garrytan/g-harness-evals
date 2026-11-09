# Frontier harness analysis: frontier-harness-2026-11

Method: task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p. Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 15 points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. 4 trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.

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
| claude-code | 85.6% [76.9%, 93.3%]<br>$0.6509 per solve [$0.4258, $0.9256]<br>257.4 s median (contended)<br>**home** | not run |
| hermes | 81.7% [72.1%, 91.3%]<br>$0.8848 per solve [$0.5443, $1.3832]<br>427.0 s median (contended)<br>**within-15** | 84.6% [76.0%, 92.3%]<br>$0.4430 per solve [$0.3155, $0.6163]<br>438.5 s median (contended)<br>**within-15** |
| openclaw | 75.0% [64.4%, 85.6%]<br>$0.8884 per solve [$0.5747, $1.3046]<br>290.0 s median (contended)<br>**inconclusive** | 69.2% [57.7%, 79.8%]<br>$0.6645 per solve [$0.4302, $1.0494]<br>319.5 s median (contended)<br>**behind** |
| pi | 77.5% [67.6%, 86.3%]<br>$0.6580 per solve [$0.3714, $1.0067]<br>196.4 s median (contended)<br>**within-15** | 74.5% [63.7%, 84.3%]<br>$0.2519 per solve [$0.1886, $0.3367]<br>213.0 s median (contended)<br>**inconclusive** |
| codex | not run | 83.7% [74.0%, 92.3%]<br>$0.3386 per solve [$0.2467, $0.4648]<br>279.2 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | opus-cc | 81.7% / 85.6% | -3.8 [-11.5, +3.8] | -10.6 | 52 (0) | 0.4614 | 0.4614 | 0.0041 | 0.0123 | 12.5% [5.8%, 20.2%] | 1.36x [1.02x, 1.77x] | within-15 |
| Opus 5.5 | opus-openclaw | opus-cc | 75.0% / 85.6% | -10.6 [-20.2, -1.9] | -19.2 | 52 (0) | 0.0512 | 0.1536 | 0.1847 | 0.1847 | 18.3% [9.6%, 27.9%] | 1.36x [1.16x, 1.65x] | inconclusive |
| Opus 5.5 | opus-pi | opus-cc | 78.4% / 85.3% | -6.9 [-13.7, +0.0] | -12.7 | 51 (1) | 0.1233 | 0.2466 | 0.0141 | 0.0282 | 14.7% [7.8%, 21.6%] | 0.99x [0.78x, 1.20x] | within-15 |
| GPT-6.1 Sol | sol-hermes | sol-codex | 84.6% / 83.7% | +1.0 [-5.8, +7.7] | -4.8 | 52 (0) | 1.0000 | 1.0000 | 0.0001 | 0.0003 | 10.6% [4.8%, 17.3%] | 1.31x [1.07x, 1.57x] | within-15 |
| GPT-6.1 Sol | sol-openclaw | sol-codex | 69.2% / 83.7% | -14.4 [-21.2, -7.7] | -20.2 | 52 (0) | 0.0002 | 0.0006 | 0.4347 | 0.4347 | 15.4% [8.7%, 22.1%] | 1.96x [1.63x, 2.39x] | behind |
| GPT-6.1 Sol | sol-pi | sol-codex | 74.5% / 83.3% | -8.8 [-19.6, +1.0] | -17.6 | 51 (1) | 0.1565 | 0.3130 | 0.1170 | 0.2340 | 21.6% [12.7%, 31.4%] | 0.73x [0.55x, 0.95x] | inconclusive |

### Power
- opus-hermes vs opus-cc: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1078; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +12.4 points.
- opus-openclaw vs opus-cc: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1351; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +15.6 points.
- opus-pi vs opus-cc: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1039; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +12.0 points.
- sol-hermes vs sol-codex: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0980; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.3 points.
- sol-openclaw vs sol-codex: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0968; the observed delta is at least that size; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.2 points.
- sol-pi vs sol-codex: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1504; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +17.4 points.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 13.1% [7.7%, 19.4%] (52) | 17.6% [12.0%, 23.4%] (52) | +4.5 |
| GPT-6.1 Sol | 15.2% [9.9%, 21.0%] (52) | 20.0% [13.9%, 26.1%] (52) | +4.8 |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-cc | 90.2% / 80.4% | -9.8 [-19.6, -2.0] | 51 | within threshold |
| GPT-6.1 Sol | sol-codex | 84.6% / 82.7% | -1.9 [-7.7, +3.8] | 52 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 2 | 80.4% [68.6%, 90.2%] | 90.2% [82.4%, 98.0%] | 9.8% [2.0%, 19.6%] | 52 / 103 | 1 / 0 / 0 | 6 | 0 | 1 | 0 | $57.2798 |
| Hermes | 2 | 76.9% [65.4%, 88.5%] | 86.5% [76.9%, 94.2%] | 9.6% [1.9%, 17.3%] | 52 / 104 | 0 / 0 / 0 | 7 | 0 | 0 | 0 | $75.2043 |
| OpenClaw | 2 | 69.2% [57.7%, 80.8%] | 80.8% [69.2%, 90.4%] | 11.5% [3.8%, 21.2%] | 52 / 104 | 0 / 0 / 0 | 8 | 0 | 0 | 0 | $69.2941 |
| Pi | 2 | 66.7% [52.9%, 78.4%] | 88.2% [78.4%, 96.1%] | 21.6% [11.8%, 33.3%] | 51 / 102 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $51.9785 |
| Codex | 2 | 80.8% [69.2%, 90.4%] | 86.5% [76.9%, 94.2%] | 5.8% [0.0%, 13.5%] | 52 / 104 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $29.4598 |
| Hermes | 2 | 78.4% [66.7%, 88.2%] | 90.2% [80.4%, 98.0%] | 11.8% [3.9%, 21.6%] | 52 / 103 | 1 / 0 / 0 | 2 | 2 | 1 | 0 | $38.5423 |
| OpenClaw | 2 | 57.7% [44.2%, 71.2%] | 80.8% [69.2%, 90.4%] | 23.1% [11.5%, 34.6%] | 52 / 104 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $47.8472 |
| Pi | 2 | 64.7% [51.0%, 76.5%] | 84.3% [74.5%, 94.1%] | 19.6% [9.8%, 31.4%] | 51 / 102 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $19.1471 |

## Tasks dropped from pairs
- opus-pi vs opus-cc: pytorch-model-recovery (no scored attempt in opus-pi)
- sol-pi vs sol-codex: pytorch-model-recovery (no scored attempt in sol-pi)
