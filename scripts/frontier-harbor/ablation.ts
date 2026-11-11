#!/usr/bin/env bun
// The frozen analysis of the gstack skill ablation (internal-task, run gstack-skill-ablation-2026-11): the headroom check, the
// selection of the minus arms and the diet group from stage 0, and the main-stage analysis with its preregistered verdicts.
//
//   bun scripts/frontier-harbor/ablation.ts headroom --results <dir> --spec <ablation-spec.json> --out <dir> [--stages <stages.json>]
//   bun scripts/frontier-harbor/ablation.ts select   --results <dir> --spec <ablation-spec.json> --out <dir> [--stages <stages.json>]
//   bun scripts/frontier-harbor/ablation.ts analyze  --results <dir> --spec <ablation-spec.json> --out <dir>
//       --headroom <headroom.json> --selection <selection.json> [--stages <stages.json>]
//
// --results is a merged results directory holding trials.jsonl (runner/contracts.ts TrialRecord, with to-trials.ts's
// "frontier.stage" and, on gstack arms, the "gstack" field of gstack-exposure.ts), or a trials.jsonl file. Each subcommand writes
// <name>.json and <name>.md to --out: headroom, selection, ablation.
//
// Cells. A model's cells are its spec cells: none, full, diet and the minus template with <skill> (opus-minus-<skill>).
// The arm is read from the cell id and must equal the record's gstack.arm when the record has one (to-trials.ts writes
// one on every cell with a gstack block, the none arm's included).
// Records of other cells are counted and ignored. A trial id recorded twice is refused.
// Truncated captures. Each output gives truncated_captures, per model and arm, the stage's records whose gstack field
// says capture_truncated (the proxy cut the capture at its size cap); opens after the cap are unobserved and still count
// as not opened.
// Stages. frontier.stage "stage0" is stage 0. "main", or null (a main-stage Harbor job has no stage suffix, to-trials.ts),
// is the main stage. A rerun record (frontier.stage rerun<n> or rerun<n>-a<m>, or frontier.rerun set) keeps its trial id, so
// it counts in the stage the plan puts that trial in: --stages is plan.ts show --stages-out, each stage's trial ids from
// plan.ts stageTrials; a rerun record with no --stages is refused. Any other stage, and a rerun of a trial in neither
// stage0 nor main, is counted and ignored.
// Scoring. scripts/matrix-analysis.ts trialValue, as analyze.ts: pass with no consent violation is 1, a fail or a
// harness_error is 0, model_error, infra_error and exam_fault are excluded (an exposure mismatch is an infra_error).
// Rates are task means: each task's mean over its scored attempts, then the mean over tasks, with a task bootstrap
// interval (runner/stats/frontier.ts taskBootstrapMean).
//
// headroom (stage 0). Per model, the none arm on its subset (subsets.json subsets.<subset>.tasks): the task-mean pass
// rate and the informative tasks, tasks with a scored attempt that did not pass every scored attempt (0 < passes <
// scored, or 0 passes), floor tasks left out. pass = rate <= band and informative >= informative_floor; a model that
// misses is ceiling-limited. Records outside the subset are counted and left out.
//
// select (stage 0, full arms, scored trials). Open rate of a skill on a model: the share of its scored full-arm trials
// whose gstack.opens has the skill with a count >= 1. Excludable: not pinned, and on every frontier host (claude, codex)
// skills.json single_removal has a spec_sha256 and no refusal. Eligible for a minus arm: excludable, fit yes, and open
// rate >= open_threshold on a frontier model. The top max_single_arms by pooled open count (trials with an open, summed
// over the frontier models' full trials), ties by larger summed listing_bytes on the frontier hosts (null counts 0), then
// by name. Diet: every excludable skill that no stage-0 full trial of any model opened, scored or excluded, sorted, as
// "full,-skill:a,-skill:b". Put-back order, if gstack refuses the diet render: smallest summed listing_bytes first, then
// name; fallbacks lists the spec after each put-back.
//
// analyze (main stage). Per model and arm: task-mean pass rate; tokens per scored trial (input, cached, output and
// total = input + output, from usage; input already holds cache reads and writes); mean gstack listing_bytes and
// opened_body_tokens; cost per solve (as analyze.ts: recorded usd of every trial, excluded ones included, over scored
// passes) with a task bootstrap interval. Paired comparisons at task level (runner/stats/task-means.ts pairTaskMeans,
// tasks with a scored attempt in both arms): each selected minus arm and the diet against full, and full against none.
// The estimate is arm minus reference (clusteredPairedDelta) with its task bootstrap 95% interval and two-sided
// task-level sign-flip p, the tasks worse and better, and the paired ratio of tokens per trial (arm over reference: sum
// of per-task mean tokens, paired task bootstrap, pairedCostRatio with one unit per task). Holm runs within each model
// over the fixed family (selected minus arms, diet, full vs none); a comparison with no paired task counts as p = 1.
// Pooled reading per selected minus arm and the diet, over the frontier models that passed headroom: the mean of all
// their per-task differences, a bootstrap that resamples tasks within each model (seeded with runner/stats/paired.ts
// seededRandom), the 95% interval and the 90% lower bound (the alpha quantile, as bootstrapLowerBound); within-10 when
// the lower bound is above -ni_margin. The pooled tokens-per-trial ratio is the sum of the arm's per-task mean tokens over
// the sum of full's, resampled the same way. With no frontier model past headroom the pooled readings use every frontier
// model and are marked descriptive.
// Verdicts per skill, first match wins: fit no is "listing cost only" (open rates and listing bytes, no verdict); not
// excludable on a frontier host is "not removable at the pin"; a selected minus arm or the diet group takes its arm's
// verdict; any other fit-yes skill is FIX-METHOD, exposure too low to measure. An arm's verdict: KEEP when the pooled 95%
// interval is wholly below 0; else CUT-CANDIDATE when within-10 and the pooled token ratio estimate is at or below 1;
// else FIX-METHOD with the MDD (half the width of the pooled 95% interval). A descriptive pooled reading gives
// FIX-METHOD, ceiling-limited. Low-cost (particle) and ceiling-limited models are reported, labelled, and never pooled.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { readJsonFile, readJsonLines } from '../../runner/heldout/sealed.ts';
import { costPerSolve, pairedCostRatio, taskBootstrapMean } from '../../runner/stats/frontier.ts';
import { clusteredPairedDelta, holmAdjusted, PairingError, seededRandom } from '../../runner/stats/paired.ts';
import { pairTaskMeans, type TrialValue } from '../../runner/stats/task-means.ts';
import { trialValue } from '../matrix-analysis.ts';
import { specSha256 } from './gstack-arm.ts';
import type { GstackHost, GstackTrial } from './gstack-exposure.ts';

