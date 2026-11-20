import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildSet, buildTask, CLOSING, diffTrees, plan, readSet, RULES_FILE, SET_DIR, SOURCES, treeDigest } from '../scripts/repo-tasks/rules-fix/build.ts';
import { sanitize } from '../scripts/repo-tasks/rules-fix/fetch-sources.ts';
import { contract } from '../scripts/repo-tasks/rules-fix/contract.ts';
import { BLOBS } from '../scripts/repo-tasks/rules-fix/pin-blobs.ts';
import { readTar } from '../scripts/repo-tasks/delivery/lib.ts';

// The rules-fix-v1 build (internal-task wave 0, lane A; scripts/repo-tasks/rules-fix/README.md): the committed set is what a
// fresh build writes, the selection rules hold, every task carries the task repository contract's files and fields, and
// the acceptance and contract runs passed for every task.
const DEV = join(SET_DIR, 'dev');
const rows = plan();
const toml = (id: string) => Bun.TOML.parse(readFileSync(join(DEV, id, 'task.toml'), 'utf8')) as any;
const ENV = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tmpdir(), LANG: 'C.UTF-8' };
const PERMISSIVE = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];

describe('rules-fix-v1 build', () => {
  test('the committed set is exactly what the build writes', () => {
    const diff = diffTrees(buildSet(), readSet(SET_DIR));
    expect(diff).toEqual([]);
    expect(readdirSync(DEV).filter((n) => !n.endsWith('.json')).sort()).toEqual(rows.map((r) => r.id).sort());
  }, 600_000);

  test('a task builds to the same bytes twice', () => {
    expect(treeDigest(buildTask(rows[0]))).toBe(treeDigest(buildTask(rows[0])));
  }, 120_000);

  test('selection: at least 30 tasks, at least 9 repositories, at most 4 per repository, permissive licences', () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    const per = new Map<string, number>();
    for (const r of rows) per.set(r.task.repo, (per.get(r.task.repo) ?? 0) + 1);
    expect(per.size).toBeGreaterThanOrEqual(9);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(4);
    for (const name of per.keys()) expect(PERMISSIVE).toContain(SOURCES.repos[name].license);
    expect(new Set(rows.map((r) => r.task.fix)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.task.issue)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.task.issue).toMatch(new RegExp('^' + SOURCES.repos[r.task.repo].url + '/issues/\\d+$'));
      expect(r.task.src_files.length).toBeGreaterThanOrEqual(1);
      expect(r.task.src_files.length).toBeLessThanOrEqual(3);
      expect(r.task.test_files.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('ids follow the seeded order and rotation is the index mod 3', () => {
    rows.forEach((r, i) => {
      expect(r.id).toBe('rf-' + String(i + 1).padStart(2, '0'));
      expect(toml(r.id).rotation).toBe(i % 3);
    });
    for (const k of [0, 1, 2]) expect(rows.filter((r) => r.rotation === k).length).toBeGreaterThanOrEqual(Math.floor(rows.length / 3));
  });

  test('every task has the contract fields, the issue text plus the closing line, and a clean repository', () => {
    for (const r of rows) {
      const t = toml(r.id);
      for (const k of ['id', 'rotation', 'package_dir', 'tests_dir', 'base_commit']) expect(t[k]).toBeDefined();
      for (const k of ['repo', 'url', 'commit', 'fix_commit', 'license', 'issue', 'stripped']) expect(t.source[k]).toBeDefined();
      expect(t.workdir).toBe('/work/repo');
      const ins = readFileSync(join(DEV, r.id, 'instruction.md'), 'utf8');
      expect(ins.endsWith('\n\n' + CLOSING + '\n')).toBe(true);
      expect(ins.split(CLOSING).length).toBe(2);
      const work = readTar(readFileSync(join(DEV, r.id, 'environment', 'work.tar')));
      const files = [...work.keys()].filter((p) => p.startsWith('repo/') && !p.startsWith('repo/.git/')).map((p) => p.slice(5));
      expect(files.filter((p) => RULES_FILE.test(p))).toEqual([]);
      expect(files.filter((p) => /^(changes|newsfragments|changelog\.d)\//.test(p))).toEqual([]);
      expect(work.get('repo/scripts/precheck')!.mode).toBe(0o755);
      expect(work.get('repo/scripts/notes')!.mode).toBe(0o755);
      expect(work.get('repo/.git/refs/heads/main')!.data.toString().trim()).toBe(t.base_commit);
      expect(work.get('repo/.git/config')!.data.toString()).toContain('name = Harness Eval\n\temail = eval@harness-evals.invalid');
      expect([...work.keys()].some((p) => p.startsWith('repo/.git/logs/'))).toBe(false);
      const docker = readFileSync(join(DEV, r.id, 'environment', 'Dockerfile'), 'utf8');
      expect(docker).toContain('COPY watch.py /opt/he/watch.py');
      expect(docker).toContain('mkdir -p /work/.he');
      expect(docker).toMatch(/^FROM python@sha256:[0-9a-f]{64}$/m);
      const task = JSON.parse(readFileSync(join(DEV, r.id, 'verifier', 'task.json'), 'utf8'));
      expect(task.hidden.length).toBeGreaterThan(0);
      const tests = readTar(readFileSync(join(DEV, r.id, 'verifier', 'tests.tar')));
      for (const h of task.hidden) expect(tests.has('hidden/' + h)).toBe(true);
    }
  });

  test('each verifier/tests.tar holds exactly the upstream files pinned for it: every git blob and mode matches upstream-blobs.json at the commits sources.json names', () => {
    const pins = JSON.parse(readFileSync(join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'rules-fix', 'upstream-blobs.json'), 'utf8')).tasks;
    expect(Object.keys(pins).sort()).toEqual(rows.map((r) => r.id).sort());
    const blob = (b: Buffer) => createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
    const bad: string[] = [];
    for (const r of rows) {
      const pin = pins[r.id], t = toml(r.id);
      expect([pin.repo, pin.base, pin.fix]).toEqual([r.task.repo, r.task.base, r.task.fix]);
      expect([t.source.commit, t.source.fix_commit]).toEqual([r.task.base, r.task.fix]);
      expect(readdirSync(join(DEV, r.id, 'verifier')).filter((n) => n === 'protected' || n === 'hidden')).toEqual([]);
      const tar = readTar(readFileSync(join(DEV, r.id, 'verifier', 'tests.tar')));
      const want = new Map<string, [string, string]>([...Object.entries(pin.protected as Record<string, [string, string]>).map(([f, b]) => ['protected/' + f, b] as const), ...Object.entries(pin.hidden as Record<string, [string, string]>).map(([f, b]) => ['hidden/' + f, b] as const)]);
      expect(want.size).toBeGreaterThan(0);
      for (const f of new Set([...tar.keys(), ...want.keys()])) {
        const e = tar.get(f), w = want.get(f);
        if (!e) bad.push(r.id + ' ' + f + ': pinned but missing from tests.tar');
        else if (!w) bad.push(r.id + ' ' + f + ': in tests.tar but not pinned');
        else if (blob(e.data) !== w[1] || (e.mode === 0o755 ? '100755' : e.mode === 0o644 ? '100644' : e.mode.toString(8)) !== w[0]) bad.push(r.id + ' ' + f + ': does not match its upstream blob ' + w[1]);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the contract and blob-pin records are the ones scripts/repo-tasks/rules-fix/contract.ts and pin-blobs.ts write', () => {
    expect(typeof contract).toBe('function');
    expect(JSON.parse(readFileSync(join(DEV, 'CONTRACT.json'), 'utf8')).script).toBe('scripts/repo-tasks/rules-fix/contract.ts');
    expect(BLOBS).toBe(join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'rules-fix', 'upstream-blobs.json'));
    expect(JSON.parse(readFileSync(BLOBS, 'utf8')).note).toContain('scripts/repo-tasks/rules-fix/pin-blobs.ts');
  });

  test('every repository has its licence text and a README row', () => {
    const readme = readFileSync(join(SET_DIR, 'README.md'), 'utf8');
    for (const name of new Set(rows.map((r) => r.task.repo))) {
      expect(existsSync(join(SET_DIR, 'LICENSES', name + '.txt'))).toBe(true);
      expect(readme).toContain('| ' + name + ' | [');
    }
  });

  test('acceptance: the upstream fix scores 1 on every run and every check scores 0; the contract checks pass', () => {
    const acc = JSON.parse(readFileSync(join(DEV, 'ACCEPTANCE.json'), 'utf8'));
    const con = JSON.parse(readFileSync(join(DEV, 'CONTRACT.json'), 'utf8'));
    for (const r of rows) {
      const m = acc.tasks[r.id];
      expect(m?.ok).toBe(true);
      expect(m.runs).toBeGreaterThanOrEqual(3);
      const names = m.rows.map((x: any) => x.scenario);
      for (const s of ['oracle', 'start', 'check:noop', 'check:wrong0', 'check:hooks', 'check:shadow', 'check:inifile', 'check:entrypoint', 'check:symlink']) expect(names).toContain(s);
      expect(con.tasks[r.id]?.ok).toBe(true);
    }
  });
});

describe('rules-fix-v1 helpers', () => {
  test('sanitize drops mentions, comments and home folder names but keeps code', () => {
    const s = sanitize('Hi @someone-1, see <!-- template -->this.\n~BT~@property~BT~ and\n```py\n@dataclass\nclass A: ...\n```\nPath /Users/alice/x and C:\\Users\\bob\\y, mail a@b.com\n'.replaceAll('~BT~', String.fromCharCode(96)));
    expect(s).not.toContain('someone-1');
    expect(s).not.toContain('template');
    expect(s).not.toContain('alice');
    expect(s).not.toContain('bob');
    expect(s).toContain('@property');
    expect(s).toContain('@dataclass');
    expect(s).toContain('a@b.com');
  });

  test('watch.py logs created, modified and deleted files and skips .git and caches', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rf-watch-'));
    try {
      const repo = join(d, 'repo'), log = join(d, 'he', 'edits.log');
      mkdirSync(join(repo, '.git'), { recursive: true });
      writeFileSync(join(repo, 'a.py'), 'x = 1\n');
      const p = spawn('/usr/bin/env', ['-i', 'PATH=' + ENV.PATH, 'LANG=C.UTF-8', 'python3', join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'rules-fix', 'template', 'watch.py'), repo, log], { stdio: 'ignore' });
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await wait(1200);
      writeFileSync(join(repo, 'a.py'), 'x = 2\n');
      writeFileSync(join(repo, '.git', 'HEAD'), 'ref\n');
      mkdirSync(join(repo, '__pycache__'));
      writeFileSync(join(repo, '__pycache__', 'a.pyc'), 'c');
      writeFileSync(join(repo, 'b.txt'), 'b\n');
      await wait(1200);
      rmSync(join(repo, 'b.txt'));
      await wait(1200);
      p.kill();
      const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.map((l) => l.path + ':' + l.kind).sort()).toEqual(['a.py:modified', 'b.txt:created', 'b.txt:deleted']);
      for (const l of lines) expect(l.t).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }, 20_000);

  test('the precheck tree hash follows the contract: git-listed regular files, caches dropped, sha256sum-style lines', () => {
    const d = mkdtempSync(join(tmpdir(), 'rf-hash-'));
    try {
      const repo = join(d, 'repo');
      const tplText = readFileSync(join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'rules-fix', 'template', 'precheck'), 'utf8')
        .replace('@@PACKAGE_DIR@@', '"pkg"').replace('@@TESTS_DIR@@', '"tests"').replace('@@SRC_ROOT@@', '""');
      const put = (p: string, s: string) => { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), s); };
      put('scripts/precheck', tplText);
      put('pkg/a.py', 'x = 1\n');
      put('.gitignore', 'ignored.txt\n');
      put('ignored.txt', 'no\n');
      put('pkg/__pycache__/a.cpython-312.pyc', 'c');
      put('.pytest_cache/v/x', 'c');
      put('stray.pyc', 'c');
      const genv = { ...ENV, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
      spawnSync('git', ['init', '-q'], { cwd: repo, env: genv });
      spawnSync('git', ['add', 'pkg/a.py', '.gitignore', 'scripts/precheck'], { cwd: repo, env: genv });
      put('untracked.py', 'y = 2\n');
      const r = spawnSync('/usr/bin/env', ['-i', 'PATH=' + ENV.PATH, 'LANG=C.UTF-8', 'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null', 'python3', '-c', 'import runpy,sys; print(runpy.run_path(sys.argv[1], run_name="x")["tree_hash"]())', join(repo, 'scripts', 'precheck')]);
      const sha = (b: string | Buffer) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
      const want = sha(['.gitignore', 'pkg/a.py', 'scripts/precheck', 'untracked.py'].map((p) => sha(readFileSync(join(repo, p))) + '  ' + p + '\n').join(''));
      expect(r.stdout.toString().trim()).toBe(want);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('precheck and notes compile and hold no repository-specific logic beyond the three paths', () => {
    const tpl = join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'rules-fix', 'template');
    for (const f of ['precheck', 'notes', 'watch.py', 'verify.py']) {
      const r = spawnSync('/usr/bin/env', ['-i', 'PATH=' + ENV.PATH, 'python3', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read().replace("@@", chr(34)))', join(tpl, f)]);
      expect(r.status).toBe(0);
    }
    expect(readFileSync(join(tpl, 'notes'), 'utf8')).not.toContain('/work/repo');
    expect(readFileSync(join(tpl, 'precheck'), 'utf8').match(/@@[A-Z_]+@@/g)!.sort()).toEqual(['@@PACKAGE_DIR@@', '@@SRC_ROOT@@', '@@TESTS_DIR@@']);
  });
});
