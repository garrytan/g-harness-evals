"""Nightly renewal charges. Runs at 02:00 UTC from cron."""

import datetime

from billing import db, stripe_client

RETRY_DAYS = [1, 3, 7]


def run(today: datetime.date) -> None:
    for account in db.accounts_due(today):
        amount = account.plan_price_pence
        if account.pending_upgrade:
            amount += account.prorated_upgrade_pence
        ok = stripe_client.charge(account.card_token, amount, currency="gbp")
        if ok:
            db.extend_renewal(account.id, months=1 if account.plan_interval == "month" else 12)
        else:
            db.schedule_retry(account.id, RETRY_DAYS)
