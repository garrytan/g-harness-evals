#!/usr/bin/env bun
// The MCP-at-scale analysis (internal-task plan, "Outcomes" and "The question and the decisions it changes"): every
// preregistered outcome, paired, with 95% ranges, clustered by core tool, from the grader's outcomes.json per trial
// (scripts/mcp-at-scale/grade.py), and decisions 1 to 4 as the plan words them. Keyless and offline.
//
//   bun scripts/mcp-at-scale/analysis/analyze.ts --trials <trials.jsonl> --sets <set-r.jsonl> [<set-t.jsonl> <set-g.jsonl> ...]
//       (--interim-state <state.json> | --exploratory) [--places <places.json>] [--margins <margins.json>] --out <dir>
//
// Inputs: the trial index (stats.ts), the set files (requests/sets.ts shapes; the public and sealed halves together),
// --places {<harness>: {"<rung>": {"<server>/<tool>": "full_schema" | "description" | "name_only" | "server_only" | "absent"}}}
// from the keyless listing map, --margins {gbrain: <points as a fraction>} as frozen in the prereg (else power.ts's margin
// at the plan's assumptions, marked provisional).
//
// Pairs and clusters: a request is paired with itself across rungs (or arms) within a setup (harness and model); a
// harness's two models are pooled with the model in the pair key. Repetitions pair by number (rep 1 with rep 1), a
// repetition without its partner is counted as unpaired, and two trials with one key stop the analysis. Tool requests cluster by target core tool, no-tool
// requests and set T tasks by themselves, set G requests by target gbrain tool. Ranges are the cluster bootstrap's 95%
// percentile interval and p is the cluster sign-flip test (runner/stats/paired.ts). INFRA trials are counted per cell and
// never scored: a pair with an INFRA side is left out and counted.
//
// Decisions, in the plan's words:
//   2. Slip point per harness: the smallest rung whose right-tool rate is at least 5 points below the 30 rung with the 95%
//      range below 0, tested 300 first, then 150, then 75 (a fixed sequence: testing stops at the first rung that does
//      not slip). Holds through 300 only if the lower 95% limit of (300 minus 30) is above minus 7 points; otherwise "not
//      shown". Each Opus harness (Claude Code, Hermes, OpenClaw, Pi, QM, on Opus) is compared with the mean of the Opus
//      harnesses at the same rung, per request; a holding harness is named when its 300 rate is not clearly below that
//      mean (the range of its difference from the mean does not sit wholly below 0). Codex is reported beside them,
//      labelled as a different model. Cost per request at 150 and 300 goes with it.
//   3. Prune advice: a harness whose slip test passes at a rung C with a drop of at least 10 points gets "keep below C
//      tools" (the smallest such C). A harness that does not slip through 300 but costs at least twice as much per request
//      at 300 as at 30 gets advice about cost only. Otherwise pruning is not needed for accuracy on that harness.
//   4. Mechanism: where send-everything (Claude Code with tool search off; Pi direct) beats the harness's own search
//      (Claude Code native; Pi codemode and Pi deferred) by at least 5 points with the range above 0, search costs accuracy
//      at that rung; the report names the smallest such rung. Search is non-inferior when the range of (send-everything
//      minus search) sits below MECH_NI_MARGIN, and cheaper when the range of its cost difference sits below 0.
//   1. gbrain's surface, pooled over the setups at the 150 rung: each surface against full on both halves of set G,
//      paired by setup, item and repetition, and its cost to the other requests
//      (reward on the re-run core requests against the no-gbrain native 150 arm). A surface passes when the lower 95%
//      limit of each difference is above minus the margin. Verbs passes: setup keeps or moves to verbs and gbrain is asked
//      to make bare gbrain serve advertise verbs. Only full passes: setup pins full. None passes: the current default
//      stays, with gbrain's measured cost to other tools. A per-harness override is flagged when that harness's own 95%
//      range excludes the pooled difference. request_tools gets FIX-METHOD when the upper 95% limit of verbs' full-only
//      half is below 70%, pooled or on any harness.
// Writes <out>/analysis.json and <out>/analysis.md.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Item, TItem } from '../requests/sets.ts';
import { lookTrials } from './interim.ts';
import { gbrainMargin } from './power.ts';
import { RUNGS, contrastOf, hasTranscript, isInfra, isOpus, loadTrials, paired, rate, readJsonl, requestIndex, setup, setupItemRep, taskSuccess, trialsDigest, VALUES, type Contrast, type Requests, type Trial } from './stats.ts';

