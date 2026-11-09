#!/usr/bin/env bun
// The harness x model analysis of a frontier Harbor run: pass rates, the noise view, reliability, the paired comparisons
// with the home harness, cost per solve and the results table.
//
//   bun scripts/frontier-harbor/analyze.ts --results <merged results dir> --spec <spec.json> [--out <dir>]
//       [--lookup-fails <file>] [--cost-with-replaced]
//
// Reads <results>/trials.jsonl (runner/contracts.ts TrialRecord) and <results>/manifest.json when it exists. Writes
// analysis.json and analysis.md to --out (default: the results directory). Intervals, never ranks.
//
// Scoring. A trial passes when grade is pass with no consent violation (scripts/matrix-analysis.ts trialValue):
// harness_error is a fail; model_error, infra_error and exam_fault are excluded and counted per cell. A trial named in
// --lookup-fails (a JSON list of trial ids, or { "trial_ids": [...] }: the trials a blind reader confirmed received the
// answer key, from scripts/frontier-harbor/audit.ts) is a fail whatever its grade.
//
// Per cell: the pass rate is the task mean (each task's mean over its scored attempts, then the mean over tasks) with a
// task-clustered percentile bootstrap interval; rerun flip 2k(n-k)/(n(n-1)) per task with two or more scored attempts,
// averaged over tasks; pass^k and pass@k with k the cell's planned attempts, over tasks with k scored attempts; cost per
// solve, the cell's recorded USD (excluded trials included, and the first run of a rerun its lease stopped, merge-stages.ts frontier.first_run_usd; with --cost-with-replaced, also each run a rerun replaced) over its scored passes, with a task bootstrap interval; and
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
//
// Spec: { "run_id": "...", "seed": 7, "draws": 10000, "alpha": 0.05, "saturated_at": 0.95, "min_paired_tasks": 10,
//         "primary_pairs": { "<model id>": 3 }, "drift_threshold": 0.1,
//         "models": [{ "id": "opus", "label": "Opus 5.5", "home": "<cell id>" }],
//         "cells": [{ "id": "<cell id>", "model": "opus", "harness": "hermes", "attempts": 2, "descriptive": false }] }

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Termination, TrialRecord } from '../../runner/contracts.ts';
import { RunnerError } from '../../runner/errors.ts';
import { readJsonFile, readJsonLines } from '../../runner/heldout/sealed.ts';
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, powerNote, type PairedDelta } from '../../runner/stats/paired.ts';
import { bootstrapLowerBound, costPerSolve, harnessFlip, pairedCostRatio, passAtK, passHatK, rerunFlip, taskBootstrapMean, type MeanInterval } from '../../runner/stats/frontier.ts';
import { checkRecords, TERMINATIONS, trialValue, type MatrixManifest } from '../matrix-analysis.ts';

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
}
export interface FrontierInput { records: TrialRecord[]; manifest: MatrixManifest | null; lookup_fails?: string[]; cost_with_replaced?: boolean }

export class SpecError extends Error {}

