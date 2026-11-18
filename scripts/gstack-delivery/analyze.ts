#!/usr/bin/env bun
// The preregistered analysis of the gstack delivery eval (HARN-61, plan decisions 6 and 8, gate changes d2, d5, d12, d14),
// modelled on scripts/matrix-analysis.ts and scripts/instruction-followed-h10.ts and built on runner/stats/paired.ts.
//
//   bun scripts/gstack-delivery/analyze.ts --trials <trials.jsonl> --probes <probes.jsonl> [--pi-delivery-passed]
//       [--pass-kinds review,ship] [--pi-delivery-from-probes] [--seed 7] [--draws 10000] [--out <dir>]
//   bun scripts/gstack-delivery/analyze.ts --gate --probes <probes.jsonl>      the d5 compliance gate on headroom transcripts
//
// Inputs. trials.jsonl: one line per trial, {trial_id, harness, model, arm, kind, task, rep, termination, grade,
// consent_violation, usd} (usd may sit at usage.usd, as in a TrialRecord). probes.jsonl: scripts/gstack-delivery/probes.ts
// output, joined on trial_id. Writes delivery-analysis.json and delivery-analysis.md to --out (default: stdout, Markdown).
//
// Values. Pass is grade pass with no consent violation; a trial that ended in timeout or harness_error is a fail (0),
// whatever its grade. Compliance is the probe's share of applicable markers met. Excluded, pairwise and counted by reason
// (methodology item 9, d12, d13): a trial ending model_error, infra_error or exam_fault; on a hook, startup or placebo arm,
// a trial whose probe says route_not_delivered, or whose delivery could not be confirmed (no probe row, or an unparsed
// capture); for compliance also an unparsed capture and a trial whose compliance is null (a marker unobservable or
// unscorable). Exclusion is pairwise: a trial pairs with the trial of the other arm at the same harness, model, task and
// rep, and when either side is excluded both are dropped.
//
// Estimator. For a contrast B minus A over a set of harness-model pairs: one item per pair and task, each side the mean over
// its kept reps, clustered on the task, so a task is one cluster however many pairs carry it. runner/stats/paired.ts
// clusteredPairedDelta gives the delta, the 95% task-clustered percentile bootstrap (10,000 draws, seed 7) and the task-level
// sign-flip p (exact up to 20 tasks). Each contrast also counts the tasks that got worse (mean paired difference below 0).
// A contrast with fewer than 10 task clusters is not tested (methodology item 10): it keeps its estimate and interval and
// counts as p = 1 in its Holm family.
//
// Pools (decision 4, d2). The primary pool is every frontier pair (a model that is not particle) except Pi's, which joins
// only with --pi-delivery-passed (Pi's delivery test passed). particle-1 pairs are reported apart, never pooled.
// --pi-delivery-from-probes runs that test here instead (piDeliveryTest), from delivery records alone, never from pass
// rates or markers: over Pi's frontier hook and startup trials, a trial is delivered when its probe is scored, the card is
// in request 1, and on hook every agent request carries a copy (d1). The test passes when at least 95% of those trials are
// delivered, and it prints its counts.
//
//   Primary 1, compliance: hook minus skill and startup minus skill, per kind, Holm over the 4. A claim needs the Holm p at
//     or under 0.05 and the interval's lower bound above 0.
//   Primary 2, pass rate, both kinds pooled: hook minus none, startup minus none, skill minus none, hook minus skill, Holm
//     over the 4. An interval that includes 0 reads "no measurable difference".
//   --pass-kinds (default review,ship): the kinds whose pass rate carries the calls. Primary 2, non-inferiority, the decision
//     table's replace rows, cost per solve, pass^2 and the per-host pass readings use only these kinds. A kind left out is a
//     compliance-only kind: its pass-rate contrasts, non-inferiority readings and cost per solve are reported under
//     descriptive_pass, never tested against a claim (the delivery preregistration's ruling B1 makes ship one).
//   Non-inferiority (d14): hook and startup against none and against skill, 5-point margin, nonInferiorityP on the same
//     bootstrap (one-sided, alpha 0.05), raw and Holm over the 4.
//   Secondary: cost per solved task per arm (all spend of the arm's recorded trials over its passes, task-clustered bootstrap
//     interval, and the paired difference against skill); pass^2 (both of the first two scored reps pass, per pair and task);
//     per-harness and per-model readings of the primary contrasts, each with its minimum detectable effect from powerNote;
//     placebo minus hook where placebo cells ran; particle-1 pairs apart; Pi pairs apart when not pooled; gstack-file reads
//     per arm (contamination; any read outside the skill arm marks that arm contaminated).
//   Decision table (d14): the card replaces skill auto-load where its pass rate is non-inferior to skill (Holm over the
//     non-inferiority family) and its cost per solve is lower (the interval of the difference below 0); a hook or startup
//     default is recommended only where its primary 1 compliance claim holds; per-host advice only for contrasts whose
//     per-host minimum detectable effect is reported.
//
// The d5 gate (--gate): on the none arm of the headroom transcripts, per kind, "followed" at most 50% and at least two
// markers met in at most 60% of the trials that score them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Termination } from '../../runner/contracts.ts';
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, powerNote, seededRandom, type PairedDelta, type PairedItem } from '../../runner/stats/paired.ts';
import { ARMS, DELIVERY_ARMS, DESCRIPTIVE, MARKERS, type Arm, type Kind, type ProbeResult, type ProbeScored } from './probes.ts';

