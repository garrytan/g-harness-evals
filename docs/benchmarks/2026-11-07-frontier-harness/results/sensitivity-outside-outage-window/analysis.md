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
| claude-code | 88.5% [79.8%, 96.2%]<br>$0.5952 per solve [$0.4017, $0.8352]<br>250.1 s median (contended)<br>**home** | not run |
| hermes | 82.0% [72.0%, 92.0%]<br>$0.8081 per solve [$0.5187, $1.1814]<br>397.5 s median (contended)<br>**within-15** | 85.9% [76.1%, 94.6%]<br>$0.5168 per solve [$0.3445, $0.7485]<br>469.0 s median (contended)<br>**within-15** |
| openclaw | 73.0% [60.0%, 85.0%]<br>$0.8953 per solve [$0.5275, $1.4248]<br>277.2 s median (contended)<br>**behind** | 76.5% [64.3%, 87.8%]<br>$0.6484 per solve [$0.4037, $1.0463]<br>329.0 s median (contended)<br>**within-15** |
| pi | 81.1% [70.0%, 91.1%]<br>$0.6989 per solve [$0.3867, $1.0833]<br>212.6 s median (contended)<br>**within-15** | 83.3% [72.9%, 92.7%]<br>$0.2214 per solve [$0.1636, $0.2962]<br>225.7 s median (contended)<br>**within-15** |
| codex | not run | 83.7% [74.0%, 92.3%]<br>$0.3386 per solve [$0.2467, $0.4648]<br>279.2 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | opus-cc | 83.7% / 88.0% | -4.3 [-12.0, +1.1] | -9.8 | 46 (6) | 0.3794 | 0.5057 | 0.0048 | 0.0096 | 7.6% [2.2%, 15.2%] | 1.30x [0.99x, 1.71x] | within-15 |
| Opus 5.5 | opus-openclaw | opus-cc | 69.6% / 91.3% | -21.7 [-34.8, -10.9] | -32.6 | 46 (6) | 0.0024 | 0.0072 | 0.8927 | 0.8927 | 21.7% [10.9%, 34.8%] | 1.62x [1.19x, 2.20x] | behind |
| Opus 5.5 | opus-pi | opus-cc | 81.8% / 86.4% | -4.5 [-10.2, +0.0] | -9.1 | 44 (8) | 0.2529 | 0.5057 | 0.0008 | 0.0024 | 6.8% [1.1%, 13.6%] | 1.06x [0.72x, 1.42x] | within-15 |
| GPT-6.1 Sol | sol-hermes | sol-codex | 85.9% / 80.4% | +5.4 [-2.2, +14.1] | -1.1 | 46 (6) | 0.3090 | 0.6179 | 0.0001 | 0.0003 | 9.8% [3.3%, 18.5%] | 1.45x [1.15x, 1.81x] | within-15 |
| GPT-6.1 Sol | sol-openclaw | sol-codex | 76.5% / 81.6% | -5.1 [-11.2, +0.0] | -10.2 | 49 (3) | 0.1899 | 0.5696 | 0.0020 | 0.0020 | 7.1% [2.0%, 13.3%] | 1.87x [1.50x, 2.34x] | within-15 |
| GPT-6.1 Sol | sol-pi | sol-codex | 83.3% / 81.3% | +2.1 [-7.3, +12.5] | -6.3 | 48 (4) | 0.8472 | 0.8472 | 0.0009 | 0.0018 | 14.6% [6.3%, 24.0%] | 0.62x [0.47x, 0.80x] | within-15 |

