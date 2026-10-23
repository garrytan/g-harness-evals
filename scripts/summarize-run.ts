#!/usr/bin/env bun
// Tables for a run's report from results/<run>/trials.jsonl (and trials.regraded.jsonl when present).
//
//   bun scripts/summarize-run.ts --results <results/<run-id>> [--regraded] [--seed 7]
//
// Per cell: n, passes, pass rate with a task-clustered bootstrap 95% interval (tasks resampled with
// replacement, 10,000 draws, seeded), consent violations, approval stops and how many were valid, terminations,
// cross-scope read failures, refused proxy requests, USD (total, median per trial, per success), tokens, wall
// median. Then a per-task x cell pass table and the failed-predicate counts per cell. Markdown to stdout, and
// summary.json beside trials.jsonl. Intervals, never ranks; every number comes from the trial records.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { seededRandom } from '../runner/stats/paired.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const results = arg('results');
if (!results || !existsSync(join(results, 'trials.jsonl'))) {
  console.error('usage: bun scripts/summarize-run.ts --results <results/<run-id>> [--regraded] [--seed N]');
  process.exit(2);
}
const useRegraded = process.argv.includes('--regraded');
const seed = Number(arg('seed', '7'));
const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
type Regraded = { trial_id: string; regraded: boolean; regraded_result?: { grade: string; consent_violation: boolean; approval_stop: boolean }; predicates?: TrialRecord['predicates'] };
const regraded = new Map<string, Regraded>();
if (useRegraded) {
  const f = join(results, 'trials.regraded.jsonl');
  if (!existsSync(f)) { console.error(`${f} is missing; run scripts/regrade.ts first`); process.exit(2); }
  for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l) as Regraded; regraded.set(r.trial_id, r); }
}
const view = (t: TrialRecord) => {
  const r = regraded.get(t.trial_id);
  if (r?.regraded && r.regraded_result) return { grade: r.regraded_result.grade, cv: r.regraded_result.consent_violation, approval: r.regraded_result.approval_stop, predicates: r.predicates ?? t.predicates };
  return { grade: t.grade, cv: t.consent_violation, approval: t.approval_stop, predicates: t.predicates };
};
const passed = (t: TrialRecord) => { const v = view(t); return v.grade === 'pass' && !v.cv; };

function clusteredRate(ts: TrialRecord[], draws = 10_000): { rate: number; lower: number; upper: number; clusters: number } {
  const byTask = new Map<string, TrialRecord[]>();
  for (const t of ts) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
  const tasks = [...byTask.values()];
  const rateOf = (sample: TrialRecord[][]) => { const flat = sample.flat(); return flat.length ? flat.filter(passed).length / flat.length : 0; };
  const rnd = seededRandom(seed);
  const stats: number[] = [];
  for (let i = 0; i < draws; i++) stats.push(rateOf(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!)));
  stats.sort((a, b) => a - b);
  return { rate: rateOf(tasks), lower: stats[Math.floor(0.025 * draws)]!, upper: stats[Math.min(draws - 1, Math.ceil(0.975 * draws))]!, clusters: tasks.length };
}
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;

const cells = [...new Set(rows.map((t) => t.cell))];
const out: string[] = [];
const summary: Record<string, unknown> = { run: rows[0]?.trial_id.split('/')[0], grading: useRegraded ? 'regraded' : 'as recorded', seed, cells: {} as Record<string, unknown> };
out.push(`| Cell | n (tasks x reps) | Passes | Pass rate [95% CI, task-clustered] | Consent violations | Approval stops (valid) | Terminations | Cross-scope read failures | Refused requests | USD total | USD median/trial | USD per success | Tokens in / out / cached | Wall median |`);
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const cell of cells) {
  const ts = rows.filter((t) => t.cell === cell);
  const rate = clusteredRate(ts);
  const passes = ts.filter(passed).length;
  const cv = ts.filter((t) => view(t).cv).length;
  const stops = ts.filter((t) => view(t).approval);
  const validStops = stops.filter((t) => view(t).predicates.some((p) => p.id.startsWith('approval') && p.passed)).length;
  const term = new Map<string, number>();
  for (const t of ts) term.set(t.termination, (term.get(t.termination) ?? 0) + 1);
  const xscope = ts.filter((t) => view(t).predicates.some((p) => p.id === 'no_cross_scope_reads' && !p.passed)).length;
  const usage = ts.map((t) => t.usage).filter((u): u is NonNullable<TrialRecord['usage']> => !!u);
  const total = usage.reduce((s, u) => s + u.usd, 0);
  const refused = usage.reduce((s, u) => s + u.refused, 0);
  const tokens = usage.reduce((s, u) => ({ i: s.i + u.input_tokens, o: s.o + u.output_tokens, c: s.c + u.cached_tokens }), { i: 0, o: 0, c: 0 });
  const wall = median(ts.map((t) => t.wall_ms / 1000));
  const perSuccess = passes ? usd(total / passes) : 'no successes';
  out.push(`| ${cell} | ${ts.length} (${rate.clusters} x ${ts.length / rate.clusters}) | ${passes} | ${pct(rate.rate)} [${pct(rate.lower)}, ${pct(rate.upper)}] | ${cv} | ${stops.length} (${validStops}) | ${[...term.entries()].map(([k, v]) => `${k} ${v}`).join(', ')} | ${xscope} | ${refused} | ${usd(total)} | ${usd(median(usage.map((u) => u.usd)))} | ${perSuccess} | ${tokens.i.toLocaleString()} / ${tokens.o.toLocaleString()} / ${tokens.c.toLocaleString()} | ${wall.toFixed(0)} s |`);
  (summary.cells as Record<string, unknown>)[cell] = { n: ts.length, passes, pass_rate: rate.rate, ci95: [rate.lower, rate.upper], task_clusters: rate.clusters, consent_violations: cv, approval_stops: stops.length, valid_approval_stops: validStops, terminations: Object.fromEntries(term), cross_scope_read_failures: xscope, refused_requests: refused, usd_total: total, usd_median: median(usage.map((u) => u.usd)), usd_per_success: passes ? total / passes : null, tokens, wall_median_s: wall, trial_ids: ts.map((t) => t.trial_id) };
}
out.push('');
const tasks = [...new Set(rows.map((t) => t.task))].sort();
out.push(`| Task | ${cells.join(' | ')} |`);
out.push(`|---|${cells.map(() => '---').join('|')}|`);
for (const task of tasks) {
  out.push(`| \`${task}\` | ${cells.map((c) => { const ts = rows.filter((t) => t.cell === c && t.task === task); return `${ts.filter(passed).length}/${ts.length}`; }).join(' | ')} |`);
}
out.push('');
for (const cell of cells) {
  const counts = new Map<string, number>();
  for (const t of rows.filter((t) => t.cell === cell)) for (const p of view(t).predicates) if (!p.passed) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  out.push(`Failed predicates, ${cell}: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
writeFileSync(join(results, useRegraded ? 'summary.regraded.json' : 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(out.join('\n'));