export const SEED = 7;
export const DRAWS = 10_000;
export const ALPHA = 0.05;
export const NI_MARGIN = 0.05;
export const MIN_TESTED_TASKS = 10;
export const KINDS: readonly Kind[] = ['review', 'ship'];
export const EXCLUDED_TERMINATIONS: ReadonlySet<string> = new Set(['model_error', 'infra_error', 'exam_fault']);

export interface DeliveryTrial {
  trial_id: string; harness: string; model: string; arm: Arm; kind: Kind; task: string; rep: number;
  termination: Termination; grade: 'pass' | 'fail' | 'n/a'; consent_violation?: boolean; usd?: number | null; usage?: { usd?: number } | null;
}
export interface Options { seed?: number; draws?: number; alpha?: number; margin?: number; piDeliveryPassed?: boolean; passKinds?: readonly Kind[] }
export type Endpoint = 'pass' | 'compliance';

const pairOf = (t: Pick<DeliveryTrial, 'harness' | 'model'>) => t.harness + '/' + t.model;
export const isParticle = (model: string) => /particle/i.test(model);
const usdOf = (t: DeliveryTrial) => (typeof t.usd === 'number' ? t.usd : typeof t.usage?.usd === 'number' ? t.usage.usd : 0);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** A trial's value on an endpoint, or the reason it is excluded. */
export function trialValue(t: DeliveryTrial, probe: ProbeResult | undefined, endpoint: Endpoint): { value: number } | { excluded: string } {
  if (EXCLUDED_TERMINATIONS.has(t.termination)) return { excluded: t.termination };
  if (DELIVERY_ARMS.has(t.arm)) {
    if (!probe || probe.status !== 'scored') return { excluded: 'delivery_unconfirmed' };
    if (probe.infra_class === 'route_not_delivered') return { excluded: 'route_not_delivered' };
  }
  if (endpoint === 'pass') return { value: t.grade === 'pass' && !t.consent_violation && t.termination !== 'timeout' && t.termination !== 'harness_error' ? 1 : 0 };
  if (!probe) return { excluded: 'no_probe' };
  if (probe.status !== 'scored') return { excluded: 'unparsed' };
  return probe.compliance.share === null ? { excluded: 'unobservable' } : { value: probe.compliance.share };
}

export const PI_DELIVERY_SHARE = 0.95;
/** Pi's delivery test (d2): outcome-blind, from the probes' delivery records of Pi's frontier hook and startup trials. */
export function piDeliveryTest(trials: readonly DeliveryTrial[], probes: readonly ProbeResult[]) {
  const byId = new Map(probes.map((p) => [p.trial_id, p]));
  const ts = trials.filter((t) => t.harness === 'pi' && !isParticle(t.model) && (t.arm === 'hook' || t.arm === 'startup'));
  const delivered = ts.filter((t) => {
    const p = byId.get(t.trial_id);
    if (!p || p.status !== 'scored' || !p.delivery?.in_request_1) return false;
    return t.arm !== 'hook' || p.delivery.requests_with_copy === p.delivery.agent_requests;
  }).length;
  return { trials: ts.length, delivered, share: ts.length ? delivered / ts.length : null, threshold: PI_DELIVERY_SHARE, pass: ts.length > 0 && delivered / ts.length >= PI_DELIVERY_SHARE };
}

export interface Contrast {
  id: string; endpoint: Endpoint; a: Arm; b: Arm; kinds: Kind[]; pairs: string[];
  n_items: number; n_tasks: number; n_rep_pairs: number; excluded: Record<string, number>;
  mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null;
  p_two_sided: number | null; p_method: string | null; tested: boolean;
  tasks_worse: number; tasks_better: number; tasks_same: number;
  mde: number | null; power_note: string | null;
  /** For non-inferiority: the bootstrap draws, kept in memory only. */
  stats: PairedDelta | null;
}

export class Analysis {
  readonly probes: Map<string, ProbeResult>;
  constructor(readonly trials: DeliveryTrial[], probes: ProbeResult[], readonly o: Required<Options>) {
    this.probes = new Map(probes.map((p) => [p.trial_id, p]));
  }