export const SLIP_BAR = 0.05;
export const HOLD_BOUND = -0.07;
export const ADVICE_BAR = 0.10;
export const COST_RATIO = 2;
export const MECH_BAR = 0.05;
/** The plan gives no margin for "search is non-inferior" in decision 4; this reuses decision 2's 7-point bound until the
 *  prereg fixes one. */
export const MECH_NI_MARGIN = 0.07;
export const FIX_METHOD_CEILING = 0.70;
export const FINAL_BOUND = 1.977;
export const STOPPED_NOTE = 'stopped early, estimate possibly overstated';
export const TEST_ORDER = [300, 150, 75] as const;
export const OPUS_HARNESSES = ['claude-code', 'hermes', 'openclaw', 'pi', 'qm'];
export const SURFACES = ['full', 'starter', 'verbs', 'registered'] as const;
export const MECHANISM_PAIRS: Array<{ harness: string; search: string; send_everything: string }> = [
  { harness: 'claude-code', search: 'native', send_everything: 'tool-search-off' },
  { harness: 'pi', search: 'native', send_everything: 'pi-direct' },
  { harness: 'pi', search: 'pi-deferred', send_everything: 'pi-direct' },
];

type InterimDecision = 'continue' | 'no data at the look' | 'stop_efficacy' | 'stop_opposite' | 'stop_futility';
type InterimDecisions = Record<string, InterimDecision>;
const isStopped = (decision: InterimDecision) => decision.startsWith('stop_');
const stopNote = (decision: InterimDecision) => STOPPED_NOTE + (decision === 'stop_futility' ? ' (futility)' : '');

function loadInterimDecisions(path: string, sets: string[], margin: number, trials: Trial[], items: Item[]): InterimDecisions {
  const designFile = join(import.meta.dir, 'interim-design.json');
  const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const design = JSON.parse(readFileSync(designFile, 'utf8')) as { comparisons: { id: string }[]; seed: string; fraction: number };
  const state = JSON.parse(readFileSync(path, 'utf8')) as {
    schema?: string; look?: string; status?: string; design_sha256?: string; sets_sha256?: string[]; gbrain_margin?: number; trials_digest?: string; decisions?: InterimDecisions;
  };
  if (state?.schema !== 'he-mcp-at-scale-interim-state/1' || state.look !== 'interim' || state.status !== 'complete') {
    throw new Error('final analysis requires a completed interim state');
  }
  if (state.design_sha256 !== sha(designFile) || JSON.stringify(state.sets_sha256?.slice().sort()) !== JSON.stringify(sets.map(sha).sort())) {
    throw new Error('interim state does not match the frozen design and request sets');
  }
  if (state.gbrain_margin !== margin) throw new Error('final analysis does not match the interim gbrain margin');
  if (!state.trials_digest || state.trials_digest !== trialsDigest(lookTrials(trials, items, design).kept)) {
    throw new Error('interim state was computed from different trials than these trials hold for the look\'s units');
  }
  const decisions = state.decisions;
  if (!decisions || Object.keys(decisions).length !== design.comparisons.length || !design.comparisons.every(({ id }) =>
    ['continue', 'no data at the look', 'stop_efficacy', 'stop_opposite', 'stop_futility'].includes(decisions[id] ?? ''))) {
    throw new Error('interim state is missing valid decisions for the frozen comparisons');
  }
  return decisions;
}

export interface Ctx { trials: Trial[]; req: Requests; tItems: Map<string, TItem>; cl: (t: Trial) => string; interimDecisions?: InterimDecisions }
export function context(trials: Trial[], items: Item[], interimDecisions?: InterimDecisions): Ctx {
  const req = requestIndex(items);
  return { trials, req, tItems: new Map(items.filter((i) => i.set === 'T').map((i) => [i.id, i as TItem])), cl: (t) => req.cluster(t.request), interimDecisions };
}

const passesBoundary = (distance: number, x: Contrast) => !!x.se_cluster && distance / x.se_cluster >= FINAL_BOUND;
const stoppedAtInterim = (c: Ctx, id: string) => isStopped(c.interimDecisions?.[id] ?? 'continue');

function finalLook(c: Ctx, id: string, x: Contrast, direction: 1 | -1, sides: 1 | 2, shift = 0) {
  const interim_decision = c.interimDecisions?.[id];
  if (!interim_decision) return null;
  const stopped = isStopped(interim_decision);
  const z = !stopped && x.delta !== null && x.se_cluster ? (direction * x.delta + shift) / x.se_cluster : null;
  return { interim_decision, z, boundary: FINAL_BOUND, boundary_crossed: z === null ? null : (sides === 2 ? Math.abs(z) : z) >= FINAL_BOUND,
    note: stopped ? stopNote(interim_decision) : null };
}

