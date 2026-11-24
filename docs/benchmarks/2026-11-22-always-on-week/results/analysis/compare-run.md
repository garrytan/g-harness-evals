Scope: all families; grading as recorded; seed 7, 10000 draws.

| A | B | Pass A | Pass B | B minus A (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs |
|---|---|---|---|---|---|---|---|---|
| cc-opus-bare-week | cc-opus-files-week | 0% | 15% | +15 [+0, +33] | 0.250 (exact-sign-flip) | 0.500 | 10 | 40 |
| cc-opus-bare-week | cc-opus-gbrain-week | 0% | 28% | +28 [+10, +48] | 0.063 (exact-sign-flip) | 0.188 | 10 | 40 |
| cc-opus-bare-week | qm-opus-native-week | 0% | 0% | +0 [+0, +0] | 1.000 (degenerate) | 1.000 | 10 | 40 |

Excluded pairs (model_error, infra_error or exam_fault on either side, or missing on either side): cc-opus-files-week vs cc-opus-bare-week: 0; cc-opus-gbrain-week vs cc-opus-bare-week: 0; qm-opus-native-week vs cc-opus-bare-week: 0.

Cost, cache and tasks on the same pairs (B against A; intervals task-clustered, same seed and draws; ratios are B over A):

| A | B | Pass half-width (points) | USD per trial A, B | B minus A USD [95% CI] | Cost per trial ratio [95% CI] | Cost per success A, B | Cost per success ratio [95% CI] | Cached share A, B | B minus A (points) [95% CI] | Broken | Fixed | Cost pairs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cc-opus-bare-week | cc-opus-files-week | 16.3 | $1.4568, $1.7497 | +$0.2928 [+$0.0815, +$0.4551] | 1.20 [1.05, 1.32] | n/a, $11.6645 | n/a [n/a] | 95%, 95% | -0 [-1, -0] | 0 | 1 | 40 |
| cc-opus-bare-week | cc-opus-gbrain-week | 18.8 | $1.4568, $1.9541 | +$0.4973 [+$0.2889, +$0.6576] | 1.34 [1.18, 1.47] | n/a, $7.1059 | n/a [n/a] | 95%, 94% | -2 [-2, -2] | 0 | 2 | 40 |
| cc-opus-bare-week | qm-opus-native-week | 0.0 | $1.4568, $1.1406 | -$0.3162 [-$0.4808, -$0.1831] | 0.78 [0.70, 0.86] | n/a, n/a | n/a [n/a] | 95%, 91% | -5 [-5, -5] | 0 | 0 | 40 |

Caching repricing per baseline cell (every input token at the plain input rate, over actual cost; cache-read share by gap since the previous request):

| Cell | Trials | Excluded | Actual USD per trial | Repriced USD per trial | Repriced over actual [95% CI] | Cache-read share by gap |
|---|---|---|---|---|---|---|
| cc-opus-bare-week | 40 | 0 | $1.4568 | $10.3790 | 7.12 [6.55, 7.58] | first request: 93% of 718,716 (40 requests); gap <= 300 s: 95% of 98,953,140 (3757 requests); gap > 300 s: n/a of 0 (0 requests) |
