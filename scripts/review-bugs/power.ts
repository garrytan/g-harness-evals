#!/usr/bin/env bun
// Smallest detectable difference (MDD) in blocking recall for the review real-bugs eval (plan section "Numbers and
// verdict": "computed with noloss power on the frozen suite at 2 passes").
//
//   bun scripts/review-bugs/power.ts (--suite <suite.json> | --prs <n> --bugs-per-pr <x>) --plain-rate <share>
//     [--passes 2] [--alpha 0.05] [--power 0.8] [--spread wide|narrow|<k>] [--dependence 0] [--sims 2000] [--seed 1] [--json]
//   bun scripts/review-bugs/power.ts --plan-check [--sims 2000] [--seed 1] [--json]
//
// Method: gstack-evals' noloss power (lanes/review-noloss/power.ts at 91d76421a9f127167b3694306aa77f2971f7a712, MIT
// License, Copyright (c) 2026 Garry Tan), restated here because harness-evals does not depend on gstack-evals. noloss
// power simulates its decision rule at a suite's PR cluster sizes: each blocking bug gets a reference detection rate
// from a beta distribution (mean recall, concentration "wide" 2 or "narrow" 8), the variant's rates are the reference's
// scaled so its mean moves by exactly delta, each pass is an independent draw, and every simulated comparison runs
// noloss's exact sign-flip tests over PR clusters.
//
// Does it answer "smallest difference detectable" for a superiority test? Not as noloss uses it: its size rule is the
// NO_LOSS rate at a margin, and it refuses to simulate a gain. But its LOSS rate at margin 0 is the power of a one-sided
// sign-flip test that the reference beats the variant. So this script puts the gstack arm in the reference seat at the
// plain rate plus d, and plain in the variant seat, scaled down by d to the plain rate, and runs that LOSS test at
// alpha / 2 (0.025, one tail of the plan's two-sided 0.05). The LOSS rate is then the power to detect a gain of d over
// plain. The MDD is the smallest whole number of points d whose power is at least 0.8, found by bisection with the
// same seed at every d. No separate simulation is needed. Two limits stay: the effect is multiplicative per bug (each
// bug's plain rate is its gstack rate times a common factor), and the plan's verdict reads the PR-clustered bootstrap
// interval, which at 110 to 150 PR clusters agrees closely with the sign-flip test simulated here.
// No model is called; the output is deterministic for a given seed.
import { readFileSync } from 'node:fs';
import { seededRandom, type PairedItem } from '../../runner/stats/paired.ts';
import { exactSignFlip } from './noloss-stats.ts';

export const SPREADS: Record<string, number> = { wide: 2, narrow: 8 };
export const POWER_GOAL = 0.8;
export const ALPHA_TWO_SIDED = 0.05;
export const DEFAULT_SIMS = 2000;
export const DEFAULT_SEED = 1;
/** The plan's planning estimates (points), at about 1.25 blocking bugs per PR and 2 passes, by PRs and plain rate. */
export const PLAN_ESTIMATES: Array<{ prs: number; plain_rate: number; mdd_points: number }> = [
  { prs: 80, plain_rate: 0.15, mdd_points: 18 }, { prs: 80, plain_rate: 0.25, mdd_points: 23 },
  { prs: 120, plain_rate: 0.15, mdd_points: 15 }, { prs: 120, plain_rate: 0.25, mdd_points: 18 },
  { prs: 150, plain_rate: 0.15, mdd_points: 13 }, { prs: 150, plain_rate: 0.25, mdd_points: 16 },
];

export class PowerError extends Error {}
const fail = (message: string): never => {
  throw new PowerError(message);
};

