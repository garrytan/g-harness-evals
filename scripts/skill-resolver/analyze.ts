#!/usr/bin/env bun
// The skill-resolver analysis (internal-task): every endpoint in docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md,
// "Endpoints", from merged results. Keyless and offline; tests/skill-resolver-analyze.test.ts runs it on synthetic fixtures.
//
//   bun scripts/skill-resolver/analyze.ts --results <merged results dir> --labels P=<labels.jsonl> [--labels R=<labels.jsonl>]
//       [--requests P=<setp.jsonl>] [--reachable <reachable.json>] [--set-t <tasks/skill-resolver/T/tasks>]
//       [--duplicate-groups <prereg.json>] [--cross-family P=<labels-astra.jsonl>] [--judge-check <judge-check.json>] --out <dir>
//
// Inputs:
//   <results>/manifest.json and trials.jsonl (runner/run.ts, scripts/merge-shards.ts). A cell's arm is its skill_arm (set T,
//     runner/trial/set-t.ts) or its config: skills-native, skills-resolver, skills-names-only, skills-no-catalog and
//     skills-usage-ordered (scripts/skill-resolver/ARMS.md); on QM pi-skills-native, pi-skills-push (the emulated hook, the
//     resolver-on arm of QM's cells in every resolver-on contrast), pi-skills-pull (reported as its own arm) and pi-skills-none.
//   Each trial's directory, <results>/trials/<cell>/<task>/r<n>:
//     got-skill.json   Got the skill: scripts/skill-resolver/got-skill.ts --json (catalog_opened) or, on QM,
//                      harnesses/qm/skill-opens.ts skillOpens (opened). Missing: counted as NO_GOT_SKILL and scored 0.
//     logs/skill-resolver/status.ndjson   the hook wrapper's status lines (scripts/skill-resolver/hook-wrapper.ts StatusLine)
//     logs/skill-resolver.ndjson          QM's status lines (harnesses/qm/skill-resolver.mjs statusLine)
//     logs/skill-resolver.infra.json      QM's INFRA marker
//   A Phase B trial's task is the request id; a set T trial carries set_t (runner/contracts.ts TrialSetT).
//   --labels SET=file: label-set.ts output rows {id, half, final: {no_skill_needed, acceptable}}. The primary runs on set P.
//   --requests SET=file: gen-set-p.ts rows {id, kind, overlap: {nd_jaccard} | null}, for the set P overlap bin.
//   --reachable file: scripts/skill-resolver/reachable.ts output, {catalog_hash, harnesses: {"<harness>": {native: [skill, ...],
//     "names-only": [...]}}, excluded}, the Step 0 reachable sets. A request counts for a harness and arm when one of its
//     acceptable skills is reachable there. An arm with its own set uses it (names-only); every other arm (resolver-on, qm-pull,
//     no-catalog, usage-ordered) uses the native set, since the resolver arms install the native catalog. Without the file every
//     acceptable skill counts as reachable and the output says so.
//
// Rules: every INFRA trial stays in (intention-to-treat) and is counted by code. A contaminated trial (skill_request.clean_arm,
// runner/trial/skill-requests.ts gstackReads: a tool call that named a gstack path outside the trial's catalog copy) is left out
// of every scored number (CREW.md, "Clean no-gstack and no-brain arms") and reported per cell; a request whose only trials on
// one side are contaminated is excluded from a contrast as "contaminated (clean-arm rule)". Pairs are per request within a cell (harness
// and model), clustered by request across cells (requests in one request_duplicate_groups entry of --duplicate-groups share a
// cluster: the same text written twice is one cluster, not two); an item missing on one side or ineligible on either is excluded and counted.
// "Significant" is the clustered sign-flip p and the exact McNemar p both at most 0.05. TOST is two nonInferiorityP calls at
// the margin, equivalence when both are at most 0.05. Output: <out>/analysis.json and <out>/analysis.md. No ranking language:
// every number has its interval.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialRecord, TrialSetT } from '../../runner/contracts.ts';
import { clopperPearson } from '../../runner/stats/exact.ts';
import { clusteredPairedDelta, exactMcNemar, holmAdjusted, nonInferiorityP, type PairedDelta, type PairedItem } from '../../runner/stats/paired.ts';
import { overlapBin } from './check-set-t.ts';

export const SEED = 20261108;
export const DRAWS = 10000;
export const ALPHA = 0.05;
export const PRIMARY_BAR = 0.10;
export const TOST_MARGIN = 0.10;
export const FALSE_SUGGESTION_BARS = { a: 0.25, b: 0.10 };
export const PRIMARY_SET = 'P';
export const HARNESSES = ['openclaw', 'claude-code', 'codex', 'hermes', 'qm'];
export const FOOTPRINT_TURNS = [1, 10, 50];
export const SET_T_GROUPS: Record<string, string[]> = {
  guessable: ['t09', 't23', 't26', 't35', 't40', 't46'],
  strict_used_it: ['t22', 't38', 't42', 't48'],
  may_stall: ['t32', 't34'],
};
const CONFIG_ARMS: Record<string, string> = {
  'skills-native': 'native', 'skills-resolver': 'resolver-on', 'skills-names-only': 'names-only', 'skills-no-catalog': 'no-catalog',
  'skills-usage-ordered': 'usage-ordered', 'pi-skills-native': 'native', 'pi-skills-push': 'resolver-on', 'pi-skills-pull': 'qm-pull', 'pi-skills-none': 'no-catalog',
};

export type LabelCore = { no_skill_needed: boolean; acceptable: string[]; judge: string };
export type Label = { id: string; set: string; half: string | null; no_skill_needed: boolean; acceptable: string[]; bin: string | null; cluster?: string;
  by_family?: Partial<Record<'anthropic' | 'openai', LabelCore>> };
