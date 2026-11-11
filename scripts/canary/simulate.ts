#!/usr/bin/env bun
// Seeded power simulator for the canary's pass-rate rule (plan decision 8): how often the T2 screen flags, and how often the
// screen and the T3 confirmation both fire, by drop size, for each model's frozen task list. It runs decide.ts's own tests.
//
//   bun scripts/canary/simulate.ts [--draws 10000] [--flip <f>] [--write]
//
// Baseline pass probability per task: the task's pooled pass rate over every cell of that model in the task list's source
// receipts (#337's merged trials for gstack, the dev-draw-2 receipts for gbrain), smoothed as (passes + 0.5) / (attempts + 1),
// so a task that passed every attempt still flips sometimes (8 of 8 gives 0.944, a flip rate of about 0.10). With --flip f
// every task gets the probability p whose flip rate 2p(1 - p) is f. A drop of d points scales every task's probability on the
// new release by (1 - d / mean p), so the expected pass rate falls by exactly d points.
// Screen: one trial per task per arm; flag when b > c and the one-sided sign test p <= screen_alpha. Confirm: fresh trials at
// k = 2 per arm; REGRESSION when the paired difference is -confirm_min_drop_points or worse and the exact sign-flip p <=
// confirm_alpha. Joint = both. It also prints the analytic null flag rate of the screen at a given flip rate and list size.
// --write regenerates docs/benchmarks/2026-11-09-regression-canary/power.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';
import { signFlipPLess, signTestP, type TasksFile, type Thresholds } from './decide.ts';

const ROOT = resolve(import.meta.dir, '../..');
const DIR = join(ROOT, 'docs/benchmarks/2026-11-09-regression-canary');
export const DROPS = [0, 10, 20, 30, 40];