const where = (c: Ctx, f: Partial<Pick<Trial, 'harness' | 'model' | 'arm' | 'set' | 'rung'>>) =>
  c.trials.filter((t) => Object.entries(f).every(([k, v]) => (t as unknown as Record<string, unknown>)[k] === v));

/** One harness's right-tool (or other) contrast, rung r against 30, native arm, set R; models pooled in the key. */
export function rungContrast(c: Ctx, harness: string, rung: number, value: (t: Trial) => number | null = VALUES.right_tool, model?: string): Contrast {
  const rows = where(c, { harness, arm: 'native', set: 'R' }).filter((t) => !model || t.model === model);
  return paired(rows.filter((t) => t.rung === 30), rows.filter((t) => t.rung === rung), value, setupItemRep, c.cl);
}

/** Decision 2's fixed sequence for one harness. */
export function slipTest(c: Ctx, harness: string) {
  const steps: Array<{ rung: number; contrast: Contrast; slips: boolean | null; final_look: ReturnType<typeof finalLook> }> = [];
  let slipPoint: number | null = null;
  for (const r of TEST_ORDER) {
    const id = 'slip:' + harness;
    const x = r === 300 && stoppedAtInterim(c, id) ? contrastOf([]) : rungContrast(c, harness, r);
    const final_look = r === 300 ? finalLook(c, id, x, -1, 2) : null;
    const slips = final_look?.note ? null : x.delta !== null && x.delta <= -SLIP_BAR && !!x.ci95 && x.ci95[1] < 0 && (!final_look || (final_look.z ?? 0) >= FINAL_BOUND);
    steps.push({ rung: r, contrast: x, slips, final_look });
    if (!slips) break;
    slipPoint = r;
  }
  const { contrast: at300, final_look } = steps[0]!;
  const holds = final_look?.note ? null : !!at300.ci95 && at300.ci95[0] > HOLD_BOUND && (!final_look || passesBoundary(at300.delta! - HOLD_BOUND, at300));
  return { sequence: steps, slip_point: slipPoint, holds_through_300: holds, lower_300: at300.ci95?.[0] ?? null };
}

/** Each Opus harness against the mean of the Opus harnesses, per request at one rung (decision 2). */
export function opusMean(c: Ctx, rung: number): Record<string, Contrast> {
  const rows = where(c, { arm: 'native', set: 'R', rung }).filter((t) => isOpus(t.model) && OPUS_HARNESSES.includes(t.harness));
  const harnesses = [...new Set(rows.map((t) => t.harness))];
  const byReq = new Map<string, number[]>();
  for (const t of rows) { const v = VALUES.right_tool(t); if (v !== null) (byReq.get(t.request) ?? byReq.set(t.request, []).get(t.request)!).push(v); }
  const mean = new Map([...byReq].map(([k, vs]) => [k, vs.reduce((s, v) => s + v, 0) / vs.length]));
  const out: Record<string, Contrast> = {};
  for (const h of harnesses) {
    const mine = rows.filter((t) => t.harness === h);
    const ref: Trial[] = mine.filter((t) => mean.has(t.request)).map((t) => ({ ...t, trial_id: t.trial_id + '#mean', harness: 'opus-mean', outcomes: { ...t.outcomes!, infra: null } }));
    out[h] = paired(ref, mine, (t) => (t.harness === 'opus-mean' ? mean.get(t.request)! : VALUES.right_tool(t)), (t) => JSON.stringify([t.model, t.request, t.rep ?? 1]), c.cl);
  }
  return out;
}

