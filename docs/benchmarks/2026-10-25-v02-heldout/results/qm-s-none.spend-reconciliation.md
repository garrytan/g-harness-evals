## Spend reconciliation: v02-heldout-2026-10

Proxy: 690 priced requests, $6.12 at list price, 12,846,243 input tokens (uncached plus cache writes plus cache reads; 11,627,671 were cache reads), 93,378 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T00:36:16.542Z to 2026-10-26T01:15:37.121Z.
Cross-check: usage lines $6.12, trials.jsonl $6.12, ledger committed $6.12, ledger settled $6.12; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-haiku-5-5 | 150 | 231,085 | 178,314 | 2,952 | $0.01 |
| 2026-10-26 | claude-sonnet-5-5 | 540 | 12,615,158 | 11,449,357 | 90,426 | $6.11 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 150 | 231,085 | 178,314 | 2,952 | $0.01 |
| 2026-10-25 | claude-sonnet-5-5 | 540 | 12,615,158 | 11,449,357 | 90,426 | $6.11 |

