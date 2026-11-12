from decimal import ROUND_HALF_UP, Decimal


def format_money(amount, currency="EUR"):
    value = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{value:,.2f} {currency}"


def iso_date(d):
    return d.strftime("%Y-%m-%d")
