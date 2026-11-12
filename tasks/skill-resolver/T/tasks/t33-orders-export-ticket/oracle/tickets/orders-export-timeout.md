# Stream the orders CSV export so large accounts stop timing out

## Context

Enterprise accounts with more than 50k orders get a 504 when they click "Export orders as CSV". Three accounts hit it this week (Ines, #support-escalations, 2026-11-04). They depend on the export for finance work, and support has no workaround.

## Current State

- `export_orders_csv()` in `src/exports/orders_csv.py:11` loads every order for the account, writes all rows into one `io.StringIO`, and returns it in a single `HttpResponse`.
- nginx closes the request at 60s (`proxy_read_timeout 60s`, `deploy/nginx.conf`).
- The 80k-order account takes about 95s and peaks at 1.4 GB RSS (Ken's measurement, 2026-11-04).
- `tests/exports/test_orders_csv.py` only covers a 3-order account.

## Proposed Change

Stream the response. URL, button, columns, header row and filename stay the same.

### Implementation Details

- Iterate with `Order.objects.filter(account=acct).order_by("created_at").iterator(chunk_size=2000)`.
- A generator yields the header row, then one CSV line per order, each produced by `csv.writer` over a small reusable buffer.
- Return `StreamingHttpResponse(generator, content_type="text/csv")` with the same `Content-Disposition: attachment; filename="orders.csv"`.
- Keep `COLUMNS` and the row order exactly as they are; finance macros depend on them.

## Acceptance Criteria

1. An account with 80,000 orders gets a 200 and a complete file through nginx (no 504). Card: protects=a complete export for large accounts; fails_when=the response is not streamed and the request passes 60s; no_claim=real nginx timing (test uses the Django client).
2. The first bytes are sent in under 1s for that account. Card: protects=time to first byte; fails_when=rows are built in memory before the response starts; no_claim=production network latency.
3. Peak memory during the export stays under 200 MB. Card: protects=bounded memory; fails_when=all rows are held at once; no_claim=memory of the database driver itself.
4. The header row and column order are byte-identical to today's. Card: protects=the finance macros' input format; fails_when=a column is added, removed or reordered; no_claim=none beyond protects.
5. No degradation of existing functionality: the 3-order test still passes unchanged.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | the row generator yields header plus one line per order, in created_at order | +2 |
| Integration | 5,000-order account through the view: 200, streaming response, full row count | +1 |
| Integration | header row equals today's exact string | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the protects / fails_when / no_claim profile of each test. Never "make the tests pass".
2. Real code and real tests land in the same change; no placeholder or deferred test.
3. Any change to a test, timeout, threshold or snapshot is reported on its own line with its justification, before any other result.
4. A reported command names the command and its observed result; a command you did not run is not reported.
5. Your report is a claim until it is re-run: say what you verified and what you could not check.

## Rollback Plan

Revert the PR. The URL and output format do not change, so no client or data migration is involved.

## Effort Estimate

1h generator and view + 2h tests (including the 5,000-order fixture) + 1h checking through nginx on staging = about 4h.

## Files Reference

| File | Change |
|---|---|
| `src/exports/orders_csv.py:11` | replace the in-memory build with a streaming generator |
| `tests/exports/test_orders_csv.py` | add the large-account, header and generator tests |
| `deploy/nginx.conf` | no change (60s timeout stays) |

## Out of Scope

- Async exports delivered by email (Priya: a bigger project, not this sprint).
- Changing the button, URL, columns or filename.

## Related

- #support-escalations thread, 2026-11-04
