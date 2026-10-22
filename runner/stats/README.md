# Statistics kit

Vendored from [gbrain-evals](https://github.com/garrytan/gbrain-evals) v0.10.128 (`6999ebc9`), `eval/runner/stats/`, MIT. Unchanged apart from the import paths in the tests.

- `gates.ts`: a preregistered comparison family with four gate kinds. `exact` is a correctness or safety assertion that one violating item fails. `noninferiority` passes only when the candidate is shown to be no worse than the baseline by more than a stated tolerance. `superiority` passes only when it is shown to beat the baseline by more than a preregistered minimum effect. `exploratory` is reported with intervals and never decides. Holm correction covers the confirmatory comparisons.
- `paired.ts`: paired observations, a cluster-aware bootstrap (a resampled cluster carries every item inside it), exact McNemar, one-sided p-values and a power note.
- `rows.ts`: row to observation mapping and eligibility.
- `exact.ts`, `fixed-sequence.ts`: helpers.

In this repository the cluster is the task: five trials of one task are one cluster, and across-task claims use task-clustered intervals (plan contract item 10).