/** Cost per request and the descriptive outcomes of one setup at one rung, any arm. */
export function cell(c: Ctx, s: string, arm: string, rung: number) {
  const rows = c.trials.filter((t) => setup(t) === s && t.arm === arm && t.rung === rung && t.set === 'R');
  const scored = rows.filter((t) => !isInfra(t));
  const withUsage = scored.filter((t) => t.usage);
  const input = withUsage.reduce((x, t) => x + t.usage!.input_tokens, 0), cacheRead = withUsage.reduce((x, t) => x + (t.usage!.cache_read_tokens ?? 0), 0);
  const transcripts = scored.filter(hasTranscript);
  const eff = transcripts.filter((t) => t.effort!.found);
  const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null);
  return {
    trials: rows.length, infra: rows.length - scored.length,
    right_tool: rate(rows, VALUES.right_tool, c.cl), wrong_tool: rate(rows, VALUES.wrong_tool, c.cl), tool_when_none: rate(rows, VALUES.tool_when_none, c.cl),
    usd_per_request: rate(rows, VALUES.usd, c.cl), input_tokens_per_request: withUsage.length ? Math.round(input / withUsage.length) : null,
    cache_read_share: input ? Number((cacheRead / input).toFixed(4)) : null,
    cache_broken_after_load: null, builtin_substitution: null, not_measured: 'cache_broken_after_load and builtin_substitution: the runner does not record them',
    search_effort: { found: eff.length, with_transcript: transcripts.length, search_calls_before_right: mean(eff.map((t) => t.effort!.search_calls_before_right)), turns_before_right: mean(eff.map((t) => t.effort!.turns_before_right ?? 0)) },
  };
}

export function infraTable(c: Ctx) {
  const m = new Map<string, { harness: string; model: string; arm: string; set: string; rung: number; trials: number; infra: number; codes: Record<string, number> }>();
  for (const t of c.trials) {
    const k = [t.harness, t.model, t.arm, t.set, t.rung].join('|');
    const e = m.get(k) ?? m.set(k, { harness: t.harness, model: t.model, arm: t.arm, set: t.set, rung: t.rung, trials: 0, infra: 0, codes: {} }).get(k)!;
    e.trials++;
    if (isInfra(t)) { e.infra++; const code = t.outcomes?.infra?.code ?? 'no outcomes'; e.codes[code] = (e.codes[code] ?? 0) + 1; }
  }
  return [...m.values()];
}

export function decision2and3(c: Ctx) {
  const harnesses = [...new Set(where(c, { arm: 'native', set: 'R' }).map((t) => t.harness))].sort();
  const mean300 = opusMean(c, 300);
  const opusMeanByRung = Object.fromEntries(RUNGS.map((r) => [r, r === 300 ? mean300 : opusMean(c, r)]));
  return harnesses.map((h) => {
    const slip = slipTest(c, h);
    const models = [...new Set(where(c, { harness: h, arm: 'native' }).map((t) => t.model))].sort();
    const opus = models.some(isOpus) && OPUS_HARNESSES.includes(h);
    const vsMean = mean300[h] ?? null;
    const clearlyBelow = !!vsMean?.ci95 && vsMean.ci95[1] < 0;
    const usd = (r: number) => rate(where(c, { harness: h, arm: 'native', set: 'R', rung: r }), VALUES.usd, c.cl);
    const cost = { 30: usd(30), 150: usd(150), 300: usd(300) };
    const ratio = cost[30].mean && cost[300].mean !== null ? Number((cost[300].mean / cost[30].mean).toFixed(3)) : null;
    const adviceRung = slip.sequence.filter((s) => s.slips && s.contrast.delta! <= -ADVICE_BAR).map((s) => s.rung).sort((a, b) => a - b)[0] ?? null;
    const stopped = slip.sequence[0]!.final_look?.note;
    const advice = stopped ? { kind: 'not_decided', text: 'no final prune advice' }
      : adviceRung !== null ? { kind: 'accuracy', text: 'keep below ' + adviceRung + ' tools' }
      : slip.slip_point === null && ratio !== null && ratio >= COST_RATIO ? { kind: 'cost', text: 'cost per request at 300 is ' + ratio + 'x the 30 rung; advise about cost on this harness only' }
      : slip.slip_point !== null ? { kind: 'none', text: 'slips at ' + slip.slip_point + ' by less than ' + ADVICE_BAR * 100 + ' points; below the advice bar' }
      : { kind: 'none', text: 'pruning is not needed for accuracy on this harness' };
    return {
      harness: h, models, label: opus ? 'Opus harness' : h === 'codex' ? 'different model (GPT-6.2 Sol), reported beside the Opus harnesses, not compared head to head' : 'not an Opus harness',
      slip_point: slip.slip_point, sequence: slip.sequence, holds_through_300: slip.holds_through_300, result: stopped ?? (slip.holds_through_300 ? 'holds through 300' : slip.slip_point ? 'slips at ' + slip.slip_point : 'not shown'),
      per_model: Object.fromEntries(models.map((m) => [m, Object.fromEntries(TEST_ORDER.map((r) => [r, rungContrast(c, h, r, VALUES.right_tool, m)]))])),
      wrong_tool: Object.fromEntries(TEST_ORDER.map((r) => [r, rungContrast(c, h, r, VALUES.wrong_tool)])),
      tool_when_none: Object.fromEntries(TEST_ORDER.map((r) => [r, rungContrast(c, h, r, VALUES.tool_when_none)])),
      vs_opus_mean: opus ? Object.fromEntries(RUNGS.map((r) => [r, opusMeanByRung[r]![h] ?? null])) : null,
      named: opus && !stopped ? slip.holds_through_300 && !clearlyBelow : null,
      cost_per_request: cost, cost_ratio_300_to_30: ratio, prune_advice: advice,
    };
  });
}

