#!/usr/bin/env bun
// Paired within-model contrasts of spend (internal-task), from a mined waterfall (scripts/waterfall/mine.ts).
//
//   bun scripts/waterfall/contrasts.ts --mined <waterfall.json> --schedule <run manifest.json> [--schedule ...]
//     [--pair <cell A>,<cell B> ...] [--seed 7] [--draws 10000] [--out <contrasts.json>]
//
// Without --pair, every pair of cells that share a model is compared. Each contrast:
//   - pairs trials by task and repetition on the tasks present in both cells, and prints what it excluded;
//   - dollars per trial, B minus A: runner/stats/paired.ts clusteredPairedDelta, task-clustered;
//   - dollars per success: sum of dollars over sum of passes in each cell, with a task-cluster bootstrap that resamples
//     whole tasks for both cells at once. A task with no pass still adds its dollars. A resample with no pass in a cell
//     has no finite ratio: its interval end is null (unbounded), and when a resample has no pass in either cell the
//     difference has no interval at all;
//   - pass rate, B minus A, beside it, flagged "confounded by work done" when its interval excludes zero, because a
//     cell that passes more tasks may spend more for that reason alone;
//   - "inconclusive (incomplete cell)" when either cell has fewer trials than the run manifest scheduled.
// A pass is grade "pass" with no consent violation. Every trial run counts, whatever its termination, since its spend
// is real. Seeded and deterministic.
import { readFileSync, writeFileSync } from 'node:fs';
import { clusteredPairedDelta, pairObservations, seededRandom, type Observation } from '../../runner/stats/paired.ts';

export interface ContrastTrial { cell: string; task: string; rep: number; usd: number; pass: boolean }
export interface Options { seed: number; draws: number }
type Interval = [number | null, number | null];

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const finiteOrNull = (x: number) => (Number.isFinite(x) ? x : null);
const percentile = (sorted: number[]): Interval => [finiteOrNull(sorted[Math.floor(sorted.length * 0.025)]!), finiteOrNull(sorted[Math.ceil(sorted.length * 0.975) - 1]!)];

/** Ratio of summed dollars to summed passes for each side, and B minus A, resampling tasks. */
export function dollarsPerSuccess(pairs: ReadonlyArray<{ task: string; a: ContrastTrial; b: ContrastTrial }>, options: Options) {
  const byTask = new Map<string, { ua: number; pa: number; ub: number; pb: number }>();
  for (const { task, a, b } of pairs) {
    const s = byTask.get(task) ?? { ua: 0, pa: 0, ub: 0, pb: 0 };
    s.ua += a.usd; s.pa += a.pass ? 1 : 0; s.ub += b.usd; s.pb += b.pass ? 1 : 0;
    byTask.set(task, s);
  }
  const tasks = [...byTask.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, s]) => s);
  const ratio = (u: number, p: number) => (p > 0 ? u / p : Infinity);
  const total = (k: 'ua' | 'pa' | 'ub' | 'pb') => sum(tasks.map((t) => t[k]));
  const ra = ratio(total('ua'), total('pa')), rb = ratio(total('ub'), total('pb'));
  const drawsA: number[] = [], drawsB: number[] = [], deltas: number[] = [];
  let undefinedDraws = 0;
  const rng = seededRandom(options.seed);
  for (let d = 0; d < options.draws; d++) {
    let ua = 0, pa = 0, ub = 0, pb = 0;
    for (let j = 0; j < tasks.length; j++) { const t = tasks[Math.floor(rng() * tasks.length)]!; ua += t.ua; pa += t.pa; ub += t.ub; pb += t.pb; }
    const x = ratio(ua, pa), y = ratio(ub, pb);
    drawsA.push(x); drawsB.push(y);
    if (!Number.isFinite(x) && !Number.isFinite(y)) undefinedDraws++;
    else deltas.push(y - x);
  }
  for (const xs of [drawsA, drawsB, deltas]) xs.sort((p, q) => p - q);
  const side = (r: number, draws: number[], key: 'pa' | 'pb') => ({ usd_per_success: finiteOrNull(r), ci95: tasks.length > 1 ? percentile(draws) : null,
    zero_success_tasks: tasks.filter((t) => t[key] === 0).length, zero_success_draws: draws.filter((x) => !Number.isFinite(x)).length });
  return {
    a: side(ra, drawsA, 'pa'), b: side(rb, drawsB, 'pb'),
    delta: Number.isFinite(ra) && Number.isFinite(rb) ? rb - ra : null,
    ci95: tasks.length > 1 && undefinedDraws === 0 ? percentile(deltas) : null,
    undefined_draws: undefinedDraws,
  };
}

