# Hermes Agent harness

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) at tag `v2026.9.24` (commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, package version 0.21.5), checked out into `/opt/harness/src` and installed with uv into `/opt/harness/venv` with the `anthropic` and `mcp` extras. Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

`run` is one turn with `hermes chat --query-file /workspace/instruction.md --oneshot --provider anthropic --model claude-sonnet-5-5` ([CLI docs](https://hermes-agent.nousresearch.com/docs/user-guide/cli)): on a non-TTY Hermes answers the query and exits.

`serve` answers each `TurnRequest` with `hermes chat --query-file <log>/turns/turn-NNNN.prompt.md --continue <key> --create-if-missing --oneshot --quiet --format stream-json --provider anthropic --model claude-sonnet-5-5 --run-budget <budget>`, where `<key>` is `dm:<member>` or `channel:<id>` used as the session title: `-c <title> --create-if-missing` resumes that titled session or creates it, so every conversation is one Hermes session in the one `HERMES_HOME` (`state.db`). The gateway and its per-user sessions are not used. At serve start the adapter appends `mcp_servers.world` (`url`, `headers.Authorization: Bearer <bot token>`) to the config copy; Hermes connects on the first turn and registers the 14 tools as `mcp__world__<tool>`. The reply is the `text` of the stream-json `result` record.

## Configuration

`config/config.yaml` is copied to `$HERMES_HOME/config.yaml` (`/harness-state/hermes`) at the start of a trial: provider `anthropic`, model `claude-sonnet-5-5`, local terminal backend with `cwd: /workspace`, non-streaming display. The adapter exports `ANTHROPIC_API_KEY=$HE_MODEL_API_KEY` and `ANTHROPIC_BASE_URL=$HE_MODEL_BASE_URL`, which Hermes's anthropic provider reads; nothing is written to `.env`. Hermes refuses to build a wheel outside Nix, so the install is editable (`uv pip install -e`), and the `anthropic` extra is installed at build time because Hermes would otherwise install it lazily into a read-only directory.

Exit mapping: Hermes exits 1 on a failed turn. The adapter reports 0, then 124 if the outer `timeout` fired (in serve: the budget plus 10 s; `--run-budget` is Hermes's soft budget), then 3 if stderr or the `result` record shows a proxy refusal or an Anthropic SDK error class or status, else 2.

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

### 2026-10-22: serve (M1 lane C)

harness-evals v0.0.3. `serve` with one named Hermes session per conversation, world-MCP under `mcp_servers.world`, the `mcp` extra in the image; two live three-turn trials.

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed after raising the proxy's output-token cap.
