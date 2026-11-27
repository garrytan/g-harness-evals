#!/usr/bin/env bun
// The preregistered half-way look of the gstack cheap-model run (internal-task): the lift analysis of analyze.ts on the first
// half of every cell's finished trials, and a stop or continue decision per cell.
//
//   bun scripts/frontier-harbor/interim.ts --results <dir> [--results <dir> ...] --spec <installed spec> --spec <told spec>
//       --look-at <N> --gstack-reads <audit json> [--out <dir>]
//
// --results is the merged results directory, or each shard's results directory, a running shard's included: each
// directory's trials.jsonl and the journaled records (trials.journal.jsonl) it does not hold yet are read together, and
// no trial id may appear twice. Every record must be a trial of the specs' run id. The two specs are the run's analysis specs, one per gstack arm
// (frontier-harbor-gstack-analysis/1); they share the no-gstack cells. --look-at is the preregistered look (1404 of 2808).
// --gstack-reads is the gstack-file audit: a JSON object mapping trial id to the number of gstack files the trial read.
// It is required and must name every no-gstack trial recorded so far: without it, or with one left out, the look is
// refused, so it never gives a decision without the clean-arm audit. --out defaults to the one results directory and
// is required with several.
//
// Score time. A trial's score time is its record's ended_at: to-trials.ts writes it from Harbor's result.json finished_at,
// which Harbor stamps after the verifier phase, the last phase of a trial, so it is the moment the verifier's reward
// existed. The record carries no separate verifier timestamp. --look-at N splits evenly over the cells of both specs (1404
// over 18 cells is 78 each), and the look keeps each cell's first N / cells records by ended_at (ties by trial id), so a
// harness or model that launched later is never judged from another's trials; the look refuses until every cell has that
// many. A record with no ended_at has no score time and stays out of the look.
// Every rule below reads only the look's trials, except contamination, which counts every record of the cell, since a
// read of a gstack file is not an outcome and a no-gstack cell that read one is contaminated whenever it happened.
//
// Stop rules, per cell:
//   harm           a model's two cells in one gstack arm stop when that model's lift in that arm, from at least 20 paired
//                  tasks, has a 99.5% task-bootstrap interval wholly below 0.
//   futility       all six gstack cells of one arm stop when every model has at least 20 paired tasks in that arm and every
//                  model's lift has a 99.5% upper bound below 5 points.
//   infra          any cell stops when more than 20% of its trials in the look are infra_error exclusions.
//   contamination  a no-gstack cell stops when any of its trials read a gstack file (--gstack-reads).
// The 99.5% interval is the percentile interval of the lift's task-clustered bootstrap draws (analyze.ts, the spec's seed and
// draws). A lift whose paired differences are all zero has no draws, so its interval is [0, 0].
//
// Writes interim.json. Monitoring must not read pass rates, so stdout prints only the decisions, and the pass rates, lifts
// and intervals sit in interim.json under internal, marked internal.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { RunnerError } from '../../runner/errors.ts';
import { readJsonFile, readJsonLines } from '../../runner/heldout/sealed.ts';
import type { PairedDelta } from '../../runner/stats/paired.ts';
import type { MatrixManifest } from '../matrix-analysis.ts';
import { analyzeGstackWithStats, checkGstackSpec, gstackArmOf, SpecError, type GstackSpec } from './analyze.ts';

export const INTERIM_SCHEMA = 'frontier-harbor-gstack-interim/1';
export const MIN_TASKS = 20;
export const LEVEL = 0.995;
export const FUTILITY_UPPER = 0.05;
export const INFRA_SHARE = 0.2;
export const SCORE_TIME = "ended_at: to-trials.ts writes it from Harbor's result.json finished_at, stamped after the verifier phase (a trial's last), so it is when the verifier's reward existed; the record carries no separate verifier timestamp";
export const RULES = {
  harm: `a model's two cells in one gstack arm stop when that model's lift in that arm, from at least ${MIN_TASKS} paired tasks, has a ${100 * LEVEL}% task-bootstrap interval wholly below 0`,
  futility: `all six gstack cells of one arm stop when every model has at least ${MIN_TASKS} paired tasks in that arm and every model's lift has a ${100 * LEVEL}% upper bound below ${100 * FUTILITY_UPPER} points`,
  infra: `any cell stops when more than ${100 * INFRA_SHARE}% of its trials in the look are infra_error exclusions`,
  contamination: 'a no-gstack cell stops when any of its trials read a gstack file (the --gstack-reads audit, every record of the cell)',
};
export type StopRule = keyof typeof RULES;

