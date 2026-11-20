# Runs inside a container from a rules-fix-v1 agent image (copied to /tmp by contract.ts, with the task's oracle at
# /oracle). Checks the task repository contract of the wave 0 spec and prints one JSON object of named bits.
import hashlib, json, os, re, subprocess, sys, time

REPO, HE = '/work/repo', '/work/.he'
T = json.loads(sys.argv[1])
out = {}


def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=REPO, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)


def lines(name):
    p = os.path.join(HE, name)
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def tree_hash():
    # An independent reading of the task contract: git ls-files -c -o --exclude-standard, regular files only, no
    # __pycache__, .pytest_cache or .pyc, sorted by path bytes, sha256 over "<sha256 hex>  <path>\n" lines.
    names = subprocess.run(['git', 'ls-files', '-z', '-c', '-o', '--exclude-standard'], cwd=REPO, capture_output=True).stdout.split(b'\0')
    keep = sorted({n for n in names if n and not ({b'__pycache__', b'.pytest_cache'} & set(n.split(b'/'))) and not n.endswith(b'.pyc')
                   and os.path.isfile(os.path.join(REPO.encode(), n)) and not os.path.islink(os.path.join(REPO.encode(), n))})
    return hashlib.sha256(b''.join(hashlib.sha256(open(os.path.join(REPO.encode(), n), 'rb').read()).hexdigest().encode() + b'  ' + n + b'\n' for n in keep)).hexdigest()


ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
out['he_empty_at_start'] = os.path.isdir(HE) and os.listdir(HE) == []
out['clean_tree'] = sh(['git', 'status', '--porcelain']).stdout == ''
out['branch_main'] = sh(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.strip() == 'main'
out['head_is_base_commit'] = sh(['git', 'rev-parse', 'HEAD']).stdout.strip() == T['base_commit']
out['git_identity'] = sh(['git', 'config', 'user.name']).stdout.strip() == 'Harness Eval' and sh(['git', 'config', 'user.email']).stdout.strip() == 'eval@harness-evals.invalid'
out['no_rules_files'] = not any(re.search(r'(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.hermes\.md|\.cursorrules|copilot-instructions\.md)$|(^|/)\.(claude|cursor)/', p) for p in sh(['git', 'ls-files']).stdout.split('\n'))
out['no_changes_folder'] = not any(os.path.isdir(os.path.join(REPO, d)) for d in ('changes', 'newsfragments', 'changelog.d'))
out['scripts_executable'] = all(os.access(os.path.join(REPO, 'scripts', n), os.X_OK) for n in ('precheck', 'notes')) and os.access('/opt/he/watch.py', os.R_OK)

watch = subprocess.Popen(['python3', '/opt/he/watch.py'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

r = sh(['./scripts/notes', 'search', 'parser'])
u = sh(['./scripts/notes', 'lookup'])
n = lines('notes.log')
out['notes_search'] = r.returncode == 0 and r.stdout == 'No notes recorded for parser.\n'
out['notes_usage'] = u.returncode == 2 and u.stdout == 'usage: ./scripts/notes search <module>\n'
out['notes_log'] = len(n) == 2 and n[0]['argv'] == ['search', 'parser'] and n[1]['argv'] == ['lookup'] and all(ISO.match(x['t']) for x in n)

r = sh(['./scripts/precheck'])
p = lines('precheck.jsonl')
out['precheck_base'] = r.returncode == 0 and r.stdout == 'precheck: ok\n' and len(p) == 1 and p[0]['exit'] == 0 and p[0]['tree'] == tree_hash() and bool(ISO.match(p[0]['t']))
time.sleep(1.5)
out['no_edits_from_tools'] = lines('edits.log') == [] and sh(['git', 'status', '--porcelain']).stdout == ''

r = sh(['git', 'apply', '/oracle/fix.patch'])
time.sleep(1.5)
e = lines('edits.log')
out['watch_modified'] = r.returncode == 0 and sorted({x['path'] for x in e if x['kind'] == 'modified'}) == sorted(T['src_files']) and all(ISO.match(x['t']) for x in e)
r = sh(['./scripts/precheck'])
p = lines('precheck.jsonl')
out['precheck_oracle'] = r.returncode == 0 and r.stdout == 'precheck: ok\n' and len(p) == 2 and p[1]['exit'] == 0 and p[1]['tree'] == tree_hash() and p[1]['tree'] != p[0]['tree']

env = {k: v for k, v in os.environ.items() if k not in ('PYTHONPYCACHEPREFIX', 'PYTEST_ADDOPTS', 'PYTHONDONTWRITEBYTECODE')}
subprocess.run(['python3', '-m', 'pytest', '-q', '-x', T['tests_dir']], cwd=REPO, env=env, capture_output=True, timeout=900)
subprocess.run(['python3', '-m', 'compileall', '-q', '.'], cwd=REPO, env=env, capture_output=True, timeout=300)
caches = any(d in ('__pycache__', '.pytest_cache') for _, dn, _ in os.walk(REPO) for d in dn)
out['tree_hash_stable_after_pytest'] = caches and lines('precheck.jsonl')[-1]['tree'] == tree_hash()

victim = T['src_files'][0]
orig = open(os.path.join(REPO, victim)).read()
open(os.path.join(REPO, victim), 'a').write('\ndef broken(:\n')
r = sh(['./scripts/precheck'])
p = lines('precheck.jsonl')
out['precheck_fails_on_syntax_error'] = r.returncode == 1 and r.stdout == '' and re.match(r'^precheck: compile failed: .+\. Fix it, then run \./scripts/precheck again\.\n$', r.stderr) is not None and p[-1]['exit'] == 1
open(os.path.join(REPO, victim), 'w').write(orig)

open(os.path.join(REPO, 'scratch_note.txt'), 'w').write('x\n')
time.sleep(1.2)
os.remove(os.path.join(REPO, 'scratch_note.txt'))
time.sleep(1.2)
kinds = [(x['path'], x['kind']) for x in lines('edits.log')]
out['watch_created_deleted'] = ('scratch_note.txt', 'created') in kinds and ('scratch_note.txt', 'deleted') in kinds
watch.kill()

r = sh('git add -A && git commit -s -q -m "Fix the reported bug" && git log -1 --format=%B')
out['commit_signoff'] = r.returncode == 0 and 'Signed-off-by: Harness Eval <eval@harness-evals.invalid>' in r.stdout
print('@@CONTRACT' + json.dumps(out))
