#!/usr/bin/env bun
// Minimum detectable difference for the within-run paired design (a harness with gbrain against the same harness
// without it, same tasks and repetition indices), estimated from an existing run's trials.
//
//   bun scripts/paired-mdd.ts --results <results/<run-id>> [--families a,b] [--alpha 0.05] [--power 0.8]
//
// For each cell: the per-task pass rate p_t over its repetitions stands in for both arms under the null that
// gbrain changes nothing, and the two arms are taken as independent given the task, so a paired difference
// has variance 2 p_t (1 - p_t) per trial. The cluster-robust standard error of the mean difference is then the
// one runner/stats/paired.ts computes, g/(g-1) times the sum of the per-task variances over n squared, and the
// minimum detectable difference is (z_{1-alpha/2} + z_{power}) times that error, the same arithmetic as
// powerNote. Tasks at 0 of 5 or 5 of 5 add no variance, so a run near the ceiling gives a small number: it says
// what the design detects if gbrain moves trials on the tasks that already vary, not what it would take to break
// a task every harness passes. Beside it, the sign-flip bar the held-out preregistration states: the fewest task
// clusters that must all move one way for an exact two-sided sign-flip test to reach alpha. Two scopes: the
// primary families (scope_isolation, shared_channel, org_security, handoff, or --families) and all tasks.
//
//   bun scripts/paired-mdd.ts --ladder [--results <arm results>] [--alpha 0.05] [--power 0.8] [--reps 10]
//
// The install ladder: the same arithmetic per endpoint (pass, gbrain use, a cross-scope read via gbrain,
// scripts/gbrain-ladder.ts) for the ladder's design, 20 tasks by 5 repetitions paired and task-clustered, printed as one
// table the preregistration quotes with its receipt path. The rates come from the gbrain arm's committed Haiku trials
// (docs/benchmarks/2026-10-24-gbrain-arm/results, every Haiku cell, each endpoint read from its trial records) when that
// directory holds them. Until it does, pass comes from the committed Haiku sensitivity run (the same 20 held-out tasks,
// no gbrain) and use and cross-scope from a stated assumption, every task at one per-trial rate p (0.10, 0.25 and 0.50,
// the last the widest a binary endpoint gets), each row saying which it is. Nothing here reads a results directory
// for anything but counting.
//
//   bun scripts/paired-mdd.ts --project --results <frozen-dev results> --pair <told-live cell>:<none cell> [--pair ...] [--families a,b]
//     [--tasks 36] [--reps 3] [--alpha 0.025] [--holm-family 2] [--power 0.8] [--threshold 15]
//
// A side of a --pair may join several cells of one harness with + (the v0.4 frozen-dev read keeps one cell per family and
// level, so one harness's told-live side is its frozen families' told-live cells); their tasks are pooled into that side.
//
// The v0.4 power gate (internal-task, plan decision 9(c)): a target-design projection of the minimum detectable difference for
// told-live against none, per harness, from fresh frozen-dev rows. The estimator is named in PROJECTION_ESTIMATOR and in the
// output: per task, the difference of the two arms' pass rates; the task-clustered variance of those differences is split by
// the method of moments into a between-task part (the variance of the true per-task differences, floored at 0) and a
// within-task part (each arm's unbiased binomial variance, so a task needs at least two scored trials per arm), and the two
// parts are scaled to the target design: SE = sqrt((between + within / reps) / tasks). The test is two-sided at alpha per
// opening (0.025) divided by the Holm family (the two harnesses), the level Holm's first step uses and every test of the
// family meets, with power 0.8. Beside each projected difference: the fewest repetitions at the target task count, and the
// fewest tasks at the target repetitions, that bring it to the threshold (15 points). Families default to the five v0.4
// primary families; model, infrastructure and exam errors are excluded (methodology item 9).

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { minimumDiscordantForSignificance, normalQuantile } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';
import { taskDirFor } from '../runner/run.ts';
import { ENDPOINTS, ENDPOINT_LABEL, endpointValue, type Endpoint } from './gbrain-ladder.ts';
import { PRIMARY_FAMILIES as V04_PRIMARY_FAMILIES } from './v04/next-round.ts';

