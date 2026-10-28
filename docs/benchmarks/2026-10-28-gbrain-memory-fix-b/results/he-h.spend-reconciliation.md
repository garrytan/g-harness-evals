## Spend reconciliation: gbrain-memory-fix-2026-10b

Proxy: 1,009 priced requests, $0.67 at list price, 29,111,604 input tokens (uncached plus cache writes plus cache reads; 27,213,250 were cache reads), 322,139 output tokens; 2,762 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-28T12:41:44.924Z to 2026-10-28T14:04:46.100Z.
Cross-check: usage lines $0.67, trials.jsonl $0.67, ledger committed $0.67, ledger settled $0.67; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 1,009 | 29,111,604 | 27,213,250 | 322,139 | $0.67 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-28 | claude-haiku-5-5 | 1,009 | 29,111,604 | 27,213,250 | 322,139 | $0.67 |

