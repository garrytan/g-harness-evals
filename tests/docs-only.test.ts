// scripts/ci/docs-only.ts decides whether public CI may skip typecheck and the test suite for a change. These tests pin
// the reader rules (named path, join chain, listing, glob, unresolved chain) and the CLI on a scratch repository.
// Keyless; every spawned process gets PATH, HOME and TMPDIR only.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { disqualifier, readMarkdown, readsOf, type Tree } from '../scripts/ci/docs-only.ts';

const ROOT = resolve(import.meta.dir, '..');
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const DOCS = ['docs/guides/unread.md', 'docs/guides/other.md', 'docs/notes/a.md', 'docs/benchmarks/run/report.md', 'docs/scoreboard/x.md', 'changelog.d/item.md', 'README.md'];

function tree(files: Record<string, string>): Tree {
  const all = { ...Object.fromEntries(DOCS.map((p) => [p, '# doc\n'])), ...files };
  return { paths: Object.keys(all), text: (p) => all[p] ?? null };
}

const docsOnly = (files: Record<string, string>, changed: string[]) => disqualifier(changed, readMarkdown(tree(files)));

describe('docs-only decision', () => {
  test('a docs/ file no test or script reads qualifies', () => {
    expect(docsOnly({ 'tests/a.test.ts': "import { join } from 'node:path';\nconst X = join(import.meta.dir, '..', 'docs', 'notes', 'a.md');\n" }, ['docs/guides/unread.md'])).toBeNull();
  });

  test('a changelog.d fragment qualifies even when a script reads it', () => {
    expect(docsOnly({ 'scripts/fold.ts': "readFileSync('changelog.d/item.md');\n" }, ['changelog.d/item.md'])).toBeNull();
  });

  test('docs/tool-discipline/README.md is read by tests/tool-discipline-receipts.test.ts through join(DOCS, \'README.md\')', () => {
    const file = 'tests/tool-discipline-receipts.test.ts';
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).not.toContain('docs/tool-discipline/README.md');
    const md = ['docs/tool-discipline/README.md', 'docs/tool-discipline/LABEL-RULES.md', 'README.md'];
    const reads = readsOf(file, text, md, new Set(['.', 'docs', 'docs/tool-discipline', 'tests']));
    expect(reads.has('docs/tool-discipline/README.md')).toBe(true);
    expect(disqualifier(['docs/tool-discipline/README.md'], reads)).toEqual({ path: 'docs/tool-discipline/README.md', why: 'read by a test, script or data file' });
  });

  test('a join chain through a constant reads its file; a chain that stops at a directory reads everything under it', () => {
    const file = { 'tests/b.test.ts': "const ROOT = resolve(import.meta.dir, '..');\nreadFileSync(join(ROOT, 'docs', 'guides', 'other.md'), 'utf8');\n" };
    expect(docsOnly(file, ['docs/guides/other.md'])?.why).toBe('read by a test, script or data file');
    expect(docsOnly(file, ['docs/guides/unread.md'])).toBeNull();
    const dir = { 'tests/b.test.ts': "const DIR = join(import.meta.dir, '..', 'docs', 'guides');\nsummarize(DIR);\n" };
    expect(docsOnly(dir, ['docs/guides/unread.md'])?.why).toBe('read by a test, script or data file');
    expect(docsOnly(dir, ['docs/notes/a.md'])).toBeNull();
  });

  test('a glob reader disqualifies every file its pattern matches', () => {
    const bunGlob = { 'tests/c.test.ts': "for (const f of new Bun.Glob('*.md').scan({ cwd: join(import.meta.dir, '..', 'docs', 'guides') })) check(f);\n" };
    expect(docsOnly(bunGlob, ['docs/guides/unread.md'])?.why).toBe('read by a test, script or data file');
    expect(docsOnly(bunGlob, ['docs/notes/a.md'])).toBeNull();
    const pyGlob = { 'scripts/d.py': "import glob\nfor f in glob.glob('docs/**/*.md', recursive=True):\n    print(f)\n" };
    expect(docsOnly(pyGlob, ['docs/notes/a.md'])?.why).toBe('read by a test, script or data file');
  });

  test('a readdir of the parent directory disqualifies; a bare directory name does not', () => {
    const lister = { 'scripts/e.ts': "const dir = join(import.meta.dir, '..', 'docs', 'notes');\nfor (const f of readdirSync(dir)) read(join(dir, f));\n" };
    expect(docsOnly(lister, ['docs/notes/a.md'])?.why).toBe('read by a test, script or data file');
    expect(docsOnly(lister, ['docs/guides/unread.md'])).toBeNull();
    expect(docsOnly({ 'scripts/f.ts': "const where = 'docs';\nconsole.log(where, 'guides');\n" }, ['docs/guides/unread.md'])).toBeNull();
  });

  test('an unresolved chain reads every Markdown file under its literal prefix', () => {
    const files = { 'tests/g.test.ts': "export function load(name: string) { return readFileSync(join(import.meta.dir, '..', 'docs', 'guides', name)); }\n" };
    expect(docsOnly(files, ['docs/guides/unread.md'])?.why).toBe('read by a test, script or data file');
    expect(docsOnly(files, ['docs/notes/a.md'])).toBeNull();
    const tpl = { 'tests/h.test.ts': "const page = (n: string) => " + "`docs/notes/${n}.md`;\n" };
    expect(docsOnly(tpl, ['docs/notes/a.md'])?.why).toBe('read by a test, script or data file');
  });

  test('a data file naming the path counts as a reader', () => {
    expect(docsOnly({ 'docs/receipts.json': '{"files": ["docs/guides/unread.md"]}\n' }, ['docs/guides/unread.md'])?.why).toBe('read by a test, script or data file');
  });

  test('non-Markdown, excluded folders, code trees and an empty diff are never docs-only', () => {
    expect(docsOnly({}, ['docs/guides/unread.md', 'scripts/x.ts'])).toEqual({ path: 'scripts/x.ts', why: 'not Markdown' });
    expect(docsOnly({}, ['docs/benchmarks/run/report.md'])?.why).toBe('under docs/benchmarks/');
    expect(docsOnly({}, ['docs/scoreboard/x.md'])?.why).toBe('under docs/scoreboard/');
    expect(docsOnly({}, ['tests/fixtures/notes.md'])?.why).toBe('under tests/');
    expect(docsOnly({}, [])).toEqual({ path: '', why: 'no changed paths' });
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
  git('init', '-q', '-b', 'main');
  write('docs/guide.md', '# guide\n');
  write('docs/tested.md', '# tested\n');
  write('tests/t.test.ts', "readFileSync('docs/tested.md');\n");
  const base = commit('base');
  write('docs/guide.md', '# guide, edited\n');
  const docs = commit('docs');
  write('docs/tested.md', '# tested, edited\n');
  const read = commit('read doc');

  test('prints docs_only=true for an unread doc and false for a read one', () => {
    expect(run('--base', base, '--head', docs).stdout).toBe('docs_only=true\n');
    const r = run('--base', docs, '--head', read);
    expect(r.stdout).toBe('docs_only=false\n');
    expect(r.stderr).toContain('docs/tested.md: read by a test, script or data file');
  });

  test('fails closed on a revision it cannot resolve, and exits 2 without arguments', () => {
    expect(run('--base', 'no-such-rev', '--head', read).stdout).toBe('docs_only=false\n');
    expect(run().status).toBe(2);
  });
});