export function setT(c: Ctx) {
  const rows = where(c, { set: 'T', arm: 'native' });
  const v = (t: Trial) => taskSuccess(t, c.tItems.get(t.request));
  const setups = [...new Set(rows.map(setup))].sort();
  return {
    pooled_300_vs_30: paired(rows.filter((t) => t.rung === 30), rows.filter((t) => t.rung === 300), v, setupItemRep, c.cl),
    per_setup: Object.fromEntries(setups.map((s) => [s, { 30: rate(rows.filter((t) => setup(t) === s && t.rung === 30), v, c.cl), 300: rate(rows.filter((t) => setup(t) === s && t.rung === 300), v, c.cl) }])),
  };
}

export function mechanismContrast(c: Ctx, p: (typeof MECHANISM_PAIRS)[number], rung: number, value: (t: Trial) => number | null = VALUES.right_tool): Contrast {
  const rows = where(c, { harness: p.harness, set: 'R', rung }).filter((t) => isOpus(t.model));
  return paired(rows.filter((t) => t.arm === p.search), rows.filter((t) => t.arm === p.send_everything), value, setupItemRep, c.cl);
}

export function decision4(c: Ctx) {
  return MECHANISM_PAIRS.filter((p) => where(c, { harness: p.harness, arm: p.send_everything }).length).map((p) => {
    const id = 'mechanism:' + (p.harness === 'pi' ? p.search === 'native' ? 'pi-native' : 'pi-deferred' : p.harness);
    const rungs = RUNGS.map((r) => {
      const stopped = r === 300 && stoppedAtInterim(c, id);
      const acc = stopped ? contrastOf([]) : mechanismContrast(c, p, r);
      const cost = stopped ? contrastOf([]) : mechanismContrast(c, p, r, VALUES.usd);
      const final_look = r === 300 ? finalLook(c, id, acc, 1, 2) : null;
      const beats = stopped ? null : acc.delta !== null && acc.delta >= MECH_BAR && !!acc.ci95 && acc.ci95[0] > 0 && (!final_look || (final_look.z ?? 0) >= FINAL_BOUND);
      const nonInferior = stopped ? null : !!acc.ci95 && acc.ci95[1] < MECH_NI_MARGIN && (!final_look || passesBoundary(MECH_NI_MARGIN - acc.delta!, acc));
      const cheaper = stopped ? null : !!cost.ci95 && cost.ci95[0] > 0;
      return { rung: r, send_everything_minus_search: acc, cost_send_everything_minus_search: cost, send_everything_beats_search: beats, search_non_inferior: nonInferior, search_cheaper: cheaper, final_look };
    });
    const wins = rungs.filter((r) => r.send_everything_beats_search).map((r) => r.rung);
    const first = wins[0] ?? null;
    const ni = rungs.filter((r) => r.search_non_inferior && r.search_cheaper).map((r) => r.rung);
    return { ...p, rungs, search_costs_accuracy_from: first,
      finding: first !== null ? 'search costs accuracy at ' + wins.join(', ') + ' tools on ' + p.harness + ' (' + p.search + ' against ' + p.send_everything + ')'
        : ni.length ? 'search is non-inferior and cheaper at ' + ni.join(', ') + ' tools' : 'no preregistered finding' };
  });
}

