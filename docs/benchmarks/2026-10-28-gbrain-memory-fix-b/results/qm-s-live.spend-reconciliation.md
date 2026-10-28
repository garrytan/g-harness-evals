## Spend reconciliation: gbrain-memory-fix-2026-10b

Proxy: 298 priced requests, $3.60 at list price, 7,907,168 input tokens (uncached plus cache writes plus cache reads; 7,129,510 were cache reads), 33,865 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-28T12:41:01.746Z to 2026-10-28T13:06:28.416Z.
Cross-check: usage lines $3.60, trials.jsonl $3.60, ledger committed $3.60, ledger settled $3.60; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 85 | 140,685 | 112,276 | 2,404 | $0.01 |
| 2026-10-28 | claude-sonnet-5-5 | 213 | 7,766,483 | 7,017,234 | 31,461 | $3.59 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 85 | 140,685 | 112,276 | 2,404 | $0.01 |
| 2026-10-28 | claude-sonnet-5-5 | 213 | 7,766,483 | 7,017,234 | 31,461 | $3.59 |

