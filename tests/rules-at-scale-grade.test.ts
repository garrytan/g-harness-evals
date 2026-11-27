import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { commandSteps, git, gradeR6, gradeTrial, partialLength, QM_SOUL_HEADING, qmSoulDelivered, requestTexts, ruleBody, ruleState, shellWords, stagedDiff, stages, systemText, treeHash, type Grade } from '../scripts/rules-at-scale/grade.ts';
import { UNREAD } from '../scripts/gstack-delivery/probes.ts';
import { loadRules } from '../scripts/rules-at-scale/lib.ts';

const doc = loadRules();
const R = Object.fromEntries(doc.rules.map((r) => [r.id, r.text])) as Record<string, string>;
const ENV = { PATH: '/usr/local/bin:/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function sh(cwd: string, cmd: string): string {
  const home = mkdtempSync(join(tmpdir(), 'ras-home-'));
  const p = Bun.spawnSync(['env', '-i', ...Object.entries({ ...ENV, HOME: home }).map(([k, v]) => k + '=' + v), 'bash', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  rmSync(home, { recursive: true, force: true });
  if (p.exitCode !== 0) throw new Error(cmd + ': ' + p.stderr.toString());
  return p.stdout.toString().trim();
}
const write = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const chainKey = (l: string) => createHash('sha256').update(l, 'utf8').digest('hex').slice(0, 16);

/** A capture file from request bodies, hash-chained the way runner/proxy/capture.ts writes it. */
function capture(file: string, bodies: Array<{ route: string; body: unknown }>) {
  let prev = '';
  const lines = bodies.map((b, seq) => { const l = JSON.stringify({ seq, prev, route: b.route, body: b.body }); prev = chainKey(l); return l; });
  write(file, lines.join('\n') + '\n');
}

/** Anthropic Messages requests for a session of Bash commands, each request carrying the history so far. */
function anthropicSession(system: string, commands: string[], extra: { toolText?: string } = {}) {
  const tools = [{ name: 'Bash', input_schema: {} }];
  const msgs: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] }];
  const out = [{ route: '/v1/messages', body: { system, tools, messages: [...msgs] } }];
  commands.forEach((c, i) => {
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tu' + i, name: 'Bash', input: { command: c } }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + i, content: i === 0 && extra.toolText ? extra.toolText : 'Exit code 0' }] });
    out.push({ route: '/v1/messages', body: { system, tools, messages: [...msgs] } });
  });
  return out;
}

interface Trial { trial: string; task: string; base: string; repo: string; he: string }

/** A trial dir with a /work artifact: repo at a base commit (pkg/mod.py, tests/test_mod.py, scripts/precheck), an empty .he. */
function makeTrial(init = ''): Trial {
  const root = mkdtempSync(join(tmpdir(), 'ras-trial-'));
  const trial = join(root, 'trial'), task = join(root, 'task');
  const repo = join(trial, 'artifacts', 'work', 'repo'), he = join(trial, 'artifacts', 'work', '.he');
  write(join(task, 'task.toml'), 'id = "t-01"\nrotation = 0\npackage_dir = "pkg"\ntests_dir = "tests"\n');
  write(join(repo, 'pkg', 'mod.py'), 'def f():\n    return 1\n');
  write(join(repo, 'tests', 'test_mod.py'), 'from pkg.mod import f\n\ndef test_f():\n    assert f() == 1\n');
  write(join(repo, 'scripts', 'precheck'), '#!/bin/sh\necho ok\n');
  mkdirSync(he, { recursive: true });
  sh(repo, 'git init -q -b main ' + init + ' && git config user.name "Harness Eval" && git config user.email eval@harness-evals.invalid && git add -A && git commit -q -m base');
  return { trial, task, base: sh(repo, 'git rev-parse HEAD'), repo, he };
}
const grade = (t: Trial): Grade => gradeTrial({ trial: t.trial, taskDir: t.task, base: t.base });
const gitHasReftable = (() => {
  const d = mkdtempSync(join(tmpdir(), 'ras-reftable-'));
  try { sh(d, 'git init -q --ref-format=reftable'); return true; } catch { return false; } finally { rmSync(d, { recursive: true, force: true }); }
})();
const edit = (t: Trial) => write(join(t.repo, 'pkg', 'mod.py'), 'def f():\n    return 2\n');
const commit = (t: Trial, signed = true) => sh(t.repo, 'git add -A && git commit -q ' + (signed ? '-s ' : '') + '-m fix');
const iso = (ms: number) => new Date(Date.UTC(2026, 10, 19, 12, 0, 0) + ms).toISOString();

