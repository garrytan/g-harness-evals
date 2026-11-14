"""Per-source egress blocklists of the frontier Harbor path, without importing Harbor (the keyless tests import this).

pin.json egress.blocklist is the Terminal-Bench 2.1 list, baked into egress-sidecar/blocklist.txt (egress.py
BlocklistDockerEnvironment). A second task source's pin (schema frontier-harbor-source/1, today
pin-swe-rebench-07-2026.json) carries its own full egress.blocklist: pin.json's list in the same order, then the hosts
that source adds, each with a reason in egress.why. render_sidecar() copies egress-sidecar/ into a content-addressed
directory with that list as blocklist.txt, and egress.py SourceBlocklistDockerEnvironment builds it as the trial's
sidecar, so the sidecar differs from the Terminal-Bench 2.1 one only in that file.

    python3 egress_blocklist.py <source>     prints the rendered blocklist.txt
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIDECAR = HERE / "egress-sidecar"
SOURCES = {"swe-rebench-07-2026": "pin-swe-rebench-07-2026.json"}


def fail(message: str) -> None:
    raise RuntimeError("HE-FRONTIER-004 " + message)


def source_blocklist(source: str, here: Path = HERE) -> list[str]:
    """The source's blocklist: pin.json's, unchanged and in order, then the source's own hosts, each with a reason."""
    if source not in SOURCES:
        fail(f"unknown task source {source!r} (known: {', '.join(sorted(SOURCES))})")
    pin = json.loads((here / SOURCES[source]).read_text())
    if pin.get("schema") != "frontier-harbor-source/1" or pin.get("source", {}).get("name") != source:
        fail(f"{SOURCES[source]} is not the frontier-harbor-source/1 pin of {source}")
    base = list(json.loads((here / "pin.json").read_text())["egress"]["blocklist"])
    hosts = list(pin["egress"]["blocklist"])
    if hosts[: len(base)] != base:
        fail(f"{SOURCES[source]} egress.blocklist does not start with pin.json egress.blocklist in order")
    if len(set(hosts)) != len(hosts):
        fail(f"{SOURCES[source]} egress.blocklist repeats a host")
    unexplained = [h for h in hosts[len(base) :] if h not in pin["egress"].get("why", {})]
    if unexplained:
        fail(f"{SOURCES[source]} egress.why gives no reason for {', '.join(unexplained)}")
    if any(not h or any(c.isspace() for c in h) for h in hosts):
        fail(f"{SOURCES[source]} egress.blocklist holds an empty or spaced host")
    return hosts


def render_sidecar(source: str, root: Path | None = None, here: Path = HERE) -> tuple[Path, str]:
    """egress-sidecar/ with blocklist.txt replaced by the source's list, at <root>/<source>-<12 hex>; returns the
    directory and the sha256 over its files ('<relative path>\0<file sha256>\n', sorted)."""
    body = ("\n".join(source_blocklist(source, here)) + "\n").encode()
    sidecar = here / "egress-sidecar"
    files = {p.relative_to(sidecar).as_posix(): p for p in sorted(sidecar.rglob("*")) if p.is_file()}
    content = {rel: (body if rel == "blocklist.txt" else p.read_bytes()) for rel, p in files.items()}
    digest = hashlib.sha256("".join(f"{rel}\0{hashlib.sha256(content[rel]).hexdigest()}\n" for rel in sorted(content)).encode()).hexdigest()
    root = root or Path.home() / ".frontier-harbor" / "egress-sidecar"
    dest = root / f"{source}-{digest[:12]}"
    if not (dest / ".complete").exists():
        root.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(dir=root, prefix=".render-"))
        for rel, data in content.items():
            (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
            (tmp / rel).write_bytes(data)
            os.chmod(tmp / rel, files[rel].stat().st_mode & 0o777)
        (tmp / ".complete").write_text(digest + "\n")
        try:
            os.rename(tmp, dest)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    return dest, digest


if __name__ == "__main__":
    sys.stdout.write("\n".join(source_blocklist(sys.argv[1])) + "\n")
