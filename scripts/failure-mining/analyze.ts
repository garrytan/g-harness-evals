#!/usr/bin/env bun
// The layer-2 analysis of the failure-mining corpus (internal-task), to the preregistered analysis spec, sections A to E.
//
//   bun scripts/failure-mining/analyze.ts --codebook <codebook.json> --labels <candidate labels.jsonl> --out <dir>
//       [--corpus docs/benchmarks/2026-11-09-failure-mining/corpus] [--checked <checked.jsonl>] [--sdk-labels <labels.jsonl>]
//       [--gold-a <opus labels> --gold-b <astra labels>] [--retest-a <a> --retest-b <b>] [--retest-opus-a <a> --retest-opus-b <b>]
//       [--fallback <labels.jsonl> [--fallback-checked <checked.jsonl>]] [--regrade <regrade.jsonl>]
//   bun scripts/failure-mining/analyze.ts --mdd [--corpus <dir>] [--codebook <codebook.json> | --holm-m <m>]
//   bun scripts/failure-mining/analyze.ts --retest-ids [--corpus <dir>]
//
// --labels is the candidate labeller's (particle-1) file for the whole corpus, gold-sample trials included: the R78
// gate scores it on the gold set, and the tables are built from it, or from --fallback when the candidate fails the gate
// and the fallback passes its own. Each labels file used must hold one labeller: one model (the fallback: one per trial
// model family, always from the other family), one codebook_sha256 equal to sha256(--codebook), and one prefix_sha256
// per model; analyze.ts refuses to run otherwise.
//
// Scope: corpus/manifest.jsonl rows of kind multiuser on a frontier model; a trial failed when its grade is not pass.
// A task cluster is (task tree, task), the tree being the results folder's tasks root and task sets in corpus/runs.json;
// a cell is (task tree, task, harness, model). Populations default, variant and uncounted get the same tables and are
// never pooled; only default is ranked and tested. SDK packets (corpus/sdk-packet-index.jsonl) are descriptive only.
//
// Label status (from --labels, with --checked overriding each label's own check): verified (an ok record that passed
// check-labels), unverified (an ok record that did not), failed (no valid record after the retry), missing (no line).
// The main analysis counts verified and unverified labels under their root_cause; the sensitivity analysis counts
// verified only. Every other failed trial counts as class "unlabelled", reported, never imputed.
//
// Regrade (--regrade, default corpus/regrade.jsonl when it exists; rows {trial_id, grader_commit, original, regraded}
// from a keyless scripts/regrade.ts at one grader commit): a failed trial in scope whose regraded grade is pass gets
// root_cause graded_before_fix with label status mechanical, overriding any model label, and counts in the main and the
// verified-only analysis alike. A further sensitivity table (regraded_as_pass) treats those trials as passes. Every
// other row (pass or n/a to fail, fail to fail) changes nothing and is only counted. The run stops if a row names a
// trial not in corpus/manifest.jsonl or the rows carry more than one grader_commit. --mdd ignores the regrade.
//
// A. Prevalence: per class, trials, distinct task clusters and harness x model pairs, and the cell-weighted per-trial
//    rate over all trials (passes included) with a task-cluster bootstrap interval (10,000 resamples, seed 2020), overall,
//    per harness and per model. Ranking (default, main): classes outside group task_or_grader by tasks, then harness x
//    model pairs, then trials; task_or_grader classes are listed apart as repository fixes. Crosstab: layer-1 primary
//    label (corpus/packet-index.jsonl) by layer-2 class, counts of failed trials, default and variant, main analysis.
// B. gbrain prevention: pairs are (run, harness, model) of PAIR_RUNS in default with a gbrain arm and a no-brain arm;
//    only tasks run in both arms count, and a unit is (pair, task cluster). Per class, the per-unit rate difference (brain
//    minus no-brain) averaged over units; interval by unit bootstrap (runner/stats clusteredPairedDelta, 10,000 resamples,
//    seed 2021); p by a two-sided sign-flip permutation over units (10,000 draws, seed 2022). The tested family, Holm at
//    alpha 0.05 (runner/stats holmAdjusted): each class with a gbrain claim (B1 to B14 in its prevention list) outside
//    group brain, plus one composite, retrieval_any, a fixed list of classes (RETRIEVAL_ANY_CLASSES): the retrieval and
//    decision classes with a gbrain claim, both group-brain classes and cross_scope_read, the no-brain twin of
//    unscoped_brain_search, so moving a failure between those classes cannot move it. Group-brain classes can only occur in brain arms, so they are never tested: they are reported as brain-arm
//    rates per pair, descriptive. Every other class is reported, untested. Per pair and per install route, descriptive.
//    MDD per pair and pooled at assumed class rates
//    of 2, 5 and 10 percent, scripts/paired-mdd.ts's variance rule (2 p (1 - p) per trial, here p (1 - p) (1/n_brain +
//    1/n_none) per unit, cluster-robust over units), alpha 0.05 two-sided and Holm's first step, power 0.8.
// C. Within gbrain arms: class rates for trials with at least one in-turn brain call against none. Descriptive.
// D. gstack: SDK class and gstack_role counts by arm; the verdict reads "not exposed in this corpus" unless a
//    multi-user trial in default had gstack present.
// E. Labeller check (R78) through judge-check.ts, scoring the --labels file over every gold trial (a gold trial it did
//    not label counts as a disagreement); fewer than 40 gold items gives the extra draw of 100 trials from the remaining
//    sample pool (build-packets.ts stratifiedSample, seed 2023). If the candidate fails, the fallback (--fallback) is gated
//    on the Opus vs Astra kappa over the whole gold sample (a missing or failed label on either side is a disagreement),
//    at least 0.6: gated on agreement between the two frontier labellers, not on independent gold. If both fail, the
//    tables come from the candidate and every one is marked descriptive. Test-retest subsets: a seeded shuffle (seed 2024)
//    of the gold sample; the first 100 go to particle-1 and the first 40 to Opus (--retest-ids prints them). Stage and
//    first-wrong-step agreement descriptive.
//
// Keyless and deterministic: seeded draws, sorted keys and no timestamps, so the same inputs give the same bytes.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { clusteredPairedDelta, holmAdjusted, normalQuantile, seededRandom } from '../../runner/stats/paired.ts';
import { readLabels, type LabelLine } from './check-labels.ts';
import { agreement, GATE, judgeCheck, rootCauses, type Agreement, type JudgeCheck } from './judge-check.ts';
import { stratifiedSample } from './build-packets.ts';

export const ANALYSIS_VERSION = '1.0.0';
export const SEEDS = { prevalence: 2020, pair_bootstrap: 2021, pair_permutation: 2022, extra_gold: 2023, retest: 2024 } as const;
export const RETEST_SIZES = { 'particle:particle-1': 100, 'anthropic:claude-opus-5-5': 40 } as const;
export const RETRIEVAL_ANY = 'retrieval_any';
export const RETRIEVAL_ANY_CLASSES = ['did_not_look', 'brain_miss', 'gave_up', 'wrong_place', 'found_ignored', 'unscoped_brain_search', 'cross_scope_read'] as const;
export const DRAWS = 10_000;
export const ALPHA = 0.05;
export const POWER = 0.8;
export const MDD_RATES = [0.02, 0.05, 0.1] as const;
export const GOLD_MIN = 40;
export const EXTRA_GOLD = 100;
export const PAIR_RUNS = ['2026-10-31-v03-opus-dev', '2026-11-01-installer-cc-codex', '2026-11-03-qm-c4-told-live', '2026-11-06-harness-zero-h2h'] as const;
export const POPULATIONS = ['default', 'variant', 'uncounted'] as const;
export const UNLABELLED = 'unlabelled';
export const GRADED_BEFORE_FIX = 'graded_before_fix';
export const OTHER = 'other';
export const REPOSITORY_GROUP = 'task_or_grader';
export const BRAIN_GROUP = 'brain';

export type Mode = 'main' | 'verified_only';
export type LabelStatus = 'verified' | 'unverified' | 'failed' | 'missing' | 'mechanical';
export type Table = Mode | 'regraded_as_pass';

