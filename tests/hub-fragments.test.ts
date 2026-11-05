// TODOS.md is rendered from todos.d/ by scripts/fold-hub-fragments.ts (internal-task's housekeeping fold today, gstack's land
// later). These tests pin the render (deterministic, idempotent), the fragment format and the CI check, which must
// pass a pull request whose fold is still pending and fail a hand edit.
import { afterAll, afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { check, fold, FragmentError, parseTodo, readFragmentsDir, renderTodos, TARGETS, TODOS_HEADER, type Fragments } from '../scripts/fold-hub-fragments.ts';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'fold-hub-fragments.ts');
const dirs: string[] = [];
const HOME = mkdtempSync(join(tmpdir(), 'hub-fragments-home-'));
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

const item = (section: string, text: string) => `---\nsection: ${section}\n---\n${text}\n`;
const PREAMBLE = '# Open work\n\nIntro with a [link](docs/x.md).\n';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-fragments-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'todos.d'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'todos.d', name), text);
  return dir;
}

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME, GIT_CONFIG_NOSYSTEM: '1' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function cli(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, '--root', dir, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME } });
}

test('an item fragment is front matter naming its section, then the item text exactly', () => {
  const text = '- [ ] **Title.** Body with `code` and [a link](docs/a.md).';
  expect(parseTodo('a.md', item('From X (2026-11-01)', text))).toEqual({ name: 'a.md', section: 'From X (2026-11-01)', body: text + '\n' });
  expect(() => parseTodo('b.md', text + '\n')).toThrow(FragmentError);
  expect(() => parseTodo('c.md', item('## From X', '- [ ] a'))).toThrow(FragmentError);
  expect(() => parseTodo('d.md', item('From X', 'not a checkbox'))).toThrow(FragmentError);
  expect(() => parseTodo('e.md', item('From X', '- [ ] a') + '\n')).toThrow(FragmentError);
  expect(() => parseTodo('f.md', item('From X', '- [ ] a').trimEnd())).toThrow(FragmentError);
  expect(() => parseTodo('g.md', item('From X', '- [ ] a\n## Injected heading'))).toThrow(/one line/);
});

test('the render orders sections newest first, undated last, and items by file name', () => {
  const files: Fragments = new Map([
    ['zz.md', item('From B (2026-10-22)', '- [ ] b2 new')],
    ['_preamble.md', PREAMBLE],
    ['01-b.md', item('From B (2026-10-22)', '- [x] b1')],
    ['01-u.md', item('From the undated lane', '- [ ] u1')],
    ['01-a.md', item('From A (lane, 2026-10-31)', '- [ ] a1')],
    ['01-c.md', item('From C (2026-10-22)', '- [ ] c1')],
    ['README.md', '# not an item\n'],
  ]);
  const out = renderTodos(files);
  expect(out).toBe([
    TODOS_HEADER, '', '# Open work', '', 'Intro with a [link](docs/x.md).', '',
    '## From A (lane, 2026-10-31)', '', '- [ ] a1', '',
    '## From B (2026-10-22)', '', '- [x] b1', '- [ ] b2 new', '',
    '## From C (2026-10-22)', '', '- [ ] c1', '',
    '## From the undated lane', '', '- [ ] u1', '',
  ].join('\n'));
  expect(renderTodos(new Map([...files].reverse()))).toBe(out);
});

test('the render refuses a missing preamble and a malformed item', () => {
  expect(() => renderTodos(new Map([['01-a.md', item('From A', '- [ ] a')]]))).toThrow(/_preamble\.md is missing/);
  expect(() => renderTodos(new Map([['_preamble.md', PREAMBLE], ['x.md', 'no front matter\n']]))).toThrow(/todos\.d\/x\.md/);
  const dir = repo({ '_preamble.md': PREAMBLE, 'notes.txt': 'x' });
  expect(() => readFragmentsDir(dir, 'todos.d')).toThrow(/only regular \.md fragment files/);
});

test('the fold skips dotfiles and refuses symlinks, so it never reads or writes outside the checkout', () => {
  const dir = repo({ '_preamble.md': PREAMBLE, '01-a.md': item('From A (2026-11-01)', '- [ ] a'), '.DS_Store': 'x', '.01-a.md.swp': 'x' });
  expect([...readFragmentsDir(dir, 'todos.d').keys()]).toEqual(['01-a.md', '_preamble.md']);
  const secret = join(HOME, 'private.txt');
  writeFileSync(secret, 'not for publication\n');
  rmSync(join(dir, 'todos.d', '_preamble.md'));
  symlinkSync(secret, join(dir, 'todos.d', '_preamble.md'));
  expect(() => fold(dir)).toThrow(/todos\.d\/_preamble\.md: only regular \.md fragment files/);
  const r = cli(dir);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).not.toContain('not for publication');

  const out = repo({ '_preamble.md': PREAMBLE });
  symlinkSync(secret, join(out, 'TODOS.md'));
  expect(() => fold(out)).toThrow(/TODOS\.md: a symlink/);
  expect(readFileSync(secret, 'utf8')).toBe('not for publication\n');
  const dangling = repo({ '_preamble.md': PREAMBLE });
  const target = join(HOME, 'not-created.md');
  symlinkSync(target, join(dangling, 'TODOS.md'));
  expect(() => fold(dangling)).toThrow(/TODOS\.md: a symlink/);
  expect(() => readFileSync(target)).toThrow();

  const linkedDir = mkdtempSync(join(tmpdir(), 'hub-fragments-linked-'));
  dirs.push(linkedDir);
  symlinkSync(join(dir, 'todos.d'), join(linkedDir, 'todos.d'));
  expect(() => fold(linkedDir)).toThrow(/todos\.d: a symlink/);
});

