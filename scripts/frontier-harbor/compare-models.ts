#!/usr/bin/env bun
// The model comparison of fable-5-2-coding-2026-11: three models in Claude Code on the same tasks, paired by task.
//
//   bun scripts/frontier-harbor/compare-models.ts --trials <trials.jsonl> [--tasks <task ids, comma-separated>] [--run-id <id>] --out <dir>
//
// --run-id labels analysis.json (default fable-5-2-coding-2026-11; fable-5-2-coding-cc322-2026-11 passes its own).
//
// A trial's arm is its cell name before the first "-" (fable52, fable51, opus55) and its attempt is the r<n> in the cell
// name (cells <arm>-r<n>h<m>, one cell per arm x attempt x task half). Scoring is scripts/matrix-analysis.ts trialValue:
// a pass is grade pass with no consent violation, harness_error is a fail, model_error, infra_error and exam_fault are
// excluded. A task's arm value is its pass share over its scored attempts. Each pair (Fable 5.2 against each comparator,
// and Fable 5.1 against Opus 5.5 as a descriptive line) keeps the tasks with a scored attempt in both arms; the difference
// is runner/stats/paired.ts clusteredPairedDelta (b minus a, b the first-named arm) with its task bootstrap 95% interval,
// plus the counts of tasks lower, equal and higher. Cost per solve is each arm's recorded USD (excluded trials included)
// over its scored passes, and the paired cost ratio is runner/stats/frontier.ts pairedCostRatio over the paired tasks.
// Wall time is the median and 90th percentile of scored trials' wall_ms, contended (4 trials at a time per VM).
// Writes analysis.json and analysis.md to --out.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { clusteredPairedDelta, powerNote } from '../../runner/stats/paired.ts';
import { costPerSolve, pairedCostRatio, passHatK, rerunFlip, taskBootstrapMean } from '../../runner/stats/frontier.ts';
import { trialValue } from '../matrix-analysis.ts';

const ARMS = [
  { id: 'fable52', label: 'Fable 5.2' },
  { id: 'fable51', label: 'Fable 5.1' },
  { id: 'opus55', label: 'Opus 5.5' },
] as const;
const PAIRS: Array<{ b: string; a: string; primary: boolean }> = [
  { b: 'fable52', a: 'fable51', primary: true },
  { b: 'fable52', a: 'opus55', primary: true },
  { b: 'fable51', a: 'opus55', primary: false },
];
const OPTS = { seed: 20261109, draws: 10000 };

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const trialsFile = arg('--trials'), out = arg('--out'), only = arg('--tasks')?.split(',').filter(Boolean), runId = arg('--run-id') ?? 'fable-5-2-coding-2026-11';
if (!trialsFile || !out) { console.error('usage: compare-models.ts --trials <trials.jsonl> [--tasks <ids>] [--run-id <id>] --out <dir>'); process.exit(2); }

const records = readFileSync(trialsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
type Arm = { usd: Map<string, number>; scored: Map<string, number[]>; wall: number[]; byTermination: Record<string, number>; excluded: number; trials: number };
const arms = new Map<string, Arm>(ARMS.map((a) => [a.id, { usd: new Map(), scored: new Map(), wall: [], byTermination: {}, excluded: 0, trials: 0 }]));
const seen = new Set<string>();
for (const t of records) {
  const m = /^([a-z0-9]+)-r(\d+)h\d+$/.exec(t.cell);
  if (!m || !arms.has(m[1]!) || !/^[a-z0-9]+-r[12]h[12]$/.test(t.cell)) throw new Error(`unexpected cell ${t.cell}`);
  if (only && !only.includes(t.task)) continue;
  const key = `${m[1]}/${t.task}/${m[2]}`;
  if (seen.has(key)) throw new Error(`two records for ${key}`);
  seen.add(key);
  const arm = arms.get(m[1]!)!;
  arm.trials += 1;
  arm.byTermination[t.termination] = (arm.byTermination[t.termination] ?? 0) + 1;
  arm.usd.set(t.task, (arm.usd.get(t.task) ?? 0) + (t.usage?.usd ?? 0));
  const v = trialValue(t);
  if (v === null) { arm.excluded += 1; continue; }
  arm.scored.set(t.task, [...(arm.scored.get(t.task) ?? []), v]);
  arm.wall.push(Number(t.wall_ms) / 1000);
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sum = (x: number[]) => x.reduce((s, v) => s + v, 0);
const quantile = (x: number[], q: number) => { const s = [...x].sort((p, r) => p - r); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : null; };
const pts = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : (v >= 0 ? '+' : '') + (100 * v).toFixed(1));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : (100 * v).toFixed(1) + '%');
const usd = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : '$' + v.toFixed(2));

