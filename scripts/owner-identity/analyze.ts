#!/usr/bin/env bun
// Owner-identity analysis (internal-task plan, "Approach" items 4 to 8, "Decision lines" and "Pilot"; docs/owner-identity.md). Reads a
// run's results (trials.jsonl, each trial's owner-identity/verdicts.json and, for family C, owner-identity/capture.json) and any
// row P output (scripts/owner-identity/row-p.ts), and writes one analysis file plus a short Markdown table:
//
//   bun scripts/owner-identity/analyze.ts --results <dir> [--row-p <row-p out dir>]... [--config <file.json>]
//        [--sealed-root <root>] [--margin <a>,<b>,<margin>,<higher|lower>[,<metric>]]... [--out <file.json>]
//
// Output: <results>/comparisons.owner-identity.json (the claim source a sealed export reads) and comparisons.owner-identity.md.
// --row-p defaults to <results>/row-p when it exists (a sealed row P writes there). --config is the analysis config (the
// preregistered smallest detectable differences, the P margin and model; analysisConfigProblems); a sealed run reads it from its
// preregistration's heldout.owner_identity instead. Every number is a token location from the grader; no model judges anything.
//
// What it computes, every rate the pooled ratio of planted facts with a 95% task-clustered interval (runner/stats/clustered-rate.ts:
// percentile bootstrap, or Wilson on the design-effect effective n below 5%):
// - per cell: false-owner and owner recall, trials, tasks, exclusions (model_error, infra_error, exam_fault, no verdicts) and
//   dropped or timed-out extraction jobs from trials.jsonl gbrain.drain;
// - paired by task and fact (runner/stats/paired.ts clusteredPairedDelta, clusters are tasks, a fact's value is its mean over
//   the side's scored trials): G vs N and B vs G per harness (Holm across a model's harnesses) and pooled within a model; P
//   against the model's G cells on family I, with a non-inferiority p against the margin; harness vs harness within a model on
//   family I G-arm false-owner, Holm across the model's pairs, plus the sensitivity line without hook and sweep rows; each with
//   the preregistered smallest detectable difference beside it;
// - hard cases pooled over a model's G cells and in P, flagged at a rate of 10% or more with the interval's lower bound above 5%;
// - per-arm pooled false-owner against the 1% bar; recorder-label false-owner hits on clear cues only and on all;
// - family C per harness and model, never pooled across harnesses, beside its session counts (a worker that never started is
//   not run, not a failure, and its brief facts leave the denominator);
// - the stage-1 look: headroom stop (every N and G cell at most 2% false-owner and at least 95% owner recall) and fault stop
//   (exam faults over 10% of a cell's trials), as computed flags.
// Under a sealed root (manifest.json has a sealed block) it needs --sealed-root, reads gold from the opened root, prints only
// the paths it wrote, and logs everything else to <results>/analyze-owner-identity.sealed.log (docs/sealed-custody.md).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, type PairedItem } from '../../runner/stats/paired.ts';
import { clusteredRate, type ClusterCount, type ClusteredRate } from '../../runner/stats/clustered-rate.ts';
import type { Gold, Verdicts } from '../../runner/grade/owner-identity.ts';
import type { CaptureCheck } from '../../runner/trial/oi-capture.ts';
import type { CapturePlan } from '../../world/owner-identity/capture.ts';
import type { TrialRecord } from '../../runner/contracts.ts';
import { RunnerError } from '../../runner/errors.ts';
import { analysisConfigProblems, SDD_KINDS, type AnalysisConfig } from './analysis-config.ts';

export { analysisConfigProblems, type AnalysisConfig };
import { sealedGuard } from '../../runner/heldout/guard.ts';
import { readJsonLines, sealedPaths } from '../../runner/heldout/sealed.ts';
import { isSealedCell, taskDirFor, type Manifest } from '../../runner/run.ts';

/** The plan's fixed cuts (internal-task "Decision lines" and "Pilot"). */
export const CUTS = { rare: 0.05, bar: 0.01, hard_case_rate: 0.10, hard_case_lower: 0.05, headroom_false_owner: 0.02, headroom_recall: 0.95, exam_faults: 0.10, recall_window: 0.10, alpha: 0.05 } as const;
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const HOOK_SWEEP = new Set(['hook', 'sweep']);
export const OUT_NAME = 'comparisons.owner-identity.json';

export interface MarginSpec { a: string; b: string; margin: number; direction: 'higher' | 'lower'; endpoint?: string }

export function parseMargin(s: string): MarginSpec {
  const [a, b, m, direction, endpoint] = s.split(',');
  if (!a || !b || !(Number(m) >= 0) || (direction !== 'higher' && direction !== 'lower')) throw new RunnerError('HE-RUN-002', `--margin takes <a>,<b>,<margin >= 0>,<higher|lower>[,<metric>], not "${s}"`);
  return { a, b, margin: Number(m), direction, ...(endpoint ? { endpoint } : {}) };
}

