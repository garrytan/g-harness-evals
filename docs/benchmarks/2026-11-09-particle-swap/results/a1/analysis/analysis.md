# Frontier harness analysis: particle-swap-a1-2026-11

Method: task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p. Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 15 points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. 38 trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.

## Verdict tags

Each cell gets the first tag whose rule holds, in this order:

- **home**: the model's home harness; every other cell of the model is compared with it.
- **incomplete**: the cell or its home cell has a planned trial with no record, or the pair has fewer than min_paired_tasks (10 by default) tasks with an attempt scored in both cells: reported from what exists, no claim.
- **descriptive**: an extension cell (descriptive in the spec, for example one attempt per task): estimate and intervals only, no test and no non-inferiority claim.
- **behind**: a primary pair whose two-sided task-level sign-flip p, Holm-adjusted across the model's primary pairs, is at or below alpha with the cell below its home.
- **no-room**: can't tell: no room to improve: a primary pair that is not behind and would be within-15, but fewer than min_paired_tasks of its paired tasks are ones the run can tell apart (a task every main cell passed on every attempt, or every main cell failed on every attempt, can't), or on those tasks the home cell's passes leave the cell less than 15 points to fall.
- **within-15**: a primary pair that is not behind and whose one-sided non-inferiority p at a 15-point margin (the share of task-bootstrap draws of cell minus home at or below -15 points), Holm-adjusted across the model's primary pairs, is at or below alpha.
- **saturated**: a primary pair that is neither behind nor within-15 and whose home cell averages at least saturated_at (95% by default) on the paired tasks, or where no paired task differs: a ceiling, not a tie.
- **inconclusive**: every other primary pair: the data show neither that the cell is within 15 points of its home nor that it is behind.

## Harness x model

Each cell: pass rate [95% CI]; cost per solve [95% CI]; median wall time (contended); verdict.