export interface ManifestRow {
  trial_id: string; run: string; results_dir: string; cell: string; task: string; harness: string; model: string; grade: string;
  kind: string; frontier: boolean; population: string; gstack_present?: boolean;
  gbrain: { present: boolean; install?: string; route?: string; in_turn_calls?: number | null };
}
export interface AnalysisClass { id: string; name: string; group: string | null; typical_stage: string | null; gbrain_claims: string[]; tested: boolean }
interface CodebookInput { version?: string; classes: Array<{ id: string; name: string; group?: string; typical_stage?: string; prevention?: unknown }> }

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const readJsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const sortStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The gbrain claim ids (B1 to B14) a class's prevention entry names, in any string inside it; an object with a gbrain key is read through that key only. */
export function gbrainClaims(prevention: unknown): string[] {
  const walk = (v: unknown): string[] => {
    if (typeof v === 'string') return v.match(/\bB\d+\b/g) ?? [];
    if (Array.isArray(v)) return v.flatMap(walk);
    if (v && typeof v === 'object') return 'gbrain' in v ? walk((v as { gbrain: unknown }).gbrain) : Object.values(v).flatMap(walk);
    return [];
  };
  return [...new Set(walk(prevention).filter((id) => { const n = Number(id.slice(1)); return n >= 1 && n <= 14; }))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function analysisClasses(cb: CodebookInput): AnalysisClass[] {
  return cb.classes.map((c) => {
    const claims = gbrainClaims(c.prevention);
    const group = typeof c.group === 'string' ? c.group : null;
    return { id: c.id, name: c.name, group, typical_stage: typeof c.typical_stage === 'string' ? c.typical_stage : null, gbrain_claims: claims, tested: claims.length > 0 && group !== BRAIN_GROUP };
  });
}

/** retrieval_any: the codebook's classes that RETRIEVAL_ANY_CLASSES lists, in codebook order. */
export function retrievalAnyMembers(classes: AnalysisClass[]): string[] {
  return classes.filter((c) => (RETRIEVAL_ANY_CLASSES as readonly string[]).includes(c.id)).map((c) => c.id);
}

/** The section B test family: the tested classes and the composite; m is the Holm family size. */
export function testFamily(classes: AnalysisClass[]): { classes: string[]; composite: string[]; m: number } {
  const tested = classes.filter((c) => c.tested).map((c) => c.id);
  const composite = retrievalAnyMembers(classes);
  return { classes: tested, composite, m: tested.length + (composite.length ? 1 : 0) };
}

/** A trial's label status: --checked (check-labels output) overrides the check stored on the label line. */
export function labelStatus(line: LabelLine | undefined, checked?: { status: string }): LabelStatus {
  if (!line) return 'missing';
  if (line.status !== 'ok' || typeof line.root_cause !== 'string') return 'failed';
  if (checked) return checked.status === 'verified' ? 'verified' : 'unverified';
  return line.check?.verified ? 'verified' : 'unverified';
}

/** The class a failed trial counts under: main takes verified and unverified labels, verified_only only verified ones; mechanical counts in both. */
export function classOf(status: LabelStatus, rootCause: string | null | undefined, mode: Mode): string {
  if (status === 'verified' || status === 'mechanical' || (status === 'unverified' && mode === 'main')) return rootCause ?? UNLABELLED;
  return UNLABELLED;
}

export interface Trial {
  trial_id: string; run: string; population: string; harness: string; model: string; task: string;
  cluster: string; cell: string; hm: string; failed: boolean; status: LabelStatus | null; root_cause: string | null; regraded_pass: boolean;
  gbrain_present: boolean; gbrain_route: string | null; in_turn_calls: number | null; gstack_present: boolean;
}

interface RunsJson { runs: Record<string, { results: Array<{ results_dir: string; tasks_root?: string | null; task_sets?: string[] }> }> }

export function taskTrees(runs: RunsJson): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of Object.values(runs.runs)) for (const d of r.results) out.set(d.results_dir, `${d.tasks_root ?? '?'}:${(d.task_sets ?? []).join('+')}`);
  return out;
}

export function routeOf(g: ManifestRow['gbrain']): string | null {
  if (!g.present) return null;
  return `${g.install ?? 'mcp'}${g.route ? '/' + g.route : ''}`;
}

export interface RegradeRow { trial_id: string; grader_commit: string; original: { grade: string }; regraded: { grade: string } }

/** corpus/regrade.jsonl, refused when a row names a trial outside the manifest or the rows disagree on grader_commit. */
export function loadRegrade(path: string, manifest: ManifestRow[]): RegradeRow[] {
  const rows = readJsonl<RegradeRow>(path).sort((a, b) => sortStr(a.trial_id, b.trial_id));
  const ids = new Set(manifest.map((m) => m.trial_id));
  const unknown = rows.filter((r) => !ids.has(r.trial_id)).map((r) => r.trial_id);
  if (unknown.length) throw new Error(`${path}: ${unknown.length} trial(s) not in corpus/manifest.jsonl: ${unknown.slice(0, 5).join(', ')}`);
  const commits = [...new Set(rows.map((r) => r.grader_commit))].sort(sortStr);
  if (commits.length > 1) throw new Error(`${path}: grader_commit values differ: ${commits.join(', ')}`);
  return rows;
}

/** The analysis scope: multi-user rows on a frontier model, each with its cluster, cell and label. */
export function trialsOf(manifest: ManifestRow[], trees: Map<string, string>, labels: Map<string, LabelLine>, checked: Map<string, { status: string }>, regrade: Map<string, RegradeRow> = new Map()): Trial[] {
  return manifest.filter((m) => m.kind === 'multiuser' && m.frontier).map((m) => {
    const cluster = `${trees.get(m.results_dir) ?? m.results_dir}::${m.task}`;
    const failed = m.grade !== 'pass';
    const regraded_pass = failed && regrade.get(m.trial_id)?.regraded.grade === 'pass';
    const line = labels.get(m.trial_id);
    const status = regraded_pass ? 'mechanical' : failed ? labelStatus(line, checked.get(m.trial_id)) : null;
    return {
      trial_id: m.trial_id, run: m.run, population: m.population, harness: m.harness, model: m.model, task: m.task,
      cluster, cell: `${cluster}::${m.harness}::${m.model}`, hm: `${m.harness} x ${m.model}`, failed, status, regraded_pass,
      root_cause: regraded_pass ? GRADED_BEFORE_FIX : status === 'verified' || status === 'unverified' ? (line!.root_cause as string) : null,
      gbrain_present: !!m.gbrain?.present, gbrain_route: routeOf(m.gbrain ?? { present: false }),
      in_turn_calls: typeof m.gbrain?.in_turn_calls === 'number' ? m.gbrain.in_turn_calls : null, gstack_present: !!m.gstack_present,
    };
  }).sort((a, b) => sortStr(a.trial_id, b.trial_id));
}

const klass = (t: Trial, mode: Mode): string | null => (t.failed ? classOf(t.status!, t.root_cause, mode) : null);

export function statusCounts(trials: Trial[]): Record<LabelStatus | 'failed_trials', number> {
  const out = { failed_trials: 0, verified: 0, unverified: 0, failed: 0, missing: 0, mechanical: 0 };
  for (const t of trials) if (t.failed) { out.failed_trials++; out[t.status!]++; }
  return out;
}

// ---------- A. prevalence ----------

export interface ClassRate { id: string; trials: number; tasks: number; hm: number; rate: number | null; ci95: [number, number] | null }
export interface Prevalence { n_trials: number; n_failed: number; n_cells: number; n_clusters: number; classes: ClassRate[] }

const percentile = (sorted: Float64Array): [number, number] => [sorted[Math.floor(sorted.length * 0.025)]!, sorted[Math.ceil(sorted.length * 0.975) - 1]!];

