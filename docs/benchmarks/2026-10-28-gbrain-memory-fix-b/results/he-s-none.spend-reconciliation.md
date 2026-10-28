## Spend reconciliation: gbrain-memory-fix-2026-10b

Proxy: 485 priced requests, $5.20 at list price, 12,844,840 input tokens (uncached plus cache writes plus cache reads; 12,092,213 were cache reads), 90,096 output tokens; 1,380 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-28T12:38:12.632Z to 2026-10-28T13:16:55.624Z.
Cross-check: usage lines $5.20, trials.jsonl $5.20, ledger committed $5.20, ledger settled $5.20; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-sonnet-5-5 | 485 | 12,844,840 | 12,092,213 | 90,096 | $5.20 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-sonnet-5-5 | 485 | 12,844,840 | 12,092,213 | 90,096 | $5.20 |

