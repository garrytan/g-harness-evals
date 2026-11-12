# Plan: move subscriptions to Stripe Billing

Today a nightly cron job (billing/charge_job.py) charges every customer whose renewal date is today, using stored card tokens through Stripe's PaymentIntents API. It has grown hard to change.

Plan:

1. Create a Stripe Product and Price for each of our 4 plans.
2. Create a Stripe Subscription for each of our 3,200 active customers.
3. Turn off the cron job.
4. Listen to Stripe webhooks to update our `accounts` table.

Target: done by the end of the month.
