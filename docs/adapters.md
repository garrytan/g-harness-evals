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
| `HE_MODEL_BASE_URL` | Provider-specific base URL on the proxy, for example `http://host.docker.internal:8787/<slot>/anthropic`. The harness appends its usual path (`/v1/messages`). |
| `HE_MODEL_API_KEY` | The per-trial token: `trial-token:<id>.<32 hex>`, random per trial since 2026-10-28 (`trial-token:<id>` before that, `sk-trial-<id>` before 2026-10-26). The proxy forwards a request on the trial's slot only when it presents this token, and meters it under `trial-token:<id>`; a request on the slot without it is refused 403 and logged under `slot:<id>`, outside the trial's usage. Send it as the provider's credential and nothing else. |
| `HE_MODEL_NAME` | Model id as the provider names it, for example `claude-sonnet-5-5`. The adapter pins the harness to exactly this model; model fallback is forbidden. |
| `HE_TIME_BUDGET_S` | Wall-clock budget for the turn, in seconds. |
| `HE_LOG_DIR` | Writable directory outside `/workspace` for the adapter's own log, the harness's stdout and stderr, and any harness-native transcript. |
| `HE_SESSION_STATE_DIR` | `/harness-state`. Writable. HOME, XDG dirs and every path in `pin.json` `state_paths` live under it. |
| `HE_TASK_SLICE` | `multiuser`, `work`, `continuity`, `coding` or `smoke`. Informational. |
| `HE_TRIAL_ID` | The preallocated trial id. Used in log lines and as the harness's thread or session reference. |
| `HE_SESSION_SCOPE` | `conversation` (default, absent unless the cell sets `session_scope`) or `turn`. Serve only. `turn` keys the harness session per turn (`turn:<NNNN>`) instead of per conversation: the memoryless contrast cell of the v0.2 pilot. Implemented by the OpenClaw adapter; Hermes and QM exit 2 on `turn` so a cell that asks for it never runs per-conversation sessions in silence. |
| `HE_HARNESS_CONFIG` | The cell's `config` string, empty when the cell has none. Serve and run. QM reads it in `prepare.sh`: `pi` (default) runs QM as shipped; `pi-probe` adds a 5 s memory capture quiet time; `pi-strict` and `pi-command-deny` add an admin PUT before the first turn (`harnesses/qm/pin.json` `configs`); any other value exits 2. OpenClaw and Hermes read it as the instruction route: unset, empty or `default` changes nothing (byte-identical to the adapters before, `tests/instruction-route.test.ts`); `route-tool`, `route-system` (Hermes only; OpenClaw 2026.10.6 has no such setting), `route-startup`, `route-hook` and `route-skill` deliver `/opt/harness/routes/instruction.md` through the carrier [harnesses/routes/README.md](../harnesses/routes/README.md) names and record it in `$HE_LOG_DIR/instruction-route.json` and `ready.instruction_route`; any other value exits 2 (HE-ADAPTER-007). Claude Code and Codex read it as internal-task's ablation config: unset, empty or `default` adds nothing; `official-minimal` replaces the harness's own system prompt (Claude Code) or base instructions (Codex) with `ablation/official-minimal.txt`, checked against `pin.json` `official_minimal.sha256`. All four harnesses (Claude Code on the cli driver) also read H10's grammar, `[<driver>+]<route>[@<slot_id>]`, under "Route config" below; on Claude Code and Codex any other value exits 2 (HE-ADAPTER-007). Harness Zero reads it as its set: `zero-min`, `zero-full` (unset or empty), `zero-full-no-<slug>` or a set in `harnesses/harness-zero/config/candidates.json`; any other value exits 2 before ready (HE-ZERO-001), and plan, dry-run and preflight refuse such a cell. |
| `HE_WORKSPACE_DIR` | Optional, defaults to `/workspace`. Exists so the process-level conformance test can run an adapter outside a container. Runners never set it. |

For `serve` the runner also sets:

