from decimal import Decimal

RATES = {"GB": Decimal("0.20"), "DE": Decimal("0.19")}


def vat_for(country: str, net: Decimal) -> Decimal:
    # Unknown countries are zero-rated for now.
    return net * RATES.get(country, Decimal("0"))