export const LADDER_DESIGN = { tasks: 20, reps: 5 } as const;
export const GBRAIN_ARM_RESULTS = join('docs', 'benchmarks', '2026-10-24-gbrain-arm', 'results');
export const HAIKU_SENSITIVITY_RESULTS = join('docs', 'benchmarks', '2026-10-24-m3-sensitivity-haiku', 'results');

/** The ladder design's null standard error and minimum detectable difference when every task shares the per-trial rate p:
 *  the cluster-robust formula of pairedMdd with g tasks of r repetitions each, so n = g r and the variance per trial is
 *  2 p (1 - p). Pass-rate units. */
export function designMdd(p: number, design: { tasks: number; reps: number } = LADDER_DESIGN, options: { alpha?: number; power?: number } = {}): { se_null: number | null; mdd: number | null } {
  const alpha = options.alpha ?? 0.05, power = options.power ?? 0.8;
  const g = design.tasks, n = design.tasks * design.reps;
  if (g < 2 || p <= 0 || p >= 1) return { se_null: null, mdd: null };
  const se = Math.sqrt((g / (g - 1)) * (2 * p * (1 - p)) / n);
  return { se_null: se, mdd: (normalQuantile(1 - alpha / 2) + normalQuantile(power)) * se };
}

export const PRIMARY_FAMILIES = ['scope_isolation', 'shared_channel', 'org_security', 'handoff'];

export interface PairedMdd {
  cell: string;
  harness: string;
  model: string;
  n_trials: number;
  n_tasks: number;
  /** Tasks whose repetitions all passed or all failed; they add nothing to the null variance. */
  tasks_at_ceiling_or_floor: number;
  pass_rate: number;
  /** Cluster-robust standard error of the paired mean difference under the null, in pass-rate units. */
  se_null: number | null;
  /** Smallest absolute difference in pass rate detected with the stated power, in pass-rate units. */
  mdd: number | null;
  alpha: number;
  power: number;
  /** Fewest task clusters that must all move one way for the exact sign-flip test to reach alpha. */
  min_one_sided_clusters: number;
}

/** Pass-rate scale: 1 is 100 points. */
export function pairedMdd(rows: TrialRecord[], cells: Array<{ id: string; harness: string; model: string }>, options: { alpha?: number; power?: number; pass?: (t: TrialRecord) => boolean; designReps?: number } = {}): PairedMdd[] {
  const alpha = options.alpha ?? 0.05, power = options.power ?? 0.8;
  const pass = options.pass ?? ((t: TrialRecord) => t.grade === 'pass' && !t.consent_violation);
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  const minK = minimumDiscordantForSignificance(alpha);
  return cells.filter((c) => rows.some((t) => t.cell === c.id)).map((c) => {
    const ts = rows.filter((t) => t.cell === c.id);
    const byTask = new Map<string, TrialRecord[]>();
    for (const t of ts) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
    // designReps: the null variance and n of a design with that many repetitions per task at each task's measured rate.
    const g = byTask.size, n = options.designReps ? g * options.designReps : ts.length;
    let variance = 0, flat = 0;
    for (const reps of byTask.values()) {
      const p = reps.filter(pass).length / reps.length;
      if (p === 0 || p === 1) flat += 1;
      variance += (options.designReps ?? reps.length) * 2 * p * (1 - p);
    }
    const se = g > 1 && variance > 0 ? Math.sqrt((g / (g - 1)) * variance) / n : null;
    return { cell: c.id, harness: c.harness, model: c.model, n_trials: n, n_tasks: g, tasks_at_ceiling_or_floor: flat, pass_rate: ts.filter(pass).length / ts.length, se_null: se, mdd: se === null ? null : z * se, alpha, power, min_one_sided_clusters: minK };
  });
}

/** internal-task: the estimator of the target-design projection, printed with every projection. */
export const PROJECTION_ESTIMATOR = 'task-clustered variance of per-task paired differences (told-live minus none), split by the method of moments into a between-task part and a within-task binomial part, scaled to the target design';
export const PROJECTION_DEFAULTS = { tasks: 36, reps: 3, alpha: 0.025, holmFamily: 2, power: 0.8, threshold: 0.15 } as const;
export type ProjectionOptions = { [K in keyof typeof PROJECTION_DEFAULTS]?: number };

