from dataclasses import dataclass, field
from decimal import Decimal

from .tax import vat_for


@dataclass
class Invoice:
    number: str
    country: str
    lines: list[tuple[str, Decimal]] = field(default_factory=list)

    # Net total before VAT.
    def net(self) -> Decimal:
        return sum((amount for _, amount in self.lines), Decimal("0"))

    def gross(self) -> Decimal:
        return self.net() + vat_for(self.country, self.net())