| Variable | Meaning |
|---|---|
| `HE_TURNS_DIR` | The file queue, `/he-turns`, a read-write mount. The runner writes requests here, the adapter writes responses beside them. |
| `HE_WORLD_MCP_URL` | The world-MCP Streamable HTTP endpoint as the container reaches it, for example `http://host.docker.internal:8791/mcp`. |
| `HE_WORLD_MCP_TOKEN` | The bot's world-MCP bearer token for this trial. Every tool call the harness makes is attributed to the bot. |
| `HE_SLACK_API_URL`, `HE_SLACK_BOT_TOKEN`, `HE_SLACK_APP_TOKEN` | The Slack mock, for a harness whose native Slack connector can point at it. No adapter uses them yet; the runner posts every message. |
| `HE_GBRAIN_MCP_URL`, `HE_GBRAIN_MCP_TOKEN` | The gbrain arm only ([docs/gbrain-arm.md](gbrain-arm.md)): the world's `/gbrain` tap (`<world>/gbrain`) and the same bot token. Set, the adapter registers a second MCP server named `gbrain` exactly as it registers `world`; unset, nothing in the adapter changes and the harness configuration is byte-identical to a cell without gbrain. |
| `HE_GBRAIN_INSTALL`, `HE_GBRAIN_SPLIT`, `HE_GBRAIN_INSTALL_DIR` | The install ladder's docs and installer rungs only ([docs/gbrain-arm.md](gbrain-arm.md)): `HE_GBRAIN_INSTALL=gbrain-docs` tells the adapter to apply gbrain's documented install, `gbrain-installer` what `gbrain setup <harness> --instructions-only` wrote, from the view mounted read-only at `HE_GBRAIN_INSTALL_DIR` (`/he-gbrain-install`) for the split `HE_GBRAIN_SPLIT` (`dev` or `heldout`) before the harness is prepared; the view's manifest must name the same install kind. See "gbrain's documented install" below. Unset, nothing in the adapter runs. |

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

## Network

A harness container reaches the metering proxy, the world and the gbrain tap as `host.docker.internal` on every cell, so an adapter writes the same URLs whichever network its cell runs on.