const ROOT = resolve(import.meta.dir, '../..');
const SKILL = '<skill>';
const EPS = 1e-12;

export interface AblationModel {
  id: string;
  label: string;
  harness: string;
  host: GstackHost;
  /** frontier models are pooled when they pass headroom; low-cost models are reported and never pooled. */
  role: 'frontier' | 'low-cost';
  optional?: boolean;
  /** The subsets.json key of the model's headroom subset. */
  subset: string;
  /** Cell ids; minus holds <skill>. */
  cells: { none: string; full: string; diet: string; minus: string };
}

export interface AblationSpec {
  schema: 'gstack-skill-ablation-analysis/1';
  run_id: string;
  seed: number;
  draws: number;
  alpha: number;
  band: number;
  informative_floor: number;
  open_threshold: number;
  max_single_arms: number;
  ni_margin: number;
  files: { skills: string; fit: string; subsets: string };
  models: AblationModel[];
}

interface SkillHost { listing_bytes: number | null; single_removal?: { spec: string; spec_sha256?: string; refusal?: string } }
export interface Catalog {
  skills: { pinned: string[]; skills: Record<string, Partial<Record<GstackHost, SkillHost>>> };
  fit: { skills: Record<string, { fit: 'yes' | 'no'; reason: string }> };
  subsets: { floor: string[]; subsets: Record<string, { tasks: string[] }> };
}

export type AblationRecord = TrialRecord & { frontier?: { stage?: string | null; rerun?: number | null }; gstack?: GstackTrial };
/** Each stage's trial ids by stage name (plan.ts stageMembership). */
export type StageMembership = Readonly<Record<string, readonly string[]>>;

export class AblationError extends Error {}

const fail = (m: string): never => { throw new AblationError(m); };
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** Every non-integer number rounded to 6 decimals, for the JSON and the tests. */
function rounded<T>(v: T): T {
  if (typeof v === 'number') return (Number.isInteger(v) || !Number.isFinite(v) ? v : Number(v.toFixed(6))) as T;
  if (Array.isArray(v)) return v.map(rounded) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)])) as T;
  return v;
}

export function checkSpec(spec: AblationSpec): string[] {
  const p: string[] = [];
  if (spec?.schema !== 'gstack-skill-ablation-analysis/1') p.push('schema must be gstack-skill-ablation-analysis/1');
  if (typeof spec?.run_id !== 'string' || !spec.run_id) p.push('run_id is required');
  if (!Number.isSafeInteger(spec?.seed)) p.push('seed must be an integer');
  if (!Number.isSafeInteger(spec?.draws) || spec.draws < 1000) p.push('draws must be an integer >= 1000');
  if (!(spec?.alpha > 0 && spec.alpha < 0.5)) p.push('alpha must lie in (0, 0.5)');
  if (!(spec?.band > 0 && spec.band <= 1)) p.push('band must lie in (0, 1]');
  if (!Number.isSafeInteger(spec?.informative_floor) || spec.informative_floor < 0) p.push('informative_floor must be an integer >= 0');
  if (!(spec?.open_threshold > 0 && spec.open_threshold <= 1)) p.push('open_threshold must lie in (0, 1]');
  if (!Number.isSafeInteger(spec?.max_single_arms) || spec.max_single_arms < 0) p.push('max_single_arms must be an integer >= 0');
  if (!(spec?.ni_margin > 0 && spec.ni_margin < 1)) p.push('ni_margin must lie in (0, 1)');
  for (const k of ['skills', 'fit', 'subsets'] as const) if (typeof spec?.files?.[k] !== 'string') p.push(`files.${k} is required`);
  const models = Array.isArray(spec?.models) ? spec.models : [];
  if (!models.some((m) => m.role === 'frontier')) p.push('at least one frontier model is required');
  const ids = new Set<string>(), cells = new Set<string>();
  for (const m of models) {
    if (ids.has(m.id)) p.push(`model ${m.id} listed twice`);
    ids.add(m.id);
    if (!['claude', 'codex', 'hermes'].includes(m.host)) p.push(`model ${m.id}: host must be claude, codex or hermes`);
    if (m.role !== 'frontier' && m.role !== 'low-cost') p.push(`model ${m.id}: role must be frontier or low-cost`);
    if (typeof m.subset !== 'string' || !m.subset) p.push(`model ${m.id}: subset is required`);
    if (!m.cells?.minus?.includes(SKILL) || m.cells.minus.split(SKILL).length !== 2) p.push(`model ${m.id}: cells.minus must hold ${SKILL} once`);
    for (const c of [m.cells?.none, m.cells?.full, m.cells?.diet, m.cells?.minus]) {
      if (typeof c !== 'string' || !c) { p.push(`model ${m.id}: cells.none, full, diet and minus are required`); break; }
      if (cells.has(c)) p.push(`cell ${c} listed twice`);
      cells.add(c);
    }
  }
  return p;
}

export function loadCatalog(spec: AblationSpec, root = ROOT): Catalog {
  return checkCatalog(spec, {
    skills: readJsonFile(resolve(root, spec.files.skills)),
    fit: readJsonFile(resolve(root, spec.files.fit)),
    subsets: readJsonFile(resolve(root, spec.files.subsets)),
  });
}

export function checkCatalog(spec: AblationSpec, cat: Catalog): Catalog {
  const skills = Object.keys(cat.skills.skills).sort(byKey), fit = Object.keys(cat.fit.skills).sort(byKey);
  if (skills.join(',') !== fit.join(',')) fail(`fit.json and skills.json name different skills: only in skills.json [${skills.filter((s) => !fit.includes(s)).join(', ')}], only in fit.json [${fit.filter((s) => !skills.includes(s)).join(', ')}]`);
  for (const s of fit) if (!['yes', 'no'].includes(cat.fit.skills[s]!.fit)) fail(`fit.json: ${s} has fit ${cat.fit.skills[s]!.fit}, not yes or no`);
  for (const m of spec.models) if (!Array.isArray(cat.subsets.subsets[m.subset]?.tasks)) fail(`subsets.json has no subset ${m.subset} (model ${m.id})`);
  return cat;
}

const frontierHosts = (spec: AblationSpec) => [...new Set(spec.models.filter((m) => m.role === 'frontier').map((m) => m.host))].sort(byKey);

