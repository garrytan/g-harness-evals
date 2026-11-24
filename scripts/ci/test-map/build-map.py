#!/usr/bin/env python3
"""Builds the gzipped runtime test map from trace.sh's per-file parse records.

usage: build-map.py --json DIR --timings FILE --sha SHA --root ROOT --out test-map.json.gz [--generated-at ISO]

The map (schema 1), which scripts/ci/select-tests.ts reads from the ci-test-map branch:
  sha, generated_at       the main commit traced and when the map was built (UTC);
  tests[file].paths       repo paths the file's processes opened, stat-ed, probed (failed lookups too) or executed, and
                          the paths it read through a path-scoped git call (show rev:path, cat-file -e rev:path);
  tests[file].dirs        directories it listed with getdents: the selector matches these only when a change adds or
                          removes an entry in them;
  tests[file].trees       directories it depends on whole: a docker build context or bind-mount source, the context of
                          an image another test file built and this one runs or inspects (a test that skips its docker
                          cases when the image is missing still inspects it), and the pathspec of a git call that reads
                          content below it (git archive <rev> harnesses/<h>, status/log/ls-files/grep -- <path>);
  always[file]            the git calls that read the whole tree (cat-file --batch, unscoped ls-files, ls-tree, status,
                          grep, archive or log --name-only, diff, diff-tree, check-ignore, add, a clone of the repository),
                          and a nonzero exit under trace, whose reads stop at the failure;
  weights_ms[file]        the file's wall time under strace, in milliseconds (an over-estimate of its plain time).
Paths are repository-relative; "." is the root. node_modules, .git and bun's own startup config discovery are left out.
A file that read more than 50,000 paths (a whole-tree scan) keeps no paths, dirs or trees: it is in always, and its
reads must not hide a code file from the selector's "no test reads this" fallback.
"""
import argparse, datetime, gzip, json, os, glob, collections

ap = argparse.ArgumentParser()
for a in ('--json', '--timings', '--sha', '--root', '--out'):
    ap.add_argument(a, required=True)
ap.add_argument('--generated-at')
A = ap.parse_args()
root = os.path.realpath(A.root)
rootp = root + '/'
SCAN = 50000
GIT_GLOBAL_VAL = {'-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'}
CONTENT_GIT = {'cat-file', 'show', 'ls-files', 'ls-tree', 'archive', 'grep', 'blame', 'diff', 'diff-tree', 'diff-index',
               'diff-files', 'format-patch', 'stash', 'checkout', 'restore', 'worktree', 'clone', 'read-tree', 'status',
               'apply', 'am', 'cherry-pick', 'rebase', 'merge', 'reset', 'switch', 'bundle', 'pack-objects', 'fast-export',
               'whatchanged', 'shortlog', 'add', 'commit', 'stage', 'rm', 'mv', 'check-ignore', 'check-attr', 'log', 'rev-list'}
LOG_CONTENT = {'-p', '--patch', '-u', '--stat', '--numstat', '--name-only', '--name-status', '--raw', '-L', '-G', '-S',
               '--follow', '--shortstat', '--summary', '--dirstat'}
PATHSPEC_SUBS = {'status', 'ls-files', 'ls-tree', 'log', 'diff', 'diff-tree', 'grep', 'blame', 'archive', 'whatchanged', 'shortlog'}


def rel(p):
    if p is None:
        return None
    p = os.path.normpath(p)
    return '.' if p == root else (p[len(rootp):] if p.startswith(rootp) else None)


def res(cwd, p):
    return os.path.normpath(p if p.startswith('/') else os.path.join(cwd or root, p))


def pathspec_tree(s, base='.'):
    """The literal directory a pathspec reads below, relative to the root, or None when it can match anywhere. A pathspec
    without :/ or :(top) magic is relative to the git process's directory, base."""
    top = s.startswith(':/')
    if s.startswith(':('):
        top = ')' in s and 'top' in s[2:s.index(')')].split(',')
        s = s[s.index(')') + 1:] if ')' in s else ''
    elif top:
        s = s[2:]
    if not top and base != '.':
        s = base + '/' + s
    cut = min([i for i in (s.find('*'), s.find('?'), s.find('[')) if i >= 0] or [len(s)])
    lit = s[:cut]
    if cut < len(s):
        lit = lit.rsplit('/', 1)[0] if '/' in lit else ''
    lit = os.path.normpath(lit).strip('/') if lit.strip('/') else ''
    return None if not lit or lit == '..' or lit.startswith('../') else lit


