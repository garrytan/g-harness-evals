#!/usr/bin/env bun
// Frozen analysis for the QM S1 edition rerun (qm-s1-edition, internal-task-a, internal-task-b plan decision 1 as approved: the cost
// clause is report-only).
//
//   bun harnesses/qm/gstack/edition-analysis.ts --turns <turns.jsonl> --grades <grades.jsonl> --tasks <n> --reps <n> --out <dir>
//
// Input: the driver's turn records (one JSON line per trial) and edition-grade.ts's grades (one line per trial_id).
// Output: <dir>/edition-analysis.json and <dir>/edition-analysis.md, and the verdict line on stdout.
//
// - Outcome per trial: model_error and infra_error are excluded (and counted); every other status that is not ok
//   (turn_error, context_length, timeout) is a failure; an ok trial takes its grade. When a cell (model, arm, task,
//   repetition) has more than one record, the first record counts unless it ended infra_error, in which case the first
//   rerun counts (the preregistration allows one rerun, of an infra_error only). Every other record is listed as a
//   rerun problem and does not count; its spend still counts.
// - Completeness: the verdict is INCOMPLETE, not KEEP or CUT, unless every model has a counted record for every
//   task in both edition and plain, with the design's repetition count in each and the design's task count overall. A cap stop leaves trials without a
//   record, so a capped run is INCOMPLETE.
// - Primary endpoint: task success, edition minus plain. Per model, each task's mean over its valid trials in each arm
//   (unequal repetitions are fine), paired by task. Pooled, each task's difference is averaged over the models that
//   have it. Two-sided sign-flip permutation p over task clusters and a task-clustered bootstrap 95 percent interval,
//   10,000 draws, seed 7 (runner/stats/paired.ts clusteredPairedDelta).
// - Verdict: KEEP only if the run is complete, the pooled difference is above 0 with p below 0.05 AND each model's
//   point estimate is at least 0. A complete run that misses any of these is CUT.
// - Descriptive, never part of the verdict: opens, complete reads, first steps, approvals answered, contamination, the
//   forced-exposure arm against plain and against edition, success by family, cost per task and per success, tokens,
//   reply length, wall time and the exclusion rate per arm (a gap above 5 points between edition and plain is flagged).
//   Cost counts every metered attempt, superseded and excluded ones included: cost per task is the cell's total USD
//   over its counted trials, cost per success the same total over its successes.
// - The graders each trial used are reported, and plan-family results say "named" rather than "respected" when any
//   plan grade came from the deterministic alias judge.
//
// Frozen surface: FROZEN_PATHS below, pinned by the preregistration's merge commit (its Pins table).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, seededRandom, type PairedItem } from '../../../runner/stats/paired.ts';
import { pairTaskMeans, type TrialValue } from '../../../runner/stats/task-means.ts';

export const ANALYSIS_VERSION = 'edition-analysis/1';
export const SEED = 7;
export const DRAWS = 10000;
export const ALPHA = 0.05;
export const EXCLUSION_GAP_FLAG = 0.05;
const EPS = 1e-12;
export const MODELS = ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol'] as const;
export const ARMS = ['edition', 'plain', 'forced'] as const;
export const STATUSES = ['ok', 'turn_error', 'model_error', 'infra_error', 'context_length', 'timeout'] as const;
export const EXCLUDED_STATUSES: readonly string[] = ['model_error', 'infra_error'];
export const FROZEN_PATHS = [
  'harnesses/qm/gstack/edition-analysis.ts',
  'harnesses/qm/gstack/edition-grade.ts',
  'harnesses/qm/gstack/edition-fixture.ts',
  'harnesses/qm/gstack/s1e-count.ts',
  'harnesses/qm/gstack/s1e-probe.ts',
  'runner/stats/paired.ts',
  'runner/stats/task-means.ts',
] as const;

