#!/usr/bin/env bun
// The harness x model analysis of a frontier Harbor run: pass rates, the noise view, reliability, the paired comparisons
// with the home harness, cost per solve and the results table.
//
//   bun scripts/frontier-harbor/analyze.ts --results <merged results dir> --spec <spec.json> [--out <dir>]
//       [--lookup-fails <file>] [--cost-with-replaced] [--shard-results <shard results dir> ...]
//
// Reads <results>/trials.jsonl (runner/contracts.ts TrialRecord) and <results>/manifest.json when it exists. Writes
// analysis.json and analysis.md to --out (default: the results directory). Intervals, never ranks.
//
// Scoring. A trial passes when grade is pass with no consent violation (scripts/matrix-analysis.ts trialValue):
// harness_error is a fail; model_error, infra_error and exam_fault are excluded and counted per cell. A trial named in
// --lookup-fails (a JSON list of trial ids, or { "trial_ids": [...] }: the trials a blind reader confirmed received the
// answer key, from scripts/frontier-harbor/audit.ts) is a fail whatever its grade. trials.jsonl is checked first by
// scripts/validate-records.ts (schema and uniqueness, and membership when manifest.json is present), and refused on a problem.
//
// Per cell: the pass rate is the task mean (each task's mean over its scored attempts, then the mean over tasks) with a
// task-clustered percentile bootstrap interval; rerun flip 2k(n-k)/(n(n-1)) per task with two or more scored attempts,
// averaged over tasks; pass^k and pass@k with k the cell's planned attempts, over tasks with k scored attempts; cost per
// solve, the cell's recorded USD (excluded trials included, and the first run of a rerun its lease stopped, merge-stages.ts frontier.first_run_usd; with --cost-with-replaced, also each run a rerun replaced) over its scored passes, with a task bootstrap interval. When the
// records carry usage.usd_reserved (records converted from 2026-11-09), that USD is metered only: the dollars the proxy
// charged at a full reservation because a request carried no usage (a provider error inside a 200 stream) stay in the
// ledger but leave usd_total, cost per solve, its interval and the cost-per-solve ratio, and each cell reports them as
// cost.usd_reserved; a record without the field is counted as it always was; and
// the median wall time of scored trials, labelled contended because trials of a shard may overlap.
//
// Pairs. Every cell of a model is paired with the model's home cell (third-party minus home). A pair keeps, per task, the
// attempt numbers (the trial id's /a<n> or /r<n> suffix, else the start order) scored in both cells, up to the smaller cell's
// planned attempts: an attempt excluded in one cell drops from the other too, and a task with no kept attempt drops
// from the pair and is listed. The difference is runner/stats/paired.ts clusteredPairedDelta over per-task means of the
// kept attempts, with its task bootstrap 95% interval and task-level sign-flip p. Primary pairs (cells not marked
// descriptive) form one Holm family per model for the two-sided difference p, and a second Holm family per model for the
// one-sided non-inferiority p at a 15-point margin (nonInferiorityP). A pair with fewer than min_paired_tasks tasks is
// not tested and counts as p = 1 in both families. Each pair also gets its harness flip (pA(1-pB) + pB(1-pA) per task,
// averaged), powerNote at alpha and at the first Holm step, and the paired task bootstrap of the cost-per-solve ratio
// (cell over home: each side's USD on the paired tasks over its scored passes there).
//
// Per model, the noise view: rerun flip averaged over the model's primary cells per task, and harness flip averaged
// over every pair of its primary cells per task, each with a task bootstrap interval. Drift: the home cell's attempt 2
// minus attempt 1 over tasks with both scored (clusteredPairedDelta), flagged when its size passes drift_threshold.
//
// The verdict tag of each cell follows VERDICT_RULES below, first match wins. The markdown repeats the rules at the top.
// Headroom (runner/stats/headroom.ts, docs/methods.md): a pair that would be within-15 is no-room ("can't tell: no room to
// improve") when fewer than min_paired_tasks of its tasks are ones the run can tell apart (not passed on every scored
// attempt by every main cell that scored it, and not failed on every one, as in matrix-analysis), or when on those tasks the
// home cell leaves less than 15 points to fall. Each pair carries its headroom record. A spec listed in scripts/headroom.ts (published before the
// gate) keeps the tags and output it was published with.
//
// gstack arms (internal-task). Records with a "gstack" field (to-trials.ts) are grouped by arm and spec model, in spec order. Per
// group: exposure counts over every record (a mismatch is an infra_error, so it is never scored), the trials that saw a
// skill outside the arm's lock, and over scored trials the open rate of each skill (trials with at least one open over
// scored trials), the section-read rate, the mean listing_bytes and opened_body_tokens, and the mean input, output and
// total tokens per trial from the proxy's usage. None of it changes the pass rates, pairs or cost per solve above.
//
// Spec: { "run_id": "...", "seed": 7, "draws": 10000, "alpha": 0.05, "saturated_at": 0.95, "min_paired_tasks": 10,
//         "primary_pairs": { "<model id>": 3 }, "drift_threshold": 0.1,
//         "models": [{ "id": "opus", "label": "Opus 5.5", "home": "<cell id>" }],
//         "cells": [{ "id": "<cell id>", "model": "opus", "harness": "hermes", "attempts": 2, "descriptive": false }],
//         "model_swap": { "particle": "particle", "frontier": [{ "id": "opus", "label": "Opus 5.5" }, { "id": "sol", "label": "GPT-6.1 Sol" }],
//                         "use_cases": [{ "id": "codegen", "cells": ["<cell id>", ...] }], "clusters": { "<task>": "<cluster>" },
//                         "family": ["codegen/opus", "codegen/sol", ...], "min_clusters": 10, "require_clusters": false },
//         "low_cost_swap": { "a": "deepseek", "b": "particle", "label_a": "DeepSeek-V4.1-Flash-1017", "label_b": "particle-1",
//                            "exclude_harnesses": ["dsh"], "use_cases": [{ "id": "codegen", "cells": ["<cell id>", ...] }],
//                            "family": ["codegen", "personal-brain", "company-brain"], "margin": 0.10,
//                            "cost_basis": { "prices": "runner/pricing/prices-2026-11-08.json",
//                                            "rows": { "deepseek": "openrouter:deepseek/deepseek-v4.1-flash-1017", "particle": "particle:particle-1" } },
//                            "frontier": ["opus", "sol"], "clusters": { "<task>": "<cluster>" }, "min_clusters": 10, "require_clusters": false } }
// model_swap (optional) adds the particle-1 against frontier contrast of scripts/model-swap.ts, which describes the rule, with
// the spec's model ids, this script's scoring (lookups as fails included) and the task as the cluster unless clusters says otherwise.
// low_cost_swap (optional) adds the two-sided a against b contrast of the same file (amendment gate G1), scored the same way, its
// use cases' cells drawn from this spec's cells (a, b and the frontier models listed), and its cost from the trials' token counts.
// Its section follows the model_swap one; without the block, the analysis and its Markdown are what they were.
//
// truncation_recovery: "amendment-6" (optional; frontier-shootout-2026-11, amendment 6) scores an effort_mismatch trial of a
// Hermes cell as its graded outcome when Hermes's thinking-only truncation recovery lowered the effort
// (truncation-recovery.ts, read from the results directory's proxy usage logs and kept request captures; trials.jsonl is not
// edited). analysis.json and analysis.md are then that view, with a truncation_recovery block: per Hermes cell the tag's
// count and rate, the trials that stayed infra, and the cell's pass rate, verdict and pairs both ways. The whole analysis
// under the original rule goes to analysis-original-rule.json and analysis-original-rule.md beside them. A record that
// to-trials.ts recover rebuilt (paths {}) is read from Harbor's run/jobs/ tree (trial-dir.ts), under the results directory or
// a --shard-results directory (a merged directory holds no run/).
//
// Recovered shards. When the results directory holds a shard's recovery.json (to-trials.ts recover; <shard>.recovery.json
// after merge-shards.ts), the spend its usage log holds for no record counts in its cell's cost (unrecordedSpend).
//
// gstack lift (internal-task). A spec with schema frontier-harbor-gstack-analysis/1 (tests/fixtures/frontier-harbor/gstack-analysis-spec.json)
// writes gstack-analysis.json and gstack-analysis.md instead of analysis.json and analysis.md:
//
//   bun scripts/frontier-harbor/analyze.ts --results <dir> --spec <gstack spec> [--lookup-fails <file>] [--out <dir>]
//
// One spec per gstack arm (installed, told). Its cells are { id, model, harness, arm }, arm none or the spec's one gstack
// arm, with one of each per model and harness; a record's arm is its cell's arm in the spec, never read from the record.
// Scoring is trialValue's (pass: verifier reward 1, so grade pass, with no consent violation; harness_error a fail;
// an agent timeout a fail whatever its grade, as PREREGISTRATION.md's Scoring says;
// model_error, infra_error and exam_fault excluded and counted per cell; a lookup a fail). Per task and harness, each side is
// the mean pass of its scored trials, so an excluded trial drops only its own side; a task and harness enters a comparison
// when both sides have a scored trial there. Differences pool the harnesses as a stratum through clusteredPairedDelta
// clustered by task (task bootstrap 95% interval, task sign-flip p), with tasks better, worse and the same, per-harness
// readings without a test, each side's pass rate with its tasks and trials, and the run's own MDD from powerNote at alpha
// and at the first Holm step:
//   lift       gstack minus none per model, Holm over the target and the frontier models: helps, hurts or no measurable
//              difference, with the paired cost-per-solve ratio (gstack over none).
//   difference the target's lift minus each frontier model's, per task and harness from the four cells, Holm over the
//              frontier models; primary when lift_difference.primary (set from the preregistered MDD), else secondary.
//   reach      the target with gstack minus each frontier model without, one-sided non-inferiority at ni_margin (10 points)
//              and superiority (superiorityP), each Holm over the frontier models: better, within 10 points or not shown,
//              with the paired cost-per-solve ratio (target with gstack over the frontier model without).
// A comparison with fewer than min_paired_tasks (10) paired tasks is not tested and counts as p = 1 in its Holm family.
// scripts/frontier-harbor/interim.ts runs the same analysis on the trials of the preregistered half-way look.
//
//   bun scripts/frontier-harbor/analyze.ts mdd --results <dir> [--lookup-fails <file>] [--tasks 52] [--attempts 3]
//       [--baseline-attempts 3] [--alpha 0.05] [--power 0.8] [--harnesses hermes,openclaw] [--lift-sd 0.1] [--json <file>]
//
// prints the expected MDD of a planned gstack run's lift and lift difference from existing results' per-task variances
// (expectedMdd).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Termination, TrialRecord } from '../../runner/contracts.ts';
import { RunnerError } from '../../runner/errors.ts';
import { readJsonFile, readJsonLines } from '../../runner/heldout/sealed.ts';
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, normalQuantile, powerNote, superiorityP, type PairedDelta } from '../../runner/stats/paired.ts';
import { bootstrapLowerBound, costPerSolve, harnessFlip, pairedCostRatio, passAtK, passHatK, rerunFlip, taskBootstrapMean, type MeanInterval } from '../../runner/stats/frontier.ts';
import { TERMINATIONS, trialValue, type MatrixManifest } from '../matrix-analysis.ts';
import { analyzeLowCostSwap, analyzeModelSwap, checkLowCostSwapSpec, checkModelSwapSpec, ModelSwapError, renderLowCostSwap, renderModelSwap, type LowCostSwapSpec, type ModelSwapSpec } from '../model-swap.ts';
import { NO_ROOM, noRoomReason, pairHeadroom, runCanTellApart } from '../../runner/stats/headroom.ts';
import { headroomGated } from '../headroom.ts';
import { validateRecords } from '../validate-records.ts';
import type { GstackTrial } from './gstack-exposure.ts';

