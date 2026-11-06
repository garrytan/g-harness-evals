// Tests for the edition fixture generator (harnesses/qm/gstack/edition-fixture.ts) on the TEST-ONLY bank in
// tests/fixtures/qm-s1-edition/test-only-bank.json. Keyless and offline: git and, where present, node.
import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTHOR, BASE_DATE, MIN_REVIEW_HUNKS, bankProblems, generate, overlaps, pickIndex, type Bank, type Generated, type ReviewKey } from '../harnesses/qm/gstack/edition-fixture.ts';

const BANK_PATH = join(import.meta.dir, 'fixtures', 'qm-s1-edition', 'test-only-bank.json');
const BANK_TEXT = readFileSync(BANK_PATH, 'utf8');
const BANK = JSON.parse(BANK_TEXT) as Bank;
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const run = (cmd: string, args: string[], cwd: string) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: ENV });
const HAS_NODE = run('sh', ['-c', 'command -v node'], '/').status === 0;
const tmp = (name: string) => join(mkdtempSync(join(tmpdir(), 'edition-fixture-')), name);

let a: Generated, b: Generated, dirA: string, dirB: string;
beforeAll(() => {
  dirA = tmp('a'); dirB = tmp('b');
  a = generate(BANK_TEXT, 'test-seed-1', dirA);
  b = generate(BANK_TEXT, 'test-seed-1', dirB);
}, 120_000);

describe('edition-fixture: the bank', () => {
  test('the shipped bank is test-only, valid, and has two templates per family', () => {
    expect(bankProblems(BANK)).toEqual([]);
    expect(BANK.test_only).toBe(true);
    expect(BANK.templates.every((t) => t.id.startsWith('test-'))).toBe(true);
    expect(['investigate', 'review', 'plan'].map((f) => BANK.templates.filter((t) => t.family === f).length)).toEqual([2, 2, 2]);
  });

  test('bank problems name the broken rule', () => {
    const broken = structuredClone(BANK) as any;
    broken.templates[0].id = 'inv-real-looking';
    broken.templates[1].key.decoys = [];
    broken.templates[2].commits[0].files['../escape.js'] = 'x';
    broken.templates[3].request = 'Review {{undeclared}}';
    broken.templates[4].key.distractors = broken.templates[4].key.distractors.slice(0, 2);
    const p = bankProblems(broken).join('\n');
    expect(p).toContain('prefix "test-"');
    expect(p).toContain('decoys must list at least one suspect');
    expect(p).toContain('unsafe path ../escape.js');
    expect(p).toContain('{{undeclared}}');
    expect(p).toContain('distractors must list at least 4');
  });

  test('a bank that is not test-only is refused inside this checkout, and a non-empty output directory is refused', () => {
    const real = JSON.stringify({ ...BANK, test_only: false, templates: BANK.templates.map((t) => ({ ...t, id: t.id.replace('test-', 'x-') })) });
    const inside = join(import.meta.dir, '..', '.edition-fixture-refusal-check');
    expect(() => generate(real, 's', inside)).toThrow('is not a test-only bank');
    const full = tmp('full');
    mkdirSync(full, { recursive: true });
    writeFileSync(join(full, 'keep.txt'), 'x');
    expect(() => generate(BANK_TEXT, 's', full)).toThrow('is not empty');
  });

  test('a key that does not fit its repository is refused', () => {
    const broken = structuredClone(BANK) as any;
    broken.templates = broken.templates.filter((t: any) => t.id === 'test-rev-bulk-discount');
    broken.templates[0].key.decoys[0].lines = [400, 401];
    expect(() => generate(JSON.stringify(broken), 's', tmp('misfit'))).toThrow('run past the end');
  }, 60_000);
});

