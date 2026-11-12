---
status: in-progress
branch: refactor/invoice-totals
timestamp: 2026-11-07T16:30:12-08:00
files_modified:
  - billing/views.py
  - billing/tests/test_invoice_api.py
  - billing/totals.py
  - billing/tests/test_totals.py
---

## Working on: billing invoice totals refactor

### Summary

Moving tax and discount math out of InvoiceView into billing/totals.py so the API and the PDF produce the same totals. compute_totals() exists and InvoiceView uses it; the API serializer and the PDF renderer still have their own math.

### Decisions Made

- Money is integer cents everywhere inside totals.py, converted only at the edges: floats drifted by 0.01 on EU invoices.
- Discount applies before tax, as finance confirmed with Hanna on 2026-11-03.

### Remaining Work

1. Open. Switch api/serializers.py from its own `_tax()` copy to `compute_totals`; this should fix the 2 expected failures in test_invoice_api.py. (SCRATCH.md)
2. Open. Make pdf/render.py round once on the total instead of per line. (SCRATCH.md)
3. Open. Resolve the GB-NIR TODO at totals.py:58: it needs EU rules, while GB uses 20% VAT. (SCRATCH.md)
4. Open. Ask Hanna whether credit notes go through compute_totals too. (SCRATCH.md)

### Notes

- test_totals.py: 9 cases, all green. test_invoice_api.py: 2 failures, expected until the serializer switch.
- Caching tax tables at import broke the region override in tests and was reverted; do not retry it without fixing the override.