export interface FrontierCell { id: string; model: string; harness: string; label?: string; attempts: number; descriptive?: boolean }
export interface FrontierModel { id: string; label?: string; home: string }
export interface FrontierSpec {
  run_id: string;
  seed?: number;
  draws?: number;
  alpha?: number;
  saturated_at?: number;
  min_paired_tasks?: number;
  /** The preregistered number of primary pairs per model; checked when given. */
  primary_pairs?: Record<string, number>;
  /** The preregistered size, in pass-rate units, above which the home cells' attempt 1 to attempt 2 drift is flagged. */
  drift_threshold?: number;
  models: FrontierModel[];
  cells: FrontierCell[];
  model_swap?: ModelSwapSpec;
  low_cost_swap?: LowCostSwapSpec;
  /** Amendment 6 of frontier-shootout-2026-11: score Hermes's thinking-only truncation recovery (truncation-recovery.ts). */
  truncation_recovery?: 'amendment-6';
}
/** Spend in a cell's shard usage log that no record carries: a shard whose records to-trials.ts recover rebuilt keeps the
 *  spend of trials it never journaled (one cut mid-run, a request charged at its reservation) only in the log. */
export interface UnrecordedSpend { usd: number; usd_reserved: number; source: string }
export interface FrontierInput { records: TrialRecord[]; manifest: MatrixManifest | null; lookup_fails?: string[]; cost_with_replaced?: boolean; unrecorded?: Record<string, UnrecordedSpend> }

export class SpecError extends Error {}

/** The non-inferiority margin, in pass-rate units: 15 percentage points. */
export const NI_MARGIN = 0.15;
export const VERDICTS = ['home', 'incomplete', 'descriptive', 'behind', 'within-15', 'saturated', 'inconclusive'] as const;
/** The tags of a run the headroom gate covers (scripts/headroom.ts): no-room comes before within-15. */
export const GATED_VERDICTS = ['home', 'incomplete', 'descriptive', 'behind', 'no-room', 'within-15', 'saturated', 'inconclusive'] as const;
export type Verdict = (typeof GATED_VERDICTS)[number];
export const VERDICT_RULES: Record<Verdict, string> = {
  home: "the model's home harness; every other cell of the model is compared with it",
  incomplete: 'the cell or its home cell has a planned trial with no record, or the pair has fewer than min_paired_tasks (10 by default) tasks with an attempt scored in both cells: reported from what exists, no claim',
  descriptive: 'an extension cell (descriptive in the spec, for example one attempt per task): estimate and intervals only, no test and no non-inferiority claim',
  behind: "a primary pair whose two-sided task-level sign-flip p, Holm-adjusted across the model's primary pairs, is at or below alpha with the cell below its home",
  'no-room': `${NO_ROOM}: a primary pair that is not behind and would be within-15, but fewer than min_paired_tasks of its paired tasks are ones the run can tell apart (a task every main cell passed on every attempt, or every main cell failed on every attempt, can't), or on those tasks the home cell's passes leave the cell less than 15 points to fall`,
  'within-15': "a primary pair that is not behind and whose one-sided non-inferiority p at a 15-point margin (the share of task-bootstrap draws of cell minus home at or below -15 points), Holm-adjusted across the model's primary pairs, is at or below alpha",
  saturated: 'a primary pair that is neither behind nor within-15 and whose home cell averages at least saturated_at (95% by default) on the paired tasks, or where no paired task differs: a ceiling, not a tie',
  inconclusive: 'every other primary pair: the data show neither that the cell is within 15 points of its home nor that it is behind',
};

const ATTEMPT = /\/[ar](\d+)$/;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const round = (x: number | null | undefined, d = 6) => (x === null || x === undefined ? null : Number(x.toFixed(d)));
const roundCi = (c: [number, number] | null | undefined, d = 6): [number, number] | null => (c ? [round(c[0], d)!, round(c[1], d)!] : null);
const roundMean = (m: MeanInterval | null) => (m ? { estimate: round(m.estimate)!, ci95: roundCi(m.ci95), tasks: m.n } : null);
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function checkSpec(spec: FrontierSpec, manifest: MatrixManifest | null): string[] {
  const problems: string[] = [];
  if (typeof spec.run_id !== 'string' || !spec.run_id) problems.push('run_id is missing');
  if (manifest && spec.run_id !== manifest.run_id) problems.push(`spec run_id ${spec.run_id} is not the manifest's ${manifest.run_id}`);
  if (!Array.isArray(spec.models) || !spec.models.length) problems.push('models is empty');
  if (!Array.isArray(spec.cells) || !spec.cells.length) problems.push('cells is empty');
  const models = new Map<string, FrontierModel>();
  for (const m of spec.models ?? []) {
    if (models.has(m.id)) problems.push(`model ${m.id} listed twice`);
    models.set(m.id, m);
  }
  const cells = new Map<string, FrontierCell>();
  for (const c of spec.cells ?? []) {
    if (cells.has(c.id)) problems.push(`cell ${c.id} listed twice`);
    cells.set(c.id, c);
    if (!models.has(c.model)) problems.push(`cell ${c.id} names model ${c.model}, which the spec does not define`);
    if (typeof c.harness !== 'string' || !c.harness) problems.push(`cell ${c.id} has no harness`);
    if (!Number.isSafeInteger(c.attempts) || c.attempts < 1) problems.push(`cell ${c.id} needs attempts, a positive integer`);
    if (manifest && !manifest.cells.some((x) => x.id === c.id)) problems.push(`cell ${c.id} is not in the run's manifest`);
  }
  for (const m of models.values()) {
    const home = cells.get(m.home);
    if (!home) problems.push(`model ${m.id} names home cell ${m.home}, which the spec does not define`);
    else if (home.model !== m.id) problems.push(`model ${m.id} names home cell ${m.home}, a cell of model ${home.model}`);
    else if (home.descriptive) problems.push(`home cell ${m.home} is marked descriptive`);
  }
  for (const [model, n] of Object.entries(spec.primary_pairs ?? {})) {
    const m = models.get(model);
    if (!m) { problems.push(`primary_pairs names model ${model}, which the spec does not define`); continue; }
    const count = [...cells.values()].filter((c) => c.model === model && c.id !== m.home && !c.descriptive).length;
    if (count !== n) problems.push(`model ${model} has ${count} primary pair(s); the spec preregisters ${n}`);
  }
  if (spec.draws !== undefined && (!Number.isSafeInteger(spec.draws) || spec.draws < 1000)) problems.push('draws must be an integer of at least 1000');
  if (spec.alpha !== undefined && !(spec.alpha > 0 && spec.alpha < 0.5)) problems.push('alpha must be between 0 and 0.5');
  if (spec.saturated_at !== undefined && !(spec.saturated_at > 0 && spec.saturated_at <= 1)) problems.push('saturated_at must be in (0, 1]');
  if (spec.min_paired_tasks !== undefined && (!Number.isSafeInteger(spec.min_paired_tasks) || spec.min_paired_tasks < 2)) problems.push('min_paired_tasks must be an integer of at least 2');
  if (spec.model_swap) problems.push(...checkModelSwapSpec(spec.model_swap, new Map([...cells.values()].map((c) => [c.id, c])), 'harbor'));
  if (spec.truncation_recovery !== undefined && spec.truncation_recovery !== 'amendment-6') problems.push('truncation_recovery is "amendment-6" or absent');
  if (spec.low_cost_swap) problems.push(...checkLowCostSwapSpec(spec.low_cost_swap, new Map([...cells.values()].map((c) => [c.id, c])), 'harbor'));
  return problems;
}

/** Attempt number of each trial of one cell: the /a<n> (plan.ts) or /r<n> suffix of its id when every trial of the task has one, else its
 *  place in start order (then id order) within the task. */
function attemptNumbers(rows: TrialRecord[]): Map<TrialRecord, number> {
  const out = new Map<TrialRecord, number>();
  const byTask = new Map<string, TrialRecord[]>();
  for (const t of rows) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
  for (const [task, ts] of byTask) {
    const suffixed = ts.every((t) => ATTEMPT.test(t.trial_id));
    const ordered = suffixed ? ts : [...ts].sort((a, b) => byKey(a.started_at, b.started_at) || byKey(a.trial_id, b.trial_id));
    const seen = new Set<number>();
    ordered.forEach((t, i) => {
      const n = suffixed ? Number(ATTEMPT.exec(t.trial_id)![1]) : i + 1;
      if (seen.has(n)) throw new SpecError(`cell ${t.cell} task ${task} has two trials numbered attempt ${n}`);
      seen.add(n);
      out.set(t, n);
    });
  }
  return out;
}

interface CellData {
  spec: FrontierCell;
  rows: TrialRecord[];
  /** task -> attempt number -> 1 pass, 0 fail, null excluded */
  attempts: Map<string, Map<number, 0 | 1 | null>>;
  /** Metered USD per task: what the trials' usage lines priced, without the dollars charged at a full reservation. */
  usdByTask: Map<string, number>;
  /** The dollars charged at a full reservation (usage.usd_reserved, and the same for a first or replaced run). */
  reservedUsd: number;
  unstarted: string[];
  unrecorded: UnrecordedSpend | null;
}

interface FrontierUsd { first_run_usd?: number; first_run_usd_reserved?: number; replaced_usd?: number; replaced_usd_reserved?: number }

const scoredOf = (m: Map<number, 0 | 1 | null> | undefined) => [...(m?.values() ?? [])].filter((v): v is 0 | 1 => v !== null);

interface Kept { items: Array<{ task: string; a: number; b: number; attempts: number }>; dropped: Array<{ task: string; reason: string }>; attempts_dropped_pairwise: number }

/** Per task, the attempt numbers scored in both cells (up to the smaller cell's planned attempts), as per-task means. */
function keepPairwise(a: CellData, b: CellData): Kept {
  const limit = Math.min(a.spec.attempts, b.spec.attempts);
  const tasks = [...new Set([...a.attempts.keys(), ...b.attempts.keys()])].sort(byKey);
  const items: Kept['items'] = [];
  const dropped: Kept['dropped'] = [];
  let attemptsDropped = 0;
  for (const task of tasks) {
    const x = a.attempts.get(task), y = b.attempts.get(task);
    const numbers = [...new Set([...(x?.keys() ?? []), ...(y?.keys() ?? [])])].filter((n) => n <= limit);
    const kept = numbers.filter((n) => (x?.get(n) ?? null) !== null && (y?.get(n) ?? null) !== null);
    attemptsDropped += numbers.filter((n) => !kept.includes(n)).reduce((s, n) => s + ((x?.get(n) ?? null) !== null ? 1 : 0) + ((y?.get(n) ?? null) !== null ? 1 : 0), 0);
    if (kept.length) { items.push({ task, a: mean(kept.map((n) => x!.get(n)!)), b: mean(kept.map((n) => y!.get(n)!)), attempts: kept.length }); continue; }
    const scoredA = scoredOf(x).length > 0, scoredB = scoredOf(y).length > 0;
    dropped.push({ task, reason: !scoredA && !scoredB ? 'no scored attempt in either cell' : !scoredA ? `no scored attempt in ${a.spec.id}` : !scoredB ? `no scored attempt in ${b.spec.id}` : 'no attempt number scored in both cells' });
  }
  return { items, dropped, attempts_dropped_pairwise: attemptsDropped };
}

