# Hermes Agent harness

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) at tag `v2026.9.24` (commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, package version 0.21.5), checked out into `/opt/harness/src` and installed with uv into `/opt/harness/venv` with the `anthropic` and `mcp` extras. Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

`run` is one turn with `hermes chat --query-file /workspace/instruction.md --oneshot --provider anthropic --model claude-sonnet-5-5` ([CLI docs](https://hermes-agent.nousresearch.com/docs/user-guide/cli)): on a non-TTY Hermes answers the query and exits.

`serve` answers each `TurnRequest` with `hermes chat --query-file <log>/turns/turn-NNNN.prompt.md --continue <key> --create-if-missing --oneshot --quiet --format stream-json --provider anthropic --model claude-sonnet-5-5 --run-budget <budget>`, where `<key>` is `dm:<member>` or `channel:<id>` used as the session title: `-c <title> --create-if-missing` resumes that titled session or creates it, so every conversation is one Hermes session in the one `HERMES_HOME` (`state.db`). The gateway and its per-user sessions are not used. At serve start the adapter appends `mcp_servers.world` (`url`, `headers.Authorization: Bearer <bot token>`) to the config copy; Hermes connects on the first turn and registers the 14 tools as `mcp__world__<tool>`. The reply is the `text` of the stream-json `result` record.

## Configuration

`config/config.yaml` is copied to `$HERMES_HOME/config.yaml` (`/harness-state/hermes`) at the start of a trial: provider `anthropic`, model `claude-sonnet-5-5`, local terminal backend with `cwd: /workspace`, non-streaming display. The adapter exports `ANTHROPIC_API_KEY=$HE_MODEL_API_KEY` and `ANTHROPIC_BASE_URL=$HE_MODEL_BASE_URL`, which Hermes's anthropic provider reads; nothing is written to `.env`. Hermes refuses to build a wheel outside Nix, so the install is editable (`uv pip install -e`), and the `anthropic` extra is installed at build time because Hermes would otherwise install it lazily into a read-only directory.

Exit mapping: Hermes exits 1 on a failed turn. The adapter reports 0, then 124 if the outer `timeout` fired (in serve: the budget plus 10 s; `--run-budget` is Hermes's soft budget), then 3 if stderr or the `result` record shows a proxy refusal or an Anthropic or OpenAI SDK error class or status, else 2.

## OpenAI cells

On an OpenAI cell (plan decision 1 of internal-task: Codex, OpenClaw and Hermes on the same OpenAI model) the adapter picks the provider from `HE_MODEL_BASE_URL`: the runner's URL ends in `/<slot>/openai` or `/<slot>/anthropic`, the cell model's prefix. Any URL that does not end in `/openai` keeps everything above, byte for byte, except one config line both branches share: `security.allow_lazy_installs: false` (see Network below).

- **Provider.** `--provider openai-api`, Hermes's direct OpenAI API-key provider, on its shipped Responses transport. `--provider openai` would not do: at this pin it is Hermes's alias for OpenRouter.
- **Credentials.** The adapter exports `OPENAI_API_KEY=$HE_MODEL_API_KEY` and `OPENAI_BASE_URL=$HE_MODEL_BASE_URL/v1` and no Anthropic variables. Every model call is `POST /v1/responses` (SSE) through the proxy.
- **Config.** `config/config.openai.yaml` is copied instead of `config/config.yaml`: the same file with provider `openai-api`, model `gpt-6-luna` and `agent.reasoning_effort: medium`.
- **Side calls.** Every auxiliary task inherits the main model, so the title call also names the cell model. It sends `reasoning.effort: none`, as Hermes ships it.
- **Output cap.** On this provider Hermes states no output cap, so the proxy writes its own: 128,000 under the shards' `--max-output-tokens 128000` (observed 2026-10-29: with the proxy at 100,000 the request upstream carried 100,000, at 128,000 it carried 128,000). The 32,768 recorded before was the proxy's default being filled in.
- **Network.** The same-model control for Codex, so it runs on the internal network too. The serve smoke there passes (`tests/internal-network-harnesses.test.ts`), with MCP tools behind `tool_search` and `tool_call` on this provider. Both configs set `security.allow_lazy_installs: false`, so Hermes no longer tries to pip-install `boto3` (Bedrock) and `edge-tts` from PyPI during a turn. On the internal network those attempts failed on DNS and added about 55 s to every turn. Hermes still tries to download its `tirith` scanner and falls back to pattern matching; `security.tirith_enabled` is left on, because turning it off changes how Hermes gates dangerous commands (`pin.json` `internal_network`).
- **Metadata probes.** Hermes still probes the proxy for a local model server's routes (`/api/tags`, `/props`, `/api/show` and others), as on an Anthropic cell. The proxy refuses them at $0 and they name no model. `pin.json` `model_openai` records this and each choice with its source.

Keyless proof (2026-10-29, `tests/openai-branch.test.ts`): through the real proxy in lease mode with `--allow-models openai:gpt-6-luna` and a fake Responses endpoint upstream, `run` and `serve` completed with every model request naming `gpt-6-luna`, none refused, and a model off the allowlist exited 3. The same test checks that an Anthropic cell's config, turn arguments, environment, response and ready file are identical to `c1c7ed1b3` except `adapter_sha256` and the config's `security.allow_lazy_installs: false` block. No paid OpenAI call has been made yet.

## Instruction routes (internal-task)

`HE_HARNESS_CONFIG` (the cell's `config`) names the route that carries `/opt/harness/routes/instruction.md` (a byte copy of [harnesses/routes/instruction.md](../routes/instruction.md), gbrain's per-turn brain-first rule). Unset, empty or `default` leaves the adapter byte-identical to before; any other value exits 2 (HE-ADAPTER-007).

- `route-tool`: nothing written; the gbrain MCP tool descriptions are the only carrier.
- `route-system`: `agent.system_prompt` in `$HERMES_HOME/config.yaml`.
- `route-startup`: `$HERMES_HOME/SOUL.md` (the seeded default with the instruction appended, only while it has the seed sha256).
- `route-hook`: a marked `hooks.pre_llm_call` shell hook echoing `{"context": <instruction>}` plus its allowlist entry (`hermes hooks doctor` must report it healthy).
- `route-skill`: `$HERMES_HOME/skills/brain-first/SKILL.md`, a fixed short description and the instruction as the body.

Each route writes `$HE_LOG_DIR/instruction-route.json` and adds `instruction_route` to `ready`. Where each route's bytes land in the model request, and why: [harnesses/routes/README.md](../routes/README.md).

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness hermes --task tasks/hello`, container run as the host user with stdin from `/dev/null` and no TTY.

| Trial | Proxy lease | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|---|
| hermes-hello-1 | `m0-laneb` (32,768 output cap) | 3 | model_error | fail | 11.9 s | 1 refused (HTTP 400) | 0 / 0 | $0 |
| hermes-hello-2 | `m0-laneb-hermes` (`--max-output-tokens 128000`) | 0 | completed | pass | 16.6 s | 2 forwarded, 1 forwarded 400 at $0 | 35,323 / 131 | $0.0492 |

Trial 1 error text, verbatim from Hermes: `HTTP 400: metering proxy: requested 128000 output tokens, above this cell's cap of 32768`. The adapter classified it as a model error (exit 3), which is the right column: the harness ran, the model call was refused.

Findings:

- Hermes sets `max_tokens` from a per-model table in `agent/anthropic_adapter.py` (128,000 for `claude-sonnet-5*`) with no user setting to lower it. The proxy must therefore run with `--max-output-tokens 128000` for Hermes cells, and its worst-case reservation per call becomes about $1.40 (128,000 output tokens at $10 per million plus input), so a per-trial lease needs that much headroom even though a hello-world call settles at a few cents.
- Before the first call Hermes probes twelve model-discovery routes (`/v1/models`, `/api/tags`, `/props`, `/version`, `/api/show` and others); the proxy refuses them all with 403 at no cost and Hermes carries on. Context-length auto-detection therefore falls back to defaults.
- Hermes's auxiliary title-generation call fails with Anthropic's 400 `To turn thinking off on this model, send "thinking": {"type": "between_tools"}` on Sonnet 5.5; the provider does not bill it and the main turn is unaffected.
- Hermes prints `tirith security scanner enabled but not available` and falls back to pattern matching for command approval; the file write needed no approval.

## M1 serve smoke

Run on 2026-10-22 with `bun harnesses/serve-smoke.ts --harness hermes --trial-id <trial> --budget 180`, proxy lease `m1-lanec-hermes` (`--allow-models anthropic:claude-sonnet-5-5`, `--max-output-tokens 128000`), container as the host user, stdin from `/dev/null`, no TTY, world in-process on `0.0.0.0:8791`. Actors Dana Okafor (DM) and Hollis Mbeki (#general).

| Trial | Turn | Conversation | Exit | Wall | Proxy calls | Tokens in / out | Cost | World-MCP calls in the window |
|---|---|---|---|---|---|---|---|---|
| hermes-serve-1 | 1 | dm:dana-okafor | 0 | 17.2 s | 3 | 54,867 / 406 | $0.0578 | none (MCP SDK missing, see below) |
| hermes-serve-1 | 2 | channel:C8PPLDSJBEF (#general) | 0 | 21.1 s | 7 | 135,784 / 993 | $0.0465 | none |
| hermes-serve-1 | 3 | dm:dana-okafor | 0 | 8.4 s | 1 | 18,984 / 36 | $0.0051 | none |
| hermes-serve-2 | 1 | dm:dana-okafor | 0 | 16.7 s | 3 | 64,386 / 354 | $0.0719 | `conversations.list` |
| hermes-serve-2 | 2 | channel:C8PPLDSJBEF (#general) | 0 | 14.6 s | 3 | 64,105 / 248 | $0.0258 | `conversations.list`, `conversations.history` |
| hermes-serve-2 | 3 | dm:dana-okafor | 0 | 11.7 s | 1 | 24,524 / 36 | $0.0062 | none |

Trial totals: hermes-serve-1 11 forwarded calls, $0.1093; hermes-serve-2 7 forwarded calls, 153,015 tokens in, 638 out, $0.1039; lease `m1-lanec-hermes` committed $0.2132 in total (`metering-proxy.ts summary`). Both containers exited 0 on `docker stop`; ready 0.5 s after start. In both trials turn 3 restated turn 1 without tools, so the `dm:dana-okafor` session carried across turns.

Findings:

- In hermes-serve-1 Hermes answered "the workspace tools aren't connected in this session" and its log said `Background MCP discovery completed with zero connected servers`: the M0 image had only the `anthropic` extra and Hermes's MCP client (`mcp==2.0.0`) was not installed, so `mcp_servers` was ignored. The Dockerfile now installs the `mcp` extra; hermes-serve-2 is the proof. In that trial the model also tried to reach the MCP URL from the terminal tool and Hermes's security scanner blocked the plain-HTTP URL, which is Hermes's own behaviour and unaffected by the fix.
- The 36 refused requests per trial in the proxy's usage log are Hermes's model-discovery probes, 12 per turn, refused 403 at $0 (the M0 finding).

## Changelog

### 2026-10-30: instruction routes (internal-task)

harness-evals v0.0.46. The "Instruction routes" section: `HE_HARNESS_CONFIG` selects the route, `default` is unchanged, and the image copies `routes/` to `/opt/harness/routes`. Why: run `anatomy-instruction-route-2026-11` needs one instruction delivered through each route.

### 2026-10-29: OpenAI cells (internal-task)

The adapter chooses the provider from the proxy URL; an OpenAI cell gets `config/config.openai.yaml` and `--provider openai-api` with `OPENAI_API_KEY` and `OPENAI_BASE_URL` (Responses API, reasoning effort medium). Anthropic cells are unchanged apart from `security.allow_lazy_installs: false` in the config; `tests/openai-branch.test.ts` holds the golden captures, now also checked without the image by a stub-based process test. The OpenAI template is read from beside `adapter.sh` (`/opt/harness` in the image). The Anthropic copy keeps its literal `/opt/harness/config/config.yaml`, the line the gstack overlay copies, so the process test seeds that config from the checkout.

### 2026-10-22: serve (M1 lane C)

harness-evals v0.0.3. `serve` with one named Hermes session per conversation, world-MCP under `mcp_servers.world`, the `mcp` extra in the image; two live three-turn trials.

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed after raising the proxy's output-token cap.
