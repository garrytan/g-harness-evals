# Adapter protocol

An adapter is the thin shell between the runner and one harness. It turns a task into one headless harness turn and reports how that turn ended. This page is the contract every `harnesses/<name>/adapter.sh` implements and `tests/adapter-conformance.test.ts` checks against the fake harness in [harnesses/_fake/](../harnesses/_fake/). It implements items 2, 3, 4, 7 and 9 of the [trial contract](methodology.md). harness-evals v0.0.1.

## What the harness receives

The harness sees three things and nothing else (methodology item 4):

- `/workspace`: the task workspace. It holds `instruction.md`, the only prompt the harness gets, plus whatever files the task seeds. The harness works here. It is the only place the harness may change that the grader reads.
- `/opt/harness`: the harness runtime (CLI or service code), its `pin.json`, its config template under `config/` and `adapter.sh`. Read-only.
- The model, reachable only through the metering proxy at `HE_MODEL_BASE_URL` with the per-trial token `HE_MODEL_API_KEY`. The proxy strips that token and injects the real key itself (methodology item 3). No adapter, image or config file ever holds a real key.

In M1 the one world-MCP server is added through the harness's own MCP config; `pin.json` names where that config lives (`mcp_config_path`).

## Environment

The runner sets these variables. An adapter must not require anything else.

| Variable | Meaning |
|---|---|
| `HE_MODEL_BASE_URL` | Provider-specific base URL on the proxy, for example `http://host.docker.internal:8787/anthropic`. The harness appends its usual path (`/v1/messages`). |
| `HE_MODEL_API_KEY` | The per-trial dummy token (`sk-trial-<id>`). The proxy maps it to the trial and refuses unknown tokens. |
| `HE_MODEL_NAME` | Model id as the provider names it, for example `claude-sonnet-5-5`. The adapter pins the harness to exactly this model; model fallback is forbidden. |
| `HE_TIME_BUDGET_S` | Wall-clock budget for the turn, in seconds. |
| `HE_LOG_DIR` | Writable directory outside `/workspace` for the adapter's own log, the harness's stdout and stderr, and any harness-native transcript. |
| `HE_SESSION_STATE_DIR` | `/harness-state`. Writable. HOME, XDG dirs and every path in `pin.json` `state_paths` live under it. |
| `HE_TASK_SLICE` | `multiuser`, `work`, `continuity`, `coding` or `smoke`. Informational. |
| `HE_TRIAL_ID` | The preallocated trial id. Used in log lines and as the harness's thread or session reference. |
| `HE_WORKSPACE_DIR` | Optional, defaults to `/workspace`. Exists so the process-level conformance test can run an adapter outside a container. Runners never set it. |

## Mounts

| Path | Mode | Contents |
|---|---|---|
| `/workspace` | read-write | task workspace; `instruction.md` and seeded files |
| `/opt/harness` | read-only | harness runtime, `pin.json`, `config/`, `adapter.sh` |
| `/harness-state` | read-write | all harness state; empty at the start of a trial |
| `$HE_LOG_DIR` | read-write | logs; outside `/workspace` so the grader never sees them |

A trial starts from an empty `/harness-state`. The adapter copies its config template there if the harness needs a writable config (OpenClaw and Hermes both do), filling secrets from the environment, never from a file in the image.

The container runs as the calling user, not root, so files it writes are owned by the account that grades them.

## Entry points

`adapter.sh run` is the single-shot entry: read `/workspace/instruction.md`, run one headless turn, exit. It is the only entry point implemented in M0.