/** Probability the screen flags with no change, n tasks each discordant with probability f (half each way), exact. */
export function analyticNullRate(n: number, f: number, alpha: number): number {
  const q = f / 2;
  const logChoose = (a: number, b: number) => { let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
  let total = 0;
  for (let b = 0; b <= n; b++) {
    for (let c = 0; c + b <= n; c++) {
      if (!(b > c && signTestP(b, c) <= alpha)) continue;
      const rest = n - b - c;
      total += Math.exp(logChoose(n, b) + logChoose(n - b, c) + (b + c) * Math.log(q) + (rest ? rest * Math.log(1 - f) : 0));
    }
  }
  return total;
}

/** The per-task pass probability whose flip rate 2p(1 - p) is f. */
export const pForFlip = (f: number) => (1 + Math.sqrt(1 - 2 * f)) / 2;

export interface Row { suite: string; model: string; tasks: number; mean_p: number; drop: number; screen: number; joint: number; draws: number }

export function simulate(p: readonly number[], drop: number, th: Thresholds, draws: number, seed: number): { screen: number; joint: number } {
  const rng = seededRandom(seed);
  const mean = p.reduce((s, x) => s + x, 0) / p.length;
  const scale = Math.max(0, 1 - drop / 100 / mean);
  const q = p.map((x) => x * scale);
  const bern = (x: number) => (rng() < x ? 1 : 0);
  let screen = 0, joint = 0;
  for (let d = 0; d < draws; d++) {
    let b = 0, c = 0;
    for (let i = 0; i < p.length; i++) {
      const a = bern(p[i]), n = bern(q[i]);
      if (a > n) b++; else if (n > a) c++;
    }
    if (!(b > c && signTestP(b, c) <= th.screen_alpha)) continue;
    screen++;
    const sums = p.map((x, i) => bern(q[i]) + bern(q[i]) - bern(x) - bern(x));
    const delta = sums.reduce((s, v) => s + v, 0) / (2 * p.length);
    if (delta * 100 <= -th.confirm_min_drop_points && signFlipPLess(sums) <= th.confirm_alpha) joint++;
  }
  return { screen: screen / draws, joint: joint / draws };
}

interface Trial { model: string; task: string; termination: string; grade: string; consent_violation?: boolean }
const smoothed = (rows: Trial[], model: string, tasks: readonly string[]) => tasks.map((t) => {
  const mine = rows.filter((r) => r.model === model && r.task === t && !['infra_error', 'model_error', 'exam_fault'].includes(r.termination));
  return (mine.filter((r) => r.grade === 'pass' && !r.consent_violation).length + 0.5) / (mine.length + 1);
});

export function baselines(flip: number | null): Array<{ suite: string; model: string; p: number[] }> {
  const out: Array<{ suite: string; model: string; p: number[] }> = [];
  for (const suite of ['gstack', 'gbrain'] as const) {
    const f = JSON.parse(readFileSync(join(DIR, `tasks-${suite}.json`), 'utf8')) as TasksFile & { source: { receipts: string[] } };
    const rows = f.source.receipts.flatMap((r) => {
      const m = r.match(/^(?:origin\/([^@]+)|main)@([0-9a-f]+):(.+)$/)!;
      return execFileSync('git', ['show', `${m[2]}:${m[3]}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Trial);
    });
    for (const mk of ['opus', 'sol'] as const) {
      const spec = f.models[mk]!;
      out.push({ suite, model: mk, p: flip === null ? smoothed(rows, spec.model, spec.tasks) : spec.tasks.map(() => pForFlip(flip)) });
    }
  }
  return out;
}

export function table(th: Thresholds, draws: number, flip: number | null): Row[] {
  const rows: Row[] = [];
  baselines(flip).forEach((b, bi) => {
    for (const drop of DROPS) {
      const r = simulate(b.p, drop, th, draws, th.seed * 1000 + bi * 10 + drop / 10);
      rows.push({ suite: b.suite, model: b.model, tasks: b.p.length, mean_p: b.p.reduce((s, x) => s + x, 0) / b.p.length, drop, ...r, draws });
    }
  });
  return rows;
}

const pc = (x: number) => (x * 100).toFixed(2) + '%';

export function render(rows: Row[], th: Thresholds, draws: number): string {
  const se = (x: number) => Math.sqrt(x * (1 - x) / draws) * 100;
  const out = [
    '# Regression canary: power of the pass-rate rule',
    '',
    '<!-- generated by bun scripts/canary/simulate.ts --write; do not edit by hand -->',
    '',
    `Seeded simulation, ${draws.toLocaleString('en-US')} draws per row, seed ${th.seed}. Screen: one trial per task per arm, flag when more tasks got worse than better and the one-sided sign test gives p <= ${th.screen_alpha}. Joint: the screen flags and a fresh T3 (two trials per task per arm) gives a paired difference of -${th.confirm_min_drop_points} points or worse with sign-flip p <= ${th.confirm_alpha}. Drop 0 is the false-flag rate.`,
    '',
    'Baseline pass probability per task: the pooled pass rate over every cell of the model in the list\'s source receipts, smoothed as (passes + 0.5) / (attempts + 1). A drop of d points scales every task\'s probability on the new release so the expected pass rate falls by d points.',
    '',
    '| Suite | Model | Tasks | Mean baseline p | Drop (points) | Screen flags | Screen and T3 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.suite} | ${r.model} | ${r.tasks} | ${r.mean_p.toFixed(3)} | ${r.drop} | ${pc(r.screen)} | ${pc(r.joint)} |`),
    '',
    `Monte Carlo standard error: at most ${se(0.5).toFixed(2)} points on any rate, ${se(0.01).toFixed(2)} points near 1%.`,
    '',
    '## Analytic null rate of the screen',
    '',
    'With n tasks each discordant with probability f (half each way), the exact chance the screen flags with no change:',
    '',
    '| n | f = 0.05 | f = 0.10 | f = 0.15 |',
    '|---|---|---|---|',
    ...[4, 12, 14, 20, 30].map((n) => `| ${n} | ${[0.05, 0.1, 0.15].map((f) => pc(analyticNullRate(n, f, th.screen_alpha))).join(' | ')} |`),
    '',
    `The plan's 0.69% at flip 0.10 is the 20-task value (${pc(analyticNullRate(20, 0.1, th.screen_alpha))}); the 30-task gstack lists sit at ${pc(analyticNullRate(30, 0.1, th.screen_alpha))} at the same flip rate.`,
  ];
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const th = (JSON.parse(readFileSync(join(DIR, 'prereg-canary.json'), 'utf8')) as { thresholds: Thresholds }).thresholds;
  const draws = Number(flag('--draws') ?? 10000);
  const flip = flag('--flip') === undefined ? null : Number(flag('--flip'));
  const rows = table(th, draws, flip);
  const text = render(rows, th, draws);
  if (argv.includes('--write')) {
    if (flip !== null || draws !== 10000) { console.error('simulate: --write uses the default 10,000 draws and the receipts\' rates'); process.exit(2); }
    writeFileSync(join(DIR, 'power.md'), text);
  }
  process.stdout.write(text);
  console.log(`\nanalytic null rate at flip ${flip ?? 0.1}, 20 tasks: ${pc(analyticNullRate(20, flip ?? 0.1, th.screen_alpha))}`);
}
