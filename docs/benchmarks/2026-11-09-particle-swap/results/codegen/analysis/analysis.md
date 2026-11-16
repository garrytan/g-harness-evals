# Frontier harness analysis: particle-swap-2026-11

Method: task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p. Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 15 points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. 2 trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.

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

| Harness | Opus 5.5 | GPT-6.1 Sol | particle-1 |
|---|---|---|---|
| hermes | 79.5% [69.9%, 88.5%]<br>$0.7916 per solve [$0.4945, $1.2156] (metered; $3.1739 charged at reservation left out)<br>395.7 s median (contended)<br>**home** | 84.0% [74.4%, 92.3%]<br>$0.3871 per solve [$0.2915, $0.5036] (metered; $4.2474 charged at reservation left out)<br>470.4 s median (contended)<br>**home** | 59.0% [48.1%, 69.9%]<br>$0.3545 per solve [$0.2215, $0.5457] (metered; $0.0000 charged at reservation left out)<br>936.6 s median (contended)<br>**home** |
| openclaw | 76.3% [65.4%, 86.5%]<br>$0.8372 per solve [$0.5616, $1.2016] (metered; $0.0000 charged at reservation left out)<br>267.6 s median (contended)<br>**descriptive** | 77.6% [66.7%, 87.2%]<br>$0.4824 per solve [$0.3603, $0.6473] (metered; $13.0683 charged at reservation left out)<br>348.6 s median (contended)<br>**descriptive** | 61.5% [50.6%, 71.8%]<br>$0.3057 per solve [$0.2005, $0.4428] (metered; $0.0000 charged at reservation left out)<br>528.3 s median (contended)<br>**descriptive** |
| pi | 80.8% [71.2%, 89.7%]<br>$0.5446 per solve [$0.3351, $0.8147] (metered; $0.0000 charged at reservation left out)<br>188.6 s median (contended)<br>**descriptive** | 80.8% [71.2%, 89.7%]<br>$0.2194 per solve [$0.1654, $0.2912] (metered; $2.5991 charged at reservation left out)<br>237.2 s median (contended)<br>**descriptive** | 62.8% [52.6%, 72.4%]<br>$0.1195 per solve [$0.0811, $0.1690] (metered; $0.4609 charged at reservation left out)<br>341.7 s median (contended)<br>**descriptive** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | opus-openclaw | opus-hermes | 76.3% / 79.5% | -3.2 [-12.2, +5.1] | -10.9 | 52 (0) | 0.5669 | no test | 0.0057 | no test | 16.5% [9.4%, 24.6%] | 1.06x [0.82x, 1.44x] | descriptive |
| Opus 5.5 | opus-pi | opus-hermes | 80.8% / 79.5% | +1.3 [-5.1, +7.7] | -4.5 | 52 (0) | 0.8543 | no test | 0.0001 | no test | 13.7% [7.7%, 20.3%] | 0.69x [0.50x, 0.97x] | descriptive |
| GPT-6.1 Sol | sol-openclaw | sol-hermes | 77.6% / 84.0% | -6.4 [-12.8, -1.3] | -11.5 | 52 (0) | 0.0603 | no test | 0.0040 | no test | 9.8% [4.5%, 16.0%] | 1.25x [1.01x, 1.53x] | descriptive |
| GPT-6.1 Sol | sol-pi | sol-hermes | 80.4% / 84.0% | -3.5 [-9.0, +1.6] | -8.0 | 52 (0) | 0.2753 | no test | 0.0001 | no test | 9.5% [5.0%, 14.7%] | 0.57x [0.49x, 0.65x] | descriptive |
| particle-1 | particle-openclaw | particle-hermes | 61.5% / 59.0% | +2.6 [-8.3, +13.5] | -6.4 | 52 (0) | 0.7353 | no test | 0.0015 | no test | 32.5% [25.0%, 40.2%] | 0.86x [0.57x, 1.33x] | descriptive |
| particle-1 | particle-pi | particle-hermes | 62.8% / 59.0% | +3.8 [-5.1, +12.8] | -3.2 | 52 (0) | 0.4811 | no test | 0.0001 | no test | 27.8% [21.6%, 34.2%] | 0.34x [0.23x, 0.51x] | descriptive |

