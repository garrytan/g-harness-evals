# Model comparison (subset of 14 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 57.1% [28.6%, 78.6%] | 12 / 21 | 14 | 0 | $3.81 [$1.53, $9.59] | 401 | 2045 | 0.0% | 57.1% |
| Fable 5.1 | 53.6% [28.6%, 78.6%] | 11 / 21 | 14 | 0 | $3.38 [$1.22, $9.32] | 367 | 1364 | 14.3% | 42.9% |
| Opus 5.5 | 57.1% [14.3%, 85.7%] | 4 / 7 | 7 | 0 | $1.45 [$0.39, $5.58] | 309 | 1430 | n/a | n/a |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +3.6 [-21.4, +28.6] | 14 | 2 / 10 / 2 | 1.13x [0.47x, 2.79x] | no measurable difference | +37.3 |
| Fable 5.2 minus Opus 5.5 | +0.0 [+0.0, +0.0] | 7 | 0 / 7 / 0 | 2.89x [2.00x, 4.74x] | no measurable difference | n/a |
| Fable 5.1 minus Opus 5.5 (descriptive) | +0.0 [-42.9, +42.9] | 7 | 1 / 5 / 1 | 2.17x [0.86x, 5.96x] | no measurable difference | +61.1 |

- Fable 5.2 lower than Fable 5.1 on: pytorch-model-cli, query-optimize. Higher on: mteb-retrieve, sanitize-git-repo.
- Fable 5.2 lower than Opus 5.5 on: none. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: sanitize-git-repo. Higher on: query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":3,"completed":18}; Fable 5.1 {"completed":19,"timeout":2}; Opus 5.5 {"completed":6,"timeout":1}
