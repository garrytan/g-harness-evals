# Codex: what it sends the model

**Pin:** `openai/codex` 0.165.0 (image `harness-eval/codex:dev`), run as `codex exec` by [harnesses/codex](../../harnesses/codex/README.md), on the OpenAI Responses API with model `gpt-6.1-sol`. **Captured:** 2026-10-31, keyless, against a fake endpoint, from a clean commit. Each fact says how we know it: **measured** (a capture record) or **source** (the adapter or pin). Codex has no counted run yet, so there is no cost section.

**Token counts on this page are local estimates.** They come from the o200k_base tokenizer run on our machine, not from OpenAI. OpenAI renders tools and message framing in its own format, so its `input_tokens` will differ. Don't compare them one to one with the Anthropic counts on the other pages.

## The short version

- **Mid-size prompt, one big tool.** About 12,900 tokens in the first request. `exec`, a JavaScript tool that wraps 11 more tools, is 3,677 of the 5,896 tool tokens.
- **The task's MCP tools are not in the request at all.** The 15 world tools are not named anywhere. The model can still call them as `tools.mcp__world__<name>` inside `exec`, and find them by filtering the `ALL_TOOLS` list there.
- **No `instructions` field.** Codex puts its whole system prompt in four developer messages.
- **It turns on multi-agent mode, then turns it down.** One developer message makes the model the root of a team of agents; the next says not to spawn sub-agents unless asked. The six collaboration tools are still sent.
- **No side traffic.** Only the two agent requests, both on the cell model.

## First request (measured)

[records/codex-sol/plain.json](records/codex-sol/plain.json), tokens from [tokens.json](receipts/anatomy-capture-codex-sol-plain-20261031t205126/tokens.json) (local, o200k_base).

| Part | Tokens (local) | What is in it |
|---|---|---|
| System prompt | 5,494 | Four developer messages, 27,694 bytes, 25 sections. Codex's own prompt ("You are Codex, an agent based on GPT-6.", 21,779 bytes); skills, permissions and `request_user_input` notes; a `<multi_agent_role>` block; a `<multi_agent_mode>` block. Largest sections: "# Working with the user" 533 tokens, `<multi_agent_role>` 530, "# Rules for getting work done" 526, `<skills_instructions>` 457, "## Writing style" 442, "# When to ask the user for permission" 409 |
| Tool schemas | 5,896 | 11 tools in three namespaces: `exec` 3,677, `wait` 315, `request_user_input` 287, `request_user_input_async` 295 (functions); `sleep` 90 (clock); `spawn_agent` 643, `wait_agent` 135, `followup_task` 132, `send_message` 101, `interrupt_agent` 84, `list_agents` 75 (collaboration) |
| Messages | 1,033 | Two user messages: an `<environment_context>` block (working directory, shell, date, time zone, file-system permissions), then the runner's turn prompt |

- **Request settings (measured):** `max_output_tokens` 128,000, streaming, `reasoning: { effort: medium, context: all_turns }`, `text.verbosity: low`, `parallel_tool_calls: false`, `store: false`, `include: [reasoning.encrypted_content]`, `tool_choice: auto`. A `prompt_cache_key` equal to the conversation id. `client_metadata` carries an installation id and turn metadata, including `sandbox_mode: danger-full-access`.
- **Who sets the output cap:** Codex sends none (**source:** [pin.json](../../harnesses/codex/pin.json)); the metering proxy writes the cell's cap. **Measured:** a capture with the proxy cap at 100,000 reached the fake with `max_output_tokens` 100,000 ([probe](cap-probe/anatomy-capture-codex-sol-cap100k-plain-20261031t205806/)). The reasoning effort comes from the adapter's config (**source:** [config.toml](../../harnesses/codex/config/config.toml)).
- **Headers (measured):** `originator: codex_exec`, `user-agent: codex_exec/0.165.0 (Debian 12.0.0; x86_64) dumb (codex_exec; 0.165.0)`.
- **Side traffic (measured):** none. Two requests, both `/v1/responses` on `gpt-6.1-sol`, none refused ([proxy-usage.ndjson](receipts/anatomy-capture-codex-sol-plain-20261031t205126/proxy-usage.ndjson)). The container ran on the internal network with no outside route and no DNS, so outside lookups were not possible, not merely absent.

## Tools and MCP (measured)

- **All 11 tools arrive in one `additional_tools` input item**, grouped in namespaces. The request has no top-level `tools` field.
- **`exec` is a JavaScript runner with its own tool set.** Its description documents 11 nested tools under `###` headings (`exec_command`, `write_stdin`, `apply_patch`, `view_image`, four goal tools, three MCP resource tools and `clock__curr_time`). It says every nested tool is on a global `tools` object, that "some deferred nested tools may be omitted from this description", and that the model can find them by filtering `ALL_TOOLS`.
- **The 15 world tools are among the omitted ones.** No `mcp__world__` name appears in the request; the adapter's probe saw all 15 on the server ([adapter.sh](../../harnesses/codex/adapter.sh) `mcp_probe`).
- [tools.json](records/codex-sol/tools.json): our script called `mcp__world__list_channels` and `mcp__world__whoami` as `exec` code (`await tools.mcp__world__list_channels({})`) and both returned world data in the next request, so a call by name works without loading anything first. That differs from Claude Code, which loads a tool into its list, and from OpenClaw and Hermes, which route calls through a generic `tool_call`.

## Not measured

- **Failures, history growth and skills:** only the plain and tools scenarios were captured for Codex.
- **gbrain:** not captured with gbrain registered.
- **Provider token counts:** OpenAI's own count is not available at $0 through our proxy, so the counts here are local.
- **Cost:** no counted run uses Codex yet.