export function analyzeFrontier(input: FrontierInput, spec: FrontierSpec) {
  const problems = checkSpec(spec, input.manifest);
  if (problems.length) throw new SpecError(problems.join('; '));
  const recordProblems = validateRecords(input.records, input.manifest);
  if (recordProblems.length) throw new SpecError(`trials.jsonl ${input.manifest ? 'disagrees with the manifest' : 'is not valid'}: ${recordProblems.slice(0, 10).join('; ')}${recordProblems.length > 10 ? '; ...' : ''}`);
  const seed = spec.seed ?? 7, draws = spec.draws ?? 10_000, alpha = spec.alpha ?? 0.05;
  const saturatedAt = spec.saturated_at ?? 0.95, minPaired = spec.min_paired_tasks ?? 10;
  const gated = headroomGated(spec);
  const headroomOf = (items: Array<{ task: string; a: number; b: number }>) => {
    const h = pairHeadroom(items.map((i) => ({ cluster: i.task, a: i.a, b: i.b })), runSet);
    return {
      headroom: h && { ...h, room_above_a: round(h.room_above_a)!, room_below_a: round(h.room_below_a)!, room_above_b: round(h.room_above_b)! },
      no_room_reason: h ? noRoomReason(h, { room: h.room_below_a, smallest_difference: NI_MARGIN, min_tasks: minPaired }) : null,
    };
  };
  const opts = { seed, draws };
  const lookups = new Set(input.lookup_fails ?? []);
  const recordIds = new Set(input.records.map((t) => t.trial_id));
  const unknownLookups = [...lookups].filter((id) => !recordIds.has(id));
  if (unknownLookups.length) throw new SpecError(`--lookup-fails names ${unknownLookups.length} trial(s) with no record: ${unknownLookups.slice(0, 5).join(', ')}`);
  const value = (t: TrialRecord): 0 | 1 | null => { const v = trialValue(t); return v === 1 && lookups.has(t.trial_id) ? 0 : v; };
  const recorded = new Set(input.records.map((t) => t.trial_id));
  const split = input.records.some((t) => t.usage?.usd_reserved !== undefined);

  const data = new Map<string, CellData>();
  for (const c of spec.cells) {
    const rows = input.records.filter((t) => t.cell === c.id);
    const numbers = attemptNumbers(rows);
    const attempts = new Map<string, Map<number, 0 | 1 | null>>();
    const usdByTask = new Map<string, number>();
    let reservedUsd = 0;
    for (const t of rows) {
      const m = attempts.get(t.task) ?? new Map<number, 0 | 1 | null>();
      m.set(numbers.get(t)!, value(t));
      attempts.set(t.task, m);
      const f = (t as { frontier?: FrontierUsd }).frontier;
      const reserved = (t.usage?.usd_reserved ?? 0) + (f?.first_run_usd_reserved ?? 0) + (input.cost_with_replaced ? f?.replaced_usd_reserved ?? 0 : 0);
      const charged = (t.usage?.usd ?? 0) + (f?.first_run_usd ?? 0) + (input.cost_with_replaced ? f?.replaced_usd ?? 0 : 0);
      usdByTask.set(t.task, (usdByTask.get(t.task) ?? 0) + (reserved ? Math.max(charged - reserved, 0) : charged));
      reservedUsd += reserved;
    }
    const unstarted = input.manifest ? input.manifest.trials.filter((t) => t.cell === c.id && !recorded.has(t.id)).map((t) => t.id) : [];
    const unrecorded = input.unrecorded?.[c.id] ?? null;
    if (unrecorded) {
      const metered = split ? unrecorded.usd - unrecorded.usd_reserved : unrecorded.usd;
      const total = sum([...usdByTask.values()]);
      for (const [task, v] of usdByTask) usdByTask.set(task, v + metered * (total > 0 ? v / total : 1 / usdByTask.size));
      if (split) reservedUsd += unrecorded.usd_reserved;
    }
    data.set(c.id, { spec: c, rows, attempts, usdByTask, reservedUsd, unstarted, unrecorded });
  }
  const mainCells = [...data.values()].filter((d) => !d.spec.descriptive);
  const taskIds = [...new Set(mainCells.flatMap((d) => [...d.attempts.keys()]))].sort(byKey);
  const inEveryCell = (want: 0 | 1) => taskIds.filter((task) => mainCells.every((d) => { const s = scoredOf(d.attempts.get(task)); return s.length > 0 && s.every((v) => v === want); }));
  const taskLists = { total: taskIds.length, passed_every_attempt_in_every_cell: inEveryCell(1), never_passed_in_any_cell: inEveryCell(0) };
  const runSet = runCanTellApart(mainCells.map((d) => new Map(taskIds.flatMap((task): Array<[string, number]> => { const s = scoredOf(d.attempts.get(task)); return s.length ? [[task, s.reduce<number>((x, y) => x + y, 0) / s.length]] : []; }))));

  const cellStats = (d: CellData) => {
    const c = d.spec;
    const tasks = [...d.attempts.entries()].sort(([x], [y]) => byKey(x, y)).map(([task, m]) => ({ task, scored: scoredOf(m) })).filter((x) => x.scored.length);
    const terminations = Object.fromEntries(TERMINATIONS.map((k) => [k, d.rows.filter((t) => t.termination === k).length])) as Record<Termination, number>;
    const scoredTrials = d.rows.filter((t) => value(t) !== null);
    const passes = scoredTrials.filter((t) => value(t) === 1).length;
    const hat = tasks.map((x) => passHatK(x.scored.length, sum(x.scored), c.attempts)).filter((v): v is number => v !== null);
    const at = tasks.map((x) => passAtK(x.scored.length, sum(x.scored), c.attempts)).filter((v): v is number => v !== null);
    const flips = tasks.map((x) => rerunFlip(x.scored.length, sum(x.scored))).filter((v): v is number => v !== null);
    const cost = costPerSolve([...d.usdByTask.entries()].map(([task, usd]) => ({ usd, solves: sum(scoredOf(d.attempts.get(task))) })), opts);
    const rate = taskBootstrapMean(tasks.map((x) => mean(x.scored)), opts);
    return {
      id: c.id, label: c.label ?? c.id, model: c.model, harness: c.harness, attempts: c.attempts, descriptive: c.descriptive === true,
      trials: {
        planned: input.manifest ? input.manifest.trials.filter((t) => t.cell === c.id).length : null, recorded: d.rows.length, scored: scoredTrials.length,
        excluded: { model_error: terminations.model_error, infra_error: terminations.infra_error, exam_fault: terminations.exam_fault },
        harness_error_as_fail: terminations.harness_error, lookup_fails: d.rows.filter((t) => lookups.has(t.trial_id) && trialValue(t) === 1).length,
        cap_stop: d.rows.filter((t) => t.cap_stop).length, unstarted: d.unstarted,
      },
      terminations,
      pass_rate: rate ? { estimate: round(rate.estimate)!, ci95: roundCi(rate.ci95), tasks: rate.n, scored_trials: scoredTrials.length, passes } : null,
      reliability: { k: c.attempts, pass_hat_k: roundMean(taskBootstrapMean(hat, opts)), pass_at_k: roundMean(taskBootstrapMean(at, opts)), tasks_with_fewer_than_k: tasks.length - hat.length },
      rerun_flip: roundMean(taskBootstrapMean(flips, opts)),
      cost: { usd_total: round(cost.usd)!, ...(split ? { usd_reserved: round(d.reservedUsd)! } : {}), ...(d.unrecorded ? { unrecorded: { usd: round(d.unrecorded.usd)!, usd_reserved: round(d.unrecorded.usd_reserved)!, source: d.unrecorded.source } } : {}), solves: cost.solves, usd_per_solve: round(cost.usd_per_solve), ci95: roundCi(cost.ci95), note: cost.note },
      wall_s_median_contended: (() => { const m = median(scoredTrials.map((t) => t.wall_ms)); return m === null ? null : round(m / 1000, 1); })(),
    };
  };
  const cells = spec.cells.map((c) => cellStats(data.get(c.id)!));
  const cellById = new Map(cells.map((c) => [c.id, c]));

  const pairs = spec.models.flatMap((m) => {
    const home = data.get(m.home)!;
    const others = spec.cells.filter((c) => c.model === m.id && c.id !== m.home);
    const familySize = others.filter((c) => !c.descriptive).length;
    const rows = others.map((c) => {
      const other = data.get(c.id)!;
      const kept = keepPairwise(home, other);
      const stats: PairedDelta | null = kept.items.length ? clusteredPairedDelta(kept.items.map((i) => ({ id: i.task, cluster: i.task, a: i.a, b: i.b })), opts) : null;
      const tested = kept.items.length >= minPaired;
      const ni = stats ? nonInferiorityP(stats, NI_MARGIN, 'higher') : null;
      const cost = pairedCostRatio(kept.items.map((i) => ({ task: i.task, usd_a: home.usdByTask.get(i.task) ?? 0, solves_a: sum(scoredOf(home.attempts.get(i.task))), usd_b: other.usdByTask.get(i.task) ?? 0, solves_b: sum(scoredOf(other.attempts.get(i.task))) })), opts);
      const flip = taskBootstrapMean(kept.items.map((i) => harnessFlip(i.a, i.b)), opts);
      const power = stats ? powerNote(stats, { alpha }) : null;
      const powerHolm = stats && familySize > 1 && !c.descriptive ? powerNote(stats, { alpha: alpha / familySize }) : null;
      return {
        id: `${c.id} vs ${m.home}`, model: m.id, cell: c.id, home: m.home, family: c.descriptive ? 'extension' as const : 'primary' as const,
        tasks_paired: kept.items.length, tasks_dropped: kept.dropped.length, dropped: kept.dropped, attempts_dropped_pairwise: kept.attempts_dropped_pairwise,
        mean_home: round(stats?.mean_a), mean_cell: round(stats?.mean_b), delta: round(stats?.delta), ci95: roundCi(stats?.ci95),
        lower_bound_90: stats ? round(bootstrapLowerBound(stats, alpha)) : null,
        p_two_sided: stats ? round(stats.p_two_sided, 8) : null, p_method: stats?.p_method ?? 'no paired task',
        ni_margin: NI_MARGIN, p_noninferiority: round(ni, 8), tested,
        untested_reason: tested ? null : `fewer than ${minPaired} paired tasks: descriptive only, counted as p = 1 in the family`,
        power: power ? { alpha, mde: round(power.mde), note: power.note } : null,
        power_first_holm_step: powerHolm ? { alpha: round(alpha / familySize), mde: round(powerHolm.mde), note: powerHolm.note } : null,
        harness_flip: roundMean(flip),
        cost_per_solve_ratio: { tasks: cost.tasks, ratio: round(cost.ratio, 4), ci95: roundCi(cost.ci95, 4), undefined_draws: cost.undefined_draws, note: cost.note },
        home_saturated: stats ? stats.mean_a >= saturatedAt - 1e-12 || stats.bootstrap.length === 0 : false,
        ...(gated ? headroomOf(kept.items) : {}),
        holm_p: null as number | null, holm_p_noninferiority: null as number | null,
      };
    });
    const primary = rows.filter((r) => r.family === 'primary');
    if (primary.length) {
      const diff = holmAdjusted(primary.map((r) => (r.tested && r.p_two_sided !== null ? r.p_two_sided : 1)));
      const ni = holmAdjusted(primary.map((r) => (r.tested && r.p_noninferiority !== null ? r.p_noninferiority : 1)));
      primary.forEach((r, i) => { r.holm_p = round(diff[i]!, 8); r.holm_p_noninferiority = round(ni[i]!, 8); });
    }
    return rows;
  });

  const verdictOf = (cellId: string): { verdict: Verdict; reason: string } => {
    const model = spec.models.find((m) => m.home === cellId);
    if (model) return { verdict: 'home', reason: `home harness of ${model.label ?? model.id}` };
    const p = pairs.find((x) => x.cell === cellId)!;
    const own = data.get(cellId)!, home = data.get(p.home)!;
    if (own.unstarted.length || home.unstarted.length) return { verdict: 'incomplete', reason: `${own.unstarted.length} planned trial(s) of this cell and ${home.unstarted.length} of its home have no record` };
    if (!p.tested) return { verdict: 'incomplete', reason: `${p.tasks_paired} paired task(s), fewer than ${minPaired}` };
    if (p.family === 'extension') return { verdict: 'descriptive', reason: 'extension cell: estimate and interval only' };
    if (p.holm_p! <= alpha && p.delta! < 0) return { verdict: 'behind', reason: `Holm p ${p.holm_p} <= ${alpha}, delta ${p.delta}` };
    if (p.holm_p_noninferiority! <= alpha && p.no_room_reason) return { verdict: 'no-room', reason: p.no_room_reason };
    if (p.holm_p_noninferiority! <= alpha) return { verdict: 'within-15', reason: `Holm non-inferiority p ${p.holm_p_noninferiority} <= ${alpha}` };
    if (p.home_saturated) return { verdict: 'saturated', reason: `home cell averages ${p.mean_home} on the paired tasks (threshold ${saturatedAt}) or no paired task differs` };
    return { verdict: 'inconclusive', reason: `Holm p ${p.holm_p}, Holm non-inferiority p ${p.holm_p_noninferiority ?? 'n/a'}` };
  };
  const withVerdicts = cells.map((c) => ({ ...c, ...verdictOf(c.id) }));

  const models = spec.models.map((m) => {
    const core = spec.cells.filter((c) => c.model === m.id && !c.descriptive).map((c) => data.get(c.id)!);
    const rerunByTask = new Map<string, number[]>();
    for (const d of core) for (const [task, a] of d.attempts) {
      const s = scoredOf(a);
      const f = s.length ? rerunFlip(s.length, sum(s)) : null;
      if (f !== null) rerunByTask.set(task, [...(rerunByTask.get(task) ?? []), f]);
    }
    const harnessByTask = new Map<string, number[]>();
    for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) {
      for (const it of keepPairwise(core[i]!, core[j]!).items) harnessByTask.set(it.task, [...(harnessByTask.get(it.task) ?? []), harnessFlip(it.a, it.b)]);
    }
    const rerun = taskBootstrapMean([...rerunByTask.entries()].sort(([x], [y]) => byKey(x, y)).map(([, v]) => mean(v)), opts);
    const harness = taskBootstrapMean([...harnessByTask.entries()].sort(([x], [y]) => byKey(x, y)).map(([, v]) => mean(v)), opts);
    const both = [...data.get(m.home)!.attempts.entries()].sort(([x], [y]) => byKey(x, y)).flatMap(([task, a]) => {
      const first = a.get(1) ?? null, second = a.get(2) ?? null;
      return first !== null && second !== null ? [{ id: task, cluster: task, a: first, b: second }] : [];
    });
    const drift = both.length ? clusteredPairedDelta(both, opts) : null;
    return {
      id: m.id, label: m.label ?? m.id, home: m.home, primary_cells: core.map((d) => d.spec.id),
      noise: { rerun_flip: roundMean(rerun), harness_flip: roundMean(harness), harness_minus_rerun: rerun && harness ? round(harness.estimate - rerun.estimate) : null },
      drift: { cell: m.home, tasks: both.length, attempt_1: round(drift?.mean_a), attempt_2: round(drift?.mean_b), delta: round(drift?.delta), ci95: roundCi(drift?.ci95),
        threshold: spec.drift_threshold ?? null, exceeds: drift && spec.drift_threshold !== undefined ? Math.abs(drift.delta) > spec.drift_threshold + 1e-12 : null },
    };
  });

  const swap = spec.model_swap;
  const swapCells = new Set(swap?.use_cases.flatMap((u) => u.cells) ?? []);
  const swapOrRefuse = <T,>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof ModelSwapError) throw new SpecError(e.message); throw e; } };
  const modelSwap = swap ? swapOrRefuse(() => analyzeModelSwap({
    cells: spec.cells.filter((c) => swapCells.has(c.id)),
    trials: input.records.filter((t) => swapCells.has(t.cell)).map((t) => ({ cell: t.cell, task: t.task, value: value(t), usd: t.usage?.usd ?? 0 })),
    leaks: false,
  }, swap, { seed, draws, alpha })) : null;
  const low = spec.low_cost_swap;
  const lowCells = new Set(low?.use_cases.flatMap((u) => u.cells) ?? []);
  const lowCostSwap = low ? swapOrRefuse(() => analyzeLowCostSwap({
    cells: spec.cells.filter((c) => lowCells.has(c.id)),
    trials: input.records.filter((t) => lowCells.has(t.cell)).map((t) => ({ cell: t.cell, task: t.task, value: value(t), usage: t.usage })),
  }, low, { seed, draws, alpha })) : null;
  const gstackOf = (t: TrialRecord) => (t as TrialRecord & { gstack?: GstackTrial }).gstack ?? null;
  const armGroups = new Map<string, { arm: string; model: string; cells: string[]; rows: TrialRecord[] }>();
  for (const c of spec.cells) for (const t of data.get(c.id)!.rows) {
    const g = gstackOf(t);
    if (!g) continue;
    const group = armGroups.get(g.arm + '\0' + c.model) ?? { arm: g.arm, model: c.model, cells: [], rows: [] };
    if (!group.cells.includes(c.id)) group.cells.push(c.id);
    group.rows.push(t);
    armGroups.set(g.arm + '\0' + c.model, group);
  }
  const gstack = [...armGroups.values()].map(({ arm, model, cells: armCells, rows }) => {
    const all = rows.map((t) => gstackOf(t)!);
    const scored = rows.filter((t) => value(t) !== null);
    const gs = scored.map((t) => gstackOf(t)!);
    const skills = [...new Set(all.flatMap((g) => [...g.expected, ...Object.keys(g.opens), ...Object.keys(g.section_reads)]))].sort(byKey);
    const rates = (key: 'opens' | 'section_reads') => skills.map((skill) => {
      const n = gs.filter((g) => (g[key][skill] ?? 0) > 0).length;
      return { skill, trials: n, rate: gs.length ? round(n / gs.length) : null };
    });
    const meanOf = (xs: number[]) => (xs.length ? round(mean(xs), 1) : null);
    const inputs = scored.map((t) => t.usage?.input_tokens ?? 0), outputs = scored.map((t) => t.usage?.output_tokens ?? 0);
    return {
      arm, model, cells: armCells, trials: rows.length, scored_trials: gs.length,
      exposure: { ok: all.filter((g) => g.exposure === 'ok').length, mismatch: all.filter((g) => g.exposure === 'mismatch').length, not_applicable: all.filter((g) => g.exposure === 'not-applicable').length },
      removed_seen_trials: all.filter((g) => g.removed_seen.length).length,
      listing_bytes_mean: meanOf(gs.map((g) => g.listing_bytes)), opened_body_tokens_mean: meanOf(gs.map((g) => g.opened_body_tokens)),
      tokens_per_trial_mean: { input: meanOf(inputs), output: meanOf(outputs), total: meanOf(inputs.map((x, i) => x + outputs[i]!)) },
      open_rate: rates('opens'), section_read_rate: rates('section_reads').filter((r) => r.trials > 0),
    };
  });

  const outside = input.records.filter((t) => !cellById.has(t.cell)).length;
  const planned = input.manifest ? input.manifest.trials.filter((t) => cellById.has(t.cell)).length : null;
  const unstarted = withVerdicts.reduce((s, c) => s + c.trials.unstarted.length, 0);
  return {
    run_id: spec.run_id,
    method: {
      estimator: "task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p",
      seed, draws, alpha, ni_margin: NI_MARGIN, saturated_at: saturatedAt, min_paired_tasks: minPaired, drift_threshold: spec.drift_threshold ?? null,
      wall_time: 'median over scored trials, contended (trials of a shard may overlap)',
      cost: `${input.cost_with_replaced ? 'recorded USD of every trial of the cell (excluded ones included) plus each run a rerun replaced (frontier.replaced_usd, --cost-with-replaced), over scored passes' : 'recorded USD of every trial record of the cell (excluded ones included; a run a rerun replaced is not a record) over scored passes'}${split ? '; metered dollars only: the dollars the proxy charged at a full reservation because a request carried no usage (usage.usd_reserved) are left out of usd_total, cost per solve and its interval, and reported as usd_reserved' : ''}${input.unrecorded && Object.keys(input.unrecorded).length ? '; a cell whose shard records were rebuilt by to-trials.ts recover also counts the spend its shard usage log holds for no record (cost.unrecorded), spread over the cell\'s tasks in proportion to their recorded spend, its reservation part with usd_reserved' : ''}`,
    },
    verdict_rules: Object.fromEntries((gated ? GATED_VERDICTS : VERDICTS).map((v) => [v, VERDICT_RULES[v]])) as Partial<Record<Verdict, string>>,
    trials_planned: planned, trials_recorded: input.records.length - outside, trials_outside_spec: outside, trials_unstarted: unstarted,
    complete: planned === null ? null : unstarted === 0,
    lookup_fails: lookups.size,
    tasks: taskLists,
    models, cells: withVerdicts, pairs,
    ...(modelSwap ? { model_swap: modelSwap } : {}),
    ...(lowCostSwap ? { low_cost_swap: lowCostSwap } : {}),
    ...(gstack.length ? { gstack } : {}),
  };
}

