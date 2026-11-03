#!/usr/bin/env bun
// Power, cost and cap figures for qm-brain-native (K8), as frozen in docs/benchmarks/2026-11-02-qm-brain-native/PREREGISTRATION.md.
// Keyless and deterministic (seeded simulation). Prints the MDE table, the task-count rule and cap ladder, the simulated chance
// of a CUT-CANDIDATE reading at zero effect (both frontier models, correlated tasks), and the unanswerable guard's false-fail
// rate and power. tests/qm-brain-power.test.ts pins the printed numbers.
//
//   bun scripts/qm-brain-power.ts [--json]

import { rng } from '../world/brain/names.ts';

/** Acklam's inverse normal CDF (relative error below 1.2e-9). */
export function qnorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1); }
  if (p > 1 - lo) return -qnorm(1 - p);
  const q = p - 0.5; const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export const FAMILY_TESTS = 6;
export const ALPHA = 0.05;
export const POWER = 0.8;
export const MUE = 0.15;
export const Z_ADJ = qnorm(1 - ALPHA / (2 * FAMILY_TESTS));
export const MULT = Z_ADJ + qnorm(POWER);
export const SD_RECEIPTS = 0.51;
export const SD_THRESHOLD = 0.40;
export const N_PLANNED = 88;
export const N_MAX = 135;

export const mde = (sd: number, n: number) => MULT * sd / Math.sqrt(n);
export const nFor = (sd: number, mue = MUE) => Math.ceil((MULT * sd / mue) ** 2);

/** The frozen task-count rule: 88 at or below 0.40, otherwise the count that powers 15 points, at most N_MAX. */
export const taskCount = (sd: number) => (sd <= SD_THRESHOLD ? N_PLANNED : Math.min(N_MAX, Math.max(N_PLANNED, nFor(sd))));

/** Per-trial cost basis (USD, list price, 25% margin included): receipts repriced, arm multipliers stated in the preregistration. */
export const COST = {
  opus: { N: 0.16, R: 0.19, T: 0.29, TC: 0.30, F: 0.32 },
  sol: { N: 0.08, R: 0.094, T: 0.14, TC: 0.15, F: 0.16 },
  particle: { N: 0.012, R: 0.014, T: 0.021, TC: 0.022, F: 0.024 },
  judge: 0.045,
  second_judge: 0.03,
} as const;
const core = (m: { R: number; T: number; TC: number; F: number }) => m.R + m.T + m.TC + m.F;
const all5 = (m: { N: number; R: number; T: number; TC: number; F: number }) => core(m) + m.N;
const models = [COST.opus, COST.sol, COST.particle];

/** One answerable held-out task: R, T, TC, F at two repeats and N at one, on three models; two thirds judged; particle re-judged. */
export const perAnswerable = () => models.reduce((s, m) => s + 2 * core(m) + m.N, 0) + 27 * (2 / 3) * COST.judge + 9 * (2 / 3) * COST.second_judge;
export const perUnanswerable = () => models.reduce((s, m) => s + all5(m), 0) + 15 * COST.judge;
export const perPrivacy = () => models.reduce((s, m) => s + all5(m), 0);
export const FIXED_MAIN = () => 12 * perUnanswerable() + 24 * perPrivacy();
export const plannedMain = (n: number) => n * perAnswerable() + FIXED_MAIN();
export const PILOT_CAP = 40;
export const HEADROOM = 1.13;
export const mainCap = (n: number) => Math.ceil(HEADROOM * plannedMain(n) / 10) * 10;
export const totalCap = (n: number) => mainCap(n) + PILOT_CAP;

/** Judge calls outside the trial basis: calibration (60 pilot and 20 synthetic replies, two labellers each), a fresh 40 after a failed
 *  calibration, the 60-reply blinding check, second fabrication rulings at a 10% planning rate of judged main replies, and 40 leak audits.
 *  Their lease is drawn from the main cap, so no cap rises. */