| Harness | Opus 5.5 | GPT-6.1 Sol | particle-1 | DeepSeek-V4.1-Flash-1017 |
|---|---|---|---|---|
| hermes | 79.5% [69.9%, 88.5%]<br>$0.7916 per solve [$0.4945, $1.2156] (metered; $3.1739 charged at reservation left out)<br>395.7 s median (contended)<br>**home** | 84.0% [74.4%, 92.3%]<br>$0.3871 per solve [$0.2915, $0.5036] (metered; $4.2474 charged at reservation left out)<br>470.4 s median (contended)<br>**home** | 59.0% [48.1%, 69.9%]<br>$0.3545 per solve [$0.2215, $0.5457] (metered; $0.0000 charged at reservation left out)<br>936.6 s median (contended)<br>**home** | 68.9% [58.3%, 79.2%]<br>$0.1586 per solve [$0.1145, $0.2141] (metered; $1.3018 charged at reservation left out)<br>729.6 s median (contended)<br>**home** |
| openclaw | 76.3% [65.4%, 86.5%]<br>$0.8372 per solve [$0.5616, $1.2016] (metered; $0.0000 charged at reservation left out)<br>267.6 s median (contended)<br>**descriptive** | 77.6% [66.7%, 87.2%]<br>$0.4824 per solve [$0.3603, $0.6473] (metered; $13.0683 charged at reservation left out)<br>348.6 s median (contended)<br>**descriptive** | 61.5% [50.6%, 71.8%]<br>$0.3057 per solve [$0.2005, $0.4428] (metered; $0.0000 charged at reservation left out)<br>528.3 s median (contended)<br>**descriptive** | 66.3% [55.8%, 76.6%]<br>$0.1394 per solve [$0.1028, $0.1857] (metered; $4.2996 charged at reservation left out)<br>577.4 s median (contended)<br>**descriptive** |
| pi | 80.8% [71.2%, 89.7%]<br>$0.5446 per solve [$0.3351, $0.8147] (metered; $0.0000 charged at reservation left out)<br>188.6 s median (contended)<br>**descriptive** | 80.8% [71.2%, 89.7%]<br>$0.2194 per solve [$0.1654, $0.2912] (metered; $2.5991 charged at reservation left out)<br>237.2 s median (contended)<br>**descriptive** | 62.8% [52.6%, 72.4%]<br>$0.1195 per solve [$0.0811, $0.1690] (metered; $0.4609 charged at reservation left out)<br>341.7 s median (contended)<br>**descriptive** | 74.4% [64.1%, 84.0%]<br>$0.0777 per solve [$0.0594, $0.1013] (metered; $0.0000 charged at reservation left out)<br>393.4 s median (contended)<br>**descriptive** |
| dsh | 81.4% [71.2%, 91.0%]<br>$0.6904 per solve [$0.4342, $1.0214] (metered; $0.0000 charged at reservation left out)<br>251.5 s median (contended)<br>**descriptive** | 64.1% [53.8%, 73.7%]<br>$1.2466 per solve [$0.9237, $1.6797] (metered; $25.5565 charged at reservation left out)<br>384.2 s median (contended)<br>**descriptive** | 65.4% [54.5%, 75.6%]<br>$0.2252 per solve [$0.1574, $0.3106] (metered; $0.1580 charged at reservation left out)<br>503.5 s median (contended)<br>**descriptive** | 67.3% [56.4%, 77.6%]<br>$0.1040 per solve [$0.0806, $0.1353] (metered; $0.2252 charged at reservation left out)<br>523.8 s median (contended)<br>**descriptive** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-openclaw | opus-hermes | 76.3% / 79.5% | -3.2 [-12.2, +5.1] | -10.9 | 52 (0) | 0.5669 | no test | 0.0057 | no test | 16.5% [9.4%, 24.6%] | 1.06x [0.82x, 1.44x] | descriptive |
| Opus 5.5 | opus-pi | opus-hermes | 80.8% / 79.5% | +1.3 [-5.1, +7.7] | -4.5 | 52 (0) | 0.8543 | no test | 0.0001 | no test | 13.7% [7.7%, 20.3%] | 0.69x [0.50x, 0.97x] | descriptive |
| Opus 5.5 | opus-dsh | opus-hermes | 81.4% / 79.5% | +1.9 [-3.8, +8.3] | -3.2 | 52 (0) | 0.6813 | no test | 0.0001 | no test | 10.5% [5.3%, 16.5%] | 0.87x [0.63x, 1.29x] | descriptive |
| GPT-6.1 Sol | sol-openclaw | sol-hermes | 77.6% / 84.0% | -6.4 [-12.8, -1.3] | -11.5 | 52 (0) | 0.0603 | no test | 0.0040 | no test | 9.8% [4.5%, 16.0%] | 1.25x [1.01x, 1.53x] | descriptive |
| GPT-6.1 Sol | sol-pi | sol-hermes | 80.4% / 84.0% | -3.5 [-9.0, +1.6] | -8.0 | 52 (0) | 0.2753 | no test | 0.0001 | no test | 9.5% [5.0%, 14.7%] | 0.57x [0.49x, 0.65x] | descriptive |
| GPT-6.1 Sol | sol-dsh | sol-hermes | 64.1% / 84.0% | -19.9 [-27.9, -12.2] | -26.6 | 52 (0) | 0.0001 | no test | 0.8943 | no test | 25.0% [17.8%, 32.7%] | 3.22x [2.56x, 4.15x] | descriptive |
| particle-1 | particle-openclaw | particle-hermes | 61.5% / 59.0% | +2.6 [-8.3, +13.5] | -6.4 | 52 (0) | 0.7353 | no test | 0.0015 | no test | 32.5% [25.0%, 40.2%] | 0.86x [0.57x, 1.33x] | descriptive |
| particle-1 | particle-pi | particle-hermes | 62.8% / 59.0% | +3.8 [-5.1, +12.8] | -3.2 | 52 (0) | 0.4811 | no test | 0.0001 | no test | 27.8% [21.6%, 34.2%] | 0.34x [0.23x, 0.51x] | descriptive |
| particle-1 | particle-dsh | particle-hermes | 65.4% / 59.0% | +6.4 [-1.9, +14.7] | -0.6 | 52 (0) | 0.1815 | no test | 0.0001 | no test | 25.6% [18.8%, 32.9%] | 0.64x [0.47x, 0.91x] | descriptive |
| DeepSeek-V4.1-Flash-1017 | deepseek-openclaw | deepseek-hermes | 65.1% / 68.9% | -3.8 [-13.8, +6.4] | -12.2 | 52 (0) | 0.5093 | no test | 0.0164 | no test | 27.8% [20.1%, 36.0%] | 0.88x [0.73x, 1.07x] | descriptive |
| DeepSeek-V4.1-Flash-1017 | deepseek-pi | deepseek-hermes | 74.4% / 68.9% | +5.4 [+0.0, +11.5] | +0.6 | 52 (0) | 0.1113 | no test | 0.0001 | no test | 17.9% [11.6%, 24.5%] | 0.49x [0.40x, 0.61x] | descriptive |
| DeepSeek-V4.1-Flash-1017 | deepseek-dsh | deepseek-hermes | 67.3% / 68.9% | -1.6 [-8.0, +4.8] | -7.1 | 52 (0) | 0.6909 | no test | 0.0001 | no test | 19.8% [13.8%, 26.0%] | 0.66x [0.55x, 0.80x] | descriptive |