/** One harness trial as the analysis reads it. gold and plan come from the task's directory (plan: family C only). */
export interface OITrial {
  trial_id: string; cell: string; task: string; harness: string; model: string; arm: string | null; termination: string;
  dropped_jobs: number; timed_out_jobs: number;
  verdicts: Verdicts | null; capture: CaptureCheck | null; gold: Gold | null; plan: CapturePlan | null;
}
/** One row P try (scripts/owner-identity/row-p.ts). */
export interface PTry { p_model: string; extraction_model: string; task: string; try: number; verdicts: Verdicts; gold: Gold | null; failed_steps: string[] }

type Metric = 'false_owner' | 'owner_recall';
interface Fact { harness: string; model: string; arm: string; family: string; task: string; trial: string; fact: string; primary: string; hard_case: string; fo: boolean; fo_strict: boolean; recall: boolean; cue: string | null; known_format: boolean }

const scored = (t: OITrial) => !EXCLUDED.has(t.termination) && !!t.verdicts;

function factsOf(v: Verdicts, gold: Gold | null, at: { harness: string; model: string; arm: string; task: string; trial: string }): Fact[] {
  const cue = new Map((gold?.facts ?? []).map((f) => [f.id, (f as { cue?: string }).cue ?? null]));
  const known_format = (gold?.formats ?? []).every((f) => f.format_known_to_gbrain);
  return v.facts.map((f) => ({ ...at, family: v.family, fact: f.id, primary: f.primary, hard_case: f.hard_case, fo: f.false_owner_hit,
    fo_strict: f.false_owner_hit && f.owner_sources.some((s) => !HOOK_SWEEP.has(s)), recall: f.owner_hit, cue: cue.get(f.id) ?? null, known_format }));
}

const hit = (f: Fact, m: Metric, strict = false) => (m === 'false_owner' ? (strict ? f.fo_strict : f.fo) : f.recall);
const inMetric = (f: Fact, m: Metric) => f.primary === m;

export interface Comparison {
  id: string; kind: string; metric: Metric; model: string; harness: string; family: 'I' | 'all'; sources: 'all' | 'no_hook_sweep';
  a: string; b: string; endpoint: Metric; n_pairs: number; n_clusters: number; unpaired: number;
  mean_a: number | null; mean_b: number | null; delta: number | null; ci95: [number, number] | null;
  p: number | null; p_greater: number | null; p_less: number | null; p_method: string | null; design_effect: number | null;
  holm_p: number | null; sdd: number | null; beyond_sdd: boolean | null;
  noninferiority?: { margin: number; direction: 'higher' | 'lower'; p: number | null };
}

/** Tasks with an import in a format gbrain has no importer for (gold.formats format_known_to_gbrain false): their own stratum. */
export interface FormatStratum { n_tasks: number; false_owner: ClusteredRate; owner_recall: ClusteredRate }

export interface Analysis {
  schema_version: 1; kind: 'owner-identity-analysis'; seed: number; draws: number; config: AnalysisConfig | null; cuts: typeof CUTS;
  cells: Array<{ cell: string; harness: string; model: string; arm: string | null; families: string[]; n_trials: number; n_tasks: number; scored: number;
    excluded: Record<string, number>; extraction: { trials_with_dropped: number; dropped_jobs: number; timed_out_jobs: number };
    false_owner: ClusteredRate; owner_recall: ClusteredRate; recorder_label: { clear: ClusteredRate; all: ClusteredRate }; unknown_format: FormatStratum }>;
  row_p: Array<{ p_model: string; extraction_model: string; tries: number; failed_tries: number; n_tasks: number; false_owner: ClusteredRate; owner_recall: ClusteredRate; recorder_label: { clear: ClusteredRate; all: ClusteredRate }; unknown_format: FormatStratum }>;
  comparisons: Comparison[];
  recommendation: Array<{ model: string; harness: string | null; reason: string }>;
  hard_cases: Array<{ scope: 'G' | 'P'; model: string; hard_case: string; false_owner: ClusteredRate; owner_recall: ClusteredRate; flagged: boolean }>;
  arms: Array<{ arm: string; false_owner: ClusteredRate; above_bar: boolean | null; interval_above_bar: boolean | null; unknown_format: FormatStratum }>;
  family_c: Array<{ harness: string; model: string; trials: number; false_owner: ClusteredRate; owner_recall: ClusteredRate;
    sessions: { owner: { planned: number; banked: number }; orchestrator: { planned: number; banked: number }; worker: { planned: number; started: number; not_run: number; banked: number; speaker_ok: number } };
    worker_briefs_as_owner: { env: ClusteredRate; detected: ClusteredRate; not_run_facts: number } }>;
  look: { headroom_stop: boolean; fault_stop: boolean; headroom_cells: string[]; fault_cells: string[]; unseen_cells: string[] };
}