### Power
- opus-openclaw vs opus-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1237; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-pi vs opus-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0958; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-openclaw vs sol-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0852; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-pi vs sol-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.0762; the observed delta is below that size, so a null result here is not evidence of no effect.
- particle-openclaw vs particle-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1578; the observed delta is below that size, so a null result here is not evidence of no effect.
- particle-pi vs particle-hermes: at alpha 0.05: with 52 pairs in 52 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1273; the observed delta is below that size, so a null result here is not evidence of no effect.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 | 11.5% [5.1%, 19.2%] (52) | n/a | n/a |
| GPT-6.1 Sol | 6.4% [1.3%, 11.5%] (52) | n/a | n/a |
| particle-1 | 24.4% [16.7%, 33.3%] (52) | n/a | n/a |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (+10.0 points).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 | opus-hermes | 82.7% / 78.8% | -3.8 [-15.4, +7.7] | 52 | within threshold |
| GPT-6.1 Sol | sol-hermes | 86.3% / 86.3% | +0.0 [-7.8, +7.8] | 51 | within threshold |
| particle-1 | particle-hermes | 63.5% / 57.7% | -5.8 [-17.3, +5.8] | 52 | within threshold |

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

## Model swap: particle against opus, sol in the same harnesses

d is frontier minus particle pass per task, paired within a harness; a primary call pools the harnesses that ran both models, each harness weighted equally. Non-inferiority: particle minus frontier above -10 points. Superiority: frontier minus particle above 0. Holm per test across the primary family (codegen/opus, codegen/sol, personal-brain/opus, personal-brain/sol, company-brain/opus, company-brain/sol; not in this run, counted as p = 1: personal-brain/opus, personal-brain/sol, company-brain/opus, company-brain/sol), and across harnesses within each use case and frontier model for the secondary calls. Clusters: task. Alpha 0.05, seed 7, 10000 draws, at least 10 clusters to test.

### Primary calls (pooled across harnesses)

| Call | Harnesses | Tasks / pairs / clusters | Attempts (particle / frontier) | particle / frontier task mean | d [95% CI] | particle worse / better / tied | Informative pairs | Non-inferiority p (Holm) | Superiority p (Holm) | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| codegen/opus | hermes, openclaw, pi | 52 / 156 / 52 | 467 / 467 | 61.1% / 78.8% | +17.7 [+7.7, +27.8] | 64 / 17 / 75 | 88 (56.4%) | 0.9338 (1.0000) | 0.0011 (0.0055) | **frontier better** |
| codegen/sol | hermes, openclaw, pi | 52 / 156 / 52 | 467 / 460 | 61.1% / 80.8% | +19.7 [+9.4, +29.7] | 65 / 20 / 71 | 89 (57.0%) | 0.9703 (1.0000) | 0.0001 (0.0006) | **frontier better** |

Cost per solved task: each arm's trial records' usage.usd over every trial of the paired tasks (excluded ones included), over scored passes; the trial-record figure, not the proxy-log cell totals.