describe('tree hash', () => {
  test('matches an independent implementation of the shared definition', () => {
    const t = makeTrial();
    write(join(t.repo, 'a b.txt'), 'x');
    write(join(t.repo, '.gitignore'), 'build/\n');
    write(join(t.repo, 'build', 'out.txt'), 'ignored');
    const py = "import hashlib,os,subprocess;ps=sorted({p for p in subprocess.run(['git','ls-files','-z','-c','-o','--exclude-standard'],capture_output=True).stdout.decode().split(chr(0)) if p and os.path.isfile(p) and not os.path.islink(p) and not p.endswith('.pyc') and not set(p.split('/'))&{'__pycache__','.pytest_cache'}},key=lambda p:p.encode());print(hashlib.sha256(''.join(hashlib.sha256(open(p,'rb').read()).hexdigest()+'  '+p+chr(10) for p in ps).encode()).hexdigest())";
    expect(treeHash(t.repo)).toBe(sh(t.repo, 'python3 -c "' + py + '"'));
  });
  test('Python caches, ignored files and .git do not change it; a tracked or new file does', () => {
    const t = makeTrial();
    const before = treeHash(t.repo);
    sh(t.repo, 'python3 -m compileall -q pkg tests && mkdir -p .pytest_cache/v && echo x > .pytest_cache/v/lastfailed && echo x > pkg/stray.pyc && echo y > .git/info/exclude.note');
    write(join(t.repo, '.git', 'info', 'exclude'), 'CLAUDE.md\n');
    write(join(t.repo, 'CLAUDE.md'), 'placed rules file\n');
    expect(existsSync(join(t.repo, 'pkg', '__pycache__'))).toBe(true);
    expect(treeHash(t.repo)).toBe(before);
    write(join(t.repo, 'changes', 'fix-x.md'), 'Fix.\n');
    const withNew = treeHash(t.repo);
    expect(withNew).not.toBe(before);
    edit(t);
    expect(treeHash(t.repo)).not.toBe(withNew);
  });
});

describe('the agent repository runs nothing on the grading host', () => {
  test('fsmonitor, a clean filter named from info/attributes or .gitattributes, gpg.program with showSignature and a hook: none runs', () => {
    const t = makeTrial(); edit(t); commit(t);
    const marker = (n: string) => join(dirname(t.trial), 'MARKER-' + n);
    const prog = (n: string) => { const p = join(dirname(t.trial), n + '.sh'); write(p, '#!/bin/sh\ntouch ' + marker(n) + '\ncat\n'); sh(t.repo, 'chmod +x ' + p); return p; };
    sh(t.repo, "git cat-file commit HEAD | sed '/^committer /a gpgsig -----BEGIN PGP SIGNATURE-----\\n -----END PGP SIGNATURE-----' > ../c.txt && git update-ref refs/heads/main $(git hash-object -t commit -w ../c.txt)");
    sh(t.repo, ['git config core.fsmonitor ' + prog('fsmonitor'), 'git config filter.x.clean ' + prog('filter'), "echo '* filter=x' > .git/info/attributes", "echo '*.py filter=x' > .gitattributes",
      'git config log.showSignature true', 'git config gpg.program ' + prog('gpg'), 'git config core.hooksPath .git/hooks', 'cp ' + prog('hook') + ' .git/hooks/post-index-change', 'cp ' + prog('hook') + ' .git/hooks/reference-transaction'].join(' && '));
    write(join(t.repo, 'pkg', 'mod.py'), 'def f():\n    return 3\n');
    sh(t.repo, 'git log -1 --format=%B >/dev/null 2>&1; git status >/dev/null 2>&1; true');
    const ran = () => ['fsmonitor', 'filter', 'gpg', 'hook'].filter((n) => existsSync(marker(n)));
    expect(ran()).toEqual(['fsmonitor', 'filter', 'gpg', 'hook']);
    for (const n of ran()) rmSync(marker(n));
    const g = grade(t);
    expect(ran()).toEqual([]);
    expect(g.rules.R4).toMatchObject({ state: 'not_met', code: 'R4_UNCOMMITTED' });
    expect(g.rules.R2.code).toBe('R2_NEVER_RAN');
  });
  test('the shard runs the grader with env -i and an allowlist, so no provider key is in its environment', () => {
    const rs = readFileSync(join(import.meta.dir, '..', 'scripts', 'rules-at-scale', 'run-shard.sh'), 'utf8');
    expect(rs).toContain('safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")');
    expect(rs).toContain('"${safe_env[@]}" bun scripts/rules-at-scale/collect.ts ');
  });
});

