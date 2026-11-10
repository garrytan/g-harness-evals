#!/usr/bin/env bun
// The preregistered analysis of a harness x model matrix run (internal-task, plan decision 8 and "Analysis (preregistered)").
//
//   bun scripts/matrix-analysis.ts --results <merged results dir> --spec <spec.json> [--out <dir>]
//
// Reads <results>/trials.jsonl, <results>/manifest.json, each trial's world event log under <results>/trials/ and the
// proxy usage logs at the top of <results> (*proxy-usage.ndjson, one per shard after scripts/merge-shards.ts). Writes
// matrix-analysis.json and matrix-analysis.md to --out (default: the results directory). Intervals, never ranks: rows
// follow the order of the spec.
//
// The estimator is the task mean: each task's mean pass over its scored repetitions, then the mean over tasks, so a
// 4-repetition cell and a 5-repetition cell compare on the same footing. A trial passes when grade is pass with no
// consent violation. Faults are handled the same way in every cell: harness_error is a fail (0); model_error,
// infra_error and exam_fault are excluded and counted per cell (methodology item 9). A task with no scored trial in a
// cell has no task mean there.
//
// Intervals are task-clustered percentile bootstraps (tasks resampled with replacement, the spec's seed and draws,
// 10,000 by default). Paired differences use runner/stats/paired.ts clusteredPairedDelta with one item per task (B's task
// mean against A's), over the tasks present in both cells; a task missing from either cell drops from that comparison
// and is listed with the reason. The p-value is the task-level sign-flip test from the same function (exact up to 20
// tasks). Holm runs across exactly the spec's primary family, whose size the spec states and the script checks; a
// primary comparison that fails Holm is "can't tell apart", never a tie. One with fewer than 10 paired tasks is not tested
// (methodology item 10): it keeps its estimate and interval and counts as p = 1 inside the family. Secondary comparisons
// carry an interval and no test.
//
// Headroom (runner/stats/headroom.ts, docs/methods.md): after Holm, a "higher" call is refused and reads "can't tell: no
// room to improve" when fewer than 10 of the pair's tasks are ones the run can tell apart (not every spec cell passed it
// on every repetition, not every cell failed it on every repetition), or when on those tasks the losing cell leaves less
// room than the spec's smallest_difference. Each primary comparison carries its headroom record. A spec listed in
// scripts/headroom.ts (published before the gate) keeps the output it was published with.
//
// A drop is frontier minus cheap per task (a frontier-to-cheap drop for one harness). A drop difference is drop A minus
// drop B per task, over tasks present in all four cells. A task is informative for a drop unless both cells sit at the
// same extreme on it (both at 0, or both passing every scored repetition); a drop difference counts the tasks
// informative in both drops, and with fewer than h3_min_informative_tasks (8 by default) it is "inconclusive". Each
// drop also reports how many of its frontier tasks pass every repetition, with ceiling_warning set above one half.
//
// Per cell: trials planned (manifest), recorded, scored and excluded by termination, cap stops, the unstarted trial ids
// (manifest trials with no record: an incomplete run is reported from what exists and never errors for it), pass rate
// with interval, floor and ceiling task counts, USD over every recorded trial (excluded ones too, plus charged rows of
// earlier, interrupted attempts of a trial, of planned trials with no record, and rows logged after a trial's meter
// closed) and per pass (when the records carry usage.usd_reserved, records written from 2026-11-09, per pass leaves out
// the dollars the proxy charged at a full reservation because a request carried no usage, in the records and, with usage
// logs, in rows of earlier attempts or logged after a trial's meter closed, reported as cost.usd_reserved; each trial counts
// once, at the larger of its record's usd_reserved and its logged reservation rows,
// while USD total keeps them; a record without the field counts as it always did), USD by
// model (utility-model housekeeping shows here), tokens (with usage logs, tokens come from each trial's current attempt's
// forwarded harness rows and USD by model from every charged row, on the same attempt boundary as USD; a trial whose record
// shows spend but whose current attempt has no charged row falls back to its trials.jsonl usage), the cache-write share of spend (scripts/anatomy/cost-split.ts
// over the usage logs; null with the reason for a cell a refusal touches, a cell whose unsplit remainder passes 0.1% of its
// dollars, or a run with no log), wall time over scored trials,
// and world-MCP tool use: events with via "mcp" in each trial's events.jsonl, calls per trial and the share of trials
// with at least one call, over the trials whose event log was read (the denominator is printed).
//
// A spec that names a cell the manifest lacks, a primary family of the wrong size, a duplicate id, a dangling reference
// or a run_id other than the manifest's is refused (exit 2), and so is a trials.jsonl that scripts/validate-records.ts refuses: a malformed record, a duplicate trial id, a trial
// the manifest does not plan, or a cell or task that differs from the plan. A results directory with no manifest.json is
// refused (the sealed check and the unstarted list both read it), and so is a merged results directory whose shards.json
// names a shard with spend and no <shard>.proxy-usage.ndjson beside it (a usage log that did not come back from its VM; a shard
// whose trials all recorded $0 may have none, since the proxy creates the file on its first row, and reads as empty) or whose log has
// no row for a trial of that shard that recorded spend (a copy cut short while the shard ran), and a sealed run: this script prints task ids, so
// it reads the manifest first and opens nothing else of a sealed run. A line that is not JSON is HE-RUN-007 naming the file
// and line, never the parser's message; a cut-off line of a usage or event log (the last line, or a usage-log line the resumed proxy ran into) is skipped and counted instead.
//
// Spec: { "run_id": "...", "seed": 7, "draws": 10000, "alpha": 0.05, "primary_family_size": 6,
//         "h3_min_informative_tasks": 8, "smallest_difference": 0.1, "cells": [{ "id": "<cell id>", "label": "..." }],
//         "primary": [{ "id": "...", "a": "<cell id>", "b": "<cell id>" }], "secondary": [...same shape...],
//         "drops": [{ "id": "...", "frontier": "<cell id>", "cheap": "<cell id>" }],
//         "drop_differences": [{ "id": "...", "a": "<drop id>", "b": "<drop id>" }] }

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Termination, TrialRecord } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { clusteredPairedDelta, holmAdjusted, seededRandom } from '../runner/stats/paired.ts';
import { beyondRecords, costSplit, earlierAttempts, UNALLOCATED_TOLERANCE, type SplitTrial, type UsageRow } from './anatomy/cost-split.ts';
import { readJsonFile, readJsonLines } from '../runner/heldout/sealed.ts';
import { RunnerError } from '../runner/errors.ts';
import { trialDirFor } from '../runner/trial/run.ts';
import { NO_ROOM, noRoomReason, pairHeadroom, runCanTellApart } from '../runner/stats/headroom.ts';
import { headroomGated } from './headroom.ts';
import { TERMINATIONS, validateRecords } from './validate-records.ts';

