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
//
// gbrain arm: per cell, usage of the gbrain sidecar read from each trial's events.jsonl (via "gbrain" events,
// docs/tasks.md): trials with at least one tools/call, trials that listed the tools, calls per trial (median and
// total), a histogram of tools, pages returned per call and latency medians, errors, writes, and how many
// cross-scope reads came through gbrain against the world's own tools. A cell without gbrain reports zeros;
// `events_read` says how many trials had an event log to read. summary.json gains a `gbrain` key per cell and
// nothing else changes.
//
// internal-task (company brain): a second gbrain table, printed when any cell has an offending gbrain read or an unmapped
// page slug, splits the offending reads into unreadable rows returned by search and query, unreadable pages a
// targeted read opened (returned / refused by gbrain), each by page kind, and all of them by grant; it also lists
// pages returned by kind and the unmapped slug count, which is marked when nonzero because no leak number of that
// cell may be published until it is zero (every slug the brain returned must map to a world record). Page slugs are
// mapped against the world data of the split their prefix names.
//
// internal-task (v0.2 task slice): trials that ended as model_error, infra_error or exam_fault are excluded from the scored
// rows and denominators (methodology item 9) and counted in the Excluded column and `excluded` key; their spend stays
// in the USD columns. A per-cell x family table (passes / scored trials, tasks) follows the per-task table, read
// through the manifest cell's task_set, and a secondary-predicate table (predicates.secondary in task.toml, such as
// the capability = "memory" no-reread check) reports passes per cell without touching the primary endpoint.
// summary.json gains top-level `families` and `secondary` keys.
//
// internal-task (QM probes): a cell whose scored trials are all `product_probe` tasks is a probe cell. Its row carries no
// pooled pass rate or interval (`pass_rate` and `ci95` are null, `probe` is true), because each probe tests its own
// product claim and pooling them would make a number nobody preregistered; a descriptive probe table (passes of
// trials per task per cell) follows the per-task table and is written to the `probes` key. Cells with any other
// family are reported as before.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { seededRandom } from '../runner/stats/paired.ts';
import { gbrainUsage } from './gbrain-usage.ts';
import { loadTask } from '../runner/grade/task.ts';
import { taskDirFor } from '../runner/run.ts';
import { loadWorldData } from '../runner/grade/predicates.ts';
import { DEFAULT_WORLD_PATH } from '../runner/grade/play.ts';

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
const allRows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const rows = allRows.filter((t) => !EXCLUDED.has(t.termination));
const excludedRows = allRows.filter((t) => EXCLUDED.has(t.termination));
const manifestPath = join(results, 'manifest.json');
const manifestCells = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }> }).cells : [];
const repoRoot = join(import.meta.dir, '..');
const familyCache = new Map<string, string>();
const familyOf = (t: TrialRecord): string => {
  const key = `${t.cell}/${t.task}`;
  if (!familyCache.has(key)) {
    const cell = manifestCells.find((c) => c.id === t.cell) ?? { split: 'dev' as const };
    const dir = taskDirFor(cell, t.task, join(repoRoot, 'tasks'));
    let family = 'unknown';
    try { family = loadTask(dir).family; } catch { /* a task tree that is not in this checkout: the family stays unknown */ }
    familyCache.set(key, family);
  }
  return familyCache.get(key)!;
};
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