describe('R1 changes file', () => {
  test('met: a new kebab-case file with a sentence, uncommitted', () => {
    const t = makeTrial(); write(join(t.repo, 'changes', 'fix-return-value.md'), 'Return 2.\n');
    expect(grade(t).rules.R1).toMatchObject({ state: 'met', code: 'R1_MET' });
  });
  test('not met: no file, a bad name, an empty file', () => {
    const t = makeTrial();
    expect(grade(t).rules.R1.code).toBe('R1_NO_CHANGES_FILE');
    write(join(t.repo, 'changes', 'Fix_Return.md'), 'x\n');
    expect(grade(t).rules.R1).toMatchObject({ state: 'not_met', code: 'R1_BAD_NAME' });
    write(join(t.repo, 'changes', 'fix-return.md'), '  \n');
    expect(grade(t).rules.R1).toMatchObject({ state: 'not_met', code: 'R1_EMPTY' });
  });
  test('not met: a file that was already there at the base', () => {
    const t = makeTrial();
    write(join(t.repo, 'changes', 'old-entry.md'), 'Old.\n'); sh(t.repo, 'git add -A && git commit -q -m old');
    const g = gradeTrial({ trial: t.trial, taskDir: t.task, base: sh(t.repo, 'git rev-parse HEAD') });
    expect(g.rules.R1.code).toBe('R1_NO_CHANGES_FILE');
  });
  test('unscorable: no work artifact', () => {
    const t = makeTrial(); rmSync(join(t.trial, 'artifacts'), { recursive: true });
    const g = grade(t);
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const) expect(g.rules[id]).toMatchObject({ state: 'unscorable', code: 'WORK_MISSING' });
    expect(g.rules.R1.evidence.path).toBe(t.trial);
  });
});

describe('R2 precheck', () => {
  const stamp = (t: Trial, exit: number, tree: string) => appendFileSync(join(t.he, 'precheck.jsonl'), JSON.stringify({ t: iso(0), exit, tree }) + '\n');
  test('met: last run passed on the final tree', () => { const t = makeTrial(); edit(t); stamp(t, 1, '0'.repeat(64)); stamp(t, 0, treeHash(t.repo)); expect(grade(t).rules.R2.state).toBe('met'); });
  test('not met: never ran, last run failed, tree changed after', () => {
    const t = makeTrial();
    expect(grade(t).rules.R2.code).toBe('R2_NEVER_RAN');
    stamp(t, 1, treeHash(t.repo));
    expect(grade(t).rules.R2.code).toBe('R2_LAST_FAILED');
    stamp(t, 0, treeHash(t.repo)); edit(t);
    expect(grade(t).rules.R2).toMatchObject({ state: 'not_met', code: 'R2_TREE_CHANGED' });
  });
  test('unscorable: a cut last line, a line that is not JSON, no .he folder', () => {
    const t = makeTrial(); write(join(t.he, 'precheck.jsonl'), '{"t": "x", "exit": 0');
    expect(grade(t).rules.R2).toMatchObject({ state: 'unscorable', code: 'PRECHECK_LOG_TRUNCATED' });
    write(join(t.he, 'precheck.jsonl'), 'not json\n');
    expect(grade(t).rules.R2).toMatchObject({ state: 'unscorable', code: 'PRECHECK_LOG_JSON', evidence: { path: join(t.he, 'precheck.jsonl') } });
    write(join(t.he, 'precheck.jsonl'), JSON.stringify({ t: iso(0), exit: 0 }) + '\n');
    expect(grade(t).rules.R2).toMatchObject({ state: 'unscorable', code: 'PRECHECK_LOG_FIELDS' });
    rmSync(t.he, { recursive: true });
    expect(grade(t).rules.R2.code).toBe('HE_DIR_MISSING');
  });
});