export interface TurnRecord {
  trial_id: string; task_id: string; family: string; arm: string; model: string; rep: number; status: string; reply_text?: string;
  counts?: { open_matched?: boolean | null; open_any?: boolean | null; complete_read?: unknown; first_step?: boolean | null; approvals_answered?: number | null; contaminated?: boolean | null } | null;
  usage?: { usd?: number; input_tokens?: number; output_tokens?: number; cached_tokens?: number; cache_write_tokens?: number; requests?: number } | null;
  wall_s?: number | null;
}
export interface GradeRecord { trial_id: string; success: boolean; reply_chars?: number; final_chars?: number; grader?: string; family?: string }
interface Trial { t: TurnRecord; outcome: 0 | 1 | null; reply_chars: number; final_chars: number | null }

export interface Delta { n_tasks: number; mean_a: number; mean_b: number; delta: number; ci95: [number, number] | null; p_two_sided: number; p_method: string; dropped: string[] }
export interface Comparison { a: string; b: string; per_model: Record<string, Delta | null>; pooled: Delta | null }

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const bit = (v: unknown) => (v === null || v === undefined ? null : v ? 1 : 0);

function delta(pairs: PairedItem[], dropped: string[]): Delta | null {
  if (!pairs.length) return null;
  const d = clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS });
  return { n_tasks: d.n_clusters, mean_a: d.mean_a, mean_b: d.mean_b, delta: d.delta, ci95: d.ci95, p_two_sided: d.p_two_sided, p_method: d.p_method, dropped };
}

/** b minus a on task success, per model and pooled over models (each task's difference averaged over its models). */
export function compare(trials: Trial[], a: string, b: string, models: readonly string[]): Comparison {
  const perModel: Record<string, Delta | null> = {};
  const byTask = new Map<string, Array<{ a: number; b: number }>>();
  for (const m of models) {
    const rows = (arm: string): TrialValue[] => trials.filter((x) => x.t.model === m && x.t.arm === arm).map((x) => ({ task: x.t.task_id, trial: x.t.rep, value: x.outcome }));
    const ra = rows(a), rb = rows(b);
    const valid = (rs: TrialValue[]) => rs.some((r) => r.value !== null);
    if (!valid(ra) || !valid(rb)) { perModel[m] = null; continue; }
    let pairing;
    try { pairing = pairTaskMeans(ra, rb, { min_trials: 1, on_missing: 'drop_task' }); } catch { perModel[m] = null; continue; }
    perModel[m] = delta(pairing.pairs, pairing.dropped.map((d) => d.task));
    for (const p of pairing.pairs) { const l = byTask.get(p.cluster) ?? []; l.push({ a: p.a, b: p.b }); byTask.set(p.cluster, l); }
  }
  const pooledPairs = [...byTask.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([task, l]): PairedItem => ({ id: task, cluster: task, a: mean(l.map((x) => x.a))!, b: mean(l.map((x) => x.b))! }));
  return { a, b, per_model: perModel, pooled: delta(pooledPairs, []) };
}

function rateWithInterval(trials: Trial[], f: (x: Trial) => number | null) {
  const by = new Map<string, { sum: number; count: number }>();
  for (const x of trials) { const v = f(x); if (v === null) continue; const c = by.get(x.t.task_id) ?? { sum: 0, count: 0 }; c.sum += v; c.count += 1; by.set(x.t.task_id, c); }
  const cl = [...by.entries()].sort(([p], [q]) => (p < q ? -1 : 1)).map(([, c]) => c);
  const k = cl.reduce((s, c) => s + c.sum, 0), n = cl.reduce((s, c) => s + c.count, 0);
  if (!n) return { k, n, rate: null, ci95: null };
  if (cl.length < 2) return { k, n, rate: k / n, ci95: null };
  const rng = seededRandom(SEED), boot: number[] = [];
  for (let i = 0; i < DRAWS; i++) { let s = 0, c = 0; for (let j = 0; j < cl.length; j++) { const x = cl[Math.floor(rng() * cl.length)]!; s += x.sum; c += x.count; } boot.push(s / c); }
  boot.sort((p, q) => p - q);
  return { k, n, rate: k / n, ci95: [boot[Math.floor(DRAWS * 0.025)]!, boot[Math.ceil(DRAWS * 0.975) - 1]!] as [number, number] };
}
const count = (trials: Trial[], f: (x: Trial) => number | null) => { const vs = trials.map(f).filter((v): v is number => v !== null); return { k: vs.reduce((s, v) => s + v, 0), n: vs.length }; };

