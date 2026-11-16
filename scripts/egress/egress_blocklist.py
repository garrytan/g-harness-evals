"""The egress blocklists of every open-egress path in the repository, in one place.

The rules live in scripts/frontier-harbor/egress_blocklist.py (source_blocklist): a source's list is the frontier pin.json
egress.blocklist, unchanged and in order, then the source's own hosts, each with a reason in egress.why. That file is pinned
byte for byte by docs/benchmarks/2026-11-10-gstack-delivery/pins.sha256, so this module wraps it instead of moving it, and
adds the sources that live outside scripts/frontier-harbor/:

    gbrain-install    tasks/gbrain-install/egress.json, the open-egress proxy of the gbrain install trial (runner/trial/egress.ts)

    python3 scripts/egress/egress_blocklist.py <source>     prints the source's blocklist, one host pattern per line
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
FRONTIER = ROOT / "scripts" / "frontier-harbor"
sys.path.insert(0, str(FRONTIER))

import egress_blocklist as frontier  # noqa: E402

EXTRA = {"gbrain-install": ROOT / "tasks" / "gbrain-install" / "egress.json"}
SOURCES = {**{name: FRONTIER / rel for name, rel in frontier.SOURCES.items()}, **EXTRA}


def source_blocklist(source: str) -> list[str]:
    """The source's blocklist, checked by the frontier rules (base list first and in order, no repeat, a reason per added host)."""
    if source not in SOURCES:
        frontier.fail(f"unknown egress source {source!r} (known: {', '.join(sorted(SOURCES))})")
    saved = dict(frontier.SOURCES)
    try:
        frontier.SOURCES[source] = str(SOURCES[source])
        return frontier.source_blocklist(source, FRONTIER)
    finally:
        frontier.SOURCES.clear()
        frontier.SOURCES.update(saved)


if __name__ == "__main__":
    sys.stdout.write("\n".join(source_blocklist(sys.argv[1])) + "\n")
