# Harness anatomy

**What each harness actually sends the model, byte for byte, before the model does anything.** We ran each harness against a fake model endpoint and logged every request. No real model was called; token counts come from Anthropic's free count_tokens endpoint ($0).

This page indexes the records. The per-harness pages, the cost split and the comparison come in a later change.

## The short version

- **The harness decides what the model can see, and the three harnesses decide very differently.** Same task, same model name, first request:

| Harness | Tokens in the first request | System prompt | Tool schemas | Messages | Tools sent directly |
|---|---|---|---|---|---|
| OpenClaw 2026.10.6 | 18,356 | 10,288 | 6,815 | 1,253 | 14 (47 more named in the system prompt, one line each) |
| Hermes v2026.9.24 (one-shot) | 20,613 | 4,422 | 15,040 | 1,151 | 24 |
| QM v0.1.15, Pi engine | 20,492 | 1,341 | 15,809 | 3,342 | 28 |
| QM v0.1.15, Claude Agent SDK engine | 24,935 | 1,391 | 19,256 | 4,288 | 29 |

- **MCP tools are often hidden.** OpenClaw and Hermes do not send MCP tools (the task's own world tools, and gbrain when it is registered) as tools. The model has to call `tool_search` first. QM-Pi sends every MCP tool in full on every request.
- **Registering gbrain costs from 0 to 11,771 tokens per request**, depending on the harness: OpenClaw +0, Hermes +1,318, QM-Pi +11,771.
- **Skill limits differ.** OpenClaw refuses a registered skill file over 64,000 characters, whole (on models with a 200k-token window; less on smaller windows): a [63,463-byte skill](records/openclaw-kb62/skills.json) is served, a [65,488-byte one](records/openclaw-kb64/skills.json) is refused. Hermes shows only the first 57 characters of each skill's description in its skill list.
- **Failures are handled differently.** Against two 529s, a 429 and a 500 in a row, OpenClaw and QM-Pi retried until they succeeded. Hermes gave up after the third failure and lost that turn.
- **Only Hermes compacted its history** in the growth test. It sent a separate summarization request after the fake endpoint reported 152,000 input tokens. OpenClaw and QM kept sending the whole history for 30 tool calls, but the fake never reported more than 194,000 input tokens and never refused a long prompt, so this does not show what they do at a real context limit (OpenClaw's last body was about 1.86 MB).

Each number links to a record below. A **record** is one capture turned into JSON by [scripts/anatomy/dissect.ts](../../scripts/anatomy/dissect.ts), following [record.schema.json](../../scripts/anatomy/record.schema.json).

## Records

| Harness | Plain turn | With gbrain | Tool calls | Failures | History growth | Skills probe |
|---|---|---|---|---|---|---|
| OpenClaw | [plain](records/openclaw-default/plain.json) | [plain-gbrain](records/openclaw-default/plain-gbrain.json) | [tools-gbrain](records/openclaw-default/tools-gbrain.json) | [retry](records/openclaw-default/retry.json) | [growth](records/openclaw-default/growth.json) | [4 to 80 KB](records/openclaw-default/skills.json); one size each: [52](records/openclaw-kb52/skills.json), [56](records/openclaw-kb56/skills.json), [60](records/openclaw-kb60/skills.json), [62](records/openclaw-kb62/skills.json), [64](records/openclaw-kb64/skills.json), [72](records/openclaw-kb72/skills.json), [80](records/openclaw-kb80/skills.json), [96](records/openclaw-kb96/skills.json) KB |
| Hermes, one-shot (the counted mode) | [plain](records/hermes-default/plain.json) | [plain-gbrain](records/hermes-default/plain-gbrain.json) | [tools-gbrain](records/hermes-default/tools-gbrain.json) (calls not made: the tools sit behind tool_search) | [retry](records/hermes-default/retry.json) | [growth](records/hermes-default/growth.json) | [skills](records/hermes-default/skills.json) |
| Hermes, chat (internal-task overlay path) | [probe](records/hermes-chat-gsta135-overlay/gsta135-probe.json) | | | | | |
| QM, Pi engine | [plain](records/qm-pi/plain.json) | [plain-gbrain](records/qm-pi/plain-gbrain.json) | | [retry](records/qm-pi/retry.json) | [growth](records/qm-pi/growth.json) | |
| QM, Claude Agent SDK engine | [plain](records/qm-claude/plain.json) | | | | | |

Claude Code and Codex records follow once their harnesses (#118) are on main.

<details>
<summary>How the captures were made, and what to watch for when reading them</summary>

- **Driver:** [scripts/anatomy/capture.ts](../../scripts/anatomy/capture.ts) runs one trial through the real runner (same world, task prompt, preamble and gbrain sidecar as a counted trial) with `--capture-upstream` pointing the metering proxy at [scripts/gsta-135/fake-anthropic.ts](../../scripts/gsta-135/fake-anthropic.ts). The fake answers from a script per scenario and logs every request. It refuses any key that does not start with `sk-ant-capture-dummy`, so a real key can't reach it.
- **Task:** public dev task `si-01-marrow-agrisupply-site` (two member turns). Model name `claude-haiku-5-5`; the fake ignores it, but harnesses size some limits from the model's context window.
- **Network:** in 11 of the 17 main captures, the harness container's DNS and outbound TCP went to a logging sink ([scripts/anatomy/sink](../../scripts/anatomy/sink)), saved as `egress.ndjson`. The skills captures, QM-Claude and the QM-Pi plain, gbrain and retry captures ran without it, and QM's core uses the host network, so **QM egress is not measured**. The sink sees connections that start with a DNS lookup; a connection to a literal IP address would not show up.
- **Refused requests:** requests the metering proxy refused never reach the fake, so they are not in the records; each capture's `proxy-usage.ndjson` has them. Hermes made 24 refused model-discovery requests to 10 paths per trial (30 in the growth capture) (`/v1/models`, `/api/show`, `/api/tags` and others); QM-Claude called `/api/hello` 4 times.
- **Tokens:** [scripts/anatomy/count-tokens.ts](../../scripts/anatomy/count-tokens.ts) sent each first request's system prompt, tools and messages to Anthropic's count_tokens endpoint through the metering proxy under a scratch lease (the proxy forwards the counting route only when started with a counting flag; trial proxies never are). The 330 calls ran before this branch merged #123, through this branch's own `--allow-count-tokens` route, with count-tokens.ts at the sha256 in run.json; the committed script now uses #123's `--free-count-tokens`, which forwards the same route at $0. 330 calls, $0: [count-tokens/usage.ndjson](count-tokens/usage.ndjson), with the script's sha256 in [count-tokens/run.json](count-tokens/run.json). System and tools are counted with a one-message baseline subtracted; messages are counted alone as sent, so they include a few tokens of request framing.
- **Receipts:** `receipts/<capture>/` holds `capture.json` (commit, image digest, file digests), `tokens.json`, `egress.ndjson`, `proxy-usage.ndjson`, the fake's script, and the request log packed by [scripts/anatomy/store.ts](../../scripts/anatomy/store.ts): each distinct system prompt, tool list and message stored once as a gzipped blob named by its sha256. `bun scripts/anatomy/store.ts unpack` rebuilds the original log byte for byte. A test checks each rebuilt log's sha256 against `capture.json` and rebuilds every record from it.
- **Provenance:** every `capture.json` names commit 861bcffc with `dirty: true`, because the capture kit was not yet committed when the captures ran; the harness images are pinned by their image digest. Records, receipts and token counts were regenerated from the raw logs with the committed `dissect.ts`, `store.ts` and `publish.sh`, and `count-tokens.ts` at the version run.json names.
- **Reading `compaction`:** `kind: new_session` is a harness starting a member's next turn fresh, not a compaction. Only Hermes's growth record has a real one.
- **Reading `retries`:** the record pairs each failed request with the next one to the same path that also carries tools (or also carries none), so an agent request is never paired with a side call. When `same_body` is false, check whether it is the same turn: Hermes's third failure is followed by the next member's turn, because it gave up on the first. OpenClaw's bodies differ because it adds a "Continue the current task" message after each failure.
- **Growth on QM:** QM's shell tool needs a sandbox the capture does not create, so its 30 tool results were short errors. The record shows history kept whole, not how QM handles large tool output.
- **Hermes growth:** Hermes's one-shot mode refused the growth command (`python3 -c`) as dangerous on the first calls and returned short errors after that, so its tool results were small. Its compaction was triggered by the token counts the fake reported, not by real bytes.

</details>