const perArm = ARMS.map(({ id, label }) => {
  const a = arms.get(id)!;
  const tasks = [...a.scored.keys()].sort();
  const passes = sum(tasks.map((k) => sum(a.scored.get(k)!)));
  const scoredTrials = sum(tasks.map((k) => a.scored.get(k)!.length));
  const two = tasks.filter((k) => a.scored.get(k)!.length >= 2);
  return {
    id, label, trials: a.trials, scored_trials: scoredTrials, passes, excluded: a.excluded, tasks: tasks.length, by_termination: a.byTermination,
    pass_rate: taskBootstrapMean(tasks.map((k) => mean(a.scored.get(k)!)), OPTS),
    cost_per_solve: costPerSolve([...a.usd.entries()].map(([k, u]) => ({ usd: u, solves: sum(a.scored.get(k) ?? []) })), OPTS),
    usd: sum([...a.usd.values()]),
    wall_s: { median: quantile(a.wall, 0.5), p90: quantile(a.wall, 0.9) },
    rerun_flip: taskBootstrapMean(two.map((k) => rerunFlip(a.scored.get(k)!.length, sum(a.scored.get(k)!))!), OPTS),
    pass_hat_2: taskBootstrapMean(two.map((k) => passHatK(a.scored.get(k)!.length, sum(a.scored.get(k)!), 2)!), OPTS),
  };
});

const pairs = PAIRS.map(({ a, b, primary }) => {
  const A = arms.get(a)!, B = arms.get(b)!;
  const tasks = [...B.scored.keys()].filter((k) => A.scored.has(k)).sort();
  const items = tasks.map((k) => ({ id: k, cluster: k, a: mean(A.scored.get(k)!), b: mean(B.scored.get(k)!) }));
  const stats = items.length ? clusteredPairedDelta(items, OPTS) : null;
  const { draws: _d, ...shown } = (stats ?? {}) as Record<string, unknown>;
  return {
    b, a, primary, tasks: tasks.length,
    difference: stats ? shown : null,
    power: stats ? powerNote(stats) : null,
    worse: items.filter((i) => i.b < i.a).map((i) => i.id), better: items.filter((i) => i.b > i.a).map((i) => i.id), same: items.filter((i) => i.b === i.a).length,
    cost_ratio: pairedCostRatio(tasks.map((k) => ({ task: k, usd_a: A.usd.get(k) ?? 0, solves_a: sum(A.scored.get(k)!), usd_b: B.usd.get(k) ?? 0, solves_b: sum(B.scored.get(k)!) })), OPTS),
    reading: stats?.ci95 ? (stats.ci95[0] > 0 ? 'higher' : stats.ci95[1] < 0 ? 'lower' : 'no measurable difference') : 'no interval',
  };
});

const label = (id: string) => ARMS.find((x) => x.id === id)!.label;
const md: string[] = [
  `# Model comparison${only ? ` (subset of ${only.length} tasks)` : ''}`, '',
  'Pass rate is the task mean with a task bootstrap 95% interval. Cost per solve is recorded USD at list price over scored passes. Wall time is per scored trial, contended (4 at a time per VM).', '',
  '| Arm | Pass rate [95%] | Passes / scored trials | Tasks | Excluded | Cost per solve [95%] | Median s | p90 s | Rerun flip | pass^2 |', '|---|---|---|---|---|---|---|---|---|---|',
  ...perArm.map((r) => `| ${r.label} | ${pct(r.pass_rate?.estimate)} [${pct(r.pass_rate?.ci95?.[0])}, ${pct(r.pass_rate?.ci95?.[1])}] | ${r.passes} / ${r.scored_trials} | ${r.tasks} | ${r.excluded} | ${usd(r.cost_per_solve.usd_per_solve)} [${usd(r.cost_per_solve.ci95?.[0])}, ${usd(r.cost_per_solve.ci95?.[1])}] | ${r.wall_s.median?.toFixed(0)} | ${r.wall_s.p90?.toFixed(0)} | ${pct(r.rerun_flip?.estimate)} | ${pct(r.pass_hat_2?.estimate)} |`),
  '', '| Pair | Difference, points [95%] | Tasks paired | Lower / same / higher | Cost per solve ratio [95%] | Reading | MDD 80% |', '|---|---|---|---|---|---|---|',
  ...pairs.map((p) => { const d = p.difference as { delta?: number; ci95?: [number, number] | null } | null; return `| ${label(p.b)} minus ${label(p.a)}${p.primary ? '' : ' (descriptive)'} | ${pts(d?.delta)} [${pts(d?.ci95?.[0])}, ${pts(d?.ci95?.[1])}] | ${p.tasks} | ${p.worse.length} / ${p.same} / ${p.better.length} | ${p.cost_ratio.ratio?.toFixed(2)}x [${p.cost_ratio.ci95?.[0]?.toFixed(2)}x, ${p.cost_ratio.ci95?.[1]?.toFixed(2)}x] | ${p.reading} | ${pts(p.power?.mde ?? null)} |`; }),
  '', ...pairs.map((p) => `- ${label(p.b)} lower than ${label(p.a)} on: ${p.worse.join(', ') || 'none'}. Higher on: ${p.better.join(', ') || 'none'}.`),
  '', '- Terminations per arm: ' + perArm.map((r) => `${r.label} ${JSON.stringify(r.by_termination)}`).join('; '),
];
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'analysis.json'), JSON.stringify({ run_id: runId, subset: only ?? null, options: OPTS, arms: perArm, pairs }, null, 2) + '\n');
writeFileSync(join(out, 'analysis.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