export interface InterimInput { records: TrialRecord[]; specs: GstackSpec[]; look_at: number; gstack_reads: Record<string, number> | null; planned: number | null }

/** The two-sided percentile interval at level of a paired delta's bootstrap draws; [delta, delta] when no paired difference varied. */
export function bootstrapInterval(stats: PairedDelta | null, level: number): [number, number] | null {
  if (!stats || stats.n_clusters < 2) return null;
  const b = stats.bootstrap;
  if (!b.length) return [stats.delta, stats.delta];
  const tail = (1 - level) / 2;
  return [b[Math.floor(b.length * tail)]!, b[Math.ceil(b.length * (1 - tail)) - 1]!];
}

const scoreTime = (t: TrialRecord) => Date.parse(t.ended_at);
/** to-trials.ts journal's file in a running shard's results directory: one { record } row per finished trial. */
const JOURNAL = 'trials.journal.jsonl';
const round = (x: number | null | undefined, d = 6) => (x === null || x === undefined ? null : Number(x.toFixed(d)));

function checkSpecs(specs: GstackSpec[]): string[] {
  const problems = specs.flatMap((s, i) => checkGstackSpec(s, null).map((p) => `spec ${i + 1}: ${p}`));
  if (problems.length) return problems;
  if (specs.length !== 2) return [`the look needs the two specs, installed and told; got ${specs.length}`];
  const [a, b] = specs as [GstackSpec, GstackSpec];
  if (new Set(specs.map(gstackArmOf)).size !== 2) problems.push('the two specs analyze the same gstack arm');
  if (a.run_id !== b.run_id) problems.push(`the specs name two runs, ${a.run_id} and ${b.run_id}`);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.models, b.models) || a.target !== b.target || !same(a.frontier, b.frontier) || !same(a.harnesses, b.harnesses)) problems.push('the specs differ in models, target, frontier or harnesses');
  if (a.seed !== b.seed || a.draws !== b.draws) problems.push('the specs differ in seed or draws');
  const none = (s: GstackSpec) => s.cells.filter((c) => c.arm === 'none').sort((x, y) => (x.id < y.id ? -1 : 1));
  if (!same(none(a), none(b))) problems.push('the specs differ in their no-gstack cells');
  return problems;
}