function normal(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * (1 - rng()) ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function spreadValue(spread: string): number {
  const k = SPREADS[spread] ?? Number(spread);
  return Number.isFinite(k) && k > 0 ? k : fail('--spread is wide, narrow or a positive beta concentration');
}

/** noloss suiteClusters: blocking bugs per PR cluster in a suite file. */
export function suiteClusters(path: string): number[] {
  const suite = JSON.parse(readFileSync(path, 'utf8')) as { units: Array<{ cluster: string; blockers: Array<{ counts: string }> }> };
  const byCluster = new Map<string, number>();
  for (const u of suite.units) {
    const n = u.blockers.filter((b) => b.counts === 'blocking').length;
    if (n) byCluster.set(u.cluster, (byCluster.get(u.cluster) ?? 0) + n);
  }
  return [...byCluster.values()];
}

/** A planning design before the suite is frozen: prs PRs holding round(prs * bugsPerPr) bugs, spread as evenly as whole bugs allow. */
export function syntheticClusters(prs: number, bugsPerPr: number): number[] {
  if (!Number.isSafeInteger(prs) || prs < 2) fail('--prs is a whole number of at least 2');
  if (!(bugsPerPr >= 1)) fail('--bugs-per-pr is at least 1');
  const total = Math.round(prs * bugsPerPr);
  const low = Math.floor(total / prs);
  return Array.from({ length: prs }, (_, i) => (i < total - low * prs ? low + 1 : low));
}

export interface SimInput {
  clusters: number[];
  passes_variant: number;
  passes_reference: number;
  /** The reference arm's mean detection rate. */
  recall: number;
  spread: number;
  /** Zero or a loss of the variant against the reference, in points. */
  delta_points: number;
  sims: number;
  seed: number;
  /** Both one-sided tests' alpha. */
  alpha: number;
  dependence: number;
}

/** noloss simulate at margin 0: the share of runs called NO_LOSS (variant better), LOSS (variant worse) or neither. */
export function simulate(input: SimInput): { no_loss: number; loss: number; sims: number; loss_mc_se: number } {
  const { clusters, recall, spread, sims, alpha, dependence } = input;
  if (!(recall > 0 && recall < 1)) fail('the reference recall is a share strictly between 0 and 1');
  if (input.delta_points > 0) fail('delta is zero or a loss; a gain is not simulated');
  if (!Number.isSafeInteger(sims) || sims < 1) fail('--sims is a positive integer');
  if (clusters.length < 2) fail('the design needs at least 2 PR clusters');
  if (!(dependence >= 0 && dependence <= 1)) fail('--dependence is a share from 0 to 1');
  const rng = seededRandom(input.seed);
  const cluster = clusters.flatMap((n, c) => Array.from({ length: n }, () => 'c' + String(c).padStart(3, '0')));
  const passes = [input.passes_reference, input.passes_variant];
  const share = (rate: number, p: number) => {
    let hits = 0;
    for (let i = 0; i < p; i++) if (rng() < rate) hits++;
    return hits / p;
  };
  const plan = (rates: number[], p: number): number[] => {
    const hits = rates.map(() => 0);
    for (let pass = 0; pass < p; pass++) {
      const draws = new Map<string, number>();
      rates.forEach((rate, i) => {
        if (!draws.has(cluster[i]!)) draws.set(cluster[i]!, rng());
        const own = rng();
        if ((rng() < dependence ? draws.get(cluster[i]!)! : own) < rate) hits[i]!++;
      });
    }
    return hits.map((h) => h / p);
  };
  let noLoss = 0;
  let loss = 0;
  for (let s = 0; s < sims; s++) {
    const rates = cluster.map(() => {
      const x = gamma(recall * spread, rng);
      return x / (x + gamma((1 - recall) * spread, rng));
    });
    const mean = rates.reduce((a, r) => a + r, 0) / rates.length;
    const scale = mean > 0 ? Math.max(0, mean + input.delta_points / 100) / mean : 1;
    let pairs: PairedItem[];
    if (dependence === 0) pairs = rates.map((r, i) => ({ id: String(i), cluster: cluster[i]!, a: share(r, input.passes_reference), b: share(Math.min(1, r * scale), input.passes_variant) }));
    else {
      const a = plan(rates, input.passes_reference);
      const b = plan(rates.map((r) => Math.min(1, r * scale)), input.passes_variant);
      pairs = rates.map((_, i) => ({ id: String(i), cluster: cluster[i]!, a: a[i]!, b: b[i]! }));
    }
    const t = exactSignFlip(pairs, passes);
    if (t.greater !== null && t.greater < alpha) noLoss++;
    else if (t.less !== null && t.less < alpha) loss++;
  }
  const p = loss / sims;
  return { no_loss: noLoss / sims, loss: p, sims, loss_mc_se: Math.sqrt((p * (1 - p)) / sims) };
}

export interface MddOptions { passes: number; alpha: number; power: number; spread: number; dependence: number; sims: number; seed: number }

/** Power to detect a gain of d points over plain: gstack as noloss's reference at plain + d, plain as the variant. */
export function powerAt(clusters: number[], plainRate: number, d: number, o: MddOptions): { power: number; mc_se: number } {
  const r = simulate({ clusters, passes_variant: o.passes, passes_reference: o.passes, recall: plainRate + d / 100, spread: o.spread, delta_points: -d, sims: o.sims, seed: o.seed, alpha: o.alpha / 2, dependence: o.dependence });
  return { power: r.loss, mc_se: r.loss_mc_se };
}

export interface MddResult {
  /** Smallest whole number of points with power at least the goal; null when no gain below 100 - plain reaches it. */
  mdd_points: number | null;
  power_at_mdd: { power: number; mc_se: number } | null;
  /** Power one point below the MDD. */
  power_below: { power: number; mc_se: number } | null;
}

export function mdd(clusters: number[], plainRate: number, o: MddOptions): MddResult {
  if (!(plainRate > 0 && plainRate < 1)) fail('--plain-rate is a share strictly between 0 and 1');
  const seen = new Map<number, { power: number; mc_se: number }>();
  const at = (d: number) => seen.get(d) ?? seen.set(d, powerAt(clusters, plainRate, d, o)).get(d)!;
  let hi = Math.ceil((1 - plainRate) * 100 - 1e-9) - 1;
  if (hi < 1 || at(hi).power < o.power) return { mdd_points: null, power_at_mdd: null, power_below: null };
  let lo = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid).power >= o.power) hi = mid;
    else lo = mid;
  }
  return { mdd_points: hi, power_at_mdd: at(hi), power_below: hi > 1 ? at(hi - 1) : null };
}

