#!/usr/bin/env bun
// Tables for a run's report from results/<run>/trials.jsonl (and trials.regraded.jsonl when present).
//
//   bun scripts/summarize-run.ts --results <results/<run-id>> [--regraded] [--seed 7] [--sealed-root <dir>] [--allow-missing-tasks]
//
// Sealed custody (docs/sealed-custody.md): a run planned with a sealed root (its manifest.json has a
// "sealed" block) reads the sealed cells' task families from <sealed-root>/tasks and the world from
// <sealed-root>/world/world.json, so it is summarized inside custody with --sealed-root; without it the run is refused.
// In a sealed run, a task whose directory is absent from the tree the family is read from is refused with HE-TASK-005
// instead of being counted under family "unknown"; --allow-missing-tasks counts it as unknown, prints a warning and lists
// the tasks under families_unresolved in summary.json. A plaintext run keeps the fallback it always had: a task with no
// readable task.toml is family "unknown", with one WARN line and the same families_unresolved list.
// trials.jsonl and manifest.json are read before the sealed guard is up, so a line that is not JSON is HE-RUN-007 naming
// the file, the line and the parser's error class, never the parser's message (which quotes the line).
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
// The company brain: a second gbrain table, printed when any cell has an offending gbrain read or an unmapped
// page slug, splits the offending reads into unreadable rows returned by search and query, unreadable pages a
// targeted read opened (returned / refused by gbrain), each by page kind, and all of them by grant; it also lists
// pages returned by kind and the unmapped slug count, which is marked when nonzero because no leak number of that
// cell may be published until it is zero (every slug the brain returned must map to a world record). Page slugs are
// mapped against the world data of the split their prefix names.
//
// The v0.2 task slice: trials that ended as model_error, infra_error or exam_fault are excluded from the scored
// rows and denominators (methodology item 9) and counted in the Excluded column and `excluded` key; their spend stays
// in the USD columns. A per-cell x family table (passes / scored trials, tasks) follows the per-task table, read
// through the manifest cell's task_set, and a secondary-predicate table (predicates.secondary in task.toml, such as
// the capability = "memory" no-reread check) reports passes per cell without touching the primary endpoint.
// summary.json gains top-level `families` and `secondary` keys.
//
// QM probes: a cell whose scored trials are all `product_probe` tasks is a probe cell. Its row carries no
// pooled pass rate or interval (`pass_rate` and `ci95` are null, `probe` is true), because each probe tests its own
// product claim and pooling them would make a number nobody preregistered; a descriptive probe table (passes of
// trials per task per cell) follows the per-task table and is written to the `probes` key. Cells with any other
// family are reported as before.
// The install ladder: a top-level `ladder` key per cell, printed as a table when any trial carries a `gbrain` record:
// the harness's own input tokens per trial (median and total; the runner keeps the sidecar's /v1/embeddings lines out of
// this figure), the sidecar's embedding usage summed from `gbrain.embedding_usage` (requests, input tokens, USD, refused,
// failed, and how many trials carried it), the install bundle from `gbrain.install_bundle` (file count, view digest, and
// for Hermes the largest number of compiled-context pages outside an actor's scope), the semantic exclusions
// (`gbrain.semantic_check.ok` false, HE-GBRAIN-005) and the degraded calls (`gbrain.events.degraded`). Every existing
// key and table is unchanged.
// Issue #153: a cell with Claude Code or Codex installer trials (`install_bundle.turn_hook.status` "ran") also gets
// `install_bundle.turn_hook.per_turn`: those trials, how many ran the hook in every turn (`applied`), the rest by the reason
// compare-run gives them (installerNotApplied, installer_not_applied there), the turns, the turns at 0 and with no count, and
// the turns by hook runs. The Install bundle column adds the same counts for such a cell; every other cell prints as before.
// Live ingestion (gbrain-memory-2026-10's Endpoints item 3): a top-level `ingest` key with a block per cell whose records
// carry `gbrain.ingest` "live" (a cell without live ingestion gets no block), printed as a "Live ingestion" table: ingestion counts
// per trial from the record's `gbrain.ingested` (ok, skipped, failed: median per trial and total), the write latency from the
// `gbrain.ingest` events' `effect.latency_ms` (median, p90 by nearest rank, max; a skipped message made no write and is left out),
// facts returned per `search`, `query` or `recall` call (`effect.facts` length: median, max, and the share of calls returning at
// least one), and the queries those calls sent (distinct `args.query` strings with counts, the top ten per cell).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installerNotApplied, type TrialRecord } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { seededRandom } from '../runner/stats/paired.ts';
import { gbrainUsage } from './gbrain-usage.ts';
import { taskFamily } from '../runner/grade/task.ts';
import { taskDirFor } from '../runner/run.ts';
import { loadWorldData } from '../runner/grade/predicates.ts';
import { DEFAULT_WORLD_PATH } from '../runner/grade/play.ts';
import { isSealedCell } from '../runner/run.ts';
import { sealedGuard } from '../runner/heldout/guard.ts';
import { readJsonFile, readJsonLines, sealedPaths } from '../runner/heldout/sealed.ts';
import { RunnerError } from '../runner/errors.ts';

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
const parsed = <T>(read: () => T): T => { try { return read(); } catch (e) { if (!(e instanceof RunnerError)) throw e; console.error(e.message); process.exit(2); } };
const allRows = parsed(() => readJsonLines<TrialRecord>(join(results, 'trials.jsonl')));
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const rows = allRows.filter((t) => !EXCLUDED.has(t.termination));
const excludedRows = allRows.filter((t) => EXCLUDED.has(t.termination));
const manifestPath = join(results, 'manifest.json');
const runManifest = existsSync(manifestPath) ? parsed(() => readJsonFile<{ cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }>; sealed?: { set: string } }>(manifestPath)) : null;
const manifestCells = runManifest?.cells ?? [];
const repoRoot = join(import.meta.dir, '..');
const sealedSet = runManifest?.sealed?.set;
const sealedRoot = arg('sealed-root');
if (sealedSet && !sealedRoot) { console.error(`HE-SEALED-001 ${results} was planned with a sealed root (set ${sealedSet}); summarize it inside custody with --sealed-root <the opened root> (docs/sealed-custody.md)`); process.exit(2); }
if (sealedSet && sealedRoot) {
  const g = sealedGuard({ root: sealedRoot, set: sealedSet, repoRoot: process.cwd(), preregJson: (runManifest as { sealed?: { receipt?: { prereg_json?: string } } }).sealed?.receipt?.prereg_json, logFile: join(results, 'summarize-run.sealed.log'), allow: [], label: 'scripts/summarize-run.ts' });
  g.say(`summarize-run: sealed run (set ${sealedSet}); summary.json is written beside trials.jsonl and the console tables go to ${g.logFile} (custody only)`);
}
// A repo set has no world: its root holds no world/world.json, and the public world serves the gbrain slug tables.
const worldPath = sealedSet && sealedRoot && sealedPaths(sealedRoot, sealedSet).kind === 'multiuser' ? join(sealedRoot, 'world', 'world.json') : DEFAULT_WORLD_PATH;
const familyCache = new Map<string, string>();
const missingTasks = new Set<string>();
const familyOf = (t: TrialRecord): string => {
  const key = `${t.cell}/${t.task}`;
  if (!familyCache.has(key)) {
    const cell = manifestCells.find((c) => c.id === t.cell) ?? { split: 'dev' as const };
    const dir = taskDirFor(cell, t.task, isSealedCell(cell, sealedSet) ? join(sealedRoot!, 'tasks') : join(repoRoot, 'tasks'));
    let family = 'unknown';
    if (!existsSync(join(dir, 'task.toml'))) missingTasks.add(`${t.task} (cell ${t.cell}, looked in ${dir})`);
    else if (sealedSet) family = taskFamily(dir);
    else try { family = taskFamily(dir); } catch { missingTasks.add(`${t.task} (cell ${t.cell}, ${join(dir, 'task.toml')} does not load)`); }
    familyCache.set(key, family);
  }
  return familyCache.get(key)!;
};
allRows.forEach(familyOf);
if (sealedSet && missingTasks.size && !process.argv.includes('--allow-missing-tasks')) {
  console.error(`HE-TASK-005 ${missingTasks.size} task(s) of ${results} have no task.toml where their family is read: ${[...missingTasks].slice(0, 5).join('; ')}${missingTasks.size > 5 ? '; ...' : ''}; fix: run from a checkout that holds the task tree (a sealed run needs --sealed-root), or pass --allow-missing-tasks to count them under family "unknown"`);
  process.exit(2);
}
if (missingTasks.size) console.error(`WARN: HE-TASK-005 ${missingTasks.size} task(s) counted under family "unknown"${process.argv.includes('--allow-missing-tasks') ? ' (--allow-missing-tasks)' : ''}; summary.json lists them under families_unresolved`);
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

