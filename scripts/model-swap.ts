// The model-swap contrast: particle-1 against a frontier model inside the same harnesses, on the same tasks. It is a section
// of scripts/matrix-analysis.ts (multi-user runs) and scripts/frontier-harbor/analyze.ts (Harbor runs), turned on by a
// "model_swap" block in either spec; this file holds the rule, the task readers and the Markdown.
//
// The rule. d is frontier pass minus particle-1 pass per task, each side's task mean over its scored attempts, paired within
// one harness: a task drops from a harness's pairs (and is listed) unless both cells scored it at least once. Scoring is the
// calling script's: harness_error is a fail, model_error, infra_error and exam_fault are excluded.
//   - Primary, one call per use case and frontier model: every harness of the use case with a particle-1 cell and a cell of
//     that frontier model. The items are (harness, task) pairs through runner/stats/paired.ts clusteredPairedDelta, weighted so
//     each harness counts the same (an item of harness h carries n / (H * n_h)), and the bootstrap resamples whole clusters, so a
//     task's items in every harness move together. The cluster is the task, or for a multi-user run the account plus attribute
//     a task's spec.json facts name ("cluster": "account-attribute"; a task with no facts falls back to its own id and is
//     listed with a warning); "clusters" in the spec sets any task's cluster by hand and wins over both. With
//     "require_clusters": true there is no fallback: a task in a contrast whose cluster comes from neither the facts index
//     (account-attribute) nor the override refuses the analysis (ModelSwapError), so with "cluster": "task" every such task
//     needs an override.
//   - Secondary, one call per harness: the same items of one harness, unweighted.
// Two tests per call. Non-inferiority at 10 points: nonInferiorityP(d, 0.10, 'lower'), the bootstrap share of draws where
// particle-1 minus frontier is at or below -10 points. Superiority: superiorityP(d, 0, 'higher'), the exact one-sided cluster
// sign-flip p that the frontier model is better. Holm runs over each test separately: across the run's family of primary
// calls (by default every primary call the run makes; a spec may declare the family by call id, "<use case>/<frontier model>",
// and a declared call this run does not make counts as p = 1, which keeps Holm conservative), and for the secondary calls
// within each use case and frontier model. A call with fewer than min_clusters clusters (10 by default, methodology item
// 10) is not tested and counts as p = 1; so does a call whose bootstrap is empty because no paired task differs.
// Labels, after Holm: both tests pass is "frontier better, by less than 10"; non-inferiority alone is "within 10 points", with
// ", no measurable difference" when the 95% interval of d includes 0; superiority alone is "frontier better"; neither is
// "can't tell", reported with the minimum detectable difference at 80% power (powerNote, two-sided alpha).
//
// Every call also reports tasks, (harness, task) pairs and clusters, scored attempts per arm, tasks where particle-1 did worse
// and better, the informative share (pairs where the two arms are not both all-pass or both all-fail), cost per solved task
// per arm (the trial records' usage.usd for every trial of the paired tasks, excluded ones included, over scored passes, not
// the calling script's proxy-log cell totals, with a cluster
// bootstrap) and the particle-1 to frontier ratio (pairedCostRatio over clusters), pass^k per cell (every one of k attempts
// passes, k the cell's most scored attempts on a paired task, tasks with fewer left out and counted), and on a multi-user run
// the leak rate difference, frontier minus particle-1, with its interval. A leak is a failed no_cross_scope_reads, a failed
// reply_not_matches that carries a hidden_fact or whose id starts with no_leak, or a finance_disclosure effect (the
// cross_scope_any and hidden_fact_leak endpoints of scripts/secondary-endpoints.ts).
//
// The low-cost swap (amendment gate G1). An optional second block, "low_cost_swap", in the same specs: model a (DeepSeek-
// V4.1-Flash-1017, labelled a low-cost model, not frontier) against model b (particle-1), two-sided. The model_swap rule and
// its output above do not change (tests/model-swap-low-cost.test.ts holds their hashes from before the block existed).
//   - Items: d is a minus b per (harness, task), weighted and clustered exactly as a model_swap primary call, one call per use
//     case, over the harnesses of that use case with cells of both models, minus exclude_harnesses (DeepSeek's home harness
//     dsh). Each excluded harness's own a minus b difference is reported beside the call with its interval and no test.
//   - Tests per call: superiority of a, superiorityP(d, 0, 'higher'), and of b, superiorityP(d, 0, 'lower'), each the exact
//     one-sided cluster sign-flip p; and equivalence at the margin by two one-sided tests, p = max(nonInferiorityP(d, margin,
//     'higher'), nonInferiorityP(d, margin, 'lower')), so the bootstrap must sit above -margin and below +margin.
//   - Holm: over the superiority family, two calls per declared use case ("<use case>/<label> better", six for the three use
//     cases), and separately over the equivalence family, one per use case ("<use case>/within"). A declared use case the run
//     does not make, a call with fewer than min_clusters clusters and a call whose bootstrap is empty count as p = 1.
//   - Labels after Holm (LOW_COST_CALL_TEMPLATES, fixed before any trial): "<x> better, by less than 10" when x's superiority
//     and the equivalence both pass; "<x> better" for superiority alone; "within 10 points" for equivalence alone, with ", no
//     measurable difference" when the 95% interval of d includes 0; otherwise "can't tell" with the MDD at 80% power. The 10 is
//     the spec's margin in points.
//   - Beside each call, per frontier model the spec lists: the descriptive gap, frontier minus a, pooled and weighted the same
//     way over the harnesses with cells of both (exclude_harnesses left out), with its interval and no test.
//   - Cost, on one basis: each trial's cost is recomputed from its token counts at the peak list rates of the price row
//     cost_basis.rows names in the dated price file cost_basis.prices (for DeepSeek, OpenRouter's DeepSeek endpoint row in
//     runner/pricing/prices-2026-11-08.json with its $0.006 cache-read rate): (usage.input_tokens minus cached_tokens minus
//     cache_write_tokens) at input, cached_tokens at cache read, cache_write_tokens at cache write, output_tokens at output, a
//     null rate billing as input. usage.input_tokens is the whole prompt, cache reads and writes included, as the metering
//     proxy records it. usage.usd is not used. Cost per solved task per model is every trial of the paired tasks (excluded
//     ones included) over scored passes, with a cluster bootstrap, and the b to a ratio is pairedCostRatio over clusters. A
//     trial the basis cannot price names the field it lacks (no usage; a missing token count; cache_write_tokens when the row
//     has a cache-write rate; usage.unpriced, requests charged their reservation with no token count; spend on another model,
//     since usage.by_model has no token counts; a long_prompt tier, which needs per-request prompt sizes), and that model's
//     cost per solved task and the ratio are then withheld, with the fields listed, rather than estimated.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord, TrialUsage } from '../runner/contracts.ts';
import { loadTask } from '../runner/grade/task.ts';
import { clusteredPairedDelta, holmAdjusted, nonInferiorityP, powerNote, superiorityP } from '../runner/stats/paired.ts';
import { costPerSolve, pairedCostRatio, passHatK, taskBootstrapMean } from '../runner/stats/frontier.ts';

export const USE_CASES = ['codegen', 'personal-brain', 'company-brain'] as const;
export type UseCase = (typeof USE_CASES)[number];
/** The non-inferiority margin, in pass-rate units: 10 percentage points. */
export const SWAP_MARGIN = 0.1;
export const SWAP_CALLS = ['within 10 points', 'within 10 points, no measurable difference', 'frontier better, by less than 10', 'frontier better', "can't tell"] as const;
export type SwapCall = (typeof SWAP_CALLS)[number];

export interface ModelSwapSpec {
  /** The model id of the particle-1 cells, as the calling script names models. */
  particle: string;
  frontier: Array<{ id: string; label?: string }>;
  use_cases: Array<{ id: UseCase; cells: string[] }>;
  cluster?: 'task' | 'account-attribute';
  /** The facts index the tasks' spec.json facts refer to, from the repository root (account-attribute only). */
  facts_index?: string;
  /** Task id to cluster id; wins over the computed cluster. */
  clusters?: Record<string, string>;
  /** The primary family, by call id "<use case>/<frontier model id>"; defaults to every primary call the run makes. */
  family?: string[];
  min_clusters?: number;
  /** Refuse, instead of falling back to the task id, when a task in a contrast has no cluster from facts_index or clusters. */
  require_clusters?: boolean;
}

/** A model_swap refusal found in the data (a task with no cluster under require_clusters); callers report it as their SpecError. */
export class ModelSwapError extends Error {}