function cell(all: Trial[], spent: TurnRecord[]) {
  const valid = all.filter((x) => x.outcome !== null);
  const statuses = Object.fromEntries(STATUSES.map((s) => [s, all.filter((x) => x.t.status === s).length]));
  const usd = (xs: Trial[]) => xs.reduce((s, x) => s + (x.t.usage?.usd ?? 0), 0);
  const success = rateWithInterval(valid, (x) => x.outcome);
  const spentUsd = spent.reduce((s, t) => s + (t.usage?.usd ?? 0), 0);
  const families = [...new Set(valid.map((x) => x.t.family))].sort();
  return {
    trials: all.length, excluded: all.length - valid.length, exclusion_rate: all.length ? (all.length - valid.length) / all.length : null, statuses,
    valid: valid.length, success,
    open_matched: count(valid, (x) => bit(x.t.counts?.open_matched)), open_any: count(valid, (x) => bit(x.t.counts?.open_any)),
    complete_read: count(valid, (x) => bit(x.t.counts?.complete_read)), first_step: count(valid, (x) => bit(x.t.counts?.first_step)),
    approvals_answered: valid.reduce((s, x) => s + (x.t.counts?.approvals_answered ?? 0), 0),
    contaminated: all.filter((x) => x.t.counts?.contaminated).map((x) => x.t.trial_id).sort(),
    usd_all_attempts: spentUsd, usd_counted: usd(all), attempts: spent.length,
    cost_per_task: all.length ? spentUsd / all.length : null,
    cost_per_success: success.k ? spentUsd / success.k : null,
    tokens: { input: valid.reduce((s, x) => s + (x.t.usage?.input_tokens ?? 0), 0), output: valid.reduce((s, x) => s + (x.t.usage?.output_tokens ?? 0), 0), cached: valid.reduce((s, x) => s + (x.t.usage?.cached_tokens ?? 0), 0), cache_write: valid.reduce((s, x) => s + (x.t.usage?.cache_write_tokens ?? 0), 0) },
    reply_chars: { mean: mean(valid.map((x) => x.reply_chars)), median: median(valid.map((x) => x.reply_chars)) },
    final_chars: { mean: mean(valid.map((x) => x.final_chars).filter((v): v is number => v !== null)) },
    wall_s: { mean: mean(valid.map((x) => x.t.wall_s).filter((v): v is number => typeof v === 'number')) },
    by_family: Object.fromEntries(families.map((f) => [f, count(valid.filter((x) => x.t.family === f), (x) => x.outcome)])),
  };
}

export interface Analysis {
  version: string; seed: number; draws: number; alpha: number; models: string[];
  records: number; trials: number; reruns: Array<{ kept: string; superseded: string; superseded_status: string }>; rerun_problems: string[];
  primary: Comparison; verdict: 'KEEP' | 'CUT' | 'INCOMPLETE'; verdict_reasons: string[]; missing: string[];
  graders: Record<string, Record<string, number>>; plan_judge_fallback: boolean;
  by_family: Record<string, Comparison>;
  forced: { vs_plain: Comparison; vs_edition: Comparison };
  cells: Record<string, ReturnType<typeof cell>>;
  exclusion_gap: Record<string, { edition: number | null; plain: number | null; gap: number | null; flagged: boolean }>;
}