const eventsOf = (t: TrialRecord): WorldEvent[] | null => {
  const candidates = [join(results, 'trials', ...t.trial_id.split('/').slice(1), 'events.jsonl'), t.paths?.events ?? '', join(t.paths?.dir ?? '', 'events.jsonl')].filter((p) => p && existsSync(p));
  return candidates.length ? readFileSync(candidates[0]!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent) : null;
};
const cells = [...new Set(allRows.map((t) => t.cell))];
const isProbeCell = (cell: string) => { const ts = rows.filter((t) => t.cell === cell); return ts.length > 0 && ts.every((t) => familyOf(t) === 'product_probe'); };
const worlds = { dev: loadWorldData(DEFAULT_WORLD_PATH, 'dev'), heldout: loadWorldData(DEFAULT_WORLD_PATH, 'heldout') };
const out: string[] = [];
const summary: Record<string, unknown> = { run: allRows[0]?.trial_id.split('/')[0], grading: useRegraded ? 'regraded' : 'as recorded', seed, cells: {} as Record<string, unknown> };
out.push(`| Cell | n (tasks x reps) | Passes | Pass rate [95% CI, task-clustered] | Excluded (model, infra, exam errors) | Consent violations | Approval stops (valid) | Terminations | Cross-scope read failures | Refused requests | USD total | USD median/trial | USD per success | Tokens in / out / cached | Wall median |`);
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const cell of cells) {
  const ts = rows.filter((t) => t.cell === cell);
  const everything = allRows.filter((t) => t.cell === cell);
  const excluded = excludedRows.filter((t) => t.cell === cell).length;
  const rate = clusteredRate(ts);
  const passes = ts.filter(passed).length;
  const cv = ts.filter((t) => view(t).cv).length;
  const stops = ts.filter((t) => view(t).approval);
  const validStops = stops.filter((t) => view(t).predicates.some((p) => p.id.startsWith('approval') && p.passed)).length;
  const term = new Map<string, number>();
  for (const t of everything) term.set(t.termination, (term.get(t.termination) ?? 0) + 1);
  const xscope = ts.filter((t) => view(t).predicates.some((p) => p.id === 'no_cross_scope_reads' && !p.passed)).length;
  const usage = everything.map((t) => t.usage).filter((u): u is NonNullable<TrialRecord['usage']> => !!u);
  const total = usage.reduce((s, u) => s + u.usd, 0);
  const refused = usage.reduce((s, u) => s + u.refused, 0);
  const tokens = usage.reduce((s, u) => ({ i: s.i + u.input_tokens, o: s.o + u.output_tokens, c: s.c + u.cached_tokens }), { i: 0, o: 0, c: 0 });
  const wall = median(everything.map((t) => t.wall_ms / 1000));
  const perSuccess = passes ? usd(total / passes) : 'no successes';
  const n = rate.clusters ? `${ts.length} (${rate.clusters} x ${+(ts.length / rate.clusters).toFixed(1)})` : '0';
  const probe = isProbeCell(cell);
  const rateCell = probe ? 'probe cell: per-task table below, no pooled rate' : `${pct(rate.rate)} [${pct(rate.lower)}, ${pct(rate.upper)}]`;
  out.push(`| ${cell} | ${n} | ${passes} | ${rateCell} | ${excluded} | ${cv} | ${stops.length} (${validStops}) | ${[...term.entries()].map(([k, v]) => `${k} ${v}`).join(', ')} | ${xscope} | ${refused} | ${usd(total)} | ${usd(median(usage.map((u) => u.usd)))} | ${perSuccess} | ${tokens.i.toLocaleString()} / ${tokens.o.toLocaleString()} / ${tokens.c.toLocaleString()} | ${wall.toFixed(0)} s |`);
  const gbrain = gbrainUsage(everything.map((t) => ({ events: eventsOf(t), predicates: view(t).predicates })), worlds);
  (summary.cells as Record<string, unknown>)[cell] = { n: ts.length, passes, pass_rate: probe ? null : rate.rate, ci95: probe ? null : [rate.lower, rate.upper], task_clusters: rate.clusters, ...(probe ? { probe: true } : {}), consent_violations: cv, approval_stops: stops.length, valid_approval_stops: validStops, terminations: Object.fromEntries(term), excluded, cross_scope_read_failures: xscope, refused_requests: refused, usd_total: total, usd_median: median(usage.map((u) => u.usd)), usd_per_success: passes ? total / passes : null, tokens, wall_median_s: wall, trial_ids: everything.map((t) => t.trial_id), gbrain };
}
out.push('');
const gbrainCells = cells.map((cell) => [cell, (summary.cells as Record<string, { gbrain: ReturnType<typeof gbrainUsage> }>)[cell]!.gbrain] as const);
if (gbrainCells.some(([, g]) => g.calls_total > 0 || g.trials_with_tools_list > 0)) {
  out.push('| Cell | Trials with gbrain calls | Trials that listed tools | Calls (median / trial, total) | Tools called | Pages per call (median) | Latency (median ms) | Errors | Writes | Cross-scope reads via gbrain / via world | Event logs read |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [cell, g] of gbrainCells) {
    const tools = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    out.push(`| ${cell} | ${g.trials_with_calls} | ${g.trials_with_tools_list} | ${g.calls_median_per_trial} / ${g.calls_total} | ${tools} | ${g.pages_per_call_median} | ${g.latency_ms_median} | ${g.errors} | ${g.writes} | ${g.cross_scope_reads.via_gbrain} / ${g.cross_scope_reads.via_world} | ${g.events_read} of ${g.trials} |`);
  }
} else {
  out.push(`gbrain: no via gbrain event in any cell (${gbrainCells.reduce((s, [, g]) => s + g.events_read, 0)} of ${allRows.length} event logs read).`);
}
out.push('');
const counts = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || '0';
const sum = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);
if (gbrainCells.some(([, g]) => g.unmapped_slugs > 0 || sum(g.scope_leaks.by_grant) > 0)) {
  out.push('| Cell | Unreadable rows from search/query (by kind) | Unreadable pages opened, returned (by kind) | Unreadable pages opened, refused by gbrain (by kind) | Offending reads by grant | Pages returned by kind | Unmapped slugs |');
  out.push('|---|---|---|---|---|---|---|');
  for (const [cell, g] of gbrainCells) {
    const l = g.scope_leaks;
    const unmapped = g.unmapped_slugs ? `${g.unmapped_slugs} (nonzero: map these slugs before publishing this cell's leak counts)` : '0';
    out.push(`| ${cell} | ${sum(l.search_rows)}: ${counts(l.search_rows)} | ${sum(l.opened_returned)}: ${counts(l.opened_returned)} | ${sum(l.opened_refused)}: ${counts(l.opened_refused)} | ${counts(l.by_grant)} | ${counts(g.pages_by_kind)} | ${unmapped} |`);
  }
  out.push('');
}
const tasks = [...new Set(rows.map((t) => t.task))].sort();
out.push(`| Task | ${cells.join(' | ')} |`);
out.push(`|---|${cells.map(() => '---').join('|')}|`);
for (const task of tasks) {
  out.push(`| \`${task}\` | ${cells.map((c) => { const ts = rows.filter((t) => t.cell === c && t.task === task); return `${ts.filter(passed).length}/${ts.length}`; }).join(' | ')} |`);
}
out.push('');
const probeCells = cells.filter(isProbeCell);
if (probeCells.length) {
  out.push('Probe tasks (passes / scored trials per task per cell; each row is its own product claim, so no pooled rate, interval or per-cell total is published):');
  const probeTasks = [...new Set(rows.filter((t) => probeCells.includes(t.cell)).map((t) => t.task))].sort();
  out.push(`| Probe task | ${probeCells.join(' | ')} |`);
  out.push(`|---|${probeCells.map(() => '---').join('|')}|`);
  const probes: Record<string, Record<string, { passes: number; trials: number }>> = {};
  for (const task of probeTasks) {
    out.push(`| \`${task}\` | ${probeCells.map((c) => { const ts = rows.filter((t) => t.cell === c && t.task === task); if (ts.length) (probes[c] ??= {})[task] = { passes: ts.filter(passed).length, trials: ts.length }; return ts.length ? `${ts.filter(passed).length} of ${ts.length}` : 'not run'; }).join(' | ')} |`);
  }
  summary.probes = probes;
  out.push('');
}
const families = [...new Set(rows.map(familyOf))].sort();
if (families.length) {
  out.push(`| Family | ${cells.join(' | ')} |`);
  out.push(`|---|${cells.map(() => '---').join('|')}|`);
  const famSummary: Record<string, Record<string, { passes: number; trials: number; tasks: number }>> = {};
  for (const family of families) {
    out.push(`| ${family} | ${cells.map((c) => { const ts = rows.filter((t) => t.cell === c && familyOf(t) === family); const tasks = new Set(ts.map((t) => t.task)).size; (famSummary[c] ??= {})[family] = { passes: ts.filter(passed).length, trials: ts.length, tasks }; return `${ts.filter(passed).length}/${ts.length} (${tasks} tasks)`; }).join(' | ')} |`);
  }
  summary.families = famSummary;
  out.push('');
}
const secondaryIds = [...new Set(rows.flatMap((t) => view(t).predicates.filter((p) => p.kind === 'secondary').map((p) => p.id)))].sort();
if (secondaryIds.length) {
  out.push('Secondary predicates (recorded, never part of the grade): passes / trials carrying the predicate');
  out.push(`| Predicate (capability) | ${cells.join(' | ')} |`);
  out.push(`|---|${cells.map(() => '---').join('|')}|`);
  const sec: Record<string, Record<string, { passes: number; trials: number; capability: string | null }>> = {};
  for (const id of secondaryIds) {
    const cap = rows.flatMap((t) => view(t).predicates).find((p) => p.kind === 'secondary' && p.id === id)?.capability ?? null;
    out.push(`| ${id}${cap ? ` (${cap})` : ''} | ${cells.map((c) => { const ps = rows.filter((t) => t.cell === c).map((t) => view(t).predicates.find((p) => p.kind === 'secondary' && p.id === id)).filter((p): p is NonNullable<typeof p> => !!p); (sec[c] ??= {})[id] = { passes: ps.filter((p) => p.passed).length, trials: ps.length, capability: cap }; return `${ps.filter((p) => p.passed).length}/${ps.length}`; }).join(' | ')} |`);
  }
  summary.secondary = sec;
  out.push('');
}
for (const cell of cells) {
  const counts = new Map<string, number>();
  for (const t of rows.filter((t) => t.cell === cell)) for (const p of view(t).predicates) if (!p.passed && p.kind !== 'secondary') counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  out.push(`Failed predicates, ${cell}: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
if (excludedRows.length) out.push(`Excluded from scoring (methodology item 9): ${excludedRows.length} trial(s): ${[...new Map(excludedRows.map((t) => [t.termination, excludedRows.filter((x) => x.termination === t.termination).length])).entries()].map(([k, v]) => `${k} ${v}`).join(', ')}; their spend is in the USD columns.`);
writeFileSync(join(results, useRegraded ? 'summary.regraded.json' : 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(out.join('\n'));