export interface SwapCell { id: string; harness: string; model: string }
export interface SwapTrial { cell: string; task: string; value: 0 | 1 | null; usd: number; leak?: { cross_scope: boolean; hidden_fact: boolean } }
export interface SwapInput {
  cells: SwapCell[];
  trials: SwapTrial[];
  /** Per task, its account-plus-attribute key, null when the task names no fact (account-attribute clusters only). */
  keys?: Record<string, string | null>;
  /** Whether trials carry leak flags (multi-user runs). */
  leaks: boolean;
}
export interface SwapOptions { seed: number; draws: number; alpha: number }

/** What a multi-user task carries for the contrast: its cluster key and the ids of its hidden-fact leak predicates. */
export interface SwapTaskInfo { key: string | null; leak_predicates: string[] }

const round = (x: number | null | undefined, d = 6) => (x === null || x === undefined ? null : Number(x.toFixed(d)));
const roundCi = (c: [number, number] | null | undefined, d = 6): [number, number] | null => (c ? [round(c[0], d)!, round(c[1], d)!] : null);
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function checkModelSwapSpec(spec: ModelSwapSpec, cells: ReadonlyMap<string, SwapCell | undefined>, where: 'matrix' | 'harbor'): string[] {
  const problems: string[] = [];
  const p = (s: string) => problems.push(`model_swap: ${s}`);
  if (typeof spec.particle !== 'string' || !spec.particle) p('particle is missing');
  if (!Array.isArray(spec.frontier) || !spec.frontier.length) p('frontier is empty');
  const frontier = new Set<string>();
  for (const f of spec.frontier ?? []) {
    if (frontier.has(f.id)) p(`frontier model ${f.id} listed twice`);
    if (f.id === spec.particle) p(`frontier model ${f.id} is the particle model`);
    frontier.add(f.id);
  }
  if (!Array.isArray(spec.use_cases) || !spec.use_cases.length) p('use_cases is empty');
  const seenUse = new Set<string>(), seenCell = new Set<string>();
  for (const u of spec.use_cases ?? []) {
    if (!USE_CASES.includes(u.id)) p(`use case ${u.id} is not one of ${USE_CASES.join(', ')}`);
    if (seenUse.has(u.id)) p(`use case ${u.id} listed twice`);
    seenUse.add(u.id);
    const slots = new Set<string>();
    for (const id of u.cells ?? []) {
      if (seenCell.has(id)) p(`cell ${id} is in more than one use case`);
      seenCell.add(id);
      if (!cells.has(id)) { p(`use case ${u.id} names cell ${id}, which the spec does not define`); continue; }
      const c = cells.get(id);
      if (!c?.harness || !c.model) { p(`cell ${id} has no harness or model in the ${where === 'matrix' ? 'manifest' : 'spec'}`); continue; }
      if (c.model !== spec.particle && !frontier.has(c.model)) p(`cell ${id} runs ${c.model}, neither the particle model nor a frontier model`);
      const slot = `${c.harness} ${c.model}`;
      if (slots.has(slot)) p(`use case ${u.id} has two cells of ${c.harness} on ${c.model}`);
      slots.add(slot);
    }
  }
  clusterProblems(spec, where, p);
  if (spec.family !== undefined && (!Array.isArray(spec.family) || new Set(spec.family).size !== spec.family.length || spec.family.some((id) => typeof id !== 'string' || !id))) p('family must be a list of distinct call ids');
  if (spec.min_clusters !== undefined && (!Number.isSafeInteger(spec.min_clusters) || spec.min_clusters < 2)) p('min_clusters must be an integer of at least 2');
  if (spec.require_clusters !== undefined && typeof spec.require_clusters !== 'boolean') p('require_clusters must be true or false');
  if (problems.length || !spec.family) return problems;
  const planned = spec.use_cases.flatMap((u) => spec.frontier.filter((f) => u.cells.some((a) => cells.get(a)!.model === spec.particle && u.cells.some((b) => cells.get(b)!.model === f.id && cells.get(b)!.harness === cells.get(a)!.harness))).map((f) => `${u.id}/${f.id}`));
  const left = planned.filter((id) => !spec.family!.includes(id));
  if (left.length) p(`the declared family leaves out primary call(s) this run plans: ${left.join(', ')}`);
  return problems;
}

type Clustering = Pick<ModelSwapSpec, 'cluster' | 'facts_index' | 'clusters'>;

function clusterProblems(spec: Clustering, where: 'matrix' | 'harbor', p: (s: string) => void) {
  const cluster = spec.cluster ?? 'task';
  if (cluster !== 'task' && cluster !== 'account-attribute') p('cluster must be task or account-attribute');
  if (cluster === 'account-attribute' && where === 'harbor') p('Harbor tasks name no account, so cluster must be task (set any other grouping in clusters)');
  if (cluster === 'account-attribute' && (typeof spec.facts_index !== 'string' || !spec.facts_index)) p('cluster account-attribute needs facts_index');
  for (const [task, id] of Object.entries(spec.clusters ?? {})) if (typeof id !== 'string' || !id) p(`clusters.${task} must be a non-empty string`);
}

/** Each task's cluster: the hand-set one, else the task (cluster task) or its account-attribute key, falling back to the task
 *  id (listed in fallback) when it has none. fromSource says whether a task's cluster came from the override or the key. */
function assignClusters(tasks: readonly string[], spec: Clustering, keys: Record<string, string | null> | undefined) {
  const mode = spec.cluster ?? 'task';
  const fallback: string[] = [];
  const clusterOf = new Map(tasks.map((task) => {
    const manual = spec.clusters?.[task];
    if (manual) return [task, manual];
    if (mode === 'task') return [task, task];
    const key = keys?.[task] ?? null;
    if (key === null) fallback.push(task);
    return [task, key ?? task];
  }));
  const fromSource = (task: string) => Boolean(spec.clusters?.[task]) || (mode === 'account-attribute' && (keys?.[task] ?? null) !== null);
  return { mode, clusterOf, fallback, fromSource };
}

/** Holm across a family given by id; a member with no p-value here (a call this run does not make) counts as p = 1. */
export function holmByIds(family: readonly string[], p: ReadonlyMap<string, number>): Map<string, number> {
  const adjusted = holmAdjusted(family.map((id) => p.get(id) ?? 1));
  return new Map(family.map((id, i) => [id, adjusted[i]!]));
}

/** The call for one comparison from its Holm-adjusted p-values; a p at or below alpha passes. */
export function swapCall(x: { tested: boolean; holm_p_noninferiority: number; holm_p_superiority: number; ci95: [number, number] | null }, alpha: number): SwapCall {
  const ni = x.tested && x.holm_p_noninferiority <= alpha;
  const sup = x.tested && x.holm_p_superiority <= alpha;
  if (ni && sup) return 'frontier better, by less than 10';
  if (ni) return x.ci95 && x.ci95[0] <= 0 && x.ci95[1] >= 0 ? 'within 10 points, no measurable difference' : 'within 10 points';
  if (sup) return 'frontier better';
  return "can't tell";
}

interface Side { scored: number[]; usd: number; leaks: { any: number; cross_scope: number; hidden_fact: number } }
interface Item { harness: string; task: string; cluster: string; p: Side; f: Side; pCell: string; fCell: string }

const meanOf = (s: Side) => sum(s.scored) / s.scored.length;

