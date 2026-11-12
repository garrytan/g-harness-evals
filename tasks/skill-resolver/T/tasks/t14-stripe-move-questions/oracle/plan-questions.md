# Stripe Billing migration: questions before any code

Facts I looked up instead of asking (billing/charge_job.py):

- Renewals are charged at 02:00 UTC by cron, monthly or yearly per account.
- Mid-cycle upgrades are prorated by our own code (`prorated_upgrade_pence`).
- Failed charges retry after 1, 3 and 7 days (`RETRY_DAYS`).
- Charges use stored card tokens in GBP.

The plan is a design tree; these are the decisions nothing else depends on. Questions that hang off them wait for a later round.

## Round 1

❓ Q1 - Cutover: do all 3,200 customers move on one night, or does each customer move at their own next renewal date?
➡️ Recommendation: move each customer at their next renewal. No one is charged twice or skipped, and a bad batch affects a few customers, not all.

❓ Q2 - Source of truth: after the move, is Stripe or our `accounts` table the record of a customer's plan and renewal date?
➡️ Recommendation: Stripe, with `accounts` updated only from webhooks. Two writers is how the cron job got hard to change.

❓ Q3 - Card tokens: can the existing stored card tokens be attached to Stripe Customers as default payment methods, or do some customers need to re-enter cards?
➡️ Recommendation: check whether every token is already a Stripe PaymentMethod before planning anything else; if they are, no customer action is needed.

❓ Q4 - Rollback: if webhooks or charges misbehave in the first week, can the cron job be turned back on for migrated customers?
➡️ Recommendation: keep charge_job.py deployable but skipping migrated accounts (a `billing_source` flag), so rollback is a flag flip.

❓ Q5 - Deadline: is "end of the month" fixed by something external, such as a contract or a price change?
➡️ Recommendation: if not, drop it; a renewal-date migration naturally takes one full billing cycle, so up to a year for annual plans.

## Waiting for round 2 (depends on round 1)

- How mid-cycle upgrades are prorated in Stripe versus our own `prorated_upgrade_pence` (depends on Q1 and Q2).
- Whether Stripe's Smart Retries replace the 1, 3, 7 day schedule (depends on Q2).
- Which webhooks we must handle and how we make them idempotent (depends on Q2 and Q4).
- How annual customers are handled if the deadline stays (depends on Q1 and Q5).

Answer round 1 and I'll recompute the next round. No code until every branch is settled and we agree on the summary.