- Default: `--network bridge --add-host host.docker.internal:host-gateway`, with the proxy and the world listening on the bridge gateway (172.17.0.1 unless the daemon says otherwise). The container can also open connections to the internet. It holds only the per-trial token, so a direct model call fails, but nothing else is blocked.
- `network: "internal"` on the cell: the runner creates one docker network per run, `he-net-<run id>`, with `--internal` and inter-container traffic off, starts the container on it with `--add-host host.docker.internal:<that network's gateway>`, binds the proxy and the world to that gateway (read with `docker network inspect`, never 0.0.0.0), and removes the network when the invocation ends. The container has no DNS and no route off the machine, so a direct connection to a provider or any other outside host fails. `host-gateway` is not used there because it resolves to the bridge gateway, which an internal network cannot route to. A gbrain sidecar joins the same network; internal networks publish no ports, so the world reaches the sidecar at its address on the network, and the harness cannot reach it.
- Every pilot harness serves there: Claude Code, Codex, OpenClaw, Hermes and Harness Zero each complete a turn through the lease-mode proxy, land a world-MCP call, and fail a direct connection to an outside host from inside the container (`tests/internal-network-harnesses.test.ts`, keyless). A `codex` cell must carry `network: "internal"` (HE-NET-001 at preregistration), because Codex calls chatgpt.com directly when its plugins are on: the adapter turns them off, and the internal network rules out any direct connection the config missed. Its same-model OpenClaw and Hermes controls run on the same network so the comparison is like for like. A `harness-zero` cell must carry it too (HE-NET-001): Harness Zero is meant to reach only the proxy, the world and the gbrain tap. Hermes still tries to download its `tirith` scanner during a turn; there it fails on DNS and Hermes falls back to pattern matching (its lazy PyPI installs are off in both configs).
- An internal cell runs in docker mode on a multi-user slice with an in-container harness. A compose harness (QM), a single-shot slice, process or scripted mode, and an invocation that mixes internal and default harness cells are refused with HE-NET-001 ([errors](errors.md)): the run's one proxy listens on one gateway, so such cells run in separate invocations with `--cells`.

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
| Claude Code 2.1.312 | `claude -p --output-format stream-json --verbose --model <model> --permission-mode bypassPermissions --disallowedTools WebSearch,WebFetch --mcp-config <file> --strict-mcp-config` with `--session-id <uuid>` for a new key or `--resume <uuid>`, prompt on stdin; reply from the `result` record | UUIDv5 of `dm:<member>` or `channel:<id>`, transcripts under `CLAUDE_CONFIG_DIR` (`/harness-state/claude`) | `/harness-state/mcp.json` (mode 0600), `mcpServers.world` as HTTP with the bearer; `tools/list` probed before ready; the CLI defers MCP tools behind its ToolSearch tool | CLI, one session per conversation; no gateway |
| Codex 0.165.0 | `codex exec --json --skip-git-repo-check --strict-config -C /workspace -` for a new key, `codex exec resume <id> --json --skip-git-repo-check --strict-config -` after; reply from the last `agent_message` item | thread id per key in `/harness-state/codex-threads.json`; sessions in `CODEX_HOME` (`/harness-state/codex`) | `[mcp_servers.world]` streamable HTTP in `$CODEX_HOME/config.toml`, bearer from env; `tools/list` probed before ready | CLI, one thread per conversation; no gateway |
| Harness Zero | in-process: `bun /opt/harness/zero.ts serve` runs each turn's model loop itself (no child process), non-streamed Anthropic Messages, OpenAI Responses or Chat Completions by the last segment of `HE_MODEL_BASE_URL`; reply = the turn's last assistant text | `dm:<member>`, `channel:<id>` (`:t<thread_ts>` for a thread); one JSON file per key under `/harness-state/zero/sessions/`, named sha256(key); `HE_HARNESS_CONFIG` picks the feature set | none on disk: `zero.ts` is its own MCP client (Streamable HTTP, JSON or SSE, `Mcp-Session-Id`), initialized with the bearer before ready; tools as `mcp__world__<tool>` | one process, one session per conversation; notes shared within one scope only under `scoped-notes` |
| QM main@b6786d67 (the pin before the internal-task amendment; multi-user cells run from a worktree there because serve can't register the world MCP at 90e4ced7) | `POST /v1/turns` with `actor.externalId` = the requester's Slack user id and `conversation` `{kind: dm, threadRef: dm:<member>}` or `{kind: channel, threadRef: channel:<id>, channelRef, channelName}`; reply from `TurnResult.reply` | QM scopes `personal:<slack user id>` and `channel:<id>`, in Postgres; `HE_HARNESS_CONFIG` selects the probe configs (Pi is QM's only loop at this pin; `claude` was removed upstream) ([harnesses/qm/pin.json](../harnesses/qm/pin.json) `configs`) | `PUT /v1/admin/mcp-servers/world` as admin `harness-admin` (`ADMIN_GRANTS` in `config/core.env`) with `auth: bearer`, `readOnly: false`; core probes `tools/list` before saving | QM's native scoping; the actor is the requester on every turn |

The bearer token in each MCP config is the per-trial bot token the world minted; it is in the runner's redaction set and never a provider key.

Every adapter appends `:t<thread_ts>` to its session key when `TurnRequest.thread_ts` is set: a task turn with `thread = "new"` therefore opens a new harness session inside the same conversation and scope, which is how "remembered across sessions" is tested the same way on every harness. No turn without that field changes.

### Route config (H10, internal-task)

**Status: built on all four harnesses: OpenClaw and Hermes (H10 PR 2), Codex (H10 PR 3), and Claude Code on both drivers, `cli` (H10 PR 3) and the Agent SDK drivers `sdk-preset` and `sdk-default` (H10 PR 4).** H10 PR 5 has the runner write the TurnWindow fields. Until an adapter implements a route, it refuses it with HE-ADAPTER-007. The route table per harness is in [harnesses/routes/README.md](../harnesses/routes/README.md), "Routes on four harnesses".

**Grammar.** A cell's `config` reaches the adapter as `HE_HARNESS_CONFIG`, as today, so there is no new cell key and no runner change.

- **The form:** `[<driver>+]<route>[@<slot_id>]`, parsed by `parseRouteConfig(config, harness)` in [runner/contracts.ts](../runner/contracts.ts).
- **Drivers** (`ROUTE_DRIVERS`): `cli` (the default when none is named), `sdk-preset` and `sdk-default`. A driver prefix is legal on `claude-code` only.
- **Routes** (`ROUTE_NAMES`): `default` (also the empty string), `route-tool`, `route-hook`, `route-once`, `route-system`, `route-startup`, `route-skill`, `route-told`, `route-placebo`, `route-slot-told` and `route-slot-skill`.
- **Slot id:** the two slot routes need `@<slot_id>` (`[a-z0-9][a-z0-9-]{0,62}`). No other route takes one.
- **Refusals:** an unknown driver or route, a driver prefix off Claude Code, a missing or malformed slot id, and a slot id on another route. Each throws an `HE-ADAPTER-007 HE_HARNESS_CONFIG=<config> ...` message.
- **Route cells only:** `parseRouteConfig` parses the config of a route cell. The configs that are not routes stay outside the grammar and keep their adapters' own checks: Claude Code's and Codex's `official-minimal` (internal-task) and QM's `pi` configs. `parseRouteConfig` refuses them, so a caller parses only route cells.

| Config | Harness | Parses to |
|---|---|---|
| `route-hook` | any | `{driver: "cli", route: "route-hook"}` |
| `route-once` | any | `{driver: "cli", route: "route-once"}` |
| `sdk-preset+route-told` | claude-code | `{driver: "sdk-preset", route: "route-told"}` |
| `sdk-default+route-skill` | claude-code | `{driver: "sdk-default", route: "route-skill"}` |
| `sdk-preset+route-slot-told@geva-2` | claude-code | `{driver: "sdk-preset", route: "route-slot-told", slot: "geva-2"}` |
| `sdk-preset+route-hook` | openclaw, hermes, codex | refused: only claude-code takes a driver |

**Emit flag.** The hook routes (`route-hook`, `route-once`, `route-placebo`) share one protocol, so the hook itself keeps no state.

1. Before it hands a turn to the harness, the adapter computes the turn's session key (the `TurnWindow.session_key` definition below) and `session_turn`, the 1-based count of turns it has handed to that session.
2. It writes `emit=1` or `emit=0` to `$HE_SESSION_STATE_DIR/he-route/emit` (temp file, then rename). `route-hook` and `route-placebo` always write `emit=1`. `route-once` writes `emit=1` only when `session_turn` is 1.
3. The harness runs the turn. The harness's hook runs one stateless script that reads the flag and prints the rule bytes (`/opt/harness/routes/instruction.md`), the placebo bytes (`/opt/harness/routes/placebo.md`) or nothing.

**Per-turn route status.** On a route cell, the adapter writes one `RouteTurnStatus` per answered turn to `$HE_LOG_DIR/turns/turn-NNNN.route.json`:

| Field | Meaning |
|---|---|
| `config` | the cell's config string as received |
| `driver` | `cli`, `sdk-preset` or `sdk-default` |
| `route` | the parsed route |
| `session_key` | the turn's session, defined as `TurnWindow.session_key` |
| `session_turn` | 1-based, the adapter's view |
| `emitted` | hook routes: what the emit flag said this turn; `null` on every other route |

It is an exposure receipt only. The scorer never reads it to choose which turns it analyses.

**TurnWindow additions.** Two optional fields, so turns.jsonl files written before them still parse:

- `thread_ts`: the Slack thread ts the turn was posted in, or `null` for a top-level message.
- `session_key`: `<channel id>`, or `<channel id>:<thread_ts>` in a thread.

The metering proxy's usage line also gains two optional fields, written only on a route cell's slot (runner/trial/routes.ts) when the run has a route cell, so every other line is byte-identical to before (`tests/metering-proxy-route-copies.test.ts`):

- `route_copies`: copies of the rule or placebo in the forwarded request by location (`system`, `user` for the current member turn, `tool_result`, `history` for everything earlier), plus `listing`, copies of a skill description outside tool results. Counts only. `scripts/instruction-followed-h10.ts` reads discovery and load from them.
- `housekeeping: true`: a request for a model other than the cell's own (a harness's utility model). It carries no `route_copies`, and count_tokens and refused lines carry neither field.

### gbrain beside world

In a gbrain-arm cell the runner sets `HE_GBRAIN_MCP_URL` and `HE_GBRAIN_MCP_TOKEN`, and each adapter adds a server named `gbrain` with the same shape as `world`: OpenClaw `openclaw mcp set gbrain {url, transport: streamable-http, headers.Authorization}`; Hermes an `mcp_servers.gbrain` block appended beside `world` (tools register as `mcp__gbrain__<tool>`); QM `PUT /v1/admin/mcp-servers/gbrain` as `harness-admin`, whose `tools/list` probe before saving is the discovery proof (`qm-gbrain-register.json`); the fake harness answers `[fake:gbrain ...]` markers. Each `pin.json` records this under `gbrain_mcp`. The URL is the world's tap, so every call the harness makes to gbrain is a `via: "gbrain"` event in the trial's log (world/README.md), and the harness never holds the sidecar's own token. `tests/adapter-conformance.test.ts` proves the fake path against a fake sidecar; the live smoke of the three real harnesses is in docs/gbrain-arm.md.

### gbrain's documented install

The install ladder's `docs` rungs ask what changes when gbrain is installed the way its own documentation says, not only registered as an MCP server. The gbrain image holds that install, run once at image build with the gbrain CLI ([gbrain/README.md](../gbrain/README.md), "The install bundle"), and the runner's `preflight` exports the harness and split's view of it with a manifest that lists every file's sha256 and a `view_digest`; each trial verifies the view again and mounts it read-only at `/he-gbrain-install` with `HE_GBRAIN_INSTALL=gbrain-docs`, `HE_GBRAIN_SPLIT` and `HE_GBRAIN_INSTALL_DIR`. The adapter then does what the documented command would have done in `/workspace`, before the MCP wiring and before `ready`:

1. It reads `manifest.json` in the view and refuses a view for another harness or split, or whose `view_digest` does not match its file list.
2. It checks every listed file against its sha256 and copies `workspace/<x>` to `/workspace/<x>` (`skills/` at the pinned gbrain commit: the five core skills in 30 files for OpenClaw from gbrain 0.60.456.0, 64 skills in 127 files before that and for Hermes at every pin, see docs/gbrain-arm.md; what `gbrain skillpack scaffold --harness openclaw --workspace /workspace` writes for OpenClaw and `gbrain skillpack scaffold --all` for Hermes); Hermes also copies `.hermes.md`, the split's compiled context from `gbrain compile-context --target hermes --include-core`, to `/workspace/.hermes.md`. A destination that already exists is refused, as `skillpack scaffold` refuses to overwrite. Each copy is checked again.
3. It writes `$HE_LOG_DIR/gbrain-install.json`: `status` (`ok` or `error`), `code` (`HE-ADAPTER-006` on error), `harness`, `split`, `install`, `dir`, `view_digest`, `files`, `destinations` (the top-level entries, `/workspace/skills` and for Hermes `/workspace/.hermes.md`), `copied` (every destination path) and `error`; `ready` repeats `status`, `install`, `files`, `view_digest` and `destinations` under `gbrain_install`.

The `installer` rung (gbrain#7489) goes through the same step with `HE_GBRAIN_INSTALL=gbrain-installer` and the installer view, what `gbrain setup <harness> --instructions-only` wrote at image build: OpenClaw gets `workspace/AGENTS.md` at `/workspace/AGENTS.md`, the brain-first block in the workspace bootstrap file OpenClaw loads into its system prompt (`skipBootstrap` only stops OpenClaw seeding the file itself); Hermes gets `home/SOUL.md` at `$HERMES_HOME/SOUL.md`, Hermes's own default `SOUL.md` at the pinned Hermes commit with the block appended. Hermes writes that default `SOUL.md` into `HERMES_HOME` when the adapter runs `hermes --version`, the "ran Hermes once" gbrain's installer needs before it writes anything, so the Hermes adapter replaces a `SOUL.md` whose sha256 equals the seed the bundle records (`replaced_seed` in `gbrain-install.json`) and refuses any other content. tests/adapter-install.test.ts proves, against a fake Anthropic endpoint on the host and no key, that both harnesses carry the block into the system prompt of their first model request. When the bundle's `installer.turn_hook` is present (gbrain#7489 at `10949a15`), the same step installs gbrain's per-turn hook through the harness's own extension point: OpenClaw copies the hook-only plugin to `$OPENCLAW_STATE_DIR/gbrain/gbrain-turn-rule/`, runs the three recorded `openclaw plugins`/`config` commands and keeps `openclaw plugins inspect gbrain-turn-rule --runtime --json` as `logs/gbrain-hook.openclaw.json` (the plugin must be `loaded` with `before_prompt_build`); Hermes merges the marked `hooks: pre_llm_call` block from the bundle's `home/config.yaml` into its own `config.yaml`, copies `shell-hooks-allowlist.json` and keeps `hermes hooks doctor` as `logs/gbrain-hook.hermes.log` (the hook must be healthy). `ready` then carries `gbrain_install.turn_hook` (`loaded` or `healthy`), and the test proves the rule is in the first request's messages ([docs/gbrain-arm.md](gbrain-arm.md), "The per-turn hook"). `gbrain-install.json` then also carries `turn_hook` (`status`, `detail`; for OpenClaw `plugin_dir` and the `commands` run, for Hermes `doctor_exit`) and, for Hermes, `merged_hooks` (the `config.yaml` path, the block's sha256 and its size). Hermes refuses a `config.yaml` that already has a `hooks:` section and an allowlist file that already exists; either adapter refuses a view whose hook files and manifest `turn_hook` disagree. OpenClaw applies the hook under the `serve` entry only: under `run` the exec state directory would not see the plugin, so an installer view with the hook is refused with HE-ADAPTER-006. Claude Code and Codex take the same variable for the installer view gbrain `5fd43d5a` (gbrain#7989) writes; each adapter runs the installed `UserPromptSubmit` hook once before ready, and `ready` carries `gbrain_install.turn_hook: "ran"` ([docs/gbrain-arm.md](gbrain-arm.md), "The Claude Code and Codex installer").

Any failure is one code, HE-ADAPTER-006 (the install bundle could not be applied), printed to `adapter.log` with the reason, and exit 2 before `ready`; the runner records a pre-ready exit 2 as `harness_error`, so the mount is checked by `preflight` first. With `HE_GBRAIN_INSTALL` unset the step does not run and the adapters behave as before; the one visible change for every cell is the `adapter_sha256` field in `ready`.

What each harness does with the landed files was read keylessly from the installed source in the images and is recorded in each `pin.json` under `gbrain_install` with the file and line: OpenClaw 2026.10.6 lists `/workspace/skills` as workspace skills (`src/skills/loading/workspace-skill-roots.ts`; `openclaw skills list --json` shows all 64 scaffolded skills with source `openclaw-workspace`, eligible and model-visible); Hermes v2026.9.24 loads `/workspace/.hermes.md` as its project context from the cwd (`agent/prompt_builder.py`, `_find_hermes_md` and `build_context_files_prompt`) and reads no skills from `/workspace/skills` (`agent/skill_utils.py`: `HERMES_HOME/skills`, `skills.external_dirs` and trusted `<git root>/.hermes/skills` only), so on the Hermes docs rung the skills copy is inert and the brain's index reaches the model through `.hermes.md`. `tests/adapter-install.test.ts` proves the landing, the record, the ready fields, both observations and a one-byte tamper against the images built from the checkout, with no model call. Whether a model reads a landed skill in a turn is a paid question for the smoke.

### Driver

`harnesses/serve-smoke.ts` runs one image in serve mode against a world started in-process on the docker bridge gateway (containers reach it as `host.docker.internal`; since 2026-10-28 nothing binds 0.0.0.0), the way the runner does: four mounts plus `/he-turns`, the serve environment, stdin closed, no TTY, the calling user. It drives three turns (member A in a DM, member B in a shared channel, A again in the DM, so per-session memory shows), posts each member message and each reply through the Slack mock, fences and snapshots the world, stops the container with SIGTERM and writes `smoke.json`, `events.jsonl`, `snapshot.json` and the container's logs under `results/serve-smoke/<trial-id>/`. For QM it drives the compose stack with `HE_ENTRY=serve` and `HE_TURNS`, and runs `prepare.sh` and `capture.sh` like `run-trial.sh`.

```sh
bun harnesses/serve-smoke.ts --harness _fake --trial-id fake-serve-1
bun harnesses/serve-smoke.ts --harness openclaw --trial-id openclaw-serve-1 \
  --base-url http://host.docker.internal:8787/openclaw-serve-1/anthropic --api-key "$cred"
```

A lease-mode proxy forwards only for a bound slot, and on a slot bound with a token only to a caller presenting it (the runner binds every trial slot that way; the embedded image build binds its own slot without one), so the slot `openclaw-serve-1` is bound with `$token` through `POST /__proxy/bind` first ([harnesses/README.md](../harnesses/README.md), "Run one trial").

The bind body is `{slot, key, token?, models?}`. `models` is a list of `provider:model` ids: in lease mode (the mode every trial uses; in-process mode ignores it) on that slot the proxy forwards only requests for those models and refuses any other priced model with 403 before reserving, logged with its model and the reason, at $0. The run-wide `--allow-models` still applies on top, so a model must pass both. The runner binds each trial slot with its cell's model plus the cell's `utility_models`, and a gbrain sidecar slot with its embedding model, so a harness on one cell cannot spend on another cell's model although that model is on the run's allowlist (a Codex subagent on a Sol cell's model, for example). A bind without `models` has no per-slot limit, as before.

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

On a Particle cell the runner reads Particle's answers from the proxy's usage lines and can override this table (HE-MODEL-002, [errors](errors.md)): a 400 with `error.code` `invalid_value` or `unsupported_parameter`, or any 402, makes the trial `model_error` whatever the exit, and an exit 3 on any other 400 is `harness_error` unless the trial also logged a 429, a 5xx or a failed request. No adapter sees Particle's `error.code`, so none of them changes.

## Logs

Everything the harness prints goes to `$HE_LOG_DIR/stdout.log` and `$HE_LOG_DIR/stderr.log`. The adapter's own lines go to `$HE_LOG_DIR/adapter.log`, each with a UTC timestamp, the harness name and the trial id. A harness-native transcript (OpenClaw's JSON envelope, QM's turn result) goes beside them, and on a gbrain-docs cell `gbrain-install.json` (above). Nothing is written to `/workspace` except by the harness doing the task and, on a gbrain-docs cell, the adapter's copy of gbrain's documented install before the first turn.

## Two topologies

**In-container** (OpenClaw, Hermes): one image holds the harness. The runner mounts the three paths, sets the environment and runs `adapter.sh run` as the container's entrypoint.

**Sidecar** (QM): the harness is a service stack. `harnesses/qm/compose.yaml` runs Postgres, QM core and a task container whose entrypoint is `adapter.sh`; the task container posts one turn to core over HTTP. Two hooks extend the protocol for this topology: `prepare.sh <out>` runs before the stack starts (creates bind-mount targets, mints per-trial secrets; QM's also refuses an image whose `harness-eval.commit` label is not `pin.json`'s commit, and a refusal stops the trial before the stack starts) and `capture.sh <out>` runs after the task container exits and before teardown (copies world state the stack holds outside `/workspace` into it, removes per-trial sandboxes). Everything in the stack is fresh per trial.

## Driver

`harnesses/run-trial.sh` is the M0 single-turn driver for both topologies. It creates `workspace/`, `state/`, `logs/` and `turns/` under an output directory, copies the task's `instruction.md` in, runs the image or stack with `run`, runs the task's grader on the workspace and writes `result.json` with exit code, termination, grade and wall time. `runner/run.ts` is the trial runner for multi-user trials; `harnesses/serve-smoke.ts` (below) is the serve-mode counterpart of this script.

```sh
harnesses/run-trial.sh --harness openclaw --task tasks/hello --trial-id t1 \
  --base-url http://host.docker.internal:8787/t1/anthropic --api-key "$cred"
```

The slot `t1` is bound with `$cred` first, as above.

## Conformance

`bun test tests/adapter-conformance.test.ts` proves the protocol on the fake harness. For `run`: exit 0, 2, 3 and 124 under the conditions above; nothing written outside `/workspace`, `/harness-state` and `$HE_LOG_DIR` (at the process level by listing the temp tree, at the container level with `docker diff`); state in `/harness-state`; a stdin-closed, no-TTY run that completes; a no-op instruction that leaves the workspace untouched. For `serve`: the ready file appears; requests are answered in order with the right session key and a per-session turn counter; a sleep past a 2 s budget yields 124 within the kill grace, `[fake:model_error]` yields 3 and `[fake:harness_error]` yields 2 while the loop keeps serving; a `[fake:call post_message ...]` marker lands as a `chat.postMessage` event by the bot in an in-process world; nothing is written outside the four writable places and no `.tmp` file is left; SIGTERM at idle, both before any turn has run and after turns, and SIGTERM during a turn end the process with exit 0 within seconds. The container-level test runs the same through `docker run ... serve` and `docker stop`. Container-level tests skip when no Docker daemon is reachable; the whole file runs in about 12 s.

The same file also runs the shared `run` and `serve` assertions once per adapter that has a fixture: today `_fake` and `harness-zero`. A fixture supplies the model upstream, the workload (the prompt that makes a turn reply, pass its budget, fail at the model, fail in the harness or post through the world MCP) and the state layout the adapter keeps. The fake-only assertions above do not change. File-writing assertions stay fake-only, because Harness Zero has no file tools.

## Changelog

### 2026-11-01: the Claude Code Agent SDK drivers (internal-task, H10 PR 4)

"Route config" says Claude Code now runs the `sdk-preset` and `sdk-default` drivers. Why: H10 PR 4 adds the Agent SDK driver (harnesses/claude-code/README.md, "Agent SDK driver").

### 2026-11-01: the proxy writes route copies and housekeeping (internal-task)

"Route config" now says when the usage line carries `route_copies` (with its `listing` count) and `housekeeping`, and what each location means. Why: H10 PR 5 builds the proxy side of the contract, and the scorer reads discovery and load from it.

### 2026-11-01: Claude Code and Codex read the route config (internal-task, H10 PR 3)

The `HE_HARNESS_CONFIG` row and "Route config" say Claude Code (cli driver) and Codex now implement the grammar, the emit flag and the per-turn route status. Why: H10 PR 3 builds those two adapters.

### 2026-11-01: route config grammar, emit flag, per-turn route status and TurnWindow session fields

Added "Route config", and the `HE_HARNESS_CONFIG` row points to it. It holds the grammar `[<driver>+]<route>[@<slot_id>]` with examples, the emit-flag protocol for the hook routes, the per-turn route status fields, `TurnWindow.thread_ts` and `session_key`, and the proxy's `route_copies` and `housekeeping` fields. Why: H10 runs the route test on four harnesses and its later pull requests build to this contract. No adapter changes yet.

### 2026-11-01: Particle error codes can override the exit table (internal-task)

A paragraph under "Exit codes" says that on a Particle cell the runner's HE-MODEL-002 rule, read from the proxy's usage lines, can override the exit-code table. The adapters did not change. Why: plan decision 12 counts a listed Particle 400 or a 402 as a model error and any other 400 as the harness's fail, and no adapter sees Particle's `error.code`.

### 2026-10-31: Harness Zero

The `HE_HARNESS_CONFIG` row names Harness Zero's sets, "Per harness" gains a Harness Zero row, and "Network" says a `harness-zero` cell must run on the internal network. "Conformance" says the shared assertions run per adapter fixture, with Harness Zero the second fixture. `serve-smoke.ts` gains `--fake-upstream` ([harnesses/README.md](../harnesses/README.md)). Why: Harness Zero is the fully known control harness for the feature runs.

### 2026-10-30: QM at main b6786d67

harness-evals v0.0.66. The `HE_HARNESS_CONFIG` and QM rows: QM removed its Claude harness at `b6786d67`, so `claude` and `claude-probe` are no longer QM configs; the QM row names the new pin. The Sidecar paragraph says QM's `prepare.sh` refuses an image not built from the pin.

### 2026-10-30: instruction routes for OpenClaw and Hermes

harness-evals v0.0.46. The `HE_HARNESS_CONFIG` row: OpenClaw and Hermes no longer ignore it; it names the instruction route, and `default` is unchanged. Why: run `anatomy-instruction-route-2026-11` sends one instruction to each harness through each route it supports, chosen per cell.

### 2026-10-29: per-slot model lists and every pilot harness on the internal network

harness-evals v0.0.42. `POST /__proxy/bind` takes an optional `models` list and the runner binds each trial slot with its cell's models. The "Network" section says all four pilot harnesses serve on the internal network, with the test that proves it, and that a Codex cell must use it. Why: a reviewer had a Codex trial on a Luna cell spend on another cell's model through the run-wide allowlist.

### 2026-10-29: Claude Code and Codex rows

harness-evals v0.0.42. "Per harness" gains Claude Code 2.1.312 and Codex 0.165.0. OpenClaw and Hermes read the provider from the last segment of `HE_MODEL_BASE_URL` (`/anthropic` or `/openai`); their Anthropic path is unchanged. Why: Garry asked for both as harnesses.

### 2026-10-29: the internal network option

harness-evals v0.0.42. New "Network" section. A cell with `network: "internal"` runs its harness container and gbrain sidecar on a per-run docker network with no DNS and no route off the machine, with `host.docker.internal` mapped to that network's gateway, where the proxy and the world listen, so adapters change nothing. A cell without the field gets the same `docker run` arguments and listen addresses as before.

### 2026-10-28: the proxy URL example names the trial slot

harness-evals v0.0.20. The `HE_MODEL_BASE_URL` example includes the slot path segment, matching the runner and the hand-run commands. The serve-smoke binding instructions link to the harness guide.

### 2026-10-27: the fake harness stops on a SIGTERM that lands as a turn starts

harness-evals v0.0.13. The protocol did not change. The fake harness's serve loop now ends a running turn from its TERM and INT trap itself, so a SIGTERM that lands after the turn is spawned and before the loop waits on it no longer keeps `serve` alive until the turn ends. The conformance test gains a case that stops an idle `serve` before any turn has run, and its SIGTERM-during-a-turn case waits for `adapter.log` to appear instead of failing when the file is not there yet; the Conformance paragraph names the idle case.

### 2026-10-25: the installer rung's per-turn hook (gbrain 10949a15)

harness-evals v0.0.8. Under `HE_GBRAIN_INSTALL=gbrain-installer` with a bundle that records `installer.turn_hook`, the OpenClaw adapter installs the hook-only plugin and the Hermes adapter merges the marked `hooks: pre_llm_call` block and the allowlist; each keeps the harness's own account of the hook as a per-trial receipt (`logs/gbrain-hook.openclaw.json`, `logs/gbrain-hook.hermes.log`) and exits 2 with HE-ADAPTER-006 before `ready` unless it is loaded or healthy; `ready` carries `gbrain_install.turn_hook`. The Hermes adapter reads all of `hermes --version`, so the `SOUL.md` seed is never cut short by a closed pipe. The OpenClaw run entry refuses a hook view.

### 2026-10-25: gbrain's documented install (the install ladder)

harness-evals v0.0.5. Three serve variables, `HE_GBRAIN_INSTALL`, `HE_GBRAIN_SPLIT` and `HE_GBRAIN_INSTALL_DIR`, and the read-only `/he-gbrain-install` mount; the OpenClaw and Hermes adapters verify and copy the view before ready and write `gbrain-install.json`, HE-ADAPTER-006 on any failure; `adapter_sha256` and `gbrain_install` in `ready`; the keyless observation of what each harness loads; `tests/adapter-install.test.ts`.

### 2026-10-24: inner-harness configs and thread sessions

`HE_HARNESS_CONFIG` carries the cell's `config` to the adapter and the compose stack; QM's `prepare.sh` maps it to the inner harness, the memory quiet time and the two probe settings; every adapter keys a thread turn's session with `:t<thread_ts>`; QM's `capture.sh` dumps the trial's database.

### 2026-10-24: gbrain beside world (gbrain arm lane D)

harness-evals v0.0.5. Two optional serve variables, `HE_GBRAIN_MCP_URL` and `HE_GBRAIN_MCP_TOKEN`; each adapter registers a second MCP server named `gbrain` when they are set and is unchanged when they are not; the fake harness's `[fake:gbrain]` marker.

### 2026-10-22: serve implemented (M1 lane C)

harness-evals v0.0.3. `serve` is implemented for the fake harness, OpenClaw, Hermes Agent and QM: the file-queue details settled (naming, atomic writes, per-turn budget and kill grace, ready file, SIGTERM), the per-harness session keying and world-MCP wiring table, the `serve-smoke.ts` driver, and the serve conformance tests. Live proof: three turns each on OpenClaw, Hermes and QM through the metering proxy (receipts in each harness README).

### 2026-10-22: Protocol written for M0

harness-evals v0.0.1. First version: environment, mounts, exit codes, logs, the `run` entry and the reserved `serve` lifecycle, two topologies, the M0 driver. Proven on the fake harness and on live hello-world trials of OpenClaw, Hermes Agent and QM; see each harness's README under `harnesses/`.
