// Restates the parts of gstack-evals' noloss statistics that score-mc.ts and power.ts need, from
// https://github.com/garrytan/gstack-evals at 91d76421a9f127167b3694306aa77f2971f7a712, lanes/review-noloss/stats.ts
// (MIT License, Copyright (c) 2026 Garry Tan). harness-evals does not depend on gstack-evals, so the code is copied
// here, not imported. tests/review-bugs/score-mc.test.ts checks it against noloss score's own output on a fixture.
//
// The paired values are shares of passes, so each PR cluster's summed difference is put on an integer lattice of
// 1 / (1000 * lcm(passes)) exactly as noloss does. On that lattice noloss computes the sign-flip tail exactly by
// convolution (signFlipTail below). This file adds a seeded Monte Carlo version over the same cluster values
// (mcSignFlip), which the plan uses at 110 to 150 PR clusters with a frozen seed and draw count.
import { seededRandom, type PairedItem } from '../../runner/stats/paired.ts';

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/** Each PR cluster's summed difference b - a on noloss's integer lattice, in cluster id order. */
export function clusterValues(pairs: readonly PairedItem[], passes: readonly number[]): number[] {
  const l = passes.reduce((acc, p) => lcm(acc, p), 1);
  const scale = 1000 * l;
  for (const p of pairs) for (const v of [p.a, p.b]) if (Math.abs(Math.round(v * l) - v * l) > 1e-9) throw new Error('paired value ' + v + ' is not a share of ' + passes.join(' or ') + ' passes');
  const byCluster = new Map<string, number>();
  for (const p of pairs) byCluster.set(p.cluster, (byCluster.get(p.cluster) ?? 0) + Math.round((p.b - p.a) * scale));
  return [...byCluster.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v);
}

/** Why noloss gives no p for these pairs (fewer than 2 clusters, a true ceiling or floor), or null when it gives one. */
export function noTestReason(pairs: readonly PairedItem[]): string | null {
  if (new Set(pairs.map((p) => p.cluster)).size < 2) return 'fewer than 2 PR clusters';
  if (pairs.some((p) => p.a !== p.b)) return null;
  if (pairs.every((p) => p.a === 1)) return 'ceiling: both arms found every bug';
  if (pairs.every((p) => p.a === 0)) return 'floor: neither arm found any bug';
  return null;
}

/** noloss signFlipTail: exact one-sided p that the signed sum is at least the observed sum. Values are integers. */
export function signFlipTail(values: readonly number[]): number {
  if (!values.every(Number.isSafeInteger)) throw new Error('sign-flip values must be integers on the lattice');
  const nonzero = values.filter((v) => v !== 0).map(Math.abs);
  const g = nonzero.reduce((acc, v) => gcd(acc, v), 0) || 1;
  const steps = nonzero.map((v) => v / g);
  const signed = values.filter((v) => v !== 0).map((v) => v / g);
  const span = steps.reduce((s, v) => s + v, 0);
  let dist = new Float64Array(2 * span + 1);
  dist[span] = 1;
  let reach = 0;
  for (const v of steps) {
    const next = new Float64Array(dist.length);
    for (let s = span - reach; s <= span + reach; s++) {
      const p = dist[s]!;
      if (p === 0) continue;
      next[s + v]! += p / 2;
      next[s - v]! += p / 2;
    }
    dist = next;
    reach += v;
  }
  const observed = signed.reduce((s, v) => s + v, 0);
  let tail = 0;
  for (let s = span + observed; s <= 2 * span; s++) tail += dist[s]!;
  return tail;
}

/**
 * The two one-sided tests noloss pairedTests runs at margin 0: greater is its no-loss p (b better than a), less its
 * LOSS p (b worse than a). Null where noloss gives null.
 */
export function exactSignFlip(pairs: readonly PairedItem[], passes: readonly number[]): { greater: number | null; less: number | null } {
  if (noTestReason(pairs)) return { greater: null, less: null };
  const values = clusterValues(pairs, passes);
  return { greater: signFlipTail(values), less: signFlipTail(values.map((v) => -v)) };
}

export interface McSignFlip {
  /** P(signed sum >= observed): b better than a. */
  p_greater: number;
  /** P(signed sum <= observed): b worse than a. */
  p_less: number;
  /** P(|signed sum| >= |observed|). */
  p_two_sided: number;
  /** Monte Carlo standard error of each p, sqrt(p (1 - p) / draws). */
  mc_se: { greater: number; less: number; two_sided: number };
  informative_clusters: number;
  seed: number;
  draws: number;
}

/**
 * Seeded Monte Carlo sign-flip test over the same cluster values noloss uses: each draw flips every cluster's sign
 * with probability 1/2 (one generator call per cluster, in cluster id order). p = (count + 1) / (draws + 1), the
 * Monte Carlo rule runner/stats/paired.ts uses. Null where noloss gives null.
 */
export function mcSignFlip(pairs: readonly PairedItem[], passes: readonly number[], o: { seed: number; draws: number }): McSignFlip | null {
  if (!Number.isSafeInteger(o.draws) || o.draws < 1000) throw new Error('the Monte Carlo sign-flip test needs at least 1000 draws');
  if (!Number.isSafeInteger(o.seed) || o.seed < 0) throw new Error('the Monte Carlo seed is a non-negative integer');
  if (noTestReason(pairs)) return null;
  const values = clusterValues(pairs, passes);
  const observed = values.reduce((s, v) => s + v, 0);
  const rng = seededRandom(o.seed);
  let ge = 0;
  let le = 0;
  let two = 0;
  for (let d = 0; d < o.draws; d++) {
    let sum = 0;
    for (const v of values) sum += rng() < 0.5 ? -v : v;
    if (sum >= observed) ge++;
    if (sum <= observed) le++;
    if (Math.abs(sum) >= Math.abs(observed)) two++;
  }
  const p = (k: number) => (k + 1) / (o.draws + 1);
  const se = (x: number) => Math.sqrt((x * (1 - x)) / o.draws);
  return { p_greater: p(ge), p_less: p(le), p_two_sided: p(two), mc_se: { greater: se(p(ge)), less: se(p(le)), two_sided: se(p(two)) }, informative_clusters: values.filter((v) => v !== 0).length, seed: o.seed, draws: o.draws };
}

/** noloss holmSteps: Holm's step-down, ties in the given order, each adjusted p at least the one before it. */
export function holmSteps(pValues: readonly number[]): { adjusted: number[]; step: number[] } {
  if (!pValues.every((p) => Number.isFinite(p) && p >= 0 && p <= 1)) throw new Error('a Holm p-value is a number from 0 to 1');
  const order = pValues.map((p, index) => ({ p, index })).sort((x, y) => x.p - y.p || x.index - y.index);
  const adjusted = new Array<number>(pValues.length);
  const step = new Array<number>(pValues.length);
  let previous = 0;
  order.forEach(({ p, index }, rank) => {
    previous = Math.max(previous, Math.min(1, p * (order.length - rank)));
    adjusted[index] = previous;
    step[index] = rank + 1;
  });
  return { adjusted, step };
}
