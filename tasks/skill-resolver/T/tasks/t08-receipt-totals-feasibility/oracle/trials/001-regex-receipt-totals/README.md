# 001: regex-receipt-totals

**Question (Given/When/Then):** Given an OCR text dump of a receipt, when `extract.py` scans it with one regex for TOTAL or AMOUNT DUE lines, then it returns the amount the customer paid.

**Why it matters:** if regexes are enough, the importer needs no paid structured receipt API (GBP 0.04 per receipt). Risk: OCR noise and non-UK formats break simple patterns.

## Approach

- One regex for a line starting with "total" or "amount due", skipping "Total savings", taking the last match in the dump.
- Commas are treated as decimal points (German receipts).
- No libraries, everything hardcoded. Run: `python extract.py ../../samples`

## Results

| Sample | Expected | Got | OK |
|---|---|---|---|
| receipt-1.txt (cafe, SUBTOTAL and TOTAL lines) | 9.60 | 9.60 | yes |
| receipt-2.txt (supermarket, "Total savings" trap) | 23.45 | 23.45 | yes |
| receipt-3.txt (Berlin hotel, "AMOUNT DUE EUR 41,80") | 41.80 | 41.80 | yes |
| receipt-4.txt (noisy OCR, "T0TAL 18.2O") | 18.20 | None | no |

## Verdict: PARTIAL

Regexes find the total on clean dumps, including the savings trap and comma decimals, but not when OCR swaps letters and digits.

### What worked
- 3 of 4 samples correct with one pattern.
- Taking the last match avoided picking SUBTOTAL; the negative lookahead avoided "Total savings".

### What didn't
- receipt-4: "T0TAL" (zero for O) and "18.2O" (letter O for zero) defeat the pattern.

### Surprises
- receipt-2's item lines add up to 9.45, not 23.45. Either the dump is truncated or lines are missing, so we cannot cross-check totals against items.
- The currency is not always next to the total (receipt-2 uses "£", receipt-3 "EUR", the others none).

### Recommendation for the real build
- Use regexes as the first pass, and send any receipt with no match to the paid API or to a person, instead of paying for every receipt.
- Normalise common OCR swaps (0/O, 1/l, 4/A) on the TOTAL line before matching; test that on a larger sample set.
- Do not rely on item lines summing to the total.
