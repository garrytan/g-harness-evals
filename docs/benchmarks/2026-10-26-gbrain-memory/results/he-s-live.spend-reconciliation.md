## Spend reconciliation: gbrain-memory-2026-10

Proxy: 876 priced requests, $13.58 at list price, 27,973,468 input tokens (uncached plus cache writes plus cache reads; 25,564,106 were cache reads), 244,162 output tokens; 2,220 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T23:23:08.042Z to 2026-10-27T00:42:38.468Z.
Cross-check: usage lines $13.58, trials.jsonl $13.58, ledger committed $13.58, ledger settled $13.58; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-sonnet-5-5 | 437 | 14,379,879 | 13,158,153 | 113,698 | $6.82 |
| 2026-10-27 | claude-sonnet-5-5 | 439 | 13,593,589 | 12,405,953 | 130,464 | $6.75 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-sonnet-5-5 | 876 | 27,973,468 | 25,564,106 | 244,162 | $13.58 |

