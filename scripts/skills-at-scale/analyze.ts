#!/usr/bin/env bun
// The skills-at-scale analysis (internal-task-a, internal-task-b): every outcome and decision rule in the plan's "Outcomes" and "The
// question and the decision", from merged results. Keyless and offline; tests/skills-at-scale-analyze.test.ts runs it on
// synthetic trials where the answer is known. The statistics are scripts/skill-resolver/analyze.ts's (contrast: pairs per
// request within a cell, cluster bootstrap and cluster sign-flip from runner/stats/paired.ts), reused, not copied.
//
//   bun scripts/skills-at-scale/analyze.ts --results <merged results dir> --requests <setl.jsonl> --labels <labels-l.jsonl>
//       --ladder <ladder.json> --places <places.json> [--pins <pins.json>] [--margins <margins.json>]
//       [--adjudications <adjudications.jsonl>] [--queue <queue.jsonl>] [--judge-check <judge-check.json>]
//       [--interim <interim.json>] [--flagged <flagged.jsonl>] [--settled <settled.jsonl>] --out <dir>
//
// Inputs:
//   <results>/manifest.json and trials.jsonl, shaped like #449's results/merged (runner/run.ts, scripts/merge-shards.ts). Every
//     cell carries skill_arm (native, resolver or resolver-pins) and rung (100, 351, 700 or 1500); a set T cell also carries
//     slice skill-tasks. Each trial directory holds got-skill.json (what the agent opened) and, for outcome 1,
//     saw-skill.json ({described: [skill], name_only: [skill], block_requests}: skills found in the model's captured request
//     with at least 40 characters of description or a resolver line, or by name only, and how many requests carried a
//     resolver block, which the no-skill block rate reads). A trial with no saw-skill.json has no value for
//     outcome 1 and is counted under "no value".
//   --requests: set L rows {id, kind: skill|none, target, stratum, half} (gen-set-l.ts). Requests cluster by target skill; a
//     no-skill request is its own cluster.
//   --labels: label-l.ts rows {id, judges: {astra: {no_skill_needed, acceptable}, opus: {...}}}. A trial is scored with the
//     other family's judge (R78): Opus 5.5 labels score OpenAI models, GPT-6.2 Astra labels score every other model.
//   --ladder: {rungs: {"100": [skill], "351": [...], "700": [...], "1500": [...]}}, nested. A request's acceptable set at a
//     rung is its 1,500-catalog set intersected with that rung's catalog.
//   --places: the keyless listing map, {harnesses: {<harness>: {"<rung>": {described, name_only, omitted, not_loaded}}}},
//     each a list of skills: listed with a description, name only, loaded but left out of the prompt, not loaded.
//   --pins: {pins: [skill]}, the 20 pre-drawn pins (decision D). --margins: {<harness>: {wrong_skill, no_skill_open}}, the
//     preregistered non-inferiority margins; without it the plan's expected margins are used and the output says so.
//   --adjudications: adjudicate.ts rows {request_id, skill, acceptable}; an opened skill adjudicated acceptable joins the
//     request's acceptable set for both judges. --queue: adjudicate.ts's queue; items with no adjudication are pending, and
//     every decision is marked provisional while any are.
//   --judge-check: adjudicate.ts gold-check output; the decision counts only when both judges reach kappa 0.6 on at least
//     100 gold pairs (R78 for preregistrations frozen from 2026-11-22).
//
// Rules, from the plan: outcomes are resolver minus native, paired per request within a setup (harness and model) and rung,
// clustered by target skill. Opened the right skill counts on all skill-needing requests (what a user gets); the reachable
// line (an acceptable skill the native harness listed, with a description or by name) is reported beside it (F13). A
// no-skill request with an acceptable skill at a rung leaves the no-skill bars at that rung (F3). S is found by a fixed
// sequence per harness, 1,500 first, then 700, 351 and 100 (runner/stats/fixed-sequence.ts); a rung passes when opened the
// right skill is at least +5 points with the 95% interval above 0, both harm bars pass as non-inferiority tests pooled over
// the rungs at or above it and on each model separately, and set T success pooled over setups at those rungs does not sit
// wholly below 0. A harm bar passes when the one-sided 97.5% cluster-bootstrap bound sits below the margin; with no
// discordant pair at all, the bound is the exact Clopper-Pearson bound for zero events over the pairs. Every INFRA trial
// stays in (intention-to-treat); contaminated trials are left out as #449 did. Output: <out>/analysis.json and analysis.md.
//
// The interim look (R113, sequential.ts): the 1,500-rung primary of each harness is looked at once, when the first half of
// the target skills and of the no-skill requests (the units, in the seeded order interimUnits gives, which the run follows)
// have run at 1,500. Run
//   bun scripts/skills-at-scale/analyze.ts --look interim [the same inputs] [--planned-effect <json>] [--margins <json>] --out <dir>
// on those trials; it writes <out>/interim.json with each harness's z, conditional power under the planned effect
// (--planned-effect {<harness>: effect}, else the plan's smallest detectable differences: 8.9 points on one model, 6.3 on
// two) and its decision. The bounds are two-look O'Brien-Fleming bounds at each test's own alpha (power.ts obfBounds): 2.80
// and 1.98 for the two-sided 0.05 primary, the same for the one-sided 0.025 harm bars (nominal 0.00258 at the interim and
// 0.0240 at the final). stop_efficacy (z >= 2.80, and both harm bars of the 1,500 step passing on the interim units at the
// interim nominal alpha; otherwise the run continues) ends that harness's 1,500-rung cells: the 1,500 primary passes on the
// interim data when it also clears the +5 bar, and every output says it stopped early and that the estimate is possibly
// overstated. stop_futility (conditional power under 10%) and stop_loss (z <= -2.80) fail the 1,500 step, so by the fixed
// sequence nothing smaller is tested and the harness's run can stop. continue runs to the end, where the 1,500 primary
// needs z >= 1.98 as well as the +5 bar. The final analysis takes the record with --interim <interim.json>; without it the
// status stays provisional.
//
// Flagged trials (internal-task, 2026-11-19): --flagged <flagged.jsonl> (flags.ts) lists the trials #491's cd handling could get
// wrong, and --settled <settled.jsonl> (adjudicate-flags.ts) their verdicts from two readers. A settled trial counts with
// its settled clean-arm verdict and opened skills in place of the automatic ones; flagged trials are reported as their own
// line per harness, rung and arm, and the status stays provisional without the flag file or while any flagged trial is
// unsettled.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clopperPearson } from '../../runner/stats/exact.ts';
import { fixedSequence } from '../../runner/stats/fixed-sequence.ts';
import { nonInferiorityP } from '../../runner/stats/paired.ts';
import { DRAWS, SEED, contrast, interval, loadTrials, type Trial } from '../skill-resolver/analyze.ts';
import { LOOKS, lookDecision, type LookDecision } from './sequential.ts';
import { obfBounds } from './power.ts';
import type { FlaggedRow } from './flags.ts';
import type { Settled } from './adjudicate-flags.ts';

