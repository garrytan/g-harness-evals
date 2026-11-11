# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 76.9% [61.5%, 92.3%] | 20 / 26 | 26 | 0 | $1.31 [$0.70, $2.27] | 290 | 1070 | n/a | n/a |
| Fable 5.1 | 69.2% [50.0%, 84.6%] | 18 / 26 | 26 | 0 | $1.64 [$0.96, $2.88] | 386 | 1110 | n/a | n/a |
| Opus 5.5 | 79.2% [62.5%, 95.8%] | 19 / 24 | 24 | 2 | $0.54 [$0.27, $1.05] | 189 | 1005 | n/a | n/a |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +7.7 [-11.5, +26.9] | 26 | 2 / 20 / 4 | 0.80x [0.51x, 1.25x] | no measurable difference | +26.6 |
| Fable 5.2 minus Opus 5.5 | -4.2 [-12.5, +0.0] | 24 | 1 / 23 / 0 | 2.66x [2.07x, 3.58x] | no measurable difference | +11.7 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -8.3 [-25.0, +8.3] | 24 | 3 / 20 / 1 | 3.08x [2.25x, 4.60x] | no measurable difference | +23.3 |

- Fable 5.2 lower than Fable 5.1 on: feal-differential-cryptanalysis, query-optimize. Higher on: compile-compcert, extract-moves-from-video, raman-fitting, sanitize-git-repo.
- Fable 5.2 lower than Opus 5.5 on: feal-differential-cryptanalysis. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: compile-compcert, raman-fitting, sanitize-git-repo. Higher on: query-optimize.

- Terminations per arm: Fable 5.2 {"completed":22,"harness_error":3,"timeout":1}; Fable 5.1 {"completed":21,"harness_error":2,"timeout":3}; Opus 5.5 {"completed":21,"harness_error":2,"model_error":2,"timeout":1}
