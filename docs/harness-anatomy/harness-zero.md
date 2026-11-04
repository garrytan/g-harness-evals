# Harness Zero: what it sends the model

**Pin:** [harnesses/harness-zero](../../harnesses/harness-zero/README.md) at harness-evals `bebcab40` (clean tree), image `sha256:59b8882bdeed77557ce164709e3e7a1053a445ff0880c337a8cc31a91da01aa8`. Two sets: **`zero-min`** (every switch off) and **`zero-full`** (every switch on). **Captured:** 2026-10-31 UTC, keyless, against the fake endpoint. Each fact says how we know it: **measured** (a capture record) or **source** (the harness code). Token counts come from Anthropic's count_tokens endpoint ($0), the same way as on the other harness pages.

## The short version

- **The smallest first requests captured so far.** 4,046 tokens for `zero-min` and 1,981 for `zero-full`, against 13,408 to 24,935 for the other harnesses.
- **`zero-full` is smaller than `zero-min`.** Its `tool-search` switch sends 3 short tools instead of the 15 world tools in full, which saves more than its five prompt layers add.
- **`tool-search` never changes the tools list.** Found schemas arrive as tool results, so the cached prefix stays the same for the whole turn.
- **gbrain costs +7,418 tokens per request on `zero-min` and +1,365 on `zero-full`.** `zero-min` sends all 33 gbrain schemas. `zero-full` sends none, but passes on gbrain's operating contract.
- **With `mcp-instructions` on, Harness Zero delivers gbrain's own instructions.** Only Claude Code does that among the field harnesses.
- **Retries ride out every failure.** Against 529, 529, 429 and 500, both sets waited 0.5, 1, 2 (the `retry-after`) and 4 seconds, then finished the turn.

## First request

[zero-min plain.json](records/harness-zero-min/plain.json) and [zero-full plain.json](records/harness-zero-full/plain.json); tokens from [zero-min tokens.json](receipts/anatomy-capture-harness-zero-zero-min-plain-20261101t005822/tokens.json) and [zero-full tokens.json](receipts/anatomy-capture-harness-zero-zero-full-plain-20261101t005852/tokens.json).

| Part | `zero-min` tokens | `zero-min` bytes | `zero-full` tokens | `zero-full` bytes | What is in it |
|---|---|---|---|---|---|
| Whole request | 4,046 | 9,984 | 1,981 | 5,594 | |
| System prompt | 13 | 36 | 233 | 820 | `zero-min`: one line, "You are the workspace assistant bot." `zero-full`: that line plus the five layer files (tool use, safety, scope, style, planning), one short paragraph each |
| Tool schemas | 2,882 | 6,134 | 597 | 811 | `zero-min`: the 15 world tools in full. `zero-full`: `tool_search`, `call_tool` and `save_note` |
| Messages | 1,151 | 3,709 | 1,151 | 3,746 | One user message: the runner's turn prompt, nothing added |

- **Tool tokens include Anthropic's own framing.** Any request with tools gets a fixed tool-use preamble from the API, so 3 short tools count 597 tokens. The other harnesses' tool numbers are counted the same way.
- **Request settings (measured):** `max_tokens` 16,000, not streamed. `zero-full` adds `thinking: adaptive` with `output_config.effort: high` (`effort-high`) and cache breakpoints on the system block and the newest message block (`caching`). `zero-min` has neither.
- **No hidden context (measured):** no environment block, no date, no skill list, no reminders. The world MCP server sends no instructions, so `mcp-instructions` adds nothing without gbrain.
- **Side traffic (measured):** none. Every request was an agent request; no side calls and no refused requests.

## Tools and MCP (measured)

- [zero-min tools-gbrain.json](records/harness-zero-min/tools-gbrain.json): the model called `mcp__world__list_channels`, `mcp__world__whoami` and `mcp__gbrain__search` by name, and all three answered. All 48 tools went out on every request.
- [zero-full tools-gbrain.json](records/harness-zero-full/tools-gbrain.json): `tool_search` for "list channels" returned `mcp__world__list_channels` with its schema. `call_tool` then ran it, and a search for "gbrain search" returned the gbrain tools.
- **The tools list stayed at 3 on all 5 requests.** The system breakpoint never moved; the message breakpoint moved to the newest message each time. So a tool load does not break the cache. Claude Code instead adds the loaded tool to its tools list.

## gbrain (measured)