export function analyzeModelSwap(input: SwapInput, spec: ModelSwapSpec, opts: SwapOptions) {
  const minClusters = spec.min_clusters ?? 10;
  const clusterMode = spec.cluster ?? 'task';
  const cellById = new Map(input.cells.map((c) => [c.id, c]));
  const sides = new Map<string, Map<string, Side>>();
  for (const t of input.trials) {
    const m = sides.get(t.cell) ?? new Map<string, Side>();
    const s = m.get(t.task) ?? { scored: [], usd: 0, leaks: { any: 0, cross_scope: 0, hidden_fact: 0 } };
    s.usd += t.usd;
    if (t.value !== null) {
      s.scored.push(t.value);
      if (t.leak) {
        if (t.leak.cross_scope || t.leak.hidden_fact) s.leaks.any++;
        if (t.leak.cross_scope) s.leaks.cross_scope++;
        if (t.leak.hidden_fact) s.leaks.hidden_fact++;
      }
    }
    m.set(t.task, s);
    sides.set(t.cell, m);
  }
  const allTasks = [...new Set(input.trials.map((t) => t.task))].sort(byKey);
  const { clusterOf, fallback, fromSource } = assignClusters(allTasks, spec, input.keys);

  const callStats = (items: Item[]) => {
    const harnesses = [...new Set(items.map((i) => i.harness))].sort(byKey);
    const perHarness = new Map(harnesses.map((h) => [h, items.filter((i) => i.harness === h).length]));
    const weight = (i: Item) => items.length / (harnesses.length * perHarness.get(i.harness)!);
    const delta = (value: (s: Side) => number) => clusteredPairedDelta(items.map((i) => ({ id: `${i.harness}/${i.task}`, cluster: i.cluster, a: value(i.p) * weight(i), b: value(i.f) * weight(i) })), opts);
    const stats = delta(meanOf);
    const tested = stats.n_clusters >= minClusters;
    const ni = nonInferiorityP(stats, SWAP_MARGIN, 'lower');
    const sup = superiorityP(stats, 0, 'higher');
    const mdd = powerNote(stats, { alpha: opts.alpha, power: 0.8 });
    const extreme = (i: Item) => [...i.p.scored, ...i.f.scored].every((v) => v === 1) || [...i.p.scored, ...i.f.scored].every((v) => v === 0);
    const byCluster = new Map<string, { usd_p: number; solves_p: number; usd_f: number; solves_f: number }>();
    for (const i of items) {
      const c = byCluster.get(i.cluster) ?? { usd_p: 0, solves_p: 0, usd_f: 0, solves_f: 0 };
      c.usd_p += i.p.usd; c.solves_p += sum(i.p.scored); c.usd_f += i.f.usd; c.solves_f += sum(i.f.scored);
      byCluster.set(i.cluster, c);
    }
    const clusters = [...byCluster.entries()].sort(([x], [y]) => byKey(x, y)).map(([, c]) => c);
    const cost = (c: ReturnType<typeof costPerSolve>) => ({ usd_total: round(c.usd)!, solves: c.solves, usd_per_solve: round(c.usd_per_solve), ci95: roundCi(c.ci95), note: c.note });
    const ratio = pairedCostRatio(clusters.map((c, j) => ({ task: String(j), usd_a: c.usd_f, solves_a: c.solves_f, usd_b: c.usd_p, solves_b: c.solves_p })), opts);
    const passK = [...new Set(items.flatMap((i) => [i.pCell, i.fCell]))].map((cell) => {
      const rows = items.filter((i) => i.pCell === cell || i.fCell === cell).map((i) => (i.pCell === cell ? i.p : i.f));
      const k = Math.max(...rows.map((s) => s.scored.length));
      const values = rows.map((s) => passHatK(s.scored.length, sum(s.scored), k)).filter((v): v is number => v !== null);
      const m = taskBootstrapMean(values, opts);
      const c = cellById.get(cell)!;
      return { cell, harness: c.harness, model: c.model, k, estimate: round(m?.estimate), ci95: roundCi(m?.ci95), tasks: values.length, tasks_with_fewer_than_k: rows.length - values.length };
    });
    const leakStats = input.leaks ? delta((s) => s.leaks.any / s.scored.length) : null;
    const leakCount = (side: 'p' | 'f', k: keyof Side['leaks']) => sum(items.map((i) => i[side].leaks[k]));
    const informative = items.filter((i) => !extreme(i)).length;
    return {
      harnesses, tasks: new Set(items.map((i) => i.task)).size, pairs: items.length, clusters: stats.n_clusters,
      attempts: { particle: sum(items.map((i) => i.p.scored.length)), frontier: sum(items.map((i) => i.f.scored.length)) },
      mean_particle: round(stats.mean_a)!, mean_frontier: round(stats.mean_b)!, d: round(stats.delta)!, ci95: roundCi(stats.ci95), p_method: stats.p_method,
      p_noninferiority: round(ni, 8), p_superiority: round(sup, 8), tested,
      untested_reason: !tested ? `${stats.n_clusters} cluster(s), fewer than ${minClusters}: estimate and interval only, counted as p = 1 in the family` : ni === null ? 'no paired task differs, so the bootstrap is empty: counted as p = 1' : null,
      mdd_80: round(mdd.mde), power_note: mdd.note,
      particle_worse: items.filter((i) => meanOf(i.f) > meanOf(i.p)).length,
      particle_better: items.filter((i) => meanOf(i.p) > meanOf(i.f)).length,
      tied: items.filter((i) => meanOf(i.p) === meanOf(i.f)).length,
      informative: { pairs: informative, share: round(informative / items.length, 4)! },
      cost: {
        particle: cost(costPerSolve(clusters.map((c) => ({ usd: c.usd_p, solves: c.solves_p })), opts)),
        frontier: cost(costPerSolve(clusters.map((c) => ({ usd: c.usd_f, solves: c.solves_f })), opts)),
        particle_to_frontier: { ratio: round(ratio.ratio, 4), ci95: roundCi(ratio.ci95, 4), undefined_draws: ratio.undefined_draws, note: ratio.note },
      },
      pass_hat_k: passK,
      leaks: leakStats ? {
        rate_particle: round(leakStats.mean_a)!, rate_frontier: round(leakStats.mean_b)!, difference: round(leakStats.delta)!, ci95: roundCi(leakStats.ci95),
        trials: {
          particle: { any: leakCount('p', 'any'), cross_scope: leakCount('p', 'cross_scope'), hidden_fact: leakCount('p', 'hidden_fact') },
          frontier: { any: leakCount('f', 'any'), cross_scope: leakCount('f', 'cross_scope'), hidden_fact: leakCount('f', 'hidden_fact') },
        },
      } : null,
      testP: { ni: tested && ni !== null ? ni : 1, sup: tested && sup !== null ? sup : 1 },
    };
  };

  const notPaired: Array<{ use_case: UseCase; frontier: string; reason: string }> = [];
  const raw: Array<{ id: string; family: 'primary' | 'secondary'; use_case: UseCase; frontier: string; harness: string | null; tasks_in: string[]; dropped: Array<{ harness: string; task: string; reason: string }>; s: ReturnType<typeof callStats> }> = [];
  for (const u of spec.use_cases) {
    const cells = u.cells.map((id) => cellById.get(id)!);
    for (const f of spec.frontier) {
      const harnesses = [...new Set(cells.map((c) => c.harness))].filter((h) => cells.some((c) => c.harness === h && c.model === spec.particle) && cells.some((c) => c.harness === h && c.model === f.id)).sort(byKey);
      if (!harnesses.length) { notPaired.push({ use_case: u.id, frontier: f.id, reason: `no harness of ${u.id} has both a ${spec.particle} cell and a ${f.id} cell` }); continue; }
      const byHarness = harnesses.map((h) => {
        const pc = cells.find((c) => c.harness === h && c.model === spec.particle)!, fc = cells.find((c) => c.harness === h && c.model === f.id)!;
        const P = sides.get(pc.id) ?? new Map<string, Side>(), F = sides.get(fc.id) ?? new Map<string, Side>();
        const items: Item[] = [], dropped: Array<{ harness: string; task: string; reason: string }> = [];
        for (const task of [...new Set([...P.keys(), ...F.keys()])].sort(byKey)) {
          const p = P.get(task), q = F.get(task);
          if (p?.scored.length && q?.scored.length) { items.push({ harness: h, task, cluster: clusterOf.get(task)!, p, f: q, pCell: pc.id, fCell: fc.id }); continue; }
          dropped.push({ harness: h, task, reason: !p?.scored.length && !q?.scored.length ? 'no scored attempt in either cell' : !p?.scored.length ? `no scored attempt in ${pc.id}` : `no scored attempt in ${fc.id}` });
        }
        return { h, items, dropped };
      });
      const pooled = byHarness.flatMap((x) => x.items);
      if (!pooled.length) { notPaired.push({ use_case: u.id, frontier: f.id, reason: 'no task was scored in both cells of any harness' }); continue; }
      raw.push({ id: `${u.id}/${f.id}`, family: 'primary', use_case: u.id, frontier: f.id, harness: null, tasks_in: pooled.map((i) => i.task), dropped: byHarness.flatMap((x) => x.dropped), s: callStats(pooled) });
      for (const x of byHarness) if (x.items.length) raw.push({ id: `${u.id}/${f.id}/${x.h}`, family: 'secondary', use_case: u.id, frontier: f.id, harness: x.h, tasks_in: x.items.map((i) => i.task), dropped: x.dropped, s: callStats(x.items) });
    }
  }

  const unclustered = [...new Set(raw.filter((r) => r.family === 'primary').flatMap((r) => r.tasks_in))].filter((task) => !fromSource(task)).sort(byKey);
  if (spec.require_clusters && unclustered.length) throw new ModelSwapError(`model_swap: require_clusters is set and ${unclustered.length} task(s) in a contrast have no cluster from ${clusterMode === 'account-attribute' ? 'facts_index or ' : ''}clusters: ${unclustered.slice(0, 10).join(', ')}${unclustered.length > 10 ? ', ...' : ''}`);
  const prim = raw.filter((r) => r.family === 'primary');
  const primaryIds = prim.map((r) => r.id);
  const family = spec.family ?? primaryIds;
  const pOf = (rows: typeof raw, k: 'ni' | 'sup') => new Map(rows.map((r) => [r.id, r.s.testP[k]]));
  const holm = new Map<string, { ni: number; sup: number }>();
  const ni = holmByIds(family, pOf(prim, 'ni')), sup = holmByIds(family, pOf(prim, 'sup'));
  for (const r of prim) {
    holm.set(r.id, { ni: ni.get(r.id)!, sup: sup.get(r.id)! });
    const group = raw.filter((x) => x.family === 'secondary' && x.use_case === r.use_case && x.frontier === r.frontier);
    const ids = group.map((x) => x.id);
    const gni = holmByIds(ids, pOf(group, 'ni')), gsup = holmByIds(ids, pOf(group, 'sup'));
    for (const id of ids) holm.set(id, { ni: gni.get(id)!, sup: gsup.get(id)! });
  }
  const calls = raw.map((r) => {
    const { testP: _unused, ...s } = r.s;
    const h = holm.get(r.id)!;
    return {
      id: r.id, family: r.family, use_case: r.use_case, frontier: r.frontier, frontier_label: spec.frontier.find((f) => f.id === r.frontier)!.label ?? r.frontier, harness: r.harness, ...s,
      holm_p_noninferiority: round(h.ni, 8)!, holm_p_superiority: round(h.sup, 8)!,
      call: swapCall({ tested: s.tested, holm_p_noninferiority: h.ni, holm_p_superiority: h.sup, ci95: s.ci95 }, opts.alpha),
      dropped: r.dropped,
    };
  });
  return {
    method: {
      rule: 'd = frontier minus particle-1 task mean per (harness, task) pair; primary calls pool the harnesses that ran both models with equal weight per harness, secondary calls take one harness; cluster bootstrap and exact cluster sign-flip from runner/stats/paired.ts',
      particle: spec.particle, frontier: spec.frontier.map((f) => f.id), margin: SWAP_MARGIN, alpha: opts.alpha, seed: opts.seed, draws: opts.draws, min_clusters: minClusters, power: 0.8,
      cluster: {
        source: clusterMode, required: spec.require_clusters === true, facts_index: clusterMode === 'account-attribute' ? spec.facts_index! : null, set_by_hand: Object.keys(spec.clusters ?? {}).filter((t) => allTasks.includes(t)).length,
        fallback_tasks: fallback, warning: fallback.length ? `${fallback.length} task(s) name no fact in spec.json, so each is its own cluster: ${fallback.join(', ')}` : null,
      },
      cost: "each arm's trial records' usage.usd over every trial of the paired tasks (excluded ones included), over scored passes; the trial-record figure, not the proxy-log cell totals",
      leaks: input.leaks ? 'a failed no_cross_scope_reads, a failed hidden-fact or no_leak reply_not_matches, or a finance_disclosure effect, over scored trials' : null,
    },
    family: { ids: family, absent: family.filter((id) => !primaryIds.includes(id)), note: 'Holm per test across these primary calls; an absent call counts as p = 1' },
    primary: calls.filter((c) => c.family === 'primary'),
    secondary: calls.filter((c) => c.family === 'secondary'),
    not_paired: notPaired,
  };
}

