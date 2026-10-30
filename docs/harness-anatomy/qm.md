# QM: what it sends the model

**Pin:** [QM](https://github.com/yc-software/qm) tag `v0.1.15` (commit `7417aa2a`), two inner engines: **Pi** (the default, what counted QM cells run) and the **Claude Agent SDK** (config `claude`). **Captured:** 2026-10-30, keyless, against a fake endpoint. Each fact says how we know it: **measured**, **source** or **cost**.

## The short version

- **Tiny system prompt, every tool in full.** About 1,350 tokens of system prompt; 28 tools (Pi) or 29 (Claude SDK) sent directly, the 15 world tools included. Nothing hides behind a search tool.
- **Per-turn context goes in the user message, not the system prompt.** Time, place, people, credentials, connected apps and skills sit in an `<environment>` block of about 6.5 KB at the end of the user message, after the runner's turn prompt.
- **Registering gbrain costs 11,771 tokens per request on Pi**, because its 33 tools are sent in full.
- **Cheapest in the m3 run**, with half its billed dollars in cache writes.

## First request (measured)

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

## gbrain (measured)

- With gbrain registered ([plain-gbrain.json](records/qm-pi/plain-gbrain.json)): 61 tools instead of 28. All 33 gbrain tools are sent in full on every request, which is the whole +11,771 tokens.
- That is the most visible gbrain of the three harnesses, and the most expensive to carry. On OpenClaw and Hermes the same registration costs 0 and 1,318 tokens and gbrain sits behind `tool_search`.

## Failures and retries (measured)

[retry.json](records/qm-pi/retry.json): against 529, 529, 429 (retry-after 2 s), 500, QM-Pi retried the same request after 2.0, 4.0, 8.0 and 16.1 seconds (doubling each time) and finished the turn. The retried body was identical each time.

## History (measured)

[growth.json](records/qm-pi/growth.json): QM kept the whole history for 30 tool calls (61 messages), then the second member turn, in a different conversation (a channel after a DM), started with one message (`kind: new_session`, not a compaction). QM's shell tool needs a sandbox the capture does not create, so the 30 tool results were short errors; this shows history kept whole, not how QM handles large tool output.

## Not measured

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