describe('R3 existing tests unchanged', () => {
  test('met: a new test file beside the old one', () => { const t = makeTrial(); write(join(t.repo, 'tests', 'test_new.py'), 'def test_x():\n    pass\n'); expect(grade(t).rules.R3.state).toBe('met'); });
  test('not met: changed or deleted, inside tests_dir or by name elsewhere', () => {
    const t = makeTrial(); write(join(t.repo, 'tests', 'test_mod.py'), 'changed\n');
    expect(grade(t).rules.R3).toMatchObject({ state: 'not_met', code: 'R3_CHANGED' });
    rmSync(join(t.repo, 'tests', 'test_mod.py'));
    expect(grade(t).rules.R3.code).toBe('R3_DELETED');
  });
  test('not applicable: the base has no test file', () => {
    const t = makeTrial(); sh(t.repo, 'git rm -q -r tests && git commit -q -m drop');
    expect(gradeTrial({ trial: t.trial, taskDir: t.task, base: sh(t.repo, 'git rev-parse HEAD') }).rules.R3.state).toBe('not_applicable');
  });
  test('unscorable: the base commit is not in the repository', () => {
    const t = makeTrial();
    const g = gradeTrial({ trial: t.trial, taskDir: t.task, base: 'f'.repeat(40) });
    expect(g.rules.R3).toMatchObject({ state: 'unscorable', code: 'BASE_MISSING' });
  });
});

describe('R4 signed commit', () => {
  test('met', () => { const t = makeTrial(); edit(t); commit(t); expect(grade(t).rules.R4.state).toBe('met'); });
  test('not met: no commit, unsigned, uncommitted change left', () => {
    const t = makeTrial(); edit(t);
    expect(grade(t).rules.R4.code).toBe('R4_NO_COMMIT');
    commit(t, false);
    expect(grade(t).rules.R4.code).toBe('R4_UNSIGNED');
    const u = makeTrial(); edit(u); commit(u); write(join(u.repo, 'pkg', 'mod.py'), 'later\n');
    expect(grade(u).rules.R4).toMatchObject({ state: 'not_met', code: 'R4_UNCOMMITTED' });
  });
  test('not met: no main branch, or main rewritten off the base', () => {
    const t = makeTrial(); edit(t); commit(t); sh(t.repo, 'git branch -m main other');
    expect(grade(t).rules.R4.code).toBe('R4_NO_MAIN');
    const u = makeTrial(); sh(u.repo, 'git checkout -q --orphan fresh && git commit -q -s -m new && git branch -D main && git branch -m fresh main');
    expect(grade(u).rules.R4.code).toBe('R4_BASE_NOT_ANCESTOR');
  });
  test('unscorable: the artifact repository has no .git', () => {
    const t = makeTrial(); rmSync(join(t.repo, '.git'), { recursive: true });
    expect(grade(t).rules.R4).toMatchObject({ state: 'unscorable', code: 'REPO_NOT_GIT' });
  });
  test('unscorable with its own code: reftable refs, sha256 objects, a .git file (linked worktree)', () => {
    const codes = (t: Trial) => [...new Set(Object.values(grade(t).rules).map((r) => r.code))];
    const r = makeTrial(); sh(r.repo, 'git config --file .git/config core.repositoryformatversion 1 && git config --file .git/config extensions.refStorage reftable');
    expect(codes(r)).toEqual(['REPO_REFTABLE']);
    if (gitHasReftable) expect(codes(makeTrial('--ref-format=reftable'))).toEqual(['REPO_REFTABLE']);
    expect(codes(makeTrial('--object-format=sha256'))).toEqual(['REPO_SHA256']);
    const w = makeTrial(); sh(w.repo, 'mv .git ../gitdata && echo "gitdir: ../gitdata" > .git');
    expect(codes(w)).toEqual(['REPO_LINKED_WORKTREE']);
  });
  test('a same-size edit in the second of the last index write still shows as a change (the index keeps its time)', () => {
    const t = makeTrial(), at = '@1700000000';
    sh(t.repo, 'touch -d ' + at + ' pkg/mod.py && git update-index --refresh');
    edit(t);
    sh(t.repo, 'touch -d ' + at + ' pkg/mod.py .git/index');
    expect(git(t.repo, ['status', '--porcelain']).out).toContain('M pkg/mod.py');
    expect(grade(t).rules.R5).toMatchObject({ state: 'unscorable', code: 'EDITS_LOG_MISSING' });
  });
  test('a split index is read through its sharedindex file', () => {
    const t = makeTrial(); sh(t.repo, 'git update-index --split-index'); edit(t); commit(t);
    write(join(t.repo, 'pkg', 'extra.py'), 'x = 1\n'); sh(t.repo, 'git add pkg/extra.py');
    expect(sh(t.repo, 'ls .git').split('\n').some((f) => f.startsWith('sharedindex.'))).toBe(true);
    expect(git(t.repo, ['ls-files']).out.split('\n')).toContain('pkg/extra.py');
    expect(grade(t).rules.R4.state).toBe('not_met');
    expect(grade(t).rules.R4.code).toBe('R4_UNCOMMITTED');
  });
});