/** R78 (amended by Garry, "Use Astra vs opus"): a cell is scored with labels from a judge of the other family. */
export const JUDGE_BY_FAMILY: Record<'anthropic' | 'openai', string> = { anthropic: 'openai:gpt-6-astra', openai: 'anthropic:claude-opus-5-5' };
export const KAPPA_MIN = 0.6;
export type JudgeCheck = { n_gold: number; sources: Record<string, { judge: string; kappa: number | null; catch_rate: number | null; false_fail_rate: number | null; n_bad: number; n_good: number }> };
/** The label a trial on this model is scored with: the other family's judge when cross-family labels are loaded, else the panel. */
export function labelFor(l: Label | undefined, model: string): Label | undefined {
  if (!l?.by_family) return l;
  const f = l.by_family[model.split(':')[0] as 'anthropic' | 'openai'];
  return f ? { ...l, no_skill_needed: f.no_skill_needed, acceptable: f.acceptable } : undefined;
}
export type Turn = { session: string; turn: number | null; block: boolean; block_tokens: number; injected: boolean; on: boolean; suggestions: string[]; phase: string | null; exhausted: boolean; code: string; infra: string[] };
export type Trial = {
  id: string; cell: string; harness: string; model: string; arm: string | null; task: string; termination: string; opened: string[]; got_skill_file: boolean;
  turns: Turn[]; infra: string[]; set_t: TrialSetT | null; cluster?: string; contaminated?: boolean; gstack_reads?: number;
};
export const CONTAMINATED = 'contaminated (clean-arm rule)';
type Interval = { x: number; n: number; rate: number | null; ci95: [number, number] | null };
type Contrast = { a: string; b: string; n_pairs: number; n_clusters: number; n_better: number; n_worse: number; n_same: number; mdd80: number | null; reading: string; mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null; p_sign_flip: number | null; mcnemar: ReturnType<typeof exactMcNemar> | null; excluded: Record<string, number>; note?: string; stats?: PairedDelta };

const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bump = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };

export function interval(x: number, n: number): Interval {
  if (!n) return { x, n, rate: null, ci95: null };
  const ci = clopperPearson(x, n);
  return { x, n, rate: x / n, ci95: [ci.lower, ci.upper] };
}

/** One status line under one shape: the hook wrapper's (push harnesses) or QM's. */
export function statusTurn(l: Record<string, unknown>, fallbackSession: string): Turn {
  const qm = l.schema === 'he-skill-resolver-status/1';
  const bytes = qm ? num(l.block_chars) ?? 0 : num(l.block_bytes) ?? 0;
  const infra = qm ? (Array.isArray(l.infra) ? l.infra.map(String) : []) : (Array.isArray(l.infra_reasons) ? l.infra_reasons.map(String) : l.infra === true ? ['INFRA'] : []);
  return {
    session: str(l.session_key) ?? str(l.trial) ?? fallbackSession,
    turn: qm ? num(l.turn) : num(l.session_turn) ?? num(l.turn),
    block: bytes > 0, block_tokens: num(l.block_tokens) ?? 0, injected: l.injected === true,
    on: qm ? l.call !== 'shadow' : l.mode !== 'shadow',
    suggestions: Array.isArray(l.suggestions) ? l.suggestions.map(String) : [],
    phase: str(l.budget_phase), exhausted: l.budget_exhausted === true, code: str(l.code) ?? 'UNKNOWN', infra,
  };
}

export function armOf(cell: { skill_arm?: string; config?: string } | undefined): string | null {
  if (!cell) return null;
  if (cell.skill_arm) return cell.skill_arm;
  return cell.config ? CONFIG_ARMS[cell.config] ?? null : null;
}

export function loadTrials(results: string): Trial[] {
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; skill_arm?: string; config?: string }> };
  const cells = new Map(manifest.cells.map((c) => [c.id, c]));
  return (readJsonl(join(results, 'trials.jsonl')) as TrialRecord[]).map((r) => {
    const dir = join(results, 'trials', ...r.trial_id.split('/').slice(1));
    const got = join(dir, 'got-skill.json');
    let opened: string[] = [];
    if (existsSync(got)) {
      const g = JSON.parse(readFileSync(got, 'utf8')) as { catalog_opened?: unknown; opened?: unknown };
      const list = Array.isArray(g.catalog_opened) ? g.catalog_opened : Array.isArray(g.opened) ? g.opened : [];
      opened = list.map(String);
    }
    const turns: Turn[] = [];
    for (const f of [join(dir, 'logs', 'skill-resolver', 'status.ndjson'), join(dir, 'logs', 'skill-resolver.ndjson')]) {
      if (existsSync(f)) for (const l of readJsonl(f)) if (l.repeat !== true) turns.push(statusTurn(l, r.trial_id));
    }
    const infra = [...new Set(turns.flatMap((t) => t.infra))];
    const marker = join(dir, 'logs', 'skill-resolver.infra.json');
    if (existsSync(marker)) for (const reason of (JSON.parse(readFileSync(marker, 'utf8')).reasons ?? []) as string[]) if (!infra.includes(reason)) infra.push(reason);
    return { id: r.trial_id, cell: r.cell, harness: r.harness, model: r.model, arm: armOf(cells.get(r.cell)), task: r.task, termination: r.termination,
      opened, got_skill_file: existsSync(got), turns, infra: infra.sort(), set_t: r.set_t ?? null,
      contaminated: r.skill_request?.clean_arm?.contaminated === true, gstack_reads: r.skill_request?.clean_arm?.gstack_reads ?? 0 };
  });
}