/** Whether a single removal of the skill renders on every frontier host, and why not. */
export function removability(cat: Catalog, skill: string, hosts: readonly string[]): { excludable: boolean; reasons: string[] } {
  if (cat.skills.pinned.includes(skill)) return { excludable: false, reasons: ['pinned'] };
  const reasons = hosts.flatMap((h) => {
    const r = cat.skills.skills[skill]?.[h as GstackHost]?.single_removal;
    if (!r) return [`${h}: no single removal`];
    if (r.refusal) return [`${h}: ${r.refusal}`];
    return r.spec_sha256 ? [] : [`${h}: no spec_sha256`];
  });
  return { excludable: !reasons.length, reasons };
}

const listingBytes = (cat: Catalog, skill: string, hosts: readonly string[]) => sum(hosts.map((h) => cat.skills.skills[skill]?.[h as GstackHost]?.listing_bytes ?? 0));

export function armOf(m: AblationModel, cell: string): string | null {
  if (cell === m.cells.none) return 'none';
  if (cell === m.cells.full) return 'full';
  if (cell === m.cells.diet) return 'diet';
  const [pre, post] = m.cells.minus.split(SKILL) as [string, string];
  return cell.length > pre.length + post.length && cell.startsWith(pre) && cell.endsWith(post) ? 'minus-' + cell.slice(pre.length, cell.length - post.length) : null;
}

export const stageOf = (t: AblationRecord, planStage?: ReadonlyMap<string, string>): 'stage0' | 'main' | 'other' => {
  const s = t.frontier?.stage;
  if (t.frontier?.rerun || /^rerun\d+(?:-a\d+)?$/.test(s ?? '')) {
    const own = (planStage ?? fail(`trial ${t.trial_id} is a rerun record (stage ${s}); pass --stages (plan.ts show --stages-out) so it counts in its own stage`)).get(t.trial_id);
    return own === 'stage0' || own === 'main' ? own : 'other';
  }
  return s === 'stage0' ? 'stage0' : s === 'main' || s === null || s === undefined ? 'main' : 'other';
};

interface Arm { cell: string; rows: AblationRecord[] }
interface Grouped { arms: Map<string, Map<string, Arm>>; counts: { stage0: number; main: number; other_stage: number; outside_spec: number } }

/** Records of one stage by model and arm, after the id and arm checks. */
function group(records: readonly AblationRecord[], spec: AblationSpec, stage: 'stage0' | 'main', stages?: StageMembership): Grouped {
  const planStage = stages && new Map(Object.entries(stages).flatMap(([name, ids]) => ids.map((id): [string, string] => [id, name])));
  const ids = new Set<string>();
  const arms = new Map<string, Map<string, Arm>>(spec.models.map((m) => [m.id, new Map()]));
  const counts = { stage0: 0, main: 0, other_stage: 0, outside_spec: 0 };
  for (const t of records) {
    if (ids.has(t.trial_id)) fail(`trial ${t.trial_id} is recorded twice`);
    ids.add(t.trial_id);
    const hit = spec.models.map((m) => ({ m, arm: armOf(m, t.cell) })).find((x) => x.arm !== null);
    if (!hit) { counts.outside_spec++; continue; }
    const arm = hit.arm!;
    if (t.gstack && t.gstack.arm !== arm) fail(`trial ${t.trial_id}: cell ${t.cell} is arm ${arm}, its gstack field says ${t.gstack.arm}`);
    const s = stageOf(t, planStage);
    if (s === 'other') { counts.other_stage++; continue; }
    counts[s]++;
    if (s !== stage) continue;
    const byArm = arms.get(hit.m.id)!;
    const a = byArm.get(arm) ?? { cell: t.cell, rows: [] };
    a.rows.push(t);
    byArm.set(arm, a);
  }
  return { arms, counts };
}

const scored = (rows: readonly AblationRecord[]) => rows.filter((t) => trialValue(t) !== null);
/** Per model and arm, the stage's records whose capture the proxy cut at its size cap (opens after the cap are unobserved). */
const truncatedCaptures = (g: Grouped): Record<string, Record<string, number>> =>
  Object.fromEntries([...g.arms].map(([m, arms]) => [m, Object.fromEntries([...arms].map(([arm, a]) => [arm, a.rows.filter((t) => t.gstack?.capture_truncated).length]))]));
const gstackOf = (t: AblationRecord): GstackTrial => t.gstack ?? fail(`trial ${t.trial_id}: a gstack-arm record has no gstack field`);
const opened = (t: AblationRecord, skill: string) => (gstackOf(t).opens[skill] ?? 0) >= 1;
const totalTokens = (t: AblationRecord) => (t.usage?.input_tokens ?? 0) + (t.usage?.output_tokens ?? 0);

/** Each task's mean over its scored attempts, then the mean over tasks, with a task bootstrap interval. */
function taskRate(rows: readonly AblationRecord[], opts: { seed: number; draws: number }) {
  const byTask = new Map<string, number[]>();
  for (const t of rows) { const v = trialValue(t); if (v !== null) byTask.set(t.task, [...(byTask.get(t.task) ?? []), v]); }
  const r = taskBootstrapMean([...byTask.keys()].sort(byKey).map((k) => mean(byTask.get(k)!)!), opts);
  return r ? { estimate: r.estimate, ci95: r.ci95, tasks: r.n } : null;
}

// ---- headroom

export function headroom(records: readonly AblationRecord[], spec: AblationSpec, cat: Catalog, stages?: StageMembership) {
  const opts = { seed: spec.seed, draws: spec.draws };
  const g = group(records, spec, 'stage0', stages);
  const floor = new Set(cat.subsets.floor);
  const models = spec.models.map((m) => {
    const subset = cat.subsets.subsets[m.subset]!.tasks;
    const inSubset = new Set(subset);
    const all = g.arms.get(m.id)!.get('none')?.rows ?? [];
    const rows = all.filter((t) => inSubset.has(t.task));
    const tasks = [...inSubset].sort(byKey).map((task) => {
      const v = rows.filter((t) => t.task === task).map(trialValue).filter((x): x is 0 | 1 => x !== null);
      return { task, scored: v.length, passes: sum(v) };
    }).filter((x) => x.scored > 0);
    const rate = taskRate(rows, opts);
    const informative = tasks.filter((x) => !floor.has(x.task) && x.passes < x.scored).map((x) => x.task);
    const withinBand = rate !== null && rate.estimate <= spec.band + EPS;
    const enough = informative.length >= spec.informative_floor;
    const pass = withinBand && enough;
    return {
      model: m.id, label: m.label, role: m.role, host: m.host, cell: m.cells.none, subset: m.subset, subset_tasks: subset.length,
      trials_recorded: all.length, trials_outside_subset: all.length - rows.length, trials_scored: scored(rows).length, tasks_scored: tasks.length,
      pass_rate: rate, informative_tasks: informative.length, informative_task_ids: informative,
      rate_within_band: withinBand, informative_floor_met: enough, pass,
      status: !scored(rows).length ? 'no scored trial' : pass ? 'passed' : 'ceiling-limited',
    };
  });
  return rounded({
    run_id: spec.run_id, stage: 'stage0',
    rule: { band: spec.band, informative_floor: spec.informative_floor, floor_tasks: cat.subsets.floor, seed: spec.seed, draws: spec.draws,
      text: `pass when the none arm's task-mean pass rate on the model's subset is at or below ${spec.band} and at least ${spec.informative_floor} subset tasks are informative (a scored attempt failed; floor tasks left out); a model that misses is ceiling-limited` },
    records: g.counts, truncated_captures: truncatedCaptures(g), models,
  });
}
export type HeadroomResult = ReturnType<typeof headroom>;

