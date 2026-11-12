# Claude Code: what it sends the model

**Pin:** `@anthropic-ai/claude-code@2.1.312` (image `harness-eval/claude-code:dev`), run as `claude -p` by [harnesses/claude-code](../../harnesses/claude-code/README.md). **Captured:** 2026-10-30, keyless, against a fake endpoint. Each fact says how we know it: **measured** (a capture record) or **source** (the adapter). Claude Code has no counted run yet, so there is no cost section.

## The short version

- **Mid-size prompt, almost every MCP tool deferred.** 18,416 tokens in the first request. 11 tools are sent with schemas; the 15 world tools and Claude Code's own extra tools are listed by name only.
- **Deferred tools are loaded on request.** The prompt tells the model to load a deferred tool with `ToolSearch` before calling it, and the loaded schema is added to the tools list on the next request. (The adapter's tests show a direct call by name also works.)
- **Big tool output stays out of the prompt.** A 58.6 KB command output was saved to a file, and only a 2 KB preview went into the history.
- **gbrain costs 1,903 tokens per request**, and **Claude Code is the only harness here that passes on gbrain's own operating instructions** (its MCP server instructions). OpenClaw, Hermes and QM-Pi drop them.

## First request (measured)

[records/claude-code-default/plain.json](records/claude-code-default/plain.json), tokens from [tokens.json](receipts/anatomy-capture-claude-code-default-plain-20261030t060651/tokens.json).

| Part | Tokens | What is in it |
|---|---|---|
| System prompt | 2,910 | Three blocks: a billing header line, a one-line statement that the agent runs on the Claude Agent SDK, then the main prompt. Largest sections: "Context management" 961 tokens, "Harness" 717, "Memory" 673, "Environment" 256 |
| Tool schemas | 10,780 | 11 tools with schemas plus a `DeferredToolPlaceholder`. Largest: `Workflow` 2,265, `ScheduleWakeup` 2,106, `Agent` 1,876, `Bash` 1,618, `ReportFindings` 1,107 |
| Messages | 4,726 | A user message (a commit-attribution reminder, then the runner's turn prompt), then a system-role message of 9,410 characters: the "# Environment" block, a list of 13 bundled skills (such as dataviz, code-review, claude-api and security-review, 6,169 characters), the deferred tool names (718) and the available agent types (1,638) |

- **Request settings (measured):** `max_tokens` 128,000, streaming, `thinking: adaptive`, `output_config.effort: medium`, and a `context_management` edit (`clear_thinking_20251015` with `keep: all`) that keeps all thinking blocks. Cache breakpoints on two system blocks and the system-role message; from the second call in a turn, the third breakpoint moves to the newest budget-line message.
- **Every request carries a token budget line (measured):** "<total_tokens>N tokens left</total_tokens>", at the end of the system prompt and the first system-role message, and as its own system-role message on later calls in a turn. N counts down from 15,000,000 by the tokens the fake reported, so here it reflects the fake's numbers.
- **Side traffic (measured):** none. No side calls, no refused requests and no outside DNS lookups (the sink ran in pass mode, which logs lookups but does not intercept connections). The adapter turns off non-essential traffic, telemetry, error reporting and the auto-updater (**source:** [adapter.sh](../../harnesses/claude-code/adapter.sh)), so this is the configured product, not the default one.

## Tools and MCP (measured)

- The system-role message says "The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded" and that calling them directly "will fail with InputValidationError". It names 9 of Claude Code's own tools (`CronCreate`, `NotebookEdit`, `SendMessage` and others) and the 15 world tools.
- [tools-gbrain.json](records/claude-code-default/tools-gbrain.json): after `ToolSearch` with `select:mcp__world__list_channels`, the tool result is a `tool_reference` and "Tool loaded.", and the next request has 13 tools instead of 12. A keyword search, "gbrain search", loaded 5 gbrain tools at once (18 tools).
- So Claude Code differs from OpenClaw and Hermes, which route deferred calls through a generic `tool_call`. Claude Code changes the tools list itself during the conversation.
- **Named setting (source):** the adapter sets `MCP_CONNECTION_NONBLOCKING=false`. By default `claude -p` connects MCP servers in the background, so its first request can go out before they are ready. With `false` it waits, as every other harness here does before turn 1. Garry kept this on 2026-10-30.

## gbrain (measured)

- With gbrain registered ([plain-gbrain.json](records/claude-code-default/plain-gbrain.json)): the same 12 tools and the same system prompt. The system-role message grows from 9,410 to 14,559 characters, which is the whole +1,903 tokens. It adds:
  - 33 `mcp__gbrain__*` names (about 840 characters) and three resource tool names (`ListMcpResourcesTool`, `ReadMcpResourceTool`, `ReadMcpResourceDirTool`);
  - a "# MCP Server Instructions" section with gbrain's text, "GBrain agent operating contract (apply on every cold start)", about 4,200 characters. It tells the model to search gbrain before external lookups and to call `context_pack` at session start.
- **No other harness here delivers that text.** The same string is in none of the OpenClaw, Hermes or QM-Pi requests with gbrain registered.
- The gbrain tools' own descriptions and schemas are not in the first request; they arrive when the model loads them with `ToolSearch`.

## Failures and retries (measured)

[retry.json](records/claude-code-default/retry.json): against 529, 529, 429 (retry-after 2 s), 500, Claude Code retried after 0.6 and 1.0 seconds, then **gave up on the first member's turn after the 429** (the trial ended `model_error`). The second turn's first request, 1.0 seconds later, hit the 500, was retried after 0.6 seconds and succeeded. **Source:** the adapter sets `CLAUDE_CODE_MAX_RETRIES=2`, so the give-up point is our setting, not Claude Code's default.

## History (measured)

[growth.json](records/claude-code-default/growth.json): 30 `Bash` calls that each print about 60 KB. Each result went into the history as "<persisted-output> Output too large (58.6KB). Full output saved to: ..." plus a 2 KB preview, so the request grew by about 2.6 KB per call, to 130,840 bytes. OpenClaw, given the same output, grew by about 60 KB per call. No compaction happened, but the fake never reported more than 194,000 input tokens and never refused a long prompt, so this does not show what Claude Code does at a real context limit. The second member turn is in a different conversation, so it started with a short history.

## Not measured

- **Skills:** the built-in skill list is measured (above), but no probe of skill loading or size limits was run on Claude Code.
- **Cost:** no counted run uses Claude Code yet.

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
