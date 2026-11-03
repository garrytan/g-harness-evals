# QM: what it sends the model

**Pins:** [QM](https://github.com/yc-software/qm) main `b6786d67` (Pi only), in the first section, and tag `v0.1.15` (commit `7417aa2a`) below it, with two inner engines: **Pi** (the default, what counted QM cells run) and the **Claude Agent SDK** (config `claude`). **Captured:** keyless, against a fake endpoint: `b6786d67` on 2026-10-31 UTC, `v0.1.15` on 2026-10-30 UTC. Each fact says how we know it: **measured**, **source** or **cost**.

## QM at b6786d67 (captured 2026-10-31 UTC)

**Pin:** QM main `b6786d67` (commit `b6786d675f83d9a818c5d5335cc017ffea9ec7a7`), Pi only; QM removed the Claude SDK engine at this commit. Captured keyless from harness-evals `12e1ad9b` (clean tree), core image `sha256:dea5ec20c66e15be540702967c10acbd5e3c33fb7273f1575b04caad10b6b55d`. Records: [records/qm-pi-b6786d67/](records/qm-pi-b6786d67/). The v0.1.15 sections below are unchanged.

**The short version**

- **The first request is a third smaller: 13,408 tokens, down from 20,492.** Tool schemas fell from 15,809 to 8,327 tokens, because MCP tools are no longer sent with their schemas.
- **MCP tools now sit behind `tool_search` and `mcp_call`.** 15 tools are sent directly, all QM's own. The 15 world tools are one line each in a `## Connectors` section of the system prompt.
- **Registering gbrain costs 1,490 tokens per request, down from 11,771.** All of it is 34 more lines in the Connectors section; the tool list and the messages do not change.
- **gbrain's operating contract still does not reach the model.** Only its first line shows: `GBrain agent operating contract (apply on every cold start):`, a heading with none of the rules under it.
- **Per-turn context moved from the user message into the system prompt.** The user message fell from 10,171 bytes (about 10.2 KB) to 3,750; its `<environment>` block is 83 bytes, down from 6,502.
- **Agent requests ask for a 1-hour cache.** At v0.1.15 they used the default 5-minute cache. A 1-hour cache write is billed at a higher rate, so this can change what a QM run costs.
- **Session-title side calls keep the 5-minute cache.** Their breakpoints are `{type: ephemeral}` with no `ttl`.

**First request (measured)**

[plain.json](records/qm-pi-b6786d67/plain.json); tokens from [tokens.json](receipts/anatomy-capture-qm-pi-plain-20261031t010849/tokens.json).

| Part | b6786d67 | v0.1.15 | What changed |
|---|---|---|---|
| Whole request | 13,408 | 20,492 | |
| System prompt | 3,873 | 1,341 | Now holds Skills (1,815 tokens, 5,565 bytes), Connectors (621), Credentials, Sandboxes and Where you are |
| Tool schemas | 8,327 | 15,809 | 15 tools, down from 28: QM's own 13 plus `tool_search` and `mcp_call`. Largest: `background` 1,429, `execute` 1,339, `goal` 1,267 |
| Messages | 1,208 | 3,342 | One user message of 3,750 bytes |

- **Request settings (measured):** streaming, `thinking: adaptive`, `max_tokens` 128,000, as before. Cache breakpoints on the system prompt, the last tool (`mcp_call`) and the user message, each `{type: ephemeral, ttl: 1h}` (v0.1.15: no `ttl`, so 5 minutes). Every agent request in the four captures carries `ttl: 1h`: 2 in plain and in plain-gbrain, 32 in growth, 6 in retry.
- **Side calls (measured):** one session-title call per member turn (5,224 and 5,148 bytes, no tools), as before. Their 2 cache breakpoints are `{type: ephemeral}` with no `ttl`, the 5-minute default; 2 such calls in each capture.

**gbrain (measured)**

[plain-gbrain.json](records/qm-pi-b6786d67/plain-gbrain.json); [tokens.json](receipts/anatomy-capture-qm-pi-plain-gbrain-20261031t010914/tokens.json).

| | World only | World and gbrain |
|---|---|---|
| Whole request | 13,408 | 14,898 |
| Connectors section | 621 tokens, 1,847 bytes | 2,111 tokens, 5,952 bytes |
| Lines in it | 1 server, 15 tools | 2 servers, 48 tools |

- **The rest of the request is identical byte for byte.** The system prompt before Connectors and every message match between the two captures, so the 1,490 tokens are the gbrain lines alone.
- **QM's budget estimate undercounts.** QM caps the section at 2,000 tokens, estimating 4 characters per token (`src/agent/deferred-tools.ts:66-68`).
  - **Its estimate:** 1,460 summed over the lines it emitted. Its own algorithm charges 1,466, because it prices each server line in its first form, with `none shown` (`src/agent/deferred-tools.ts:107-108`).
  - **The count:** 2,111. Both estimates are under 2,000, so the list is marked complete, and every gbrain tool is listed.
- **Each tool gets one line.** Its description is cut to 120 characters (`firstLine`, `src/agent/deferred-tools.ts:70-73`); with the `  - ` prefix and the tool name the longest gbrain line is 147. The model sees a tool's parameters only after calling `tool_search`.
- **The about line comes from the server's instructions.** QM shows `serverInfo.description`, or else the first line of the instructions (`src/mcp/mcp-client.ts:94`). gbrain sends no description (`serverInfo` is `{name, version}`, gbrain `src/mcp/server.ts:371` at `32366ac2`), so the line is the instructions' first line, which QM trims (`firstLine`): a 60-character heading.
- **Source, not measured:** under QM's default approval policy a connector tool needs approval when it declares `destructiveHint: true` (`src/mcp/mcp-tool-service.ts:37-44`). gbrain declares it only on `forget` (gbrain `src/core/verbs.ts:463`), so a QM agent's `forget` call would wait for approval.

**Failures and retries (measured)**

[retry.json](records/qm-pi-b6786d67/retry.json): against 529, 529, 429 (retry-after 2 s), 500, QM-Pi retried the same body after 2.0, 4.0, 8.0 and 17.2 seconds and finished the turn. v0.1.15: 2.0, 4.0, 8.0 and 16.1 seconds.

**History (measured)**

[growth.json](records/qm-pi-b6786d67/growth.json): the whole history kept for 30 tool calls (61 messages), then `kind: new_session` for the second member turn, as at v0.1.15. Each `execute` answered `this scope has no default sandbox; use sandbox list, create, set_default, then retry`, so the 30 tool results were short errors again.

**Not measured at b6786d67**

- **Egress:** every capture ran with the egress sink off; core is on the host network either way.
- **Skills:** no skills probe.
- **Tokens:** 132 count_tokens calls through the metering proxy at $0 ([usage-qm-b6786d67.ndjson](count-tokens/usage-qm-b6786d67.ndjson)).

## QM v0.1.15 (captured 2026-10-30)

### The short version

- **Tiny system prompt, every tool in full.** About 1,350 tokens of system prompt; 28 tools (Pi) or 29 (Claude SDK) sent directly, the 15 world tools included. Nothing hides behind a search tool.
- **Per-turn context goes in the user message, not the system prompt.** Time, place, people, credentials, connected apps and skills sit in an `<environment>` block of about 6.5 KB at the end of the user message, after the runner's turn prompt.
- **Registering gbrain costs 11,771 tokens per request on Pi**, because its 33 tools are sent in full.
- **Cheapest in the m3 run**, with half its billed dollars in cache writes.

### First request (measured)

[records/qm-pi/plain.json](records/qm-pi/plain.json) and [records/qm-claude/plain.json](records/qm-claude/plain.json); tokens from [Pi](receipts/anatomy-capture-qm-pi-plain-20261030t024338/tokens.json) and [Claude SDK](receipts/anatomy-capture-qm-claude-plain-20261030t024424/tokens.json) `tokens.json`.

| Part | Pi | Claude SDK | What is in it |
|---|---|---|---|
| System prompt | 1,341 | 1,391 | "System orientation" 422 tokens, "This session" 215, then rules for talking to users, auth, crons, files |
| Tool schemas | 15,809 | 19,256 | Pi: largest `background` 2,151, `execute` 1,954, `goal` 1,722, `apps` 1,681, `memory` 1,449. Claude SDK: the same tools as `mcp__qm__*`, plus the SDK's own `Agent` (delegation) at 3,133 |
| Messages | 3,342 | 4,288 | One user message (about 10.1 KB): on Pi a date line, then the runner's turn prompt (our task preamble with the member's request filled in), then the 6,502-byte `<environment>` block (local time, "Where you are", sandbox, who is in the conversation, credentials, connected apps, skills). The Claude SDK adds a second, system-role message in `messages`: a 2,528-byte `# Environment` block |