export const RUNGS = [1500, 700, 351, 100] as const;
export const ARMS = ['native', 'resolver', 'resolver-pins'] as const;
export const PLACES = ['described', 'name_only', 'omitted', 'not_loaded'] as const;
export const OPEN_RIGHT_BAR = 0.05;
export const NI_ALPHA = 0.025;
/** Two-look O'Brien-Fleming bounds (R113) at each test's own alpha: the primary is two-sided 0.05 (2.80 and 1.98), the
 *  harm bars one-sided NI_ALPHA. A harm bar tested at the interim look uses the interim nominal alpha, else the final. */
export const PRIMARY_BOUNDS = obfBounds(0.05, 2);
export const HARM_BOUNDS = obfBounds(NI_ALPHA, 1);
export const NO_SKILL_BLOCK_BAR = 0.25;
export const PINS_BAR = 0.10;
export const PINS_UNPINNED_FLOOR = -0.03;
export const PINS_HARNESSES = ['hermes', 'openclaw', 'pi'];
export const KAPPA_MIN = 0.6;
export const MIN_GOLD = 100;
export const PLAN_MARGINS = { one_model: { wrong_skill: 0.045, no_skill_open: 0.045 }, two_models: { wrong_skill: 0.03, no_skill_open: 0.03 } };
export const JUDGES = { astra: 'openai:gpt-6.2-astra', opus: 'anthropic:claude-opus-5-5' } as const;
export const PLANNED_EFFECT = { one_model: 0.089, two_models: 0.063 };
export const INTERIM_SEED = 'harn-107-interim-v1';

export type Place = (typeof PLACES)[number];
export type Request = { id: string; kind: 'skill' | 'none'; target: string | null; stratum?: string | null; half?: string | null };
export type JudgeLabel = { no_skill_needed: boolean; acceptable: string[] };
export type LabelRow = { id: string; judges: Partial<Record<'astra' | 'opus', JudgeLabel>> };
export type Ladder = Record<number, Set<string>>;
export type Places = Record<string, Record<string, Partial<Record<Place, string[]>>>>;
export type Margins = Record<string, { wrong_skill: number; no_skill_open: number }>;
export type Adjudication = { request_id: string; skill: string; acceptable: boolean };
export type ScaleTrial = Trial & { rung: number; usage: { input_tokens: number; usd: number } | null; saw: { described: string[]; name_only: string[]; block_requests?: number } | null };

/** Whether a captured request carried a gbrain resolver block (saw-skill.json block_requests). gbrain's own hooks write no
 *  status log of ours, so this is the record of a block on a skills-at-scale trial; #449-style status turns still count too. */
export const sawBlock = (t: ScaleTrial): boolean => (t.saw?.block_requests ?? 0) > 0;
export type GoldCheck = { n_gold: number; sources: Record<string, { kappa: number | null }> };
type Contrast = ReturnType<typeof contrast>;

const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const strList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** The judge whose labels score a model: the other family's (R78). */
export const judgeFor = (model: string): 'astra' | 'opus' => (model.startsWith('openai:') ? 'opus' : 'astra');

/** #449's loader plus each trial's rung (from its cell), metered usage and saw-skill.json. */
export function loadScaleTrials(results: string): ScaleTrial[] {
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; rung?: number; skill_arm?: string }> };
  const rung = new Map(manifest.cells.map((c) => [c.id, c.rung]));
  const bad = manifest.cells.filter((c) => !RUNGS.includes(c.rung as never) || !ARMS.includes(c.skill_arm as never));
  if (bad.length) throw new Error('HE-SCALE-001 cells without a rung of ' + RUNGS.join(', ') + ' or a skill_arm of ' + ARMS.join(', ') + ': ' + bad.map((c) => c.id).join(', '));
  const usage = new Map((readJsonl(join(results, 'trials.jsonl')) as Array<{ trial_id: string; usage?: { input_tokens?: number; usd?: number } }>)
    .map((r) => [r.trial_id, r.usage && typeof r.usage.input_tokens === 'number' && typeof r.usage.usd === 'number' ? { input_tokens: r.usage.input_tokens, usd: r.usage.usd } : null]));
  return loadTrials(results).map((t) => {
    const f = join(results, 'trials', ...t.id.split('/').slice(1), 'saw-skill.json');
    const s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    return { ...t, rung: rung.get(t.cell)!, usage: usage.get(t.id) ?? null, saw: s ? { described: strList(s.described), name_only: strList(s.name_only), ...(typeof s.block_requests === 'number' ? { block_requests: s.block_requests } : {}) } : null };
  });
}

export function readLadder(path: string): Ladder {
  return ladderOf((JSON.parse(readFileSync(path, 'utf8')) as { rungs?: Record<string, string[]> }).rungs ?? {});
}

/** Checks the ladder holds every rung and is nested. */
export function ladderOf(rungs: Record<string, string[]>): Ladder {
  const out: Ladder = {};
  for (const r of RUNGS) {
    if (!rungs[String(r)]) throw new Error('HE-SCALE-002 ladder has no rung ' + r);
    out[r] = new Set(rungs[String(r)]);
  }
  for (let i = RUNGS.length - 1; i > 0; i--) {
    const small = out[RUNGS[i]!]!, big = out[RUNGS[i - 1]!]!;
    const missing = [...small].filter((s) => !big.has(s));
    if (missing.length) throw new Error('HE-SCALE-003 ladder is not nested: rung ' + RUNGS[i] + ' has ' + missing.length + ' skill(s) rung ' + RUNGS[i - 1] + ' lacks');
  }
  return out;
}

