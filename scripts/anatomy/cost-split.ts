#!/usr/bin/env bun
// Billed components of a counted run's spend, per cell (anatomy plan decision 5; receipts of every age).
//
// Reads the run's metering-proxy usage log(s) named in a committed manifest and splits each forwarded request's
// actual_usd at the proxy's own list prices (runner/ledger/budget-ledger.ts chatPrice, which reads runner/pricing).
// splitRow puts each line in exactly one kind:
//   - a chat request (/v1/messages, /v1/responses, /v1/chat/completions) with reported usage: uncached input, cache
//     reads, cache writes (of which 1-hour writes) and output (of which reasoning tokens);
//   - an embedding request (/v1/embeddings): its own component, tokens and dollars as the proxy recorded them;
//   - a failed line that kept its reservation: its own component, dollars only;
//   - a forwarded line charged its reservation with no usage: "unknown" dollars, never tokens;
//   - a zero-dollar line on any other route (model listings, free count_tokens) gives requests 0.
// A line that carries cache_write_tokens (and cache_write_1h_tokens) uses those measured values. An older line does
// not separate cache writes from uncached input, so its cache writes are inferred: the tokens that make the priced
// total equal actual_usd, assuming 5-minute cache writes. A request whose inferred writes fall outside
// 0..(input minus reads) is clamped and its remainder reported, never hidden.
//
// internal-task (plan decision 8): rows are matched to trials by meter id, in either shape the proxy has written:
// `trial-token:<trial id>` (runs from 2026-10-26, trials.jsonl usage.meter_id) or `sk-trial-<trial id>` (earlier runs,
// usage.key). The cell comes from the matched trial record. A row with no model and no charge (GET /v1/models) is
// skipped and counted; a charged /v1/embeddings row is its own embedding component, and the shares count it. The split
// refuses to publish (exit 2, nothing written) unless every charged row matches a trial, every charged row is a
// forwarded request it can split, and each trial's charged rows sum to its usage.usd within $0.000001. refused_cells names
// the cells a refusal touches (unattributed_refusal is set when a row matches no trial, so no cell can be named), and
// unallocated_share is each cell's summed per-request |remainder_usd| plus its unknown dollars (charged with no usage)
// over its charged dollars (an under-allocated request cannot cancel an over-allocated one), so a reader can tell where
// the split holds. No row
// is dropped as a duplicate: the proxy writes each request once and logs no request id, so two identical rows are two
// parallel requests, and a stale copy of a log is kept out by merge-shards instead. A charged row
// logged before its trial's started_at belongs to an earlier, interrupted attempt of that trial (the meter id is the
// same on --resume and the usage log is append-only): it is left out of the split and the reconciliation and reported
// per cell under earlier_attempts (not_forwarded_rows counts its charged failures).
// This CLI reads only recorded trials, so on an interrupted run a paid trial with no record refuses as unattributed;
// scripts/matrix-analysis.ts passes the manifest's unrecorded trials and counts their rows with the interrupted attempts.
//
//   bun scripts/anatomy/cost-split.ts --manifest <manifest.json> [--out <split.json>]
//
// Manifest: { "run_id": "...", "usage_logs": [{ "path": "<repo path>", "sha256": "..." }],
//             "trials": { "path": "<repo path>", "sha256": "..." } }
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chatPrice } from '../../runner/ledger/budget-ledger.ts';
import { ANTHROPIC_CACHE_WRITE_1H_MULT } from '../../runner/pricing/model-pricing.ts';

const ROOT = resolve(import.meta.dir, '../..');

export interface UsageRow { at: string; key: string; provider: string; route: string; model: string | null; outcome: string; actual_usd?: number;
  input_tokens?: number; output_tokens?: number; cached_tokens?: number; charged_reservation?: boolean;
  cache_write_tokens?: number; cache_write_1h_tokens?: number; reasoning_tokens?: number }
