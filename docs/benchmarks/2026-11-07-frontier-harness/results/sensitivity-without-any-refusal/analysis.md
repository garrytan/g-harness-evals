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
| claude-code | 93.9% [86.7%, 99.0%]<br>$0.6248 per solve [$0.4108, $0.8948]<br>262.3 s median (contended)<br>**home** | not run |
| hermes | 87.8% [79.6%, 94.9%]<br>$0.8703 per solve [$0.5217, $1.3542]<br>435.8 s median (contended)<br>**within-15** | 87.3% [78.4%, 95.1%]<br>$0.3750 per solve [$0.2807, $0.4950]<br>440.3 s median (contended)<br>**within-15** |
| openclaw | 82.3% [71.9%, 91.7%]<br>$0.8716 per solve [$0.5643, $1.2817]<br>306.9 s median (contended)<br>**inconclusive** | 77.5% [66.7%, 87.3%]<br>$0.4998 per solve [$0.3688, $0.6788]<br>331.0 s median (contended)<br>**within-15** |
| pi | 88.5% [80.2%, 95.8%]<br>$0.6138 per solve [$0.3430, $0.9476]<br>213.2 s median (contended)<br>**within-15** | 80.4% [70.6%, 90.2%]<br>$0.2310 per solve [$0.1734, $0.3068]<br>220.5 s median (contended)<br>**within-15** |
| codex | not run | 85.3% [75.5%, 94.1%]<br>$0.3055 per solve [$0.2318, $0.3994]<br>280.3 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | opus-cc | 87.8% / 93.9% | -6.1 [-13.3, +0.0] | -12.2 | 49 (0) | 0.1487 | 0.2974 | 0.0109 | 0.0218 | 9.2% [3.1%, 16.3%] | 1.39x [1.04x, 1.82x] | within-15 |
| Opus 5.5 | opus-openclaw | opus-cc | 82.3% / 93.8% | -11.5 [-20.8, -3.1] | -18.8 | 48 (1) | 0.0225 | 0.0675 | 0.1995 | 0.1995 | 14.6% [6.3%, 24.0%] | 1.37x [1.18x, 1.65x] | inconclusive |
| Opus 5.5 | opus-pi | opus-cc | 89.6% / 93.8% | -4.2 [-9.4, +0.0] | -8.3 | 48 (1) | 0.2490 | 0.2974 | 0.0001 | 0.0003 | 6.3% [1.0%, 12.5%] | 0.97x [0.74x, 1.17x] | within-15 |
| GPT-6.1 Sol | sol-hermes | sol-codex | 87.3% / 85.3% | +2.0 [-3.9, +8.8] | -2.9 | 51 (0) | 0.7718 | 0.7718 | 0.0001 | 0.0003 | 9.8% [3.9%, 16.7%] | 1.23x [1.02x, 1.48x] | within-15 |
| GPT-6.1 Sol | sol-openclaw | sol-codex | 77.5% / 85.3% | -7.8 [-14.7, -2.0] | -12.7 | 51 (0) | 0.0387 | 0.1161 | 0.0154 | 0.0278 | 9.8% [3.9%, 16.7%] | 1.64x [1.47x, 1.84x] | within-15 |
| GPT-6.1 Sol | sol-pi | sol-codex | 80.0% / 85.0% | -5.0 [-13.0, +3.0] | -12.0 | 50 (2) | 0.3661 | 0.7321 | 0.0139 | 0.0278 | 14.0% [7.0%, 22.0%] | 0.75x [0.63x, 0.89x] | within-15 |

### Power
- opus-hermes vs opus-cc: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0969; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.2 points.
- opus-openclaw vs opus-cc: at alpha 0.05: with 48 pairs in 48 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1268; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +14.6 points.
- opus-pi vs opus-cc: at alpha 0.05: with 48 pairs in 48 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0702; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +8.1 points.
- sol-hermes vs sol-codex: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0958; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.1 points.
- sol-openclaw vs sol-codex: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0909; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +10.5 points.
- sol-pi vs sol-codex: at alpha 0.05: with 50 pairs in 50 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1217; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +14.1 points.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 8.3% [3.1%, 14.5%] (49) | 12.6% [7.0%, 18.5%] (49) | +4.3 |
| GPT-6.1 Sol | 9.5% [5.1%, 14.3%] (52) | 13.7% [8.2%, 19.9%] (51) | +4.3 |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-cc | 95.8% / 91.7% | -4.2 [-10.4, +0.0] | 48 | within threshold |
| GPT-6.1 Sol | sol-codex | 86.3% / 84.3% | -2.0 [-9.8, +3.9] | 51 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 2 | 91.7% [83.3%, 97.9%] | 95.8% [89.6%, 100.0%] | 4.2% [0.0%, 10.4%] | 49 / 97 | 1 / 0 / 0 | 0 | 0 | 1 | 0 | $56.8590 |
| Hermes | 2 | 83.3% [72.9%, 93.8%] | 91.7% [83.3%, 97.9%] | 8.3% [2.1%, 16.7%] | 49 / 97 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $73.9748 |
| OpenClaw | 2 | 77.1% [64.6%, 89.6%] | 87.5% [77.1%, 95.8%] | 10.4% [2.1%, 18.8%] | 48 / 96 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $68.8596 |
| Pi | 2 | 82.6% [71.7%, 93.5%] | 93.5% [84.8%, 100.0%] | 10.9% [2.2%, 21.7%] | 48 / 94 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $50.9419 |
| Codex | 2 | 82.4% [70.6%, 92.2%] | 88.2% [78.4%, 96.1%] | 5.9% [0.0%, 13.7%] | 51 / 102 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $26.5810 |
| Hermes | 2 | 83.7% [73.5%, 93.9%] | 93.9% [85.7%, 100.0%] | 10.2% [2.0%, 18.4%] | 51 / 100 | 1 / 0 / 0 | 0 | 2 | 1 | 0 | $33.0030 |
| OpenClaw | 2 | 72.5% [60.8%, 84.3%] | 82.4% [70.6%, 92.2%] | 9.8% [2.0%, 19.6%] | 51 / 102 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $39.4814 |
| Pi | 2 | 74.5% [62.7%, 86.3%] | 86.3% [76.5%, 94.1%] | 11.8% [3.9%, 21.6%] | 51 / 102 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $18.9438 |

## Tasks dropped from pairs
- opus-openclaw vs opus-cc: feal-linear-cryptanalysis (no scored attempt in opus-openclaw)
- opus-pi vs opus-cc: pytorch-model-recovery (no scored attempt in opus-pi)
- sol-pi vs sol-codex: model-extraction-relu-logits (no scored attempt in sol-codex); pytorch-model-recovery (no scored attempt in sol-pi)
