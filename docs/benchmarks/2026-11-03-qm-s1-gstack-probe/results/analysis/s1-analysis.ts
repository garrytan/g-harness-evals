#!/usr/bin/env bun
// The S1 report's counts and intervals (PREREGISTRATION.md, Endpoints), keyless, from the driver's turns.jsonl.
//
//   bun docs/benchmarks/2026-11-03-qm-s1-gstack-probe/results/analysis/s1-analysis.ts
//
// Task-clustered bootstrap 95 percent intervals over the 5 requests (10,000 draws, seed 7), computed here, not by the
// driver. The R44 comparison pairs gstack-router with no-gstack on request and repetition; no test is run (5 clusters).
// A turn counts unless its termination is model_error, infra_error or a cap stop, or it shows a preregistered fixture
// fault (Invalid turns). The driver also leaves out turns that are not ok; the R44 rows are printed both ways.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, seededRandom, type PairedItem } from '../../../../../runner/stats/paired.ts';

const SEED = 7, DRAWS = 10000;
type Turn = { turn_id: string; model: string; arm: string; request: number; rep: number; termination: string; wall_ms: number; counts: any; usage: any; first_prompt: any; housekeeping: any };
const turns = readFileSync(join(import.meta.dir, '..', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Turn);
const model = (t: Turn) => (t.model.includes('opus') ? 'opus' : 'sol');
const prereg = (t: Turn) => !['model_error', 'infra_error'].includes(t.termination) && !t.counts?.faults?.length && !t.usage?.cap_stop;
const driver = (t: Turn) => prereg(t) && t.termination === 'ok';

function rate(ts: Turn[], f: (t: Turn) => number | null) {
  const by = new Map<number, { sum: number; count: number }>();
  for (const t of ts) { const v = f(t); if (v === null) continue; const c = by.get(t.request) ?? { sum: 0, count: 0 }; c.sum += v; c.count += 1; by.set(t.request, c); }
  const cl = [...by.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  const k = cl.reduce((a, c) => a + c.sum, 0), n = cl.reduce((a, c) => a + c.count, 0);
  if (cl.length < 2) return { k, n, ci95: null };
  const rng = seededRandom(SEED), boot: number[] = [];
  for (let i = 0; i < DRAWS; i++) { let a = 0, b = 0; for (let j = 0; j < cl.length; j++) { const c = cl[Math.floor(rng() * cl.length)]; a += c.sum; b += c.count; } boot.push(a / b); }
  boot.sort((x, y) => x - y);
  return { k, n, rate: k / n, ci95: [boot[Math.floor(DRAWS * 0.025)], boot[Math.ceil(DRAWS * 0.975) - 1]] as [number, number] };
}
const b = (x: boolean | null | undefined) => (x === null || x === undefined ? null : x ? 1 : 0);
const out: any = { seed: SEED, draws: DRAWS, turns: turns.length, excluded_prereg: turns.filter((t) => !prereg(t)).map((t) => t.turn_id), excluded_driver: turns.filter((t) => !driver(t)).map((t) => t.turn_id + ' ' + t.termination), cells: {}, r44: {} };
for (const m of ['opus', 'sol']) for (const arm of ['gstack-router', 'no-gstack']) {
  const ts = turns.filter((t) => model(t) === m && t.arm === arm && prereg(t));
  out.cells[m + '/' + arm] = {
    turns: ts.length,
    matched_open: rate(ts, (t) => b(t.counts.open_matched)), any_open: rate(ts, (t) => b(t.counts.open_any)),
    complete_inline: rate(ts, (t) => (t.counts.complete_read === 'inline' ? 1 : 0)), complete_cut: rate(ts, (t) => (t.counts.complete_read === 'cut' ? 1 : 0)), complete_pieces: rate(ts, (t) => (t.counts.complete_read === 'pieces' ? 1 : 0)),
    start_preamble: rate(ts, (t) => b(t.counts.start_preamble)), start_first_step: rate(ts, (t) => b(t.counts.start_first_step)),
    cut_reads: ts.reduce((a, t) => a + (t.counts.cut_reads ?? 0), 0), read_after_cut: ts.filter((t) => t.counts.read_after_cut).length,
    progress: rate(ts, (t) => b(t.counts.progress)), router_in_first_prompt: ts.filter((t) => t.first_prompt?.router).length,
    audit_hits: ts.reduce((a, t) => a + (t.counts.audit?.length ?? 0), 0), contaminated: ts.filter((t) => t.counts.contaminated).map((t) => t.turn_id),
    by_request: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, { matched_open: ts.filter((t) => t.request === r && t.counts.open_matched).length, start_preamble: ts.filter((t) => t.request === r && t.counts.start_preamble).length, of: ts.filter((t) => t.request === r).length }])),
    usd: ts.reduce((a, t) => a + (t.usage?.usd ?? 0), 0), housekeeping_usd: ts.reduce((a, t) => a + (t.housekeeping?.usd ?? 0), 0), housekeeping_requests: ts.reduce((a, t) => a + (t.housekeeping?.requests ?? 0), 0),
    system_chars: [...new Set(ts.map((t) => t.first_prompt?.system_chars))],
  };
}
const metrics: Record<string, (t: Turn) => number | null> = {
  progress: (t) => b(t.counts.progress), input_tokens: (t) => t.usage?.input_tokens ?? null, cached_tokens: (t) => t.usage?.cached_tokens ?? null,
  output_tokens: (t) => t.usage?.output_tokens ?? null, usd: (t) => t.usage?.usd ?? null, wall_s: (t) => t.wall_ms / 1000,
};
for (const [label, keep] of [['prereg', prereg], ['driver', driver]] as const) {
  out.r44[label] = {};
  for (const m of ['opus', 'sol']) {
    out.r44[label][m] = {};
    for (const [name, f] of Object.entries(metrics)) {
      const pairs: PairedItem[] = [];
      for (const g of turns.filter((t) => model(t) === m && t.arm === 'gstack-router')) {
        const n = turns.find((t) => model(t) === m && t.arm === 'no-gstack' && t.request === g.request && t.rep === g.rep)!;
        if (!keep(g) || !keep(n)) continue;
        const a = f(n), bb = f(g);
        if (a === null || bb === null) continue;
        pairs.push({ id: g.request + '/' + g.rep, cluster: String(g.request), a, b: bb });
      }
      const d = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
      out.r44[label][m][name] = { mean_no_gstack: d.mean_a, mean_gstack_router: d.mean_b, delta: d.delta, ci95: d.ci95, n_pairs: d.n_pairs, n_clusters: d.n_clusters, tested: false };
    }
  }
}
const pct = (x: number) => (100 * x).toFixed(0);
const iv = (c: [number, number] | null) => (c ? '[' + pct(c[0]) + ', ' + pct(c[1]) + ']' : 'n/a');
const md = ['# S1 counts and intervals', '', `Task-clustered bootstrap 95% intervals over the 5 requests, ${DRAWS} draws, seed ${SEED}.`, '', '| Cell | Turns | Matched open | Any open | Complete read (inline / cut / pieces) | Start (preamble / first step) | Progress | Router in first prompt | Audit hits |', '|---|---:|---|---|---|---|---|---:|---:|'];
for (const [cell, c] of Object.entries<any>(out.cells)) md.push(`| ${cell} | ${c.turns} | ${c.matched_open.k}/${c.matched_open.n} ${iv(c.matched_open.ci95)} | ${c.any_open.k}/${c.any_open.n} ${iv(c.any_open.ci95)} | ${c.complete_inline.k} / ${c.complete_cut.k} / ${c.complete_pieces.k} | ${c.start_preamble.k} ${iv(c.start_preamble.ci95)} / ${c.start_first_step.k}/${c.start_first_step.n} | ${c.progress.k}/${c.progress.n} ${iv(c.progress.ci95)} | ${c.router_in_first_prompt} | ${c.audit_hits} |`);
for (const label of ['prereg', 'driver']) {
  md.push('', `## R44: gstack-router minus no-gstack, paired (${label} exclusions; descriptive, no test)`, '', '| Model | Metric | no-gstack mean | gstack-router mean | Delta | Interval | Pairs |', '|---|---|---:|---:|---:|---|---:|');
  for (const m of ['opus', 'sol']) for (const [name, d] of Object.entries<any>(out.r44[label][m])) {
    const fmt = (x: number) => (name === 'progress' ? (100 * x).toFixed(0) + '%' : name === 'usd' ? '$' + x.toFixed(4) : x.toFixed(name === 'wall_s' ? 1 : 0));
    const civ = d.ci95 ? '[' + fmt(d.ci95[0]) + ', ' + fmt(d.ci95[1]) + ']' : 'n/a';
    md.push(`| ${m} | ${name} | ${fmt(d.mean_no_gstack)} | ${fmt(d.mean_gstack_router)} | ${fmt(d.delta)} | ${civ} | ${d.n_pairs} |`);
  }
}
writeFileSync(join(import.meta.dir, 's1-analysis.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(import.meta.dir, 's1-analysis.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
console.log(JSON.stringify({ excluded_prereg: out.excluded_prereg, excluded_driver: out.excluded_driver, cells: Object.fromEntries(Object.entries<any>(out.cells).map(([k, v]) => [k, { by_request: v.by_request, usd: v.usd, hk: [v.housekeeping_usd, v.housekeeping_requests], sys: v.system_chars, cut: v.cut_reads, rac: v.read_after_cut }])) }));
