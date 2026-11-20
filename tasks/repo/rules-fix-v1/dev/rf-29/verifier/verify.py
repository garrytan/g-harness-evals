# Verifier for the rules-fix-v1 bug-fix tasks. Runs as root in a fresh container built from verifier/Dockerfile, after
# the agent's /work has been restored there (Harbor separate verification). The agent's code runs only as nobody.
# Reward 1 when the hidden tests (the upstream fix's own test changes) pass and the repository's other tests still pass.
# Writes the reward and counts only.
import json, os, shutil, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET

os.chmod('/tests', 0o700)
os.makedirs('/logs/verifier', exist_ok=True)
NOBODY = 65534
T = json.load(open('/tests/task.json'))
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp/nobody', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1', 'TZ': 'UTC', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'}
# pytest starts in isolated mode (-I: no working folder or PYTHON* variables on the path) and the repository's folders
# go after the standard library and site-packages, so no file in the tree can stand in for pytest or a module it loads.
# PYTHONPATH is still set for the Python processes the tests start themselves.
LAUNCH = 'import sys; p = sys.argv.pop(1).split(":"); import pytest; sys.path.extend(p); sys.exit(pytest.main(sys.argv[1:]))'
PYTEST = ['/usr/local/bin/python3', '-I', '-B', '-c', LAUNCH]
PYTEST_ARGS = ['-q', '-p', 'no:cacheprovider', '-o', 'junit_family=xunit2', '-o', 'cache_dir=/tmp/nobody/.pytest_cache']
SNEAKY = ('conftest.py', 'pytest.ini', '.pytest.ini', 'pytest.toml', '.pytest.toml', 'sitecustomize.py', 'usercustomize.py', 'pyproject.toml', 'setup.cfg', 'tox.ini')
result = {'kind': 'fix'}


def kill_nobody():
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
    # Nothing carries from one run of the agent's code to the next: its processes and every file it owns go.
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
    os.makedirs('/tmp/nobody', exist_ok=True); os.chown('/tmp/nobody', NOBODY, NOBODY)


def lockdown():
    # /work and /logs/verifier become root-owned and read-only to nobody.
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


def finish(reward):
    kill_nobody()
    reward = max(0.0, min(1.0, float(reward)))
    open('/logs/verifier/reward.txt', 'w').write(str(round(reward, 4)) + '\n')
    result['reward'] = round(reward, 4)
    json.dump(result, open('/logs/verifier/result.json', 'w'))
    sys.exit(0)


def as_nobody():
    os.setgroups([]); os.setgid(NOBODY); os.setuid(NOBODY)


def files_under(root):
    out = set()
    for dp, dn, fn in os.walk(root):
        for f in fn:
            out.add(os.path.relpath(os.path.join(dp, f), root))
    return out


def prepare(tree):
    # The agent's tree with the starting test files and test configuration put back, the fix's test files laid over
    # them, and every pytest or interpreter hook the starting tree did not have removed. Test files the agent added are
    # dropped from the test folder, so only the repository's own tests and the hidden tests run. Every symlink goes first
    # (no starting tree has one), so no folder the scrub cannot see is reachable from the tree.
    for dp, dn, fn in os.walk(tree):
        for n in dn + fn:
            if os.path.islink(os.path.join(dp, n)):
                os.remove(os.path.join(dp, n))
    protected, hidden = files_under('/tests/protected'), files_under('/tests/hidden')
    keep = protected | hidden
    tests_dir = T['tests_dir'].rstrip('/') + '/'
    for dp, dn, fn in os.walk(tree):
        for f in fn:
            rel = os.path.relpath(os.path.join(dp, f), tree)
            if rel in keep:
                continue
            if f in SNEAKY or f.endswith('.pth') or rel.startswith(tests_dir):
                os.remove(os.path.join(dp, f))
    for src_root, names in (('/tests/protected', protected), ('/tests/hidden', hidden)):
        for rel in sorted(names):
            dst = os.path.join(tree, rel)
            if os.path.islink(dst) or os.path.isdir(dst):
                shutil.rmtree(dst, ignore_errors=True) if os.path.isdir(dst) and not os.path.islink(dst) else os.remove(dst)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(src_root, rel), dst)
    # Root owns every file; folders are sticky and world-writable like /tmp, so tests can write scratch files next to
    # themselves but the agent's code cannot change or remove a file it does not own.
    for dp, dn, fn in os.walk(tree):
        os.chmod(dp, 0o1777)
        for n in fn:
            p = os.path.join(dp, n)
            if not os.path.islink(p):
                os.chmod(p, 0o755 if os.lstat(p).st_mode & 0o100 else 0o644)


