# Error codes

Every runner, proxy and adapter failure prints one line that starts with its code, says what happened with the values involved, and ends with the fix command or the human prerequisite. Codes are stable; add a row here in the same commit that introduces one. Areas: PREREG, PIN, RUN, BUDGET, PROXY, ADAPTER, EGRESS, SCORE, TASK, PUBLISH.

| Code | What | Fix / recovery | Where |
|---|---|---|---|
| HE-PREREG-001 | preregistration file not found | pass `--prereg docs/benchmarks/<run>/prereg.json` | runner/run.ts |
| HE-PREREG-002 | unsupported schema_version | set `schema_version: 1` | runner/run.ts |
| HE-PREREG-003 | no cells | add at least one cell | runner/run.ts |
| HE-PREREG-004 | a cell names a slice with no task list | add `tasks.<slice>` | runner/run.ts |
| HE-PREREG-005 | repetitions < 1 | set repetitions >= 1 (5 for counted cells) | runner/run.ts |
| HE-PIN-001 | a cell's harness has no `harnesses/<name>/pin.json` | add the pin before any cell runs | runner/run.ts preflight |
| HE-PIN-002 | a cell's model has no registered price | register the list price in `runner/pricing/model-pricing.ts` | runner/run.ts |
| HE-RUN-001 | retired in M1: `run` dispatches trials (runner/README.md) | none | runner/run.ts (historical) |
| HE-RUN-002 | bad or missing arguments | see usage line | runner/run.ts |
| HE-RUN-003 | manifest already exists for this run id | a run id is used once; choose a new one, or remove the directory only if nothing ran | runner/run.ts |
| HE-BUDGET-001 | the metering proxy refused a trial's call because the lease or program cap is spent; the trial is `model_error` with `cap_stop`; exit 3 under `--stop-on-cap` | the run is incomplete; raise the cap in the ledger with `set-cap` (owner's authorization in the reason) and `run --resume --lease-usd <new>` | runner/trial/run.ts |
| HE-BUDGET-002 | preregistration has no positive spend cap | write the cap into the preregistration | runner/run.ts |
| HE-BUDGET-003 | cost ceiling exceeds the preregistered cap (warning) | cells past the cap stop incomplete in `drop_order`; raise the cap through the ledger with a reason or shrink the matrix | runner/run.ts |
| HE-PROXY-001 | provider key missing in the proxy's shell (warning) | export the key where the proxy runs; never in a harness container | runner/run.ts preflight |
| HE-PROXY-003 | the metering proxy did not start, or a control call (bind, finalize, unbind) failed | read `results/<run>/proxy.log`; a lease left open by another run id needs `--new-lease`; the ledger path must be writable | runner/trial/proxy.ts |
| HE-PROXY-002 | per-trial reconciliation off by more than 1% | trial is `model_error`; the message names the call, both token counts and the provider; rerun only with a named repair | runner/reconcile (planned) |
| HE-ADAPTER-001 | adapter exited 2 (harness error) | counted against the harness in its own column; read `$HE_LOG_DIR` | adapters (lane B) |
| HE-ADAPTER-002 | the harness did not write `$HE_LOG_DIR/ready` within the ready timeout (default 180 s), or exited first | trial is `infra_error` (or `harness_error` / `model_error` when it exited 2 / 3); read `logs/docker.log` or `logs/harness.stderr.log`; `--ready-timeout-s` for a slow stack | runner/trial/trial.ts |
| HE-ADAPTER-003 | a serve turn outlived `time_budget_s`: the adapter answers exit 124 with `reply_text` null and keeps serving, or no `turn-NNNN.response.json` arrives within the budget plus the runner's grace (default 60 s) and the harness is killed | the turn is recorded exit 124 and the trial `timeout`; nothing to fix unless every trial does it | adapters serve, runner/trial/turns.ts |
| HE-RUN-005 | unknown `--harness-mode`, or process mode without an adapter script | pass `docker`, `process` or `scripted`; set `cell.adapter` or `--adapter <script>` | runner/run.ts, runner/trial/trial.ts |
| HE-RUN-006 | `docker run`, `docker compose up`, `prepare.sh` or `harnesses/run-trial.sh` failed | the message carries the tool's last lines; build the image (`harnesses/<name>/README.md`), check the daemon | runner/trial/docker.ts, runner/trial/run.ts |
| HE-PREREG-006 | a scripted cell is inconsistent (harness not `scripted`, or `script` not `oracle` / `mutations`) | set `harness: "scripted"`, `model: "none"`, `harness_mode: "scripted"`, `script` | runner/run.ts |
| HE-TASK-001 | `task.toml` missing or malformed (no id, actors, turns or positive `time_budget_s`) | fix the task against the schema in docs/tasks.md | runner/trial/task.ts, runner/run.ts |
| HE-TASK-002 | the shared preamble `tasks/multiuser/_shared/preamble.md` is missing | add it (lane B), or `--preamble <file>` | runner/trial/task.ts |
| HE-TASK-003 | the preamble uses a placeholder the runner does not fill | use only `PREAMBLE_PLACEHOLDERS` from runner/contracts.ts | runner/trial/task.ts |
| HE-TASK-004 | a turn names an actor with no token in the trial's world | list the actor in `task.toml` `actors`; check the member exists in the split | runner/trial/world.ts |
| HE-WORLD-001 | the world refused a runner call: an actor's post (channel missing, actor not a member), a clock advance, the fence or the snapshot | the trial is `exam_fault`; fix the task's channel or actors | runner/trial/turns.ts, runner/trial/world.ts |
| HE-SCRIPT-001 | a Script (oracle.json or mutations/<id>.json) is missing or malformed | one script per predicate, shape `Script` in runner/contracts.ts | runner/scripted/executor.ts, runner/run.ts |
| HE-GRADE-001 | `runner/grade/index.ts` is absent or does not export `gradeTrial` | land the grader (lane B; docs/tasks.md predicate library) | runner/trial/trial.ts |
| HE-ADAPTER-004 | serve started without `HE_WORLD_MCP_URL` and `HE_WORLD_MCP_TOKEN`, or the world-MCP registration was refused (exit 2 before `ready`) | pass both variables from the world's trial.json; for QM read `$HE_LOG_DIR/qm-mcp-register.json`, for OpenClaw `openclaw-mcp-probe.log` | adapters serve (M1 lane C) |
| HE-EGRESS-003 | egress denials during a trial | add the host to `runner/egress.json` and start a new run; the current run is not comparable | runner/egress (planned) |
