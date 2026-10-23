# M3 sensitivity cell preregistration: a weaker model

Status: written 2026-10-23 (America/Los_Angeles), before any trial of this run. Run id `m3-sensitivity-haiku-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-24-m3-sensitivity-haiku/prereg.json` prints 300 trials in 3 cells under the $50 cap. This is the plan's model-sensitivity cell on the multi-user slice, with one deliberate change recorded here.

## Amendment to the plan's sensitivity cell

Plan v2 described the sensitivity cell as a frontier model. The held-out run on `claude-sonnet-5-5` ([../2026-10-24-m3-heldout/report.md](../2026-10-24-m3-heldout/report.md)) ended at ceiling: 13 of 16 primary tasks were 5 of 5 for all three harnesses and no pair was distinguished. A stronger model would move the matrix further into the ceiling and tell us nothing about the harnesses. This cell therefore uses a weaker model, `claude-haiku-5-5`, on the same held-out tasks: if harness scaffolding matters, it should matter more when the model has less to give. Garry approved the recommendation on 2026-10-23 ("Continue"). The frontier-model cell is not run in v0.1.

## Question

On the same 20 held-out multi-user tasks, with the model fixed to the weaker `claude-haiku-5-5`, do differences between OpenClaw, Hermes Agent and QM (via Pi) appear that the Sonnet run could not show, and does each harness's cost and time ordering hold?

## Fixed now

Everything as in the held-out preregistration except the model: same 20 tasks (held-out tree `9a95a465632c`), preamble, grader, pins, images (rebuilt from the running commit), serve mode, one bot token, order, resume rules, 1500 s per turn, one machine. Model `anthropic:claude-haiku-5-5` for every cell, the only model on the proxy allowlist; a consequence is that OpenClaw's and QM's own `claude-haiku-5-5` utility calls are now allowed and priced into the trial, so their request and token counts are not comparable one for one with the Sonnet run, and the report says so. Hermes's model-discovery probes stay refused. Spend cap $50 as the lease; `--max-output-tokens 128000`. A three-trial smoke on one dev task with Haiku passed for all three harnesses before this preregistration ($0.02 in total, scratch ledger, not counted).

Primary families and endpoints as in the held-out preregistration: pass rate over the 16 capable tasks with task-clustered intervals; three pairwise differences with exact sign-flip p and Holm correction; the scheduled family in its capability table; secondary endpoints unchanged. One added comparison: for each harness, the paired difference between its Haiku and its Sonnet cell on the same tasks and repetition indices (the model effect within a harness), with the same statistics; this is descriptive and not part of the decision sentences.

## Decision sentences

As in the held-out preregistration: a pair is reported as different only when the Holm-adjusted two-sided p is below 0.05 and the cluster-bootstrap interval excludes zero; otherwise "not distinguished at 16 tasks". Ceiling and floor sentences apply: a harness at 0 or 5 of 5 on every primary task is uninformative. Consent violations and leaks are counts with trial ids. Excluded trials are published; no pairwise verdict from an incomplete matrix. A defective task is reported and the endpoint recomputed without it as a labelled line.

## Cut line and drop order

v0.1 minimum: `openclaw-haiku-mu-heldout`, `hermes-haiku-mu-heldout`. Drop order: `qm-pi-haiku-mu-heldout`, then `hermes-haiku-mu-heldout`.

## Receipts

As in the held-out run, under `docs/benchmarks/2026-10-24-m3-sensitivity-haiku/results/`.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.