export type FrontierAnalysis = ReturnType<typeof analyzeFrontier>;

/** The spend a recovered shard's usage log holds for no record, per cell. A shard is recovered when the results directory
 *  holds its recovery.json (to-trials.ts recover; <shard>.recovery.json after merge-shards.ts). Its usage log is
 *  proxy-usage.ndjson or <shard>.proxy-usage.ndjson; the spend is every line whose meter key is no record's Harbor trial,
 *  split by charged_reservation, else recovery.json's spend.not_in_a_recovered_record_usd when the log is missing. Its cell
 *  is the shard's one cell in shards.json, else the one cell of the directory's records. */
export function unrecordedSpend(results: string, records: TrialRecord[]): Record<string, UnrecordedSpend> {
  const out: Record<string, UnrecordedSpend> = {};
  const files = existsSync(results) ? readdirSync(results).filter((f) => f === 'recovery.json' || f.endsWith('.recovery.json')) : [];
  if (!files.length) return out;
  const shards = existsSync(join(results, 'shards.json')) ? readJsonFile<{ shards?: Record<string, { cells?: string[] }> }>(join(results, 'shards.json')).shards ?? {} : {};
  const keys = new Set(records.flatMap((t) => { const n = (t as { frontier?: { harbor_trial?: string } }).frontier?.harbor_trial; return n ? [n, 'slot:' + n] : []; }));
  for (const f of files.sort(byKey)) {
    const shard = f === 'recovery.json' ? null : f.slice(0, -'.recovery.json'.length);
    const cells = shard ? shards[shard]?.cells ?? [] : Object.keys(shards).length === 1 ? Object.values(shards)[0]!.cells ?? [] : [...new Set(records.map((t) => t.cell))];
    if (cells.length !== 1) throw new SpecError(f + ': its shard has ' + cells.length + ' cells (' + cells.join(', ') + '), so the spend no record holds cannot be given to one cell');
    const log = join(results, shard ? shard + '.proxy-usage.ndjson' : 'proxy-usage.ndjson');
    let spend: UnrecordedSpend;
    if (existsSync(log)) {
      const lines = readJsonLines<{ key: string; outcome?: string; actual_usd?: number; charged_reservation?: boolean }>(log).filter((l) => l.outcome !== 'estimated' && !keys.has(l.key));
      spend = { usd: sum(lines.map((l) => l.actual_usd ?? 0)), usd_reserved: sum(lines.filter((l) => l.charged_reservation).map((l) => l.actual_usd ?? 0)), source: log.slice(results.length + 1) + ': lines of no record' };
    } else {
      const usd = readJsonFile<{ spend?: { not_in_a_recovered_record_usd?: number } }>(join(results, f)).spend?.not_in_a_recovered_record_usd ?? 0;
      spend = { usd, usd_reserved: 0, source: f + ': spend.not_in_a_recovered_record_usd' };
    }
    if (spend.usd <= 0) continue;
    const prev = out[cells[0]!];
    out[cells[0]!] = prev ? { usd: prev.usd + spend.usd, usd_reserved: prev.usd_reserved + spend.usd_reserved, source: prev.source + '; ' + spend.source } : spend;
  }
  return out;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pts = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);
const ciPct = (c: [number, number] | null | undefined) => (c ? `[${pct(c[0])}, ${pct(c[1])}]` : '[no interval]');
const ciPts = (c: [number, number] | null | undefined) => (c ? `[${pts(c[0])}, ${pts(c[1])}]` : '[no interval]');
const usd = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(4)}`);
const ciUsd = (c: [number, number] | null | undefined) => (c ? `[${usd(c[0])}, ${usd(c[1])}]` : '[no interval]');
const times = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x.toFixed(2)}x`);
const ciTimes = (c: [number, number] | null | undefined) => (c ? `[${times(c[0])}, ${times(c[1])}]` : '[no interval]');
const pv = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(4));

