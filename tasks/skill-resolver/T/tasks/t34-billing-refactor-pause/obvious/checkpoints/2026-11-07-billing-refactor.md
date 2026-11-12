# Billing refactor: paused 2026-11-07

**Branch:** `refactor/invoice-totals`
**Goal:** move tax and discount math out of InvoiceView into `billing/totals.py` so the API and the PDF agree on totals.

## Done

- `billing/totals.py` with `compute_totals(lines, region)` returning `Totals(subtotal, discount, tax, total)`.
- `InvoiceView` now uses `compute_totals`.
- `billing/tests/test_totals.py`: 9 cases, all passing.

## Decisions

- All money inside totals.py is integer cents; convert only at the edges (floats caused 0.01 drift on EU invoices).
- Discount is applied before tax (confirmed by finance with Hanna on 2026-11-03).

## Next steps

1. Switch `api/serializers.py` from its own `_tax()` to `compute_totals`. This should fix the 2 expected failures in `test_invoice_api.py`.
2. Change `pdf/render.py` to round once on the total instead of per line.
3. Handle the GB-NIR case (TODO at totals.py:58): GB uses 20% VAT, GB-NIR needs EU rules.

## Open questions

- Do credit notes go through `compute_totals` too? (ask Hanna)

## Gotchas

- Caching tax tables at import broke the region override in tests; it was reverted.

## Uncommitted changes

- M billing/views.py
- M billing/tests/test_invoice_api.py
- A billing/totals.py
- A billing/tests/test_totals.py