export function analyze(trials: OITrial[], pTries: PTry[], config: AnalysisConfig | null, margins: MarginSpec[] = [], plannedNG: string[] = []): Analysis {
  const seed = config?.seed ?? 7, draws = config?.draws ?? 10000;
  const rate = (items: ClusterCount[]) => clusteredRate(items, { seed, draws, rare: CUTS.rare, ...(config?.design_effect_fallback !== undefined ? { designEffectFallback: config.design_effect_fallback } : {}) });
  const count = (facts: Fact[], keep: (f: Fact) => boolean, isHit: (f: Fact) => boolean): ClusterCount[] => facts.filter(keep).map((f) => ({ cluster: f.task, num: isHit(f) ? 1 : 0, den: 1 }));
  const metricRate = (facts: Fact[], m: Metric) => rate(count(facts, (f) => inMetric(f, m), (f) => hit(f, m)));
  const unknownFormat = (facts: Fact[]): FormatStratum => {
    const fs = facts.filter((f) => !f.known_format);
    return { n_tasks: new Set(fs.map((f) => f.task)).size, false_owner: metricRate(fs, 'false_owner'), owner_recall: metricRate(fs, 'owner_recall') };
  };
  const recorder = (facts: Fact[]) => ({
    clear: rate(count(facts, (f) => f.hard_case === 'recorder_label_absorbs' && f.primary === 'false_owner' && f.cue === 'clear', (f) => f.fo)),
    all: rate(count(facts, (f) => f.hard_case === 'recorder_label_absorbs' && f.primary === 'false_owner', (f) => f.fo)),
  });

  const ok = trials.filter(scored);
  const allFacts = ok.flatMap((t) => factsOf(t.verdicts!, t.gold, { harness: t.harness, model: t.model, arm: t.arm ?? t.verdicts!.arm ?? '?', task: t.task, trial: t.trial_id }));
  // A family C fact a worker that never started was meant to say (no launch row and nothing banked) leaves every rate.
  const notRun = new Set(ok.flatMap((t) => {
    if (!t.capture) return [];
    const launched = new Set((t.capture.launch?.workers ?? []).map((w) => w.worker));
    const workerOf = new Map((t.plan?.workers ?? []).map((w) => [w.session, w.n]));
    const idle = new Set((t.capture.sessions ?? []).filter((c) => c.kind === 'worker' && !c.sessions.length && !launched.has(workerOf.get(c.n) ?? -1)).map((c) => c.n));
    return (t.gold?.facts ?? []).filter((f) => 'session' in f.where && idle.has(f.where.session)).map((f) => `${t.trial_id}\n${f.id}`);
  }));
  const facts = allFacts.filter((f) => !notRun.has(`${f.trial}\n${f.fact}`));
  const pFacts = pTries.filter((p) => !p.failed_steps.length).flatMap((p) => factsOf(p.verdicts, p.gold, { harness: 'row-p', model: p.p_model, arm: 'P', task: p.task, trial: `row-p/${p.p_model}/${p.task}/try-${p.try}` }));
  const byTrial = new Map<string, Fact[]>(), byTrialAll = new Map<string, Fact[]>();
  for (const f of facts) byTrial.set(f.trial, [...(byTrial.get(f.trial) ?? []), f]);
  for (const f of allFacts) byTrialAll.set(f.trial, [...(byTrialAll.get(f.trial) ?? []), f]);

  const cellIds = [...new Set(trials.map((t) => t.cell))];
  const cells = cellIds.map((cell) => {
    const ts = trials.filter((t) => t.cell === cell), first = ts[0]!;
    const fs = ts.filter(scored).flatMap((t) => byTrial.get(t.trial_id) ?? []);
    const excluded: Record<string, number> = {};
    for (const t of ts) { const why = EXCLUDED.has(t.termination) ? t.termination : !t.verdicts ? 'no_verdicts' : null; if (why) excluded[why] = (excluded[why] ?? 0) + 1; }
    return { cell, harness: first.harness, model: first.model, arm: first.arm ?? ts.find((t) => t.verdicts)?.verdicts?.arm ?? null,
      families: [...new Set(ts.map((t) => t.verdicts?.family).filter((x): x is Gold['family'] => !!x))].sort(),
      n_trials: ts.length, n_tasks: new Set(ts.map((t) => t.task)).size, scored: ts.filter(scored).length, excluded,
      extraction: { trials_with_dropped: ts.filter((t) => t.dropped_jobs + t.timed_out_jobs > 0).length, dropped_jobs: ts.reduce((s, t) => s + t.dropped_jobs, 0), timed_out_jobs: ts.reduce((s, t) => s + t.timed_out_jobs, 0) },
      false_owner: metricRate(fs, 'false_owner'), owner_recall: metricRate(fs, 'owner_recall'), recorder_label: recorder(fs), unknown_format: unknownFormat(fs) };
  });
  const pModels = [...new Set(pTries.map((p) => p.p_model))];
  const row_p = pModels.map((m) => {
    const ps = pTries.filter((p) => p.p_model === m), fs = pFacts.filter((f) => f.model === m);
    return { p_model: m, extraction_model: ps[0]!.extraction_model, tries: ps.length, failed_tries: ps.filter((p) => p.failed_steps.length).length, n_tasks: new Set(ps.map((p) => p.task)).size, false_owner: metricRate(fs, 'false_owner'), owner_recall: metricRate(fs, 'owner_recall'), recorder_label: recorder(fs), unknown_format: unknownFormat(fs) };
  });

  const comparisons: Comparison[] = [];
  const compare = (o: { kind: string; sddKind: (typeof SDD_KINDS)[number]; metric: Metric; model: string; harness: string; family: 'I' | 'all'; sources?: 'all' | 'no_hook_sweep'; a: string; b: string; A: Fact[]; B: Fact[]; key: (f: Fact) => string }) => {
    const sources = o.sources ?? 'all';
    const values = (fs: Fact[]) => {
      const m = new Map<string, { task: string; sum: number; n: number }>();
      for (const f of fs) if (inMetric(f, o.metric) && (o.family === 'all' || f.family === o.family)) {
        const k = o.key(f), e = m.get(k) ?? { task: f.task, sum: 0, n: 0 };
        e.sum += hit(f, o.metric, sources === 'no_hook_sweep') ? 1 : 0; e.n++; m.set(k, e);
      }
      return m;
    };
    const va = values(o.A), vb = values(o.B);
    const pairs: PairedItem[] = [...va.entries()].filter(([k]) => vb.has(k)).map(([k, x]) => ({ id: k, cluster: x.task, a: x.sum / x.n, b: vb.get(k)!.sum / vb.get(k)!.n }));
    const unpaired = [...va.keys()].filter((k) => !vb.has(k)).length + [...vb.keys()].filter((k) => !va.has(k)).length;
    const d = pairs.length ? clusteredPairedDelta(pairs, { seed, draws }) : null;
    const sdd = config?.sdd?.[o.sddKind] ?? null;
    const spec = margins.find((x) => x.a === o.a && x.b === o.b && (!x.endpoint || x.endpoint === o.metric))
      ?? (o.kind === 'p_vs_g' && config?.p_vs_g ? { margin: config.p_vs_g.margin, direction: (o.metric === 'false_owner' ? 'lower' : 'higher') as 'lower' | 'higher' } : undefined);
    const id = [o.kind, o.metric, o.model, o.harness, ...(o.family === 'I' ? ['I'] : []), ...(sources === 'all' ? [] : [sources])].join('/');
    comparisons.push({ id, kind: o.kind, metric: o.metric, model: o.model, harness: o.harness, family: o.family, sources, a: o.a, b: o.b, endpoint: o.metric,
      n_pairs: pairs.length, n_clusters: d?.n_clusters ?? 0, unpaired, mean_a: d?.mean_a ?? null, mean_b: d?.mean_b ?? null, delta: d?.delta ?? null, ci95: d?.ci95 ?? null,
      p: d?.p_two_sided ?? null, p_greater: d?.p_greater ?? null, p_less: d?.p_less ?? null, p_method: d?.p_method ?? null, design_effect: d?.design_effect ?? null,
      holm_p: null, sdd, beyond_sdd: sdd === null || !d ? null : Math.abs(d.delta) > sdd,
      ...(spec ? { noninferiority: { margin: spec.margin, direction: spec.direction, p: d ? nonInferiorityP(d, spec.margin, spec.direction) : null } } : {}) });
  };
  const holm = (filter: (c: Comparison) => boolean) => {
    const group = comparisons.filter((c) => filter(c) && c.p !== null);
    holmAdjusted(group.map((c) => c.p!)).forEach((x, i) => { group[i]!.holm_p = x; });
  };

  const models = [...new Set(facts.map((f) => f.model))].sort();
  const harnessesOf = (model: string) => [...new Set(facts.filter((f) => f.model === model).map((f) => f.harness))].sort();
  // Family C is reported per harness and model only (family_c below), never pooled: the capture cells carry the owner card and
  // grade as G, so every pooled G figure, hard case, arm rate and comparison reads the facts of families I and L.
  const pooled = facts.filter((f) => f.family !== 'C');
  const sel = (model: string, arm: string, harness?: string) => pooled.filter((f) => f.model === model && f.arm === arm && (!harness || f.harness === harness));
  const perTask = (f: Fact) => `${f.task}/${f.fact}`;
  const perHarnessTask = (f: Fact) => `${f.harness}/${f.task}/${f.fact}`;
  for (const model of models) {
    for (const metric of ['false_owner', 'owner_recall'] as const) {
      for (const [kind, lo, hi] of [['g_vs_n', 'N', 'G'], ['b_vs_g', 'G', 'B']] as const) {
        const sddKind = `${kind}_harness` as const;
        for (const h of harnessesOf(model)) if (sel(model, lo, h).length && sel(model, hi, h).length)
          compare({ kind, sddKind, metric, model, harness: h, family: 'all', a: `${lo}/${h}/${model}`, b: `${hi}/${h}/${model}`, A: sel(model, lo, h), B: sel(model, hi, h), key: perTask });
        holm((c) => c.kind === kind && c.metric === metric && c.model === model && c.harness !== 'pooled');
        const both = harnessesOf(model).filter((h) => sel(model, lo, h).length && sel(model, hi, h).length);
        if (both.length) compare({ kind, sddKind: `${kind}_pooled`, metric, model, harness: 'pooled', family: 'all', a: `${lo}/pooled/${model}`, b: `${hi}/pooled/${model}`,
          A: sel(model, lo).filter((f) => both.includes(f.harness)), B: sel(model, hi).filter((f) => both.includes(f.harness)), key: perHarnessTask });
      }
    }
    const hs = harnessesOf(model).filter((h) => sel(model, 'G', h).some((f) => f.family === 'I'));
    for (const sources of ['all', 'no_hook_sweep'] as const) {
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++)
        compare({ kind: 'harness_vs_harness', sddKind: 'harness_vs_harness', metric: 'false_owner', model, harness: `${hs[i]} vs ${hs[j]}`, family: 'I', sources,
          a: `G/${hs[i]}/${model}`, b: `G/${hs[j]}/${model}`, A: sel(model, 'G', hs[i]), B: sel(model, 'G', hs[j]), key: perTask });
      holm((c) => c.kind === 'harness_vs_harness' && c.model === model && c.sources === sources);
    }
  }
  const pv = config?.p_vs_g;
  if (pv) {
    const pm = pv.p_model ?? 'opus';
    // Tasks with an import gbrain has no importer for are their own stratum and are left out of P against G.
    const P = pFacts.filter((f) => f.model === pm && f.known_format), G = pooled.filter((f) => f.model === pv.model && f.arm === 'G' && f.known_format);
    if (P.length && G.length) for (const metric of ['false_owner', 'owner_recall'] as const)
      compare({ kind: 'p_vs_g', sddKind: 'p_vs_g', metric, model: pv.model, harness: 'pooled', family: 'I', a: `G/pooled/${pv.model}`, b: `P/${pm}`, A: G, B: P, key: perTask });
  }

  const recommendation = models.map((model) => {
    const hvh = comparisons.filter((c) => c.kind === 'harness_vs_harness' && c.model === model && c.sources === 'all');
    const hs = [...new Set(hvh.flatMap((c) => c.harness.split(' vs ')))];
    if (hs.length < 2) return { model, harness: null, reason: 'fewer than two harnesses with family I G-arm trials' };
    const recall = new Map(hs.map((h) => [h, rate(count(sel(model, 'G', h).filter((f) => f.family === 'I'), (f) => inMetric(f, 'owner_recall'), (f) => f.recall)).rate]));
    const best = Math.max(...[...recall.values()].map((x) => x ?? 0));
    const beats = (h: string) => hvh.every((c) => {
      const [ha, hb] = c.harness.split(' vs ');
      if (ha !== h && hb !== h) return true;
      return c.holm_p !== null && c.holm_p <= CUTS.alpha && c.delta !== null && (ha === h ? c.delta > 0 : c.delta < 0);
    });
    const winner = hs.find((h) => beats(h) && (recall.get(h) ?? 0) >= best - CUTS.recall_window);
    return winner ? { model, harness: winner, reason: 'lower family I G-arm false-owner than every other harness on the model after Holm, and owner recall within 10 points of the best' }
      : { model, harness: null, reason: 'no harness is distinguishably better on family I G-arm false-owner after Holm with owner recall within 10 points of the best' };
  });

  const hard_cases: Analysis['hard_cases'] = [];
  const hardCases = (scope: 'G' | 'P', model: string, fs: Fact[]) => {
    for (const hc of [...new Set(fs.map((f) => f.hard_case))].sort()) {
      const own = fs.filter((f) => f.hard_case === hc);
      const fo = metricRate(own, 'false_owner');
      if (!fo.den && !own.some((f) => inMetric(f, 'owner_recall'))) continue;
      hard_cases.push({ scope, model, hard_case: hc, false_owner: fo, owner_recall: metricRate(own, 'owner_recall'), flagged: fo.rate !== null && fo.rate >= CUTS.hard_case_rate && !!fo.ci95 && fo.ci95[0] > CUTS.hard_case_lower });
    }
  };
  for (const model of models) hardCases('G', model, sel(model, 'G'));
  for (const m of pModels) hardCases('P', m, pFacts.filter((f) => f.model === m));

  const arms = [...new Set([...pooled.map((f) => f.arm), ...(pFacts.length ? ['P'] : [])])].sort().map((arm) => {
    const own = [...pooled, ...pFacts].filter((f) => f.arm === arm), fo = metricRate(own, 'false_owner');
    return { arm, false_owner: fo, above_bar: fo.rate === null ? null : fo.rate > CUTS.bar, interval_above_bar: fo.ci95 ? fo.ci95[0] > CUTS.bar : null, unknown_format: unknownFormat(own) };
  });

  const family_c: Analysis['family_c'] = [];
  const cTrials = ok.filter((t) => t.verdicts!.family === 'C');
  for (const key of [...new Set(cTrials.map((t) => `${t.harness}\n${t.model}`))].sort()) {
    const [harness, model] = key.split('\n') as [string, string];
    const ts = cTrials.filter((t) => t.harness === harness && t.model === model);
    const s = { owner: { planned: 0, banked: 0 }, orchestrator: { planned: 0, banked: 0 }, worker: { planned: 0, started: 0, not_run: 0, banked: 0, speaker_ok: 0 } };
    const briefs: Record<'env' | 'detected', ClusterCount[]> = { env: [], detected: [] };
    let notRunFacts = 0;
    for (const t of ts) {
      const launched = new Set((t.capture?.launch?.workers ?? []).map((w) => w.worker));
      const workerOf = new Map((t.plan?.workers ?? []).map((w) => [w.session, w.n]));
      const started = new Set<number>();
      for (const c of t.capture?.sessions ?? []) {
        const banked = c.sessions.length > 0;
        if (c.kind === 'worker') {
          s.worker.planned++;
          const ran = banked || launched.has(workerOf.get(c.n) ?? -1);
          if (ran) { s.worker.started++; started.add(c.n); } else s.worker.not_run++;
          if (banked) s.worker.banked++;
          if (c.pass) s.worker.speaker_ok++;
        } else { s[c.kind].planned++; if (banked) s[c.kind].banked++; }
      }
      const session = new Map((t.gold?.facts ?? []).map((f) => [f.id, 'session' in f.where ? f.where.session : null]));
      const launch = new Map((t.gold?.facts ?? []).map((f) => [f.id, f.launch ?? null]));
      for (const f of byTrialAll.get(t.trial_id) ?? []) {
        const l = launch.get(f.fact);
        if ((l !== 'env' && l !== 'detected') || f.primary !== 'false_owner') continue;
        const sn = session.get(f.fact);
        if (t.capture && sn !== null && sn !== undefined && !started.has(sn)) { notRunFacts++; continue; }
        briefs[l].push({ cluster: f.task, num: f.fo ? 1 : 0, den: 1 });
      }
    }
    const fs = ts.flatMap((t) => byTrial.get(t.trial_id) ?? []);
    family_c.push({ harness, model, trials: ts.length, false_owner: metricRate(fs, 'false_owner'), owner_recall: metricRate(fs, 'owner_recall'), sessions: s,
      worker_briefs_as_owner: { env: rate(briefs.env), detected: rate(briefs.detected), not_run_facts: notRunFacts } });
  }

  const ng = cells.filter((c) => (c.arm === 'N' || c.arm === 'G') && !(c.families.length && c.families.every((f) => f === 'C')));
  const headroom_cells = ng.filter((c) => c.false_owner.rate !== null && c.false_owner.rate <= CUTS.headroom_false_owner && c.owner_recall.rate !== null && c.owner_recall.rate >= CUTS.headroom_recall).map((c) => c.cell);
  const unseen = plannedNG.filter((id) => !ng.some((c) => c.cell === id));
  const fault_cells = cells.filter((c) => c.n_trials && (c.excluded.exam_fault ?? 0) / c.n_trials > CUTS.exam_faults).map((c) => c.cell);
  const look = { headroom_stop: ng.length > 0 && !unseen.length && headroom_cells.length === ng.length, fault_stop: fault_cells.length > 0, headroom_cells, fault_cells, unseen_cells: unseen };

  return { schema_version: 1, kind: 'owner-identity-analysis', seed, draws, config, cuts: CUTS, cells, row_p, comparisons, recommendation, hard_cases, arms, family_c, look };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const ci = (r: { ci95: [number, number] | null }) => (r.ci95 ? `[${pct(r.ci95[0])}, ${pct(r.ci95[1])}]` : '[n/a]');