export function contrast(a: readonly ContrastTrial[], b: readonly ContrastTrial[], scheduled: { a: number; b: number }, options: Options) {
  const tasksA = new Set(a.map((t) => t.task)), tasksB = new Set(b.map((t) => t.task));
  const shared = [...tasksA].filter((t) => tasksB.has(t));
  const id = (t: ContrastTrial) => `${t.task}/r${t.rep}`;
  const idsA = new Set(a.filter((t) => tasksB.has(t.task)).map(id)), idsB = new Set(b.filter((t) => tasksA.has(t.task)).map(id));
  const inA = a.filter((t) => idsB.has(id(t))), inB = b.filter((t) => idsA.has(id(t)));
  const excluded = {
    tasks_only_in_a: [...tasksA].filter((t) => !tasksB.has(t)).sort(), tasks_only_in_b: [...tasksB].filter((t) => !tasksA.has(t)).sort(),
    unpaired_trials: [...a.filter((t) => tasksB.has(t.task) && !idsB.has(id(t))).map((t) => `A ${id(t)}`), ...b.filter((t) => tasksA.has(t.task) && !idsA.has(id(t))).map((t) => `B ${id(t)}`)].sort(),
  };
  const status = a.length < scheduled.a || b.length < scheduled.b ? 'inconclusive (incomplete cell)' : 'complete';
  const trials = { a: a.length, b: b.length, scheduled_a: scheduled.a, scheduled_b: scheduled.b, tasks: shared.length };
  if (!inA.length) return { status: 'not compared (no paired trials)', trials: { ...trials, paired: 0 }, excluded, dollars_per_trial: null, dollars_per_success: null, pass_rate: null, confounded_by_work_done: false };
  const obs = (rows: readonly ContrastTrial[], value: (t: ContrastTrial) => number): Observation[] => rows.map((t) => ({ id: id(t), cluster: t.task, value: value(t), eligible: true }));
  const usd = pairObservations(obs(inA, (t) => t.usd), obs(inB, (t) => t.usd)).pairs;
  const pass = pairObservations(obs(inA, (t) => (t.pass ? 1 : 0)), obs(inB, (t) => (t.pass ? 1 : 0))).pairs;
  const spend = clusteredPairedDelta(usd, options), rate = clusteredPairedDelta(pass, options);
  const byId = new Map(inB.map((t) => [id(t), t]));
  const perSuccess = dollarsPerSuccess(inA.map((t) => ({ task: t.task, a: t, b: byId.get(id(t))! })), options);
  const confounded = rate.ci95 !== null && (rate.ci95[0] > 0 || rate.ci95[1] < 0);
  return {
    status,
    trials: { ...trials, paired: usd.length },
    excluded,
    dollars_per_trial: { mean_a: spend.mean_a, mean_b: spend.mean_b, delta: spend.delta, ci95: spend.ci95, p_two_sided: spend.p_two_sided, n_clusters: spend.n_clusters },
    dollars_per_success: perSuccess,
    pass_rate: { a: rate.mean_a, b: rate.mean_b, delta: rate.delta, ci95: rate.ci95 },
    confounded_by_work_done: confounded,
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const all = (n: string) => argv.flatMap((x, i) => (x === `--${n}` && argv[i + 1] ? [argv[i + 1]!] : []));
  const minedPath = arg('mined'), schedules = all('schedule');
  if (!minedPath || !schedules.length) { console.error('usage: bun scripts/waterfall/contrasts.ts --mined <waterfall.json> --schedule <run manifest.json> [--pair A,B] [--seed 7] [--draws 10000] [--out <json>]'); process.exit(64); }
  const options = { seed: Number(arg('seed') ?? 7), draws: Number(arg('draws') ?? 10000) };
  const mined = JSON.parse(readFileSync(minedPath, 'utf8')) as { cells: Array<{ cell: string; model: string }>; trials: Array<{ cell: string; task: string; rep: number; pass: boolean; bill: { actual_usd?: number } }> };
  const scheduled = new Map<string, number>();
  for (const s of schedules) for (const t of (JSON.parse(readFileSync(s, 'utf8')) as { trials: Array<{ cell: string }> }).trials) scheduled.set(t.cell, (scheduled.get(t.cell) ?? 0) + 1);
  const modelOf = new Map(mined.cells.map((c) => [c.cell, c.model]));
  const pairs = all('pair').map((p) => p.split(',') as [string, string]);
  if (!pairs.length) mined.cells.forEach((x, i) => mined.cells.slice(i + 1).forEach((y) => { if (x.model === y.model) pairs.push([x.cell, y.cell]); }));
  const trialsOf = (cell: string): ContrastTrial[] => mined.trials.filter((t) => t.cell === cell).map((t) => ({ cell, task: t.task, rep: t.rep, usd: t.bill.actual_usd ?? 0, pass: t.pass }));
  const money = (x: number | null) => (x === null ? 'unbounded' : `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(4)}`);
  const results = pairs.map(([a, b]) => {
    if (!modelOf.has(a) || !modelOf.has(b)) throw new Error(`unknown cell in pair ${a},${b}`);
    if (modelOf.get(a) !== modelOf.get(b)) throw new Error(`${a} (${modelOf.get(a)}) and ${b} (${modelOf.get(b)}) use different models; contrasts stay within one model`);
    if (!scheduled.has(a) || !scheduled.has(b)) throw new Error(`no schedule for ${scheduled.has(a) ? b : a}`);
    const r = contrast(trialsOf(a), trialsOf(b), { a: scheduled.get(a)!, b: scheduled.get(b)! }, options);
    console.log(`${b} minus ${a} (${modelOf.get(a)}): ${r.status}; ${r.trials.paired} pairs over ${r.trials.tasks} tasks`);
    const ex = r.excluded;
    if (ex.tasks_only_in_a.length || ex.tasks_only_in_b.length || ex.unpaired_trials.length) console.log(`  excluded: tasks only in A [${ex.tasks_only_in_a.join(', ')}], only in B [${ex.tasks_only_in_b.join(', ')}], unpaired trials [${ex.unpaired_trials.join(', ')}]`);
    if (r.dollars_per_trial === null) return { a, b, model: modelOf.get(a), ...r };
    const d = r.dollars_per_trial, s = r.dollars_per_success, p = r.pass_rate;
    console.log(`  dollars per trial ${money(d.delta)} [${d.ci95 ? d.ci95.map(money).join(', ') : 'no interval'}]; dollars per success ${s.delta === null ? 'undefined' : money(s.delta)} [${s.ci95 ? s.ci95.map(money).join(', ') : 'no interval'}]; pass rate ${(100 * p.delta).toFixed(1)} points [${p.ci95 ? p.ci95.map((x) => (100 * x).toFixed(1)).join(', ') : 'no interval'}]${r.confounded_by_work_done ? '; confounded by work done' : ''}`);
    return { a, b, model: modelOf.get(a), ...r };
  });
  if (arg('out')) writeFileSync(arg('out')!, JSON.stringify({ generated_by: 'scripts/waterfall/contrasts.ts', mined: minedPath, schedules, ...options, contrasts: results }, null, 2) + '\n');
}
