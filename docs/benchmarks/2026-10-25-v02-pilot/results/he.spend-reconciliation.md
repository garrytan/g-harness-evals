## Spend reconciliation: v02-pilot-2026-10

Proxy: 562 priced requests, $0.37 at list price, 15,309,340 input tokens (uncached plus cache writes plus cache reads; 14,375,212 were cache reads), 211,526 output tokens; 1,332 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-25T07:19:55.299Z to 2026-10-25T08:00:32.016Z.
Cross-check: usage lines $0.37, trials.jsonl $0.37, ledger committed $0.37, ledger settled $0.37; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 562 | 15,309,340 | 14,375,212 | 211,526 | $0.37 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 562 | 15,309,340 | 14,375,212 | 211,526 | $0.37 |

