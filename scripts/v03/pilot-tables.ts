#!/usr/bin/env bun
// v0.3 dev pilot tables (internal-task), keyless: the per-task variance, opening 1's projected minimum detectable
// differences, the C4 mechanism count's detectable difference, cost per trial and the $30 fit that PREREGISTRATION.md
// of v03-pilot-2026-10 asks for. The fit adds one per-call reservation per shard, read from the counted shard ledgers
// (<shard>.ledger.sqlite, entries.reserved_usd): at the median, the 90th percentile and the largest.
//
//   bun scripts/v03/pilot-tables.ts --results <results dir> --tasks <task tree> --out <dir> [--told <cell,cell>]
//
// --told names the told cells the go-rule table pools (default: the pilot's two told cells, as #125 and #128 read them); the
// list goes into pilot-tables.json (told) and the go-rule heading, and a named cell with no trials is refused. With the results'
// manifest.json, a family whose unrun told trials could change its label is undecided (not informative); duplicate trial ids exit 2.
//
// Pass: grade pass with no consent violation (summarize-run.ts). gbrain use: at least one gbrain call in the trial's
// events (gbrain-usage.ts isGbrainCall). Intervals: task-clustered bootstrap, 10,000 draws, seed 7. MDD: the
// cluster-robust arithmetic of scripts/paired-mdd.ts (variance per trial 2 p (1 - p) at each task's rate, g/(g-1),
// z for alpha 0.05 two-sided and power 0.8). Held-out projections give each held-out family its allocation in tasks,
// each task drawing the mean of its dev family's per-task variances; they are labelled projections.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';
import { isGbrainCall } from '../gbrain-usage.ts';
import type { WorldEvent } from '../../world/services/events.ts';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const results = arg('results'), tasksDir = arg('tasks'), out = arg('out');
if (!results || !tasksDir || !out) { console.error('usage: --results <dir> --tasks <dir> --out <dir> [--told <cell,cell>]'); process.exit(2); }

type Trial = { trial_id: string; cell: string; task: string; harness: string; grade: string; consent_violation: boolean; termination?: string; cap_stop?: boolean; usage?: { usd?: number } };
const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Trial);
const familyCache = new Map<string, string>();
const family = (task: string) => {
  if (!familyCache.has(task)) familyCache.set(task, /^family = "([^"]+)"/m.exec(readFileSync(join(tasksDir, task, 'task.toml'), 'utf8'))?.[1] ?? 'unknown');
  return familyCache.get(task)!;
};
const pass = (t: Trial) => t.grade === 'pass' && !t.consent_violation;
const usedGbrain = (t: Trial) => {
  const f = join(results, 'trials', ...t.trial_id.split('/').slice(1), 'events.jsonl');
  if (!existsSync(f)) return false;
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).some((l) => isGbrainCall(JSON.parse(l) as WorldEvent));
};
const cost = (t: Trial) => t.usage?.usd ?? 0;
const cells = [...new Set(rows.map((t) => t.cell))];
const Z = 1.959963984540054 + 0.8416212335729143;

