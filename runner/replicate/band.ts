/**
 * The replication band (docs/replicate.md): what a rerun of one cell should score if nothing changed.
 *
 * Each task's true pass rate is uncertain after k passes in n published trials, so it is drawn from the Jeffreys
 * posterior Beta(k + 1/2, n - k + 1/2) before the rerun's passes are drawn. A task the published run passed 5 of 5
 * can still miss on a rerun, which a plug-in band (rate k / n) would rule out. The band is the central 95% of the
 * posterior-predictive distribution of the rerun's total passes, endpoints inclusive. Totals are discrete, so the
 * attained coverage is reported beside it instead of assumed.
 *
 * The difference (rerun minus published) is task-paired: per task, the rerun's pass rate minus the published one,
 * averaged over tasks, with a task-resampled bootstrap interval.
 *
 * Every draw comes from runner/stats/paired.ts seededRandom, so a seed gives the same band on every machine.
 */
import { seededRandom } from '../stats/paired.ts';

export interface TaskCount { task: string; k: number; n: number }
export interface Band { lo: number; hi: number; reps: number[]; draws: number; seed: number; mean: number; attained: number }
export interface Interval { estimate: number; lo: number; hi: number }

/** Terminations the scorer leaves out of the scored rows (scripts/summarize-run.ts): not the harness's answer. */
export const EXCLUDED_TERMINATIONS: ReadonlySet<string> = new Set(['model_error', 'infra_error', 'exam_fault']);

/** Per-task pass counts of one cell from trials.jsonl text, sorted by task; excluded terminations are not counted. */
export function cellCounts(trialsJsonl: string, cell: string): TaskCount[] {
  const by = new Map<string, TaskCount>();
  for (const line of trialsJsonl.split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line) as { cell: string; task: string; grade: string; termination?: string };
    if (t.cell !== cell || EXCLUDED_TERMINATIONS.has(t.termination ?? '')) continue;
    const c = by.get(t.task) ?? { task: t.task, k: 0, n: 0 };
    c.n += 1;
    if (t.grade === 'pass') c.k += 1;
    by.set(t.task, c);
  }
  return [...by.values()].sort((a, b) => (a.task < b.task ? -1 : 1));
}

function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Gamma(shape, 1) by Marsaglia and Tsang, with the shape < 1 boost. */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rand();
    return gamma(shape + 1, rand) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do { x = normal(rand); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaDraw(a: number, b: number, rand: () => number): number {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}

function binomial(n: number, p: number, rand: () => number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (rand() < p) s += 1;
  return s;
}

/** Draws of the rerun's total passes: reps[i] trials of tasks[i], each task's rate drawn from its posterior. */
export function predictiveTotals(tasks: readonly TaskCount[], reps: readonly number[], draws: number, rand: () => number, rate: 'posterior' | 'plugin' = 'posterior'): Int32Array {
  const out = new Int32Array(draws);
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const p = rate === 'posterior' ? betaDraw(t.k + 0.5, t.n - t.k + 0.5, rand) : t.k / t.n;
      s += binomial(reps[i]!, p, rand);
    }
    out[d] = s;
  }
  return out;
}

/** The central 95% band of the predictive totals, endpoints inclusive, with its attained coverage under the same draws. */
export function replicationBand(tasks: readonly TaskCount[], reps: readonly number[] | number, opts: { draws?: number; seed?: number } = {}): Band {
  const r = typeof reps === 'number' ? tasks.map(() => reps) : [...reps];
  if (r.length !== tasks.length) throw new Error('replicationBand: one repetition count per task');
  const draws = opts.draws ?? 20_000;
  const seed = opts.seed ?? 20261101;
  const totals = predictiveTotals(tasks, r, draws, seededRandom(seed)).sort();
  const lo = totals[Math.floor(0.025 * (draws - 1))]!;
  const hi = totals[Math.ceil(0.975 * (draws - 1))]!;
  let inside = 0;
  let sum = 0;
  for (const v of totals) { sum += v; if (v >= lo && v <= hi) inside += 1; }
  return { lo, hi, reps: r, draws, seed, mean: sum / draws, attained: inside / draws };
}

export interface Coverage { reps: number; truth: 'posterior' | 'published'; coverage: number; trials: number; seed: number }

/**
 * How often the band holds a rerun when nothing changed. Each round draws true task rates (from the posterior on the
 * published counts, or the published rates themselves), simulates a published run of n trials per task and a rerun of
 * reps trials per task from those rates, builds the band from the simulated published counts, and checks the rerun.
 */
export function bandCoverage(tasks: readonly TaskCount[], reps: number, opts: { rounds?: number; draws?: number; seed?: number; truth?: 'posterior' | 'published' } = {}): Coverage {
  const rounds = opts.rounds ?? 1000;
  const draws = opts.draws ?? 4000;
  const seed = opts.seed ?? 20261101;
  const truth = opts.truth ?? 'posterior';
  const rand = seededRandom(seed);
  let held = 0;
  for (let i = 0; i < rounds; i++) {
    const rates = tasks.map((t) => (truth === 'posterior' ? betaDraw(t.k + 0.5, t.n - t.k + 0.5, rand) : t.k / t.n));
    const published = tasks.map((t, j) => ({ task: t.task, k: binomial(t.n, rates[j]!, rand), n: t.n }));
    const rerun = rates.reduce((s, p) => s + binomial(reps, p, rand), 0);
    const b = replicationBand(published, reps, { draws, seed: Math.floor(rand() * 2 ** 31) });
    if (rerun >= b.lo && rerun <= b.hi) held += 1;
  }
  return { reps, truth, coverage: held / rounds, trials: rounds, seed };
}

/** Rerun minus published pass rate, task-paired, with a 95% task-resampled bootstrap interval. */
export function pairedDifference(published: readonly TaskCount[], rerun: readonly TaskCount[], opts: { resamples?: number; seed?: number } = {}): Interval {
  const byTask = new Map(published.map((t) => [t.task, t] as const));
  const d = rerun.filter((t) => t.n > 0 && byTask.has(t.task)).map((t) => t.k / t.n - byTask.get(t.task)!.k / byTask.get(t.task)!.n);
  return bootstrapMean(d, opts);
}

/** A cell's pass rate, the mean of per-task rates, with a 95% task-resampled bootstrap interval. */
export function passRate(tasks: readonly TaskCount[], opts: { resamples?: number; seed?: number } = {}): Interval {
  return bootstrapMean(tasks.filter((t) => t.n > 0).map((t) => t.k / t.n), opts);
}

function bootstrapMean(xs: readonly number[], opts: { resamples?: number; seed?: number }): Interval {
  if (!xs.length) return { estimate: Number.NaN, lo: Number.NaN, hi: Number.NaN };
  const resamples = opts.resamples ?? 10_000;
  const rand = seededRandom(opts.seed ?? 20261101);
  const means = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]!;
    means[b] = s / xs.length;
  }
  means.sort();
  return { estimate: xs.reduce((a, b) => a + b, 0) / xs.length, lo: means[Math.floor(0.025 * (resamples - 1))]!, hi: means[Math.ceil(0.975 * (resamples - 1))]! };
}
