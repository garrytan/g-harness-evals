#!/usr/bin/env bun
// The frozen analysis of fable-diagnosis-2026-11: Fable 5.2 against Opus 5.5 on tasks whose instruction names none of the
// files the fix changes ("diagnosis") and on tasks whose instruction names at least one ("pointed").
//
//   bun scripts/frontier-harbor/feature-split.ts --trials <trials.jsonl> --labels <labels.json> [--tasks <ids>] --out <dir>
//
// Scoring is scripts/matrix-analysis.ts trialValue (a pass is grade pass with no consent violation, harness_error is a
// fail, model_error, infra_error and exam_fault are excluded). A task's arm value is its pass share over its scored
// attempts, and a task is paired when both arms have a scored attempt. Per group (diagnosis, pointed, all): each arm's pass
// rate with a task bootstrap interval, the paired difference Fable 5.2 minus Opus 5.5 (runner/stats/paired.ts
// clusteredPairedDelta, one cluster per task) with its 80% minimum detectable difference, each arm's cost per solve, the
// paired cost-per-solve ratio, and the extra cost per extra solve: (Fable USD - Opus USD) / (Fable solves - Opus solves)
// over the group's paired tasks, with a task bootstrap interval that is withheld when more than 5% of draws have no extra
// solve. The interaction is the diagnosis difference minus the pointed difference, with a stratified task bootstrap
// (each group resampled on its own). Readings follow the preregistration's decision rules. Seed 20261114, 10,000 draws.
// USD is every trial's recorded spend, excluded trials included, less usage.usd_reserved (the dollars the proxy charged at
// a full reservation because a request carried no usage), as scripts/frontier-harbor/analyze.ts counts it; that part is
// reported beside, per arm, and left out of every cost figure. --tasks limits the run to a task list (a sensitivity
// line). Writes analysis.json and analysis.md to --out.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { clusteredPairedDelta, powerNote, seededRandom } from '../../runner/stats/paired.ts';
import { costPerSolve, pairedCostRatio, taskBootstrapMean } from '../../runner/stats/frontier.ts';
import { trialValue } from '../matrix-analysis.ts';

export const OPTS = { seed: 20261114, draws: 10000 };
export const ARMS = { b: { model: 'anthropic:claude-fable-5-2', label: 'Fable 5.2' }, a: { model: 'anthropic:claude-opus-5-5', label: 'Opus 5.5' } } as const;
const GROUPS = ['diagnosis', 'pointed', 'all'] as const;
type Group = (typeof GROUPS)[number];

interface Arm { scored: Map<string, number[]>; usd: Map<string, number>; reserved: number; trials: number; excluded: number; timeouts: number }
export interface TaskRow { task: string; a: number; b: number; usd_a: number; usd_b: number; solves_a: number; solves_b: number }

const sum = (x: number[]) => x.reduce((s, v) => s + v, 0);
const mean = (x: number[]) => sum(x) / x.length;

export function extraCostPerExtraSolve(rows: readonly TaskRow[], options = OPTS) {
  const of = (rs: readonly TaskRow[]) => {
    const ds = sum(rs.map((r) => r.solves_b - r.solves_a));
    return ds > 0 ? sum(rs.map((r) => r.usd_b - r.usd_a)) / ds : null;
  };
  const estimate = of(rows);
  if (estimate === null) return { usd_per_extra_solve: null, ci95: null, undefined_draws: 0, note: 'Fable 5.2 has no extra solve on these tasks' };
  const rnd = seededRandom(options.seed);
  const boot: number[] = [];
  let undef = 0;
  for (let i = 0; i < options.draws; i++) {
    const draw = rows.map(() => rows[Math.floor(rnd() * rows.length)]!);
    const v = of(draw);
    if (v === null) undef++;
    else boot.push(v);
  }
  if (undef > options.draws * 0.05) return { usd_per_extra_solve: estimate, ci95: null, undefined_draws: undef, note: undef + ' of ' + options.draws + ' draws had no extra solve, so no interval is given' };
  boot.sort((x, y) => x - y);
  return { usd_per_extra_solve: estimate, ci95: [boot[Math.floor(boot.length * 0.025)]!, boot[Math.ceil(boot.length * 0.975) - 1]!] as [number, number], undefined_draws: undef, note: null };
}

export function interaction(diag: readonly TaskRow[], pointed: readonly TaskRow[], options = OPTS) {
  const d = (rs: readonly TaskRow[]) => mean(rs.map((r) => r.b - r.a));
  const estimate = d(diag) - d(pointed);
  const rnd = seededRandom(options.seed + 1);
  const boot: number[] = [];
  for (let i = 0; i < options.draws; i++) {
    const x = diag.map(() => diag[Math.floor(rnd() * diag.length)]!);
    const y = pointed.map(() => pointed[Math.floor(rnd() * pointed.length)]!);
    boot.push(d(x) - d(y));
  }
  boot.sort((x, y) => x - y);
  const ci95: [number, number] = [boot[Math.floor(options.draws * 0.025)]!, boot[Math.ceil(options.draws * 0.975) - 1]!];
  const se = Math.sqrt(boot.reduce((s, v) => s + (v - estimate) ** 2, 0) / (boot.length - 1));
  return { estimate, ci95, se, mdd80: 2.8 * se };
}

