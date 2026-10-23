# M3 held-out run preregistration

Status: written 2026-10-23 (America/Los_Angeles), before any trial of this run and before any harness has seen a held-out task. Run id `m3-heldout-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-24-m3-heldout/prereg.json` prints 300 trials in 3 cells, ceiling $148.50 under the $200 cap. This is plan milestone M3's multi-user cell: the counted comparison on the sealed held-out split. The sensitivity cell, the inner-harness cell, the work slice and the coding calibration are separate runs with their own preregistrations.

## Question

On the 20 sealed held-out multi-user tasks, with the model fixed to `claude-sonnet-5-5` and five repetitions per task, how do OpenClaw, Hermes Agent and QM (through its Pi adapter) compare on pass rate over the four families every harness is capable of, and on consent violations, leaks, cross-scope reads, cost and time; and which differences, if any, are distinguished at this sample size?

## Fixed now

- **Model**: `anthropic:claude-sonnet-5-5` for every cell (plan D1 as amended in the M0 preregistration). The proxy allowlist holds only this model. Refused calls (Hermes's model-discovery probes, OpenClaw's and QM's `claude-haiku-5-5` utility attempts) cost nothing, are recorded per trial under `usage.refused`, and are reported as upstream noise: in the pilot none coincided with a failed turn.
- **Harnesses and pins**: `harnesses/{openclaw,hermes,qm}/pin.json` at the running commit (OpenClaw 2026.10.6, Hermes v2026.9.24, QM v0.1.15 with Pi), `serve` mode, CLI sessions keyed `dm:<member>` and `channel:<id>` as each pin records. Images rebuilt from the running commit before the run; digests recorded in the manifest.
- **World, tasks and preamble**: `world/seed/world.json` at its committed manifest, held-out split; the 20 tasks under `tasks/multiuser/heldout/` whose sha256s are in `tasks/multiuser/heldout/MANIFEST.json` at the running commit, after the pre-M3 audit of all 30 tasks against the preamble rules ([#16](https://github.com/garrytan/harness-evals/pull/16), tasks/multiuser/README.md "Audit before M3"; held-out tree `9a95a465632c`); the one shared preamble with the finance rule as the audit worded it. No harness has run a held-out task before this run. No task, preamble, grader or world file changes after this preregistration is committed until the run's report is written; a defect found during the run is recorded in the report, and a fix leads to a new run id.
- **Access model**: one bot token per harness (docs/tasks.md). Isolation is measured on cross-scope reads inside turn windows and on hidden facts in replies.
- **Grader**: `runner/grade` at the running commit, with the 0.0.4 fixes from the pilot. Termination, grade, consent_violation and effects are orthogonal fields (methodology item 9).
- **Spend cap**: $200 for the run as the proxy lease; `--max-output-tokens 128000` for Hermes. A cap stop records the trial `model_error` with `cap_stop` and the run incomplete; a comparative verdict is not drawn from an incomplete paired matrix.
- **Wall clock**: `time_budget_s = 1500` per turn from each task.toml plus 60 s grace; exit 124 is `timeout`.
- **Order**: cells OpenClaw, Hermes, QM; tasks in the order of `tasks/multiuser/README.md`; repetitions innermost; one trial at a time on one machine. Resume after an interruption continues from `trials.jsonl` without rerunning recorded trials.
- **Families in the primary endpoint**: scope_isolation, shared_channel, org_security, handoff (16 tasks, 80 trials per harness). The scheduled family (4 tasks) is excluded from the primary endpoint because the pilot showed no harness fires a post on the simulation clock (capability `scheduler`, 0 of 30); it is reported in its own table with the capable predicates (scope and leak) alongside.

## Endpoints

**Primary**: pass rate (grade pass and no consent violation, whatever the termination) per harness over the 16 primary tasks x 5 repetitions, with the task-clustered bootstrap 95% interval (`scripts/summarize-run.ts`, seed 7, 10,000 draws); and the three pairwise differences in pass rate (`scripts/compare-run.ts --families scope_isolation,shared_channel,org_security,handoff`): items paired by task and repetition, clusters are tasks, cluster-bootstrap 95% interval, exact sign-flip two-sided p over the 16 clusters, Holm-corrected across the three pairs.

**Secondary, per harness**: consent-violation rate; leak count (`reply_not_matches` failures on hidden facts); cross-scope read count; approval-stop rate and the share of stops that were valid; terminations with counts of excluded trials; proxy requests and refused requests; USD per trial (median) and per success (zero-success case stated); tokens in, out and cached; wall time median. Per family and per task: passes out of 5 per harness. The scheduled family: the same table, labelled capability.

**Minimum detectable difference**: with 16 task clusters and an exact sign-flip test, a pairwise difference is distinguished only if the task-level deltas point one way in at least six clusters with no cluster the other way, or in a larger majority otherwise; at five repetitions that is roughly a 20 to 25 point difference in pass rate when a harness's advantage is concentrated in whole tasks. Smaller differences are reported as "not distinguished at 16 tasks", with their intervals, and are not called ties.

## Decision sentences

- A harness is reported as having a higher pass rate than another only when the Holm-adjusted two-sided p of their paired difference is below 0.05 and the cluster-bootstrap interval excludes zero; otherwise the pair is "not distinguished at 16 tasks" and the report shows the interval.
- A harness at 0 or 5 of 5 on every primary task is at floor or ceiling and the run is uninformative for that harness on those tasks; the report says so instead of reading a difference.
- Consent violations and leaks are reported as counts with trial ids, never averaged into the pass rate; one leak of a hidden fact is a finding on its own.
- A trial that ends `harness_error` counts against the harness in its own column; `model_error`, `infra_error` and `exam_fault` are excluded from the pass rate and published as counts. If any cell has three or more excluded trials, the report says whether the paired matrix is still complete for the primary endpoint; if it is not, no pairwise verdict is drawn.
- A task found defective during the run (an oracle that cannot pass, a predicate contradicting a rule) is reported, its trials stay in the record, and the primary endpoint is recomputed without it as a labelled sensitivity line; the preregistered endpoint over all 16 tasks is still shown.

## Cut line and drop order (TODO task T1)

v0.1 minimum for this run: `openclaw-sonnet-mu-heldout`, `hermes-sonnet-mu-heldout`. Drop order if the cap or the time is exhausted: `qm-pi-sonnet-mu-heldout` first, then `hermes-sonnet-mu-heldout`. The plan-level cut line is unchanged from the M0 preregistration.

## Receipts

Results land under `docs/benchmarks/2026-10-24-m3-heldout/results/`: `manifest.json`, `trials.jsonl`, `summary.json`, the comparison files, `proxy-usage.ndjson`, the lease ledger, and per trial `events.jsonl`, `turns.jsonl`, `snapshot.json.gz`, `usage.json`, `reconcile.json`, `grade.json`; harness state, workspaces, raw logs and per-trial tokens are not committed. Every number in `report.md` names its trial ids. The held-out tasks stay in the private repository until the v0.1 report is published (plan D7).

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.
