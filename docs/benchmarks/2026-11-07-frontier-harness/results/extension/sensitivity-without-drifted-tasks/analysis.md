# Frontier harness analysis: frontier-harness-2026-11

Method: task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p. Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 15 points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. 0 trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.

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

| Harness | GPT-6 Astra | Claude Fable 5.1 |
|---|---|---|
| codex | 85.7% [75.5%, 93.9%]<br>$1.7567 per solve [$1.1889, $2.5749]<br>278.1 s median (contended)<br>**home** | not run |
| openclaw | 75.5% [63.3%, 87.8%]<br>$3.8393 per solve [$2.3489, $6.3056]<br>399.3 s median (contended)<br>**descriptive** | 65.3% [51.0%, 77.6%]<br>$2.3657 per solve [$1.5657, $3.5068]<br>385.8 s median (contended)<br>**descriptive** |
| claude-code | not run | 71.4% [57.1%, 83.7%]<br>$2.9450 per solve [$1.6338, $4.9358]<br>426.7 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | astra-openclaw | astra-codex | 75.5% / 85.7% | -10.2 [-22.4, +2.0] | -20.4 | 49 (0) | 0.1821 | no test | 0.1925 | no test | 18.4% [8.2%, 30.6%] | 2.19x [1.64x, 2.91x] | descriptive |
| Claude Fable 5.1 | fable-openclaw | fable-cc | 65.3% / 71.4% | -6.1 [-18.4, +6.1] | -16.3 | 49 (0) | 0.5473 | no test | 0.0809 | no test | 22.4% [12.2%, 34.7%] | 0.80x [0.51x, 1.24x] | descriptive |

### Power
- astra-openclaw vs astra-codex: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1683; the observed delta is below that size, so a null result here is not evidence of no effect.
- fable-openclaw vs fable-cc: at alpha 0.05: with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1900; the observed delta is below that size, so a null result here is not evidence of no effect.

## Noise: rerun flip and harness flip per model

Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.

| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |
|---|---|---|---|
| GPT-6 Astra | n/a (needs two attempts) | n/a | n/a |
| Claude Fable 5.1 | n/a (needs two attempts) | n/a | n/a |

## Drift: home cell attempt 2 minus attempt 1

Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (none set).

| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |
|---|---|---|---|---|---|
| GPT-6 Astra | astra-codex | n/a / n/a | n/a [no interval] | 0 | n/a |
| Claude Fable 5.1 | fable-cc | n/a / n/a | n/a [no interval] | 0 | n/a |

## Reliability and exclusions per cell

| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Codex | 1 | 85.7% [75.5%, 93.9%] | 85.7% [75.5%, 93.9%] | n/a | 49 / 49 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $73.7817 |
| OpenClaw | 1 | 75.5% [63.3%, 87.8%] | 75.5% [63.3%, 87.8%] | n/a | 49 / 49 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $142.0546 |
| Claude Code | 1 | 71.4% [57.1%, 83.7%] | 71.4% [57.1%, 83.7%] | n/a | 49 / 49 | 0 / 0 / 0 | 2 | 0 | 0 | 0 | $103.0757 |
| OpenClaw | 1 | 65.3% [51.0%, 77.6%] | 65.3% [51.0%, 77.6%] | n/a | 49 / 49 | 0 / 0 / 0 | 4 | 0 | 0 | 0 | $75.7024 |