export const FABRICATION_RATE = 0.1;
export const judgedMain = (n: number) => n * 27 * (2 / 3) + 12 * 15;
export const plannedJudgeExtras = (n: number) => (2 * (60 + 20 + 40) + 60 + FABRICATION_RATE * judgedMain(n) + 40) * COST.judge;
export const calibrationLease = (n: number) => Math.ceil(HEADROOM * plannedJudgeExtras(n) / 5) * 5;

/** Pilot: 6 answerable (frontier core arms at two repeats, N and particle at one), 2 unanswerable (all arms), 4 DM probes (R, T, TC on frontier). */
export const plannedPilot = () => {
  const ans = 2 * core(COST.opus) + COST.opus.N + 2 * core(COST.sol) + COST.sol.N + all5(COST.particle) + 23 * (2 / 3) * COST.judge;
  const probes = COST.opus.R + COST.opus.T + COST.opus.TC + COST.sol.R + COST.sol.T + COST.sol.TC;
  return 6 * ans + 2 * perUnanswerable() + 4 * probes;
};

/** Chance that both frontier models read CUT (Bonferroni-adjusted upper bound below MUE) when the true effect is zero. */
export function simulateCut(sd: number, n: number, rho = 0.5, reps = 20000, seed = 20261102): { per_model: number; joint: number } {
  const r = rng(seed);
  const normal = () => { let u = 0; while (u === 0) u = r.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.next()); };
  const se = sd / Math.sqrt(n);
  let one = 0; let both = 0;
  for (let i = 0; i < reps; i++) {
    const z1 = normal(); const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * normal();
    const c1 = z1 * se + Z_ADJ * se < MUE; const c2 = z2 * se + Z_ADJ * se < MUE;
    if (c1) one++;
    if (c1 && c2) both++;
  }
  return { per_model: one / reps, joint: both / reps };
}

/** The unanswerable guard on 12 tasks at one repeat: it fails only when the drop exceeds 10 points and the 95% interval excludes zero. */
export function simulateGuard(drop: number, pBase = 0.85, tasks = 12, reps = 20000, seed = 20261103): number {
  const r = rng(seed);
  let fails = 0;
  for (let i = 0; i < reps; i++) {
    const d: number[] = [];
    for (let t = 0; t < tasks; t++) d.push((r.next() < pBase - drop ? 1 : 0) - (r.next() < pBase ? 1 : 0));
    const mean = d.reduce((a, b) => a + b, 0) / tasks;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (tasks - 1));
    if (mean < -0.10 && mean + 1.96 * sd / Math.sqrt(tasks) < 0) fails++;
  }
  return fails / reps;
}

export function report() {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    multiplier: r2(MULT),
    mde_points_at_88: Object.fromEntries([0.3, 0.4, 0.45, 0.5, 0.51].map(sd => [sd, r2(100 * mde(sd, 88))])),
    tasks_for_15_points: Object.fromEntries([0.3, 0.4, 0.45, 0.5, 0.51].map(sd => [sd, nFor(sd)])),
    rule: Object.fromEntries([0.35, 0.4, 0.45, 0.5, 0.55].map(sd => { const n = taskCount(sd); return [sd, { n, mde_points: r2(100 * mde(sd, n)), planned_main: r2(plannedMain(n)), judge_extras: r2(plannedJudgeExtras(n)), calibration_lease: calibrationLease(n), main_cap: mainCap(n), total_cap: totalCap(n) }]; })),
    per_answerable_task: r2(perAnswerable()),
    fixed_main: r2(FIXED_MAIN()),
    planned_pilot: r2(plannedPilot()),
    cut_at_zero: Object.fromEntries([0.4, 0.51].map(sd => [sd, simulateCut(sd, taskCount(sd))])),
    guard: { false_fail_no_change: simulateGuard(0), power_20_point_drop: simulateGuard(0.2), power_30_point_drop: simulateGuard(0.3) },
  };
}

if (import.meta.main) console.log(JSON.stringify(report(), null, 2));
