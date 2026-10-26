# Adapter protocol

An adapter is the thin shell between the runner and one harness. It turns a task into headless harness turns and reports how each turn ended. This page is the contract every `harnesses/<name>/adapter.sh` implements and `tests/adapter-conformance.test.ts` checks against the fake harness in [harnesses/_fake/](../harnesses/_fake/). It implements items 2, 3, 4, 5, 7 and 9 of the [trial contract](methodology.md). harness-evals v0.0.3: both entry points, `run` (one turn) and `serve` (a multi-user trial), are implemented for the fake harness, OpenClaw, Hermes Agent and QM, and `serve` is proven live on all three (see each harness's README).

## What the harness receives

The harness sees three things and nothing else (methodology item 4):

- `/workspace`: the task workspace. It holds `instruction.md`, the only prompt the harness gets, plus whatever files the task seeds. The harness works here. It is the only place the harness may change that the grader reads.
- `/opt/harness`: the harness runtime (CLI or service code), its `pin.json`, its config template under `config/` and `adapter.sh`. Read-only.
- The model, reachable only through the metering proxy at `HE_MODEL_BASE_URL` with the per-trial token `HE_MODEL_API_KEY`. The proxy strips that token and injects the real key itself (methodology item 3). No adapter, image or config file ever holds a real key.

In `serve` the one world-MCP server is added through the harness's own MCP config; `pin.json` names where that config lives (`mcp_config_path`) and how the adapter writes it. The table under "Serve" below has the per-harness detail.

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
| `HE_SESSION_SCOPE` | `conversation` (default, absent unless the cell sets `session_scope`) or `turn`. Serve only. `turn` keys the harness session per turn (`turn:<NNNN>`) instead of per conversation: the memoryless contrast cell of the v0.2 pilot. Implemented by the OpenClaw adapter; Hermes and QM exit 2 on `turn` so a cell that asks for it never runs per-conversation sessions in silence. |
| `HE_HARNESS_CONFIG` | The cell's `config` string, empty when the cell has none. Serve and run. QM reads it in `prepare.sh` (internal-task): `pi` (default) or `claude` select the inner harness as shipped; `pi-probe` and `claude-probe` add a 5 s memory capture quiet time; `pi-strict` and `pi-command-deny` add an admin PUT before the first turn (`harnesses/qm/pin.json` `configs`); any other value exits 2. OpenClaw and Hermes ignore it. |
| `HE_WORKSPACE_DIR` | Optional, defaults to `/workspace`. Exists so the process-level conformance test can run an adapter outside a container. Runners never set it. |

For `serve` the runner also sets:

| Variable | Meaning |
|---|---|
| `HE_TURNS_DIR` | The file queue, `/he-turns`, a read-write mount. The runner writes requests here, the adapter writes responses beside them. |
| `HE_WORLD_MCP_URL` | The world-MCP Streamable HTTP endpoint as the container reaches it, for example `http://host.docker.internal:8791/mcp`. |
| `HE_WORLD_MCP_TOKEN` | The bot's world-MCP bearer token for this trial. Every tool call the harness makes is attributed to the bot. |
| `HE_SLACK_API_URL`, `HE_SLACK_BOT_TOKEN`, `HE_SLACK_APP_TOKEN` | The Slack mock, for a harness whose native Slack connector can point at it. No adapter uses them yet; the runner posts every message. |
| `HE_GBRAIN_MCP_URL`, `HE_GBRAIN_MCP_TOKEN` | The gbrain arm only ([docs/gbrain-arm.md](gbrain-arm.md)): the world's `/gbrain` tap (`<world>/gbrain`) and the same bot token. Set, the adapter registers a second MCP server named `gbrain` exactly as it registers `world`; unset, nothing in the adapter changes and the harness configuration is byte-identical to a cell without gbrain. |
| `HE_GBRAIN_INSTALL`, `HE_GBRAIN_SPLIT`, `HE_GBRAIN_INSTALL_DIR` | The install ladder's docs and installer rungs only (internal-task, [docs/gbrain-arm.md](gbrain-arm.md)): `HE_GBRAIN_INSTALL=gbrain-docs` tells the adapter to apply gbrain's documented install, `gbrain-installer` what `gbrain setup <harness> --instructions-only` wrote (internal-task), from the view mounted read-only at `HE_GBRAIN_INSTALL_DIR` (`/he-gbrain-install`) for the split `HE_GBRAIN_SPLIT` (`dev` or `heldout`) before the harness is prepared; the view's manifest must name the same install kind. See "gbrain's documented install" below. Unset, nothing in the adapter runs. |

## Mounts

| Path | Mode | Contents |
|---|---|---|
| `/workspace` | read-write | task workspace; `instruction.md` and seeded files |
| `/opt/harness` | read-only | harness runtime, `pin.json`, `config/`, `adapter.sh` |
| `/harness-state` | read-write | all harness state; empty at the start of a trial |
| `$HE_LOG_DIR` | read-write | logs; outside `/workspace` so the grader never sees them |
| `$HE_TURNS_DIR` | read-write | `serve` only: the request and response files |
| `/he-gbrain-install` | read-only | gbrain-docs and gbrain-installer cells only: the harness and split's exported view of gbrain's install bundle (docs: `workspace/`, Hermes's `.hermes.md`; installer: `workspace/AGENTS.md` for OpenClaw, `home/SOUL.md` for Hermes; always `manifest.json`), exported and verified by `preflight` into `results/<run>/gbrain-install/<harness>/<split>/` (`<harness>-installer/<split>/` for the installer) |

A trial starts from an empty `/harness-state`. The adapter copies its config template there if the harness needs a writable config (OpenClaw and Hermes both do), filling secrets from the environment, never from a file in the image.

The container runs as the calling user, not root, so files it writes are owned by the account that grades them.

## Entry points

`adapter.sh run` is the single-shot entry: read `/workspace/instruction.md`, run one headless turn, exit.

`adapter.sh serve` is the multi-user entry (methodology item 5). `serve` starts the harness once per trial with the world-MCP server (bot token) wired into its MCP config, writes a readiness file `$HE_LOG_DIR/ready`, then answers turns from a file queue until SIGTERM: the runner writes `$HE_TURNS_DIR/turn-<NNNN>.request.json` (a `TurnRequest` from [runner/contracts.ts](../runner/contracts.ts): the composed prompt, the requesting member, the channel, the simulation time, the turn budget) and the adapter writes `turn-<NNNN>.response.json` (a `TurnResponse`: exit code as below, the harness's reply text) when the harness is done; both files are written whole and renamed into place. The adapter keys the harness's session on the conversation (`dm:<member>` for a DM, `channel:<id>` for a channel) and keeps the harness process or state alive across turns, so whatever the harness does or does not share between sessions is what gets measured. The runner posts the reply into the world as the bot, so an adapter never posts to Slack itself. An entry point other than `run` or `serve` exits 2.

## Serve

### The file queue

- `NNNN` is the turn number from `TurnRequest.turn`, 1-based, zero-padded to four digits (`turn-0001`), so lexical order is turn order. The adapter polls `HE_TURNS_DIR` every 250 ms, lists `turn-*.request.json` in lexical order and handles every request that has no response yet, one at a time. A request the runner writes while a turn is running is handled after it.
- The runner writes a request as `turn-NNNN.request.json.tmp` and renames it; the adapter writes `turn-NNNN.response.json.tmp` and renames it. Nothing else lands in `HE_TURNS_DIR`. Prompt files, harness envelopes and per-turn stderr go under `$HE_LOG_DIR/turns/`.
- The budget of a turn is `TurnRequest.time_budget_s` (falling back to `HE_TIME_BUDGET_S`). The adapter runs the harness turn under `timeout` with a short kill grace (5 s, or the harness's own deadline plus a backstop of 10 to 15 s), so the response lands before the runner's 60 s grace ends; a turn stopped this way is exit 124 with `reply_text: null`. The 60 s SIGTERM-to-SIGKILL grace of methodology item 7 belongs to the runner stopping the container, not to one turn.
- `started_at` and `ended_at` are UTC ISO-8601 with milliseconds, taken by the adapter just before the harness turn starts and just after it ends. `detail` is set on every non-zero exit with a short reason.
- `$HE_LOG_DIR/ready` is a one-line JSON object (`harness`, `trial`, `ready_at`, `session_keys`, for OpenClaw `session_scope`, `adapter_sha256`: the sha256 of the adapter file that ran, which `preflight` compares with the image and the checkout under HE-ADAPTER-005, and on a gbrain-docs cell `gbrain_install` with `status`, `files`, `view_digest` and `destinations`), written after the MCP config is in place and the harness is prepared. A failure before ready (missing world variables, MCP registration refused, an install bundle that could not be applied) exits 2 before the file exists.
- SIGTERM at idle stops the loop and exits 0 within a second. SIGTERM during a turn stops the harness turn, writes that turn's response as exit 2 with `detail: "stopped by SIGTERM during the turn"`, and exits 0. `docker stop` is the runner's way to do this.
- `serve` requires `HE_WORLD_MCP_URL` and `HE_WORLD_MCP_TOKEN` and exits 2 without them. The fake harness is the exception: it serves without a world and fails only a turn that carries a `[fake:call ...]` marker.

### Per harness

| Harness | Harness turn | Session key, where it lives | World-MCP wiring (`pin.json` `mcp_config_path`) | Multi-user mode |
|---|---|---|---|---|
| `_fake` | scripted by markers in the prompt: `[fake:sleep N]`, `[fake:model_error]`, `[fake:harness_error]`, `[fake:call <tool> <json>]`, `[fake:gbrain <tool> <json>]` (one per line) | `dm:<member>`, `channel:<id>`; a turn counter per key in `/harness-state/fake/sessions/` | none; `[fake:call]` POSTs a JSON-RPC `tools/call` to `HE_WORLD_MCP_URL` with curl as the bot; `[fake:gbrain]` does the same to `HE_GBRAIN_MCP_URL` (`tools/list` for the tool name `tools/list`) | scripted, nothing shared between keys |
| OpenClaw 2026.10.6 | `openclaw agent --local --session-key agent:main:<key> --message-file ... --model anthropic/<model> --timeout <budget> --json`; reply from `payloads[].text` | `agent:main:dm:<member>`, `agent:main:channel:<id>` in one `OPENCLAW_STATE_DIR` (`agents/main/agent/openclaw-agent.sqlite`); `agent:main:turn:<NNNN>` under `HE_SESSION_SCOPE=turn` | `openclaw mcp set world {url, transport: streamable-http, headers.Authorization}` into `/harness-state/openclaw/openclaw.json#mcp.servers`; `openclaw mcp probe` logged | embedded agent, one session per conversation; no gateway. `agent exec` has no session selector at this version, so `run` and `serve` use different OpenClaw paths |
| Hermes Agent v2026.9.24 | `hermes chat --query-file ... -c <key> --create-if-missing --oneshot --quiet --format stream-json --provider anthropic --model <model> --run-budget <budget>`; reply from the `result` record | session title `dm:<member>`, `channel:<id>` in one `HERMES_HOME` (`state.db`) | `mcp_servers.world: {url, headers.Authorization}` appended to `/harness-state/hermes/config.yaml`; tools register as `mcp__world__<tool>`; the image installs the `mcp` extra | CLI, one named session per conversation; no gateway |
| QM v0.1.15 | `POST /v1/turns` with `actor.externalId` = the requester's Slack user id and `conversation` `{kind: dm, threadRef: dm:<member>}` or `{kind: channel, threadRef: channel:<id>, channelRef, channelName}`; reply from `TurnResult.reply` | QM scopes `personal:<slack user id>` and `channel:<id>`, in Postgres; `HE_HARNESS_CONFIG` selects the inner harness (`pi` or `claude`) and the probe configs ([harnesses/qm/pin.json](../harnesses/qm/pin.json) `configs`) | `PUT /v1/admin/mcp-servers/world` as admin `harness-admin` (`ADMIN_GRANTS` in `config/core.env`) with `auth: bearer`, `readOnly: false`; core probes `tools/list` before saving | QM's native scoping; the actor is the requester on every turn |

The bearer token in each MCP config is the per-trial bot token the world minted; it is in the runner's redaction set and never a provider key.

Every adapter appends `:t<thread_ts>` to its session key when `TurnRequest.thread_ts` is set (internal-task): a task turn with `thread = "new"` therefore opens a new harness session inside the same conversation and scope, which is how "remembered across sessions" is tested the same way on every harness. No turn without that field changes.

### gbrain beside world

In a gbrain-arm cell the runner sets `HE_GBRAIN_MCP_URL` and `HE_GBRAIN_MCP_TOKEN`, and each adapter adds a server named `gbrain` with the same shape as `world`: OpenClaw `openclaw mcp set gbrain {url, transport: streamable-http, headers.Authorization}`; Hermes an `mcp_servers.gbrain` block appended beside `world` (tools register as `mcp__gbrain__<tool>`); QM `PUT /v1/admin/mcp-servers/gbrain` as `harness-admin`, whose `tools/list` probe before saving is the discovery proof (`qm-gbrain-register.json`); the fake harness answers `[fake:gbrain ...]` markers. Each `pin.json` records this under `gbrain_mcp`. The URL is the world's tap, so every call the harness makes to gbrain is a `via: "gbrain"` event in the trial's log (world/README.md), and the harness never holds the sidecar's own token. `tests/adapter-conformance.test.ts` proves the fake path against a fake sidecar; the live smoke of the three real harnesses is in docs/gbrain-arm.md.

### gbrain's documented install

The install ladder's `docs` rungs (internal-task) ask what changes when gbrain is installed the way its own documentation says, not only registered as an MCP server. The gbrain image holds that install, run once at image build with the gbrain CLI ([gbrain/README.md](../gbrain/README.md), "The install bundle"), and the runner's `preflight` exports the harness and split's view of it with a manifest that lists every file's sha256 and a `view_digest`; each trial verifies the view again and mounts it read-only at `/he-gbrain-install` with `HE_GBRAIN_INSTALL=gbrain-docs`, `HE_GBRAIN_SPLIT` and `HE_GBRAIN_INSTALL_DIR`. The adapter then does what the documented command would have done in `/workspace`, before the MCP wiring and before `ready`:

1. It reads `manifest.json` in the view and refuses a view for another harness or split, or whose `view_digest` does not match its file list.
2. It checks every listed file against its sha256 and copies `workspace/<x>` to `/workspace/<x>` (`skills/` at the pinned gbrain commit: the five core skills in 30 files for OpenClaw from gbrain 0.60.456.0, 64 skills in 127 files before that and for Hermes at every pin, see docs/gbrain-arm.md; what `gbrain skillpack scaffold --harness openclaw --workspace /workspace` writes for OpenClaw and `gbrain skillpack scaffold --all` for Hermes); Hermes also copies `.hermes.md`, the split's compiled context from `gbrain compile-context --target hermes --include-core`, to `/workspace/.hermes.md`. A destination that already exists is refused, as `skillpack scaffold` refuses to overwrite. Each copy is checked again.
3. It writes `$HE_LOG_DIR/gbrain-install.json`: `status` (`ok` or `error`), `code` (`HE-ADAPTER-006` on error), `harness`, `split`, `install`, `dir`, `view_digest`, `files`, `destinations` (the top-level entries, `/workspace/skills` and for Hermes `/workspace/.hermes.md`), `copied` (every destination path) and `error`; `ready` repeats `status`, `install`, `files`, `view_digest` and `destinations` under `gbrain_install`.

The `installer` rung (internal-task, gbrain#7489) goes through the same step with `HE_GBRAIN_INSTALL=gbrain-installer` and the installer view, what `gbrain setup <harness> --instructions-only` wrote at image build: OpenClaw gets `workspace/AGENTS.md` at `/workspace/AGENTS.md`, the brain-first block in the workspace bootstrap file OpenClaw loads into its system prompt (`skipBootstrap` only stops OpenClaw seeding the file itself); Hermes gets `home/SOUL.md` at `$HERMES_HOME/SOUL.md`, Hermes's own default `SOUL.md` at the pinned Hermes commit with the block appended. Hermes writes that default `SOUL.md` into `HERMES_HOME` when the adapter runs `hermes --version`, the "ran Hermes once" gbrain's installer needs before it writes anything, so the Hermes adapter replaces a `SOUL.md` whose sha256 equals the seed the bundle records (`replaced_seed` in `gbrain-install.json`) and refuses any other content. tests/adapter-install.test.ts proves, against a fake Anthropic endpoint on the host and no key, that both harnesses carry the block into the system prompt of their first model request. When the bundle's `installer.turn_hook` is present (gbrain#7489 at `10949a15`), the same step installs gbrain's per-turn hook through the harness's own extension point: OpenClaw copies the hook-only plugin to `$OPENCLAW_STATE_DIR/gbrain/gbrain-turn-rule/`, runs the three recorded `openclaw plugins`/`config` commands and keeps `openclaw plugins inspect gbrain-turn-rule --runtime --json` as `logs/gbrain-hook.openclaw.json` (the plugin must be `loaded` with `before_prompt_build`); Hermes merges the marked `hooks: pre_llm_call` block from the bundle's `home/config.yaml` into its own `config.yaml`, copies `shell-hooks-allowlist.json` and keeps `hermes hooks doctor` as `logs/gbrain-hook.hermes.log` (the hook must be healthy). `ready` then carries `gbrain_install.turn_hook` (`loaded` or `healthy`), and the test proves the rule is in the first request's messages ([docs/gbrain-arm.md](gbrain-arm.md), "The per-turn hook"). `gbrain-install.json` then also carries `turn_hook` (`status`, `detail`; for OpenClaw `plugin_dir` and the `commands` run, for Hermes `doctor_exit`) and, for Hermes, `merged_hooks` (the `config.yaml` path, the block's sha256 and its size). Hermes refuses a `config.yaml` that already has a `hooks:` section and an allowlist file that already exists; either adapter refuses a view whose hook files and manifest `turn_hook` disagree. OpenClaw applies the hook under the `serve` entry only: under `run` the exec state directory would not see the plugin, so an installer view with the hook is refused with HE-ADAPTER-006.

Any failure is one code, HE-ADAPTER-006 (the install bundle could not be applied), printed to `adapter.log` with the reason, and exit 2 before `ready`; the runner records a pre-ready exit 2 as `harness_error`, so the mount is checked by `preflight` first. With `HE_GBRAIN_INSTALL` unset the step does not run and the adapters behave as before; the one visible change for every cell is the `adapter_sha256` field in `ready`.

What each harness does with the landed files was read keylessly from the installed source in the images and is recorded in each `pin.json` under `gbrain_install` with the file and line: OpenClaw 2026.10.6 lists `/workspace/skills` as workspace skills (`src/skills/loading/workspace-skill-roots.ts`; `openclaw skills list --json` shows all 64 scaffolded skills with source `openclaw-workspace`, eligible and model-visible); Hermes v2026.9.24 loads `/workspace/.hermes.md` as its project context from the cwd (`agent/prompt_builder.py`, `_find_hermes_md` and `build_context_files_prompt`) and reads no skills from `/workspace/skills` (`agent/skill_utils.py`: `HERMES_HOME/skills`, `skills.external_dirs` and trusted `<git root>/.hermes/skills` only), so on the Hermes docs rung the skills copy is inert and the brain's index reaches the model through `.hermes.md`. `tests/adapter-install.test.ts` proves the landing, the record, the ready fields, both observations and a one-byte tamper against the images built from the checkout, with no model call. Whether a model reads a landed skill in a turn is a paid question for the smoke.

### Driver

`harnesses/serve-smoke.ts` runs one image in serve mode against a world started in-process on `0.0.0.0` (containers reach it as `host.docker.internal`), the way the runner does: four mounts plus `/he-turns`, the serve environment, stdin closed, no TTY, the calling user. It drives three turns (member A in a DM, member B in a shared channel, A again in the DM, so per-session memory shows), posts each member message and each reply through the Slack mock, fences and snapshots the world, stops the container with SIGTERM and writes `smoke.json`, `events.jsonl`, `snapshot.json` and the container's logs under `results/serve-smoke/<trial-id>/`. For QM it drives the compose stack with `HE_ENTRY=serve` and `HE_TURNS`, and runs `prepare.sh` and `capture.sh` like `run-trial.sh`.

```sh
bun harnesses/serve-smoke.ts --harness _fake --trial-id fake-serve-1
bun harnesses/serve-smoke.ts --harness openclaw --trial-id openclaw-serve-1 \
  --base-url http://host.docker.internal:8787/anthropic --api-key sk-trial-openclaw-serve-1
```

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

Everything the harness prints goes to `$HE_LOG_DIR/stdout.log` and `$HE_LOG_DIR/stderr.log`. The adapter's own lines go to `$HE_LOG_DIR/adapter.log`, each with a UTC timestamp, the harness name and the trial id. A harness-native transcript (OpenClaw's JSON envelope, QM's turn result) goes beside them, and on a gbrain-docs cell `gbrain-install.json` (above). Nothing is written to `/workspace` except by the harness doing the task and, on a gbrain-docs cell, the adapter's copy of gbrain's documented install before the first turn.

## Two topologies

**In-container** (OpenClaw, Hermes): one image holds the harness. The runner mounts the three paths, sets the environment and runs `adapter.sh run` as the container's entrypoint.

**Sidecar** (QM): the harness is a service stack. `harnesses/qm/compose.yaml` runs Postgres, QM core and a task container whose entrypoint is `adapter.sh`; the task container posts one turn to core over HTTP. Two hooks extend the protocol for this topology: `prepare.sh <out>` runs before the stack starts (creates bind-mount targets, mints per-trial secrets) and `capture.sh <out>` runs after the task container exits and before teardown (copies world state the stack holds outside `/workspace` into it, removes per-trial sandboxes). Everything in the stack is fresh per trial.

## Driver

`harnesses/run-trial.sh` is the M0 single-turn driver for both topologies. It creates `workspace/`, `state/`, `logs/` and `turns/` under an output directory, copies the task's `instruction.md` in, runs the image or stack with `run`, runs the task's grader on the workspace and writes `result.json` with exit code, termination, grade and wall time. `runner/run.ts` is the trial runner for multi-user trials; `harnesses/serve-smoke.ts` (below) is the serve-mode counterpart of this script.

```sh
harnesses/run-trial.sh --harness openclaw --task tasks/hello --trial-id t1 \
  --base-url http://host.docker.internal:8787/anthropic --api-key sk-trial-t1
```

## Conformance

`bun test tests/adapter-conformance.test.ts` proves the protocol on the fake harness. For `run`: exit 0, 2, 3 and 124 under the conditions above; nothing written outside `/workspace`, `/harness-state` and `$HE_LOG_DIR` (at the process level by listing the temp tree, at the container level with `docker diff`); state in `/harness-state`; a stdin-closed, no-TTY run that completes; a no-op instruction that leaves the workspace untouched. For `serve`: the ready file appears; requests are answered in order with the right session key and a per-session turn counter; a sleep past a 2 s budget yields 124 within the kill grace, `[fake:model_error]` yields 3 and `[fake:harness_error]` yields 2 while the loop keeps serving; a `[fake:call post_message ...]` marker lands as a `chat.postMessage` event by the bot in an in-process world; nothing is written outside the four writable places and no `.tmp` file is left; SIGTERM at idle and during a turn both end the process with exit 0 within seconds. The container-level test runs the same through `docker run ... serve` and `docker stop`. Container-level tests skip when no Docker daemon is reachable; the whole file runs in about 12 s.

## Changelog

### 2026-10-25: the installer rung's per-turn hook (internal-task, internal-task at gbrain 10949a15)

harness-evals v0.0.8. Under `HE_GBRAIN_INSTALL=gbrain-installer` with a bundle that records `installer.turn_hook`, the OpenClaw adapter installs the hook-only plugin and the Hermes adapter merges the marked `hooks: pre_llm_call` block and the allowlist; each keeps the harness's own account of the hook as a per-trial receipt (`logs/gbrain-hook.openclaw.json`, `logs/gbrain-hook.hermes.log`) and exits 2 with HE-ADAPTER-006 before `ready` unless it is loaded or healthy; `ready` carries `gbrain_install.turn_hook`. The Hermes adapter reads all of `hermes --version`, so the `SOUL.md` seed is never cut short by a closed pipe. The OpenClaw run entry refuses a hook view.

### 2026-10-25: gbrain's documented install (internal-task, the install ladder)

harness-evals v0.0.5. Three serve variables, `HE_GBRAIN_INSTALL`, `HE_GBRAIN_SPLIT` and `HE_GBRAIN_INSTALL_DIR`, and the read-only `/he-gbrain-install` mount; the OpenClaw and Hermes adapters verify and copy the view before ready and write `gbrain-install.json`, HE-ADAPTER-006 on any failure; `adapter_sha256` and `gbrain_install` in `ready`; the keyless observation of what each harness loads; `tests/adapter-install.test.ts`.

### 2026-10-24: inner-harness configs and thread sessions (internal-task)

`HE_HARNESS_CONFIG` carries the cell's `config` to the adapter and the compose stack; QM's `prepare.sh` maps it to the inner harness, the memory quiet time and the two probe settings; every adapter keys a thread turn's session with `:t<thread_ts>`; QM's `capture.sh` dumps the trial's database.

### 2026-10-24: gbrain beside world (gbrain arm lane D)

harness-evals v0.0.5. Two optional serve variables, `HE_GBRAIN_MCP_URL` and `HE_GBRAIN_MCP_TOKEN`; each adapter registers a second MCP server named `gbrain` when they are set and is unchanged when they are not; the fake harness's `[fake:gbrain]` marker.

### 2026-10-22: serve implemented (M1 lane C)

harness-evals v0.0.3. `serve` is implemented for the fake harness, OpenClaw, Hermes Agent and QM: the file-queue details settled (naming, atomic writes, per-turn budget and kill grace, ready file, SIGTERM), the per-harness session keying and world-MCP wiring table, the `serve-smoke.ts` driver, and the serve conformance tests. Live proof: three turns each on OpenClaw, Hermes and QM through the metering proxy (receipts in each harness README).

### 2026-10-22: Protocol written for M0

harness-evals v0.0.1. First version: environment, mounts, exit codes, logs, the `run` entry and the reserved `serve` lifecycle, two topologies, the M0 driver. Proven on the fake harness and on live hello-world trials of OpenClaw, Hermes Agent and QM; see each harness's README under `harnesses/`.
