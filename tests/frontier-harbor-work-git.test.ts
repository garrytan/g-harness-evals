// scripts/frontier-harbor/work-git.sh, keyless, no VM: a finished frontier trial's work trees (work/repo and
// work/remote.git) go into a shard's packed replica as git bundles of the agent's new commits against the task's base
// (tasks/repo/<suite>/<split>/<task>/environment/work.tar), its refs, and one binary diff of what it left uncommitted,
// instead of the raw trees (Amendment 1, added 2026-11-15 (3)). The fixture is the real ship-01 base with an agent's work
// on top: commits, a push to remote.git, staged, unstaged, deleted, untracked, binary, executable and symlinked files.
//
// Value: protects=a lost VM's work trees can be rebuilt from the replica alone, file for file, refs and remote.git
// included; a key-shaped string in a commit the final tree no longer holds is still caught; a repo the base cannot
// explain fails the pack (so the mirror keeps the raw tree) instead of packing a partial copy; the agent's own git config
// and attributes never run a command on the controller; fails_when=the rebuilt tree differs from the raw tree in any
// non-ignored file, mode, symlink, ref or HEAD, or any of the guards above stops holding; seam=work-git.sh pack and
// rebuild on temporary copies; no_claim=a real VM, Harbor, or files git ignores (listed in repo.ignored, not rebuilt).

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'frontier-harbor', 'work-git.sh');
const base = (task: string) => join(ROOT, 'tasks', 'repo', 'gstack-delivery-v1', 'dev', task, 'environment', 'work.tar');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const KEY_SHAPED = 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(24);
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), LANG: 'C' };

function sh(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...ENV, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
const commit = (cwd: string, msg: string) => { sh(cwd, ['add', '-A']); sh(cwd, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg]); };
function work(task: string) {
  const dir = mkdtempSync(join(tmpdir(), 'he-work-git-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'work'));
  expect(spawnSync('tar', ['-C', join(dir, 'work'), '-xf', base(task)]).status).toBe(0);
  return dir;
}
function run(args: string[]) {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: ENV, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
/** Every non-ignored file under a work tree, outside .git: its bytes, its executable bit, or its symlink target. */
function files(repo: string) {
  const ignored = new Set(sh(repo, ['-c', 'core.hooksPath=/dev/null', 'ls-files', '-o', '-i', '--exclude-standard', '--directory']).split('\n').filter(Boolean).map((p) => p.replace(/\/$/, '')));
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), rel = relative(repo, p);
      if (rel === '.git' || ignored.has(rel)) continue;
      const s = lstatSync(p);
      if (s.isSymbolicLink()) out[rel] = 'link:' + readlinkSync(p);
      else if (s.isDirectory()) walk(p);
      else out[rel] = (s.mode & 0o100 ? 'x:' : 'f:') + readFileSync(p).toString('base64');
    }
  };
  walk(repo);
  return out;
}
const refs = (gitDir: string) => sh(gitDir, ['for-each-ref', '--format=%(objectname) %(refname) %(symref)']);
const head = (gitDir: string) => sh(gitDir, ['symbolic-ref', '-q', 'HEAD']) || sh(gitDir, ['rev-parse', 'HEAD']);

/** An agent's ship-01 session on the real base: two commits on the feature branch, the first pushed to remote.git, a
 *  third commit that adds and then a fourth that removes a file, and staged, unstaged, deleted, untracked, binary,
 *  executable, symlinked and ignored files left over. */
function shipSession(dir: string, secret = 'harmless') {
  const repo = join(dir, 'work', 'repo');
  writeFileSync(join(repo, 'inflection', '__init__.py'), readFileSync(join(repo, 'inflection', '__init__.py'), 'utf8') + '\n# rule one\n');
  commit(repo, 'rule one');
  writeFileSync(join(repo, 'logo.bin'), Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37) % 256)));
  commit(repo, 'binary logo');
  sh(repo, ['push', '-q', '../remote.git', 'HEAD:refs/heads/feature/3a9dd9']);
  sh(repo, ['update-ref', 'refs/remotes/origin/feature/3a9dd9', 'HEAD']);
  writeFileSync(join(repo, 'notes.txt'), 'TOKEN = "' + secret + '"\n');
  commit(repo, 'notes');
  unlinkSync(join(repo, 'notes.txt'));
  commit(repo, 'drop notes');
  writeFileSync(join(repo, 'VERSION'), '9.9.9\n');
  sh(repo, ['add', 'VERSION']);
  writeFileSync(join(repo, 'CHANGELOG.md'), readFileSync(join(repo, 'CHANGELOG.md'), 'utf8') + '\n- unstaged line\n');
  unlinkSync(join(repo, 'MANIFEST.in'));
  chmodSync(join(repo, 'setup.py'), 0o755);
  mkdirSync(join(repo, 'tests_feature'), { recursive: true });
  writeFileSync(join(repo, 'tests_feature', 'test_rules.py'), 'def test_x():\n    assert True\n');
  writeFileSync(join(repo, 'blob.dat'), Buffer.from([0, 255, 0, 1, 2, 3, 0, 10, 13, 0]));
  symlinkSync('inflection/__init__.py', join(repo, 'entry.py'));
  mkdirSync(join(repo, '__pycache__'), { recursive: true });
  writeFileSync(join(repo, '__pycache__', 'x.pyc'), 'cache');
  return repo;
}

