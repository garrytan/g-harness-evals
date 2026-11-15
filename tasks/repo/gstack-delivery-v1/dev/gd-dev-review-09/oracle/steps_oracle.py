# The steps-followed oracle for gstack-delivery tasks. Reaches the oracle's solution while also performing every step of a
# steps card, so a task can show that following the card is compatible with scoring 1. It takes the card's step list and
# fails closed (exit 2) on a step it has no action for; a step whose check does not hold exits 1.
#
#   python3 steps_oracle.py <steps.json> <params.json>
#
# steps.json: {"kind": "review" | "ship", "steps": [{"id": ..., "text": ...}, ...]}. params.json is written by the build:
# the branch, the oracle's findings and the decoys (review), or the test command and final files (ship).
import json, os, shutil, subprocess, sys

card, P = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
KNOWN = {'review': ['read-diff', 'check-spots', 'test-each-finding', 'report-file-line'],
         'ship': ['fetch-merge', 'rerun-tests', 'contributing', 'final-diff', 'push-branch']}
kind = card['kind']
if kind != P['kind']:
    print('STEPS: card kind %s does not match task kind %s' % (kind, P['kind'])); sys.exit(2)
ids = [s['id'] for s in card['steps']]
unknown = [i for i in ids if i not in KNOWN[kind]]
if unknown:
    print('STEPS: no action for ' + ','.join(unknown)); sys.exit(2)
on = set(ids)
REPO = '/work/repo'
ENV = dict(os.environ)
ENV.update(P.get('env', {}))
done = []

def sh(cmd, check=True):
    r = subprocess.run(cmd, cwd=REPO, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and r.returncode != 0:
        print('STEPS: command failed: ' + ' '.join(cmd)); sys.stdout.write(r.stdout.decode('utf8', 'replace')[-2000:]); sys.exit(1)
    return r

def pytest(path):
    return sh(['python3', '-m', 'pytest', '-q', '-o', 'addopts=', path], check=False).returncode

def step(i):
    if i in on:
        done.append(i)
        return True
    return False

def review():
    os.makedirs('/work/out/tests', exist_ok=True)
    if step('read-diff'):
        diff = sh(['git', 'diff', P['base'] + '...' + P['branch']]).stdout
        sh(['git', 'log', '--format=%h %s', P['base'] + '..' + P['branch']])
        if not diff.strip():
            print('STEPS: empty diff'); sys.exit(1)
    if step('check-spots'):
        for s in P['findings'] + P['decoys']:
            dst = '/work/out/tests/' + os.path.basename(s['probe'])
            shutil.copy(s['probe'], dst)
            rc = pytest(dst)
            if (rc == 0) != s['correct']:
                print('STEPS: spot %s:%s did not check out' % (s['file'], s['line'])); sys.exit(1)
    for f in P['findings']:
        shutil.copy(f['probe'], f['test'])
    if step('test-each-finding'):
        for f in P['findings']:
            if pytest(f['test']) != 1:
                print('STEPS: finding test did not fail: ' + f['test']); sys.exit(1)
    step('report-file-line')
    out = [{'file': f['file'], 'line': f['line'], 'summary': f['summary'], 'test': f['test']} for f in P['findings']]
    json.dump(out, open('/work/out/review.json', 'w'), indent=1)

def ship():
    step('fetch-merge')
    sh(['git', 'fetch', '-q', 'origin'])
    sh(['git', 'merge', '--no-edit', 'origin/main'], check=False)
    step('contributing')
    for rel in P['final']:
        dst = os.path.join(REPO, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(os.path.join('/oracle/final', rel), dst)
    tests = step('rerun-tests')
    if tests:
        sh(P['test_cmd'])
    sh(['git', 'add', '-A'])
    sh(['git', 'commit', '-q', '--no-edit', '-m', 'Finish the feature and merge main'])
    if tests:
        sh(P['test_cmd'])
    if step('final-diff'):
        if not sh(['git', 'diff', 'origin/main...HEAD']).stdout.strip():
            print('STEPS: empty final diff'); sys.exit(1)
        if sh(['git', 'diff', '--name-only', '--diff-filter=U']).stdout.strip():
            print('STEPS: unmerged paths'); sys.exit(1)
    step('push-branch')
    sh(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/' + P['branch']])

{'review': review, 'ship': ship}[kind]()
print('STEPS: done ' + ','.join(done))
