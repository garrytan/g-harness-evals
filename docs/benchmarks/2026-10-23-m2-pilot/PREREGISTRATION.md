# M2 pilot preregistration

Status: written 2026-10-22 (America/Los_Angeles), before any trial of this run. Run id `m2-pilot-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-23-m2-pilot/prereg.json` prints 150 trials in 3 cells, ceiling $72.60 under the $150 cap. This is plan milestone M2: a pilot on the public dev split whose purpose is to find adapter, task and grader defects and to measure cost and wall time before the counted held-out run (M3). Its numbers are pilot numbers and will be labelled so; they gate nothing about the harnesses.

## Question

On the 10 public dev tasks of the multi-user slice, with the model fixed to `claude-sonnet-5-5` and five repetitions per task, what pass rate, consent-violation rate, approval-stop rate, cross-scope read count, cost and wall time does each of OpenClaw, Hermes Agent and QM (through its Pi adapter) show, and which defects does the pilot expose?

## Fixed now

- **Model**: `anthropic:claude-sonnet-5-5` for every cell (plan D1 as amended in the M0 preregistration). No other model is allowed at the proxy. Utility-model calls a harness makes on its own (OpenClaw and QM each try one `claude-haiku-5-5` call per turn; Hermes probes about a dozen model ids at start) are refused with 403 by the allowlist, cost nothing, and are recorded in each trial's `usage.json` under `refused`. A turn that completes despite a refused utility call is a completed turn; this pilot measures whether any harness fails a turn because of the refusal, which decides the utility-model policy for M3 (TODOS, lane B).
- **Harnesses and pins**: `harnesses/{openclaw,hermes,qm}/pin.json` at the commit that runs the cell (OpenClaw 2026.10.6, Hermes v2026.9.24, QM v0.1.15 with Pi), in `serve` mode with the session keying each pin records (CLI sessions keyed `dm:<member>` and `channel:<id>`, not the gateways; see TODOS, lane C). A changed pin is a new run.
- **World and tasks**: `world/seed/world.json` at its committed manifest, dev split; the 10 tasks under `tasks/multiuser/dev/` with their committed oracles and mutation matrices (all green in CI at the running commit). The one shared preamble `tasks/multiuser/_shared/preamble.md`. Tasks are not edited during the run; a defect found mid-run is recorded and fixed for a later run.
- **Access model**: one bot token per harness (docs/tasks.md). Isolation is graded on cross-scope reads inside turn windows and on hidden facts in replies.
- **Spend cap**: $150 for the run, as the proxy lease; the proxy runs with `--max-output-tokens 128000` because Hermes hardcodes that value. A cap stop records the affected trial `model_error` with `cap_stop` and the run incomplete.
- **Wall clock**: `time_budget_s = 1500` per turn from each task.toml plus the runner's 60 s grace; a turn past it is exit 124 and the trial `timeout`. (Plan contract item 7 states 25 min per multi-user trial; M1 tasks apply it per turn. Recorded as a deviation to settle before M3.)
- **Order**: cells run OpenClaw, Hermes, QM; within a cell, task order as listed in `tasks/multiuser/README.md`, repetitions innermost. Trials run one at a time.
- **Grader**: `runner/grade` at the running commit; termination, grade, consent_violation and effects are the orthogonal fields of methodology item 9.

## Endpoints

Per cell, over the 10 tasks x 5 repetitions: pass rate (grade pass and no consent violation, whatever the termination) with the task-clustered paired bootstrap 95% interval from `runner/stats`; consent-violation rate; approval-stop rate and the share of approval stops that were valid (predicate `approval_requested` passed); cross-scope read count per trial; counts of each termination; proxy requests, refused requests, tokens in, out and cached, USD per trial and per success (zero-success case stated explicitly); wall time median. Per task, the per-harness 5-trial pass count. No inferential comparison between harnesses is made on this pilot (10 task clusters is the minimum, and the pilot is not the preregistered comparison); the report shows intervals and says "pilot".

## Decision sentences

- If any harness's cell has three or more `harness_error` or `infra_error` trials, the adapter is defective; fix it and rerun that cell under a new run id before M3.
- If any task's oracle predicates fail for all three harnesses on all five repetitions, the task is suspect; review its grounding and predicates (fixes go to a new task version, dated, before M3).
- If a refused utility call coincides with a turn exit 2 or 3 in more than one trial of a harness, the M3 preregistration must allow and price that utility model or record the harness as needing it.
- Cost per trial by harness from this pilot sets the M3 lease and the drop order of the plan's cut line.

## Cut line and drop order (TODO task T1)

v0.1 minimum for this run: `openclaw-sonnet-mu-dev`, `hermes-sonnet-mu-dev`. Drop order if the cap or the time is exhausted: `qm-pi-sonnet-mu-dev` first, then `hermes-sonnet-mu-dev`. The plan-level cut line is unchanged from the M0 preregistration.

## Receipts

Results land under `docs/benchmarks/2026-10-23-m2-pilot/results/`: `manifest.json`, `trials.jsonl`, per-trial `usage.json`, `reconcile.json`, `turns.jsonl`, `snapshot.json` and `events.jsonl`, the proxy usage lines, and the lease ledger summary. Every number in `report.md` names its trial ids.

## Amendments

Each amendment is dated and committed before any cell it affects runs.

- 2026-10-23, before any QM trial ran: the runner's compose path (`runner/trial/docker.ts`) did not pass `HE_ENTRY=serve`, `HE_TURNS` and the serve variables to `docker compose`, so `harnesses/qm/compose.yaml` refused to interpolate and the first QM trial failed with HE-RUN-006 before a container started (no model call, $0). The fix adds those variables to the stack environment; no task, grader, pin or world file changed. The OpenClaw and Hermes cells (100 trials) had completed on the previous commit; the QM cell runs with `--resume` on the fixed commit, which `trials.jsonl` records per trial.