  /** B minus A on an endpoint over the given pairs and kinds, paired by pair, task and rep, excluded pairwise. */
  contrast(id: string, endpoint: Endpoint, a: Arm, b: Arm, pairs: readonly string[], kinds: readonly Kind[]): Contrast {
    const at = new Map<string, DeliveryTrial>();
    for (const t of this.trials) if (pairs.includes(pairOf(t)) && kinds.includes(t.kind) && (t.arm === a || t.arm === b)) at.set([pairOf(t), t.kind, t.task, t.rep, t.arm].join('\u0000'), t);
    const excluded: Record<string, number> = {};
    const count = (r: string) => { excluded[r] = (excluded[r] ?? 0) + 1; };
    const cells = new Map<string, { pair: string; cluster: string; va: number[]; vb: number[] }>();
    const keys = new Set([...at.keys()].map((k) => k.split('\u0000').slice(0, 4).join('\u0000')));
    let repPairs = 0;
    for (const k of [...keys].sort()) {
      const ta = at.get(k + '\u0000' + a), tb = at.get(k + '\u0000' + b);
      if (!ta || !tb) { count('unmatched'); continue; }
      const va = trialValue(ta, this.probes.get(ta.trial_id), endpoint), vb = trialValue(tb, this.probes.get(tb.trial_id), endpoint);
      if ('excluded' in va || 'excluded' in vb) { if ('excluded' in va) count(va.excluded); if ('excluded' in vb) count(vb.excluded); continue; }
      repPairs++;
      const [pair, kind, task] = k.split('\u0000') as [string, string, string];
      const cellKey = pair + '\u0000' + kind + '\u0000' + task;
      const c = cells.get(cellKey) ?? { pair, cluster: kind + ':' + task, va: [], vb: [] };
      c.va.push(va.value); c.vb.push(vb.value);
      cells.set(cellKey, c);
    }
    const items: PairedItem[] = [...cells.values()].map((c) => ({ id: c.pair + '|' + c.cluster, cluster: c.cluster, a: mean(c.va), b: mean(c.vb) }));
    const byTask = new Map<string, number[]>();
    for (const it of items) byTask.set(it.cluster, [...(byTask.get(it.cluster) ?? []), it.b - it.a]);
    const taskDiffs = [...byTask.values()].map(mean);
    const base = { id, endpoint, a, b, kinds: [...kinds], pairs: [...pairs], n_items: items.length, n_tasks: byTask.size, n_rep_pairs: repPairs, excluded,
      tasks_worse: taskDiffs.filter((d) => d < -1e-12).length, tasks_better: taskDiffs.filter((d) => d > 1e-12).length, tasks_same: taskDiffs.filter((d) => Math.abs(d) <= 1e-12).length };
    if (!items.length) return { ...base, mean_a: null, mean_b: null, delta: null, ci95: null, p_two_sided: null, p_method: null, tested: false, mde: null, power_note: null, stats: null };
    const s = clusteredPairedDelta(items, { seed: this.o.seed, draws: this.o.draws });
    const pn = powerNote(s, { alpha: this.o.alpha });
    return { ...base, mean_a: s.mean_a, mean_b: s.mean_b, delta: s.delta, ci95: s.ci95, p_two_sided: s.p_two_sided, p_method: s.p_method, tested: s.n_clusters >= MIN_TESTED_TASKS, mde: pn.mde, power_note: pn.note, stats: s };
  }
}

const holmOver = (cs: Contrast[]) => holmAdjusted(cs.map((c) => (c.tested && c.p_two_sided !== null ? c.p_two_sided : 1)));
const lower90 = (s: PairedDelta | null) => (s && s.bootstrap.length ? s.bootstrap[Math.floor(s.bootstrap.length * 0.05)]! : null);

/** Cost per solved task of one arm over pairs and kinds: all spend of its recorded trials over its passes (scored trials),
 *  with a task-clustered bootstrap; against: the same for a second arm on the same resampled tasks, and the difference, both
 *  arms then read only on the harness-model pairs and tasks where each of them has trials. */
export function costPerSolve(trials: readonly DeliveryTrial[], probes: Map<string, ProbeResult>, arm: Arm, pairs: readonly string[], kinds: readonly Kind[], o: Required<Options>, against?: Arm) {
  const cell = (t: DeliveryTrial) => pairOf(t) + ':' + t.kind + ':' + t.task;
  const cellsOf = (x: Arm) => new Set(trials.filter((t) => t.arm === x).map(cell));
  const otherCells = against ? cellsOf(against) : null;
  const both = otherCells ? new Set([...cellsOf(arm)].filter((c) => otherCells.has(c))) : null;
  const sums = (x: Arm) => {
    const m = new Map<string, { usd: number; passes: number }>();
    for (const t of trials) {
      if (t.arm !== x || !pairs.includes(pairOf(t)) || !kinds.includes(t.kind)) continue;
      if (both && !both.has(cell(t))) continue;
      const c = m.get(t.kind + ':' + t.task) ?? { usd: 0, passes: 0 };
      c.usd += usdOf(t);
      const v = trialValue(t, probes.get(t.trial_id), 'pass');
      if ('value' in v) c.passes += v.value;
      m.set(t.kind + ':' + t.task, c);
    }
    return m;
  };
  const A = sums(arm), B = against ? sums(against) : null;
  const tasks = [...new Set([...A.keys(), ...(B?.keys() ?? [])])].sort();
  const ratio = (m: Map<string, { usd: number; passes: number }>, ts: readonly string[]) => { let u = 0, p = 0; for (const t of ts) { u += m.get(t)?.usd ?? 0; p += m.get(t)?.passes ?? 0; } return p > 0 ? u / p : null; };
  const est = ratio(A, tasks);
  const estB = B ? ratio(B, tasks) : null;
  const rng = seededRandom(o.seed);
  const draws: number[] = [], diffs: number[] = [];
  let undefinedDraws = 0;
  for (let i = 0; i < o.draws && tasks.length > 1; i++) {
    const pick = Array.from({ length: tasks.length }, () => tasks[Math.floor(rng() * tasks.length)]!);
    const ra = ratio(A, pick), rb = B ? ratio(B, pick) : null;
    if (ra === null || (B && rb === null)) { undefinedDraws++; continue; }
    draws.push(ra);
    if (B) diffs.push(ra - rb!);
  }
  const interval = (xs: number[]): [number, number] | null => {
    if (!xs.length || undefinedDraws > o.draws * 0.025) return null;
    const s = [...xs].sort((x, y) => x - y);
    return [s[Math.floor(s.length * 0.025)]!, s[Math.ceil(s.length * 0.975) - 1]!];
  };
  return { arm, against: against ?? null, usd_per_solve: est, ci95: interval(draws), against_usd_per_solve: estB, difference: est !== null && estB !== null ? est - estB : null, difference_ci95: B ? interval(diffs) : null, undefined_draws: undefinedDraws, tasks: tasks.length };
}

