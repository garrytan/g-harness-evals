#!/usr/bin/env python3
# Edit watcher baked into the task image at /opt/he/watch.py. The harness setup starts it before the agent. Every 0.5 s
# it compares /work/repo (without .git/) with the previous poll and appends one line per created, modified or deleted
# file to /work/.he/edits.log. The first poll only records the starting state. Python bytecode caches and pytest's
# cache folder are not edits and are skipped.
import datetime, hashlib, json, os, sys, time

REPO = sys.argv[1] if len(sys.argv) > 1 else '/work/repo'
LOG = sys.argv[2] if len(sys.argv) > 2 else '/work/.he/edits.log'
SKIP_DIRS = {'__pycache__', '.pytest_cache'}


def digest(p):
    try:
        if os.path.islink(p):
            return 'link:' + os.readlink(p)
        h = hashlib.sha256()
        with open(p, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def snapshot(prev):
    cur = {}
    for dp, dn, fn in os.walk(REPO):
        dn[:] = [d for d in dn if d not in SKIP_DIRS and not (dp == REPO and d == '.git')]
        for f in fn:
            if f.endswith('.pyc'):
                continue
            p = os.path.join(dp, f)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            key = (st.st_mtime_ns, st.st_size)
            old = prev.get(p)
            cur[p] = (key, old[1] if old and old[0] == key else digest(p))
    return cur


def main():
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    prev = snapshot({})
    while True:
        time.sleep(0.5)
        cur = snapshot(prev)
        t = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        rows = []
        for p in sorted(set(prev) | set(cur)):
            if p not in prev:
                kind = 'created'
            elif p not in cur:
                kind = 'deleted'
            elif prev[p][1] != cur[p][1]:
                kind = 'modified'
            else:
                continue
            rows.append(json.dumps({'t': t, 'path': os.path.relpath(p, REPO), 'kind': kind}))
        if rows:
            with open(LOG, 'a') as fh:
                fh.write('\n'.join(rows) + '\n')
        prev = cur


if __name__ == '__main__':
    main()
