#!/usr/bin/env bun
// Token waterfall miner (internal-task): every trial's spend split into billing classes, per request, user turn, trial and
// cell, and with --sections into the content partition the metering proxy logs.
//
//   bun scripts/waterfall/mine.ts --manifest <manifest.json> --out <waterfall.json> [--sections] [--calibration <json>]
//     [--seed 7] [--draws 2000]
//
// Manifest: a JSON list of shards, paths relative to the repository root:
//   [{ "run": "...", "cell": "...", "usage_log": "<proxy-usage.ndjson>", "sha256": "<of usage_log>",
//      "trials_jsonl": "<trials.jsonl>", "trials_sha256": "<optional>", "trials_dir": "<dir holding <cell>/<task>/<rN>/turns.jsonl>" }]
//
// Billing: each usage line goes through scripts/anatomy/cost-split.ts splitRow, which prices at the proxy's own list
// prices (runner/ledger/budget-ledger.ts chatPrice, read from runner/pricing). Cache writes are measured when the line
// carries cache_write_tokens; older lines get them inferred at the 5-minute rate, flagged "inferred", with clamps
// counted. The classes sum to the receipt dollars.
//
// Every forwarded or failed line counts, identical ones included: the proxy logs no request id, so two identical lines
// are two parallel requests. A line logged before its trial's started_at belongs to an earlier, interrupted attempt
// (the meter id is the same on --resume): it is left out of the trial and counted under earlier_attempt_*.
//
// Turns: a request joins the user turn whose started_wall..ended_wall window (turns.jsonl) holds the time the proxy
// received it. Requests outside every window go to "out_of_turn": a timing bucket, not a purpose. Context growth (mean
// and last request input tokens per turn) counts chat requests only, never embeddings.
//
// Sections (--sections): the nine content sections in bytes, and in tokens only through --calibration, a JSON map
// { "<provider:model or model>": { "<section>": tokens_per_byte } }. Without it, bytes only. Also per-turn growth and
// the six avoidable-looking categories of scripts/waterfall/avoidable.ts, with task-clustered intervals of the
// per-trial mean.
//
// Exits 1 when a trial with positive spend has no usage rows, a trial's mined dollars differ from its trials.jsonl usd
// by more than $0.000001, or a charged line names no trial of its shard.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { meterIndex, splitRow, trialOf, type UsageRow } from '../anatomy/cost-split.ts';
import { seededRandom } from '../../runner/stats/paired.ts';
import { avoidable, type Avoidable, type SectionRequest } from './avoidable.ts';
import { addBill, billOf, emptyBill, isHeadline, SECTION_NAMES, type Bill, type SectionName, type SectionsV1 } from './types.ts';

const ROOT = resolve(import.meta.dir, '../..');

export interface Shard { run: string; cell: string; usage_log: string; sha256: string; trials_jsonl: string; trials_sha256?: string; trials_dir: string }
export interface TrialRow { trial_id: string; cell: string; task: string; harness?: string; model: string; grade?: string; consent_violation?: boolean; started_at?: string; usage?: { usd?: number; meter_id?: string } }
export interface Turn { turn: number; started_wall: string; ended_wall: string }
export type Calibration = Record<string, Partial<Record<SectionName, number>>>;
export interface LoadedShard { shard: Shard; rows: UsageRow[]; trials: TrialRow[]; turns: (trialId: string) => Turn[] }
export interface MineOptions { sections: boolean; calibration?: Calibration; seed: number; draws: number }

type Line = UsageRow & { sections?: SectionsV1; tools_called?: string[]; sections_error?: string };
interface Request { at: number; turn: number | 'out_of_turn'; provider: string; model: string | null; chat: boolean; bill: Bill; sections?: SectionsV1; tools_called: string[] }
export interface TurnOut { turn: number; bill: Bill; chat_requests: number; mean_input_tokens_per_request: number; last_request_input_tokens: number; sections?: SectionTotals }
export interface TrialOut { trial_id: string; cell: string; task: string; rep: number; pass: boolean; receipt_usd: number | null; bill: Bill; turns: TurnOut[]; out_of_turn: Bill;
  sections?: SectionTotals; avoidable?: Avoidable }
export interface SectionTotals { requests: number; body_bytes: number; bytes: Record<SectionName, number>; tokens?: Record<SectionName, number>; uncalibrated_requests?: number;
  /** With a calibration: bytes of sections the table has no rate for ("other" framing always), left out of tokens. */
  uncalibrated_bytes?: Record<SectionName, number> }