const pts = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);

/** The short Markdown table: cells, paired comparisons and the flags. No task ids. */
export function markdown(a: Analysis): string {
  const rate = (r: ClusteredRate) => `${pct(r.rate)} ${ci(r)} (${r.num}/${r.den})`;
  const stratum = (u: FormatStratum) => (u.n_tasks ? `${u.n_tasks} task(s): ${rate(u.false_owner)}, ${rate(u.owner_recall)}` : 'none');
  return [
    '| Cell | Arm | Harness | Model | Trials | Tasks | Excluded | Dropped jobs | False-owner [95%] | Owner recall [95%] | Unknown-format tasks: false-owner, recall |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...a.cells.map((c) => `| ${c.cell} | ${c.arm ?? 'n/a'} | ${c.harness} | ${c.model} | ${c.n_trials} | ${c.n_tasks} | ${Object.values(c.excluded).reduce((s, x) => s + x, 0)} | ${c.extraction.dropped_jobs + c.extraction.timed_out_jobs} | ${rate(c.false_owner)} | ${rate(c.owner_recall)} | ${stratum(c.unknown_format)} |`),
    ...a.row_p.map((p) => `| row-p/${p.p_model} | P | none | ${p.extraction_model} | ${p.tries} | ${p.n_tasks} | ${p.failed_tries} | n/a | ${rate(p.false_owner)} | ${rate(p.owner_recall)} | ${stratum(p.unknown_format)} |`),
    '', '| Comparison | B minus A (points) [95%] | p | Holm p | SDD | Pairs | Tasks |', '|---|---|---|---|---|---|---|',
    ...a.comparisons.map((c) => `| ${c.id} | ${pts(c.delta)} ${c.ci95 ? `[${pts(c.ci95[0])}, ${pts(c.ci95[1])}]` : '[n/a]'} | ${c.p?.toFixed(3) ?? 'n/a'} | ${c.holm_p?.toFixed(3) ?? 'n/a'} | ${c.sdd === null ? 'n/a' : pts(c.sdd)} | ${c.n_pairs} | ${c.n_clusters} |`),
    '', `Flagged hard cases: ${a.hard_cases.filter((h) => h.flagged).map((h) => `${h.scope} ${h.model} ${h.hard_case} ${pct(h.false_owner.rate)}`).join('; ') || 'none'}.`,
    `Arms above the 1% false-owner bar: ${a.arms.filter((x) => x.above_bar).map((x) => `${x.arm} ${pct(x.false_owner.rate)}`).join('; ') || 'none'}.`,
    `Unknown-format tasks per arm: ${a.arms.map((x) => `${x.arm} ${stratum(x.unknown_format)}`).join('; ') || 'none'}.`,
    `Stage-1 look: headroom stop ${a.look.headroom_stop ? 'yes' : 'no'}; fault stop ${a.look.fault_stop ? `yes (${a.look.fault_cells.join(', ')})` : 'no'}${a.look.unseen_cells.length ? `; no scored trial yet in ${a.look.unseen_cells.join(', ')}` : ''}.`,
    '',
  ].join('\n');
}

