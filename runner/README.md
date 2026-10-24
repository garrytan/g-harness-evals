# Runner: dispatch, metering proxy, budget ledger and price table

`runner/run.ts` plans a preregistered run and dispatches its trials. harness-evals v0.0.3 (M1): `run` drives multi-user trials end to end against the simulated company, the metering proxy and a harness speaking the `serve` protocol, and writes the evaluator-owned record of every trial. The single-shot hello/smoke path from M0 still runs through the same command.

## Commands

```sh
bun runner/run.ts plan      --prereg docs/benchmarks/<run>/prereg.json [--out results/<run-id>]
bun runner/run.ts dry-run   --prereg <file>
bun runner/run.ts preflight --manifest results/<run-id>/manifest.json
bun runner/run.ts run       --manifest results/<run-id>/manifest.json [options]
```

`plan` expands the preregistration into `manifest.json`: one preallocated trial id per cell, task and repetition, and the cost ceiling priced from the pinned price table. A run id is used once (HE-RUN-003). `dry-run` prints the same without writing.

A cell names `harness`, `model` (`provider:model`), `slice`, `split`, `repetitions` and a `ceiling` in tokens. For a multi-user cell the ceiling is per turn and a trial is priced as turns x ceiling, with the turn count read from each task's `task.toml`. Tasks come from `cell.tasks`, else `tasks.<slice>` in the preregistration, else every directory under `tasks/multiuser/<split>/`. Optional fields: `harness_mode` (`docker`, the default; `process`; `scripted`), `adapter` (process mode: the script to run), and for scripted cells `harness: "scripted"`, `model: "none"` and `script: "oracle"` or `"mutations"`, which expands to one trial per task's `oracle.json` or per `mutations/<predicate-id>.json`. Scripted cells cost nothing.

### `run` options

| Option | Meaning |
|---|---|
| `--harness-mode docker\|process\|scripted` | How non-scripted cells run (default `docker`). A scripted cell is always scripted. |
| `--adapter <script>` | Process mode: the adapter script (`.sh` under bash, `.ts` under bun) started with the argument `serve`. |
| `--image <tag>` | Docker mode: image instead of `harness-eval/<harness>:dev`. |
| `--resume` | Skip trials that already have a line in `trials.jsonl`. Without it a run directory that holds trials is refused (HE-RUN-003). |
| `--stop-on-cap` | Stop at the first proxy lease refusal and exit 3; the default records the trial and continues. |
| `--cells a,b` | Only these cells. |
| `--ledger <file>`, `--lease-usd <n>`, `--new-lease` | The proxy's lease ledger (default `results/<run>/ledger.sqlite`), the lease (default the preregistered cap) and the proxy's `--new-run` for a ledger whose open lease belongs to another run id. |
| `--max-output-tokens <n>` | The proxy's output cap (Hermes needs 128000; TODOS). |
| `--preamble <file>` | Instead of `tasks/multiuser/_shared/preamble.md`. |
| `--ready-timeout-s <n>`, `--turn-grace-s <n>` | Defaults 180 and 60: how long to wait for `$HE_LOG_DIR/ready`, and how long past `time_budget_s` a turn may run before the harness is killed. |
| `--harness-env K=V` | Extra environment for the harness (debugging a harness; never a key). |

Exit 0 when every selected trial was recorded, 3 after a cap stop with `--stop-on-cap` (HE-BUDGET-001 on stderr), 2 on any HE- refusal.

## What one multi-user trial does

1. **World.** The simulated company starts in-process (`world/services/server.ts`) on a random free port, bound to every interface in docker mode so a container reaches it through `host.docker.internal`, with the task's split and actors; `trial.json` and `events.jsonl` land in the trial directory.
2. **Proxy slot.** The run's metering proxy binds a slot named after the trial to the trial key `sk-trial-<id>`; the harness's `HE_MODEL_BASE_URL` is `<proxy>/<slot>/<provider>`.
3. **Harness.** Docker: `docker run -d` with `/workspace`, `/harness-state`, `/he-logs` and `/he-turns` mounted, the `serve` environment table of docs/adapters.md, entrypoint argument `serve`; a harness with `compose.yaml` runs its stack with an override file that switches the task service to `serve`, after `prepare.sh` and before `capture.sh`, as `harnesses/run-trial.sh` does. Process: the adapter script on this host with the same variables pointing at host directories. Scripted: the in-process executor (`runner/scripted/executor.ts`), ready at once. The runner waits for `$HE_LOG_DIR/ready` (HE-ADAPTER-002 past the timeout).
4. **Turns.** For each turn in `task.toml`: advance the clock if asked (`POST /clock/advance`), post the actor's message through the Slack mock with that actor's token (`chat.postMessage` to the channel by name, or `conversations.open` with the bot and then post for a DM), compose the prompt from the preamble, write `turn-NNNN.request.json`, wait for `turn-NNNN.response.json` up to `time_budget_s` plus the grace (then kill the harness and record exit 124), post `reply_text` as the bot into the same channel, record a `TurnWindow` whose `started_seq` and `ended_seq` bracket the harness's work, then honour `wait_s`. The bot reply is posted after `ended_seq`, so it is never counted as the harness's own read.
5. **End.** `POST /admin/fence`, `GET /admin/snapshot` to `snapshot.json`, stop the harness (SIGTERM, 60 s, SIGKILL; compose: `capture.sh`, then `down -v`), finalize the proxy key into `usage.json` and `reconcile.json`, grade with `gradeTrial(TrialEvidence)` from `runner/grade/index.ts` (HE-GRADE-001 when absent), append the line to `trials.jsonl`.

