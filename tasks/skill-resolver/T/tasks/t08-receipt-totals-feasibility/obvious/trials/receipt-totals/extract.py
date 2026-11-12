"""Disposable check: can regexes find receipt totals in OCR text dumps?"""

import re
import sys
from pathlib import Path

TOTAL_LINE = re.compile(r"^\s*(total|amount due)\b(?!\s+saving)[^\d-]*([\d.,]+)\s*$", re.I | re.M)


def find_total(text: str) -> str | None:
    matches = TOTAL_LINE.findall(text)
    if not matches:
        return None
    return matches[-1][1].replace(",", ".")


if __name__ == "__main__":
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "samples")
    for path in sorted(folder.glob("*.txt")):
        print(f"{path.name}: {find_total(path.read_text())}")
