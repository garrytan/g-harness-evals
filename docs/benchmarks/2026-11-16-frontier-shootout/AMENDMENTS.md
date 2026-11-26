# Amendments: the frontier coding-model shootout (frontier-shootout-2026-11)

The preregistration is [PREREGISTRATION.md](PREREGISTRATION.md). It is not edited after its merge. Each amendment below is dated and committed before any cell it affects.

## Amendment 1 (2026-11-16): Hermes and OpenClaw reach OpenRouter through their own providers, and Hermes moves to v0.23.1

**Approved by** Garry on 2026-11-16 (the gate's answers A1, B1 and C, relayed by the coordinating agent: "A1, B1 and C. Finish the amendment on `harn99/results` and push it."). **Committed** on branch `harn99/results` before any counted trial. Every counted shard runs from that branch's head.

- **What changed:** Hermes now replays the reasoning of every OpenRouter model, and OpenClaw replays Gemini's thought signatures. These were the gate's three failing cells (Carbon and Muse Wonder in Hermes, Carbon in OpenClaw), plus Hydrogen in OpenClaw.
- **Why they failed:** the cause was our wiring, not the models or the harnesses' own OpenRouter support. We had pointed both harnesses at OpenRouter through a custom provider entry, and both treat a custom provider more strictly than their built-in OpenRouter one.
- **What it costs:** three declared changes. Hermes gets a small pinned plugin that sends the effort and output cap. OpenClaw gets two media tools denied. Hermes moves to a newer release.

### 1. Why: our custom-provider wiring lost the reasoning

The keyless install check on 2026-11-16 found three cells failing at the first replayed tool turn (preregistration, "Replay gate, fixed now"). Read against the harnesses' source, each failure came from the custom provider entry we used, `openrouter-proxy`:

- **Hermes v2026.9.24** (commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`) kept `reasoning_details` in the wire copy only when the base URL's host was openrouter.ai or nousresearch.com (`agent/transports/chat_completions.py`, `_route_replays_reasoning_details`). The proxy's route is neither. Carbon's thought signature and Muse Wonder's encrypted reasoning both ride in `reasoning_details`, so every replayed turn lost them.
- **OpenClaw 2026.10.6** handles a provider id it doesn't own with its unowned-provider replay fallback (`src/agents/transcript-policy.ts` `buildUnownedProviderTransportReplayFallback`, `sanitizeToolCallIds` in strict mode). That fallback rewrote every tool call id to letters and digits. The Gemini signature entry kept OpenRouter's original id, so it no longer matched its call. Carbon and Hydrogen replayed only in part.

### 2. The new wiring

**Hermes (gate answer A1, with C below).**

- **Provider:** Hermes's built-in `openrouter` provider, with `OPENROUTER_BASE_URL` set to the proxy's OpenRouter route and `OPENROUTER_API_KEY` set to the per-trial token. No custom provider entry is used.
- **Why it needs a plugin:** as of v0.23.1, that provider sends OpenRouter's `reasoning` field only when the base URL's host is openrouter.ai (`run_agent.py` `_is_openrouter_url`, `agent/reasoning_params.py` `_supports_reasoning_extra_body`). It also reads config `extra_body` only for custom providers (`agent/agent_init.py` `_custom_provider_extra_body_for_agent`). So behind the proxy it would send no effort and no output cap. Reported upstream on 2026-11-17 as [NousResearch/hermes-agent#156806](https://github.com/NousResearch/hermes-agent/issues/156806).
- **The plugin:** `he-openrouter-effort` is an `llm_request` middleware, Hermes's documented plugin hook (`hermes_cli/middleware.py`). On provider `openrouter` it sets `reasoning {effort: high}` and `max_completion_tokens` on every agent request, and changes nothing else. The cap is the cell's, read from `HE_OPENROUTER_MAX_OUTPUT_TOKENS`.
  - **Files:** [`scripts/frontier-harbor/hermes-plugins/he-openrouter-effort/`](../../../scripts/frontier-harbor/hermes-plugins/he-openrouter-effort/).
  - **Pinned by sha256** in `scripts/frontier-harbor/pin.json` (`harnesses.hermes.openrouter_plugin`):
    - `__init__.py`: `16498fe6d804b99f86ba404fc95cd25f38a9171428d363e4e300157c49fc2a8f`
    - `plugin.yaml`: `4eacf7236c9cf976d7242e429c5d84f3e44fd9666af2399683b035dc36012b93`
  - **Check:** `frontier_settings.py` refuses a file with any other hash (HE-FRONTIER-015, [docs/errors.md](../../errors.md)).
  - **Install:** `agents.py` writes both files to `$HERMES_HOME/plugins/he-openrouter-effort/`. `config.yaml` enables the plugin (`plugins.enabled`) on OpenRouter cells only.
- **What the plugin doesn't cover:** Hermes's compression-summary calls don't pass through `llm_request` middleware, so they carry no effort. They are housekeeping, never agent-loop calls.
- **Body changes from the old wiring:**
  - Hermes no longer sends a top-level `reasoning_effort: high` beside `reasoning {effort: high}`.
  - It now sends an OpenRouter `session_id` body field (its built-in provider's sticky-routing field), which the proxy forwards.
- **Effort test (keyless):** the effort test in `tests/frontier-harbor-replay.test.ts` runs the real v0.23.1 binary with a tap between Hermes and the proxy. It covers Carbon, Muse Wonder and DeepSeek, streamed and not streamed (6 runs). In every run:
  - every agent request reached the proxy with `reasoning {effort: high}`, the cell's cap (65,536 for Carbon, 128,000 for the others) and no top-level `reasoning_effort`;
  - every replayed turn carried `reasoning`, `reasoning_content` and `reasoning_details`;
  - on Carbon, all 3 signatures came back byte for byte.

**OpenClaw (gate answer B1).** OpenClaw stays at 2026.10.6.

- **Provider:** the provider id is now `openrouter`, OpenClaw's bundled OpenRouter provider. Its key is `apiKey ${OPENROUTER_API_KEY}` (the per-trial token). Everything else is as before: the base URL, api `openai-completions`, `compat.thinkingFormat: openrouter`, the limits and `utilityModel`.
- **Tool call ids:** the bundled provider's replay policy keeps every tool call id as OpenRouter gave it. Otherwise the bodies, headers and usage are identical to the old wiring: it adds no provider field and no attribution header.
- **Denied tools:** `music_generate` and `video_generate` are added to `tools.deny` on OpenRouter cells. The bundled provider would list them, with lines about them, in the system prompt. They are never in the request's tool list (12 tools either way).
- **Remaining prompt differences:** with those two tools denied, the system prompt differs from the old wiring's in two places only:
  - the `openai-whisper-api` skill line is dropped;
  - `openrouter/<model>` replaces `openrouter-proxy/<model>`.

**Both harnesses: metering.** On every fake call, the tokens, `actual_usd`, `openrouter_cost_usd`, served provider and tier are unchanged. The proxy still applies every endpoint pin. The fake upstream's rules are unchanged.

### 3. Hermes v0.23.1 in every Hermes cell (gate answer C)

- **Pin:** every Hermes cell, Claude and OpenAI cells included, moves from v2026.9.24 to **v0.23.1** (commit `3b421578588243f920886e6fe79a6faa87ea026e`, released 2026-11-10).
- **Install:** the anthropic SDK pin moves from 0.87.0 to **0.125.0**, from Hermes's own `uv.lock` at v0.23.1 (wheel sha256 `3486013602eca76d8b12540764e53654f02cf4951110bca86cf06e67428a9f21`).
- **Version line:** `hermes --version` prints `Hermes Agent v0.23.1 (2026.9.24) · stable · local 3b4215785882`. The date is a release-date constant the release did not move.
- **Changes we measured keyless (all models):**
  - **Tools: 15 to 16.** `clarify` was removed. `manage_connections` and `skill_manage` were added. The schemas of `terminal`, `execute_code`, `delegate_task`, `memory`, `search_files`, `skill_view`, `tool_search` and `tool_call` changed.
  - **System prompt: about 3,500 characters shorter.** On Claude it went from 12,330 to 8,774 characters. The Responses `instructions` went from 16,710 to 13,220.
  - **Session-title call: removed.** A one-shot run, which is how the Harbor class runs Hermes, makes no title call at v0.23.1 (`agent/turn_context.py`, `agent_is_oneshot`). That is one fewer metered housekeeping line per trial on OpenAI, xAI and OpenRouter.
  - **Headers:** only the SDK versions change (anthropic 0.87.0 to 0.125.0, openai 2.24.0 to 2.54.0, Python 3.12 to 3.14). On Grok the user agent becomes `Hermes-Agent/0.23.1` and the `x-grok-conv-id` format changes.
  - **Unchanged on the direct routes:** effort, `max_tokens`, `tool_choice` and streaming.
- **Hermes still strips Claude thinking behind the proxy.** At v0.23.1, as at v2026.9.24, every replayed tool-use turn on Opus 5.5, Fable 5.2 and Sonnet 5.5 comes back without its thinking block.
  - **Why:** Hermes strips all thinking for a base URL it doesn't know as Anthropic's own (`agent/anthropic_thinking_policy.py` `anthropic_thinking_route`, `agent/anthropic_message_convert.py` `_manage_thinking_signatures`).
  - **Status:** a declared per-harness property of Hermes, unchanged by this amendment. It is reported, never patched.

### 4. Declared reasoning-replay verdicts

These were checked keyless with the real binaries on the final wiring (`tests/frontier-harbor-replay.test.ts`: 26 runs, all passing). They are declared in `scripts/frontier-harbor/frontier_settings.py` and in `pin.json` (`models.<model>.reasoning_replay`; no entry means replays).

| Model | Hermes v0.23.1 | OpenClaw 2026.10.6 | Before this amendment |
|---|---|---|---|
| Gemini 4 Carbon (OpenRouter) | replays | replays | Hermes drops, OpenClaw partial |
| Gemini 4 Hydrogen (OpenRouter) | replays | replays | Hermes drops, OpenClaw partial |
| Muse Wonder (OpenRouter) | replays | **partial** | Hermes drops, OpenClaw partial |
| DeepSeek V4.1 Flash 1017 (OpenRouter) | replays | replays | both replay |
| Kimi K3.1 Pro, GLM 5.3 (OpenRouter) | replays | replays | Hermes drops, OpenClaw replays |
| Claude (Opus 5.5, Fable 5.2, Sonnet 5.5) | **drops** | replays | unchanged |
| GPT-6.1 Sol, GPT-6 Astra, Grok 4.7 | replays | replays | unchanged |

- **Muse Wonder in OpenClaw stays partial.** OpenClaw sends the reasoning text back exactly. But `compat.thinkingFormat openrouter` drops `reasoning_details`, so the encrypted entry (`meta-responses-v1`) never returns. That is OpenClaw's own replay format, not our wiring.
- **Install check:** its cells follow these verdicts, because `install-check.sh` reads `pin.json`. The committed `install-check.json` is from the earlier wiring; the next install check replaces it.

### 5. What stays, what is not counted, and what this run can be compared with

- **The lineup is unchanged.** So are the cells, the shard table, the near-frontier harness choices, the calls, the smallest detectable differences, the leases, the caps and the stop rule.
- **The replay gate stays as written.** s01, s02, s29 and s33 still launch first, under the same stop rule.
- **Trials on the old wiring aren't counted.** The replay gate stops s01, s02, s29 or s33 after its first 3 trials on the preregistered wiring. Any such trial is kept as a diagnostic record.
- **Carbon's deadline is unchanged:** s01 to s05 must all launch by **2026-11-29 00:00 UTC**, before Carbon's 2026-12-01 price change.
- **Numbers that move:** none of the preregistration's planned numbers. The expected cost and hours per Hermes trial are estimates, and the canaries replace them. The shorter Hermes prompt and the dropped title call should lower them, by an amount we haven't measured.
- **Comparison with particle-swap:**
  - **Hermes:** results aren't comparable with particle-swap's Hermes cells. That run used Hermes v2026.9.24, and v0.23.1 has different tools, a different system prompt and no title call. The preregistration's line "at the versions particle-swap used" no longer holds for Hermes.
  - **OpenClaw on OpenRouter:** these cells also differ from particle-swap's, in the provider id and in the tool-call ids.
  - **Unchanged:** OpenClaw's Claude and OpenAI cells, and Pi.

### 6. Upstream state (searched 2026-11-16)

- **Reported upstream:** [NousResearch/hermes-agent#156806](https://github.com/NousResearch/hermes-agent/issues/156806), filed 2026-11-17, for the built-in openrouter provider behind a gateway.
- **Not documented or fixed, as of v0.23.1.** We found no Hermes documentation or issue that names this case: the built-in openrouter provider sends no reasoning effort when its base URL isn't openrouter.ai, and `extra_body` is read only for custom providers. We found no fix either. Hermes main at `ae2a81ccc00e9b7c06301523e5bb09608397149c` (2026-11-16) still has the same gate and the same custom-only `extra_body`.
- **Closest report:** [NousResearch/hermes-agent#55276](https://github.com/NousResearch/hermes-agent/issues/55276) (open, opened 2026-06-29), the umbrella bug for reasoning effort being silently dropped. Its triage names the root cause, the `_supports_reasoning_extra_body()` base-URL allowlist. The report itself covers custom and Z.ai providers.
- **Related report:** [#18742](https://github.com/NousResearch/hermes-agent/issues/18742) (open, opened 2026-05-02). Kimi reached through aggregators, OpenRouter included, gets no `max_tokens` or `reasoning_effort`.
- **Proposed fixes:** [#71299](https://github.com/NousResearch/hermes-agent/pull/71299) (closed) and [#39625](https://github.com/NousResearch/hermes-agent/pull/39625) reorder the gate, for custom providers only.
- **Docs:** they list `OPENROUTER_BASE_URL` as "Override the OpenRouter-compatible base URL" ([environment variables](https://hermes-agent.nousresearch.com/docs/reference/environment-variables)). They don't say that the reasoning field is then dropped.

## Amendment 2 (2026-11-16): Gemini 4 Carbon and Hydrogen in Hermes, OpenClaw and Pi go to Google's Gemini API directly

**Approved by** the coordinating agent's ruling of 2026-11-16: A2, taken because registering our Gemini key with OpenRouter needs a person in OpenRouter's web settings, with rulings B and C. Hermes's base URL (section 3) was chosen the same day. **Committed** on branch `harn99/results` before any counted trial of the cells it moves. Every counted shard runs from that branch's head.

- **What changed:** every Carbon and Hydrogen cell in Hermes, OpenClaw and Pi (shards s01, s02, s03, s05, s33 and s34) now goes straight to Google's Gemini API through the metering proxy's existing google route, the route Gemini CLI (s04) already used. Each harness uses its own Gemini provider. Muse Wonder, Kimi K3.1 Pro, GLM 5.3 and DeepSeek V4.1 Flash 1017 stay on OpenRouter as they were.
- **Why:** OpenRouter's shared Google AI Studio capacity refused about a third of s01's requests with 429. Our own Gemini key carried more than twice that load with no refusal.
- **What it costs:** nothing in the plan's money. Google's Gemini API and OpenRouter's Google AI Studio endpoint list the same rates for both models.

### 1. Why: OpenRouter's shared Google AI Studio capacity

- **s01 on the real API** (Carbon in Hermes, preregistered wiring, 3 trials and a 4th in flight, concurrency 4):
  - Every trial ended in infra_error on upstream 429s. The first came about 35 seconds in.
  - The proxy logged 16 answers of 429 against 26 of 200. A second read of the same log, at the peak of about 22 requests and 300,000 input tokens a minute, counted 15 of 42 requests refused. Both reads are quoted because they disagree by one; the proxy log is the record.
  - OpenRouter's error text was "Provider returned error", its wording for an upstream error, with the provider pinned and fallbacks off. Our OpenRouter key had $945 of its $1,000 daily limit left and no rate limit set.
  - Hermes, as wired then, sent Carbon's `reasoning_details` back on none of its 27 replayed turns (0 of 5, 9 and 13). Google AI Studio through OpenRouter still answered 200 every time. These trials are not counted (amendment 1, section 5) and are kept as diagnostic records.
- **Our own quota, probed straight at Google with `GEMINI_API_KEY`** (synthetic prompts of about 15,000 tokens, low thinking, short output, about $2.54):
  - 4 workers for 2 minutes: 21 of 21 answered 200, at up to 13 requests and about 200,000 input tokens a minute. One read timed out on our side after 120 seconds; it was not a 429.
  - 8 workers for 90 seconds: 59 of 59 answered 200, at 41 requests and about 650,000 input tokens in the first minute.
- **Why not OpenRouter with our own key:** OpenRouter registers a provider key only with a management key, which is made by hand in its web settings. We hold only an inference key.

### 2. The routes now

| Cell | Shard | Route | The harness's provider |
|---|---|---|---|
| Carbon in Gemini CLI | s04 | Google Gemini API, direct (unchanged) | Gemini CLI's own |
| Carbon in Hermes | s01 | Google Gemini API, direct | provider `gemini`, its native generateContent client |
| Carbon in OpenClaw | s02 | Google Gemini API, direct | its bundled `google` provider, api `google-generative-ai` |
| Carbon in Pi | s03, s05 | Google Gemini API, direct | `harbor-endpoint` on api `google-generative-ai`, with Pi's Gemini 4 Argon catalog row |
| Hydrogen in OpenClaw | s33 | Google Gemini API, direct | as Carbon in OpenClaw |
| Hydrogen in Pi | s34 | Google Gemini API, direct | as Carbon in Pi |
| Muse Wonder, Kimi K3.1 Pro, GLM 5.3, DeepSeek V4.1 Flash 1017 | unchanged | OpenRouter, pinned as before | unchanged |

- **Model ids:** these cells now name `google:gemini-4-carbon` and `google:gemini-4-hydrogen` (shard files s01, s02, s03, s05, s33 and s34). In `scripts/frontier-harbor/pin.json` the OpenRouter rows for both models list no harness, so no cell can use them.
- **Terms:** the Gemini API terms (effective 2026-03-23) apply directly, with no OpenRouter in the path. They have no benchmarking clause. The preregistration's reading of Google Cloud's terms for OpenRouter's AI Studio route no longer applies to any cell.
- **Keys:** `GEMINI_API_KEY` now reaches the proxy on s01 to s05, s33 and s34, and no other shard (`scripts/ubicloud/provider-keys.sh` `shard_keys`, which reads the shard's models). Each harness sees only the per-trial token. Gemini CLI's named OpenRouter fallback stays Gemini CLI's alone: `vm-run.sh` refuses it for a shard with a Gemini cell in any other harness.

### 3. The new wiring

- **Hermes v0.23.1.** Provider `gemini`, with `GEMINI_BASE_URL` set to `<proxy>/<trial>/google/generativelanguage.googleapis.com/v1beta` and `GEMINI_API_KEY` the per-trial token.
  - **This relies on a substring check, not on documented behaviour.** Hermes v0.23.1 uses its native Gemini client only when the base URL contains `generativelanguage.googleapis.com` (`agent/gemini_native_adapter.py` lines 183-188, `is_native_gemini_base_url`). Its own guide treats a base URL on any other host as an OpenAI-compatible endpoint. The pin to v0.23.1 (commit `3b421578588243f920886e6fe79a6faa87ea026e`) keeps that check as it is for this run.
  - **The proxy alias:** the google route drops exactly one `/generativelanguage.googleapis.com/` segment straight after `/google` and nowhere else (`GOOGLE_HOST_SEGMENT` in `runner/proxy/metering-proxy.ts`). Twice in a row, after the API version, in another case, with a prefix, or on any other route, the path is left as it was (`tests/proxy-google-host-segment.test.ts`).
  - **Other places Hermes v0.23.1 keys off that name**, read in its source: the auxiliary client (compression summaries) also takes the native client, on the same route; the native path skips `stream_options` and keeps only `thinking_config` and `max_output_tokens` from extra_body, of which we set none; the long-decode budget applies only at effort xhigh or max, never at high; an error-guidance message for Vertex-style keys changes text only. The checks that compare the host exactly (thought-signature hosts on the OpenAI-compatible path, the provider-from-URL table, the model-list probe's `X-Goog-Api-Client` header, cost display, `hermes doctor`) don't match the proxy's host and don't run. The tier probe (`probe_gemini_tier`) runs only in interactive setup. The native client sends its own `X-Goog-Api-Client` header on every request whatever the host.
  - **Output cap: 65,535, declared.** Hermes sends `maxOutputTokens` 65,535 on every Gemini request (`GEMINI_DEFAULT_MAX_OUTPUT_TOKENS`) and reads no setting for it. That is one token under the row's 65,536. The proxy's cap leaves it as sent.
  - **Effort:** `agent.reasoning_effort = high`; Hermes sends `thinkingLevel: high` in lower case, as Google's own REST examples write it.
- **OpenClaw 2026.10.6.** Its bundled `google` provider id, api `google-generative-ai`, baseUrl `<proxy>/<trial>/google/v1beta`, apiKey `${GEMINI_API_KEY}`.
  - It sends `thinkingLevel: HIGH` and no `maxOutputTokens`, so the proxy writes 65,536.
  - OpenClaw appends `/v1beta` itself only on Google's own host, and its key rotation and first-response retry run only there. It creates explicit context caches only for gemini-2.5 and gemini-3 ids, so Gemini 4 gets only Google's implicit caching.
- **Pi 1.5.0.** Harbor's `harbor-endpoint` provider on api `google-generative-ai`, baseUrl `<proxy>/<trial>/google/v1beta`, apiKey `$GEMINI_API_KEY`. The model entry carries the thinkingLevelMap of Pi's Gemini 4 Argon row, since Pi's google catalog has no Carbon or Hydrogen row. It sends `thinkingLevel: HIGH` and `maxOutputTokens` 65,536.
- **Settings records:** `scripts/frontier-harbor/frontier_settings.py` writes each cell's route, cap, effort and replay record into `harness_settings.json`.

### 4. Checks, all keyless

- **Replay on the new route** (`tests/frontier-harbor-replay.test.ts`, the real pinned binaries through the proxy to a fake that answers Gemini's 400 when a function call comes back without its signature, as Google does):

| Harness | Carbon | Hydrogen | thinkingLevel sent | maxOutputTokens upstream | Signatures back |
|---|---|---|---|---|---|
| Hermes, streamed and not | replays | replays | high | 65,535 | 3 of 3, byte for byte, signature only |
| OpenClaw | replays | replays | HIGH | 65,536 (written by the proxy) | 3 of 3, byte for byte, with the thought text |
| Pi | replays | replays | HIGH | 65,536 | 3 of 3, byte for byte, with the thought text |

  Every forwarded line carried finish reason STOP. The Carbon and Hydrogen ids on Hermes, OpenClaw and Pi in the main replay list also replay. Every other model's verdict is unchanged from amendment 1.
- **Nothing else changed:** for the 52 harness and model pairs that are not Gemini cells, the settings the new tree renders (config, environment, Harbor arguments and records) are byte for byte those of 921f99c. The proxy's recorded answers for every other route are unchanged apart from the new log fields.
- **Harbor:** agents.py's Hermes, OpenClaw and Pi classes, run against Harbor 0.24.0 on both models, write these configs, pass the token only as `GEMINI_API_KEY` (and Hermes's `GEMINI_BASE_URL`), and write no token into any file.
- **Metering** (`tests/gemini-direct-metering.test.ts`): Carbon and Hydrogen lines split cached and thinking tokens and are priced from the dated rows, streamed and not, through the alias too.

### 5. Ruling B: the output cap stays 65,536, and every line says how a reply ended

- Every Gemini row keeps 65,536 (Hermes 65,535, declared above).
- Every forwarded line on every route now records the finish reason (`finish_reason`: Gemini `finishReason`, Chat Completions `finish_reason`, Anthropic `stop_reason`, Responses status), beside its output tokens. A reply cut at a per-request limit shows as `MAX_TOKENS` with its length.
- If the canaries show refusals, or replies cut at 32,768, a further dated amendment sets 32,768 for every Gemini row, Gemini CLI included, so the rows stay comparable.
- Every cell here streams its requests (seen keyless). Hermes's own source says Google caps an unstreamed request at 32,768 tokens; if one ever ran unstreamed, its finish reason would show the cut.

### 6. Ruling C: every non-2xx answer is logged

- On every route, a line whose answer was not 2xx records the status, the Retry-After header and the error body: as JSON (`error_body`, up to 8,000 characters) when it parses, else as cut text (`error_text`). That keeps OpenRouter's provider name and raw message, and Google's `error.status` and quota details.
- The real key, the slot token and anything shaped like a key or token are masked before the line is written. Logging only: no billing changed. Tested in `tests/gemini-direct-metering.test.ts` (a 429 with Retry-After and Google's quota details) and the proxy's stream and error tests.

### 7. Trial records for Gemini API cells

- Before this amendment, `to-trials.ts` found no agent-loop requests in a Gemini API capture, because Google's bodies name no model. So the effort check passed with nothing checked, and no replay was recorded. That applied to Gemini CLI's s04 too.
- Now it finds them by route, reads `thinkingLevel` in either case, and records `frontier.reasoning_replay` from the `thoughtSignature` on each replayed model turn's first function call. The install check holds Gemini API cells to the same replay rule as OpenRouter and xAI cells (`tests/frontier-harbor-gemini-trials.test.ts`). These records apply to s04 as well.

### 8. Prices, what stays, and the deadline

- **Prices:** `runner/pricing/prices-2026-11-18.json`, the next dated table, adds `google:gemini-4-hydrogen` at $1.50 input, $7.50 output (thinking included) and $0.075 cache reads per million tokens (ai.google.dev/gemini-api/docs/pricing, read 2026-11-16). Carbon's row is unchanged: $2, $10 and $0.10 through 2026-11-30, then $4, $20 and $0.20 from 2026-12-01.
- **Expected cost: no change.** Google's Gemini API and OpenRouter's Google AI Studio standard endpoint list the same per-token rates for both models. The direct route bills no cache writes, which OpenRouter's rows could add, so if anything it costs less. Expected dollars, leases and caps stay as preregistered.
- **Unchanged:** the lineup, cells, tasks, attempts, shard table (apart from the model ids and keys above), calls, smallest detectable differences, the stop rule and every other route.
- **Not counted:** s01's as-wired trials, and any trial on the old OpenRouter route for these cells.
- **Before counted trials:** a keyless install check at this commit replaces `install-check.json`, then the gated canaries run.
- **Carbon's deadline is unchanged:** s01 to s05 must all launch by **2026-11-29 00:00 UTC**, before Carbon's 2026-12-01 price change.

## Amendment 3 (2026-11-17): Hermes installs from its pinned commit without a branch name

### 1. Why

- The keyless install check at amendment 2's commit (34edfa6) failed every Hermes cell at install: Hermes's `install.sh` printed "commit 3b421578588243f920886e6fe79a6faa87ea026e is not on branch v0.23.1". `agents.py` passed `--branch v0.23.1`, but v0.23.1 is a tag, not a branch, so `install.sh`'s `git merge-base --is-ancestor <commit> origin/v0.23.1` check could never pass. The pin itself was right.
- No trial ran on that wiring, and nothing was counted.

### 2. The change

- `agents.py` now runs the pinned commit's own `install.sh` with `--skip-setup --commit 3b421578588243f920886e6fe79a6faa87ea026e` and no `--branch`, so `install.sh` uses its default branch, main. The commit is on Hermes's main (checked 2026-11-17 with `git merge-base --is-ancestor` on a fresh clone), and the existing post-install check still refuses any checkout whose HEAD is not that commit.
- Nothing else changes: the Hermes version, the plugin and its hashes, every route, the shard table and the deadline stay as amendments 1 and 2 set them.

### 3. What the as-wired gates showed on the real APIs

These trials ran at the preregistration commit (7c604eb) with the old wiring, 3 trials each, and are not counted:

- **s01, Carbon in Hermes (custom provider via OpenRouter, Google AI Studio):** Hermes dropped Carbon's `reasoning_details` from every replayed turn, and Google still answered 200 on every replay. All 3 trials ended on upstream 429s from OpenRouter's shared Google AI Studio capacity (amendment 2).
- **s02, Carbon in OpenClaw (custom provider via OpenRouter):** OpenClaw rewrote tool-call ids (`call_N` to `callN`) and kept `reasoning_details`. Google answered 200 on all 146 requests, with no 429s, and all 3 trials completed.
- **s29, Muse Wonder in Hermes (custom provider via OpenRouter, Meta):** Hermes dropped every reasoning field, and Meta answered 200. All 3 trials completed.

So the replay refusals our keyless test upstream predicted for these pairings did not happen on the real APIs. Amendments 1 and 2 stand for their other reasons: with them, Hermes replays reasoning as it would for a user calling openrouter.ai directly, and Carbon and Hydrogen run on our own Gemini quota.



## Amendment 4 (2026-11-17): the keyless stand-in refuses only what a provider documents or was seen to refuse

### 1. Why

- Our keyless install check talks to a stand-in for the provider APIs (`scripts/frontier-harbor/fake-upstream.ts`). It refused three replay shapes that the real APIs answered with 200 in the as-wired gates at 7c604eb (amendment 3, section 3):
  - a Carbon tool-call turn replayed through OpenRouter with no `reasoning_details` (Hermes v2026.9.24, s01);
  - a Carbon tool-call turn whose ids OpenClaw rewrote from `call_N` to `callN`, signature kept (s02);
  - a Muse Wonder tool-call turn replayed with every reasoning field dropped (Hermes v2026.9.24, s29). The stand-in answered it with DeepSeek's error text, which Meta never documented.
- It also refused a Muse Code function call replayed on OpenRouter's Responses route without its reasoning item, a refusal its own comment said was not known to exist.
- Those refusals made us expect failures that the real APIs don't produce.

### 2. The change

- The stand-in now refuses a replay only when the provider documents the refusal or we saw the real API refuse it:
  - **DeepSeek** still refuses a tool-call turn replayed without its reasoning: its thinking-mode docs say `reasoning_content` must be passed back. No other OpenRouter model gets that refusal.
  - **Gemini on the native route** still refuses a function call replayed with no `thoughtSignature`, as Google's thought-signature docs say Gemini 3 and later do.
  - **Gemini through OpenRouter** refuses only a signature that was changed, with the error Google returns for an invalid signature. A turn with no signature, or with rewritten ids, is answered.
  - **Muse Wonder**, on Chat Completions and on the Responses route, is answered whatever reasoning comes back.
- The request log still records which reasoning fields each replayed turn carried, so a harness that drops reasoning still shows up, as a recorded property rather than a failure.
- `tests/fake-upstream-real-shapes.test.ts` sends the s01, s02 and s29 shapes and expects 200, and checks that the three documented refusals still stand.
- Not modelled: in s29 each trial's last request, Hermes's session-title call (`reasoning_effort` none with `response_format` set), got a 400 from the real route after the agent had finished. No error body was kept, so we can't say which field it refused, and the stand-in doesn't guess.
- The replay verdicts in `pin.json` don't change: they come from the keyless replay test of what each pinned harness sends, not from the stand-in's refusals.
- The keyless install check runs again at this amendment's commit, and the canaries run from the commit that records it.


## Amendment 5 (2026-11-17): Hermes installs and runs under one HERMES_HOME, and gets its anthropic extra from its own package manager

### 1. Why

- The keyless install check at amendment 4's commit (502fba5) failed every Hermes cell before its first request: `hermes --version` exited with "no dependency environment is committed for this install; run hermes pm repair". No trial ran on that wiring, and nothing was counted.
- A keyless repro in the task image (cobol-modernization at its pinned digest) found three bugs in `agents.py`'s Hermes install, each hiding the next:
  1. **Two homes.** `install.sh` ran under the default `HERMES_HOME` (`~/.hermes`), and Hermes then started under `HERMES_HOME=/tmp/hermes`. Hermes v0.23.1 records its committed dependency environment inside `HERMES_HOME`, so it found none, tried to rebuild, and failed because the image has no C++ compiler. This is Hermes issue [#143476](https://github.com/NousResearch/hermes-agent/issues/143476) (open).
  2. **A stale uv path.** The second step looked for uv at `$HOME/.hermes/bin/uv`. In v0.23.1 uv lives under `<HERMES_HOME>/tools/`, so the step would have exited 127.
  3. **The wrong environment.** That step synced the anthropic extra into `~/.hermes-src/venv`, but the v0.23.1 launcher runs on the environment Hermes's package manager commits under `<HERMES_HOME>/installs/`. Every Claude cell in Hermes would have installed cleanly and then failed at run time without `anthropic`.
- The cua-driver warning in the install log (the image lacks libXi.so.6) is not a cause: Hermes only warns, and `hermes --version` passes under the installer's own home.

### 2. The change

- `agents.py` sets `HERMES_HOME=/tmp/hermes` before `install.sh` runs, and every later step and every trial uses the same home.
- The anthropic extra goes in with `hermes pm install --extra anthropic`, Hermes's own package manager, into the environment the launcher runs on.
- The post-install check finds that committed environment with Hermes's own `pm.environments.committed_venv` and requires it to import anthropic 0.125.0, the version Hermes's uv.lock at v0.23.1 pins and `pin.json` names. A mismatch still stops the trial with HE-FRONTIER-002.
- Keyless repro in the task image: `hermes --version` reports v0.23.1 at 3b4215785882, the extra installs, the check reads anthropic 0.125.0, and the package manager's tool path covers ripgrep, node, npm, pnpm and ffmpeg.
- Nothing else changes: the Hermes version and commit, the plugin and its hashes, every route, the shard table and the deadline stay as earlier amendments set them.

### 3. Declared, not changed

- On first boot Hermes writes default files into `HERMES_HOME`, including SOUL.md, its built-in persona. It did this at run time before this amendment too. The install check records what the model sees, and the tool count and system prompt must match what amendment 1 declared.
- `hermes --version` prints "Update available". Our Hermes config keeps updates off, so no trial updates Hermes.

## Amendment 6 (2026-11-17): Hermes's own recovery from a thinking-only truncation is scored, not excluded

**Approved by** the coordinating agent on 2026-11-17. **Committed** on branch `harn99/results` while s01 and s02 run from f8662e6. It changes how trials are scored at analysis time only: no harness, setting, task, cap or runner file changes, and no counted `trials.jsonl` is edited.

### 1. What we found, and when we decided

- **Where:** s01 (Carbon in Hermes), canary trial 3, adaptive-rejection-sampler.
- **What happened:** request 3 went out at thinkingLevel high and ended with finish reason MAX_TOKENS at 65,535 output tokens, of which 43,775 were reasoning. Hermes kept no content from that answer. Requests 4 and 5 went out at thinkingLevel low with includeThoughts false, with caps of 8,192 and 32,768. Both ended with MAX_TOKENS again (8,192 tokens with 8,189 reasoning, then 32,768 with 32,437). The trial then timed out.
- **How it was classed:** `to-trials.ts` classes any trial whose agent-loop requests did not all send the preregistered effort as infra_class effort_mismatch, an infra_error excluded pairwise. So trial 3 was excluded.
- **When we decided:** we found this pattern on that one canary trial. We decided the rule after seeing that one trial's outcome and before reading any pair counts. The operational reading in section 3 was settled the same way: after seeing trial 3, before any pair counts.

### 2. Why: Hermes lowers reasoning on purpose, in one place

We read Hermes at the pinned commit (3b421578588243f920886e6fe79a6faa87ea026e, v0.23.1). The recovery came in with [NousResearch/hermes-agent#100891](https://github.com/NousResearch/hermes-agent/pull/100891).

- **The recovery:** when an answer ends at the output cap and Hermes kept no visible text from it, Hermes sends the next request with reasoning off for that one request (`agent._ephemeral_reasoning_off`). On Google's Gemini API, reasoning off goes out as thinkingLevel low with includeThoughts false, since Gemini 3 and later have no off switch (Hermes's own comment in `agent/gemini_native_adapter.py`).
- **Hermes's own test for "thinking-only":** two places in `agent/turn_truncation.py` set it, and nothing else does:
  - `_continue_text`: finish reason length (Gemini's MAX_TOKENS arrives as length), no tool call in the answer, no visible content after Hermes normalizes it, and not a stream that broke off. It then appends its continuation nudge ("[System: Your previous response was truncated by the output length limit. ...]") and no assistant turn.
  - `continue_codex_incomplete`: a Responses answer with status incomplete for max_output_tokens or length, and no visible content.
- **Nothing else lowers reasoning right after a cut answer.** Hermes's other paths that lower or drop reasoning follow a 400 from a route that rejected the level or a disable (`agent/turn_recovery.py`), or a voice setting. None follows a truncated answer.
- **What the replay shows:** Hermes's Gemini adapter puts a placeholder model turn, "[The previous response was interrupted before it completed.]", between a tool-result turn and the nudge (`agent/gemini_native_adapter.py`). Trial 3's request 4 replays the cut answer as that placeholder plus the nudge. That is Hermes's text, not the model's.

### 3. The rule

- **Scored:** an effort_mismatch trial of a Hermes cell is scored as its graded outcome (pass or fail from the verifier, so it enters its pair) when every lowered agent-loop request directly follows an agent-loop answer cut at the output cap. A cut answer is finish reason MAX_TOKENS, length or max_tokens, or a Responses answer incomplete for max_output_tokens or length.
- **A chain counts:** trial 3's second lowered request follows the first lowered request's own MAX_TOKENS answer.
- **Where the request bodies are kept, they must show the recovery too:** each lowered request ends in Hermes's continuation nudge (a Responses body may instead be Hermes's bare first retry), and replays no visible model text from the cut answer. Gemini's placeholder turn is not model text.
- **The tag:** every such trial carries "harness lowered effort after thinking-only truncation". The tag's rate is reported per Hermes cell.
- **Everything else stays infra exactly as before:** a lowered request that follows any other answer, a request body that replays visible text from the cut answer, a usage log whose lowered requests do not match the record's count, or a capture that cannot be paired with the usage log.
- **"Graded outcome" means what the trial would have been without the effort check:** a timeout stays a timeout with its verifier grade (trial 3), an exception is a harness_error, and a trial that also met a later infra class (a 429 that stopped the harness, verifier_unavailable) keeps that class.
- **Scope:** every Hermes cell, including s01 trials already run. OpenClaw, Pi and every other harness are unchanged.

### 4. It follows Hermes's recovery path, not a token count

- **Trial 3's answer was not all reasoning by count:** 43,775 of its 65,535 output tokens were reasoning, and Hermes still kept no content from it. A rule that needed reasoning tokens to equal output tokens would miss the very case Hermes handles.
- **Response bodies are not kept anywhere.** So the evidence is the proxy's per-request usage lines (finish_reason, output_tokens, reasoning_tokens and the effort sent, in every shard's `proxy-usage.ndjson`), plus the replayed placeholder and nudge in the request capture where it is kept.

### 5. How it applies to trials already run

- **Where it lives:** `scripts/frontier-harbor/truncation-recovery.ts`, run by `scripts/frontier-harbor/analyze.ts` when the analysis spec sets `"truncation_recovery": "amendment-6"`. Tests: `tests/frontier-harbor-truncation-recovery.test.ts`. For a shard whose records were rebuilt by `to-trials recover` (paths {}, because the shard ended on its timeout before `convert` ran), it reads each trial's capture from the shard's own `run/jobs/<harbor_job>/<harbor_trial>/proxy-capture/` (`scripts/frontier-harbor/trial-dir.ts`; `analyze.ts --shard-results <dir>` points a merged analysis at it), and each verdict records whether it used the usage log alone or the capture too.
- **Nothing on the VMs changes.** s01 and s02 keep running from f8662e6 and write `trials.jsonl` under the original rule.
- **At analysis time** it reads the merged results directory: `trials.jsonl` as written, every shard's `proxy-usage.ndjson`, and each trial's request capture under `trials/<cell>/<task>/a<n>/harbor/proxy-capture/` when the controller's pull brought it back. With no capture, the usage log alone decides, and its count of lowered requests must equal the record's.

### 6. The results page reports the affected Hermes cells both ways

- `analysis.json` and `analysis.md` use amendment 6. Their truncation_recovery section gives, per Hermes cell, the tagged trials and their rate, the trials that stayed infra and why, and the pass rate, verdict and pairs under both rules.
- `analysis-original-rule.json` and `analysis-original-rule.md` hold the whole analysis under the original rule, from the same `trials.jsonl`.

### 7. Ruling C is confirmed: Gemini rows keep requesting 65,536

- Every Gemini row keeps requesting 65,536 output tokens (Hermes 65,535, as declared in amendment 2).
- Amendment 2 said a further amendment would drop every Gemini row to 32,768 if the canaries showed refusals or replies cut at 32,768. That meant the provider cutting or refusing a request, not the model spending the cap it was given.
- Trial 3 is the second case. Every cut came with the model's own reasoning filling the cap, and the 32,768 cap on request 5 was Hermes's own continuation cap. Google refused nothing.

## Amendment 7 (2026-11-17): each remaining shard's timeout and TTL come from measured canary pace

**Approved by** the coordinating agent on 2026-11-17. **Operational only:** tasks, models, trial counts, leases, caps and scoring don't change.

### 1. Why

- s01 (Carbon in Hermes) measured 22 to 24 minutes a trial, against the planned 11.8, plus about 2 hours 15 minutes of start-up.
- Its 14-hour timeout stops it at roughly 125 to 130 of its 156 trials.
- The shard table's expected hours took Hermes's Opus mean for Carbon, since no run had timed Carbon on these tasks.

### 2. The rule for every shard launched from now on

- **Measured pace:** each shard uses its own canary's measured minutes per trial and start-up. A shard with no canary of its own uses the canaries of the same model.
- **Timeout:** trials times measured minutes per trial, divided by 4 concurrent trials, divided by 60, plus the measured start-up in hours, times 1.25, rounded up to a whole hour.
- **TTL:** UBI_TTL_HOURS is that timeout plus 1. This replaces the preregistration's "1.5 times the expected hours plus 2" for these shards.
- **Example:** 156 trials at 23 minutes with 2 hours 15 minutes of start-up gives 17.2 hours, so a 22-hour timeout and a 23-hour TTL.
- **Recorded at launch:** `bun scripts/frontier-harbor/shard-hours.ts --shard <name> --trials <n> --minutes-per-trial <m> --startup-minutes <s> --canary <source> --log <dest>/lane.log` computes both values and appends one SHARD_HOURS line to the shard's run log (`<dest>/lane.log`). The line names the measured inputs, the canary they came from and the values. Tests: `tests/frontier-harbor-shard-hours.test.ts`.
- **No runner change needed:** no preregistered file the runner reads carries a timeout or TTL. The shard table's UBI_TTL_HOURS column is prose, and `prereg-harbor-sNN.json` has neither. `scripts/ubicloud/run-shard.sh` takes any `--timeout-hours` from 1 to 998 and any UBI_TTL_HOURS above it.
- **Carbon's deadline is unchanged:** s01 to s05 must all launch by **2026-11-29 00:00 UTC**.

### 3. Deviation: shards launched before this amendment (s01 and s02)

- s01 (Carbon in Hermes, 14-hour timeout) and s02 (Carbon in OpenClaw, 12-hour timeout) launched from f8662e6 before this amendment.
- Each runs until its own timeout. If it stops short of its trials, its unrun trials finish with `run-shard.sh --resume` on one fresh VM, from f8662e6, under the same lease and cap.
- **Updated by amendment 10:** the unrun trials of s01 and s02 run in a second results directory per shard, from a lease-only commit on top of f8662e6 with identical code, under the raised leases, one VM after the other.
- So such a cell runs on two VMs, one after the other, never at the same time. The preregistration says no cell is split across machines. This is a deviation from that line, and the results page states it per shard.
- Both VMs are the same size (standard-16) and run 4 trials at a time from the same commit. As for every resumed counted run, the lane log names each VM and the commit it loaded.
- A shard stopped by its timeout comes back without `trials.jsonl`, so s01 and s02's records are rebuilt by `to-trials recover`. The analysis reads their trial files from the shard's `run/jobs/` tree (`scripts/frontier-harbor/trial-dir.ts`), and counts the spend their usage logs hold for no record (a trial cut mid-run, a request charged at its reservation) in the cell's cost. This is a fix to the analysis, not a rule change.

## Amendment 8 (2026-11-17): s01 and s02 finish under raised leases, Carbon shards launch first, and spend is re-projected from measured ratios

**Approved by** the coordinating agent on 2026-11-17. Sections 2 and 3 raise two leases. Sections 4 and 5 are operational only. Tasks, models, trial counts and scoring don't change.

### 1. Why

- **Carbon costs 2 to 3 times its plan.** s01 (Carbon in Hermes) spent $1.157 a trial against the planned $0.58 (2.0 times). s02 (Carbon in OpenClaw) spent about $1.549 against $0.54 (2.9 times).
- **Most of it is the agent clock.** 55 of s01's 104 recorded trials and 47 of s02's first 81 ran the agent's full time limit. A timed-out trial is still graded, so these are results, not lost trials. The results page reports the share per cell.
- **The first three trials under-predicted.** After 3 trials s02 measured $0.826 a trial, and s01 $0.956.
- **The leases can't cover the rest.** s01 stopped on its timeout with 104 of 156 trials recorded. Its lease had $59.51 left for 52 trials needing about $60.20. s02 is expected to be further short.

### 2. New leases for s01 and s02

- **Rule:** new lease = spend recorded so far + measured $ per trial × trials left × 1.25, rounded up to $5. New cap = new lease + a 5% reserve, at least $5. This replaces the shard table's lease and cap for these two shards only.
- **s01:** $120.49 + 52 × $1.157 × 1.25 = $195.70, so the lease is **$200** (was $180) and the cap **$210** (was $190).
- **s02:** lease $265 and cap $280, set by the same rule when it stopped (amendment 10 section 2).
- **Updated by amendment 10:** these leases take effect in the plan files, and s01 and s02 finish in a second results directory per shard from a lease-only commit on top of f8662e6, not by an in-place resume.

### 3. Deviation: a hand-written shard.json for each resumed shard

- **What broke:** a timeout stop ends the shard by signal. The VM's teardown runs before `vm-run.sh`'s `finish()`, so the shard returns no `trials.jsonl` and no `shard.json`. `run-shard.sh --resume` needs `results/shard.json` and refuses without it.
- **Recovery:** each shard's records are rebuilt from the mid-run journal with `to-trials.ts recover`, one record per journal row (s01: 104 of 104), and checked with `to-trials.ts scan-verifier`.
- **The hand-written file:** `shard.json` holds exactly the fields `finish()` writes (vm-run.sh line 353 at f8662e6): name, machine, commit, images (null) and workload. One value differs from what `finish()` would have written. `finish()` records the VM's hostname, Ubicloud's short VM id. That id was never recorded and the VM is gone, so `machine` holds the VM's name from `shard-vm.json` instead. merge-shards.ts copies `machine` into its manifest, so the manifest shows the VM name for these two shards.
- The resumed VM skips every recovered trial, since `vm-run.sh` passes the shard's `trials.jsonl` as `--own`.

### 4. Launch order (operational)

- After the s01 and s02 resumes, the Carbon shards s03, s04 and s05 launch next, then every other shard, with s29 and s33 first among them.
- **Why:** if the stop rule trips, the Carbon cells, the question this eval exists to answer, have still run.
- This replaces "these four shards (s01, s02, s29, s33) launch first" in the replay gate. The gate itself is unchanged: it still applies to s29 and s33 at their own first 3 trials.

### 5. Re-projecting spend

- **When:** after each shard's first 10 trials, instead of after a canary's first 3.
- **How:** each shard that has run uses its measured $ per trial. A shard that hasn't run uses its planned $ per trial times its model's measured ratio (measured over planned, weighted by spend across that model's shards so far). A model with no measured shard uses plan. VM-hours and our own model use are counted, the second VMs included.
- **The stop is unchanged:** if this projection passes $8,500, shards already running finish and no new shard launches until the coordinating agent says so.


## Amendment 9 (2026-11-17): the stop moves to a projected $9,500 all-in

**Approved by** Garry on 2026-11-17. Asked to raise the stop from $8,500 to $9,500 all-in, he replied: "raise". Budget only. Tasks, models, trial counts, leases, launch order and scoring don't change.

- **Why:** Carbon measured 2.0 and 2.9 times its planned cost a trial (amendment 8 section 1). At those ratios the whole eval projects at about $8,500 all-in, right on the old stop, which would likely have left Carbon cells unrun.
- **The stop rule:** the re-projection in amendment 8 section 5 still runs after each shard's first 10 trials. If it passes **$9,500 all-in**, shards already running finish and no new shard launches. This replaces $8,500 in "Budget and stop rule". No further raise is made without Garry.
- **Unchanged:** the coordinating agent still hears before paid spend passes $7,000, and leases stay runaway protection, raised only by a dated amendment.


## Amendment 10 (2026-11-17): Carbon leases are raised in the plan files, and s01 and s02 finish in a second results directory

**Approved by** the coordinating agent on 2026-11-17, under the B1 lease rule of amendment 8 section 2. Leases and caps only. Tasks, models, trial counts, code and scoring don't change.

### 1. Why amendment 8's raise needed this

- **Leases are read from the plan files.** On each VM, `plan.ts check-shard` refuses any `--lease-usd` above the lease in `prereg-harbor-sNN.json` at the commit the VM loads. Amendment 8 changed only this file, so its raise could not take effect.
- **A started results directory can't take a new plan commit.** `to-trials attest` records the commit that last changed the plan file and refuses a different one later (HE-FRONTIER-006). So s01 and s02 can't finish in their first directories under a raised lease without a runner code change, which this run doesn't make.

### 2. New leases and caps in the plan files

- **Rule (amendment 8 section 2):** recorded spend + measured $ per trial × trials left × 1.25, rounded up to $5. For a shard that hasn't run: planned $ per trial × Carbon's measured ratio (2.39) × trials × 1.25, rounded up to $5. Each reserve is 5% of the lease rounded up to $5, as the shard table's reserves are, and each cap is lease plus reserve.
- **s01:** lease $200, reserve $10, cap $210 (was $180, $10, $190). From $120.49 + 52 × $1.157 × 1.25.
- **s02:** lease $265, reserve $15, cap $280 (was $170, $10, $180). From $150.21 + 58 × $1.533 × 1.25.
- **s03:** lease $190, reserve $10, cap $200 (was $125, $10, $135).
- **s04:** lease $210, reserve $15, cap $225 (was $140, $10, $150).
- **s05:** lease $1,030, reserve $55, cap $1,085 (was $685, $35, $720).
- Recorded spend is the proxy usage log's, which is higher than the records' sum: s01's log holds $0.17 and s02's $3.08 that no record holds.

### 3. Deviation: s01 and s02 finish in a second results directory per shard

- **Where they run from:** commit d0820b4d3da0450d32d6a918e485ac97dc7bde7d, which is f8662e6 with only `prereg-harbor-s01.json` and `prereg-harbor-s02.json` changed (the leases above). The code is identical to f8662e6. That commit is merged into this branch so it stays reachable.
- **How:** each shard's unrun trials run on one fresh VM into a new directory (`c-s01-b`, `c-s02-b`). The first directory's recovered `trials.jsonl` is passed as `--done`, so no recorded trial runs again and its spend counts against the new lease. The new directory's lease is the new lease less the first directory's usage-log spend: $79.50 for s01 and $114.79 for s02.
- **Still one VM after the other:** each cell runs on two VMs, never at the same time, as amendment 7 section 3 says. The lane log names each VM and the commit it loaded.
- **Hand-written lane files in the new directory:** `results/shard.json` (as in amendment 8 section 3) and `shard-vm.json` with `cleanup: done`, which `run-shard.sh --resume` needs before it uploads the directory. The new directory has no earlier VM or ledger, so the stale-ledger guard behind that check has nothing to protect.
- **Merging:** the two directories of a shard merge with `scripts/merge-stages.ts` (new directory first, `--prereg-sha` naming the first directory's plan file), not `merge-shards.ts`, which refuses one shard in two directories. A keyless dry run on s01's recovered records merged all 104, and scan-verifier found nothing. Each first directory gets a `manifest.json` built from its original plan file, since `to-trials recover` doesn't write one.
- **s02's stop:** its attached controller was killed at about 22:39Z by the controller machine's process time limit, before its own stop. The VM kept running trials until it was stopped at about 23:20Z and torn down at 23:23Z. Its 98 journaled trials were recovered, 98 of 98.

### 4. s03 to s05

- They launch into fresh directories from this branch at this amendment's commit, after the s01 and s02 second directories, in amendment 8 section 4's order. That commit differs from 61451a8 only in docs and plan-file leases.


## Amendment 11 (2026-11-18): s04 and s05 leases raised again from measured cost

**Approved by** the coordinating agent on 2026-11-18, under the lease rule of amendment 8 section 2 and the plan-file route of amendment 10. Leases and caps only. Tasks, models, trial counts, code and scoring don't change.

### 1. Why

- **s04 (Carbon in Gemini CLI) costs more than amendment 10 projected.** After 77 of its 156 trials it had recorded $139.68, or $1.814 a trial, against the $0.45 planned (4.0 times). At that rate its $210 lease runs out after about 115 trials.
- **Carbon's ratio rose.** Weighted by spend across s01 to s04, Carbon now measures 2.60 times its planned cost, against the 2.39 used for amendment 10. s05's $1,030 lease sits below the B1 figure at that ratio.

### 2. New leases and caps in the plan files

- **s04:** lease $320, reserve $20, cap $340 (was $210, $15, $225). From $139.68 + 79 × $1.814 × 1.25 = $318.80.
- **s05:** lease $1,115, reserve $60, cap $1,175 (was $1,030, $55, $1,085). From 214 × $1.60 × 2.60 × 1.25 = $1,112.80. s05 hasn't started, so it launches from this amendment's commit into a fresh directory.
- Each reserve is 5% of the lease rounded up to $5, and each cap is lease plus reserve.

### 3. s04 finishes in a second results directory

- s04's first directory (`h-s04`) is attested at amendment 10's commit, so, as amendment 10 section 3 explains, its unrun trials can't take the new lease in place.
- When s04's first directory stops, at its lease or its timeout, its unrun trials run on one fresh VM into `h-s04-b` from this amendment's commit. The first directory's records are passed as `--done`. The new directory's lease is $320 less the first directory's usage-log spend. The two directories merge with `scripts/merge-stages.ts`, as for s01 and s02. One VM after the other, never at the same time.
- Trials refused at the old lease in the first directory are not counted. Like any unrun trial, they run in the second directory.
- This amendment's commit differs from amendment 10's only in this file and the s04 and s05 plan files.


## Amendment 12 (2026-11-19): s04's 26 lease-refused trials run once more as a rerun stage

**Approved by** the coordinating agent on 2026-11-19. Operational only. Tasks, models, trial counts, leases and scoring don't change.

- **What happened:** s04's first directory (`h-s04`) reached its $210 lease and wrote a record for all 156 trials. 26 of them are `infra_class: lease_refused` (the proxy refused their calls with a 402 under the old lease). Amendment 11 section 3 says these aren't counted and run again in the second directory.
- **How they run:** with the runner's existing rerun stage (`vm-run.sh --rerun`). This is the same code at amendment 11's commit, with no change. The second directory `h-s04-b` runs exactly those 26 trial ids once more under their own ids, as stage `rerun1`, under amendment 11's $320 lease less the first directory's $206.97 ($113.03).
- **Inputs:** the first directory's `trials.jsonl` goes in as `--done` and the 26 ids as `--rerun`. `plan.ts check-shard --rerun` was dry-run at amendment 11's commit and passes at $113.03.
- **Merge:** `merge-stages.ts --shard s04:a=h-s04 --exclude <the 26 ids> --rerun s04:b=h-s04-b` replaces each lease-refused record with its rerun record. The first run's recorded spend is kept in `frontier.replaced_usd` and counts toward s04's cost.
- **No third attempt:** a rerun that is itself lease-refused stays lease-refused (merge-stages counts it under `rerun_lease_stopped`). Each of these trials gets at most one more attempt.



## Amendment 13 (2026-11-19): Pi installs Node without GitHub in the fresh-set cells

**Approved by** the coordinating agent on 2026-11-19. It is a dated plan change for a setup error (org rule R102). Tasks, models, trial counts, leases, scoring and the blocklist don't change.

- **What happened:** s05 (Carbon in Pi, SWE-rebench) ran from amendment 11's commit into `h-s05`. All 214 of its records are infra errors (`infra_class: no_model_response`, HE-FRONTIER-006), with 0 model requests and $0 paid. The VM cost $1.96 at list price.
- **Cause:** Harbor 0.24.0's Pi install starts by piping nvm's install script from raw.githubusercontent.com. The SWE-rebench blocklist refuses `*.githubusercontent.com` on purpose (`pin-swe-rebench-07-2026.json` egress.why), so every trial stopped at setup with `NetworkConnectionError` before the model was called. It's our setup, not Pi and not the model.
- **Why nothing caught it:** the shard smoke is the keyless install check, which runs on Terminal-Bench tasks, and their blocklist doesn't list GitHub. fable-diagnosis-2026-11 ran the same tasks in Claude Code, whose install doesn't use GitHub.
- **Who it affects:** all five fresh-set cells, since all of them are Pi: s05, s15 (Opus 5.5), s16 (Fable 5.2), s27 (Grok 4.7) and s32 (Muse Wonder). Only s05 has run.
- **The fix:** `agents.py` FrontierPi checks whether a trial runs in a task-source environment (`egress.py` SourceBlocklistDockerEnvironment). If it does, FrontierPi copies the same nvm v0.40.2 files (`nvm.sh` and `nvm-exec`, vendored under `scripts/frontier-harbor/vendor/nvm-v0.40.2/` with nvm's MIT licence, sha256-checked before upload) into `~/.nvm`. It does that instead of piping the install script. The rest of Harbor's install is unchanged: Node 22 from nodejs.org, then Pi 1.5.0 from the npm registry. Neither host is refused.
- **What doesn't change:** Terminal-Bench cells keep Harbor's install exactly as before, so s03 and the Pi cells not yet run are unaffected. The model still can't reach GitHub.
- **Checked:** the rewritten install ran in the gentle-ai-595 task image with raw.githubusercontent.com and github.com pointed at 127.0.0.1. It exited 0 with Node v22.23.5 and `pi --version` 1.5.0, and the rewritten command no longer names GitHub. The frontier-harbor, delivery and audit tests pass (403 pass, 51 skip, 0 fail), and check-links is clean.
- **How s05 runs:** `h-s05` is set aside whole and not merged. Scoring already leaves out every one of its records as an infra error with no model request. It is reported as a failed first attempt, with this cause. s05 runs all 214 trials again from this amendment's commit, on one fresh VM, into `h-s05-b`. The lease stays amendment 11's $1,115 ($60 reserve, $1,175 cap), because `h-s05` spent nothing.
- **The other fresh-set shards** launch from this commit.
- **Not a "can't run" result:** the prereg's "can't run <model> in <harness>" rule is for a cell the harness or model can't complete. This failure came from our blocklist, so it is fixed and stated here instead.



## Amendment 14 (2026-11-20): the s33 lease is raised from measured Hydrogen cost, and its lease-refused trials run in a second directory

**Made by** the run's agent under the coordinating agent's standing lease rule (the B1 formula, with no raise that pushes the measured-ratio projection past the $9,500 stop). Operational only. Tasks, models, trial counts, scoring and code don't change.

- **What happened:** s33 (Gemini 4 Hydrogen in OpenClaw) ran from amendment 13's commit into `h-s33` and reached its $80 lease after 80 trials that weren't refused, at $79.03, about $0.99 a trial. That is about 1.9 times the plan's rate. The proxy then refused the remaining trials' calls with a 402 (`infra_class: lease_refused`).
- **New lease (B1):** recorded spend $79.03 plus $0.99 a trial for the 76 trials left, times 1.25, rounded up to $5, gives $175. The reserve is 5% rounded up to $5 ($10), so the cap is $185. The measured-ratio projection stays under $9,500.
- **How the rest runs:** as amendment 12 did for s04. When `h-s33` stops, its lease-refused trials run once more under their own ids as stage `rerun1`, on one fresh VM, into `h-s33-b`, from this amendment's commit. The first directory's `trials.jsonl` goes in as `--done` and the lease-refused ids as `--rerun`. The new directory's lease is $175 less the first directory's usage-log spend. `plan.ts check-shard --rerun` is dry-run first. The two directories merge with `merge-stages.ts --shard s33:a=h-s33 --exclude <the refused ids> --rerun s33:b=h-s33-b`, which keeps the refused trials' recorded spend in `frontier.replaced_usd`.
- **No third attempt:** a rerun that is itself lease-refused stays lease-refused. One VM after the other, never at the same time.
- This amendment's commit differs from the one before it only in this file and the s33 plan file.



## Amendment 15 (2026-11-20): the stop moves to a projected $10,500 all-in

**Approved by** Garry on 2026-11-20. The coordinating agent asked him to choose: raise the stop from $9,500 to $10,500 all-in, cut the fresh-set Fable cell (s16), or stop at the cells already done. He replied: "Do it can you do it for me", which took the recommended raise. Budget only. Tasks, models, trial counts, leases, launch order and scoring don't change, and every preregistered cell stays.

- **Why:** the re-projection on 2026-11-20 at about 10:00Z came to about $10,000 all-in. Paid spend so far was $1,488.56, with about $7,270 still to pay. Ubicloud VMs add about $286 and our own model use about $960 ($561.94 measured so far, against the $460 estimate). Muse Wonder measured 1.84 times its plan in s29. The reruns after Google AI Studio's prepaid credit ran out (402 `RESOURCE_EXHAUSTED` from about 05:10Z, which ended s05-b's and s33-b's trials with `no_model_response`) add about $365. Shards already running finished, and no new shard launched until Garry answered.
- **The stop rule:** as in amendment 9, with **$10,500 all-in** in place of $9,500. No further raise is made without Garry.
- **Unchanged:** leases stay runaway protection, raised only under amendment 8's B1 rule or by a dated amendment. The Google-routed reruns and s34 launch only after the prepaid balance is topped up.


## Amendment 16 (2026-11-20): trials lost to Google's 402 answers run again, and the s34 lease is sized from measured Hydrogen cost

**Made by** the run's agent, after the coordinating agent asked on 2026-11-20 for the Google shards to resume. Lease sizes follow the coordinating agent's standing lease rule (amendment 8's B1 formula, inside amendment 15's $10,500 stop). Operational only. Tasks, models, trial counts, scoring and code don't change.

- **What happened:** from about 05:10Z on 2026-11-20, Google's Gemini API answered every call from s05-b (Carbon in Pi, SWE-rebench) and s33-b (Hydrogen in OpenClaw, the rerun directory of amendment 14) with HTTP 402 `RESOURCE_EXHAUSTED`: "Your prepayment credits are depleted. Please go to AI Studio ... to manage your project and billing." The proxy settled those answers at $0. The model never answered, so the trials ended `infra_class: no_model_response`. When the coordinating agent checked Garry's AI Studio billing, it found no prepaid balance, and none of it was depleted. By 15:09Z, one-token calls to gemini-3.8-flash and gemini-4-carbon through the metering proxy, with the same key, answered 200 again. The cause on Google's side isn't known.
- **s05:** h-s05-b finished all 214 trials: 98 completed, 23 at the agent timeout and 93 infra errors. Of those, 92 were `no_model_response` from the 402 window and 1 was `setup_failed` inside it, at 06:19Z. The 93 infra trials run once more under their own ids as stage `rerun1`, on one fresh VM, into `h-s05-c`, from this amendment's commit. h-s05-b's `trials.jsonl` goes in as `--done`. The lease stays amendment 11's $1,115; check-shard counts h-s05-b's $384.27 of recorded spend against it, so the new directory's lease is $730.72. Merge with `merge-stages.ts --shard s05:a=h-s05-b --exclude <the 93 ids> --rerun s05:b=h-s05-c`. As amendment 13 says, h-s05 stays set aside.
- **s33:** 69 of h-s33-b's 76 rerun trials hit the 402 window. The merge allows one rerun per trial id, so **h-s33-b is set aside whole** and not merged, as amendment 13 did for h-s05. All 76 of s33's lease-refused ids run once more as stage `rerun1`, outcome-blind, on one fresh VM, into `h-s33-c`, from this commit. That includes the 7 that got answers in h-s33-b (4 completed, 3 harness errors). h-s33's `trials.jsonl` goes in as `--done`. The lease is amendment 14's $175, less h-s33's $79.03 and h-s33-b's $5.91, so $90.05. Merge with `merge-stages.ts --shard s33:a=h-s33 --exclude <the 76 ids> --rerun s33:b=h-s33-c`. h-s33-b's spend and VM time still count in the eval's total, and it is reported as a failed directory.
- **s34 (Hydrogen in Pi), not yet run:** Hydrogen measured $0.99 a trial in s33, against $0.25 planned. B1 with no spend gives $0.99 × 156 × 1.25 = $193.05, rounded up to $5: lease **$195**, reserve $10, cap **$205** (were $80, $5 and $85). The measured-ratio projection stays under $10,500.
- This amendment's commit differs from the one before it only in this file and the s34 plan file.

## Amendment 17 (2026-11-21): the s05 reruns that h-s05-c did not reach run in a second directory, and h-s05-c's records come from its journal

**Made by** the run's agent, under amendment 16's plan for s05 and the coordinating agent's standing lease rule, inside amendment 15's $10,500 stop. Operational only. Tasks, models, trial counts, scoring and code don't change.

- **What happened:** h-s05-c (amendment 16's 93 reruns of Carbon in Pi on SWE-rebench) ran at about 6 trials an hour and hit its time limit at 09:58Z on 2026-11-21, with 67 of the 93 trials finished. When run-shard.sh stopped the shard, vm-run.sh's `finish()` did not get to write `trials.jsonl` before the results were pulled and the VM destroyed. `meter-final.jsonl` holds all 71 finalize answers, but `accounting.json` and `trials.jsonl` were never written.
- **h-s05-c's records:** rebuilt with the documented recovery (README, "A lost VM"), `to-trials.ts recover --mirror replica-h3/s05 --out h-s05-c-r`, at runner commit 2fb1db7. The result is 67 records from the journal (43 pass; 49 completed, 18 at the agent timeout), all `stage: rerun1`, all on google:gemini-4-carbon, with $234.39 of spend. The usage log holds $241.56, so $7.18 was spent by trials still running at the stop, which have no record. The ledger committed $243.75, including one open $2.19 reservation. All of it counts in the eval's total. Each recovered record has `paths: {}`, and its Harbor directory is in h-s05-c's `results/run/jobs`, which was pulled whole and is kept in h-s05-c's archive, so the audit can still read it through trial-dir.ts.
- **The 26 trials with no record:** they run once, as the same stage `rerun1` under the same lease (`frontier-shootout-2026-11:s05:rerun1`, $730.72, with about $486.97 left), on one fresh VM, into `h-s05-d`, from this amendment's commit. That is a `run-shard.sh --resume` of a directory holding h-s05-c's ledger, `shard.json`, `done.jsonl` (h-s05-b's 214 records) and `rerun.json` (amendment 16's 93 ids), plus the 67 recovered records as its own `trials.jsonl`, so `plan.ts jobs` leaves those 67 out and emits 26 (checked keyless). Timeout 10 hours, VM TTL 14 hours.
- **Merge:** `merge-stages.ts --shard s05:a=h-s05-b --exclude <the 93 ids> --rerun s05:b=<one directory with one rerun1 record per id>`, made from the 67 h-s05-c-r records and h-s05-d's records for the 26 ids. As amendments 13 and 16 say, h-s05 stays set aside.
- This amendment's commit differs from the one before it only in this file.

## Amendment 18 (2026-11-21): the run's stop moves from $10,500 to $11,500 all-in

**Made by** the run's agent, recording Garry's decision as the coordinating agent relayed it on 2026-11-21. Operational only. Tasks, models, trial counts, scoring, code and shard leases don't change.

- **Why:** at 16:18Z on 2026-11-21, after Grok's first 22 trials (s26, Grok 4.7 in Pi, about 1.7x its planned cost), the measured-ratio projection reached about $11,060 all-in, over amendment 15's $10,500 stop. Launches paused at that point, and the running shards finished.
- **Decision:** the coordinating agent asked Garry to raise the stop to $11,500 all-in so every preregistered cell runs, or to hold $10,500 and drop about $560 of cells. Garry's reply, 2026-11-21: "Raise".
- **From now:** the stop is $11,500 all-in (paid, VM and the run agent's own model use). Launches resume under the same rules. If the measured-ratio projection crosses $11,500, launches stop again and the question goes back to Garry. There is no further raise without him.
- This amendment's commit differs from the one before it only in this file.

## Amendment 19 (2026-11-21): Hermes on xAI also turns off its X search tool

**Approved by** the coordinating agent on 2026-11-21, before any data for s24. It is a dated plan change for a setup error (org rule R102), like amendment 13. Tasks, models, trial counts, leases, scoring and the web-tools check don't change.

- **What happened:** s24 (Grok 4.7 in Hermes) launched from d78c85d into `h-s24` at 20:22Z on 2026-11-21. After the keyless smoke, the web-tools check failed it at 22:14Z (exit 4, HE-FRONTIER-011): the cell was offered `hermes_tool_search`, whose deferred tool catalog lists `x_search: Search X (Twitter) posts, profiles and threads via xAI's built-in X Search`. The check did its job. No counted trial ran, $0 was paid, and the VM cost $0.96 at list price.
- **Cause:** Hermes v0.23.1 (3b42157) turns on its `x_search` toolset whenever xAI credentials are present (`hermes_cli/tools_config.py` `_composite_toolsets`; upstream [hermes-agent#68001](https://github.com/NousResearch/hermes-agent/issues/68001), open). Our config disabled only the `web` and `browser` toolsets. Only the xAI provider sets an xAI credential, so the other Hermes cells never saw it, and s01, s07, s10, s18 and s29 passed the same check.
- **The fix:** on xAI, `frontier_settings.py` writes `agent.disabled_toolsets: [web, browser, x_search]`. Hermes subtracts that list after every other toolset choice, including the credential auto-enable, and drops the same names from the tool_search catalog and bridge (`toolsets.py` `session_disabled_toolsets`, `model_tools.py` `get_tool_definitions`). Every other provider's config is byte-identical to before.
- **Checked:** keyless, at Hermes's pinned commit with a dummy xAI key: with `[web, browser]`, `x_search` is in the enabled set and named in the tool definitions, as in s24's smoke; with `[web, browser, x_search]`, it is in neither. The frontier-harbor web-tools, DeepSeek and Particle tests pass (58 pass, 4 skip, 0 fail), with a new case for Hermes on xAI. The shard's own smoke and web-tools check run again before any counted trial.
- **Who it affects:** only grok-hermes (s24). It is the only Hermes cell on xAI. s21 (Sol) and s35 (DeepSeek) are Hermes cells still to run, on other providers, and launch from d78c85d as planned.
- **How s24 runs:** `h-s24` is set aside (no records). s24 runs all 156 trials from this amendment's commit on one fresh VM, into `h-s24-b`, under its planned $295 lease.
- **Reported:** the results name this as a setup fix of ours. Hermes's out-of-the-box behaviour on xAI offers X search to the model, and the upstream issue is still open at the pinned commit.

## Amendment 20 (2026-11-22): Grok trials lost to xAI's out-of-credit answers run again, with leases sized from measured Grok cost

**Made by** the run's agent, after the coordinating agent asked at about 23:25Z on 2026-11-21 for s25's and s26's credit-failed trials to run again as declared reruns. Lease sizes follow the coordinating agent's standing lease rule (amendment 8's B1 formula) inside amendment 18's $11,500 stop. Operational only. Tasks, models, trial counts, scoring and code don't change.

- **What happened:** from about 22:40Z to 23:24Z on 2026-11-21, xAI answered every request with HTTP 403: "Your team ... has either used all available credits or reached its monthly spending limit." The account's balance was $0, and its automatic top-ups had failed. The proxy settled those answers at $0. The model never answered, so the trials ended `infra_class: no_model_response`, each with one request. Garry added credit, and the API answered 200 again from 23:25Z (a one-token probe).
- **s26 (Grok 4.7 in Pi):** 44 trials started between 22:40Z and 22:51Z hit the 403. They run once more under their own ids as stage `rerun1`, on one fresh VM, into `h-s26-b`, from this amendment's commit, with h-s26's `trials.jsonl` as `--done`. One more s26 record, `feal-linear-cryptanalysis/a1` at 17:23Z, also got a 403 with one request and $0, but credit was available then and xAI's 403 body isn't kept, so its cause isn't known. It stays as recorded and does not run again.
- **s25 (Grok 4.7 in OpenClaw):** 52 trials started between 22:40Z and 23:20Z hit the 403. They run once more the same way, into `h-s25-b`.
- **Leases (B1, measured cost):** s25 cost $2.18 a trial on its 104 trials that reached the model ($226.32), against $0.87 planned. 52 × $2.18 × 1.25 = $141.40, rounded up to $145. With h-s25's $226.32 recorded spend, s25's lease moves from $275 to **$375** and its cap from $290 to **$390** (reserve $15). The new directory's lease is $148.67 (h-s25's recorded spend is $226.3203, so $375 less it, rounded down to the cent). s26 cost $1.26 a trial on its 111 trials that reached the model ($139.71). 44 × $1.26 × 1.25 = $69.30, rounded up to $70. s26's lease moves from $205 to **$210** and its cap from $220 to **$225**. The new directory's lease is $70.29.
- **Merge:** `merge-stages.ts --shard s25:a=h-s25 --exclude <the 52 ids> --rerun s25:b=h-s25-b`, and the same for s26 with its 44 ids and `h-s26-b`.
- **Code:** this commit's code is amendment 19's, whose one change (Hermes on xAI turns off `x_search`) doesn't touch OpenClaw or Pi.
- This amendment's commit differs from the one before it only in this file and the s25 and s26 plan files.
## Amendment 21 (2026-11-22): trials a shard lease stopped, and trials whose model never answered, run once more with leases sized from measured cost

**Made by** the run's agent. On 2026-11-22 the coordinating agent asked for the lease-refused trials to run again as declared reruns, with Grok priced at 2.5 times its $0.87 planned rate per trial ($2.18), and for a projected all-in total at completion to be written down before any launch. That projection is a projected total, not spend to date: about $11,130 at 18:55Z on 2026-11-22, under amendment 18's $11,500 stop. Lease sizes follow the coordinating agent's standing lease rule (amendment 8's B1 formula). Operational only. Tasks, models, trial counts, scoring and run code don't change.

- **Which trials run again:** each runs once more under its own id as stage `rerun1`. No trial gets a third attempt.
  - `lease_refused` (the shard's lease ran out before the trial could make a request): s17 2, s23 36, s24 4, s28 56, s30 34, s31 37.
  - `no_model_response` with no upstream answer recorded at all (the trial made no request that got any HTTP status): s07 3, s08 1, s10 1, s12 6, s18 2, s23 3, s24 1, s37 1.
- **Which trials do not run again:**
  - xAI's 403 refusals whose body reads "I'm sorry, I can't help with that request.", answered while credit was available: s24 `feal-differential-cryptanalysis/a2` and `feal-linear-cryptanalysis/a3`, s25 `feal-differential-cryptanalysis/a1` (in its amendment 20 rerun), and s26 `feal-linear-cryptanalysis/a1` (amendment 20's trial of unknown cause). They are provider safety stops, reported per cell apart from model failures.
  - The 5 s25 and 8 s26 trials whose amendment 20 rerun ran out of lease. merge-stages.ts takes one rerun record per trial, so they stay as rerun_lease_stopped.
  - s29's 3 `no_model_response` trials: s29 ran from 508a2f7, whose code differs from this amendment's commit in the Hermes install path, so a rerun here would not be the same setup. They stay as recorded.
  - Shards still running or not yet launched (s15, s16, s27, s32, s35, s36, s39, s40) are outside this amendment.
- **Leases (B1, measured cost on trials that reached the model, lease-stopped trials left out):**

| Shard | Cell | Trials | Rate used | n × rate × 1.25, rounded up to $5 | Shard lease | Shard cap | Rerun directory lease |
|---|---|---|---|---|---|---|---|
| s23 | grok-grok-build | 39 | $2.18 (measured $1.74) | $110 | $230 → **$325** | $245 → **$340** | $113.45 |
| s24 | grok-hermes | 5 | $2.18 (measured $1.72) | $15 | $295 | $310 | $18.88 |
| s28 | muse-muse-code | 56 | $1.495 | $105 | $175 → **$275** | $185 → **$285** | $107.05 |
| s30 | muse-openclaw | 34 | $1.556 | $70 | $210 → **$280** | $225 → **$295** | $72.78 |
| s31 | muse-pi | 37 | $1.281 | $60 | $160 → **$220** | $170 → **$230** | $62.58 |
| s07, s08, s10, s12, s17, s18, s37 | opus-hermes, opus-openclaw, fable-hermes, fable-pi, astra-codex, astra-hermes, kimi-openclaw | 3, 1, 1, 6, 2, 2, 1 | measured | under $15 each | unchanged | unchanged | $35, $35, $65, $65, $155, $155, $25 |

  A rerun directory's lease is its shard lease less the spend its records already carry, so the shard never passes its lease. The small reruns get the plan check's headroom floor (concurrency 4 times the largest per-call reservation among the shard's cells, rounded up to $5, or $25 where that is lower), so one long request's reservation can't refuse a trial, and each stays inside its shard's unchanged lease. Expected paid for all of these reruns is about $304.
- **How they run:** one fresh VM per shard, one shard at a time within the vCPU limits, from this amendment's commit, into `h-<shard>-r1`, with `run-shard.sh --resume` and the shard's `trials.jsonl` as `--done`. Each provider gets one request with the proxy's exact provider pin before each launch.
- **Merge:** `merge-stages.ts --shard <name>:<label>=<dirs> --exclude <the ids above> --rerun <name>:r1=h-<shard>-r1`, on top of the merges already named in amendments 19 and 20.
- **Code:** this commit's code is amendment 20's. Against d78c85d, where every shard named here except s24 ran, it changes only Hermes on xAI (amendment 19), which none of these cells is. s24 ran from amendment 19's commit, whose code this is.
- This amendment's commit differs from the one before it only in this file and the s23, s28, s30 and s31 plan files.
## Amendment 22 (2026-11-22): a scored trial whose model never gave a 2xx answer counts as no_model_response

**Made by** the run's agent, at the coordinating agent's direction on 2026-11-22. It was written before any results were read for analysis. It is an analysis rule only: tasks, models, trial counts, run code and leases don't change, and no running shard changes.

- **The rule:** this applies to every harness, model and shard alike, and to every stage, rerun stages included. A trial recorded as `completed` or `timeout` whose `usage.upstream.statuses` holds no 2xx answer counts as `infra_error` with `infra_class: no_model_response`. That covers no requests at all, and requests that only ever got 4xx or 5xx answers. Its grade becomes n/a, it is excluded pairwise like every other infra trial, and the results list it by trial id with its recorded statuses. Its recorded USD still counts toward spend.
- **Why:** harnesses end the same failure in different ways. When GLM 5.3's pinned endpoint answered only 429, OpenClaw stopped with an error (s39, recorded as `infra_error`). Pi gave up after four 429 answers and exited normally (s40, recorded as `completed` and graded fail). Without this rule, one harness's way of quitting would read as a model failure and the other's as infra.
- **Known so far:** a scan of every finished and running shard directory at 20:15Z on 2026-11-22 found 73 such trials: s40's 72 to that point (glm-pi, 4 answers of 429 each) and one in h-s26 (grok-pi, 4 answers of 429 from xAI). The final list comes from the merged records.
- **Reruns:** a trial this rule reclassifies may run again under the amendment that covers its cell, the same as any other no_model_response trial, and no trial gets a third attempt. For s40 that is the GLM rerun the coordinating agent approved on 2026-11-22: once a probe with the proxy's exact provider pin gets a 2xx answer, or else the cells are reported as "provider endpoint unavailable".
- **Where it is applied:** at merge, before analyze.ts reads the records. The merge step writes the reclassified ids and their statuses to merge.json.
- This amendment's commit differs from the one before it only in this file.

## Amendment 23 (2026-11-22): s27 trials cut by xAI's credit stop run again if credit returns, and are reported apart if it doesn't

**Made by** the run's agent, at the coordinating agent's direction on 2026-11-22, before any results were read for analysis. Operational and analysis only: tasks, models, trial counts, scoring, run code and leases don't change. This is not spend to date: the projected all-in total at completion was about $11,270 at 22:50Z on 2026-11-22, under amendment 18's $11,500 stop.

- **What happened:** from 22:00:59Z on 2026-11-22 every xAI request got HTTP 403 with code `permission-denied` and a body saying the team "has either used all available credits or reached its monthly spending limit". It is an account stop, not a model answer and not a safety refusal. s27 (swe-grok-pi) was the only Grok shard running then, and 7 of its trials met it:
  - No answer at all, recorded `infra_error`: `microsoft__typescript-go-4194/a2`, `withcoral__coral-1143/a2`, `stablyai__orca-4331/a2`.
  - Cut after earlier 2xx answers, recorded `completed`: `gleam-lang__gleam-5797/a2` (graded pass), `harbor-framework__harbor-1764/a2`, `PerryTS__perry-3982/a2` and `nearai__ironclaw-3694/a2` (graded fail).
- **The class:** a trial whose recorded upstream statuses include one of these credit 403s counts as `infra_error` with `infra_class: provider_credit_stop`, whatever it was recorded as. Its grade becomes n/a, it is excluded pairwise like every other infra trial, and the results list it by trial id. Its recorded USD still counts toward spend. It takes precedence over amendment 22's no_model_response for the 3 trials with no answer.
- **Rerun:** once a request with the proxy's exact xAI pin gets a 2xx answer, the 7 run once more under their own ids as stage `rerun1` in `h-s27-r1`, from this amendment's commit, with `run-shard.sh --resume` and s27's other 207 records as `--done`. Rerun directory lease: s27's $1,115 lease less the $951.95 its records carry, rounded down to the cent so the plan check's floating-point sum stays at or under $1,115: $163.04 (7 × $4.45 measured × 1.25 is about $40). A first launch at $163.05 was refused by that check before any trial ran. No trial gets a third attempt.
- **If credit doesn't return** before the other shards finish, the 7 stay as `provider_credit_stop` and are reported per cell apart from model results. The same applies to amendment 21's Grok reruns that can't launch (s23 39, s24 5), which then keep their original records and classes.
- **Merge:** `--rerun s27:r1=h-s27-r1` when the rerun runs; the reclassification is written to merge.json either way.
- This amendment's commit differs from the one before it only in this file.

## Amendment 24 (2026-11-23): the s10 and s18 reruns share one VM because both cells run in Hermes

**Made by** the run's agent, at the coordinating agent's direction on 2026-11-23, before any results were read for analysis. Operational only: tasks, models, cells, attempts, effort, scoring and run code don't change. Every rerun VM first runs the keyless install check, which takes about 2 hours, so the two Hermes cells of amendment 21's reruns run on one VM and pay for it once. The projected all-in total at completion is about $11,310, under amendment 18's $11,500 stop. That is a projection, not spend to date.

- **What runs:** amendment 21's 3 Hermes rerun trials, unchanged: `fable-hermes/make-mips-interpreter/a2` (s10) and `astra-hermes/gcode-to-text/a1` and `astra-hermes/feal-differential-cryptanalysis/a1` (s18). Each runs once more under its own id as stage `rerun1`. No trial gets a third attempt.
- **How:** a new plan file, `prereg-harbor-s10s18.json`, holds both cells copied byte for byte from `prereg-harbor-s10.json` and `prereg-harbor-s18.json` (same model, harness, attempts, tasks, stage and priority, concurrency 4), as one shard `s10s18`. Its planned lease is $879, which is the $658.84 the two shards' records already carry plus amendment 21's two rerun directory leases ($65 + $155 = $220), rounded up; its cap is $914 (lease plus the $35 reserve). The rerun directory `h-s10s18-r1` runs with `run-shard.sh --resume`, both shards' `trials.jsonl` together as `--done`, a $220 lease and the ZDR gate (astra-hermes is an OpenAI cell). The two cells share that $220, which is far above their expected need of about $7.
- **s08 (opus-openclaw) and s17 (astra-codex)** have no other rerun cell in their harness, so each keeps its own VM under amendment 21.
- **Merge:** records are taken by trial id for each cell: `--rerun s10:r1=h-s10s18-r1 --rerun s18:r1=h-s10s18-r1`. If merge-stages needs one directory per shard, the combined `trials.jsonl` is copied into one directory per cell with the records byte-identical, and merge.json lists the split.
- **Code:** this commit's code is amendment 23's. The new plan file's name doesn't match the `prereg-harbor-s<NN>.json` pattern, so the 40 per-shard plan files and the checks that count them don't change.
- This amendment's commit differs from the one before it only in this file and the new plan file.

## Amendment 25 (2026-11-25): GLM 5.3 runs again on Novita's fp8 host after Baidu's endpoint left OpenRouter, and one s17 trial runs again with a lease sized for its reservations

**Made by** the run's agent on 2026-11-25, on the coordinating agent's rulings of 00:16Z that day, before any results were read for analysis. Tasks, cells, attempts, effort, scoring and leases of other cells don't change. The projected all-in total at completion is about $10,500 (about $10,400 before this amendment, plus about $70 paid for GLM at its leases, about $6 paid for the s17 trial and about $25 of VM). That is a projection, not spend to date, and it is under the coordinating agent's $10,550 for this amendment and amendment 18's $11,500 stop.

**GLM 5.3 (s39 glm-openclaw, s40 glm-pi)**

- **What happened:** from 2026-11-16 the proxy pinned GLM 5.3 to Baidu's fp8 endpoint (tag baidu/fp8). Every request there returned 429 tpm_rate_limit_exceeded (upstream_provider_shared_pool) through 2026-11-23. All 156 s39 trials are infra_error at $0. All 156 s40 trials got no 2xx answer and count as no_model_response under amendment 22. At 23:26Z on 2026-11-24 a request with the exact pin returned 404 "No allowed providers are available for the selected model", and Baidu was gone from openrouter.ai/api/v1/models/z-ai/glm-5.3/endpoints.
- **How the Baidu attempt is reported:** apart from model results, as "provider endpoint unavailable (host delisted 2026-11-24 23:26Z)". Its records, proxy logs and 429s stay in the raw data unchanged. The 404 is from the pinned probe and is in the run log.
- **What runs:** both cells in full, 52 tasks times 3 attempts each, from this amendment's commit, into the fresh directories h-s39-nv and h-s40-nv. Each cell gets its own VM, since the two cells run in different harnesses. Plan files, leases ($35) and caps ($40) are unchanged.
- **Host, frozen before the first counted trial:** Novita's endpoint on OpenRouter. That means tag novita/fp8, provider Novita, quantization fp8, standard tier, no fallbacks. Its context length is 1,048,576 and its max completion is 131,072, the same as Baidu's. It lists tools, tool_choice, reasoning, include_reasoning, reasoning_effort and max_tokens. Pinned probes at about 23:27Z on 2026-11-24 and at 00:34Z on 2026-11-25 (that one with the proxy's service_tier and max_price) returned 200, served by Novita, with no service tier named. GLM's own endpoint answered too, but it stays out under the provider-terms ruling of 2026-11-16. Every GLM row is labelled "Novita fp8 host", and the report keeps the sentence "GLM's own endpoint wasn't used, and an fp8 host may understate it."
- **Price:** the price row (prices-2026-11-18, $1.40 input, $4.40 output and $0.26 cached input per million tokens) and the max_price the proxy sends don't change. Those rates are Z.AI's list rates and Novita's rates before its current 55% discount. So the metered cost of every GLM trial is the undiscounted cost, and OpenRouter's billed cost, logged beside it as openrouter_cost_usd, is lower. The row's note still names Baidu, because it records where the rates were read on 2026-11-16.
- **Pilot:** a pinned probe before each launch, then each shard's one-trial smoke. The pilot passes when the proxy logs a 2xx answer served by Novita with no served_elsewhere and the smoke trial finishes. If Novita fails its pilot, the same cell runs on SiliconFlow's fp8 endpoint instead (tag siliconflow/fp8, provider SiliconFlow, fp8, standard tier; pinned probe 200 at about 23:27Z on 2026-11-24), labelled "SiliconFlow fp8 host". That follow-up commit changes only the pin, its pin.json row and the tests that check it. Its own pinned probe goes before its launch. Its rates of $0.70 and $1.90 are under the price row, so the price row and max_price stay.
- **Code:** this commit's code differs from amendment 24's only in the GLM pin in runner/proxy/metering-proxy.ts, the GLM row of scripts/frontier-harbor/pin.json, one comment in scripts/frontier-harbor/install-check.sh, and the two tests that check the pin. No cell other than s39 and s40 runs from this commit. Once the GLM cells finish, and before the results pull request, a later commit on harn99/results puts those lines back as they were, so main's code doesn't change. This commit stays in the merged history as the GLM runs' receipt.
- **Merge:** s39 takes h-s39-nv and s40 takes h-s40-nv. h-s39 and h-s40 are left out of model results and reported apart, as above.

**The lease-sized rerun (coordinating agent's condition: rerun only trials confirmed as false lease refusals)**

- **s17** astra-codex/extract-moves-from-video/a3 runs once more, into h-s17-r2. This is the one exception to amendment 21's "no third attempt", made on the coordinating agent's ruling. Its amendment 21 rerun stopped on a proxy 402: one request's worst-case reservation of $150.18 on top of the $8.63 the directory had committed would have passed the $155 lease, while the trial had spent $4.43 at the time. On the same task, single requests reserved up to $297.89, and whole trials spent $4.19 to $6.37.
  - Its directory lease is that trial spend plus one worst-case reservation: $6.37 + $297.89 = $304.26.
  - s17's records already carry $246.83 ($238.21 in h-s17 and $8.63 in h-s17-r1). So the s17 plan file's lease rises from $485 to $551.10, and its cap from $510 to $576.10 (lease plus the unchanged $25 reserve), and the shard still never passes its lease.
  - The rerun runs with run-shard.sh --resume, h-s17's trials.jsonl as --done and the ZDR gate, as amendment 21's s17 rerun did.
  - **Merge:** merge-stages.ts takes one rerun record per trial. So s17's rerun directory for the merge holds h-s17-r1's a1 record and h-s17-r2's a3 record, byte-identical to their sources, and merge.json lists the split.
- **s31's 7 lease-refused trials in h-s31-r1 stay lease_refused, with no rerun.** They were a real lease shortfall, not a false refusal. The reservations refused were $2.58 to $4.01, ordinary for Muse. The directory's $62.58 lease had $58.76 of real spend from 30 finished trials (mean $1.83, up to $15.70). At the refusals about $3.80 was left, and the 7 trials would have needed about $12.80 at that mean. Two made no request, and five had spent $0.08 to $1.66 when they were cut.
- **Order:** the GLM VMs launch first, within internal-task's 48 vCPUs. h-s17-r2 launches when a slot frees. Each launch runs the room check and a pinned probe of its provider.
- This amendment's commit differs from the one before it in this file, the s17 plan file and the code named above.

- **Addendum, 2026-11-25 03:10Z: the GLM code goes back now, and the s17 trial runs from that commit.** The ZDR gate refused h-s17-r2 at 10b027c (HE-FRONTIER-013), because the keyless install check it reads ran at 81d6e83 and the GLM row of pin.json differs. So the commit that puts the GLM pin, its pin.json row, the install-check comment and the two tests back as they were in amendment 24 comes now, not after the GLM cells. h-s17-r2 runs from it. Its code is amendment 24's, and it differs from 10b027c only in those lines and this paragraph. The GLM cells keep running from 10b027c, which their VMs already checked out. If the SiliconFlow fallback is needed, its commit reapplies the pin on top of this one.

## Amendment 26 (2026-11-25): GLM leases sized from Novita's measured cost, and one rerun of GLM trials that got no model answer

**Made by** the run's agent on 2026-11-25, on the coordinating agent's ruling of 04:31Z that day, before any results were read for analysis. Tasks, cells, attempts, effort, host and scoring don't change. The projected all-in total at completion is about $10,620, under the coordinating agent's $10,700 for this amendment and amendment 18's $11,500 stop. That is a projection, not spend to date.

- **Why:** on Novita's fp8 host, the first 10 h-s39-nv trials that reached the model cost $0.62 each at the price row's list rates (6 completed at $0.48, 4 timed out at $0.83), against the $0.10 planned. At that rate the $35 lease stops each GLM cell at about trial 60 to 70 of 156.
- **Leases:** by amendment 8's formula, 156 × $0.62 × 1.25 is $121, rounded up to $125. So s39 and s40 go from a $35 lease and $40 cap to a **$125 lease and $135 cap** (the $5 reserve plus $5). If s40's measured rate turns out higher than s39's, its lease follows the same formula in a dated line here, as long as the projection stays under $10,700.
- **How:** h-s39-nv and h-s40-nv run on at their $35 leases until they finish. Each cell then finishes in a fresh directory, h-s39-nv-b and h-s40-nv-b, with run-shard.sh --resume, the first directory's trials.jsonl as --done, and a rerun list. The directory lease is the cell lease less the spend its records already carry, so the cell never passes $125.
- **What the -nv-b directories run:** each trial the first directory recorded as lease_refused, and once each, the trials that got no model answer there (no_model_response, or infra_error with no 2xx answer recorded, which includes the 03:12Z to 03:39Z Novita 429s: "z-ai/glm-5.3 is temporarily rate-limited upstream"). If a trial gets no model answer in -nv-b too, it stays as recorded. No trial runs a third time.
- **Cost reporting:** every GLM row reports two costs, each labelled. One is the metered cost at the price row's list rates ($1.40, $4.40 and $0.26 per million tokens, which are also Novita's undiscounted rates). The other is OpenRouter's discounted bill (openrouter_cost_usd, Novita's 55% discount at the time). Cost per solve is given both ways, so it is neither understated nor overstated.
- **Code:** this commit's code is amendment 25's (10b027c), with the GLM pin on Novita, because the -nv-b directories run GLM. Against cf7f52a it differs only in those lines, the s39 and s40 plan files and this section. The commit that puts the GLM code back comes after the last GLM directory, before the results pull request.
- **Merge:** s39 takes h-s39-nv plus --rerun s39:r1=h-s39-nv-b, and s40 takes h-s40-nv plus --rerun s40:r1=h-s40-nv-b.
- **s39 lease raised (2026-11-25, on the coordinating agent's ruling of 19:21Z):** the h-s39-nv-b trials cost $1.14 each at list rates (27 trials, $30.80), about twice the first directory's rate, because the trials that the $35 lease stopped are the long ones. At that rate the $125 lease runs out near trial 79 of the 102. By the formula above (spend so far plus the remaining trials at the measured rate, times 1.15), s39 goes to a **$165 lease and $175 cap** (the cap stays $10 above the lease: the $5 reserve plus $5, as above). h-s39-nv-b's first VM ran from 671f6fd and stops at its 12 h TTL. The rest of its rerun list then runs with run-shard.sh --resume of the same directory on a fresh VM from this commit, under $165 less the spend the cell's records already carry. This commit changes only s39's plan file and this line. s40 stays at $125: it measured $0.56 a trial and is on course for about $79. The ruling also covers any later GLM cell whose measured rate outruns its lease, as long as the projected total stays under $10,700. The projection stays about $10,600, with the $11,500 stop unchanged.

## Amendment 26 close (2026-11-26): the GLM pin goes back after the last GLM directory

- **What:** runner/proxy/metering-proxy.ts, scripts/frontier-harbor/install-check.sh, scripts/frontier-harbor/pin.json and their two tests return byte-for-byte to the amendment 25 addendum commit (cf7f52a). The plan files and this file keep their amendment 26 changes. No counted directory runs from this commit or later: h-s39-nv-b and h-s40-nv-b finished at 00:33Z and 21:27Z, from 671f6fd. s39's $165 lease from 22608a7 was never used, because h-s39-nv-b recorded all 102 of its reruns on its first VM ($89.36 of its $90.51 directory lease). That makes s39's cell spend $123.84 and s40's $86.43.
- **Why:** the Novita pin is a GLM-only provider route for this run, and it stays off main.

- **Correction (2026-11-26):** the close line above was early. Under amendment 22, two h-s40-nv trials count as no_model_response: glm-pi adaptive-rejection-sampler/a1 and torch-tensor-parallelism/a1, recorded `completed` with only four 429 answers each. Amendment 26 gives each of them one rerun, which h-s40-nv-b left out by mistake. They run once in a third directory, h-s40-nv-c, as stage rerun1-a26 from 671f6fd (the commit with the GLM pin). Its --done files are h-s40-nv's and h-s40-nv-b's trials.jsonl, and its lease is $38.57, which is s40's $125 less the $86.43 its records carry. s40's merge adds --rerun s40:r2=h-s40-nv-c. s39 has no such trial: its one no-answer trial in h-s39-nv-b is a second attempt. This commit changes only this file.

## Amendment 27 (2026-11-26): how the merge and the labels are read

**Made by** the run's agent on 2026-11-26 at about 04:00Z, after every counted directory finished and before any pass rate, pair or label of the merged results was read. It changes no task, model, trial, setting or run code. It writes down four readings the plan left open, so the analysis can be checked against them.

- **The labels.** "The calls" names two Holm families per reading (superiority and the 10-point non-inferiority test) and five labels, but not which test gives which label. They are read the way particle-swap's rule reads them ([scripts/model-swap.ts](../../../scripts/model-swap.ts)), with the model and Opus 5.5 in place of the two arms:
  - **The difference test** is the two-sided cluster sign-flip p of d (model minus Opus), so one Holm family covers "better" and "behind".
  - **The non-inferiority test** is nonInferiorityP at 10 points: the bootstrap share of draws where d is at or below -10.
  - **Labels:** the difference test passes with the model ahead: "better", or "better, by less than 10" when the 95% interval's upper end is under +10. The difference test passes with Opus ahead: "within 10 points" when non-inferiority also passes, else "behind". Only non-inferiority passes: "within 10 points", plus ", no measurable difference" when the interval includes 0. Neither: "can't tell", with the smallest detectable difference at 80% power, at alpha 0.05 and at the family's first Holm step.
  - **"The more cautious one decides"** (What each result changes) is read as the reading less favourable to the model, in this order: better, better by less than 10, within 10 points with no measurable difference, within 10 points, can't tell, behind.
- **Amendment 23's class in every shard.** Amendment 23 defines provider_credit_stop for s27. The same xAI credit stop on 2026-11-21 also cut 4 s25 trials and 4 s26 trials that had started before it and so were not in amendment 20's reruns (which took only the trials that started during the stop). The class is applied to every shard: a trial with a credit-stop answer in its usage log is infra_error provider_credit_stop. This was decided after seeing that all 8 were recorded as fails (4 harness_error, 4 completed), and before any pass rate or pair was read, so the results give s25's and s26's pass rates both ways.
- **c-s01 and c-s02.** Their records were rebuilt by to-trials.ts recover, which writes no manifest.json. Each manifest is rebuilt with to-trials.ts buildManifest from the plan file the directory ran (prereg-harbor-s01.json and prereg-harbor-s02.json at 34edfa6, at runner commit f8662e6) and the directory's own tasks tree. They are committed in merge/. s02's rebuilt manifest differs from c-s02-b's in prereg_sha256, cap_usd and reserve_usd, because amendment 10 raised the reserve with the lease, so merge-stages.ts now accepts a different reserve_usd alongside --prereg-sha.
- **The merge plan** is merge/merge-plan.json, run by scripts/frontier-harbor/shootout-merge.ts. It copies every directory before merge-stages.ts reads it, so no results directory is written. Two copies are not byte-for-byte directory copies, and merge.json lists both: h-s10s18-r1 is split by cell into s10's and s18's rerun directory (amendment 24), with each copy's shard.json naming its shard, and h-s05-c-r (amendment 17) gets a shard.json naming s05. h-s17-r1's a3 record is left out, because its lease refused it and h-s17-r2 ran it again (amendment 25).
- This amendment's commit differs from the one before it in this file, merge/, analysis-spec.json, merge-stages.ts and its test, and the new scripts shootout-merge.ts and shootout.ts.