type Ctx = ReturnType<typeof context>;

function context(o: { requests: Request[]; labels: LabelRow[]; ladder: Ladder; places: Places; adjudications: Adjudication[] }) {
  const req = new Map(o.requests.map((r) => [r.id, r]));
  const labels = new Map(o.labels.map((l) => [l.id, l]));
  const added = new Map<string, string[]>();
  for (const a of o.adjudications) if (a.acceptable) added.set(a.request_id, [...(added.get(a.request_id) ?? []), a.skill]);
  const acceptable = (t: ScaleTrial): string[] | null => {
    const j = labels.get(t.task)?.judges[judgeFor(t.model)];
    if (!j) return null;
    return [...new Set([...(j.no_skill_needed ? [] : j.acceptable), ...(added.get(t.task) ?? [])])];
  };
  const atRung = (t: ScaleTrial) => (acceptable(t) ?? []).filter((s) => o.ladder[t.rung]?.has(s));
  const listing = (h: string, r: number) => o.places[h]?.[String(r)];
  const placeOf = (h: string, r: number, skill: string | null): Place | 'unknown' => {
    const l = listing(h, r);
    if (!l || !skill) return 'unknown';
    return PLACES.find((p) => l[p]?.includes(skill)) ?? 'unknown';
  };
  const skillNeed = (t: ScaleTrial): string | null => {
    const r = req.get(t.task);
    if (!r) return 'no request row';
    if (r.kind !== 'skill') return 'no-skill request';
    if (!acceptable(t)) return 'no label';
    return atRung(t).length ? null : 'no acceptable skill at this rung';
  };
  const reachable = (t: ScaleTrial): string | null => {
    const why = skillNeed(t);
    if (why) return why;
    const l = listing(t.harness, t.rung);
    if (!l) return 'no listing map for this harness and rung';
    const shown = new Set([...(l.described ?? []), ...(l.name_only ?? [])]);
    return atRung(t).some((s) => shown.has(s)) ? null : 'no acceptable skill in the native listing';
  };
  const noSkill = (t: ScaleTrial): string | null => {
    const r = req.get(t.task);
    if (!r) return 'no request row';
    if (r.kind !== 'none') return 'skill request';
    if (!acceptable(t)) return 'no label';
    return atRung(t).length ? 'acceptable skill at this rung (F3)' : null;
  };
  const opened = (t: ScaleTrial, right: boolean) => { const acc = new Set(acceptable(t) ?? []); return t.opened.some((s) => acc.has(s) === right) ? 1 : 0; };
  const saw = (t: ScaleTrial, key: 'any' | 'described' | 'name_only') => {
    if (!t.saw) return null;
    const acc = new Set(atRung(t));
    const ds = t.saw.described.some((s) => acc.has(s)), ns = t.saw.name_only.some((s) => acc.has(s));
    return (key === 'any' ? ds || ns : key === 'described' ? ds : ns && !ds) ? 1 : 0;
  };
  return { req, skillNeed, reachable, noSkill, opened, saw, targetPlace: (t: ScaleTrial) => placeOf(t.harness, t.rung, req.get(t.task)?.target ?? null) };
}

const OUTCOMES: Record<string, { value: (c: Ctx) => (t: ScaleTrial) => number | null; eligible: (c: Ctx) => (t: ScaleTrial) => string | null }> = {
  saw_right_skill: { value: (c) => (t) => c.saw(t, 'any'), eligible: (c) => c.skillNeed },
  saw_right_skill_described: { value: (c) => (t) => c.saw(t, 'described'), eligible: (c) => c.skillNeed },
  saw_right_skill_name_only: { value: (c) => (t) => c.saw(t, 'name_only'), eligible: (c) => c.skillNeed },
  opened_right_skill: { value: (c) => (t) => c.opened(t, true), eligible: (c) => c.skillNeed },
  opened_right_skill_reachable: { value: (c) => (t) => c.opened(t, true), eligible: (c) => c.reachable },
  opened_wrong_skill: { value: (c) => (t) => c.opened(t, false), eligible: (c) => c.skillNeed },
  no_skill_opened_any: { value: () => (t) => (t.opened.length ? 1 : 0), eligible: (c) => c.noSkill },
  input_tokens_per_request: { value: () => (t) => t.usage?.input_tokens ?? null, eligible: () => () => null },
  usd_per_request: { value: () => (t) => t.usage?.usd ?? null, eligible: () => () => null },
};
const PLACE_OUTCOMES = ['saw_right_skill', 'opened_right_skill', 'opened_wrong_skill', 'input_tokens_per_request', 'usd_per_request'];

const run = (c: Ctx, ts: ScaleTrial[], outcome: string, a = 'native', b = 'resolver') => {
  const o = OUTCOMES[outcome]!;
  const elig = o.eligible(c);
  return contrast(ts, a, b, o.value(c) as (t: Trial) => number | null, (t) => elig(t as ScaleTrial));
};
const strip = (x: Contrast) => { const { stats: _s, ...rest } = x; return rest; };
const discordance = (x: Contrast) => ({ discordant: x.n_better + x.n_worse, n_pairs: x.n_pairs, share: x.n_pairs ? Number(((x.n_better + x.n_worse) / x.n_pairs).toFixed(4)) : null });
/** Pools trials over rungs without merging pairs across rungs: the pair key carries the rung. */
const byRungKey = <T extends ScaleTrial>(ts: T[]) => ts.map((t) => ({ ...t, model: t.model + ' @' + t.rung }));