export function decision1(c: Ctx, margin: number, provisional: boolean) {
  const g = (s: string) => where(c, { arm: 'gbrain-' + s, set: 'G', rung: 150 });
  if (!g('full').length) return null;
  const half = (rows: Trial[], h: string) => rows.filter((t) => { const it = c.req.byId.get(t.request); return it?.set === 'G' && it.half_kind === h; });
  const key = setupItemRep;
  const ni = (x: Contrast) => !!x.ci95 && x.ci95[0] > -margin;
  const native150 = where(c, { arm: 'native', set: 'R', rung: 150 });
  const harnesses = [...new Set(g('full').map((t) => t.harness))].sort();
  const surfaces = SURFACES.filter((s) => g(s).length).map((s) => {
    const halves = (['starter', 'full_only'] as const).map((h) => {
      if (s === 'full') return { half: h, reachable: true, contrast: null, pass: true, note: 'reference', final_look: null };
      const id = 'gbrain:' + s + ':' + h;
      const stopped = stoppedAtInterim(c, id);
      const x = stopped ? contrastOf([]) : paired(half(g('full'), h), half(g(s), h), VALUES.right_tool, setupItemRep, c.cl);
      const final_look = finalLook(c, id, x, 1, 1, margin);
      return { half: h, reachable: true, contrast: x, pass: stopped ? null : ni(x) && (!final_look || (final_look.z ?? 0) >= FINAL_BOUND), final_look };
    });
    const others = where(c, { arm: 'gbrain-' + s, set: 'R', rung: 150 });
    const cost = paired(native150.filter((t) => others.some((o) => key(o) === key(t))), others, VALUES.reward, key, c.cl);
    const pass = halves.some((h) => h.pass === null) ? null : halves.every((h) => h.pass) && ni(cost);
    const perHarness = Object.fromEntries(harnesses.map((h) => [h, {
      halves: Object.fromEntries((['starter', 'full_only'] as const).filter(() => s !== 'full').map((x) => [x, paired(half(g('full'), x).filter((t) => t.harness === h), half(g(s), x).filter((t) => t.harness === h), VALUES.right_tool, setupItemRep, c.cl)])),
      full_only_rate: rate(half(g(s), 'full_only').filter((t) => t.harness === h), VALUES.right_tool, c.cl),
    }]));
    return { surface: s, halves, cost_to_other_requests: cost, cost_pass: ni(cost), pass, per_harness: perHarness, full_only_rate: rate(half(g(s), 'full_only'), VALUES.right_tool, c.cl) };
  });
  const passed = surfaces.filter((s) => s.pass).map((s) => s.surface);
  const decision = passed.includes('verbs') ? { pick: 'verbs', text: 'gbrain setup keeps or moves to verbs; ask gbrain to make bare gbrain serve advertise verbs too' }
    : surfaces.some((s) => s.pass === null) ? { pick: null, text: 'no final recommendation: a surface comparison stopped at the interim look' }
    : passed.includes('starter') ? { pick: 'starter', text: 'starter stays the setup default as shipped; report how often the model widened it' }
    : passed.length === 1 && passed[0] === 'full' ? { pick: 'full', text: 'gbrain setup pins full' }
    : !passed.length ? { pick: 'current default', text: 'no surface passes: the current default stays; report gbrain\'s measured cost to other tools' }
    : { pick: null, text: 'surfaces passing (' + passed.join(', ') + ') match no preregistered rule; goes to internal-task' };
  const chosen = surfaces.find((s) => s.surface === decision.pick);
  const overrides = chosen ? harnesses.flatMap((h) => Object.entries(chosen.per_harness[h]!.halves).flatMap(([half, x]) => {
    const pooled = chosen.halves.find((y) => y.half === half)?.contrast?.delta;
    return pooled !== null && pooled !== undefined && x.ci95 && (x.ci95[0] > pooled || x.ci95[1] < pooled) ? [{ harness: h, half, range: x.ci95, pooled }] : [];
  })) : [];
  const verbs = surfaces.find((s) => s.surface === 'verbs');
  const verbsFullOnlyStopped = stoppedAtInterim(c, 'gbrain:verbs:full_only');
  const fixMethod = verbs && !verbsFullOnlyStopped ? {
    pooled: verbs.full_only_rate, pooled_fix: !!verbs.full_only_rate.ci95 && verbs.full_only_rate.ci95[1] < FIX_METHOD_CEILING,
    harnesses: Object.fromEntries(harnesses.map((h) => [h, { rate: verbs.per_harness[h]!.full_only_rate, fix: !!verbs.per_harness[h]!.full_only_rate.ci95 && verbs.per_harness[h]!.full_only_rate.ci95![1] < FIX_METHOD_CEILING }])),
  } : null;
  const fix = !!fixMethod && (fixMethod.pooled_fix || Object.values(fixMethod.harnesses).some((x) => x.fix));
  return { margin, margin_provisional: provisional, setups: [...new Set(g('full').map(setup))].sort(), surfaces, decision, per_harness_overrides: overrides,
    request_tools: { verdict: verbsFullOnlyStopped ? 'no final decision (stopped at interim)' : fix ? 'FIX-METHOD' : 'no FIX-METHOD', rule: 'upper 95% limit of the full-only half under verbs below ' + FIX_METHOD_CEILING * 100 + '%, pooled or on a harness', ...fixMethod } };
}