export function renderMarkdown(a: FrontierAnalysis): string {
  const out: string[] = [`# Frontier harness analysis: ${a.run_id}`, ''];
  if (a.complete === false) out.push(`**Incomplete run.** ${a.trials_recorded} of ${a.trials_planned} planned trials recorded; ${a.trials_unstarted} never started. Reported from what exists; nothing was backfilled.`, '');
  out.push(`Method: ${a.method.estimator}. Seed ${a.method.seed}, ${a.method.draws} draws, alpha ${a.method.alpha}, non-inferiority margin ${(100 * a.method.ni_margin).toFixed(0)} points. harness_error counts as a fail; model_error, infra_error and exam_fault are excluded, counted per cell and dropped pairwise. ${a.lookup_fails} trial(s) confirmed as answer-key lookups count as fails. No ranks: rows and columns follow the spec.`, '');
  out.push('## Verdict tags', '', 'Each cell gets the first tag whose rule holds, in this order:', '');
  for (const [v, rule] of Object.entries(a.verdict_rules)) out.push(`- **${v}**: ${rule}.`);
  const harnesses = [...new Set(a.cells.map((c) => c.harness))];
  out.push('', '## Harness x model', '', 'Each cell: pass rate [95% CI]; cost per solve [95% CI]; median wall time (contended); verdict.', '');
  out.push(`| Harness | ${a.models.map((m) => m.label).join(' | ')} |`, `|---|${a.models.map(() => '---|').join('')}`);
  for (const h of harnesses) {
    const row = a.models.map((m) => {
      const c = a.cells.find((x) => x.harness === h && x.model === m.id);
      if (!c) return 'not run';
      return [`${c.pass_rate ? `${pct(c.pass_rate.estimate)} ${ciPct(c.pass_rate.ci95)}` : 'no scored trial'}`, `${c.cost.usd_per_solve === null ? 'no solve' : `${usd(c.cost.usd_per_solve)} per solve ${ciUsd(c.cost.ci95)}`}${c.cost.usd_reserved === undefined ? '' : ` (metered; ${usd(c.cost.usd_reserved)} charged at reservation left out)`}`,
        `${c.wall_s_median_contended === null ? 'n/a' : `${c.wall_s_median_contended.toFixed(1)} s`} median (contended)`, `**${c.verdict}**`].join('<br>');
    });
    out.push(`| ${h} | ${row.join(' | ')} |`);
  }
  out.push('', '## Pairs: cell minus home', '', 'Differences are in percentage points. The 90% lower bound is the bootstrap bound the non-inferiority test compares with the margin. Holm runs within each model across its primary pairs; extension pairs carry no test.', '');
  out.push('| Model | Cell | Home | Cell / home task mean | Difference [95% CI] | 90% lower bound | Tasks paired (dropped) | p (sign-flip) | Holm p | Non-inferiority p | Holm non-inferiority p | Harness flip [95% CI] | Cost-per-solve ratio [95% CI] | Verdict |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of a.pairs) {
    const c = a.cells.find((x) => x.id === p.cell)!;
    out.push(`| ${a.models.find((m) => m.id === p.model)!.label} | ${p.cell} | ${p.home} | ${pct(p.mean_cell)} / ${pct(p.mean_home)} | ${pts(p.delta)} ${ciPts(p.ci95)} | ${pts(p.lower_bound_90)} | ${p.tasks_paired} (${p.tasks_dropped}) | ${pv(p.p_two_sided)} | ${p.family === 'primary' ? pv(p.holm_p) : 'no test'} | ${pv(p.p_noninferiority)} | ${p.family === 'primary' ? pv(p.holm_p_noninferiority) : 'no test'} | ${p.harness_flip ? `${pct(p.harness_flip.estimate)} ${ciPct(p.harness_flip.ci95)}` : 'n/a'} | ${times(p.cost_per_solve_ratio.ratio)} ${ciTimes(p.cost_per_solve_ratio.ci95)} | ${c.verdict} |`);
  }
  const notes = a.pairs.filter((p) => p.power || !p.tested);
  if (notes.length) {
    out.push('', '### Power');
    for (const p of notes) out.push(`- ${p.id}: ${p.untested_reason ?? ''}${p.untested_reason && p.power ? '; ' : ''}${p.power ? `at alpha ${p.power.alpha}: ${p.power.note}` : ''}${p.power_first_holm_step ? `; at the first Holm step (alpha ${p.power_first_holm_step.alpha}): minimum detectable difference about ${pts(p.power_first_holm_step.mde)} points` : ''}.`);
  }
  out.push('', '## Noise: rerun flip and harness flip per model', '', 'Rerun flip: how often two attempts of the same harness disagree on a task. Harness flip: how often one attempt each of two harnesses disagree. Harness flip above rerun flip is disagreement the harness adds.', '');
  out.push('| Model | Rerun flip [95% CI] (tasks) | Harness flip [95% CI] (tasks) | Harness minus rerun |', '|---|---|---|---|');
  for (const m of a.models) {
    const r = m.noise.rerun_flip, h = m.noise.harness_flip;
    out.push(`| ${m.label} | ${r ? `${pct(r.estimate)} ${ciPct(r.ci95)} (${r.tasks})` : 'n/a (needs two attempts)'} | ${h ? `${pct(h.estimate)} ${ciPct(h.ci95)} (${h.tasks})` : 'n/a'} | ${pts(m.noise.harness_minus_rerun)} |`);
  }
  out.push('', '## Drift: home cell attempt 2 minus attempt 1', '', `Attempt 2 of each home cell runs interleaved with the main stage. Flagged when the difference is larger than the preregistered threshold (${a.method.drift_threshold === null ? 'none set' : `${pts(a.method.drift_threshold)} points`}).`, '');
  out.push('| Model | Home cell | Attempt 1 / attempt 2 | Difference [95% CI] | Tasks | Flag |', '|---|---|---|---|---|---|');
  for (const m of a.models) {
    const d = m.drift;
    out.push(`| ${m.label} | ${d.cell} | ${pct(d.attempt_1)} / ${pct(d.attempt_2)} | ${pts(d.delta)} ${ciPts(d.ci95)} | ${d.tasks} | ${d.exceeds === null ? 'n/a' : d.exceeds ? '**over threshold**' : 'within threshold'} |`);
  }
  out.push('', '## Reliability and exclusions per cell', '', '| Cell | k | pass^k [95% CI] | pass@k [95% CI] | Rerun flip [95% CI] | Tasks / scored trials | Excluded (model / infra / exam) | Harness errors as fails | Lookups as fails | Cap stops | Unstarted | USD total |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of a.cells) {
    const r = c.reliability;
    out.push(`| ${c.label} | ${r.k} | ${r.pass_hat_k ? `${pct(r.pass_hat_k.estimate)} ${ciPct(r.pass_hat_k.ci95)}` : 'n/a'} | ${r.pass_at_k ? `${pct(r.pass_at_k.estimate)} ${ciPct(r.pass_at_k.ci95)}` : 'n/a'} | ${c.rerun_flip ? `${pct(c.rerun_flip.estimate)} ${ciPct(c.rerun_flip.ci95)}` : 'n/a'} | ${c.pass_rate?.tasks ?? 0} / ${c.trials.scored} | ${c.trials.excluded.model_error} / ${c.trials.excluded.infra_error} / ${c.trials.excluded.exam_fault} | ${c.trials.harness_error_as_fail} | ${c.trials.lookup_fails} | ${c.trials.cap_stop} | ${c.trials.unstarted.length} | ${usd(c.cost.usd_total)}${c.cost.usd_reserved === undefined ? '' : ` metered + ${usd(c.cost.usd_reserved)} reserved`}${c.cost.unrecorded ? ` (includes ${usd(c.cost.unrecorded.usd)} in no record)` : ''} |`);
  }
  if (a.gstack?.length) {
    out.push('', '## gstack arms: exposure, opens and tokens', '', 'Per arm and model. Exposure counts every record; a mismatch (the first agent-loop request did not list exactly the lock\'s skills) is an infra_error and is excluded. Means and open rates are over scored trials. Listing bytes are the gstack entries of the first agent-loop request; opened-body tokens are the tool results that returned a SKILL.md or section file, each once.', '');
    out.push('| Arm | Model | Cells | Scored / recorded | Exposure ok / mismatch / n.a. | Saw a removed skill | Listing bytes (mean) | Opened-body tokens (mean) | Tokens per trial in / out (mean) | Skills opened (open rate) |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const g of a.gstack) {
      const label = a.models.find((m) => m.id === g.model)?.label ?? g.model;
      const opened = g.open_rate.filter((r) => r.trials > 0).sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0) || byKey(x.skill, y.skill));
      const never = g.open_rate.length - opened.length;
      out.push(`| ${g.arm} | ${label} | ${g.cells.join(', ')} | ${g.scored_trials} / ${g.trials} | ${g.exposure.ok} / ${g.exposure.mismatch} / ${g.exposure.not_applicable} | ${g.removed_seen_trials} | ${g.listing_bytes_mean ?? 'n/a'} | ${g.opened_body_tokens_mean ?? 'n/a'} | ${g.tokens_per_trial_mean.input ?? 'n/a'} / ${g.tokens_per_trial_mean.output ?? 'n/a'} | ${opened.length ? opened.map((r) => `${r.skill} ${pct(r.rate)} (${r.trials})`).join(', ') : 'none'}${never ? `; ${never} never opened` : ''} |`);
    }
  }
  const dropped = a.pairs.filter((p) => p.dropped.length);
  if (dropped.length) {
    out.push('', '## Tasks dropped from pairs');
    for (const p of dropped) out.push(`- ${p.id}: ${p.dropped.map((d) => `${d.task} (${d.reason})`).join('; ')}`);
  }
  if (a.model_swap) out.push(...renderModelSwap(a.model_swap));
  if (a.low_cost_swap) out.push(...renderLowCostSwap(a.low_cost_swap));
  return out.join('\n') + '\n';
}

// The gstack lift analysis (internal-task): one spec per gstack arm (installed, told), each holding the no-gstack cells and that
// arm's cells. The header describes the method.

export const GSTACK_SCHEMA = 'frontier-harbor-gstack-analysis/1';
export const GSTACK_ARMS = ['none', 'installed', 'told'] as const;
export type GstackArm = (typeof GSTACK_ARMS)[number];
export interface GstackModel { id: string; label?: string; model: string }
export interface GstackCell { id: string; model: string; harness: string; arm: GstackArm }
export interface GstackSpec {
  schema: typeof GSTACK_SCHEMA;
  run_id: string;
  seed?: number;
  draws?: number;
  alpha?: number;
  power?: number;
  min_paired_tasks?: number;
  /** The one-sided non-inferiority margin of reach-frontier, in pass-rate units (default 0.10). */
  ni_margin?: number;
  /** The lift difference is a primary family only when primary is true, set at preregistration from an expected MDD of at most mdd_limit (default 0.10). */
  lift_difference: { primary: boolean; mdd_limit?: number };
  target: string;
  frontier: string[];
  harnesses: string[];
  models: GstackModel[];
  cells: GstackCell[];
}
export interface GstackInput { records: TrialRecord[]; manifest: MatrixManifest | null; lookup_fails?: string[] }

/** The one gstack arm a spec's cells run beside none, or null when they run none or several. */
export function gstackArmOf(spec: GstackSpec): Exclude<GstackArm, 'none'> | null {
  const arms = [...new Set((spec.cells ?? []).map((c) => c.arm).filter((a) => a !== 'none'))];
  return arms.length === 1 && (arms[0] === 'installed' || arms[0] === 'told') ? arms[0] : null;
}