// ---- select

export function select(records: readonly AblationRecord[], spec: AblationSpec, cat: Catalog, stages?: StageMembership) {
  const g = group(records, spec, 'stage0', stages);
  const hosts = frontierHosts(spec);
  const names = Object.keys(cat.skills.skills).sort(byKey);
  const tables = spec.models.map((m) => {
    const rows = scored(g.arms.get(m.id)!.get('full')?.rows ?? []);
    const skills = [...new Set([...names, ...rows.flatMap((t) => Object.keys(gstackOf(t).opens))])].sort(byKey);
    return {
      model: m.id, label: m.label, role: m.role, cell: m.cells.full, scored_trials: rows.length,
      open_rate: skills.map((skill) => { const n = rows.filter((t) => opened(t, skill)).length; return { skill, trials: n, rate: rows.length ? n / rows.length : null }; }),
    };
  });
  for (const t of tables) if (t.role === 'frontier' && !t.scored_trials) fail(`model ${t.model} has no scored stage-0 trial in ${t.cell}`);
  const frontier = tables.filter((t) => t.role === 'frontier');
  const rateOf = (t: (typeof tables)[number], skill: string) => t.open_rate.find((r) => r.skill === skill)!;
  const candidates = names.map((skill) => {
    const rem = removability(cat, skill, hosts);
    const fit = cat.fit.skills[skill]!.fit;
    const reached = frontier.some((t) => (rateOf(t, skill).rate ?? 0) >= spec.open_threshold - EPS);
    const why = [...(rem.excludable ? [] : ['not excludable on every frontier host (' + rem.reasons.join('; ') + ')']), ...(fit === 'yes' ? [] : ['fit no']), ...(reached ? [] : [`open rate below ${spec.open_threshold} on every frontier model`])];
    return {
      skill, fit, excludable: rem.excludable, removal_reasons: rem.reasons, listing_bytes: listingBytes(cat, skill, hosts),
      pooled_open_trials: sum(frontier.map((t) => rateOf(t, skill).trials)), open_rate: Object.fromEntries(frontier.map((t) => [t.model, rateOf(t, skill).rate])),
      eligible: !why.length, not_eligible_because: why,
    };
  });
  const ranked = candidates.filter((c) => c.eligible).sort((a, b) => b.pooled_open_trials - a.pooled_open_trials || b.listing_bytes - a.listing_bytes || byKey(a.skill, b.skill));
  const selected = ranked.slice(0, spec.max_single_arms).map((c, i) => {
    const armSpec = `full,-skill:${c.skill}`;
    return { rank: i + 1, arm: `minus-${c.skill}`, skill: c.skill, spec: armSpec, spec_sha256: specSha256(armSpec), pooled_open_trials: c.pooled_open_trials, listing_bytes: c.listing_bytes, open_rate: c.open_rate };
  });
  const openedAnywhere = new Set(spec.models.flatMap((m) => (g.arms.get(m.id)!.get('full')?.rows ?? []).flatMap((t) => Object.keys(t.gstack?.opens ?? {}).filter((s) => opened(t, s)))));
  const dietSkills = candidates.filter((c) => c.excludable && !openedAnywhere.has(c.skill)).map((c) => c.skill);
  const dietSpec = (skills: string[]) => 'full,' + skills.map((s) => '-skill:' + s).join(',');
  const putBack = [...dietSkills].sort((a, b) => listingBytes(cat, a, hosts) - listingBytes(cat, b, hosts) || byKey(a, b));
  const diet = dietSkills.length ? {
    arm: 'diet', skills: dietSkills, spec: dietSpec(dietSkills), spec_sha256: specSha256(dietSpec(dietSkills)),
    listing_bytes: sum(dietSkills.map((s) => listingBytes(cat, s, hosts))), put_back_order: putBack,
    fallbacks: putBack.slice(0, -1).map((_, i) => {
      const back = putBack.slice(0, i + 1), left = dietSkills.filter((s) => !back.includes(s));
      return { put_back: back, skills: left, spec: dietSpec(left), spec_sha256: specSha256(dietSpec(left)) };
    }),
  } : null;
  return rounded({
    run_id: spec.run_id, stage: 'stage0', frontier_hosts: hosts,
    rule: { open_threshold: spec.open_threshold, max_single_arms: spec.max_single_arms,
      text: `minus arm: excludable on every frontier host (${hosts.join(', ')}), fit yes, open rate >= ${spec.open_threshold} on a frontier model; top ${spec.max_single_arms} by pooled open count over the frontier models' full trials, ties by larger summed listing bytes, then name. diet: every excludable skill no stage-0 full trial of any model opened. put-back order: smallest summed listing bytes first, then name` },
    records: g.counts, truncated_captures: truncatedCaptures(g), selected, diet, candidates, open_rates: tables,
  });
}
export type SelectionResult = ReturnType<typeof select>;

// ---- analyze

const RULE = { min_trials: 1, on_missing: 'drop_task' } as const;

