# Model comparison (subset of 14 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 75.0% [53.6%, 92.9%] | 21 / 28 | 14 | 0 | $2.92 [$1.05, $6.60] | 357 | 2217 | 7.1% | 71.4% |
| Fable 5.1 | 57.1% [35.7%, 78.6%] | 16 / 28 | 14 | 0 | $3.04 [$1.33, $6.78] | 438 | 1137 | 28.6% | 42.9% |
| Opus 5.5 | 82.1% [64.3%, 96.4%] | 23 / 28 | 14 | 0 | $0.70 [$0.28, $1.53] | 314 | 1166 | 21.4% | 71.4% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +17.9 [+0.0, +39.3] | 14 | 1 / 9 / 4 | 0.96x [0.56x, 1.41x] | no measurable difference | +31.5 |
| Fable 5.2 minus Opus 5.5 | -7.1 [-25.0, +7.1] | 14 | 2 / 11 / 1 | 4.15x [2.48x, 7.21x] | no measurable difference | +24.8 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -25.0 [-46.4, -3.6] | 14 | 6 / 7 / 1 | 4.32x [3.00x, 7.17x] | lower | +32.0 |

- Fable 5.2 lower than Fable 5.1 on: pytorch-model-cli. Higher on: configure-git-webserver, mteb-retrieve, query-optimize, sanitize-git-repo.
- Fable 5.2 lower than Opus 5.5 on: filter-js-from-html, pytorch-model-cli. Higher on: install-windows-3.11.
- Fable 5.1 lower than Opus 5.5 on: configure-git-webserver, filter-js-from-html, mteb-retrieve, pytorch-model-cli, query-optimize, sanitize-git-repo. Higher on: install-windows-3.11.

- Terminations per arm: Fable 5.2 {"timeout":4,"completed":24}; Fable 5.1 {"completed":26,"timeout":2}; Opus 5.5 {"completed":26,"timeout":2}