export type ModelSwapAnalysis = ReturnType<typeof analyzeModelSwap>;

/** The cluster key of one multi-user task: the account (entity) and attribute of each answer fact its spec.json names, sorted
 *  and joined, or of every named fact when none is an answer; null when spec.json is missing or names no fact the index holds. */
export function accountAttributeKey(taskDir: string, facts: ReadonlyMap<string, { entity: string; attribute: string; role?: string }>): string | null {
  const file = join(taskDir, 'spec.json');
  if (!existsSync(file)) return null;
  const named = ((JSON.parse(readFileSync(file, 'utf8')) as { facts?: string[] }).facts ?? []).flatMap((id) => facts.get(id) ?? []);
  const answers = named.filter((f) => f.role === 'answer');
  const keys = [...new Set((answers.length ? answers : named).map((f) => `${f.entity}/${f.attribute}`))].sort(byKey);
  return keys.length ? keys.join(' + ') : null;
}

/** Task info for the multi-user contrast, read from each task's directory (relative to the repository root). */
export function loadSwapTaskInfo(root: string, taskDirs: ReadonlyMap<string, string>, factsIndex: string | null): Record<string, SwapTaskInfo> {
  const facts = factsIndex ? new Map((JSON.parse(readFileSync(join(root, factsIndex), 'utf8')) as { facts: Array<{ id: string; entity: string; attribute: string; role?: string }> }).facts.map((f) => [f.id, f])) : null;
  return Object.fromEntries([...taskDirs].sort(([x], [y]) => byKey(x, y)).map(([task, dir]) => {
    const leak = loadTask(join(root, dir)).predicate.filter((p) => p.kind === 'reply_not_matches' && (('hidden_fact' in p && p.hidden_fact) || p.id.startsWith('no_leak'))).map((p) => p.id);
    return [task, { key: facts ? accountAttributeKey(join(root, dir), facts) : null, leak_predicates: leak }];
  }));
}

/** Leak flags of one multi-user trial from its predicate results and its task's leak predicates. */
export function trialLeaks(t: TrialRecord, leakPredicates: readonly string[]): { cross_scope: boolean; hidden_fact: boolean } {
  const failed = (id: string) => (t.predicates ?? []).some((p) => p.id === id && !p.passed);
  return { cross_scope: failed('no_cross_scope_reads'), hidden_fact: leakPredicates.some(failed) || (t.effects ?? []).includes('finance_disclosure') };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const pts = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`);
const ciPts = (c: [number, number] | null | undefined) => (c ? `[${pts(c[0])}, ${pts(c[1])}]` : '[no interval]');
const ciPct = (c: [number, number] | null | undefined) => (c ? `[${pct(c[0])}, ${pct(c[1])}]` : '[no interval]');
const usd = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(4)}`);
const ciUsd = (c: [number, number] | null | undefined) => (c ? `[${usd(c[0])}, ${usd(c[1])}]` : '[no interval]');
const times = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${x.toFixed(2)}x`);
const ciTimes = (c: [number, number] | null | undefined) => (c ? `[${times(c[0])}, ${times(c[1])}]` : '[no interval]');
const pv = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(4));

export function renderModelSwap(a: ModelSwapAnalysis): string[] {
  const m = a.method;
  const out: string[] = ['', `## Model swap: ${m.particle} against ${m.frontier.join(', ')} in the same harnesses`, ''];
  out.push(`d is frontier minus ${m.particle} pass per task, paired within a harness; a primary call pools the harnesses that ran both models, each harness weighted equally. Non-inferiority: ${m.particle} minus frontier above -${(100 * m.margin).toFixed(0)} points. Superiority: frontier minus ${m.particle} above 0. Holm per test across the primary family (${a.family.ids.join(', ')}${a.family.absent.length ? `; not in this run, counted as p = 1: ${a.family.absent.join(', ')}` : ''}), and across harnesses within each use case and frontier model for the secondary calls. Clusters: ${m.cluster.source}${m.cluster.set_by_hand ? `, ${m.cluster.set_by_hand} task(s) set by hand` : ''}. Alpha ${m.alpha}, seed ${m.seed}, ${m.draws} draws, at least ${m.min_clusters} clusters to test.`);
  if (m.cluster.warning) out.push('', `**Cluster warning:** ${m.cluster.warning}.`);
  for (const [title, rows] of [['Primary calls (pooled across harnesses)', a.primary], ['Secondary calls (one harness)', a.secondary]] as const) {
    if (!rows.length) continue;
    out.push('', `### ${title}`, '', `| Call | Harnesses | Tasks / pairs / clusters | Attempts (${m.particle} / frontier) | ${m.particle} / frontier task mean | d [95% CI] | ${m.particle} worse / better / tied | Informative pairs | Non-inferiority p (Holm) | Superiority p (Holm) | Label |`, '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of rows) out.push(`| ${c.id} | ${c.harnesses.join(', ')} | ${c.tasks} / ${c.pairs} / ${c.clusters} | ${c.attempts.particle} / ${c.attempts.frontier} | ${pct(c.mean_particle)} / ${pct(c.mean_frontier)} | ${pts(c.d)} ${ciPts(c.ci95)} | ${c.particle_worse} / ${c.particle_better} / ${c.tied} | ${c.informative.pairs} (${pct(c.informative.share)}) | ${pv(c.p_noninferiority)} (${pv(c.holm_p_noninferiority)}) | ${pv(c.p_superiority)} (${pv(c.holm_p_superiority)}) | **${c.call}**${c.call === "can't tell" ? ` (MDD at 80% power: ${c.mdd_80 === null ? 'not estimable' : `${(100 * c.mdd_80).toFixed(1)} points`})` : ''}${c.untested_reason ? `; ${c.untested_reason}` : ''} |`);
    out.push('', `Cost per solved task: ${m.cost}.`, '', `| Call | ${m.particle} cost per solved task [95% CI] | Frontier cost per solved task [95% CI] | ${m.particle} to frontier cost ratio [95% CI] | pass^k per cell [95% CI] | Leak rate ${m.particle} / frontier, difference [95% CI] |`, '|---|---|---|---|---|---|');
    for (const c of rows) {
      const k = c.pass_hat_k.map((x) => `${x.cell} k=${x.k}: ${pct(x.estimate)} ${ciPct(x.ci95)} (${x.tasks} tasks${x.tasks_with_fewer_than_k ? `, ${x.tasks_with_fewer_than_k} with fewer attempts left out` : ''})`).join('<br>');
      const leak = c.leaks ? `${pct(c.leaks.rate_particle)} / ${pct(c.leaks.rate_frontier)}, ${pts(c.leaks.difference)} ${ciPts(c.leaks.ci95)}` : 'n/a';
      const solved = (x: { usd_per_solve: number | null; ci95: [number, number] | null }) => (x.usd_per_solve === null ? 'no solve' : `${usd(x.usd_per_solve)} ${ciUsd(x.ci95)}`);
      out.push(`| ${c.id} | ${solved(c.cost.particle)} | ${solved(c.cost.frontier)} | ${times(c.cost.particle_to_frontier.ratio)} ${ciTimes(c.cost.particle_to_frontier.ci95)} | ${k} | ${leak} |`);
    }
  }
  if (a.not_paired.length) { out.push('', '### Not paired', ''); for (const x of a.not_paired) out.push(`- ${x.use_case}/${x.frontier}: ${x.reason}`); }
  const dropped = a.primary.filter((c) => c.dropped.length);
  if (dropped.length) { out.push('', '### Tasks dropped from model-swap pairs', ''); for (const c of dropped) out.push(`- ${c.id}: ${c.dropped.map((d) => `${d.harness} ${d.task} (${d.reason})`).join('; ')}`); }
  return out;
}