/** A statistic over every stratum pooled, with a bootstrap that resamples items within each stratum. */
function stratifiedBootstrap<T>(strata: T[][], stat: (xs: T[]) => number | null, opts: { seed: number; draws: number }, alpha: number) {
  const estimate = stat(strata.flat());
  if (estimate === null) return { estimate: null, ci95: null, lower_bound_90: null, undefined_draws: 0 };
  const rnd = seededRandom(opts.seed);
  const boot: number[] = [];
  let undefinedDraws = 0;
  for (let i = 0; i < opts.draws; i++) {
    const sample: T[] = [];
    for (const s of strata) for (let j = 0; j < s.length; j++) sample.push(s[Math.floor(rnd() * s.length)]!);
    const v = stat(sample);
    if (v === null) undefinedDraws++;
    else boot.push(v);
  }
  if (undefinedDraws > opts.draws * 0.05) return { estimate, ci95: null, lower_bound_90: null, undefined_draws: undefinedDraws };
  boot.sort((a, b) => a - b);
  const m = boot.length;
  return { estimate, ci95: [boot[Math.floor(m * 0.025)]!, boot[Math.ceil(m * 0.975) - 1]!] as [number, number], lower_bound_90: boot[Math.floor(m * alpha)]!, undefined_draws: undefinedDraws };
}

function armSummary(arm: string, a: Arm, opts: { seed: number; draws: number }) {
  const s = scored(a.rows);
  const usdByTask = new Map<string, number>(), solvesByTask = new Map<string, number>();
  for (const t of a.rows) {
    usdByTask.set(t.task, (usdByTask.get(t.task) ?? 0) + (t.usage?.usd ?? 0));
    solvesByTask.set(t.task, (solvesByTask.get(t.task) ?? 0) + (trialValue(t) === 1 ? 1 : 0));
  }
  const cost = costPerSolve([...usdByTask.keys()].sort(byKey).map((k) => ({ usd: usdByTask.get(k)!, solves: solvesByTask.get(k)! })), opts);
  const gs = arm === 'none' ? [] : s.map(gstackOf);
  return {
    arm, cell: a.cell, trials: a.rows.length, scored_trials: s.length, excluded: a.rows.length - s.length,
    pass_rate: taskRate(a.rows, opts),
    tokens_per_trial: { input: mean(s.map((t) => t.usage?.input_tokens ?? 0)), cached: mean(s.map((t) => t.usage?.cached_tokens ?? 0)), output: mean(s.map((t) => t.usage?.output_tokens ?? 0)), total: mean(s.map(totalTokens)) },
    listing_bytes_mean: mean(gs.map((x) => x.listing_bytes)), opened_body_tokens_mean: mean(gs.map((x) => x.opened_body_tokens)),
    cost: { usd_total: cost.usd, solves: cost.solves, usd_per_solve: cost.usd_per_solve, ci95: cost.ci95, note: cost.note },
  };
}

interface TaskPair { task: string; pass_arm: number; pass_ref: number; diff: number; tokens_arm: number; tokens_ref: number }

function compare(arm: string, reference: string, a: Arm | undefined, r: Arm | undefined, opts: { seed: number; draws: number }) {
  const base = {
    arm, reference, tasks_paired: 0, tasks_dropped: [] as Array<{ task: string; reason: string }>, estimate: null as number | null, mean_arm: null as number | null,
    mean_reference: null as number | null, ci95: null as [number, number] | null, p_two_sided: null as number | null, p_method: null as string | null, holm_p: 1,
    worse: 0, better: 0, ties: 0, tokens_ratio: { ratio: null as number | null, ci95: null as [number, number] | null, note: null as string | null }, per_task: [] as TaskPair[],
  };
  if (!a || !r) return { ...base, tokens_ratio: { ...base.tokens_ratio, note: `no ${!a ? arm : reference} records` } };
  const values = (rows: AblationRecord[], f: (t: AblationRecord) => number): TrialValue[] => rows.map((t, i) => ({ task: t.task, trial: i, value: trialValue(t) === null ? null : f(t) }));
  let pass, tokens;
  try {
    pass = pairTaskMeans(values(r.rows, (t) => trialValue(t)!), values(a.rows, (t) => trialValue(t)!), RULE);
    tokens = pairTaskMeans(values(r.rows, totalTokens), values(a.rows, totalTokens), RULE);
  } catch (e) {
    if (e instanceof PairingError) return { ...base, tokens_ratio: { ...base.tokens_ratio, note: e.message } };
    throw e;
  }
  const d = clusteredPairedDelta(pass.pairs, opts);
  const tok = new Map(tokens.pairs.map((p) => [p.id, p]));
  const ratio = pairedCostRatio(tokens.pairs.map((p) => ({ task: p.id, usd_a: p.a, solves_a: 1, usd_b: p.b, solves_b: 1 })), opts);
  return {
    ...base, tasks_paired: pass.pairs.length, tasks_dropped: pass.dropped,
    estimate: d.delta, mean_arm: d.mean_b, mean_reference: d.mean_a, ci95: d.ci95, p_two_sided: d.p_two_sided, p_method: d.p_method,
    worse: pass.pairs.filter((p) => p.b < p.a).length, better: pass.pairs.filter((p) => p.b > p.a).length, ties: pass.pairs.filter((p) => p.b === p.a).length,
    tokens_ratio: { ratio: ratio.ratio, ci95: ratio.ci95, note: ratio.note },
    per_task: pass.pairs.map((p) => ({ task: p.id, pass_arm: p.b, pass_ref: p.a, diff: p.b - p.a, tokens_arm: tok.get(p.id)!.b, tokens_ref: tok.get(p.id)!.a })),
  };
}

/** The diet's skills: the selection's diet, or the put-back fallback whose spec_sha256 the main-stage diet trials carry. */
function dietOf(sel: SelectionResult, g: Grouped): { skills: string[]; spec: string | null; spec_sha256: string | null; put_back: string[] } {
  if (!sel.diet) return { skills: [], spec: null, spec_sha256: null, put_back: [] };
  const shas = new Set([...g.arms.values()].flatMap((m) => (m.get('diet')?.rows ?? []).map((t) => gstackOf(t).spec_sha256)));
  if (shas.size > 1) fail(`main-stage diet trials carry ${shas.size} different spec_sha256 values`);
  const sha = [...shas][0];
  if (sha === undefined || sha === sel.diet.spec_sha256) return { skills: sel.diet.skills, spec: sel.diet.spec, spec_sha256: sel.diet.spec_sha256, put_back: [] };
  const f = sel.diet.fallbacks.find((x) => x.spec_sha256 === sha) ?? fail(`main-stage diet trials carry spec_sha256 ${sha}, which is neither the selection's diet nor a put-back fallback`);
  return { skills: f.skills, spec: f.spec, spec_sha256: f.spec_sha256, put_back: f.put_back };
}

export type Verdict = 'KEEP' | 'CUT-CANDIDATE' | 'FIX-METHOD';

