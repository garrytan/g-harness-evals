/**
 * Noise, reliability and cost-ratio statistics for a harness x model run with repeated attempts per task.
 *
 * The flip rates follow the Harness Leaderboard's noise view (Joel Niklaus, Hugging Face Space, Apache-2.0):
 *   - rerun flip for one task with n scored attempts and k passes is 2k(n-k)/(n(n-1)), the chance that two different
 *     attempts of the same harness disagree. It is unbiased for 2p(1-p) and needs n >= 2.
 *   - harness flip for one task is pA(1-pB) + pB(1-pA), the chance that one attempt of harness A and one of harness B
 *     disagree, with pA and pB the task's pass shares.
 * pass^k (every one of k attempts passes) is C(c,k)/C(n,k) and pass@k (at least one of k passes) is 1 - C(n-c,k)/C(n,k)
 * for a task with n scored attempts and c passes; both need n >= k.
 *
 * Intervals resample tasks with replacement (the task is the cluster), using the kit's seeded generator so a seed
 * reproduces every draw.
 */
import { seededRandom, type PairedDelta } from './paired.ts';

export function choose(n: number, k: number): number {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(k) || n < 0) throw new Error('choose needs non-negative integers');
  if (k < 0 || k > n) return 0;
  const m = Math.min(k, n - k);
  let out = 1;
  for (let i = 1; i <= m; i++) out = out * (n - m + i) / i;
  return out;
}

const checkCounts = (n: number, c: number) => {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(c) || n < 0 || c < 0 || c > n) throw new Error('attempt counts must be integers with 0 <= passes <= attempts');
};

/** 2k(n-k)/(n(n-1)) for one task; null with fewer than two scored attempts. */
export function rerunFlip(attempts: number, passes: number): number | null {
  checkCounts(attempts, passes);
  return attempts < 2 ? null : (2 * passes * (attempts - passes)) / (attempts * (attempts - 1));
}

/** pA(1-pB) + pB(1-pA) for one task, from the two cells' pass shares. */
export function harnessFlip(pA: number, pB: number): number {
  if (!(pA >= 0 && pA <= 1 && pB >= 0 && pB <= 1)) throw new Error('pass shares must lie in [0, 1]');
  return pA * (1 - pB) + pB * (1 - pA);
}

/** C(c,k)/C(n,k); null when the task has fewer than k scored attempts. */
export function passHatK(attempts: number, passes: number, k: number): number | null {
  checkCounts(attempts, passes);
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('k must be a positive integer');
  return attempts < k ? null : choose(passes, k) / choose(attempts, k);
}

/** 1 - C(n-c,k)/C(n,k); null when the task has fewer than k scored attempts. */
export function passAtK(attempts: number, passes: number, k: number): number | null {
  checkCounts(attempts, passes);
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('k must be a positive integer');
  return attempts < k ? null : 1 - choose(attempts - passes, k) / choose(attempts, k);
}

export interface MeanInterval { estimate: number; n: number; ci95: [number, number] | null }

/** Mean of per-task values with a percentile bootstrap over tasks; null for no values, no interval for one value. */
export function taskBootstrapMean(values: readonly number[], options: { seed: number; draws: number }): MeanInterval | null {
  if (!values.length) return null;
  if (!values.every(Number.isFinite)) throw new Error('task values must be finite');
  if (!Number.isSafeInteger(options.draws) || options.draws < 1000) throw new Error('taskBootstrapMean needs at least 1000 draws');
  const n = values.length;
  const estimate = values.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { estimate, n, ci95: null };
  const rnd = seededRandom(options.seed);
  const boot = new Array<number>(options.draws);
  for (let i = 0; i < options.draws; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[Math.floor(rnd() * n)]!;
    boot[i] = s / n;
  }
  boot.sort((a, b) => a - b);
  return { estimate, n, ci95: [boot[Math.floor(options.draws * 0.025)]!, boot[Math.ceil(options.draws * 0.975) - 1]!] };
}

/** One task of a cost-per-solve comparison: each side's dollars and solves on that task. */
export interface CostTask { task: string; usd_a: number; solves_a: number; usd_b: number; solves_b: number }

export interface CostRatio {
  tasks: number;
  /** Cost per solve of B divided by cost per solve of A over the same tasks; null when a side has no solve or no spend. */
  ratio: number | null;
  ci95: [number, number] | null;
  /** Bootstrap draws in which a side had no solve or no spend, so the ratio was undefined; they are left out of the interval. */
  undefined_draws: number;
  note: string | null;
}

/** Paired task-clustered bootstrap of (sum usd_b / sum solves_b) / (sum usd_a / sum solves_a). The interval is withheld
 *  when more than 5% of draws are undefined, since the draws left would no longer be a random sample. */