/** The non-inferiority test of a harm bar (lower is better): passes when the one-sided upper bound sits below the margin. */
export function nonInferior(x: Contrast, margin: number, alpha: number = HARM_BOUNDS.nominal_final) {
  const level = Number(alpha.toFixed(5));
  if (!x.n_pairs) return { pass: false, margin, delta: null, upper: null, p: null, method: 'no pairs' };
  const boot = x.stats?.bootstrap ?? [];
  if (!boot.length) {
    if (x.n_clusters < 2 || (x.delta ?? 0) !== 0) return { pass: false, margin, delta: x.delta, upper: null, p: null, method: 'not estimable: fewer than two clusters' };
    const upper = Number(clopperPearson(0, x.n_pairs, 2 * alpha).upper.toFixed(4));
    return { pass: upper < margin, margin, delta: 0, upper, p: null, method: 'no discordant pair: exact one-sided ' + level + ' upper bound for zero events over ' + x.n_pairs + ' pairs' };
  }
  const p = nonInferiorityP(x.stats!, margin, 'lower')!;
  return { pass: p <= alpha, margin, delta: x.delta, upper: boot[Math.min(boot.length, Math.ceil(boot.length * (1 - alpha))) - 1]!, p, method: 'cluster bootstrap, one-sided ' + level };
}

/** Both harm bars of one fixed-sequence step, per model and with both models pooled, at the given one-sided alpha. */
function harmBars(c: Ctx, pooled: ScaleTrial[], models: string[], margins: { wrong_skill: number; no_skill_open: number }, alpha: number, rungs: readonly number[]) {
  const bar = (b: 'wrong_skill' | 'no_skill_open') => {
    const outcome = b === 'wrong_skill' ? 'opened_wrong_skill' : 'no_skill_opened_any';
    const per = models.map((m) => ({ model: m, ...nonInferior(run(c, byRungKey(pooled.filter((t) => t.model === m)), outcome), margins[b], alpha) }));
    return { margin: margins[b], rungs, look: alpha === HARM_BOUNDS.nominal_final ? 'final' : 'interim', pass: per.every((x) => x.pass), per_model: per, both_models: models.length > 1 ? nonInferior(run(c, byRungKey(pooled), outcome), margins[b], alpha) : null };
  };
  return { wrong_skill: bar('wrong_skill'), no_skill_open: bar('no_skill_open') };
}
const marginsOf = (margins: Margins | null | undefined, h: string, models: string[]) => margins?.[h] ?? (models.length > 1 ? PLAN_MARGINS.two_models : PLAN_MARGINS.one_model);

/** Each settled flagged trial with its settled clean-arm verdict and opened skills in place of the automatic ones. */
export function applySettled<T extends ScaleTrial>(trials: T[], settled: Settled[] | null | undefined): T[] {
  const by = new Map((settled ?? []).map((s) => [s.trial_id, s]));
  return trials.map((t) => { const s = by.get(t.id); return s ? { ...t, contaminated: s.contaminated, opened: s.opened } : t; });
}

/** The unit a request belongs to: its target skill, or the request itself for a no-skill request. */
export const interimUnitOf = (r: Request | undefined): string | null => (r ? (r.kind === 'skill' ? r.target : r.id) : null);

/** The units of the interim look: the first half of the target skills and the first half of the no-skill requests, each
 *  in the preregistered seeded order. */
export function interimUnits(requests: Request[]): Set<string> {
  const key = (x: string) => createHash('sha256').update(INTERIM_SEED + x).digest('hex');
  const half = (xs: string[]) => [...new Set(xs)].map((x) => [key(x), x] as const).sort((a, b) => a[0].localeCompare(b[0])).slice(0, Math.floor(new Set(xs).size * LOOKS.fraction)).map(([, x]) => x);
  return new Set([...half(requests.filter((r) => r.kind === 'skill' && r.target).map((r) => r.target!)), ...half(requests.filter((r) => r.kind === 'none').map((r) => r.id))]);
}

export type InterimRecord = ReturnType<typeof interimLook>;

/** The interim look: each harness's 1,500-rung primary on the first half of the units. An efficacy stop also needs the
 *  1,500 step's harm bars to pass on those units at the interim nominal alpha; when one does not, the run continues to the
 *  final look, which keeps the error rate (an efficacy bound the run does not act on only makes it more conservative). */
export function interimLook(o: { trials: ScaleTrial[]; requests: Request[]; labels: LabelRow[]; ladder: Ladder; places: Places; plannedEffect?: Record<string, number> | null; margins?: Margins | null; settled?: Settled[] | null }) {
  const c = context({ requests: o.requests, labels: o.labels, ladder: o.ladder, places: o.places, adjudications: [] });
  const units = interimUnits(o.requests);
  const at = applySettled(o.trials, o.settled).filter((t) => t.rung === LOOKS.rung && !t.task_phase && !t.set_t && units.has(interimUnitOf(c.req.get(t.task)) ?? ''))
    .map((t) => ({ ...t, cluster: c.req.get(t.task)?.target ?? t.task }));
  const harnesses = [...new Set(at.map((t) => t.harness))].sort();
  return {
    schema: 'he-skills-at-scale-interim/1', looks: LOOKS, bounds: PRIMARY_BOUNDS, units: [...units].sort(),
    harnesses: Object.fromEntries(harnesses.map((h) => {
      const ts = at.filter((t) => t.harness === h);
      const models = [...new Set(ts.map((t) => t.model))];
      const planned = o.plannedEffect?.[h] ?? (models.length > 1 ? PLANNED_EFFECT.two_models : PLANNED_EFFECT.one_model);
      const x = run(c, ts, 'opened_right_skill');
      const look = x.delta === null ? { z: null, conditional_power: null, planned_effect: planned, bounds: PRIMARY_BOUNDS, decision: 'continue' as LookDecision } : lookDecision({ delta: x.delta, se: x.stats?.se_cluster ?? null, plannedEffect: planned, bounds: PRIMARY_BOUNDS });
      if (look.decision !== 'stop_efficacy') return [h, { n_pairs: x.n_pairs, n_clusters: x.n_clusters, delta: x.delta, ci95: x.ci95, ...look }];
      const harm = harmBars(c, ts, models.sort(), marginsOf(o.margins, h, models), HARM_BOUNDS.nominal_interim, [LOOKS.rung]);
      const held = !harm.wrong_skill.pass || !harm.no_skill_open.pass;
      return [h, { n_pairs: x.n_pairs, n_clusters: x.n_clusters, delta: x.delta, ci95: x.ci95, ...look, decision: held ? 'continue' as LookDecision : look.decision, efficacy_bound_crossed: true,
        harm_at_interim: harm, ...(held ? { held: 'the efficacy bound was crossed but a harm bar does not pass at the interim nominal alpha, so the run continues to the final look' } : {}) }];
    })),
  };
}

