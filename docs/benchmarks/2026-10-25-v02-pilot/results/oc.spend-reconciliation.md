## Spend reconciliation: v02-pilot-2026-10

Proxy: 508 priced requests, $0.47 at list price, 16,206,802 input tokens (uncached plus cache writes plus cache reads; 14,290,615 were cache reads), 170,191 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-25T07:21:33.762Z to 2026-10-25T08:24:42.796Z.
Cross-check: usage lines $0.47, trials.jsonl $0.47, ledger committed $0.47, ledger settled $0.47; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 508 | 16,206,802 | 14,290,615 | 170,191 | $0.47 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 508 | 16,206,802 | 14,290,615 | 170,191 | $0.47 |

