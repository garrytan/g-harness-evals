from dataclasses import dataclass


@dataclass(frozen=True)
class Totals:
    subtotal: int
    discount: int
    tax: int
    total: int


def compute_totals(lines, region):
    subtotal = sum(l.unit_cents * l.qty for l in lines)
    discount = sum(l.discount_cents for l in lines)
    tax = round((subtotal - discount) * tax_rate(region))
    return Totals(subtotal, discount, tax, subtotal - discount + tax)
