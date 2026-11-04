# Harness anatomy

**What each harness actually sends the model, byte for byte, before the model does anything.** We ran each harness against a fake model endpoint and logged every request. No real model was called. Token counts for the Anthropic captures come from Anthropic's free count_tokens endpoint ($0); Codex's are local o200k_base estimates, labelled as such.

**Per-harness pages:** [OpenClaw](openclaw.md) · [Hermes Agent](hermes.md) · [QM](qm.md) · [Claude Code](claude-code.md) · [Codex](codex.md). This page has the comparison, the cost split and the index of records.

## The short version

- **The harness decides what the model can see, and the harnesses decide very differently.** Same task, same model name, first request:

| Harness | Tokens in the first request | System prompt | Tool schemas | Messages | Tools sent directly |
|---|---|---|---|---|---|
| OpenClaw 2026.10.6 | 18,356 | 10,288 | 6,815 | 1,253 | 14 (47 more named in the system prompt, one line each) |
| Hermes v2026.9.24 (one-shot) | 20,613 | 4,422 | 15,040 | 1,151 | 24 |
| QM v0.1.15, Pi engine | 20,492 | 1,341 | 15,809 | 3,342 | 28 |
| QM v0.1.15, Claude Agent SDK engine | 24,935 | 1,391 | 19,256 | 4,288 | 29 |
| QM main b6786d67, Pi engine (the only one) | 13,408 | 3,873 | 8,327 | 1,208 | 15, all QM's own; the 15 world tools are one line each in the system prompt, loaded through `tool_search` |
| Claude Code 2.1.312 | 18,416 | 2,910 | 10,780 | 4,726 | 11 plus a deferred placeholder (24 more named in a message, loaded on request) |
| Codex 0.165.0, on GPT-6.1 Sol (local o200k_base estimate, not an OpenAI count) | 12,900 | 5,494 | 5,896 | 1,033 | 11, in one `additional_tools` item; `exec` documents 11 more inside its description; the 15 world tools are not named at all |

