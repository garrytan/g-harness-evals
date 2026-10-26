## Spend reconciliation: v02-heldout-2026-10

Proxy: 1,370 priced requests, $0.85 at list price, 33,021,134 input tokens (uncached plus cache writes plus cache reads; 30,019,491 were cache reads), 352,713 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T01:18:56.917Z to 2026-10-26T02:48:58.598Z.
Cross-check: usage lines $0.85, trials.jsonl $0.85, ledger committed $0.85, ledger settled $0.85; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-haiku-5-5 | 1,370 | 33,021,134 | 30,019,491 | 352,713 | $0.85 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 1,370 | 33,021,134 | 30,019,491 | 352,713 | $0.85 |

