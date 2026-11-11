# Model comparison (subset of 14 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 57.1% [28.6%, 78.6%] | 16 / 28 | 14 | 0 | $3.74 [$1.54, $8.97] | 381 | 2179 | 0.0% | 57.1% |
| Fable 5.1 | 57.1% [35.7%, 78.6%] | 16 / 28 | 14 | 0 | $3.37 [$1.37, $7.93] | 404 | 1583 | 28.6% | 42.9% |
| Opus 5.5 | 82.1% [64.3%, 96.4%] | 23 / 28 | 14 | 0 | $0.82 [$0.36, $1.64] | 325 | 1321 | 21.4% | 71.4% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +0.0 [-25.0, +25.0] | 14 | 3 / 8 / 3 | 1.11x [0.67x, 2.07x] | no measurable difference | +36.0 |
| Fable 5.2 minus Opus 5.5 | -25.0 [-46.4, -7.1] | 14 | 5 / 9 / 0 | 4.56x [2.81x, 8.76x] | lower | +28.4 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -25.0 [-46.4, -3.6] | 14 | 6 / 7 / 1 | 4.11x [2.59x, 7.44x] | lower | +32.0 |

- Fable 5.2 lower than Fable 5.1 on: pytorch-model-cli, query-optimize, video-processing. Higher on: install-windows-3.11, mteb-retrieve, sanitize-git-repo.
- Fable 5.2 lower than Opus 5.5 on: configure-git-webserver, filter-js-from-html, pytorch-model-cli, query-optimize, video-processing. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: configure-git-webserver, filter-js-from-html, install-windows-3.11, mteb-retrieve, pytorch-model-cli, sanitize-git-repo. Higher on: query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":4,"completed":24}; Fable 5.1 {"completed":25,"timeout":3}; Opus 5.5 {"completed":26,"timeout":2}
