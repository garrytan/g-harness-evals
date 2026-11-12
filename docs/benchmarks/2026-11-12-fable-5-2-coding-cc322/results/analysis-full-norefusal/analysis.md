# Model comparison

Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).

| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |
|---|---|---|---|---|---|---|---|---|---|
| Fable 5.2 | 87.8% [78.6%, 94.9%] | 86 / 98 | 49 | 0 | $1.83 [$1.18, $2.69] | 363 | 1920 | 8.2% | 83.7% |
| Fable 5.1 | 79.0% [68.0%, 88.0%] | 78 / 99 | 50 | 0 | $2.54 [$1.46, $4.14] | 400 | 1948 | 14.3% | 71.4% |
| Opus 5.5 | 89.8% [81.6%, 96.9%] | 88 / 98 | 49 | 0 | $0.65 [$0.41, $0.98] | 279 | 1989 | 8.2% | 85.7% |

| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |
|---|---|---|---|---|---|---|
| Fable 5.2 minus Fable 5.1 | +9.2 [-2.0, +20.4] | 49 | 5 / 34 / 10 | 0.70x [0.47x, 1.07x] | no measurable difference | +16.2 |
| Fable 5.2 minus Opus 5.5 | -2.0 [-10.2, +6.1] | 49 | 5 / 40 / 4 | 2.81x [2.06x, 3.96x] | no measurable difference | +12.2 |
| Fable 5.1 minus Opus 5.5 (descriptive) | -11.2 [-21.4, -2.0] | 49 | 10 / 37 / 2 | 3.99x [3.22x, 4.92x] | lower | +14.3 |

- Fable 5.2 lower than Fable 5.1 on: feal-differential-cryptanalysis, feal-linear-cryptanalysis, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: caffe-cifar-10, configure-git-webserver, extract-moves-from-video, mteb-retrieve, query-optimize, raman-fitting, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor.
- Fable 5.2 lower than Opus 5.5 on: feal-differential-cryptanalysis, filter-js-from-html, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Higher on: extract-moves-from-video, feal-linear-cryptanalysis, install-windows-3.11, raman-fitting.
- Fable 5.1 lower than Opus 5.5 on: caffe-cifar-10, configure-git-webserver, filter-js-from-html, mteb-retrieve, pytorch-model-cli, query-optimize, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor. Higher on: feal-linear-cryptanalysis, install-windows-3.11.

- Terminations per arm: Fable 5.2 {"timeout":12,"completed":85,"harness_error":1}; Fable 5.1 {"completed":87,"harness_error":2,"timeout":10}; Opus 5.5 {"completed":92,"timeout":6}