/** The tries of each row P model dir under a row-p --out dir (or a model dir itself). runId: a sealed run's id, which every
 *  summary must be bound to (row-p.ts --sealed-root). */
export function readRowP(dir: string, goldOf: (summary: Record<string, unknown>, task: string) => Gold | null, runId?: string): PTry[] {
  const modelDirs = existsSync(join(dir, 'summary.json')) ? [dir] : readdirSync(dir).map((n) => join(dir, n)).filter((d) => existsSync(join(d, 'summary.json')));
  return modelDirs.flatMap((d) => {
    const s = JSON.parse(readFileSync(join(d, 'summary.json'), 'utf8')) as Record<string, unknown> & { model: string; extraction_model: string; rows: Array<{ task: string; try: number; steps?: Array<{ label: string; exit: number }> }>; sealed?: { run_id?: string } };
    if (runId !== undefined && s.sealed?.run_id !== runId) throw new RunnerError('HE-SEALED-003', `${join(d, 'summary.json')} is ${s.sealed ? `bound to run ${s.sealed.run_id}` : 'not a sealed row P'}, not run ${runId}; a sealed run's analysis reads only row P output made under its own opening (row-p.ts --sealed-root)`);
    return s.rows.map((r) => ({ p_model: s.model, extraction_model: s.extraction_model, task: r.task, try: r.try, verdicts: JSON.parse(readFileSync(join(d, r.task, `try-${r.try}`, 'verdicts.json'), 'utf8')) as Verdicts, gold: goldOf(s, r.task),
      failed_steps: (r.steps ?? []).filter((x) => x.exit !== 0).map((x) => x.label) }));
  });
}