export function analyze(o: { trials: ScaleTrial[]; requests: Request[]; labels: LabelRow[]; ladder: Ladder; places: Places; pins?: string[]; margins?: Margins | null;
  adjudications?: Adjudication[]; queue?: Array<{ request_id: string; skill: string }>; judgeCheck?: GoldCheck | null; interim?: InterimRecord | null;
  flagged?: FlaggedRow[] | null; settled?: Settled[] | null }) {
  const c = context({ requests: o.requests, labels: o.labels, ladder: o.ladder, places: o.places, adjudications: o.adjudications ?? [] });
  const trials = applySettled(o.trials, o.settled).map((t) => ({ ...t, cluster: c.req.get(t.task)?.target ?? t.task }));
  const isTask = (t: ScaleTrial) => t.task_phase === true || !!t.set_t;
  const phase = trials.filter((t) => !isTask(t));
  const setT = trials.filter(isTask);
  const harnesses = [...new Set(phase.map((t) => t.harness))].sort();
  const modelsOf = (h: string) => [...new Set(phase.filter((t) => t.harness === h).map((t) => t.model))].sort();
  const at = (h: string, r: number) => phase.filter((t) => t.harness === h && t.rung === r);

  const done = new Set((o.adjudications ?? []).map((a) => a.request_id + '|' + a.skill));
  const pending = (o.queue ?? []).filter((q) => !done.has(q.request_id + '|' + q.skill)).length;
  const judgeOk = !!o.judgeCheck && o.judgeCheck.n_gold >= MIN_GOLD && Object.values(JUDGES).every((j) => (o.judgeCheck!.sources[j]?.kappa ?? -1) >= KAPPA_MIN);
  const marginsFor = (h: string) => marginsOf(o.margins, h, modelsOf(h));

  const perRung = harnesses.flatMap((h) => RUNGS.filter((r) => at(h, r).length).map((r) => {
    const ts = at(h, r);
    const models = modelsOf(h);
    const outcomes = Object.fromEntries(Object.keys(OUTCOMES).map((k) => [k, strip(run(c, ts, k))]));
    const byPlace: Record<string, Record<string, ReturnType<typeof strip>>> = Object.fromEntries([...PLACES, 'unknown'].map((p) => [p, Object.fromEntries(PLACE_OUTCOMES
      .map((k) => [k, strip(run(c, ts.filter((t) => c.targetPlace(t) === p && c.req.get(t.task)?.kind === 'skill'), k))]))]).filter(([, v]) => Object.values(v).some((x) => x.n_pairs)));
    const block = models.map((m) => {
      const side = ts.filter((t) => t.model === m && t.arm === 'resolver' && !t.contaminated && !c.noSkill(t) && (t.saw || t.turns.length));
      const i = interval(side.filter((t) => t.turns.some((u) => u.block) || sawBlock(t)).length, side.length);
      return { model: m, no_skill_requests_with_block: i, over_bar: i.rate !== null && i.rate > NO_SKILL_BLOCK_BAR };
    });
    const disc = Object.fromEntries(models.map((m) => [m, Object.fromEntries(['opened_right_skill', 'opened_wrong_skill', 'no_skill_opened_any']
      .map((k) => [k, discordance(run(c, ts.filter((t) => t.model === m), k))]))]));
    const costPerArm = Object.fromEntries(ARMS.filter((a) => ts.some((t) => t.arm === a)).map((a) => {
      const s = ts.filter((t) => t.arm === a && t.usage);
      const avg = (f: (t: ScaleTrial) => number) => (s.length ? Number((s.reduce((x, t) => x + f(t), 0) / s.length).toFixed(6)) : null);
      return [a, { trials: s.length, mean_input_tokens: avg((t) => t.usage!.input_tokens), mean_usd: avg((t) => t.usage!.usd) }];
    }));
    const skillRows = ts.filter((t) => t.arm === 'native' && !t.contaminated && !c.skillNeed(t));
    const visibility = {
      native_saw_described: interval(skillRows.filter((t) => c.saw(t, 'described') === 1).length, skillRows.filter((t) => t.saw).length),
      target_place: Object.fromEntries([...PLACES, 'unknown'].map((p) => [p, skillRows.filter((t) => c.targetPlace(t) === p).length]).filter(([, n]) => n)),
    };
    return { harness: h, rung: r, models, outcomes, by_place: byPlace, no_skill_block_rate: block, discordance: disc, cost_per_arm: costPerArm, visibility };
  }));

  const taskAt = (rs: readonly number[]) => byRungKey(setT.filter((t) => rs.includes(t.rung)));
  const taskSuccess = (ts: ScaleTrial[]) => contrast(ts, 'native', 'resolver', (t) => (t.set_t?.success ? 1 : 0), () => null);

  const decisions = harnesses.map((h) => {
    const models = modelsOf(h);
    const margins = marginsFor(h);
    const look = o.interim?.harnesses[h] ?? null;
    const early = look?.decision === 'stop_efficacy';
    const steps = RUNGS.map((r) => ({ id: String(r), evaluate: () => {
      const ts = at(h, r);
      if (r === LOOKS.rung && (look?.decision === 'stop_futility' || look?.decision === 'stop_loss')) return { pass: false, detail: { reason: 'stopped at the interim look: ' + look.decision.replace('stop_', '') + ' (z ' + look.z + ', conditional power ' + look.conditional_power + ')', interim: look } as Record<string, unknown> };
      if (!ts.length) return { pass: false, detail: { reason: 'no trials at this rung' } as Record<string, unknown> };
      const right = run(c, ts, 'opened_right_skill');
      const z = right.delta === null ? null : right.stats?.se_cluster ? right.delta / right.stats.se_cluster : right.delta > 0 ? Infinity : 0;
      const rightPass = r === LOOKS.rung
        ? (early ? (look!.delta ?? -1) >= OPEN_RIGHT_BAR : right.delta !== null && right.delta >= OPEN_RIGHT_BAR && z !== null && z >= PRIMARY_BOUNDS.final)
        : right.delta !== null && right.delta >= OPEN_RIGHT_BAR && !!right.ci95 && right.ci95[0] > 0;
      const above = RUNGS.filter((x) => x >= r);
      const pooled = phase.filter((t) => t.harness === h && (above as readonly number[]).includes(t.rung));
      const harm = harmBars(c, pooled, models, margins, early && r === LOOKS.rung ? HARM_BOUNDS.nominal_interim : HARM_BOUNDS.nominal_final, above);
      const tts = taskAt(above);
      const tr = tts.length ? taskSuccess(tts) : null;
      const taskPass = !tr || !tr.n_pairs || !tr.ci95 || tr.ci95[1] >= 0;
      return { pass: rightPass && harm.wrong_skill.pass && harm.no_skill_open.pass && taskPass,
        detail: { opened_right_skill: { ...strip(right), bar: OPEN_RIGHT_BAR, pass: rightPass, ...(r === LOOKS.rung ? { z, rule: early ? 'stopped early at the interim look (z >= ' + PRIMARY_BOUNDS.interim.toFixed(2) + '): estimate possibly overstated' : 'final look: z >= ' + PRIMARY_BOUNDS.final.toFixed(2), interim: look } : {}) }, harm, task_success: tr ? { ...strip(tr), pass: taskPass } : 'not measured at these rungs' } as Record<string, unknown> };
    } }));
    const seq = fixedSequence(steps);
    const s = seq.longest_passing_prefix.length ? Number(seq.longest_passing_prefix.at(-1)) : null;
    const blockOver = perRung.filter((x) => x.harness === h && x.no_skill_block_rate.some((b) => b.over_bar)).map((x) => x.rung);
    return {
      harness: h, models, margins, margins_source: o.margins?.[h] ? 'preregistered' : 'plan expected values, not preregistered',
      sequence: seq.results, S: s, interim: look, stopped_early: early,
      verdict: (s ? 'flip on at ' + s + ' skills and above' : 'null or loss at every tested rung: the resolver stays opt-in; one "Why null?" pass is due (R48)')
        + (early ? '; stopped early at the interim look, so the 1,500 estimate is possibly overstated' : look && look.decision !== 'continue' ? '; stopped at the interim look (' + look.decision.replace('stop_', '') + ')' : ''),
      fix_method_no_skill_gate: blockOver.length ? 'FIX-METHOD for the gate: no-skill requests got a block more than 25% of the time at rung(s) ' + blockOver.join(', ') : null,
    };
  });

  const pinsScope = phase.filter((t) => PINS_HARNESSES.includes(t.harness) && t.rung === 1500);
  const pinSet = new Set(o.pins ?? []);
  const targetOf = (t: ScaleTrial) => c.req.get(t.task)?.target ?? '';
  const pinned = run(c, pinsScope.filter((t) => pinSet.has(targetOf(t))), 'opened_right_skill', 'resolver', 'resolver-pins');
  const unpinned = run(c, pinsScope.filter((t) => c.req.get(t.task)?.kind === 'skill' && !pinSet.has(targetOf(t))), 'opened_right_skill', 'resolver', 'resolver-pins');
  const pinnedPass = pinned.delta !== null && pinned.delta >= PINS_BAR && !!pinned.ci95 && pinned.ci95[0] > 0;
  const unpinnedPass = !!unpinned.ci95 && unpinned.ci95[0] > PINS_UNPINNED_FLOOR;
  const pins = {
    harnesses: PINS_HARNESSES, rung: 1500, pins: [...pinSet].sort(),
    pinned_targets: { ...strip(pinned), bar: PINS_BAR, pass: pinnedPass }, unpinned_requests: { ...strip(unpinned), floor: PINS_UNPINNED_FLOOR, pass: unpinnedPass },
    verdict: !pinned.n_pairs ? 'not measured' : pinnedPass && unpinnedPass ? 'pins help: setup should suggest pinning daily skills' : 'pins stay a documented option',
  };

  const taskRungs = [...new Set(setT.map((t) => t.rung))].sort((a, b) => b - a);
  const setTOut = {
    per_rung: taskRungs.map((r) => ({ rung: r, success: strip(taskSuccess(taskAt([r]))) })),
    per_harness: [...new Set(setT.map((t) => t.harness))].sort().map((h) => ({ harness: h, success: strip(taskSuccess(taskAt(taskRungs).filter((t) => t.harness === h))), note: 'not powered per harness' })),
  };

  const flaggedIds = new Set((o.flagged ?? []).map((f) => f.trial_id));
  const settledBy = new Map((o.settled ?? []).map((s) => [s.trial_id, s]));
  const auto = new Map(o.trials.map((t) => [t.id, t]));
  const unsettled = [...flaggedIds].filter((id) => !settledBy.has(id)).length;
  const groups = [...new Set(trials.filter((t) => flaggedIds.has(t.id)).map((t) => t.harness + '|' + t.rung + '|' + t.arm))].sort();
  const flags = {
    supplied: !!o.flagged, flagged: flaggedIds.size, settled: [...flaggedIds].filter((id) => settledBy.has(id)).length, unsettled,
    per_arm: groups.map((g) => {
      const [harness, rung, arm] = g.split('|') as [string, string, string];
      const ts = trials.filter((t) => t.harness === harness && String(t.rung) === rung && String(t.arm) === arm);
      const f = ts.filter((t) => flaggedIds.has(t.id));
      const changed = f.filter((t) => { const s = settledBy.get(t.id), a = auto.get(t.id)!; return s && (s.contaminated !== !!a.contaminated || JSON.stringify(s.opened) !== JSON.stringify([...new Set(a.opened)].sort())); });
      return { harness, rung: Number(rung), arm, trials: ts.length, flagged: f.length, settled: f.filter((t) => settledBy.has(t.id)).length, unsettled: f.filter((t) => !settledBy.has(t.id)).length, changed_by_settlement: changed.length };
    }),
  };

  return {
    schema: 'he-skills-at-scale-analysis/1', seed: SEED, draws: DRAWS, ni_alpha: NI_ALPHA, bounds: { primary: PRIMARY_BOUNDS, harm: HARM_BOUNDS },
    trials: { total: trials.length, requests_phase: phase.length, set_t: setT.length, contaminated: trials.filter((t) => t.contaminated).length,
      by_termination: Object.fromEntries([...new Set(trials.map((t) => t.termination))].sort().map((k) => [k, trials.filter((t) => t.termination === k).length])) },
    status: {
      judge_check: o.judgeCheck ? { n_gold: o.judgeCheck.n_gold, kappa: Object.fromEntries(Object.values(JUDGES).map((j) => [j, o.judgeCheck!.sources[j]?.kappa ?? null])), passed: judgeOk } : 'not supplied',
      adjudication: { queue: o.queue?.length ?? null, adjudicated: o.adjudications?.length ?? 0, pending },
      flags: { supplied: flags.supplied, flagged: flags.flagged, settled: flags.settled, unsettled },
      final: judgeOk && pending === 0 && !!o.queue && !!o.interim && flags.supplied && unsettled === 0,
      why_not_final: [...(judgeOk ? [] : ['the R78 judge check has not passed (kappa 0.6 for both judges on at least ' + MIN_GOLD + ' gold pairs)']), ...(o.queue ? [] : ['no adjudication queue supplied']), ...(pending ? [pending + ' adjudication item(s) pending'] : []), ...(o.interim ? [] : ['no interim look record supplied (R113)']),
        ...(flags.supplied ? [] : ['no flagged-trial file supplied (flags.ts)']), ...(unsettled ? [unsettled + ' flagged trial(s) not settled by two agreeing readers'] : [])],
    },
    decisions, per_rung: perRung, flags, pins, set_t: setTOut,
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (100 * v).toFixed(1) + '%');
const pts = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : (v >= 0 ? '+' : '') + (100 * v).toFixed(1));
const ci = (c: [number, number] | null | undefined, f = pts) => (c ? '[' + f(c[0]) + ', ' + f(c[1]) + ']' : '-');
const row = (cells: unknown[]) => '| ' + cells.map(String).join(' | ') + ' |';
const head = (cells: string[]) => row(cells) + '\n' + row(cells.map(() => '---'));
type Shown = { n_pairs: number; mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null; mdd80: number | null };
const UNITS: Record<string, (v: number) => string> = { input_tokens_per_request: (v) => v.toFixed(0), usd_per_request: (v) => '$' + v.toFixed(4) };
const cRow = (label: string, k: string, x: Shown) => {
  const u = UNITS[k];
  if (!u) return row([label, x.n_pairs, pct(x.mean_a), pct(x.mean_b), pts(x.delta), ci(x.ci95), pts(x.mdd80)]);
  const f = (v: number | null) => (v === null ? '-' : u(v));
  return row([label, x.n_pairs, f(x.mean_a), f(x.mean_b), x.delta === null ? '-' : (x.delta >= 0 ? '+' : '') + u(x.delta), x.ci95 ? '[' + u(x.ci95[0]) + ', ' + u(x.ci95[1]) + ']' : '-', '-']);
};
const C_HEAD = ['', 'pairs', 'A', 'B', 'B minus A', '95% interval', 'smallest detectable (80%)'];