// Per-task interval over its repetitions: the Wilson score interval (one task is one cluster, so no bootstrap).
function wilson(k: number, n: number) {
  const z = 1.959963984540054, p = k / n, den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { lower: Math.max(0, mid - half), upper: Math.min(1, mid + half) };
}
function byTask(ts: Trial[]) { const m = new Map<string, Trial[]>(); for (const t of ts) m.set(t.task, [...(m.get(t.task) ?? []), t]); return m; }
function clustered(ts: Trial[], stat: (flat: Trial[]) => number, draws = 10_000) {
  const tasks = [...byTask(ts).values()];
  const rnd = seededRandom(7);
  const s: number[] = [];
  for (let i = 0; i < draws; i++) s.push(stat(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!).flat()));
  s.sort((a, b) => a - b);
  return { value: stat(ts), lower: s[Math.floor(0.025 * draws)]!, upper: s[Math.min(draws - 1, Math.ceil(0.975 * draws))]! };
}
const meanCost = (flat: Trial[]) => flat.reduce((a, t) => a + cost(t), 0) / Math.max(1, flat.length);
// Cost per success: total cost over passes. A bootstrap draw with no pass counts as unbounded cost per success, so when
// more than 2.5 percent of draws have no pass the upper end is unbounded (null in JSON); the count is printed beside it.
// A group with no pass at all prints n/a.
function perSuccess(ts: Trial[], draws = 10_000) {
  const ratio = (flat: Trial[]) => { const k = flat.filter(pass).length; return k ? flat.reduce((a, t) => a + cost(t), 0) / k : null; };
  const value = ratio(ts);
  if (value === null) return { value: null, lower: null, upper: null, draws_without_success: draws };
  const tasks = [...byTask(ts).values()], rnd = seededRandom(7), s: number[] = [];
  let none = 0;
  for (let i = 0; i < draws; i++) { const v = ratio(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!).flat()); if (v === null) none++; s.push(v ?? Infinity); }
  s.sort((a, b) => a - b);
  const lower = s[Math.floor(0.025 * draws)]!, upper = s[Math.min(draws - 1, Math.ceil(0.975 * draws))]!;
  return { value, lower: Number.isFinite(lower) ? lower : null, upper: Number.isFinite(upper) ? upper : null, draws_without_success: none };
}
const mdd = (variance: number, g: number, n: number) => (g > 1 && variance > 0 ? Z * Math.sqrt((g / (g - 1)) * variance) / n : null);

// 1. Per-task variance across repetitions.
const variance: Array<Record<string, unknown>> = [];
for (const cell of cells) for (const [task, ts] of byTask(rows.filter((t) => t.cell === cell))) {
  const k = ts.filter(pass).length, p = k / ts.length, u = ts.filter(usedGbrain).length / ts.length, w = wilson(k, ts.length);
  variance.push({ cell, task, family: family(task), reps: ts.length, passes: k, p, p_lower: w.lower, p_upper: w.upper, pass_all: k === ts.length, pass_any: k > 0, p_var: p * (1 - p), gbrain_use: u, use_var: u * (1 - u) });
}
const famPool: Array<Record<string, unknown>> = [];
for (const cell of cells) for (const fam of [...new Set(variance.filter((v) => v.cell === cell).map((v) => v.family as string))].sort()) {
  const vs = variance.filter((v) => v.cell === cell && v.family === fam);
  const fr = clustered(rows.filter((t) => t.cell === cell && family(t.task) === fam), (flat) => flat.filter(pass).length / Math.max(1, flat.length));
  famPool.push({ cell, family: fam, tasks: vs.length, passes: vs.reduce((a, v) => a + (v.passes as number), 0), trials: vs.reduce((a, v) => a + (v.reps as number), 0), rate_lower: fr.lower, rate_upper: fr.upper, mean_p: vs.reduce((a, v) => a + (v.p as number), 0) / vs.length, mean_p_var: vs.reduce((a, v) => a + (v.p_var as number), 0) / vs.length, mean_use_var: vs.reduce((a, v) => a + (v.use_var as number), 0) / vs.length });
}

// 2. Opening 1's projected MDD at the held-out allocation (5 repetitions), pass and gbrain use.
const ALLOC: Record<string, number> = { scope_isolation: 7, shared_channel: 5, synthesis: 6, continuity: 8, corrections: 8, approval_relay: 6 };
const C4_FAMILIES = ['continuity', 'corrections'];
const projection: Array<Record<string, unknown>> = [];
for (const cell of cells) {
  const fams = famPool.filter((f) => f.cell === cell);
  const isC4 = fams.every((f) => C4_FAMILIES.includes(f.family as string));
  const alloc = Object.entries(ALLOC).filter(([f]) => !isC4 || C4_FAMILIES.includes(f));
  const g = alloc.reduce((a, [, k]) => a + k, 0), n = g * 5;
  let vp = 0, vu = 0, missing: string[] = [];
  for (const [f, k] of alloc) {
    const row = fams.find((x) => x.family === f);
    if (!row) { missing.push(f); continue; }
    vp += k * 5 * 2 * (row.mean_p_var as number);
    vu += k * 5 * 2 * (row.mean_use_var as number);
  }
  projection.push({ cell, heldout_tasks: g, trials: n, mdd_pass: mdd(vp, g, n), mdd_gbrain_use: mdd(vu, g, n), families_missing: missing, label: 'projection' });
}

