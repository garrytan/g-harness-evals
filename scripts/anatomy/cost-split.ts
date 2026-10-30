#!/usr/bin/env bun
// Billed components of a counted run's spend, per cell (internal-task, plan decision 5).
//
// Reads the run's metering-proxy usage log(s) named in a committed manifest, keeps forwarded requests, removes
// duplicate rows (same key, time and route), and splits each request's actual_usd into uncached input, cache
// reads, cache writes and output at the proxy's own list prices (runner/ledger/budget-ledger.ts chatPrice).
// The usage log records total input and cache reads but not cache writes, so cache writes are inferred: the
// tokens that make the priced total equal actual_usd, assuming 5-minute cache writes. A request whose inferred
// writes fall outside 0..(input minus reads) is clamped and its remainder reported, never hidden. Each trial's
// summed rows are checked against the usd its trials.jsonl row records.
//
//   bun scripts/anatomy/cost-split.ts --manifest <manifest.json> [--out <split.json>]
//
// Manifest: { "run_id": "...", "usage_logs": [{ "path": "<repo path>", "sha256": "..." }],
//             "trials": { "path": "<repo path>", "sha256": "..." } }
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chatPrice } from '../../runner/ledger/budget-ledger.ts';

const ROOT = resolve(import.meta.dir, '../..');

export interface UsageRow { at: string; key: string; provider: string; route: string; model: string; outcome: string; actual_usd?: number;
  input_tokens?: number; output_tokens?: number; cached_tokens?: number }
type Rates = { input: number; output: number; cache_read?: number; cache_write?: number };
export interface Components { requests: number; uncached_input_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
  output_tokens: number; uncached_input_usd: number; cache_read_usd: number; cache_write_usd: number; output_usd: number;
  actual_usd: number; remainder_usd: number; clamped_requests: number }

const empty = (): Components => ({ requests: 0, uncached_input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
  uncached_input_usd: 0, cache_read_usd: 0, cache_write_usd: 0, output_usd: 0, actual_usd: 0, remainder_usd: 0, clamped_requests: 0 });

/** One request's components. Cache writes are the tokens that reconcile the priced total to actual_usd. */
export function splitRow(row: UsageRow): Components {
  const price = chatPrice(`${row.provider}:${row.model}`) as (Rates & { long?: Rates & { above_input_tokens: number } }) | undefined;
  if (!price) throw new Error(`no list price for ${row.provider}:${row.model}`);
  const input = row.input_tokens ?? 0, read = row.cached_tokens ?? 0, out = row.output_tokens ?? 0, actual = row.actual_usd ?? 0;
  const r: Rates = price.long && input > price.long.above_input_tokens ? price.long : price;
  const cr = r.cache_read ?? r.input, cw = r.cache_write ?? r.input;
  const base = (input - read) * r.input + read * cr + out * r.output;
  const raw = cw > r.input ? Math.round((actual * 1e6 - base) / (cw - r.input)) : 0;
  const write = Math.min(Math.max(raw, 0), input - read);
  const c = empty();
  c.requests = 1;
  c.uncached_input_tokens = input - read - write;
  c.cache_read_tokens = read;
  c.cache_write_tokens = write;
  c.output_tokens = out;
  c.uncached_input_usd = c.uncached_input_tokens * r.input / 1e6;
  c.cache_read_usd = read * cr / 1e6;
  c.cache_write_usd = write * cw / 1e6;
  c.output_usd = out * r.output / 1e6;
  c.actual_usd = actual;
  c.remainder_usd = actual - (c.uncached_input_usd + c.cache_read_usd + c.cache_write_usd + c.output_usd);
  c.clamped_requests = raw === write ? 0 : 1;
  return c;
}

function add(a: Components, b: Components): Components {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof Components)[]) out[k] = a[k] + b[k];
  return out;
}

