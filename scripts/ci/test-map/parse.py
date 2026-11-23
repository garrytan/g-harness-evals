#!/usr/bin/env python3
"""Parse one strace -f -y log into the repo paths a test touched.

usage: parse.py LOG ROOT OUT.json [TESTFILE]
Entries first seen before the test file itself is opened and never seen again after it are bun's own startup
(config discovery) and go to startup_paths / startup_dirs instead of the map lists.
Paths resolve through the AT_FDCWD<cwd> and fd<path> decoding that strace -y prints, with a per-pid cwd table
(inherited on clone/fork, updated on chdir/fchdir) for the old non-at syscalls. Only paths inside ROOT are kept.
"""
import json, os, re, sys

log, root, out = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3]
testfile = sys.argv[4] if len(sys.argv) > 4 else None
phase = [0]  # 0 until the test file is opened, then 1
rootp = root + '/'

LINE = re.compile(r'^(\d+)\s+(?:<\.\.\. (\w+) resumed>|(\w+)\()(.*)$')
STR = re.compile(r'"((?:[^"\\]|\\.)*)"(\.\.\.)?')
FD = re.compile(r'(AT_FDCWD|-?\d+)<((?:[^>\\]|\\.)*)>')
RET = re.compile(r'\) += (-?\d+)(?:<[^>]*>)?(?: (\w+))?')

AT_CALLS = {'openat', 'openat2', 'newfstatat', 'statx', 'faccessat', 'faccessat2', 'readlinkat', 'execveat',
            'mkdirat', 'unlinkat', 'renameat', 'renameat2', 'symlinkat', 'linkat', 'fchmodat', 'utimensat',
            'inotify_add_watch'}
PLAIN_CALLS = {'open', 'stat', 'lstat', 'access', 'readlink', 'execve', 'chdir', 'truncate', 'mkdir', 'unlink',
               'rmdir', 'rename', 'creat', 'chmod', 'statfs'}
WRITE_CALLS = {'mkdirat', 'unlinkat', 'renameat', 'renameat2', 'symlinkat', 'linkat', 'fchmodat', 'utimensat',
               'mkdir', 'unlink', 'rmdir', 'rename', 'creat', 'chmod', 'truncate'}


def unesc(s):
    if '\\' not in s:
        return s
    try:
        return bytes(s, 'latin-1').decode('unicode_escape').encode('latin-1').decode('utf-8', 'replace')
    except Exception:
        return s


cwd, pending = {}, {}
paths, missing, dirs, written = set(), set(), set(), set()
pre_paths, pre_dirs, pre_missing = set(), set(), set()
execs, pid_exec, gitdir_pids = [], {}, set()
if testfile is None:
    phase[0] = 1


def resolve(base, p):
    if p.startswith('/'):
        return os.path.normpath(p)
    if base is None:
        return None
    return os.path.normpath(os.path.join(base, p))


def rel_of(p):
    if p is None or (p != root and not p.startswith(rootp)):
        return None
    return '.' if p == root else p[len(rootp):]


def keep(p, ok, call, pid):
    rel = rel_of(p)
    if rel is None:
        return
    if rel == '.git' or rel.startswith('.git/'):
        gitdir_pids.add(pid)
        return
    if call in WRITE_CALLS:
        written.add(rel)
    elif phase[0] == 0:
        if rel == testfile and ok:
            phase[0] = 1
            paths.add(rel)
        else:
            (pre_paths if ok else pre_missing).add(rel)
    elif ok:
        paths.add(rel)
    else:
        missing.add(rel)


with open(log, 'r', encoding='latin-1') as fh:
    for raw in fh:
        m = LINE.match(raw.rstrip('\n'))
        if not m:
            continue
        pid = int(m.group(1))
        if m.group(2):
            head = pending.pop(pid, None)
            if head is None:
                continue
            call, rest = head[0], head[1] + m.group(4)
        else:
            call, rest = m.group(3), m.group(4)
        if rest.endswith('<unfinished ...>'):
            pending[pid] = (call, rest[:-len('<unfinished ...>')])
            continue
        r = RET.search(rest)
        if not r:
            continue
        ret = int(r.group(1))
        ok = ret >= 0
        fdm = FD.search(rest)
        if fdm and fdm.group(1) == 'AT_FDCWD':
            cwd[pid] = unesc(fdm.group(2))
        if call in ('clone', 'clone3', 'fork', 'vfork'):
            if ret > 0:
                cwd.setdefault(ret, cwd.get(pid))
                if pid in pid_exec:
                    pid_exec.setdefault(ret, list(pid_exec[pid]))
            continue
        if call in ('getdents64', 'getdents'):
            if fdm:
                rel = rel_of(os.path.normpath(unesc(fdm.group(2))))
                if rel is not None and not (rel == '.git' or rel.startswith('.git/')):
                    (dirs if phase[0] else pre_dirs).add(rel)
            continue
        if call == 'fchdir':
            if fdm and ok:
                cwd[pid] = unesc(fdm.group(2))
            continue
        sm = STR.search(rest)
        if not sm:
            continue
        s = unesc(sm.group(1))
        if call in AT_CALLS:
            if s == '' and fdm:
                p = os.path.normpath(unesc(fdm.group(2)))
            else:
                p = resolve(unesc(fdm.group(2)) if fdm else cwd.get(pid), s)
            keep(p, ok, call, pid)
            continue
        if call in PLAIN_CALLS:
            p = resolve(cwd.get(pid), s)
            keep(p, ok, call, pid)
            if call == 'chdir' and ok and p:
                cwd[pid] = p
            if call == 'execve' and ok:
                lb = rest.find('[')
                rb = rest.find('], ', lb)
                argv = [unesc(x.group(1)) for x in STR.finditer(rest[lb:rb if rb > 0 else len(rest)])] if lb >= 0 else []
                execs.append({'pid': pid, 'cwd': cwd.get(pid), 'path': p, 'argv': argv[:200]})
                pid_exec[pid] = pid_exec.get(pid, []) + [len(execs) - 1]

for e in execs:
    e['opened_gitdir'] = False
for pid in gitdir_pids:
    for i in pid_exec.get(pid, []):
        execs[i]['opened_gitdir'] = True


def prog(e):
    return os.path.basename(e['argv'][0]) if e['argv'] else os.path.basename(e['path'] or '')


def interesting(e):
    return prog(e) in ('git', 'docker', 'docker-compose', 'docker-buildx') or rel_of(e['path']) is not None

json.dump({
    'root': root,
    'testfile_seen': phase[0] == 1,
    'paths': sorted(paths | (pre_paths & (paths | missing))),
    'missing': sorted(missing - paths),
    'dirs': sorted(dirs),
    'startup_paths': sorted(pre_paths - paths - missing),
    'startup_missing': sorted(pre_missing - paths - missing),
    'startup_dirs': sorted(pre_dirs - dirs),
    'written': sorted(written),
    'gitdir_opened': bool(gitdir_pids),
    'execs': [e for e in execs if interesting(e)],
    'exec_count': len(execs),
    'exec_progs': sorted({prog(e) for e in execs}),
}, open(out, 'w'))