// The low-cost swap (optional "low_cost_swap" block; see the header): a two-sided contrast of model a against model b in
// the same harnesses, beside the descriptive frontier minus a gap, with one token-priced cost basis.

/** The outcome wording of a low_cost_swap call, fixed before any trial; <a> and <b> are the spec's labels, <margin> its margin in points. */
export const LOW_COST_CALL_TEMPLATES = ['<a> better', '<b> better', '<a> better, by less than <margin>', '<b> better, by less than <margin>', 'within <margin> points', 'within <margin> points, no measurable difference', "can't tell"] as const;

export interface LowCostSwapSpec {
  /** The model id of the low-cost model (DeepSeek-V4.1-Flash-1017), as the calling script names models. */
  a: string;
  /** The model id it is compared with (particle-1). */
  b: string;
  label_a: string;
  label_b: string;
  /** Harnesses left out of every pool (a model's home harness), each reported beside the call with no test. */
  exclude_harnesses?: string[];
  use_cases: Array<{ id: UseCase; cells: string[] }>;
  /** The use cases of the two Holm families: two superiority calls per use case, and one equivalence call per use case. */
  family: UseCase[];
  /** The equivalence margin, in pass-rate units (0.10 is 10 points). */
  margin: number;
  /** The price file, from the repository root, and the row ("<provider>:<model>") that prices each of a and b. */
  cost_basis: { prices: string; rows: Record<string, string> };
  /** Frontier model ids for the descriptive frontier minus a gap. */
  frontier?: string[];
  cluster?: 'task' | 'account-attribute';
  facts_index?: string;
  clusters?: Record<string, string>;
  min_clusters?: number;
  require_clusters?: boolean;
}

export interface LowCostTrial { cell: string; task: string; value: 0 | 1 | null; usage: TrialUsage | null }
export interface LowCostInput {
  cells: SwapCell[];
  trials: LowCostTrial[];
  /** Per task, its account-plus-attribute key, null when the task names no fact (account-attribute clusters only). */
  keys?: Record<string, string | null>;
}

export function checkLowCostSwapSpec(spec: LowCostSwapSpec, cells: ReadonlyMap<string, SwapCell | undefined>, where: 'matrix' | 'harbor'): string[] {
  const problems: string[] = [];
  const p = (s: string) => problems.push(`low_cost_swap: ${s}`);
  for (const k of ['a', 'b', 'label_a', 'label_b'] as const) if (typeof spec[k] !== 'string' || !spec[k]) p(`${k} is missing`);
  if (spec.a === spec.b) p('a and b are the same model');
  const frontier = spec.frontier ?? [];
  if (!Array.isArray(frontier) || new Set(frontier).size !== frontier.length || frontier.some((id) => typeof id !== 'string' || !id)) p('frontier must be a list of distinct model ids');
  else for (const id of frontier) if (id === spec.a || id === spec.b) p(`frontier model ${id} is a or b`);
  const excluded = spec.exclude_harnesses ?? [];
  if (!Array.isArray(excluded) || excluded.some((h) => typeof h !== 'string' || !h)) p('exclude_harnesses must be a list of harness ids');
  const models = new Set([spec.a, spec.b, ...(Array.isArray(frontier) ? frontier : [])]);
  if (!Array.isArray(spec.use_cases) || !spec.use_cases.length) p('use_cases is empty');
  const seenUse = new Set<string>(), seenCell = new Set<string>();
  for (const u of spec.use_cases ?? []) {
    if (!USE_CASES.includes(u.id)) p(`use case ${u.id} is not one of ${USE_CASES.join(', ')}`);
    if (seenUse.has(u.id)) p(`use case ${u.id} listed twice`);
    seenUse.add(u.id);
    const slots = new Set<string>();
    for (const id of u.cells ?? []) {
      if (seenCell.has(id)) p(`cell ${id} is in more than one use case`);
      seenCell.add(id);
      if (!cells.has(id)) { p(`use case ${u.id} names cell ${id}, which the spec does not define`); continue; }
      const c = cells.get(id);
      if (!c?.harness || !c.model) { p(`cell ${id} has no harness or model in the ${where === 'matrix' ? 'manifest' : 'spec'}`); continue; }
      if (!models.has(c.model)) p(`cell ${id} runs ${c.model}, which is neither a, b nor a listed frontier model`);
      const slot = `${c.harness} ${c.model}`;
      if (slots.has(slot)) p(`use case ${u.id} has two cells of ${c.harness} on ${c.model}`);
      slots.add(slot);
    }
  }
  if (!Array.isArray(spec.family) || !spec.family.length || new Set(spec.family).size !== spec.family.length) p('family must be a non-empty list of distinct use cases');
  else {
    for (const u of spec.family) if (!USE_CASES.includes(u)) p(`family names ${u}, which is not one of ${USE_CASES.join(', ')}`);
    const left = (spec.use_cases ?? []).map((u) => u.id).filter((u) => !spec.family.includes(u));
    if (left.length) p(`the declared family leaves out use case(s) this run plans: ${left.join(', ')}`);
  }
  if (typeof spec.margin !== 'number' || !(spec.margin > 0 && spec.margin < 0.5)) p('margin must be a number between 0 and 0.5');
  const basis = spec.cost_basis;
  if (!basis || typeof basis.prices !== 'string' || !basis.prices) p('cost_basis.prices is missing');
  for (const m of [spec.a, spec.b]) if (typeof basis?.rows?.[m] !== 'string' || !basis.rows[m]) p(`cost_basis.rows names no price row for ${m}`);
  clusterProblems(spec, where, p);
  if (spec.min_clusters !== undefined && (!Number.isSafeInteger(spec.min_clusters) || spec.min_clusters < 2)) p('min_clusters must be an integer of at least 2');
  if (spec.require_clusters !== undefined && typeof spec.require_clusters !== 'boolean') p('require_clusters must be true or false');
  return problems;
}

interface Rate { row: string; input: number; output: number; cache_read: number | null; cache_write: number | null; long_prompt: boolean }

/** The cost basis: each of the models' price rows from the dated price file, with the file's sha256 for the receipt. */
export function loadCostBasis(root: string, basis: LowCostSwapSpec['cost_basis'], models: readonly string[]) {
  const file = join(root, basis.prices);
  if (!existsSync(file)) throw new ModelSwapError(`low_cost_swap: cost_basis.prices ${basis.prices} does not exist`);
  const text = readFileSync(file, 'utf8');
  const table = JSON.parse(text) as { date?: string; unit?: string; rows: Array<{ provider: string; model: string; input: number; output: number; cache_read: number | null; cache_write: number | null; long_prompt: unknown; source_url?: string; source_date?: string }> };
  const rates = new Map(models.map((m) => {
    const key = basis.rows[m]!;
    const row = table.rows.find((r) => `${r.provider}:${r.model}` === key);
    if (!row) throw new ModelSwapError(`low_cost_swap: ${basis.prices} has no row ${key} (cost_basis.rows.${m})`);
    return [m, { row: key, input: row.input, output: row.output, cache_read: row.cache_read ?? null, cache_write: row.cache_write ?? null, long_prompt: row.long_prompt !== null && row.long_prompt !== undefined, source_url: row.source_url ?? null, source_date: row.source_date ?? null }];
  }));
  return { prices: basis.prices, date: table.date ?? null, sha256: createHash('sha256').update(text).digest('hex'), rates };
}

