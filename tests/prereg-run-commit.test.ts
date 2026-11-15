// internal-task: a preregistration's pinned files are checked at the commit its run loads, read from its registry entry's
// run_commit, so a shared-script change on main no longer breaks another run's pins.
//
// Value: protects=pins hold at the run commit while main moves, a wrong hash or an unamended re-pin still fails, and a
// missing commit or shallow clone fails closed; fails_when=the check reads main's tip for an entry with run_commit, falls
// back to the tip when the commit is missing, or accepts a run commit no dated amendment names; why_new=main went red
// three times on 2026-11-15 (#457, #467 and another) on a frozen run's pins.sha256; seam=temporary git repositories with
// merge commits like main's; no_claim=that the real run loaded the commit its entry names.

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ManifestEntry } from '../runner/prereg/prereg.ts';
import { checkPins, runCommitOf } from '../runner/prereg/run-commit.ts';

const PREREG = 'docs/benchmarks/run/PREREGISTRATION.md';
const PINS = 'docs/benchmarks/run/pins.sha256';
const SCRIPT = 'scripts/shared.ts';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'he-run-commit-'));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  const commit = (msg: string) => { git('add', '-A'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const sha = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');
  const pin = (files: Record<string, string>) => write(PINS, Object.entries(files).map(([p, t]) => sha(t) + '  ' + p + '\n').join(''));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.git/info/exclude'), '.capy/\n');
  write(SCRIPT, 'v1\n');
  write('README.md', 'base\n');
  commit('base');
  git('checkout', '-q', '-b', 'prereg');
  write(PREREG, '# Run\n\n## Amendments\n');
  pin({ [SCRIPT]: 'v1\n' });
  commit('preregister');
  git('checkout', '-q', 'main');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '-q', '--no-ff', '-m', 'Merge the preregistration', 'prereg');
  const merge = git('rev-parse', 'HEAD');
  return { dir, git, write, commit, pin, merge, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const entry = (run_commit?: ManifestEntry['run_commit']): ManifestEntry => ({ id: 'run-2026-11', preregistration: PREREG, results: ['docs/benchmarks/run/results/**'], ...(run_commit ? { run_commit } : {}) });

describe('pins checked at the run commit (runner/prereg/run-commit.ts)', () => {
  test('an active run: the pins hold at its merge commit while main changes a pinned script', () => {
    const r = repo();
    try {
      r.write(SCRIPT, 'v2 on main\n');
      r.commit('main changes the shared script');
      expect(checkPins(entry({ commit: r.merge }), PINS, r.dir)).toEqual({ at: r.merge, files: 1, problems: [] });
      expect(checkPins(entry(), PINS, r.dir).problems).toEqual([SCRIPT + ': sha256 differs from its pin in this checkout']);
    } finally { r.done(); }
  });

  test('a merged run: the latest dated amendment names the run commit, and the pins hold there after its results merge', () => {
    const r = repo();
    try {
      r.write(PREREG, '# Run\n\n## Amendments\n\n### Amendment 1 (2026-11-15, before any counted trial)\n');
      r.write(SCRIPT, 'v2 amended\n');
      r.pin({ [SCRIPT]: 'v2 amended\n' });
      const amended = r.commit('Amendment 1');
      r.write('docs/benchmarks/run/results/trials.jsonl', '{}\n');
      r.commit('results');
      r.write(SCRIPT, 'v3 on main\n');
      r.commit('main moves on');
      const rc = { commit: r.merge, amendments: [{ date: '2026-11-15', commit: amended, heading: 'Amendment 1' }] };
      expect(runCommitOf(entry(rc), r.dir)).toBe(amended);
      expect(checkPins(entry(rc), PINS, r.dir)).toEqual({ at: amended, files: 1, problems: [] });
      expect(() => checkPins(entry({ commit: r.merge }), PINS, r.dir)).toThrow(/differs from its copy at the run commit .*a re-pin needs a dated amendment/);
    } finally { r.done(); }
  });

  test('a branch that forked before the preregistration merged and later merged main finds the same run commit', () => {
    const r = repo();
    try {
      r.git('checkout', '-q', '-b', 'old', r.merge + '^1');
      r.write('README.md', 'branch work\n');
      r.commit('work on a branch that forked before the preregistration');
      r.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '-q', '--no-ff', '-m', 'Merge main into the branch', 'main');
      expect(checkPins(entry({ commit: r.merge }), PINS, r.dir)).toEqual({ at: r.merge, files: 1, problems: [] });
    } finally { r.done(); }
  });

  test('a pinned path that is a directory is reported alone and does not shift the paths after it', () => {
    const r = repo();
    try {
      r.write(PREREG, '# Run\n\n### Amendment 1 (2026-11-15)\n');
      r.write(PINS, '0'.repeat(64) + '  scripts\n' + new Bun.CryptoHasher('sha256').update('v1\n').digest('hex') + '  ' + SCRIPT + '\n');
      const amended = r.commit('Amendment 1 pins a directory ahead of a file');
      expect(checkPins(entry({ commit: r.merge, amendments: [{ date: '2026-11-15', commit: amended, heading: 'Amendment 1' }] }), PINS, r.dir).problems).toEqual(['scripts: missing at ' + amended]);
    } finally { r.done(); }
  });

  test('a wrong hash at the run commit still fails', () => {
    const r = repo();
    try {
      r.git('checkout', '-q', '-b', 'bad', r.merge + '^2');
      r.write(SCRIPT, 'changed on the branch\n');
      r.commit('change a pinned file without re-pinning');
      r.git('checkout', '-q', 'main');
      r.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '-q', '--no-ff', '-m', 'Merge the change', 'bad');
      r.write(PREREG, '# Run\n\n### Amendment 1 (2026-11-15)\n');
      const amended = r.commit('Amendment 1 names a commit whose pinned file has changed');
      expect(checkPins(entry({ commit: r.merge, amendments: [{ date: '2026-11-15', commit: amended, heading: 'Amendment 1' }] }), PINS, r.dir).problems).toEqual([SCRIPT + ': sha256 differs from its pin at ' + amended]);
    } finally { r.done(); }
  });

  test('a pinned file changed and re-pinned on main without an amendment fails, and so does moving the run commit by hand', () => {
    const r = repo();
    try {
      r.write(SCRIPT, 'v2\n');
      r.pin({ [SCRIPT]: 'v2\n' });
      const repinned = r.commit('re-pin on main');
      expect(() => checkPins(entry({ commit: r.merge }), PINS, r.dir)).toThrow(/pins\.sha256 in this checkout differs from its copy at the run commit/);
      expect(() => checkPins(entry({ commit: repinned }), PINS, r.dir)).toThrow(/does not add .*PREREGISTRATION\.md against its first parent/);
      expect(() => checkPins(entry({ commit: r.merge, amendments: [{ date: '2026-11-15', commit: repinned, heading: 'Amendment 1' }] }), PINS, r.dir)).toThrow(/has no heading naming "Amendment 1" and 2026-11-15/);
    } finally { r.done(); }
  });

  test('amendments must be dated, in order and later than the run commit before them', () => {
    const r = repo();
    try {
      r.write(PREREG, '# Run\n\n### Amendment 1 (2026-11-15)\n\n### Amendment 2 (2026-11-16)\n');
      const a = r.commit('amendments');
      const one = { date: '2026-11-15', commit: a, heading: 'Amendment 1' };
      expect(() => runCommitOf(entry({ commit: r.merge, amendments: [{ ...one, date: '15 Nov' }] }), r.dir)).toThrow(/is not a YYYY-MM-DD date/);
      expect(() => runCommitOf(entry({ commit: r.merge, amendments: [{ ...one, heading: '' }] }), r.dir)).toThrow(/heading must name/);
      expect(() => runCommitOf(entry({ commit: r.merge, amendments: [{ ...one, date: '2026-11-16', heading: 'Amendment 2' }, one] }), r.dir)).toThrow(/is not a YYYY-MM-DD date on or after/);
      expect(() => runCommitOf(entry({ commit: r.merge, amendments: [one, { ...one, date: '2026-11-16', heading: 'Amendment 2' }] }), r.dir)).toThrow(/does not come after the run commit before it/);
    } finally { r.done(); }
  });

  test('a missing commit, one off HEAD\'s history, or a shallow clone fails closed instead of checking the tip', () => {
    const r = repo();
    const shallow = mkdtempSync(join(tmpdir(), 'he-run-commit-shallow-'));
    try {
      expect(() => checkPins(entry({ commit: 'a'.repeat(40) }), PINS, r.dir)).toThrow(/commit a{40} is not in this checkout; fetch full history/);
      expect(() => checkPins(entry({ commit: r.merge.slice(0, 12) }), PINS, r.dir)).toThrow(/is not a full 40-character/);
      r.git('checkout', '-q', '-b', 'side');
      r.write(PREREG, '# Run\n\n### Amendment 1 (2026-11-15)\n');
      const side = r.commit('an amendment that never reached main');
      r.git('checkout', '-q', 'main');
      expect(() => checkPins(entry({ commit: r.merge, amendments: [{ date: '2026-11-15', commit: side, heading: 'Amendment 1' }] }), PINS, r.dir)).toThrow(/is not an ancestor of HEAD/);
      r.write('README.md', 'later\n');
      r.commit('later');
      execFileSync('git', ['clone', '-q', '--depth', '1', 'file://' + r.dir, join(shallow, 'c')], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: shallow }, stdio: 'ignore' });
      expect(() => checkPins(entry({ commit: r.merge }), PINS, join(shallow, 'c'))).toThrow(/shallow clone .*The pins are not checked at the tip instead/);
    } finally { r.done(); rmSync(shallow, { recursive: true, force: true }); }
  });
});
