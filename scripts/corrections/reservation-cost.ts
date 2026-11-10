#!/usr/bin/env bun
// Keyless sensitivity for the 2026-11-09 correction on reservation charges (docs/corrections.md). When a provider
// error arrives inside an HTTP 200 stream there is no usage, so the metering proxy charges the request's full
// reservation (request bytes plus the 128,000-token output cap at list price) and marks the usage line
// charged_reservation. That charge protects the lease; it is not what the call cost. This writes a copy of a frontier
// Harbor run's merged trials.jsonl in which each trial's usage.usd_reserved holds the charged_reservation lines on its own
// meter, as records written from 2026-11-09 carry it (usage.usd keeps every charged dollar), so that
// scripts/frontier-harbor/analyze.ts and scripts/matrix-analysis.ts leave them out of cost per solve and USD per pass. Charges on runs a rerun
// replaced are listed but not subtracted, because the headline cost already leaves those runs out.
//
//   bun scripts/corrections/reservation-cost.ts --results <merged results dir> --out <dir>
//   bun scripts/corrections/reservation-cost.ts --results <multi-user results dir> --out <dir> --layout matrix
//
// The matrix layout reads <results>/*.proxy-usage.ndjson, where a trial's lines carry key trial-token:<trial id>; a
// charged line whose trial record closed before it was logged is counted under charges_after_record (scripts/matrix-analysis.ts
// adds such lines to a cell's cost; the trial record does not).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Line = { key?: string; actual_usd?: number; charged_reservation?: boolean; outcome?: string };

/** How many of a trial's charged lines its record leaves out: the record's usd is the sum of the lines its meter saw, so a
 *  charge that makes the lines' sum exceed the record by about its own amount was logged after the meter closed. */
function lateCharges(t: { usage?: { usd?: number } }, all: Line[], charged: Line[]): number {
  let excess = all.filter((l) => l.outcome !== 'refused').reduce((a, l) => a + (l.actual_usd ?? 0), 0) - (t.usage?.usd ?? 0);
  let late = 0;
  for (const l of [...charged].reverse()) if (excess >= (l.actual_usd ?? 0) - 1e-6) { excess -= l.actual_usd ?? 0; late++; }
  return late;
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i < 0 ? undefined : process.argv[i + 1]; };
  const results = resolve(arg('results') ?? ''), out = resolve(arg('out') ?? '');
  if (!existsSync(join(results, 'trials.jsonl')) || !arg('out')) { console.error('usage: bun scripts/corrections/reservation-cost.ts --results <merged results dir> --out <dir>'); process.exit(2); }
  const layout = arg('layout') ?? 'harbor';
  const cache = new Map<string, Line[]>();
  const matrixLines = layout === 'matrix' ? readdirSync(results).filter((f) => f.endsWith('.proxy-usage.ndjson')).flatMap((f) => readFileSync(join(results, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line)) : [];
  const linesOf = (shard: string, stage: string) => {
    const f = join(results, 'shards', shard, stage, 'proxy-usage.ndjson');
    if (!cache.has(f)) cache.set(f, existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : []);
    return cache.get(f)!;
  };
  const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const used = new Set<Line>();
  const cells: Record<string, { trials: number; usd: number; usd_reserved: number; trials_with_charge: number; charges: number; charges_on_replaced_runs: number; usd_on_replaced_runs: number; charges_after_record: number; usd_after_record: number }> = {};
  const outRows: string[] = [];
  for (const t of rows) {
    const c = (cells[t.cell] ??= { trials: 0, usd: 0, usd_reserved: 0, trials_with_charge: 0, charges: 0, charges_on_replaced_runs: 0, usd_on_replaced_runs: 0, charges_after_record: 0, usd_after_record: 0 });
    c.trials++;
    c.usd += t.usage?.usd ?? 0;
    const m = /^[^:]+:([^:#]+)(?::([^#]+))?#(.+)$/.exec(t.usage?.meter_id ?? '');
    if (layout !== 'matrix' && !m) { outRows.push(JSON.stringify(t)); continue; }
    const all = layout === 'matrix' ? matrixLines.filter((l) => l.key === 'trial-token:' + t.trial_id) : linesOf(m![1]!, m![2] ?? 'main').filter((l) => l.key === m![3]);
    const mine = all.filter((l) => l.charged_reservation === true);
    const inRecord = layout === 'matrix' ? mine.length - lateCharges(t, all, mine) : mine.length;
    const charged = mine.slice(0, inRecord);
    if (mine.length > inRecord) { c.charges_after_record += mine.length - inRecord; c.usd_after_record += mine.slice(inRecord).reduce((a, l) => a + (l.actual_usd ?? 0), 0); }
    mine.forEach((l) => used.add(l));
    charged.forEach((l) => used.add(l));
    const reserved = charged.reduce((a, l) => a + (l.actual_usd ?? 0), 0);
    if (charged.length) { c.trials_with_charge++; c.charges += charged.length; c.usd_reserved += reserved; }
    outRows.push(JSON.stringify(t.usage ? { ...t, usage: { ...t.usage, usd_reserved: reserved } } : t));
  }
  for (const [f, lines] of cache) {
    const cell = f.slice(join(results, 'shards').length + 1).split('/')[0]!;
    for (const l of lines) if (l.charged_reservation === true && !used.has(l) && cells[cell]) { cells[cell].charges_on_replaced_runs++; cells[cell].usd_on_replaced_runs += l.actual_usd ?? 0; }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'trials.jsonl'), outRows.join('\n') + '\n');
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const summary = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { ...v, usd: r6(v.usd), usd_reserved: r6(v.usd_reserved), usd_on_replaced_runs: r6(v.usd_on_replaced_runs), usd_after_record: r6(v.usd_after_record), reserved_share: v.usd ? r6(v.usd_reserved / v.usd) : 0 }]));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ results: results.slice(resolve(import.meta.dir, '..', '..').length + 1), cells: summary }, null, 2) + '\n');
  for (const [k, v] of Object.entries(summary)) console.log(k.padEnd(24), JSON.stringify(v));
}
