# #support-escalations, 2026-11-04

**Ines (support):** Three enterprise accounts this week say "Export orders as CSV" spins and then shows a 504. All three have over 50k orders. Smaller accounts are fine.

**Ken (backend):** Looked at it. `export_orders_csv()` in src/exports/orders_csv.py runs `Order.objects.filter(account=acct)` with no limit, builds every row into one big string in memory, and returns it in a single response. nginx cuts the request at 60s (`proxy_read_timeout 60s` in deploy/nginx.conf). For the 80k-order account the query plus string building takes about 95s and peaks at 1.4 GB RSS.

**Ken:** Fix I'd do: stream it. Iterate with `.iterator(chunk_size=2000)`, write rows through `csv.writer` into a generator, return a `StreamingHttpResponse`. First bytes go out in under a second so nginx never times out. Keep the same columns and header row, finance has macros that depend on the order.

**Ines:** Can we keep the button the same? Customers are used to it.

**Ken:** Yes, URL and button stay, only the response changes. Tests are in tests/exports/test_orders_csv.py, they only cover a 3-order account right now.

**Priya (eng manager):** Fine to do this sprint. Not doing async email exports now, that's a bigger project.
