// A small git repository for the review-bugs tests: a base commit on main, a PR branch with a head commit and a fix
// commit, and a later commit on main. Fixture identity lives in the throwaway repository's own config.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GIT_ENV } from '../../scripts/review-bugs/git.ts';

export interface Fixture { dir: string; base: string; head: string; fix: string; later: string }

export function makeRepo(root = mkdtempSync(join(tmpdir(), 'rb-fx-'))): Fixture {
  const dir = join(root, 'src');
  mkdirSync(dir, { recursive: true });
  const g = (...a: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: GIT_ENV });
    if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr);
    return r.stdout.trim();
  };
  const put = (p: string, s: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
  put('src/page.ts', lines(30, (i) => 'export const v' + i + ' = ' + i + ';'));
  put('tests/page.test.ts', "import { v1 } from '../src/page';\ntest('v1', () => expect(v1).toBe(1));\n");
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'feature');
  put('src/page.ts', lines(30, (i) => (i === 20 ? 'export const last = (xs: number[]) => xs.slice(0, xs.length - 1);' : 'export const v' + i + ' = ' + i + ';')) + lines(25, (i) => 'export const w' + i + ' = ' + i + ';'));
  g('add', '-A'); g('commit', '-q', '-m', 'feature: add last()');
  const head = g('rev-parse', 'HEAD');
  put('src/page.ts', lines(30, (i) => (i === 20 ? 'export const last = (xs: number[]) => xs.slice(0, xs.length);' : 'export const v' + i + ' = ' + i + ';')) + lines(25, (i) => 'export const w' + i + ' = ' + i + ';'));
  put('tests/page.test.ts', "import { last } from '../src/page';\ntest('last keeps the last item', () => expect(last([1, 2])).toEqual([1, 2]));\n");
  g('add', '-A'); g('commit', '-q', '-m', 'fix: keep the last item');
  const fix = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  put('README.md', 'later\n');
  g('add', '-A'); g('commit', '-q', '-m', 'later on main');
  const later = g('rev-parse', 'HEAD');
  g('tag', 'v1', later);
  return { dir, base, head, fix, later };
}
