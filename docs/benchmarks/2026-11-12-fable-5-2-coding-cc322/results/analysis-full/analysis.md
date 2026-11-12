# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 82.7% [73.1%, 91.3%] | 86 / 104 | 52 | 0 | $1.83 [$1.19, $2.65] | 344 | 1870 | 7.7% | 78.8% |
| Fable 5.1 | 75.0% [64.4%, 84.6%] | 78 / 104 | 52 | 0 | $2.56 [$1.47, $4.18] | 369 | 1707 | 15.4% | 67.3% |
| Opus 5.5 | 84.6% [75.0%, 93.3%] | 88 / 104 | 52 | 0 | $0.65 [$0.41, $0.97] | 270 | 1649 | 7.7% | 80.8% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +7.7 [-3.8, +19.2] | 52 | 6 / 35 / 11 | 0.72x [0.48x, 1.09x] | no measurable difference | +16.5 |
| Fable 5.2 minus Opus 5.5 | -1.9 [-9.6, +5.8] | 52 | 5 / 43 / 4 | 2.80x [2.05x, 3.99x] | no measurable difference | +11.5 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -9.6 [-20.2, +1.0] | 52 | 11 / 38 / 3 | 3.91x [3.14x, 4.82x] | no measurable difference | +14.9 |

- Fable 5.2 lower than Fable 5.1 on: dna-insert, feal-differential-cryptanalysis, feal-linear-cryptanalysis, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: caffe-cifar-10, configure-git-webserver, extract-moves-from-video, gcode-to-text, mteb-retrieve, query-optimize, raman-fitting, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: feal-differential-cryptanalysis, filter-js-from-html, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: extract-moves-from-video, feal-linear-cryptanalysis, install-windows-3.11, raman-fitting.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, configure-git-webserver, filter-js-from-html, gcode-to-text, mteb-retrieve, pytorch-model-cli, query-optimize, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor. Higher on: dna-insert, feal-linear-cryptanalysis, install-windows-3.11.

- Terminations per arm: Fable 5.2 {"timeout":12,"completed":85,"harness_error":7}; Fable 5.1 {"completed":87,"harness_error":7,"timeout":10}; Opus 5.5 {"completed":92,"harness_error":6,"timeout":6}
