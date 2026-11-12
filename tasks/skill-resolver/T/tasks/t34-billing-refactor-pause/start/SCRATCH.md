scratch, billing refactor (refactor/invoice-totals)

- goal: move tax + discount math out of InvoiceView into billing/totals.py so the API and the PDF agree
- DONE: totals.py with compute_totals(lines, region) -> Totals(subtotal, discount, tax, total)
- DONE: InvoiceView uses compute_totals
- decided: money as integer cents everywhere in totals.py, convert at the edges. floats gave 0.01 drift on EU invoices
- decided: discount applies BEFORE tax (matches what finance confirmed with Hanna on 11/03)
- NOT done: api/serializers.py still has its own _tax() copy -> switch to compute_totals
- NOT done: pdf/render.py still rounds per line, should round once on the total
- tests: test_totals.py has 9 cases, all green. test_invoice_api.py has 2 failures, expected until serializers switch
- careful: region "GB" uses VAT 20% but "GB-NIR" needs EU rules, there's a TODO in totals.py:58
- tried caching tax tables at import, broke the region override in tests, reverted
- question for Hanna: do credit notes go through compute_totals too?