const eventsCache = new Map<string, WorldEvent[] | null>();
const eventsOf = (t: TrialRecord): WorldEvent[] | null => {
  if (eventsCache.has(t.trial_id)) return eventsCache.get(t.trial_id)!;
  const candidates = [join(results, 'trials', ...t.trial_id.split('/').slice(1), 'events.jsonl'), t.paths?.events ?? '', join(t.paths?.dir ?? '', 'events.jsonl')].filter((p) => p && existsSync(p));
  const events = candidates.length ? readFileSync(candidates[0]!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent) : null;
  eventsCache.set(t.trial_id, events);
  return events;
};
const cells = [...new Set(allRows.map((t) => t.cell))];
const isProbeCell = (cell: string) => { const ts = rows.filter((t) => t.cell === cell); return ts.length > 0 && ts.every((t) => familyOf(t) === 'product_probe'); };
const worlds = { dev: loadWorldData(worldPath, 'dev'), heldout: loadWorldData(worldPath, 'heldout') };
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
const counts = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || '0';
const sum = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);
const gbrainCells = cells.map((cell) => [cell, (summary.cells as Record<string, { gbrain: ReturnType<typeof gbrainUsage> }>)[cell]!.gbrain] as const);
if (gbrainCells.some(([, g]) => g.calls_total > 0 || g.trials_with_tools_list > 0 || g.provider)) {
  out.push('| Cell | Trials with gbrain calls | Trials that listed tools | Calls (median / trial, total) | Tools called | Pages per call (median) | Latency (median ms) | Errors | Writes | Cross-scope reads via gbrain / via world | Event logs read |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [cell, g] of gbrainCells) {
    const tools = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    out.push(`| ${cell} | ${g.trials_with_calls} | ${g.trials_with_tools_list} | ${g.calls_median_per_trial} / ${g.calls_total} | ${tools} | ${g.pages_per_call_median} | ${g.latency_ms_median} | ${g.errors} | ${g.writes}${g.write_errors ? ` (failed: ${Object.entries(g.write_errors).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} | ${g.cross_scope_reads.via_gbrain} / ${g.cross_scope_reads.via_world} | ${g.events_read} of ${g.trials} |`);
  }
  const providerCells = gbrainCells.filter(([, g]) => g.provider);
  if (providerCells.length) {
    out.push('', 'The table counts the model\'s own gbrain calls. QM\'s memory-provider client (caller provider) is counted apart:', '');
    for (const [cell, g] of providerCells) out.push(`- ${cell}: ${g.provider!.calls_total} provider call(s) in ${g.provider!.trials_with_calls} trial(s) (${counts(g.provider!.tools)}), ${g.provider!.errors} error(s), ${g.provider!.writes} write(s)`);
  }
} else {
  out.push(`gbrain: no via gbrain event in any cell (${gbrainCells.reduce((s, [, g]) => s + g.events_read, 0)} of ${allRows.length} event logs read).`);
}
out.push('');
if (gbrainCells.some(([, g]) => g.unmapped_slugs + (g.provider?.unmapped_slugs ?? 0) > 0 || sum(g.scope_leaks.by_grant) > 0)) {
  out.push('| Cell | Unreadable rows from search/query (by kind) | Unreadable pages opened, returned (by kind) | Unreadable pages opened, refused by gbrain (by kind) | Offending reads by grant | Pages returned by kind | Unmapped slugs |');
  out.push('|---|---|---|---|---|---|---|');
  for (const [cell, g] of gbrainCells) {
    const l = g.scope_leaks;
    const unmappedSlugs = g.unmapped_slugs + (g.provider?.unmapped_slugs ?? 0);
    const unmapped = unmappedSlugs ? `${unmappedSlugs} (nonzero: map these slugs before publishing this cell's leak counts)` : '0';
    out.push(`| ${cell} | ${sum(l.search_rows)}: ${counts(l.search_rows)} | ${sum(l.opened_returned)}: ${counts(l.opened_returned)} | ${sum(l.opened_refused)}: ${counts(l.opened_refused)} | ${counts(l.by_grant)} | ${counts(g.pages_by_kind)} | ${unmapped} |`);
  }
  out.push('');
}
const ladder: Record<string, unknown> = {};
for (const cell of cells) {
  const everything = allRows.filter((t) => t.cell === cell);
  const withGbrain = everything.filter((t) => t.gbrain);
  const inputTokens = everything.map((t) => t.usage?.input_tokens).filter((x): x is number => typeof x === 'number');
  const eu = withGbrain.map((t) => t.gbrain!.embedding_usage).filter((u): u is NonNullable<typeof u> => !!u);
  const bundles = withGbrain.map((t) => t.gbrain!.install_bundle).filter((b): b is NonNullable<typeof b> => !!b);
  const exposure = bundles.map((b) => b.context?.outside_scope_max).filter((x): x is number => typeof x === 'number');
  const ran = bundles.filter((b) => b.turn_hook?.status === 'ran');
  const turnRuns = ran.flatMap((b) => b.turn_hook!.turn_runs ?? []);
  const notApplied = ran.map((b) => installerNotApplied(b)).filter((r): r is string => !!r);
  const tally = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
  const perTurn = ran.length ? { trials: ran.length, applied: ran.length - notApplied.length, not_applied: tally(notApplied), turns: turnRuns.length, turns_zero: turnRuns.filter((n) => n === 0).length, turns_missing: turnRuns.filter((n) => n === null).length, runs_per_turn: tally(turnRuns.filter((n): n is number => n !== null).map(String)) } : null;
  ladder[cell] = {
    harness_input_tokens: { median_per_trial: median(inputTokens), total: inputTokens.reduce((s, n) => s + n, 0), trials: inputTokens.length },
    embedding_usage: { trials: eu.length, requests: eu.reduce((s, u) => s + u.requests, 0), input_tokens: eu.reduce((s, u) => s + u.input_tokens, 0), usd: eu.reduce((s, u) => s + u.usd, 0), refused: eu.reduce((s, u) => s + u.refused, 0), failed: eu.reduce((s, u) => s + u.failed, 0) },
    install_bundle: bundles.length ? { trials: bundles.length, files: [...new Set(bundles.map((b) => b.files))], view_digests: [...new Set(bundles.map((b) => b.view_digest))], context_outside_scope_max: exposure.length ? Math.max(...exposure) : null, turn_hook: bundles.some((b) => b.turn_hook) ? { trials: bundles.filter((b) => b.turn_hook).length, status: Object.fromEntries([...new Set(bundles.map((b) => b.turn_hook?.status).filter((s): s is string => !!s))].map((s) => [s, bundles.filter((b) => b.turn_hook?.status === s).length])), ...(perTurn ? { per_turn: perTurn } : {}) } : null } : null,
    semantic_exclusions: withGbrain.filter((t) => t.gbrain!.semantic_check && !t.gbrain!.semantic_check.ok).length,
    degraded_calls: withGbrain.reduce((s, t) => s + (t.gbrain!.events.degraded ?? 0), 0),
  };
}
summary.ladder = ladder;
if (allRows.some((t) => t.gbrain)) {
  out.push('Install ladder (internal-task): the harness\'s own input tokens, the sidecar\'s embedding usage, the install bundle, semantic exclusions and degraded calls per cell');
  out.push('| Cell | Harness input tokens / trial (median; total) | Embedding requests / input tokens / USD (trials with usage) | Embedding refused / failed | Install bundle (files; view digest; Hermes context pages outside scope, max) | Semantic exclusions (HE-GBRAIN-005) | Degraded calls |');
  out.push('|---|---|---|---|---|---|---|');
  for (const cell of cells) {
    const l = ladder[cell] as { harness_input_tokens: { median_per_trial: number; total: number }; embedding_usage: { trials: number; requests: number; input_tokens: number; usd: number; refused: number; failed: number }; install_bundle: { files: number[]; view_digests: string[]; context_outside_scope_max: number | null; turn_hook: { per_turn?: { trials: number; applied: number; turns: number; turns_zero: number; turns_missing: number } } | null } | null; semantic_exclusions: number; degraded_calls: number };
    const pt = l.install_bundle?.turn_hook?.per_turn;
    const bundle = l.install_bundle ? `${l.install_bundle.files.join('/')}; ${l.install_bundle.view_digests.map((d) => d.slice(0, 12)).join(', ')}; ${l.install_bundle.context_outside_scope_max ?? 'n/a'}${pt ? `; hook ran at ready in ${pt.trials}, ran in every turn in ${pt.applied}; turns at 0: ${pt.turns_zero} of ${pt.turns}, no count: ${pt.turns_missing}` : ''}` : 'none';
    out.push(`| ${cell} | ${l.harness_input_tokens.median_per_trial.toLocaleString()}; ${l.harness_input_tokens.total.toLocaleString()} | ${l.embedding_usage.requests} / ${l.embedding_usage.input_tokens.toLocaleString()} / $${l.embedding_usage.usd.toFixed(6)} (${l.embedding_usage.trials}) | ${l.embedding_usage.refused} / ${l.embedding_usage.failed} | ${bundle} | ${l.semantic_exclusions} | ${l.degraded_calls} |`);
  }
  out.push('');
}
// gbrain-memory-2026-10 (Endpoints item 3): live ingestion per cell, for the cells whose records carry gbrain.ingest "live".
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.min(s.length - 1, Math.ceil(q * s.length) - 1))]!; };
const QUERY_TOOLS = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall']);
const ingest: Record<string, unknown> = {};
for (const cell of cells) {
  const live = allRows.filter((t) => t.cell === cell && t.gbrain?.ingest === 'live');
  if (!live.length) continue;
  const counted = live.map((t) => t.gbrain!.ingested).filter((c): c is NonNullable<typeof c> => !!c);
  const perTrial = (key: 'ok' | 'skipped' | 'failed') => { const xs = counted.map((c) => c[key]); return { median: median(xs), total: xs.reduce((s, n) => s + n, 0) }; };
  const latency: number[] = [];
  const factsPerCall: number[] = [];
  const queries = new Map<string, number>();
  let eventsRead = 0;
  for (const t of live) {
    const events = eventsOf(t);
    if (!events) continue;
    eventsRead += 1;
    for (const e of events) {
      const effect = (e.effect ?? {}) as { latency_ms?: unknown; skipped?: unknown; facts?: unknown };
      if ((e.via as string) === 'runner' && e.tool === 'gbrain.ingest') {
        // A skipped message (a conversation the brain has no source for) made no write, so its latency is not a write latency.
        if (effect.skipped === undefined && typeof effect.latency_ms === 'number') latency.push(effect.latency_ms);
        continue;
      }
      if ((e.via as string) !== 'gbrain' || e.kind !== 'read' || !QUERY_TOOLS.has(e.tool)) continue;
      factsPerCall.push(Array.isArray(effect.facts) ? effect.facts.length : 0);
      const query = (e.args as { query?: unknown } | undefined)?.query;
      if (typeof query === 'string') queries.set(query, (queries.get(query) ?? 0) + 1);
    }
  }
  const withFact = factsPerCall.filter((n) => n > 0).length;
  ingest[cell] = {
    trials: live.length, trials_with_counts: counted.length, events_read: eventsRead,
    ingested: { ok: perTrial('ok'), skipped: perTrial('skipped'), failed: perTrial('failed') },
    write_latency_ms: { writes: latency.length, median: median(latency), p90: quantile(latency, 0.9), max: latency.length ? Math.max(...latency) : 0 },
    facts_per_call: { calls: factsPerCall.length, median: median(factsPerCall), max: factsPerCall.length ? Math.max(...factsPerCall) : 0, calls_with_fact: withFact, share_with_fact: factsPerCall.length ? withFact / factsPerCall.length : null },
    queries: { calls: [...queries.values()].reduce((s, n) => s + n, 0), distinct: queries.size, top: [...queries.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([query, count]) => ({ query, count })) },
  };
}
summary.ingest = ingest;
if (Object.keys(ingest).length) {
  out.push('Live ingestion (internal-task): per cell with gbrain.ingest live, the ingestion counts per trial from the record\'s gbrain.ingested, the write latency from the gbrain.ingest events (skipped messages made no write and are left out), facts returned per search, query or recall call, and the queries those calls sent');
  out.push('| Cell | Trials (event logs read) | Ingested ok / trial (median; total) | Skipped / trial (median; total) | Failed / trial (median; total) | Write latency ms (median / p90 / max; writes) | Facts per call (median / max; calls) | Calls returning a fact | Queries (calls; distinct) | Top queries (count) |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  const cellText = (s: string) => { const one = s.replace(/\s+/g, ' ').replace(/\|/g, '\\|'); return one.length > 80 ? one.slice(0, 77) + '...' : one; };
  for (const [cell, v] of Object.entries(ingest) as Array<[string, { trials: number; events_read: number; ingested: Record<'ok' | 'skipped' | 'failed', { median: number; total: number }>; write_latency_ms: { writes: number; median: number; p90: number; max: number }; facts_per_call: { calls: number; median: number; max: number; calls_with_fact: number; share_with_fact: number | null }; queries: { calls: number; distinct: number; top: Array<{ query: string; count: number }> } }]>) {
    const c = (k: 'ok' | 'skipped' | 'failed') => `${v.ingested[k].median}; ${v.ingested[k].total}`;
    const share = v.facts_per_call.share_with_fact === null ? 'no calls' : `${v.facts_per_call.calls_with_fact} of ${v.facts_per_call.calls} (${pct(v.facts_per_call.share_with_fact)})`;
    out.push(`| ${cell} | ${v.trials} (${v.events_read}) | ${c('ok')} | ${c('skipped')} | ${c('failed')} | ${v.write_latency_ms.median} / ${v.write_latency_ms.p90} / ${v.write_latency_ms.max}; ${v.write_latency_ms.writes} | ${v.facts_per_call.median} / ${v.facts_per_call.max}; ${v.facts_per_call.calls} | ${share} | ${v.queries.calls}; ${v.queries.distinct} | ${v.queries.top.map((q) => `"${cellText(q.query)}" ${q.count}`).join(', ') || 'none'} |`);
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
  out.push('Secondary predicates (recorded, never part of the grade): passes / trials carrying the predicate, then the same among trials that passed the task');
  out.push(`| Predicate (capability) | ${cells.join(' | ')} |`);
  out.push(`|---|${cells.map(() => '---').join('|')}|`);
  const sec: Record<string, Record<string, { passes: number; trials: number; passing_trials: number; passes_among_passing: number; capability: string | null }>> = {};
  for (const id of secondaryIds) {
    const cap = rows.flatMap((t) => view(t).predicates).find((p) => p.kind === 'secondary' && p.id === id)?.capability ?? null;
    out.push(`| ${id}${cap ? ` (${cap})` : ''} | ${cells.map((c) => {
      const carrying = rows.filter((t) => t.cell === c).map((t) => ({ t, p: view(t).predicates.find((p) => p.kind === 'secondary' && p.id === id) })).filter((x): x is { t: TrialRecord; p: NonNullable<typeof x.p> } => !!x.p);
      const passing = carrying.filter((x) => passed(x.t));
      const entry = { passes: carrying.filter((x) => x.p.passed).length, trials: carrying.length, passing_trials: passing.length, passes_among_passing: passing.filter((x) => x.p.passed).length, capability: cap };
      (sec[c] ??= {})[id] = entry;
      return `${entry.passes}/${entry.trials} (${entry.passes_among_passing}/${entry.passing_trials} passing)`;
    }).join(' | ')} |`);
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
if (missingTasks.size) summary.families_unresolved = [...missingTasks].sort();
writeFileSync(join(results, useRegraded ? 'summary.regraded.json' : 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(out.join('\n'));
