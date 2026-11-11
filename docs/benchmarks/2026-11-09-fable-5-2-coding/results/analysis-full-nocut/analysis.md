# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 78.8% [67.3%, 88.5%] | 82 / 104 | 52 | 0 | $1.87 [$1.26, $2.65] | 381 | 1915 | 3.8% | 76.9% |
| Fable 5.1 | 71.2% [60.6%, 81.7%] | 74 / 103 | 52 | 1 | $2.18 [$1.55, $3.01] | 373 | 1583 | 19.6% | 62.7% |
| Opus 5.5 | 89.4% [80.8%, 96.2%] | 91 / 102 | 52 | 2 | $0.61 [$0.41, $0.86] | 292 | 1430 | 6.0% | 86.0% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +7.7 [-3.8, +19.2] | 52 | 7 / 33 / 12 | 0.86x [0.69x, 1.05x] | no measurable difference | +16.9 |
| Fable 5.2 minus Opus 5.5 | -10.6 [-18.3, -3.8] | 52 | 8 / 44 / 0 | 3.06x [2.49x, 3.80x] | lower | +10.4 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -18.3 [-28.8, -8.7] | 52 | 15 / 35 / 2 | 3.57x [2.99x, 4.43x] | lower | +14.4 |

- Fable 5.2 lower than Fable 5.1 on: dna-insert, feal-differential-cryptanalysis, feal-linear-cryptanalysis, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: caffe-cifar-10, chess-best-move, compile-compcert, extract-moves-from-video, install-windows-3.11, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: configure-git-webserver, feal-differential-cryptanalysis, feal-linear-cryptanalysis, filter-js-from-html, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, chess-best-move, compile-compcert, configure-git-webserver, extract-moves-from-video, filter-js-from-html, install-windows-3.11, mteb-retrieve, pytorch-model-cli, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor. Higher on: dna-insert, query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":9,"completed":87,"harness_error":8}; Fable 5.1 {"completed":85,"harness_error":9,"timeout":9,"infra_error":1}; Opus 5.5 {"completed":93,"harness_error":6,"model_error":2,"timeout":3}