`adapter.sh serve` is the multi-user entry (methodology item 5), specified here and built in M1. `serve` starts the harness once per trial with the world-MCP server (bot token) wired into its MCP config, writes a readiness file `$HE_LOG_DIR/ready`, then answers turns from a file queue until SIGTERM: the runner writes `$HE_TURNS_DIR/turn-<NNNN>.request.json` (a `TurnRequest` from [runner/contracts.ts](../runner/contracts.ts): the composed prompt, the requesting member, the channel, the simulation time, the turn budget) and the adapter writes `turn-<NNNN>.response.json` (a `TurnResponse`: exit code as below, the harness's reply text) when the harness is done; both files are written whole and renamed into place. The adapter keys the harness's session on the conversation (`dm:<member>` for a DM, `channel:<id>` for a channel) and keeps the harness process or state alive across turns, so whatever the harness does or does not share between sessions is what gets measured. The runner posts the reply into the world as the bot, so an adapter never posts to Slack itself. Environment for `serve`, beyond the table above: `HE_TURNS_DIR`, `HE_WORLD_MCP_URL`, `HE_WORLD_MCP_TOKEN` (the bot's world-MCP bearer token, dummy outside a trial), `HE_SLACK_API_URL`, `HE_SLACK_BOT_TOKEN`, `HE_SLACK_APP_TOKEN` for a harness whose native Slack connector can point at the mock. An adapter that has not implemented `serve` exits 2.

## Non-interactive by construction

The harness must complete a turn with stdin closed and no TTY: the runner starts it as `docker run -i ... </dev/null`, never with `-t`. Any first-run wizard, update prompt, consent screen or approval prompt is a harness error. The config template under `config/` is written from `pin.json` so none of these fire. `docker run -i` with stdin from `/dev/null` is also how the conformance test runs the fake harness.

## Exit codes

| Code | Termination in trials.jsonl | Meaning |
|---|---|---|
| 0 | `completed` | the harness finished its turn. Says nothing about the grade. |
| 2 | `harness_error` | the harness could not run or crashed: missing config, wizard, unsupported entry point, crash. Counts against the harness in its own column. |
| 3 | `model_error` | the model call failed: proxy refusal, 4xx or 5xx from the provider, budget cap. Excluded from pass rate, counted and published. |
| 124 | `timeout` | the turn outlived `HE_TIME_BUDGET_S`. The adapter sends SIGTERM, waits 60 s, then SIGKILL (methodology item 7). The runner adds its own 60 s grace outside the container. |

Any other code is `infra_error`. The adapter maps the harness's own exit codes and output onto these four; each `adapter.sh` documents its mapping in comments. An adapter that cannot tell a model error from a harness error reports 2.

## Logs

Everything the harness prints goes to `$HE_LOG_DIR/stdout.log` and `$HE_LOG_DIR/stderr.log`. The adapter's own lines go to `$HE_LOG_DIR/adapter.log`, each with a UTC timestamp, the harness name and the trial id. A harness-native transcript (OpenClaw's JSON envelope, QM's turn result) goes beside them. Nothing is written to `/workspace` except by the harness doing the task.

## Two topologies

**In-container** (OpenClaw, Hermes): one image holds the harness. The runner mounts the three paths, sets the environment and runs `adapter.sh run` as the container's entrypoint.

**Sidecar** (QM): the harness is a service stack. `harnesses/qm/compose.yaml` runs Postgres, QM core and a task container whose entrypoint is `adapter.sh`; the task container posts one turn to core over HTTP. Two hooks extend the protocol for this topology: `prepare.sh <out>` runs before the stack starts (creates bind-mount targets, mints per-trial secrets) and `capture.sh <out>` runs after the task container exits and before teardown (copies world state the stack holds outside `/workspace` into it, removes per-trial sandboxes). Everything in the stack is fresh per trial.

## Driver

`harnesses/run-trial.sh` is the M0 driver for both topologies. It creates `workspace/`, `state/` and `logs/` under an output directory, copies the task's `instruction.md` in, runs the image or stack, runs the task's grader on the workspace and writes `result.json` with exit code, termination, grade and wall time. `runner/run.py` replaces it once the ledger and world land.

```sh
harnesses/run-trial.sh --harness openclaw --task tasks/hello --trial-id t1 \
  --base-url http://host.docker.internal:8787/anthropic --api-key sk-trial-t1
```

## Conformance

`bun test tests/adapter-conformance.test.ts` proves the protocol on the fake harness: exit 0, 2, 3 and 124 under the conditions above; nothing written outside `/workspace`, `/harness-state` and `$HE_LOG_DIR` (at the process level by listing the temp tree, at the container level with `docker diff`); state in `/harness-state`; a stdin-closed, no-TTY run that completes; a no-op instruction that leaves the workspace untouched. The container-level tests skip when no Docker daemon is reachable.

## Changelog

### 2026-10-22: Protocol written for M0

harness-evals v0.0.1. First version: environment, mounts, exit codes, logs, the `run` entry and the reserved `serve` lifecycle, two topologies, the M0 driver. Proven on the fake harness and on live hello-world trials of OpenClaw, Hermes Agent and QM; see each harness's README under `harnesses/`.