/** The preregistered reading of the prediction. */
export function predictionReading(inter: { estimate: number; ci95: [number, number] }, diagCi: [number, number] | null): 'supported' | 'disproved' | 'not shown' {
  if (inter.estimate <= 0 || (diagCi !== null && diagCi[1] < 0)) return 'disproved';
  if (inter.ci95[0] > 0) return 'supported';
  return 'not shown';
}

export function analyze(trials: readonly TrialRecord[], labels: Record<string, { label: 'diagnosis' | 'pointed' }>, only?: string[]) {
  const arms = { a: { scored: new Map(), usd: new Map(), reserved: 0, trials: 0, excluded: 0, timeouts: 0 } as Arm, b: { scored: new Map(), usd: new Map(), reserved: 0, trials: 0, excluded: 0, timeouts: 0 } as Arm };
  for (const t of trials) {
    const side = t.model === ARMS.a.model ? 'a' : t.model === ARMS.b.model ? 'b' : null;
    if (!side || (only && !only.includes(t.task))) continue;
    if (!labels[t.task]) throw new Error('task ' + t.task + ' has no label');
    const arm = arms[side];
    arm.trials++;
    const charged = Number(t.usage?.usd ?? 0), reserved = Number(t.usage?.usd_reserved ?? 0);
    arm.usd.set(t.task, (arm.usd.get(t.task) ?? 0) + (reserved ? Math.max(charged - reserved, 0) : charged));
    arm.reserved += reserved;
    if (t.termination === 'timeout') arm.timeouts++;
    const v = trialValue(t);
    if (v === null) { arm.excluded++; continue; }
    arm.scored.set(t.task, [...(arm.scored.get(t.task) ?? []), v]);
  }
  const paired = [...arms.b.scored.keys()].filter((k) => arms.a.scored.has(k)).sort();
  const rows: TaskRow[] = paired.map((k) => ({ task: k, a: mean(arms.a.scored.get(k)!), b: mean(arms.b.scored.get(k)!), usd_a: arms.a.usd.get(k) ?? 0, usd_b: arms.b.usd.get(k) ?? 0, solves_a: sum(arms.a.scored.get(k)!), solves_b: sum(arms.b.scored.get(k)!) }));
  const inGroup = (g: Group) => rows.filter((r) => g === 'all' || labels[r.task]!.label === g);
  const groups = Object.fromEntries(GROUPS.map((g) => {
    const rs = inGroup(g);
    const stats = clusteredPairedDelta(rs.map((r) => ({ id: r.task, cluster: r.task, a: r.a, b: r.b })), OPTS);
    const { bootstrap: _b, ...difference } = stats;
    return [g, {
      tasks: rs.length,
      pass_rate: { [ARMS.b.label]: taskBootstrapMean(rs.map((r) => r.b), OPTS), [ARMS.a.label]: taskBootstrapMean(rs.map((r) => r.a), OPTS) },
      difference, power: powerNote(stats),
      lower: rs.filter((r) => r.b < r.a).map((r) => r.task), higher: rs.filter((r) => r.b > r.a).map((r) => r.task), same: rs.filter((r) => r.b === r.a).length,
      cost_per_solve: { [ARMS.b.label]: costPerSolve(rs.map((r) => ({ usd: r.usd_b, solves: r.solves_b })), OPTS), [ARMS.a.label]: costPerSolve(rs.map((r) => ({ usd: r.usd_a, solves: r.solves_a })), OPTS) },
      cost_ratio: pairedCostRatio(rs.map((r) => ({ task: r.task, usd_a: r.usd_a, solves_a: r.solves_a, usd_b: r.usd_b, solves_b: r.solves_b })), OPTS),
      extra_cost_per_extra_solve: extraCostPerExtraSolve(rs),
      reading: stats.ci95 ? (stats.ci95[0] > 0 ? 'Fable 5.2 higher' : stats.ci95[1] < 0 ? 'Fable 5.2 lower' : 'no measurable difference') : 'no interval',
    }];
  })) as Record<Group, any>;
  const inter = interaction(inGroup('diagnosis'), inGroup('pointed'));
  return {
    run_id: 'fable-diagnosis-2026-11', options: OPTS, subset: only ?? null,
    arms: { [ARMS.b.label]: { trials: arms.b.trials, excluded: arms.b.excluded, timeouts: arms.b.timeouts, usd_reserved: arms.b.reserved }, [ARMS.a.label]: { trials: arms.a.trials, excluded: arms.a.excluded, timeouts: arms.a.timeouts, usd_reserved: arms.a.reserved } },
    unpaired_tasks: [...new Set([...arms.a.usd.keys(), ...arms.b.usd.keys()])].filter((k) => !paired.includes(k)).sort(),
    groups, interaction: inter, prediction: predictionReading(inter, groups.diagnosis.difference.ci95),
  };
}

