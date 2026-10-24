# Error codes

Every runner, proxy and adapter failure prints one line that starts with its code, says what happened with the values involved, and ends with the fix command or the human prerequisite. Codes are stable; add a row here in the same commit that introduces one. Areas: PREREG, PIN, RUN, BUDGET, PROXY, ADAPTER, EGRESS, SCORE, TASK, PUBLISH.

| Code | What | Fix / recovery | Where |
|---|---|---|---|
| HE-PREREG-001 | preregistration file not found | pass `--prereg docs/benchmarks/<run>/prereg.json` | runner/run.ts |
| HE-PREREG-002 | unsupported schema_version | set `schema_version: 1` | runner/run.ts |
| HE-PREREG-003 | no cells | add at least one cell | runner/run.ts |
| HE-PREREG-004 | a cell has no tasks to run: a non-multi-user slice without `tasks.<slice>`; a multi-user cell whose task directory (`tasks/multiuser/[<task_set>/]<split>/`) is empty or whose `task_set` has no directory; or an explicit list (`cell.tasks` or `tasks.multiuser`) naming tasks the cell's set does not hold | add `tasks.<slice>` or the task directories; name an existing `task_set` (`v0.1` is the root); list tasks of that set, or set `task_set` to the set the list belongs to | runner/run.ts |
| HE-PREREG-005 | repetitions < 1 | set repetitions >= 1 (5 for counted cells) | runner/run.ts |
| HE-PREREG-007 | a cell has a key outside the Cell interface (a misspelled `task_set` would otherwise run the v0.1 dev set in silence), or an invalid `task_set` or `session_scope` value | the message lists the allowed keys; `task_set` is a name such as `v0.1` or `v0.2`, `session_scope` is `conversation` or `turn` | runner/run.ts |
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
| HE-TASK-001 | `task.toml` missing or malformed (no id, actors, turns or positive `time_budget_s`) under `tasks/multiuser/[<task_set>/]<split>/` | fix the task against the schema in docs/tasks.md | runner/trial/task.ts, runner/run.ts |
| HE-TASK-SEAL | a held-out tree and its `MANIFEST.json` disagree, a held-out tree holds tasks but no manifest (unsealed), or `--task-set` names a set with no `tasks/multiuser/<set>/heldout/` | `bun scripts/seal-heldout.ts [--task-set <set>]` and commit the manifest beside the change; the message names the known sets | scripts/seal-heldout.ts |
| HE-TASK-002 | the shared preamble `tasks/multiuser/_shared/preamble.md` is missing | add it (lane B), or `--preamble <file>` | runner/trial/task.ts |
| HE-TASK-003 | the preamble uses a placeholder the runner does not fill | use only `PREAMBLE_PLACEHOLDERS` from runner/contracts.ts | runner/trial/task.ts |
| HE-TASK-004 | a turn names an actor with no token in the trial's world | list the actor in `task.toml` `actors`; check the member exists in the split | runner/trial/world.ts |
| HE-WORLD-001 | the world refused a runner call: an actor's post (channel missing, actor not a member), a clock advance, the fence or the snapshot | the trial is `exam_fault`; fix the task's channel or actors | runner/trial/turns.ts, runner/trial/world.ts |
| HE-SCRIPT-001 | a Script (oracle.json or mutations/<id>.json) is missing or malformed | one script per predicate, shape `Script` in runner/contracts.ts | runner/scripted/executor.ts, runner/run.ts |
| HE-GRADE-001 | `runner/grade/index.ts` is absent or does not export `gradeTrial` | land the grader (lane B; docs/tasks.md predicate library) | runner/trial/trial.ts |
| HE-ADAPTER-004 | serve started without `HE_WORLD_MCP_URL` and `HE_WORLD_MCP_TOKEN`, or the world-MCP registration was refused (exit 2 before `ready`) | pass both variables from the world's trial.json; for QM read `$HE_LOG_DIR/qm-mcp-register.json`, for OpenClaw `openclaw-mcp-probe.log` | adapters serve (M1 lane C) |
| HE-EGRESS-003 | egress denials during a trial | add the host to `runner/egress.json` and start a new run; the current run is not comparable | runner/egress (planned) |

## From the gbrain arm, lane D

| Code | What | Fix / recovery | Where |
|---|---|---|---|
| HE-GBRAIN-001 | a cell carries `gbrain` with a surface other than `starter`, or a scripted cell carries `gbrain`, or a gbrain cell is dispatched in scripted mode | set `gbrain: {"surface": "starter"}` (the pinned surface, gbrain/pin.json) on a docker or process cell; a script plays the bot over world-MCP and has no harness to call the brain | runner/run.ts, runner/trial/trial.ts |
| HE-GBRAIN-002 | the gbrain sidecar image is missing, `docker run` or `docker network create` failed, or the sidecar did not serve `/health` and write its token within the ready timeout (60 s) | `docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .` (gbrain/README.md); read `<trial dir>/gbrain/sidecar.log` and `docker.log`; `preflight` starts one sidecar to prove the image before a run | runner/trial/gbrain.ts, runner/run.ts preflight |

## Spend reconciliation (internal-task)

| Code | What | Fix / recovery | Where |
|---|---|---|---|
| HE-RECONCILE-001 | the Admin API refused or did not answer (401 or 403: not an Admin key; 429 or 5xx: transient; timeout) | set `ANTHROPIC_ADMIN_KEY` to an Admin API key with usage and cost read access, or run again later; the message carries the status and request id, never the body | scripts/reconcile-provider.ts |
| HE-RECONCILE-002 | a malformed or truncated Admin API page (no `data[]`, `has_more` without a fresh cursor, more than 50 pages) | nothing is written; run again, and report the request id if it repeats | scripts/reconcile-provider.ts |
| HE-RECONCILE-003 | a results directory lacks `trials.jsonl`, `proxy-usage.ndjson`, a ledger lease for the run, or a harness trial has no usage block; or `--provider-fixture` was combined with `--write` | pass the directory that holds `trials.jsonl`; finish an incomplete run with `--resume` first; a fixture never stamps a run | scripts/reconcile-provider.ts |
| HE-RECONCILE-004 | provider usage differs from the proxy by more than 1% in a settled day x model cell | the file is written with status `performed_mismatch`; label the run's cost figures "unreconciled" in its report and look for other spend on the same key and day (TODOS) | scripts/reconcile-provider.ts |
