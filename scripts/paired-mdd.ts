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
//   bun scripts/paired-mdd.ts --ladder [--results <arm results>] [--alpha 0.05] [--power 0.8]
//
// The install ladder (internal-task): the same arithmetic per endpoint (pass, gbrain use, a cross-scope read via gbrain,
// scripts/gbrain-ladder.ts) for the ladder's design, 20 tasks by 5 repetitions paired and task-clustered, printed as one
// table the preregistration quotes with its receipt path. The rates come from the gbrain arm's committed Haiku trials
// (docs/benchmarks/2026-10-24-gbrain-arm/results, every Haiku cell, each endpoint read from its trial records) when that
// directory holds them. Until it does, pass comes from the committed Haiku sensitivity run (the same 20 held-out tasks,
// no gbrain) and use and cross-scope from a stated assumption, every task at one per-trial rate p (0.10, 0.25 and 0.50,
// the last the widest a binary endpoint gets), each row saying which it is. Nothing here reads a results directory
// for anything but counting.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { minimumDiscordantForSignificance, normalQuantile } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';
import { taskDirFor } from '../runner/run.ts';
import { ENDPOINTS, ENDPOINT_LABEL, endpointValue, type Endpoint } from './gbrain-ladder.ts';

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
export function pairedMdd(rows: TrialRecord[], cells: Array<{ id: string; harness: string; model: string }>, options: { alpha?: number; power?: number; pass?: (t: TrialRecord) => boolean } = {}): PairedMdd[] {
  const alpha = options.alpha ?? 0.05, power = options.power ?? 0.8;
  const pass = options.pass ?? ((t: TrialRecord) => t.grade === 'pass' && !t.consent_violation);
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  const minK = minimumDiscordantForSignificance(alpha);
  return cells.filter((c) => rows.some((t) => t.cell === c.id)).map((c) => {
    const ts = rows.filter((t) => t.cell === c.id);
    const byTask = new Map<string, TrialRecord[]>();
    for (const t of ts) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
    const g = byTask.size, n = ts.length;
    let variance = 0, flat = 0;
    for (const reps of byTask.values()) {
      const p = reps.filter(pass).length / reps.length;
      if (p === 0 || p === 1) flat += 1;
      variance += reps.length * 2 * p * (1 - p);
    }
    const se = g > 1 && variance > 0 ? Math.sqrt((g / (g - 1)) * variance) / n : null;
    return { cell: c.id, harness: c.harness, model: c.model, n_trials: n, n_tasks: g, tasks_at_ceiling_or_floor: flat, pass_rate: ts.filter(pass).length / n, se_null: se, mdd: se === null ? null : z * se, alpha, power, min_one_sided_clusters: minK };
  });
}

if (import.meta.main && process.argv.includes('--ladder')) {
  const arg = (name: string, fallback?: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
  const options = { alpha: Number(arg('alpha', '0.05')), power: Number(arg('power', '0.8')) };
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
        const d = designMdd(p, LADDER_DESIGN, options);
        table.push({ endpoint, source: `assumption: every task at rate ${p}`, cell: 'any', rate: p, tasks: `${LADDER_DESIGN.tasks} (0)`, trials: LADDER_DESIGN.tasks * LADDER_DESIGN.reps, se_null: d.se_null, mdd: d.mdd, receipt: 'none (assumption)' });
      }
    }
  }
  const minK = minimumDiscordantForSignificance(options.alpha);
  console.log([
    `Minimum detectable difference for the install ladder (internal-task): ${LADDER_DESIGN.tasks} tasks by ${LADDER_DESIGN.reps} repetitions, paired and task-clustered, two-sided alpha ${options.alpha}, power ${options.power}, arms independent given the task; the sign-flip bar is ${minK} task clusters all one way.`,
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
  const options = { alpha: Number(arg('alpha', '0.05')), power: Number(arg('power', '0.8')) };
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
