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

| Harness | Opus 5.5 (kept sample) | GPT-6.1 Sol (kept sample) |
|---|---|---|
| claude-code | 87.5% [62.5%, 100.0%]<br>$0.1901 per solve [$0.1250, $0.2923]<br>181.0 s median (contended)<br>**home** | not run |
| hermes | 75.0% [37.5%, 100.0%]<br>$0.2665 per solve [$0.1636, $0.4448]<br>322.3 s median (contended)<br>**descriptive** | 75.0% [37.5%, 100.0%]<br>$0.1786 per solve [$0.1002, $0.3861]<br>340.1 s median (contended)<br>**descriptive** |
| openclaw | 75.0% [37.5%, 100.0%]<br>$0.2673 per solve [$0.2162, $0.3905]<br>226.3 s median (contended)<br>**descriptive** | 75.0% [37.5%, 100.0%]<br>$0.2283 per solve [$0.1432, $0.3881]<br>241.1 s median (contended)<br>**descriptive** |
| pi | 87.5% [62.5%, 100.0%]<br>$0.1206 per solve [$0.0883, $0.1512]<br>118.1 s median (contended)<br>**descriptive** | 87.5% [62.5%, 100.0%]<br>$0.1224 per solve [$0.0464, $0.2528]<br>134.1 s median (contended)<br>**descriptive** |
| codex | not run | 87.5% [62.5%, 100.0%]<br>$0.1703 per solve [$0.0906, $0.3090]<br>191.1 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 (kept sample) | opus-hermes-kept | opus-cc-kept | 75.0% / 87.5% | -12.5 [-37.5, +0.0] | -37.5 | 8 (0) | 1.0000 | no test | 0.2613 | no test | 12.5% [0.0%, 37.5%] | 1.40x [1.03x, 2.05x] | descriptive |
| Opus 5.5 (kept sample) | opus-openclaw-kept | opus-cc-kept | 75.0% / 87.5% | -12.5 [-50.0, +25.0] | -50.0 | 8 (0) | 1.0000 | no test | 0.3772 | no test | 37.5% [0.0%, 75.0%] | 1.41x [0.79x, 2.76x] | descriptive |
| Opus 5.5 (kept sample) | opus-pi-kept | opus-cc-kept | 87.5% / 87.5% | +0.0 [-37.5, +37.5] | -25.0 | 8 (0) | 1.0000 | no test | 0.1370 | no test | 25.0% [0.0%, 62.5%] | 0.63x [0.43x, 0.87x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-hermes-kept | sol-codex-kept | 75.0% / 87.5% | -12.5 [-37.5, +0.0] | -37.5 | 8 (0) | 1.0000 | no test | 0.2698 | no test | 12.5% [0.0%, 37.5%] | 1.05x [0.83x, 1.38x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-openclaw-kept | sol-codex-kept | 75.0% / 87.5% | -12.5 [-37.5, +0.0] | -37.5 | 8 (0) | 1.0000 | no test | 0.2567 | no test | 12.5% [0.0%, 37.5%] | 1.34x [0.92x, 2.51x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-pi-kept | sol-codex-kept | 87.5% / 87.5% | +0.0 [+0.0, +0.0] | n/a | 8 (0) | 1.0000 | no test | n/a | no test | 0.0% [0.0%, 0.0%] | 0.72x [0.51x, 0.84x] | descriptive |

### Power
- opus-hermes-kept vs opus-cc-kept: at alpha 0.05: with 8 pairs in 8 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.3502; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-openclaw-kept vs opus-cc-kept: at alpha 0.05: with 8 pairs in 8 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.6348; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-pi-kept vs opus-cc-kept: at alpha 0.05: with 8 pairs in 8 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.5294; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-hermes-kept vs sol-codex-kept: at alpha 0.05: with 8 pairs in 8 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.3502; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-openclaw-kept vs sol-codex-kept: at alpha 0.05: with 8 pairs in 8 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.3502; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-pi-kept vs sol-codex-kept: at alpha 0.05: no paired variation was observed, so the detectable effect cannot be estimated from this data.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| Opus 5.5 (kept sample) | n/a (needs two attempts) | n/a | n/a |
| GPT-6.1 Sol (kept sample) | n/a (needs two attempts) | n/a | n/a |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (none set).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| Opus 5.5 (kept sample) | opus-cc-kept | n/a / n/a | n/a [no interval] | 0 | n/a |
| GPT-6.1 Sol (kept sample) | sol-codex-kept | n/a / n/a | n/a [no interval] | 0 | n/a |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 1 | 87.5% [62.5%, 100.0%] | 87.5% [62.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $1.3307 |
| Hermes | 1 | 75.0% [37.5%, 100.0%] | 75.0% [37.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 1 | 1 | 0 | 0 | $1.5992 |
| OpenClaw | 1 | 75.0% [37.5%, 100.0%] | 75.0% [37.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $1.6038 |
| Pi | 1 | 87.5% [62.5%, 100.0%] | 87.5% [62.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $0.8445 |
| Codex | 1 | 87.5% [62.5%, 100.0%] | 87.5% [62.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $1.1921 |
| Hermes | 1 | 75.0% [37.5%, 100.0%] | 75.0% [37.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 1 | 0 | 0 | $1.0717 |
| OpenClaw | 1 | 75.0% [37.5%, 100.0%] | 75.0% [37.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $1.3697 |
| Pi | 1 | 87.5% [62.5%, 100.0%] | 87.5% [62.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $0.8569 |
