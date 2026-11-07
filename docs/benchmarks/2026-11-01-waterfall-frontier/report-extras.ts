#!/usr/bin/env bun
// The report's numbers that summarize-run, mine.ts and contrasts.ts (at the analysis commit f5fa45fca0a4) do not print,
// from the committed receipts, keyless:
//
//   bun docs/benchmarks/2026-11-01-waterfall-frontier/report-extras.ts [--check]
//
// Inputs, all under results/: waterfall.json, contrasts.json, trials.jsonl, shards.json, each shard's
// proxy-usage.ndjson, and each trial's turns.jsonl; calibration.json beside this script. Output: results/report-extras.json.
// With --check it writes nothing and exits 1 when the output differs from what is on disk.
//
// Preregistered readings (PREREGISTRATION.md, Endpoints) that the analysis scripts leave to the report:
// - Per cell: billing classes per trial; sections in bytes per request and per trial; on Opus, estimated tokens for the
//   five point-rated sections and a token range for tool_result (calibration.json); requests per trial; models named in
//   forwarded requests with their dollars; reasoning settings sent; refused requests by route; wall time per trial and
//   per user turn, median with a task-clustered bootstrap interval (seed 7, 10,000 draws).
// - Per contrast: the per-trial difference, B minus A, in each billing class and each section. Every contrast pairs
//   all 40 trials, so the difference of per-trial means is the paired mean difference.
// - Savings levers: the dollars at stake per avoidable-looking pattern and cell, using the formulas in the
//   preregistration and the proxy's own list prices (runner/ledger/budget-ledger.ts chatPrice), and the lever with the
//   largest high-end dollars summed over the Opus cells and over the Sol cells.
// - The cap-stop table of the incomplete-cell rule.
// Exploratory, labelled as such in the report: the minimum detectable difference of each dollars-per-trial contrast
// (runner/stats/paired.ts powerNote, 80% power, alpha 0.05), and per cell how many cache-writing requests a later request
// of the same trial and conversation contains (equal boundary digest at the writer's last index), the test that
// avoidable.ts's patterns 1, 2 and 4 rest on.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatPrice } from '../../../runner/ledger/budget-ledger.ts';
import { clusteredPairedDelta, powerNote, seededRandom } from '../../../runner/stats/paired.ts';

const DIR = 'docs/benchmarks/2026-11-01-waterfall-frontier';
const RES = join(DIR, 'results');
const OUT = join(RES, 'report-extras.json');
const SEED = 7, DRAWS = 10000;
const read = (p: string) => readFileSync(p, 'utf8');
const ndjson = (p: string) => read(p).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r1 = (x: number) => Math.round(x * 10) / 10;

const wf = JSON.parse(read(join(RES, 'waterfall.json')));
const contrasts = JSON.parse(read(join(RES, 'contrasts.json'))).contrasts as Array<{ a: string; b: string; model: string }>;
const shards = JSON.parse(read(join(RES, 'shards.json'))).cells as Record<string, string>;
const trials = ndjson(join(RES, 'trials.jsonl')) as Array<{ trial_id: string; cell: string; task: string; wall_ms: number; cap_stop?: boolean; model: string }>;
const cal = JSON.parse(read(join(DIR, 'calibration.json'))).sections as Record<string, { tokens_per_byte: { pooled?: number; min?: number; max?: number } | null; use: string }>;

const CLASSES = ['uncached_input', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'output', 'embedding', 'failed', 'unknown'];
const SECTIONS = ['system', 'tools', 'user_text', 'tool_result', 'assistant_text', 'tool_use', 'opaque', 'media', 'other'];
const POINT = SECTIONS.filter((s) => cal[s]?.use === 'point');
const isOpus = (model: string) => model === 'anthropic:claude-opus-5-5';