export function loadLabels(specs: Array<[string, string]>, requests: Array<[string, string]>, duplicateGroups: string[][] = [], crossFamily: Array<[string, string]> = []): Map<string, Label> {
  const bins = new Map<string, string>();
  const clusters = new Map<string, string>();
  for (const g of duplicateGroups) { const head = [...g].sort()[0]!; for (const id of g) clusters.set(id, head); }
  for (const [, file] of requests) for (const row of readJsonl(file)) bins.set(row.id, row.kind === 'none' || !row.overlap ? 'no_skill' : overlapBin(row.overlap.nd_jaccard));
  const out = new Map<string, Label>();
  for (const [set, file] of specs) for (const row of readJsonl(file)) {
    const f = row.final ?? row;
    out.set(row.id, { id: row.id, set, half: row.half ?? null, no_skill_needed: f.no_skill_needed === true, acceptable: (f.acceptable ?? []).map(String), bin: bins.get(row.id) ?? null, cluster: clusters.get(row.id) ?? row.id });
  }
  const core = (v: any, judge: string): LabelCore | undefined => (v ? { no_skill_needed: v.no_skill_needed === true, acceptable: (v.acceptable ?? []).map(String), judge } : undefined);
  for (const [set, file] of crossFamily) {
    const astra = new Map(readJsonl(file).map((r) => [r.id as string, r.judges?.astra]));
    for (const l of out.values()) if (l.set === set) {
      const row = readOnce(specs, set).get(l.id);
      l.by_family = { anthropic: core(astra.get(l.id), JUDGE_BY_FAMILY.anthropic), openai: core(row?.judges?.opus, JUDGE_BY_FAMILY.openai) };
    }
  }
  return out;
}

const readOnceCache = new Map<string, Map<string, any>>();
function readOnce(specs: Array<[string, string]>, set: string): Map<string, any> {
  const file = specs.find(([s]) => s === set)?.[1];
  if (!file) return new Map();
  if (!readOnceCache.has(file)) readOnceCache.set(file, new Map(readJsonl(file).map((r) => [r.id as string, r])));
  return readOnceCache.get(file)!;
}

export type Reach = { catalog_hash?: string; harnesses: Record<string, Record<string, string[]>>; excluded?: unknown } | null;

/** Reads a reachable.json; refuses the earlier {harness: {arm: [...]}} shape. */
export function readReachable(path: string): NonNullable<Reach> {
  const r = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (!r || typeof r.harnesses !== 'object' || r.harnesses === null) throw new Error(path + ' is not reachable.ts output ({catalog_hash, harnesses: {<harness>: {native, names-only}}, excluded}); rebuild it with scripts/skill-resolver/reachable.ts');
  return r as NonNullable<Reach>;
}
/** Why a request is out of the Got the skill denominator for this harness and arm, or null when it is in. */
export function ineligible(label: Label | undefined, harness: string, arm: string, reach: Reach): string | null {
  if (!label) return 'no label';
  if (label.no_skill_needed) return 'no_skill_needed';
  if (!label.acceptable.length) return 'no acceptable skill';
  if (!reach) return null;
  const sets = reach.harnesses[harness];
  const set = sets?.[arm] ?? sets?.native;
  if (!set) return 'no reachable set for ' + harness + ' ' + arm;
  return label.acceptable.some((s) => set.includes(s)) ? null : 'no acceptable skill reachable';
}