def git_call(e):
    """(on_repo, subcommand, args, deps) for one git exec; deps is ('always', why) or ('paths'|'trees', [..]) or None."""
    a = e['argv'][1:]
    cwd, gitdir, i = e['cwd'], None, 0
    while i < len(a) and a[i].startswith('-'):
        if a[i] in GIT_GLOBAL_VAL and i + 1 < len(a):
            if a[i] == '-C':
                cwd = res(cwd, a[i + 1])
            if a[i] == '--git-dir':
                gitdir = res(cwd, a[i + 1])
            i += 2
            continue
        if a[i].startswith('--git-dir='):
            gitdir = res(cwd, a[i].split('=', 1)[1])
        i += 1
    sub = a[i] if i < len(a) else ''
    rest = a[i + 1:]
    if sub == 'clone':
        pos = [x for x in rest if not x.startswith('-')]
        src = pos[0] if pos else ''
        src = src[len('file://'):] if src.startswith('file://') else src
        on = '://' not in src and rel(res(cwd, src)) is not None
        return on, sub, rest, ('always', 'clone of the repository') if on else None
    on = rel(gitdir if gitdir else cwd) is not None and bool(e.get('opened_gitdir'))
    if not on or sub not in CONTENT_GIT:
        return on, sub, rest, None
    flags = [x for x in rest if x.startswith('-')]
    if sub in ('show', 'cat-file'):
        if sub == 'show' and ({'--quiet', '-s', '--no-patch'} & set(flags)):
            return on, sub, rest, ('paths', [])
        if '--batch' in flags or '--batch-check' in flags or '--batch-command' in flags:
            return on, sub, rest, ('always', sub + ' --batch')
        objs = [x for x in rest if not x.startswith('-') and x not in ('blob', 'tree', 'commit', 'tag')]
        if sub == 'cat-file' and ('-e' in flags or '-t' in flags or '-s' in flags) and all(':' not in o for o in objs):
            return on, sub, rest, ('paths', [])
        if objs and all(':' in o for o in objs):
            ps = [o.split(':', 1)[1] for o in objs]
            ps = [rel(res(cwd, p)) if p.startswith(('./', '../')) else p for p in ps if p and not p.startswith('/')]
            return on, sub, rest, ('paths', [p for p in ps if p])
        return on, sub, rest, ('always', sub + ' ' + ' '.join(rest)[:60])
    if sub in ('log', 'rev-list') and '--' not in rest and not (set(x.split('=')[0] for x in rest) & LOG_CONTENT) and '--objects' not in rest:
        return on, sub, rest, ('paths', [])
    if sub in PATHSPEC_SUBS:
        if '--' in rest:
            specs = rest[rest.index('--') + 1:]
        elif sub == 'archive':
            pos = [x for x in rest if not x.startswith('-')]
            specs = pos[1:]
        elif sub in ('ls-files', 'grep'):
            pos = [x for x in rest if not x.startswith('-')]
            specs = pos if sub == 'ls-files' else pos[1:]
        else:
            specs = []
        base = rel(cwd) or '.'
        trees = [pathspec_tree(s, base) for s in specs if s and not s.startswith('/')]
        if trees and all(t is not None for t in trees):
            return on, sub, rest, ('trees', trees)
        return on, sub, rest, ('always', sub + ' (whole tree)')
    return on, sub, rest, ('always', sub)


DOCKER_RUN_VAL = set('-e --env -v --volume --mount -w --workdir --name --network --net -p --publish --entrypoint -u --user '
                     '--add-host --label -l --cpus -m --memory --env-file --cap-add --cap-drop --security-opt --tmpfs '
                     '--ulimit --pids-limit --platform --hostname -h --stop-timeout --memory-swap --shm-size --log-driver '
                     '--log-opt --dns --runtime --cgroupns --ipc --pid --gpus --restart --cidfile --device --group-add '
                     '--expose --label-file --sysctl --userns --uts --volumes-from -a --attach --stop-signal --cpu-shares '
                     '--cpuset-cpus --network-alias --mac-address --ip --health-cmd --health-interval --health-retries '
                     '--health-timeout --oom-score-adj --storage-opt --pull --cgroup-parent --annotation'.split())
DOCKER_BUILD_VAL = set('-t --tag -f --file --build-arg --target --platform --label --network --progress --secret --ssh '
                       '--cache-from --cache-to -o --output --iidfile --build-context --metadata-file --shm-size --ulimit '
                       '--add-host --builder --provenance --sbom --attest --allow --annotation --cgroup-parent --memory -m'.split())


def opts(a, valset, stop_at_first):
    o, pos, i = [], [], 0
    while i < len(a):
        x = a[i]
        if x == '--':
            pos += a[i + 1:]
            break
        if x.startswith('--') and '=' in x:
            k, v = x.split('=', 1); o.append((k, v)); i += 1; continue
        if x.startswith('-') and x != '-':
            if x in valset and i + 1 < len(a):
                o.append((x, a[i + 1])); i += 2; continue
            if len(x) > 2 and not x.startswith('--') and x[:2] in valset:
                o.append((x[:2], x[2:])); i += 1; continue
            o.append((x, None)); i += 1; continue
        pos.append(x)
        if stop_at_first:
            pos += a[i + 1:]
            break
        i += 1
    return o, pos