/** One trial's cost on the token basis: uncached input, cache reads, cache writes and output tokens times the row's rates (a
 *  rate the row leaves null bills as input). usage.input_tokens is the whole prompt, cache reads and writes included (the
 *  metering proxy's usageCost). A trial whose record cannot be priced this way names the fields it lacks instead. */
export function tokenCost(u: TrialUsage | null, r: Rate): { usd: number; missing: null } | { usd: null; missing: string[] } {
  if (!u) return { usd: null, missing: ['usage'] };
  const missing: string[] = [];
  for (const k of ['input_tokens', 'output_tokens', 'cached_tokens'] as const) if (typeof u[k] !== 'number') missing.push(`usage.${k}`);
  if (r.cache_write !== null && typeof u.cache_write_tokens !== 'number') missing.push('usage.cache_write_tokens');
  if ((u.unpriced ?? 0) > 0) missing.push('usage.unpriced: tokens of requests charged their reservation');
  if (Object.entries(u.by_model ?? {}).some(([k, v]) => k !== r.row && v.usd > 0)) missing.push('usage.by_model tokens: the trial also ran another model, and by_model carries only usd and requests');
  if (r.long_prompt) missing.push('per-request prompt tokens: the price row has a long_prompt tier');
  if (missing.length) return { usd: null, missing };
  const write = u.cache_write_tokens ?? 0;
  const uncached = u.input_tokens - u.cached_tokens - write;
  if (uncached < 0) return { usd: null, missing: ['usage.input_tokens: smaller than cached_tokens plus cache_write_tokens'] };
  return { usd: (uncached * r.input + u.cached_tokens * (r.cache_read ?? r.input) + write * (r.cache_write ?? r.input) + u.output_tokens * r.output) / 1e6, missing: null };
}

/** The call of one low_cost_swap comparison from its Holm-adjusted p-values; a p at or below alpha passes. */
export function lowCostCall(x: { tested: boolean; holm_p_superiority_a: number; holm_p_superiority_b: number; holm_p_tost: number; ci95: [number, number] | null }, labels: { a: string; b: string; margin: number }, alpha: number): string {
  const m = Number((100 * labels.margin).toFixed(1));
  const winner = !x.tested ? null : x.holm_p_superiority_a <= alpha ? labels.a : x.holm_p_superiority_b <= alpha ? labels.b : null;
  const within = x.tested && x.holm_p_tost <= alpha;
  if (winner && within) return `${winner} better, by less than ${m}`;
  if (winner) return `${winner} better`;
  if (within) return x.ci95 && x.ci95[0] <= 0 && x.ci95[1] >= 0 ? `within ${m} points, no measurable difference` : `within ${m} points`;
  return "can't tell";
}

interface LSide { scored: number[]; usd: number; trials: number; priced: number; missing: Map<string, number> }
interface LItem { harness: string; task: string; cluster: string; x: LSide; y: LSide }

