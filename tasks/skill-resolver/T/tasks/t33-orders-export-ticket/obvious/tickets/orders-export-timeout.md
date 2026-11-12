# Orders CSV export times out for large accounts

## Summary

"Export orders as CSV" returns a 504 for accounts with more than about 50k orders. Three enterprise accounts reported it this week. The fix is to stream the CSV instead of building it in memory.

## Background

- `export_orders_csv()` in src/exports/orders_csv.py loads every order for the account, writes all rows into one in-memory string, and returns it in one response.
- nginx closes requests after 60 seconds (`proxy_read_timeout 60s` in deploy/nginx.conf).
- For the 80k-order account this takes about 95 seconds and 1.4 GB of memory, so nginx gives up first.

## Proposed fix

1. Query with `.iterator(chunk_size=2000)` so rows are not all loaded at once.
2. Write each row with `csv.writer` inside a generator.
3. Return a `StreamingHttpResponse` with the same content type and `Content-Disposition` header.

Keep the URL, the button, the column list and the header row exactly as they are; finance has macros that depend on the column order.

## Acceptance criteria

- [ ] An account with 80,000 orders downloads a complete CSV through nginx with no 504.
- [ ] The response starts sending data within 1 second.
- [ ] Memory use during the export stays under 200 MB.
- [ ] The header row and column order are unchanged.
- [ ] The existing 3-order test still passes.

## Tests to add

- Generator unit test: header plus one line per order, ordered by created_at.
- Integration test with a 5,000-order account: 200, streaming response, correct row count.
- Header row matches the current string exactly.

## Out of scope

- Emailing exports asynchronously (agreed with Priya as a later project).
- Any change to the UI.

## Notes for whoever picks this up

Everything you need is above; the existing test lives in tests/exports/test_orders_csv.py. Check the change through nginx on staging before merging.