/** pass^2: per pair and task, both of the first two scored reps pass; mean over units, task-clustered bootstrap. */
export function passSquared(trials: readonly DeliveryTrial[], probes: Map<string, ProbeResult>, arm: Arm, pairs: readonly string[], kinds: readonly Kind[], o: Required<Options>) {
  const units = new Map<string, Array<{ rep: number; v: number }>>();
  for (const t of trials) {
    if (t.arm !== arm || !pairs.includes(pairOf(t)) || !kinds.includes(t.kind)) continue;
    const v = trialValue(t, probes.get(t.trial_id), 'pass');
    if (!('value' in v)) continue;
    const k = pairOf(t) + '|' + t.kind + ':' + t.task;
    units.set(k, [...(units.get(k) ?? []), { rep: t.rep, v: v.value }]);
  }
  const byTask = new Map<string, number[]>();
  for (const [k, reps] of units) {
    if (reps.length < 2) continue;
    const [r1, r2] = reps.sort((x, y) => x.rep - y.rep);
    const task = k.split('|')[1]!;
    byTask.set(task, [...(byTask.get(task) ?? []), r1!.v === 1 && r2!.v === 1 ? 1 : 0]);
  }
  const tasks = [...byTask.keys()].sort();
  const all = tasks.flatMap((t) => byTask.get(t)!);
  if (!all.length) return { arm, units: 0, tasks: 0, pass2: null, ci95: null };
  const rng = seededRandom(o.seed);
  const draws: number[] = [];
  for (let i = 0; i < o.draws && tasks.length > 1; i++) { const xs = Array.from({ length: tasks.length }, () => byTask.get(tasks[Math.floor(rng() * tasks.length)]!)!).flat(); draws.push(mean(xs)); }
  draws.sort((x, y) => x - y);
  return { arm, units: all.length, tasks: tasks.length, pass2: mean(all), ci95: draws.length ? [draws[Math.floor(o.draws * 0.025)]!, draws[Math.ceil(o.draws * 0.975) - 1]!] as [number, number] : null };
}

export interface GateRow { kind: Kind; trials: number; followed_share: number | null; markers: Record<string, { scored: number; met_share: number | null }>; descriptive: Record<string, { scored: number; met_share: number | null }>; markers_at_most_60: number; pass: boolean }

/** d5: on the none arm of the headroom transcripts, per kind, followed at most 50% and at least two markers at most 60%. */
export function complianceGate(probes: readonly ProbeResult[]): GateRow[] {
  return KINDS.map((kind) => {
    const rows = probes.filter((p): p is ProbeScored => p.status === 'scored' && p.kind === kind && p.arm === 'none');
    const fol = rows.filter((r) => r.compliance.followed !== null);
    const share = (get: (r: ProbeScored) => { state: string } | undefined) => {
      const scoredRows = rows.filter((r) => get(r)?.state === 'met' || get(r)?.state === 'not_met');
      return { scored: scoredRows.length, met_share: scoredRows.length ? scoredRows.filter((r) => get(r)!.state === 'met').length / scoredRows.length : null };
    };
    const markers: GateRow['markers'] = {};
    for (const m of Object.keys(MARKERS).filter((m) => MARKERS[m] === kind)) markers[m] = share((r) => r.markers[m]);
    const descriptive: GateRow['descriptive'] = {};
    for (const m of Object.keys(DESCRIPTIVE).filter((m) => DESCRIPTIVE[m] === kind)) descriptive[m] = share((r) => r.descriptive?.[m]);
    const followedShare = fol.length ? fol.filter((r) => r.compliance.followed).length / fol.length : null;
    const low = Object.values(markers).filter((x) => x.met_share !== null && x.met_share <= 0.6).length;
    return { kind, trials: rows.length, followed_share: followedShare, markers, descriptive, markers_at_most_60: low, pass: followedShare !== null && followedShare <= 0.5 && low >= 2 };
  });
}

const strip = (c: Contrast) => { const { stats: _s, ...rest } = c; return rest; };

