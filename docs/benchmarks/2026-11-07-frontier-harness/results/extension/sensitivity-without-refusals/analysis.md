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
| codex | 88.2% [78.4%, 96.1%]<br>$1.5887 per solve [$1.1633, $2.1743]<br>297.0 s median (contended)<br>**home** | not run |
| openclaw | 76.5% [64.7%, 88.2%]<br>$3.0790 per solve [$2.2285, $4.2823]<br>405.2 s median (contended)<br>**descriptive** | 65.4% [51.9%, 78.8%]<br>$2.3160 per solve [$1.5583, $3.3851]<br>389.3 s median (contended)<br>**descriptive** |
| claude-code | not run | 74.0% [62.0%, 86.0%]<br>$2.8498 per solve [$1.6101, $4.7644]<br>433.1 s median (contended)<br>**home** |

## Pairs: cell minus home

Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.

| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | astra-openclaw | astra-codex | 76.5% / 88.2% | -11.8 [-23.5, +0.0] | -21.6 | 51 (0) | 0.1086 | no test | 0.2990 | no test | 19.6% [9.8%, 31.4%] | 1.94x [1.56x, 2.50x] | descriptive |
| Claude Fable 5.1 | fable-openclaw | fable-cc | 68.0% / 74.0% | -6.0 [-18.0, +6.0] | -16.0 | 50 (2) | 0.5513 | no test | 0.0849 | no test | 22.0% [10.0%, 34.0%] | 0.81x [0.53x, 1.23x] | descriptive |

### Power
- astra-openclaw vs astra-codex: at alpha 0.05: with 51 pairs in 51 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1691; the observed delta is below that size, so a null result here is not evidence of no effect.
- fable-openclaw vs fable-cc: at alpha 0.05: with 50 pairs in 50 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1862; the observed delta is below that size, so a null result here is not evidence of no effect.

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
| Codex | 1 | 88.2% [78.4%, 96.1%] | 88.2% [78.4%, 96.1%] | n/a | 51 / 51 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $71.4902 |
| OpenClaw | 1 | 76.5% [64.7%, 88.2%] | 76.5% [64.7%, 88.2%] | n/a | 51 / 51 | 0 / 0 / 0 | 0 | 0 | 0 | 0 | $120.0804 |
| Claude Code | 1 | 74.0% [62.0%, 86.0%] | 74.0% [62.0%, 86.0%] | n/a | 50 / 50 | 0 / 0 / 0 | 1 | 0 | 0 | 0 | $105.4427 |
| OpenClaw | 1 | 65.4% [51.9%, 78.8%] | 65.4% [51.9%, 78.8%] | n/a | 52 / 52 | 0 / 0 / 0 | 5 | 0 | 0 | 0 | $78.7428 |

## Tasks dropped from pairs
- fable-openclaw vs fable-cc: dna-assembly (no scored attempt in fable-cc); protein-assembly (no scored attempt in fable-cc)