/** Cell-weighted per-trial class rates with a task-cluster bootstrap interval. */
export function prevalence(trials: Trial[], classIds: string[], mode: Mode, seed = SEEDS.prevalence, draws = DRAWS): Prevalence {
  const k = classIds.length;
  const idx = new Map(classIds.map((c, i) => [c, i]));
  const cells = new Map<string, { cluster: string; n: number; counts: number[] }>();
  const tasks = classIds.map(() => new Set<string>()), hms = classIds.map(() => new Set<string>()), counts = classIds.map(() => 0);
  for (const t of trials) {
    const cell = cells.get(t.cell) ?? cells.set(t.cell, { cluster: t.cluster, n: 0, counts: new Array(k).fill(0) }).get(t.cell)!;
    cell.n++;
    const c = klass(t, mode);
    if (c === null) continue;
    const i = idx.get(c) ?? idx.get(OTHER);
    if (i === undefined) continue;
    cell.counts[i]!++; counts[i]!++; tasks[i]!.add(t.cluster); hms[i]!.add(t.hm);
  }
  const clusters = new Map<string, { cells: number; sums: number[] }>();
  for (const cell of cells.values()) {
    const cl = clusters.get(cell.cluster) ?? clusters.set(cell.cluster, { cells: 0, sums: new Array(k).fill(0) }).get(cell.cluster)!;
    cl.cells++;
    for (let i = 0; i < k; i++) cl.sums[i]! += cell.counts[i]! / cell.n;
  }
  const list = [...clusters.entries()].sort(([a], [b]) => sortStr(a, b)).map(([, v]) => v);
  const nCells = cells.size;
  const rates = classIds.map((_, i) => (nCells ? list.reduce((s, c) => s + c.sums[i]!, 0) / nCells : null));
  let cis: Array<[number, number] | null> = classIds.map(() => null);
  if (list.length) {
    const rng = seededRandom(seed);
    const boot = classIds.map(() => new Float64Array(draws));
    const g = list.length;
    const acc = new Float64Array(k);
    for (let d = 0; d < draws; d++) {
      acc.fill(0);
      let n = 0;
      for (let j = 0; j < g; j++) { const c = list[Math.floor(rng() * g)]!; n += c.cells; for (let i = 0; i < k; i++) acc[i]! += c.sums[i]!; }
      for (let i = 0; i < k; i++) boot[i]![d] = acc[i]! / n;
    }
    cis = boot.map((b) => percentile(b.sort()));
  }
  return {
    n_trials: trials.length, n_failed: trials.filter((t) => t.failed).length, n_cells: nCells, n_clusters: list.length,
    classes: classIds.map((id, i) => ({ id, trials: counts[i]!, tasks: tasks[i]!.size, hm: hms[i]!.size, rate: rates[i]!, ci95: cis[i]! })),
  };
}

export interface PrevalenceTables { overall: Prevalence; by_harness: Record<string, Prevalence>; by_model: Record<string, Prevalence> }

export function prevalenceTables(trials: Trial[], classIds: string[], mode: Mode): PrevalenceTables {
  const split = (key: 'harness' | 'model') => Object.fromEntries([...new Set(trials.map((t) => t[key]))].sort(sortStr).map((v) => [v, prevalence(trials.filter((t) => t[key] === v), classIds, mode)]));
  return { overall: prevalence(trials, classIds, mode), by_harness: split('harness'), by_model: split('model') };
}

export function ranking(p: Prevalence, classes: AnalysisClass[]): { ranked: ClassRate[]; repository_fixes: ClassRate[] } {
  const group = new Map(classes.map((c) => [c.id, c.group]));
  const order = (a: ClassRate, b: ClassRate) => b.tasks - a.tasks || b.hm - a.hm || b.trials - a.trials || sortStr(a.id, b.id);
  const known = p.classes.filter((c) => group.has(c.id));
  return { ranked: known.filter((c) => group.get(c.id) !== REPOSITORY_GROUP).sort(order), repository_fixes: known.filter((c) => group.get(c.id) === REPOSITORY_GROUP).sort(order) };
}

// ---------- B. gbrain prevention ----------

export interface Unit { unit: string; pair: string; cluster: string; brain: Trial[]; none: Trial[] }
export interface Pair { pair: string; run: string; harness: string; model: string; routes: string[]; units: Unit[] }

/** (run, harness, model) groups of PAIR_RUNS in default with both arms; units are the task clusters both arms ran. */
export function gbrainPairs(trials: Trial[], runs: readonly string[] = PAIR_RUNS): Pair[] {
  const out: Pair[] = [];
  for (const run of runs) {
    const rows = trials.filter((t) => t.run === run && t.population === 'default');
    for (const hm of [...new Set(rows.map((t) => t.harness + '\u0000' + t.model))].sort(sortStr)) {
      const [harness, model] = hm.split('\u0000') as [string, string];
      const mine = rows.filter((t) => t.harness === harness && t.model === model);
      const brain = mine.filter((t) => t.gbrain_present), none = mine.filter((t) => !t.gbrain_present);
      if (!brain.length || !none.length) continue;
      const pair = `${run}, ${harness}, ${model}`;
      const both = [...new Set(brain.map((t) => t.cluster))].filter((c) => none.some((t) => t.cluster === c)).sort(sortStr);
      out.push({ pair, run, harness, model, routes: [...new Set(brain.map((t) => t.gbrain_route!))].sort(sortStr),
        units: both.map((cluster) => ({ unit: `${pair} | ${cluster}`, pair, cluster, brain: brain.filter((t) => t.cluster === cluster), none: none.filter((t) => t.cluster === cluster) })) });
    }
  }
  return out;
}

/** Two-sided sign-flip permutation p over per-unit differences: draws seeded patterns, (hits + 1) / (draws + 1). */
export function signFlipP(diffs: number[], seed = SEEDS.pair_permutation, draws = DRAWS): number | null {
  if (!diffs.length) return null;
  if (diffs.every((d) => d === 0)) return 1;
  const observed = Math.abs(diffs.reduce((s, d) => s + d, 0));
  const rng = seededRandom(seed);
  let hits = 0;
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    for (const d of diffs) sum += rng() < 0.5 ? -d : d;
    if (Math.abs(sum) >= observed - 1e-12) hits++;
  }
  return (hits + 1) / (draws + 1);
}

export interface Difference { class: string; members: string[]; units: number; mean_brain: number | null; mean_none: number | null; delta: number | null; ci95: [number, number] | null; worse: number; better: number }

const rateIn = (ts: Trial[], members: readonly string[], mode: Mode) => ts.filter((t) => members.includes(klass(t, mode) ?? '')).length / ts.length;

/** The per-unit rate difference of one class, or of the union of members for a composite. */
export function difference(units: Unit[], name: string, mode: Mode, members: readonly string[] = [name]): Difference & { diffs: number[] } {
  const items = units.map((u) => ({ id: u.unit, cluster: u.unit, a: rateIn(u.none, members, mode), b: rateIn(u.brain, members, mode) }));
  const diffs = items.map((x) => x.b - x.a);
  if (!items.length) return { class: name, members: [...members], units: 0, mean_brain: null, mean_none: null, delta: null, ci95: null, worse: 0, better: 0, diffs };
  const d = clusteredPairedDelta(items, { seed: SEEDS.pair_bootstrap, draws: DRAWS });
  return { class: name, members: [...members], units: items.length, mean_brain: d.mean_b, mean_none: d.mean_a, delta: d.delta, ci95: d.ci95, worse: diffs.filter((x) => x > 0).length, better: diffs.filter((x) => x < 0).length, diffs };
}

export interface TestedRow extends Difference { tested: boolean; brain_only: boolean; gbrain_claims: string[]; p: number | null; p_holm: number | null; holm_rank: number | null; reading: string }

/** Holm across the tested rows, by ascending raw p; untested rows keep null. */
export function applyHolm<T extends { tested: boolean; p: number | null }>(rows: T[]): Array<T & { p_holm: number | null; holm_rank: number | null }> {
  const tested = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.tested && r.p !== null);
  const adjusted = holmAdjusted(tested.map(({ r }) => r.p!));
  const rank = [...tested.keys()].sort((a, b) => tested[a]!.r.p! - tested[b]!.r.p! || a - b);
  const out = rows.map((r) => ({ ...r, p_holm: null as number | null, holm_rank: null as number | null }));
  tested.forEach(({ i }, j) => { out[i]!.p_holm = adjusted[j]!; out[i]!.holm_rank = rank.indexOf(j) + 1; });
  return out;
}