const gotIt = (t: Trial, l: Label) => (t.opened.some((s) => l.acceptable.includes(s)) ? 1 : 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Paired contrast of arm b minus arm a over trials (per request within a cell, clustered by request). */
export function contrast(trials: Trial[], a: string, b: string, value: (t: Trial) => number | null, eligible: (t: Trial, arm: string) => string | null): Contrast {
  const side = (arm: string) => {
    const m = new Map<string, { cluster: string; values: number[]; why: string | null; contaminated: number }>();
    for (const t of trials.filter((x) => x.arm === arm)) {
      const key = t.harness + '|' + t.model + '|' + t.task;
      const why = eligible(t, arm);
      const e = m.get(key) ?? { cluster: t.cluster ?? t.task, values: [], why, contaminated: 0 };
      m.set(key, e);
      if (t.contaminated) { e.contaminated++; continue; }
      const v = why ? null : value(t);
      if (v !== null) e.values.push(v);
    }
    return m;
  };
  const A = side(a), B = side(b);
  const excluded: Record<string, number> = {};
  const pairs: PairedItem[] = [];
  for (const key of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const x = A.get(key), y = B.get(key);
    if (!x) { bump(excluded, 'missing in ' + a); continue; }
    if (!y) { bump(excluded, 'missing in ' + b); continue; }
    if (x.why || y.why) { bump(excluded, x.why ?? y.why!); continue; }
    if ((!x.values.length && x.contaminated) || (!y.values.length && y.contaminated)) { bump(excluded, CONTAMINATED); continue; }
    if (!x.values.length || !y.values.length) { bump(excluded, 'no value'); continue; }
    pairs.push({ id: key, cluster: x.cluster, a: mean(x.values), b: mean(y.values) });
  }
  const empty: Contrast = { a, b, n_pairs: 0, n_clusters: 0, n_better: 0, n_worse: 0, n_same: 0, mdd80: null, reading: 'no pairs', mean_a: null, mean_b: null, delta: null, ci95: null, p_sign_flip: null, mcnemar: null, excluded };
  if (!pairs.length) return { ...empty, note: 'no pairs' };
  const s = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
  const binary = pairs.every((p) => (p.a === 0 || p.a === 1) && (p.b === 0 || p.b === 1));
  const n_better = pairs.filter((x) => x.b > x.a).length, n_worse = pairs.filter((x) => x.b < x.a).length;
  const mdd80 = s.ci95 ? Number((2.8 * (s.ci95[1] - s.ci95[0]) / 3.92).toFixed(4)) : null;
  const reading = !s.ci95 ? 'not estimable' : s.ci95[0] <= 0 && s.ci95[1] >= 0 ? 'no measurable difference' : s.delta! > 0 ? b + ' higher' : b + ' lower';
  return { a, b, n_pairs: s.n_pairs, n_clusters: s.n_clusters, n_better, n_worse, n_same: pairs.length - n_better - n_worse, mdd80, reading, mean_a: s.mean_a, mean_b: s.mean_b, delta: s.delta, ci95: s.ci95, p_sign_flip: s.p_two_sided,
    mcnemar: binary ? exactMcNemar(pairs) : null, excluded, ...(binary ? {} : { note: 'repetitions averaged; McNemar needs one 0/1 outcome per side' }), stats: s };
}

export function tost(c: Contrast, margin = TOST_MARGIN) {
  if (!c.stats) return { margin, p_lower: null, p_upper: null, p: null, verdict: 'not estimable' };
  const lo = nonInferiorityP(c.stats, margin, 'higher'), hi = nonInferiorityP(c.stats, margin, 'lower');
  const p = lo === null || hi === null ? null : Math.max(lo, hi);
  return { margin, p_lower: lo, p_upper: hi, p, verdict: p === null ? 'not estimable' : p <= ALPHA ? 'equivalent within the margin' : 'could not tell apart' };
}

const strip = (c: Contrast) => { const { stats: _s, ...rest } = c; return rest; };
const significant = (c: Contrast) => c.p_sign_flip !== null && c.p_sign_flip <= ALPHA && c.mcnemar !== null && c.mcnemar.p_two_sided <= ALPHA;

export function analyze(o: { trials: Trial[]; labels: Map<string, Label>; reachable: Reach; setT?: Map<string, { bin: string; body_coverage: number }>; judgeCheck?: JudgeCheck | null }) {
  const { labels, reachable } = o;
  const trials = o.trials.map((t) => ({ ...t, cluster: labels.get(t.task)?.cluster ?? t.task }));
  const phaseB = trials.filter((t) => !t.set_t && t.arm);
  const taskT = trials.filter((t) => t.set_t);
  const cross = [...labels.values()].some((l) => l.by_family);
  const lab = (t: Trial) => (cross ? labelFor(labels.get(t.task), t.model) : labels.get(t.task));
  const elig = (t: Trial, arm: string) => ineligible(lab(t), t.harness, arm, reachable);
  const got = (t: Trial) => { const l = lab(t); return l ? gotIt(t, l) : null; };
  const eligPanel = (t: Trial, arm: string) => ineligible(labels.get(t.task), t.harness, arm, reachable);
  const gotPanel = (t: Trial) => { const l = labels.get(t.task); return l ? gotIt(t, l) : null; };
  const inSet = (set: string, half?: string) => phaseB.filter((t) => labels.get(t.task)?.set === set && (!half || labels.get(t.task)?.half === half));
  const cellsOf = (ts: Trial[]) => [...new Set(ts.map((t) => t.harness + '|' + t.model))].sort();

  const primarySet = inSet(PRIMARY_SET);
  const primary = contrast(primarySet, 'native', 'resolver-on', got, elig);
  const sensitivity = contrast(inSet(PRIMARY_SET, 'test'), 'native', 'resolver-on', got, elig);
  const setR = contrast(inSet('R'), 'native', 'resolver-on', got, elig);
  const panelPrimary = cross ? contrast(primarySet, 'native', 'resolver-on', gotPanel, eligPanel) : null;
  const usedSources = cross ? [...new Set(primarySet.map((t) => JUDGE_BY_FAMILY[t.model.split(':')[0] as 'anthropic' | 'openai']).filter(Boolean))].sort() : ['panel'];
  const checks = usedSources.map((src) => ({ source: src, check: o.judgeCheck?.sources[src] ?? null }));
  const gates = !!o.judgeCheck && o.judgeCheck.n_gold >= 40 && checks.every((c) => c.check?.kappa !== null && c.check?.kappa !== undefined && c.check.kappa >= KAPPA_MIN);
  const judge = { label_source: cross ? { 'anthropic cells': JUDGE_BY_FAMILY.anthropic, 'openai cells': JUDGE_BY_FAMILY.openai } : 'panel (label-set.ts final)',
    check: o.judgeCheck ? { n_gold: o.judgeCheck.n_gold, sources: checks } : 'not supplied', kappa_min: KAPPA_MIN, gates_verdict: gates,
    note: gates ? 'judge check passed for every label source the primary uses' : 'Got the skill is descriptive: the judge check is missing, has fewer than 40 gold outputs, or a label source has kappa under ' + KAPPA_MIN };

  const harnesses = HARNESSES.filter((h) => primarySet.some((t) => t.harness === h));
  const harnessRows = harnesses.map((h) => ({ harness: h, ...strip(contrast(primarySet.filter((t) => t.harness === h), 'native', 'resolver-on', got, elig)) }));
  const holm = harnessRows.length ? holmAdjusted(harnessRows.map((c) => c.p_sign_flip ?? 1)) : [];
  const perHarness = harnessRows.map((c, i) => ({ ...c, p_holm: c.p_sign_flip === null ? null : holm[i]! }));

  const perCell = cellsOf(primarySet).map((key) => {
    const [harness, model] = key.split('|');
    const ts = primarySet.filter((t) => t.harness === harness && t.model === model);
    const rates: Record<string, Interval> = {};
    for (const arm of [...new Set(ts.map((t) => t.arm!))].sort()) {
      const scored = ts.filter((t) => t.arm === arm && !t.contaminated && !elig(t, arm));
      rates[arm] = interval(scored.reduce((s, t) => s + (got(t) ?? 0), 0), scored.length);
    }
    return { harness, model, got_the_skill: rates, resolver_on_minus_native: strip(contrast(ts, 'native', 'resolver-on', got, elig)) };
  });

  const equivalence = harnesses.flatMap((h) => {
    const out = [];
    for (const [set, other] of [[PRIMARY_SET, 'names-only'], ['R', 'usage-ordered']] as const) {
      const ts = phaseB.filter((t) => t.harness === h && labels.get(t.task)?.set === set);
      if (!ts.some((t) => t.arm === other)) continue;
      const c = contrast(ts, other, 'resolver-on', got, (t, arm) => elig(t, arm) ?? elig(t, arm === other ? 'resolver-on' : other));
      out.push({ harness: h, set, comparator: other, contrast: strip(c), tost: tost(c) });
    }
    return out;
  });

  const resolverArms = phaseB.filter((t) => t.turns.length && !t.contaminated);
  const fsA = (ts: Trial[]) => {
    const none = ts.filter((t) => lab(t)?.no_skill_needed);
    return interval(none.filter((t) => t.turns.some((x) => x.block)).length, none.length);
  };
  const fsB = (ts: Trial[]) => {
    let x = 0, n = 0;
    for (const t of ts) {
      const acc = lab(t)?.acceptable ?? [];
      for (const turn of t.turns.filter((u) => u.block)) { n++; if (turn.suggestions.some((s) => t.opened.includes(s) && !acc.includes(s))) x++; }
    }
    return interval(x, n);
  };
  const byPhase = (ts: Trial[]) => {
    const m: Record<string, { x: number; n: number }> = {};
    for (const t of ts.filter((u) => lab(u)?.no_skill_needed)) for (const turn of t.turns) {
      const k = turn.phase ?? 'unknown';
      m[k] = m[k] ?? { x: 0, n: 0 };
      m[k]!.n++; if (turn.block) m[k]!.x++;
    }
    return Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, interval(v.x, v.n)]));
  };
  const fsRows = (label: string, ts: Trial[]) => [true, false].map((on) => {
    const side = ts.filter((t) => t.turns.every((u) => u.on === on) && t.turns.length);
    const a = fsA(side), b = fsB(side);
    return { scope: label, mode: on ? 'on' : 'off (shadow)', arms: [...new Set(side.map((t) => t.arm))].sort(), a_no_skill_requests_with_block: a, b_off_target_reads_per_block_turn: b, a_by_budget_phase: byPhase(side),
      a_meets_bar: a.rate === null ? null : a.rate <= FALSE_SUGGESTION_BARS.a, b_meets_bar: b.rate === null ? null : b.rate <= FALSE_SUGGESTION_BARS.b };
  });
  const falseSuggestions = {
    bars: FALSE_SUGGESTION_BARS,
    rows: [...fsRows('pooled', resolverArms), ...harnesses.flatMap((h) => fsRows(h, resolverArms.filter((t) => t.harness === h)))],
  };

  const infra = { handling: 'intention-to-treat: INFRA trials stay in every analysis with their observed outcome', by_code: {} as Record<string, number>, by_reason: {} as Record<string, number>, by_termination: {} as Record<string, number>, infra_trials: {} as Record<string, number>, no_got_skill_output: 0 };
  for (const t of trials) {
    bump(infra.by_termination, t.termination);
    for (const turn of t.turns) bump(infra.by_code, turn.code);
    for (const r of t.infra) bump(infra.by_reason, r);
    if (t.infra.length) bump(infra.infra_trials, t.harness + ' ' + (t.arm ?? '?'));
    if (!t.set_t && t.arm && !t.got_skill_file) infra.no_got_skill_output++;
  }

  const tVal = (k: 'success' | 'used_it') => (t: Trial) => (t.set_t ? (t.set_t[k] ? 1 : 0) : null);
  const tElig = () => null;
  const taskPhase = {
    pooled: Object.fromEntries((['success', 'used_it'] as const).map((k) => [k, { 'resolver-on_minus_native': strip(contrast(taskT, 'native', 'resolver-on', tVal(k), tElig)), 'no-catalog_minus_native': strip(contrast(taskT, 'native', 'no-catalog', tVal(k), tElig)) }])),
    success_tost: tost(contrast(taskT, 'native', 'resolver-on', tVal('success'), tElig)),
    gbra_108_note: 'a 2-point margin needs about 7,000 pairs; this run cannot certify it either way',
    per_cell: cellsOf(taskT).map((key) => {
      const [harness, model] = key.split('|');
      const ts = taskT.filter((t) => t.harness === harness && t.model === model);
      const arms = [...new Set(ts.map((t) => t.arm!))].sort();
      return { harness, model, arms: Object.fromEntries(arms.map((a) => { const s = ts.filter((t) => t.arm === a); return [a, { success: interval(s.filter((t) => t.set_t!.success).length, s.length), used_it: interval(s.filter((t) => t.set_t!.used_it).length, s.length) }]; })) };
    }),
    strata: [] as unknown[],
  };
  const tTask = (t: Trial) => t.task.slice(0, 3);
  const stratT = (name: string, keep: (t: Trial) => boolean, extra: Record<string, unknown> = {}) => ({ stratum: name, ...extra,
    success: strip(contrast(taskT.filter(keep), 'native', 'resolver-on', tVal('success'), tElig)), used_it: strip(contrast(taskT.filter(keep), 'native', 'resolver-on', tVal('used_it'), tElig)) });
  if (o.setT) for (const bin of ['none', 'low', 'mid', 'high']) {
    const ids = [...o.setT.entries()].filter(([, v]) => v.bin === bin);
    if (!ids.length) continue;
    const cov = ids.map(([, v]) => v.body_coverage);
    taskPhase.strata.push(stratT('overlap ' + bin, (t) => o.setT!.get(t.task)?.bin === bin, { tasks: ids.length, body_coverage: { mean: mean(cov), min: Math.min(...cov), max: Math.max(...cov) } }));
  }
  for (const [g, ids] of Object.entries(SET_T_GROUPS)) taskPhase.strata.push(stratT('flagged ' + g, (t) => ids.includes(tTask(t)), { tasks: ids }));
  const nc = taskT.filter((t) => t.arm === 'no-catalog' && SET_T_GROUPS.guessable.includes(tTask(t)));
  Object.assign(taskPhase, { no_catalog_pass_on_guessable: interval(nc.filter((t) => t.set_t!.success).length, nc.length) });

  const sessions = new Map<string, { harness: string; arm: string; turns: Turn[] }>();
  for (const t of phaseB.filter((u) => !u.contaminated)) for (const turn of t.turns) {
    const k = t.harness + '|' + t.arm + '|' + t.id + '|' + turn.session;
    const s = sessions.get(k) ?? { harness: t.harness, arm: t.arm!, turns: [] };
    s.turns.push(turn); sessions.set(k, s);
  }
  const footGroups = new Map<string, Array<{ harness: string; arm: string; turns: Turn[] }>>();
  for (const s of sessions.values()) { const k = s.harness + '|' + s.arm; footGroups.set(k, [...(footGroups.get(k) ?? []), s]); }
  const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
  const footprint = [...footGroups.entries()].sort().map(([k, ss]) => {
    const [harness, arm] = k.split('|');
    const at = Object.fromEntries(FOOTPRINT_TURNS.map((n) => {
      const reach = ss.filter((s) => Math.max(...s.turns.map((u) => u.turn ?? 0)) >= n);
      const added = reach.map((s) => s.turns.filter((u) => (u.turn ?? 0) <= n && u.injected).reduce((a, u) => a + u.block_tokens, 0));
      return ['turn_' + n, { sessions: reach.length, median_tokens: median(added), max_tokens: added.length ? Math.max(...added) : null }];
    }));
    const firstOut = ss.map((s) => s.turns.filter((u) => u.exhausted).map((u) => u.turn ?? 0).sort((a, b) => a - b)[0]).filter((x): x is number => x !== undefined);
    return { harness, arm, sessions: ss.length, ...at, budget_exhausted: { sessions: firstOut.length, first_turn_median: median(firstOut), first_turn_min: firstOut.length ? Math.min(...firstOut) : null } };
  });

  const strataP = ['none', 'low', 'mid', 'high'].map((bin) => ({ bin, contrast: strip(contrast(primarySet.filter((t) => labels.get(t.task)?.bin === bin), 'native', 'resolver-on', got, elig)) })).filter((s) => s.contrast.n_pairs || Object.keys(s.contrast.excluded).length);

  const denominators = cellsOf(primarySet).map((key) => {
    const [h, model] = key.split('|') as [string, string];
    const reqs = [...new Set(primarySet.filter((t) => t.harness === h && t.model === model).map((t) => t.task))];
    const out: Record<string, number> = { requests: reqs.length };
    for (const id of reqs) { const l = labels.get(id); const why = ineligible(cross ? labelFor(l, model) : l, h, 'native', reachable); bump(out, why ?? 'in denominator'); }
    return { harness: h, model, ...out } as { harness: string; model: string } & Record<string, string | number>;
  });

  const contamination = {
    rule: 'CREW.md, "Clean no-gstack and no-brain arms": a trial whose tool calls named a gstack path outside its own catalog copy is contaminated, reported here and left out of every scored number',
    total: phaseB.filter((t) => t.contaminated).length,
    per_cell: [...new Set(phaseB.map((t) => t.cell))].sort().map((cell) => {
      const ts = phaseB.filter((t) => t.cell === cell);
      return { cell, harness: ts[0]!.harness, model: ts[0]!.model, arm: ts[0]!.arm!, trials: ts.length, contaminated: ts.filter((t) => t.contaminated).length, gstack_reads: ts.reduce((s, t) => s + (t.gstack_reads ?? 0), 0) };
    }),
  };

  return {
    schema: 'he-skill-resolver-analysis/1', seed: SEED, draws: DRAWS, alpha: ALPHA, primary_set: PRIMARY_SET,
    reachable_sets: reachable ? 'supplied' : 'not supplied: every acceptable skill counted as reachable',
    qm_resolver_on_arm: 'pi-skills-push (emulated hook); pi-skills-pull reported as qm-pull',
    trials: { total: trials.length, phase_b: phaseB.length, task_phase: taskT.length },
    judge,
    primary: { ...strip(primary), bar: PRIMARY_BAR, significant: significant(primary), claim_met: gates && significant(primary) && (primary.delta ?? 0) >= PRIMARY_BAR, gated_by_judge_check: gates },
    sensitivity_test_half: strip(sensitivity), panel_labels: panelPrimary ? strip(panelPrimary) : null,
    set_r: { ...strip(setR), descriptive: true, why: 'set R text goes to Anthropic only (decision 1A), so Opus labels score Opus cells: same family, never gates a verdict (R78)' },
    per_harness: perHarness, per_cell: perCell, equivalence, false_suggestions: falseSuggestions, infra, contamination, task_phase: taskPhase, footprint,
    strata_set_p: strataP, denominators,
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (100 * v).toFixed(1) + '%');
const pts = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + (100 * v).toFixed(1));
const ci = (c: [number, number] | null | undefined, f = pts) => (c ? '[' + f(c[0]) + ', ' + f(c[1]) + ']' : '-');
const p = (v: number | null | undefined) => (v === null || v === undefined ? '-' : v < 0.001 ? '<0.001' : v.toFixed(3));
const iv = (i: Interval) => (i.n ? pct(i.rate) + ' ' + ci(i.ci95, pct) + ' (' + i.x + '/' + i.n + ')' : '-');
const row = (cells: unknown[]) => '| ' + cells.map(String).join(' | ') + ' |';
const head = (cells: string[]) => row(cells) + '\n' + row(cells.map(() => '---'));
const cRow = (label: string, c: { n_pairs: number; n_worse?: number; mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null; p_sign_flip: number | null; mcnemar: { p_two_sided: number } | null; reading?: string }) =>
  row([label, c.n_pairs, c.n_worse ?? '-', pct(c.mean_a), pct(c.mean_b), pts(c.delta), ci(c.ci95), p(c.p_sign_flip), p(c.mcnemar?.p_two_sided), c.reading ?? '-']);