describe('edition-fixture: determinism', () => {
  test('the same bank and seed give the same keys, fixtures and commits; tasks differ only by the output path', () => {
    for (const f of ['keys.json', 'fixtures.json']) expect(readFileSync(join(dirA, f), 'utf8')).toBe(readFileSync(join(dirB, f), 'utf8'));
    expect(readFileSync(join(dirA, 'tasks.json'), 'utf8').split(dirA).join('<out>')).toBe(readFileSync(join(dirB, 'tasks.json'), 'utf8').split(dirB).join('<out>'));
    expect(a.tasks.map((t) => t.id)).toEqual(['inv-01', 'inv-02', 'rev-01', 'rev-02', 'plan-01', 'plan-02']);
    for (const t of a.tasks) expect(run('git', ['rev-parse', 'HEAD'], t.repo_dir).stdout.trim()).toBe(a.fixtures.tasks[t.id]!.head);
  });

  test('the seed picks the variables, so another seed changes some request and commit ids', () => {
    const seeds = ['test-seed-1', 'test-seed-2', 'test-seed-3', 'test-seed-4'];
    const picks = seeds.map((s) => BANK.templates.map((t) => Object.entries(t.vars ?? {}).map(([n, v]) => pickIndex(s, t.id, n, v.length)).join(',')).join('|'));
    const other = seeds.find((s, i) => picks[i] !== picks[0])!;
    expect(other).toBeDefined();
    const c = generate(BANK_TEXT, other, tmp('c'));
    expect(c.tasks.some((t, i) => t.request !== a.tasks[i]!.request)).toBe(true);
    expect(Object.keys(c.fixtures.tasks).some((id) => c.fixtures.tasks[id]!.head !== a.fixtures.tasks[id]!.head)).toBe(true);
  }, 60_000);

  test('every commit has the fixed author and dates, and task records carry exactly the shared fields', () => {
    for (const t of a.tasks) {
      const log = run('git', ['log', '--all', '--reverse', '--format=%an <%ae> %at %cn %ct'], t.repo_dir).stdout.trim().split('\n');
      for (const line of log) expect(line.startsWith(AUTHOR + ' ')).toBe(true);
      const dates = log.map((l) => Number(l.split(' ')[3]));
      expect(dates.every((d) => d >= BASE_DATE && (d - BASE_DATE) % 86400 === 0)).toBe(true);
      expect(Object.keys(t).sort()).toEqual(['family', 'first_step', 'id', 'repo_dir', 'request']);
      expect(t.first_step).toEqual({ skill: t.family });
      expect(t.request).not.toContain('{{');
    }
    expect(JSON.parse(readFileSync(join(dirA, 'keys.json'), 'utf8'))['inv-01'].key.cause.file).toBe('src/paginate.js');
  });
});

describe('edition-fixture: what each family needs', () => {
  test('review keys list the diff hunks; the defect and both decoys sit in separate hunks, with enough other hunks', () => {
    for (const t of a.tasks.filter((x) => x.family === 'review')) {
      const k = a.keys[t.id]!.key as ReviewKey & { hunks: Array<{ file: string; start: number; end: number }>; diff_files: string[] };
      const spotHunks = [k.defect, ...k.decoys].map((s) => k.hunks.findIndex((h) => overlaps(h, s)));
      expect(spotHunks.every((h) => h >= 0)).toBe(true);
      expect(new Set(spotHunks).size).toBe(3);
      expect(k.hunks.filter((h) => !k.decoys.some((d) => overlaps(h, d))).length).toBeGreaterThanOrEqual(MIN_REVIEW_HUNKS);
      expect(run('git', ['diff', '--name-only', k.base + '...HEAD'], t.repo_dir).stdout.trim().split('\n').sort()).toEqual([...k.diff_files].sort());
    }
  });

  test.skipIf(!HAS_NODE)('investigate repositories fail exactly the planted test; review and plan repositories pass; no run leaves files behind', () => {
    const planted: Record<string, string> = { 'inv-01': 'a partial last page still counts as a page', 'inv-02': 'a fresh token is not expired' };
    for (const t of a.tasks) {
      const r = run('node', ['--test', '--test-reporter=tap'], t.repo_dir);
      const failing = [...r.stdout.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]);
      expect(failing).toEqual(planted[t.id] ? [planted[t.id]] : []);
      expect(run('git', ['status', '--porcelain', '--ignored'], t.repo_dir).stdout).toBe('');
    }
  }, 60_000);
});