/** The non-inferiority margin, in pass-rate units: 15 percentage points. */
export const NI_MARGIN = 0.15;
export const VERDICTS = ['home', 'incomplete', 'descriptive', 'behind', 'within-15', 'saturated', 'inconclusive'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_RULES: Record<Verdict, string> = {
  home: "the model's home harness; every other cell of the model is compared with it",
  incomplete: 'the cell or its home cell has a planned trial with no record, or the pair has fewer than min_paired_tasks (10 by default) tasks with an attempt scored in both cells: reported from what exists, no claim',
  descriptive: 'an extension cell (descriptive in the spec, for example one attempt per task): estimate and intervals only, no test and no non-inferiority claim',
  behind: "a primary pair whose two-sided task-level sign-flip p, Holm-adjusted across the model's primary pairs, is at or below alpha with the cell below its home",
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
  usdByTask: Map<string, number>;
  unstarted: string[];
}

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
  if (input.manifest) {
    const recordProblems = checkRecords(input.records, input.manifest);
    if (recordProblems.length) throw new SpecError(`trials.jsonl disagrees with the manifest: ${recordProblems.slice(0, 10).join('; ')}${recordProblems.length > 10 ? '; ...' : ''}`);
  } else {
    const ids = new Set<string>();
    for (const t of input.records) { if (ids.has(t.trial_id)) throw new SpecError(`trial ${t.trial_id} is recorded twice`); ids.add(t.trial_id); }
  }
  const seed = spec.seed ?? 7, draws = spec.draws ?? 10_000, alpha = spec.alpha ?? 0.05;
  const saturatedAt = spec.saturated_at ?? 0.95, minPaired = spec.min_paired_tasks ?? 10;
  const opts = { seed, draws };
  const lookups = new Set(input.lookup_fails ?? []);
  const recordIds = new Set(input.records.map((t) => t.trial_id));
  const unknownLookups = [...lookups].filter((id) => !recordIds.has(id));
  if (unknownLookups.length) throw new SpecError(`--lookup-fails names ${unknownLookups.length} trial(s) with no record: ${unknownLookups.slice(0, 5).join(', ')}`);
  const value = (t: TrialRecord): 0 | 1 | null => { const v = trialValue(t); return v === 1 && lookups.has(t.trial_id) ? 0 : v; };
  const recorded = new Set(input.records.map((t) => t.trial_id));

  const data = new Map<string, CellData>();
  for (const c of spec.cells) {
    const rows = input.records.filter((t) => t.cell === c.id);
    const numbers = attemptNumbers(rows);
    const attempts = new Map<string, Map<number, 0 | 1 | null>>();
    const usdByTask = new Map<string, number>();
    for (const t of rows) {
      const m = attempts.get(t.task) ?? new Map<number, 0 | 1 | null>();
      m.set(numbers.get(t)!, value(t));
      attempts.set(t.task, m);
      usdByTask.set(t.task, (usdByTask.get(t.task) ?? 0) + (t.usage?.usd ?? 0) + ((t as { frontier?: { first_run_usd?: number } }).frontier?.first_run_usd ?? 0) + (input.cost_with_replaced ? (t as { frontier?: { replaced_usd?: number } }).frontier?.replaced_usd ?? 0 : 0));
    }
    const unstarted = input.manifest ? input.manifest.trials.filter((t) => t.cell === c.id && !recorded.has(t.id)).map((t) => t.id) : [];
    data.set(c.id, { spec: c, rows, attempts, usdByTask, unstarted });
  }
  const mainCells = [...data.values()].filter((d) => !d.spec.descriptive);
  const taskIds = [...new Set(mainCells.flatMap((d) => [...d.attempts.keys()]))].sort(byKey);
  const inEveryCell = (want: 0 | 1) => taskIds.filter((task) => mainCells.every((d) => { const s = scoredOf(d.attempts.get(task)); return s.length > 0 && s.every((v) => v === want); }));
  const taskLists = { total: taskIds.length, passed_every_attempt_in_every_cell: inEveryCell(1), never_passed_in_any_cell: inEveryCell(0) };

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
      cost: { usd_total: round(cost.usd)!, solves: cost.solves, usd_per_solve: round(cost.usd_per_solve), ci95: roundCi(cost.ci95), note: cost.note },
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

  const outside = input.records.filter((t) => !cellById.has(t.cell)).length;
  const planned = input.manifest ? input.manifest.trials.filter((t) => cellById.has(t.cell)).length : null;
  const unstarted = withVerdicts.reduce((s, c) => s + c.trials.unstarted.length, 0);
  return {
    run_id: spec.run_id,
    method: {
      estimator: "task mean (each task's mean pass over its scored attempts, then the mean over tasks); task-clustered percentile bootstrap intervals; pairs from runner/stats/paired.ts clusteredPairedDelta over per-task means of the attempts scored in both cells, Holm within model across primary pairs for the two-sided sign-flip p and for the one-sided non-inferiority p",
      seed, draws, alpha, ni_margin: NI_MARGIN, saturated_at: saturatedAt, min_paired_tasks: minPaired, drift_threshold: spec.drift_threshold ?? null,
      wall_time: 'median over scored trials, contended (trials of a shard may overlap)',
      cost: input.cost_with_replaced ? 'recorded USD of every trial of the cell (excluded ones included) plus each run a rerun replaced (frontier.replaced_usd, --cost-with-replaced), over scored passes' : 'recorded USD of every trial record of the cell (excluded ones included; a run a rerun replaced is not a record) over scored passes',
    },
    verdict_rules: VERDICT_RULES,
    trials_planned: planned, trials_recorded: input.records.length - outside, trials_outside_spec: outside, trials_unstarted: unstarted,
    complete: planned === null ? null : unstarted === 0,
    lookup_fails: lookups.size,
    tasks: taskLists,
    models, cells: withVerdicts, pairs,
  };
}