export interface SpecComparison { id: string; a: string; b: string }
export interface SpecDrop { id: string; frontier: string; cheap: string }
export interface MatrixSpec {
  run_id: string;
  seed?: number;
  draws?: number;
  alpha?: number;
  primary_family_size: number;
  h3_min_informative_tasks?: number;
  /** The smallest difference, in pass-rate units, the preregistration named for its primary comparisons (its minimum
   *  detectable difference). The headroom gate refuses a "higher" call when the tasks left can't move the pass rate this far. */
  smallest_difference?: number;
  cells: Array<{ id: string; label?: string }>;
  primary: SpecComparison[];
  secondary?: SpecComparison[];
  drops?: SpecDrop[];
  drop_differences?: SpecComparison[];
}

export interface MatrixManifest { run_id: string; cells: Array<{ id: string; harness?: string; model?: string }>; trials: Array<{ id: string; cell: string; task?: string }>; sealed?: unknown }

export interface MatrixInput {
  manifest: MatrixManifest;
  records: TrialRecord[];
  /** The trial's world event log, null when none was found. */
  eventsOf: (t: TrialRecord) => WorldEvent[] | null;
  /** Every proxy usage row of the run, null when the results directory holds no usage log. */
  usageRows: UsageRow[] | null;
  /** Cut-off lines skipped in the usage logs and the event logs read so far (loadResults). */
  truncated?: { usage_logs: number; event_logs: number };
}

export { TERMINATIONS };
export const EXCLUDED: ReadonlySet<Termination> = new Set<Termination>(['model_error', 'infra_error', 'exam_fault']);
export const METHOD = "task-mean estimator (each task's mean pass over its scored repetitions, then the mean over tasks); task-clustered percentile bootstrap intervals (tasks resampled with replacement); paired differences and differences of differences from runner/stats/paired.ts clusteredPairedDelta with one item per task, p from its task-level sign-flip test; Holm across the primary family only";

export class SpecError extends Error {}

/** The minimum paired task clusters for an inferential comparison (methodology item 10). */
export const MIN_TESTED_TASKS = 10;
/** A planned trial with no record (the run was interrupted after it started paying) gets this started_at in the cost
 *  split, so every charged row under its key counts as an interrupted attempt instead of matching no trial. */
const UNRECORDED_START = '9999-12-31T23:59:59.999Z';

/** 1 pass, 0 fail, null excluded (model_error, infra_error, exam_fault). harness_error is a fail. */
export function trialValue(t: TrialRecord): 0 | 1 | null {
  if (EXCLUDED.has(t.termination)) return null;
  if (t.termination === 'harness_error') return 0;
  return t.grade === 'pass' && !t.consent_violation ? 1 : 0;
}

export function checkSpec(spec: MatrixSpec, manifest: MatrixManifest): string[] {
  const problems: string[] = [];
  if (spec.run_id !== manifest.run_id) problems.push(`spec run_id ${spec.run_id} is not the manifest's ${manifest.run_id}`);
  const cells = new Set<string>();
  for (const c of spec.cells ?? []) {
    if (cells.has(c.id)) problems.push(`cell ${c.id} listed twice`);
    cells.add(c.id);
    if (!manifest.cells.some((m) => m.id === c.id)) problems.push(`cell ${c.id} is not in the run's manifest`);
  }
  const ids = new Set<string>();
  const seen = (id: string) => { if (ids.has(id)) problems.push(`id ${id} used twice`); ids.add(id); };
  const pair = (kind: string, c: SpecComparison, known: Set<string>) => {
    seen(c.id);
    for (const side of [c.a, c.b]) if (!known.has(side)) problems.push(`${kind} ${c.id} names ${side}, which the spec does not define`);
    if (c.a === c.b) problems.push(`${kind} ${c.id} compares ${c.a} with itself`);
  };
  if (!Number.isSafeInteger(spec.primary_family_size) || spec.primary_family_size < 1) problems.push('primary_family_size must be a positive integer');
  else if ((spec.primary ?? []).length !== spec.primary_family_size) problems.push(`the primary family has ${(spec.primary ?? []).length} comparison(s); the spec preregisters ${spec.primary_family_size}`);
  for (const c of spec.primary ?? []) pair('primary comparison', c, cells);
  if (spec.smallest_difference !== undefined && !(Number.isFinite(spec.smallest_difference) && spec.smallest_difference > 0 && spec.smallest_difference <= 1)) problems.push('smallest_difference must be a pass-rate difference above 0 and at most 1 (0.1 is 10 points)');
  for (const c of spec.secondary ?? []) pair('secondary comparison', c, cells);
  const drops = new Set<string>();
  for (const d of spec.drops ?? []) {
    seen(d.id);
    drops.add(d.id);
    for (const side of [d.frontier, d.cheap]) if (!cells.has(side)) problems.push(`drop ${d.id} names ${side}, which the spec does not define`);
  }
  for (const c of spec.drop_differences ?? []) pair('drop difference', c, drops);
  if (spec.draws !== undefined && (!Number.isSafeInteger(spec.draws) || spec.draws < 1000)) problems.push('draws must be an integer of at least 1000');
  if (spec.alpha !== undefined && !(spec.alpha > 0 && spec.alpha < 1)) problems.push('alpha must be between 0 and 1');
  return problems;
}

type TaskMeans = Map<string, { mean: number; reps: number; passes: number }>;
type Interval = [number, number] | null;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const round = (x: number | null, d = 6) => (x === null ? null : Number(x.toFixed(d)));

function taskMeans(rows: TrialRecord[]): TaskMeans {
  const by = new Map<string, number[]>();
  for (const t of rows) {
    const v = trialValue(t);
    if (v === null) continue;
    by.set(t.task, [...(by.get(t.task) ?? []), v]);
  }
  return new Map([...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([task, vs]) => [task, { mean: sum(vs) / vs.length, reps: vs.length, passes: sum(vs) }]));
}

