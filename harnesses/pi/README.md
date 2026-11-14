# Pi

**Pi 1.5.0 as a multi-user harness, the same release Harbor's stock Pi agent ran in frontier-harness-2026-11.** Pi is the
coding agent from [earendil-works/pi](https://github.com/earendil-works/pi) (npm `@earendil-works/pi-coding-agent`, MIT). This
directory runs it in its own image under the [adapter protocol](../../docs/adapters.md), with the world's tools added by a
small Pi extension. Every number and shape below comes from the keyless tests in `tests/pi-adapter.test.ts`.

- **Pin:** `@earendil-works/pi-coding-agent@1.5.0`, npm integrity `sha512-xNDZ5kqo...MJaQ==` (full value in [pin.json](pin.json)). `package-lock.json` pins Pi and the 122 packages it pulls in by version and sha512.
- **Image:** `harness-eval/pi:dev`, `node:24-bookworm-slim`, `npm ci --ignore-scripts`. The build fails unless `pi --version` prints 1.5.0. No key, `auth.json` or `models.json` is in the image.
- **Entry:** `/opt/harness/adapter.sh run | serve`.

```sh
docker build -t harness-eval/pi:dev harnesses/pi
```

## One turn

```
pi --mode json --provider <provider> --model <HE_MODEL_NAME> --thinking medium    --session-dir /harness-state/pi/sessions --session-id <UUIDv5(key)>    -e /opt/harness/extension/world-mcp.ts -- "<message>"
```

- **The message is always the last argument, after `--`.** Harbor's stock adapter put it first, so the one Terminal-Bench instruction that starts with "- " made Pi exit `Error: Unknown option: -` before any request (frontier-harness-2026-11 report, "Pi crashes on one instruction"). The tests send messages that start with "- " in both entries.
- **One argument holds at most 131072 bytes on Linux.** A longer prompt is exit 2 with that reason.
- **stdin is `/dev/null`**, and the turn runs under `setsid` with the adapter's own wall clock.
- **The reply** is the text of the last assistant `message_end` in Pi's JSON event stream.

## Model routes

The last segment of `HE_MODEL_BASE_URL` picks the provider and its `config/models.<provider>.json`. The adapter writes it to
`/harness-state/pi/agent/models.json`. `apiKey` is the literal `$HE_MODEL_API_KEY`, which Pi reads from its environment per
request, so the per-trial token is never written to a file.

| Route | Pi provider | Request (observed against the fake) | Output cap | Effort on the wire |
|---|---|---|---|---|
| `/anthropic` | built-in `anthropic` | `POST <base>/v1/messages`, streamed, `x-api-key` | `max_tokens` 128000 | `output_config.effort` medium, `thinking` adaptive (summarized) |
| `/openai` | built-in `openai` | `POST <base>/v1/responses`, streamed, Bearer | `max_output_tokens` 128000 | `reasoning {effort: medium, summary: auto}` |
| `/particle` | `particle`, added by models.json | `POST <base>/v1/chat/completions`, streamed with usage, Bearer | `max_completion_tokens` 128000 | `reasoning_effort` medium |
| `/openrouter` | built-in `openrouter` | `POST <base>/v1/chat/completions`, streamed with usage, Bearer | `max_completion_tokens` 128000 | `reasoning {effort: high}` for DeepSeek (see Effort) |

- **Any other route is exit 2 before any turn.**
- **OpenRouter** takes the bare OpenRouter id as `HE_MODEL_NAME` (for example `deepseek/deepseek-v4.1-flash-1017`). models.json lowers the catalog's 943718 output cap to 128000 so the request fits the proxy's cap.
- **Particle** is declared in models.json: Chat Completions, reasoning on, context 1048576, `max_completion_tokens`.

## Effort

**Medium on every turn (`--thinking medium`), on every route.** That matches the other multi-user harnesses (the
OpenClaw, Hermes and Codex pins, and Claude Code's default), so the multi-user cells compare at one effort. High stays the
Harbor frontier setting only (`scripts/frontier-harbor/pin.json` `effort`). Medium is also Pi's own default; the adapter sets it explicitly.

- **Except DeepSeek on OpenRouter, which gets high.** Pi's catalog row for `deepseek/deepseek-v4.1-flash-1017` has no medium level (DeepSeek has none, low, high and max). Pi raises an unsupported level to the next one up, so `--thinking medium` arrives as `reasoning {effort: high}`. This is Pi's shipped behaviour; the adapter does not override it.
- **Mid-conversation effort is off.** Pi 1.5.0's catalog rows for `claude-opus-5-5` and `gpt-6.1-sol` set `compat.supportsMidConvoEffort`. Pi then sends a fixed effort at the top level (low on Anthropic, medium on Responses) and the real level in a mid-conversation item. The metering proxy records only the top-level fields, so models.json sets the flag to false for the cell model on the Anthropic and OpenAI routes. Pi then sends the real level at the top level.
- **The proxy's record agrees.** In the serve test, every call through the real metering proxy logs `output_config_effort: medium` and `thinking_type: adaptive`.

## The world-MCP extension

[extension/world-mcp.ts](extension/world-mcp.ts) is a pass-through. At load it calls `initialize` and `tools/list` on
`HE_WORLD_MCP_URL` (Streamable HTTP, bearer `HE_WORLD_MCP_TOKEN`) and registers each tool with `pi.registerTool` under the
server's name, description, input schema and annotations. A call is one `tools/call`; the result comes back as the server sent it.

- **No added text.** No prompt snippet, guideline or instruction, so Pi's system prompt does not list the world tools. They reach the model only as tool definitions.
- **No renaming, prefix, filter or wrapper.** The model sees `whoami`, not `mcp__world__whoami`.
- **Failures.** If the tools cannot be listed, the extension prints `HE-ADAPTER-004` and ends Pi with exit 2, so no turn runs without the world. A call that fails at the transport level is exit 2 for the turn. A JSON-RPC error or a tool's own error result is the model's to handle.
- **Why not Pi's own MCP support?** Pi 1.5.0 has one (mcp.json), but it names tools `mcp__<server>__<tool>` and by default exposes them through its codemode tool. The brief asked for the world's tools as plain Pi tools. Declared as a deviation.

## What the model sees

- **System prompt:** Pi's own, starting "You are a coding assistant running inside pi, a coding agent harness." It has no `<project_instructions>` section: the adapter writes no AGENTS.md, CLAUDE.md, SYSTEM.md or APPEND_SYSTEM.md, the agent directory starts empty, and the workspace holds only `instruction.md`. Pi would load such a file from the agent directory or `/workspace` if one were there, as shipped.
- **Tools:** Pi's built-in `read`, `bash`, `edit` and `write`, then the 15 world tools. On Anthropic Pi also sends `__pi_deferred_placeholder__`.
- **Schemas, per route:**
  - OpenAI, Particle and OpenRouter: each world tool's schema is byte-equal to `tools/list`, with `strict: false` where the API has the field. On OpenAI the tools travel in an `additional_tools` input item and the top-level `tools` field is absent.
  - Anthropic: Pi's encoder keeps only `type`, `properties` and `required`. So `$schema` is dropped and an absent `required` becomes `[]`. The test checks that this is the only difference.

## Serve

- **Session key:** `dm:<member>` or `channel:<id>`, plus `:t<thread_ts>` for a thread. The session id is UUIDv5 of `harness-evals:pi:<key>`. All sessions live in `/harness-state/pi/sessions`.
- **Nothing else is shared** between conversations. Pi 1.5.0 has no memory feature. The workspace and the world are shared, as for every harness.
- **Ready** waits until the world answers `tools/list`; the ready file records the tool count.
- **A turn past its budget** gets SIGTERM, then SIGKILL after 5 s (60 s for `run`). The adapter stops the turn's session and the session of every process under Pi, because Pi's bash tool starts each command in a session of its own.

## Exit codes

| Exit | When |
|---|---|
| 0 | Pi exited 0 and its last assistant message ended with `stop` or `length` |
| 3 | the last assistant message ended with a provider error: an HTTP status from the proxy or provider (`403 {...}`, `OpenAI API error (402)`) or `Connection error.` after Pi's retries |
| 124 | the turn outlived its budget |
| 2 | everything else: no world tools, a world-MCP transport error, no assistant message, an aborted or other error, a non-zero Pi exit, a Pi version off the pin, SIGTERM during a turn, or a setting this adapter does not implement |

**Not implemented (exit 2 before ready):** `HE_HARNESS_CONFIG` other than `default` (HE-ADAPTER-007), `HE_SESSION_SCOPE=turn`,
the gbrain arm (`HE_GBRAIN_MCP_URL`) and the gbrain install ladder (`HE_GBRAIN_INSTALL`, HE-ADAPTER-006).

## Deviations from Pi as shipped

- The world's tools come from the extension, not Pi's MCP support (above).
- `compat.supportsMidConvoEffort: false` for the cell model on the Anthropic and OpenAI routes (Effort).
- OpenRouter's output cap lowered to 128000.
- `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`: no startup network operations (model catalog refresh, package or tool downloads), version check or install telemetry. The fake upstream sees only model requests.

## Tests

`tests/pi-adapter.test.ts`, keyless. The model key is a per-trial placeholder with a canary, and every test checks the canary
is in no log, state file or request body. Process-level tests use a stand-in `pi` (`tests/fixtures/pi/bin/pi`). Container
tests need docker and `harness-eval/pi:dev`, and skip otherwise.

- Pin, lockfile and Dockerfile agree with Harbor's pin.
- Each route's models.json, the turn command, the refusals and the full exit mapping.
- In the image, against the world mock and `tests/fixtures/pi/fake-upstream.ts`: one run turn per route that calls `whoami`, with the request shape and tool schemas above.
- A multi-user serve run through the real metering proxy: two members' DMs and a channel thread are separate sessions, a member's next turn carries only that member's history, a turn whose bash command outlives the budget is 124 with the command gone, and the proxy records effort medium on every call.