describe('R5 notes before the first edit', () => {
  const log = (t: Trial, f: string, o: object) => appendFileSync(join(t.he, f), JSON.stringify(o) + '\n');
  test('met, with cache writes before the search ignored', () => {
    const t = makeTrial();
    log(t, 'edits.log', { t: iso(0), path: 'tests/__pycache__/test_mod.cpython-312.pyc', kind: 'created' });
    log(t, 'notes.log', { t: iso(1000), argv: ['search', 'mod'] });
    log(t, 'edits.log', { t: iso(2000), path: 'pkg/mod.py', kind: 'modified' });
    expect(grade(t).rules.R5).toMatchObject({ state: 'met', code: 'R5_MET' });
  });
  test('not met: search after the edit, no search, a usage error only', () => {
    const t = makeTrial();
    log(t, 'edits.log', { t: iso(0), path: 'pkg/mod.py', kind: 'modified' });
    expect(grade(t).rules.R5.code).toBe('R5_NO_SEARCH');
    log(t, 'notes.log', { t: iso(-500), argv: ['list'] });
    expect(grade(t).rules.R5.code).toBe('R5_NO_SEARCH');
    log(t, 'notes.log', { t: iso(500), argv: ['search', 'mod'] });
    expect(grade(t).rules.R5).toMatchObject({ state: 'not_met', code: 'R5_SEARCH_AFTER_EDIT' });
  });
  test('not applicable: no edits (empty log, or no log and an unchanged repository)', () => {
    const t = makeTrial();
    expect(grade(t).rules.R5).toMatchObject({ state: 'not_applicable', code: 'R5_NO_EDITS' });
    write(join(t.he, 'edits.log'), '');
    expect(grade(t).rules.R5.state).toBe('not_applicable');
  });
  test('unscorable: no edits log while the repository changed, a bad line, a bad time', () => {
    const t = makeTrial(); edit(t);
    expect(grade(t).rules.R5).toMatchObject({ state: 'unscorable', code: 'EDITS_LOG_MISSING' });
    write(join(t.he, 'edits.log'), '{oops\n');
    expect(grade(t).rules.R5.code).toBe('EDITS_LOG_JSON');
    write(join(t.he, 'edits.log'), JSON.stringify({ t: 'yesterday', path: 'pkg/mod.py' }) + '\n');
    expect(grade(t).rules.R5.code).toBe('LOG_TIME');
  });
});

