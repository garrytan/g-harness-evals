# DeepSeek Harness (dsh)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `0.2.2-rc.1` (npm `@deepseek-ai/dsh`, a developer preview, MIT), installed from a lockfile on `node:24-bookworm-slim`. Source read at tag `dsh-v0.2.2-rc.1` (`66491b05`).

**Status: keyless only.** Every check below ran against a fake streaming endpoint and an in-process world. No paid trial yet.

## How it runs

- **`run`** is one turn: `dsh --profile headless --json --permission-mode workspace-write --approval-policy never -` with `/workspace/instruction.md` on stdin.
- **`serve`** answers each `TurnRequest` with one headless turn. The first turn of a session key (`dm:<member>`, `channel:<id>`, `:t<thread_ts>` for a thread turn) starts a new dsh Session. The adapter records its id from the opening `session` event in `/harness-state/dsh-sessions.json`, and later turns of that key pass `--session-id <id>`. All Sessions share one `DSH_HOME` (`/harness-state/.dsh`). Only `HE_SESSION_SCOPE=conversation` is supported.
- **Headless** is dsh's own one-shot profile: one task per process, newline-delimited JSON events, no port.

## Configuration

The adapter writes the headless profile's user patch layer, `/harness-state/.dsh/profiles/headless/cordis.patch.yml`, from `config/route.<route>.patch.yml` and `config/base.patch.yml`. It copies it to `$HE_LOG_DIR/cordis.patch.yml` and checks that `dsh --dump-config` composes it before the first turn.

- **One provider, the proxy.** A hand-declared pi-ai provider `he-<route>` with `apiKeyEnv: HE_MODEL_API_KEY` and the cell model. The route is the last segment of `HE_MODEL_BASE_URL`:

| Route | Wire | Reasoning sent | Replayed on the tool turn |
|---|---|---|---|
| `/anthropic` | Messages, `/v1/messages` | `thinking: adaptive`, `output_config.effort: high` | the signed thinking block |
| `/openai` | Responses, `/v1/responses` | `reasoning.effort: high`, `include: reasoning.encrypted_content` | the encrypted reasoning item |
| `/particle` | Chat Completions | `reasoning_effort: high` | `reasoning_content` |
| `/openrouter` | Chat Completions | `reasoning: {effort: high}` | `reasoning_details` |

- **Effort high, cap 128000** on every route.
- **Off:** the direct DeepSeek API and account adapters, DeepSeek's package inventory, web search and web fetch, and agent-instruction loading. Session telemetry is `DISABLED` (shipped: `FEEDBACK_ONLY`). `pin.json` `profile_patch` gives the reason for each row.

## What to know before reading a dsh result

- **DeepSeek's own model runs on the OpenRouter route.** `deepseek/deepseek-v4.1-flash-1017` goes through `<proxy>/<slot>/openrouter`. dsh's pi-ai layer keeps the `reasoning_details` OpenRouter streams with each assistant message and sends them back on that message in every later request, the tool-call message included and across `--session-id` resumes. Observed keyless; whether OpenRouter's DeepSeek endpoint accepts them live is a paid question.
- **World MCP is native.** dsh ships an MCP client plugin, `@deepseek-ai/dsh-mcp-client`. At serve start the adapter inserts a row for `world` (Streamable HTTP, bearer read from `HE_WORLD_MCP_TOKEN` at load, so the file holds no token, `failOnStartupError: true`) and a `gbrain` row on a gbrain cell. Tools are `mcp__world__<tool>`. A configured client also adds three MCP resource tools.
- **No instruction file is loaded.** Shipped dsh loads `AGENTS.md`, `CLAUDE.md` and their `.local` overlays from the project root down to the working directory, plus `$DSH_HOME/AGENTS.md`. We turn that plugin off. Observed: with it on, a `/workspace/AGENTS.md` reached the request; with it off, none of the seeded files did.
- **Workspace skills are listed.** The shipped skill catalog stays on. A skill in `/workspace/.agents/skills` has its name and description listed in the request; its body is read only when the model calls the `skill` tool.
- **Shell commands are sandboxed.** dsh's local sandbox runs every shell command under Landlock in the container (no bwrap in the image). Writes inside `/workspace` work; writes to `/opt/harness` and `/harness-state` are denied. The shell's environment showed neither the trial token nor any `*_API_KEY` canary.
- **Housekeeping model.** dsh sends one session-title request (no tools, 4096-token cap) after the first message of each new Session. It uses the cell's own route and model, its shipped default, so it is metered as the cell model and is never scored.
- **Tools.** 22 native tools (bash, read, write, edit, glob, grep, subagents, jobs, goals, todos, skill and others), plus the MCP resource tools and the world tools on serve. No web tool.

## Exit mapping

0 when dsh exits with a `final` event of kind `completed`. 124 when the budget runs out: the turn runs under `setsid`, the adapter signals its process group, then kills every process carrying the turn's marker. 3 when the final error starts with an HTTP status (`NNN: <body>`) or has code `TRANSPORT`. 2 for anything else, and before any turn for an unsupported route, `HE_HARNESS_CONFIG` other than `default`, `HE_GBRAIN_INSTALL`, a per-turn scope or a dsh version other than `pin.json`'s.

## Tests

`bun test tests/dsh-adapter.test.ts`, keyless. The process level runs the adapter against a stub `dsh`. The container level builds the image and runs `serve` on the OpenRouter route (three multi-user turns, world-MCP calls as the bot, the DM Session resumed with its reasoning, tool parity with the world server) and `run` on the Anthropic, OpenAI and Particle routes, Particle through the real metering proxy in lease mode. The fake endpoint is `tests/fixtures/dsh/fake-upstream.ts`.

## Changelog

### 2026-11-09: Image, adapter and keyless tests (internal-task)

First image, profile patches, adapter (`run` and `serve`) and keyless tests. No paid trial yet.
