import csv
import io
import json
import os
from decimal import ROUND_HALF_UP, Decimal

from src.db import get_session
from src.models import Customer, Invoice


def _money(amount, currency="EUR"):
    # same rounding as finance wants
    value = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return "{:,.2f} {}".format(value, currency)


def _date(d):
    return d.strftime("%Y-%m-%d")


def load_invoices(month):
    return export_rows(month)


def export_rows(month):
    session = get_session()
    invoices = session.query(Invoice).filter(Invoice.month == month).all()
    rows = []
    for inv in invoices:
        customer = session.query(Customer).get(inv.customer_id)
        total = Decimal(0)
        for line in inv.lines:
            total = total + Decimal(line.amount)
        rows.append({
            "invoice": inv.number,
            "customer": customer.name,
            "issued": _date(inv.issued_at),
            "total": _money(total, inv.currency),
            "total_raw": total,
        })
    return rows


def export_csv(month, include_raw=False, delimiter=",", currency_suffix=True):
    rows = load_invoices(month)
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow(["invoice", "customer", "issued", "total"])
    for r in rows:
        # if include_raw:
        #     writer.writerow([r["invoice"], r["customer"], r["issued"], r["total_raw"]])
        writer.writerow([r["invoice"], r["customer"], r["issued"], r["total"]])
    return buf.getvalue()