export function places(c: Ctx, map: Record<string, Record<string, Record<string, string>>>) {
  const out: Array<{ harness: string; rung: number; place: string; right_tool: ReturnType<typeof rate> }> = [];
  for (const [h, rungs] of Object.entries(map)) for (const [r, tools] of Object.entries(rungs)) {
    const rows = where(c, { harness: h, arm: 'native', set: 'R', rung: Number(r) }).filter((t) => c.req.kind(t.request) === 'tool');
    const by = new Map<string, Trial[]>();
    for (const t of rows) { const p = tools[c.cl(t)] ?? 'unknown'; (by.get(p) ?? by.set(p, []).get(p)!).push(t); }
    for (const [p, ts] of by) out.push({ harness: h, rung: Number(r), place: p, right_tool: rate(ts, VALUES.right_tool, c.cl) });
  }
  return out;
}

export function analyze(o: { trials: Trial[]; items: Item[]; places?: Record<string, Record<string, Record<string, string>>> | null; margin?: number | null; interimDecisions?: InterimDecisions }) {
  const c = context(o.trials, o.items, o.interimDecisions);
  const setups = [...new Set(o.trials.map(setup))].sort();
  const arms = [...new Set(o.trials.map((t) => t.arm))].sort();
  return {
    schema: 'he-mcp-at-scale-analysis/1',
    analysis_mode: o.interimDecisions ? 'final' : 'exploratory',
    interim_stops: Object.entries(o.interimDecisions ?? {}).filter(([, decision]) => isStopped(decision)).map(([comparison, decision]) => ({ comparison, decision, note: stopNote(decision) })),
    constants: { SLIP_BAR, HOLD_BOUND, ADVICE_BAR, COST_RATIO, MECH_BAR, MECH_NI_MARGIN, FIX_METHOD_CEILING, TEST_ORDER },
    counts: { trials: o.trials.length, infra: o.trials.filter(isInfra).length, scored: o.trials.filter((t) => !isInfra(t)).length },
    infra: infraTable(c),
    cells: Object.fromEntries(setups.flatMap((s) => arms.map((a) => [s + ' ' + a, Object.fromEntries(RUNGS.filter((r) => c.trials.some((t) => setup(t) === s && t.arm === a && t.rung === r && t.set === 'R')).map((r) => [r, cell(c, s, a, r)]))])).filter(([, v]) => Object.keys(v as object).length)),
    decision2_3: decision2and3(c),
    set_t: setT(c),
    decision4: decision4(c),
    decision1: decision1(c, o.margin ?? gbrainMargin(), o.margin === null || o.margin === undefined),
    places: o.places ? places(c, o.places) : null,
  };
}

