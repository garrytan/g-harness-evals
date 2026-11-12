# Merge notes: pricing.py

## What I kept

- **Both features.** The WELCOME10 coupon (agent A) and per-country VAT (agent B) don't interfere, so order_total now takes both a country and an optional coupon. The coupon is applied to the subtotal first and VAT is charged on the discounted amount, which is the usual order for a discount.
- **Rounding: ROUND_HALF_UP (agent A).** Agent A switched to half-up because finance needs receipts to match the shop tills, and there were complaints about 1p differences. Agent B's switch to banker's rounding was a general preference, so the finance requirement wins.

## Follow-ups

- ROUND_HALF_EVEN is no longer used and can be removed from the import.
- Worth adding a test for a coupon plus VAT order, for example two items at 9.99 in GB with WELCOME10.
