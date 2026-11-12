# Cleanup pass: src/report_export.py (dry run, nothing applied)

Scope: the new file src/report_export.py, read against src/utils/formatting.py and src/models.py. Single-pass inline review: the four reviewer angles (reuse, quality, efficiency, altitude) were worked through one after another here, not as a parallel fan-out. Nothing was edited; say which tiers to apply.

Format: file:line -> problem -> cost -> suggested fix | confidence | risk

## SAFE (proven not to change behavior)
- [quality] report_export.py:3-4 -> `json` and `os` are imported and never used -> noise, lint failures -> delete both imports | confidence: high | risk: SAFE
- [quality] report_export.py:50-51 -> commented-out `include_raw` branch -> dead code a reader has to reason about -> delete it (git keeps it) | confidence: high | risk: SAFE
- [quality] report_export.py:21-22 -> `load_invoices` only calls `export_rows` -> pass-through wrapper, two names for one thing -> call `export_rows` directly and drop `load_invoices` | confidence: high | risk: SAFE

## CAREFUL (same behavior, verify with tests)
- [reuse] report_export.py:11-14 -> `_money` re-implements `format_money` in src/utils/formatting.py (same quantize and ROUND_HALF_UP) -> two places to change when finance changes rounding -> use `format_money` | confidence: high | risk: CAREFUL
- [reuse] report_export.py:17-18 -> `_date` duplicates `iso_date` in src/utils/formatting.py -> duplicated helper -> use `iso_date` | confidence: high | risk: CAREFUL
- [quality] report_export.py:44 -> `include_raw` and `currency_suffix` are accepted and ignored -> parameter sprawl; callers think they do something -> remove them, or implement them if a caller needs them | confidence: medium | risk: CAREFUL
- [quality] report_export.py:39 -> `total_raw` is computed for every row and never written -> redundant state -> drop the key | confidence: high | risk: CAREFUL

## RISKY (may change behavior; flag for review, do not auto-apply)
- [efficiency] report_export.py:30 -> `session.query(Customer).get(...)` inside the loop is one query per invoice (N+1) -> about 1,400 extra queries for a month of invoices -> load customers with the invoices (`joinedload(Invoice.customer)`, or `inv.customer` with eager loading) and the lines with `selectinload(Invoice.lines)` | confidence: high | risk: RISKY (query shape changes)
- [altitude] report_export.py:31-33 -> the export sums invoice lines itself -> a band-aid: the invoice total is business logic and will drift from what the invoice PDF shows -> give `Invoice` one `total` (property or column) and use it here and in the PDF; touches shared model code, so a follow-up PR is fine | confidence: medium | risk: RISKY

## Skipped
- Renaming `r` in the CSV loop: style only.