test('fold writes TODOS.md once and a second run changes nothing', () => {
  const dir = repo({ '_preamble.md': PREAMBLE, '01-a.md': item('From A (2026-11-01)', '- [ ] a') });
  expect(fold(dir)).toEqual(['fold: TODOS.md written from todos.d/']);
  const first = readFileSync(join(dir, 'TODOS.md'), 'utf8');
  const mtime = statSync(join(dir, 'TODOS.md')).mtimeMs;
  expect(fold(dir)).toEqual(['fold: TODOS.md unchanged']);
  expect(readFileSync(join(dir, 'TODOS.md'), 'utf8')).toBe(first);
  expect(statSync(join(dir, 'TODOS.md')).mtimeMs).toBe(mtime);
  expect(first.split('\n')[0]).toBe(TODOS_HEADER);
});

test('--check passes a folded tree and a pending fold, and fails a hand edit', () => {
  const dir = repo({ '_preamble.md': PREAMBLE, '01-a.md': item('From A (2026-11-01)', '- [ ] a') });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fold(dir);
  const base = commit(dir, 'base');
  expect(cli(dir, '--check').status).toBe(0);

  writeFileSync(join(dir, 'todos.d', 'new-item.md'), item('From B (2026-11-02)', '- [ ] b'));
  rmSync(join(dir, 'todos.d', '01-a.md'));
  commit(dir, 'pull request adds one item and closes another, unfolded');
  expect(cli(dir, '--check').status).toBe(1);
  const pending = cli(dir, '--check', '--base', base);
  expect(pending.status).toBe(0);
  expect(pending.stdout).toContain(`check: TODOS.md pending (unchanged since ${base.slice(0, 12)}; internal-task's housekeeping fold writes it from todos.d/)`);

  writeFileSync(join(dir, 'TODOS.md'), readFileSync(join(dir, 'TODOS.md'), 'utf8') + '- [ ] a hand edit\n');
  const edited = cli(dir, '--check', '--base', base);
  expect(edited.status).toBe(1);
  expect(edited.stdout).toContain('check: TODOS.md does not match todos.d/');

  expect(cli(dir).stdout).toContain('fold: TODOS.md written from todos.d/');
  expect(cli(dir, '--check').status).toBe(0);
  expect(readFileSync(join(dir, 'TODOS.md'), 'utf8')).not.toContain('a hand edit');
  expect(readFileSync(join(dir, 'TODOS.md'), 'utf8')).toContain('## From B (2026-11-02)\n\n- [ ] b\n');
});

test('--check passes a branch that folded at its fork point after the base moved on', () => {
  const dir = repo({ '_preamble.md': PREAMBLE, '01-a.md': item('From A (2026-11-01)', '- [ ] a') });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fold(dir);
  commit(dir, 'fork point');
  git(dir, 'checkout', '-q', '-b', 'pr');
  writeFileSync(join(dir, 'todos.d', 'pr-item.md'), item('From P (2026-11-02)', '- [ ] p'));
  commit(dir, 'pr adds an item');
  git(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'todos.d', 'main-item.md'), item('From M (2026-11-02)', '- [ ] m'));
  fold(dir);
  const base = commit(dir, 'main adds and folds an item');
  git(dir, 'checkout', '-q', 'pr');
  expect(check(dir, base).lines).toEqual([expect.stringMatching(/^check: TODOS\.md pending \(folded at [0-9a-f]{12}; internal-task's housekeeping fold writes it from todos\.d\/\)$/)]);
});

test('check-links resolves todos.d/ item links from the root, todos.d/README.md links from todos.d/, and skips generated TODOS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-fragments-links-'));
  dirs.push(dir);
  for (const d of ['scripts', 'docs', 'todos.d']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'scripts', 'check-links.py'), readFileSync(join(ROOT, 'scripts', 'check-links.py')));
  writeFileSync(join(dir, 'docs', 'a.md'), '# a\n');
  writeFileSync(join(dir, 'todos.d', '01-x.md'), item('From X (2026-11-01)', '- [ ] see [a](docs/a.md)'));
  writeFileSync(join(dir, 'todos.d', 'README.md'), 'Rendered into [TODOS.md](../TODOS.md); [a](docs/a.md) is wrong here.\n');
  writeFileSync(join(dir, 'TODOS.md'), '- [ ] a closed item still waiting for the fold links [gone](docs/deleted.md)\n');
  const r = spawnSync('python3', [join(dir, 'scripts', 'check-links.py')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME } });
  expect(r.stdout.trim().split('\n')).toEqual(['todos.d/README.md: broken link docs/a.md', 'check-links: 1 problem(s)']);
  expect(r.status).toBe(1);
});

test("the repository's todos.d/ files parse and TODOS.md opens with the generated-file header", () => {
  const t = TARGETS.find((x) => x.output === 'TODOS.md')!;
  expect(() => t.render(readFragmentsDir(ROOT, t.dir))).not.toThrow();
  expect(readFileSync(join(ROOT, 'TODOS.md'), 'utf8').split('\n')[0]).toBe(TODOS_HEADER);
});

test('the ship policy runs the fold at land with exactly the generated files as outputs, or leaves both out', () => {
  const policy = JSON.parse(readFileSync(join(ROOT, '.gstack', 'ship-policy.json'), 'utf8')) as { release_tool?: string; release_outputs?: string[] };
  const generated = TARGETS.map((x) => x.output);
  if (policy.release_tool === undefined) {
    expect((policy.release_outputs ?? []).filter((p) => generated.includes(p))).toEqual([]);
    return;
  }
  expect(policy.release_tool).toBe('bun scripts/fold-hub-fragments.ts');
  expect(policy.release_outputs).toEqual(generated);
});