/** Forwarded rows, duplicates (same key, time and route) removed. */
export function dedupe(rows: UsageRow[]): { rows: UsageRow[]; duplicates: number } {
  const seen = new Set<string>();
  const kept = rows.filter((r) => {
    if (r.outcome !== 'forwarded') return false;
    const id = `${r.key}\u0000${r.at}\u0000${r.route}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { rows: kept, duplicates: rows.filter((r) => r.outcome === 'forwarded').length - kept.length };
}

const cellOf = (key: string) => key.split('/')[1] ?? 'unknown';
const trialOf = (key: string) => key.replace(/^sk-trial-/, '');

export function costSplit(rows: UsageRow[], trials: Array<{ trial_id: string; usage?: { usd?: number } }>) {
  const { rows: kept, duplicates } = dedupe(rows);
  const cells: Record<string, Components> = {};
  const perTrial = new Map<string, number>();
  for (const row of kept) {
    const cell = cellOf(row.key);
    cells[cell] = add(cells[cell] ?? empty(), splitRow(row));
    perTrial.set(trialOf(row.key), (perTrial.get(trialOf(row.key)) ?? 0) + (row.actual_usd ?? 0));
  }
  let worst = 0, unmatched = 0;
  for (const t of trials) {
    const logged = perTrial.get(t.trial_id);
    if (logged === undefined || t.usage?.usd === undefined) { unmatched++; continue; }
    worst = Math.max(worst, Math.abs(logged - t.usage.usd));
  }
  const shares = Object.fromEntries(Object.entries(cells).map(([cell, c]) => {
    const total = c.uncached_input_usd + c.cache_read_usd + c.cache_write_usd + c.output_usd;
    const share = (x: number) => Number((x / total).toFixed(4));
    return [cell, { uncached_input: share(c.uncached_input_usd), cache_read: share(c.cache_read_usd), cache_write: share(c.cache_write_usd), output: share(c.output_usd) }];
  }));
  return { cells, shares, duplicates_removed: duplicates, trials_checked: trials.length - unmatched, trials_unmatched: unmatched,
    max_trial_usd_difference: Number(worst.toFixed(6)) };
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const manifestPath = arg('manifest');
  if (!manifestPath) { console.error('usage: cost-split.ts --manifest <manifest.json> [--out <split.json>]'); process.exit(64); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { run_id: string; usage_logs: Array<{ path: string; sha256: string }>; trials: { path: string; sha256: string } };
  const read = (f: { path: string; sha256: string }) => {
    const text = readFileSync(join(ROOT, f.path), 'utf8');
    const sha = createHash('sha256').update(text).digest('hex');
    if (sha !== f.sha256) throw new Error(`${f.path}: sha256 ${sha} does not match the manifest`);
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const rows = manifest.usage_logs.flatMap(read) as UsageRow[];
  const split = costSplit(rows, read(manifest.trials));
  const out = { run_id: manifest.run_id, manifest: manifestPath, assumption: 'cache writes inferred from actual_usd at the 5-minute cache-write price', ...split };
  if (arg('out')) writeFileSync(arg('out')!, JSON.stringify(out, null, 2) + '\n');
  console.log(`COST_SPLIT: ${manifest.run_id}: ${Object.keys(split.cells).length} cells, ${split.duplicates_removed} duplicate rows removed, ${split.trials_checked} trials reconciled (max difference $${split.max_trial_usd_difference})`);
  for (const [cell, c] of Object.entries(split.cells)) {
    const s = split.shares[cell]!;
    console.log(`  ${cell}: $${c.actual_usd.toFixed(4)} over ${c.requests} requests; input ${(s.uncached_input * 100).toFixed(1)}%, cache read ${(s.cache_read * 100).toFixed(1)}%, cache write ${(s.cache_write * 100).toFixed(1)}%, output ${(s.output * 100).toFixed(1)}%; remainder $${c.remainder_usd.toFixed(6)}, clamped ${c.clamped_requests}`);
  }
}