export function interimLook(input: InterimInput) {
  const problems = checkSpecs(input.specs);
  if (problems.length) throw new SpecError(problems.join('; '));
  if (!Number.isSafeInteger(input.look_at) || input.look_at < 1) throw new SpecError('--look-at must be a positive integer');
  const cells = new Map(input.specs.flatMap((s) => s.cells).map((c) => [c.id, c]));
  const outside = input.records.filter((t) => !cells.has(t.cell));
  if (outside.length) throw new SpecError(`${outside.length} record(s) name a cell neither spec defines, for example ${outside[0]!.trial_id} (cell ${outside[0]!.cell})`);
  const runId = input.specs[0]!.run_id;
  const foreign = input.records.filter((t) => !t.trial_id.startsWith(runId + '/'));
  if (foreign.length) throw new SpecError(`${foreign.length} record(s) are not trials of ${runId}, for example ${foreign[0]!.trial_id}`);
  const recorded = new Set(input.records.map((t) => t.trial_id));
  if (recorded.size !== input.records.length) throw new SpecError(`${input.records.length - recorded.size} trial id(s) appear in more than one record`);
  const reads = input.gstack_reads;
  if (!reads) throw new SpecError('--gstack-reads is required: the look gives no decision without the clean-arm audit of every no-gstack trial');
  const unknown = Object.keys(reads).filter((id) => !recorded.has(id));
  if (unknown.length) throw new SpecError(`--gstack-reads names ${unknown.length} trial(s) with no record: ${unknown.slice(0, 5).join(', ')}`);
  const bad = Object.entries(reads).filter(([, n]) => !Number.isSafeInteger(n) || n < 0);
  if (bad.length) throw new SpecError(`--gstack-reads must map trial ids to counts; ${bad[0]![0]} has ${JSON.stringify(bad[0]![1])}`);
  const missing = input.records.filter((t) => cells.get(t.cell)?.arm === 'none' && !Object.hasOwn(reads, t.trial_id)).map((t) => t.trial_id);
  if (missing.length) throw new SpecError(`--gstack-reads must give a count for every no-gstack trial, and leaves out ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
  const timed = input.records.filter((t) => Number.isFinite(scoreTime(t))).sort((x, y) => scoreTime(x) - scoreTime(y) || (x.trial_id < y.trial_id ? -1 : x.trial_id > y.trial_id ? 1 : 0));
  if (timed.length < input.look_at) throw new SpecError(`only ${timed.length} trial(s) have a score time so far; the look is at ${input.look_at}`);
  const per = input.look_at / cells.size;
  if (!Number.isSafeInteger(per)) throw new SpecError(`--look-at ${input.look_at} does not split evenly over the ${cells.size} cells; the look takes the same number of trials from each`);
  const byCell = [...cells.keys()].map((id) => [id, timed.filter((t) => t.cell === id)] as const);
  const short = byCell.filter(([, ts]) => ts.length < per);
  if (short.length) throw new SpecError(`the look takes each cell's first ${per} finished trials, and ${short.length} cell(s) have fewer so far: ${short.map(([id, ts]) => `${id} (${ts.length})`).join(', ')}`);
  const look = byCell.flatMap(([, ts]) => ts.slice(0, per)).sort((x, y) => scoreTime(x) - scoreTime(y) || (x.trial_id < y.trial_id ? -1 : x.trial_id > y.trial_id ? 1 : 0));

  const stops = new Map<string, Set<StopRule>>([...cells.keys()].map((id) => [id, new Set<StopRule>()]));
  const arms = input.specs.map((spec) => {
    const arm = gstackArmOf(spec)!;
    const { analysis, lift_stats } = analyzeGstackWithStats({ records: look, manifest: null }, spec);
    const models = analysis.lift.map((r) => {
      const ci = bootstrapInterval(lift_stats[r.model] ?? null, LEVEL);
      const enough = r.tasks >= MIN_TASKS;
      return { model: r.model, paired_tasks: r.tasks, lift: r.delta, ci95: r.ci95, ci995: ci && [round(ci[0])!, round(ci[1])!] as [number, number],
        harm: enough && ci !== null && ci[1] < 0, under_futility_bound: enough && ci !== null && ci[1] < FUTILITY_UPPER, cells: r.cells.gstack };
    });
    for (const m of models) if (m.harm) for (const id of m.cells) stops.get(id)!.add('harm');
    const futility = models.every((m) => m.under_futility_bound);
    if (futility) for (const m of models) for (const id of m.cells) stops.get(id)!.add('futility');
    return { arm, futility, models, analysis };
  });

  const decisions = [...cells.values()].map((c) => {
    const inLook = look.filter((t) => t.cell === c.id);
    const infra = inLook.filter((t) => t.termination === 'infra_error').length;
    if (inLook.length && infra / inLook.length > INFRA_SHARE) stops.get(c.id)!.add('infra');
    const readTrials = c.arm !== 'none' ? null : input.records.filter((t) => t.cell === c.id && (reads[t.trial_id] ?? 0) > 0).length;
    if (readTrials) stops.get(c.id)!.add('contamination');
    const by = (Object.keys(RULES) as StopRule[]).filter((r) => stops.get(c.id)!.has(r));
    return { cell: c.id, model: c.model, harness: c.harness, arm: c.arm, stop: by.length > 0, stopped_by: by, trials_in_look: inLook.length, infra_errors: infra,
      gstack_read_trials: readTrials };
  });
  const modelLabel = new Map(input.specs[0]!.models.map((m) => [m.id, m.label ?? m.id]));
  return {
    schema: INTERIM_SCHEMA, run_id: input.specs[0]!.run_id, look_at: input.look_at, trials_planned: input.planned, trials_recorded: input.records.length,
    trials_with_score_time: timed.length, trials_without_score_time: input.records.length - timed.length, score_time: SCORE_TIME,
    look_ends_at: look.at(-1)!.ended_at, rules: RULES, decisions,
    internal: {
      note: 'internal: pass rates, lifts and intervals for the analysis owner only; monitoring reads the decisions above and nothing here',
      arms: arms.map((a) => ({ arm: a.arm, futility: a.futility, models: a.models.map(({ cells: _c, ...m }) => ({ label: modelLabel.get(m.model)!, ...m })), analysis: a.analysis })),
    },
  };
}

export type InterimLook = ReturnType<typeof interimLook>;

/** The decisions only: stdout must carry no pass rate. */
export function renderDecisions(l: InterimLook): string {
  const why: Record<StopRule, (d: InterimLook['decisions'][number]) => string> = {
    harm: (d) => `harm: this model's lift with gstack ${d.arm} has a ${100 * LEVEL}% interval wholly below 0 on at least ${MIN_TASKS} paired tasks`,
    futility: (d) => `futility: every model's lift with gstack ${d.arm} has a ${100 * LEVEL}% upper bound below ${100 * FUTILITY_UPPER} points on at least ${MIN_TASKS} paired tasks`,
    infra: (d) => `infra: ${d.infra_errors} of ${d.trials_in_look} trials in the look are infra_error, above ${100 * INFRA_SHARE}%`,
    contamination: (d) => `contamination: ${d.gstack_read_trials} trial(s) read a gstack file`,
  };
  const out = [`INTERIM: ${l.run_id}: look at ${l.look_at} of ${l.trials_planned ?? 'unknown'} planned trials, ordered by ended_at; the look ends at ${l.look_ends_at}`];
  for (const d of l.decisions) out.push(`${d.cell}: ${d.stop ? `stop (${d.stopped_by.map((r) => why[r](d)).join('; ')})` : 'continue'}`);
  out.push(`INTERIM_RESULT: ${l.decisions.filter((d) => d.stop).length} of ${l.decisions.length} cells stop`);
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const all = (n: string) => process.argv.flatMap((x, i) => (process.argv[i - 1] === `--${n}` ? [x] : []));
  const results = all('results'), specs = all('spec'), lookAt = all('look-at')[0], readsFile = all('gstack-reads')[0], out = all('out')[0] ?? (results.length === 1 ? results[0] : undefined);
  if (!results.length || results.some((d) => !existsSync(join(d, 'trials.jsonl')) && !existsSync(join(d, JOURNAL))) || specs.length !== 2 || specs.some((s) => !existsSync(s)) || !lookAt || !out || !readsFile || !existsSync(readsFile)) {
    console.error('usage: bun scripts/frontier-harbor/interim.ts --results <dir with trials.jsonl or ' + JOURNAL + '> [--results <dir> ...] --spec <installed spec> --spec <told spec> --look-at <N> --gstack-reads <audit json> [--out <dir>, required with several --results]');
    process.exit(2);
  }
  try {
    const specList = specs.map((s) => readJsonFile<GstackSpec>(s));
    const cellIds = new Set(specList.flatMap((s) => s.cells?.map((c) => c.id) ?? []));
    const manifests = results.filter((d) => existsSync(join(d, 'manifest.json'))).map((d) => readJsonFile<MatrixManifest>(join(d, 'manifest.json')));
    const planned = manifests.length ? new Set(manifests.flatMap((m) => m.trials.filter((t) => cellIds.has(t.cell)).map((t) => t.id))).size : null;
    const reads = readJsonFile<Record<string, number>>(readsFile);
    if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) throw new SpecError(`${readsFile} must be a JSON object mapping trial id to the number of gstack files read`);
    const recordsOf = (d: string) => {
      const done = existsSync(join(d, 'trials.jsonl')) ? readJsonLines<TrialRecord>(join(d, 'trials.jsonl')) : [];
      const have = new Set(done.map((t) => t.trial_id));
      const lines = existsSync(join(d, JOURNAL)) ? readFileSync(join(d, JOURNAL), 'utf8').split('\n').filter((l) => l.trim()) : [];
      const journaled = lines.flatMap((l, i) => {
        try { return [(JSON.parse(l) as { record: TrialRecord }).record]; } catch { if (i < lines.length - 1) throw new SpecError(`${join(d, JOURNAL)} line ${i + 1} is not JSON`); return []; }
      });
      return [...done, ...journaled.filter((t) => !have.has(t.trial_id))];
    };
    const look = interimLook({ records: results.flatMap(recordsOf), specs: specList, look_at: Number(lookAt), gstack_reads: reads, planned });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'interim.json'), JSON.stringify(look, null, 1) + '\n');
    process.stdout.write(renderDecisions(look));
    console.log(`wrote ${join(out, 'interim.json')}`);
  } catch (e) {
    if (e instanceof SpecError) { console.error(`interim: refused: ${e.message}`); process.exit(2); }
    if (e instanceof RunnerError) { console.error(`interim: ${e.message}`); process.exit(2); }
    throw e;
  }
}