const readIf = <T>(f: string): T | null => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null);

/** The harness trials of a results dir, with each task's gold (and capture plan) from tasksRoot or, for a sealed cell, the root. */
export function readTrials(results: string, manifest: Pick<Manifest, 'cells'> & { sealed?: { set: string } }, tasksRoot: string, sealedRoot?: string): OITrial[] {
  const gold = new Map<string, { gold: Gold | null; plan: CapturePlan | null }>();
  return readJsonLines<TrialRecord>(join(results, 'trials.jsonl')).map((t) => {
    const cell = manifest.cells.find((c) => c.id === t.cell);
    if (!cell) throw new RunnerError('HE-RUN-007', `trial of cell ${t.cell} in ${results}/trials.jsonl: no such cell in manifest.json`);
    const dir = taskDirFor(cell, t.task, isSealedCell(cell, manifest.sealed?.set) && sealedRoot ? join(sealedRoot, 'tasks') : tasksRoot);
    if (!gold.has(dir)) gold.set(dir, { gold: readIf<Gold>(join(dir, 'gold.json')), plan: readIf<CapturePlan>(join(dir, 'capture.json')) });
    const g = gold.get(dir)!;
    const trialDir = join(results, 'trials', ...t.trial_id.split('/').slice(1).map((p) => p.replace(/[^A-Za-z0-9._-]+/g, '-')));
    const drain = t.gbrain?.drain;
    const verdicts = readIf<Verdicts>(join(trialDir, 'owner-identity', 'verdicts.json'));
    const c = cell as typeof cell & { notes?: boolean; owner_card?: string };
    return { trial_id: t.trial_id, cell: t.cell, task: t.task, harness: cell.harness, model: cell.model,
      arm: verdicts?.arm ?? (c.notes ? 'N' : cell.gbrain ? (c.owner_card ? 'G' : 'B') : null), termination: t.termination,
      dropped_jobs: drain ? Object.values(drain.dropped ?? {}).reduce((s, x) => s + x, 0) : 0, timed_out_jobs: drain?.timed_out ?? 0,
      verdicts, capture: readIf<CaptureCheck>(join(trialDir, 'owner-identity', 'capture.json')), gold: g.gold, plan: g.plan };
  }).filter((t) => t.verdicts || t.gold);
}