/** One task's scored outcomes (1 pass, 0 fail) in each arm: a is told-live, b is none. */
export interface PairedTaskOutcomes { task: string; a: number[]; b: number[] }

export interface MddProjection {
  harness: string;
  tasks_used: number;
  /** Tasks with fewer than two scored trials in an arm: their within-task variance cannot be estimated. */
  tasks_excluded: number;
  rate_a: number | null;
  rate_b: number | null;
  /** Mean over tasks of the per-task difference, a minus b. */
  mean_difference: number | null;
  /** Variance of the true per-task differences between tasks, floored at 0. */
  between_task_variance: number | null;
  /** Mean within-task variance of one paired difference (one trial per arm). */
  within_task_variance: number | null;
  tasks: number;
  reps: number;
  /** alpha divided by the Holm family size: the level of Holm's first step. */
  alpha_per_test: number;
  power: number;
  /** Projected standard error and minimum detectable difference at the target design, in pass-rate units. */
  se: number | null;
  mdd: number | null;
  threshold: number;
  /** Fewest repetitions per arm at the target task count, and fewest tasks at the target repetitions, that bring the
   *  difference to the threshold; null when no number of repetitions can (the between-task part alone is too large). */
  reps_needed: number | null;
  tasks_needed: number | null;
}

/** The v0.4 power gate's target-design projection for one harness (PROJECTION_ESTIMATOR). Pass-rate scale. */
export function projectMdd(harness: string, outcomes: PairedTaskOutcomes[], options: ProjectionOptions = {}): MddProjection {
  const o = { ...PROJECTION_DEFAULTS, ...options };
  const alphaTest = o.alpha / o.holmFamily;
  const z = normalQuantile(1 - alphaTest / 2) + normalQuantile(o.power);
  const used = outcomes.filter((t) => t.a.length >= 2 && t.b.length >= 2);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const base = {
    harness, tasks_used: used.length, tasks_excluded: outcomes.length - used.length,
    rate_a: used.length ? mean(used.flatMap((t) => t.a)) : null, rate_b: used.length ? mean(used.flatMap((t) => t.b)) : null,
    tasks: o.tasks, reps: o.reps, alpha_per_test: alphaTest, power: o.power, threshold: o.threshold,
  };
  const empty = { mean_difference: null, between_task_variance: null, within_task_variance: null, se: null, mdd: null, reps_needed: null, tasks_needed: null };
  if (used.length < 2) return { ...base, ...empty };
  const unbiased = (xs: number[]) => { const p = mean(xs); return (p * (1 - p) * xs.length) / (xs.length - 1); };
  const perTask = used.map((t) => {
    const va = unbiased(t.a), vb = unbiased(t.b);
    return { d: mean(t.a) - mean(t.b), sampling: va / t.a.length + vb / t.b.length, within: va + vb };
  });
  const dBar = mean(perTask.map((t) => t.d));
  const spread = perTask.reduce((s, t) => s + (t.d - dBar) ** 2, 0) / (perTask.length - 1);
  const between = Math.max(0, spread - mean(perTask.map((t) => t.sampling)));
  const within = mean(perTask.map((t) => t.within));
  const variance = between + within / o.reps;
  const stats = { ...base, mean_difference: dBar, between_task_variance: between, within_task_variance: within };
  if (variance <= 0) return { ...stats, se: null, mdd: null, reps_needed: null, tasks_needed: null };
  const se = Math.sqrt(variance / o.tasks);
  const target = (o.threshold / z) ** 2;
  const slack = target * o.tasks - between;
  return {
    ...stats, se, mdd: z * se,
    reps_needed: slack <= 0 ? null : Math.max(1, Math.ceil(within / slack - 1e-9)),
    tasks_needed: Math.max(2, Math.ceil(variance / target - 1e-9)),
  };
}

