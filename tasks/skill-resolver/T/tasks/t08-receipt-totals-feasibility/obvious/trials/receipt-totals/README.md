# Receipt totals: quick feasibility check

## What I tried

`extract.py` looks for a line that starts with "total" or "amount due" (ignoring "Total savings"), takes the last match, and treats commas as decimal points. Run it with `python extract.py ../../samples`.

## Results

| Sample | Expected | Got |
|---|---|---|
| receipt-1.txt | 9.60 | 9.60 |
| receipt-2.txt | 23.45 | 23.45 |
| receipt-3.txt | 41.80 | 41.80 |
| receipt-4.txt | 18.20 | not found |

## Is it worth it?

Mostly yes. Simple patterns handle clean dumps, the "Total savings" trap and German comma decimals. They fail on noisy OCR such as "T0TAL 18.2O" in receipt-4.

## Things to watch

- OCR swaps letters and digits (0/O, 1/l). Normalising those on the total line should recover most of these.
- receipt-2's items add up to 9.45, not 23.45, so the dump may be incomplete; don't cross-check totals against items.
- Currency symbols are inconsistent.

## Suggested next step

Use pattern matching first and fall back to the vendor's paid receipt API only when no total is found. Test on 50 or more real receipts before committing.
