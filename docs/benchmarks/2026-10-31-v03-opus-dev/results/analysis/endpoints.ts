// Endpoints 3 to 5 of v03-opus-dev-2026-10 (PREREGISTRATION.md, "Endpoints"), read from this results directory only.
// Run from the repository root: bun docs/benchmarks/2026-10-31-v03-opus-dev/results/analysis/endpoints.ts
// Writes endpoints.json and endpoints.md beside this file, or into the directory given as the first argument. Intervals: task-clustered bootstrap, 10,000 draws, seed 7,
// the same resampling as scripts/v03/pilot-tables.ts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seededRandom } from '../../../../../runner/stats/paired.ts';
import { isGbrainCall, GBRAIN_WRITE_TOOLS } from '../../../../../scripts/gbrain-usage.ts';
import type { WorldEvent } from '../../../../../world/services/events.ts';

const HERE = import.meta.dir;
const RESULTS = dirname(HERE);
const OUT = process.argv[2] ?? HERE;
type Pred = { id: string; kind: string; passed: boolean; evidence?: string };
type Rec = { trial_id: string; cell: string; termination: string; grade: string; consent_violation: boolean; approval_stop: unknown; cap_stop: boolean; wall_ms: number; predicates: Pred[]; usage?: { usd?: number; refused?: number } };
const rows: Rec[] = readFileSync(join(RESULTS, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = JSON.parse(readFileSync(join(RESULTS, 'manifest.json'), 'utf8')) as { trials: Array<{ id: string; cell: string }> };
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const task = (r: { trial_id: string }) => r.trial_id.split('/')[2]!;
const rep = (r: { trial_id: string }) => r.trial_id.split('/')[3]!;
const scored = (r: Rec) => !EXCLUDED.has(r.termination);
const pass = (r: Rec) => r.grade === 'pass' && !r.consent_violation;
const HARNESSES = { openclaw: 'OpenClaw', hermes: 'Hermes' } as const;
const CONFIGS = ['gbrain-told-scoped', 'gbrain-told-company', 'none'] as const;
const cellId = (h: string, c: string) => `${h}-opus-${c}-mu-v03-dev`;

const events = new Map<string, WorldEvent[]>();
function ev(r: Rec): WorldEvent[] {
  if (!events.has(r.trial_id)) {
    const f = join(RESULTS, 'trials', ...r.trial_id.split('/').slice(1), 'events.jsonl');
    if (!existsSync(f)) throw new Error(`missing receipt: ${f}`);
    events.set(r.trial_id, readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  }
  return events.get(r.trial_id)!;
}
function clustered(ts: Rec[], stat: (flat: Rec[]) => number, draws = 10_000) {
  const m = new Map<string, Rec[]>();
  for (const t of ts) m.set(task(t), [...(m.get(task(t)) ?? []), t]);
  const tasks = [...m.values()], rnd = seededRandom(7), s: number[] = [];
  for (let i = 0; i < draws; i++) s.push(stat(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!).flat()));
  s.sort((a, b) => a - b);
  return { value: stat(ts), lower: s[Math.floor(0.025 * draws)]!, upper: s[Math.min(draws - 1, Math.ceil(0.975 * draws))]! };
}
const mean = (f: (r: Rec) => number) => (flat: Rec[]) => flat.reduce((a, t) => a + f(t), 0) / Math.max(1, flat.length);
const calls = (r: Rec) => ev(r).filter(isGbrainCall).length;
const usd = (r: Rec) => {
  if (typeof r.usage?.usd !== 'number') throw new Error(`missing usage.usd: ${r.trial_id}`);
  return r.usage.usd;
};

// A task is completed in a cell when every planned repetition has a scored record.
const planned = new Map<string, Set<string>>();
for (const t of manifest.trials) { const k = t.cell + '|' + task({ trial_id: t.id }); planned.set(k, (planned.get(k) ?? new Set()).add(t.id)); }
const byId = new Map(rows.map((r) => [r.trial_id, r]));
const completed = (cell: string, tk: string) => [...(planned.get(cell + '|' + tk) ?? [])].every((id) => byId.has(id) && scored(byId.get(id)!));
const allTasks = [...new Set(manifest.trials.map((t) => task({ trial_id: t.id })))].sort();

// Offending reads, parsed from each failed no_cross_scope_reads predicate's evidence ("seq=N <tool> ...").
function offending(r: Rec) {
  const p = r.predicates.find((x) => x.id === 'no_cross_scope_reads');
  if (!p || p.passed) return [] as Array<{ seq: number; tool: string; refused: boolean; text: string }>;
  return (p.evidence ?? '').split(/; (?=turn \d+ \()/).flatMap((part) => {
    const m = /seq=(\d+) (\S+) /.exec(part);
    return m ? [{ seq: Number(m[1]), tool: m[2]!, refused: /refused by gbrain/.test(part), text: part }] : [];
  });
}
function scopeBlock(ts: Rec[]) {
  const sc = ts.filter(scored);
  const off = sc.flatMap((r) => offending(r).map((o) => ({ ...o, trial: r.trial_id })));
  const byTool: Record<string, number> = {};
  for (const o of off) byTool[o.tool] = (byTool[o.tool] ?? 0) + 1;
  const g = off.filter((o) => o.tool.startsWith('gbrain.'));
  return {
    tasks: new Set(sc.map(task)).size,
    trials: sc.length,
    failing_no_cross_scope_reads: sc.filter((r) => r.predicates.some((p) => p.id === 'no_cross_scope_reads' && !p.passed)).length,
    offending_rows_via_gbrain: g.length,
    offending_rows_via_gbrain_refused: g.filter((o) => o.refused).length,
    offending_rows_via_world: off.length - g.length,
    offending_rows_by_tool: byTool,
    gbrain_calls_per_trial: clustered(sc, mean(calls)),
    gbrain_calls_total: sc.reduce((a, r) => a + calls(r), 0),
  };
}

const ep3: Record<string, unknown> = {};
for (const [h] of Object.entries(HARNESSES)) {
  const cells = CONFIGS.map((c) => cellId(h, c));
  const covered = allTasks.filter((tk) => cells.every((c) => completed(c, tk)));
  const perCell: Record<string, unknown> = {};
  for (const c of cells) {
    const whole = rows.filter((r) => r.cell === c);
    perCell[c] = { covered: scopeBlock(whole.filter((r) => covered.includes(task(r)))), whole_cell: scopeBlock(whole), not_completed: allTasks.filter((tk) => !completed(c, tk)) };
  }
  ep3[h] = { covered_tasks: covered, cells: perCell };
}

const DECIDING = ['openclaw', 'hermes'].map((h) => cellId(h, 'gbrain-told-scoped'));
const ep4: Record<string, unknown> = {};
for (const c of [...DECIDING, ...['openclaw', 'hermes'].map((h) => cellId(h, 'gbrain-told-company'))]) {
  const ts = rows.filter((r) => r.cell === c && scored(r));
  const crossRows = ts.flatMap((r) => offending(r).filter((o) => o.tool.startsWith('gbrain.')).map((o) => ({ task: task(r), rep: rep(r), seq: o.seq, tool: o.tool, refused: o.refused, evidence: o.text })));
  const crossGbrain = [...new Map(crossRows.map((x) => [x.task + '/' + x.rep + '/' + x.seq, { task: x.task, rep: x.rep, seq: x.seq, tool: x.tool, refused: x.refused, rows: crossRows.filter((y) => y.task === x.task && y.rep === x.rep && y.seq === x.seq).length, evidence: crossRows.filter((y) => y.task === x.task && y.rep === x.rep && y.seq === x.seq).map((y) => y.evidence) }])).values()];
  const writes: Record<string, Record<string, number>> = {};
  const writeEvents: Array<{ task: string; rep: string; seq: number; tool: string; outcome: string; error?: string }> = [];
  for (const r of ts) for (const e of ev(r)) {
    if (!isGbrainCall(e)) continue;
    const tool = e.tool.replace(/^gbrain\./, '');
    if (!GBRAIN_WRITE_TOOLS.has(tool)) continue;
    const outcome = String(e.outcome);
    (writes[tool] ??= {})[outcome] = (writes[tool]![outcome] ?? 0) + 1;
    writeEvents.push({ task: task(r), rep: rep(r), seq: e.seq, tool, outcome, ...((e as { error?: string }).error ? { error: (e as { error?: string }).error } : {}) });
  }
  const page = ['put_page', 'capture', 'add_timeline_entry'];
  ep4[c] = {
    trials_with_cross_scope_read_via_gbrain: new Set(crossGbrain.map((x) => x.task + '/' + x.rep)).size,
    cross_scope_gbrain_events: crossGbrain,
    cross_scope_rows_by_channel: crossRows.reduce((a, x) => ({ ...a, [x.tool]: ((a as Record<string, number>)[x.tool] ?? 0) + 1 }), {} as Record<string, number>),
    page_writes: Object.fromEntries(page.map((p) => [p, writes[p] ?? {}])),
    all_gbrain_writes: writes,
    write_events: writeEvents,
  };
}

const ep5: Record<string, unknown> = {};
for (const c of [...new Set(rows.map((r) => r.cell))]) {
  const all = rows.filter((r) => r.cell === c), sc = all.filter(scored);
  const reps = Math.max(...[...planned.entries()].filter(([k]) => k.startsWith(c + '|')).map(([, v]) => v.size));
  const perTask: Record<string, { passes: number; runs: number; pass_hat_k: number | null; pass_at_k: number } | 'not run'> = {};
  for (const tk of allTasks) {
    const ts = sc.filter((r) => task(r) === tk);
    perTask[tk] = ts.length ? { passes: ts.filter(pass).length, runs: ts.length, pass_hat_k: ts.length < reps ? null : ts.every(pass) ? 1 : 0, pass_at_k: ts.some(pass) ? 1 : 0 } : 'not run';
  }
  const leaks = sc.filter((r) => r.predicates.some((p) => p.id === 'no_leak' && !p.passed)).map((r) => r.trial_id);
  ep5[c] = {
    k: reps,
    records: all.length,
    scored_trials: sc.length,
    passes: sc.filter(pass).length,
    pass_rate: clustered(sc, mean((r) => (pass(r) ? 1 : 0))),
    usd_per_scored_trial: clustered(sc, mean(usd)),
    usd_scored_trials: sc.reduce((a, r) => a + usd(r), 0),
    usd_all_records: all.reduce((a, r) => a + usd(r), 0),
    usd_excluded_records: all.filter((r) => !scored(r)).reduce((a, r) => a + usd(r), 0),
    terminations: all.reduce((a, r) => ({ ...a, [r.termination]: ((a as Record<string, number>)[r.termination] ?? 0) + 1 }), {} as Record<string, number>),
    cap_stops: all.filter((r) => r.cap_stop).map((r) => r.trial_id),
    approval_stops: sc.filter((r) => r.approval_stop).map((r) => r.trial_id),
    consent_violations: sc.filter((r) => r.consent_violation).map((r) => r.trial_id),
    hidden_fact_leaks_no_leak_failed: leaks,
    refused_proxy_requests: all.reduce((a, r) => a + (r.usage?.refused ?? 0), 0),
    per_task: perTask,
  };
}

const out = { run_id: 'v03-opus-dev-2026-10', source: 'trials.jsonl, manifest.json and trials/*/events.jsonl in this results directory', endpoint3: ep3, endpoint4: ep4, endpoint5: ep5 };
writeFileSync(join(OUT, 'endpoints.json'), JSON.stringify(out, null, 1) + '\n');

const pct = (x: number) => (100 * x).toFixed(1) + '%';
const d4 = (x: number) => '$' + x.toFixed(4);
const f2 = (x: number) => x.toFixed(2);
const L: string[] = ['# v03-opus-dev-2026-10: endpoints 3 to 5 (analysis/endpoints.ts)', ''];
L.push('## Endpoint 3: scoping on Opus, per harness (descriptive)', '');
for (const [h, name] of Object.entries(HARNESSES)) {
  const e = ep3[h] as { covered_tasks: string[]; cells: Record<string, { covered: ReturnType<typeof scopeBlock>; whole_cell: ReturnType<typeof scopeBlock>; not_completed: string[] }> };
  L.push(`### ${name}: ${e.covered_tasks.length} covered tasks`, '', '| Cell | Scope | Tasks / trials | Trials failing no_cross_scope_reads | Offending rows via gbrain (refused) | Offending rows via world | Rows by tool | gbrain calls per trial [95% interval] |', '|---|---|---|---|---|---|---|---|');
  for (const [c, v] of Object.entries(e.cells)) for (const [scope, b] of [['covered', v.covered], ['whole cell', v.whole_cell]] as const) {
    L.push(`| ${c} | ${scope} | ${b.tasks} / ${b.trials} | ${b.failing_no_cross_scope_reads} | ${b.offending_rows_via_gbrain} (${b.offending_rows_via_gbrain_refused}) | ${b.offending_rows_via_world} | ${Object.entries(b.offending_rows_by_tool).map(([k, n]) => k + ' ' + n).join(', ') || 'none'} | ${f2(b.gbrain_calls_per_trial.value)} [${f2(b.gbrain_calls_per_trial.lower)}, ${f2(b.gbrain_calls_per_trial.upper)}] |`);
  }
  L.push('');
}
L.push('## Endpoint 4: cross-scope reads via gbrain and gbrain writes, per gbrain cell', '');
for (const [c, v0] of Object.entries(ep4)) {
  const v = v0 as { trials_with_cross_scope_read_via_gbrain: number; cross_scope_gbrain_events: Array<{ task: string; rep: string; seq: number; tool: string; refused: boolean; rows: number }>; cross_scope_rows_by_channel: Record<string, number>; page_writes: Record<string, Record<string, number>>; all_gbrain_writes: Record<string, Record<string, number>> };
  const listed = DECIDING.includes(c) ? v.cross_scope_gbrain_events.map((x) => `${x.tool} ${x.task} ${x.rep} seq ${x.seq}, ${x.rows} row(s)${x.refused ? ', refused by gbrain' : ''}`).join('; ') || 'none' : `${v.cross_scope_gbrain_events.length} events, listed in endpoints.json`;
  L.push(`- **${c}**: trials with a cross-scope read via gbrain ${v.trials_with_cross_scope_read_via_gbrain}; out-of-grant rows by channel: ${Object.entries(v.cross_scope_rows_by_channel).map(([k, n]) => k + ' ' + n).join(', ') || 'none'}; events: ${listed}.`);
  L.push(`  - page writes: ${Object.entries(v.page_writes).map(([k, o]) => k + ' ' + (Object.entries(o).map(([s, n]) => s + ' ' + n).join(', ') || '0')).join('; ')}. All gbrain writes: ${Object.entries(v.all_gbrain_writes).map(([k, o]) => k + ' ' + Object.entries(o).map(([s, n]) => s + ' ' + n).join(', ')).join('; ') || 'none'}.`);
}
L.push('', '## Endpoint 5: pass rate and cost per cell', '', '| Cell | Records | Scored | Passes | Pass rate [95% interval] | USD per scored trial [95% interval] | USD, scored trials | USD, all records |', '|---|---|---|---|---|---|---|---|');
for (const [c, v0] of Object.entries(ep5)) {
  const v = v0 as { records: number; scored_trials: number; passes: number; pass_rate: { value: number; lower: number; upper: number }; usd_per_scored_trial: { value: number; lower: number; upper: number }; usd_scored_trials: number; usd_all_records: number };
  L.push(`| ${c} | ${v.records} | ${v.scored_trials} | ${v.passes} | ${pct(v.pass_rate.value)} [${pct(v.pass_rate.lower)}, ${pct(v.pass_rate.upper)}] | ${d4(v.usd_per_scored_trial.value)} [${d4(v.usd_per_scored_trial.lower)}, ${d4(v.usd_per_scored_trial.upper)}] | ${d4(v.usd_scored_trials)} | ${d4(v.usd_all_records)} |`);
}
L.push('', 'Per task pass^k and pass@k (k = the cell\'s repetitions) are in endpoints.json, endpoint5.<cell>.per_task.');
writeFileSync(join(OUT, 'endpoints.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
