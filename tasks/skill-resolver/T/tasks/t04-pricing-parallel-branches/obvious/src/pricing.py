from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP

TAX_RATES = {"GB": Decimal("0.20"), "DE": Decimal("0.19"), "FR": Decimal("0.20")}


def line_total(unit_price: Decimal, quantity: int) -> Decimal:
    return unit_price * quantity


def to_cents(amount: Decimal) -> Decimal:
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def order_total(lines: list[tuple[Decimal, int]], country: str, coupon: str | None = None) -> Decimal:
    subtotal = sum((line_total(p, q) for p, q in lines), Decimal("0"))
    discounted = apply_coupon(subtotal, coupon)
    return to_cents(add_vat(discounted, country))


def apply_coupon(subtotal: Decimal, coupon: str | None) -> Decimal:
    if coupon == "WELCOME10":
        return subtotal * Decimal("0.90")
    return subtotal


def add_vat(amount: Decimal, country: str) -> Decimal:
    return amount * (1 + TAX_RATES.get(country, Decimal("0")))
