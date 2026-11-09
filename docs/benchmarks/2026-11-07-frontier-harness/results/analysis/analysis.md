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
| claude-code | 88.5% [79.8%, 96.2%]<br>$0.6284 per solve [$0.4117, $0.8929]<br>252.0 s median (contended)<br>**home** | not run |
| hermes | 81.7% [72.1%, 91.3%]<br>$0.8848 per solve [$0.5443, $1.3832]<br>427.0 s median (contended)<br>**within-15** | 85.6% [76.9%, 93.3%]<br>$0.4324 per solve [$0.3114, $0.5954]<br>438.5 s median (contended)<br>**within-15** |
| openclaw | 76.0% [64.4%, 86.5%]<br>$0.8796 per solve [$0.5715, $1.2911]<br>287.8 s median (contended)<br>**behind** | 76.0% [64.4%, 86.5%]<br>$0.6107 per solve [$0.3996, $0.9530]<br>325.6 s median (contended)<br>**within-15** |
| pi | 81.4% [71.6%, 90.2%]<br>$0.6193 per solve [$0.3465, $0.9499]<br>196.4 s median (contended)<br>**within-15** | 80.4% [70.6%, 90.2%]<br>$0.2310 per solve [$0.1734, $0.3068]<br>220.5 s median (contended)<br>**within-15** |
| codex | not run | 83.7% [74.0%, 92.3%]<br>$0.3386 per solve [$0.2467, $0.4648]<br>279.2 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | opus-cc | 81.7% / 88.5% | -6.7 [-13.5, -1.0] | -12.5 | 52 (0) | 0.0910 | 0.1248 | 0.0119 | 0.0238 | 9.6% [3.8%, 16.3%] | 1.41x [1.07x, 1.82x] | within-15 |
| Opus 5.5 | opus-openclaw | opus-cc | 76.0% / 88.5% | -12.5 [-22.1, -3.8] | -20.2 | 52 (0) | 0.0123 | 0.0369 | 0.2943 | 0.2943 | 15.4% [7.7%, 24.0%] | 1.40x [1.19x, 1.68x] | behind |
| Opus 5.5 | opus-pi | opus-cc | 82.4% / 88.2% | -5.9 [-11.8, -1.0] | -10.8 | 51 (1) | 0.0624 | 0.1248 | 0.0015 | 0.0045 | 7.8% [2.9%, 13.7%] | 0.97x [0.75x, 1.17x] | within-15 |
| GPT-6.1 Sol | sol-hermes | sol-codex | 85.6% / 83.7% | +1.9 [-4.8, +8.7] | -2.9 | 52 (0) | 0.7744 | 1.0000 | 0.0001 | 0.0003 | 9.6% [3.8%, 16.3%] | 1.28x [1.05x, 1.54x] | within-15 |
| GPT-6.1 Sol | sol-openclaw | sol-codex | 76.0% / 83.7% | -7.7 [-14.4, -1.9] | -13.5 | 52 (0) | 0.0332 | 0.0996 | 0.0154 | 0.0154 | 9.6% [3.8%, 16.3%] | 1.80x [1.51x, 2.18x] | within-15 |
| GPT-6.1 Sol | sol-pi | sol-codex | 80.4% / 83.3% | -2.9 [-11.8, +5.9] | -10.8 | 51 (1) | 0.6886 | 1.0000 | 0.0046 | 0.0092 | 15.7% [7.8%, 24.5%] | 0.67x [0.51x, 0.85x] | within-15 |

### Power
- opus-hermes vs opus-cc: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0945; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +10.9 points.
- opus-openclaw vs opus-cc: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1269; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +14.7 points.
- opus-pi vs opus-cc: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0749; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +8.7 points.
- sol-hermes vs sol-codex: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0939; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +10.8 points.
- sol-openclaw vs sol-codex: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0893; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +10.3 points.
- sol-pi vs sol-codex: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1325; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +15.3 points.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 9.3% [4.0%, 15.4%] (52) | 13.9% [8.3%, 19.9%] (52) | +4.6 |
| GPT-6.1 Sol | 9.5% [5.1%, 14.3%] (52) | 14.4% [8.8%, 20.7%] (52) | +5.0 |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-cc | 90.2% / 86.3% | -3.9 [-9.8, +0.0] | 51 | within threshold |
| GPT-6.1 Sol | sol-codex | 84.6% / 82.7% | -1.9 [-7.7, +3.8] | 52 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 2 | 86.3% [76.5%, 94.1%] | 90.2% [82.4%, 98.0%] | 3.9% [0.0%, 9.8%] | 52 / 103 | 1 / 0 / 0 | 6 | 0 | 1 | 0 | $57.1840 |
| Hermes | 2 | 76.9% [65.4%, 88.5%] | 86.5% [76.9%, 94.2%] | 9.6% [1.9%, 17.3%] | 52 / 104 | 0 / 0 / 0 | 7 | 0 | 0 | 0 | $75.2043 |
| OpenClaw | 2 | 71.2% [59.6%, 82.7%] | 80.8% [69.2%, 90.4%] | 9.6% [1.9%, 17.3%] | 52 / 104 | 0 / 0 / 0 | 8 | 0 | 0 | 0 | $69.4888 |
| Pi | 2 | 74.5% [62.7%, 86.3%] | 88.2% [78.4%, 96.1%] | 13.7% [3.9%, 23.5%] | 51 / 102 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $51.4040 |
| Codex | 2 | 80.8% [69.2%, 90.4%] | 86.5% [76.9%, 94.2%] | 5.8% [0.0%, 13.5%] | 52 / 104 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $29.4598 |
| Hermes | 2 | 80.4% [68.6%, 90.2%] | 90.2% [80.4%, 98.0%] | 9.8% [2.0%, 17.6%] | 52 / 103 | 1 / 0 / 0 | 2 | 2 | 1 | 0 | $38.0534 |
| OpenClaw | 2 | 71.2% [57.7%, 82.7%] | 80.8% [69.2%, 90.4%] | 9.6% [1.9%, 17.3%] | 52 / 104 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $48.2479 |
| Pi | 2 | 74.5% [62.7%, 86.3%] | 86.3% [76.5%, 94.1%] | 11.8% [3.9%, 21.6%] | 51 / 102 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $18.9438 |

## Tasks dropped from pairs
- opus-pi vs opus-cc: pytorch-model-recovery (no scored attempt in opus-pi)
- sol-pi vs sol-codex: pytorch-model-recovery (no scored attempt in sol-pi)
