// scripts/waterfall/contrasts.ts (internal-task): paired spend contrasts on the shared tasks, a cell that is short of its
// schedule is inconclusive, and the dollars-per-success ratio handles tasks and resamples with no success.
import { describe, expect, test } from 'bun:test';
import { contrast, dollarsPerSuccess, type ContrastTrial } from '../scripts/waterfall/contrasts.ts';

const OPTS = { seed: 7, draws: 2000 };
const cell = (name: string, tasks: number, reps: number, usd: (task: number, rep: number) => number, pass: (task: number, rep: number) => boolean): ContrastTrial[] =>
  Array.from({ length: tasks }, (_, t) => Array.from({ length: reps }, (_, r) => ({ cell: name, task: `t${t}`, rep: r + 1, usd: usd(t, r), pass: pass(t, r) }))).flat();

describe('waterfall contrasts (internal-task)', () => {
  test('a cell three tasks short is paired on the shared tasks, its exclusions listed, and marked inconclusive', () => {
    const a = cell('A', 6, 2, (t, r) => 0.01 + 0.001 * t + 0.0001 * r, (t) => t % 2 === 0);
    const b = cell('B', 3, 2, (t, r) => 0.02 + 0.001 * t + 0.0001 * r, (t) => t % 2 === 0);
    const r = contrast(a, b, { a: 12, b: 12 }, OPTS);
    expect(r.status).toBe('inconclusive (incomplete cell)');
    expect(r.trials).toEqual({ a: 12, b: 6, scheduled_a: 12, scheduled_b: 12, paired: 6, tasks: 3 });
    expect(r.excluded.tasks_only_in_a).toEqual(['t3', 't4', 't5']);
    expect(r.dollars_per_trial!.delta).toBeCloseTo(0.01, 12);
    expect(r.confounded_by_work_done).toBe(false);
    expect(contrast(a, a.map((t) => ({ ...t, cell: 'B' })), { a: 12, b: 12 }, OPTS).status).toBe('complete');
  });

  test('a zero-success task adds its dollars to the ratio; the estimate is deterministic for a seed', () => {
    const a = cell('A', 4, 2, () => 0.01, (t) => t !== 3);
    const b = cell('B', 4, 2, () => 0.02, (t) => t !== 3);
    const pairs = a.map((x, i) => ({ task: x.task, a: x, b: b[i]! }));
    const s = dollarsPerSuccess(pairs, OPTS);
    expect(s.a.usd_per_success).toBeCloseTo(0.08 / 6, 12);
    expect(s.b.usd_per_success).toBeCloseTo(0.16 / 6, 12);
    expect(s.a.zero_success_tasks).toBe(1);
    expect(s.delta).toBeCloseTo(0.08 / 6, 12);
    expect(dollarsPerSuccess(pairs, OPTS)).toEqual(s);
  });

  test('resamples with no success give an unbounded interval end, and no difference interval when both cells have none', () => {
    const a = cell('A', 5, 1, () => 0.01, (t) => t === 0);
    const b = cell('B', 5, 1, () => 0.01, (t) => t === 0);
    const s = dollarsPerSuccess(a.map((x, i) => ({ task: x.task, a: x, b: b[i]! })), OPTS);
    expect(s.a.zero_success_draws).toBeGreaterThan(0);
    expect(s.a.ci95![1]).toBeNull();
    expect(s.undefined_draws).toBeGreaterThan(0);
    expect(s.ci95).toBeNull();
    const none = dollarsPerSuccess(a.map((x, i) => ({ task: x.task, a: { ...x, pass: false }, b: b[i]! })), OPTS);
    expect(none.a.usd_per_success).toBeNull();
    expect(none.delta).toBeNull();
  });

  test('a pass-rate interval that excludes zero flags the contrast as confounded by work done', () => {
    const a = cell('A', 8, 2, () => 0.01, () => false);
    const b = cell('B', 8, 2, () => 0.03, () => true);
    const r = contrast(a, b, { a: 16, b: 16 }, OPTS);
    expect(r.pass_rate!.delta).toBe(1);
    expect(r.confounded_by_work_done).toBe(true);
    expect(r.dollars_per_success!.a.usd_per_success).toBeNull();
  });
});
