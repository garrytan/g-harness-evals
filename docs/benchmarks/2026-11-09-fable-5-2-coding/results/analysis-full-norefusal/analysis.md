# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 83.7% [73.5%, 92.9%] | 82 / 98 | 49 | 0 | $2.04 [$1.29, $3.02] | 401 | 1923 | 4.1% | 81.6% |
| Fable 5.1 | 75.0% [64.0%, 85.0%] | 74 / 98 | 50 | 1 | $2.27 [$1.55, $3.21] | 404 | 1765 | 18.8% | 66.7% |
| Opus 5.5 | 94.9% [88.8%, 99.0%] | 91 / 96 | 49 | 2 | $0.61 [$0.41, $0.86] | 309 | 1511 | 6.4% | 91.5% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +9.2 [-3.1, +21.4] | 49 | 6 / 31 / 12 | 0.89x [0.66x, 1.18x] | no measurable difference | +17.7 |
| Fable 5.2 minus Opus 5.5 | -11.2 [-19.4, -4.1] | 49 | 8 / 41 / 0 | 3.35x [2.64x, 4.21x] | lower | +11.0 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -20.4 [-30.6, -10.2] | 49 | 15 / 33 / 1 | 3.77x [3.15x, 4.58x] | lower | +14.7 |

- Fable 5.2 lower than Fable 5.1 on: feal-differential-cryptanalysis, feal-linear-cryptanalysis, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: caffe-cifar-10, chess-best-move, compile-compcert, extract-moves-from-video, install-windows-3.11, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: configure-git-webserver, feal-differential-cryptanalysis, feal-linear-cryptanalysis, filter-js-from-html, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, chess-best-move, compile-compcert, configure-git-webserver, extract-moves-from-video, filter-js-from-html, install-windows-3.11, mteb-retrieve, pytorch-model-cli, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor. Higher on: query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":9,"completed":87,"harness_error":2}; Fable 5.1 {"completed":85,"harness_error":4,"timeout":9,"infra_error":1}; Opus 5.5 {"completed":93,"model_error":2,"timeout":3}