### Power
- opus-openclaw vs opus-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1237; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-pi vs opus-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0958; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-dsh vs opus-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0866; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-openclaw vs sol-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0852; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-pi vs sol-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0762; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-dsh vs sol-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1140; the observed delta is at least that size.
- particle-openclaw vs particle-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1578; the observed delta is below that size, so a null result here is not evidence of no effect.
- particle-pi vs particle-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1273; the observed delta is below that size, so a null result here is not evidence of no effect.
- particle-dsh vs particle-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1204; the observed delta is below that size, so a null result here is not evidence of no effect.
- deepseek-openclaw vs deepseek-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1482; the observed delta is below that size, so a null result here is not evidence of no effect.
- deepseek-pi vs deepseek-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0848; the observed delta is below that size, so a null result here is not evidence of no effect.
- deepseek-dsh vs deepseek-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0927; the observed delta is below that size, so a null result here is not evidence of no effect.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 11.5% [5.1%, 19.2%] (52) | n/a | n/a |
| GPT-6.1 Sol | 6.4% [1.3%, 11.5%] (52) | n/a | n/a |
| particle-1 | 24.4% [16.7%, 33.3%] (52) | n/a | n/a |
| DeepSeek-V4.1-Flash-1017 | 21.2% [12.8%, 30.1%] (52) | n/a | n/a |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | 82.7% / 78.8% | -3.8 [-15.4, +7.7] | 52 | within threshold |
| GPT-6.1 Sol | sol-hermes | 86.3% / 86.3% | +0.0 [-7.8, +7.8] | 51 | within threshold |
| particle-1 | particle-hermes | 63.5% / 57.7% | -5.8 [-17.3, +5.8] | 52 | within threshold |
| DeepSeek-V4.1-Flash-1017 | deepseek-hermes | 74.5% / 70.2% | -4.3 [-19.1, +10.6] | 47 | within threshold |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hermes | 3 | 70.6% [56.9%, 82.4%] | 88.2% [78.4%, 96.1%] | 11.5% [5.1%, 19.2%] | 52 / 155 | 1 / 0 / 0 | 15 | 0 | 1 | 0 | $97.3647 metered + $3.1739 reserved |
| OpenClaw | 3 | 71.2% [57.7%, 82.7%] | 82.7% [71.2%, 92.3%] | 7.7% [2.6%, 14.1%] | 52 / 156 | 0 / 0 / 0 | 15 | 0 | 0 | 0 | $99.6274 metered + $0.0000 reserved |
| Pi | 3 | 71.2% [57.7%, 82.7%] | 88.5% [78.8%, 96.2%] | 11.5% [5.1%, 19.2%] | 52 / 156 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $68.6161 metered + $0.0000 reserved |
| Hermes | 3 | 78.3% [65.2%, 89.1%] | 89.1% [80.4%, 97.8%] | 6.4% [1.3%, 11.5%] | 52 / 150 | 4 / 2 / 0 | 3 | 0 | 4 | 0 | $48.7782 metered + $4.2474 reserved |
| OpenClaw | 3 | 68.6% [54.9%, 80.4%] | 84.3% [74.5%, 94.1%] | 10.3% [3.8%, 16.7%] | 52 / 155 | 0 / 1 / 0 | 4 | 0 | 0 | 0 | $57.8890 metered + $13.0683 reserved |
| Pi | 3 | 72.5% [60.8%, 84.3%] | 88.2% [78.4%, 96.1%] | 10.3% [3.8%, 16.7%] | 52 / 155 | 1 / 0 / 0 | 0 | 0 | 1 | 0 | $27.4231 metered + $2.5991 reserved |
| Hermes | 3 | 42.3% [28.8%, 55.8%] | 78.8% [67.3%, 88.5%] | 24.4% [16.7%, 33.3%] | 52 / 156 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $32.6133 metered + $0.0000 reserved |
| OpenClaw | 3 | 41.2% [27.5%, 54.9%] | 78.4% [66.7%, 88.2%] | 24.4% [15.4%, 33.3%] | 52 / 155 | 1 / 0 / 0 | 2 | 0 | 1 | 0 | $29.0397 metered + $0.0000 reserved |
| Pi | 3 | 40.4% [26.9%, 53.8%] | 80.8% [69.2%, 90.4%] | 26.9% [17.9%, 35.9%] | 52 / 156 | 0 / 0 / 0 | 1 | 1 | 0 | 0 | $11.7111 metered + $0.4609 reserved |
| Hermes | 3 | 53.2% [38.3%, 68.1%] | 85.1% [74.5%, 93.6%] | 21.2% [12.8%, 30.1%] | 52 / 151 | 0 / 5 / 0 | 2 | 0 | 0 | 0 | $16.4941 metered + $1.3018 reserved |
| OpenClaw | 3 | 51.0% [37.3%, 64.7%] | 82.4% [70.6%, 92.2%] | 22.4% [14.1%, 31.4%] | 52 / 155 | 0 / 1 / 0 | 1 | 5 | 0 | 0 | $14.3569 metered + $4.2996 reserved |
| Pi | 3 | 59.6% [46.2%, 73.1%] | 86.5% [76.9%, 94.2%] | 17.9% [10.3%, 25.6%] | 52 / 156 | 0 / 0 / 0 | 0 | 10 | 0 | 0 | $9.0112 metered + $0.0000 reserved |
| DeepSeek Harness | 3 | 48.1% [34.6%, 61.5%] | 80.8% [69.2%, 90.4%] | 21.8% [14.1%, 30.8%] | 52 / 156 | 0 / 0 / 0 | 3 | 16 | 0 | 0 | $10.9205 metered + $0.2252 reserved |
| DeepSeek Harness | 3 | 76.9% [65.4%, 88.5%] | 84.6% [75.0%, 94.2%] | 5.1% [1.3%, 10.3%] | 52 / 156 | 0 / 0 / 0 | 15 | 0 | 0 | 0 | $87.6815 metered + $0.0000 reserved |
| DeepSeek Harness | 3 | 38.5% [25.0%, 51.9%] | 84.6% [75.0%, 94.2%] | 30.8% [21.8%, 39.7%] | 52 / 156 | 0 / 0 / 0 | 29 | 0 | 0 | 0 | $124.6622 metered + $25.5565 reserved |
| DeepSeek Harness | 3 | 46.2% [32.7%, 59.6%] | 80.8% [69.2%, 90.4%] | 23.1% [14.1%, 32.1%] | 52 / 156 | 0 / 0 / 0 | 3 | 2 | 0 | 0 | $22.9736 metered + $0.1580 reserved |