function estTokens(bytes: Record<string, number>) {
  const point: Record<string, number> = {};
  for (const s of POINT) point[s] = Math.round(bytes[s] * cal[s].tokens_per_byte!.pooled!);
  const tr = cal.tool_result.tokens_per_byte!;
  const ends = [Math.round(bytes.tool_result * tr.min!), Math.round(bytes.tool_result * tr.max!)];
  return { point, tool_result_range: [Math.min(...ends), Math.max(...ends)] };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clusteredMedian(byTask: Map<string, number[]>) {
  const tasks = [...byTask.keys()].sort();
  const rand = seededRandom(SEED);
  const draws: number[] = [];
  for (let d = 0; d < DRAWS; d++) {
    const xs: number[] = [];
    for (let i = 0; i < tasks.length; i++) xs.push(...byTask.get(tasks[Math.floor(rand() * tasks.length)])!);
    draws.push(median(xs));
  }
  draws.sort((a, b) => a - b);
  return { median: median([...byTask.values()].flat()), ci95: [draws[Math.floor(0.025 * DRAWS)], draws[Math.ceil(0.975 * DRAWS) - 1]], n: [...byTask.values()].flat().length };
}

const cells = wf.cells.map((c: any) => {
  const shard = shards[c.cell];
  const n = c.trials as number;
  const usage = ndjson(join(RES, shard + '.proxy-usage.ndjson'));
  const chat = usage.filter((u: any) => u.outcome === 'forwarded' && u.model);
  const models: Record<string, { requests: number; usd: number }> = {};
  const reasoning: Record<string, number> = {};
  for (const u of chat) {
    const m = (models[u.model] ??= { requests: 0, usd: 0 });
    m.requests += 1; m.usd = r6(m.usd + u.actual_usd);
    const k = 'thinking_type=' + (u.thinking_type ?? 'none') + ' reasoning_effort=' + (u.reasoning_effort ?? 'none');
    reasoning[k] = (reasoning[k] ?? 0) + 1;
  }
  const refused: Record<string, number> = {};
  for (const u of usage.filter((u: any) => u.outcome === 'refused')) refused[u.route] = (refused[u.route] ?? 0) + 1;
  const freeMetadata = usage.filter((u: any) => u.outcome === 'forwarded' && !u.model).length;
  const charged = usage.filter((u: any) => u.charged_reservation).map((u: any) => ({ trial: u.key.replace(/^trial-token:/, ''), usd: u.actual_usd, reason: u.reason ?? null }));
  const byTrial = new Map<string, any[]>();
  for (const u of usage.filter((u: any) => u.sections)) (byTrial.get(u.key) ?? byTrial.set(u.key, []).get(u.key)!).push(u);
  let writers = 0, contained = 0;
  for (const rs of byTrial.values()) {
    rs.sort((x, y) => x.at.localeCompare(y.at));
    rs.forEach((r, i) => {
      if (!r.cache_write_tokens) return;
      writers += 1;
      const b = r.sections.boundary_sha256 as string[], n = b.length - 1;
      if (n >= 0 && rs.slice(i + 1).some((r2) => r2.sections.conv_sha256 === r.sections.conv_sha256 && r2.sections.boundary_sha256.length > n && r2.sections.boundary_sha256[n] === b[n])) contained += 1;
    });
  }
  const trialWall = new Map<string, number[]>(), turnWall = new Map<string, number[]>();
  for (const t of trials.filter((t) => t.cell === c.cell)) {
    (trialWall.get(t.task) ?? trialWall.set(t.task, []).get(t.task)!).push(t.wall_ms / 1000);
    const turns = ndjson(join(RES, 'trials', t.trial_id.split('/').slice(1).join('/'), 'turns.jsonl'));
    for (const u of turns) (turnWall.get(t.task) ?? turnWall.set(t.task, []).get(t.task)!).push((Date.parse(u.ended_wall) - Date.parse(u.started_wall)) / 1000);
  }
  const bytes = c.sections.bytes as Record<string, number>;
  return {
    cell: c.cell, shard, model: c.model, trials: n, usd: r6(c.bill.actual_usd),
    usd_per_trial: r6(c.bill.actual_usd / n),
    billing_per_trial: Object.fromEntries(CLASSES.map((k) => [k, r6((c.bill.usd[k] ?? 0) / n)])),
    billing_share: Object.fromEntries(CLASSES.map((k) => [k, Math.round(((c.bill.usd[k] ?? 0) / c.bill.actual_usd) * 1000) / 1000])),
    chat_requests: chat.length, requests_per_trial: r1(chat.length / n),
    max_input_tokens: Math.max(...chat.map((u: any) => u.input_tokens ?? 0)),
    section_bytes_per_request: Object.fromEntries(SECTIONS.map((s) => [s, Math.round(bytes[s] / c.sections.requests)])),
    section_bytes_per_trial: Object.fromEntries(SECTIONS.map((s) => [s, Math.round(bytes[s] / n)])),
    body_bytes_per_request: Math.round(c.sections.body_bytes / c.sections.requests),
    estimated_tokens_per_trial: isOpus(c.model) ? estTokens(Object.fromEntries(SECTIONS.map((s) => [s, bytes[s] / n]))) : 'uncalibrated (OpenAI): bytes only',
    models, reasoning, refused_by_route: refused, refused_total: Object.values(refused).reduce((a, b) => a + b, 0),
    forwarded_free_metadata_reads: freeMetadata, charged_reservations: charged,
    exploratory_containment: { cache_writing_requests: writers, contained_by_a_later_request: contained },
    wall_s_per_trial: clusteredMedian(trialWall), wall_s_per_turn: clusteredMedian(turnWall),
  };
});
const byCell = new Map(cells.map((c: any) => [c.cell, c]));

const contrastExtras = contrasts.map((k) => {
  const A: any = byCell.get(k.a), B: any = byCell.get(k.b);
  const wa = wf.trials.filter((t: any) => t.cell === k.a), wb = wf.trials.filter((t: any) => t.cell === k.b);
  const key = (t: any) => t.task + '/' + t.rep;
  const bMap = new Map(wb.map((t: any) => [key(t), t]));
  const pairs = wa.map((t: any) => ({ id: key(t), cluster: t.task, a: t.receipt_usd, b: (bMap.get(key(t)) as any).receipt_usd }));
  const stats = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
  const pn = powerNote(stats);
  const gapSections = Object.fromEntries(SECTIONS.map((s) => [s, B.section_bytes_per_trial[s] - A.section_bytes_per_trial[s]]));
  return {
    a: k.a, b: k.b, model: k.model,
    usd_per_trial_gap: r6(B.usd_per_trial - A.usd_per_trial),
    billing_gap_per_trial: Object.fromEntries(CLASSES.map((c) => [c, r6(B.billing_per_trial[c] - A.billing_per_trial[c])])),
    section_bytes_gap_per_trial: gapSections,
    estimated_tokens_gap_per_trial: isOpus(k.model) ? estTokens(gapSections) : 'uncalibrated (OpenAI): bytes only',
    exploratory_mdd_usd_per_trial: pn.mde === null ? null : r6(pn.mde), exploratory_power_note: pn.note,
  };
});

const M = 1e6;
const levers = cells.map((c: any) => {
  const p = chatPrice(c.model)!;
  const av = wf.cells.find((x: any) => x.cell === c.cell).avoidable;
  const opus = isOpus(c.model);
  const write1h = (p as any).cache_write_1h ?? p.input * 2;
  const rated = (bytes: number, lo: number, hi: number) => [r6(bytes * lo * p.cache_read! / M), r6(bytes * hi * p.input / M)];
  const has1h = c.billing_per_trial.cache_write_1h > 0;
  const tr = cal.tool_result.tokens_per_byte!, tl = cal.tools.tokens_per_byte!.pooled!;
  return {
    cell: c.cell, model: c.model,
    usd_at_stake: {
      cache_miss_repeated_boundary: [r6(av.cache_miss_repeated_boundary.total * (p.input - p.cache_read!) / M), r6(av.cache_miss_repeated_boundary.total * (p.input - p.cache_read!) / M)],
      unread_cache_writes: [r6(av.unread_cache_writes.total * (p.cache_write! - p.input) / M), r6(av.unread_cache_writes.total * ((has1h ? write1h : p.cache_write!) - p.input) / M)],
      unused_tool_schemas: opus ? rated(av.unused_tool_schemas.total, tl, tl) : null,
      resent_tool_results: opus ? rated(av.resent_tool_results.total, tr.min!, tr.max!) : null,
      retries: [r6(av.retries.total), r6(av.retries.total)],
      side_calls: [r6(av.side_calls.total), r6(av.side_calls.total)],
    },
    rates_per_million: { input: p.input, cache_read: p.cache_read, cache_write_5m: p.cache_write, cache_write_1h: has1h ? write1h : null },
  };
});
const PATTERNS = ['cache_miss_repeated_boundary', 'unread_cache_writes', 'unused_tool_schemas', 'resent_tool_results', 'retries', 'side_calls'];
const leverFor = (opus: boolean) => {
  const sums = Object.fromEntries(PATTERNS.map((k) => [k, r6(levers.filter((l: any) => isOpus(l.model) === opus).reduce((s: number, l: any) => s + (l.usd_at_stake[k]?.[1] ?? 0), 0))]));
  const best = PATTERNS.filter((k) => levers.some((l: any) => isOpus(l.model) === opus && l.usd_at_stake[k] !== null)).sort((x, y) => sums[y] - sums[x])[0];
  return { high_end_usd_summed: sums, proposed: best };
};

const capStop = Object.keys(shards).map((cell) => ({ cell, rows: trials.filter((t) => t.cell === cell).length, cap_stop: trials.filter((t) => t.cell === cell && t.cap_stop).length }));

const out = JSON.stringify({ generated_by: DIR + '/report-extras.ts', seed: SEED, draws: DRAWS, cells, contrasts: contrastExtras, levers, proposed_lever: { opus: leverFor(true), sol: leverFor(false) }, cap_stop: capStop }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || read(OUT) !== out) { console.error(OUT + ' differs from what report-extras.ts computes'); process.exit(1); }
  console.log('report-extras: up to date');
} else {
  writeFileSync(OUT, out);
  console.log('wrote ' + OUT);
}
