# Questions about the Stripe Billing migration plan

Things to settle before anyone writes code. From the plan and billing/charge_job.py.

## Cutover

1. Will all 3,200 customers move on one night, or in batches? What happens to someone whose renewal is due the night we switch?
2. How do we make sure no customer is charged by both the cron job and Stripe, or by neither?
3. Is the end-of-month deadline fixed by anything external?

## Data and cards

4. Can our stored card tokens be attached to Stripe Customers directly, or will some customers have to re-enter their card?
5. After the move, which is the source of truth for plan and renewal date: Stripe or our `accounts` table?
6. How do annual customers move mid-term without being charged early?

## Behaviour we already have

7. charge_job.py prorates mid-cycle upgrades itself (`prorated_upgrade_pence`). Will Stripe's proration give the same amounts?
8. Failed charges retry after 1, 3 and 7 days. Do we keep that schedule or switch to Stripe's retry settings?

## Webhooks

9. Which webhook events do we need (invoice paid, payment failed, subscription updated or deleted)?
10. How do we handle duplicate or out-of-order webhook deliveries?

## Rollback and testing

11. If something goes wrong in the first week, how do we roll back for customers already moved?
12. Will we run the migration in Stripe test mode with a copy of production data first?