/** The CLI's work, also called by scripts/sealed/export.ts through the CLI. Returns the paths written. */
export function runAnalyze(o: { results: string; rowP?: string[]; config?: AnalysisConfig | null; margins?: MarginSpec[]; sealedRoot?: string; out?: string; repoRoot?: string }): { json: string; md: string; analysis: Analysis } {
  const results = resolve(o.results), repoRoot = resolve(o.repoRoot ?? process.cwd());
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as Manifest;
  const tasksRoot = join(repoRoot, 'tasks');
  const trials = readTrials(results, manifest, tasksRoot, o.sealedRoot);
  const goldOfP = (s: Record<string, unknown>, task: string): Gold | null => {
    const sealed = s.sealed as { set?: string } | undefined;
    if (sealed?.set && o.sealedRoot) return readIf<Gold>(join(sealedPaths(o.sealedRoot, sealed.set).tasks, task, 'gold.json'));
    return typeof s.set === 'string' ? readIf<Gold>(join(resolve(repoRoot, s.set), 'dev', task, 'gold.json')) : null;
  };
  const rowDirs = o.rowP?.length ? o.rowP : existsSync(join(results, 'row-p')) ? [join(results, 'row-p')] : [];
  const pTries = rowDirs.flatMap((d) => readRowP(resolve(d), goldOfP, manifest.sealed ? manifest.run_id : undefined));
  const captureOnly = (c: { families?: string[] }) => !!c.families?.length && c.families.every((f) => f === 'owner_identity_C');
  const plannedNG = manifest.cells.filter((c) => !captureOnly(c as { families?: string[] }) && ((c as { notes?: boolean }).notes || (c.gbrain && (c as { owner_card?: string }).owner_card))).map((c) => c.id);
  const analysis = analyze(trials, pTries, o.config ?? null, o.margins ?? [], plannedNG);
  const json = resolve(o.out ?? join(results, OUT_NAME)), md = json.replace(/\.json$/, '') + '.md';
  writeFileSync(json, JSON.stringify(analysis, null, 1) + '\n');
  writeFileSync(md, markdown(analysis));
  return { json, md, analysis };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const many = (n: string) => argv.flatMap((x, i) => (x === `--${n}` ? [argv[i + 1] ?? ''] : []));
  const results = flag('results');
  if (!results) { console.error('usage: bun scripts/owner-identity/analyze.ts --results <dir> [--row-p <dir>]... [--config <file.json>] [--sealed-root <root>] [--margin <a>,<b>,<margin>,<higher|lower>[,<metric>]]... [--out <file.json>]'); process.exit(2); }
  try {
    const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as Manifest;
    const sealedRoot = flag('sealed-root');
    if (manifest.sealed && !sealedRoot) throw new RunnerError('HE-SEALED-001', `${results} was planned with a sealed root (set ${manifest.sealed.set}); analyze it inside custody with --sealed-root <the opened root> (docs/sealed-custody.md)`);
    const preregJson = manifest.sealed?.receipt?.prereg_json;
    const g = manifest.sealed && sealedRoot ? sealedGuard({ root: sealedRoot, set: manifest.sealed.set, repoRoot: process.cwd(), preregJson, logFile: join(results, 'analyze-owner-identity.sealed.log'), allow: [], label: 'scripts/owner-identity/analyze.ts' }) : null;
    let config: AnalysisConfig | null = null;
    const configFile = flag('config');
    if (configFile) config = JSON.parse(readFileSync(configFile, 'utf8')) as AnalysisConfig;
    else if (manifest.sealed && preregJson) config = (JSON.parse(readFileSync(join(process.cwd(), preregJson), 'utf8')) as { heldout?: { owner_identity?: AnalysisConfig } }).heldout?.owner_identity ?? null;
    const problems = config ? analysisConfigProblems(config) : [];
    if (problems.length) throw new RunnerError('HE-RUN-002', `the analysis config is not usable: ${problems.join('; ')}`);
    const out = runAnalyze({ results, rowP: many('row-p'), config, margins: many('margin').map(parseMargin), ...(sealedRoot ? { sealedRoot } : {}), ...(flag('out') ? { out: flag('out')! } : {}) });
    const line = `analyze: wrote ${out.json} and ${out.md} (${out.analysis.cells.length} cells, ${out.analysis.row_p.length} row P models, ${out.analysis.comparisons.length} comparisons)`;
    if (g) g.say(line); else { console.log(markdown(out.analysis)); console.log(line); }
  } catch (e) {
    console.error(e instanceof RunnerError ? e.message : `analyze: ${(e as Error).name}`);
    process.exit(e instanceof RunnerError ? e.exit : 2);
  }
}