/** The avoidable-looking categories, each with the measure its chart bar shows. */
export const AVOIDABLE_MEASURES = [
  { key: 'cache_miss_repeated_boundary', measure: 'tokens', unit: 'tokens', label: 'Cache misses on a repeated prefix' },
  { key: 'unread_cache_writes', measure: 'tokens', unit: 'tokens', label: 'Cache writes never read' },
  { key: 'unused_tool_schemas', measure: 'bytes', unit: 'bytes', label: 'Schemas of tools never called' },
  { key: 'resent_tool_results', measure: 'bytes', unit: 'bytes', label: 'Tool results sent again' },
  { key: 'retries', measure: 'usd', unit: 'USD', label: 'Retries' },
  { key: 'side_calls', measure: 'usd', unit: 'USD', label: 'Side calls' },
] as const;

const inputTokens = (b: Bill) => b.tokens.uncached_input + b.tokens.cache_read + b.tokens.cache_write_5m + b.tokens.cache_write_1h;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const zeroSections = () => Object.fromEntries(SECTION_NAMES.map((k) => [k, 0])) as Record<SectionName, number>;
export const isPass = (t: TrialRow) => t.grade === 'pass' && !t.consent_violation;

/** A sections object that follows the v1 contract: the nine byte fields sum exactly to body_bytes. */
export function validSections(s: unknown): s is SectionsV1 {
  if (!s || typeof s !== 'object') return false;
  const x = s as SectionsV1;
  return x.v === 1 && Number.isFinite(x.body_bytes) && SECTION_NAMES.every((k) => Number.isFinite(x[k])) && sum(SECTION_NAMES.map((k) => x[k])) === x.body_bytes
    && Array.isArray(x.boundary_sha256) && Array.isArray(x.tools_declared) && Array.isArray(x.tool_results) && typeof x.conv_sha256 === 'string';
}

/**
 * A calibrate.ts output ({ model, sections: { <section>: { tokens_per_byte: { pooled } | null } } }) as a Calibration
 * keyed by its model, with only the sections it measured; a table already keyed by model passes through unchanged.
 */
export function calibrationTable(json: unknown): Calibration {
  const c = json as { model?: unknown; sections?: Record<string, { tokens_per_byte?: { pooled?: unknown } | null } | null> };
  if (typeof c.model !== 'string' || !c.sections || typeof c.sections !== 'object') return json as Calibration;
  return { [c.model]: Object.fromEntries(Object.entries(c.sections).flatMap(([k, s]) => (typeof s?.tokens_per_byte?.pooled === 'number' ? [[k, s.tokens_per_byte.pooled]] : []))) };
}

/** Section bytes (and calibrated tokens) summed over requests; a section the calibration has no rate for stays in bytes. */
export function sectionTotals(reqs: readonly Request[], calibration?: Calibration): SectionTotals | undefined {
  const withSections = reqs.filter((r) => r.sections);
  if (!withSections.length) return undefined;
  const out: SectionTotals = { requests: withSections.length, body_bytes: 0, bytes: zeroSections(), ...(calibration ? { tokens: zeroSections(), uncalibrated_requests: 0, uncalibrated_bytes: zeroSections() } : {}) };
  for (const r of withSections) {
    out.body_bytes += r.sections!.body_bytes;
    for (const k of SECTION_NAMES) out.bytes[k] += r.sections![k];
    if (!calibration) continue;
    const rates = calibration[`${r.provider}:${r.model}`] ?? calibration[r.model ?? ''];
    if (!rates) {
      out.uncalibrated_requests!++;
      for (const k of SECTION_NAMES) out.uncalibrated_bytes![k] += r.sections![k];
      continue;
    }
    for (const k of SECTION_NAMES) {
      const rate = rates[k];
      if (typeof rate === 'number') out.tokens![k] += r.sections![k] * rate;
      else out.uncalibrated_bytes![k] += r.sections![k];
    }
  }
  return out;
}