export function analyzeLowCostSwap(input: LowCostInput, spec: LowCostSwapSpec, opts: SwapOptions, root = join(import.meta.dir, '..')) {
  const minClusters = spec.min_clusters ?? 10;
  const excluded = [...new Set(spec.exclude_harnesses ?? [])].sort(byKey);
  const frontier = spec.frontier ?? [];
  const basis = loadCostBasis(root, spec.cost_basis, [spec.a, spec.b]);
  const label = (m: string) => (m === spec.a ? spec.label_a : m === spec.b ? spec.label_b : m);
  const cellById = new Map(input.cells.map((c) => [c.id, c]));
  const sides = new Map<string, Map<string, LSide>>();
  for (const t of input.trials) {
    const m = sides.get(t.cell) ?? new Map<string, LSide>();
    const s = m.get(t.task) ?? { scored: [], usd: 0, trials: 0, priced: 0, missing: new Map<string, number>() };
    s.trials++;
    if (t.value !== null) s.scored.push(t.value);
    const rate = basis.rates.get(cellById.get(t.cell)?.model ?? '');
    if (rate) {
      const c = tokenCost(t.usage, rate);
      if (c.missing) for (const f of c.missing) s.missing.set(f, (s.missing.get(f) ?? 0) + 1);
      else { s.usd += c.usd; s.priced++; }
    }
    m.set(t.task, s);
    sides.set(t.cell, m);
  }
  const allTasks = [...new Set(input.trials.map((t) => t.task))].sort(byKey);
  const { mode, clusterOf, fallback, fromSource } = assignClusters(allTasks, spec, input.keys);
  const mean = (s: LSide) => sum(s.scored) / s.scored.length;

  const bothIn = (cells: SwapCell[], x: string, y: string) => [...new Set(cells.map((c) => c.harness))].filter((h) => cells.some((c) => c.harness === h && c.model === x) && cells.some((c) => c.harness === h && c.model === y)).sort(byKey);
  const pairUp = (cells: SwapCell[], x: string, y: string, harnesses: string[]) => {
    const items: LItem[] = [], dropped: Array<{ harness: string; task: string; reason: string }> = [];
    for (const h of harnesses) {
      const xc = cells.find((c) => c.harness === h && c.model === x)!, yc = cells.find((c) => c.harness === h && c.model === y)!;
      const X = sides.get(xc.id) ?? new Map<string, LSide>(), Y = sides.get(yc.id) ?? new Map<string, LSide>();
      for (const task of [...new Set([...X.keys(), ...Y.keys()])].sort(byKey)) {
        const p = X.get(task), q = Y.get(task);
        if (p?.scored.length && q?.scored.length) { items.push({ harness: h, task, cluster: clusterOf.get(task)!, x: p, y: q }); continue; }
        dropped.push({ harness: h, task, reason: !p?.scored.length && !q?.scored.length ? 'no scored attempt in either cell' : !p?.scored.length ? `no scored attempt in ${xc.id}` : `no scored attempt in ${yc.id}` });
      }
    }
    return { items, dropped };
  };
  // d = x minus y, each harness weighted the same: an item of harness h carries n / (H * n_h).
  const delta = (items: LItem[]) => {
    const hs = [...new Set(items.map((i) => i.harness))];
    const perHarness = new Map(hs.map((h) => [h, items.filter((i) => i.harness === h).length]));
    const w = (i: LItem) => items.length / (hs.length * perHarness.get(i.harness)!);
    return clusteredPairedDelta(items.map((i) => ({ id: `${i.harness}/${i.task}`, cluster: i.cluster, a: mean(i.y) * w(i), b: mean(i.x) * w(i) })), opts);
  };
  const describe = (items: LItem[]) => {
    const s = delta(items);
    return { harnesses: [...new Set(items.map((i) => i.harness))].sort(byKey), tasks: new Set(items.map((i) => i.task)).size, pairs: items.length, clusters: s.n_clusters, mean_x: round(s.mean_b)!, mean_y: round(s.mean_a)!, d: round(s.delta)!, ci95: roundCi(s.ci95) };
  };
  const sideCost = (items: LItem[], k: 'x' | 'y') => {
    const byCluster = new Map<string, { usd: number; solves: number }>();
    for (const i of items) { const c = byCluster.get(i.cluster) ?? { usd: 0, solves: 0 }; c.usd += i[k].usd; c.solves += sum(i[k].scored); byCluster.set(i.cluster, c); }
    const clusters = [...byCluster.entries()].sort(([p], [q]) => byKey(p, q)).map(([, c]) => c);
    const trials = sum(items.map((i) => i[k].trials)), priced = sum(items.map((i) => i[k].priced));
    const missing = new Map<string, number>();
    for (const i of items) for (const [f, n] of i[k].missing) missing.set(f, (missing.get(f) ?? 0) + n);
    const complete = priced === trials;
    const c = costPerSolve(clusters, opts);
    return {
      clusters, complete,
      out: { trials, trials_priced: priced, usd_total: complete ? round(c.usd)! : null, usd_priced_trials: round(c.usd)!, solves: c.solves, usd_per_solve: complete ? round(c.usd_per_solve) : null, ci95: complete ? roundCi(c.ci95) : null,
        note: complete ? c.note : `${trials - priced} of ${trials} trial(s) lack the token counts, so no cost per solved task`, missing: [...missing.entries()].sort(([p], [q]) => byKey(p, q)).map(([field, n]) => ({ field, trials: n })) },
    };
  };

  const notPaired: Array<{ use_case: UseCase; reason: string; excluded: ReturnType<typeof beside> }> = [];
  const beside = (cells: SwapCell[]) => excluded.filter((h) => cells.some((c) => c.harness === h)).map((h) => {
    const paired = bothIn(cells, spec.a, spec.b).includes(h);
    const { items } = pairUp(cells, spec.a, spec.b, paired ? [h] : []);
    if (!items.length) return { harness: h, reason: paired ? 'no task was scored in both cells' : `${h} has no cell pair of ${spec.a} and ${spec.b}` };
    const s = describe(items);
    return { harness: h, tasks: s.tasks, pairs: s.pairs, clusters: s.clusters, mean_a: s.mean_x, mean_b: s.mean_y, d: s.d, ci95: s.ci95 };
  });
  const raw: Array<{ u: UseCase; harnesses: string[]; items: LItem[]; dropped: Array<{ harness: string; task: string; reason: string }>; cells: SwapCell[] }> = [];
  for (const u of spec.use_cases) {
    const cells = u.cells.map((id) => cellById.get(id)!);
    const pool = bothIn(cells, spec.a, spec.b).filter((h) => !excluded.includes(h));
    const { items, dropped } = pairUp(cells, spec.a, spec.b, pool);
    if (!pool.length) { notPaired.push({ use_case: u.id, reason: `no harness of ${u.id}${excluded.length ? ` outside ${excluded.join(', ')}` : ''} has cells of both ${spec.a} and ${spec.b}`, excluded: beside(cells) }); continue; }
    if (!items.length) { notPaired.push({ use_case: u.id, reason: 'no task was scored in both cells of any pooled harness', excluded: beside(cells) }); continue; }
    raw.push({ u: u.id, harnesses: pool, items, dropped, cells });
  }
  const unclustered = [...new Set(raw.flatMap((r) => r.items.map((i) => i.task)))].filter((task) => !fromSource(task)).sort(byKey);
  if (spec.require_clusters && unclustered.length) throw new ModelSwapError(`low_cost_swap: require_clusters is set and ${unclustered.length} task(s) in a contrast have no cluster from ${mode === 'account-attribute' ? 'facts_index or ' : ''}clusters: ${unclustered.slice(0, 10).join(', ')}${unclustered.length > 10 ? ', ...' : ''}`);

  const tests = raw.map((r) => {
    const stats = delta(r.items);
    const tested = stats.n_clusters >= minClusters;
    const supA = superiorityP(stats, 0, 'higher'), supB = superiorityP(stats, 0, 'lower');
    const lower = nonInferiorityP(stats, spec.margin, 'higher'), upper = nonInferiorityP(stats, spec.margin, 'lower');
    const tost = lower === null || upper === null ? null : Math.max(lower, upper);
    return { r, stats, tested, supA, supB, lower, upper, tost, testP: { a: tested && supA !== null ? supA : 1, b: tested && supB !== null ? supB : 1, tost: tested && tost !== null ? tost : 1 } };
  });
  const supId = (u: UseCase, m: string) => `${u}/${label(m)} better`;
  const tostId = (u: UseCase) => `${u}/within`;
  const supFamily = spec.family.flatMap((u) => [supId(u, spec.a), supId(u, spec.b)]), tostFamily = spec.family.map(tostId);
  const holmSup = holmByIds(supFamily, new Map(tests.flatMap((t) => [[supId(t.r.u, spec.a), t.testP.a], [supId(t.r.u, spec.b), t.testP.b]] as Array<[string, number]>)));
  const holmTost = holmByIds(tostFamily, new Map(tests.map((t) => [tostId(t.r.u), t.testP.tost])));

  const calls = tests.map(({ r, stats, tested, supA, supB, lower, upper, tost }) => {
    const mdd = powerNote(stats, { alpha: opts.alpha, power: 0.8 });
    const extreme = (i: LItem) => [...i.x.scored, ...i.y.scored].every((v) => v === 1) || [...i.x.scored, ...i.y.scored].every((v) => v === 0);
    const informative = r.items.filter((i) => !extreme(i)).length;
    const ca = sideCost(r.items, 'x'), cb = sideCost(r.items, 'y');
    const ratio = ca.complete && cb.complete ? pairedCostRatio(ca.clusters.map((c, j) => ({ task: String(j), usd_a: c.usd, solves_a: c.solves, usd_b: cb.clusters[j]!.usd, solves_b: cb.clusters[j]!.solves })), opts) : null;
    const h = { holm_p_superiority_a: holmSup.get(supId(r.u, spec.a))!, holm_p_superiority_b: holmSup.get(supId(r.u, spec.b))!, holm_p_tost: holmTost.get(tostId(r.u))! };
    const gap = frontier.map((f) => {
      const hs = bothIn(r.cells, f, spec.a).filter((x) => !excluded.includes(x));
      const { items } = pairUp(r.cells, f, spec.a, hs);
      if (!items.length) return { frontier: f, reason: hs.length ? 'no task was scored in both cells of any pooled harness' : `no pooled harness of ${r.u} has cells of both ${f} and ${spec.a}` };
      const s = describe(items);
      return { frontier: f, harnesses: s.harnesses, tasks: s.tasks, pairs: s.pairs, clusters: s.clusters, mean_frontier: s.mean_x, mean_a: s.mean_y, gap: s.d, ci95: s.ci95 };
    });
    const ci95 = roundCi(stats.ci95);
    return {
      id: r.u, use_case: r.u, harnesses: r.harnesses, tasks: new Set(r.items.map((i) => i.task)).size, pairs: r.items.length, clusters: stats.n_clusters,
      attempts: { a: sum(r.items.map((i) => i.x.scored.length)), b: sum(r.items.map((i) => i.y.scored.length)) },
      mean_a: round(stats.mean_b)!, mean_b: round(stats.mean_a)!, d: round(stats.delta)!, ci95, p_method: stats.p_method,
      p_superiority_a: round(supA, 8), p_superiority_b: round(supB, 8), p_tost_lower: round(lower, 8), p_tost_upper: round(upper, 8), p_tost: round(tost, 8), tested,
      untested_reason: !tested ? `${stats.n_clusters} cluster(s), fewer than ${minClusters}: estimate and interval only, counted as p = 1 in both families` : supA === null ? 'no paired task differs, so the bootstrap is empty: counted as p = 1' : null,
      holm_p_superiority_a: round(h.holm_p_superiority_a, 8)!, holm_p_superiority_b: round(h.holm_p_superiority_b, 8)!, holm_p_tost: round(h.holm_p_tost, 8)!,
      call: lowCostCall({ tested, ...h, ci95 }, { a: spec.label_a, b: spec.label_b, margin: spec.margin }, opts.alpha),
      mdd_80: round(mdd.mde), power_note: mdd.note,
      a_worse: r.items.filter((i) => mean(i.y) > mean(i.x)).length, a_better: r.items.filter((i) => mean(i.x) > mean(i.y)).length, tied: r.items.filter((i) => mean(i.x) === mean(i.y)).length,
      informative: { pairs: informative, share: round(informative / r.items.length, 4)! },
      cost: {
        a: ca.out, b: cb.out,
        b_to_a: ratio ? { ratio: round(ratio.ratio, 4), ci95: roundCi(ratio.ci95, 4), undefined_draws: ratio.undefined_draws, note: ratio.note }
          : { ratio: null, ci95: null, undefined_draws: 0, note: `not computed: trial records lack ${[...new Set([...ca.out.missing, ...cb.out.missing].map((m) => m.field))].join('; ')}` },
      },
      excluded: beside(r.cells),
      frontier_gap: gap,
      dropped: r.dropped,
    };
  });
  const made = new Set(calls.map((c) => c.use_case));
  const rateOut = (m: string) => { const r = basis.rates.get(m)!; return { model: m, label: label(m), row: r.row, input: r.input, cache_read: r.cache_read, cache_write: r.cache_write, output: r.output, long_prompt: r.long_prompt, source_url: r.source_url, source_date: r.source_date }; };
  return {
    method: {
      rule: 'd = a minus b task mean per (harness, task) pair; each use case pools the harnesses that ran both models, minus exclude_harnesses, with equal weight per harness; cluster bootstrap and exact cluster sign-flip from runner/stats/paired.ts',
      a: spec.a, b: spec.b, label_a: spec.label_a, label_b: spec.label_b, a_class: 'low-cost model, not frontier', exclude_harnesses: excluded, frontier, margin: spec.margin,
      alpha: opts.alpha, seed: opts.seed, draws: opts.draws, min_clusters: minClusters, power: 0.8,
      tests: 'superiority each way: superiorityP(d, 0, higher) for a and (lower) for b, the exact one-sided cluster sign-flip p; within the margin: two one-sided tests, nonInferiorityP(d, margin, higher) and (lower), p the larger',
      cluster: {
        source: mode, required: spec.require_clusters === true, facts_index: mode === 'account-attribute' ? spec.facts_index! : null, set_by_hand: Object.keys(spec.clusters ?? {}).filter((t) => allTasks.includes(t)).length,
        fallback_tasks: fallback, warning: fallback.length ? `${fallback.length} task(s) name no fact in spec.json, so each is its own cluster: ${fallback.join(', ')}` : null,
      },
      cost: {
        basis: "each trial's token counts times the price row's peak list rates: (usage.input_tokens minus cached_tokens minus cache_write_tokens) at input, cached_tokens at cache read, cache_write_tokens at cache write (a null rate bills as input), output_tokens at output; every trial of the paired tasks (excluded ones included) over scored passes; not usage.usd",
        prices: basis.prices, date: basis.date, sha256: basis.sha256, rates: [rateOut(spec.a), rateOut(spec.b)],
      },
      templates: LOW_COST_CALL_TEMPLATES,
    },
    family: { superiority: supFamily, within: tostFamily, absent: spec.family.filter((u) => !made.has(u)), note: 'Holm over each family; a declared use case this run does not make, and an untested call, count as p = 1' },
    calls,
    not_paired: notPaired,
  };
}