export function checkGstackSpec(spec: GstackSpec, manifest: MatrixManifest | null): string[] {
  const problems: string[] = [];
  if (spec.schema !== GSTACK_SCHEMA) problems.push(`schema must be ${GSTACK_SCHEMA}`);
  if (typeof spec.run_id !== 'string' || !spec.run_id) problems.push('run_id is missing');
  if (manifest && spec.run_id !== manifest.run_id) problems.push(`spec run_id ${spec.run_id} is not the manifest's ${manifest.run_id}`);
  const models = new Map((spec.models ?? []).map((m) => [m.id, m]));
  if (models.size !== (spec.models ?? []).length) problems.push('a model is listed twice');
  for (const m of spec.models ?? []) if (typeof m.model !== 'string' || !m.model.includes(':')) problems.push(`model ${m.id} needs its provider:name model id`);
  if (!models.has(spec.target)) problems.push(`target ${spec.target} is not a model of the spec`);
  if (!Array.isArray(spec.frontier) || !spec.frontier.length) problems.push('frontier is empty');
  for (const f of spec.frontier ?? []) if (!models.has(f) || f === spec.target) problems.push(`frontier model ${f} must be a model of the spec other than the target`);
  if (!Array.isArray(spec.harnesses) || !spec.harnesses.length || new Set(spec.harnesses).size !== spec.harnesses.length) problems.push('harnesses must be a list without repeats');
  const ids = new Set<string>();
  for (const c of spec.cells ?? []) {
    if (ids.has(c.id)) problems.push(`cell ${c.id} listed twice`);
    ids.add(c.id);
    if (!models.has(c.model)) problems.push(`cell ${c.id} names model ${c.model}, which the spec does not define`);
    if (!spec.harnesses?.includes(c.harness)) problems.push(`cell ${c.id} runs on ${c.harness}, which is not one of the spec's harnesses`);
    if (!GSTACK_ARMS.includes(c.arm)) problems.push(`cell ${c.id}: arm must be ${GSTACK_ARMS.join(', ')}`);
    if (manifest && !manifest.cells.some((x) => x.id === c.id)) problems.push(`cell ${c.id} is not in the run's manifest`);
  }
  if (!gstackArmOf(spec)) problems.push('the cells must run exactly one gstack arm (installed or told) beside none; write one spec per gstack arm');
  for (const m of [spec.target, ...(spec.frontier ?? [])]) for (const h of spec.harnesses ?? []) {
    const here = (spec.cells ?? []).filter((c) => c.model === m && c.harness === h);
    const none = here.filter((c) => c.arm === 'none').length;
    if (none !== 1 || here.length - none !== 1) problems.push(`model ${m} on ${h} needs one no-gstack cell and one gstack cell; the spec has ${none} and ${here.length - none}`);
  }
  if (spec.draws !== undefined && (!Number.isSafeInteger(spec.draws) || spec.draws < 1000)) problems.push('draws must be an integer of at least 1000');
  if (spec.alpha !== undefined && !(spec.alpha > 0 && spec.alpha < 0.5)) problems.push('alpha must be between 0 and 0.5');
  if (spec.power !== undefined && !(spec.power > 0 && spec.power < 1)) problems.push('power must be between 0 and 1');
  if (spec.ni_margin !== undefined && !(spec.ni_margin > 0 && spec.ni_margin < 1)) problems.push('ni_margin must be between 0 and 1');
  if (spec.min_paired_tasks !== undefined && (!Number.isSafeInteger(spec.min_paired_tasks) || spec.min_paired_tasks < 2)) problems.push('min_paired_tasks must be an integer of at least 2');
  if (typeof spec.lift_difference?.primary !== 'boolean') problems.push('lift_difference.primary must be true or false (true only when the preregistered MDD is at most lift_difference.mdd_limit)');
  if (spec.lift_difference?.mdd_limit !== undefined && !(spec.lift_difference.mdd_limit > 0 && spec.lift_difference.mdd_limit <= 1)) problems.push('lift_difference.mdd_limit must be in (0, 1]');
  return problems;
}

type TaskSide = Map<string, { passes: number; scored: number; usd: number }>;
interface LiftItem { task: string; harness: string; a: number; b: number }

/** A record's metered USD as analyzeFrontier counts it: its own and its lease-stopped first run's, less what was charged at a full reservation. */
const meteredUsd = (t: TrialRecord) => {
  const f = (t as { frontier?: FrontierUsd }).frontier;
  return Math.max((t.usage?.usd ?? 0) + (f?.first_run_usd ?? 0) - (t.usage?.usd_reserved ?? 0) - (f?.first_run_usd_reserved ?? 0), 0);
};
const reservedUsd = (t: TrialRecord) => (t.usage?.usd_reserved ?? 0) + ((t as { frontier?: FrontierUsd }).frontier?.first_run_usd_reserved ?? 0);

/** Per task, one cell's passes and scored trials (an excluded trial leaves only its own side) and its metered USD. */
function sideOf(rows: TrialRecord[], value: (t: TrialRecord) => 0 | 1 | null): TaskSide {
  const out: TaskSide = new Map();
  for (const t of rows) {
    const s = out.get(t.task) ?? { passes: 0, scored: 0, usd: 0 };
    const v = value(t);
    if (v !== null) { s.scored++; s.passes += v; }
    s.usd += meteredUsd(t);
    out.set(t.task, s);
  }
  return out;
}
const rateOf = (s: { passes: number; scored: number } | undefined) => (s && s.scored ? s.passes / s.scored : null);

/** Per harness and task, both sides' pass rates where both have a scored trial. */
function pairItems(harnesses: string[], a: (h: string) => TaskSide, b: (h: string) => TaskSide): LiftItem[] {
  return harnesses.flatMap((h) => {
    const x = a(h), y = b(h);
    return [...new Set([...x.keys(), ...y.keys()])].sort(byKey).flatMap((task) => {
      const p = rateOf(x.get(task)), q = rateOf(y.get(task));
      return p !== null && q !== null ? [{ task, harness: h, a: p, b: q }] : [];
    });
  });
}

/** One side's pass rate on the paired items: the mean of its per task and harness rates, with the tasks and trials behind it. */
function rateOn(items: LiftItem[], side: (h: string) => TaskSide) {
  const vals = items.map((i) => side(i.harness).get(i.task)!);
  return { estimate: vals.length ? round(mean(vals.map((v) => v.passes / v.scored))) : null, items: items.length, tasks: new Set(items.map((i) => i.task)).size, trials: sum(vals.map((v) => v.scored)) };
}

/** Paired cost per solve, b over a, by task (each task's paired harnesses summed), with its task bootstrap interval. */
function costOn(items: LiftItem[], a: (h: string) => TaskSide, b: (h: string) => TaskSide, opts: { seed: number; draws: number }) {
  const byTask = new Map<string, { task: string; usd_a: number; solves_a: number; usd_b: number; solves_b: number }>();
  for (const i of items) {
    const x = a(i.harness).get(i.task)!, y = b(i.harness).get(i.task)!;
    const t = byTask.get(i.task) ?? { task: i.task, usd_a: 0, solves_a: 0, usd_b: 0, solves_b: 0 };
    t.usd_a += x.usd; t.solves_a += x.passes; t.usd_b += y.usd; t.solves_b += y.passes;
    byTask.set(i.task, t);
  }
  const r = pairedCostRatio([...byTask.values()], opts);
  return { tasks: r.tasks, ratio: round(r.ratio, 4), ci95: roundCi(r.ci95, 4), undefined_draws: r.undefined_draws, note: r.note };
}

/** b minus a over the items, the harness a stratum and the task the cluster, with the tasks better, worse and the same. */
function liftReading(items: LiftItem[], opts: { seed: number; draws: number }) {
  const stats = items.length ? clusteredPairedDelta(items.map((i) => ({ id: i.task + '/' + i.harness, cluster: i.task, a: i.a, b: i.b })), opts) : null;
  const byTask = new Map<string, number[]>();
  for (const i of items) byTask.set(i.task, [...(byTask.get(i.task) ?? []), i.b - i.a]);
  const d = [...byTask.values()].map(mean);
  return { stats, tasks: byTask.size, items: items.length, mean_a: round(stats?.mean_a), mean_b: round(stats?.mean_b), delta: round(stats?.delta), ci95: roundCi(stats?.ci95),
    p_two_sided: stats ? round(stats.p_two_sided, 8) : null, tasks_better: d.filter((x) => x > 1e-12).length, tasks_worse: d.filter((x) => x < -1e-12).length, tasks_same: d.filter((x) => Math.abs(x) <= 1e-12).length };
}

export const NOT_TESTED = 'not tested';