| Call | particle cost per solved task [95% CI] | Frontier cost per solved task [95% CI] | particle to frontier cost ratio [95% CI] | pass^k per cell [95% CI] | Leak rate particle / frontier, difference [95% CI] |
|---|---|---|---|---|---|
| codegen/opus | $0.2590 [$0.1795, $0.3578] | $0.7304 [$0.4730, $1.0529] | 0.35x [0.27x, 0.49x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>opus-hermes k=3: 70.6% [56.9%, 82.4%] (51 tasks, 1 with fewer attempts left out)<br>particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>opus-openclaw k=3: 71.2% [57.7%, 82.7%] (52 tasks)<br>particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>opus-pi k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/sol | $0.2590 [$0.1795, $0.3578] | $0.4151 [$0.2945, $0.5851] | 0.62x [0.40x, 0.90x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>sol-hermes k=3: 78.3% [65.2%, 89.1%] (46 tasks, 6 with fewer attempts left out)<br>particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>sol-openclaw k=3: 68.6% [54.9%, 80.4%] (51 tasks, 1 with fewer attempts left out)<br>particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>sol-pi k=3: 72.5% [60.8%, 84.3%] (51 tasks, 1 with fewer attempts left out) | n/a |

### Secondary calls (one harness)

| Call | Harnesses | Tasks / pairs / clusters | Attempts (particle / frontier) | particle / frontier task mean | d [95% CI] | particle worse / better / tied | Informative pairs | Non-inferiority p (Holm) | Superiority p (Holm) | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| codegen/opus/hermes | hermes | 52 / 52 / 52 | 156 / 155 | 59.0% / 79.5% | +20.5 [+8.3, +32.1] | 22 / 5 / 25 | 30 (57.7%) | 0.9589 (1.0000) | 0.0010 (0.0030) | **frontier better** |
| codegen/opus/openclaw | openclaw | 52 / 52 / 52 | 155 / 156 | 61.5% / 76.3% | +14.7 [+3.2, +26.3] | 19 / 6 / 27 | 27 (51.9%) | 0.7906 (1.0000) | 0.0116 (0.0116) | **frontier better** |
| codegen/opus/pi | pi | 52 / 52 / 52 | 156 / 156 | 62.8% / 80.8% | +17.9 [+7.1, +28.8] | 23 / 6 / 23 | 31 (59.6%) | 0.9222 (1.0000) | 0.0020 (0.0040) | **frontier better** |
| codegen/sol/hermes | hermes | 52 / 52 / 52 | 156 / 150 | 59.0% / 84.0% | +25.0 [+12.2, +37.8] | 23 / 6 / 23 | 30 (57.7%) | 0.9894 (1.0000) | 0.0005 (0.0015) | **frontier better** |
| codegen/sol/openclaw | openclaw | 52 / 52 / 52 | 155 / 155 | 61.5% / 77.6% | +16.0 [+5.1, +26.9] | 19 / 7 / 26 | 28 (53.8%) | 0.8575 (1.0000) | 0.0026 (0.0026) | **frontier better** |
| codegen/sol/pi | pi | 52 / 52 / 52 | 156 / 155 | 62.8% / 80.8% | +17.9 [+7.1, +28.8] | 23 / 7 / 22 | 31 (59.6%) | 0.9237 (1.0000) | 0.0009 (0.0018) | **frontier better** |

Cost per solved task: each arm's trial records' usage.usd over every trial of the paired tasks (excluded ones included), over scored passes; the trial-record figure, not the proxy-log cell totals.

| Call | particle cost per solved task [95% CI] | Frontier cost per solved task [95% CI] | particle to frontier cost ratio [95% CI] | pass^k per cell [95% CI] | Leak rate particle / frontier, difference [95% CI] |
|---|---|---|---|---|---|
| codegen/opus/hermes | $0.3545 [$0.2197, $0.5419] | $0.8174 [$0.4947, $1.2765] | 0.43x [0.28x, 0.68x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>opus-hermes k=3: 70.6% [56.9%, 82.4%] (51 tasks, 1 with fewer attempts left out) | n/a |
| codegen/opus/openclaw | $0.3057 [$0.2016, $0.4426] | $0.8372 [$0.5539, $1.1911] | 0.37x [0.27x, 0.52x] | particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>opus-openclaw k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/opus/pi | $0.1242 [$0.0838, $0.1789] | $0.5446 [$0.3328, $0.8019] | 0.23x [0.16x, 0.33x] | particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>opus-pi k=3: 71.2% [57.7%, 82.7%] (52 tasks) | n/a |
| codegen/sol/hermes | $0.3545 [$0.2197, $0.5419] | $0.4208 [$0.3066, $0.5663] | 0.84x [0.53x, 1.28x] | particle-hermes k=3: 42.3% [28.8%, 55.8%] (52 tasks)<br>sol-hermes k=3: 78.3% [65.2%, 89.1%] (46 tasks, 6 with fewer attempts left out) | n/a |
| codegen/sol/openclaw | $0.3057 [$0.2016, $0.4426] | $0.5913 [$0.3821, $0.9178] | 0.52x [0.29x, 0.86x] | particle-openclaw k=3: 41.2% [27.5%, 54.9%] (51 tasks, 1 with fewer attempts left out)<br>sol-openclaw k=3: 68.6% [54.9%, 80.4%] (51 tasks, 1 with fewer attempts left out) | n/a |
| codegen/sol/pi | $0.1242 [$0.0838, $0.1789] | $0.2402 [$0.1744, $0.3248] | 0.52x [0.35x, 0.72x] | particle-pi k=3: 40.4% [26.9%, 53.8%] (52 tasks)<br>sol-pi k=3: 72.5% [60.8%, 84.3%] (51 tasks, 1 with fewer attempts left out) | n/a |