Termination comes from the turn exits: all 0 is `completed` (or `approval_stop` when the grader says so); any 124 is `timeout`; else any 3 is `model_error`; else any 2 is `harness_error`. A harness that never wrote `ready` is `harness_error` or `model_error` when it exited 2 or 3 first, else `infra_error`. A proxy lease refusal during the trial makes it `model_error` with `cap_stop: true`. A world refusal of an actor's message (channel missing, actor not a member) is `exam_fault`.

## Results tree

```
results/<run-id>/
  manifest.json              from plan
  trials.jsonl               one TrialRecord per finished trial, appended atomically; --resume reads it
  run.log, run-summary.json  the runner's own log and the completion summary
  ledger.sqlite              the proxy's lease ledger (unless --ledger); proxy-usage.ndjson, proxy.log
  trials/<cell>/<task>/[<oracle|mut-<id>>/]r<n>/
    trial.json               tokens and MCP config (evaluator-owned; the redaction set)
    events.jsonl             the world's event log
    turns.jsonl              one TurnWindow per turn run
    turns/                   turn-NNNN.request.json and .response.json
    snapshot.json            GET /admin/snapshot after the fence
    usage.json, reconcile.json   the proxy meter for sk-trial-<id> and its check against the usage lines
    grade.json               GradeResult
    workspace/, state/, logs/    the harness's mounts; logs/ready, adapter.log, docker.log or harness.std*.log
```

### trials.jsonl fields (`TrialRecord` in runner/contracts.ts)

| Field | Meaning |
|---|---|
| `trial_id`, `cell`, `task`, `harness`, `harness_mode`, `model`, `script` | identity; `script` is the Script path for a scripted trial |
| `termination` | `completed`, `timeout`, `approval_stop`, `harness_error`, `model_error`, `infra_error`, `exam_fault` |
| `grade`, `consent_violation`, `approval_stop`, `effects`, `predicates` | the grader's verdict, kept apart from termination (methodology item 9) |
| `cap_stop` | the proxy refused a call because the lease or program cap was spent |
| `turns` | `planned`, `run`, and the exit of every turn run |
| `usage` | requests, refused, failed, usd, tokens in, out and cached, by model, upstream status counts; null for scripted trials |
| `wall_ms`, `started_at`, `ended_at`, `paths`, `error` | timing, where the files are, and the HE- line that cut the trial short, if one did |

`reconcile.json` checks the proxy's meter against the usage lines it wrote for the key. Reconciliation against the provider's own usage (HE-PROXY-002, the 1% rule) is not built; the file says so.

## Harness modes

- **docker** is the counted configuration: the harness image and the mounts of docs/adapters.md. Everything docker-specific is in `runner/trial/docker.ts`; nothing else needs a daemon.
- **process** runs an adapter script on this host for keyless tests: `tests/fixtures/serve-adapter.ts` honours the queue protocol with markers in the message text for sleeps, exits, a cross-scope read and a leak. `tests/trial-loop.test.ts` runs the whole loop this way with a stub grader.
- **scripted** plays an oracle or mutation (`Script`) as the bot over world-MCP with no harness, through the same turn loop, fence, snapshot and grader. This is how CI runs the oracle and mutation matrix through the real runner.

## Vendored pieces

