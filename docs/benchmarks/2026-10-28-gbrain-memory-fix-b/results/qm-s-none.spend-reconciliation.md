## Spend reconciliation: gbrain-memory-fix-2026-10b

Proxy: 366 priced requests, $2.99 at list price, 6,639,163 input tokens (uncached plus cache writes plus cache reads; 6,024,303 were cache reads), 35,640 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-28T12:37:00.484Z to 2026-10-28T12:59:47.042Z.
Cross-check: usage lines $2.99, trials.jsonl $2.99, ledger committed $2.99, ledger settled $2.99; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 85 | 130,620 | 104,224 | 2,324 | $0.01 |
| 2026-10-28 | claude-sonnet-5-5 | 281 | 6,508,543 | 5,920,079 | 33,316 | $2.99 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 85 | 130,620 | 104,224 | 2,324 | $0.01 |
| 2026-10-28 | claude-sonnet-5-5 | 281 | 6,508,543 | 5,920,079 | 33,316 | $2.99 |

