# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 77.9% [66.3%, 88.5%] | 60 / 78 | 52 | 0 | $1.82 [$1.16, $2.72] | 341 | 1509 | 3.8% | 73.1% |
| Fable 5.1 | 67.3% [54.8%, 78.8%] | 52 / 77 | 52 | 1 | $2.60 [$1.71, $3.75] | 395 | 1583 | 16.0% | 60.0% |
| Opus 5.5 | 79.2% [62.5%, 95.8%] | 19 / 24 | 24 | 2 | $0.54 [$0.27, $1.05] | 189 | 1005 | n/a | n/a |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +10.6 [-1.9, +23.1] | 52 | 5 / 36 / 11 | 0.70x [0.48x, 1.03x] | no measurable difference | +18.6 |
| Fable 5.2 minus Opus 5.5 | -6.3 [-16.7, +0.0] | 24 | 2 / 22 / 0 | 2.92x [2.20x, 4.01x] | no measurable difference | +12.8 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -8.3 [-25.0, +8.3] | 24 | 3 / 20 / 1 | 3.08x [2.25x, 4.60x] | no measurable difference | +23.3 |

- Fable 5.2 lower than Fable 5.1 on: feal-differential-cryptanalysis, feal-linear-cryptanalysis, overfull-hbox, pytorch-model-cli, query-optimize. Higher on: caffe-cifar-10, chess-best-move, compile-compcert, extract-moves-from-video, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: feal-differential-cryptanalysis, feal-linear-cryptanalysis. Higher on: none.
- Fable 5.1 lower than Opus 5.5 on: compile-compcert, raman-fitting, sanitize-git-repo. Higher on: query-optimize.

- Terminations per arm: Fable 5.2 {"timeout":6,"completed":65,"harness_error":7}; Fable 5.1 {"completed":62,"harness_error":8,"timeout":7,"infra_error":1}; Opus 5.5 {"completed":21,"harness_error":2,"model_error":2,"timeout":1}
