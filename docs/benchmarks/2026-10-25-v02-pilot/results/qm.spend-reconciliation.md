## Spend reconciliation: v02-pilot-2026-10

Proxy: 429 priced requests, $0.21 at list price, 7,728,740 input tokens (uncached plus cache writes plus cache reads; 6,977,768 were cache reads), 93,481 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-25T07:19:51.384Z to 2026-10-25T07:44:17.446Z.
Cross-check: usage lines $0.21, trials.jsonl $0.21, ledger committed $0.21, ledger settled $0.21; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 429 | 7,728,740 | 6,977,768 | 93,481 | $0.21 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 429 | 7,728,740 | 6,977,768 | 93,481 | $0.21 |

