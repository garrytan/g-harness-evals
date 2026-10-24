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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { minimumDiscordantForSignificance, normalQuantile } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';

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

if (import.meta.main) {
  const arg = (name: string, fallback?: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
  const results = arg('results');
  if (!results || !existsSync(join(results, 'trials.jsonl')) || !existsSync(join(results, 'manifest.json'))) {
    console.error('usage: bun scripts/paired-mdd.ts --results <results/<run-id>> [--families a,b] [--alpha 0.05] [--power 0.8]');
    process.exit(2);
  }
  const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; split: 'dev' | 'heldout' }> };
  const repoRoot = join(import.meta.dir, '..');
  const familyOf = new Map<string, string>();
  for (const t of rows) {
    if (familyOf.has(t.task)) continue;
    const split = manifest.cells.find((c) => c.id === t.cell)?.split ?? 'dev';
    familyOf.set(t.task, loadTask(join(repoRoot, 'tasks', 'multiuser', split, t.task)).family);
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
