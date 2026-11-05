#!/usr/bin/env bun
// The preregistered C4 analysis (PREREGISTRATION.md, Endpoints), keyless, from the merged results directory.
//
//   bun docs/benchmarks/2026-11-03-qm-c4-told-live/results/analysis/c4-analysis.ts --results <results dir> --tasks tasks/multiuser/v0.3/dev
//
// Writes analysis/c4-analysis.json and analysis/c4-analysis.md beside this file. Every interval is a task-clustered
// bootstrap 95 percent interval (10,000 draws, seed 7). Paired comparisons use clusteredPairedDelta (exact cluster
// sign-flip test) and Holm within each endpoint and each model over its 3 comparisons. The Opus minus Sol gap is
// descriptive and untested. Primary 2 per trial is mechanism.ts --provider-aware's union of the provider path
// (provider_delivered) and the model path (model_returned_by_gbrain), and for corrections the needed fact ahead of the
// superseded one (trialMechanism's ahead).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, holmAdjusted, pairObservations, powerNote, seededRandom, type Observation } from '../../../../../runner/stats/paired.ts';
import { loadTask, type Task } from '../../../../../runner/grade/task.ts';
import { trialMechanism, trialProviderMechanism } from '../../../../../scripts/v03/mechanism.ts';
import { turnStarts } from '../../../../../scripts/recall-audit.ts';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const results = arg('results'), tasksDir = arg('tasks');
if (!results || !tasksDir) { console.error('usage: c4-analysis.ts --results <dir> --tasks <dir>'); process.exit(1); }
const SEED = 7, DRAWS = 10000;
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const MODELS = ['opus', 'sol'] as const;
const ROUTES = ['none', 'gbrain-memory-provider', 'gbrain-route-tool'] as const;
const cellOf = (m: string, r: string) => `qm-pi-${m}-${r}-mu-v03-dev`;
const world = JSON.parse(readFileSync(join(import.meta.dir, '../../../../../world/seed/world.json'), 'utf8')) as { channels: Array<{ name: string; id: string }> };
const channelIds = new Map(world.channels.map((c) => [c.name, c.id]));