type Rates = { input: number; output: number; cache_read?: number; cache_write?: number };
export interface Components { requests: number; uncached_input_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
  output_tokens: number; uncached_input_usd: number; cache_read_usd: number; cache_write_usd: number; output_usd: number;
  actual_usd: number; remainder_usd: number; clamped_requests: number;
  cache_write_1h_tokens: number; cache_write_1h_usd: number; reasoning_tokens: number; measured_requests: number; inferred_requests: number;
  embedding_requests: number; embedding_tokens: number; embedding_usd: number; failed_requests: number; failed_usd: number;
  unknown_requests: number; unknown_usd: number }

export const empty = (): Components => ({ requests: 0, uncached_input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
  uncached_input_usd: 0, cache_read_usd: 0, cache_write_usd: 0, output_usd: 0, actual_usd: 0, remainder_usd: 0, clamped_requests: 0,
  cache_write_1h_tokens: 0, cache_write_1h_usd: 0, reasoning_tokens: 0, measured_requests: 0, inferred_requests: 0,
  embedding_requests: 0, embedding_tokens: 0, embedding_usd: 0, failed_requests: 0, failed_usd: 0, unknown_requests: 0, unknown_usd: 0 });

const CHAT_ROUTE = /^\/v1\/(messages|responses|chat\/completions)$/;
const EMBEDDING_ROUTE = /^\/v1\/embeddings$/;

/**
 * One line's components; a zero-dollar line that is not a priced request (a model listing, a free count_tokens) gives
 * empty components with requests 0. Chat cache writes are measured when the line carries cache_write_tokens, else they are the tokens
 * that reconcile the priced total to actual_usd at the 5-minute price.
 */
export function splitRow(row: UsageRow): Components {
  const actual = row.actual_usd ?? 0;
  const hasUsage = row.input_tokens !== undefined || row.output_tokens !== undefined;
  const c = empty();
  c.requests = 1;
  c.actual_usd = actual;
  if (row.outcome === 'failed') {
    if (actual === 0) return empty();
    c.failed_requests = 1;
    c.failed_usd = actual;
    return c;
  }
  if (EMBEDDING_ROUTE.test(row.route)) {
    if (actual === 0 && !hasUsage) return empty();
    c.embedding_requests = 1;
    c.embedding_tokens = row.input_tokens ?? 0;
    c.embedding_usd = actual;
    return c;
  }
  if (!CHAT_ROUTE.test(row.route)) {
    if (actual === 0) return empty();
    throw new Error(`${row.key}: a charged line on ${row.route}, which is neither a chat nor an embedding route`);
  }
  if (!hasUsage) {
    if (actual === 0) return empty();
    c.unknown_requests = 1;
    c.unknown_usd = actual;
    return c;
  }
  const price = row.model ? chatPrice(`${row.provider}:${row.model}`) as (Rates & { long?: Rates & { above_input_tokens: number } }) | undefined : undefined;
  if (!price) throw new Error(`no list price for ${row.provider}:${row.model}`);
  const input = row.input_tokens ?? 0, read = row.cached_tokens ?? 0, out = row.output_tokens ?? 0;
  const r: Rates = price.long && input > price.long.above_input_tokens ? price.long : price;
  const cr = r.cache_read ?? r.input, cw = r.cache_write ?? r.input, cw1h = r.input * ANTHROPIC_CACHE_WRITE_1H_MULT;
  const measured = typeof row.cache_write_tokens === 'number';
  let write: number, write1h = 0, raw: number;
  if (measured) {
    write = raw = row.cache_write_tokens!;
    write1h = Math.min(write, row.cache_write_1h_tokens ?? 0);
  } else if (row.charged_reservation) {
    write = raw = 0;
  } else {
    const base = (input - read) * r.input + read * cr + out * r.output;
    raw = cw > r.input ? Math.round((actual * 1e6 - base) / (cw - r.input)) : 0;
    write = Math.min(Math.max(raw, 0), input - read);
  }
  c.uncached_input_tokens = input - read - write;
  c.cache_read_tokens = read;
  c.cache_write_tokens = write;
  c.cache_write_1h_tokens = write1h;
  c.output_tokens = out;
  c.reasoning_tokens = row.reasoning_tokens ?? 0;
  c.uncached_input_usd = c.uncached_input_tokens * r.input / 1e6;
  c.cache_read_usd = read * cr / 1e6;
  c.cache_write_1h_usd = write1h * cw1h / 1e6;
  c.cache_write_usd = (write - write1h) * cw / 1e6 + c.cache_write_1h_usd;
  c.output_usd = out * r.output / 1e6;
  c.measured_requests = measured ? 1 : 0;
  c.inferred_requests = !measured && !row.charged_reservation ? 1 : 0;
  const priced = c.uncached_input_usd + c.cache_read_usd + c.cache_write_usd + c.output_usd;
  if (row.charged_reservation) {
    c.unknown_requests = 1;
    c.unknown_usd = Math.max(actual - priced, 0);
  }
  c.remainder_usd = actual - priced - c.unknown_usd;
  c.clamped_requests = raw === write ? 0 : 1;
  return c;
}