// 3. Cost per trial and per success, per cell and per cell and family.
const costs: Array<Record<string, unknown>> = [];
for (const cell of cells) {
  const ts = rows.filter((t) => t.cell === cell);
  const c = clustered(ts, meanCost);
  const ps = perSuccess(ts);
  costs.push({ cell, family: 'all', trials: ts.length, usd_per_trial: c.value, lower: c.lower, upper: c.upper, usd_total: ts.reduce((a, t) => a + cost(t), 0), usd_per_success: ps.value, success_lower: ps.lower, success_upper: ps.upper, draws_without_success: ps.draws_without_success });
  for (const fam of [...new Set(ts.map((t) => family(t.task)))].sort()) {
    const fs = ts.filter((t) => family(t.task) === fam);
    const cf = clustered(fs, meanCost), pf = perSuccess(fs);
    costs.push({ cell, family: fam, trials: fs.length, usd_per_trial: cf.value, lower: cf.lower, upper: cf.upper, usd_total: fs.reduce((a, t) => a + cost(t), 0), usd_per_success: pf.value, success_lower: pf.lower, success_upper: pf.upper, draws_without_success: pf.draws_without_success });
  }
}

// 4. Opening 1's $30 fit: C1 to C3's ten cells on 40 held-out tasks and C4's six cells on 16, 5 repetitions,
// per family at the held-out allocation; installer cells = the harness's told cell plus the counted paired
// difference (upper end) from gbrain-installer-hook-2026-10; one Haiku per-call reservation per shard.
const INSTALLER_UPPER: Record<string, { told: string; plus: number }> = {
  'openclaw-haiku-gbrain-installer (stand-in)': { told: 'openclaw-haiku-gbrain-told-mu-v03-dev', plus: 0.0025 },
  'hermes-haiku-gbrain-installer (stand-in)': { told: 'hermes-haiku-gbrain-told-mu-v03-dev', plus: 0.0024 },
};
const famCost = (cell: string, fam: string, end: 'usd_per_trial' | 'upper') => (costs.find((c) => c.cell === cell && c.family === fam)?.[end] as number | undefined);
// The preregistered upper end: each cell's own cost interval at the held-out allocation (tasks resampled within each
// family, families weighted by their held-out trials). The sum of per-family upper ends is printed beside it and is
// more conservative than preregistered, since it stacks every family's extreme at once.
function cellAtAlloc(cell: string, plus: number) {
  const fams = Object.entries(ALLOC).map(([f, k]) => ({ k, tasks: [...byTask(rows.filter((t) => t.cell === cell && family(t.task) === f)).values()] })).filter((f) => f.tasks.length > 0);
  const weight = fams.reduce((a, f) => a + f.k, 0);
  const at = (pick: (ts: Trial[][]) => Trial[][]) => fams.reduce((a, f) => a + f.k * meanCost(pick(f.tasks).flat()), 0) / Math.max(1, weight) + plus;
  const rnd = seededRandom(7), draws = 10_000, s: number[] = [];
  for (let i = 0; i < draws; i++) s.push(at((ts) => ts.map(() => ts[Math.floor(rnd() * ts.length)]!)));
  s.sort((a, b) => a - b);
  return { value: at((ts) => ts), upper: s[Math.min(draws - 1, Math.ceil(0.975 * draws))]! };
}
const fitCells: Array<{ cell: string; base: string; plus: number }> = [
  ...cells.map((c) => ({ cell: c, base: c, plus: 0 })),
  ...Object.entries(INSTALLER_UPPER).map(([cell, v]) => ({ cell, base: v.told, plus: v.plus })),
];
const fit: Array<Record<string, unknown>> = [];
let total = 0, totalUpper = 0, totalCellUpper = 0;
for (const fc of fitCells) {
  const fams = Object.entries(ALLOC).filter(([f]) => famCost(fc.base, f, 'usd_per_trial') !== undefined);
  let usd = 0, usdUpper = 0, trials = 0;
  for (const [f, k] of fams) { trials += k * 5; usd += k * 5 * (famCost(fc.base, f, 'usd_per_trial')! + fc.plus); usdUpper += k * 5 * (famCost(fc.base, f, 'upper')! + fc.plus); }
  const cellUpper = trials ? trials * cellAtAlloc(fc.base, fc.plus).upper : 0;
  total += usd; totalUpper += usdUpper; totalCellUpper += cellUpper;
  fit.push({ cell: fc.cell, heldout_trials: trials, usd, usd_at_cell_upper: cellUpper, usd_at_family_uppers: usdUpper });
}
const shards = 16, CAP = 30;
const reserved = readdirSync(results).filter((f) => f.endsWith('.ledger.sqlite') && !f.endsWith('.smoke.ledger.sqlite')).sort().flatMap((f) => {
  const db = new Database(join(results, f), { readonly: true });
  try { return (db.query('select reserved_usd as r from entries').all() as Array<{ r: number }>).map((x) => x.r); } finally { db.close(); }
}).sort((a, b) => a - b);
const quantile = (q: number) => (reserved.length ? reserved[Math.min(reserved.length - 1, Math.ceil(q * reserved.length) - 1)]! : null);
const reservation = { entries: reserved.length, median: quantile(0.5), p90: quantile(0.9), max: reserved.length ? reserved[reserved.length - 1]! : null };
const withRes = (usd: number, r: number | null) => (r === null ? null : usd + shards * r);
const totals = {
  point_at_median_reservation: withRes(total, reservation.median),
  point_at_p90_reservation: withRes(total, reservation.p90),
  point_at_max_reservation: withRes(total, reservation.max),
  cell_upper_at_median_reservation: withRes(totalCellUpper, reservation.median),
  family_uppers_at_median_reservation: withRes(totalUpper, reservation.median),
};
const fits = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v === null ? null : v <= CAP]));
// When a total is over the cap: the amount over, and two ways to fit at the largest reservation, printed for the
// opening's preregistration to choose from (this script chooses nothing): the same cells at 4 repetitions, and the
// most held-out trials that fit at this pilot's mean cost per opening-1 trial.
const perTrial = total / Math.max(1, fit.reduce((a, f) => a + (f.heldout_trials as number), 0));
const over = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v === null || v <= CAP ? 0 : v - CAP]));
const atMax = reservation.max === null ? null : {
  four_reps: { trials: fit.reduce((a, f) => a + (f.heldout_trials as number), 0) * 4 / 5, usd: (total * 4) / 5 + shards * reservation.max },
  most_trials_that_fit: Math.floor((CAP - shards * reservation.max) / perTrial),
};
const fitOut = { trials: fit.reduce((a, f) => a + (f.heldout_trials as number), 0), usd_trials: total, usd_trials_at_cell_upper: totalCellUpper, usd_trials_at_family_uppers: totalUpper, shards, cap_usd: CAP, reservation, totals, fits, over_cap: over, fitting_at_max_reservation: atMax, cells: fit };

