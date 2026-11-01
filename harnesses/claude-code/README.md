# Claude Code harness

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) `2.1.312`, the npm package `@anthropic-ai/claude-code` installed under `/opt/harness` on `node:24-bookworm-slim`. The package's postinstall puts the linux-x64 native binary in place; the build checks `claude --version` and the binary's sha256 against [pin.json](pin.json). Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

- **`run`** is one turn: `claude -p --output-format stream-json --verbose --model <model> --permission-mode bypassPermissions --disallowedTools WebSearch,WebFetch --mcp-config /harness-state/mcp.json --strict-mcp-config --session-id <id>` with `/workspace/instruction.md` on stdin.
- **`serve`** runs the same command once per `TurnRequest`, with the prompt on stdin. The session id is a UUIDv5 of the conversation key (`dm:<member>`, `channel:<id>`, plus `:t<thread_ts>` for a thread turn): `--session-id` the first time, `--resume` once the session's transcript exists. The CLI refuses a `--session-id` it already holds.
- **The reply** is the `result` field of the stream's `result` record.

## Configuration

- **Model and key.** The adapter exports `ANTHROPIC_BASE_URL=$HE_MODEL_BASE_URL` and `ANTHROPIC_API_KEY=$HE_MODEL_API_KEY`. Every model setting the CLI reads at this version names the cell model, and model substitution is off (`pin.json` `model.model_settings`). No `--fallback-model`.
- **State.** `HOME` is `/harness-state`, `CLAUDE_CONFIG_DIR` is `/harness-state/claude` and `TMPDIR` is `/harness-state/tmp`. `config/settings.json` is copied there at trial start: it denies `WebSearch` and `WebFetch`. No `.credentials.json` exists in the image or the state directory.
- **Side traffic off.** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_AUTOUPDATER`, `DISABLE_TELEMETRY` and `DISABLE_ERROR_REPORTING` are 1. `CLAUDE_CODE_MAX_RETRIES=2` (the CLI's default is 10).
- **MCP.** `world`, and `gbrain` when `HE_GBRAIN_MCP_URL` is set, are Streamable HTTP servers with the bot token as a bearer. Before ready the adapter sends `tools/list` to each and exits 2 if one does not answer. `MCP_CONNECTION_NONBLOCKING=false` makes the CLI wait for the servers, so each turn's init record shows their real status; a server that is not `connected` fails the turn with exit 2.
- **Not supported.** `HE_SESSION_SCOPE=turn`, and any `HE_GBRAIN_INSTALL` other than `gbrain-installer`, exit 2.
- **gbrain's installer.** `HE_GBRAIN_INSTALL=gbrain-installer` applies what `gbrain setup claude-code --instructions-only` wrote at gbrain image build (the brain-first block in `CLAUDE.md`, the per-turn `UserPromptSubmit` hook in `settings.json`, gbrain's ledger and binary) and checks the hook prints its rule before ready. See [docs/gbrain-arm.md](../../docs/gbrain-arm.md), "The Claude Code and Codex installer".
- **Provider check.** The adapter exits 2 at startup, with the reason in `adapter.log`, unless `HE_MODEL_BASE_URL` ends in `/anthropic` (the runner's `<proxy>/<slot>/anthropic` route). The CLI speaks only the Messages API.
- **Network.** It serves on the internal network: a turn through the proxy, a world-MCP call, no direct connection out (`tests/internal-network-harnesses.test.ts`).
- **Skills** live at `$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md` and run as `/<name>` or through the Skill tool.

Exit mapping:

- **124** when the turn outlives its budget (SIGTERM to the turn's process session, then SIGKILL).
- **3** when the `result` record is an error with `api_error_status` set, or with `terminal_reason` `api_error` and no status (the proxy unreachable after retries).
- **2** for anything else that fails: no init or result record, another CLI version, an MCP server not connected, SIGTERM during a `run` or `serve` turn.
- **2 for a mid-turn MCP failure.** When a call to a `world` or `gbrain` tool fails at the transport level after a good init, the CLI tells the model and exits 0. The adapter reads the `tool_result` and fails the turn with a null reply. At 2.1.312 the error reads `ECONNREFUSED: Unable to connect. ...` for a refused connection and `Error POSTing to endpoint: <body>` for an HTTP error status, and `MCP server "<server>" tool "<tool>" timed out after <n>s` past the tool timeout. The match is anchored at the start of the CLI's own message, so a tool's own error result is never read as a transport failure, even when its text holds a word like `ENOTFOUND`.
- **SIGTERM.** The trap is set before the first turn, `run` included. Bash is PID 1 in the container and would otherwise ignore `docker stop` until the SIGKILL.

## Observed at this pin

Keyless, against a fake Anthropic endpoint and through the metering proxy in lease mode (`tests/claude-code-adapter.test.ts`):

- The CLI sends only `POST <base>/v1/messages?beta=true`, streamed, with `x-api-key`.
- `max_tokens` is 128,000 on Haiku 5.5, so the proxy runs with `--max-output-tokens 128000`, as for Hermes. Thinking is `adaptive` and `output_config.effort` is `medium` by default.
- An HTTP 400 makes the CLI resend the request in three body variants, twice each (6 requests), whatever the retry setting. The proxy settles a 4xx at $0.
- MCP tools are deferred behind `ToolSearch`; the model can still call `mcp__world__<tool>` by name.
- The Bash tool refuses a standalone `sleep`.

No paid trial has run on this harness yet.

## Changelog

### 2026-10-29: image, adapter and keyless tests (internal-task)

First image, adapter, `pin.json` and tests: `run` and `serve`, the MCP checks, the version check, the exit mapping, and a container test through the real metering proxy.

Review fixes: a mid-turn MCP transport failure is exit 2 (stub and container tests), SIGTERM stops a `run` turn too, the provider check, and the internal-network smoke.