export function analyze(records: readonly AblationRecord[], spec: AblationSpec, cat: Catalog, head: HeadroomResult, sel: SelectionResult, stages?: StageMembership) {
  if (head.run_id !== spec.run_id) fail(`the headroom file is for run ${head.run_id}, not ${spec.run_id}`);
  if (sel.run_id !== spec.run_id) fail(`the selection file is for run ${sel.run_id}, not ${spec.run_id}`);
  const opts = { seed: spec.seed, draws: spec.draws };
  const g = group(records, spec, 'main', stages);
  const hosts = frontierHosts(spec);
  const selectedArms = sel.selected.map((s) => s.arm);
  for (const [model, arms] of g.arms) for (const [arm, a] of arms) {
    if (!arm.startsWith('minus-')) continue;
    const chosen = sel.selected.find((s) => s.arm === arm) ?? fail(`model ${model}: main-stage cell ${a.cell} is arm ${arm}, which the selection did not choose`);
    for (const t of a.rows) if (gstackOf(t).spec_sha256 !== chosen.spec_sha256) fail(`trial ${t.trial_id}: spec_sha256 ${gstackOf(t).spec_sha256} is not the selected ${arm} (${chosen.spec_sha256})`);
  }
  const diet = dietOf(sel, g);
  const passed = new Set(head.models.filter((h) => h.pass).map((h) => h.model));
  const family: Array<[string, string]> = [...selectedArms.map((a): [string, string] => [a, 'full']), ...(sel.diet ? [['diet', 'full'] as [string, string]] : []), ['full', 'none']];
  const order = (a: string) => (a === 'none' ? '0' : a === 'full' ? '1' : a === 'diet' ? '2' : '3' + a);

  const models = spec.models.map((m) => {
    const arms = g.arms.get(m.id)!;
    const comparisons = family.map(([a, r]) => compare(a, r, arms.get(a), arms.get(r), opts));
    const holm = holmAdjusted(comparisons.map((c) => c.p_two_sided ?? 1));
    comparisons.forEach((c, i) => { c.holm_p = holm[i]!; });
    return {
      model: m.id, label: m.label, role: m.role, host: m.host, headroom: head.models.find((h) => h.model === m.id)?.status ?? 'not in the headroom file',
      pooling: m.role === 'low-cost' ? 'low-cost, never pooled' : passed.has(m.id) ? 'pooled' : 'ceiling-limited, not pooled',
      arms: [...arms.keys()].sort((x, y) => byKey(order(x), order(y))).map((arm) => armSummary(arm, arms.get(arm)!, opts)),
      comparisons,
    };
  });

  const frontier = models.filter((m) => m.role === 'frontier');
  const pool = frontier.filter((m) => m.pooling === 'pooled');
  const descriptive = pool.length === 0;
  const pooledModels = descriptive ? frontier : pool;
  const pooled = family.filter(([a]) => a !== 'full').map(([arm]) => {
    const strata = pooledModels.map((m) => m.comparisons.find((c) => c.arm === arm)!.per_task).filter((s) => s.length);
    const diff = stratifiedBootstrap(strata, (xs) => mean(xs.map((x) => x.diff)), opts, spec.alpha);
    const ratio = stratifiedBootstrap(strata, (xs) => { const ref = sum(xs.map((x) => x.tokens_ref)); return ref > 0 ? sum(xs.map((x) => x.tokens_arm)) / ref : null; }, opts, spec.alpha);
    const within = diff.lower_bound_90 !== null && diff.lower_bound_90 > -spec.ni_margin + EPS;
    const mdd = diff.ci95 ? (diff.ci95[1] - diff.ci95[0]) / 2 : null;
    const keep = !!diff.ci95 && diff.ci95[1] < -EPS;
    const cut = within && ratio.estimate !== null && ratio.estimate <= 1 + EPS;
    const tasks = sum(strata.map((s) => s.length));
    const [verdict, reason]: [Verdict, string] = !tasks ? ['FIX-METHOD', 'no paired main-stage task in the pooled models']
      : descriptive ? ['FIX-METHOD', 'no frontier model passed headroom, so the pooled reading is descriptive (ceiling-limited); raise the ceiling (R61)']
      : keep ? ['KEEP', `pooled 95% interval wholly below 0${cut ? ' (the CUT-CANDIDATE rule also held)' : ''}`]
      : cut ? ['CUT-CANDIDATE', `within-10 (90% lower bound above -${spec.ni_margin}) and pooled token ratio at or below 1`]
      : ['FIX-METHOD', `${within ? 'within-10, but the pooled token ratio is above 1' : 'inconclusive'}; MDD ${mdd === null ? 'n/a' : (100 * mdd).toFixed(1) + ' points'}`];
    return {
      arm, skills: arm === 'diet' ? diet.skills : [arm.slice(6)], models: pooledModels.map((m) => m.model), tasks, descriptive,
      estimate: diff.estimate, ci95: diff.ci95, lower_bound_90: diff.lower_bound_90, within_10: within,
      tokens_ratio: { estimate: ratio.estimate, ci95: ratio.ci95 }, mdd, verdict, reason,
    };
  });

  const fullRows = (ms: typeof models) => ms.flatMap((m) => scored(g.arms.get(m.model)!.get('full')?.rows ?? []));
  const pooledFull = fullRows(frontier);
  const rate = (rows: AblationRecord[], skill: string) => (rows.length ? rows.filter((t) => opened(t, skill)).length / rows.length : null);
  const skills = Object.keys(cat.skills.skills).map((skill) => {
    const fit = cat.fit.skills[skill]!.fit;
    const rem = removability(cat, skill, hosts);
    const arm = sel.selected.some((s) => s.skill === skill) ? `minus-${skill}` : diet.skills.includes(skill) ? 'diet' : null;
    const reading = arm ? pooled.find((p) => p.arm === arm)! : null;
    const stage0 = sel.candidates.find((c) => c.skill === skill)?.open_rate ?? {};
    const bytesOn = (h: GstackHost) => cat.skills.skills[skill]?.[h]?.listing_bytes ?? null;
    const [kind, verdict, reason]: [string, Verdict | null, string] = fit === 'no' ? ['listing cost only', null, arm ? `fit no; in the ${arm} arm, whose verdict is ${reading!.verdict}` : 'fit no']
      : !rem.excludable ? ['not removable at the pin', null, rem.reasons.join('; ')]
      : reading ? [arm === 'diet' ? 'diet group' : 'minus arm', reading.verdict, reading.reason]
      : ['exposure too low to measure', 'FIX-METHOD', `exposure too low to measure${sel.candidates.find((c) => c.skill === skill)?.eligible ? ` (eligible, outside the top ${spec.max_single_arms})` : ''}: stage-0 open rate ${Object.entries(stage0).map(([k, v]) => `${k} ${v === null ? 'n/a' : (100 * v).toFixed(1) + '%'}`).join(', ')}`];
    return {
      skill, fit, kind, verdict, reason, arm,
      open_rate_pooled: rate(pooledFull, skill), open_rate: Object.fromEntries(models.map((m) => [m.model, rate(fullRows([m]), skill)])), stage0_open_rate: stage0,
      listing_bytes: { claude: bytesOn('claude'), codex: bytesOn('codex'), hermes: bytesOn('hermes'), frontier: listingBytes(cat, skill, hosts) },
      excludable: rem.excludable, removal_reasons: rem.reasons,
    };
  }).sort((a, b) => (b.open_rate_pooled ?? -1) - (a.open_rate_pooled ?? -1) || b.listing_bytes.frontier - a.listing_bytes.frontier || byKey(a.skill, b.skill))
    .map((s, i) => ({ rank: i + 1, ...s }));

  return rounded({
    run_id: spec.run_id, stage: 'main', records: g.counts, truncated_captures: truncatedCaptures(g),
    method: {
      seed: spec.seed, draws: spec.draws, alpha: spec.alpha, ni_margin: spec.ni_margin, frontier_hosts: hosts,
      pass_rate: "task mean (each task's mean over its scored attempts, then the mean over tasks), task bootstrap 95% interval",
      paired: 'per task, arm mean minus reference mean over scored attempts, tasks scored in both; clusteredPairedDelta task bootstrap 95% interval and two-sided task-level sign-flip p; Holm within model over the selected minus arms, the diet and full vs none (no paired task counts as p = 1)',
      tokens: 'tokens per scored trial; total = input + output (input holds cached); paired ratio arm over reference = sum of per-task mean total tokens, paired task bootstrap',
      cost: 'recorded usd of every trial of the arm (excluded ones included) over scored passes, task bootstrap',
      pooled: `frontier models that passed headroom; mean of all per-task differences, bootstrap resampling tasks within each model; within-10 when the 90% lower bound is above -${spec.ni_margin}`,
      verdicts: 'KEEP when the pooled 95% interval is wholly below 0; else CUT-CANDIDATE when within-10 and the pooled token ratio is at or below 1; else FIX-METHOD with the MDD (half the pooled 95% interval width)',
    },
    diet, pooled_models: pooledModels.map((m) => m.model), pooled_descriptive: descriptive, models, pooled, skills,
  });
}
export type AblationResult = ReturnType<typeof analyze>;