export interface PowerReport {
  record: 'review-bugs-power';
  design: { source: string; prs: number; bugs: number; bugs_per_pr: number; passes: number };
  plain_rate: number;
  alpha_two_sided: number;
  power_goal: number;
  spread: number;
  dependence: number;
  sims: number;
  seed: number;
  method: string;
  result: MddResult;
}

export const METHOD = 'noloss power (gstack-evals lanes/review-noloss/power.ts at 91d76421), restated: gstack in the reference seat at plain + d, plain in the variant seat scaled down by d, LOSS rate of the exact one-sided sign-flip test over PR clusters at alpha / 2; MDD is the smallest whole point with power at least the goal.';

export function report(clusters: number[], source: string, plainRate: number, o: MddOptions): PowerReport {
  const bugs = clusters.reduce((s, n) => s + n, 0);
  return { record: 'review-bugs-power', design: { source, prs: clusters.length, bugs, bugs_per_pr: Math.round((bugs / clusters.length) * 1000) / 1000, passes: o.passes }, plain_rate: plainRate, alpha_two_sided: o.alpha, power_goal: o.power, spread: o.spread, dependence: o.dependence, sims: o.sims, seed: o.seed, method: METHOD, result: mdd(clusters, plainRate, o) };
}

const pct = (x: number) => (x * 100).toFixed(1) + '%';
export function renderText(r: PowerReport): string {
  const m = r.result;
  const head = r.design.source + ': ' + r.design.prs + ' PRs, ' + r.design.bugs + ' blocking bugs (' + r.design.bugs_per_pr + ' per PR), ' + r.design.passes + ' passes per arm, plain blocking rate ' + pct(r.plain_rate) + '.';
  const body = m.mdd_points === null
    ? 'No gain below ' + Math.round((1 - r.plain_rate) * 100) + ' points reaches ' + pct(r.power_goal) + ' power.'
    : 'MDD ' + m.mdd_points + ' points (two-sided alpha ' + r.alpha_two_sided + ', power ' + r.power_goal + ', PR-clustered): power ' + pct(m.power_at_mdd!.power) + ' at ' + m.mdd_points + (m.power_below ? ' and ' + pct(m.power_below.power) + ' at ' + (m.mdd_points - 1) : '') + ' points (Monte Carlo SE ' + m.power_at_mdd!.mc_se.toFixed(3) + ').';
  return head + '\n' + body + '\nSimulated: ' + r.sims + ' runs per difference, seed ' + r.seed + ', beta concentration ' + r.spread + ', dependence ' + r.dependence + '. Method: ' + r.method + '\n';
}