export function analyze(trials: DeliveryTrial[], probes: ProbeResult[], options: Options = {}) {
  const o: Required<Options> = { seed: options.seed ?? SEED, draws: options.draws ?? DRAWS, alpha: options.alpha ?? ALPHA, margin: options.margin ?? NI_MARGIN, piDeliveryPassed: options.piDeliveryPassed ?? false, passKinds: options.passKinds ?? KINDS };
  const PK = KINDS.filter((k) => o.passKinds.includes(k));
  if (!PK.length) throw new Error('passKinds names no kind');
  const descriptiveKinds = KINDS.filter((k) => !PK.includes(k));
  const A = new Analysis(trials, probes, o);
  const allPairs = [...new Set(trials.map(pairOf))].sort();
  const frontier = allPairs.filter((p) => !isParticle(p.split('/').slice(1).join('/')));
  const pi = frontier.filter((p) => p.split('/')[0] === 'pi');
  const pool = frontier.filter((p) => o.piDeliveryPassed || !pi.includes(p));
  const particle = allPairs.filter((p) => !frontier.includes(p));

  const P1 = KINDS.flatMap((k) => (['hook', 'startup'] as const).map((d) => A.contrast(d + ' minus skill (' + k + ')', 'compliance', 'skill', d, pool, [k])));
  const h1 = holmOver(P1);
  const primary1 = P1.map((c, i) => {
    const claim = c.tested && h1[i]! <= o.alpha && c.ci95 !== null && c.ci95[0] > 0;
    const lower = c.tested && h1[i]! <= o.alpha && c.ci95 !== null && c.ci95[1] < 0;
    return { ...strip(c), holm_p: h1[i]!, claim, verdict: claim ? 'higher compliance' : lower ? 'lower compliance' : c.tested ? 'no measurable difference' : 'untested: fewer than ' + MIN_TESTED_TASKS + ' task clusters' };
  });
  const P2 = ([['hook', 'none'], ['startup', 'none'], ['skill', 'none'], ['hook', 'skill']] as const).map(([b, a]) => A.contrast(b + ' minus ' + a, 'pass', a, b, pool, PK));
  const h2 = holmOver(P2);
  const primary2 = P2.map((c, i) => ({ ...strip(c), holm_p: h2[i]!, verdict: !c.tested ? 'untested: fewer than ' + MIN_TESTED_TASKS + ' task clusters' : h2[i]! <= o.alpha && c.ci95 && (c.ci95[0] > 0 || c.ci95[1] < 0) ? (c.delta! > 0 ? 'higher pass rate' : 'lower pass rate') : 'no measurable difference' }));

  const NI = ([['hook', 'none'], ['startup', 'none'], ['hook', 'skill'], ['startup', 'skill']] as const).map(([b, a]) => A.contrast(b + ' against ' + a, 'pass', a, b, pool, PK));
  const niP = NI.map((c) => (c.tested && c.stats ? nonInferiorityP(c.stats, o.margin, 'higher') : null));
  const hNI = holmAdjusted(niP.map((p) => p ?? 1));
  const nonInferiority = NI.map((c, i) => ({ id: c.id, a: c.a, b: c.b, margin: o.margin, delta: c.delta, ci95: c.ci95, lower90: lower90(c.stats), p: niP[i], holm_p: hNI[i]!, non_inferior: niP[i] !== null && hNI[i]! <= o.alpha }));
  const niKind = (b: Arm, k: Kind) => { const c = A.contrast(b + ' against skill (' + k + ')', 'pass', 'skill', b, pool, [k]); const p = c.tested && c.stats ? nonInferiorityP(c.stats, o.margin, 'higher') : null; return { delta: c.delta, ci95: c.ci95, lower90: lower90(c.stats), p, non_inferior: p !== null && p <= o.alpha }; };

  const cost = Object.fromEntries((['none', 'skill', 'hook', 'startup'] as const).map((arm) => [arm, costPerSolve(trials, A.probes, arm, pool, PK, o, arm === 'skill' ? undefined : 'skill')]));
  const pass2 = Object.fromEntries((['none', 'skill', 'hook', 'startup'] as const).map((arm) => [arm, passSquared(trials, A.probes, arm, pool, PK, o)]));

  const scopes: Array<{ scope: 'pooled' | Kind; kinds: readonly Kind[] }> = [{ scope: 'pooled', kinds: PK }, ...(PK.length > 1 ? PK.map((k) => ({ scope: k, kinds: [k] as const })) : [])];
  const replace = (['hook', 'startup'] as const).flatMap((d) => scopes.map(({ scope, kinds }) => {
    const ni = scope === 'pooled' ? nonInferiority.find((x) => x.b === d && x.a === 'skill')! : { ...niKind(d, scope as Kind), holm_p: null };
    const c = costPerSolve(trials, A.probes, d, pool, kinds, o, 'skill');
    const cheaper = c.difference_ci95 !== null && c.difference_ci95[1] < 0;
    const reasons = [ni.non_inferior ? null : 'pass rate not shown non-inferior to skill at ' + Math.round(o.margin * 100) + ' points', cheaper ? null : 'cost per solve not shown lower than skill'].filter(Boolean);
    return { delivery: d, scope, family: scope === 'pooled' ? 'non-inferiority, Holm over 4' : 'secondary, per kind', non_inferior: ni.non_inferior, ni_p: ni.p, cost_difference: c.difference, cost_difference_ci95: c.difference_ci95, cheaper, replaces_skill: ni.non_inferior && cheaper, why_not: reasons };
  }));
  const defaults = primary1.map((c) => ({ delivery: c.b, kind: c.kinds[0]!, compliance_delta: c.delta, ci95: c.ci95, holm_p: c.holm_p, recommend_default: c.claim }));

  const reading = (label: string, pairs: string[]) => [
    ...P2.map((c) => A.contrast(c.id, 'pass', c.a, c.b, pairs, PK)),
    ...KINDS.flatMap((k) => (['hook', 'startup'] as const).map((d) => A.contrast(d + ' minus skill (' + k + ')', 'compliance', 'skill', d, pairs, [k]))),
  ].map((c) => ({ scope: label, ...strip(c), advice_allowed: c.mde !== null }));
  const harnesses = [...new Set(frontier.map((p) => p.split('/')[0]!))].sort();
  const models = [...new Set(pool.map((p) => p.split('/').slice(1).join('/')))].sort();
  const perHarness = harnesses.flatMap((h) => reading('harness ' + h + (pi.some((p) => p.startsWith(h + '/')) && !o.piDeliveryPassed ? ' (not pooled: Pi delivery test not passed)' : ''), frontier.filter((p) => p.startsWith(h + '/'))));
  const perModel = models.flatMap((m) => reading('model ' + m, pool.filter((p) => p.endsWith('/' + m))));
  const placeboPairs = [...new Set(trials.filter((t) => t.arm === 'placebo').map(pairOf))].sort();
  const placebo = placeboPairs.length ? [A.contrast('placebo minus hook', 'pass', 'hook', 'placebo', placeboPairs, PK), ...KINDS.map((k) => A.contrast('placebo minus hook (' + k + ')', 'compliance', 'hook', 'placebo', placeboPairs, [k]))].map(strip) : [];
  const particleReadings = particle.length ? reading('particle-1 (secondary, not pooled)', particle) : [];

  const descriptivePass = descriptiveKinds.map((k) => ({
    kind: k,
    comparisons: P2.map((c) => strip(A.contrast(c.id + ' (' + k + ')', 'pass', c.a, c.b, pool, [k]))),
    non_inferiority: NI.map((c) => { const d = A.contrast(c.id + ' (' + k + ')', 'pass', c.a, c.b, pool, [k]); return { id: d.id, delta: d.delta, ci95: d.ci95, lower90: lower90(d.stats) }; }),
    cost_per_solve: Object.fromEntries((['none', 'skill', 'hook', 'startup'] as const).map((arm) => [arm, costPerSolve(trials, A.probes, arm, pool, [k], o, arm === 'skill' ? undefined : 'skill')])),
  }));

  const contamination = ARMS.map((arm) => {
    const ts = trials.filter((t) => t.arm === arm);
    const reads = ts.map((t) => { const p = A.probes.get(t.trial_id); return p && p.status === 'scored' ? p.gstack_reads : 0; });
    const withReads = reads.filter((r) => r > 0).length;
    return { arm, trials: ts.length, trials_reading_gstack: withReads, gstack_reads: reads.reduce((s, r) => s + r, 0), contaminated: arm !== 'skill' && withReads > 0 };
  }).filter((c) => c.trials > 0);
  const exclusions = ARMS.map((arm) => {
    const counts: Record<string, number> = {};
    for (const t of trials.filter((x) => x.arm === arm)) for (const e of ['pass', 'compliance'] as const) {
      const v = trialValue(t, A.probes.get(t.trial_id), e);
      if ('excluded' in v) { const k = e + ':' + v.excluded; counts[k] = (counts[k] ?? 0) + 1; }
    }
    return { arm, trials: trials.filter((x) => x.arm === arm).length, excluded: counts };
  }).filter((x) => x.trials > 0);

  return {
    method: 'per pair and task, each arm\'s mean over its kept reps; task-clustered paired bootstrap (' + o.draws + ' draws, seed ' + o.seed + ') and task-level sign-flip p from runner/stats/paired.ts; exclusions pairwise; Holm per primary family of 4',
    pools: { primary: pool, pi_pooled: o.piDeliveryPassed, pi_pairs: pi, particle_pairs: particle },
    pass_kinds: PK, compliance_only_kinds: descriptiveKinds,
    primary1: { family: 'compliance, Holm over 4', comparisons: primary1 },
    primary2: { family: 'pass rate, ' + (PK.length > 1 ? 'both kinds pooled' : PK[0] + ' only') + ', Holm over 4', comparisons: primary2 },
    non_inferiority: nonInferiority,
    decision_table: { replace_skill: replace, defaults, per_host: perHarness.map((r) => ({ scope: r.scope, contrast: r.id, delta: r.delta, ci95: r.ci95, mde: r.mde, advice_allowed: r.advice_allowed })) },
    cost_per_solve: cost, pass_squared: pass2,
    secondary: { per_harness: perHarness, per_model: perModel, placebo, particle: particleReadings },
    descriptive_pass: descriptivePass,
    contamination, exclusions,
  };
}
export type DeliveryAnalysis = ReturnType<typeof analyze>;

