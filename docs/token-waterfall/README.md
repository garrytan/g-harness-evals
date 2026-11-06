# Token waterfall

**Where an agent harness's money goes, split two ways: by how the provider bills each token, and by what each request carried.** The split is per request, then per user turn, per trial and per harness. It is built for a frontier run on Opus 5.5 and GPT-6.1 Sol. Those results come from a later run and are not on this page yet.

## The two axes

- **Billing classes: what the provider charges for.** Every request's dollars split into:
  - **uncached input**: prompt tokens billed at the full input rate;
  - **cache read**: prompt tokens served from the provider's prompt cache, billed at a small fraction of the input rate;
  - **cache write, 5 minutes and 1 hour**: prompt tokens stored in the cache for later requests, billed above the input rate (1.25x for 5 minutes, 2x for 1 hour on Anthropic);
  - **output**: the reply, with reasoning tokens included;
  - and, when they occur, **embeddings**, **failed** requests that kept their reservation, and **unknown** dollars (a request charged its reservation because the provider reported no usage).
- **The classes add up to the receipt.** For every trial, the summed classes equal the `usd` its `trials.jsonl` row records, to within $0.000001, or the miner fails.
- **Content sections: what the request body holds.** Every request body splits into system prompt, tool schemas, user text, tool results, assistant text, tool calls, opaque blocks (thinking, signatures, encrypted reasoning), media, and "other" (JSON framing, settings, keys). The sections add up to the body's bytes. They become tokens only through a calibration table of tokens per byte per model. Sections the table has no rate for (always "other") stay in bytes under `uncalibrated_bytes`, so `tokens` covers only the rated sections, and the content chart stays in bytes unless every section is rated.
- **Content sections need the proxy to log them.** The metering proxy writes them with `--log-sections` (sizes and digests only, never request or response text). Receipts from earlier runs have billing classes but no sections.

## What the miner flags

With sections, [scripts/waterfall/mine.ts](../../scripts/waterfall/mine.ts) counts six patterns that often signal waste. **"Avoidable-looking" is a pattern, not proof** that a different harness could have skipped the spend.

- **Cache misses on a repeated prefix**: a request repeats history an earlier request cached less than five minutes before, but reads less from the cache.
- **Cache writes never read**: no later request in the same conversation reads the written prefix before it expires.
- **Schemas of tools never called**: tool definitions sent on every request for tools the trial never used.
- **Tool results sent again**: the same tool output sent again at another place in the conversation, or in a request that does not carry the earlier history, counted each time. Plain history replay on a stateless API does not count.
- **Retries**: a request with exactly the same history as the one before it.
- **Side calls**: requests outside the main conversation of their user turn.

Requests that fall outside every user turn's time window go to an **out of turn** bucket. That label is about timing only, not purpose.

## Tools

- [scripts/waterfall/mine.ts](../../scripts/waterfall/mine.ts): billing classes and content sections per request, turn, trial and cell, from a manifest of hashed receipts.
- [scripts/waterfall/contrasts.ts](../../scripts/waterfall/contrasts.ts): paired dollars per trial and dollars per success between two cells on one model, task-clustered, with the pass-rate difference beside it.
- [scripts/waterfall/chart.ts](../../scripts/waterfall/chart.ts): plain SVG waterfalls, growth lines and avoidable-looking bars.
- [scripts/waterfall/calibrate.ts](../../scripts/waterfall/calibrate.ts): the tokens-per-byte table for each section type, measured from anatomy capture logs through Anthropic's free count_tokens route; `mine.ts` can take its output as the calibration table.
- [scripts/anatomy/cost-split.ts](../../scripts/anatomy/cost-split.ts): the per-request billing split both scripts use, at the proxy's own list prices.

The inputs for a secondary appendix (the host-harness dev pilot on Haiku and gpt-6-luna, billing classes only) are listed in [appendix-manifest.json](data/appendix-manifest.json). Its numbers, and the frontier results, arrive with the frontier run's report.

## Changelog

- **2026-10-31:** New page. Explains the two axes (billing classes and content sections), lists the avoidable-looking patterns and the tools, and names the inputs of a secondary appendix. Results come with the frontier run.