def junit(tree, args, timeout):
    # Runs pytest as nobody and reads its junit report. A run that exits early writes no report and counts as failed.
    reset_nobody()
    d = tempfile.mkdtemp(prefix='junit-'); os.chmod(d, 0o1733)
    xml = os.path.join(d, 'r.xml')
    path = ([os.path.join(tree, T['src_root'])] if T['src_root'] else []) + [tree]
    env = dict(ENV, PYTHONPATH=path[0])
    try:
        rc = subprocess.run(PYTEST + [':'.join(path)] + PYTEST_ARGS + ['--junitxml=' + xml] + args, cwd=tree, env=env, timeout=timeout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=as_nobody).returncode
    except subprocess.TimeoutExpired:
        rc = 124
    finally:
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


def hidden_ok(rc, cases):
    return not (cases is None or rc != 0 or any(s in ('failure', 'error') for _, s in cases) or len(cases) != T['hidden_cases'] or sum(1 for _, s in cases if s == 'passed') != T['hidden_passed'])


def repo_ok(rc, cases):
    return not (cases is None or rc != 0 or any(s in ('failure', 'error') for _, s in cases) or len(cases) < T['repo_tests_min'] or sum(1 for _, s in cases if s == 'skipped') > T['repo_skips_max'])


def stage(tree, args, ok, timeout):
    # A stage that fails is run once more and the second run decides, so a test that fails only under load (a timing
    # or pipe test) does not fail a correct fix. A wrong fix fails both runs.
    rc, cases = junit(tree, args, timeout)
    if ok(rc, cases):
        return rc, cases
    result['reruns'] = result.get('reruns', 0) + 1
    return junit(tree, args, timeout)


def main():
    lockdown()
    if not os.path.isdir('/work/repo'):
        result['stage'] = 'no_repo'; finish(0)
    tree = '/tmp/eval/repo'
    shutil.rmtree('/tmp/eval', ignore_errors=True)
    shutil.copytree('/work/repo', tree, symlinks=True, ignore=shutil.ignore_patterns('.git', '__pycache__', '.pytest_cache', '*.pyc'))
    prepare(tree)
    timeout = T.get('test_timeout_s', 900)
    deselect = [a for n in T.get('deselect', []) for a in ('--deselect', n)]
    rc, cases = stage(tree, deselect + T['hidden'], hidden_ok, timeout)
    result['hidden_failed_tests'] = None if cases is None else [n for n, s in cases if s in ('failure', 'error')][:5]
    result['hidden_total'] = None if cases is None else len(cases)
    result['hidden_passed'] = None if cases is None else sum(1 for _, s in cases if s == 'passed')
    if not hidden_ok(rc, cases):
        result['stage'] = 'hidden_tests'; finish(0)
    rc, cases = stage(tree, deselect + [a for h in T['hidden'] for a in ('--ignore', h)] + [T['tests_dir']], repo_ok, timeout)
    if cases is not None:
        result['repo_total'] = len(cases); result['repo_skipped'] = sum(1 for _, s in cases if s == 'skipped')
        result['repo_failed'] = sum(1 for _, s in cases if s in ('failure', 'error'))
        result['repo_failed_tests'] = [n for n, s in cases if s in ('failure', 'error')][:5]
    if not repo_ok(rc, cases):
        result['stage'] = 'repo_tests'; finish(0)
    finish(1)


main()