/** Mean of per-trial values with a task-clustered percentile bootstrap interval (null with fewer than two tasks). */
export function clusterMean(items: ReadonlyArray<{ cluster: string; value: number }>, seed: number, draws: number) {
  const byTask = new Map<string, { sum: number; n: number }>();
  for (const i of items) { const c = byTask.get(i.cluster) ?? { sum: 0, n: 0 }; c.sum += i.value; c.n++; byTask.set(i.cluster, c); }
  const tasks = [...byTask.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  const mean = items.length ? sum(items.map((i) => i.value)) / items.length : 0;
  if (tasks.length < 2) return { mean, ci95: null };
  const rng = seededRandom(seed), boot: number[] = [];
  for (let d = 0; d < draws; d++) {
    let s = 0, n = 0;
    for (let j = 0; j < tasks.length; j++) { const c = tasks[Math.floor(rng() * tasks.length)]!; s += c.sum; n += c.n; }
    boot.push(s / n);
  }
  boot.sort((a, b) => a - b);
  return { mean, ci95: [boot[Math.floor(draws * 0.025)]!, boot[Math.ceil(draws * 0.975) - 1]!] as [number, number] };
}

export function mine(shards: readonly LoadedShard[], options: MineOptions) {
  const recon = { trials_checked: 0, trials_unmatched: 0, max_trial_usd_difference: 0, unattributed_lines: 0, unattributed_usd: 0, other_cell_lines: 0, earlier_attempt_lines: 0, earlier_attempt_usd: 0, free_lines_skipped: 0,
    sections_missing: 0, sections_invalid: 0, sections_error: 0 };
  const unmatched: string[] = [];
  const cells = [], trialsOut: TrialOut[] = [];
  for (const { shard, rows, trials: allTrials, turns } of shards) {
    const trials = allTrials.filter((t) => t.cell === shard.cell);
    const otherCells = new Set(allTrials.filter((t) => t.cell !== shard.cell).map((t) => t.trial_id));
    const byTrial = new Map<string, Request[]>(trials.map((t) => [t.trial_id, []]));
    const turnsOf = new Map(trials.map((t) => [t.trial_id, turns(t.trial_id)]));
    const own = rows.filter((l) => !otherCells.has(trialOf((l as Line).key)));
    recon.other_cell_lines += rows.length - own.length;
    const { earlierAttempt } = meterIndex(trials);
    for (const line of own.filter((l) => l.outcome === 'forwarded' || l.outcome === 'failed') as Line[]) {
      const c = splitRow(line);
      if (c.requests === 0) { recon.free_lines_skipped++; continue; }
      if (earlierAttempt(line)) { recon.earlier_attempt_lines++; recon.earlier_attempt_usd += c.actual_usd; continue; }
      const id = trialOf(line.key), list = byTrial.get(id);
      if (!list) { recon.unattributed_lines++; recon.unattributed_usd += c.actual_usd; continue; }
      const at = Date.parse(line.at);
      const turn = turnsOf.get(id)!.find((t) => Date.parse(t.started_wall) <= at && at <= Date.parse(t.ended_wall))?.turn ?? 'out_of_turn';
      let sections: SectionsV1 | undefined;
      if (options.sections) {
        if (line.sections_error !== undefined) recon.sections_error++;
        else if (line.sections === undefined) recon.sections_missing++;
        else if (!validSections(line.sections)) recon.sections_invalid++;
        else sections = line.sections;
      }
      list.push({ at, turn, provider: line.provider, model: line.model, chat: line.route !== '/v1/embeddings', bill: billOf(c), ...(sections ? { sections } : {}), tools_called: sections ? line.tools_called ?? [] : [] });
    }
    const cellTrials: TrialOut[] = [];
    for (const t of trials) {
      const reqs = byTrial.get(t.trial_id)!.sort((a, b) => a.at - b.at);
      const bill = reqs.reduce((b, r) => addBill(b, r.bill), emptyBill());
      const receipt = t.usage?.usd;
      if (receipt === undefined || (!reqs.length && receipt !== 0)) { recon.trials_unmatched++; unmatched.push(t.trial_id); }
      else { recon.trials_checked++; recon.max_trial_usd_difference = Math.max(recon.max_trial_usd_difference, Math.abs(bill.actual_usd - receipt)); }
      const turnRows = turnsOf.get(t.trial_id)!.map((turn): TurnOut => {
        const inTurn = reqs.filter((r) => r.turn === turn.turn);
        const tb = inTurn.reduce((b, r) => addBill(b, r.bill), emptyBill());
        const sec = options.sections ? sectionTotals(inTurn, options.calibration) : undefined;
        const chat = inTurn.filter((r) => r.chat);
        return { turn: turn.turn, bill: tb, chat_requests: chat.length, mean_input_tokens_per_request: chat.length ? sum(chat.map((r) => inputTokens(r.bill))) / chat.length : 0,
          last_request_input_tokens: chat.length ? inputTokens(chat.at(-1)!.bill) : 0, ...(sec ? { sections: sec } : {}) };
      });
      const outOfTurn = reqs.filter((r) => r.turn === 'out_of_turn').reduce((b, r) => addBill(b, r.bill), emptyBill());
      const sectionReqs: SectionRequest[] = reqs.filter((r) => r.sections).map((r) => ({ at: r.at, turn: r.turn, usd: r.bill.actual_usd, cache_read: r.bill.tokens.cache_read,
        cache_write: r.bill.tokens.cache_write_5m + r.bill.tokens.cache_write_1h, cache_write_1h: r.bill.tokens.cache_write_1h, sections: r.sections!, tools_called: r.tools_called }));
      const sec = options.sections ? sectionTotals(reqs, options.calibration) : undefined;
      const row: TrialOut = { trial_id: t.trial_id, cell: t.cell, task: t.task, rep: Number(t.trial_id.split('/').at(-1)!.replace(/^r/, '')), pass: isPass(t), receipt_usd: receipt ?? null,
        bill, turns: turnRows, out_of_turn: outOfTurn, ...(sec ? { sections: sec } : {}), ...(sectionReqs.length ? { avoidable: avoidable(sectionReqs) } : {}) };
      cellTrials.push(row);
      trialsOut.push(row);
    }
    const maxTurn = Math.max(0, ...cellTrials.flatMap((t) => t.turns.map((u) => u.turn)));
    const turnsByIndex = Array.from({ length: maxTurn }, (_, i) => i + 1).map((k) => {
      const rowsK = cellTrials.flatMap((t) => t.turns.filter((u) => u.turn === k));
      const active = rowsK.filter((u) => u.chat_requests > 0);
      const chatRequests = sum(rowsK.map((u) => u.chat_requests));
      const bill = rowsK.reduce((b, u) => addBill(b, u.bill), emptyBill());
      const sec = rowsK.filter((u) => u.sections).map((u) => u.sections!);
      return { turn: k, trials: rowsK.length, bill, mean_input_tokens_per_request: chatRequests ? sum(rowsK.map((u) => u.mean_input_tokens_per_request * u.chat_requests)) / chatRequests : 0,
        mean_last_request_input_tokens: active.length ? sum(active.map((u) => u.last_request_input_tokens)) / active.length : 0,
        ...(sec.length ? { mean_body_bytes_per_request: sum(sec.map((s) => s.body_bytes)) / sum(sec.map((s) => s.requests)) } : {}) };
    });
    const withAvoidable = cellTrials.filter((t) => t.avoidable);
    const avoidableSummary = withAvoidable.length ? Object.fromEntries(AVOIDABLE_MEASURES.map(({ key, measure, unit, label }) => {
      const values = withAvoidable.map((t) => ({ cluster: t.task, value: (t.avoidable![key as keyof Avoidable] as Record<string, number>)[measure] ?? 0 }));
      const { mean, ci95 } = clusterMean(values, options.seed, options.draws);
      return [key, { label, measure, unit, total: sum(values.map((v) => v.value)), trials: values.length, per_trial_mean: mean, ci95 }];
    })) : undefined;
    const allReqs = [...byTrial.values()].flat();
    const sec = options.sections ? sectionTotals(allReqs, options.calibration) : undefined;
    cells.push({ run: shard.run, cell: shard.cell, harness: trials[0]?.harness ?? null, model: trials[0]?.model ?? null, headline: trials[0] ? isHeadline(trials[0].model) : false,
      trials: cellTrials.length, passes: cellTrials.filter((t) => t.pass).length, bill: cellTrials.reduce((b, t) => addBill(b, t.bill), emptyBill()),
      out_of_turn: cellTrials.reduce((b, t) => addBill(b, t.out_of_turn), emptyBill()), turns_by_index: turnsByIndex,
      ...(sec ? { sections: sec } : {}), ...(avoidableSummary ? { avoidable: avoidableSummary } : {}) });
  }
  recon.max_trial_usd_difference = Number(recon.max_trial_usd_difference.toFixed(9));
  const ok = recon.trials_unmatched === 0 && recon.max_trial_usd_difference <= 0.000001 && recon.unattributed_usd === 0;
  return { ok, unmatched, reconciliation: recon, cells, trials: trialsOut };
}

function readHashed(path: string, sha?: string): string {
  const text = readFileSync(join(ROOT, path), 'utf8');
  const got = createHash('sha256').update(text).digest('hex');
  if (sha !== undefined && got !== sha) throw new Error(`${path}: sha256 ${got} does not match the manifest`);
  return text;
}
const ndjson = (text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

export function loadShards(manifest: Shard[]): LoadedShard[] {
  return manifest.map((shard) => ({
    shard,
    rows: ndjson(readHashed(shard.usage_log, shard.sha256)),
    trials: ndjson(readHashed(shard.trials_jsonl, shard.trials_sha256)),
    turns: (trialId: string) => {
      const p = join(ROOT, shard.trials_dir, ...trialId.split('/').slice(1), 'turns.jsonl');
      return existsSync(p) ? ndjson(readFileSync(p, 'utf8')).map((t) => ({ turn: t.turn, started_wall: t.started_wall, ended_wall: t.ended_wall })) : [];
    },
  }));
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const manifestPath = arg('manifest'), outPath = arg('out');
  if (!manifestPath || !outPath) { console.error('usage: bun scripts/waterfall/mine.ts --manifest <manifest.json> --out <waterfall.json> [--sections] [--calibration <json>] [--seed 7] [--draws 2000]'); process.exit(64); }
  const calibrationPath = arg('calibration');
  const options: MineOptions = { sections: argv.includes('--sections'), seed: Number(arg('seed') ?? 7), draws: Number(arg('draws') ?? 2000),
    ...(calibrationPath ? { calibration: calibrationTable(JSON.parse(readFileSync(calibrationPath, 'utf8'))) } : {}) };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Shard[];
  const result = mine(loadShards(manifest), options);
  const out = {
    schema: 'token-waterfall/v1', generated_by: 'scripts/waterfall/mine.ts', manifest: manifestPath, sections: options.sections, calibration: calibrationPath ?? null,
    seed: options.seed, draws: options.draws,
    pricing: 'scripts/anatomy/cost-split.ts splitRow at runner/ledger/budget-ledger.ts chatPrice (runner/pricing)',
    notes: {
      inferred: 'a request whose usage line does not report cache writes: its writes are the tokens that reconcile the priced total to actual_usd at the 5-minute rate',
      out_of_turn: 'requests the proxy received outside every user turn window in turns.jsonl; a timing bucket that says nothing about purpose',
      remainder: 'dollars a clamped inference could not place in a token class',
      trial_rows: 'one line per trial; numeric fields that are 0 are omitted',
    },
    reconciliation: result.reconciliation, cells: result.cells, trials: '__TRIALS__',
  };
  const json = JSON.stringify(out, null, 2).replace('"__TRIALS__"', `[\n${result.trials.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]`);
  writeFileSync(outPath, json + '\n');
  const r = result.reconciliation;
  console.log(`WATERFALL_MINE: ${result.cells.length} cells, ${result.trials.length} trials; ${r.trials_checked} reconciled (max difference $${r.max_trial_usd_difference}), ${r.trials_unmatched} unmatched; ${r.unattributed_lines} unattributed lines ($${r.unattributed_usd}); ${r.other_cell_lines} lines of other cells skipped; ${r.earlier_attempt_lines} earlier-attempt lines ($${r.earlier_attempt_usd}), ${r.free_lines_skipped} free lines skipped`);
  if (options.sections) console.log(`  sections: ${r.sections_missing} lines without sections, ${r.sections_invalid} invalid, ${r.sections_error} with sections_error`);
  for (const c of result.cells) console.log(`  ${c.cell}: $${c.bill.actual_usd.toFixed(4)} over ${c.bill.requests} requests (${c.bill.inferred_requests} inferred, ${c.bill.clamped_requests} clamped), out of turn $${c.out_of_turn.actual_usd.toFixed(4)}`);
  if (!result.ok) {
    console.error(`WATERFALL_MINE: FAIL: ${r.trials_unmatched} trial(s) with spend and no rows${result.unmatched.length ? ` (${result.unmatched.slice(0, 5).join(', ')})` : ''}, max difference $${r.max_trial_usd_difference}, unattributed $${r.unattributed_usd}`);
    process.exit(1);
  }
}