describe('R6 full staged diff before the commit', () => {
  const cap = (t: Trial, commands: string[]) => capture(join(t.trial, 'proxy-capture', 'proxy-requests.ndjson'), anthropicSession('sys', commands));
  test('met: edit, stage, diff, commit (also inside one chained command)', () => {
    const t = makeTrial(); edit(t); commit(t);
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git add -A', 'git --no-pager diff --staged', 'git commit -s -m fix']);
    expect(grade(t).rules.R6).toMatchObject({ state: 'met', code: 'R6_MET' });
    cap(t, ["cat > pkg/mod.py <<'EOF'\ndef f():\n    return 2\nEOF", 'git add -A && git diff --cached && git commit -s -m "fix: x"']);
    expect(grade(t).rules.R6.state).toBe('met');
  });
  test('not met: no diff, a path-filtered or stat diff, a diff before the last edit', () => {
    const t = makeTrial(); edit(t); commit(t);
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git add -A', 'git commit -s -m fix']);
    expect(grade(t).rules.R6.code).toBe('R6_NO_STAGED_DIFF');
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git add -A', 'git diff --staged -- pkg/mod.py', 'git diff --staged --stat', 'git diff --cached | head -20', 'git commit -s -m fix']);
    expect(grade(t).rules.R6).toMatchObject({ state: 'not_met', code: 'R6_DIFF_NOT_FULL' });
    cap(t, ['git add -A', 'git diff --staged', "echo x >> pkg/mod.py", 'git add -A', 'git commit -s -m fix']);
    expect(grade(t).rules.R6.code).toBe('R6_NO_STAGED_DIFF');
  });
  test('not met: a staged diff before the staging step it should have shown', () => {
    const t = makeTrial(); edit(t); commit(t);
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git diff --staged', 'git add -A && git commit -s -m fix']);
    expect(grade(t).rules.R6).toMatchObject({ state: 'not_met', code: 'R6_NO_STAGED_DIFF' });
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git diff --staged', 'git commit -a -s -m fix']);
    expect(grade(t).rules.R6.code).toBe('R6_NO_STAGED_DIFF');
  });
  test('unscorable: the last step before the commit is a call the capture does not show', () => {
    const t = makeTrial(); edit(t); commit(t);
    const call = (command: string) => ({ command, cwd: null }) as unknown as Parameters<typeof gradeR6>[0] extends readonly (infer C)[] | unknown ? C : never;
    expect(gradeR6([call(UNREAD as unknown as string), call('git commit -s -m fix')] as never, t.repo, t.base)).toMatchObject({ state: 'unscorable', code: 'R6_UNREAD_STEP' });
  });
  test('met: a multi-line quoted commit message stays one command (Claude Code pilot, 2026-11-19)', () => {
    const t = makeTrial(); edit(t); commit(t);
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git add -A && git diff --staged', 'git commit -s -q -m "Fix f\n\nf returned 1, so callers saw the old value; return 2 && keep\n\'quoted\' text"']);
    expect(grade(t).rules.R6).toMatchObject({ state: 'met', code: 'R6_MET' });
    cap(t, ["sed -i 's/1/2/' pkg/mod.py", 'git add -A', "git commit -s -m 'Fix f\n\nsecond line'"]);
    expect(grade(t).rules.R6.code).toBe('R6_NO_STAGED_DIFF');
  });
  test('not applicable: no commit on main', () => { const t = makeTrial(); edit(t); cap(t, ['git diff --staged']); expect(grade(t).rules.R6.state).toBe('not_applicable'); });
  test('unscorable: capture missing, chain broken, the commit never captured', () => {
    const t = makeTrial(); edit(t); commit(t);
    expect(grade(t).rules.R6).toMatchObject({ state: 'unscorable', code: 'CAPTURE_MISSING' });
    const file = join(t.trial, 'proxy-capture', 'proxy-requests.ndjson');
    write(file, JSON.stringify({ seq: 0, prev: 'bad', route: '/v1/messages', body: {} }) + '\n');
    expect(grade(t).rules.R6).toMatchObject({ state: 'unscorable', code: 'CAPTURE_CHAIN_BROKEN', evidence: { path: file } });
    cap(t, ['git add -A', 'git diff --staged']);
    expect(grade(t).rules.R6.code).toBe('R6_COMMIT_NOT_CAPTURED');
  });
  test('Codex: code-mode exec calls are read through probes.ts', () => {
    const t = makeTrial(); edit(t); commit(t);
    const input: unknown[] = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix it.' }] }];
    const reqs: Array<{ route: string; body: unknown }> = [];
    const tools = [{ type: 'function', name: 'exec' }];
    reqs.push({ route: '/v1/responses', body: { tools, input: [...input] } });
    ['tools.apply_patch("*** Begin Patch\\n*** Update File: pkg/mod.py\\n-1\\n+2\\n*** End Patch")', 'await tools.exec_command({ cmd: "git add -A && git diff --staged" })', 'await tools.exec_command({ cmd: "git commit -s -m fix" })'].forEach((src, i) => {
      input.push({ type: 'custom_tool_call', call_id: 'c' + i, name: 'exec', input: src });
      input.push({ type: 'custom_tool_call_output', call_id: 'c' + i, output: 'ok' });
      reqs.push({ route: '/v1/responses', body: { tools, input: [...input] } });
    });
    capture(join(t.trial, 'proxy-capture', 'proxy-requests.ndjson'), reqs);
    expect(grade(t).rules.R6.state).toBe('met');
  });
});

