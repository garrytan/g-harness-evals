// scripts/ci/docs-only.ts decides whether public CI may skip typecheck and the test suite for a change. The rule is an
// allowlist of human-facing docs that no file under tests/ or scripts/ names; these tests pin the list, the naming rule
// (basename, directory names, globs, the .md extension), the pin check and the CLI on a scratch repository, including
// deletions and renames. Keyless; every spawned process gets PATH, HOME and TMPDIR only.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { disqualifier, listed, namer, sha256, type Reader } from '../scripts/ci/docs-only.ts';

const ROOT = resolve(import.meta.dir, '..');
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const real = (path: string): Reader => ({ path, text: readFileSync(join(ROOT, path), 'utf8') });
const UNRELATED: Reader = { path: 'tests/unrelated.test.ts', text: "import { join } from 'node:path';\nexpect(load(join('area', 'notes.txt'))).toBe(1);\n" };
const verdict = (paths: string[], readers: Reader[], pinned: string[] = []) => disqualifier(paths.map((path) => ({ path, mode: '100644', sha256: sha256(path) })), namer(readers), new Set(pinned));

describe('docs-only list', () => {
  test('README.md, Markdown under docs/ and findings/<name>.md are listed; results, preregistrations, amendments and fragments are not', () => {
    for (const p of ['README.md', 'docs/methods.md', 'docs/guides/deep/page.md', 'findings/claim.md']) expect(listed(p)).toBe(true);
    for (const p of ['docs/benchmarks/run/report.md', 'docs/scoreboard/x.md', 'docs/plans/x/PREREGISTRATION.md', 'docs/PREREGISTRATION-v2.md', 'docs/plans/x/AMENDMENTS.md', 'changelog.d/item.md', 'todos.d/item.md', 'findings/sub/x.md', 'CHANGELOG.md', 'docs/methods.txt', 'tests/fixtures/notes.md', 'notes/README.md']) expect(listed(p)).toBe(false);
  });

  test('an unread docs/ page qualifies', () => {
    expect(verdict(['docs/guides/unread.md'], [UNRELATED])).toBeNull();
  });

  test('a changelog.d or todos.d fragment is never docs-only, read or not', () => {
    expect(verdict(['changelog.d/item.md'], [UNRELATED])).toEqual({ path: 'changelog.d/item.md', why: 'not on the docs-only list' });
    expect(verdict(['todos.d/item.md'], [])?.why).toBe('not on the docs-only list');
  });

  test('a docs/benchmarks or docs/scoreboard file does not qualify', () => {
    expect(verdict(['docs/benchmarks/run/report.md'], [])?.why).toBe('not on the docs-only list');
    expect(verdict(['docs/scoreboard/x.md'], [])?.why).toBe('not on the docs-only list');
  });

  test('tests/version.test.ts lists every Markdown file through git ls-files, so every version-bearing page is ineligible', () => {
    const version = real('tests/version.test.ts');
    expect(version.text).toContain("'ls-files', '*.md'");
    for (const p of ['README.md', 'docs/guides/unread.md', 'docs/methods.md', 'findings/claim.md']) expect(verdict([p], [UNRELATED, version])).toEqual({ path: p, why: 'named by tests/version.test.ts' });
  });

  test('docs/tool-discipline/README.md is named by tests/tool-discipline-receipts.test.ts and does not qualify', () => {
    const reader = real('tests/tool-discipline-receipts.test.ts');
    expect(reader.text).not.toContain('docs/tool-discipline/README.md');
    expect(verdict(['docs/tool-discipline/README.md'], [reader])).toEqual({ path: 'docs/tool-discipline/README.md', why: 'named by tests/tool-discipline-receipts.test.ts' });
  });

  test('a basename, a directory name, a glob or the .md extension names a path; a longer word does not', () => {
    const r = (text: string): Reader[] => [{ path: 'scripts/r.ts', text }];
    expect(verdict(['docs/guides/unread.md'], r("readFileSync('unread.md')"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r('// see the guides folder.'))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("const d = join(ROOT, 'docs');"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("new Bun.Glob('guides/*.md')"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("glob('un*')"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("files.filter((f) => f.endsWith('.md'))"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("const ext = 'md';"))?.why).toBe('named by scripts/r.ts');
    expect(verdict(['docs/guides/unread.md'], r("run('docs-only', 'guidesx', 'unread.mdx', 'x * y')"))).toBeNull();
  });

  test('a file whose sha256 a committed file pins does not qualify, nor does a symlink or an empty change', () => {
    expect(verdict(['docs/guides/unread.md'], [UNRELATED], [sha256('docs/guides/unread.md')])).toEqual({ path: 'docs/guides/unread.md', why: 'its sha256 is pinned by a committed file' });
    expect(disqualifier([{ path: 'docs/guides/unread.md', mode: '120000', sha256: null }], namer([]), new Set())?.why).toBe('not a regular file');
    expect(disqualifier([], namer([]), new Set())).toEqual({ path: '', why: 'no changed paths' });
  });
});

describe('docs-only CLI', () => {
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() };
  const dir = mkdtempSync(join(tmpdir(), 'docs-only-'));
  scratch.push(dir);
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1' } });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const write = (p: string, text: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
  const commit = (msg: string) => { git('add', '-A'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const run = (...args: string[]) => spawnSync('bun', [join(ROOT, 'scripts', 'ci', 'docs-only.ts'), ...args], { cwd: dir, encoding: 'utf8', env });
  const branch = (name: string, from: string, edit: () => void) => { git('checkout', '-q', '-b', name, from); edit(); const h = commit(name); git('checkout', '-q', 'main'); return h; };
  git('init', '-q', '-b', 'main');
  write('docs/guide.md', '# guide\n');
  write('docs/area/tested.md', '# tested\n');
  write('docs/pinned.md', '# pinned\n');
  write('receipts/pins.json', JSON.stringify({ pinned: sha256('# pinned\n') }) + '\n');
  write('tests/t.test.ts', "load('area', 'tested.md');\n");
  const base = commit('base');
  const edited = branch('edit', base, () => write('docs/guide.md', '# guide, edited\n'));
  const renamedUnread = branch('rename-unread', base, () => { git('mv', 'docs/guide.md', 'docs/guide-2.md'); });
  const read = branch('read', base, () => write('docs/area/tested.md', '# tested, edited\n'));
  const deleted = branch('delete', base, () => { git('rm', '-q', 'docs/area/tested.md'); });
  const renamed = branch('rename', base, () => { git('mv', 'docs/area/tested.md', 'docs/moved.md'); });
  const pinned = branch('pinned', base, () => write('docs/pinned.md', '# pinned, edited\n'));
  const fragment = branch('fragment', base, () => write('changelog.d/x.md', '- a fragment\n'));
  const linked = branch('symlink', base, () => { rmSync(join(dir, 'docs/guide.md')); symlinkSync('../tests/t.test.ts', join(dir, 'docs/guide.md')); });

  test('prints docs_only=true for an unread doc edited or renamed', () => {
    expect(run('--base', base, '--head', edited, '--tree', edited).stdout).toBe('docs_only=true\n');
    expect(run('--base', base, '--head', renamedUnread, '--tree', renamedUnread).stdout).toBe('docs_only=true\n');
  });

  test('prints docs_only=false when a read doc is edited, deleted or renamed, a pinned doc changes, a fragment is added or a doc becomes a symlink', () => {
    const cases: [string, string][] = [[read, 'docs/area/tested.md: named by tests/t.test.ts'], [deleted, 'docs/area/tested.md: named by tests/t.test.ts'], [renamed, 'docs/area/tested.md: named by tests/t.test.ts'], [pinned, 'docs/pinned.md: its sha256 is pinned by a committed file'], [fragment, 'changelog.d/x.md: not on the docs-only list'], [linked, 'docs/guide.md: not a regular file']];
    for (const [head, why] of cases) {
      const r = run('--base', base, '--head', head, '--tree', head);
      expect(r.stdout).toBe('docs_only=false\n');
      expect(r.stderr).toContain(why);
    }
  });

  test('fails closed on a revision it cannot resolve, and exits 2 without arguments', () => {
    expect(run('--base', 'no-such-rev', '--head', read).stdout).toBe('docs_only=false\n');
    expect(run().status).toBe(2);
  });

  test('--audit counts the listed docs that qualify', () => {
    expect(run('--audit', '--tree', base).stdout).toBe('1 of 3 Markdown files at ' + base + ' qualify for the docs-only path (3 on the docs-only list before the reader and pin checks)\n');
  });
});