export function markdown(a: ReturnType<typeof analyze>): string {
  const out = ['# Skills-at-scale analysis (' + a.schema + ')', '',
    'Interim look (R113): one look at half the target skills on the 1,500 primary, stop at |z| >= ' + PRIMARY_BOUNDS.interim.toFixed(2) + ', final z >= ' + PRIMARY_BOUNDS.final.toFixed(2) + '; harm bars one-sided ' + NI_ALPHA + ' with bounds ' + HARM_BOUNDS.interim.toFixed(2) + ' and ' + HARM_BOUNDS.final.toFixed(2) + ' (nominal ' + HARM_BOUNDS.nominal_interim.toFixed(5) + ' at the interim, ' + HARM_BOUNDS.nominal_final.toFixed(4) + ' at the final); futility below ' + LOOKS.futility_cp * 100 + '% conditional power.', '',
    'Seed ' + a.seed + ', ' + a.draws + ' bootstrap draws. Pairs are per request within a setup and rung, clustered by target skill. Intervals are 95%. Harm bars are non-inferiority tests at one-sided ' + a.ni_alpha + '. A is native and B the resolver unless a table says otherwise.', '',
    a.status.final ? 'Status: final.' : 'Status: provisional. ' + a.status.why_not_final.join('; ') + '.', '',
    '## Decision per harness (fixed sequence 1,500, 700, 351, 100)', '', head(['harness', 'models', 'S', 'verdict', 'margins (wrong skill, no-skill open)', 'gate note'])];
  for (const d of a.decisions) out.push(row([d.harness, d.models.join(', '), (d.S ?? '-') + (d.stopped_early ? ' (stopped early; possibly overstated)' : ''), d.verdict, pts(d.margins.wrong_skill) + ', ' + pts(d.margins.no_skill_open) + ' (' + d.margins_source + ')', d.fix_method_no_skill_gate ?? '-']));
  out.push('', '## Flagged trials, settled by hand', '', a.flags.supplied ? a.flags.flagged + ' flagged, ' + a.flags.settled + ' settled, ' + a.flags.unsettled + ' unsettled. Settled trials count with the readers\' verdicts.' : 'No flagged-trial file supplied.', '');
  if (a.flags.per_arm.length) out.push(head(['harness', 'rung', 'arm', 'trials', 'flagged', 'settled', 'unsettled', 'changed by settlement']), ...a.flags.per_arm.map((x) => row([x.harness, x.rung, x.arm, x.trials, x.flagged, x.settled, x.unsettled, x.changed_by_settlement])));
  out.push('', head(['harness', 'rung', 'status', 'opened right skill', '95% interval', 'wrong skill: pass (worst model upper bound)', 'no-skill open: pass (worst model upper bound)', 'set T success']));
  for (const d of a.decisions) for (const s of d.sequence) {
    const x = s.detail as any;
    if (!x?.opened_right_skill) { out.push(row([d.harness, s.id, s.status, s.reason ?? x?.reason ?? '-', '-', '-', '-', '-'])); continue; }
    const worst = (b: any) => b.pass + ' (' + pts(Math.max(...b.per_model.map((m: any) => m.upper ?? Infinity))) + ')';
    out.push(row([d.harness, s.id, s.status, pts(x.opened_right_skill.delta), ci(x.opened_right_skill.ci95), worst(x.harm.wrong_skill), worst(x.harm.no_skill_open),
      typeof x.task_success === 'string' ? x.task_success : pts(x.task_success.delta) + ' ' + ci(x.task_success.ci95)]));
  }
  out.push('', '## Outcomes per harness and rung', '');
  for (const r of a.per_rung) {
    out.push('### ' + r.harness + ', ' + r.rung + ' skills (' + r.models.join(', ') + ')', '', head(C_HEAD));
    for (const [k, x] of Object.entries(r.outcomes)) out.push(cRow(k.replaceAll('_', ' '), k, x));
    out.push('', head(['model', 'no-skill requests with a resolver block', 'over the 25% bar']));
    for (const b of r.no_skill_block_rate) {
      const i = b.no_skill_requests_with_block;
      out.push(row([b.model, i.n ? pct(i.rate) + ' ' + ci(i.ci95, pct) + ' (' + i.x + '/' + i.n + ')' : '-', b.over_bar]));
    }
    out.push('', 'Native visibility: saw an acceptable skill with a description on ' + pct(r.visibility.native_saw_described.rate) + ' (' + r.visibility.native_saw_described.x + '/' + r.visibility.native_saw_described.n + ') of skill-needing requests; target place: ' + (Object.entries(r.visibility.target_place).map(([k, v]) => k + ' ' + v).join(', ') || '-') + '.', '');
    out.push(head(['target place and outcome', ...C_HEAD.slice(1)]));
    for (const [p, ks] of Object.entries(r.by_place)) for (const [k, x] of Object.entries(ks)) if (x.n_pairs) out.push(cRow(p + ': ' + k.replaceAll('_', ' '), k, x));
    out.push('', head(['arm', 'trials', 'mean input tokens per request', 'mean dollars per request']));
    for (const [arm, v] of Object.entries(r.cost_per_arm)) out.push(row([arm, v.trials, v.mean_input_tokens === null ? '-' : v.mean_input_tokens.toFixed(0), v.mean_usd === null ? '-' : '$' + v.mean_usd.toFixed(4)]));
    out.push('');
  }
  const p = a.pins;
  out.push('## Pins (1,500 skills, Hermes, OpenClaw and Pi pooled; A is the resolver alone, B the resolver with pins)', '', head(C_HEAD));
  out.push(cRow('pinned targets (bar ' + pts(PINS_BAR) + ')', 'opened_right_skill', p.pinned_targets), cRow('unpinned requests (floor ' + pts(PINS_UNPINNED_FLOOR) + ')', 'opened_right_skill', p.unpinned_requests), '', 'Verdict: ' + p.verdict + '.', '');
  out.push('## Set T success (pooled over setups)', '', head(C_HEAD));
  for (const t of a.set_t.per_rung) out.push(cRow(t.rung + ' skills', 'success', t.success));
  for (const t of a.set_t.per_harness) out.push(cRow(t.harness + ' (not powered per harness)', 'success', t.success));
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const v = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const [results, requests, labels, ladder, places, out] = ['results', 'requests', 'labels', 'ladder', 'places', 'out'].map(v);
  if (!results || !requests || !labels || !ladder || !places || !out) {
    console.error('usage: analyze.ts --results <dir> --requests <setl.jsonl> --labels <labels-l.jsonl> --ladder <ladder.json> --places <places.json> [--pins <json>] [--margins <json>] [--adjudications <jsonl>] [--queue <jsonl>] [--judge-check <json>] [--interim <json>] [--flagged <jsonl>] [--settled <jsonl>] --out <dir>');
    process.exit(2);
  }
  const json = (k: string) => (v(k) ? JSON.parse(readFileSync(v(k)!, 'utf8')) : null);
  try {
    if (v('look') === 'interim') {
      const look = interimLook({ trials: loadScaleTrials(results), requests: readJsonl(requests), labels: readJsonl(labels), ladder: readLadder(ladder), places: JSON.parse(readFileSync(places, 'utf8')).harnesses, plannedEffect: json('planned-effect'), margins: json('margins'), settled: v('settled') ? readJsonl(v('settled')!) : null });
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'interim.json'), JSON.stringify(look, null, 1) + '\n');
      for (const [h, x] of Object.entries(look.harnesses)) console.log('INTERIM harness=' + h + ' pairs=' + x.n_pairs + ' delta=' + pts(x.delta) + ' z=' + x.z + ' conditional_power=' + x.conditional_power + ' decision=' + x.decision + ('held' in x ? ' held_by_harm_bar=yes' : ''));
      process.exit(0);
    }
    const a = analyze({ trials: loadScaleTrials(results), requests: readJsonl(requests), labels: readJsonl(labels), ladder: readLadder(ladder), places: JSON.parse(readFileSync(places, 'utf8')).harnesses,
      pins: json('pins')?.pins, margins: json('margins'), adjudications: v('adjudications') ? readJsonl(v('adjudications')!) : [], queue: v('queue') ? readJsonl(v('queue')!) : undefined, judgeCheck: json('judge-check'), interim: json('interim'),
      flagged: v('flagged') ? readJsonl(v('flagged')!) : null, settled: v('settled') ? readJsonl(v('settled')!) : null });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'analysis.json'), JSON.stringify(a, null, 1) + '\n');
    writeFileSync(join(out, 'analysis.md'), markdown(a));
    for (const d of a.decisions) if (d.stopped_early) console.log('EARLY_STOP harness=' + d.harness + ' stopped early at the interim look; the 1,500 estimate is possibly overstated');
    console.log('SCALE_ANALYSIS trials=' + a.trials.total + ' final=' + a.status.final + ' ' + a.decisions.map((d) => d.harness + ':S=' + (d.S ?? 'none')).join(' ') + ' out=' + out);
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-000 ' + (e as Error).message); process.exit(2); }
}