## Model swap: particle against opus, sol in the same harnesses

d is frontier minus particle pass per task, paired within a harness; a primary call pools the harnesses that ran both models, each harness weighted equally. Non-inferiority: particle minus frontier above -10 points. Superiority: frontier minus particle above 0. Holm per test across the primary family (codegen/opus, codegen/sol, personal-brain/opus, personal-brain/sol, company-brain/opus, company-brain/sol; not in this run, counted as p = 1: personal-brain/opus, personal-brain/sol, company-brain/opus, company-brain/sol), and across harnesses within each use case and frontier model for the secondary calls. Clusters: task. Alpha 0.05, seed 7, 10000 draws, at least 10 clusters to test.

### Primary calls (pooled across harnesses)

| Call | Harnesses | Tasks / pairs / clusters | Attempts (particle / frontier) | particle / frontier task mean | d [95% CI] | particle worse / better / tied | Informative pairs | Non-inferiority p (Holm) | Superiority p (Holm) | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| codegen/opus | dsh, hermes, openclaw, pi | 52 / 208 / 52 | 623 / 623 | 62.2% / 79.5% | +17.3 [+7.1, +27.4] | 87 / 23 / 98 | 117 (56.3%) | 0.9155 (1.0000) | 0.0011 (0.0066) | **frontier better** |
| codegen/sol | dsh, hermes, openclaw, pi | 52 / 208 / 52 | 623 / 616 | 62.2% / 76.6% | +14.4 [+4.5, +24.4] | 77 / 38 / 93 | 123 (59.1%) | 0.8105 (1.0000) | 0.0025 (0.0125) | **frontier better** |

