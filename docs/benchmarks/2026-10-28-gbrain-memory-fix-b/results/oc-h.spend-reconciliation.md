## Spend reconciliation: gbrain-memory-fix-2026-10b

Proxy: 705 priced requests, $0.63 at list price, 20,578,131 input tokens (uncached plus cache writes plus cache reads; 17,758,222 were cache reads), 207,741 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-28T12:44:31.062Z to 2026-10-28T14:43:36.204Z.
Cross-check: usage lines $0.63, trials.jsonl $0.63, ledger committed $0.63, ledger settled $0.63; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 705 | 20,578,131 | 17,758,222 | 207,741 | $0.63 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 705 | 20,578,131 | 17,758,222 | 207,741 | $0.63 |