- **`zero-min`** ([plain-gbrain.json](records/harness-zero-min/plain-gbrain.json)): 48 tools instead of 15, the 33 gbrain tools in full. The request grows from 4,046 to 11,464 tokens (9,984 to 27,899 bytes), +7,418 ([tokens.json](receipts/anatomy-capture-harness-zero-zero-min-plain-gbrain-20261101t005825/tokens.json)).
- **`zero-full`** ([plain-gbrain.json](records/harness-zero-full/plain-gbrain.json)): the same 3 tools. The system prompt grows from 233 to 1,598 tokens (820 to 5,003 bytes), and the request from 1,981 to 3,346, +1,365 ([tokens.json](receipts/anatomy-capture-harness-zero-zero-full-plain-gbrain-20261101t005855/tokens.json)). All of it is "Instructions from the gbrain tool server:" followed by gbrain's text, "GBrain agent operating contract (apply on every cold start):".
- **So `mcp-instructions` is the switch that decides whether gbrain's contract reaches the model.** The planned gbrain arm compares the same harness with it on and off.

## Failures and retries (measured)

[zero-min retry.json](records/harness-zero-min/retry.json) and [zero-full retry.json](records/harness-zero-full/retry.json): against 529, 529, 429 (`retry-after` 2 s), 500, Harness Zero sent the same body again after 0.5, 1.0, 2.0 and 4.0 seconds, and the fifth request succeeded. No turn was lost. **Source:** retries are core (always on), up to `retry_max` 6, backoff from 500 ms that honors `retry-after`, never past the turn budget.

## History (measured)

[zero-min growth.json](records/harness-zero-min/growth.json) and [zero-full growth.json](records/harness-zero-full/growth.json): 30 `list_channels` calls (through `call_tool` in `zero-full`).

- **The whole history went out every time.** The body grew by about 3 KB per call, to 101,406 bytes (`zero-min`) and 97,992 bytes (`zero-full`). No compaction. Harness Zero has none by design.
- **This does not show large tool output.** Harness Zero has no shell tool, so the growth probe used a world read with a small result, under the 8,000-byte `output-cap` limit. The cap's cut-and-marker behavior is tested in `tests/harness-zero-serve.test.ts`, not here.
- The fake never reported more than 194,000 input tokens and never refused a long prompt, so this does not show what happens at a real context limit. The second member turn is in a different conversation, so it started a new session (`kind: new_session` in the record).

<details>
<summary>How these captures differ from the other harnesses'</summary>

- **Tokens:** `scripts/anatomy/count-tokens.ts` through the metering proxy started with `--free-count-tokens`, the provider key in the proxy's environment only. 216 calls, $0: [usage-harness-zero.ndjson](count-tokens/usage-harness-zero.ndjson), script sha256 in [run.json](count-tokens/run.json). All 10 captures were counted; retry, growth and tools-gbrain share their first request with plain or plain-gbrain.
- **Network:** Harness Zero cells must run on the internal network, so these captures did too, without the egress sink. The internal network test shows a direct connection out fails from inside the container. **Egress is not logged here.**
- **Model name:** `claude-haiku-5-5`, the kit's default, so the fake's reported usage stays inside the capture's virtual lease. The fake ignores the name, and Harness Zero sizes nothing from it.
- **gbrain:** the keyword sidecar image at gbrain `a590ad07` (`scripts/build-gbrain-image.sh`, keyless).
- **Provenance:** every `capture.json` names `bebcab40` with `dirty: false` and the image digest above. The captured image ran Bun 1.4.4; the harness now pins Bun 1.4.3, the version the repository's CI runs. zero.ts has since gained PR 1a's review fixes (rejected-request history, restarted turns, SSE reads, call_tool argument checks); none of them changes the system prompt, the tool list or any request these scenarios send.

</details>

## Not measured

- **Large tool output:** no shell tool, so no 60 KB probe.
- **Cost:** no counted run uses Harness Zero yet.
- **OpenAI and Particle wires:** the capture kit's fake speaks only Anthropic's Messages API. `bun harnesses/harness-zero/zero.ts explain` shows those first requests from a sample catalog.

## Changelog

### 2026-10-31: first captures (internal-task)

`zero-min` and `zero-full` captured on plain, plain-gbrain, tools-gbrain, retry and growth, with count_tokens counts. Why: a fully known control harness needs its own anatomy beside the field's.