/** Mean of the task means with a task-clustered percentile bootstrap interval (null with fewer than two tasks). */
function meanInterval(values: number[], seed: number, draws: number): { estimate: number; ci95: Interval } | null {
  if (!values.length) return null;
  const estimate = sum(values) / values.length;
  if (values.length < 2) return { estimate, ci95: null };
  const rnd = seededRandom(seed);
  const boot = new Array<number>(draws);
  for (let i = 0; i < draws; i++) {
    let s = 0;
    for (let j = 0; j < values.length; j++) s += values[Math.floor(rnd() * values.length)]!;
    boot[i] = s / values.length;
  }
  boot.sort((a, b) => a - b);
  return { estimate, ci95: [boot[Math.floor(draws * 0.025)]!, boot[Math.ceil(draws * 0.975) - 1]!] };
}

interface PairedResult { tasks: number; mean_a: number; mean_b: number; delta: number; ci95: Interval; p_two_sided: number; p_method: string }

/** B minus A over per-task values, task-clustered. */
function pairedTasks(items: Array<{ task: string; a: number; b: number }>, seed: number, draws: number): PairedResult | null {
  if (!items.length) return null;
  const d = clusteredPairedDelta(items.map((i) => ({ id: i.task, cluster: i.task, a: i.a, b: i.b })), { seed, draws });
  return { tasks: d.n_pairs, mean_a: d.mean_a, mean_b: d.mean_b, delta: d.delta, ci95: d.ci95, p_two_sided: d.p_two_sided, p_method: d.p_method };
}

/** Holm across exactly the given p-values; step is the position in the step-down order (1 = smallest p). */
export function holmFamily(pValues: number[], alpha: number): Array<{ holm_p: number; step: number; threshold: number; rejected: boolean }> {
  const adjusted = holmAdjusted(pValues);
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p || x.i - y.i);
  const step = new Array<number>(pValues.length);
  order.forEach(({ i }, k) => { step[i] = k + 1; });
  return pValues.map((_p, i) => ({ holm_p: adjusted[i]!, step: step[i]!, threshold: alpha / (pValues.length - step[i]! + 1), rejected: adjusted[i]! <= alpha }));
}

