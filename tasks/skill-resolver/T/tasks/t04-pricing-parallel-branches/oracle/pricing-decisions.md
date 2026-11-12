# Merge notes: agent-a/coupon x agent-b/vat

Arbiter: neither side's worker. Both intents were read from the PR descriptions in notes/ before any edit.

- Side A (HEAD, agent-a/coupon): add the WELCOME10 coupon, and round halves up so receipts match the tills (a finance requirement).
- Side B (MERGE_HEAD, agent-b/vat): add per-country VAT to order totals; prefers banker's rounding as a general default, unrequested.

## Hunk decisions

- src/pricing.py:10-15 (to_cents) - same-question-different-answer - kept side A - Design question: how do totals round to the penny? Answer picked: ROUND_HALF_UP, because side A's choice serves a stated requirement (receipts must match the tills) and side B's is a preference nobody asked for. Veto here if finance has changed its mind.
- src/pricing.py:18-37, sub-decision 1 (order_total signature) - disjoint-intent - kept both - the function now takes country (B) and an optional coupon (A).
- src/pricing.py:18-37, sub-decision 2 (apply_coupon and add_vat) - disjoint-intent - kept both - the coupon and VAT serve different goals and coexist.
- src/pricing.py:18-37, sub-decision 3 (order of coupon and VAT) - same-question-different-answer - picked coupon first, then VAT, then one rounding step. Neither side stated an order; a coupon is a price reduction, so VAT is charged on the discounted price. Flagged for a human to confirm.

Nothing outside the conflict markers was changed. ROUND_HALF_EVEN is now an unused import; it sits outside the conflicted regions, so it is left for a follow-up.