const pts = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : (x >= 0 ? '+' : '') + (100 * x).toFixed(1));
const pc = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(1) + '%');
const ci = (c: [number, number] | null) => (c ? '[' + pts(c[0]) + ', ' + pts(c[1]) + ']' : '[n/a]');
const usd = (x: number | null) => (x === null ? 'n/a' : (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(3));
const p4 = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x < 0.0001 ? x.toExponential(2) : x.toFixed(4));
const excl = (e: Record<string, number>) => Object.entries(e).map(([k, v]) => k + ' ' + v).join(', ') || 'none';

export function markdown(a: DeliveryAnalysis): string {
  const out: string[] = ['# gstack delivery eval: analysis', '', 'Method: ' + a.method + '.', '',
    'Primary pool: ' + (a.pools.primary.join(', ') || 'none') + '. Pi pairs ' + (a.pools.pi_pooled ? 'pooled (delivery test passed)' : 'held out: ' + (a.pools.pi_pairs.join(', ') || 'none')) + '. particle-1 pairs apart: ' + (a.pools.particle_pairs.join(', ') || 'none') + '.', ''];
  out.push('## Primary 1: compliance (Holm over 4)', '', '| Contrast | Skill / card | Delta, points [95% CI] | Tasks (worse) | p | Holm p | Excluded pairs | Verdict |', '|---|---|---|---|---|---|---|---|');
  for (const c of a.primary1.comparisons) out.push('| ' + c.id + ' | ' + pc(c.mean_a) + ' / ' + pc(c.mean_b) + ' | ' + pts(c.delta) + ' ' + ci(c.ci95) + ' | ' + c.n_tasks + ' (' + c.tasks_worse + ') | ' + p4(c.p_two_sided) + ' | ' + p4(c.holm_p) + ' | ' + excl(c.excluded) + ' | ' + c.verdict + ' |');
  out.push('', '## Primary 2: ' + a.primary2.family, '', '| Contrast | A / B | Delta, points [95% CI] | Tasks (worse) | p (sign-flip) | Holm p | Excluded pairs | Verdict |', '|---|---|---|---|---|---|---|---|');
  for (const c of a.primary2.comparisons) out.push('| ' + c.id + ' | ' + pc(c.mean_a) + ' / ' + pc(c.mean_b) + ' | ' + pts(c.delta) + ' ' + ci(c.ci95) + ' | ' + c.n_tasks + ' (' + c.tasks_worse + ') | ' + p4(c.p_two_sided) + ' | ' + p4(c.holm_p) + ' | ' + excl(c.excluded) + ' | ' + c.verdict + ' |');
  out.push('', '## Non-inferiority, 5-point margin', '', '| Contrast | Delta [95% CI] | 90% lower bound | p | Holm p | Non-inferior |', '|---|---|---|---|---|---|');
  for (const n of a.non_inferiority) out.push('| ' + n.id + ' | ' + pts(n.delta) + ' ' + ci(n.ci95) + ' | ' + pts(n.lower90) + ' | ' + p4(n.p) + ' | ' + p4(n.holm_p) + ' | ' + (n.non_inferior ? 'yes' : 'no') + ' |');
  out.push('', '## Decision table (d14)', '', '| Card replaces skill auto-load | Scope | Non-inferior to skill | Cost per solve minus skill [95% CI] | Verdict |', '|---|---|---|---|---|');
  for (const r of a.decision_table.replace_skill) out.push('| ' + r.delivery + ' | ' + r.scope + ' (' + r.family + ') | ' + (r.non_inferior ? 'yes' : 'no') + ' | ' + usd(r.cost_difference) + ' ' + (r.cost_difference_ci95 ? '[' + usd(r.cost_difference_ci95[0]) + ', ' + usd(r.cost_difference_ci95[1]) + ']' : '[n/a]') + ' | ' + (r.replaces_skill ? 'replace' : 'keep skill: ' + r.why_not.join('; ')) + ' |');
  out.push('', '| Default delivery | Kind | Compliance gain [95% CI] | Holm p | Recommend as default |', '|---|---|---|---|---|');
  for (const r of a.decision_table.defaults) out.push('| ' + r.delivery + ' | ' + r.kind + ' | ' + pts(r.compliance_delta) + ' ' + ci(r.ci95) + ' | ' + p4(r.holm_p) + ' | ' + (r.recommend_default ? 'yes' : 'no') + ' |');
  out.push('', '| Per-host reading | Contrast | Delta [95% CI] | MDE | Per-host advice |', '|---|---|---|---|---|');
  for (const r of a.decision_table.per_host) out.push('| ' + r.scope + ' | ' + r.contrast + ' | ' + pts(r.delta) + ' ' + ci(r.ci95) + ' | ' + pts(r.mde) + ' | ' + (r.advice_allowed ? 'allowed' : 'none: no MDE') + ' |');
  out.push('', '## Cost per solved task and pass^2 (secondary)', '', '| Arm | USD per solve [95% CI] | Minus skill [95% CI] | pass^2 [95% CI] (units) |', '|---|---|---|---|');
  for (const arm of Object.keys(a.cost_per_solve)) {
    const c = a.cost_per_solve[arm]!, q = a.pass_squared[arm]!;
    out.push('| ' + arm + ' | ' + usd(c.usd_per_solve) + (c.ci95 ? ' [' + usd(c.ci95[0]) + ', ' + usd(c.ci95[1]) + ']' : ' [n/a]') + ' | ' + (c.against ? usd(c.difference) + (c.difference_ci95 ? ' [' + usd(c.difference_ci95[0]) + ', ' + usd(c.difference_ci95[1]) + ']' : ' [n/a]') : '') + ' | ' + pc(q.pass2) + ' ' + ci(q.ci95) + ' (' + q.units + ') |');
  }
  const sec = (title: string, rows: Array<{ scope?: string; id: string; delta: number | null; ci95: [number, number] | null; n_tasks: number; tasks_worse: number; mde: number | null; excluded: Record<string, number> }>) => {
    if (!rows.length) return;
    out.push('', '## ' + title, '', '| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |', '|---|---|---|---|---|---|');
    for (const r of rows) out.push('| ' + (r.scope ?? '') + ' | ' + r.id + ' | ' + pts(r.delta) + ' ' + ci(r.ci95) + ' | ' + r.n_tasks + ' (' + r.tasks_worse + ') | ' + pts(r.mde) + ' | ' + excl(r.excluded) + ' |');
  };
  for (const d of a.descriptive_pass) {
    sec('Pass rate on ' + d.kind + ', descriptive only (compliance-only kind)', d.comparisons);
    out.push('', '| ' + d.kind + ' (descriptive) | Delta [95% CI] | 90% lower bound |', '|---|---|---|');
    for (const n of d.non_inferiority) out.push('| ' + n.id + ' | ' + pts(n.delta) + ' ' + ci(n.ci95) + ' | ' + pts(n.lower90) + ' |');
    out.push('', '| ' + d.kind + ' arm (descriptive) | USD per solve [95% CI] | Minus skill [95% CI] |', '|---|---|---|');
    for (const [arm, c] of Object.entries(d.cost_per_solve)) out.push('| ' + arm + ' | ' + usd(c.usd_per_solve) + (c.ci95 ? ' [' + usd(c.ci95[0]) + ', ' + usd(c.ci95[1]) + ']' : ' [n/a]') + ' | ' + (c.against ? usd(c.difference) + (c.difference_ci95 ? ' [' + usd(c.difference_ci95[0]) + ', ' + usd(c.difference_ci95[1]) + ']' : ' [n/a]') : '') + ' |');
  }
  sec('Per harness (secondary)', a.secondary.per_harness);
  sec('Per model (secondary)', a.secondary.per_model);
  sec('Placebo against hook (secondary)', a.secondary.placebo);
  sec('particle-1, reported apart (secondary)', a.secondary.particle);
  out.push('', '## Contamination: tool calls naming a gstack file', '', '| Arm | Trials | Trials reading gstack | Reads | Contaminated |', '|---|---|---|---|---|');
  for (const c of a.contamination) out.push('| ' + c.arm + ' | ' + c.trials + ' | ' + c.trials_reading_gstack + ' | ' + c.gstack_reads + ' | ' + (c.contaminated ? 'yes' : c.arm === 'skill' ? 'expected' : 'no') + ' |');
  out.push('', '## Exclusions per arm (trials, by endpoint and reason)', '', '| Arm | Trials | Excluded |', '|---|---|---|');
  for (const e of a.exclusions) out.push('| ' + e.arm + ' | ' + e.trials + ' | ' + excl(e.excluded) + ' |');
  return out.join('\n') + '\n';
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) as T; } catch { throw new Error(file + ' line ' + (i + 1) + ' is not JSON'); } });
}

