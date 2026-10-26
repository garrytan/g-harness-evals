## Spend reconciliation: v02-heldout-2026-10

Proxy: 604 priced requests, $7.52 at list price, 17,966,993 input tokens (uncached plus cache writes plus cache reads; 16,559,746 were cache reads), 89,951 output tokens; 0 refused, 0 forwarded 4xx at $0, 0 failed. From 2026-10-26T00:35:58.359Z to 2026-10-26T01:11:01.874Z.
Cross-check: usage lines $7.52, trials.jsonl $7.52, ledger committed $7.52, ledger settled $7.52; largest difference $0.00 (consistent).

Provider (not_performed): not performed: needs an Anthropic Admin API key (Admin API usage and cost read access) in ANTHROPIC_ADMIN_KEY; the proxy's ANTHROPIC_API_KEY is a user key and the Admin API answers 401 to it. The per-day sheet in this file is what to check against the console's Usage page (filter by the proxy's API key and these UTC days) until then

### By UTC day (the Admin API's buckets)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-26 | claude-haiku-5-5 | 150 | 249,775 | 199,340 | 5,753 | $0.01 |
| 2026-10-26 | claude-sonnet-5-5 | 454 | 17,717,218 | 16,360,406 | 84,198 | $7.51 |

### By local day, America/Los_Angeles (the console as a viewer there sees it)

| Day | Model | Requests | Input tokens (uncached + cache writes + cache reads) | of which cache reads | Output tokens | USD (list) |
|---|---|---|---|---|---|---|
| 2026-10-25 | claude-haiku-5-5 | 150 | 249,775 | 199,340 | 5,753 | $0.01 |
| 2026-10-25 | claude-sonnet-5-5 | 454 | 17,717,218 | 16,360,406 | 84,198 | $7.51 |