// ---- markdown

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pts = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);
const ci = (c: [number, number] | null | undefined, f: (x: number) => string) => (c ? `[${f(c[0])}, ${f(c[1])}]` : '[no interval]');
const num = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(0));
const usd = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(4)}`);
const times = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x.toFixed(2)}x`);
const pv = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(4));
const code = (s: string) => '\x60' + s + '\x60';
const truncatedLine = (t: Record<string, Record<string, number>>) => `Truncated captures (cut at the proxy's size cap; opens after the cap are unobserved): ${Object.entries(t).flatMap(([m, arms]) => Object.entries(arms).map(([arm, n]) => `${m} ${arm} ${n}`)).join(', ') || 'no records'}.`;

export function renderHeadroom(h: HeadroomResult): string {
  const out = [`# Headroom (stage 0): ${h.run_id}`, '', `Rule: ${h.rule.text}. Seed ${h.rule.seed}, ${h.rule.draws} draws.`, '',
    '| Model | Role | Cell | Subset | Tasks scored / subset | Trials scored | Pass rate [95% CI] | Informative tasks | Status |', '|---|---|---|---|---|---|---|---|---|'];
  for (const m of h.models) out.push(`| ${m.label} | ${m.role} | ${m.cell} | ${m.subset} | ${m.tasks_scored} / ${m.subset_tasks} | ${m.trials_scored} | ${m.pass_rate ? `${pct(m.pass_rate.estimate)} ${ci(m.pass_rate.ci95, pct)}` : 'n/a'} | ${m.informative_tasks} | ${m.status} |`);
  out.push('', truncatedLine(h.truncated_captures));
  return out.join('\n') + '\n';
}

export function renderSelection(s: SelectionResult): string {
  const out = [`# Arm selection (stage 0): ${s.run_id}`, '', `Rule: ${s.rule.text}.`, '', '## Minus arms', ''];
  if (!s.selected.length) out.push('No skill is eligible.');
  else {
    out.push('| Rank | Arm | Spec | spec_sha256 | Pooled open trials | Listing bytes | Open rate |', '|---|---|---|---|---|---|---|');
    for (const a of s.selected) out.push(`| ${a.rank} | ${a.arm} | ${code(a.spec)} | ${code(a.spec_sha256)} | ${a.pooled_open_trials} | ${a.listing_bytes} | ${Object.entries(a.open_rate).map(([k, v]) => `${k} ${pct(v)}`).join(', ')} |`);
  }
  out.push('', '## Diet', '');
  if (!s.diet) out.push('No excludable skill went unopened, so there is no diet arm.');
  else out.push(`${s.diet.skills.length} skills, ${s.diet.listing_bytes} listing bytes on ${s.frontier_hosts.join(' + ')}.`, '', `Spec: ${code(s.diet.spec)}`, '', `spec_sha256: ${code(s.diet.spec_sha256)}`, '',
    `Put-back order if gstack refuses the render: ${s.diet.put_back_order.join(', ')}.`);
  const openedSkills = [...new Set(s.open_rates.flatMap((t) => t.open_rate.filter((r) => r.trials > 0).map((r) => r.skill)))].sort(byKey);
  out.push('', '## Open rates (scored stage-0 full trials)', '', `| Skill | ${s.open_rates.map((t) => `${t.label} (n ${t.scored_trials})`).join(' | ')} | Eligible |`, `|---|${s.open_rates.map(() => '---|').join('')}---|`);
  for (const skill of openedSkills) {
    const c = s.candidates.find((x) => x.skill === skill);
    out.push(`| ${skill} | ${s.open_rates.map((t) => { const r = t.open_rate.find((x) => x.skill === skill)!; return `${pct(r.rate)} (${r.trials})`; }).join(' | ')} | ${c ? (c.eligible ? 'yes' : c.not_eligible_because.join('; ')) : 'not in skills.json'} |`);
  }
  out.push('', truncatedLine(s.truncated_captures));
  out.push('', `Never opened by any model: ${s.candidates.filter((c) => !openedSkills.includes(c.skill)).length} skills (every row is in selection.json).`);
  return out.join('\n') + '\n';
}

