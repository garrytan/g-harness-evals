# Task verifier. Runs as root in a fresh container built from verifier/Dockerfile, after the agent's /work has been
# restored there (Harbor separate verification). The agent's code runs only as nobody. Writes reward and bits only.
import ast, fnmatch, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
import xml.etree.ElementTree as ET

os.chmod('/tests', 0o700)
os.makedirs('/logs/verifier', exist_ok=True)
NOBODY = 65534

def kill_nobody():
    # Every process the agent's code left running as nobody, so none survives into the next run or past the grade.
    for _ in range(3):
        found = False
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                if os.stat('/proc/' + pid).st_uid == NOBODY:
                    os.kill(int(pid), 9); found = True
            except Exception:
                pass
        if not found:
            return
        time.sleep(0.2)

def reset_nobody():
    # No state carries from one run of the agent's code to the next: kill its processes, delete everything it owns,
    # System V IPC objects included.
    kill_nobody()
    for kind, flag, col in (('shm', '-m', 'shmid'), ('msg', '-q', 'msqid'), ('sem', '-s', 'semid')):
        try:
            lines = open('/proc/sysvipc/' + kind).read().splitlines()
            hdr = lines[0].split()
            for l in lines[1:]:
                f = l.split()
                if NOBODY in (int(f[hdr.index('uid')]), int(f[hdr.index('cuid')])):
                    subprocess.run(['/usr/bin/ipcrm', flag, f[hdr.index(col)]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    for root in ('/tmp', '/var/tmp', '/dev/shm', '/dev/mqueue', '/run/lock'):
        for dp, dn, fn in os.walk(root, topdown=False):
            for n in fn + dn:
                p = os.path.join(dp, n)
                try:
                    if os.lstat(p).st_uid == NOBODY:
                        shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
                except Exception:
                    pass

def lockdown():
    # Harbor restores /work and mounts /logs/verifier writable by everyone; the agent's code must not change either.
    for dp, dn, fn in os.walk('/work'):
        for n in dn + fn:
            p = os.path.join(dp, n)
            os.lchown(p, 0, 0)
            if not os.path.islink(p):
                os.chmod(p, os.lstat(p).st_mode & ~0o022 & 0o7777 & ~0o6000)
    if os.path.isdir('/work'):
        os.chown('/work', 0, 0); os.chmod('/work', 0o755)
    os.chown('/logs/verifier', 0, 0); os.chmod('/logs/verifier', 0o755)
    for f in os.listdir('/logs/verifier'):
        p = os.path.join('/logs/verifier', f)
        if os.path.islink(p) or not os.path.isfile(p):
            shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)

def readable(tree):
    # Eval trees are root-owned; the agent's code, running as nobody, may read them and nothing more.
    for dp, dn, fn in os.walk(tree):
        os.chmod(dp, 0o755)
        for n in fn:
            p = os.path.join(dp, n)
            if not os.path.islink(p):
                os.chmod(p, 0o755 if os.lstat(p).st_mode & 0o100 else 0o644)

lockdown()
T = json.load(open('/tests/task.json'))
KIND = T['kind']
PY = ['/usr/local/bin/python3', '-s', '-B']
GIT = '/usr/bin/git'
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
       'PLAYWRIGHT_BROWSERS_PATH': '/opt/ms-playwright', 'NODE_PATH': '/usr/local/lib/node_modules',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
GITC = [GIT, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'safe.directory=*']
result = {'kind': KIND}

def finish(reward):
    kill_nobody()
    reward = max(0.0, min(1.0, float(reward)))
    open('/logs/verifier/reward.txt', 'w').write(str(round(reward, 4)) + '\n')
    result['reward'] = round(reward, 4)
    json.dump(result, open('/logs/verifier/result.json', 'w'))
    sys.exit(0)

def as_nobody():
    os.setgroups([]); os.setgid(NOBODY); os.setuid(NOBODY)

def run(cmd, cwd=None, timeout=600, env=None, nobody=False):
    e = dict(ENV); e.update(env or {})
    if nobody:
        reset_nobody()
        e['HOME'] = '/tmp/nobody'
        os.makedirs('/tmp/nobody', exist_ok=True); os.chown('/tmp/nobody', NOBODY, NOBODY)
    try:
        r = subprocess.run(cmd, cwd=cwd, env=e, timeout=timeout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=as_nobody if nobody else None)
        return r.returncode
    except subprocess.TimeoutExpired:
        return 124
    finally:
        if nobody:
            kill_nobody()

def git(args, cwd=None):
    return subprocess.run(GITC + args, cwd=cwd, env=dict(ENV), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120)

PYTEST = PY + ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-o', 'addopts=', '-o', 'junit_family=xunit2']
SNEAKY = ('conftest.py', 'pytest.ini', 'sitecustomize.py', 'usercustomize.py')

def clean_tree(tree, protected_root):
    # Remove pytest and interpreter hooks the starting tree did not have, then restore protected files.
    orig = set()
    for dp, dn, fn in os.walk(protected_root):
        for f in fn:
            orig.add(os.path.relpath(os.path.join(dp, f), protected_root))
    for dp, dn, fn in os.walk(tree):
        if '.git' in dp.split(os.sep):
            continue
        for f in fn:
            rel = os.path.relpath(os.path.join(dp, f), tree)
            if (f in SNEAKY or f.endswith('.pth')) and rel not in orig:
                os.remove(os.path.join(dp, f))
    for rel in orig:
        dst = os.path.join(tree, rel)
        if os.path.islink(dst) or os.path.isdir(dst):
            shutil.rmtree(dst, ignore_errors=True) if os.path.isdir(dst) and not os.path.islink(dst) else os.remove(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(protected_root, rel), dst)

def junit(tree, args, timeout, env=None, nobody=True):
    # Run pytest and read its junit report. A run that exits early writes no report and counts as failed. The
    # repository tests run as nobody; the trusted hidden-test run is root, and its library worker is nobody.
    d = tempfile.mkdtemp(prefix='junit-'); os.chmod(d, 0o1733)
    xml = os.path.join(d, 'r.xml')
    if not nobody:
        reset_nobody()
    try:
        rc = run(PYTEST + ['--junitxml=' + xml] + args, cwd=tree, env=env if env is not None else {'PYTHONPATH': os.path.join(tree, T.get('src', '.'))}, timeout=timeout, nobody=nobody)
    finally:
        if not nobody:
            kill_nobody()
    cases = []
    try:
        for tc in ET.parse(xml).getroot().iter('testcase'):
            state = 'passed'
            for child in tc:
                if child.tag in ('failure', 'error', 'skipped'):
                    state = child.tag
            cases.append((tc.get('classname', '') + '::' + tc.get('name', ''), state))
    except Exception:
        return rc, None
    return rc, cases

# The hidden tests decide whether the fix or feature is there, so the agent's code never runs in the process that
# grades them. A trusted pytest, as root in a directory the agent's code cannot read, runs the hidden tests against a
# stand-in for the library: every call goes over a pipe to a worker process that imports the agent's library as
# nobody, and only the call's return value (a Python literal) and the arguments' values after the call come back.
# The agent's code sees each call's inputs and nothing else: no test source, no expected value, no pytest.
PROXY_PLUGIN = r'''
import ast, builtins, importlib.abc, importlib.machinery, os, subprocess, sys, types
NAMES = set(os.environ['GN_PROXY_NAMES'].split(','))
WORKER = os.environ['GN_WORKER']
_w = None

def _nobody():
    os.setgroups([]); os.setgid(65534); os.setuid(65534)

def _worker():
    global _w
    if _w is None:
        r, w = os.pipe()
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp/nobody', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
               'GN_SRC': os.environ['GN_SRC'], 'GN_FD': str(w)}
        p = subprocess.Popen(['/usr/local/bin/python3', '-s', '-B', WORKER], cwd=os.environ['GN_TREE'], env=env, stdin=subprocess.PIPE,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=(w,), preexec_fn=_nobody)
        os.close(w)
        _w = (p, os.fdopen(r, 'rb'))
    return _w

def _exc(name):
    e = getattr(builtins, name, None)
    return e if isinstance(e, type) and issubclass(e, Exception) else type(name, (Exception,), {})

def _writeback(before, after):
    if isinstance(before, list) and isinstance(after, list):
        before[:] = after
    elif isinstance(before, dict) and isinstance(after, dict):
        before.clear(); before.update(after)

def _call(path, a, k):
    p, resp = _worker()
    try:
        p.stdin.write((repr((path, a, k)) + '\n').encode()); p.stdin.flush()
    except (BrokenPipeError, ValueError):
        raise RuntimeError('library process ended')
    line = resp.readline()
    if not line:
        raise RuntimeError('library process ended')
    msg = ast.literal_eval(line.decode())
    if msg[0] == 'exc':
        raise _exc(msg[1])(msg[2])
    for x, y in zip(a, msg[2]):
        _writeback(x, y)
    for key in k:
        _writeback(k[key], msg[3].get(key))
    return msg[1]

class _Stub:
    def __init__(self, path):
        self._path = path
    def __getattr__(self, attr):
        if attr.startswith('__'):
            raise AttributeError(attr)
        return _Stub(self._path + '.' + attr)
    def __call__(self, *a, **k):
        return _call(self._path, a, k)

class _Mod(types.ModuleType):
    def __getattr__(self, attr):
        if attr.startswith('__'):
            raise AttributeError(attr)
        return _Stub(self.__name__ + '.' + attr)

class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        if name.split('.')[0] in NAMES:
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
    def create_module(self, spec):
        return _Mod(spec.name)
    def exec_module(self, module):
        module.__path__ = []

sys.meta_path.insert(0, _Finder())
'''

PROXY_WORKER = r'''
import ast, importlib, os, sys
sys.path.insert(0, os.environ['GN_SRC'])
out = os.fdopen(int(os.environ['GN_FD']), 'w')
for line in sys.stdin:
    try:
        path, a, k = ast.literal_eval(line)
        parts = path.split('.')
        for i in range(len(parts), 0, -1):
            try:
                obj = importlib.import_module('.'.join(parts[:i]))
                break
            except ImportError:
                if i == 1:
                    raise
        for p in parts[i:]:
            obj = getattr(obj, p)
        a = list(a)
        msg = repr(('ok', obj(*a, **k), a, k))
        ast.literal_eval(msg)
    except BaseException as e:
        msg = repr(('exc', type(e).__name__, str(e)[:500]))
    out.write(msg + '\n'); out.flush()
'''

def test_functions(mod):
    for n in mod.body:
        if isinstance(n, ast.ClassDef) and n.name.startswith('Test'):
            for m in n.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name.startswith('test'):
                    yield n.name, m
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith('test'):
            yield None, n

def expected_rows(fn):
    # The row count of a test with one parametrize over a literal list, else None (at least one case).
    decs = [d for d in fn.decorator_list if isinstance(d, ast.Call) and ast.unparse(d.func) == 'pytest.mark.parametrize']
    if len(decs) == 1 and len(decs[0].args) >= 2 and isinstance(decs[0].args[1], (ast.List, ast.Tuple)):
        return len(decs[0].args[1].elts)
    return None

def hidden_pass(tree, rel, timeout):
    src = open(os.path.join('/tests/hidden', rel)).read()
    mod = ast.parse(src)
    lib = os.path.join(tree, T.get('src', '.'))
    tops = {a.name.split('.')[0] for n in ast.walk(mod) if isinstance(n, ast.Import) for a in n.names}
    tops |= {n.module.split('.')[0] for n in ast.walk(mod) if isinstance(n, ast.ImportFrom) and n.level == 0 and n.module}
    names = sorted(t for t in tops if os.path.isdir(os.path.join(lib, t)) or os.path.isfile(os.path.join(lib, t + '.py')))
    if not names:
        result['stage'] = 'no_library_import'
        return False
    root = '/tmp/trusted'
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(root, '_gn')); os.chmod(root, 0o700)
    open(os.path.join(root, '_gn', 'gn_proxy.py'), 'w').write(PROXY_PLUGIN)
    worker = '/tmp/gn_worker.py'
    open(worker, 'w').write(PROXY_WORKER); os.chmod(worker, 0o644)
    dst = os.path.join(root, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(os.path.join('/tests/hidden', rel), dst)
    os.makedirs('/tmp/nobody', exist_ok=True); os.chown('/tmp/nobody', NOBODY, NOBODY)
    env = {'PYTHONPATH': os.path.join(root, '_gn'), 'GN_PROXY_NAMES': ','.join(names), 'GN_WORKER': worker, 'GN_TREE': tree, 'GN_SRC': lib}
    rc, cases = junit(root, ['-p', 'gn_proxy', '--rootdir', root, rel], timeout, env=env, nobody=False)
    if cases is None or rc != 0:
        return False
    modname = rel[:-3].replace('/', '.')
    seen = {}
    for name, state in cases:
        classname, test = name.split('::', 1)
        if classname != modname and not classname.startswith(modname + '.'):
            return False
        fid = (classname[len(modname) + 1:] or None, test.split('[')[0])
        seen[fid] = seen.get(fid, 0) + 1
        if state != 'passed':
            return False
    for cls, fn in test_functions(mod):
        n, rows = seen.get((cls, fn.name), 0), expected_rows(fn)
        if n == 0 or (rows is not None and n != rows):
            return False
    return True

def tests_pass(tree):
    timeout = T.get('test_timeout_s', 600)
    for rel in T['hidden']:
        if not hidden_pass(tree, rel, timeout):
            result.setdefault('stage', 'hidden_tests')
            return False
    rc, cases = junit(tree, T['repo_tests'], timeout)
    if cases is None or rc != 0 or any(s in ('failure', 'error') for _, s in cases):
        result['stage'] = 'repo_tests'
        return False
    skipped = sum(1 for _, s in cases if s == 'skipped')
    result['repo_total'] = len(cases); result['repo_skipped'] = skipped
    if 'repo_tests_min' in T and (len(cases) < T['repo_tests_min'] or skipped > T['repo_skips_max']):
        result['stage'] = 'repo_tests_count'
        return False
    return True

def fresh_copy(src, tree):
    shutil.rmtree(tree, ignore_errors=True)
    shutil.copytree(src, tree, symlinks=True, ignore=shutil.ignore_patterns('.git', '__pycache__', '.pytest_cache'))

def verify_fix():
    tree = '/tmp/eval'
    if not os.path.isdir('/work/repo'):
        result['stage'] = 'no_repo'; finish(0)
    fresh_copy('/work/repo', tree)
    clean_tree(tree, '/tests/protected')
    readable(tree)
    ok = tests_pass(tree)
    result['hidden_and_repo_tests'] = ok
    finish(1 if ok else 0)

def in_hunk(f):
    try:
        line = int(f.get('line'))
    except Exception:
        return False
    name = str(f.get('file', ''))
    name = name.removeprefix('./')
    for h in T['planted_hunks']:
        if os.path.normpath(name) == h['file'] and h['start'] - 3 <= line <= h['end'] + 3:
            return True
    return False

def review_rc(name, test_src, i):
    # Both trees run at the same path, one after the other, so a test cannot tell them apart by location.
    tree = '/tmp/review/repo'
    shutil.rmtree('/tmp/review', ignore_errors=True)
    shutil.copytree('/tests/trees/' + name, tree, symlinks=True)
    dst = os.path.join(tree, 'tests_review', 'test_finding_%d.py' % i)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(test_src, dst)
    readable(tree)
    return run(PYTEST + [dst], cwd=tree, env={'PYTHONPATH': os.path.join(tree, T.get('src', '.'))}, timeout=300, nobody=True)

def verify_review():
    try:
        findings = json.load(open(T['findings_path']))
        assert isinstance(findings, list)
    except Exception:
        result['findings'] = 'unreadable'
        finish(0)
    result['findings'] = len(findings)
    if len(findings) > 10:
        result['stage'] = 'too_many_findings'; finish(0)
    verified, passing_on_defective = 0, 0
    for i, f in enumerate(findings):
        if not isinstance(f, dict):
            continue
        tp = os.path.realpath(str(f.get('test', '')))
        if not tp.startswith(T['tests_dir'] + '/') or not os.path.isfile(tp):
            continue
        rc_def = review_rc('defective', tp, i)
        if rc_def == 0:
            passing_on_defective += 1
            continue
        if in_hunk(f) and review_rc('corrected', tp, i) == 0:
            verified += 1
    result['verified'] = verified; result['passing_on_defective'] = passing_on_defective
    if passing_on_defective:
        result['stage'] = 'test_passes_on_defective'; finish(0)
    finish(min(verified, len(T['planted_hunks'])) / len(T['planted_hunks']))

APP = '/srv/app'
PORT = 18080

def start_app(variant):
    # Every variant runs from the same path with the same arguments, owned by root and unreadable to the repros.
    shutil.rmtree(APP, ignore_errors=True)
    shutil.copytree('/tests/app/' + variant, APP)
    os.chmod('/srv', 0o711); os.chmod(APP, 0o700)
    p = subprocess.Popen(PY + [os.path.join(APP, T['app_entry']), '--port', str(PORT), '--data', os.path.join(APP, 'data')], cwd=APP, env=dict(ENV), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d%s' % (PORT, T.get('health', '/')), timeout=1)
            return p
        except Exception:
            time.sleep(0.2)
    p.kill(); p.wait()
    return None

def repro_rc(script, variant):
    p = start_app(variant)
    if p is None:
        return None
    try:
        work = '/tmp/repro'
        shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
        dst = os.path.join(work, 'r.sh'); shutil.copy2(script, dst); os.chmod(dst, 0o755); os.chmod(work, 0o1777)
        return run(['/bin/bash', dst], cwd=work, env={'APP_URL': 'http://127.0.0.1:%d' % PORT}, timeout=T.get('repro_timeout_s', 120), nobody=True)
    finally:
        p.kill(); p.wait()

def verify_qa():
    d = T['repros_dir']
    scripts = sorted(os.path.join(d, n) for n in os.listdir(d) if n.endswith('.sh') and os.path.isfile(os.path.join(d, n))) if os.path.isdir(d) else []
    result['repros'] = len(scripts)
    if len(scripts) > 10:
        result['stage'] = 'too_many_repros'; finish(0)
    runs = T.get('repro_runs', 3)
    detected, false = set(), 0
    for s in scripts:
        rcs = [repro_rc(s, 'fixed') for _ in range(runs)]
        if any(rc is None for rc in rcs):
            result['app_start_failed'] = True
            finish(0)
        if not all(rc == 0 for rc in rcs):
            false += 1
            continue
        for b in T['bugs']:
            rcs = [repro_rc(s, b) for _ in range(runs)]
            if all(rc is not None and rc != 0 for rc in rcs):
                detected.add(b)
    result['detected'] = len(detected); result['false_reports'] = false
    if false > T['max_false_reports']:
        finish(0)
    finish(len(detected) / len(T['bugs']))

def verify_ship():
    remote = T['remote']
    if not os.path.isdir(remote):
        result['stage'] = 'no_remote'; finish(0)
    main = git(['--git-dir', remote, 'rev-parse', '--verify', '-q', 'refs/heads/main']).stdout.decode().strip()
    if main != T['main_sha']:
        result['stage'] = 'main_moved'; finish(0)
    tip = git(['--git-dir', remote, 'rev-parse', '--verify', '-q', 'refs/heads/' + T['branch']]).stdout.decode().strip()
    if not tip:
        result['stage'] = 'no_branch'; finish(0)
    tree = '/tmp/ship'
    shutil.rmtree(tree, ignore_errors=True)
    if git(['clone', '-q', '--no-local', remote, tree]).returncode != 0:
        result['stage'] = 'clone'; finish(0)
    git(['checkout', '-q', 'main'], cwd=tree)
    m = subprocess.run(GITC + ['-c', 'user.name=Verifier', '-c', 'user.email=verifier@example.com', 'merge', '--no-ff', '--no-edit', 'origin/' + T['branch']], cwd=tree, env=dict(ENV), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if m.returncode != 0:
        result['stage'] = 'merge_conflict'; finish(0)
    changed = [l for l in git(['diff', '--name-only', T['main_sha'] + '...' + 'origin/' + T['branch']], cwd=tree).stdout.decode().splitlines() if l]
    stray = [c for c in changed if not any(fnmatch.fnmatch(c, g) for g in T['allowed_paths'])]
    result['changed'] = len(changed); result['stray'] = len(stray)
    if stray:
        result['stage'] = 'unrelated_changes'; finish(0)
    # Static checks first, before any of the branch's code runs.
    if run(['/usr/local/bin/ruff', 'check', '--no-cache', '--config', '/tests/protected/' + T['lint_config']] + T['lint_paths'], cwd=tree) != 0:
        result['stage'] = 'lint'; finish(0)
    if run(PY + ['/tests/contrib_check.py', tree, T['main_sha'], 'origin/' + T['branch']], cwd=tree) != 0:
        result['stage'] = 'contributing'; finish(0)
    clean_tree(tree, '/tests/protected')
    readable(tree)
    if not tests_pass(tree):
        finish(0)
    result['stage'] = 'ok'
    finish(1)

try:
    {'fix': verify_fix, 'review': verify_review, 'qa': verify_qa, 'ship': verify_ship}[KIND]()
except SystemExit:
    raise
except Exception as e:
    import traceback
    open('/logs/verifier/error.log', 'w').write(traceback.format_exc())
    result['error'] = type(e).__name__
    finish(0)
