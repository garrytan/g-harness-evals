## Spend reconciliation: gbrain-memory-2026-10

Proxy: 711 priced requests, $15.20 at list price, 23,854,187 input tokens (uncached plus cache writes plus cache reads; 20,164,346 were cache reads), 194,009 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T22:05:22.486Z to 2026-10-27T00:03:08.665Z.
Cross-check: usage lines $15.20, trials.jsonl $15.20, ledger committed $15.20, ledger settled $15.20; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-sonnet-5-5 | 693 | 23,151,909 | 19,582,250 | 187,653 | $14.72 |
| 2026-10-27 | claude-sonnet-5-5 | 18 | 702,278 | 582,096 | 6,356 | $0.48 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-sonnet-5-5 | 711 | 23,854,187 | 20,164,346 | 194,009 | $15.20 |