export function reading(r: { tested: boolean; brain_only?: boolean; gbrain_claims: string[]; ci95: [number, number] | null; delta: number | null; p_holm: number | null }): string {
  if (r.brain_only) return 'brain-only class: brain-arm rate, descriptive, never tested';
  if (r.delta === null) return 'no paired units';
  if (!r.ci95) return 'no interval (fewer than two units)';
  if (r.ci95[0] <= 0 && r.ci95[1] >= 0) return 'no measurable difference';
  if (!r.tested) return r.delta > 0 ? 'higher in the brain arm (descriptive)' : 'lower in the brain arm (descriptive)';
  if (r.p_holm === null || r.p_holm >= ALPHA) return 'interval excludes zero but not significant after Holm';
  if (r.delta > 0) return r.gbrain_claims.length ? 'gbrain made this worse' : 'higher in the brain arm';
  return 'lower in the brain arm';
}

/** Every class, then the retrieval_any composite; Holm across the tested classes and the composite. */
export function pooledTests(units: Unit[], classes: AnalysisClass[], classIds: string[], mode: Mode): TestedRow[] {
  const meta = new Map(classes.map((c) => [c.id, c]));
  const composite = retrievalAnyMembers(classes);
  const rows = [
    ...classIds.map((c) => {
      const { diffs, ...d } = difference(units, c, mode);
      const tested = !!meta.get(c)?.tested;
      return { ...d, tested, brain_only: meta.get(c)?.group === BRAIN_GROUP, gbrain_claims: meta.get(c)?.gbrain_claims ?? [], p: tested ? signFlipP(diffs) : null };
    }),
    ...(composite.length ? [(() => {
      const { diffs, ...d } = difference(units, RETRIEVAL_ANY, mode, composite);
      return { ...d, tested: true, brain_only: false, gbrain_claims: [...new Set(composite.flatMap((c) => meta.get(c)!.gbrain_claims))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))), p: signFlipP(diffs) };
    })()] : []),
  ];
  return applyHolm(rows).map((r) => ({ ...r, reading: reading(r) }));
}

/** Group-brain classes per pair: the share of brain-arm trials in the class, and how many no-brain trials carry it. */
export function brainOnlyRates(pairs: Pair[], classes: AnalysisClass[], mode: Mode) {
  const ids = classes.filter((c) => c.group === BRAIN_GROUP).map((c) => c.id);
  return Object.fromEntries(ids.map((c) => {
    const brain = pairs.flatMap((p) => p.units.flatMap((u) => u.brain)), none = pairs.flatMap((p) => p.units.flatMap((u) => u.none));
    const count = (ts: Trial[]) => ts.filter((t) => klass(t, mode) === c).length;
    return [c, {
      brain_trials: brain.length, brain_with_class: count(brain), brain_rate: brain.length ? count(brain) / brain.length : null, no_brain_with_class: count(none),
      by_pair: Object.fromEntries(pairs.map((p) => { const b = p.units.flatMap((u) => u.brain); return [p.pair, { brain_trials: b.length, with_class: count(b), rate: b.length ? count(b) / b.length : null }]; })),
    }];
  }));
}

export interface MddRow { scope: string; units: number; trials_brain: number; trials_none: number; holm_m: number | null; rows: Array<{ p: number; se: number | null; mdd: number | null; mdd_holm_first: number | null }> }

/** MDD at an assumed per-trial class rate p: per unit p (1 - p) (1/n_brain + 1/n_none), cluster-robust over g units. */
export function mddFor(scope: string, units: Array<{ n_brain: number; n_none: number }>, holmM: number | null): MddRow {
  const g = units.length;
  const z = normalQuantile(1 - ALPHA / 2) + normalQuantile(POWER);
  const zHolm = holmM ? normalQuantile(1 - ALPHA / (2 * holmM)) + normalQuantile(POWER) : null;
  return {
    scope, units: g, trials_brain: units.reduce((s, u) => s + u.n_brain, 0), trials_none: units.reduce((s, u) => s + u.n_none, 0), holm_m: holmM,
    rows: MDD_RATES.map((p) => {
      const se = g > 1 ? Math.sqrt((g / (g - 1)) * units.reduce((s, u) => s + p * (1 - p) * (1 / u.n_brain + 1 / u.n_none), 0)) / g : null;
      return { p, se, mdd: se === null ? null : z * se, mdd_holm_first: se === null || zHolm === null ? null : zHolm * se };
    }),
  };
}

export function mddTable(pairs: Pair[], holmM: number | null): MddRow[] {
  const sizes = (us: Unit[]) => us.map((u) => ({ n_brain: u.brain.length, n_none: u.none.length }));
  return [...pairs.map((p) => mddFor(p.pair, sizes(p.units), holmM)), mddFor('pooled', sizes(pairs.flatMap((p) => p.units)), holmM)];
}