export type LowCostSwapAnalysis = ReturnType<typeof analyzeLowCostSwap>;

const rate = (x: number | null) => (x === null ? 'none (bills as input)' : `$${x}`);

export function renderLowCostSwap(a: LowCostSwapAnalysis): string[] {
  const m = a.method;
  const A = m.label_a, B = m.label_b, pts10 = Number((100 * m.margin).toFixed(1));
  const out: string[] = ['', `## Low-cost swap: ${A} against ${B} in the same harnesses`, ''];
  out.push(`${A} is a low-cost model, not a frontier model. d is ${A} minus ${B} pass per task, paired within a harness; a call pools the harnesses of its use case that ran both models, each weighted equally${m.exclude_harnesses.length ? `, and leaves out ${m.exclude_harnesses.join(', ')}, reported beside it` : ''}. Superiority each way (exact one-sided cluster sign-flip), Holm over ${a.family.superiority.length} calls (${a.family.superiority.join(', ')}). Within ${pts10} points: two one-sided bootstrap tests at -${pts10} and +${pts10} points, p the larger, Holm over ${a.family.within.length} calls (${a.family.within.join(', ')})${a.family.absent.length ? `; not in this run, counted as p = 1: ${a.family.absent.join(', ')}` : ''}. Clusters: ${m.cluster.source}${m.cluster.set_by_hand ? `, ${m.cluster.set_by_hand} task(s) set by hand` : ''}. Alpha ${m.alpha}, seed ${m.seed}, ${m.draws} draws, at least ${m.min_clusters} clusters to test.`);
  if (m.cluster.warning) out.push('', `**Cluster warning:** ${m.cluster.warning}.`);
  if (a.calls.length) {
    out.push('', `| Use case | Harnesses | Tasks / pairs / clusters | Attempts (${A} / ${B}) | ${A} / ${B} task mean | d [95% CI] | ${A} worse / better / tied | Informative pairs | ${A} better p (Holm) | ${B} better p (Holm) | Within ${pts10} points p (Holm) | Label |`, '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of a.calls) out.push(`| ${c.id} | ${c.harnesses.join(', ')} | ${c.tasks} / ${c.pairs} / ${c.clusters} | ${c.attempts.a} / ${c.attempts.b} | ${pct(c.mean_a)} / ${pct(c.mean_b)} | ${pts(c.d)} ${ciPts(c.ci95)} | ${c.a_worse} / ${c.a_better} / ${c.tied} | ${c.informative.pairs} (${pct(c.informative.share)}) | ${pv(c.p_superiority_a)} (${pv(c.holm_p_superiority_a)}) | ${pv(c.p_superiority_b)} (${pv(c.holm_p_superiority_b)}) | ${pv(c.p_tost)} (${pv(c.holm_p_tost)}) | **${c.call}**${c.call === "can't tell" ? ` (MDD at 80% power: ${c.mdd_80 === null ? 'not estimable' : `${(100 * c.mdd_80).toFixed(1)} points`})` : ''}${c.untested_reason ? `; ${c.untested_reason}` : ''} |`);
    out.push('', '### Beside the calls (descriptive, no test)', '', '| Use case | Comparison | Harnesses | Tasks / pairs / clusters | Task means | Difference [95% CI] |', '|---|---|---|---|---|---|');
    for (const c of a.calls) {
      for (const x of c.excluded) out.push('reason' in x ? `| ${c.id} | ${x.harness} (left out of the pool): ${A} minus ${B} | ${x.harness} | n/a | n/a | ${x.reason} |` : `| ${c.id} | ${x.harness} (left out of the pool): ${A} minus ${B} | ${x.harness} | ${x.tasks} / ${x.pairs} / ${x.clusters} | ${pct(x.mean_a)} / ${pct(x.mean_b)} | ${pts(x.d)} ${ciPts(x.ci95)} |`);
      for (const g of c.frontier_gap) out.push('reason' in g ? `| ${c.id} | ${g.frontier} minus ${A} | n/a | n/a | n/a | ${g.reason} |` : `| ${c.id} | ${g.frontier} minus ${A} | ${g.harnesses.join(', ')} | ${g.tasks} / ${g.pairs} / ${g.clusters} | ${pct(g.mean_frontier)} / ${pct(g.mean_a)} | ${pts(g.gap)} ${ciPts(g.ci95)} |`);
    }
    const [ra, rb] = m.cost.rates;
    const rates = (r: typeof ra) => `${r!.label} (${r!.row}): input ${rate(r!.input)}, cache read ${rate(r!.cache_read)}, cache write ${rate(r!.cache_write)}, output ${rate(r!.output)}`;
    out.push('', '### Cost per solved task, one basis', '', `Each trial's tokens times the peak list rates of ${m.cost.prices} (dated ${m.cost.date ?? 'n/a'}, sha256 ${m.cost.sha256.slice(0, 12)}), USD per million tokens: ${rates(ra)}; ${rates(rb)}. Uncached input is usage.input_tokens minus cache reads and writes. Every trial of the paired tasks counts, excluded ones included, over scored passes. The ratio is ${B} over ${A}.`,
      '', `| Use case | ${A} cost per solved task [95% CI] | ${B} cost per solved task [95% CI] | ${B} to ${A} cost ratio [95% CI] | Trials priced (${A} / ${B}) |`, '|---|---|---|---|---|');
    const solved = (x: { usd_per_solve: number | null; ci95: [number, number] | null; note: string | null }) => (x.usd_per_solve === null ? (x.note ?? 'no solve') : `${usd(x.usd_per_solve)} ${ciUsd(x.ci95)}`);
    for (const c of a.calls) out.push(`| ${c.id} | ${solved(c.cost.a)} | ${solved(c.cost.b)} | ${c.cost.b_to_a.ratio === null ? c.cost.b_to_a.note : `${times(c.cost.b_to_a.ratio)} ${ciTimes(c.cost.b_to_a.ci95)}`} | ${c.cost.a.trials_priced} of ${c.cost.a.trials} / ${c.cost.b.trials_priced} of ${c.cost.b.trials} |`);
    const missing = a.calls.flatMap((c) => ([['a', A], ['b', B]] as const).filter(([k]) => c.cost[k].missing.length).map(([k, l]) => `- ${c.id}, ${l}: ${c.cost[k].missing.map((x) => `${x.field} (${x.trials} trial(s))`).join('; ')}`));
    if (missing.length) out.push('', '**Fields the trial records lack for the token basis:**', '', ...missing);
  }
  if (a.not_paired.length) {
    out.push('', '### Not paired', '');
    for (const x of a.not_paired) out.push(`- ${x.use_case}: ${x.reason}${x.excluded.map((e) => 'reason' in e ? `; ${e.harness}: ${e.reason}` : `; ${e.harness} (left out of the pool), ${A} minus ${B}: ${pts(e.d)} ${ciPts(e.ci95)}, ${e.tasks} task(s)`).join('')}`);
  }
  const dropped = a.calls.filter((c) => c.dropped.length);
  if (dropped.length) { out.push('', '### Tasks dropped from low-cost pairs', ''); for (const c of dropped) out.push(`- ${c.id}: ${c.dropped.map((d) => `${d.harness} ${d.task} (${d.reason})`).join('; ')}`); }
  return out;
}