export function add(a: Components, b: Components): Components {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof Components)[]) out[k] = a[k] + b[k];
  return out;
}

export const trialOf = (key: string) => key.replace(/^(sk-trial-|trial-token:)/, '');

export interface SplitTrial { trial_id: string; cell?: string; started_at?: string; usage?: { usd?: number; meter_id?: string; key?: string } | null }

export const USD_TOLERANCE = 1e-6;
/** The share of a cell's charged dollars the split may leave unplaced (remainder_usd) before its shares stop being published. */
export const UNALLOCATED_TOLERANCE = 0.001;
const charged = (r: UsageRow) => (r.actual_usd ?? 0) > 0;

/** Each trial by every key its usage lines can carry, and whether a line was logged before its trial's started_at
 *  (an earlier, interrupted attempt under the same meter id). */
export function meterIndex(trials: SplitTrial[]) {
  const byMeter = new Map<string, SplitTrial>();
  for (const t of trials) {
    for (const id of [t.usage?.meter_id, t.usage?.key, `trial-token:${t.trial_id}`, `sk-trial-${t.trial_id}`]) if (id) byMeter.set(id, t);
  }
  const earlierAttempt = (r: UsageRow) => {
    const t = byMeter.get(r.key);
    return t?.started_at !== undefined && Date.parse(r.at) < Date.parse(t.started_at);
  };
  return { byMeter, earlierAttempt };
}
const cellOf = (t: SplitTrial) => t.cell ?? t.trial_id.split('/')[1] ?? 'unknown';

/** Charged rows logged under a trial's key before its started_at (earlier, interrupted attempts), summed at full
 *  precision and rounded once. Needs no list prices, so it stands when costSplit throws. */
export function earlierAttempts(input: UsageRow[], trials: SplitTrial[]) {
  const { byMeter, earlierAttempt } = meterIndex(trials);
  const earlier: { rows: number; usd: number; not_forwarded_rows: number; by_cell: Record<string, { rows: number; usd: number }> } = { rows: 0, usd: 0, not_forwarded_rows: 0, by_cell: {} };
  for (const r of input.filter((r) => charged(r) && earlierAttempt(r))) {
    const cell = cellOf(byMeter.get(r.key)!);
    const c = earlier.by_cell[cell] ?? { rows: 0, usd: 0 };
    c.rows += 1;
    c.usd += r.actual_usd ?? 0;
    earlier.by_cell[cell] = c;
    earlier.rows += 1;
    earlier.usd += r.actual_usd ?? 0;
    if (r.outcome !== 'forwarded') earlier.not_forwarded_rows += 1;
  }
  earlier.usd = Number(earlier.usd.toFixed(6));
  for (const c of Object.values(earlier.by_cell)) c.usd = Number(c.usd.toFixed(6));
  return earlier;
}