const pts = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : (v >= 0 ? '+' : '') + (100 * v).toFixed(1));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : (100 * v).toFixed(1) + '%');
const usd = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : '$' + v.toFixed(2));
const x = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : v.toFixed(2) + 'x');

export function render(r: ReturnType<typeof analyze>): string {
  const g = r.groups;
  const row = (name: string, k: Group) => {
    const q = g[k];
    const pb = q.pass_rate[ARMS.b.label], pa = q.pass_rate[ARMS.a.label], cb = q.cost_per_solve[ARMS.b.label], ca = q.cost_per_solve[ARMS.a.label], e = q.extra_cost_per_extra_solve;
    return '| ' + name + ' | ' + q.tasks + ' | ' + pct(pb?.estimate) + ' | ' + pct(pa?.estimate) + ' | ' + pts(q.difference.delta) + ' [' + pts(q.difference.ci95?.[0]) + ', ' + pts(q.difference.ci95?.[1]) + '] | ' + q.lower.length + ' / ' + q.same + ' / ' + q.higher.length + ' | ' + usd(cb.usd_per_solve) + ' | ' + usd(ca.usd_per_solve) + ' | ' + x(q.cost_ratio.ratio) + ' [' + x(q.cost_ratio.ci95?.[0]) + ', ' + x(q.cost_ratio.ci95?.[1]) + '] | ' + usd(e.usd_per_extra_solve) + (e.ci95 ? ' [' + usd(e.ci95[0]) + ', ' + usd(e.ci95[1]) + ']' : '') + ' | ' + q.reading + ' |';
  };
  return [
    '# Fable 5.2 against Opus 5.5, split by whether the instruction points at the fix' + (r.subset ? ' (subset of ' + r.subset.length + ' tasks)' : ''), '',
    'Difference is Fable 5.2 minus Opus 5.5 in points, paired by task, with a task bootstrap 95% interval. Lower / same / higher counts tasks where Fable 5.2 did worse, the same or better. Cost per solve is recorded USD at list price over scored passes. Extra cost per extra solve is what Fable 5.2 spent beyond Opus 5.5 for each task-attempt it solved beyond Opus 5.5.', '',
    '| Group | Tasks | Fable 5.2 | Opus 5.5 | Difference [95%] | Lower / same / higher | Fable cost per solve | Opus cost per solve | Cost ratio [95%] | Extra cost per extra solve | Reading |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    row('Needs diagnosis (instruction names no changed file)', 'diagnosis'), row('Pointed (instruction names a changed file)', 'pointed'), row('All tasks', 'all'), '',
    '- **Interaction** (diagnosis difference minus pointed difference): ' + pts(r.interaction.estimate) + ' points [' + pts(r.interaction.ci95[0]) + ', ' + pts(r.interaction.ci95[1]) + '], smallest difference this sample detects with 80% power ' + (100 * r.interaction.mdd80).toFixed(1) + ' points.',
    '- **Prediction:** ' + r.prediction + '.',
    '- 80% detectable difference per group: diagnosis ' + JSON.stringify(g.diagnosis.power) + '; pointed ' + JSON.stringify(g.pointed.power) + '.',
    '- Trials, excluded, timeouts: ' + Object.entries(r.arms).map(([k, v]) => k + ' ' + v.trials + ' / ' + v.excluded + ' / ' + v.timeouts).join('; ') + '. Charged at a full reservation, left out of cost: ' + Object.entries(r.arms).map(([k, v]) => k + ' ' + usd(v.usd_reserved)).join('; ') + '. Unpaired tasks: ' + (r.unpaired_tasks.join(', ') || 'none') + '.',
  ].join('\n') + '\n';
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const trialsFile = arg('--trials'), labelsFile = arg('--labels'), out = arg('--out'), only = arg('--tasks')?.split(',').filter(Boolean);
  if (!trialsFile || !labelsFile || !out) { console.error('usage: feature-split.ts --trials <trials.jsonl> --labels <labels.json> [--tasks <ids>] --out <dir>'); process.exit(2); }
  const trials = readFileSync(trialsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const r = analyze(trials, JSON.parse(readFileSync(labelsFile, 'utf8')).tasks, only);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'analysis.json'), JSON.stringify(r, null, 2) + '\n');
  writeFileSync(join(out, 'analysis.md'), render(r));
  console.log(render(r));
}