Vendored from [gbrain-evals](https://github.com/garrytan/gbrain-evals) v0.10.128 (`6999ebc9`) and [gbrain](https://github.com/garrytan/gbrain) (`src/core/model-pricing.ts`, `embedding-pricing.ts`, `model-id.ts`), both MIT. Changes: import paths, `sanitize.ts` reduced to the leak tripwire the proxy uses, and a `cached_tokens` field on the proxy's usage lines.

- `proxy/metering-proxy.ts`: the only network exit for a harness container's model calls. In lease mode it strips inbound credentials and injects the real key from its own environment, allows only listed provider routes and priced models, bounds input tokens by request bytes, injects or enforces an output-token cap, reserves the worst case in the ledger before forwarding (concurrent requests serialize on the ledger), meters streamed responses from their usage events, refuses bodies carrying a forbidden marker, and appends one usage line per request (never a body or a key). Per-trial attribution: the runner binds a slot (the path segment the container's base URL carries) to a trial key with `POST /__proxy/bind {slot, key}`, reads the meter with `POST /__proxy/finalize {key}` and releases the slot with `POST /__proxy/unbind {slot}`; with `--control-token` these need the `x-proxy-control` header, so a container cannot move charges. The runner starts one proxy per run (`runner/trial/proxy.ts`) with the manifest's models as the allowlist; the proxy's environment is the only place a provider key lives.
- `ledger/budget-ledger.ts`: SQLite ledger (WAL, synchronous=FULL). Reserve before dispatch, settle to provider usage, cap recorded in the ledger with who set it and why, refusals name the fix. `docs/budget-ledger.md` in gbrain-evals describes the operator commands; the same CLI works here as `bun runner/ledger/budget-ledger.ts`. The program ledger for this evaluation lives outside the repository (the project drive, `harness-eval/ledger/program-ledger.sqlite`); its recorded cap is $2,000 (plan D10, set 2026-10-22), and every paid run opens its lease in it.
- `contracts.ts`: the shapes the runner, the adapters (`TurnRequest`, `TurnResponse`), the graders (`TrialEvidence`, `GradeResult`), the scripted oracle and mutation solutions (`Script`) and the trial record (`TrialRecord`, `TrialUsage`) agree on. See docs/tasks.md and docs/adapters.md.
- `pricing/`: the list-price table (`canonicalLookup`). A model with no row cannot be reserved and so cannot run (HE-PIN-002). Register a price before a cell runs, in the same commit as the preregistration amendment that adds the model.

What the plan still asks for on top of this (TODOS): egress enforcement, forced `stream_options.include_usage` on OpenAI chat streams, native Anthropic Messages and OpenAI Responses metering fixtures for the Claude Code and Codex cells, and per-run external reconciliation against the provider usage page.

## Report tooling (gbrain arm, lane E)

The scripts that turn `results/<run>/trials.jsonl` into report tables, all keyless, all writing their JSON beside the trials file: `bun scripts/summarize-run.ts --results <dir>` prints the per-cell table, the per-task pass table and the failed-predicate counts and writes `summary.json`; it also reads each trial's `events.jsonl` and adds a `gbrain` block per cell (trials with at least one gbrain tools/call, trials that listed the tools, calls per trial as median and total, the histogram of gbrain tools, pages returned per call and latency medians, errors, writes, and cross-scope reads that came via gbrain against via the world), zeros for a cell without gbrain, with `events_read` saying how many logs it found. `bun scripts/compare-run.ts --results <dir> [--families ...]` is the pairwise harness comparison and `--against <other run>` the across-run model effect; `--pair gbrain` is the within-run gbrain arm: for each (harness, config, model) it pairs the cell with gbrain (a truthy `gbrain` field in the manifest cell, or a `gbrain` segment in its id) against the cell without, trial by trial on the same task and repetition index, over the four capable families and over all tasks, excluding a pair whose trial ended as `model_error` or `infra_error` on either side and publishing the count, with Holm across the harness pairs of one model, and writes `comparisons.gbrain.json` (passed counts, gbrain minus none with its task-clustered interval, the per-task table, discordant counts, Holm-adjusted p, and median USD and seconds per trial and total input tokens for both cells). `bun scripts/paired-mdd.ts --results <dir>` prints the minimum detectable difference of that paired design from an existing run's per-task pass rates, under the null that gbrain changes nothing and with the two arms independent given the task, beside the sign-flip bar of the preregistration (six task clusters all one way). `bun scripts/regrade.ts --results <dir>` re-reads every trial's evidence with the grader at the current commit into `trials.regraded.jsonl`, which `--regraded` on the two scripts above consumes. Tests: `tests/scripts-gbrain.test.ts`.

## Changelog

### 2026-10-23: gbrain arm report tooling (lane E)

harness-evals v0.0.5. The "Report tooling" section: `summarize-run.ts` gains the per-cell `gbrain` block, `compare-run.ts` gains `--pair gbrain`, and `paired-mdd.ts` is new.

### 2026-10-22: M1 trial dispatch

harness-evals v0.0.3. `run` dispatches multi-user trials (world per trial, proxy per run, docker, process and scripted harness modes, turn loop, fence and snapshot, classification, grading hook, resume, cap stop); manifests carry multi-user cells priced per turn and scripted cells; this page describes the command, the results tree and the trials.jsonl fields.

### 2026-10-22: Proxy, ledger and price table vendored

harness-evals v0.0.2. First version of this page: the vendored pieces and what the plan still asks for.