export function renderMdd(rows: MddRow[]): string {
  const pct = (x: number | null) => (x === null ? 'n/a' : (100 * x).toFixed(1));
  const holm = rows[0]?.holm_m ?? null;
  const head = ['Scope', 'Units', 'Trials (brain / none)', ...MDD_RATES.map((p) => `MDD at ${100 * p}%`), ...(holm ? MDD_RATES.map((p) => `Holm first step (m=${holm}) at ${100 * p}%`) : [])];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.scope} | ${r.units} | ${r.trials_brain} / ${r.trials_none} | ${r.rows.map((x) => pct(x.mdd)).join(' | ')}${holm ? ' | ' + r.rows.map((x) => pct(x.mdd_holm_first)).join(' | ') : ''} |`);
  return lines.join('\n') + '\n';
}

// ---------- C, D, E ----------

export function exposureSplit(trials: Trial[], classIds: string[], mode: Mode) {
  const brain = trials.filter((t) => t.population === 'default' && t.gbrain_present);
  const groups: Record<string, Trial[]> = { called: brain.filter((t) => (t.in_turn_calls ?? -1) > 0), not_called: brain.filter((t) => t.in_turn_calls === 0), unknown: brain.filter((t) => t.in_turn_calls === null) };
  return Object.fromEntries(Object.entries(groups).map(([k, ts]) => [k, { trials: ts.length, failed: ts.filter((t) => t.failed).length, classes: classIds.map((c) => { const n = ts.filter((t) => klass(t, mode) === c).length; return { id: c, trials: n, rate: ts.length ? n / ts.length : null }; }) }]));
}

export function gstackSection(trials: Trial[], sdkIndex: Array<{ trial_id: string; arm: string }>, sdkLabels: Map<string, LabelLine>) {
  const byArm: Record<string, { failed: number; status: Record<string, number>; root_cause: Record<string, number>; gstack_role: Record<string, number> }> = {};
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  for (const s of [...sdkIndex].sort((a, b) => sortStr(a.trial_id, b.trial_id))) {
    const a = byArm[s.arm] ??= { failed: 0, status: {}, root_cause: {}, gstack_role: {} };
    a.failed++;
    const l = sdkLabels.get(s.trial_id);
    const st = labelStatus(l);
    bump(a.status, st);
    if (st === 'verified' || st === 'unverified') { bump(a.root_cause, l!.root_cause as string); bump(a.gstack_role, String(l!.gstack_role ?? 'none')); }
  }
  const exposed = trials.filter((t) => t.population === 'default' && t.gstack_present).length;
  return { sdk_by_arm: Object.fromEntries(Object.entries(byArm).sort(([a], [b]) => sortStr(a, b))), multiuser_default_trials_with_gstack: exposed, verdict: exposed ? 'gstack exposed in the multi-user corpus: see section D' : 'not exposed in this corpus' };
}

export type Layer2 = 'gated' | 'gated_fallback' | 'descriptive' | 'pending';
export interface FallbackGate { file: string; status: 'passes' | 'fails' | 'not_reached'; basis: string; min_kappa: number; kappa: number | null; n: number }
export interface LabellerCheck {
  status: 'not_checked' | 'insufficient_gold' | 'passes' | 'fails'; judge: JudgeCheck | null; extra_gold_draw: string[] | null;
  fallback: FallbackGate | null; retests: Record<string, Agreement>; retest_subsets: Record<string, string[]> | null;
  step_agreement: Record<string, StepAgreement> | null; layer2: Layer2; tables: { source: 'candidate' | 'fallback'; gated: boolean };
}
export const FALLBACK_BASIS = 'gated on agreement between the two frontier labellers, not on independent gold';

interface Pool { index: Array<{ trial_id: string; population: string; harness: string; model: string; layer1_primary: string | null; packet_sha256: string | null }>; samples: { pool: { populations: string[] }; samples: Array<{ name?: string; trial_ids: string[] }> } }

/** The gold sample's trial ids from samples.json, or null when it has none. */
export function goldSampleIds(samples: Pool['samples']): string[] | null {
  return samples.samples.find((s) => s.name === 'gold')?.trial_ids ?? null;
}

/** Test-retest subsets: a seeded shuffle (seed 2024) of the gold sample; the first 100 for particle-1, the first 40 for Opus. */
export function retestSubsets(goldSample: readonly string[]): Record<keyof typeof RETEST_SIZES, string[]> {
  const ids = [...new Set(goldSample)].sort(sortStr);
  const rng = seededRandom(SEEDS.retest);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return Object.fromEntries(Object.entries(RETEST_SIZES).map(([m, n]) => [m, ids.slice(0, n)])) as Record<keyof typeof RETEST_SIZES, string[]>;
}

/** Layer-1 primary label by layer-2 class: counts of failed trials. */
export function crosstab(trials: Trial[], layer1: Map<string, string | null>, classIds: string[], mode: Mode = 'main') {
  const counts: Record<string, Record<string, number>> = {};
  for (const t of trials) {
    if (!t.failed) continue;
    const l1 = layer1.has(t.trial_id) ? layer1.get(t.trial_id) ?? 'none' : 'not in packet-index';
    const row = (counts[l1] ??= {});
    const c = klass(t, mode)!;
    row[c] = (row[c] ?? 0) + 1;
  }
  const rows = Object.keys(counts).sort(sortStr);
  const columns = classIds.filter((c) => rows.some((r) => counts[r]![c]));
  return { rows, columns, counts: Object.fromEntries(rows.map((r) => [r, Object.fromEntries(columns.filter((c) => counts[r]![c]).map((c) => [c, counts[r]![c]!]))])) };
}

const providerOf = (model: string) => (model.includes(':') ? model.split(':')[0]! : model.startsWith('claude') ? 'anthropic' : model.startsWith('gpt') ? 'openai' : model);

export interface Provenance { file: string; lines: number; models: Record<string, number>; codebook_sha256: string | null; prefix_sha256: Record<string, string> }

/** One labeller per file: refuses mixed models (the fallback: one per trial family, cross-family), codebooks or prefixes. */
export function labelProvenance(path: string, codebookSha: string, kind: 'candidate' | 'fallback', trialModel: Map<string, string>): Provenance {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').flatMap((l) => { try { const x = JSON.parse(l) as LabelLine; return x && typeof x.trial_id === 'string' ? [x] : []; } catch { return []; } }) : [];
  const fail = (why: string): never => { throw new Error(`${path}: ${why}; refusing to build tables from it`); };
  const models: Record<string, number> = {}, prefixes: Record<string, string> = {}, byFamily: Record<string, string> = {};
  const codebooks = new Set<string>();
  for (const l of lines) {
    if (typeof l.model !== 'string' || typeof l.codebook_sha256 !== 'string' || typeof l.prefix_sha256 !== 'string') fail(`line for ${l.trial_id} has no model, codebook_sha256 or prefix_sha256`);
    models[l.model] = (models[l.model] ?? 0) + 1;
    codebooks.add(l.codebook_sha256);
    if ((prefixes[l.model] ??= l.prefix_sha256) !== l.prefix_sha256) fail(`model ${l.model} has more than one prefix_sha256`);
    if (kind === 'fallback') {
      const tm = trialModel.get(l.trial_id) ?? fail(`${l.trial_id} is not in corpus/manifest.jsonl`);
      const fam = providerOf(tm);
      if (providerOf(l.model) === fam) fail(`${l.trial_id} ran on ${tm} and was labelled by ${l.model}, the same family`);
      if ((byFamily[fam] ??= l.model) !== l.model) fail(`trials run on ${fam} models are labelled by both ${byFamily[fam]} and ${l.model}`);
    }
  }
  if (kind === 'candidate' && Object.keys(models).length > 1) fail(`more than one model: ${Object.keys(models).sort(sortStr).join(', ')}`);
  if (codebooks.size > 1) fail(`more than one codebook_sha256: ${[...codebooks].sort(sortStr).map((s) => s.slice(0, 12)).join(', ')}`);
  const cb = [...codebooks][0] ?? null;
  if (cb !== null && cb !== codebookSha) fail(`codebook_sha256 ${cb.slice(0, 12)} is not sha256(--codebook) ${codebookSha.slice(0, 12)}`);
  return { file: basename(path), lines: lines.length, models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => sortStr(a, b))), codebook_sha256: cb, prefix_sha256: Object.fromEntries(Object.entries(prefixes).sort(([a], [b]) => sortStr(a, b))) };
}

export interface StepAgreement { n: number; stage: number | null; turn: number | null; seq: number | null }

function stepAgreement(x: Map<string, LabelLine>, y: Map<string, LabelLine>, ids: string[]): StepAgreement {
  const both = ids.filter((id) => x.get(id)?.status === 'ok' && y.get(id)?.status === 'ok');
  const share = (f: (l: LabelLine) => unknown) => (both.length ? both.filter((id) => JSON.stringify(f(x.get(id)!)) === JSON.stringify(f(y.get(id)!))).length / both.length : null);
  return { n: both.length, stage: share((l) => l.stage), turn: share((l) => l.first_wrong_step?.turn ?? null), seq: share((l) => l.first_wrong_step?.seq ?? null) };
}

export interface CheckFiles { goldA?: string; goldB?: string; retestA?: string; retestB?: string; retestOpusA?: string; retestOpusB?: string }

/** R78 on the candidate (the --labels file), then the fallback gate when the candidate fails; picks the tables' labels. */
export function labellerCheck(f: CheckFiles, candidate: string, fallbackFile: string | undefined, classIds: string[], pool: Pool | null): LabellerCheck {
  const retests: Record<string, Agreement> = {};
  if (f.retestA && f.retestB) retests['particle-1'] = agreement(rootCauses(f.retestA), rootCauses(f.retestB));
  if (f.retestOpusA && f.retestOpusB) retests['claude-opus-5-5'] = agreement(rootCauses(f.retestOpusA), rootCauses(f.retestOpusB));
  const sample = pool ? goldSampleIds(pool.samples) : null;
  const retest_subsets = sample ? retestSubsets(sample) : null;
  const descriptive = { source: 'candidate' as const, gated: false };
  if (!f.goldA || !f.goldB) return { status: 'not_checked', judge: null, extra_gold_draw: null, fallback: null, retests, retest_subsets, step_agreement: null, layer2: 'pending', tables: descriptive };
  const judge = judgeCheck({ goldA: f.goldA, goldB: f.goldB, candidate, classes: classIds, sample: sample ?? undefined });
  const a = readLabels(f.goldA).lines, b = readLabels(f.goldB).lines, c = readLabels(candidate).lines;
  const rcB = rootCauses(f.goldB);
  const goldIds = [...rootCauses(f.goldA)].filter(([id, rc]) => rcB.get(id) === rc).map(([id]) => id).sort(sortStr);
  const step_agreement = { gold_a_vs_gold_b: stepAgreement(a, b, [...a.keys()].sort(sortStr)), candidate_vs_gold_a_on_gold: stepAgreement(c, a, goldIds) };
  if (judge.gold.n < GOLD_MIN) {
    let draw: string[] | null = null;
    if (pool) {
      const taken = new Set(pool.samples.samples.flatMap((s) => s.trial_ids));
      const rows = pool.index.filter((r) => r.packet_sha256 && pool.samples.pool.populations.includes(r.population) && !taken.has(r.trial_id));
      draw = [...stratifiedSample(rows.map((r) => ({ trial_id: r.trial_id, stratum: `${r.layer1_primary ?? 'none'} | ${r.harness} | ${r.model}` })), EXTRA_GOLD, SEEDS.extra_gold)].sort(sortStr);
    }
    return { status: 'insufficient_gold', judge, extra_gold_draw: draw, fallback: null, retests, retest_subsets, step_agreement, layer2: 'pending', tables: descriptive };
  }
  const status = judge.gate.passes ? 'passes' : 'fails';
  const kappa = judge.gold_labellers.agreement.kappa;
  const fallback: FallbackGate | null = fallbackFile ? {
    file: basename(fallbackFile), status: status === 'passes' ? 'not_reached' : kappa !== null && kappa >= GATE.min_kappa ? 'passes' : 'fails',
    basis: FALLBACK_BASIS, min_kappa: GATE.min_kappa, kappa, n: judge.gold_labellers.agreement.n,
  } : null;
  const layer2: Layer2 = status === 'passes' ? 'gated' : fallback?.status === 'passes' ? 'gated_fallback' : fallback ? 'descriptive' : 'pending';
  const tables = layer2 === 'gated' ? { source: 'candidate' as const, gated: true } : layer2 === 'gated_fallback' ? { source: 'fallback' as const, gated: true } : descriptive;
  return { status, judge, extra_gold_draw: null, fallback, retests, retest_subsets, step_agreement, layer2, tables };
}

// ---------- the whole analysis ----------

export interface AnalyzeInputs {
  corpus: string; codebook: string; labels: string; checked?: string; sdkLabels?: string; check?: CheckFiles; regrade?: string;
  fallback?: string; fallbackChecked?: string;
}

/** What the regrade did: overrides per population and run, and the rows that changed nothing. */
export function regradeSummary(path: string, rows: RegradeRow[], trials: Trial[]) {
  const byId = new Map(trials.map((t) => [t.trial_id, t]));
  const toPass = rows.filter((r) => r.regraded.grade === 'pass');
  const overridden: Record<string, Record<string, number>> = {};
  for (const t of trials) if (t.regraded_pass) { const p = (overridden[t.population] ??= {}); p[t.run] = (p[t.run] ?? 0) + 1; }
  return {
    file: basename(path), grader_commit: rows[0]?.grader_commit ?? null, rows: rows.length,
    overridden: trials.filter((t) => t.regraded_pass).length,
    overridden_by_population_and_run: Object.fromEntries(Object.entries(overridden).sort(([a], [b]) => sortStr(a, b)).map(([p, runs]) => [p, Object.fromEntries(Object.entries(runs).sort(([a], [b]) => sortStr(a, b)))])),
    to_pass_not_counted: toPass.filter((r) => !byId.get(r.trial_id)?.regraded_pass).length,
    to_fail_unchanged: rows.filter((r) => r.regraded.grade === 'fail' && r.original.grade !== 'fail').length,
    other_unchanged: rows.filter((r) => r.regraded.grade !== 'pass' && !(r.regraded.grade === 'fail' && r.original.grade !== 'fail')).length,
  };
}

export function analyze(o: AnalyzeInputs) {
  const cb = JSON.parse(readFileSync(o.codebook, 'utf8')) as CodebookInput;
  const classes = analysisClasses(cb);
  const classIds = [...classes.map((c) => c.id), ...(classes.some((c) => c.id === GRADED_BEFORE_FIX) ? [] : [GRADED_BEFORE_FIX]), OTHER, UNLABELLED];
  const manifest = readJsonl<ManifestRow>(join(o.corpus, 'manifest.jsonl'));
  const regradePath = o.regrade ?? (existsSync(join(o.corpus, 'regrade.jsonl')) ? join(o.corpus, 'regrade.jsonl') : undefined);
  const regradeRows = regradePath ? loadRegrade(regradePath, manifest) : [];
  const trees = taskTrees(JSON.parse(readFileSync(join(o.corpus, 'runs.json'), 'utf8')) as RunsJson);
  const trialModel = new Map(manifest.map((m) => [m.trial_id, m.model]));
  const codebookSha = sha256(readFileSync(o.codebook));
  const provenance = { candidate: labelProvenance(o.labels, codebookSha, 'candidate', trialModel), fallback: o.fallback ? labelProvenance(o.fallback, codebookSha, 'fallback', trialModel) : null };
  const indexPath = join(o.corpus, 'packet-index.jsonl'), samplesPath = join(o.corpus, 'samples.json');
  const index = existsSync(indexPath) ? readJsonl<Pool['index'][number]>(indexPath) : [];
  const pool: Pool | null = index.length && existsSync(samplesPath) ? { index, samples: JSON.parse(readFileSync(samplesPath, 'utf8')) } : null;
  const E = labellerCheck(o.check ?? {}, o.labels, o.fallback, classIds, pool);
  const fromFallback = E.tables.source === 'fallback';
  const labels = readLabels(fromFallback ? o.fallback! : o.labels);
  const checkedPath = fromFallback ? o.fallbackChecked : o.checked;
  const checked = new Map(checkedPath ? readJsonl<{ trial_id: string; status: string }>(checkedPath).map((c) => [c.trial_id, c]) : []);
  const trials = trialsOf(manifest, trees, labels.lines, checked, new Map(regradeRows.map((r) => [r.trial_id, r])));
  const byPop = (p: string) => trials.filter((t) => t.population === p);
  const modes: Mode[] = ['main', 'verified_only'];

  const asPass = (ts: Trial[]) => ts.map((t) => (t.regraded_pass ? { ...t, failed: false, status: null, root_cause: null } : t));
  const prev = Object.fromEntries(POPULATIONS.map((p) => [p, { ...Object.fromEntries(modes.map((m) => [m, prevalenceTables(byPop(p), classIds, m)])), regraded_as_pass: prevalenceTables(asPass(byPop(p)), classIds, 'main') }])) as Record<string, Record<Table, PrevalenceTables>>;
  const rank = ranking(prev.default!.main.overall, classes);
  const layer1 = new Map(index.map((r) => [r.trial_id, r.layer1_primary]));
  const cross = { default: crosstab(byPop('default'), layer1, classIds), variant: crosstab(byPop('variant'), layer1, classIds) };

  const pairs = gbrainPairs(trials);
  const units = pairs.flatMap((p) => p.units);
  const family = testFamily(classes);
  const holmM = family.m || null;
  const strip = ({ diffs: _, ...d }: Difference & { diffs: number[] }) => d;
  const routes = [...new Set(pairs.flatMap((p) => p.routes))].sort(sortStr);
  const B = {
    pairs: pairs.map((p) => ({ pair: p.pair, routes: p.routes, units: p.units.length, trials_brain: p.units.reduce((s, u) => s + u.brain.length, 0), trials_none: p.units.reduce((s, u) => s + u.none.length, 0) })),
    tested_classes: family.classes, retrieval_any: family.composite, holm_m: family.m,
    pooled: Object.fromEntries(modes.map((m) => [m, pooledTests(units, classes, classIds, m)])),
    brain_only: brainOnlyRates(pairs, classes, 'main'),
    by_pair: Object.fromEntries(pairs.map((p) => [p.pair, [...classIds.map((c) => strip(difference(p.units, c, 'main'))), ...(family.composite.length ? [strip(difference(p.units, RETRIEVAL_ANY, 'main', family.composite))] : [])]])),
    by_route: Object.fromEntries(routes.map((r) => {
      const us = pairs.flatMap((p) => p.units.map((u) => ({ ...u, brain: u.brain.filter((t) => t.gbrain_route === r) }))).filter((u) => u.brain.length);
      return [r, [...classIds.map((c) => strip(difference(us, c, 'main'))), ...(family.composite.length ? [strip(difference(us, RETRIEVAL_ANY, 'main', family.composite))] : [])]];
    })),
    mdd: mddTable(pairs, holmM),
  };
  const C = exposureSplit(trials, classIds, 'main');
  const sdkIndexPath = join(o.corpus, 'sdk-packet-index.jsonl');
  const sdkIndex = existsSync(sdkIndexPath) ? readJsonl<{ trial_id: string; arm: string; packet_sha256: string | null }>(sdkIndexPath).filter((s) => s.packet_sha256) : [];
  const Dsec = gstackSection(trials, sdkIndex, o.sdkLabels ? readLabels(o.sdkLabels).lines : new Map());
  const tablesNote = E.layer2 === 'gated' ? 'gated: the candidate passed R78 on gold' : E.layer2 === 'gated_fallback' ? `fallback labels, ${FALLBACK_BASIS}` : 'DESCRIPTIVE: no labeller passed its check, so no verdict rests on these tables';

  const files: Array<[string, string | undefined]> = [['manifest.jsonl', join(o.corpus, 'manifest.jsonl')], ['runs.json', join(o.corpus, 'runs.json')], ['packet-index.jsonl', index.length ? indexPath : undefined], ['samples.json', pool ? samplesPath : undefined], ['codebook', o.codebook], ['labels', o.labels], ['checked', o.checked], ['fallback', o.fallback], ['fallback checked', o.fallbackChecked], ['sdk-packet-index.jsonl', existsSync(sdkIndexPath) ? sdkIndexPath : undefined], ['sdk labels', o.sdkLabels], ['regrade', regradePath], ...Object.entries(o.check ?? {}).map(([k, v]) => [k, v] as [string, string | undefined])];
  return {
    analysis_version: ANALYSIS_VERSION,
    inputs: Object.fromEntries(files.filter(([, p]) => p && existsSync(p)).map(([k, p]) => [k, { file: basename(p!), sha256: sha256(readFileSync(p!)) }])),
    constants: { seeds: SEEDS, draws: DRAWS, alpha: ALPHA, power: POWER, mdd_rates: MDD_RATES, gold_min: GOLD_MIN, extra_gold: EXTRA_GOLD, retest_sizes: RETEST_SIZES, pair_runs: PAIR_RUNS, scope: 'manifest rows of kind multiuser on a frontier model' },
    tables: { source: E.tables.source, file: basename(fromFallback ? o.fallback! : o.labels), gated: E.tables.gated, layer2: E.layer2, note: tablesNote },
    provenance,
    classes,
    label_status: Object.fromEntries(POPULATIONS.map((p) => [p, statusCounts(byPop(p))])),
    malformed_label_lines: labels.malformed,
    regrade: regradePath ? regradeSummary(regradePath, regradeRows, trials) : null,
    A: { populations: prev, ranking: rank.ranked.map((c) => c.id), repository_fixes: rank.repository_fixes.map((c) => c.id), crosstab: cross },
    B, C, D: Dsec, E,
    verdicts: { gbrain: E.layer2 === 'gated' ? 'see B (labeller gated)' : E.layer2 === 'gated_fallback' ? `see B (fallback labeller, ${FALLBACK_BASIS})` : `descriptive only (labeller check: ${E.status})`, gstack: Dsec.verdict },
  };
}

export type Analysis = ReturnType<typeof analyze>;

const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(d));
const ci = (c: [number, number] | null) => (c ? `[${pct(c[0])}, ${pct(c[1])}]` : 'n/a');
const p4 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(4));

export function renderMarkdown(a: Analysis): string {
  const out: string[] = ['# Failure mining: layer-2 analysis', '', `Analysis ${a.analysis_version}. Rates are per-trial percentages with 95% intervals. Main analysis: verified and unverified labels; sensitivity: verified only.`, '', `Tables: ${a.tables.source} labels (${a.tables.file}); ${a.tables.note}.`, ''];
  out.push('## Label status', '', '| Population | Failed trials | Verified | Unverified | Failed | Missing | Mechanical |', '|---|---|---|---|---|---|---|');
  for (const [p, s] of Object.entries(a.label_status)) out.push(`| ${p} | ${s.failed_trials} | ${s.verified} | ${s.unverified} | ${s.failed} | ${s.missing} | ${s.mechanical} |`);
  out.push('');
  if (a.regrade) {
    const g = a.regrade;
    out.push('## Regrade', '', `${g.file} at grader commit ${g.grader_commit ?? 'n/a'}: ${g.rows} rows. ${g.overridden} failed trials in scope regrade to pass and are labelled ${GRADED_BEFORE_FIX} (mechanical); ${g.to_pass_not_counted} rows to pass are out of scope or were not failures; ${g.to_fail_unchanged} rows to fail and ${g.other_unchanged} other rows change nothing.`, '', '| Population | Run | Overridden |', '|---|---|---|');
    for (const [p, runs] of Object.entries(g.overridden_by_population_and_run)) for (const [run, n] of Object.entries(runs)) out.push(`| ${p} | ${run} | ${n} |`);
    out.push('');
  }
  const prevTable = (title: string, p: Prevalence) => {
    out.push(`### ${title}`, '', `${p.n_trials} trials (${p.n_failed} failed) in ${p.n_cells} cells and ${p.n_clusters} task clusters.`, '', '| Class | Trials | Tasks | Harness x model | Rate | 95% interval |', '|---|---|---|---|---|---|');
    for (const c of p.classes) out.push(`| ${c.id} | ${c.trials} | ${c.tasks} | ${c.hm} | ${pct(c.rate)} | ${ci(c.ci95)} |`);
    out.push('');
  };
  out.push('## A. Prevalence', '', `Ranking (default, main; tasks, then harness x model pairs, then trials): ${a.A.ranking.join(', ') || 'none'}. Repository fixes (group task_or_grader): ${a.A.repository_fixes.join(', ') || 'none'}.`, '');
  const splitTable = (title: string, by: Record<string, Prevalence>) => {
    const keys = Object.keys(by);
    out.push(`### ${title}`, '', `| Class | ${keys.join(' | ')} |`, `|---|${keys.map(() => '---').join('|')}|`);
    for (const [i, id] of (by[keys[0]!]?.classes ?? []).map((c) => c.id).entries()) out.push(`| ${id} | ${keys.map((k) => `${pct(by[k]!.classes[i]!.rate)} ${ci(by[k]!.classes[i]!.ci95)}`).join(' | ')} |`);
    out.push('');
  };
  for (const p of POPULATIONS) {
    const t = a.A.populations[p]!;
    prevTable(`${p}, main`, t.main.overall);
    prevTable(`${p}, verified only`, t.verified_only.overall);
    if (a.regrade) prevTable(`${p}, main, regraded trials as passes`, t.regraded_as_pass.overall);
    if (p === 'default') { splitTable('default, main, by harness', t.main.by_harness); splitTable('default, main, by model', t.main.by_model); }
  }
  for (const p of ['default', 'variant'] as const) {
    const x = a.A.crosstab[p];
    out.push(`### Layer-1 primary label by layer-2 class, ${p}, main`, '', `| Layer 1 | ${x.columns.join(' | ')} |`, `|---|${x.columns.map(() => '---').join('|')}|`);
    for (const r of x.rows) out.push(`| ${r} | ${x.columns.map((c) => x.counts[r]![c] ?? 0).join(' | ')} |`);
    out.push('');
  }
  out.push(`## B. gbrain prevention${a.tables.gated ? '' : ' (descriptive: no labeller passed its check)'}`, '', '| Pair | Routes | Units | Trials (brain / none) |', '|---|---|---|---|');
  for (const p of a.B.pairs) out.push(`| ${p.pair} | ${p.routes.join(', ')} | ${p.units} | ${p.trials_brain} / ${p.trials_none} |`);
  out.push('', `Tested family (Holm, m = ${a.B.holm_m}): ${[...a.B.tested_classes, ...(a.B.retrieval_any.length ? [`${RETRIEVAL_ANY} (${a.B.retrieval_any.join(', ')})`] : [])].join(', ') || 'none'}.`, '');
  for (const m of ['main', 'verified_only'] as Mode[]) {
    out.push(`### Pooled, ${m === 'main' ? 'main' : 'verified only'}`, '', '| Class | Tested | Units | Brain | No brain | Difference | 95% interval | Units worse | p | Holm p | Reading |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of a.B.pooled[m]!) out.push(`| ${r.class} | ${r.tested ? 'yes' : 'no'} | ${r.units} | ${pct(r.mean_brain)} | ${pct(r.mean_none)} | ${pct(r.delta)} | ${ci(r.ci95)} | ${r.worse} | ${p4(r.p)} | ${p4(r.p_holm)} | ${r.reading} |`);
    out.push('');
  }
  const diffTable = (title: string, rows: Difference[]) => {
    out.push(`### ${title} (descriptive)`, '', '| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |', '|---|---|---|---|---|---|---|');
    for (const r of rows) out.push(`| ${r.class} | ${r.units} | ${pct(r.mean_brain)} | ${pct(r.mean_none)} | ${pct(r.delta)} | ${ci(r.ci95)} | ${r.worse} |`);
    out.push('');
  };
  out.push('### Brain-only classes: brain-arm rates (descriptive, never tested)', '', '| Class | Brain trials | With class | Rate | No-brain trials with class |', '|---|---|---|---|---|');
  for (const [c, v] of Object.entries(a.B.brain_only)) out.push(`| ${c} | ${v.brain_trials} | ${v.brain_with_class} | ${pct(v.brain_rate)} | ${v.no_brain_with_class} |`);
  out.push('');
  for (const [k, rows] of Object.entries(a.B.by_pair)) diffTable(`Pair ${k}`, rows);
  for (const [k, rows] of Object.entries(a.B.by_route)) diffTable(`Install route ${k}`, rows);
  out.push('### Minimum detectable difference', '', renderMdd(a.B.mdd));
  out.push('## C. Brain called or not (descriptive)', '', '| Group | Trials | Failed |', '|---|---|---|');
  for (const [k, v] of Object.entries(a.C)) out.push(`| ${k} | ${v.trials} | ${v.failed} |`);
  out.push('', '## D. gstack (descriptive)', '', `Verdict: ${a.D.verdict}. Multi-user default trials with gstack: ${a.D.multiuser_default_trials_with_gstack}.`, '');
  for (const [arm, v] of Object.entries(a.D.sdk_by_arm)) out.push(`- ${arm}: ${v.failed} failed SDK sessions; root causes ${JSON.stringify(v.root_cause)}; gstack_role ${JSON.stringify(v.gstack_role)}`);
  out.push('', '## E. Labeller check (R78)', '', `Candidate: ${a.E.status}; layer 2: ${a.E.layer2}.`);
  if (a.E.judge) {
    const j = a.E.judge, g = j.gold_labellers.agreement;
    out.push(`Gold n ${j.gold.n}. Candidate kappa ${p4(j.candidate.agreement.kappa)} over all ${j.candidate.n} gold trials (${j.candidate.labelled} labelled, coverage ${p4(j.candidate.coverage)}; an unlabelled gold trial counts as a disagreement). Gold labellers kappa ${p4(g.kappa)} over the ${g.n}-trial gold sample (${g.x_labelled} and ${g.y_labelled} labelled; a missing label is a disagreement).`, '', '| Class | Gold | Labelled | Catch rate | Others | Others labelled | False-assignment rate |', '|---|---|---|---|---|---|---|');
    for (const c of j.candidate.per_class) out.push(`| ${c.class} | ${c.gold} | ${c.labelled} | ${p4(c.catch_rate)} | ${c.others} | ${c.others_labelled} | ${p4(c.false_assignment_rate)} |`);
    out.push('');
  }
  const fb = a.E.fallback;
  if (fb) out.push(fb.status === 'passes' ? `Fallback (${fb.file}): passes, ${fb.basis} (kappa ${p4(fb.kappa)} over ${fb.n}, at least ${fb.min_kappa}).` : fb.status === 'fails' ? `Fallback (${fb.file}): fails; the two frontier labellers' kappa is ${p4(fb.kappa)} over ${fb.n}, under ${fb.min_kappa}.` : `Fallback (${fb.file}): not reached; the candidate passed.`);
  if (a.E.retest_subsets) out.push(`Test-retest subsets (seed ${SEEDS.retest}): ${Object.entries(a.E.retest_subsets).map(([m, ids]) => `${m} ${ids.length}`).join(', ')} (listed in analysis.json; analyze.ts --retest-ids prints them).`);
  if (a.E.extra_gold_draw) out.push(`Fewer than ${GOLD_MIN} gold items: ${a.E.extra_gold_draw.length} more trials drawn with seed ${SEEDS.extra_gold} for both gold labellers (listed in analysis.json).`);
  for (const [k, v] of Object.entries(a.E.retests)) out.push(`Test-retest ${k}: n ${v.n}, agreement ${p4(v.raw_agreement)}, kappa ${p4(v.kappa)}.`);
  out.push('', '## Verdicts', '', `- gbrain: ${a.verdicts.gbrain}`, `- gstack: ${a.verdicts.gstack}`, '');
  return out.join('\n');
}

