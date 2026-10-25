# Re-reading of five OpenClaw trials under the preregistered classification rule

This directory is a labelled second reading of `../trials.jsonl`, not a replacement for it. The last 65 trials of `openclaw-haiku-company-scoped-mu-heldout` were recorded by a runner at `e278fb0` instead of the preregistered `6b67de1` (see "A deviation from the preregistration" in [../../report.md](../../report.md)). The one rule that differed labels a trial `model_error` when a refused proxy line names a model other than the cell's; at `6b67de1` the same refusal was counted in `usage.refused` and the trial's termination came from its turns and its grade. Five trials were affected.

`trials.jsonl` here is `../trials.jsonl` with exactly one field changed in each of these five records, `termination`, set to what the `6b67de1` runner's `classify` would have set from the record's own turns (every turn exited 0) and grade:

| Trial | Recorded termination | Here |
|---|---|---|
| `openclaw-haiku-company-scoped-mu-heldout/os-06-driftmoor-rate-channel/r1` | model_error | approval_stop (the grade's approval_stop is true) |
| `openclaw-haiku-company-scoped-mu-heldout/sd-03-coastal-week-ahead/r5` | model_error | completed |
| `openclaw-haiku-company-scoped-mu-heldout/sd-04-strategic-brief/r1` | model_error | completed |
| `openclaw-haiku-company-scoped-mu-heldout/sd-05-kwame-dm-digest/r4` | model_error | completed |
| `openclaw-haiku-company-scoped-mu-heldout/sd-06-pod-end-of-day/r3` | model_error | completed |

Grades, predicates, usage and every other field are untouched (`../regrade-6b67de1.jsonl` shows the grades are the preregistered grader's). `manifest.json` is a copy of `../manifest.json`. `summary.json`, `comparisons.gbrain.json` and `comparisons.json` are `scripts/summarize-run.ts`, `scripts/compare-run.ts --pair gbrain` and `scripts/compare-run.ts` run over this directory with the same seed and draws as the as-recorded files. The report quotes this reading as the cell's primary one and the as-recorded one beside it.