export function renderAnalysis(a: AblationResult): string {
  const out = [`# gstack skill ablation (main stage): ${a.run_id}`, '',
    `Seed ${a.method.seed}, ${a.method.draws} draws, alpha ${a.method.alpha}, non-inferiority margin ${(100 * a.method.ni_margin).toFixed(0)} points. Pass rates are task means with task bootstrap 95% intervals. Differences are arm minus reference, in percentage points.`, '',
    `Pooled models: ${a.pooled_models.join(', ') || 'none'}${a.pooled_descriptive ? ' (descriptive: no frontier model passed headroom)' : ''}.`, '', truncatedLine(a.truncated_captures), ''];
  if (a.diet.spec) out.push(`Diet spec: ${code(a.diet.spec)}` + (a.diet.put_back.length ? `, after putting back ${a.diet.put_back.join(', ')}` : '') + '.', '');
  for (const m of a.models) {
    out.push(`## ${m.label}`, '', `Role ${m.role}; headroom: ${m.headroom}; ${m.pooling}.`, '',
      '| Arm | Cell | Scored / trials | Pass rate [95% CI] | Tokens per trial (input / cached / output / total) | Listing bytes | Opened body tokens | Cost per solve [95% CI] |', '|---|---|---|---|---|---|---|---|');
    for (const r of m.arms) out.push(`| ${r.arm} | ${r.cell} | ${r.scored_trials} / ${r.trials} | ${r.pass_rate ? `${pct(r.pass_rate.estimate)} ${ci(r.pass_rate.ci95, pct)}` : 'n/a'} | ${num(r.tokens_per_trial.input)} / ${num(r.tokens_per_trial.cached)} / ${num(r.tokens_per_trial.output)} / ${num(r.tokens_per_trial.total)} | ${num(r.listing_bytes_mean)} | ${num(r.opened_body_tokens_mean)} | ${r.cost.usd_per_solve === null ? 'no solve' : `${usd(r.cost.usd_per_solve)} ${ci(r.cost.ci95, usd)}`} |`);
    out.push('', '| Comparison | Tasks | Arm / reference | Difference [95% CI] | p | Holm p | Worse / better | Token ratio [95% CI] |', '|---|---|---|---|---|---|---|---|');
    for (const c of m.comparisons) out.push(`| ${c.arm} - ${c.reference} | ${c.tasks_paired} | ${pct(c.mean_arm)} / ${pct(c.mean_reference)} | ${pts(c.estimate)} ${ci(c.ci95, pts)} | ${pv(c.p_two_sided)} | ${pv(c.holm_p)} | ${c.worse} / ${c.better} | ${times(c.tokens_ratio.ratio)} ${ci(c.tokens_ratio.ci95, times)} |`);
    out.push('');
  }
  out.push('## Pooled readings', '', '| Arm | Models | Tasks | Difference [95% CI] | 90% lower bound | Within-10 | Token ratio [95% CI] | MDD | Verdict |', '|---|---|---|---|---|---|---|---|---|');
  for (const p of a.pooled) out.push(`| ${p.arm} | ${p.models.join(', ')}${p.descriptive ? ' (descriptive)' : ''} | ${p.tasks} | ${pts(p.estimate)} ${ci(p.ci95, pts)} | ${pts(p.lower_bound_90)} | ${p.within_10 ? 'yes' : 'no'} | ${times(p.tokens_ratio.estimate)} ${ci(p.tokens_ratio.ci95, times)} | ${p.mdd === null ? 'n/a' : `${(100 * p.mdd).toFixed(1)} points`} | ${p.verdict}: ${p.reason} |`);
  out.push('', '## Skills, ranked by pooled open rate, then listing bytes', '', '| Rank | Skill | Fit | Pooled open rate | Listing bytes (claude / codex) | Kind | Verdict |', '|---|---|---|---|---|---|---|');
  for (const s of a.skills) out.push(`| ${s.rank} | ${s.skill} | ${s.fit} | ${pct(s.open_rate_pooled)} | ${s.listing_bytes.claude ?? 'unlisted'} / ${s.listing_bytes.codex ?? 'unlisted'} | ${s.kind} | ${s.verdict ? `${s.verdict}: ${s.reason}` : s.reason} |`);
  return out.join('\n') + '\n';
}

// ---- CLI

if (import.meta.main) {
  const [cmd] = process.argv.slice(2);
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const results = arg('results'), specPath = arg('spec'), out = arg('out');
  if (!['headroom', 'select', 'analyze'].includes(cmd ?? '') || !results || !specPath || !out || (cmd === 'analyze' && (!arg('headroom') || !arg('selection')))) {
    console.error('usage: bun scripts/frontier-harbor/ablation.ts <headroom|select|analyze> --results <dir or trials.jsonl> --spec <ablation-spec.json> --out <dir> [--headroom <headroom.json> --selection <selection.json>] [--stages <stages.json>]');
    process.exit(2);
  }
  try {
    const spec = readJsonFile<AblationSpec>(specPath);
    const problems = checkSpec(spec);
    if (problems.length) fail(`${specPath}: ${problems.join('; ')}`);
    const cat = loadCatalog(spec);
    const records = readJsonLines<AblationRecord>(results.endsWith('.jsonl') ? results : join(results, 'trials.jsonl'));
    const stages = arg('stages') === undefined ? undefined : readJsonFile<StageMembership>(arg('stages')!);
    mkdirSync(out, { recursive: true });
    const write = (name: string, json: unknown, md: string) => {
      writeFileSync(join(out, `${name}.json`), JSON.stringify(json, null, 2) + '\n');
      writeFileSync(join(out, `${name}.md`), md);
      console.log(`wrote ${join(out, name)}.json and .md`);
    };
    if (cmd === 'headroom') { const h = headroom(records, spec, cat, stages); write('headroom', h, renderHeadroom(h)); }
    else if (cmd === 'select') { const s = select(records, spec, cat, stages); write('selection', s, renderSelection(s)); }
    else {
      const a = analyze(records, spec, cat, readJsonFile<HeadroomResult>(arg('headroom')!), readJsonFile<SelectionResult>(arg('selection')!), stages);
      write('ablation', a, renderAnalysis(a));
    }
  } catch (e) {
    if (!(e instanceof AblationError)) throw e;
    console.error(`ablation: ${e.message}`);
    process.exit(1);
  }
}