/** Section B's MDD table from the manifest alone (no labels), for the preregistration. */
export function mddOnly(corpus: string, holmM: number | null): MddRow[] {
  const manifest = readJsonl<ManifestRow>(join(corpus, 'manifest.jsonl'));
  const trees = taskTrees(JSON.parse(readFileSync(join(corpus, 'runs.json'), 'utf8')) as RunsJson);
  return mddTable(gbrainPairs(trialsOf(manifest, trees, new Map(), new Map())), holmM);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(import.meta.dir, '..', '..');
  const corpus = one('corpus') ?? join(root, 'docs/benchmarks/2026-11-09-failure-mining/corpus');
  const codebook = one('codebook');
  if (argv.includes('--mdd')) {
    const holmM = one('holm-m') ? Number(one('holm-m')) : codebook ? testFamily(analysisClasses(JSON.parse(readFileSync(codebook, 'utf8')))).m || null : null;
    process.stdout.write(renderMdd(mddOnly(corpus, holmM)));
    process.exit(0);
  }
  if (argv.includes('--retest-ids')) {
    const gold = goldSampleIds(JSON.parse(readFileSync(join(corpus, 'samples.json'), 'utf8')));
    if (!gold) { console.error(`${join(corpus, 'samples.json')} has no gold sample`); process.exit(2); }
    for (const [model, ids] of Object.entries(retestSubsets(gold))) for (const id of ids) process.stdout.write(`${model}\t${id}\n`);
    process.exit(0);
  }
  const labels = one('labels'), out = one('out');
  if (!codebook || !labels || !out) {
    console.error('usage: bun scripts/failure-mining/analyze.ts --codebook <codebook.json> --labels <candidate labels.jsonl> --out <dir> [--corpus <dir>] [--checked <checked.jsonl>] [--sdk-labels <labels.jsonl>] [--gold-a <a> --gold-b <b>] [--retest-a <a> --retest-b <b>] [--retest-opus-a <a> --retest-opus-b <b>] [--fallback <labels> [--fallback-checked <checked.jsonl>]] [--regrade <regrade.jsonl>]\n       bun scripts/failure-mining/analyze.ts --mdd [--corpus <dir>] [--codebook <codebook.json> | --holm-m <m>]\n       bun scripts/failure-mining/analyze.ts --retest-ids [--corpus <dir>]');
    process.exit(2);
  }
  if (one('candidate')) { console.error('--candidate is gone: the candidate is the --labels file, gold-sample trials included'); process.exit(2); }
  let a: Analysis;
  try {
    a = analyze({ corpus, codebook, labels, checked: one('checked'), sdkLabels: one('sdk-labels'), fallback: one('fallback'), fallbackChecked: one('fallback-checked'), check: { goldA: one('gold-a'), goldB: one('gold-b'), retestA: one('retest-a'), retestB: one('retest-b'), retestOpusA: one('retest-opus-a'), retestOpusB: one('retest-opus-b') }, regrade: one('regrade') });
  } catch (e) {
    console.error(`analyze: ${(e as Error).message}`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'analysis.json'), JSON.stringify(a, null, 1) + '\n');
  writeFileSync(join(out, 'analysis.md'), renderMarkdown(a));
  console.log(`analysis written to ${join(out, 'analysis.json')} and analysis.md; layer 2 ${a.E.layer2}; gbrain: ${a.verdicts.gbrain}; gstack: ${a.verdicts.gstack}`);
}
