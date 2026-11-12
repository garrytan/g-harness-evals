# Model comparison (subset of 50 tasks)

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 85.0% [75.0%, 94.0%] | 85 / 100 | 50 | 0 | $1.85 [$1.19, $2.70] | 357 | 1920 | 6.0% | 82.0% |
| Fable 5.1 | 74.0% [63.0%, 84.0%] | 74 / 100 | 50 | 0 | $2.66 [$1.53, $4.43] | 400 | 1948 | 16.0% | 66.0% |
| Opus 5.5 | 86.0% [77.0%, 94.0%] | 86 / 100 | 50 | 0 | $0.67 [$0.41, $0.99] | 279 | 1989 | 8.0% | 82.0% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +11.0 [+0.0, +22.0] | 50 | 4 / 35 / 11 | 0.69x [0.47x, 1.06x] | no measurable difference | +15.6 |
| Fable 5.2 minus Opus 5.5 | -1.0 [-8.0, +6.0] | 50 | 4 / 43 / 3 | 2.78x [2.05x, 3.93x] | no measurable difference | +10.2 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -12.0 [-22.0, -3.0] | 50 | 11 / 37 / 2 | 4.01x [3.23x, 4.96x] | lower | +14.2 |

- Fable 5.2 lower than Fable 5.1 on: dna-insert, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: caffe-cifar-10, configure-git-webserver, extract-moves-from-video, gcode-to-text, mteb-retrieve, query-optimize, raman-fitting, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: filter-js-from-html, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: extract-moves-from-video, install-windows-3.11, raman-fitting.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, configure-git-webserver, filter-js-from-html, gcode-to-text, mteb-retrieve, pytorch-model-cli, query-optimize, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor. Higher on: dna-insert, install-windows-3.11.

- Terminations per arm: Fable 5.2 {"timeout":12,"completed":82,"harness_error":6}; Fable 5.1 {"completed":83,"harness_error":7,"timeout":10}; Opus 5.5 {"completed":88,"harness_error":6,"timeout":6}
