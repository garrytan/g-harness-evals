## Spend reconciliation: v02-heldout-2026-10

Proxy: 1,522 priced requests, $1.54 at list price, 48,396,006 input tokens (uncached plus cache writes plus cache reads; 41,828,732 were cache reads), 592,804 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T00:35:52.595Z to 2026-10-26T04:56:28.586Z.
Cross-check: usage lines $1.54, trials.jsonl $1.53, ledger committed $1.97, ledger settled $1.54; largest difference $0.44 (NOT consistent: a view disagrees by more than a cent; compare the per-trial usage.json files with the usage lines for that run).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-haiku-5-5 | 1,522 | 48,396,006 | 41,828,732 | 592,804 | $1.54 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 1,522 | 48,396,006 | 41,828,732 | 592,804 | $1.54 |