- **MCP tools are often hidden.** OpenClaw, Hermes and Claude Code do not send MCP tools (the task's own world tools, and gbrain when it is registered) with their schemas. OpenClaw and Hermes route them through a generic `tool_call`; Claude Code loads a tool into its tools list when the model asks `ToolSearch` for it. QM v0.1.15 sent every MCP tool in full on every request (gbrain measured on the Pi engine only); QM main `b6786d67` lists them one line each and loads them through `tool_search` ([QM page](qm.md#qm-at-b6786d67-captured-2026-10-31-utc)). Codex names none of the world tools; the model can call them by name as code inside its `exec` tool ([Codex page](codex.md#tools-and-mcp-measured)).
- **Registering gbrain costs from 0 to 11,771 tokens per request**, depending on the harness: OpenClaw +0, Hermes +1,318, Claude Code +1,903, QM-Pi +11,771 at v0.1.15 and +1,490 at main `b6786d67`.
- **Only Claude Code passes on gbrain's own instructions.** gbrain's MCP server sends an "operating contract" (search gbrain first, call `context_pack` at session start). Claude Code puts it in the request; OpenClaw, Hermes and QM v0.1.15 drop it ([Claude Code page](claude-code.md#gbrain-measured)); QM main `b6786d67` shows only its first line, a heading.
- **Skill limits differ.** OpenClaw refuses a registered skill file over 64,000 characters, whole (on models with a 200k-token window; less on smaller windows): a [63,463-byte skill](records/openclaw-kb62/skills.json) is served, a [65,488-byte one](records/openclaw-kb64/skills.json) is refused. Hermes shows only the first 57 characters of each skill's description in its skill list.
- **Failures are handled differently.** Against two 529s, a 429 and a 500 in a row, OpenClaw and QM-Pi retried until they succeeded. Hermes, and Claude Code with the adapter's 2 retries, gave up after the third failure and lost that turn.
- **Some harnesses send their own output cap, some leave it to the proxy.** With the metering proxy's cap at 100,000 tokens, Codex and Hermes on the Responses API sent none and every request went through with the proxy's 100,000. Claude Code, OpenClaw (on both APIs) and Hermes on Anthropic's API asked for 128,000 themselves, so the proxy refused every one of their requests ([probe receipts](#records)). A cell that caps output below 128,000 has to set the cap in those harnesses' own config.
- **Only Hermes compacted its history** in the growth test. It sent a separate summarization request after the fake endpoint reported 152,000 input tokens. Claude Code saved each 60 KB tool output to a file and kept a 2 KB preview in the history. OpenClaw, QM and Claude Code kept sending the whole history for 30 tool calls, but the fake never reported more than 194,000 input tokens and never refused a long prompt, so this does not show what they do at a real context limit (OpenClaw's last body was about 1.86 MB).

Each number links to a record below. A **record** is one capture turned into JSON by [scripts/anatomy/dissect.ts](../../scripts/anatomy/dissect.ts), following [record.schema.json](../../scripts/anatomy/record.schema.json).

## Where the money goes

**Most of a harness's bill is prompt caching, not output.** We split the [m3 held-out run](../benchmarks/2026-10-24-m3-heldout/report.md) (Sonnet, 100 trials per harness, the same 20 held-out tasks) into its billed parts with [scripts/anatomy/cost-split.ts](../../scripts/anatomy/cost-split.ts) ([split](cost/m3-heldout-2026-10.split.json), [inputs](cost/m3-heldout-2026-10.manifest.json)).

| Harness | Total | Requests | Cache writes | Cache reads | Output | Uncached input | Passes, all 20 tasks [95% CI, task-clustered] |
|---|---|---|---|---|---|---|---|
| OpenClaw | $17.30 | 909 | 54.4% | 33.0% | 12.6% | under 0.1% | 77 of 100 [58%, 93%] |
| Hermes Agent | $12.26 | 1,056 | 33.9% | 46.2% | 19.9% | under 0.1% | 76 of 100 [58%, 92%] |
| QM (Pi) | $6.10 | 534 | 49.1% | 36.9% | 13.9% | under 0.1% | 71 of 100 [51%, 90%] |

- **Cache writes are the biggest single cost for OpenClaw and QM.** OpenClaw wrote about 4,100 cache tokens per request, Hermes about 1,600 and QM about 2,200.
- **QM made the fewest requests.** 534, against 909 for OpenClaw and 1,056 for Hermes. Per request, QM and Hermes cost about the same ($0.0114 and $0.0116) and OpenClaw about 1.7 times as much ($0.0190).
- **The pass rates can't be told apart** (the [report](../benchmarks/2026-10-24-m3-heldout/report.md) has the intervals), so the cost difference is the clearer difference in this run.
- **Why OpenClaw writes so much cache is not settled.** No OpenClaw request failed in the m3 run, so retries are not the cause there, and only 5 of its 909 requests read no cache at all, so its fixed prefix is being reused. Finding the cause needs a run that logs cache writes per request.

<details>
<summary>How the split is computed</summary>

- The run's proxy log records each request's total input, cache reads, output and billed dollars, priced at the proxy's list prices. It does not separate cache writes from uncached input, so the script infers cache writes as the tokens that make the priced total equal the billed dollars, assuming 5-minute cache writes. A request whose inferred writes fall outside the possible range is clamped and the remainder reported.
- The script checks that every trial's dollars match `trials.jsonl`: 300 trials, largest difference $0 to the millionth of a dollar, no request needed clamping.
- Refused requests (Hermes's 2,706 model-discovery calls, QM's 160 utility calls) cost nothing and are not in the split.

</details>

## Named settings

**Six choices we made on purpose, written down so a reader can see them.** Garry reviewed the first five on 2026-10-30 and kept each as it is. The sixth fixed 11 model errors in the host-harness pilot.

| Setting | Value | Why | Where it is set |
|---|---|---|---|
| Lease headroom per shard | smoke cost of one trial x 100 trials x **1.25**, plus one per-call reservation, rounded up to $0.05 | Room for trials that cost more than the smoke trial, while the host-harness pilot stayed under its $20 cap | [host-harness pilot preregistration](../benchmarks/2026-10-30-host-harness-pilot/PREREGISTRATION.md), "Leases and spend" |
| Hermes Agent `security.tirith_enabled` | **on**, Hermes's own default | Turning it off would change how Hermes gates dangerous commands. tirith is not in the image, so Hermes falls back to pattern matching | Not set; Hermes's default ([Hermes page](hermes.md#named-setting)) |
| Claude Code `MCP_CONNECTION_NONBLOCKING` | **`false`** | Claude Code waits for its MCP servers before its first request. Every harness here starts turn 1 with its servers ready, so this keeps it fair | [harnesses/claude-code/adapter.sh](../../harnesses/claude-code/adapter.sh) ([Claude Code page](claude-code.md#tools-and-mcp-measured)) |
| Codex `sandbox_mode` | **`danger-full-access`** | Codex's bubblewrap sandbox cannot start in our unprivileged containers. The container is the sandbox | [harnesses/codex/config/config.toml](../../harnesses/codex/config/config.toml) |
| Codex reasoning effort | **`medium`** (main turns, plan mode and subagents) | The effort every harness sends on a gpt-6-luna cell | [harnesses/codex/pin.json](../../harnesses/codex/pin.json) `codex_config`, filled into the three `@EFFORT@` keys of [config.toml](../../harnesses/codex/config/config.toml) |
| OpenClaw memory search on OpenAI cells | **`memory.search.provider: "none"`**, keyword only | Without it OpenClaw calls `/v1/embeddings`, which the cell refuses. Anthropic cells already search memory by keyword only | [harnesses/openclaw/config/openclaw.openai.json](../../harnesses/openclaw/config/openclaw.openai.json) ([OpenClaw page](openclaw.md#memory-search-on-openai-cells)) |

## Records

| Harness | Plain turn | With gbrain | Tool calls | Failures | History growth | Skills probe |
|---|---|---|---|---|---|---|
| OpenClaw | [plain](records/openclaw-default/plain.json) | [plain-gbrain](records/openclaw-default/plain-gbrain.json) | [tools-gbrain](records/openclaw-default/tools-gbrain.json) | [retry](records/openclaw-default/retry.json) | [growth](records/openclaw-default/growth.json) | [4 to 80 KB](records/openclaw-default/skills.json); one size each: [52](records/openclaw-kb52/skills.json), [56](records/openclaw-kb56/skills.json), [60](records/openclaw-kb60/skills.json), [62](records/openclaw-kb62/skills.json), [64](records/openclaw-kb64/skills.json), [72](records/openclaw-kb72/skills.json), [80](records/openclaw-kb80/skills.json), [96](records/openclaw-kb96/skills.json) KB |
| Hermes, one-shot (the counted mode) | [plain](records/hermes-default/plain.json) | [plain-gbrain](records/hermes-default/plain-gbrain.json) | [tools-gbrain](records/hermes-default/tools-gbrain.json) (calls not made: the tools sit behind tool_search) | [retry](records/hermes-default/retry.json) | [growth](records/hermes-default/growth.json) | [skills](records/hermes-default/skills.json) |
| Hermes, chat (internal-task overlay path) | [probe](records/hermes-chat-gsta135-overlay/gsta135-probe.json) | | | | | |
| QM v0.1.15, Pi engine | [plain](records/qm-pi/plain.json) | [plain-gbrain](records/qm-pi/plain-gbrain.json) | | [retry](records/qm-pi/retry.json) | [growth](records/qm-pi/growth.json) | |
| QM v0.1.15, Claude Agent SDK engine | [plain](records/qm-claude/plain.json) | | | | | |
| QM main b6786d67, Pi engine | [plain](records/qm-pi-b6786d67/plain.json) | [plain-gbrain](records/qm-pi-b6786d67/plain-gbrain.json) | | [retry](records/qm-pi-b6786d67/retry.json) | [growth](records/qm-pi-b6786d67/growth.json) | |
| Claude Code | [plain](records/claude-code-default/plain.json) | [plain-gbrain](records/claude-code-default/plain-gbrain.json) | [tools-gbrain](records/claude-code-default/tools-gbrain.json) | [retry](records/claude-code-default/retry.json) | [growth](records/claude-code-default/growth.json) | |

**Frontier recaptures (2026-10-31).** Each harness on the model its cell runs, with only that model in every request: Opus 5.5 on Anthropic's API and GPT-6.1 Sol on the Responses API. The tools scenario here runs without gbrain.

| Harness and model | Plain turn | Tool calls | Output cap probe (proxy cap 100,000) |
|---|---|---|---|
| Claude Code 2.1.312, Opus 5.5 | [plain](records/claude-code-opus/plain.json) | [tools](records/claude-code-opus/tools.json) | refused (asks for 128,000): [proxy log](cap-probe/anatomy-capture-claude-code-opus-cap100k-plain-20261031t205640/proxy-usage.ndjson) |
| OpenClaw 2026.10.6, Opus 5.5 | [plain](records/openclaw-opus/plain.json) | [tools](records/openclaw-opus/tools.json) | refused (asks for 128,000): [proxy log](cap-probe/anatomy-capture-openclaw-opus-cap100k-plain-20261031t205646/proxy-usage.ndjson) |
| Hermes v2026.9.24 (one-shot), Opus 5.5 | [plain](records/hermes-opus/plain.json) | [tools](records/hermes-opus/tools.json) | refused (asks for 128,000): [proxy log](cap-probe/anatomy-capture-hermes-opus-cap100k-plain-20261031t205741/proxy-usage.ndjson) |
| Codex 0.165.0, GPT-6.1 Sol | [plain](records/codex-sol/plain.json) | [tools](records/codex-sol/tools.json) | forwarded at 100,000 (sends no cap): [proxy log](cap-probe/anatomy-capture-codex-sol-cap100k-plain-20261031t205806/proxy-usage.ndjson) |
| OpenClaw 2026.10.6, GPT-6.1 Sol | [plain](records/openclaw-sol/plain.json) | [tools](records/openclaw-sol/tools.json) | refused (asks for 128,000): [proxy log](cap-probe/anatomy-capture-openclaw-sol-cap100k-plain-20261031t205811/proxy-usage.ndjson) |
| Hermes v2026.9.24 (one-shot), GPT-6.1 Sol | [plain](records/hermes-sol/plain.json) | [tools](records/hermes-sol/tools.json) | forwarded at 100,000 (sends no cap): [proxy log](cap-probe/anatomy-capture-hermes-sol-cap100k-plain-20261031t205907/proxy-usage.ndjson) |


<details>
<summary>How the captures were made, and what to watch for when reading them</summary>

- **Driver:** [scripts/anatomy/capture.ts](../../scripts/anatomy/capture.ts) runs one trial through the real runner (same world, task prompt, preamble and gbrain sidecar as a counted trial) with `--capture-upstream` pointing the metering proxy at [scripts/gsta-135/fake-anthropic.ts](../../scripts/gsta-135/fake-anthropic.ts). The fake answers from a script per scenario and logs every request. It refuses any key that does not start with `sk-ant-capture-dummy`, so a real key can't reach it.
- **Task:** public dev task `si-01-marrow-agrisupply-site` (two member turns). Model name `claude-haiku-5-5` for the 2026-10-30 captures; the fake ignores it, but harnesses size some limits from the model's context window. The 2026-10-31 frontier recaptures use the cell's model, `claude-opus-5-5` or `gpt-6.1-sol`.
- **Responses API:** the frontier recaptures on GPT-6.1 Sol point the proxy at [tests/fixtures/fake-responses.ts](../../tests/fixtures/fake-responses.ts), which logs each request the same way and refuses any key that does not start with `sk-capture-dummy`. Those harness containers ran on the internal network with no outside route and no DNS, so they have no `egress.ndjson`.
- **One model per capture:** before the frontier recaptures, OpenClaw's housekeeping model defaulted to `claude-haiku-5-5` on Opus, and Hermes's discovery requests named `claude-sonnet-5-5` on Opus and `gpt-6-luna` on Sol. The frontier recaptures ran with the cell's model in both (`utilityModel` in [openclaw.json](../../harnesses/openclaw/config/openclaw.json), `model.default` in [Hermes's adapter](../../harnesses/hermes/adapter.sh)), and every request and proxy route named only the cell's model.
- **Housekeeping stays at the shipped default (internal-task, 2026-11-01):** OpenClaw's `utilityModel` line is gone again, so its housekeeping model is its shipped default, `claude-haiku-5-5` on Anthropic, metered and labelled "harness housekeeping, shipped default", never an arm. It never fired in a capture or a counted trial: keyless recaptures without the line (Opus 5.5, plain, tools and growth) sent only agent turns, so the published records stand. On OpenAI the shipped default would be `openai/gpt-5.6-luna`, but the existing adapter pin to the cell model in `openclaw.openai.json` stays (declared deviation). Hermes's `model.default` stays the cell model: it names the answering model, not a housekeeping model.
- **Network:** in 11 of the 21 main OpenClaw, Hermes and QM captures the harness container's DNS and outbound TCP went to a logging sink ([scripts/anatomy/sink](../../scripts/anatomy/sink)), saved as `egress.ndjson`. In the 5 Claude Code captures only its DNS lookups did, because the sink ran in pass mode, which logs lookups and not connections. The skills captures, QM-Claude, the QM-Pi plain, gbrain and retry captures at `v0.1.15` and all four QM-Pi captures at `b6786d67` ran without it, and QM's core uses the host network, so **QM egress is not measured**. The sink sees connections that start with a DNS lookup; a connection to a literal IP address would not show up.
- **Refused requests:** requests the metering proxy refused never reach the fake, so they are not in the records; each capture's `proxy-usage.ndjson` has them. Hermes made 24 refused model-discovery requests to 10 paths per trial (30 in the growth capture) (`/v1/models`, `/api/show`, `/api/tags` and others); QM-Claude called `/api/hello` 4 times. On the Responses API the proxy forwards `/v1/models` and `/v1/models/<model>`, so 10 of Hermes's Sol discovery requests reach the fake (which answers 404) and are in the records as errors; the other 16 are refused.
- **Tokens:** [scripts/anatomy/count-tokens.ts](../../scripts/anatomy/count-tokens.ts) sent each first request's system prompt, tools and messages to Anthropic's count_tokens endpoint through the metering proxy (the proxy forwards the counting route only when started with a counting flag; trial proxies never are). Four runs, 726 calls, $0: [usage.ndjson](count-tokens/usage.ndjson) (330 calls), [usage-claude-code.ndjson](count-tokens/usage-claude-code.ndjson) (48 calls), [usage-qm-b6786d67.ndjson](count-tokens/usage-qm-b6786d67.ndjson) (132 calls) and [usage-harn20-opus.ndjson](count-tokens/usage-harn20-opus.ndjson) (216 calls, the Opus recaptures), with each run's script sha256 in [count-tokens/run.json](count-tokens/run.json). The first two went through this lane's own `--allow-count-tokens` route under a scratch lease, before #123 merged. The QM `b6786d67` run used #123's `--free-count-tokens` directly, which forwards the same route at $0; the provider key was only in the proxy's environment. The Claude Code run's script also drops per-message fields other than role and content, and skips the per-tool count for Claude Code's one deferred placeholder tool, because count_tokens refused both in a trial run ("messages.1.output_config: Extra inputs are not permitted" and "At least one tool must have defer_loading=false"). System and tools are counted with a one-message baseline subtracted; messages are counted alone as sent, so they include a few tokens of request framing.
- **Receipts:** `receipts/<capture>/` holds `capture.json` (commit, image digest, file digests), `tokens.json`, `egress.ndjson`, `proxy-usage.ndjson`, the fake's script, and the request log packed by [scripts/anatomy/store.ts](../../scripts/anatomy/store.ts): each distinct system prompt, tool list and message stored once as a gzipped blob named by its sha256. `bun scripts/anatomy/store.ts unpack` rebuilds the original log byte for byte. A test checks each rebuilt log's sha256 against `capture.json` and rebuilds every record from it.
- **Frontier recapture tokens:** the three GPT-6.1 Sol captures are counted locally ([count-tokens.ts](../../scripts/anatomy/count-tokens.ts) with o200k_base, no key, no network), and each receipt's `tokens.json` says so. The three Opus recaptures are counted by Anthropic's free count_tokens endpoint through the metering proxy's `--free-count-tokens` route, $0, the provider key only in the proxy's environment: Claude Code 17,686 tokens (system 2,130, tools 10,664), OpenClaw 18,355 (system 10,287, tools 6,815) and Hermes 20,613 (system 4,422, tools 15,040) in the plain scenario's first agent request.
- **Cap probes:** `cap-probe/<capture>/` holds each probe's `capture.json`, the fake's script and the proxy's usage log; the two probes whose requests reached the fake also keep the fake's request log, gzipped (its sha256 is in `capture.json`).
- **Provenance:** the frontier recaptures name commit 35153882 with `dirty: false`. The OpenClaw, Hermes and QM `capture.json` files name commit 861bcffc with `dirty: true`, because the capture kit was not yet committed when the captures ran. The Claude Code ones name 9a4a170d with `dirty: true`, because the Claude Code branches of the tools and growth scenarios in `capture.ts` were committed after they ran; the harness images are pinned by their image digest. Records, receipts and token counts were regenerated from the raw logs with the committed `dissect.ts`, `store.ts` and `publish.sh`, and `count-tokens.ts` at the version [run.json](count-tokens/run.json) names for each run. The QM `b6786d67` captures name `12e1ad9b` with `dirty: false` and were published into their own records directory with `capture.ts --record qm-pi-b6786d67`, so the v0.1.15 records stay as they were; all four ran without the egress sink.
- **Reading `compaction`:** `kind: new_session` is a harness starting a turn with a short history, here because the second member turn is in a different conversation (a channel after a DM); it is not a compaction. Only Hermes's growth record has a real one.
- **Reading `retries`:** the record pairs each failed request with the next one to the same path that also carries tools (or also carries none), so an agent request is never paired with a side call. When `same_body` is false, check whether it is the same turn: Hermes's and Claude Code's third failure is followed by the next member's turn, because they gave up on the first. OpenClaw's bodies differ because it adds a "Continue the current task" message after each failure.
- **Growth on QM:** QM's shell tool needs a sandbox the capture does not create, so its 30 tool results were short errors. The record shows history kept whole, not how QM handles large tool output.
- **Hermes growth:** Hermes's one-shot mode refused the growth command (`python3 -c`) as dangerous on the first calls and returned short errors after that, so its tool results were small. Its compaction was triggered by the token counts the fake reported, not by real bytes.

</details>

## Changelog

- 2026-11-03: added a closing Disclosures section with the line for each product the page features, word for word from the shared disclosures list, because every page that features a tested product carries its disclosure line.
- 2026-10-31: added free count_tokens counts for the three Opus recaptures (216 calls, $0), so every frontier recapture has a token count (internal-task).
- 2026-10-31: added Codex (its own page and a row in the first-request table), the frontier recaptures on Opus 5.5 and GPT-6.1 Sol with one model per capture, and the output-cap probe, because the harness-evals cells now run frontier models and Codex runs on the Responses API (internal-task).

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
