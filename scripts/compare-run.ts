#!/usr/bin/env bun
// Pairwise harness comparison for one run: task-clustered paired bootstrap on pass (1/0) per (task, repetition),
// sign-flip p-values, Holm correction across the pairs. Items are paired by task and repetition index, so each
// pair compares the same task on the same repetition; clusters are tasks.
//
//   bun scripts/compare-run.ts --results <results/<run-id>> [--regraded] [--families a,b] [--seed 7] [--draws 10000]
//
// Prints a Markdown table (delta = B minus A in pass-rate points, 95% cluster bootstrap interval, two-sided
// sign-flip p, Holm-adjusted p, clusters, pairs) and writes comparisons.json beside trials.jsonl. Intervals and
// p-values only; whether a difference is reported as a difference is the preregistration's decision sentence.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, holmAdjusted, pairObservations, type Observation } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const results = arg('results');
if (!results || !existsSync(join(results, 'trials.jsonl'))) {
  console.error('usage: bun scripts/compare-run.ts --results <results/<run-id>> [--regraded] [--families a,b] [--seed N] [--draws N]');
  process.exit(2);
}
const seed = Number(arg('seed', '7'));
const draws = Number(arg('draws', '10000'));
const useRegraded = process.argv.includes('--regraded');
const familiesArg = arg('families');
const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; split: 'dev' | 'heldout' }> };
const regraded = new Map<string, { grade: string; consent_violation: boolean }>();
if (useRegraded) {
  for (const l of readFileSync(join(results, 'trials.regraded.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l) as { trial_id: string; regraded: boolean; regraded_result?: { grade: string; consent_violation: boolean } };
    if (r.regraded && r.regraded_result) regraded.set(r.trial_id, r.regraded_result);
  }
}
const repoRoot = join(import.meta.dir, '..');
const familyOf = new Map<string, string>();
for (const t of rows) {
  if (familyOf.has(t.task)) continue;
  const split = manifest.cells.find((c) => c.id === t.cell)?.split ?? 'dev';
  familyOf.set(t.task, loadTask(join(repoRoot, 'tasks', 'multiuser', split, t.task)).family);
}
const families = familiesArg ? familiesArg.split(',').map((s) => s.trim()) : null;
const inScope = rows.filter((t) => !families || families.includes(familyOf.get(t.task)!));
const pass = (t: TrialRecord) => { const r = regraded.get(t.trial_id); const g = r ?? t; return g.grade === 'pass' && !g.consent_violation ? 1 : 0; };
const rep = (t: TrialRecord) => t.trial_id.split('/').at(-1)!;
const obs = (cell: string): Observation[] => inScope.filter((t) => t.cell === cell).map((t) => ({ id: `${t.task}/${rep(t)}`, cluster: t.task, value: pass(t), eligible: true }));
const cells = [...new Set(inScope.map((t) => t.cell))];
const pairs: Array<{ a: string; b: string }> = [];
for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) pairs.push({ a: cells[i]!, b: cells[j]! });
const deltas = pairs.map(({ a, b }) => {
  const pairing = pairObservations(obs(a), obs(b));
  const d = clusteredPairedDelta(pairing.pairs, { seed, draws });
  return { a, b, delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_clusters: d.n_clusters, n_pairs: d.n_pairs, mean_a: d.mean_a, mean_b: d.mean_b };
});
const adjusted = holmAdjusted(deltas.map((d) => d.p));
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)}`;
const lines = [
  `Scope: ${families ? `families ${families.join(', ')}` : 'all families'}; grading ${useRegraded ? 'regraded' : 'as recorded'}; seed ${seed}, ${draws} draws.`,
  '',
  '| A | B | Pass A | Pass B | B minus A (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs |',
  '|---|---|---|---|---|---|---|---|---|',
  ...deltas.map((d, i) => `| ${d.a} | ${d.b} | ${(100 * d.mean_a).toFixed(0)}% | ${(100 * d.mean_b).toFixed(0)}% | ${pts(d.delta)} [${d.ci95 ? `${pts(d.ci95[0])}, ${pts(d.ci95[1])}` : 'n/a'}] | ${d.p.toFixed(3)} (${d.p_method}) | ${adjusted[i]!.toFixed(3)} | ${d.n_clusters} | ${d.n_pairs} |`),
];
console.log(lines.join('\n'));
writeFileSync(join(results, `comparisons${families ? '.' + families.join('-') : ''}${useRegraded ? '.regraded' : ''}.json`), JSON.stringify({ scope: families, grading: useRegraded ? 'regraded' : 'as recorded', seed, draws, comparisons: deltas.map((d, i) => ({ ...d, holm_p: adjusted[i] })) }, null, 1) + '\n');