/** Per cell, the charged dollars a trial's current-attempt rows hold beyond its trials.jsonl usage.usd (a request still
 *  running when the proxy finalized the trial is logged after its meter closed). Needs no list prices. */
export function beyondRecords(input: UsageRow[], trials: SplitTrial[]): Record<string, number> {
  const { byMeter, earlierAttempt } = meterIndex(trials);
  const logged = new Map<SplitTrial, number>();
  for (const r of input.filter((r) => charged(r) && byMeter.has(r.key) && !earlierAttempt(r))) {
    const t = byMeter.get(r.key)!;
    logged.set(t, (logged.get(t) ?? 0) + (r.actual_usd ?? 0));
  }
  const out: Record<string, number> = {};
  for (const [t, usd] of logged) {
    const excess = usd - (t.usage?.usd ?? 0);
    if (excess > USD_TOLERANCE) out[cellOf(t)] = (out[cellOf(t)] ?? 0) + excess;
  }
  for (const cell of Object.keys(out)) out[cell] = Number(out[cell]!.toFixed(6));
  return out;
}

export function costSplit(input: UsageRow[], trials: SplitTrial[]) {
  const { byMeter, earlierAttempt } = meterIndex(trials);
  const earlier = earlierAttempts(input, trials);
  const rows = input.filter((r) => !earlierAttempt(r));
  const refusals: string[] = [];
  const refusedCells = new Set<string>();
  const unmatchedKeys = new Map<string, number>();
  for (const r of rows.filter((r) => charged(r) && !byMeter.has(r.key))) unmatchedKeys.set(r.key, (unmatchedKeys.get(r.key) ?? 0) + 1);
  if (unmatchedKeys.size) refusals.push(`${[...unmatchedKeys.values()].reduce((s, n) => s + n, 0)} charged usage row(s) under ${unmatchedKeys.size} meter id(s) match no trial: ${[...unmatchedKeys.keys()].slice(0, 5).join(', ')}${unmatchedKeys.size > 5 ? ', ...' : ''}`);
  const unsplittable = rows.filter((r) => charged(r) && r.outcome !== 'forwarded');
  if (unsplittable.length) refusals.push(`${unsplittable.length} charged usage row(s) are not forwarded requests (outcome ${[...new Set(unsplittable.map((r) => r.outcome))].join(', ')}) and cannot be split into components`);
  for (const r of unsplittable) { const t = byMeter.get(r.key); if (t) refusedCells.add(cellOf(t)); }
  const skipped = rows.filter((r) => r.outcome === 'forwarded' && !r.model && !charged(r)).length;
  const kept = rows.filter((r) => r.outcome === 'forwarded' && (r.model || charged(r)));
  const cells: Record<string, Components> = {};
  const perTrial = new Map<string, number>();
  const grossRemainder: Record<string, number> = {};
  for (const row of kept) {
    const trial = byMeter.get(row.key);
    if (!trial) continue;
    const cell = cellOf(trial);
    const split = splitRow(row);
    cells[cell] = add(cells[cell] ?? empty(), split);
    grossRemainder[cell] = (grossRemainder[cell] ?? 0) + Math.abs(split.remainder_usd) + split.unknown_usd;
    perTrial.set(trial.trial_id, (perTrial.get(trial.trial_id) ?? 0) + (row.actual_usd ?? 0));
  }
  let worst = 0, unmatched = 0;
  const offTrials: string[] = [];
  for (const t of trials) {
    const logged = perTrial.get(t.trial_id);
    const usd = t.usage?.usd;
    if (logged === undefined && !usd) { unmatched++; continue; }
    if (logged === undefined || usd === undefined) { unmatched++; refusedCells.add(cellOf(t)); offTrials.push(`${t.trial_id} (${logged === undefined ? `trials.jsonl usd ${usd} with no charged row` : `charged rows $${logged} with no usage.usd`})`); continue; }
    const diff = Math.abs(logged - usd);
    worst = Math.max(worst, diff);
    if (diff > USD_TOLERANCE) { refusedCells.add(cellOf(t)); offTrials.push(`${t.trial_id} (rows $${logged.toFixed(6)}, trials.jsonl $${usd.toFixed(6)})`); }
  }
  if (offTrials.length) refusals.push(`${offTrials.length} trial(s) do not reconcile with their charged rows: ${offTrials.slice(0, 5).join('; ')}${offTrials.length > 5 ? '; ...' : ''}`);
  const shares = Object.fromEntries(Object.entries(cells).map(([cell, c]) => {
    const total = c.uncached_input_usd + c.cache_read_usd + c.cache_write_usd + c.output_usd + c.embedding_usd;
    const share = (x: number) => Number((x / total).toFixed(4));
    return [cell, { uncached_input: share(c.uncached_input_usd), cache_read: share(c.cache_read_usd), cache_write: share(c.cache_write_usd), output: share(c.output_usd), embedding: share(c.embedding_usd) }];
  }));
  const unallocated = Object.fromEntries(Object.entries(cells).map(([cell, c]) => [cell, c.actual_usd > 0 ? Number(((grossRemainder[cell] ?? 0) / c.actual_usd).toFixed(6)) : 0]));
  const usd = (xs: number[]) => Number(xs.reduce((s, x) => s + x, 0).toFixed(6));
  return { cells, shares, trials_checked: trials.length - unmatched, trials_unmatched: unmatched,
    max_trial_usd_difference: Number(worst.toFixed(6)),
    charged_rows: rows.filter(charged).length, uncharged_rows_skipped: skipped,
    usd_total: { usage_rows: usd(kept.map((r) => r.actual_usd ?? 0)), trials: usd(trials.map((t) => t.usage?.usd ?? 0)) },
    earlier_attempts: earlier, unallocated_share: unallocated,
    refused_cells: [...refusedCells].sort(), unattributed_refusal: unmatchedKeys.size > 0, refusals };
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
  if (split.refusals.length) {
    for (const r of split.refusals) console.error(`COST_SPLIT_REFUSED: ${manifest.run_id}: ${r}`);
    console.error('Nothing was written: every charged usage row must match a trial and every trial must reconcile before a split is published.');
    process.exit(2);
  }
  const measured = Object.values(split.cells).reduce((n, c) => n + c.measured_requests, 0);
  const inferred = Object.values(split.cells).reduce((n, c) => n + c.inferred_requests, 0);
  const assumption = !measured ? 'cache writes inferred from actual_usd at the 5-minute cache-write price'
    : !inferred ? 'cache writes measured from cache_write_tokens and cache_write_1h_tokens on every request'
    : `cache writes measured on ${measured} requests and inferred from actual_usd at the 5-minute price on ${inferred}`;
  const out = { run_id: manifest.run_id, manifest: manifestPath, assumption, ...split };
  if (arg('out')) writeFileSync(arg('out')!, JSON.stringify(out, null, 2) + '\n');
  console.log(`COST_SPLIT: ${manifest.run_id}: ${Object.keys(split.cells).length} cells, ${split.trials_checked} trials reconciled (max difference $${split.max_trial_usd_difference})`);
  for (const [cell, c] of Object.entries(split.cells)) {
    const s = split.shares[cell]!;
    console.log(`  ${cell}: $${c.actual_usd.toFixed(4)} over ${c.requests} requests; input ${(s.uncached_input * 100).toFixed(1)}%, cache read ${(s.cache_read * 100).toFixed(1)}%, cache write ${(s.cache_write * 100).toFixed(1)}%, output ${(s.output * 100).toFixed(1)}%; embedding ${(s.embedding * 100).toFixed(1)}%; remainder ${c.remainder_usd.toFixed(6)}, unknown ${c.unknown_usd.toFixed(6)}, clamped ${c.clamped_requests}, measured ${c.measured_requests}`);
  }
}
