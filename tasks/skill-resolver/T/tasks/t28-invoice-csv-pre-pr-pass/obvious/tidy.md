# Suggestions for src/report_export.py

Overall the export reads fine and the logic is easy to follow. Things worth tidying before the PR:

## Quick wins
- Remove the unused imports `json` and `os`.
- Delete the commented-out `include_raw` block in `export_csv`; it's in git history if you need it.
- `load_invoices` just returns `export_rows(month)`. Drop the wrapper and call `export_rows` directly.

## Worth doing in this PR
- `_money` duplicates `format_money` from `src/utils/formatting.py` (same quantize and rounding). Import and use `format_money` so rounding lives in one place.
- `_date` duplicates `iso_date` from the same module. Use `iso_date`.
- `export_csv` takes `include_raw` and `currency_suffix` but never uses them. Remove them (or implement them) so callers aren't misled.
- `total_raw` is computed for each row but never written. Drop it.

## Bigger changes (discuss first)
- **N+1 queries:** `session.query(Customer).get(inv.customer_id)` runs once per invoice. Use `joinedload(Invoice.customer)` and `selectinload(Invoice.lines)` on the invoice query instead; this changes the query shape, so check it against real data.
- **Where the total lives:** summing `inv.lines` here means the export and the invoice PDF can disagree. Consider an `Invoice.total` property used by both.

I haven't changed any code.