type Ev = { seq: number; tool: string; via?: string; caller?: string; kind?: string; provider_op?: string; outcome?: string; args?: Record<string, unknown>; effect?: Record<string, any> };
type Rec = { trial_id: string; cell: string; task: string; termination: string; grade: string; consent_violation: boolean; approval_stop: boolean; cap_stop: boolean; wall_ms: number; usage?: any; predicates: Array<{ id: string; kind: string; passed: boolean; evidence?: string }> };
const recs = readFileSync(join(results, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Rec);
const taskCache = new Map<string, Task>();
const task = (id: string) => { if (!taskCache.has(id)) taskCache.set(id, loadTask(join(tasksDir, id))); return taskCache.get(id)!; };
const rep = (r: Rec) => Number(r.trial_id.split('/').pop()!.slice(1));
const dirOf = (r: Rec) => join(results, 'trials', r.cell, r.task, 'r' + rep(r));
const events = (r: Rec): Ev[] => { const p = join(dirOf(r), 'events.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const family = (t: string) => (t.startsWith('cn-') ? 'continuity' : 'corrections');
const scored = (r: Rec) => !EXCLUDED.has(r.termination);
const pass = (r: Rec) => (r.grade === 'pass' && !r.consent_violation ? 1 : 0);

interface Row { rec: Rec; ev: Ev[]; pass: number; mech: number; provider_only_xscope: boolean; xscope_by_caller: Record<string, number>; pass_provider_xscope_aside: number; pass_delivered_only: number }
const rows: Row[] = recs.map((rec) => {
  const ev = events(rec);
  const t = task(rec.task);
  const p = trialProviderMechanism(t, ev as any, channelIds, { untaggedIsModel: true });
  const m = trialMechanism(t, ev as any, channelIds);
  const reached = p.provider_delivered || p.model_returned_by_gbrain;
  const mech = reached && (t.mechanism?.superseded_turn ? m.ahead === true : true) ? 1 : 0;
  const bySeq = new Map(ev.map((e) => [e.seq, e]));
  const xs = rec.predicates.find((q) => q.id === 'no_cross_scope_reads');
  const offenders = xs && !xs.passed ? [...(xs.evidence ?? '').matchAll(/seq=(\d+) (\S+)(?: fact #(\d+))?/g)].map((mm) => ({ seq: Number(mm[1]), fact: mm[3] })) : [];
  const xscope_by_caller: Record<string, number> = {};
  let allProvider = offenders.length > 0, allUndelivered = offenders.length > 0;
  for (const o of offenders) {
    const e = bySeq.get(o.seq);
    const who = e?.via === 'gbrain' ? (e.caller ?? 'untagged') : (e?.via ?? 'unknown');
    xscope_by_caller[who] = (xscope_by_caller[who] ?? 0) + 1;
    if (who !== 'provider') { allProvider = false; allUndelivered = false; continue; }
    const facts = (e!.effect?.facts ?? []) as Array<{ id?: number | string }>;
    const j = facts.findIndex((f) => String(f.id) === o.fact);
    if (j < 0 || e!.effect?.delivery?.facts?.[j] === true) allUndelivered = false;
  }
  const othersPass = rec.predicates.filter((q) => q.kind === 'required' && q.id !== 'no_cross_scope_reads').every((q) => q.passed) && !rec.consent_violation;
  return {
    rec, ev, pass: pass(rec), mech, provider_only_xscope: allProvider, xscope_by_caller,
    pass_provider_xscope_aside: pass(rec) || (othersPass && allProvider) ? 1 : 0,
    pass_delivered_only: pass(rec) || (othersPass && allUndelivered) ? 1 : 0,
  };
});
const byCell = (cell: string) => rows.filter((r) => r.rec.cell === cell);

function clusterRate(rs: Row[], f: (r: Row) => number): { k: number; n: number; rate: number; ci95: [number, number] | null; tasks: number } {
  const s = rs.filter((r) => scored(r.rec));
  const by = new Map<string, { sum: number; count: number }>();
  for (const r of s) { const c = by.get(r.rec.task) ?? { sum: 0, count: 0 }; c.sum += f(r); c.count += 1; by.set(r.rec.task, c); }
  const cl = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
  const k = cl.reduce((a, c) => a + c.sum, 0), n = cl.reduce((a, c) => a + c.count, 0);
  if (cl.length < 2) return { k, n, rate: n ? k / n : NaN, ci95: null, tasks: cl.length };
  const rng = seededRandom(SEED);
  const boot: number[] = [];
  for (let i = 0; i < DRAWS; i++) { let a = 0, b = 0; for (let j = 0; j < cl.length; j++) { const c = cl[Math.floor(rng() * cl.length)]; a += c.sum; b += c.count; } boot.push(a / b); }
  boot.sort((x, y) => x - y);
  return { k, n, rate: k / n, ci95: [boot[Math.floor(DRAWS * 0.025)], boot[Math.ceil(DRAWS * 0.975) - 1]], tasks: cl.length };
}

function paired(aCell: string, bCell: string, f: (r: Row) => number, filter: (r: Row) => boolean = () => true) {
  const A = byCell(aCell).filter(filter), B = byCell(bCell).filter(filter);
  const key = (r: Row) => r.rec.task + '/' + rep(r.rec);
  const bMap = new Map(B.map((r) => [key(r), r]));
  const obsA: Observation[] = [], obsB: Observation[] = [], excluded: string[] = [];
  for (const a of A) {
    const b = bMap.get(key(a));
    const why = !b ? 'missing' : !scored(a.rec) ? 'a ' + a.rec.termination : !scored(b.rec) ? 'b ' + b.rec.termination : null;
    if (why) excluded.push(key(a) + ': ' + why);
    obsA.push({ id: key(a), cluster: a.rec.task, value: why ? null : f(a), eligible: !why, reason: why ?? undefined });
    obsB.push({ id: key(a), cluster: a.rec.task, value: why || !b ? null : f(b), eligible: !why, reason: why ?? undefined });
  }
  const d = clusteredPairedDelta(pairObservations(obsA, obsB).pairs, { seed: SEED, draws: DRAWS });
  const { bootstrap: _b, ...rest } = d;
  return { ...rest, excluded, power: powerNote(d, { binary: true }) };
}

const COMPARISONS = [
  { name: 'memory-provider minus none', a: 'none', b: 'gbrain-memory-provider' },
  { name: 'memory-provider minus route-tool', a: 'gbrain-route-tool', b: 'gbrain-memory-provider' },
  { name: 'route-tool minus none', a: 'none', b: 'gbrain-route-tool' },
] as const;
const ENDPOINTS = { pass: (r: Row) => r.pass, mechanism: (r: Row) => r.mech } as const;

const out: any = { seed: SEED, draws: DRAWS, cells: {}, comparisons: {}, by_family: {}, opus_minus_sol: {}, provider_failure: {}, xscope: {}, secondary: {}, reconciliation: {}, terminations: {} };
for (const m of MODELS) for (const r of ROUTES) {
  const cell = cellOf(m, r), rs = byCell(cell);
  out.cells[cell] = {
    trials: rs.length, scored: rs.filter((x) => scored(x.rec)).length, excluded: rs.filter((x) => !scored(x.rec)).map((x) => x.rec.trial_id + ' ' + x.rec.termination),
    pass: clusterRate(rs, ENDPOINTS.pass), mechanism: clusterRate(rs, ENDPOINTS.mechanism),
    pass_provider_xscope_aside: clusterRate(rs, (x) => x.pass_provider_xscope_aside),
    pass_delivered_provider_rows_only: clusterRate(rs, (x) => x.pass_delivered_only),
  };
  out.by_family[cell] = Object.fromEntries(['continuity', 'corrections'].map((fam) => [fam, { pass: clusterRate(rs.filter((x) => family(x.rec.task) === fam), ENDPOINTS.pass), mechanism: clusterRate(rs.filter((x) => family(x.rec.task) === fam), ENDPOINTS.mechanism) }]));
  const terms: Record<string, number> = {};
  for (const x of rs) terms[x.rec.termination] = (terms[x.rec.termination] ?? 0) + 1;
  out.terminations[cell] = { ...terms, approval_stops: rs.filter((x) => x.rec.approval_stop).map((x) => x.rec.trial_id), consent_violations: rs.filter((x) => x.rec.consent_violation).map((x) => x.rec.trial_id), cap_stops: rs.filter((x) => x.rec.cap_stop).length };
}
for (const m of MODELS) {
  out.comparisons[m] = {};
  for (const [ep, f] of Object.entries(ENDPOINTS)) {
    const cs = COMPARISONS.map((c) => ({ comparison: c.name, ...paired(cellOf(m, c.a), cellOf(m, c.b), f) }));
    const holm = holmAdjusted(cs.map((c) => c.p_two_sided));
    out.comparisons[m][ep] = cs.map((c, i) => ({ ...c, holm_p: holm[i], distinguished: holm[i] < 0.05 }));
    for (const fam of ['continuity', 'corrections']) {
      out.comparisons[m][ep + '_' + fam + '_descriptive'] = COMPARISONS.map((c) => {
        try { const d = paired(cellOf(m, c.a), cellOf(m, c.b), f, (x) => family(x.rec.task) === fam); return { comparison: c.name, delta: d.delta, ci95: d.ci95, n_clusters: d.n_clusters, n_pairs: d.n_pairs }; } catch (e) { return { comparison: c.name, error: String(e) }; }
      });
    }
  }
}
for (const r of ROUTES) out.opus_minus_sol[r] = Object.fromEntries(Object.entries(ENDPOINTS).map(([ep, f]) => { const d = paired(cellOf('sol', r), cellOf('opus', r), f); return [ep, { delta: d.delta, ci95: d.ci95, n_pairs: d.n_pairs, n_clusters: d.n_clusters, tested: false }]; }));

const pct = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const med = (xs: number[]) => pct(xs, 0.5);
for (const m of MODELS) for (const r of ROUTES) {
  const cell = cellOf(m, r), rs = byCell(cell);
  let dmTurns = 0, failed = 0, empty = 0, withText = 0, noRecall = 0, dropped = 0, oauthRefused = 0, channelRecalls: string[] = [];
  const recallLat: number[] = [], modelLat: number[] = [];
  let model = 0, provider = 0, oauth = 0, all = 0, providerQuery = 0;
  const modelTools: Record<string, number> = {}, providerTools: Record<string, number> = {};
  const coreRecallFailed: string[] = [];
  for (const x of rs) {
    const t = task(x.rec.task), starts = turnStarts(x.ev as any);
    const end = x.ev.find((e) => e.tool === 'gbrain.requester' && !(e.args as any)?.member && starts.length && e.seq > starts[starts.length - 1])?.seq ?? Infinity;
    const core = join(dirOf(x.rec), 'logs', 'core.log');
    if (existsSync(core) && /recall failed/i.test(readFileSync(core, 'utf8'))) coreRecallFailed.push(x.rec.trial_id);
    for (const e of x.ev) {
      if (e.via === 'oauth') oauth++;
      if (e.via !== 'gbrain') continue;
      all++;
      if (e.caller === 'provider') { provider++; providerTools[e.tool] = (providerTools[e.tool] ?? 0) + 1; if (e.provider_op === 'query') providerQuery++; if (e.provider_op === 'recall' && typeof e.effect?.latency_ms === 'number') recallLat.push(e.effect.latency_ms); }
      else { model++; modelTools[e.tool] = (modelTools[e.tool] ?? 0) + 1; if (typeof e.effect?.latency_ms === 'number') modelLat.push(e.effect.latency_ms); }
    }
    if (r !== 'gbrain-memory-provider') continue;
    if (starts.length !== t.turns.length) throw new Error('turn count mismatch in ' + x.rec.trial_id);
    t.turns.forEach((turn, i) => {
      const lo = starts[i], hi = i + 1 < starts.length ? starts[i + 1] : end;
      const inWin = x.ev.filter((e) => e.seq > lo && e.seq < hi);
      const recalls = inWin.filter((e) => e.via === 'gbrain' && e.caller === 'provider' && e.provider_op === 'recall');
      if (turn.channel !== 'dm') { if (recalls.length) channelRecalls.push(x.rec.trial_id + ' turn ' + (i + 1)); return; }
      dmTurns++;
      const refused = inWin.some((e) => e.via === 'oauth' && e.outcome !== 'ok' && (e.args as any)?.client_id === 'qm-memory-read');
      const drop = recalls.some((e) => e.effect?.delivery?.dropped);
      const okRecall = recalls.some((e) => e.outcome === 'ok' && !e.effect?.delivery?.dropped);
      if (!recalls.length) noRecall++;
      if (drop) dropped++;
      if (refused) oauthRefused++;
      if (!recalls.length || drop || refused || !okRecall) failed++;
      else if (recalls.every((e) => !((e.effect?.facts ?? []).length))) empty++;
      if (recalls.some((e) => (e.effect?.delivery?.delivered_chars ?? 0) > 0)) withText++;
    });
  }
  if (r === 'gbrain-memory-provider') out.provider_failure[cell] = { dm_turns: dmTurns, failed, rate: dmTurns ? failed / dmTurns : null, no_recall_event: noRecall, dropped, oauth_refused: oauthRefused, core_recall_failed_trials: coreRecallFailed, empty_recalls_not_failures: empty, dm_turns_with_delivered_text: withText, channel_turn_recalls: channelRecalls };
  out.reconciliation[cell] = { gbrain_tap_events: all, caller_model: model, caller_provider: provider, sum_ok: model + provider === all, oauth_token_events: oauth, model_tools: modelTools, provider_tools: providerTools, provider_query_searches: providerQuery };
  const s = rs.filter((x) => scored(x.rec));
  const usd = s.map((x) => x.rec.usage?.usd ?? 0);
  const hk = s.map((x) => Object.entries(x.rec.usage?.by_model ?? {}).filter(([k]) => k !== x.rec.cell && !k.includes(m === 'opus' ? 'opus-5-5' : 'gpt-6.1-sol')).reduce((a, [, v]: [string, any]) => a + (v.usd ?? 0), 0));
  const hkReq = s.map((x) => Object.entries(x.rec.usage?.by_model ?? {}).filter(([k]) => !k.includes(m === 'opus' ? 'opus-5-5' : 'gpt-6.1-sol')).reduce((a, [, v]: [string, any]) => a + (v.requests ?? 0), 0));
  const passes = s.filter((x) => x.pass).length;
  out.secondary[cell] = {
    usd_total: usd.reduce((a, b) => a + b, 0), usd_per_trial_mean: usd.reduce((a, b) => a + b, 0) / s.length, usd_per_trial_median: med(usd), usd_per_success: passes ? usd.reduce((a, b) => a + b, 0) / passes : null,
    housekeeping_usd: hk.reduce((a, b) => a + b, 0), housekeeping_requests: hkReq.reduce((a, b) => a + b, 0),
    tokens_per_request_median: med(s.map((x) => (x.rec.usage?.input_tokens ?? 0) / Math.max(1, x.rec.usage?.requests ?? 1))),
    input_tokens_per_trial_median: med(s.map((x) => x.rec.usage?.input_tokens ?? 0)), cached_tokens_per_trial_median: med(s.map((x) => x.rec.usage?.cached_tokens ?? 0)), output_tokens_per_trial_median: med(s.map((x) => x.rec.usage?.output_tokens ?? 0)),
    wall_s_median: (med(s.map((x) => x.rec.wall_ms)) ?? 0) / 1000,
    model_gbrain_calls_per_trial: clusterRate(rs, (x) => x.ev.filter((e) => e.via === 'gbrain' && e.caller !== 'provider' && e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list').length),
    trials_with_model_gbrain_call: rs.filter((x) => x.ev.some((e) => e.via === 'gbrain' && e.caller !== 'provider' && e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list')).length,
    provider_recall_latency_ms: { n: recallLat.length, p50: pct(recallLat, 0.5), p95: pct(recallLat, 0.95) },
    model_gbrain_latency_ms: { n: modelLat.length, p50: pct(modelLat, 0.5), p95: pct(modelLat, 0.95) },
  };
  out.xscope[cell] = { trials_failing_no_cross_scope_reads: rs.filter((x) => Object.keys(x.xscope_by_caller).length).map((x) => ({ trial: x.rec.trial_id, by_caller: x.xscope_by_caller })) };
}

const f = (x: number | null | undefined, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : (100 * x).toFixed(d));
const iv = (c: [number, number] | null | undefined) => (c ? '[' + f(c[0]) + ', ' + f(c[1]) + ']' : 'n/a');
const md: string[] = ['# C4 analysis (preregistered endpoints)', '', `Task-clustered bootstrap 95% intervals, ${DRAWS} draws, seed ${SEED}. Rates and differences in percentage points.`, ''];
md.push('## Per cell', '', '| Cell | Scored | Pass | Pass interval | Mechanism | Mechanism interval | Pass, provider-only cross-scope set aside | Pass, delivered provider rows only |', '|---|---:|---:|---|---:|---|---:|---:|');
for (const [cell, c] of Object.entries<any>(out.cells)) md.push(`| \`${cell}\` | ${c.scored} | ${c.pass.k}/${c.pass.n} (${f(c.pass.rate)}) | ${iv(c.pass.ci95)} | ${c.mechanism.k}/${c.mechanism.n} (${f(c.mechanism.rate)}) | ${iv(c.mechanism.ci95)} | ${c.pass_provider_xscope_aside.k}/${c.pass_provider_xscope_aside.n} ${iv(c.pass_provider_xscope_aside.ci95)} | ${c.pass_delivered_provider_rows_only.k}/${c.pass_delivered_provider_rows_only.n} ${iv(c.pass_delivered_provider_rows_only.ci95)} |`);
for (const m of MODELS) for (const ep of Object.keys(ENDPOINTS)) {
  md.push('', `## ${m}: ${ep}, paired (Holm over 3)`, '', '| Comparison | Delta | Interval | p (exact sign-flip) | Holm p | Distinguished | Pairs | Tasks | MDE (80% power) |', '|---|---:|---|---:|---:|---|---:|---:|---:|');
  for (const c of out.comparisons[m][ep]) md.push(`| ${c.comparison} | ${f(c.delta, 1)} | ${iv(c.ci95)} | ${c.p_two_sided.toFixed(4)} | ${c.holm_p.toFixed(4)} | ${c.distinguished ? 'yes' : 'no'} | ${c.n_pairs} | ${c.n_clusters} | ${f(c.power.mde, 1)} |`);
}
md.push('', '## Opus minus Sol (descriptive, not tested)', '', '| Route | Pass delta | Interval | Mechanism delta | Interval |', '|---|---:|---|---:|---|');
for (const r of ROUTES) md.push(`| ${r} | ${f(out.opus_minus_sol[r].pass.delta, 1)} | ${iv(out.opus_minus_sol[r].pass.ci95)} | ${f(out.opus_minus_sol[r].mechanism.delta, 1)} | ${iv(out.opus_minus_sol[r].mechanism.ci95)} |`);
md.push('', '## Provider-failure rate (memory-provider DM member turns)', '', '| Cell | DM turns | Failed | No recall event | Dropped | OAuth refused | core.log recall failed (trials) | Empty recalls (not failures) |', '|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [cell, p] of Object.entries<any>(out.provider_failure)) md.push(`| \`${cell}\` | ${p.dm_turns} | ${p.failed} | ${p.no_recall_event} | ${p.dropped} | ${p.oauth_refused} | ${p.core_recall_failed_trials.length} | ${p.empty_recalls_not_failures} |`);
md.push('', '## Reconciliation: gbrain tap events by caller', '', '| Cell | All gbrain tap events | caller model | caller provider | oauth.token events |', '|---|---:|---:|---:|---:|');
for (const [cell, p] of Object.entries<any>(out.reconciliation)) md.push(`| \`${cell}\` | ${p.gbrain_tap_events} | ${p.caller_model} | ${p.caller_provider} | ${p.oauth_token_events} |`);
md.push('', '## Secondary (descriptive)', '', '| Cell | USD total | USD/trial (mean) | USD/success | Housekeeping USD (requests) | Input tok/request (median) | Wall s (median) | Model gbrain calls/trial | Recall latency p50/p95 ms |', '|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const [cell, s] of Object.entries<any>(out.secondary)) md.push(`| \`${cell}\` | ${s.usd_total.toFixed(4)} | ${s.usd_per_trial_mean.toFixed(4)} | ${s.usd_per_success === null ? 'n/a' : s.usd_per_success.toFixed(4)} | ${s.housekeeping_usd.toFixed(4)} (${s.housekeeping_requests}) | ${Math.round(s.tokens_per_request_median)} | ${s.wall_s_median.toFixed(1)} | ${s.model_gbrain_calls_per_trial.rate.toFixed(2)} ${s.model_gbrain_calls_per_trial.ci95 ? '[' + s.model_gbrain_calls_per_trial.ci95.map((v: number) => v.toFixed(2)).join(', ') + ']' : ''} | ${s.provider_recall_latency_ms.p50 ?? 'n/a'}/${s.provider_recall_latency_ms.p95 ?? 'n/a'} |`);
md.push('', '## Cross-scope read failures by caller', '');
for (const [cell, x] of Object.entries<any>(out.xscope)) md.push(`- \`${cell}\`: ${x.trials_failing_no_cross_scope_reads.length} trials${x.trials_failing_no_cross_scope_reads.length ? ': ' + x.trials_failing_no_cross_scope_reads.map((t: any) => t.trial.split('/').slice(2).join('/') + ' ' + JSON.stringify(t.by_caller)).join('; ') : ''}`);
writeFileSync(join(import.meta.dir, 'c4-analysis.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(import.meta.dir, 'c4-analysis.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
