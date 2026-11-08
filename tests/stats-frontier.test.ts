// runner/stats/frontier.ts: flips, pass^k and pass@k, task bootstrap means, cost per solve and the paired cost ratio,
// against values worked out by hand.
import { describe, expect, test } from 'bun:test';
import { clusteredPairedDelta } from '../runner/stats/paired.ts';
import { bootstrapLowerBound, choose, costPerSolve, harnessFlip, pairedCostRatio, passAtK, passHatK, rerunFlip, taskBootstrapMean } from '../runner/stats/frontier.ts';

const opts = { seed: 7, draws: 10_000 };

describe('counts', () => {
  test('choose', () => {
    expect(choose(5, 2)).toBe(10);
    expect(choose(4, 0)).toBe(1);
    expect(choose(6, 3)).toBe(20);
    expect(choose(3, 4)).toBe(0);
  });

  test('rerun flip is 2k(n-k)/(n(n-1)) and needs two attempts', () => {
    expect(rerunFlip(2, 1)).toBe(1);
    expect(rerunFlip(3, 1)).toBeCloseTo(4 / 6, 12);
    expect(rerunFlip(4, 2)).toBeCloseTo(8 / 12, 12);
    expect(rerunFlip(3, 3)).toBe(0);
    expect(rerunFlip(1, 1)).toBeNull();
    expect(() => rerunFlip(2, 3)).toThrow();
  });

  test('harness flip is pA(1-pB) + pB(1-pA)', () => {
    expect(harnessFlip(1, 0)).toBe(1);
    expect(harnessFlip(1, 1)).toBe(0);
    expect(harnessFlip(0.5, 0.5)).toBe(0.5);
    expect(harnessFlip(0.75, 0.5)).toBe(0.5);
    expect(() => harnessFlip(1.2, 0)).toThrow();
  });

  test('pass^k and pass@k', () => {
    expect(passHatK(3, 2, 2)).toBeCloseTo(1 / 3, 12);
    expect(passAtK(3, 1, 2)).toBeCloseTo(2 / 3, 12);
    expect(passHatK(2, 2, 2)).toBe(1);
    expect(passAtK(2, 0, 2)).toBe(0);
    expect(passHatK(2, 1, 2)).toBe(0);
    expect(passAtK(2, 1, 2)).toBe(1);
    expect(passHatK(1, 1, 2)).toBeNull();
    expect(passAtK(1, 1, 2)).toBeNull();
    expect(passHatK(1, 1, 1)).toBe(1);
  });
});

describe('task bootstrap', () => {
  test('mean with an interval inside the range of the values', () => {
    const m = taskBootstrapMean([1, 0, 1, 0.5], opts)!;
    expect(m.estimate).toBe(0.625);
    expect(m.n).toBe(4);
    expect(m.ci95![0]).toBeLessThanOrEqual(0.625);
    expect(m.ci95![1]).toBeGreaterThanOrEqual(0.625);
    expect(m.ci95![0]).toBeGreaterThanOrEqual(0);
    expect(m.ci95![1]).toBeLessThanOrEqual(1);
    expect(taskBootstrapMean([0.5, 0.5, 0.5], opts)!.ci95).toEqual([0.5, 0.5]);
    expect(taskBootstrapMean([0.3], opts)).toEqual({ estimate: 0.3, n: 1, ci95: null });
    expect(taskBootstrapMean([], opts)).toBeNull();
    expect(taskBootstrapMean([1, 0], opts)).toEqual(taskBootstrapMean([1, 0], opts));
  });

  test('cost per solve is a ratio of sums; draws are 2, 3 or 4 with a quarter at each end', () => {
    const c = costPerSolve([{ usd: 2, solves: 1 }, { usd: 4, solves: 1 }], opts);
    expect(c.usd_per_solve).toBe(3);
    expect(c.ci95).toEqual([2, 4]);
    expect(costPerSolve([{ usd: 2, solves: 0 }], opts)).toMatchObject({ usd_per_solve: null, note: 'no solve' });
    const sparse = costPerSolve([{ usd: 1, solves: 0 }, { usd: 1, solves: 1 }], opts);
    expect(sparse.usd_per_solve).toBe(2);
    expect(sparse.ci95).toBeNull();
    expect(sparse.undefined_draws).toBeGreaterThan(2000);
  });

  test('paired cost-per-solve ratio: cell over home on the same resampled tasks', () => {
    const flat = pairedCostRatio([{ task: 't1', usd_a: 1, solves_a: 1, usd_b: 2, solves_b: 1 }, { task: 't2', usd_a: 1, solves_a: 1, usd_b: 2, solves_b: 1 }], opts);
    expect(flat.ratio).toBe(2);
    expect(flat.ci95).toEqual([2, 2]);
    const mixed = pairedCostRatio([{ task: 't1', usd_a: 1, solves_a: 1, usd_b: 3, solves_b: 1 }, { task: 't2', usd_a: 1, solves_a: 1, usd_b: 1, solves_b: 1 }], opts);
    expect(mixed.ratio).toBe(2);
    expect(mixed.ci95).toEqual([1, 3]);
    expect(pairedCostRatio([{ task: 't1', usd_a: 1, solves_a: 0, usd_b: 1, solves_b: 1 }], opts).ratio).toBeNull();
    expect(pairedCostRatio([], opts).note).toBe('no paired task');
  });

  test('bootstrap lower bound is the alpha quantile of the paired bootstrap', () => {
    // Four tasks, one lost: each draw's mean is minus the share of the lost task drawn, and at least two of four draws
    // are lost with probability about 0.26, so the 10% quantile is -0.5.
    const stats = clusteredPairedDelta(['t1', 't2', 't3', 't4'].map((t, i) => ({ id: t, cluster: t, a: 1, b: i === 3 ? 0 : 1 })), opts);
    expect(stats.delta).toBe(-0.25);
    expect(bootstrapLowerBound(stats, 0.1)).toBe(-0.5);
    const flat = clusteredPairedDelta(['t1', 't2'].map((t) => ({ id: t, cluster: t, a: 1, b: 1 })), opts);
    expect(bootstrapLowerBound(flat, 0.05)).toBeNull();
  });
});
