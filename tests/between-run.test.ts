// scripts/between-run.ts, keyless: pass counting with exclusions, the suffix match, the interval on a fixed sample, and the
// memory run's Sonnet none cells on the eight tasks of gbrain-memory-fix-2026-10b (25, 23 and 22 of 40, its preregistration's
// prediction 8).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { betweenRun, markdown, tally, type Trial } from '../scripts/between-run.ts';

const ROOT = join(import.meta.dir, '..');
const t = (cell: string, task: string, grade: string, termination = 'completed', consent_violation = false): Trial =>
  ({ trial_id: `run/${cell}/${task}/r1`, cell, task, grade, termination, consent_violation });

describe('tally', () => {
  test('excluded terminations leave n; a consent violation is not a pass', () => {
    const r = tally([t('c', 'a', 'pass'), t('c', 'a', 'pass', 'completed', true), t('c', 'b', 'fail'), t('c', 'b', 'n/a', 'exam_fault')]);
    expect(r).toMatchObject({ n: 3, passes: 1, excluded: 1, clusters: 2 });
    expect(r.rate).toBeCloseTo(1 / 3);
  });
  test('every task at the same rate gives a degenerate interval', () => {
    const r = tally([t('c', 'a', 'pass'), t('c', 'a', 'fail'), t('c', 'b', 'pass'), t('c', 'b', 'fail')]);
    expect([r.lower, r.rate, r.upper]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('betweenRun', () => {
  test('cells match through the suffix, tasks outside the list are dropped, and the markdown puts none cells first', () => {
    const mine = [t('h-none-x-fix', 'a', 'pass'), t('h-live-x-fix', 'a', 'fail')];
    const theirs = [t('h-none-x', 'a', 'fail'), t('h-none-x', 'z', 'pass'), t('h-live-x', 'a', 'pass')];
    const rows = betweenRun(mine, theirs, ['-x-fix', '-x'], ['a'], 7, 100);
    expect(rows.map((r) => [r.cell, r.against_cell, r.none, r.this.passes, r.against.passes, r.against.n])).toEqual([
      ['h-none-x-fix', 'h-none-x', true, 1, 0, 1], ['h-live-x-fix', 'h-live-x', false, 0, 1, 1],
    ]);
    const md = markdown(rows, ['a'], ['fix', 'old']);
    expect(md.indexOf('| h-none-x-fix |')).toBeLessThan(md.indexOf('All cells'));
    expect(md).toContain('| h-live-x-fix | 0 (1) |');
    expect(md).toContain('Passes of 1 per task');
  });
  test('a cell without the suffix, a task with no trial, or a cell with no earlier trials is refused', () => {
    expect(() => betweenRun([t('other', 'a', 'pass')], [t('zz', 'a', 'pass')], ['-x-fix', '-x'], ['a'])).toThrow('does not end with');
    expect(() => betweenRun([t('h-x-fix', 'a', 'pass')], [t('zz', 'a', 'pass')], ['-x-fix', '-x'], ['a'])).toThrow('no trials of h-x');
    expect(() => betweenRun([t('h-x-fix', 'a', 'pass')], [t('h-x', 'a', 'pass')], ['-x-fix', '-x'], ['a', 'typo'])).toThrow('task typo has no trial in this run');
    expect(() => betweenRun([t('h-x-fix', 'a', 'pass'), t('h-x-fix', 'b', 'pass')], [t('h-x', 'a', 'pass')], ['-x-fix', '-x'], ['a', 'b'])).toThrow('task b has no trial in the earlier run');
  });
  test("the memory run's Sonnet none cells on the eight tasks: 25, 23 and 22 of 40", () => {
    const dir = join(ROOT, 'docs/benchmarks/2026-10-26-gbrain-memory/results');
    const trials = readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Trial);
    const tasks = (JSON.parse(readFileSync(join(ROOT, 'docs/benchmarks/2026-10-28-gbrain-memory-fix-b/prereg.json'), 'utf8')) as { tasks: { multiuser: string[] } }).tasks.multiuser;
    const sonnetNone = trials.filter((x) => /sonnet-none/.test(x.cell));
    const rows = betweenRun(sonnetNone, trials, ['-mu-memory', '-mu-memory'], tasks, 7, 200);
    expect(rows.map((r) => [r.cell, r.this.passes, r.this.n])).toEqual([
      ['openclaw-sonnet-none-mu-memory', 25, 40], ['hermes-sonnet-none-mu-memory', 23, 40], ['qm-pi-sonnet-none-mu-memory', 22, 40],
    ]);
  });
});