describe('staged diff parsing', () => {
  test('full and limited forms', () => {
    expect(stagedDiff('git diff --staged')).toEqual({ full: true, why: null });
    expect(stagedDiff('git -C /work/repo diff --cached HEAD')).toEqual({ full: true, why: null });
    expect(stagedDiff('GIT_PAGER=cat git diff --staged | cat')!.full).toBe(true);
    expect(stagedDiff('git diff --staged --name-only')!.full).toBe(false);
    expect(stagedDiff('git diff --staged pkg/mod.py')!.full).toBe(false);
    expect(stagedDiff('git diff --staged > /tmp/d')!.full).toBe(false);
    expect(stagedDiff('git diff')).toBeNull();
    expect(stagedDiff('echo git diff --staged')).toBeNull();
  });
  test('staging steps: add, rm, restore --staged, and a commit that stages by itself', () => {
    for (const s of ['git add -A', 'git -C /work/repo rm pkg/x.py', 'git restore --staged pkg/mod.py', 'git apply --cached p.diff', 'git commit -a -s -m fix', 'git commit -sam fix', 'git commit --all -m x', 'git commit -s -m "fix it" pkg/mod.py', 'git commit -m x -- pkg/mod.py']) expect(stages(s)).toBe(true);
    for (const s of ['git commit -s -m fix', 'git commit -s -q -m "a b"', 'git commit --amend --no-edit -s', 'git commit -s -F msg.txt', 'git status', 'git restore pkg/mod.py', 'git apply p.diff', 'echo git add -A']) expect(stages(s)).toBe(false);
    expect(stages('git --git-dir .git add f')).toBe(true);
    for (const s of ['git read-tree HEAD', 'git read-tree -m -u HEAD', 'git add -- -n']) expect(stages(s)).toBe(true);
    for (const s of ['git add -n .', 'git add --dry-run -A', 'git add -An', 'git rm -n pkg/x.py', 'git mv --dry-run a b', 'git read-tree -n HEAD', 'git read-tree --dry-run HEAD', 'git read-tree -mn HEAD']) expect(stages(s)).toBe(false);
  });
  test('a plain commit with a redirection, a pipe, a heredoc or a > or | in its message does not stage', () => {
    for (const s of ['git commit -s -m "fix bug" 2>&1', 'git commit -s -m "fix bug" 2>&1 | tail -5', 'git commit -m "fix" 2>/dev/null', 'git commit -m "fix" &>/dev/null', 'git commit -F msg.txt < /dev/null',
      'git commit -s -m "map a -> b"', 'git commit -s -m "fix a | b"', "git commit -s -m 'return 2 > 1'", 'git commit -m"a b"']) expect(stages(s)).toBe(false);
    expect(commandSteps("git commit -s -F - <<'EOF'\nfix\nEOF", null)).toEqual([{ t: 'commit' }]);
    expect(stages('git commit -a -s -m "x" 2>&1 | tail')).toBe(true);
    expect(shellWords('git commit -m "a > b" 2>&1 >out x | tail')).toEqual(['git', 'commit', '-m', 'a > b', 'x']);
  });
  test('wrapped shells and cd', () => {
    expect(commandSteps("bash -lc 'git add -A && git diff --staged && git commit -s -m x'", null).map((s) => s.t)).toEqual(['stage', 'staged_diff', 'commit']);
    expect(commandSteps('cd /tmp && echo x > notes.txt', null)).toEqual([]);
  });
});