/** The whole frozen analysis over turn records and grades. Throws on records it cannot place. */
export function analyze(turns: TurnRecord[], grades: GradeRecord[], options: { models?: readonly string[]; tasks: number; reps: number }): Analysis {
  const models = [...(options.models ?? MODELS)];
  const gradeOf = new Map(grades.map((g) => [g.trial_id, g]));
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const t of turns) {
    if (ids.has(t.trial_id)) problems.push('trial_id ' + t.trial_id + ' repeats');
    ids.add(t.trial_id);
    if (!(ARMS as readonly string[]).includes(t.arm)) problems.push(t.trial_id + ': unknown arm ' + t.arm);
    if (!models.includes(t.model)) problems.push(t.trial_id + ': unknown model ' + t.model);
    if (!(STATUSES as readonly string[]).includes(t.status)) problems.push(t.trial_id + ': unknown status ' + t.status);
    if (!Number.isSafeInteger(t.rep)) problems.push(t.trial_id + ': rep must be an integer');
    if (t.status === 'ok' && !gradeOf.has(t.trial_id)) problems.push(t.trial_id + ': an ok trial has no grade');
  }
  if (problems.length) throw new Error('edition-analysis: ' + problems.join('; '));
  const first = new Map<string, TurnRecord>();
  const counted = new Map<string, TurnRecord>();
  const reruns: Analysis['reruns'] = [];
  const rerunProblems: string[] = [];
  for (const t of turns) {
    const cellKey = [t.model, t.arm, t.task_id, t.rep].join('|');
    const head = first.get(cellKey);
    if (!head) { first.set(cellKey, t); counted.set(cellKey, t); continue; }
    if (counted.get(cellKey) === head && head.status === 'infra_error') { reruns.push({ kept: t.trial_id, superseded: head.trial_id, superseded_status: head.status }); counted.set(cellKey, t); continue; }
    rerunProblems.push(t.trial_id + ' does not count: ' + cellKey + ' already counts ' + counted.get(cellKey)!.trial_id + (head.status === 'infra_error' ? ', its one rerun' : ', which ended ' + head.status + ', not infra_error'));
  }
  const latest = counted;
  const trials: Trial[] = [...latest.values()].map((t) => {
    const g = gradeOf.get(t.trial_id);
    const outcome = EXCLUDED_STATUSES.includes(t.status) ? null : t.status === 'ok' ? (g!.success ? 1 : 0) : 0;
    return { t, outcome, reply_chars: g?.reply_chars ?? (t.reply_text ?? '').length, final_chars: g?.final_chars ?? null };
  });

  const graders: Analysis['graders'] = {};
  for (const x of trials) { const g = gradeOf.get(x.t.trial_id); if (!g?.grader) continue; const f = (graders[x.t.family] ??= {}); f[g.grader] = (f[g.grader] ?? 0) + 1; }
  const planJudgeFallback = Object.keys(graders.plan ?? {}).some((g) => g.endsWith('+alias-judge/1'));
  const primary = compare(planJudgeFallback ? trials.filter((x) => x.t.family !== 'plan') : trials, 'plain', 'edition', models);
  const taskIds = [...new Set(trials.map((x) => x.t.task_id))].sort();
  const missing: string[] = [];
  if (taskIds.length !== options.tasks) missing.push(taskIds.length + ' tasks have records; the design has ' + options.tasks);
  const perCell = new Map<string, number>();
  for (const t of latest.values()) { const k = [t.model, t.arm, t.task_id].join('|'); perCell.set(k, (perCell.get(k) ?? 0) + 1); }
  for (const m of models) for (const arm of ['plain', 'edition']) for (const task of taskIds) { const n = perCell.get([m, arm, task].join('|')) ?? 0; if (n !== options.reps) missing.push([m, arm, task].join('|') + ': ' + n + ' of ' + options.reps + ' repetitions'); }
  const reasons: string[] = [];
  if (!primary.pooled) reasons.push('no task has valid trials in both arms');
  else {
    if (!(primary.pooled.delta > EPS)) reasons.push('the pooled difference is ' + primary.pooled.delta.toFixed(4) + ', not above 0');
    if (!(primary.pooled.p_two_sided < ALPHA)) reasons.push('the pooled sign-flip p is ' + primary.pooled.p_two_sided.toFixed(4) + ', not below ' + ALPHA);
  }
  for (const m of models) {
    const d = primary.per_model[m];
    if (!d) reasons.push(m + ' has no comparison');
    else if (d.delta < -EPS) reasons.push(m + "'s point estimate is " + d.delta.toFixed(4) + ', below 0');
  }
  const families = [...new Set(trials.map((x) => x.t.family))].sort();
  const cells: Analysis['cells'] = {};
  for (const m of [...models, 'pooled']) for (const arm of ARMS) {
    const xs = trials.filter((x) => (m === 'pooled' || x.t.model === m) && x.t.arm === arm);
    if (xs.length) cells[m + '/' + arm] = cell(xs, turns.filter((t) => (m === 'pooled' || t.model === m) && t.arm === arm));
  }
  const exclusionGap: Analysis['exclusion_gap'] = {};
  for (const m of [...models, 'pooled']) {
    const e = cells[m + '/edition']?.exclusion_rate ?? null, p = cells[m + '/plain']?.exclusion_rate ?? null;
    const gap = e === null || p === null ? null : e - p;
    exclusionGap[m] = { edition: e, plain: p, gap, flagged: gap !== null && Math.abs(gap) > EXCLUSION_GAP_FLAG + EPS };
  }
  return {
    version: ANALYSIS_VERSION, seed: SEED, draws: DRAWS, alpha: ALPHA, models,
    records: turns.length, trials: trials.length, reruns, rerun_problems: rerunProblems,
    primary, verdict: missing.length ? 'INCOMPLETE' : reasons.length ? 'CUT' : 'KEEP', verdict_reasons: missing.length ? ['the run is incomplete: ' + missing.length + ' design cells have no counted record'] : reasons, missing,
    graders, plan_judge_fallback: planJudgeFallback,
    by_family: Object.fromEntries(families.map((f) => [f, compare(trials.filter((x) => x.t.family === f), 'plain', 'edition', models)])),
    forced: { vs_plain: compare(trials, 'plain', 'forced', models), vs_edition: compare(trials, 'edition', 'forced', models) },
    cells, exclusion_gap: exclusionGap,
  };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(1));