Cost per solved task: each arm's trial records' usage.usd over every trial of the paired tasks (excluded ones included), over scored passes; the trial-record figure, not the proxy-log cell totals.

| Call | particle cost per solved task [95% CI] | Frontier cost per solved task [95% CI] | particle to frontier cost ratio [95% CI] | pass^k per cell [95% CI] | Leak rate particle / frontier, difference [95% CI] |
|---|---|---|---|---|---|
| codegen/opus | $0.2505 [$0.1765, $0.3411] | $0.7201 [$0.4677, $1.0310] | 0.35x [0.27x, 0.47x] | particle-dsh k=3: 46.2% [32.7%, 59.6%] (52 tasks)<br>opus-dsh k=3: 76.9% [65.4%, 88.5%] (52 tasks)<br>particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>opus-hermes k=3: 70.6% [56.9%, 82.4%] (51 tasks, 1 with fewer attempts left out)<br>particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>opus-openclaw k=3: 71.2% [57.7%, 82.7%] (52 tasks)<br>particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>opus-pi k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/sol | $0.2505 [$0.1765, $0.3411] | $0.6459 [$0.4773, $0.8694] | 0.39x [0.27x, 0.53x] | particle-dsh k=3: 46.2% [32.7%, 59.6%] (52 tasks)<br>sol-dsh k=3: 38.5% [25.0%, 51.9%] (52 tasks)<br>particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>sol-hermes k=3: 78.3% [65.2%, 89.1%] (46 tasks, 6 with fewer attempts left out)<br>particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>sol-openclaw k=3: 68.6% [54.9%, 80.4%] (51 tasks, 1 with fewer attempts left out)<br>particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>sol-pi k=3: 72.5% [60.8%, 84.3%] (51 tasks, 1 with fewer attempts left out) | n/a |

### Secondary calls (one harness)

| Call | Harnesses | Tasks / pairs / clusters | Attempts (particle / frontier) | particle / frontier task mean | d [95% CI] | particle worse / better / tied | Informative pairs | Non-inferiority p (Holm) | Superiority p (Holm) | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| codegen/opus/dsh | dsh | 52 / 52 / 52 | 156 / 156 | 65.4% / 81.4% | +16.0 [+3.8, +28.2] | 23 / 6 / 23 | 29 (55.8%) | 0.8413 (1.0000) | 0.0079 (0.0158) | **frontier better** |
| codegen/opus/hermes | hermes | 52 / 52 / 52 | 156 / 155 | 59.0% / 79.5% | +20.5 [+8.3, +32.1] | 22 / 5 / 25 | 30 (57.7%) | 0.9589 (1.0000) | 0.0010 (0.0040) | **frontier better** |
| codegen/opus/openclaw | openclaw | 52 / 52 / 52 | 155 / 156 | 61.5% / 76.3% | +14.7 [+3.2, +26.3] | 19 / 6 / 27 | 27 (51.9%) | 0.7906 (1.0000) | 0.0116 (0.0158) | **frontier better** |
| codegen/opus/pi | pi | 52 / 52 / 52 | 156 / 156 | 62.8% / 80.8% | +17.9 [+7.1, +28.8] | 23 / 6 / 23 | 31 (59.6%) | 0.9222 (1.0000) | 0.0020 (0.0060) | **frontier better** |
| codegen/sol/dsh | dsh | 52 / 52 / 52 | 156 / 156 | 65.4% / 64.1% | -1.3 [-12.2, +10.9] | 12 / 18 / 22 | 34 (65.4%) | 0.0319 (0.1276) | 1.0000 (1.0000) | **can't tell** (MDD at 80% power: 16.8 points) |
| codegen/sol/hermes | hermes | 52 / 52 / 52 | 156 / 150 | 59.0% / 84.0% | +25.0 [+12.2, +37.8] | 23 / 6 / 23 | 30 (57.7%) | 0.9894 (1.0000) | 0.0005 (0.0020) | **frontier better** |
| codegen/sol/openclaw | openclaw | 52 / 52 / 52 | 155 / 155 | 61.5% / 77.6% | +16.0 [+5.1, +26.9] | 19 / 7 / 26 | 28 (53.8%) | 0.8575 (1.0000) | 0.0026 (0.0052) | **frontier better** |
| codegen/sol/pi | pi | 52 / 52 / 52 | 156 / 155 | 62.8% / 80.8% | +17.9 [+7.1, +28.8] | 23 / 7 / 22 | 31 (59.6%) | 0.9237 (1.0000) | 0.0009 (0.0027) | **frontier better** |