describe('delivery', () => {
  const file = (t: Trial) => join(t.trial, 'proxy-capture', 'proxy-requests.ndjson');
  test('whole at start, then a rule fetched later by a read before the first edit', () => {
    const t = makeTrial();
    const sys = '# Project guidelines\n\n## Repository conventions\n\n' + R.R1 + '\n' + R.R2 + '\n';
    capture(file(t), anthropicSession(sys, ['cat AGENTS.md', "sed -i 's/1/2/' pkg/mod.py"], { toolText: R.R3 + '\n' }));
    const d = grade(t).delivery;
    expect(d.state).toBe('scored');
    expect(d.summary.R1).toMatchObject({ at_start: 'whole', first_whole_seq: 0 });
    expect(d.summary.R3).toMatchObject({ at_start: 'absent', first_fetched_seq: 1, fetched_before_first_edit: true });
    expect(d.summary.R4.at_start).toBe('absent');
    expect(d.requests[1]!.rules.R3.state).toBe('fetched_later');
  });
  test('partial: Codex cuts mid-line with no marker', () => {
    const t = makeTrial();
    const cut = '# AGENTS.md instructions for /work/repo\n\n<INSTRUCTIONS>\n' + R.R2 + '\n' + R.R5.slice(0, 40) + '\n</INSTRUCTIONS>';
    capture(file(t), [{ route: '/v1/responses', body: { tools: [{ type: 'function', name: 'shell' }], input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'base' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: cut }] }] } }]);
    const d = grade(t).delivery;
    expect(d.summary.R2.at_start).toBe('whole');
    expect(d.summary.R5.at_start).toBe('partial');
    expect(d.summary.R6.at_start).toBe('absent');
  });
  test('OpenClaw digest and truncation markers, Hermes marker', () => {
    const t = makeTrial();
    const sys = '# Project Context\n## AGENTS.md\n' + R.R1 + '\n[...truncated, read AGENTS.md for full content...]\n[Policy digest from AGENTS.md]\n' + R.R4 + '\n[...12 more policy lines omitted...]\n\u2026(truncated AGENTS.md: kept 9000+policy 6953+3000 chars of 163839)\u2026\n' + R.R6 + '\n## Bootstrap Context Notice [Bootstrap truncation warning]';
    capture(file(t), [{ route: '/v1/chat/completions', body: { tools: [{ type: 'function', function: { name: 'exec' } }], messages: [{ role: 'system', content: sys }, { role: 'user', content: 'go' }] } }]);
    const d = grade(t).delivery;
    expect(d.requests[0]!.markers).toEqual(['openclaw_truncated', 'openclaw_digest', 'openclaw_kept', 'openclaw_bootstrap_warning']);
    expect(d.summary.R4).toMatchObject({ at_start: 'whole', digest_hit: true });
    expect(d.summary.R1).toMatchObject({ at_start: 'whole', digest_hit: false });
    const h = makeTrial();
    capture(file(h), [{ route: '/v1/chat/completions', body: { tools: [{ type: 'function' }], messages: [{ role: 'system', content: R.R1 + '\n[...truncated AGENTS.md: kept 43008+12288 of 163853 chars. The middle is omitted.]' }] } }]);
    expect(grade(h).delivery.requests[0]!.markers).toEqual(['hermes_truncated']);
  });
  test('a rule the model repeats in its own turn is not delivered', () => {
    expect(ruleState(requestTexts({ wire: 'anthropic-messages', body: { system: 'x', messages: [{ role: 'assistant', content: [{ type: 'text', text: R.R1 }] }] } }), ruleBody(R.R1))).toBe('absent');
    expect(partialLength('abc', ruleBody(R.R1))).toBe(0);
  });
  test('unscorable: no capture, or a capture cut by the size cap, with code, path and step', () => {
    const t = makeTrial();
    const d = grade(t).delivery;
    expect(d).toMatchObject({ state: 'unscorable', code: 'CAPTURE_MISSING', step: 'locating the capture' });
    expect(d.summary.R1.at_start).toBe('unscorable');
    capture(file(t), anthropicSession('s', []));
    appendFileSync(file(t), JSON.stringify({ seq: 1, prev: 'x', truncated: true }) + '\n');
    expect(grade(t).delivery).toMatchObject({ state: 'unscorable', path: file(t) });
    expect(existsSync(file(t))).toBe(true);
  });
});

describe('qmSoulDelivered', () => {
  const p = '# This session\n## Organization instructions\nR1 text here\n# QM';
  test('whole when the SOUL starts the section after the heading, absent otherwise, unscorable with no heading', () => {
    expect([qmSoulDelivered(p, 'R1 text here\n'), qmSoulDelivered(p, 'R2 text'), qmSoulDelivered(p, 'text here'), qmSoulDelivered('# QM', 'R1 text here'), qmSoulDelivered('R1 text here\n' + QM_SOUL_HEADING, 'R1 text here')])
      .toEqual(['whole', 'absent', 'absent', 'unscorable', 'absent']);
  });
  test('only the system prompt counts: the SOUL in a user turn is not delivery', () => {
    const user = { role: 'user', content: [{ type: 'text', text: QM_SOUL_HEADING + '\nR1 text here' }] };
    expect(qmSoulDelivered(systemText({ wire: 'anthropic-messages', body: { system: '# QM', messages: [user] } } as never), 'R1 text here')).toBe('unscorable');
    expect(qmSoulDelivered(systemText({ wire: 'anthropic-messages', body: { system: [{ type: 'text', text: QM_SOUL_HEADING }, { type: 'text', text: 'R1 text here' }], messages: [user] } } as never), 'R1 text here')).toBe('whole');
    expect(qmSoulDelivered(systemText({ wire: 'openai-responses', body: { instructions: '# QM', input: [{ type: 'message', ...user }, { type: 'message', role: 'developer', content: QM_SOUL_HEADING + '\n\nR1 text here' }] } } as never), 'R1 text here')).toBe('whole');
  });
});