export function analyzeMatrix(input: MatrixInput, spec: MatrixSpec) {
  const problems = checkSpec(spec, input.manifest);
  if (problems.length) throw new SpecError(problems.join('; '));
  const recordProblems = validateRecords(input.records, input.manifest);
  if (recordProblems.length) throw new SpecError(`trials.jsonl disagrees with the manifest: ${recordProblems.slice(0, 10).join('; ')}${recordProblems.length > 10 ? '; ...' : ''}`);
  const seed = spec.seed ?? 7, draws = spec.draws ?? 10_000, alpha = spec.alpha ?? 0.05, minInformative = spec.h3_min_informative_tasks ?? 8;
  const specCells = new Set(spec.cells.map((c) => c.id));
  const recordsOf = new Map<string, TrialRecord[]>();
  for (const t of input.records) if (specCells.has(t.cell)) recordsOf.set(t.cell, [...(recordsOf.get(t.cell) ?? []), t]);
  const recorded = new Set(input.records.map((t) => t.trial_id));
  const reservedSplit = input.records.some((t) => t.usage?.usd_reserved !== undefined);
  const plannedOf = (cell: string) => input.manifest.trials.filter((t) => t.cell === cell);
  const means = new Map(spec.cells.map((c) => [c.id, taskMeans(recordsOf.get(c.id) ?? [])]));
  const taskUniverse = (cell: string) => new Set([...plannedOf(cell).map((t) => t.task ?? t.id.split('/')[2] ?? ''), ...(recordsOf.get(cell) ?? []).map((t) => t.task)].filter(Boolean));

  let split: ReturnType<typeof costSplit> | null = null;
  const unrecorded = input.manifest.trials.filter((t) => !recorded.has(t.id)).map((t) => ({ trial_id: t.id, cell: t.cell, started_at: UNRECORDED_START }));
  const splitTrials: Array<SplitTrial & { cell: string }> = [...input.records, ...unrecorded];
  const earlier = input.usageRows ? earlierAttempts(input.usageRows, splitTrials) : null;
  const beyond = input.usageRows ? beyondRecords(input.usageRows, input.records) : null;
  // With usage logs, a trial takes its tokens and USD by model from them, on the same attempt boundary as USD: tokens from
  // the current attempt's forwarded harness rows (no /v1/embeddings), USD by model from every charged row. Only a trial
  // whose record shows spend (usage.usd > 0) but whose current attempt has no charged row in the logs (a shard whose log
  // was not copied, a cut-off log) takes its tokens and current-attempt USD by model from its trials.jsonl usage; its
  // earlier-attempt rows still count. A resumed trial refused at the cap keeps 0 tokens, not the interrupted attempt's.
  const owner = new Map<string, { trial: string; cell: string; start: number | null }>();
  for (const t of splitTrials) {
    const o = { trial: t.trial_id, cell: t.cell, start: t.started_at ? Date.parse(t.started_at) : null };
    for (const id of [t.usage?.meter_id, `trial-token:${t.trial_id}`, `sk-trial-${t.trial_id}`]) if (id) owner.set(id, o);
  }
  const currentRows = new Map<string, UsageRow[]>();
  const chargedNow = new Set<string>();
  const rowUsdByModel = new Map<string, Record<string, number>>();
  const loggedReserve = new Map<string, { cell: string; usd: number }>();
  for (const r of input.usageRows ?? []) {
    const o = owner.get(r.key);
    if (!o) continue;
    if (r.charged_reservation === true) loggedReserve.set(o.trial, { cell: o.cell, usd: (loggedReserve.get(o.trial)?.usd ?? 0) + (r.actual_usd ?? 0) });
    const current = o.start === null || Date.parse(r.at) >= o.start;
    if (current && (r.actual_usd ?? 0) > 0) chargedNow.add(o.trial);
    if ((r.actual_usd ?? 0) > 0) {
      const m = rowUsdByModel.get(o.cell) ?? {};
      const model = r.provider ? `${r.provider}:${r.model ?? 'unknown'}` : r.model ?? 'unknown';
      m[model] = (m[model] ?? 0) + r.actual_usd!;
      rowUsdByModel.set(o.cell, m);
    }
    if (r.outcome === 'forwarded' && r.route !== '/v1/embeddings' && current) currentRows.set(o.trial, [...(currentRows.get(o.trial) ?? []), r]);
  }
  const fromRecord = (t: TrialRecord) => !input.usageRows || ((t.usage?.usd ?? 0) > 0 && !chargedNow.has(t.trial_id));
  let splitNote: string | null = null;
  if (!input.usageRows) splitNote = 'no proxy usage log in the results directory';
  else {
    try {
      split = costSplit(input.usageRows, splitTrials);
      if (split.refusals.length) splitNote = `cost split refused: ${split.refusals.join('; ')}`;
    } catch (e) { splitNote = `cost split failed: ${(e as Error).message}`; }
  }
  const shareNote = (cell: string): string | null => {
    if (!split) return splitNote;
    if (split.unattributed_refusal) return 'a charged usage row matches no trial, so no cell can be cleared';
    if (split.refused_cells.includes(cell)) return 'a trial of this cell does not reconcile with its charged rows';
    if ((split.unallocated_share[cell] ?? 0) > UNALLOCATED_TOLERANCE) return `${((split.unallocated_share[cell] ?? 0) * 100).toFixed(1)}% of this cell's charged dollars could not be split into components`;
    return null;
  };

  const cells = spec.cells.map((c) => {
    const rows = recordsOf.get(c.id) ?? [];
    const m = means.get(c.id)!;
    const planned = plannedOf(c.id);
    const manifestCell = input.manifest.cells.find((x) => x.id === c.id);
    const scored = rows.filter((t) => trialValue(t) !== null);
    const terminations = Object.fromEntries(TERMINATIONS.map((k) => [k, rows.filter((t) => t.termination === k).length])) as Record<Termination, number>;
    const passes = scored.filter((t) => trialValue(t) === 1).length;
    const usdRecorded = sum(rows.map((t) => t.usage?.usd ?? 0));
    const usdEarlier = earlier ? earlier.by_cell[c.id]?.usd ?? 0 : null;
    const usdBeyond = beyond ? beyond[c.id] ?? 0 : null;
    const usdTotal = usdRecorded + (usdEarlier ?? 0) + (usdBeyond ?? 0);
    const recordReserve = new Map(rows.map((t) => [t.trial_id, t.usage?.usd_reserved ?? 0]));
    const reserveTrials = new Set([...recordReserve.keys(), ...[...loggedReserve].filter(([, v]) => v.cell === c.id).map(([trial]) => trial)]);
    const usdReserved = sum([...reserveTrials].map((trial) => Math.max(recordReserve.get(trial) ?? 0, loggedReserve.get(trial)?.usd ?? 0)));
    const modelUsd: Record<string, number> = { ...rowUsdByModel.get(c.id) };
    for (const t of rows.filter(fromRecord)) for (const [model, v] of Object.entries(t.usage?.by_model ?? {})) modelUsd[model] = (modelUsd[model] ?? 0) + v.usd;
    const byModel = Object.fromEntries(Object.entries(modelUsd).map(([model, usd]) => [model, round(usd)!]));
    const rate = meanInterval([...m.values()].map((x) => x.mean), seed, draws);
    const reps = [...m.values()].map((x) => x.reps);
    let eventLogs = 0, calls = 0, withCall = 0;
    for (const t of rows) {
      const events = input.eventsOf(t);
      if (!events) continue;
      eventLogs++;
      const n = events.filter((e) => e.via === 'mcp').length;
      calls += n;
      if (n > 0) withCall++;
    }
    const cacheNote = shareNote(c.id);
    const sc = cacheNote === null ? split?.cells[c.id] : undefined;
    const splitTotal = sc ? sc.uncached_input_usd + sc.cache_read_usd + sc.cache_write_usd + sc.output_usd + sc.embedding_usd : 0;
    const tokens = (k: 'input_tokens' | 'output_tokens' | 'cached_tokens') => sum(rows.map((t) => (fromRecord(t) ? t.usage?.[k] ?? 0 : sum((currentRows.get(t.trial_id) ?? []).map((r) => r[k] ?? 0)))));
    return {
      id: c.id, label: c.label ?? c.id, harness: manifestCell?.harness ?? rows[0]?.harness ?? null, model: manifestCell?.model ?? rows[0]?.model ?? null,
      trials: {
        planned: planned.length, recorded: rows.length, scored: scored.length,
        excluded: { model_error: terminations.model_error, infra_error: terminations.infra_error, exam_fault: terminations.exam_fault },
        harness_error_as_fail: terminations.harness_error, cap_stop: rows.filter((t) => t.cap_stop).length,
        unstarted: planned.filter((t) => !recorded.has(t.id)).map((t) => t.id),
      },
      terminations,
      pass_rate: rate ? { estimate: round(rate.estimate), ci95: rate.ci95 ? [round(rate.ci95[0])!, round(rate.ci95[1])!] as [number, number] : null, tasks: m.size, scored_trials: scored.length, passes } : null,
      reps_per_task: reps.length ? { min: Math.min(...reps), max: Math.max(...reps) } : null,
      floor_tasks: [...m.values()].filter((x) => x.mean === 0).length,
      ceiling_tasks: [...m.values()].filter((x) => x.mean === 1).length,
      cost: { usd_total: round(usdTotal), usd_recorded_trials: round(usdRecorded), usd_earlier_attempts: usdEarlier === null ? null : round(usdEarlier), usd_rows_beyond_records: usdBeyond === null ? null : round(usdBeyond),
        usd_per_recorded_trial: rows.length ? round(usdRecorded / rows.length) : null, passes, usd_per_pass: passes ? round((reservedSplit ? Math.max(usdTotal - usdReserved, 0) : usdTotal) / passes) : null,
        ...(reservedSplit ? { usd_reserved: round(usdReserved) } : {}), usd_by_model: byModel },
      tokens: { input: tokens('input_tokens'), output: tokens('output_tokens'), cache_read: tokens('cached_tokens'),
        per_recorded_trial: rows.length ? { input: Math.round(tokens('input_tokens') / rows.length), output: Math.round(tokens('output_tokens') / rows.length), cache_read: Math.round(tokens('cached_tokens') / rows.length) } : null },
      cache_write_share: sc && splitTotal > 0 ? round(sc.cache_write_usd / splitTotal, 4) : null,
      cache_write_share_note: cacheNote,
      wall_ms: { median: median(scored.map((t) => t.wall_ms)), mean: scored.length ? Math.round(sum(scored.map((t) => t.wall_ms)) / scored.length) : null },
      world_mcp: { trials: rows.length, trials_with_event_log: eventLogs, calls, calls_per_trial: eventLogs ? round(calls / eventLogs, 3) : null, trials_with_call: withCall, share_with_call: eventLogs ? round(withCall / eventLogs, 4) : null },
    };
  });

  const runSet = runCanTellApart(spec.cells.map((c) => new Map([...means.get(c.id)!].map(([task, x]) => [task, x.mean]))));
  const compare = (c: SpecComparison) => {
    const A = means.get(c.a)!, B = means.get(c.b)!;
    const universe = [...new Set([...taskUniverse(c.a), ...taskUniverse(c.b), ...A.keys(), ...B.keys()])].sort();
    const dropped = universe.filter((task) => !A.has(task) || !B.has(task)).map((task) => ({ task, reason: !A.has(task) && !B.has(task) ? 'no scored trial in either cell' : !A.has(task) ? `no scored trial in ${c.a}` : `no scored trial in ${c.b}` }));
    const items = universe.filter((task) => A.has(task) && B.has(task)).map((task) => ({ task, a: A.get(task)!.mean, b: B.get(task)!.mean }));
    return { r: pairedTasks(items, seed, draws), dropped, headroom: pairHeadroom(items.map((i) => ({ cluster: i.task, a: i.a, b: i.b })), runSet) };
  };
  const fmt = (r: PairedResult | null) => r ? { tasks_paired: r.tasks, mean_a: round(r.mean_a), mean_b: round(r.mean_b), delta: round(r.delta), ci95: r.ci95 ? [round(r.ci95[0])!, round(r.ci95[1])!] as [number, number] : null } : { tasks_paired: 0, mean_a: null, mean_b: null, delta: null, ci95: null };

  const primaryRaw = spec.primary.map((c) => ({ c, ...compare(c) }));
  const tested = (r: PairedResult | null) => r !== null && r.tasks >= MIN_TESTED_TASKS;
  const holm = holmFamily(primaryRaw.map((x) => (tested(x.r) ? x.r!.p_two_sided : 1)), alpha);
  const gated = headroomGated(spec);
  const primary = primaryRaw.map(({ c, r, dropped, headroom }, i) => {
    const h = holm[i]!;
    const call = h.rejected && r && tested(r) ? (r.delta > 0 ? `${c.b} higher` : `${c.a} higher`) : "can't tell apart";
    const refused = gated && headroom && r && call !== "can't tell apart"
      ? noRoomReason(headroom, { room: r.delta > 0 ? headroom.room_above_a : headroom.room_above_b, smallest_difference: spec.smallest_difference ?? 0, min_tasks: MIN_TESTED_TASKS })
      : null;
    const verdict = refused ? NO_ROOM : call;
    return { id: c.id, family: 'primary' as const, a: c.a, b: c.b, ...fmt(r), tasks_dropped: dropped.length, dropped, p_two_sided: r ? round(r.p_two_sided, 8) : null, p_method: r?.p_method ?? 'no paired task (counted as p = 1 in the family)',
      tested: tested(r), untested_reason: tested(r) ? null : `fewer than ${MIN_TESTED_TASKS} paired tasks: descriptive only, counted as p = 1 in the family (methodology item 10)`,
      holm_step: h.step, holm_threshold: round(h.threshold, 8), holm_p: round(h.holm_p, 8), verdict,
      ...(gated ? { headroom: headroom && { ...headroom, room_above_a: round(headroom.room_above_a)!, room_below_a: round(headroom.room_below_a)!, room_above_b: round(headroom.room_above_b)! }, no_room_reason: refused } : {}) };
  });
  const secondary = (spec.secondary ?? []).map((c) => { const { r, dropped } = compare(c); return { id: c.id, family: 'secondary' as const, a: c.a, b: c.b, ...fmt(r), tasks_dropped: dropped.length, dropped, label: 'secondary, no Holm, no test' }; });

  const extreme = (x: number) => x === 0 || x === 1;
  const dropTasks = (d: SpecDrop) => {
    const F = means.get(d.frontier)!, C = means.get(d.cheap)!;
    return new Map([...F.keys()].filter((t) => C.has(t)).map((t) => [t, { f: F.get(t)!.mean, c: C.get(t)!.mean }]));
  };
  const informative = (v: { f: number; c: number }) => !(extreme(v.f) && v.f === v.c);
  const drops = (spec.drops ?? []).map((d) => {
    const tasks = dropTasks(d);
    const universe = [...new Set([...taskUniverse(d.frontier), ...taskUniverse(d.cheap), ...means.get(d.frontier)!.keys(), ...means.get(d.cheap)!.keys()])];
    const all = [...tasks.entries()].map(([task, v]) => ({ task, a: v.c, b: v.f }));
    const inf = [...tasks.entries()].filter(([, v]) => informative(v)).map(([task, v]) => ({ task, a: v.c, b: v.f }));
    const F = means.get(d.frontier)!;
    const frontierCeiling = [...F.values()].filter((x) => x.mean === 1).length;
    const cheap = cells.find((x) => x.id === d.cheap)!;
    return { id: d.id, frontier: d.frontier, cheap: d.cheap, label: 'secondary, frontier minus cheap',
      all_tasks: fmt(pairedTasks(all, seed, draws)), informative_tasks: fmt(pairedTasks(inf, seed, draws)), tasks_dropped: universe.length - tasks.size,
      frontier_ceiling_tasks: frontierCeiling, frontier_tasks: F.size, frontier_ceiling_share: F.size ? round(frontierCeiling / F.size, 4) : null, ceiling_warning: F.size > 0 && frontierCeiling / F.size > 0.5,
      cheap_pass_rate: cheap.pass_rate, cheap_usd_per_pass: cheap.cost.usd_per_pass };
  });
  const dropById = new Map((spec.drops ?? []).map((d) => [d.id, d]));
  const dropDifferences = (spec.drop_differences ?? []).map((c) => {
    const A = dropTasks(dropById.get(c.a)!), B = dropTasks(dropById.get(c.b)!);
    const common = [...A.keys()].filter((t) => B.has(t)).sort();
    const item = (t: string) => ({ task: t, a: B.get(t)!.f - B.get(t)!.c, b: A.get(t)!.f - A.get(t)!.c });
    const inf = common.filter((t) => informative(A.get(t)!) && informative(B.get(t)!));
    const status = inf.length < minInformative ? 'inconclusive' : 'estimated';
    return { id: c.id, a: c.a, b: c.b, label: 'secondary (H3), drop a minus drop b', tasks_in_all_four_cells: common.length, informative_tasks: inf.length, min_informative_tasks: minInformative, status,
      reason: status === 'inconclusive' ? `${inf.length} informative task(s), fewer than ${minInformative}` : null,
      all_tasks: fmt(pairedTasks(common.map(item), seed, draws)), informative: fmt(pairedTasks(inf.map(item), seed, draws)) };
  });

  const unstarted = Object.fromEntries(cells.filter((c) => c.trials.unstarted.length).map((c) => [c.id, c.trials.unstarted]));
  return {
    schema: 'matrix-analysis/v1', run_id: spec.run_id,
    complete: input.manifest.trials.every((t) => recorded.has(t.id)) && !input.records.some((t) => t.cap_stop),
    trials_planned: input.manifest.trials.length, trials_recorded: input.records.length,
    trials_unstarted: input.manifest.trials.filter((t) => !recorded.has(t.id)).length,
    method: { estimator: METHOD, seed, draws, alpha, interval: 'percentile 95% interval over task resamples' },
    faults: { scored_as_fail: ['harness_error'], excluded_with_counts: [...EXCLUDED], pass: 'grade pass with no consent violation' },
    cells,
    primary: { holm_family_size: spec.primary_family_size, alpha, comparisons: primary },
    ...(gated ? { headroom_gate: { min_tasks: MIN_TESTED_TASKS, smallest_difference: spec.smallest_difference ?? null } } : {}),
    secondary,
    drops,
    drop_differences: dropDifferences,
    unstarted,
    cost_split: { status: split && !split.refusals.length ? 'reconciled' : split ? 'refused' : 'unavailable', note: splitNote, usd_total: split?.usd_total ?? null, earlier_attempts: earlier, refused_cells: split?.refused_cells ?? null, unallocated_share: split?.unallocated_share ?? null },
    cells_not_in_spec: [...new Set(input.records.map((t) => t.cell))].filter((c) => !specCells.has(c)).sort(),
    truncated_log_lines: { usage_logs: input.truncated?.usage_logs ?? 0, event_logs: input.truncated?.event_logs ?? 0 },
  };
}

