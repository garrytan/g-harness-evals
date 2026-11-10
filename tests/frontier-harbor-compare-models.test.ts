import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * scripts/frontier-harbor/compare-models.ts is the preregistered analysis of fable-5-2-coding-2026-11. These tests run it on
 * a synthetic trials file: it refuses cells outside the 12 preregistered ones and duplicate trials, excludes unscored trials
 * from pass rates and pairs while still counting their cost, and pairs only tasks scored in both arms.
 */
const SCRIPT = new URL('../scripts/frontier-harbor/compare-models.ts', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'compare-models-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Row = { cell: string; task: string; termination?: string; grade?: string; usd?: number; wall_ms?: number };
const record = (r: Row) => ({ cell: r.cell, task: r.task, termination: r.termination ?? 'completed', grade: r.grade ?? 'pass', consent_violation: false, usage: { usd: r.usd ?? 0.1 }, wall_ms: r.wall_ms ?? 60_000 });
let n = 0;
const run = (rows: Row[], extra: string[] = []) => {
  const dir = join(tmp, String(n++));
  const file = join(dir + '.jsonl');
  writeFileSync(file, rows.map((r) => JSON.stringify(record(r))).join('\n') + '\n');
  const res = spawnSync('bun', [SCRIPT, '--trials', file, '--out', dir, ...extra], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  return { ...res, dir };
};
const analysis = (dir: string) => JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));

describe('compare-models.ts', () => {
  test('without --trials or --out it prints its usage and exits 2', () => {
    const res = spawnSync('bun', [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('usage: compare-models.ts');
  });

  test('a cell outside the 12 preregistered ones is refused', () => {
    for (const cell of ['fable52-r3h1', 'fable52-r1h3', 'sonnet55-r1h1', 'fable52']) {
      const res = run([{ cell, task: 't1' }]);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain(`unexpected cell ${cell}`);
    }
  });

  test('two records for one arm, task and attempt are refused, even from different halves', () => {
    const res = run([{ cell: 'fable52-r1h1', task: 't1' }, { cell: 'fable52-r1h2', task: 't1' }]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('two records for fable52/t1/1');
  });

  test('an unscored trial is excluded from pass rates and pairs but its cost still counts', () => {
    const res = run([
      { cell: 'fable52-r1h1', task: 't1' }, { cell: 'fable52-r1h1', task: 't2' }, { cell: 'fable52-r1h1', task: 't3' },
      { cell: 'fable51-r1h1', task: 't1', grade: 'fail' }, { cell: 'fable51-r1h1', task: 't2' },
      { cell: 'fable51-r1h1', task: 't3', termination: 'infra_error', grade: 'n/a', usd: 5 },
      { cell: 'opus55-r1h1', task: 't1' }, { cell: 'opus55-r1h1', task: 't2' }, { cell: 'opus55-r1h1', task: 't3', termination: 'harness_error', grade: 'n/a' },
    ]);
    expect(res.status).toBe(0);
    const a = analysis(res.dir);
    const fable51 = a.arms.find((x: { id: string }) => x.id === 'fable51');
    expect(fable51).toMatchObject({ trials: 3, scored_trials: 2, passes: 1, excluded: 1, tasks: 2, by_termination: { completed: 2, infra_error: 1 } });
    expect(fable51.usd).toBeCloseTo(5.2, 9);
    const opus = a.arms.find((x: { id: string }) => x.id === 'opus55');
    expect(opus).toMatchObject({ scored_trials: 3, passes: 2, excluded: 0 });
    const [vs51, vsOpus, descriptive] = a.pairs;
    expect(vs51).toMatchObject({ b: 'fable52', a: 'fable51', primary: true, tasks: 2, better: ['t1'], worse: [], same: 1 });
    expect(vsOpus).toMatchObject({ b: 'fable52', a: 'opus55', primary: true, tasks: 3, better: ['t3'], worse: [], same: 2 });
    expect(descriptive).toMatchObject({ b: 'fable51', a: 'opus55', primary: false, tasks: 2 });
  });

  test('a pair with no task scored in both arms has no interval', () => {
    const res = run([{ cell: 'fable52-r1h1', task: 't1' }, { cell: 'fable51-r1h1', task: 't2' }, { cell: 'opus55-r1h1', task: 't1' }]);
    expect(res.status).toBe(0);
    const vs51 = analysis(res.dir).pairs[0];
    expect(vs51).toMatchObject({ tasks: 0, difference: null, reading: 'no interval' });
  });

  test('attempt 2 cells count as a second attempt of the same task, and --tasks keeps only the listed tasks', () => {
    const res = run([
      { cell: 'fable52-r1h1', task: 't1' }, { cell: 'fable52-r2h1', task: 't1', grade: 'fail' }, { cell: 'fable52-r1h2', task: 't2' },
      { cell: 'fable51-r1h1', task: 't1' }, { cell: 'opus55-r1h1', task: 't1' },
    ], ['--tasks', 't1']);
    expect(res.status).toBe(0);
    const a = analysis(res.dir);
    expect(a.subset).toEqual(['t1']);
    expect(a.arms[0]).toMatchObject({ id: 'fable52', trials: 2, scored_trials: 2, passes: 1, tasks: 1 });
    expect(a.arms[0].pass_rate.estimate).toBeCloseTo(0.5, 9);
    expect(readFileSync(join(res.dir, 'analysis.md'), 'utf8')).toContain('# Model comparison (subset of 1 tasks)');
  });
});