- **Request settings (measured):** streaming, `thinking: adaptive` on both. `max_tokens` 128,000 on Pi, 32,000 on the Claude SDK. Cache breakpoints: Pi on the system prompt, the last tool and the user message; the Claude SDK on two system blocks and its system-role `# Environment` message.
- **Side calls (measured):** Pi makes one session-title call per member turn (about 5.2 KB, no tools). The Claude SDK makes three per turn, 6 in the capture (5.9 to 14.2 KB): two "naming a coding session" calls and one "short title for a chat conversation" call. It also called `/api/hello` 4 times, which the metering proxy refused.
- **Cost:** in the m3 run, QM's utility calls on `claude-haiku-5-5` were outside the run's model allowlist and were refused at no cost ([report](../benchmarks/2026-10-24-m3-heldout/report.md)), so the counted QM cost has no side calls in it.
- **Source:** the Claude SDK engine turns Claude Code's own tools, skills and settings off and bridges QM's tools as its only MCP server ([harnesses/qm/README.md](../../harnesses/qm/README.md)).

### gbrain (measured)

- With gbrain registered ([plain-gbrain.json](records/qm-pi/plain-gbrain.json)): 61 tools instead of 28. All 33 gbrain tools are sent in full on every request, which is the whole +11,771 tokens.
- That is the most visible gbrain of the three harnesses, and the most expensive to carry. On OpenClaw and Hermes the same registration costs 0 and 1,318 tokens and gbrain sits behind `tool_search`.