export type MatrixAnalysis = ReturnType<typeof analyzeMatrix>;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pts = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);
const ciPts = (c: [number, number] | null | undefined) => (c ? `[${pts(c[0])}, ${pts(c[1])}]` : '[no interval]');
const ciPct = (c: [number, number] | null | undefined) => (c ? `[${pct(c[0])}, ${pct(c[1])}]` : '[no interval]');
const usd = (x: number | null) => (x === null ? 'n/a' : `$${x.toFixed(4)}`);

export function renderMarkdown(a: MatrixAnalysis): string {
  const out: string[] = [`# Matrix analysis: ${a.run_id}`, ''];
  out.push(!a.complete
    ? `**Incomplete run.** ${a.trials_recorded} of ${a.trials_planned} planned trials recorded; ${a.trials_unstarted} never started (listed below). Reported from what exists; nothing was backfilled.`
    : `Complete run: ${a.trials_recorded} of ${a.trials_planned} planned trials recorded.`);
  out.push('', `Method: ${a.method.estimator}. Seed ${a.method.seed}, ${a.method.draws} draws, alpha ${a.method.alpha}. Faults: harness_error counts as a fail; model_error, infra_error and exam_fault are excluded and counted. Differences are B minus A in percentage points. No ranks: rows follow the preregistered spec.`, '');
  out.push('## Cells', '', '| Cell | Pass rate (task mean) [95% CI] | Tasks / scored trials | Reps per task | Floor / ceiling tasks | Excluded (model / infra / exam) | Harness errors (fail) | Unstarted | USD total | USD per pass | Tokens per trial (in / out / cache read) | Cache-write share | Wall median (s) | World-MCP calls per trial | Trials with a world-MCP call |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of a.cells) {
    const t = c.tokens.per_recorded_trial;
    const reps = c.reps_per_task ? (c.reps_per_task.min === c.reps_per_task.max ? `${c.reps_per_task.min}` : `${c.reps_per_task.min} to ${c.reps_per_task.max}`) : 'n/a';
    out.push(`| ${c.label} | ${c.pass_rate ? `${pct(c.pass_rate.estimate)} ${ciPct(c.pass_rate.ci95)}` : 'n/a'} | ${c.pass_rate?.tasks ?? 0} / ${c.trials.scored} | ${reps} | ${c.floor_tasks} / ${c.ceiling_tasks} | ${c.trials.excluded.model_error} / ${c.trials.excluded.infra_error} / ${c.trials.excluded.exam_fault} | ${c.trials.harness_error_as_fail} | ${c.trials.unstarted.length} | ${usd(c.cost.usd_total)}${c.cost.usd_earlier_attempts ? ` (incl. ${usd(c.cost.usd_earlier_attempts)} from interrupted attempts and unrecorded trials)` : ''}${c.cost.usd_rows_beyond_records ? ` (incl. ${usd(c.cost.usd_rows_beyond_records)} logged after a trial's meter closed)` : ''}${c.cost.usd_reserved === undefined ? '' : ` (incl. ${usd(c.cost.usd_reserved)} charged at reservation)`} | ${c.cost.usd_per_pass === null ? 'no passes' : usd(c.cost.usd_per_pass)} | ${t ? `${t.input} / ${t.output} / ${t.cache_read}` : 'n/a'} | ${pct(c.cache_write_share)} | ${c.wall_ms.median === null ? 'n/a' : (c.wall_ms.median / 1000).toFixed(1)} | ${c.world_mcp.calls_per_trial ?? 'n/a'} (${c.world_mcp.trials_with_event_log} logs) | ${c.world_mcp.trials_with_call} of ${c.world_mcp.trials_with_event_log} (${pct(c.world_mcp.share_with_call)}) |`);
  }
  out.push('', `Cache-write share: from scripts/anatomy/cost-split.ts over the run's proxy usage logs (split ${a.cost_split.status}${a.cost_split.note ? `: ${a.cost_split.note}` : ''}). USD total counts every recorded trial, excluded ones included, ${a.cost_split.earlier_attempts ? 'plus charged rows from earlier, interrupted attempts of a trial, from planned trials with no record, and logged after a trial\'s meter closed' : 'but not earlier, interrupted attempts, because the results directory has no proxy usage log'}; USD per pass divides it by scored passes${a.cells.some((c) => c.cost.usd_reserved !== undefined) ? ', after taking out the dollars the proxy charged at a full reservation because a request carried no usage (usage.usd_reserved), which stay in USD total' : ''}.`);
  for (const c of a.cells.filter((x) => x.cache_write_share_note)) out.push(`- ${c.label}: cache-write share not published: ${c.cache_write_share_note}.`);
  if (a.truncated_log_lines.usage_logs || a.truncated_log_lines.event_logs) out.push('', `Cut-off log lines skipped: ${a.truncated_log_lines.usage_logs} in usage logs, ${a.truncated_log_lines.event_logs} in event logs.${a.truncated_log_lines.usage_logs ? ' A cut-off usage line may have held a charged row, so earlier-attempt USD is a lower bound.' : ''}`);
  out.push('', `## Primary comparisons (Holm across ${a.primary.holm_family_size})`, '', '| Comparison | A | B | A / B task mean | B minus A [95% CI] | Tasks paired | Tasks dropped | p (sign-flip) | Holm step | Holm p | Verdict |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of a.primary.comparisons) out.push(`| ${c.id} | ${c.a} | ${c.b} | ${pct(c.mean_a)} / ${pct(c.mean_b)} | ${pts(c.delta)} ${ciPts(c.ci95)} | ${c.tasks_paired} | ${c.tasks_dropped} | ${c.p_two_sided ?? 'n/a'} | ${c.holm_step} | ${c.holm_p} | ${c.verdict}${c.tested ? '' : ` (untested: fewer than ${MIN_TESTED_TASKS} paired tasks)`} |`);
  if (a.headroom_gate) {
    const g = a.headroom_gate;
    out.push('', '### Headroom of each primary comparison', '', `A task the run can tell apart is one that not every cell of the spec passed on every try, and not every cell failed on every try. A "higher" call needs at least ${g.min_tasks} such tasks among A's and B's paired tasks, ${g.smallest_difference === null ? 'and the spec names no smallest difference, so only that count was checked' : `and room on them for the ${pts(g.smallest_difference).replace('+', '')}-point smallest difference the preregistration named`}. Otherwise it reads "${NO_ROOM}". The gate runs after Holm, so no other comparison changes. Room is the most those tasks could move the pass rate, holding the losing arm at its results.`, '', '| Comparison | Paired tasks the run can tell apart | A and B both passed every try | A and B both failed every try | Room for B above A | Room for A above B | Gate |', '|---|---|---|---|---|---|---|');
    for (const c of a.primary.comparisons) out.push(c.headroom ? `| ${c.id} | ${c.headroom.run_can_tell_apart} of ${c.headroom.tasks} | ${c.headroom.both_passed} | ${c.headroom.both_failed} | ${pts(c.headroom.room_above_a)} | ${pts(c.headroom.room_above_b)} | ${c.no_room_reason ?? 'ok'} |` : `| ${c.id} | no paired task | | | | | |`);
  }
  if (a.secondary.length) {
    out.push('', '## Secondary comparisons (no Holm, no test)', '', '| Comparison | A | B | A / B task mean | B minus A [95% CI] | Tasks paired | Tasks dropped | Label |', '|---|---|---|---|---|---|---|---|');
    for (const c of a.secondary) out.push(`| ${c.id} | ${c.a} | ${c.b} | ${pct(c.mean_a)} / ${pct(c.mean_b)} | ${pts(c.delta)} ${ciPts(c.ci95)} | ${c.tasks_paired} | ${c.tasks_dropped} | ${c.label} |`);
  }
  if (a.drops.length) {
    out.push('', '## Frontier-to-cheap drops (secondary)', '', '| Drop | Frontier | Cheap | Drop, all tasks [95% CI] (tasks) | Drop, informative tasks [95% CI] (tasks) | Tasks dropped | Frontier tasks passing every rep | Cheap pass rate [95% CI] | Cheap USD per pass |', '|---|---|---|---|---|---|---|---|---|');
    for (const d of a.drops) out.push(`| ${d.id} | ${d.frontier} | ${d.cheap} | ${pts(d.all_tasks.delta)} ${ciPts(d.all_tasks.ci95)} (${d.all_tasks.tasks_paired}) | ${pts(d.informative_tasks.delta)} ${ciPts(d.informative_tasks.ci95)} (${d.informative_tasks.tasks_paired}) | ${d.tasks_dropped} | ${d.frontier_ceiling_tasks} of ${d.frontier_tasks}${d.ceiling_warning ? ' (over half: no "gets the most out of a cheap model" claim)' : ''} | ${d.cheap_pass_rate ? `${pct(d.cheap_pass_rate.estimate)} ${ciPct(d.cheap_pass_rate.ci95)}` : 'n/a'} | ${d.cheap_usd_per_pass === null ? 'no passes' : usd(d.cheap_usd_per_pass)} |`);
  }
  if (a.drop_differences.length) {
    out.push('', '## Difference of drops (H3, secondary)', '', '| Comparison | Drop A | Drop B | A minus B, all tasks [95% CI] (tasks) | A minus B, informative tasks [95% CI] (tasks) | Status |', '|---|---|---|---|---|---|');
    for (const d of a.drop_differences) out.push(`| ${d.id} | ${d.a} | ${d.b} | ${pts(d.all_tasks.delta)} ${ciPts(d.all_tasks.ci95)} (${d.all_tasks.tasks_paired}) | ${pts(d.informative.delta)} ${ciPts(d.informative.ci95)} (${d.informative.tasks_paired}) | ${d.status}${d.reason ? `: ${d.reason}` : ''} |`);
  }
  out.push('', '## Terminations per cell', '', `| Cell | ${TERMINATIONS.join(' | ')} | Cap stops | USD by model |`, `|---|${TERMINATIONS.map(() => '---|').join('')}---|---|`);
  for (const c of a.cells) out.push(`| ${c.label} | ${TERMINATIONS.map((k) => c.terminations[k]).join(' | ')} | ${c.trials.cap_stop} | ${Object.entries(c.cost.usd_by_model).map(([m, v]) => `${m} ${usd(v)}`).join(', ') || 'none'} |`);
  const dropped = [...a.primary.comparisons, ...a.secondary].filter((c) => c.dropped.length);
  if (dropped.length) {
    out.push('', '## Tasks dropped from comparisons', '');
    for (const c of dropped) out.push(`- ${c.id}: ${c.dropped.map((d) => `${d.task} (${d.reason})`).join('; ')}`);
  }
  if (Object.keys(a.unstarted).length) {
    out.push('', '## Unstarted trials', '');
    for (const [cell, ids] of Object.entries(a.unstarted)) out.push(`- ${cell} (${ids.length}): ${ids.join(', ')}`);
  }
  return out.join('\n') + '\n';
}

/** A log a process may have been killed in the middle of writing: an unparseable last line is skipped and counted. A usage
 *  log (appended) is appended to again on --resume, so a cut-off line can also run into the next process's rows: every
 *  whole row on the line is kept and each cut-off fragment is skipped and counted. Any other bad line is HE-RUN-007 naming
 *  the file and line only, never the parser's message (it quotes the input). */
function readLog<T>(file: string, counts: { truncated: number }, appended: boolean): T[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const last = lines.findLastIndex((l) => l.length > 0);
  return lines.flatMap((l, i) => {
    if (!l) return [];
    try { return [JSON.parse(l) as T]; } catch (e) {
      const rows: T[] = [];
      let fragments = 0;
      for (let p = appended ? 0 : l.length; p < l.length;) {
        let end = -1;
        for (let q = l.indexOf('}', p); q >= 0 && end < 0; q = l.indexOf('}', q + 1)) {
          try { rows.push(JSON.parse(l.slice(p, q + 1)) as T); end = q + 1; } catch { /* the row ends at a later brace */ }
        }
        if (end >= 0) { p = end; continue; }
        fragments += 1;
        p = l.indexOf('{', p + 1);
        if (p < 0) break;
      }
      if (rows.length) { counts.truncated += fragments; return rows; }
      if (i === last) { counts.truncated += 1; return []; }
      throw new RunnerError('HE-RUN-007', `${file} line ${i + 1} is not JSON (${e instanceof Error ? e.name : 'error'}); the parser's message is withheld, since it quotes the input`);
    }
  });
}

/** Read a results directory after its manifest: records (strict), event logs and usage logs (a cut-off line skipped and
 *  counted in input.truncated). A merged directory (shards.json present) needs the usage log of every listed shard with spend,
 *  holding a row for every trial of that shard whose record shows spend; a $0 shard's missing log reads as empty. No trials.jsonl reads as no records. Two usage logs that share a row (a copy, whole or cut
 *  off) are refused: rows are per-trial and timestamped, so a row in two logs is a copy, and identical rows within one log
 *  are counted as separate requests. */
export function loadResults(results: string, manifest: MatrixManifest): MatrixInput {
  const truncated = { usage_logs: { truncated: 0 }, event_logs: { truncated: 0 } };
  const records = existsSync(join(results, 'trials.jsonl')) ? readJsonLines<TrialRecord>(join(results, 'trials.jsonl')) : [];
  const logs = readdirSync(results).filter((f) => /(^|[.])proxy-usage[.]ndjson$/.test(f)).sort();
  const eventsOf = (t: TrialRecord): WorldEvent[] | null => {
    const inside = (p: string) => existsSync(p) && realpathSync(p).startsWith(realpathSync(results) + sep);
    const found = [join(trialDirFor(results, { id: t.trial_id } as Parameters<typeof trialDirFor>[1]), 'events.jsonl'), t.paths?.events ?? ''].find((p) => p && inside(p) && existsSync(p));
    return found ? readLog<WorldEvent>(found, truncated.event_logs, false) : null;
  };
  const parsed = logs.map((f) => readLog<UsageRow>(join(results, f), truncated.usage_logs, true));
  const seenIn = new Map<string, string>();
  logs.forEach((f, i) => {
    const rows = new Set(parsed[i]!.map((r) => JSON.stringify(r)));
    for (const r of rows) if (seenIn.has(r)) throw new RunnerError('HE-RUN-007', `${join(results, f)} shares rows with ${join(results, seenIn.get(r)!)}; a copied usage log would count its requests twice, so remove the copy`);
    for (const r of rows) seenIn.set(r, f);
  });
  if (existsSync(join(results, 'shards.json'))) {
    const { cells = {}, shards = {} } = readJsonFile<{ cells?: Record<string, string>; shards?: Record<string, unknown> }>(join(results, 'shards.json'));
    const lost = Object.keys(shards).filter((s) => !logs.includes(`${s}.proxy-usage.ndjson`) && records.some((t) => cells[t.cell] === s && (t.usage?.usd ?? 0) > 0));
    if (lost.length) throw new SpecError(`shards.json lists ${lost.length} shard(s) with spend whose proxy usage log is not in ${results}: ${lost.map((s) => `${s}.proxy-usage.ndjson`).join(', ')}; without it every USD figure of that shard's cells is a silent lower bound, so copy the shard's proxy-usage.ndjson back and merge again`);
    const keysIn = new Map(logs.map((f, i) => [f, new Set(parsed[i]!.map((r) => r.key))]));
    const unmetered = records.filter((t) => (t.usage?.usd ?? 0) > 0 && cells[t.cell] && ![t.usage?.meter_id, `trial-token:${t.trial_id}`, `sk-trial-${t.trial_id}`].some((k) => k && keysIn.get(`${cells[t.cell]}.proxy-usage.ndjson`)?.has(k)));
    if (unmetered.length) throw new SpecError(`${unmetered.length} trial(s) with spend have no row in their shard's proxy usage log, so the log that came back is cut short (a copy taken while the shard ran): ${unmetered.slice(0, 5).map((t) => `${t.trial_id} (shard ${cells[t.cell]})`).join(', ')}${unmetered.length > 5 ? ', ...' : ''}; copy the shard's final proxy-usage.ndjson back and merge again`);
  }
  const usageRows = logs.length ? parsed.flat() : null;
  return { manifest, records, eventsOf, usageRows, truncated: { get usage_logs() { return truncated.usage_logs.truncated; }, get event_logs() { return truncated.event_logs.truncated; } } };
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const results = arg('results'), specPath = arg('spec'), out = arg('out') ?? results;
  if (!results || !specPath || !existsSync(join(results, 'manifest.json')) || !existsSync(specPath)) {
    console.error('usage: bun scripts/matrix-analysis.ts --results <merged results dir> --spec <spec.json> [--out <dir>] (the results directory must hold manifest.json)');
    process.exit(2);
  }
  let analysis: MatrixAnalysis;
  try {
    const manifest = readJsonFile<MatrixManifest>(join(results, 'manifest.json'));
    if (manifest.sealed) { console.error(`matrix-analysis: ${results} was planned with a sealed root; this script prints task ids and does not run on sealed results`); process.exit(2); }
    analysis = analyzeMatrix(loadResults(results, manifest), readJsonFile<MatrixSpec>(specPath));
  } catch (e) {
    if (e instanceof SpecError) { console.error(`matrix-analysis: refused: ${e.message}`); process.exit(2); }
    if (e instanceof RunnerError) { console.error(`matrix-analysis: ${e.message}`); process.exit(2); }
    throw e;
  }
  mkdirSync(out!, { recursive: true });
  writeFileSync(join(out!, 'matrix-analysis.json'), JSON.stringify(analysis, null, 1) + '\n');
  const md = renderMarkdown(analysis);
  writeFileSync(join(out!, 'matrix-analysis.md'), md);
  console.log(md);
  console.log(`MATRIX_ANALYSIS: ${analysis.run_id}: ${analysis.cells.length} cells, ${analysis.trials_recorded} trials recorded${analysis.complete === false ? `, incomplete (${analysis.trials_unstarted} unstarted)` : ''}; wrote ${join(out!, 'matrix-analysis.json')} and matrix-analysis.md`);
}
