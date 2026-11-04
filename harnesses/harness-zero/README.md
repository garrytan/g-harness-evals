# Harness Zero

**Harness Zero is the smallest agent harness we can read end to end.** One file, `zero.ts`, on Bun built-ins only: no npm packages, no provider SDKs. Every feature beyond the bare loop is a switch, so a run can test whether that feature earns its keep.

- **Why it exists:** it is a control harness whose prompt, tools and requests are fully known. Comparing it with Claude Code, Codex, OpenClaw and Hermes shows what their extra machinery buys.
- **Status:** keyless only. Its tests run against fake model servers through the real metering proxy. No paid trial has run yet.
- **Protocol:** the [adapter protocol](../../docs/adapters.md), like every harness here. Error codes: `HE-ZERO-001` to `HE-ZERO-009` in [docs/errors.md](../../docs/errors.md).

## Try it in two commands (no key)

```sh
docker build -t harness-eval/harness-zero:dev harnesses/harness-zero
bun harnesses/serve-smoke.ts --harness harness-zero --trial-id zero-smoke-1 --fake-upstream
```

- The first command builds the image from the pinned Bun base (`pin.json`).
- The second starts a world and a fake model server in the same process, serves three turns, and writes everything under `results/serve-smoke/zero-smoke-1/`. The fake model makes one world tool call on the first turn, then answers with short text.
- To see the exact first request a set sends, with no Docker at all:

```sh
bun harnesses/harness-zero/zero.ts explain --config zero-full
bun harnesses/harness-zero/zero.ts explain --config zero-full --diff zero-full-no-caching --provider openai
```

`explain` prints the body, its size in bytes and a token **estimate** (bytes / 4). With `--count-tokens <proxy base url>` it asks Anthropic's count_tokens route through the proxy for the **exact** number instead. There is no exact count on OpenAI or Particle.

## Always on (the core)

- **The loop:** send the conversation, run the tool calls the model asks for, send the results, repeat until the model answers without a call.
- **Sessions:** one per conversation (`dm:<member>` or `channel:<id>`), plus `:t<thread_ts>` for a thread. Stored under `/harness-state/zero/sessions/`, file name = sha256 of the key.
- **Model pinning:** every request names `HE_MODEL_NAME`. There is no fallback model.
- **MCP:** Harness Zero is its own MCP client for the world server (and gbrain when set). Tools appear as `mcp__world__<tool>`.
- **Step cap:** at most `step_cap` model requests per turn (40).
- **Identity:** one line, [`config/prompts/identity.md`](config/prompts/identity.md).
- **Retries:** 429, 500, 502, 503, 529 and overloaded answers are retried with backoff, honoring `retry-after`, never past the turn budget.

## The switches

`zero-full` has every switch on. `zero-min` has none. "Changes" is what the switch changes in a request.

| Slug | Changes | Test | Verdict |
|---|---|---|---|
| `caching` | Anthropic: `cache_control` on the system block and the last message block. OpenAI and Particle: `prompt_cache_key` per session (on or off only; OpenAI caches long prompts on its own either way) | `harness-zero-config` "every switch", `harness-zero-serve` "caching with tool-search" | pending Phase C |
| `tool-search` | the MCP tools are not sent; `tool_search` and `call_tool` are. Found tool schemas arrive in tool results, after the cached prefix, so a load does not break the cache | same two tests | pending Phase C |
| `layer-tool-use` | adds [`tool-use.md`](config/prompts/tool-use.md) to the system prompt | `harness-zero-config` "a layer switch" | pending Phase C |
| `layer-safety` | adds [`safety.md`](config/prompts/safety.md) | same | pending Phase C |
| `layer-scope` | adds [`scope.md`](config/prompts/scope.md) | same | pending Phase C |
| `layer-style` | adds [`style.md`](config/prompts/style.md) | same | pending Phase C |
| `layer-planning` | adds [`planning.md`](config/prompts/planning.md) | same | pending Phase C |
| `scoped-notes` | adds the `save_note` tool. A new session's system prompt lists the notes saved in the same scope (the key without `:t<thread_ts>`), never another scope's | `harness-zero-serve` "scoped notes" | pending Phase C |
| `output-cap` | tool results over `output_cap_bytes` (8000) are cut, with a marker saying how much. Lossy. Nothing changes in the first request | `harness-zero-serve` "output-cap" | pending Phase C |
| `mcp-instructions` | adds each MCP server's `initialize` instructions to the system prompt | `harness-zero-config` "a layer switch" | pending Phase C |
| `effort-high` | Anthropic: `thinking: {type: adaptive}` with `output_config.effort: high` (Opus 5.5 refuses `enabled` with a budget). OpenAI Responses: `reasoning.effort: high`. Chat Completions: `reasoning_effort: high` | `harness-zero-wire` "effort-high" | pending Phase C |