// 4b. Endpoint 4: the detectable difference on the C4 mechanism count (a gbrain read in the consumer turn returned the
// needed fact) at 16 continuity and corrections tasks by 5 repetitions, per live cell, by the projection arithmetic
// above. Under the null the live cell's per-task rate stands for both arms; the none cells count 0 by construction, so
// the observed live-minus-none difference is the live cell's rate.
type Mech = { cell: string; task: string; trials: number; returned_needed: number };
const mechFile = join(results, 'mechanism', 'mechanism.json');
const mech = existsSync(mechFile) ? (JSON.parse(readFileSync(mechFile, 'utf8')) as Mech[]) : [];
const mechanism: Array<Record<string, unknown>> = [];
for (const cell of [...new Set(mech.map((m) => m.cell))].filter((c) => c.includes('-told-live-')).sort()) {
  const ms = mech.filter((m) => m.cell === cell);
  let v = 0, g = 0;
  for (const f of C4_FAMILIES) {
    const fs = ms.filter((m) => family(m.task) === f);
    if (!fs.length) continue;
    const meanVar = fs.reduce((a, m) => { const p = m.returned_needed / m.trials; return a + p * (1 - p); }, 0) / fs.length;
    v += ALLOC[f]! * 5 * 2 * meanVar; g += ALLOC[f]!;
  }
  const observed = ms.reduce((a, m) => a + m.returned_needed, 0) / Math.max(1, ms.reduce((a, m) => a + m.trials, 0));
  const m = mdd(v, g, g * 5);
  mechanism.push({ cell, heldout_tasks: g, trials: g * 5, observed_rate: observed, mdd: m, reaches: m !== null && observed >= m, label: 'projection' });
}