const iv = (c: [number, number] | null) => (c ? '[' + pct(c[0]) + ', ' + pct(c[1]) + ']' : 'n/a');
const usd = (x: number | null) => (x === null ? 'n/a' : '$' + x.toFixed(4));

export function renderMarkdown(r: Analysis): string {
  const lines = ['# qm-s1-edition analysis', '', '**Verdict: ' + r.verdict + '.** ' + (r.verdict_reasons.length ? 'Why: ' + r.verdict_reasons.join('; ') + '.' : 'The pooled difference is above 0 with p below ' + r.alpha + ' and neither model is below 0.'), '',
    'Task success, edition minus plain, in points. Task-clustered bootstrap 95 percent intervals and two-sided sign-flip p over tasks, ' + r.draws + ' draws, seed ' + r.seed + '. ' + r.trials + ' trials from ' + r.records + ' records (' + r.reruns.length + ' reruns).', ''];
  const table = (title: string, c: Comparison, note: string) => {
    lines.push('## ' + title, '', note, '', '| Model | Tasks | ' + c.a + ' | ' + c.b + ' | Difference | Interval | p |', '|---|---:|---:|---:|---:|---|---:|');
    for (const [m, d] of [...Object.entries(c.per_model), ['pooled', c.pooled] as const]) lines.push('| ' + m + ' | ' + (d ? d.n_tasks : 0) + ' | ' + pct(d?.mean_a) + ' | ' + pct(d?.mean_b) + ' | ' + pct(d?.delta) + ' | ' + iv(d?.ci95 ?? null) + ' | ' + (d ? d.p_two_sided.toFixed(4) : 'n/a') + ' |');
    lines.push('');
  };
  table('Primary: edition minus plain', r.primary, 'Decides the verdict.' + (r.plan_judge_fallback ? ' Plan tasks are left out of it, because their grades came from the alias judge (a deviation): it pools the investigate and review tasks only.' : ''));
  for (const [f, c] of Object.entries(r.by_family)) table('By family: ' + f, c, 'Descriptive.' + (f === 'plan' && r.plan_judge_fallback ? ' Plan grades came from the deterministic alias judge, which checks that constraints are named, not respected (a deviation), so plan is outside the verdict.' : ''));
  table('Forced exposure minus plain', r.forced.vs_plain, 'Descriptive, outside the win rule.');
  table('Forced exposure minus edition', r.forced.vs_edition, 'Descriptive, outside the win rule.');
  lines.push('## Per arm (descriptive)', '', '| Cell | Trials | Excluded | Success | Interval | Matched open | Any open | Complete read | First step | Approvals | Contaminated | Cost per task | Cost per success | Reply chars (mean) | Wall s (mean) |', '|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [k, c] of Object.entries(r.cells)) lines.push('| ' + k + ' | ' + c.trials + ' | ' + c.excluded + ' (' + pct(c.exclusion_rate) + '%) | ' + c.success.k + '/' + c.success.n + ' (' + pct(c.success.rate) + '%) | ' + iv(c.success.ci95) + ' | ' + c.open_matched.k + '/' + c.open_matched.n + ' | ' + c.open_any.k + '/' + c.open_any.n + ' | ' + c.complete_read.k + '/' + c.complete_read.n + ' | ' + c.first_step.k + '/' + c.first_step.n + ' | ' + c.approvals_answered + ' | ' + c.contaminated.length + ' | ' + usd(c.cost_per_task) + ' | ' + usd(c.cost_per_success) + ' | ' + (c.reply_chars.mean === null ? 'n/a' : c.reply_chars.mean.toFixed(0)) + ' | ' + (c.wall_s.mean === null ? 'n/a' : c.wall_s.mean.toFixed(1)) + ' |');
  lines.push('', '## Exclusion rate, edition against plain', '', '| Model | Edition | Plain | Gap | Flag (above 5 points) |', '|---|---:|---:|---:|---|');
  for (const [m, g] of Object.entries(r.exclusion_gap)) lines.push('| ' + m + ' | ' + pct(g.edition) + '% | ' + pct(g.plain) + '% | ' + pct(g.gap) + ' | ' + (g.flagged ? 'FLAGGED' : 'no') + ' |');
  lines.push('', '## Graders', '', ...Object.entries(r.graders).map(([f, g]) => '- ' + f + ': ' + Object.entries(g).map(([k, n]) => k + ' (' + n + ')').join(', ')));
  if (r.missing.length) lines.push('', '## Missing design cells', '', ...r.missing.slice(0, 50).map((p) => '- ' + p), ...(r.missing.length > 50 ? ['- and ' + (r.missing.length - 50) + ' more'] : []));
  if (r.rerun_problems.length) lines.push('', '## Rerun problems', '', ...r.rerun_problems.map((p) => '- ' + p));
  return lines.join('\n') + '\n';
}

const readJsonl = <T>(path: string) => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const [turnsPath, gradesPath, out] = [flag('--turns'), flag('--grades'), flag('--out')];
  const [tasks, reps] = [Number(flag('--tasks')), Number(flag('--reps'))];
  if (!turnsPath || !gradesPath || !out || !(Number.isInteger(tasks) && tasks > 0) || !(Number.isInteger(reps) && reps > 0)) { console.error('usage: bun harnesses/qm/gstack/edition-analysis.ts --turns <turns.jsonl> --grades <grades.jsonl> --tasks <n> --reps <n> --out <dir>'); process.exit(2); }
  try {
    const r = analyze(readJsonl<TurnRecord>(turnsPath), readJsonl<GradeRecord>(gradesPath), { tasks, reps });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'edition-analysis.json'), JSON.stringify(r, null, 1) + '\n');
    writeFileSync(join(out, 'edition-analysis.md'), renderMarkdown(r));
    console.log('edition-analysis: verdict ' + r.verdict + (r.verdict_reasons.length ? ' (' + r.verdict_reasons.join('; ') + ')' : '') + ', pooled difference ' + pct(r.primary.pooled?.delta) + ' points, p ' + (r.primary.pooled ? r.primary.pooled.p_two_sided.toFixed(4) : 'n/a'));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