const C_HEAD = ['', 'pairs', 'worse in B', 'A', 'B', 'B minus A (points)', '95% interval', 'sign-flip p', 'McNemar p', 'reading'];

export function markdown(a: ReturnType<typeof analyze>): string {
  const out: string[] = ['# Skill-resolver analysis (' + a.schema + ')', '',
    'Bootstrap seed ' + a.seed + ', ' + a.draws + ' draws, alpha ' + a.alpha + '. Primary set: ' + a.primary_set + '. Reachable sets: ' + a.reachable_sets + '. QM resolver-on: ' + a.qm_resolver_on_arm + '.', '',
    'Intervals are 95%: cluster bootstrap for paired differences, Clopper-Pearson for rates. Pairs are per request within a cell, clustered by request; exact-duplicate requests share one cluster.', '',
    '## Primary: resolver-on minus native, Got the skill', '', head(C_HEAD),
    cRow('pooled, set ' + a.primary_set, a.primary), cRow('sensitivity, test half', a.sensitivity_test_half), ...(a.panel_labels ? [cRow('sensitivity, panel labels', a.panel_labels)] : []), cRow('set R (one user, descriptive)', a.set_r), '',
    'Bar: at least ' + pts(a.primary.bar) + ' points and significant (both p at most ' + a.alpha + '), and the judge check passed. Significant: ' + a.primary.significant + '. Judge check passed: ' + a.primary.gated_by_judge_check + '. Claim met: ' + a.primary.claim_met + '. Minimum detectable difference at 80% power: ' + pts(a.primary.mdd80) + ' points.', '',
    '## Judge (R78)', '', 'Label source: ' + (typeof a.judge.label_source === 'string' ? a.judge.label_source : Object.entries(a.judge.label_source).map(([k, v]) => k + ' scored with ' + v).join('; ')) + '. ' + a.judge.note + '.', '',
    head(['label source', 'kappa', 'catch rate (bad outputs)', 'false-fail rate (good outputs)', 'gold bad', 'gold good']),
    ...(typeof a.judge.check === 'string' ? [row(['-', 'not supplied', '-', '-', '-', '-'])] : a.judge.check.sources.map((c) => row([c.source, c.check?.kappa?.toFixed(3) ?? '-', pct(c.check?.catch_rate), pct(c.check?.false_fail_rate), c.check?.n_bad ?? '-', c.check?.n_good ?? '-']))), '',
    '## Per harness (pooled over models, Holm over harnesses)', '', head([...C_HEAD, 'Holm p'])];
  for (const h of a.per_harness) out.push(cRow(h.harness, h).replace(/ \|$/, ' | ' + p(h.p_holm) + ' |'));
  out.push('', '## Per cell (descriptive)', '', head(['harness', 'model', 'arm', 'Got the skill'])); 
  for (const c of a.per_cell) for (const [arm, i] of Object.entries(c.got_the_skill)) out.push(row([c.harness, c.model, arm, iv(i)]));
  out.push('', '## Against the config-only arms (TOST, margin ' + pts(TOST_MARGIN) + ' points)', '', head(['harness', 'set', 'comparator', 'pairs', 'resolver-on minus comparator', '95% interval', 'TOST p', 'verdict']));
  for (const e of a.equivalence) out.push(row([e.harness, e.set, e.comparator, e.contrast.n_pairs, pts(e.contrast.delta), ci(e.contrast.ci95), p(e.tost.p), e.tost.verdict]));
  out.push('', '## False suggestions', '', 'Bars: (a) at most ' + pct(a.false_suggestions.bars.a) + ', (b) at most ' + pct(a.false_suggestions.bars.b) + '.', '',
    head(['scope', 'mode', 'arms', '(a) no-skill requests with a block', '(b) off-target reads per block turn', '(a) by budget phase']));
  for (const r of a.false_suggestions.rows) out.push(row([r.scope, r.mode, r.arms.join(', ') || '-', iv(r.a_no_skill_requests_with_block), iv(r.b_off_target_reads_per_block_turn),
    Object.entries(r.a_by_budget_phase).map(([k, v]) => k + ' ' + iv(v as Interval)).join('; ') || '-']));
  out.push('', '## INFRA (' + a.infra.handling + ')', '', head(['kind', 'value', 'count']));
  for (const [kind, m] of [['termination', a.infra.by_termination], ['status code', a.infra.by_code], ['INFRA reason', a.infra.by_reason], ['INFRA trials', a.infra.infra_trials]] as const)
    for (const [k, v] of Object.entries(m).sort()) out.push(row([kind, k, v]));
  out.push(row(['missing got-skill output', 'scored 0', a.infra.no_got_skill_output]));
  out.push('', '## Clean-arm audit (contaminated trials left out of every scored number)', '', a.contamination.rule + '. Contaminated trials: ' + a.contamination.total + '.', '',
    head(['cell', 'harness', 'model', 'arm', 'trials', 'contaminated (left out)', 'gstack reads']));
  for (const c of a.contamination.per_cell) out.push(row([c.cell, c.harness, c.model, c.arm, c.trials, c.contaminated, c.gstack_reads]));
  const tp = a.task_phase;
  out.push('', '## Task phase (set T)', '', head(C_HEAD));
  for (const k of ['success', 'used_it'] as const) for (const [name, c] of Object.entries(tp.pooled[k] as Record<string, Contrast>)) out.push(cRow(k + ', ' + name.replace('_minus_', ' minus '), c));
  out.push('', 'Success TOST, resolver-on vs native, margin ' + pts(tp.success_tost.margin) + ': p ' + p(tp.success_tost.p) + ', ' + tp.success_tost.verdict + '. internal-task: ' + tp.gbra_108_note + '.', '',
    head(['harness', 'model', 'arm', 'Success', 'Used it']));
  for (const c of tp.per_cell) for (const [arm, v] of Object.entries(c.arms)) out.push(row([c.harness, c.model, arm, iv(v.success), iv(v.used_it)]));
  out.push('', head(['stratum', 'success pairs', 'success B minus A', '95% interval', 'used_it B minus A', '95% interval']));
  for (const s of tp.strata as Array<{ stratum: string; success: Contrast; used_it: Contrast }>) out.push(row([s.stratum, s.success.n_pairs, pts(s.success.delta), ci(s.success.ci95), pts(s.used_it.delta), ci(s.used_it.ci95)]));
  out.push('', '## Context footprint (injected block tokens per session)', '', head(['harness', 'arm', 'sessions', ...FOOTPRINT_TURNS.map((n) => 'turn ' + n + ' median (max)'), 'first budget_exhausted turn (median, min)']));
  for (const f of a.footprint) {
    const r = f as unknown as Record<string, { sessions: number; median_tokens: number | null; max_tokens: number | null }>;
    out.push(row([f.harness, f.arm, f.sessions, ...FOOTPRINT_TURNS.map((n) => { const x = r['turn_' + n]!; return x.sessions ? x.median_tokens + ' (' + x.max_tokens + ')' : '-'; }),
      f.budget_exhausted.sessions ? f.budget_exhausted.first_turn_median + ', ' + f.budget_exhausted.first_turn_min : 'never']));
  }
  out.push('', '## Set P by overlap bin (resolver-on minus native)', '', head(C_HEAD));
  for (const s of a.strata_set_p) out.push(cRow(s.bin, s.contrast));
  out.push('', '## Denominators (set ' + a.primary_set + ', native)', '');
  const keys = [...new Set(a.denominators.flatMap((d) => Object.keys(d).filter((k) => k !== 'harness' && k !== 'model')))];
  out.push(head(['harness', 'model', ...keys]));
  for (const d of a.denominators) out.push(row([d.harness, d.model, ...keys.map((k) => (d as Record<string, unknown>)[k] ?? 0)]));
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((x, i) => (x === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
  const pairsOf = (n: string) => all(n).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] as [string, string]; });
  const results = all('results')[0], out = all('out')[0];
  if (!results || !out || !all('labels').length || pairsOf('labels').some(([k]) => !k)) {
    console.error('usage: analyze.ts --results <dir> --labels SET=<labels.jsonl>... [--requests SET=<setp.jsonl>]... [--reachable <json>] [--set-t <dir>] [--duplicate-groups <json>] [--cross-family SET=<astra labels.jsonl>] [--judge-check <judge-check.json>] --out <dir>');
    process.exit(2);
  }
  const reachable = all('reachable')[0] ? readReachable(all('reachable')[0]!) : null;
  const setTDir = all('set-t')[0];
  let setT: Map<string, { bin: string; body_coverage: number }> | undefined;
  if (setTDir) {
    const { setTTaskIds, loadSetTTask } = await import('../../runner/trial/set-t.ts');
    const root = resolve(setTDir, '..', '..', '..');
    setT = new Map(setTTaskIds(root).map((id) => { const t = loadSetTTask(join(setTDir, id)); return [id, { bin: t.overlap.bin, body_coverage: t.overlap.body_coverage }]; }));
  }
  const groupsFile = all('duplicate-groups')[0];
  const groups = groupsFile ? (JSON.parse(readFileSync(groupsFile, 'utf8')).request_duplicate_groups ?? []) as string[][] : [];
  const judgeFile = all('judge-check')[0];
  const a = analyze({ trials: loadTrials(results), labels: loadLabels(pairsOf('labels'), pairsOf('requests'), groups, pairsOf('cross-family')), reachable, setT,
    judgeCheck: judgeFile ? JSON.parse(readFileSync(judgeFile, 'utf8')) as JudgeCheck : null });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'analysis.json'), JSON.stringify(a, null, 1) + '\n');
  writeFileSync(join(out, 'analysis.md'), markdown(a));
  console.log('ANALYSIS seed=' + a.seed + ' draws=' + a.draws + ' trials=' + a.trials.total + ' primary_pairs=' + a.primary.n_pairs + ' delta=' + pts(a.primary.delta) + ' ci95=' + ci(a.primary.ci95) + ' p=' + p(a.primary.p_sign_flip) + ' mcnemar_p=' + p(a.primary.mcnemar?.p_two_sided) + ' out=' + out);
}
