// Graded task set T of the skill-resolver eval (internal-task, task phase): the keyless set check, and that the checker
// catches a broken task. Format: tasks/skill-resolver/T/README.md.

import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSet, checkTask, grade, materialise, overlapBin, PACK_QUOTA, runCheck, SET_SIZE, type Task } from '../scripts/skill-resolver/check-set-t.ts';

const SET = join(import.meta.dir, '..', 'tasks', 'skill-resolver', 'T');
const EXAMPLE = 't15-invoice-export-decision';

function scratchTask(edit: (dir: string, t: Task) => void): string[] {
  const root = mkdtempSync(join(tmpdir(), 'sett-test-'));
  const dir = join(root, EXAMPLE);
  try {
    cpSync(join(SET, 'tasks', EXAMPLE), dir, { recursive: true });
    const t = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as Task;
    edit(dir, t);
    return checkTask(dir, t);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('set T', () => {
  test('every task passes the keyless check: oracle passes, doing nothing and the obvious attempt fail used_it', () => {
    const r = checkSet(SET);
    expect(r.errs).toEqual([]);
    expect(r.n).toBe(SET_SIZE);
    expect(r.byPack).toEqual(PACK_QUOTA);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('every task records the overlap bin that matches its nd_jaccard', () => {
    for (const row of checkSet(SET).rows) expect(row.bin).toBe(overlapBin(row.nd_jaccard!));
  });
});

describe('the checker catches a broken task', () => {
  test('an oracle that does not follow the skill', () => {
    const errs = scratchTask((dir) => cpSync(join(dir, 'obvious'), join(dir, 'oracle'), { recursive: true }));
    expect(errs.some((e) => e.includes('oracle fails'))).toBe(true);
  });

  test('an obvious attempt that follows the skill', () => {
    const errs = scratchTask((dir) => cpSync(join(dir, 'oracle'), join(dir, 'obvious'), { recursive: true }));
    expect(errs.some((e) => e.includes('the obvious attempt passes used_it'))).toBe(true);
  });

  test('an obvious attempt that also fails a plain check is not a fair attempt', () => {
    const errs = scratchTask((dir) => writeFileSync(join(dir, 'obvious', 'decision.md'), 'nothing useful\n'));
    expect(errs.some((e) => e.includes('not a fair attempt'))).toBe(true);
  });

  test('a request that gives a marker away', () => {
    const errs = scratchTask((_, t) => { t.request += ' End with a definition of done.'; });
    expect(errs.some((e) => e.includes('gives away marker'))).toBe(true);
  });

  test('a used_it check without markers', () => {
    const errs = scratchTask((_, t) => { for (const c of t.checks) delete c.markers; });
    expect(errs.some((e) => e.includes('needs markers'))).toBe(true);
  });
});

describe('check kinds', () => {
  const t = JSON.parse(readFileSync(join(SET, 'tasks', EXAMPLE, 'task.json'), 'utf8')) as Task;

  test('grade separates used_it from success', () => {
    const dir = materialise(join(SET, 'tasks', EXAMPLE), 'obvious');
    try {
      const v = grade(dir, t);
      expect(v.used_it).toBe(false);
      expect(v.success).toBe(false);
      expect(v.failed.every((id) => t.used_it.includes(id))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('json, frontmatter, order and glob checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sett-kinds-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify({ items: [{ 'a/b': 'x1' }], n: 2 }));
      writeFileSync(join(dir, 'S.md'), '---\nname: demo\ntags: [a, b]\n---\n# One\n## Two\n');
      expect(runCheck(dir, { id: 'j1', kind: 'json', path: 'a.json', pointer: '/items/0/a~1b', pattern: '^x\\d$', why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'j2', kind: 'json', path: 'a.json', pointer: '/n', equals: 2, why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'j3', kind: 'json', path: 'a.json', pointer: '/items', min_items: 2, why: 'w' })).toBe(false);
      expect(runCheck(dir, { id: 'f1', kind: 'frontmatter', path: 'S.md', key: 'name', pattern: '^demo$', why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'f2', kind: 'frontmatter', path: 'S.md', key: 'tags', pattern: '"b"', why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'o1', kind: 'order', path: 'S.md', patterns: ['^# One', '^## Two'], flags: 'm', why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'o2', kind: 'order', path: 'S.md', patterns: ['^## Two', '^# One'], flags: 'm', why: 'w' })).toBe(false);
      expect(runCheck(dir, { id: 'g1', kind: 'exists', glob: '*.md', min: 1, max: 1, why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'g2', kind: 'regex', glob: '*', pattern: 'x1', why: 'w' })).toBe(true);
      expect(runCheck(dir, { id: 'r1', kind: 'regex', path: 'S.md', pattern: '^#', flags: 'm', max: 1, why: 'w' })).toBe(false);
      expect(runCheck(dir, { id: 'm1', kind: 'exists', path: 'missing.md', why: 'w' })).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