/** The gstack lift analysis and, per model, the paired statistics behind its lift (interim.ts reads their bootstrap draws). */
export function analyzeGstackWithStats(input: GstackInput, spec: GstackSpec) {
  const problems = checkGstackSpec(spec, input.manifest);
  if (problems.length) throw new SpecError(problems.join('; '));
  const invalid = validateRecords(input.records, input.manifest);
  if (invalid.length) throw new SpecError('trials.jsonl fails the input check: ' + invalid.slice(0, 10).join('; ') + (invalid.length > 10 ? '; ...' : ''));
  const foreign = input.records.filter((t) => !t.trial_id.startsWith(spec.run_id + '/'));
  if (foreign.length) throw new SpecError(`${foreign.length} record(s) are not trials of ${spec.run_id}, for example ${foreign[0]!.trial_id}`);
  const seed = spec.seed ?? 7, draws = spec.draws ?? 10_000, alpha = spec.alpha ?? 0.05, power = spec.power ?? 0.8, minPaired = spec.min_paired_tasks ?? 10;
  const margin = spec.ni_margin ?? 0.1, mddLimit = spec.lift_difference.mdd_limit ?? 0.1;
  const opts = { seed, draws };
  const arm = gstackArmOf(spec)!;
  const lookups = new Set(input.lookup_fails ?? []);
  const known = new Set(input.records.map((t) => t.trial_id));
  const unknown = [...lookups].filter((id) => !known.has(id));
  if (unknown.length) throw new SpecError(`--lookup-fails names ${unknown.length} trial(s) with no record: ${unknown.slice(0, 5).join(', ')}`);
  const modelOf = new Map(spec.models.map((m) => [m.id, m]));
  const label = (m: string) => modelOf.get(m)!.label ?? m;
  const rowsOf = new Map(spec.cells.map((c) => [c.id, input.records.filter((t) => t.cell === c.id)]));
  for (const c of spec.cells) for (const t of rowsOf.get(c.id)!) {
    const want = modelOf.get(c.model)!.model;
    if (t.harness !== c.harness || t.model !== want) throw new SpecError(`trial ${t.trial_id} ran ${t.model} on ${t.harness}; cell ${c.id} is ${want} on ${c.harness}`);
  }
  const value = (t: TrialRecord): 0 | 1 | null => { if (t.termination === 'timeout') return 0; const v = trialValue(t); return v === 1 && lookups.has(t.trial_id) ? 0 : v; };
  const cellFor = (m: string, h: string, armed: boolean) => spec.cells.find((c) => c.model === m && c.harness === h && (c.arm !== 'none') === armed)!;
  const sides = new Map(spec.cells.map((c) => [c.id, sideOf(rowsOf.get(c.id)!, value)]));
  const get = (m: string, h: string, armed: boolean) => sides.get(cellFor(m, h, armed).id)!;
  const cellIds = (m: string, armed: boolean) => spec.harnesses.map((h) => cellFor(m, h, armed).id);

  const measure = (items: LiftItem[], family: number) => {
    const { stats, ...r } = liftReading(items, opts);
    const note = stats ? powerNote(stats, { alpha, power }) : null;
    const noteHolm = stats ? powerNote(stats, { alpha: alpha / family, power }) : null;
    return { stats, row: { ...r, tested: r.tasks >= minPaired, mdd: round(note?.mde), mdd_first_holm_step: round(noteHolm?.mde), power_note: note?.note ?? 'no paired task',
      per_harness: spec.harnesses.map((h) => { const { stats: _s, ...x } = liftReading(items.filter((i) => i.harness === h), opts); return { harness: h, ...x }; }) } };
  };
  const holm = (ps: Array<number | null>, tested: boolean[]) => holmAdjusted(ps.map((p, i) => (tested[i] && p !== null ? p : 1))).map((p) => round(p, 8)!);

  const lifted = [spec.target, ...spec.frontier];
  const liftStats: Record<string, PairedDelta | null> = {};
  const lift = lifted.map((m) => {
    const none = (h: string) => get(m, h, false), armed = (h: string) => get(m, h, true);
    const items = pairItems(spec.harnesses, none, armed);
    const { stats, row } = measure(items, lifted.length);
    liftStats[m] = stats;
    return { id: `lift ${m}`, model: m, cells: { none: cellIds(m, false), gstack: cellIds(m, true) }, ...row,
      rates: { none: rateOn(items, none), gstack: rateOn(items, armed) }, cost_per_solve_ratio: costOn(items, none, armed, opts), holm_p: null as number | null, label: '' };
  });
  holm(lift.map((r) => r.p_two_sided), lift.map((r) => r.tested)).forEach((p, i) => {
    const r = lift[i]!;
    r.holm_p = p;
    r.label = !r.tested ? NOT_TESTED : p <= alpha && r.delta! > 0 ? 'helps' : p <= alpha && r.delta! < 0 ? 'hurts' : 'no measurable difference';
  });

  const difference = spec.frontier.map((f) => {
    const items = spec.harnesses.flatMap((h) => {
      const four = [get(f, h, false), get(f, h, true), get(spec.target, h, false), get(spec.target, h, true)];
      return [...new Set(four.flatMap((s) => [...s.keys()]))].sort(byKey).flatMap((task) => {
        const v = four.map((s) => rateOf(s.get(task)));
        return v.every((x) => x !== null) ? [{ task, harness: h, a: v[1]! - v[0]!, b: v[3]! - v[2]! }] : [];
      });
    });
    const { row } = measure(items, spec.frontier.length);
    return { id: `lift difference ${spec.target} minus ${f}`, frontier: f, ...row,
      rates: { [`${f} none`]: rateOn(items, (h) => get(f, h, false)), [`${f} gstack`]: rateOn(items, (h) => get(f, h, true)),
        [`${spec.target} none`]: rateOn(items, (h) => get(spec.target, h, false)), [`${spec.target} gstack`]: rateOn(items, (h) => get(spec.target, h, true)) },
      mdd_within_limit: row.mdd === null ? null : row.mdd <= mddLimit + 1e-12, holm_p: null as number | null, label: '' };
  });
  holm(difference.map((r) => r.p_two_sided), difference.map((r) => r.tested)).forEach((p, i) => {
    const r = difference[i]!;
    r.holm_p = p;
    r.label = !r.tested ? NOT_TESTED : p <= alpha && r.delta! > 0 ? `larger lift for ${label(spec.target)}` : p <= alpha && r.delta! < 0 ? `smaller lift for ${label(spec.target)}` : 'no measurable difference';
  });

  const reach = spec.frontier.map((f) => {
    const none = (h: string) => get(f, h, false), armed = (h: string) => get(spec.target, h, true);
    const items = pairItems(spec.harnesses, none, armed);
    const { stats, row } = measure(items, spec.frontier.length);
    return { id: `${spec.target} with gstack vs ${f} without`, frontier: f, cells: { frontier_none: cellIds(f, false), target_gstack: cellIds(spec.target, true) }, ...row,
      rates: { [`${f} none`]: rateOn(items, none), [`${spec.target} gstack`]: rateOn(items, armed) },
      ni_margin: margin, lower_bound: stats ? round(bootstrapLowerBound(stats, alpha)) : null,
      p_noninferiority: stats ? round(nonInferiorityP(stats, margin, 'higher'), 8) : null, p_superiority: stats ? round(superiorityP(stats, 0, 'higher'), 8) : null,
      cost_per_solve_ratio: costOn(items, none, armed, opts), holm_p_noninferiority: null as number | null, holm_p_superiority: null as number | null, label: '' };
  });
  const ni = holm(reach.map((r) => r.p_noninferiority), reach.map((r) => r.tested)), sup = holm(reach.map((r) => r.p_superiority), reach.map((r) => r.tested));
  reach.forEach((r, i) => {
    r.holm_p_noninferiority = ni[i]!;
    r.holm_p_superiority = sup[i]!;
    r.label = !r.tested ? NOT_TESTED : sup[i]! <= alpha ? 'better' : ni[i]! <= alpha ? `within ${Math.round(100 * margin)} points` : 'not shown';
  });

  const recorded = new Set(input.records.map((t) => t.trial_id));
  const cells = spec.cells.map((c) => {
    const rows = rowsOf.get(c.id)!, side = sides.get(c.id)!;
    const rate = taskBootstrapMean([...side.values()].filter((s) => s.scored).map((s) => s.passes / s.scored), opts);
    const terminations = Object.fromEntries(TERMINATIONS.map((k) => [k, rows.filter((t) => t.termination === k).length])) as Record<Termination, number>;
    const unstarted = input.manifest ? input.manifest.trials.filter((t) => t.cell === c.id && !recorded.has(t.id)).map((t) => t.id) : [];
    return { id: c.id, model: c.model, harness: c.harness, arm: c.arm,
      pass_rate: rate ? { estimate: round(rate.estimate)!, ci95: roundCi(rate.ci95), tasks: rate.n, scored_trials: sum([...side.values()].map((s) => s.scored)) } : null,
      trials: rows.length, terminations, excluded: { model_error: terminations.model_error, infra_error: terminations.infra_error, exam_fault: terminations.exam_fault },
      harness_error_as_fail: terminations.harness_error, timeout_as_fail: terminations.timeout, lookup_fails: rows.filter((t) => lookups.has(t.trial_id) && t.termination !== 'timeout' && trialValue(t) === 1).length,
      usd_total: round(sum(rows.map(meteredUsd)))!, usd_reserved: round(sum(rows.map(reservedUsd)))!, unstarted };
  });
  const unstarted = sum(cells.map((c) => c.unstarted.length));
  const analysis = {
    schema: GSTACK_SCHEMA, run_id: spec.run_id, arm, target: spec.target, frontier: spec.frontier, harnesses: spec.harnesses, models: spec.models,
    method: {
      estimator: "per task and harness, the mean pass of each side's scored trials; differences pooled over the harnesses (a stratum) with runner/stats/paired.ts clusteredPairedDelta clustered by task: task-clustered bootstrap 95% intervals and task-level sign-flip p",
      seed, draws, alpha, power, min_paired_tasks: minPaired, ni_margin: margin, lift_difference_primary: spec.lift_difference.primary, lift_difference_mdd_limit: mddLimit,
      scoring: 'a trial passes when its verifier reward is 1 (grade pass) with no consent violation; harness_error is a fail, and so is an agent timeout whatever its grade; model_error, infra_error and exam_fault are excluded, counted per cell, and drop only their own side: the other side of the task keeps its scored trials, and a task and harness leaves a comparison only when a side has no scored trial there; a confirmed answer-key lookup is a fail',
      untested: `a comparison with fewer than ${minPaired} paired tasks is ${NOT_TESTED} and counts as p = 1 in its Holm family`,
      mdd: `the run's own minimum detectable difference at ${Math.round(100 * power)}% power, from the comparison's cluster-robust standard error (runner/stats/paired.ts powerNote), at alpha and at the first Holm step of its family`,
      cost: "paired cost per solve on the paired tasks: each side's metered USD (excluded trials included; dollars charged at a full reservation left out) over its scored passes, with a task bootstrap interval",
      families: `Holm over ${lifted.length} lifts; Holm over ${spec.frontier.length} lift differences (${spec.lift_difference.primary ? 'primary' : 'secondary'}); Holm over ${spec.frontier.length} reach-frontier non-inferiority p at ${Math.round(100 * margin)} points and separately over their superiority p`,
    },
    trials_recorded: input.records.filter((t) => rowsOf.has(t.cell)).length, trials_unstarted: unstarted, complete: input.manifest ? unstarted === 0 : null, lookup_fails: lookups.size,
    cells, lift, lift_difference: { family: spec.lift_difference.primary ? 'primary' as const : 'secondary' as const, mdd_limit: mddLimit, rows: difference }, reach,
  };
  return { analysis, lift_stats: liftStats };
}

export const analyzeGstack = (input: GstackInput, spec: GstackSpec) => analyzeGstackWithStats(input, spec).analysis;
export type GstackAnalysis = ReturnType<typeof analyzeGstack>;