const pts = (x: number | null | undefined) => (x === null || x === undefined ? '-' : (100 * x).toFixed(1));
const range = (x: { ci95: [number, number] | null } | null | undefined) => (x?.ci95 ? '[' + pts(x.ci95[0]) + ', ' + pts(x.ci95[1]) + ']' : '-');
export function render(a: ReturnType<typeof analyze>): string {
  const out = ['# MCP at scale: analysis', '', a.counts.trials + ' trials, ' + a.counts.scored + ' scored, ' + a.counts.infra + ' INFRA (counted, never scored). Differences in points with 95% ranges, clustered by core tool.', '',
    a.analysis_mode === 'final' ? 'Final look: registered comparisons that continued use the z boundary ' + FINAL_BOUND + ' in addition to the 95% ranges.' : 'Exploratory analysis without an interim receipt. These are not counted decisions.', ''];
  if (a.interim_stops.length) {
    out.push('## Comparisons stopped at the interim look', '', ...a.interim_stops.map((s) => '- ' + s.comparison + ': ' + s.decision + ' (' + s.note + '). No final decision.'), '');
  }
  out.push('## Decision 2 and 3: slip point, holding, prune advice', '', '| harness | label | 300-30 | 150-30 | 75-30 | result | vs Opus mean at 300 | named | $/request 30, 150, 300 | advice |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const h of a.decision2_3) {
    const step = (r: number) => { const s = h.sequence.find((x) => x.rung === r); return !s ? 'not tested' : s.final_look?.note ? 'stopped at interim' : pts(s.contrast.delta) + ' ' + range(s.contrast) + (s.slips ? ' slips' : ''); };
    out.push('| ' + [h.harness, h.label, step(300), step(150), step(75), h.result, h.vs_opus_mean ? pts(h.vs_opus_mean[300]?.delta) + ' ' + range(h.vs_opus_mean[300]) : '-', h.named === null ? '-' : h.named ? 'yes' : 'no',
      [30, 150, 300].map((r) => h.cost_per_request[r as 30]?.mean?.toFixed(4) ?? '-').join(', '), h.prune_advice.text].join(' | ') + ' |');
  }
  out.push('', '## Set T: task success, 300 against 30, setups pooled', '', 'Difference ' + pts(a.set_t.pooled_300_vs_30.delta) + ' ' + range(a.set_t.pooled_300_vs_30) + ' over ' + a.set_t.pooled_300_vs_30.n_pairs + ' pairs (' + a.set_t.pooled_300_vs_30.infra_excluded + ' with an INFRA side left out).');
  out.push('', '## Decision 4: mechanism', '');
  for (const m of a.decision4) out.push('- ' + m.harness + ', ' + m.send_everything + ' against ' + m.search + ': ' + m.finding + '. ' + m.rungs.map((r) => r.rung + ': ' + (r.final_look?.note ? 'stopped at interim' : pts(r.send_everything_minus_search.delta) + ' ' + range(r.send_everything_minus_search))).join('; '));
  if (!a.decision4.length) out.push('No mechanism arm in these trials.');
  out.push('', '## Decision 1: gbrain surface', '');
  if (!a.decision1) out.push('No gbrain arm in these trials.');
  else {
    out.push('Margin ' + pts(a.decision1.margin) + ' points' + (a.decision1.margin_provisional ? ' (provisional: power.ts at the plan\'s assumptions; the prereg freezes it)' : '') + '. Decision: ' + a.decision1.decision.text + '. request_tools: ' + a.decision1.request_tools.verdict + '.', '',
      '| surface | starter half vs full | full-only half vs full | cost to other requests | passes |', '|---|---|---|---|---|');
    for (const s of a.decision1.surfaces) {
      const hv = (h: string) => { const x = s.halves.find((y) => y.half === h)!; return !x.reachable ? 'cannot reach' : x.final_look?.note ? 'stopped at interim' : x.contrast ? pts(x.contrast.delta) + ' ' + range(x.contrast) : 'reference'; };
      out.push('| ' + [s.surface, hv('starter'), hv('full_only'), pts(s.cost_to_other_requests.delta) + ' ' + range(s.cost_to_other_requests), s.pass === null ? 'not decided' : s.pass ? 'yes' : 'no'].join(' | ') + ' |');
    }
    if (a.decision1.per_harness_overrides.length) out.push('', 'Per-harness overrides flagged: ' + a.decision1.per_harness_overrides.map((x) => x.harness + ' (' + x.half + ')').join(', '));
  }
  out.push('', '## INFRA', '', '| harness | model | arm | set | rung | trials | INFRA |', '|---|---|---|---|---|---|---|', ...a.infra.filter((x) => x.infra).map((x) => '| ' + [x.harness, x.model, x.arm, x.set, x.rung, x.trials, x.infra + ' ' + JSON.stringify(x.codes)].join(' | ') + ' |'));
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const after = argv.includes('--sets') ? argv.slice(argv.indexOf('--sets') + 1) : [];
  const end = after.findIndex((x) => x.startsWith('--'));
  const sets = end < 0 ? after : after.slice(0, end);
  const trials = flag('--trials'), out = flag('--out'), interim = flag('--interim-state');
  if (!trials || !out || !sets.length || Boolean(interim) === argv.includes('--exploratory')) {
    console.error('usage: analyze.ts --trials <trials.jsonl> --sets <set.jsonl>... (--interim-state <state.json> | --exploratory) [--places <json>] [--margins <json>] --out <dir>');
    process.exit(2);
  }
  const margins = flag('--margins') ? JSON.parse(readFileSync(flag('--margins')!, 'utf8')) as { gbrain?: number } : null;
  const rows = loadTrials(trials), items = sets.flatMap((f) => readJsonl<Item>(f));
  const interimDecisions = interim ? loadInterimDecisions(interim, sets, margins?.gbrain ?? gbrainMargin(), rows, items) : undefined;
  const a = analyze({ trials: rows, items, places: flag('--places') ? JSON.parse(readFileSync(flag('--places')!, 'utf8')) : null, margin: margins?.gbrain ?? null, interimDecisions });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'analysis.json'), JSON.stringify(a, null, 1) + '\n');
  writeFileSync(join(out, 'analysis.md'), render(a));
  console.log(render(a));
}