if (import.meta.main && process.argv.includes('--project')) {
  const argv = process.argv;
  const arg = (name: string, fallback?: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
  const results = arg('results');
  const pairs = argv.flatMap((a, i) => (a === '--pair' && argv[i + 1] ? [argv[i + 1]!.split(':')] : []));
  if (!results || !existsSync(join(results, 'trials.jsonl')) || !existsSync(join(results, 'manifest.json')) || !pairs.length || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) {
    console.error('usage: bun scripts/paired-mdd.ts --project --results <dir> --pair <told-live cell>:<none cell> [--pair ...] [--families a,b] [--tasks 36] [--reps 3] [--alpha 0.025] [--holm-family 2] [--power 0.8] [--threshold 15]');
    process.exit(2);
  }
  const num = (name: string, fallback: number) => Number(arg(name, String(fallback)));
  const options = { tasks: num('tasks', PROJECTION_DEFAULTS.tasks), reps: num('reps', PROJECTION_DEFAULTS.reps), alpha: num('alpha', PROJECTION_DEFAULTS.alpha), holmFamily: num('holm-family', PROJECTION_DEFAULTS.holmFamily), power: num('power', PROJECTION_DEFAULTS.power), threshold: num('threshold', 100 * PROJECTION_DEFAULTS.threshold) / 100 };
  const whole = (x: number) => Number.isInteger(x) && x > 0;
  const share = (x: number) => Number.isFinite(x) && x > 0 && x < 1;
  if (!whole(options.tasks) || !whole(options.reps) || !whole(options.holmFamily) || !share(options.alpha) || !share(options.power) || !share(options.threshold)) {
    console.error('paired-mdd --project: --tasks, --reps and --holm-family take whole numbers above 0, --alpha and --power a number between 0 and 1, --threshold points between 0 and 100');
    process.exit(2);
  }
  const families = arg('families')?.split(',').map((s) => s.trim()) ?? [...V04_PRIMARY_FAMILIES];
  const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const cells = (JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; split: 'dev' | 'heldout'; task_set?: string }> }).cells;
  const tasksRoot = join(import.meta.dir, '..', 'tasks');
  const familyOf = new Map<string, string>();
  const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
  const pts = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)} points`);
  const rate = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(0)}%`);
  const table: Array<{ a: string; b: string; p: MddProjection }> = [];
  for (const [a, b] of pairs as Array<[string, string]>) {
    const side = (ids: string) => ids.split('+').map((id) => cells.find((c) => c.id === id));
    const sa = side(a), sb = side(b);
    const ca = sa[0];
    if (!ca || [...sa, ...sb].some((c) => !c || c.harness !== ca.harness) || new Set([...a.split('+'), ...b.split('+')]).size !== sa.length + sb.length) {
      console.error(`paired-mdd --project: ${a}:${b} must name two cells of the manifest on one harness (a side may join several cells of that harness with +, each once)`);
      process.exit(2);
    }
    const scored = (group: typeof sa) => rows.filter((t) => {
      const cell = group.find((c) => c!.id === t.cell);
      if (!cell || EXCLUDED.has(t.termination)) return false;
      const key = `${cell.task_set ?? ''}/${cell.split}/${t.task}`;
      if (!familyOf.has(key)) familyOf.set(key, loadTask(taskDirFor(cell, t.task, tasksRoot)).family);
      return families.includes(familyOf.get(key)!);
    });
    const ra = scored(sa), rb = scored(sb);
    const pass = (t: TrialRecord) => (t.grade === 'pass' && !t.consent_violation ? 1 : 0);
    const tasks = [...new Set([...ra, ...rb].map((t) => t.task))].sort();
    table.push({ a, b, p: projectMdd(ca.harness, tasks.map((task) => ({ task, a: ra.filter((t) => t.task === task).map(pass), b: rb.filter((t) => t.task === task).map(pass) })), options) });
  }
  const thr = String(+(100 * options.threshold).toFixed(1));
  console.log([
    `Projected minimum detectable difference for told-live against none at a target design (v0.4 power gate), from ${results}.`,
    `Estimator: ${PROJECTION_ESTIMATOR}: SE = sqrt((between-task variance + within-task variance / repetitions) / tasks).`,
    `Target: ${options.tasks} tasks by ${options.reps} repetitions per arm; two-sided alpha ${options.alpha} per opening, Holm over ${options.holmFamily} harnesses (each test at ${options.alpha / options.holmFamily}, Holm's first step); power ${options.power}; threshold ${thr} points. Families: ${families.join(', ')}. Model, infrastructure and exam errors excluded.`,
    '',
    `| Harness | Told-live cell | None cell | Tasks used (excluded) | Told-live | None | Mean difference | Between-task variance | Within-task variance | Projected SE | Projected MDD | Repetitions for ${thr} points at ${options.tasks} tasks | Tasks for ${thr} points at ${options.reps} repetitions |`,
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...table.map(({ a, b, p }) => `| ${p.harness} | ${a} | ${b} | ${p.tasks_used} (${p.tasks_excluded}) | ${rate(p.rate_a)} | ${rate(p.rate_b)} | ${pts(p.mean_difference)} | ${p.between_task_variance === null ? 'n/a' : p.between_task_variance.toFixed(4)} | ${p.within_task_variance === null ? 'n/a' : p.within_task_variance.toFixed(4)} | ${pts(p.se)} | ${pts(p.mdd)} | ${p.reps_needed ?? (p.mdd === null ? 'n/a' : `not reachable at ${options.tasks} tasks`)} | ${p.tasks_needed ?? 'n/a'} |`),
  ].join('\n'));
} else if (import.meta.main && process.argv.includes('--ladder')) {
  const arg = (name: string, fallback?: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
  const options = { alpha: Number(arg('alpha', '0.05')), power: Number(arg('power', '0.8')), designReps: arg('reps') ? Number(arg('reps')) : undefined };
  const repoRoot = join(import.meta.dir, '..');
  const arm = arg('results') ?? join(repoRoot, GBRAIN_ARM_RESULTS);
  const receipt = (dir: string) => { const r = relative(repoRoot, join(dir, 'trials.jsonl')); return r.startsWith('..') ? join(dir, 'trials.jsonl') : r; };
  const readRun = (dir: string) => {
    const rows = readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
    const cells = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string }> }).cells.filter((c) => /haiku/.test(c.model));
    return { rows: rows.filter((t) => cells.some((c) => c.id === t.cell)), cells };
  };
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)} points`);
  type Row = { endpoint: Endpoint; source: string; cell: string; rate: number | null; tasks: string; trials: number; se_null: number | null; mdd: number | null; receipt: string };
  const table: Row[] = [];
  if (existsSync(join(arm, 'trials.jsonl')) && existsSync(join(arm, 'manifest.json'))) {
    const { rows, cells } = readRun(arm);
    for (const endpoint of ENDPOINTS) {
      for (const m of pairedMdd(rows, cells, { ...options, pass: (t) => endpointValue(endpoint, t, t) === 1 })) {
        table.push({ endpoint, source: 'measured', cell: m.cell, rate: m.pass_rate, tasks: `${m.n_tasks} (${m.tasks_at_ceiling_or_floor})`, trials: m.n_trials, se_null: m.se_null, mdd: m.mdd, receipt: receipt(arm) });
      }
    }
  } else {
    const sens = join(repoRoot, HAIKU_SENSITIVITY_RESULTS);
    if (existsSync(join(sens, 'trials.jsonl'))) {
      const { rows, cells } = readRun(sens);
      for (const m of pairedMdd(rows, cells, options)) table.push({ endpoint: 'pass', source: 'measured, no gbrain', cell: m.cell, rate: m.pass_rate, tasks: `${m.n_tasks} (${m.tasks_at_ceiling_or_floor})`, trials: m.n_trials, se_null: m.se_null, mdd: m.mdd, receipt: receipt(sens) });
    }
    for (const endpoint of ['use', 'cross_scope'] as const) {
      for (const p of [0.1, 0.25, 0.5]) {
        const design = { tasks: LADDER_DESIGN.tasks, reps: options.designReps ?? LADDER_DESIGN.reps };
        const d = designMdd(p, design, options);
        table.push({ endpoint, source: `assumption: every task at rate ${p}`, cell: 'any', rate: p, tasks: `${design.tasks} (0)`, trials: design.tasks * design.reps, se_null: d.se_null, mdd: d.mdd, receipt: 'none (assumption)' });
      }
    }
  }
  const minK = minimumDiscordantForSignificance(options.alpha);
  console.log([
    `Minimum detectable difference for the install ladder (internal-task): ${LADDER_DESIGN.tasks} tasks by ${options.designReps ?? LADDER_DESIGN.reps} repetitions${options.designReps ? ' (--reps: a design at that many repetitions at each task\'s measured rate)' : ''}, paired and task-clustered, two-sided alpha ${options.alpha}, power ${options.power}, arms independent given the task; the sign-flip bar is ${minK} task clusters all one way.`,
    `Rates from ${table.some((r) => r.source === 'measured') ? `the gbrain arm's Haiku trials at ${arm}` : `the committed Haiku sensitivity run for pass (no gbrain, so use and cross-scope are 0 there by construction) and a stated assumption for use and cross-scope; run again once ${GBRAIN_ARM_RESULTS} holds the arm's trials`}.`,
    '',
    '| Endpoint | Source | Cell | Rate | Tasks (at 0 or all of their repetitions) | Trials | Null SE | Minimum detectable difference | Receipt |',
    '|---|---|---|---|---|---|---|---|---|',
    ...table.map((r) => `| ${ENDPOINT_LABEL[r.endpoint]} | ${r.source} | ${r.cell} | ${r.rate === null ? 'n/a' : (100 * r.rate).toFixed(0) + '%'} | ${r.tasks} | ${r.trials} | ${pct(r.se_null)} | ${pct(r.mdd)} | ${r.receipt} |`),
  ].join('\n'));
} else if (import.meta.main) {
  const arg = (name: string, fallback?: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
  const results = arg('results');
  if (!results || !existsSync(join(results, 'trials.jsonl')) || !existsSync(join(results, 'manifest.json'))) {
    console.error('usage: bun scripts/paired-mdd.ts --results <results/<run-id>> [--families a,b] [--alpha 0.05] [--power 0.8]');
    process.exit(2);
  }
  const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; split: 'dev' | 'heldout'; task_set?: string }> };
  const repoRoot = join(import.meta.dir, '..');
  const familyOf = new Map<string, string>();
  for (const t of rows) {
    if (familyOf.has(t.task)) continue;
    const cell = manifest.cells.find((c) => c.id === t.cell) ?? { split: 'dev' as const };
    familyOf.set(t.task, loadTask(taskDirFor(cell, t.task, join(repoRoot, 'tasks'))).family);
  }
  const primary = arg('families')?.split(',').map((s) => s.trim()) ?? PRIMARY_FAMILIES;
  const options = { alpha: Number(arg('alpha', '0.05')), power: Number(arg('power', '0.8')), designReps: arg('reps') ? Number(arg('reps')) : undefined };
  const pts = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)} points`);
  const lines = [`Minimum detectable difference for a paired gbrain arm, from ${rows[0]?.trial_id.split('/')[0] ?? results}: two-sided alpha ${options.alpha}, power ${options.power}, arms independent given the task.`, ''];
  for (const [label, scope] of [[`primary families ${primary.join(', ')}`, rows.filter((t) => primary.includes(familyOf.get(t.task)!))], ['all tasks', rows]] as const) {
    lines.push(`${label[0]!.toUpperCase()}${label.slice(1)}:`, '', '| Cell | Harness | Pass rate | Tasks (at 0 or 5 of 5) | Trials | Null SE | Minimum detectable difference | Sign-flip bar |', '|---|---|---|---|---|---|---|---|');
    for (const m of pairedMdd(scope, manifest.cells, options)) {
      lines.push(`| ${m.cell} | ${m.harness} | ${(100 * m.pass_rate).toFixed(0)}% | ${m.n_tasks} (${m.tasks_at_ceiling_or_floor}) | ${m.n_trials} | ${m.se_null === null ? 'n/a' : (100 * m.se_null).toFixed(1) + ' points'} | ${pts(m.mdd)} | ${m.min_one_sided_clusters} task clusters all one way |`);
    }
    lines.push('');
  }
  console.log(lines.join('\n'));
}