function main(argv: string[]): void {
  const flags = new Map<string, string>();
  const bools = new Set(['--json', '--plan-check']);
  const known = new Set(['--suite', '--prs', '--bugs-per-pr', '--plain-rate', '--passes', '--alpha', '--power', '--spread', '--dependence', '--sims', '--seed', ...bools]);
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (!known.has(a)) fail('power does not take ' + JSON.stringify(a));
    if (bools.has(a)) flags.set(a, 'true');
    else flags.set(a, argv[++k] ?? fail(a + ' needs a value'));
  }
  const num = (n: string, fallback?: number) => {
    const raw = flags.get(n);
    if (raw === undefined) return fallback ?? fail('power needs ' + n);
    const x = Number(raw);
    return Number.isFinite(x) ? x : fail(n + ' is a number, not ' + JSON.stringify(raw));
  };
  const o: MddOptions = { passes: num('--passes', 2), alpha: num('--alpha', ALPHA_TWO_SIDED), power: num('--power', POWER_GOAL), spread: spreadValue(flags.get('--spread') ?? 'wide'), dependence: num('--dependence', 0), sims: num('--sims', DEFAULT_SIMS), seed: num('--seed', DEFAULT_SEED) };
  if (flags.has('--plan-check')) {
    const rows = PLAN_ESTIMATES.map((e) => ({ ...e, report: report(syntheticClusters(e.prs, 1.25), 'planning design', e.plain_rate, o) }));
    if (flags.has('--json')) return void process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    const lines = ['| PRs | plain rate | plan estimate | this script | power at MDD |', '|---|---|---|---|---|'];
    for (const r of rows) lines.push('| ' + r.prs + ' | ' + pct(r.plain_rate) + ' | ' + r.mdd_points + ' | ' + (r.report.result.mdd_points ?? 'not reached') + ' | ' + (r.report.result.power_at_mdd ? pct(r.report.result.power_at_mdd.power) : 'n/a') + ' |');
    return void process.stdout.write(lines.join('\n') + '\n1.25 blocking bugs per PR, ' + o.passes + ' passes, ' + o.sims + ' runs per difference, seed ' + o.seed + ', beta concentration ' + o.spread + ', dependence ' + o.dependence + '. Method: ' + METHOD + '\n');
  }
  const suite = flags.get('--suite');
  const clusters = suite ? suiteClusters(suite) : syntheticClusters(num('--prs'), num('--bugs-per-pr'));
  const r = report(clusters, suite ? 'suite ' + suite : 'planning design', num('--plain-rate'), o);
  process.stdout.write(flags.has('--json') ? JSON.stringify(r, null, 2) + '\n' : renderText(r));
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof PowerError)) throw e;
    process.stderr.write('power: ' + e.message + '\n');
    process.exit(2);
  }
}