export function checkTrials(trials: DeliveryTrial[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>(), slot = new Set<string>();
  for (const t of trials) {
    if (typeof t.trial_id !== 'string' || !t.trial_id) { problems.push('a trial without trial_id'); continue; }
    if (seen.has(t.trial_id)) problems.push('duplicate trial_id ' + t.trial_id);
    seen.add(t.trial_id);
    if (!ARMS.includes(t.arm)) problems.push(t.trial_id + ': unknown arm ' + t.arm);
    if (!KINDS.includes(t.kind)) problems.push(t.trial_id + ': unknown kind ' + t.kind);
    if (!t.harness || !t.model || !t.task || !Number.isSafeInteger(t.rep)) problems.push(t.trial_id + ': needs harness, model, task and a whole-number rep');
    const k = [pairOf(t), t.arm, t.kind, t.task, t.rep].join('|');
    if (slot.has(k)) problems.push(t.trial_id + ': a second trial at ' + k);
    slot.add(k);
  }
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const fail = (why: string): never => { console.error('analyze: ' + why); process.exit(2); };
  const probesFile = opt('--probes') ?? fail('--probes <probes.jsonl> is required');
  if (!existsSync(probesFile)) fail(probesFile + ' does not exist');
  const probes = readJsonl<ProbeResult>(probesFile);
  if (argv.includes('--gate')) {
    const rows = complianceGate(probes);
    for (const r of rows) console.log('GATE kind=' + r.kind + ' trials=' + r.trials + ' followed=' + pc(r.followed_share) + ' markers_at_most_60=' + r.markers_at_most_60 + ' ' + Object.entries(r.markers).map(([m, x]) => m + '=' + pc(x.met_share)).join(' ') + ' ' + (r.pass ? 'pass' : 'fail') + Object.entries(r.descriptive).map(([m, x]) => ' descriptive:' + m + '=' + pc(x.met_share)).join(''));
    process.exit(rows.every((r) => r.pass) ? 0 : 1);
  }
  const trialsFile = opt('--trials') ?? fail('--trials <trials.jsonl> is required');
  if (!existsSync(trialsFile)) fail(trialsFile + ' does not exist');
  const trials = readJsonl<DeliveryTrial>(trialsFile);
  const problems = checkTrials(trials);
  if (problems.length) fail(problems.slice(0, 10).join('; '));
  const num = (name: string, d: number) => { const v = opt(name); return v === undefined ? d : Number(v); };
  const passKinds = (opt('--pass-kinds') ?? KINDS.join(',')).split(',').filter(Boolean) as Kind[];
  if (!passKinds.length || passKinds.some((k) => !KINDS.includes(k))) fail('--pass-kinds takes review, ship or review,ship');
  let piDeliveryPassed = argv.includes('--pi-delivery-passed');
  if (argv.includes('--pi-delivery-from-probes')) {
    const pt = piDeliveryTest(trials, probes);
    console.error('pi delivery test: ' + pt.delivered + ' of ' + pt.trials + ' Pi hook and startup trials delivered (threshold ' + PI_DELIVERY_SHARE * 100 + '%): ' + (pt.pass ? 'passed, Pi pairs pooled' : 'not passed, Pi pairs held out'));
    piDeliveryPassed = pt.pass;
  }
  const a = analyze(trials, probes, { seed: num('--seed', SEED), draws: num('--draws', DRAWS), piDeliveryPassed, passKinds });
  const out = opt('--out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'delivery-analysis.json'), JSON.stringify(a, null, 2) + '\n');
    writeFileSync(join(out, 'delivery-analysis.md'), markdown(a));
  } else process.stdout.write(markdown(a));
}
