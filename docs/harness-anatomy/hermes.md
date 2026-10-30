# Hermes Agent: what it sends the model

**Pin:** `NousResearch/hermes-agent` tag `v2026.9.24` (image `harness-eval/hermes:dev`), one-shot mode (the mode counted runs use). Chat mode is shown from the internal-task overlay probe. **Captured:** 2026-10-30, keyless, against a fake endpoint. Each fact says how we know it: **measured**, **source** or **cost**.

## The short version

- **Small system prompt, heavy tool list.** 15,040 of the first request's 20,613 tokens are tool schemas (24 tools). The system prompt is 4,422.
- **Every MCP tool sits behind `tool_search`**, the task's world tools included. gbrain adds only a name and a one-line description per tool, inside `tool_search`'s description.
- **Skill descriptions are cut to 57 characters** in the skill list.
- **It gave up a member's turn after three failures in a row**, and it is the only harness that compacted its history in the growth test.

## First request (measured)

[records/hermes-default/plain.json](records/hermes-default/plain.json), tokens from [tokens.json](receipts/anatomy-capture-hermes-default-plain-20261030t023914/tokens.json).

| Part | Tokens | What is in it |
|---|---|---|
| System prompt | 4,422 | `<available_skills>` 2,151 tokens (about half), "Mid-turn user steering" 691, "Parallel tool calls" 516, Hermes's own opening ("You are Hermes Agent, built by Nous Research...") 407, "Finishing the job" 219 |
| Tool schemas | 15,040 | 24 tools. Largest: `delegate_task` 1,837, `skill_manage` 1,621, `terminal` 1,598, `memory` 1,508, `browser_exec` 1,501, `tool_search` 1,441; five `browser_vault_*` tools |
| Messages | 1,151 | One user message: the runner's turn prompt (our task preamble with the member's request filled in) |

- **Request settings (measured):** `max_tokens` 128,000, streaming, no thinking setting. Cache breakpoints on both system blocks and the user message.
- **Side traffic (measured):** each trial made 24 model-discovery requests (30 in the growth capture) to 10 paths such as `/v1/models`, `/api/show` and `/api/tags`, which the metering proxy refused ([proxy-usage.ndjson](receipts/anatomy-capture-hermes-default-plain-20261030t023914/proxy-usage.ndjson)). Its container also looked up pypi.org, models.dev and github.com ([egress.ndjson](receipts/anatomy-capture-hermes-default-plain-20261030t023914/egress.ndjson)).
- **Cost (cost):** in the m3 run, 2,706 refused requests sat beside Hermes's 1,056 paid ones; refused requests cost nothing.

## Tools and MCP (measured)

- `tool_search`'s description says "Search 19 additional tools that are loaded on demand" and lists each one's name with a one-line description. **The 15 world tools are among them, so their full schemas are not in the request.** The model can load one with `tool_describe` (the description says to skip `tool_search` when it already sees the exact name) and then call it.
- In our scripted tools capture the world tools were never offered directly ([tools-gbrain.json](records/hermes-default/tools-gbrain.json)).

## gbrain (measured)

- With gbrain registered ([plain-gbrain.json](records/hermes-default/plain-gbrain.json)): still 24 tools. `tool_search` now says "Search 54 additional tools" and grows from 1,441 to 2,759 tokens, which is the whole +1,318. The 35 new entries are gbrain's 33 tools plus `list_resources` and `read_resource` for gbrain's MCP resources, each with a one-line description.
- The ladder result fits: MCP registration alone, 0 gbrain uses in 100 trials ([gbrain ladder](../benchmarks/2026-10-25-gbrain-ladder/report.md)).

## Skills

- **Source:** `agent/skill_utils.py:763`, `SKILL_PROMPT_DESC_LIMIT = 60`: a longer description is cut to 57 characters plus "...". **Measured:** our probe entries read "Anatomy probe skill of about 12 KB. Use only when asked f..." ([skills.json](records/hermes-default/skills.json)).
- **Measured:** once opened with `skill_view`, a skill is served whole: every probe up to 80 KB came back complete (an 83,513-byte reply).
- **Source:** Hermes finds skills in several places (`agent/skill_utils.py`): `HERMES_HOME/skills`, the skill-create directory and `skills.external_dirs` (`get_all_skills_dirs()`), plus a project's `.hermes/skills` or `.agents/skills` when that project is listed in `skills.trusted_project_dirs` (`get_project_skills_dirs()`, which takes precedence). Our probes used `HERMES_HOME/skills`.

## Failures and retries (measured)

[retry.json](records/hermes-default/retry.json): against 529, 529, 429 (retry-after 2 s), 500, Hermes retried the first turn after 3.6 and 6.1 seconds, then **gave up on that member's turn after the 429** (the runner logged "exit 3, no reply (model error)"). Its next request, 16.9 seconds later, was the second member's turn; it retried that one's 500 after 2.9 seconds and succeeded. The SDK header `x-stainless-retry-count` stayed 0, so Hermes retries on its own rather than through the Anthropic SDK.

## History (measured)

[growth.json](records/hermes-default/growth.json): after the fake reported 152,000 input tokens (146,000 on the call before did not trigger it), Hermes sent a separate summarization request ("You are a summarization agent creating a context checkpoint...") and then continued with 13 messages instead of 45, keeping the member's original message first. In one-shot mode it refused the growth command as dangerous, so its tool results were small; the trigger came from the token counts the fake reported, not real bytes.

## Chat mode (measured, internal-task overlay)

[gsta135-probe.json](records/hermes-chat-gsta135-overlay/gsta135-probe.json): 59,152 body bytes, 24 tools, an 18,580-byte system prompt whose largest section is `<available_skills>` (10,724 bytes, with gstack skills installed). It is a different image and configuration from the counted path above.

## Cost in a counted run

From the [m3 held-out run](../benchmarks/2026-10-24-m3-heldout/report.md), Sonnet, 100 trials ([split](cost/m3-heldout-2026-10.split.json)):

| Billed component | Share of $12.26 | Tokens |
|---|---|---|
| Cache reads | 46.2% | 28,312,872 |
| Cache writes | 33.9% | 1,660,833 |
| Output | 19.9% | 244,469 |
| Uncached input | under 0.1% | 2,564 |