export function pairedCostRatio(items: readonly CostTask[], options: { seed: number; draws: number }): CostRatio {
  if (!Number.isSafeInteger(options.draws) || options.draws < 1000) throw new Error('pairedCostRatio needs at least 1000 draws');
  if (!items.every((t) => [t.usd_a, t.usd_b, t.solves_a, t.solves_b].every((x) => Number.isFinite(x) && x >= 0))) throw new Error('cost and solves must be finite and non-negative');
  const n = items.length;
  const ratioOf = (ua: number, sa: number, ub: number, sb: number) => (sa > 0 && sb > 0 && ua > 0 ? (ub / sb) / (ua / sa) : null);
  const totals = items.reduce((s, t) => ({ ua: s.ua + t.usd_a, sa: s.sa + t.solves_a, ub: s.ub + t.usd_b, sb: s.sb + t.solves_b }), { ua: 0, sa: 0, ub: 0, sb: 0 });
  const ratio = ratioOf(totals.ua, totals.sa, totals.ub, totals.sb);
  if (ratio === null) return { tasks: n, ratio: null, ci95: null, undefined_draws: 0, note: n ? 'a side has no solve or no spend on the paired tasks' : 'no paired task' };
  if (n < 2) return { tasks: n, ratio, ci95: null, undefined_draws: 0, note: 'one paired task: no interval' };
  const rnd = seededRandom(options.seed);
  const boot: number[] = [];
  let undefinedDraws = 0;
  for (let i = 0; i < options.draws; i++) {
    let ua = 0, sa = 0, ub = 0, sb = 0;
    for (let j = 0; j < n; j++) {
      const t = items[Math.floor(rnd() * n)]!;
      ua += t.usd_a; sa += t.solves_a; ub += t.usd_b; sb += t.solves_b;
    }
    const r = ratioOf(ua, sa, ub, sb);
    if (r === null) undefinedDraws++;
    else boot.push(r);
  }
  if (undefinedDraws > options.draws * 0.05) return { tasks: n, ratio, ci95: null, undefined_draws: undefinedDraws, note: `${undefinedDraws} of ${options.draws} draws had a side with no solve or no spend, so no interval is given` };
  boot.sort((a, b) => a - b);
  const m = boot.length;
  return { tasks: n, ratio, ci95: [boot[Math.floor(m * 0.025)]!, boot[Math.ceil(m * 0.975) - 1]!], undefined_draws: undefinedDraws, note: null };
}

/** The alpha quantile of a paired delta's cluster bootstrap: the lower bound of the two-sided (1 - 2 alpha) interval,
 *  the bound nonInferiorityP compares with -tolerance. Null when the bootstrap is empty. */
export function bootstrapLowerBound(stats: PairedDelta, alpha: number): number | null {
  if (!(alpha > 0 && alpha < 0.5)) throw new Error('alpha must lie in (0, 0.5)');
  if (!stats.bootstrap.length) return null;
  return stats.bootstrap[Math.floor(stats.bootstrap.length * alpha)]!;
}

export interface CostPerSolve { usd: number; solves: number; usd_per_solve: number | null; ci95: [number, number] | null; undefined_draws: number; note: string | null }

/** sum(usd) / sum(solves) over a cell's tasks, with a percentile bootstrap over tasks. Draws with no solve are left out of
 *  the interval, which is withheld when they pass 5% of draws. */
export function costPerSolve(items: ReadonlyArray<{ usd: number; solves: number }>, options: { seed: number; draws: number }): CostPerSolve {
  if (!Number.isSafeInteger(options.draws) || options.draws < 1000) throw new Error('costPerSolve needs at least 1000 draws');
  if (!items.every((t) => Number.isFinite(t.usd) && t.usd >= 0 && Number.isFinite(t.solves) && t.solves >= 0)) throw new Error('cost and solves must be finite and non-negative');
  const usd = items.reduce((s, t) => s + t.usd, 0), solves = items.reduce((s, t) => s + t.solves, 0);
  if (!solves) return { usd, solves, usd_per_solve: null, ci95: null, undefined_draws: 0, note: 'no solve' };
  const n = items.length;
  if (n < 2) return { usd, solves, usd_per_solve: usd / solves, ci95: null, undefined_draws: 0, note: 'one task: no interval' };
  const rnd = seededRandom(options.seed);
  const boot: number[] = [];
  let undefinedDraws = 0;
  for (let i = 0; i < options.draws; i++) {
    let u = 0, s = 0;
    for (let j = 0; j < n; j++) { const t = items[Math.floor(rnd() * n)]!; u += t.usd; s += t.solves; }
    if (s > 0) boot.push(u / s);
    else undefinedDraws++;
  }
  if (undefinedDraws > options.draws * 0.05) return { usd, solves, usd_per_solve: usd / solves, ci95: null, undefined_draws: undefinedDraws, note: `${undefinedDraws} of ${options.draws} draws had no solve, so no interval is given` };
  boot.sort((a, b) => a - b);
  const m = boot.length;
  return { usd, solves, usd_per_solve: usd / solves, ci95: [boot[Math.floor(m * 0.025)]!, boot[Math.ceil(m * 0.975) - 1]!], undefined_draws: undefinedDraws, note: null };
}