def docker_call(e):
    a = e['argv'][1:]
    gi = 0
    while gi < len(a) and a[gi].startswith('-'):
        gi += 2 if a[gi] in ('-H', '--host', '--context', '-c', '--config', '--log-level', '-l') else 1
    a = a[gi:]
    if not a:
        return None
    sub, rest = a[0], a[1:]
    if sub in ('buildx', 'image') and rest and rest[0] == 'build':
        sub, rest = 'build', rest[1:]
    if sub == 'container' and rest and rest[0] in ('run', 'create', 'cp'):
        sub, rest = rest[0], rest[1:]
    cwd = e['cwd']
    d = {'deps': [], 'tags': [], 'image': None}
    if sub == 'build':
        o, pos = opts(rest, DOCKER_BUILD_VAL, False)
        if pos and pos[-1] != '-':
            d['deps'].append(('trees', res(cwd, pos[-1])))
        for k, v in o:
            if k in ('-f', '--file') and v and v != '-':
                d['deps'].append(('paths', res(cwd, v)))
            if k == '--build-context' and v and '=' in v:
                src = v.split('=', 1)[1]
                if '://' not in src and not src.startswith('docker-image'):
                    d['deps'].append(('trees', res(cwd, src)))
            if k in ('-t', '--tag') and v:
                d['tags'].append(v)
    elif sub in ('run', 'create'):
        o, pos = opts(rest, DOCKER_RUN_VAL, True)
        d['image'] = pos[0] if pos else None
        for k, v in o:
            if k in ('-v', '--volume') and v:
                src = v.split(':', 1)[0]
                if src.startswith('/') or src.startswith('.'):
                    d['deps'].append(('trees', res(cwd, src)))
            if k == '--mount' and v:
                kv = dict(x.split('=', 1) for x in v.split(',') if '=' in x)
                src = kv.get('source') or kv.get('src')
                if kv.get('type', 'volume') == 'bind' and src:
                    d['deps'].append(('trees', res(cwd, src)))
            if k in ('--env-file', '--label-file') and v:
                d['deps'].append(('paths', res(cwd, v)))
    elif sub == 'cp':
        pos = [x for x in rest if not x.startswith('-')]
        if pos and ':' not in pos[0]:
            d['deps'].append(('trees', res(cwd, pos[0])))
    elif sub == 'inspect' or (sub == 'image' and rest[:1] == ['inspect']):
        d['probes'] = opts(rest[1:] if sub == 'image' else rest, {'-f', '--format', '--type'}, False)[1]
    return d


def tag(t):
    return t if ':' in t.split('/')[-1] else t + ':latest'


skip = lambda p: p == 'node_modules' or p.startswith('node_modules/')
weights, tests, always, names = {}, {}, collections.defaultdict(set), {}
for line in open(A.timings):
    f, rc, ms, _ = line.rstrip('\n').split('\t')
    weights[f] = int(ms)
    names[f.replace('/', '__')] = f
    if rc != '0':
        always[f].add('traced run exited %s' % rc)
built = collections.defaultdict(lambda: {'paths': set(), 'trees': set()})
runs = collections.defaultdict(set)
for fp in sorted(glob.glob(os.path.join(A.json, '*.json'))):
    t = names.get(os.path.basename(fp)[:-5]) or os.path.basename(fp)[:-5].replace('__', '/')
    d = json.load(open(fp))
    dep = {'paths': {p for p in d['paths'] + d['missing'] if not skip(p)}, 'dirs': {p for p in d['dirs'] if not skip(p)}, 'trees': set()}
    for e in d['execs']:
        prog = os.path.basename(e['argv'][0]) if e['argv'] else ''
        if prog == 'git':
            on, sub, rest, deps = git_call(e)
            if deps is None:
                continue
            kind, val = deps
            if kind == 'always':
                always[t].add(val)
            else:
                dep[kind].update(x.strip('/') for x in val if x.strip('/'))
        elif prog == 'docker':
            dc = docker_call(e)
            if not dc:
                continue
            for kind, p in dc['deps']:
                r = rel(p)
                if r is not None:
                    dep[kind].add(r)
                    for tg in dc['tags']:
                        built[tag(tg)][kind].add(r)
            for i in ([dc['image']] if dc['image'] else []) + dc.get('probes', []):
                runs[t].add(tag(i))
    tests[t] = dep
for t, imgs in runs.items():
    for i in imgs:
        if i in built:
            tests[t]['paths'] |= built[i]['paths']
            tests[t]['trees'] |= built[i]['trees']
for t, dep in tests.items():
    if len(dep['paths']) > SCAN:
        always[t].add('reads more than %d paths' % SCAN)
        tests[t] = {'paths': set(), 'dirs': set(), 'trees': set()}
m = {
    'schema': 1,
    'sha': A.sha,
    'generated_at': A.generated_at or datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'tests': {t: {k: sorted(v) for k, v in dep.items()} for t, dep in sorted(tests.items())},
    'always': {t: sorted(v) for t, v in sorted(always.items())},
    'weights_ms': {t: weights[t] for t in sorted(weights)},
}
raw = json.dumps(m, separators=(',', ':')).encode()
with gzip.open(A.out, 'wb', compresslevel=9) as fh:
    fh.write(raw)
print('build-map: %d test files, %d always, %d paths, %d dirs, %d trees, %d bytes gzipped' % (
    len(tests), len(always), sum(len(v['paths']) for v in m['tests'].values()), sum(len(v['dirs']) for v in m['tests'].values()),
    sum(len(v['trees']) for v in m['tests'].values()), os.path.getsize(A.out)))
