"""Stand-in for lane A's /opt/he/watch.py (wave0-spec.md, task repository contract), for the keyless delivery map only:
polls /work/repo every 0.5 s (excluding .git/) and appends {"t", "path", "kind"} lines to /work/.he/edits.log for each
change against the previous poll. Lane A's watcher replaces it in the real task images."""
import hashlib
import json
import os
import time
from datetime import datetime, timezone

ROOT, LOG = "/work/repo", "/work/.he/edits.log"


def snap():
    out = {}
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if not (d == ROOT and x == ".git")]
        for f in files:
            p = os.path.join(d, f)
            try:
                out[os.path.relpath(p, ROOT)] = hashlib.sha256(open(p, "rb").read()).hexdigest()
            except OSError:
                pass
    return out


prev = snap()
while True:
    time.sleep(0.5)
    cur = snap()
    t = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    lines = [{"t": t, "path": p, "kind": "created" if p not in prev else "modified"} for p in sorted(cur) if prev.get(p) != cur[p]]
    lines += [{"t": t, "path": p, "kind": "deleted"} for p in sorted(prev) if p not in cur]
    if lines:
        with open(LOG, "a") as f:
            f.writelines(json.dumps(x) + "\n" for x in lines)
    prev = cur