export type FrontierAnalysis = ReturnType<typeof analyzeFrontier>;

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
  for (const v of VERDICTS) out.push(`- **${v}**: ${a.verdict_rules[v]}.`);
  const harnesses = [...new Set(a.cells.map((c) => c.harness))];
  out.push('', '## Harness x model', '', 'Each cell: pass rate [95% CI]; cost per solve [95% CI]; median wall time (contended); verdict.', '');
  out.push(`| Harness | ${a.models.map((m) => m.label).join(' | ')} |`, `|---|${a.models.map(() => '---|').join('')}`);
  for (const h of harnesses) {
    const row = a.models.map((m) => {
      const c = a.cells.find((x) => x.harness === h && x.model === m.id);
      if (!c) return 'not run';
      return [`${c.pass_rate ? `${pct(c.pass_rate.estimate)} ${ciPct(c.pass_rate.ci95)}` : 'no scored trial'}`, `${c.cost.usd_per_solve === null ? 'no solve' : `${usd(c.cost.usd_per_solve)} per solve ${ciUsd(c.cost.ci95)}`}`,
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
    out.push(`| ${c.label} | ${r.k} | ${r.pass_hat_k ? `${pct(r.pass_hat_k.estimate)} ${ciPct(r.pass_hat_k.ci95)}` : 'n/a'} | ${r.pass_at_k ? `${pct(r.pass_at_k.estimate)} ${ciPct(r.pass_at_k.ci95)}` : 'n/a'} | ${c.rerun_flip ? `${pct(c.rerun_flip.estimate)} ${ciPct(c.rerun_flip.ci95)}` : 'n/a'} | ${c.pass_rate?.tasks ?? 0} / ${c.trials.scored} | ${c.trials.excluded.model_error} / ${c.trials.excluded.infra_error} / ${c.trials.excluded.exam_fault} | ${c.trials.harness_error_as_fail} | ${c.trials.lookup_fails} | ${c.trials.cap_stop} | ${c.trials.unstarted.length} | ${usd(c.cost.usd_total)} |`);
  }
  const dropped = a.pairs.filter((p) => p.dropped.length);
  if (dropped.length) {
    out.push('', '## Tasks dropped from pairs');
    for (const p of dropped) out.push(`- ${p.id}: ${p.dropped.map((d) => `${d.task} (${d.reason})`).join('; ')}`);
  }
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
  if (!results || !specPath || !existsSync(join(results, 'trials.jsonl')) || !existsSync(specPath)) {
    console.error('usage: bun scripts/frontier-harbor/analyze.ts --results <merged results dir with trials.jsonl> --spec <spec.json> [--out <dir>] [--lookup-fails <file>] [--cost-with-replaced]');
    process.exit(2);
  }
  let analysis: FrontierAnalysis;
  try {
    const manifest = existsSync(join(results, 'manifest.json')) ? readJsonFile<MatrixManifest>(join(results, 'manifest.json')) : null;
    if (manifest?.sealed) { console.error(`analyze: ${results} was planned with a sealed root; this script prints task ids and does not run on sealed results`); process.exit(2); }
    const records = readJsonLines<TrialRecord>(join(results, 'trials.jsonl'));
    analysis = analyzeFrontier({ records, manifest, lookup_fails: lookupFile ? lookupList(lookupFile) : [], cost_with_replaced: withReplaced }, readJsonFile<FrontierSpec>(specPath));
  } catch (e) {
    if (e instanceof SpecError) { console.error(`analyze: refused: ${e.message}`); process.exit(2); }
    if (e instanceof RunnerError) { console.error(`analyze: ${e.message}`); process.exit(2); }
    throw e;
  }
  mkdirSync(out!, { recursive: true });
  writeFileSync(join(out!, 'analysis.json'), JSON.stringify(analysis, null, 1) + '\n');
  writeFileSync(join(out!, 'analysis.md'), renderMarkdown(analysis));
  console.log(`FRONTIER_ANALYSIS: ${analysis.run_id}: ${analysis.cells.length} cells, ${analysis.pairs.length} pairs, ${analysis.trials_recorded} trials recorded${analysis.complete === false ? `, incomplete (${analysis.trials_unstarted} unstarted)` : ''}; wrote ${join(out!, 'analysis.json')} and analysis.md`);
}
