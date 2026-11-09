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
| hermes | 71.4% [42.9%, 100.0%]<br>$0.3000 per solve [$0.1841, $0.5570]<br>347.6 s median (contended)<br>**descriptive** | 71.4% [42.9%, 100.0%]<br>$0.1959 per solve [$0.1038, $0.4452]<br>373.6 s median (contended)<br>**descriptive** |
| openclaw | 85.7% [57.1%, 100.0%]<br>$0.2378 per solve [$0.2091, $0.2731]<br>225.4 s median (contended)<br>**descriptive** | 100.0% [100.0%, 100.0%]<br>$0.2115 per solve [$0.1351, $0.3241]<br>295.2 s median (contended)<br>**descriptive** |
| pi | 85.7% [57.1%, 100.0%]<br>$0.1318 per solve [$0.1012, $0.1583]<br>121.4 s median (contended)<br>**descriptive** | 80.0% [40.0%, 100.0%]<br>$0.1700 per solve [$0.0446, $0.4118]<br>179.4 s median (contended)<br>**descriptive** |
| codex | not run | 87.5% [62.5%, 100.0%]<br>$0.1703 per solve [$0.0906, $0.3090]<br>191.1 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 (kept sample) | opus-hermes-kept | opus-cc-kept | 71.4% / 85.7% | -14.3 [-42.9, +0.0] | -42.9 | 7 (1) | 1.0000 | no test | 0.2630 | no test | 14.3% [0.0%, 42.9%] | 1.46x [1.04x, 2.27x] | descriptive |
| Opus 5.5 (kept sample) | opus-openclaw-kept | opus-cc-kept | 85.7% / 85.7% | +0.0 [-42.9, +42.9] | -28.6 | 7 (1) | 1.0000 | no test | 0.1392 | no test | 28.6% [0.0%, 57.1%] | 1.16x [0.66x, 1.85x] | descriptive |
| Opus 5.5 (kept sample) | opus-pi-kept | opus-cc-kept | 85.7% / 85.7% | +0.0 [-42.9, +42.9] | -28.6 | 7 (1) | 1.0000 | no test | 0.1392 | no test | 28.6% [0.0%, 57.1%] | 0.64x [0.40x, 0.91x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-hermes-kept | sol-codex-kept | 71.4% / 85.7% | -14.3 [-42.9, +0.0] | -42.9 | 7 (1) | 1.0000 | no test | 0.2588 | no test | 14.3% [0.0%, 42.9%] | 1.05x [0.82x, 1.45x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-openclaw-kept | sol-codex-kept | 100.0% / 100.0% | +0.0 [+0.0, +0.0] | n/a | 5 (3) | 1.0000 | no test | n/a | no test | 0.0% [0.0%, 0.0%] | 1.17x [1.02x, 1.51x] | descriptive |
| GPT-6.1 Sol (kept sample) | sol-pi-kept | sol-codex-kept | 80.0% / 80.0% | +0.0 [+0.0, +0.0] | n/a | 5 (3) | 1.0000 | no test | n/a | no test | 0.0% [0.0%, 0.0%] | 0.79x [0.51x, 0.90x] | descriptive |

### Power
- opus-hermes-kept vs opus-cc-kept: at alpha 0.05: with 7 pairs in 7 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.4002; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-openclaw-kept vs opus-cc-kept: at alpha 0.05: with 7 pairs in 7 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.6114; the observed delta is below that size, so a null result here is not evidence of no effect.
- opus-pi-kept vs opus-cc-kept: at alpha 0.05: with 7 pairs in 7 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.6114; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-hermes-kept vs sol-codex-kept: at alpha 0.05: with 7 pairs in 7 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.4002; the observed delta is below that size, so a null result here is not evidence of no effect.
- sol-openclaw-kept vs sol-codex-kept: at alpha 0.05: no paired variation was observed, so the detectable effect cannot be estimated from this data.
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
| Hermes | 1 | 71.4% [42.9%, 100.0%] | 71.4% [42.9%, 100.0%] | n/a | 7 / 7 | 0 / 0 / 0 | 1 | 1 | 0 | 0 | $1.5001 |
| OpenClaw | 1 | 85.7% [57.1%, 100.0%] | 85.7% [57.1%, 100.0%] | n/a | 7 / 7 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $1.4268 |
| Pi | 1 | 85.7% [57.1%, 100.0%] | 85.7% [57.1%, 100.0%] | n/a | 7 / 7 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $0.7910 |
| Codex | 1 | 87.5% [62.5%, 100.0%] | 87.5% [62.5%, 100.0%] | n/a | 8 / 8 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $1.1921 |
| Hermes | 1 | 71.4% [42.9%, 100.0%] | 71.4% [42.9%, 100.0%] | n/a | 7 / 7 | 0 / 0 / 0 | 0 | 1 | 0 | 0 | $0.9794 |
| OpenClaw | 1 | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | n/a | 5 / 5 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $1.0573 |
| Pi | 1 | 80.0% [40.0%, 100.0%] | 80.0% [40.0%, 100.0%] | n/a | 5 / 5 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $0.6801 |

## Tasks dropped from pairs
- opus-hermes-kept vs opus-cc-kept: hf-model-inference (no scored attempt in opus-hermes-kept)
- opus-openclaw-kept vs opus-cc-kept: hf-model-inference (no scored attempt in opus-openclaw-kept)
- opus-pi-kept vs opus-cc-kept: hf-model-inference (no scored attempt in opus-pi-kept)
- sol-hermes-kept vs sol-codex-kept: hf-model-inference (no scored attempt in sol-hermes-kept)
- sol-openclaw-kept vs sol-codex-kept: extract-elf (no scored attempt in sol-openclaw-kept); hf-model-inference (no scored attempt in sol-openclaw-kept); password-recovery (no scored attempt in sol-openclaw-kept)
- sol-pi-kept vs sol-codex-kept: circuit-fibsqrt (no scored attempt in sol-pi-kept); count-dataset-tokens (no scored attempt in sol-pi-kept); hf-model-inference (no scored attempt in sol-pi-kept)