export function renderGstackMarkdown(a: GstackAnalysis): string {
  const label = (m: string) => a.models.find((x) => x.id === m)?.label ?? m;
  const out: string[] = [`# gstack lift analysis: ${a.run_id}, arm ${a.arm}`, ''];
  if (a.complete === false) out.push(`**Incomplete run.** ${a.trials_unstarted} planned trial(s) never started. Reported from what exists; nothing was backfilled.`, '');
  out.push(`Method: ${a.method.estimator}. Seed ${a.method.seed}, ${a.method.draws} draws, alpha ${a.method.alpha}. Scoring: ${a.method.scoring}. ${a.method.families}. MDD: ${a.method.mdd}. Untested: ${a.method.untested}. No ranks.`, '');
  const rate = (r: { estimate: number | null; tasks: number; trials: number }) => `${pct(r.estimate)} (${r.tasks} tasks, ${r.trials} trials)`;
  out.push(`## Lift per model: gstack ${a.arm} minus no gstack`, '', 'Percentage points, pooled over the harnesses. Holm across the models.', '');
  out.push('| Model | No gstack | gstack | Lift [95% CI] | Tasks better / worse / same | p | Holm p | MDD (first Holm step) | Cost-per-solve ratio [95% CI] | Reading |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of a.lift) out.push(`| ${label(r.model)} | ${rate(r.rates.none)} | ${rate(r.rates.gstack)} | ${pts(r.delta)} ${ciPts(r.ci95)} | ${r.tasks_better} / ${r.tasks_worse} / ${r.tasks_same} | ${pv(r.p_two_sided)} | ${pv(r.holm_p)} | ${pts(r.mdd)} (${pts(r.mdd_first_holm_step)}) | ${times(r.cost_per_solve_ratio.ratio)} ${ciTimes(r.cost_per_solve_ratio.ci95)} | **${r.label}** |`);
  const ld = a.lift_difference;
  out.push('', `## Lift difference: ${label(a.target)}'s lift minus each frontier model's (${ld.family})`, '', `Per task and harness from the four cells. Holm across the frontier models. Primary only when the preregistered MDD is at most ${Math.round(100 * ld.mdd_limit)} points.`, '');
  out.push('| Comparison | Difference [95% CI] | Tasks better / worse / same | p | Holm p | MDD (first Holm step) | Reading |', '|---|---|---|---|---|---|---|');
  for (const r of ld.rows) out.push(`| ${r.id} | ${pts(r.delta)} ${ciPts(r.ci95)} | ${r.tasks_better} / ${r.tasks_worse} / ${r.tasks_same} | ${pv(r.p_two_sided)} | ${pv(r.holm_p)} | ${pts(r.mdd)} (${pts(r.mdd_first_holm_step)})${r.mdd_within_limit === false ? ' over the limit' : ''} | **${r.label}** |`);
  out.push('', `## Reach frontier: ${label(a.target)} with gstack against each frontier model without`, '', `One-sided non-inferiority at ${a.reach[0] ? Math.round(100 * a.reach[0].ni_margin) : 10} points and superiority, each Holm across the frontier models. Same harness, pooled.`, '');
  out.push('| Comparison | Frontier, no gstack | Target, gstack | Difference [95% CI] | 90% lower bound | Tasks better / worse / same | Holm non-inferiority p | Holm superiority p | Cost-per-solve ratio [95% CI] | Reading |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of a.reach) {
    const [f, t] = Object.values(r.rates);
    out.push(`| ${r.id} | ${rate(f!)} | ${rate(t!)} | ${pts(r.delta)} ${ciPts(r.ci95)} | ${pts(r.lower_bound)} | ${r.tasks_better} / ${r.tasks_worse} / ${r.tasks_same} | ${pv(r.holm_p_noninferiority)} | ${pv(r.holm_p_superiority)} | ${times(r.cost_per_solve_ratio.ratio)} ${ciTimes(r.cost_per_solve_ratio.ci95)} | **${r.label}** |`);
  }
  out.push('', '## Per-harness readings (secondary, no test)', '', '| Comparison | Harness | Side A / side B (the two lifts for a lift difference) | Difference [95% CI] | Tasks better / worse / same |', '|---|---|---|---|---|');
  for (const r of [...a.lift, ...ld.rows, ...a.reach]) for (const h of r.per_harness) out.push(`| ${r.id} | ${h.harness} | ${pct(h.mean_a)} / ${pct(h.mean_b)} | ${pts(h.delta)} ${ciPts(h.ci95)} | ${h.tasks_better} / ${h.tasks_worse} / ${h.tasks_same} |`);
  out.push('', '## Cells', '', '| Cell | Model | Harness | Arm | Pass rate [95% CI] (tasks / scored trials) | Excluded (model / infra / exam) | Harness errors as fails | Unstarted | Metered USD |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of a.cells) out.push(`| ${c.id} | ${label(c.model)} | ${c.harness} | ${c.arm} | ${c.pass_rate ? `${pct(c.pass_rate.estimate)} ${ciPct(c.pass_rate.ci95)} (${c.pass_rate.tasks} / ${c.pass_rate.scored_trials})` : 'no scored trial'} | ${c.excluded.model_error} / ${c.excluded.infra_error} / ${c.excluded.exam_fault} | ${c.harness_error_as_fail} | ${c.unstarted.length} | ${usd(c.usd_total)} |`);
  return out.join('\n') + '\n';
}

export interface MddOptions { tasks: number; attempts: number; baseline_attempts: number; alpha: number; power: number; harnesses: string[]; lift_sd: number }

/** The expected minimum detectable lift and lift difference of a planned gstack run, from the per-task pass variance of
 *  existing results: per model and harness, the cell with the most tasks; per task the unbiased Bernoulli variance
 *  k(n - k) / (n(n - 1)) of its scored attempts (tasks with one scored attempt are left out), averaged over tasks (v).
 *  The pooled lift's standard error at T tasks, H harnesses, a gstack attempts and b no-gstack attempts per task, with
 *  the gstack arm's variance equal to the no-gstack arm's, is sqrt(sum_h v_h (1/a + 1/b) / (T H^2) + s^2 / T), where s
 *  is the SD across tasks of the true lift (lift_sd); the MDD is (z(1 - alpha/2) + z(power)) times it, at alpha and at
 *  the first Holm step. The lift difference adds the two models' variances. A model with no results (the target) is shown
 *  at the worst case, v = 0.25 on every task, and at the frontier model's own variance. */
export function expectedMdd(records: TrialRecord[], o: MddOptions, lookups: Set<string> = new Set()) {
  const z = (a: number) => normalQuantile(1 - a / 2) + normalQuantile(o.power);
  const H = o.harnesses.length;
  const se = (vsum: number, s: number) => Math.sqrt((vsum * (1 / o.attempts + 1 / o.baseline_attempts)) / (o.tasks * H * H) + (s * s) / o.tasks);
  const byCell = new Map<string, TrialRecord[]>();
  for (const t of records) if (o.harnesses.includes(t.harness)) byCell.set(t.cell, [...(byCell.get(t.cell) ?? []), t]);
  const chosen = new Map<string, { cell: string; rows: TrialRecord[] }>();
  for (const [cell, rows] of [...byCell.entries()].sort(([x, a], [y, b]) => new Set(b.map((t) => t.task)).size - new Set(a.map((t) => t.task)).size || byKey(x, y))) {
    const key = rows[0]!.model + '/' + rows[0]!.harness;
    if (!chosen.has(key)) chosen.set(key, { cell, rows });
  }
  const value = (t: TrialRecord) => { const v = trialValue(t); return v === 1 && lookups.has(t.trial_id) ? 0 : v; };
  const variances = [...chosen.values()].map(({ cell, rows }) => {
    const multi = [...sideOf(rows, value).values()].filter((s) => s.scored >= 2);
    const vs = multi.map((s) => (s.passes * (s.scored - s.passes)) / (s.scored * (s.scored - 1)));
    return { cell, model: rows[0]!.model, harness: rows[0]!.harness, tasks: vs.length, mean_attempts: multi.length ? round(mean(multi.map((s) => s.scored)), 2) : null, variance: vs.length ? round(mean(vs))! : null };
  });
  const models = [...new Set(variances.map((v) => v.model))].sort(byKey).filter((m) => o.harnesses.every((h) => variances.some((v) => v.model === m && v.harness === h && v.variance !== null)));
  const vsumOf = (m: string) => sum(o.harnesses.map((h) => variances.find((v) => v.model === m && v.harness === h)!.variance!));
  const mdd = (vsum: number, family: number) => ({
    mdd: round(z(o.alpha) * se(vsum, 0)), first_holm_step: round(z(o.alpha / family) * se(vsum, 0)),
    with_lift_sd: round(z(o.alpha) * se(vsum, o.lift_sd)), with_lift_sd_first_holm_step: round(z(o.alpha / family) * se(vsum, o.lift_sd)),
  });
  const liftFamily = models.length + 1, diffFamily = models.length;
  const worst = 0.25 * H;
  return {
    design: o, variances,
    lift: [...models.map((m) => ({ model: m, variance_sum: round(vsumOf(m)), ...mdd(vsumOf(m), liftFamily) })),
      { model: 'target at worst case (v = 0.25 per task)', variance_sum: round(worst), ...mdd(worst, liftFamily) }],
    lift_difference: models.flatMap((m) => [
      { comparison: `target (worst case) minus ${m}`, variance_sum: round(worst + vsumOf(m)), ...mdd(worst + vsumOf(m), diffFamily) },
      { comparison: `target (with ${m}'s variance) minus ${m}`, variance_sum: round(2 * vsumOf(m)), ...mdd(2 * vsumOf(m), diffFamily) },
    ]),
  };
}

export function renderMdd(m: ReturnType<typeof expectedMdd>): string {
  const d = m.design;
  const out = [`Expected MDD at ${d.tasks} tasks, ${d.harnesses.join(' + ')} pooled, ${d.attempts} gstack and ${d.baseline_attempts} no-gstack attempts per task, alpha ${d.alpha}, ${Math.round(100 * d.power)}% power; normal approximation to the paired task-clustered test. Percentage points.`, ''];
  out.push('| Cell | Model | Harness | Tasks with 2+ scored attempts | Mean attempts | Mean per-task variance |', '|---|---|---|---|---|---|');
  for (const v of m.variances) out.push(`| ${v.cell} | ${v.model} | ${v.harness} | ${v.tasks} | ${v.mean_attempts ?? 'n/a'} | ${v.variance ?? 'n/a'} |`);
  const cols = `| MDD | MDD, first Holm step | MDD, true-lift SD ${Math.round(100 * d.lift_sd)} points | same, first Holm step |`;
  const vals = (r: { mdd: number | null; first_holm_step: number | null; with_lift_sd: number | null; with_lift_sd_first_holm_step: number | null }) => [r.mdd, r.first_holm_step, r.with_lift_sd, r.with_lift_sd_first_holm_step].map(pts).join(' | ');
  out.push('', '| Lift of | Variance sum ' + cols, '|---|---|---|---|---|---|');
  for (const r of m.lift) out.push(`| ${r.model} | ${r.variance_sum} | ${vals(r)} |`);
  out.push('', '| Lift difference | Variance sum ' + cols, '|---|---|---|---|---|---|');
  for (const r of m.lift_difference) out.push(`| ${r.comparison} | ${r.variance_sum} | ${vals(r)} |`);
  return out.join('\n') + '\n';
}

function lookupList(file: string): string[] {
  const v = readJsonFile<unknown>(file);
  const ids = Array.isArray(v) ? v : (v as { trial_ids?: unknown })?.trial_ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new SpecError(`${file} must be a JSON list of trial ids or { "trial_ids": [...] }`);
  return ids as string[];
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const results = arg('results'), specPath = arg('spec'), out = arg('out') ?? results, lookupFile = arg('lookup-fails'), withReplaced = process.argv.includes('--cost-with-replaced');
  if (process.argv[2] === 'mdd') {
    if (!results || !existsSync(join(results, 'trials.jsonl'))) {
      console.error('usage: bun scripts/frontier-harbor/analyze.ts mdd --results <results dir with trials.jsonl> [--lookup-fails <file>] [--tasks 52] [--attempts 3] [--baseline-attempts 3] [--alpha 0.05] [--power 0.8] [--harnesses hermes,openclaw] [--lift-sd 0.1] [--json <file>]');
      process.exit(2);
    }
    const num = (n: string, d: number) => (arg(n) === undefined ? d : Number(arg(n)));
    const m = expectedMdd(readJsonLines<TrialRecord>(join(results, 'trials.jsonl')), { tasks: num('tasks', 52), attempts: num('attempts', 3), baseline_attempts: num('baseline-attempts', 3),
      alpha: num('alpha', 0.05), power: num('power', 0.8), harnesses: (arg('harnesses') ?? 'hermes,openclaw').split(','), lift_sd: num('lift-sd', 0.1) }, new Set(lookupFile ? lookupList(lookupFile) : []));
    if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(m, null, 1) + '\n');
    process.stdout.write(renderMdd(m));
    process.exit(0);
  }
  if (!results || !specPath || !existsSync(join(results, 'trials.jsonl')) || !existsSync(specPath)) {
    console.error('usage: bun scripts/frontier-harbor/analyze.ts --results <merged results dir with trials.jsonl> --spec <spec.json> [--out <dir>] [--lookup-fails <file>] [--cost-with-replaced] [--shard-results <shard results dir> ...]');
    process.exit(2);
  }
  let analysis: FrontierAnalysis & { truncation_recovery?: unknown };
  let original: FrontierAnalysis | null = null;
  let recoveryMd = '';
  try {
    const manifest = existsSync(join(results, 'manifest.json')) ? readJsonFile<MatrixManifest>(join(results, 'manifest.json')) : null;
    if (manifest?.sealed) { console.error(`analyze: ${results} was planned with a sealed root; this script prints task ids and does not run on sealed results`); process.exit(2); }
    const records = readJsonLines<TrialRecord>(join(results, 'trials.jsonl'));
    const spec = readJsonFile<FrontierSpec>(specPath);
    if ((spec as { schema?: unknown }).schema === GSTACK_SCHEMA) {
      const g = analyzeGstack({ records, manifest, lookup_fails: lookupFile ? lookupList(lookupFile) : [] }, spec as unknown as GstackSpec);
      mkdirSync(out!, { recursive: true });
      writeFileSync(join(out!, 'gstack-analysis.json'), JSON.stringify(g, null, 1) + '\n');
      writeFileSync(join(out!, 'gstack-analysis.md'), renderGstackMarkdown(g));
      console.log(`GSTACK_ANALYSIS: ${g.run_id} arm ${g.arm}: ${g.lift.length} lifts, ${g.lift_difference.rows.length} lift differences, ${g.reach.length} reach comparisons, ${g.trials_recorded} trials recorded${g.complete === false ? `, incomplete (${g.trials_unstarted} unstarted)` : ''}; wrote ${join(out!, 'gstack-analysis.json')} and gstack-analysis.md`);
      process.exit(0);
    }
    const input = { records, manifest, lookup_fails: lookupFile ? lookupList(lookupFile) : [], cost_with_replaced: withReplaced, unrecorded: unrecordedSpend(results, records) };
    if (spec.truncation_recovery === 'amendment-6') {
      const tr = await import(join(import.meta.dir, 'truncation-recovery.ts'));
      ({ analysis, original } = tr.analyzeWithTruncationRecovery(input, spec, tr.applyTruncationRecovery(records, results, undefined, process.argv.flatMap((x, i) => (process.argv[i - 1] === '--shard-results' ? [x] : [])))));
      recoveryMd = tr.renderTruncationRecovery(analysis.truncation_recovery);
    } else analysis = analyzeFrontier(input, spec);
  } catch (e) {
    if (e instanceof SpecError) { console.error(`analyze: refused: ${e.message}`); process.exit(2); }
    if (e instanceof RunnerError) { console.error(`analyze: ${e.message}`); process.exit(2); }
    throw e;
  }
  mkdirSync(out!, { recursive: true });
  writeFileSync(join(out!, 'analysis.json'), JSON.stringify(analysis, null, 1) + '\n');
  writeFileSync(join(out!, 'analysis.md'), renderMarkdown(analysis) + recoveryMd);
  if (original) {
    writeFileSync(join(out!, 'analysis-original-rule.json'), JSON.stringify(original, null, 1) + '\n');
    writeFileSync(join(out!, 'analysis-original-rule.md'), '> The original rule, before amendment 6: every effort_mismatch trial is an infra_error, excluded pairwise.\n\n' + renderMarkdown(original));
  }
  console.log(`FRONTIER_ANALYSIS: ${analysis.run_id}: ${analysis.cells.length} cells, ${analysis.pairs.length} pairs, ${analysis.trials_recorded} trials recorded${analysis.complete === false ? `, incomplete (${analysis.trials_unstarted} unstarted)` : ''}; wrote ${join(out!, 'analysis.json')} and analysis.md`);
}