### Failures and retries (measured)

[retry.json](records/qm-pi/retry.json): against 529, 529, 429 (retry-after 2 s), 500, QM-Pi retried the same request after 2.0, 4.0, 8.0 and 16.1 seconds (doubling each time) and finished the turn. The retried body was identical each time.

### History (measured)

[growth.json](records/qm-pi/growth.json): QM kept the whole history for 30 tool calls (61 messages), then the second member turn, in a different conversation (a channel after a DM), started with one message (`kind: new_session`, not a compaction). QM's shell tool needs a sandbox the capture does not create, so the 30 tool results were short errors; this shows history kept whole, not how QM handles large tool output.

### Not measured

- **Egress:** QM's core uses the host network, so the logging sink did not see its outbound traffic.
- **Skills:** no skills probe was run on QM.

## Cost in a counted run

From the [m3 held-out run](../benchmarks/2026-10-24-m3-heldout/report.md), Sonnet, Pi engine, 100 trials ([split](cost/m3-heldout-2026-10.split.json)):

| Billed component | Share of $6.10 | Tokens |
|---|---|---|
| Cache writes | 49.1% | 1,198,109 |
| Cache reads | 36.9% | 11,251,376 |
| Output | 13.9% | 84,872 |
| Uncached input | under 0.1% | 1,518 |

- QM-Pi made 534 requests, against 909 for OpenClaw and 1,056 for Hermes. Its average request cost $0.0114, about the same as Hermes ($0.0116) and 40% below OpenClaw ($0.0190). The capture does not say which differences cause that.

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