Cost per solved task: each arm's trial records' usage.usd over every trial of the paired tasks (excluded ones included), over scored passes; the trial-record figure, not the proxy-log cell totals.

| Call | particle cost per solved task [95% CI] | Frontier cost per solved task [95% CI] | particle to frontier cost ratio [95% CI] | pass^k per cell [95% CI] | Leak rate particle / frontier, difference [95% CI] |
|---|---|---|---|---|---|
| codegen/opus/dsh | $0.2268 [$0.1579, $0.3105] | $0.6904 [$0.4296, $1.0119] | 0.33x [0.24x, 0.47x] | particle-dsh k=3: 46.2% [32.7%, 59.6%] (52 tasks)<br>opus-dsh k=3: 76.9% [65.4%, 88.5%] (52 tasks) | n/a |
| codegen/opus/hermes | $0.3545 [$0.2197, $0.5419] | $0.8174 [$0.4947, $1.2765] | 0.43x [0.28x, 0.68x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>opus-hermes k=3: 70.6% [56.9%, 82.4%] (51 tasks, 1 with fewer attempts left out) | n/a |
| codegen/opus/openclaw | $0.3057 [$0.2016, $0.4426] | $0.8372 [$0.5539, $1.1911] | 0.37x [0.27x, 0.52x] | particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>opus-openclaw k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/opus/pi | $0.1242 [$0.0838, $0.1789] | $0.5446 [$0.3328, $0.8019] | 0.23x [0.16x, 0.33x] | particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>opus-pi k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/sol/dsh | $0.2268 [$0.1579, $0.3105] | $1.5022 [$1.0522, $2.1154] | 0.15x [0.10x, 0.22x] | particle-dsh k=3: 46.2% [32.7%, 59.6%] (52 tasks)<br>sol-dsh k=3: 38.5% [25.0%, 51.9%] (52 tasks) | n/a |
| codegen/sol/hermes | $0.3545 [$0.2197, $0.5419] | $0.4208 [$0.3066, $0.5663] | 0.84x [0.53x, 1.28x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>sol-hermes k=3: 78.3% [65.2%, 89.1%] (46 tasks, 6 with fewer attempts left out) | n/a |
| codegen/sol/openclaw | $0.3057 [$0.2016, $0.4426] | $0.5913 [$0.3821, $0.9178] | 0.52x [0.29x, 0.86x] | particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>sol-openclaw k=3: 68.6% [54.9%, 80.4%] (51 tasks, 1 with fewer attempts left out) | n/a |
| codegen/sol/pi | $0.1242 [$0.0838, $0.1789] | $0.2402 [$0.1744, $0.3248] | 0.52x [0.35x, 0.72x] | particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>sol-pi k=3: 72.5% [60.8%, 84.3%] (51 tasks, 1 with fewer attempts left out) | n/a |

## Low-cost swap: DeepSeek-V4.1-Flash-1017 against particle-1 in the same harnesses

DeepSeek-V4.1-Flash-1017 is a low-cost model, not a frontier model. d is DeepSeek-V4.1-Flash-1017 minus particle-1 pass per task, paired within a harness; a call pools the harnesses of its use case that ran both models, each weighted equally, and leaves out dsh, reported beside it. Superiority each way (exact one-sided cluster sign-flip), Holm over 6 calls (codegen/DeepSeek-V4.1-Flash-1017 better, codegen/particle-1 better, personal-brain/DeepSeek-V4.1-Flash-1017 better, personal-brain/particle-1 better, company-brain/DeepSeek-V4.1-Flash-1017 better, company-brain/particle-1 better). Within 10 points: two one-sided bootstrap tests at -10 and +10 points, p the larger, Holm over 3 calls (codegen/within, personal-brain/within, company-brain/within); not in this run, counted as p = 1: personal-brain, company-brain. Clusters: task. Alpha 0.05, seed 7, 10000 draws, at least 10 clusters to test.

| Use case | Harnesses | Tasks / pairs / clusters | Attempts (DeepSeek-V4.1-Flash-1017 / particle-1) | DeepSeek-V4.1-Flash-1017 / particle-1 task mean | d [95% CI] | DeepSeek-V4.1-Flash-1017 worse / better / tied | Informative pairs | DeepSeek-V4.1-Flash-1017 better p (Holm) | particle-1 better p (Holm) | Within 10 points p (Holm) | Label |
|---|---|---|---|---|---|---|---|---|---|---|---|
| codegen | hermes, openclaw, pi | 52 / 156 / 52 | 462 / 467 | 69.9% / 61.1% | +8.8 [+3.6, +14.2] | 25 / 52 / 79 | 86 (55.1%) | 0.0004 (0.0024) | 1.0000 (1.0000) | 0.3139 (0.9416) | **DeepSeek-V4.1-Flash-1017 better** |

### Beside the calls (descriptive, no test)

| Use case | Comparison | Harnesses | Tasks / pairs / clusters | Task means | Difference [95% CI] |
|---|---|---|---|---|---|
| codegen | dsh (left out of the pool): DeepSeek-V4.1-Flash-1017 minus particle-1 | dsh | 52 / 52 / 52 | 67.3% / 65.4% | +1.9 [-4.5, +9.0] |
| codegen | opus minus DeepSeek-V4.1-Flash-1017 | hermes, openclaw, pi | 52 / 156 / 52 | 78.8% / 69.9% | +9.0 [+0.2, +17.8] |
| codegen | sol minus DeepSeek-V4.1-Flash-1017 | hermes, openclaw, pi | 52 / 156 / 52 | 80.8% / 69.9% | +10.9 [+2.1, +19.9] |

### Cost per solved task, one basis

Each trial's tokens times the peak list rates of runner/pricing/prices-2026-11-08.json (dated 2026-11-08, sha256 f113914c2c75), USD per million tokens: DeepSeek-V4.1-Flash-1017 (openrouter:deepseek/deepseek-v4.1-flash-1017): input $0.3, cache read $0.006, cache write none (bills as input), output $1.2; particle-1 (particle:particle-1): input $0.25, cache read $0.03, cache write none (bills as input), output $1. Uncached input is usage.input_tokens minus cache reads and writes. Every trial of the paired tasks counts, excluded ones included, over scored passes. The ratio is particle-1 over DeepSeek-V4.1-Flash-1017.

| Use case | DeepSeek-V4.1-Flash-1017 cost per solved task [95% CI] | particle-1 cost per solved task [95% CI] | particle-1 to DeepSeek-V4.1-Flash-1017 cost ratio [95% CI] | Trials priced (DeepSeek-V4.1-Flash-1017 / particle-1) |
|---|---|---|---|---|
| codegen | 22 of 468 trial(s) lack the token counts, so no cost per solved task | 2 of 468 trial(s) lack the token counts, so no cost per solved task | not computed: trial records lack usage; usage.unpriced: tokens of requests charged their reservation | 446 of 468 / 466 of 468 |

**Fields the trial records lack for the token basis:**

- codegen, DeepSeek-V4.1-Flash-1017: usage (1 trial(s)); usage.unpriced: tokens of requests charged their reservation (21 trial(s))
- codegen, particle-1: usage.unpriced: tokens of requests charged their reservation (2 trial(s))