### Power
- opus-hermes vs opus-cc: at alpha 0.05: with 46 pairs in 46 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0957; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +11.0 points.
- opus-openclaw vs opus-cc: at alpha 0.05: with 46 pairs in 46 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1723; the observed delta is at least that size; at the first Holm step (alpha 0.016667): minimum detectable difference about +19.9 points.
- opus-pi vs opus-cc: at alpha 0.05: with 44 pairs in 44 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0765; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +8.8 points.
- sol-hermes vs sol-codex: at alpha 0.05: with 46 pairs in 46 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1171; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +13.5 points.
- sol-openclaw vs sol-codex: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0842; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +9.7 points.
- sol-pi vs sol-codex: at alpha 0.05: with 48 pairs in 48 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1442; the observed delta is below that size, so a null result here is not evidence of no effect; at the first Holm step (alpha 0.016667): minimum detectable difference about +16.7 points.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 9.2% [3.2%, 16.3%] (49) | 15.9% [9.5%, 22.8%] (52) | +6.7 |
| GPT-6.1 Sol | 7.5% [3.4%, 12.3%] (52) | 12.3% [6.5%, 18.6%] (51) | +4.7 |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-cc | 88.6% / 84.1% | -4.5 [-11.4, +0.0] | 44 | within threshold |
| GPT-6.1 Sol | sol-codex | 84.6% / 82.7% | -1.9 [-7.7, +3.8] | 52 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 2 | 84.1% [72.7%, 93.2%] | 88.6% [79.5%, 97.7%] | 4.5% [0.0%, 11.4%] | 52 / 96 | 1 / 0 / 0 | 6 | 0 | 1 | 0 | $49.9999 |
| Hermes | 2 | 78.8% [63.6%, 90.9%] | 90.9% [81.8%, 100.0%] | 12.1% [3.0%, 24.2%] | 50 / 83 | 0 / 0 / 0 | 6 | 0 | 0 | 0 | $55.7570 |
| OpenClaw | 2 | 71.4% [53.6%, 89.3%] | 75.0% [57.1%, 89.3%] | 3.6% [0.0%, 10.7%] | 50 / 78 | 0 / 0 / 0 | 6 | 0 | 0 | 0 | $51.0305 |
| Pi | 2 | 76.5% [61.8%, 91.2%] | 91.2% [79.4%, 100.0%] | 14.7% [2.9%, 26.5%] | 45 / 79 | 0 / 1 / 0 | 0 | 0 | 0 | 0 | $45.4314 |
| Codex | 2 | 80.8% [69.2%, 90.4%] | 86.5% [76.9%, 94.2%] | 5.8% [0.0%, 13.5%] | 52 / 104 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $29.4598 |
| Hermes | 2 | 72.0% [52.0%, 88.0%] | 84.0% [68.0%, 96.0%] | 12.0% [0.0%, 24.0%] | 46 / 71 | 1 / 0 / 0 | 2 | 2 | 1 | 0 | $30.4890 |
| OpenClaw | 2 | 71.1% [55.3%, 84.2%] | 78.9% [65.8%, 92.1%] | 7.9% [0.0%, 18.4%] | 49 / 87 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $42.7977 |
| Pi | 2 | 77.8% [63.9%, 91.7%] | 83.3% [69.4%, 94.4%] | 5.6% [0.0%, 13.9%] | 48 / 84 | 0 / 2 / 0 | 0 | 0 | 0 | 0 | $15.2799 |

## Tasks dropped from pairs
- opus-hermes vs opus-cc: build-cython-ext (no attempt number scored in both cells); caffe-cifar-10 (no scored attempt in opus-hermes); headless-terminal (no attempt number scored in both cells); largest-eigenval (no attempt number scored in both cells); make-mips-interpreter (no scored attempt in opus-hermes); schemelike-metacircular-eval (no attempt number scored in both cells)
- opus-openclaw vs opus-cc: build-cython-ext (no attempt number scored in both cells); dna-assembly (no scored attempt in opus-openclaw); headless-terminal (no attempt number scored in both cells); largest-eigenval (no attempt number scored in both cells); query-optimize (no attempt number scored in both cells); regex-chess (no scored attempt in opus-openclaw)
- opus-pi vs opus-cc: build-cython-ext (no scored attempt in opus-pi); code-from-image (no scored attempt in opus-pi); feal-differential-cryptanalysis (no scored attempt in opus-pi); feal-linear-cryptanalysis (no scored attempt in opus-pi); headless-terminal (no scored attempt in opus-pi); largest-eigenval (no attempt number scored in both cells); pytorch-model-recovery (no scored attempt in opus-pi); raman-fitting (no scored attempt in opus-pi)
- sol-hermes vs sol-codex: build-cython-ext (no scored attempt in sol-hermes); code-from-image (no scored attempt in sol-hermes); compile-compcert (no scored attempt in sol-hermes); feal-linear-cryptanalysis (no scored attempt in sol-hermes); headless-terminal (no scored attempt in sol-hermes); raman-fitting (no scored attempt in sol-hermes)
- sol-openclaw vs sol-codex: build-cython-ext (no scored attempt in sol-openclaw); headless-terminal (no scored attempt in sol-openclaw); largest-eigenval (no scored attempt in sol-openclaw)
- sol-pi vs sol-codex: build-cython-ext (no scored attempt in sol-pi); large-scale-text-editing (no scored attempt in sol-pi); largest-eigenval (no scored attempt in sol-pi); pytorch-model-recovery (no scored attempt in sol-pi)