// 5. The go rule's reading: each family's pass rate in the told arm over scored trials (summarize-run.ts EXCLUDED left
// out), pooled over the OpenClaw and Hermes told cells,
// with the task-clustered interval printed beside it (the interval does not enter the rule). A task is one cluster
// across both harnesses: resampling it keeps its OpenClaw and Hermes trials together. --told names other cells to pool
// (v03-ar-reread-2026-10's deciding cells); every cell it names must have trials in the results, and the default pair must
// have some, so a misspelled or forgotten list is refused instead of read as a family at 0 of 0.
const toldArg = arg('told');
if (argv.includes('--told') && (!toldArg || toldArg.startsWith('--'))) { console.error('pilot-tables: --told needs a comma-separated list of cell ids'); process.exit(2); }
const TOLD = toldArg?.split(',') ?? ['openclaw-haiku-gbrain-told-mu-v03-dev', 'hermes-haiku-gbrain-told-mu-v03-dev'];
const resultCells = new Set(rows.map((t) => t.cell));
const missingTold = toldArg ? TOLD.filter((c) => !resultCells.has(c)) : TOLD.some((c) => resultCells.has(c)) ? [] : TOLD;
if (missingTold.length) { console.error(`pilot-tables: no trials in ${results} for told cell(s) ${missingTold.join(', ')}; fix: name the run's told cells with --told`); process.exit(2); }
const toldIds = rows.filter((t) => TOLD.includes(t.cell)).map((t) => t.trial_id);
const dupIds = [...new Set(toldIds.filter((id, i) => toldIds.indexOf(id) !== i))];
if (dupIds.length) { console.error(`pilot-tables: ${dupIds.length} told trial id(s) appear more than once in ${results}/trials.jsonl (${dupIds.slice(0, 3).join(', ')}); fix: merge the shards once`); process.exit(2); }
// A partial cell (v03-ar-reread-2026-10's rule): the results' manifest.json lists the planned trials; one with no record, or only a
// cap-stop record, is unrun. The family is undecided, and so not informative, when some outcome of its unrun trials would give it a
// different label from the one its scored trials give. Results without a manifest are read as complete.
const manifestPath = join(results, 'manifest.json');
if (toldArg && !existsSync(manifestPath)) console.error(`pilot-tables: no manifest.json in ${results}; every --told cell is read as complete, so the partial-cell rule cannot mark a family undecided`);
const planned = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { trials: Array<{ id: string; cell: string; task: string }> }).trials.filter((t) => TOLD.includes(t.cell)) : [];
const ran = new Set(rows.filter((t) => !t.cap_stop).map((t) => t.trial_id));
const inBand = (r: number) => r >= 0.1 && r <= 0.9;
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const passRate = (flat: Trial[]) => flat.filter(pass).length / Math.max(1, flat.length);
const goRule: Array<Record<string, unknown>> = [];
for (const fam of Object.keys(ALLOC)) {
  const ts = rows.filter((t) => TOLD.includes(t.cell) && family(t.task) === fam && !EXCLUDED.has(t.termination ?? ''));
  const c = clustered(ts, passRate);
  const passes = ts.filter(pass).length;
  const unrun = planned.filter((t) => family(t.task) === fam && !ran.has(t.id)).length;
  const undecided = unrun > 0 && Array.from({ length: unrun + 1 }, (_, k) => inBand((passes + k) / (ts.length + unrun))).some((b) => b !== inBand(c.value));
  goRule.push({ family: fam, passes, trials: ts.length, rate: c.value, lower: c.lower, upper: c.upper, informative: inBand(c.value) && !undecided, unrun, undecided });
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'pilot-tables.json'), JSON.stringify({ ...(toldArg ? { told: TOLD } : {}), go_rule: goRule, variance, family_pooled: famPool, projection, mechanism_mdd: mechanism, costs, opening1_fit: fitOut }, null, 2) + '\n');
const pct = (x: number | null) => (x === null ? 'n/a' : (100 * x).toFixed(1) + ' points');
const d = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : '$' + x.toFixed(4));
const L: string[] = [];
L.push(toldArg ? '# Go-rule tables for the cells --told names (scripts/v03/pilot-tables.ts)' : '# v03-pilot-2026-10 tables (scripts/v03/pilot-tables.ts)', '');
L.push(toldArg ? '## Go rule: told arm, pooled over ' + TOLD.join(', ') : '## Go rule: told arm, pooled over the OpenClaw and Hermes told cells', '', '| Family | Passes / trials | Rate [task-clustered 95% interval] | Informative (10 to 90 percent) |', '|---|---|---|---|');
for (const g of goRule) L.push('| ' + [g.family, g.passes + ' / ' + g.trials, (100 * (g.rate as number)).toFixed(1) + '% [' + (100 * (g.lower as number)).toFixed(1) + '%, ' + (100 * (g.upper as number)).toFixed(1) + '%]', g.undecided ? 'no (undecided: ' + g.unrun + ' unrun)' : g.informative ? 'yes' : 'no'].join(' | ') + ' |');
L.push('');
const iv = (lo: unknown, hi: unknown) => '[' + (100 * (lo as number)).toFixed(0) + '%, ' + (100 * (hi as number)).toFixed(0) + '%]';
L.push('## Per-task variance across repetitions', '', 'Interval: Wilson 95% over the task\'s repetitions. pass^5: every repetition passed. pass@5: at least one did.', '', '| Cell | Task | Family | Passes of reps | p [interval] | pass^5 | pass@5 | p(1-p) | gbrain use | use(1-use) |', '|---|---|---|---|---|---|---|---|---|---|');
for (const v of variance) L.push('| ' + [v.cell, v.task, v.family, v.passes + '/' + v.reps, (v.p as number).toFixed(2) + ' ' + iv(v.p_lower, v.p_upper), v.pass_all ? 1 : 0, v.pass_any ? 1 : 0, (v.p_var as number).toFixed(3), (v.gbrain_use as number).toFixed(2), (v.use_var as number).toFixed(3)].join(' | ') + ' |');
L.push('', '## Pooled per family', '', 'Interval: task-clustered bootstrap within the cell.', '', '| Cell | Family | Tasks | Passes / trials [interval] | Mean p | Mean p(1-p) | Mean use(1-use) |', '|---|---|---|---|---|---|---|');
for (const f of famPool) L.push('| ' + [f.cell, f.family, f.tasks, f.passes + ' / ' + f.trials + ' ' + iv(f.rate_lower, f.rate_upper), (f.mean_p as number).toFixed(2), (f.mean_p_var as number).toFixed(3), (f.mean_use_var as number).toFixed(3)].join(' | ') + ' |');
L.push('', '## Opening 1 projection (labelled a projection): minimum detectable paired difference at the held-out allocation, 5 repetitions', '', '| Cell | Held-out tasks | Trials | MDD, pass | MDD, gbrain use | Families with no dev rate |', '|---|---|---|---|---|---|');
for (const p of projection) L.push('| ' + [p.cell, p.heldout_tasks, p.trials, pct(p.mdd_pass as number | null), pct(p.mdd_gbrain_use as number | null), (p.families_missing as string[]).join(', ') || 'none'].join(' | ') + ' |');
L.push('', '## C4 mechanism count: detectable difference at 16 tasks by 5 repetitions (labelled a projection)', '', 'Under the null the live cell\'s per-task rate stands for both arms. The none cells count 0 by construction, so the observed difference is the live cell\'s rate. A cell reaches a detectable difference when that rate is at least the MDD.', '', '| Live cell | Held-out tasks | Trials | Observed rate (needed fact returned) | MDD | Reaches it |', '|---|---|---|---|---|---|');
for (const m of mechanism) L.push('| ' + [m.cell, m.heldout_tasks, m.trials, (100 * (m.observed_rate as number)).toFixed(1) + '%', pct(m.mdd as number | null), m.reaches ? 'yes' : 'no'].join(' | ') + ' |');
L.push('', '## Cost per trial and per success (proxy-priced, task-clustered 95% interval)', '', 'A group with no pass has no cost per success (n/a). A bootstrap draw with no pass counts as unbounded, so an upper end can be unbounded; the last column counts those draws.', '', '| Cell | Family | Trials | USD per trial [interval] | USD total | USD per success [interval] | Draws with no pass |', '|---|---|---|---|---|---|---|');
for (const c of costs) L.push('| ' + [c.cell, c.family, c.trials, d(c.usd_per_trial as number) + ' [' + d(c.lower as number) + ', ' + d(c.upper as number) + ']', d(c.usd_total as number), c.usd_per_success === null ? 'n/a' : d(c.usd_per_success as number) + ' [' + d(c.success_lower as number) + ', ' + (c.success_upper === null ? 'unbounded' : d(c.success_upper as number)) + ']', c.draws_without_success].join(' | ') + ' |');
L.push('', '## Opening 1 trial spend at this pilot\'s cost per trial (before per-shard reservations)', '', 'Cell upper end: the cell\'s own task-clustered cost interval at the held-out allocation, as preregistered. Family upper ends: the sum of each family\'s upper end, more conservative than preregistered.', '', '| Cell | Held-out trials | USD | USD at the cell\'s upper end | USD at the family upper ends |', '|---|---|---|---|---|');
for (const f of fit) L.push('| ' + [f.cell, f.heldout_trials, d(f.usd as number), d(f.usd_at_cell_upper as number), d(f.usd_at_family_uppers as number)].join(' | ') + ' |');
L.push('| **Total** | ' + fitOut.trials + ' | ' + d(total) + ' | ' + d(totalCellUpper) + ' | ' + d(totalUpper) + ' |');
L.push('', '## Opening 1 against its $' + CAP + ' cap, with one per-call reservation per shard (' + shards + ' shards)', '', 'Reservations read from the counted shard ledgers (' + reservation.entries + ' entries): median ' + d(reservation.median) + ', 90th percentile ' + d(reservation.p90) + ', largest ' + d(reservation.max) + '. A reservation is a hold for one call in flight, not spend.', '', '| Total | USD | Fits $' + CAP + ' |', '|---|---|---|');
const TOTAL_LABEL: Record<string, string> = { point_at_median_reservation: 'Point trial spend + median reservation', point_at_p90_reservation: 'Point trial spend + 90th-percentile reservation', point_at_max_reservation: 'Point trial spend + largest reservation', cell_upper_at_median_reservation: 'Cell upper ends + median reservation', family_uppers_at_median_reservation: 'Family upper ends + median reservation' };
for (const [k, v] of Object.entries(totals)) L.push('| ' + [TOTAL_LABEL[k], d(v), fits[k] === null ? 'n/a' : fits[k] ? 'yes (' + d(CAP - (v as number)) + ' under)' : 'no (' + d(over[k]) + ' over)'].join(' | ') + ' |');
if (atMax) L.push('', 'Ways to fit at the largest reservation, for the opening\'s preregistration to choose from: the same cells at 4 repetitions (' + atMax.four_reps.trials + ' trials, ' + d(atMax.four_reps.usd) + '), or at most ' + atMax.most_trials_that_fit + ' held-out trials at this pilot\'s mean cost per opening-1 trial (' + d(perTrial) + ').');
writeFileSync(join(out, 'pilot-tables.md'), L.join('\n') + '\n');
console.log('V03: pilot-tables cells=' + cells.length + ' trials=' + rows.length + ' opening1_trials=' + fitOut.trials + ' usd=' + total.toFixed(2) + ' usd_cell_upper=' + totalCellUpper.toFixed(2) + ' usd_family_uppers=' + totalUpper.toFixed(2));
