# OpenClaw harness

[OpenClaw](https://docs.openclaw.ai/) `2026.10.6` from npm, installed under `/opt/harness`. Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

`run` is one turn with `openclaw agent exec --message-file /workspace/instruction.md --cwd /workspace --config <state>/openclaw.json --state-dir <state>/exec --model anthropic/claude-sonnet-5-5 --json` ([docs](https://docs.openclaw.ai/cli/agent)). `agent exec` is OpenClaw's own headless path: no gateway, no onboarding, temporary run state under the directory we give it.

`serve` answers each `TurnRequest` with `openclaw agent --local --session-key agent:main:<key> --message-file <log>/turns/turn-NNNN.prompt.md --model anthropic/claude-sonnet-5-5 --timeout <budget> --json`, where `<key>` is `dm:<member>` or `channel:<id>`. `agent exec` has no session selector at this version (it is "one isolated headless embedded agent turn"), so serve uses the embedded `--local` path of `openclaw agent`, which does take `--session-key` and keeps every session in the one `OPENCLAW_STATE_DIR` (`agents/main/agent/openclaw-agent.sqlite`; the envelope's `meta.agentMeta.sessionFile` is the key). The gateway and its channel routing are not used. At serve start the adapter writes the world-MCP server into the config copy with `openclaw mcp set world '{"url": $HE_WORLD_MCP_URL, "transport": "streamable-http", "headers": {"Authorization": "Bearer $HE_WORLD_MCP_TOKEN"}}'` and logs `openclaw mcp probe` (14 tools). The reply is `payloads[].text` of the JSON envelope.

## Configuration

`config/openclaw.json` (JSON5) is copied to `/harness-state/openclaw/openclaw.json` at the start of a trial. It overrides the built-in `anthropic` provider's `baseUrl` and `apiKey` with `${HE_MODEL_BASE_URL}` and `${HE_MODEL_API_KEY}` (OpenClaw substitutes `${VAR}` from the environment), declares the `claude-sonnet-5-5` catalog row, sets `agents.defaults.model.primary` to the cell model (`anthropic/${HE_MODEL_NAME}`, the answering model under test), leaves `agents.defaults.utilityModel` unset so OpenClaw's housekeeping model stays its shipped default, `anthropic/claude-haiku-5-5` (see "Housekeeping model" below), and sets `agents.defaults.skipBootstrap: true`: `agent exec` sets that itself, but `agent --local` (serve) would otherwise seed OpenClaw's first-run ritual (`BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`) into `/workspace` and the first prompt, which is a wizard in prompt form and leaves files the grader would see (it did in trial openclaw-serve-1 below). `OPENCLAW_STATE_DIR` and `HOME` point at `/harness-state`. No wizard runs because the config exists and `agent exec` never calls onboarding.

Exit mapping: OpenClaw exits 0 on a completed turn, 1 on a model or result error and 2 on its own timeout. The adapter reports 0, then 124 if the outer `timeout` fired (in serve: the budget plus 15 s, because `openclaw agent --local` retries a failed provider call up to eight times with backoff past its own `--timeout`), then 3 if the JSON envelope or stderr shows a provider status, proxy refusal, rate limit or auth error, else 2.

## OpenAI cells

On an OpenAI cell (plan decision 1 of internal-task: Codex, OpenClaw and Hermes on the same OpenAI model) the adapter picks the provider from `HE_MODEL_BASE_URL`: the runner's URL ends in `/<slot>/openai` or `/<slot>/anthropic`, the cell model's prefix. Any URL that does not end in `/openai` keeps everything above, byte for byte.

- **Config.** `config/openclaw.openai.json` is copied instead of `config/openclaw.json`. It points OpenClaw's bundled `openai` provider at `${HE_MODEL_BASE_URL}/v1` with `${HE_MODEL_API_KEY}` and its shipped `openai-responses` API, so every model call is `POST /v1/responses` (SSE) through the proxy.
- **Turn.** `--model openai/<HE_MODEL_NAME>` in `run` and `serve`; nothing else in the turn changes.
- **Housekeeping model.** `agents.defaults.utilityModel` is the cell model. OpenClaw's shipped default here would be `openai/gpt-5.6-luna` (`openclaw models status --json` shows both resolutions), but this existing adapter pin stays as it is, a declared deviation (internal-task, 2026-11-01), because published results already used it.
- **Memory search.** `memory.search.provider: "none"`: keyword-only memory search, with no embeddings. Without it OpenClaw's memory indexer embeds `MEMORY.md` and `memory/*.md` through the openai provider and calls `/v1/embeddings` for `text-embedding-3-small`, which the cell's allowlist refuses. In host-harness-pilot-2026-10 that ended 11 `oc-luna` trials as model errors. An Anthropic cell has no OpenAI key, so the same indexer already falls back to keyword ranking there; this setting makes an OpenAI cell do the same. The `memory_search` tool stays.
- **Reasoning effort.** `agents.defaults.thinkingDefault: medium`, sent as `reasoning.effort: medium`. OpenClaw's own default for `gpt-6-luna` is the same.
- **Output cap.** The model row sets no `maxTokens`, so OpenClaw states its catalog's value for `gpt-6-luna`: 128,000 on every request (observed). Every shard's proxy runs `--max-output-tokens 128000`, so it passes. The Anthropic template keeps its 16,384.
- **Network.** The same-model control for Codex, so it runs on the internal network too. The serve smoke there passes (`tests/internal-network-harnesses.test.ts`). On this provider OpenClaw defers MCP tools behind `tool_search` and calls them through `tool_call`.
- **Everything else** is OpenClaw's shipped default: catalog metadata, SSE transport, the embedded OpenClaw runtime (a custom endpoint never selects the Codex app-server runtime). `pin.json` `model_openai` records each choice with its source.

Keyless proof (2026-10-29, `tests/openai-branch.test.ts`): through the real proxy in lease mode with `--allow-models openai:gpt-6-luna`, `--max-output-tokens 128000` and a fake Responses endpoint upstream, `run` and `serve` each completed a turn on one forwarded `gpt-6-luna` request with no refusal, and a model off the allowlist exited 3. The same test checks that an Anthropic cell's config, turn arguments, environment, response and ready file are identical to `c1c7ed1b3` except `adapter_sha256` and the cell model in `model.primary` (internal-task, `tests/fixtures/model-defaults.ts`). No paid OpenAI call had been made then; the first ran in the `oc-luna` cell of host-harness-pilot-2026-10.

## Housekeeping model

**OpenClaw ships its own housekeeping (utility) model, and Anthropic cells keep it.** internal-task's decision of 2026-11-01: a harness's housekeeping model stays at its shipped default. It is metered, labelled "harness housekeeping, shipped default" in the preregistration and the report, and never an arm or a scored number. The answering model, `model.primary`, is the cell model under test.

- **Shipped default.** `anthropic/claude-haiku-5-5` on the anthropic provider and `openai/gpt-5.6-luna` on the openai provider (each provider plugin's `defaultUtilityModel`; `openclaw models status --json` reports `utilityModel {ref: anthropic/claude-haiku-5-5, source: provider-default}` with this config). Both are priced by the proxy.
- **What uses it.** OpenClaw's docs list Control UI session titles, Telegram and Discord thread titles, Activity recaps and progress-draft narration. None of these runs in a headless `agent exec` or `agent --local` trial.
- **Observed: no call.** No OpenClaw trial at this pin or earlier ones sent one. The Sonnet cells of m2-pilot, m3-heldout, gbrain-arm, v02-heldout, gbrain-memory and gbrain-memory-fix-b (730 trials) logged no `claude-haiku-5-5` request, forwarded or refused. In the v0.3 OpenClaw cells (v03-installer-dev, v03-pilot, host-harness-pilot, anatomy-instruction-route; 1,240 trials, 11,803 model requests) every answered request carried at least 10,000 input tokens, an agent turn; the two exceptions are upstream 400 errors with no usage. The keyless captures without `utilityModel` (2026-11-01, Opus 5.5, plain, tools and growth scenarios, 15 requests) sent only agent turns: the agent system prompt and 14 tools, all on the cell model.
- **If it happens.** A cell that wants the call to count preregisters the default in `utility_models` (`anthropic:claude-haiku-5-5`). The proxy then forwards and prices it, HE-MODEL-001 does not count it as foreign, and in an ablation cell the layer filter passes it through untouched as the housekeeping family (`runner/proxy/ablate.ts`). Without the declaration the slot refuses it with 403 at $0.
- **OpenAI cells: declared deviation.** The shipped default would be `openai/gpt-5.6-luna`, but `config/openclaw.openai.json` keeps its existing pin of `utilityModel` to the cell model (internal-task). Published results already used that pin, so it stays until one adapter PR changes it for every lane at once, and each preregistration declares it as a deviation.
- **Not housekeeping.** The occasional Sonnet call on older Haiku cells (4 of 200 Haiku trials in gbrain-arm, 1 of 75 in gbrain-memory, refused in several gbrain runs) came from the pinned `model.primary`, not from `utilityModel`. It now names the cell model.

## Particle cells (internal-task)

On a Particle-1 cell (cell model `particle:particle-1`, the cheap row of internal-task) the runner's URL ends in `/<slot>/particle`. Particle speaks only OpenAI Chat Completions over HTTP, so the adapter uses OpenClaw's generic `openai-completions` provider. The `@openclaw/particle-provider` plugin is not installed, so the image is unchanged. An Anthropic or OpenAI URL keeps its own branch above.

- **Config.** `config/openclaw.particle.json` is copied. It defines a provider `particle` at `${HE_MODEL_BASE_URL}/v1` with `${HE_MODEL_API_KEY}`, so every model call is `POST /v1/chat/completions` (SSE) through the proxy, naming `particle-1`.
- **Turn.** `--model particle/<HE_MODEL_NAME>` in `run` and `serve`.
- **Housekeeping model.** `agents.defaults.utilityModel` is the cell model (`openclaw models status --json` reports it from config).
- **Reasoning effort.** The model row has `reasoning: true` and `thinkingDefault` is medium, so every request sends `reasoning_effort: medium`. Particle serves medium at its high tier, the same tier it uses when no effort is sent.
- **Output cap.** `maxTokens: 128000`, sent as `max_completion_tokens`: the cap the OpenAI cells state and the shards' proxy runs. Particle spends output on `reasoning_content` first, so a low cap returns no visible text. Its own default is 32,000.
- **Usage.** `compat.supportsUsageInStreaming: true`, so OpenClaw asks for usage in the stream. It does not for an unknown endpoint by default.
- **Memory.** `memory.search.provider: "none"` in this template itself: the memory indexer searches by keyword and never calls `/v1/embeddings`, which Particle does not serve.
- **Errors.** A Particle cell uses the same model-error pattern as every other cell, so a provider 400 is exit 2, harness error. Plan decision 12 (a Particle 400 with code `invalid_value` or `unsupported_parameter` is a model error) is applied by the runner from the metering proxy's record, because OpenClaw's output does not carry the error code. A 429 is exit 3 once OpenClaw's retries run out. A 402 is exit 2, as on every cell: the pattern does not match OpenClaw's `status=402` billing line.

Keyless proof (2026-10-31, `tests/particle-branch.test.ts`): the image ran straight against a fake Particle endpoint (`tests/fixtures/particle/fake-particle.ts`), because the proxy's Particle route was not on main yet. `run` and `serve` each completed a turn on one `POST /v1/chat/completions` naming `particle-1` with effort medium and `max_completion_tokens` 128,000. There was no other request, no embeddings call and no Anthropic call. Particle's 400 and 402 error bodies from the fake exited 2; a 429 was retried until the 120 s budget ran out (exit 124). The same test checks that an OpenAI cell's turn arguments, environment, response and ready file equal main's at `3a9b403be`. No paid Particle call has been made.

## Instruction routes (internal-task)

`HE_HARNESS_CONFIG` (the cell's `config`) names the route that carries `/opt/harness/routes/instruction.md` (a byte copy of [harnesses/routes/instruction.md](../routes/instruction.md), gbrain's per-turn brain-first rule). Unset, empty or `default` leaves the adapter byte-identical to before; any other value exits 2 (HE-ADAPTER-007).

- `route-tool`: nothing written; the gbrain MCP tool descriptions are the only carrier.
- `route-system`: not supported: OpenClaw 2026.10.6 has no config key that adds text to the system prompt, so the adapter exits 2 (HE-ADAPTER-007).
- `route-startup`: `/workspace/AGENTS.md`.
- `route-hook`: the hook-only plugin `he-instruction-route` (`before_prompt_build` returns the instruction as `prependContext`; serve only; `plugins inspect --runtime` must report it loaded).
- `route-skill`: `/workspace/skills/brain-first/SKILL.md`, a fixed short description and the instruction as the body.

Each route writes `$HE_LOG_DIR/instruction-route.json` and adds `instruction_route` to `ready`. Where each route's bytes land in the model request, and why: [harnesses/routes/README.md](../routes/README.md).

## H10 routes (internal-task)

**The H10 route set runs on OpenClaw, except `route-system`.** The contract is in [harnesses/routes/README.md](../routes/README.md), "Routes on four harnesses".

- **`route-once`:** the `route-hook` plugin, emitting only on the first member turn of each session.
- **`route-placebo`:** the same plugin carrying `routes/placebo.md` (289 bytes, a byte copy of [harnesses/routes/placebo.md](../routes/placebo.md), sha256 checked) on every member turn.
- **`route-told`:** the `route-skill` skill. The told sentence is in the cell's preamble, which the runner carries.
- **`route-slot-told@<id>`, `route-slot-skill@<id>`:** the bundle byte-copied under `routes/slots/<id>/` goes to `/workspace/skills/<skill_name>/` after the adapter re-checks its `bundle_sha256`. The full shape check runs on the host (`scripts/routes/slot-check.ts`). No bundle is in the image yet.
- **Refused (HE-ADAPTER-007, exit 2):** `route-system` as before, a driver prefix (Claude Code only), every H10 route on the `run` entry, a malformed slot id, a missing slot bundle or one whose files do not match `bundle_sha256`, and a placebo file off its sha256.

**Emit flag.** The plugin `he-instruction-route` keeps no state. The adapter fills two placeholders in its `index.js`: the route's bytes and the path of the emit flag. `before_prompt_build` returns the bytes as `prependContext` when the flag reads `emit=1` and nothing otherwise. Before each member turn the adapter counts the turn in its session (`$HE_SESSION_STATE_DIR/he-route/sessions.json`) and writes the flag (`he-route/emit`).

**Per-turn status.** On every route but `default`, `$HE_LOG_DIR/turns/<turn>.route.json` holds `config`, `driver` (`cli`), `route`, `session_key` (`<channel id>` or `<channel id>:<thread_ts>`), `session_turn` and `emitted` (null off the hook routes).

**Golden captures** (`tests/instruction-route.test.ts`, "H10 golden"): keyless, against a fake Responses endpoint, with `HE_MODEL_NAME=gpt-6.1-sol`, on cn-02, cr-01 and cn-03 plus a gbrain tool-call follow-up on turn 1. Every agent request names `gpt-6.1-sol` with `reasoning.effort: medium` and `max_output_tokens: 128000`. The route-once copy stays in the session history on every later turn, so OpenClaw qualifies for the repetition pairs.

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness openclaw --task tasks/hello`, proxy lease `m0-laneb` (`--allow-models anthropic:claude-sonnet-5-5`, default 32768 output-token cap), container run as the host user with stdin from `/dev/null` and no TTY.

| Trial | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|
| openclaw-hello-1 | 0 | completed | fail (file written as root, unreadable by the grader; driver fixed to run as the host user) | 21.0 s | 2 forwarded | 27,127 / 121 | $0.0380 |
| openclaw-hello-2 | 0 | completed | pass | 28.1 s | 2 forwarded | 27,131 / 120 | $0.0100 |

The first trial's cost is mostly a prompt-cache write (13,614 tokens); the second read the cache. OpenClaw's own envelope reported `costUsd` 0.0380 for trial 1, matching the proxy to the cent.

Findings:

- OpenClaw sends one request to `claude-haiku-5-5` per run before the main turn (a utility call; the allowlist refuses it with 403 and the turn proceeds unaffected). A counted run should decide whether to allow a utility model or record the refusal. It is logged in the proxy's usage log either way. (2026-11-01: not seen in any later trial; see "Housekeeping model".)
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

### 2026-11-01: H10 routes (internal-task)

The "H10 routes" section. `route-once`, `route-placebo`, `route-told` and the slot routes, the emit flag read by the `he-instruction-route` plugin, and the per-turn route status. Why: H10 runs the route test on frontier models on four harnesses.

### 2026-10-31: Particle cells (internal-task)

The adapter gives a Particle cell `config/openclaw.particle.json` (the generic `openai-completions` provider, the housekeeping model mapped to the cell model, effort medium, an output cap of 128,000, memory search by keyword) and `--model particle/<model>`. A provider 400 is exit 2 as on every cell; plan decision 12 is the runner's. Why: internal-task's cheap row runs Particle-1 on OpenClaw. `tests/particle-branch.test.ts` holds the proof and the OpenAI-cell goldens.

### 2026-10-31: the cell model as the primary model; housekeeping at its shipped default (internal-task)

`config/openclaw.json` sets `model.primary` to `anthropic/${HE_MODEL_NAME}`, and `adapter.sh` exports `HE_MODEL_NAME` so OpenClaw can substitute it. Why: the primary was pinned to `claude-sonnet-5-5`, so on a Haiku cell the calls OpenClaw resolves from its primary named Sonnet. `utilityModel` stays unset, so the housekeeping model is OpenClaw's shipped default, `anthropic/claude-haiku-5-5`. Why: internal-task's decision of 2026-11-01 keeps a harness's own housekeeping model at its shipped default, metered and labelled "harness housekeeping, shipped default", never an arm or a scored number ([harness anatomy](../../docs/harness-anatomy/README.md)).

### 2026-10-30: instruction routes (internal-task)

harness-evals v0.0.46. The "Instruction routes" section: `HE_HARNESS_CONFIG` selects the route, `default` is unchanged, and the image copies `routes/` to `/opt/harness/routes`. Why: run `anatomy-instruction-route-2026-11` needs one instruction delivered through each route.

### 2026-10-30: OpenAI cells search memory by keyword only (internal-task)

`config/openclaw.openai.json` sets `memory.search.provider: "none"`, so OpenClaw's memory indexer on an OpenAI cell sends no `/v1/embeddings` request (11 `oc-luna` model errors in host-harness-pilot-2026-10). `config/openclaw.json`, the Anthropic template, is unchanged.

### 2026-10-29: OpenAI cells (internal-task)

The adapter chooses the provider from the proxy URL; an OpenAI cell gets `config/openclaw.openai.json` (Responses API, the housekeeping model mapped to the cell model, reasoning effort medium) and `--model openai/<model>`. Anthropic cells are unchanged; `tests/openai-branch.test.ts` holds the golden captures.

Review fixes: the OpenAI template no longer sets `maxTokens`, so OpenClaw states its catalog's 128,000 for `gpt-6-luna` (the shards' proxy cap); the Anthropic template is unchanged. The config templates are read from beside `adapter.sh`, so a stub-based process test checks the Anthropic goldens without the image. The internal-network smoke passes.

### 2026-10-22: serve (M1 lane C)

harness-evals v0.0.3. `serve` with per-conversation sessions on `openclaw agent --local --session-key`, world-MCP wired with `openclaw mcp set`; one live three-turn trial.

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed.
