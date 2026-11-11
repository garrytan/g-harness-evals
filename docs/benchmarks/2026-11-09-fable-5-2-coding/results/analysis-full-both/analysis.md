# Model comparison (subset of 49 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 77.6% [65.3%, 87.8%] | 76 / 98 | 49 | 0 | $1.77 [$1.17, $2.56] | 372 | 1691 | 4.1% | 75.5% |
| Fable 5.1 | 73.5% [62.2%, 83.7%] | 72 / 98 | 49 | 0 | $2.15 [$1.43, $3.08] | 367 | 1381 | 20.4% | 63.3% |
| Opus 5.5 | 88.8% [80.6%, 95.9%] | 87 / 98 | 49 | 0 | $0.54 [$0.36, $0.77] | 277 | 1321 | 6.1% | 85.7% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +4.1 [-7.1, +15.3] | 49 | 7 / 32 / 10 | 0.83x [0.65x, 1.04x] | no measurable difference | +16.3 |
| Fable 5.2 minus Opus 5.5 | -11.2 [-19.4, -4.1] | 49 | 8 / 41 / 0 | 3.26x [2.60x, 4.12x] | lower | +11.0 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -15.3 [-25.5, -6.1] | 49 | 13 / 34 / 2 | 3.95x [3.29x, 4.82x] | lower | +13.7 |

- Fable 5.2 lower than Fable 5.1 on: dna-insert, feal-differential-cryptanalysis, feal-linear-cryptanalysis, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: caffe-cifar-10, chess-best-move, compile-compcert, install-windows-3.11, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: configure-git-webserver, feal-differential-cryptanalysis, feal-linear-cryptanalysis, filter-js-from-html, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, chess-best-move, compile-compcert, configure-git-webserver, filter-js-from-html, install-windows-3.11, mteb-retrieve, pytorch-model-cli, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, write-compressor. Higher on: dna-insert, query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":9,"completed":81,"harness_error":8}; Fable 5.1 {"completed":83,"harness_error":8,"timeout":7}; Opus 5.5 {"completed":89,"harness_error":6,"timeout":3}