describe('work-git.sh packs a finished trial\'s work trees against the task base and rebuilds them (Amendment 1, added 2026-11-15 (3))', () => {
  test('a ship trial: the rebuilt repo matches the raw tree file for file, with its refs and HEAD, and remote.git\'s refs', () => {
    const dir = work('gd-dev-ship-01');
    const repo = shipSession(dir);
    const raw = files(repo);
    const packed = join(dir, 'packed');
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), packed]);
    expect(p.code, p.err).toBe(0);
    expect(readdirSync(packed).sort()).toEqual(['base.sha256', 'remote.git.bundle', 'remote.git.head', 'remote.git.refs', 'repo.bundle', 'repo.diff', 'repo.head', 'repo.ignored', 'repo.logs', 'repo.refs']);
    expect(readFileSync(join(packed, 'repo.ignored'), 'utf8')).toContain('__pycache__/');
    const out = join(dir, 'rebuilt');
    const b = run(['rebuild', packed, base('gd-dev-ship-01'), out]);
    expect(b.code, b.err).toBe(0);
    expect(files(join(out, 'repo'))).toEqual(raw);
    expect(Object.keys(raw)).toEqual(expect.arrayContaining(['logo.bin', 'blob.dat', 'entry.py', 'tests_feature/test_rules.py', 'VERSION']));
    expect(raw['MANIFEST.in']).toBeUndefined();
    expect(raw['setup.py'].startsWith('x:')).toBe(true);
    expect(refs(join(out, 'repo'))).toBe(refs(repo));
    expect(head(join(out, 'repo'))).toBe(head(repo));
    expect(refs(join(out, 'remote.git'))).toBe(refs(join(dir, 'work', 'remote.git')));
    expect(head(join(out, 'remote.git'))).toBe(head(join(dir, 'work', 'remote.git')));
    expect(sh(join(out, 'repo'), ['log', '--format=%s', '-4'])).toBe('drop notes\nnotes\nbinary logo\nrule one');
  }, 60_000);

  test('a review trial with no new commits and no remote.git packs only refs and the diff', () => {
    const dir = work('gd-dev-review-01');
    const repo = join(dir, 'work', 'repo');
    rmSync(join(dir, 'work', 'remote.git'), { recursive: true, force: true });
    writeFileSync(join(repo, 'review-notes.md'), 'looks fine\n');
    const packed = join(dir, 'packed');
    const p = run(['pack', join(dir, 'work'), base('gd-dev-review-01'), packed]);
    expect(p.code, p.err).toBe(0);
    expect(readdirSync(packed).filter((f) => f.endsWith('.bundle') || f.startsWith('remote.git'))).toEqual([]);
    const out = join(dir, 'rebuilt');
    expect(run(['rebuild', packed, base('gd-dev-review-01'), out]).code).toBe(0);
    expect(files(join(out, 'repo'))).toEqual(files(repo));
    expect(existsSync(join(out, 'remote.git'))).toBe(false);
  }, 60_000);

  test('key-shaped text in a commit the final tree no longer holds stops the pack with exit 3', () => {
    const dir = work('gd-dev-ship-01');
    shipSession(dir, KEY_SHAPED);
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), join(dir, 'packed'), '--scan', 'sk-' + 'ant-(api|admin|oat)[0-9]{2}-[A-Za-z0-9_-]{16,}']);
    expect(p.code).toBe(3);
    expect(p.err).toContain('key-shaped text in a commit of repo');
    expect(p.err).not.toContain(KEY_SHAPED);
  }, 60_000);

  test('a repo the base cannot explain fails the pack, so the mirror keeps the raw tree', () => {
    const dir = work('gd-dev-ship-01');
    const repo = join(dir, 'work', 'repo');
    for (const f of readdirSync(join(repo, '.git', 'objects')).filter((f) => /^[0-9a-f]{2}$/.test(f))) rmSync(join(repo, '.git', 'objects', f), { recursive: true });
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), join(dir, 'packed')]);
    expect(p.code).not.toBe(0);
    expect(p.code).not.toBe(3);
    const other = work('gd-dev-ship-01');
    shipSession(other);
    const q = run(['pack', join(other, 'work'), base('gd-dev-review-01'), join(other, 'packed')]);
    expect(q.code).not.toBe(0);
    expect(q.code).not.toBe(3);
  }, 60_000);

  test('the agent\'s git config, hooks and attributes run nothing during the pack', () => {
    const dir = work('gd-dev-ship-01');
    const repo = shipSession(dir);
    const marker = join(dir, 'ran');
    const cmd = 'touch ' + marker;
    writeFileSync(join(repo, '.gitattributes'), '* filter=x diff=x\n');
    const raw = files(repo);
    writeFileSync(join(repo, '.git', 'config'), readFileSync(join(repo, '.git', 'config'), 'utf8') + '[core]\n\tfsmonitor = "' + cmd + '"\n[filter "x"]\n\tclean = "' + cmd + '"\n[diff "x"]\n\ttextconv = "' + cmd + '"\n\tcommand = "' + cmd + '"\n');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    for (const h of ['post-index-change', 'reference-transaction', 'post-checkout']) { writeFileSync(join(repo, '.git', 'hooks', h), '#!/bin/sh\n' + cmd + '\n'); chmodSync(join(repo, '.git', 'hooks', h), 0o755); }
    const packed = join(dir, 'packed');
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), packed]);
    expect(p.code, p.err).toBe(0);
    expect(existsSync(marker)).toBe(false);
    const out = join(dir, 'rebuilt');
    expect(run(['rebuild', packed, base('gd-dev-ship-01'), out]).code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(files(join(out, 'repo'))).toEqual(raw);
  }, 60_000);

  test('a repo that is a symlink to another repository is refused, and that repository keeps its hooks and config', () => {
    const dir = work('gd-dev-ship-01');
    const victim = join(work('gd-dev-ship-01'), 'work', 'repo');
    mkdirSync(join(victim, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(victim, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
    const config = readFileSync(join(victim, '.git', 'config'), 'utf8') + '[user]\n\tname = victim\n';
    writeFileSync(join(victim, '.git', 'config'), config);
    rmSync(join(dir, 'work', 'repo'), { recursive: true });
    symlinkSync(victim, join(dir, 'work', 'repo'));
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), join(dir, 'packed')]);
    expect(p.code).toBe(1);
    expect(p.err).toContain('repo is a symlink');
    expect(existsSync(join(victim, '.git', 'hooks', 'pre-commit'))).toBe(true);
    expect(readFileSync(join(victim, '.git', 'config'), 'utf8')).toBe(config);
  }, 60_000);

  test('a failed pack leaves no temp folder behind', () => {
    const dir = work('gd-dev-ship-01');
    shipSession(dir);
    const tmp = join(dir, 'tmp');
    mkdirSync(tmp);
    const r = spawnSync('bash', [SCRIPT, 'pack', join(dir, 'work'), base('gd-dev-review-01'), join(dir, 'packed')], { encoding: 'utf8', env: { ...ENV, TMPDIR: tmp }, timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(readdirSync(tmp)).toEqual([]);
    const ok = spawnSync('bash', [SCRIPT, 'pack', join(dir, 'work'), base('gd-dev-ship-01'), join(dir, 'packed')], { encoding: 'utf8', env: { ...ENV, TMPDIR: tmp }, timeout: 60_000 });
    expect(ok.status, ok.stderr).toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
  }, 60_000);

  test('a worktree config and an attributes file the agent wrote run nothing during the pack', () => {
    const dir = work('gd-dev-ship-01');
    const repo = shipSession(dir);
    const marker = join(dir, 'ran');
    const attrs = join(dir, 'attrs');
    writeFileSync(attrs, '* filter=x\n');
    writeFileSync(join(repo, '.git', 'config'), readFileSync(join(repo, '.git', 'config'), 'utf8') + '[extensions]\n\tworktreeConfig = true\n[include]\n\tpath = ' + join(dir, 'inc') + '\n');
    writeFileSync(join(dir, 'inc'), '[filter "x"]\n\tclean = "touch ' + marker + '; cat"\n');
    writeFileSync(join(repo, '.git', 'config.worktree'), '[core]\n\tattributesFile = ' + attrs + '\n[filter "x"]\n\tclean = "touch ' + marker + '; cat"\n');
    const p = run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), join(dir, 'packed')]);
    expect(p.code, p.err).toBe(0);
    expect(existsSync(marker)).toBe(false);
  }, 60_000);

  test('rebuild refuses a base whose sha256 is not the one the pack recorded', () => {
    const dir = work('gd-dev-ship-01');
    shipSession(dir);
    const packed = join(dir, 'packed');
    expect(run(['pack', join(dir, 'work'), base('gd-dev-ship-01'), packed]).code).toBe(0);
    const b = run(['rebuild', packed, base('gd-dev-review-01'), join(dir, 'rebuilt')]);
    expect(b.code).not.toBe(0);
    expect(b.err).toContain('sha256');
  }, 60_000);
});
