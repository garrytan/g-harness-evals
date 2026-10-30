# OpenClaw harness

[OpenClaw](https://docs.openclaw.ai/) `2026.10.6` from npm, installed under `/opt/harness`. Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

`run` is one turn with `openclaw agent exec --message-file /workspace/instruction.md --cwd /workspace --config <state>/openclaw.json --state-dir <state>/exec --model anthropic/claude-sonnet-5-5 --json` ([docs](https://docs.openclaw.ai/cli/agent)). `agent exec` is OpenClaw's own headless path: no gateway, no onboarding, temporary run state under the directory we give it.

`serve` answers each `TurnRequest` with `openclaw agent --local --session-key agent:main:<key> --message-file <log>/turns/turn-NNNN.prompt.md --model anthropic/claude-sonnet-5-5 --timeout <budget> --json`, where `<key>` is `dm:<member>` or `channel:<id>`. `agent exec` has no session selector at this version (it is "one isolated headless embedded agent turn"), so serve uses the embedded `--local` path of `openclaw agent`, which does take `--session-key` and keeps every session in the one `OPENCLAW_STATE_DIR` (`agents/main/agent/openclaw-agent.sqlite`; the envelope's `meta.agentMeta.sessionFile` is the key). The gateway and its channel routing are not used. At serve start the adapter writes the world-MCP server into the config copy with `openclaw mcp set world '{"url": $HE_WORLD_MCP_URL, "transport": "streamable-http", "headers": {"Authorization": "Bearer $HE_WORLD_MCP_TOKEN"}}'` and logs `openclaw mcp probe` (14 tools). The reply is `payloads[].text` of the JSON envelope.

## Configuration

`config/openclaw.json` (JSON5) is copied to `/harness-state/openclaw/openclaw.json` at the start of a trial. It overrides the built-in `anthropic` provider's `baseUrl` and `apiKey` with `${HE_MODEL_BASE_URL}` and `${HE_MODEL_API_KEY}` (OpenClaw substitutes `${VAR}` from the environment), declares the `claude-sonnet-5-5` catalog row, pins `agents.defaults.model.primary`, and sets `agents.defaults.skipBootstrap: true`: `agent exec` sets that itself, but `agent --local` (serve) would otherwise seed OpenClaw's first-run ritual (`BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`) into `/workspace` and the first prompt, which is a wizard in prompt form and leaves files the grader would see (it did in trial openclaw-serve-1 below). `OPENCLAW_STATE_DIR` and `HOME` point at `/harness-state`. No wizard runs because the config exists and `agent exec` never calls onboarding.

Exit mapping: OpenClaw exits 0 on a completed turn, 1 on a model or result error and 2 on its own timeout. The adapter reports 0, then 124 if the outer `timeout` fired (in serve: the budget plus 15 s, because `openclaw agent --local` retries a failed provider call up to eight times with backoff past its own `--timeout`), then 3 if the JSON envelope or stderr shows a provider status, proxy refusal, rate limit or auth error, else 2.

## OpenAI cells

On an OpenAI cell (plan decision 1 of internal-task: Codex, OpenClaw and Hermes on the same OpenAI model) the adapter picks the provider from `HE_MODEL_BASE_URL`: the runner's URL ends in `/<slot>/openai` or `/<slot>/anthropic`, the cell model's prefix. Any URL that does not end in `/openai` keeps everything above, byte for byte.

- **Config.** `config/openclaw.openai.json` is copied instead of `config/openclaw.json`. It points OpenClaw's bundled `openai` provider at `${HE_MODEL_BASE_URL}/v1` with `${HE_MODEL_API_KEY}` and its shipped `openai-responses` API, so every model call is `POST /v1/responses` (SSE) through the proxy.
- **Turn.** `--model openai/<HE_MODEL_NAME>` in `run` and `serve`; nothing else in the turn changes.
- **Housekeeping model.** `agents.defaults.utilityModel` is the cell model. Without it OpenClaw would pick `openai/gpt-5.6-luna`, which the cell's allowlist refuses (`openclaw models status --json` shows both resolutions).
- **Reasoning effort.** `agents.defaults.thinkingDefault: medium`, sent as `reasoning.effort: medium`. OpenClaw's own default for `gpt-6-luna` is the same.
- **Output cap.** The model row sets no `maxTokens`, so OpenClaw states its catalog's value for `gpt-6-luna`: 128,000 on every request (observed). Every shard's proxy runs `--max-output-tokens 128000`, so it passes. The Anthropic template keeps its 16,384.
- **Network.** The same-model control for Codex, so it runs on the internal network too. The serve smoke there passes (`tests/internal-network-harnesses.test.ts`). On this provider OpenClaw defers MCP tools behind `tool_search` and calls them through `tool_call`.
- **Everything else** is OpenClaw's shipped default: catalog metadata, SSE transport, the embedded OpenClaw runtime (a custom endpoint never selects the Codex app-server runtime). `pin.json` `model_openai` records each choice with its source.

Keyless proof (2026-10-29, `tests/openai-branch.test.ts`): through the real proxy in lease mode with `--allow-models openai:gpt-6-luna`, `--max-output-tokens 128000` and a fake Responses endpoint upstream, `run` and `serve` each completed a turn on one forwarded `gpt-6-luna` request with no refusal, and a model off the allowlist exited 3. The same test checks that an Anthropic cell's config, turn arguments, environment, response and ready file are identical to `c1c7ed1b3` except `adapter_sha256`. No paid OpenAI call has been made yet.

## Instruction routes (internal-task)

`HE_HARNESS_CONFIG` (the cell's `config`) names the route that carries `/opt/harness/routes/instruction.md` (a byte copy of [harnesses/routes/instruction.md](../routes/instruction.md), gbrain's per-turn brain-first rule). Unset, empty or `default` leaves the adapter byte-identical to before; any other value exits 2 (HE-ADAPTER-007).

- `route-tool`: nothing written; the gbrain MCP tool descriptions are the only carrier.
- `route-system`: not supported: OpenClaw 2026.10.6 has no config key that adds text to the system prompt, so the adapter exits 2 (HE-ADAPTER-007).
- `route-startup`: `/workspace/AGENTS.md`.
- `route-hook`: the hook-only plugin `he-instruction-route` (`before_prompt_build` returns the instruction as `prependContext`; serve only; `plugins inspect --runtime` must report it loaded).
- `route-skill`: `/workspace/skills/brain-first/SKILL.md`, a fixed short description and the instruction as the body.

Each route writes `$HE_LOG_DIR/instruction-route.json` and adds `instruction_route` to `ready`. Where each route's bytes land in the model request, and why: [harnesses/routes/README.md](../routes/README.md).

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness openclaw --task tasks/hello`, proxy lease `m0-laneb` (`--allow-models anthropic:claude-sonnet-5-5`, default 32768 output-token cap), container run as the host user with stdin from `/dev/null` and no TTY.

| Trial | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|
| openclaw-hello-1 | 0 | completed | fail (file written as root, unreadable by the grader; driver fixed to run as the host user) | 21.0 s | 2 forwarded | 27,127 / 121 | $0.0380 |
| openclaw-hello-2 | 0 | completed | pass | 28.1 s | 2 forwarded | 27,131 / 120 | $0.0100 |

The first trial's cost is mostly a prompt-cache write (13,614 tokens); the second read the cache. OpenClaw's own envelope reported `costUsd` 0.0380 for trial 1, matching the proxy to the cent.

Findings:

- OpenClaw sends one request to `claude-haiku-5-5` per run before the main turn (a utility call; the allowlist refuses it with 403 and the turn proceeds unaffected). A counted run should decide whether to allow a utility model or record the refusal. It is logged in the proxy's usage log either way.
- The grader could not read `hello.txt` after the first trial because the container ran as root; `run-trial.sh` now passes `--user $(id -u):$(id -g)`, and the image works unprivileged with `HOME=/harness-state`.

## M1 serve smoke

Run on 2026-10-22 with `bun harnesses/serve-smoke.ts --harness openclaw --trial-id <trial> --budget 180`, proxy leases `m1-lanec-openclaw` and `m1-lanec-openclaw-2` (`--allow-models anthropic:claude-sonnet-5-5`, default 32,768 output-token cap), container as the host user, stdin from `/dev/null`, no TTY, world in-process on `0.0.0.0:8791`. Actors Dana Okafor (DM) and Hollis Mbeki (#general); the three prompts are in `serve-smoke.ts`.

| Trial | Turn | Conversation | Exit | Wall | Proxy calls | Tokens in / out | Cost | World-MCP calls in the window |
|---|---|---|---|---|---|---|---|---|
| openclaw-serve-1 | 1 | dm:dana-okafor | 0 | 29.0 s | 3 | 81,762 / 410 | $0.0941 | `conversations.list` |
| openclaw-serve-1 | 2 | channel:C8PPLDSJBEF (#general) | 0 | 27.4 s | 4 | 112,099 / 303 | $0.0471 | `conversations.list`, `conversations.history` |
| openclaw-serve-1 | 3 | dm:dana-okafor | 0 | 21.9 s | 1 | 32,520 / 35 | $0.0080 | none |
| openclaw-serve-2 | 1 | dm:dana-okafor | 0 | 27.1 s | 3 | 67,788 / 447 | $0.0832 | `conversations.list` |
| openclaw-serve-2 | 2 | channel:C8PPLDSJBEF (#general) | 0 | 23.9 s | 4 | 85,956 / 303 | $0.0418 | `conversations.list`, `conversations.history` |
| openclaw-serve-2 | 3 | dm:dana-okafor | 0 | 21.4 s | 1 | 28,847 / 41 | $0.0074 | none |

Trial totals: openclaw-serve-1 8 forwarded calls, 226,381 tokens in, 748 out, $0.1493 (lease `m1-lanec-openclaw` committed $0.1493); openclaw-serve-2 8 forwarded calls, 182,591 in, 791 out, $0.1324 (lease `m1-lanec-openclaw-2` committed $0.1324). Both containers exited 0 on `docker stop`; ready about 8.5 s after start (the `mcp probe` takes most of it). In both trials turn 3 asked, without tools, what Dana had asked earlier, and the reply restated turn 1, so the `dm:dana-okafor` session carried across turns. No `claude-haiku-5-5` utility call was observed on the `agent --local` path (the `agent exec` path in M0 made one per run). The envelope's own `usage.cost.total` for turn 1 of trial 1 was $0.0941, matching the proxy.

Findings:

- openclaw-serve-1 ran without `skipBootstrap`: OpenClaw seeded `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `SOUL.md`, `USER.md` and a `.git` directory into `/workspace` on the first turn and injected the "birth sequence" ritual into the prompt (the reply still answered the question, as the ritual text tells it to). openclaw-serve-2 ran with `skipBootstrap: true`; the workspace stayed empty and the turns' tokens dropped by about a fifth.
- A fifth of each turn's input is OpenClaw's own tool catalog and system prompt (about 24,000 to 32,000 tokens per call before the conversation), mostly served from the prompt cache after the first call.

## Changelog

### 2026-10-30: instruction routes (internal-task)

harness-evals v0.0.46. The "Instruction routes" section: `HE_HARNESS_CONFIG` selects the route, `default` is unchanged, and the image copies `routes/` to `/opt/harness/routes`. Why: run `anatomy-instruction-route-2026-11` needs one instruction delivered through each route.

### 2026-10-29: OpenAI cells (internal-task)

The adapter chooses the provider from the proxy URL; an OpenAI cell gets `config/openclaw.openai.json` (Responses API, the housekeeping model mapped to the cell model, reasoning effort medium) and `--model openai/<model>`. Anthropic cells are unchanged; `tests/openai-branch.test.ts` holds the golden captures.

Review fixes: the OpenAI template no longer sets `maxTokens`, so OpenClaw states its catalog's 128,000 for `gpt-6-luna` (the shards' proxy cap); the Anthropic template is unchanged. The config templates are read from beside `adapter.sh`, so a stub-based process test checks the Anthropic goldens without the image. The internal-network smoke passes.

### 2026-10-22: serve (M1 lane C)

harness-evals v0.0.3. `serve` with per-conversation sessions on `openclaw agent --local --session-key`, world-MCP wired with `openclaw mcp set`; one live three-turn trial.

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed.