**The prompt files are provisional** until internal-task's per-layer keep or cut list lands. Each is short, neutral and generic, with nothing about our tasks in it.

## Sets and the candidate hash

- `HE_HARNESS_CONFIG` (a cell's `config`) picks a set. Empty means `zero-full`.
- Valid names: `zero-min`, `zero-full`, `zero-full-minus-layers` (zero-full with the five `layer-*` switches off, the bundled-layers cell), `zero-full-no-<slug>` for each switch, and the sets in [`config/candidates.json`](config/candidates.json). One exported function, `setNames()`, lists them; the runner's plan, dry-run and preflight use it.
- [`config/features.json`](config/features.json) is **frozen**: the slugs, `zero-min`, `zero-full`, `zero-full-minus-layers`, the knobs and the derivation rule. The Phase C loop writes only `candidates.json`. A candidate is a feature list, or `{features, knobs}` to change a knob.
- The **candidate hash** (`candidate_sha256` in `ready` and `explain`) covers `zero.ts`, the set's features with every knob, every prompt file the set loads, `adapter.sh`, the `Dockerfile`, and `pin.json`'s base image digest and Bun version. The set's name is not part of it.

| Knob | Default | Range | What |
|---|---|---|---|
| `step_cap` | 40 | 1 to 200 | model requests per turn |
| `retry_max` | 6 | 0 to 10 | retries of one request |
| `output_cap_bytes` | 8000 | 500 to 1,000,000 | kept bytes of a tool result under `output-cap` |
| `max_tokens` | 16000 | 1024 to 32768 | output cap on every request |
| `wire` | `anthropic` to `anthropic`, `openai` to `openai-responses`, `particle` to `chat-completions` | `chat-completions` also on `openai` | the client per provider, the last segment of `HE_MODEL_BASE_URL` |

## How a turn ends

- **Answer:** the last text the model wrote in the turn; exit 0.
- **Step cap with no text yet:** `reply_text` is `null`, exit 0, `stop_reason: step_cap` in the turn's telemetry line.
- **Model error** (401, 402, 403, or retries used up): exit 3.
- **Harness error** (a provider 400 or 422 on a request Harness Zero built, an MCP server that cannot be initialized, a malformed request file, a crash): exit 2. Serving goes on to the next request.
- **Budget:** the request in flight is aborted; exit 124.
- A failed turn keeps the tool calls that already ran, so the next turn sees them. A call it did not finish is marked unknown. A turn the provider rejected, or one that failed before any tool call, leaves the session as it was. A note saved during it stays saved.
- **MCP writes are never sent twice.** If a write's answer is lost, the model is told the outcome is unknown.
- **A stuck tool is stopped.** Each MCP tool call gets 60 s, or half the turn's remaining time if that is less, so the model can still answer inside the budget. A stopped read is an error; a stopped write is an unknown outcome. Neither is sent again. Re-initializing a tool server inside a call (after an expired session or a failed server) gets the same limit; one that does not finish in time is HE-ZERO-005.
- **A restarted MCP session reloads its tools.** After a re-initialize, the next model request lists the server's current tools.

## What it leaves behind

- `adapter.log` (a kept receipt): one `ZERO_TURN` JSON line per turn (steps, stop reason, retries, tool calls and outcomes, notes written and shown) and one `ZERO_CALL` line per tool call (id, tool, status, milliseconds). No token values.
- `zero-trace.log`: the stack of a crash, credentials redacted.
- `ready`: set, candidate hash and its inputs (the file digests), features, every knob value, wire, model, MCP servers, adapter sha256.

## Add a switch

1. Add the slug to `KNOWN_FEATURES` in `zero.ts` and implement it there, behind `has(set, '<slug>')`.
2. Add it to `features.json` (`features` and the `zero-full` list). This unfreezes the file, so it is a reviewed change, never a Phase C loop edit.
3. Add what it may change to the "every switch" test in `tests/harness-zero-config.test.ts`, and a behavior test.
4. Add a row to the table above and to this changelog.

## Changelog

### 2026-10-31: first version (internal-task)

New harness: `zero.ts` with Anthropic, OpenAI Responses and Chat Completions clients, an MCP client, eleven switches, `explain`, the adapter, the image, and the `--fake-upstream` quickstart. Why: a fully known control harness for the Harness Zero feature runs.
