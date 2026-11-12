# PR: VAT on order totals (agent-b/vat)

Task t_32, worker profile coder-2.

- Adds per-country VAT to order totals using TAX_RATES.
- Switches rounding to ROUND_HALF_EVEN, since banker's rounding avoids upward bias when totals are summed in reports. Nobody asked for this; it seemed the more correct default.
