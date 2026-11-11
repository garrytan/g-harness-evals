# Model comparison (subset of 50 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 81.0% [70.0%, 91.0%] | 81 / 100 | 50 | 0 | $2.06 [$1.31, $3.04] | 400 | 1923 | 2.0% | 80.0% |
| Fable 5.1 | 70.0% [58.0%, 81.0%] | 70 / 99 | 50 | 1 | $2.39 [$1.64, $3.40] | 386 | 1765 | 20.4% | 61.2% |
| Opus 5.5 | 89.0% [80.0%, 96.0%] | 87 / 98 | 50 | 2 | $0.63 [$0.43, $0.89] | 307 | 1511 | 6.3% | 85.4% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +11.0 [+0.0, +22.0] | 50 | 5 / 33 / 12 | 0.86x [0.65x, 1.14x] | no measurable difference | +16.2 |
| Fable 5.2 minus Opus 5.5 | -8.0 [-15.0, -2.0] | 50 | 6 / 44 / 0 | 3.26x [2.55x, 4.10x] | lower | +9.3 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -19.0 [-30.0, -9.0] | 50 | 15 / 33 / 2 | 3.78x [3.13x, 4.64x] | lower | +14.9 |

- Fable 5.2 lower than Fable 5.1 on: dna-insert, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: caffe-cifar-10, chess-best-move, compile-compcert, extract-moves-from-video, install-windows-3.11, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: configure-git-webserver, filter-js-from-html, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, chess-best-move, compile-compcert, configure-git-webserver, extract-moves-from-video, filter-js-from-html, install-windows-3.11, mteb-retrieve, pytorch-model-cli, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor. Higher on: dna-insert, query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":9,"completed":85,"harness_error":6}; Fable 5.1 {"completed":81,"harness_error":9,"timeout":9,"infra_error":1}; Opus 5.5 {"completed":89,"harness_error":6,"model_error":2,"timeout":3}
