// The one preregistered interim look of the rules-at-scale run (R113, Garry 2026-11-19): one look at half the units (the
// first half of the tasks in the design's task order), two-look O'Brien-Fleming bounds at each test's own alpha (2.80 and
// 1.98 for a two-sided 0.05 test) and a futility stop when the conditional power under the planned effect is below 10%.
// Copied unchanged in its logic from the skills-at-scale eval's scripts/skills-at-scale/sequential.ts and power.ts obfBounds (branch
// skills-at-scale-analysis at e0284921b3853ee3fa397c02685dd29ca7b5a654), so the two evals use one rule; only the LOOKS
// constant drops its skills-only rung field. tests/rules-at-scale-analyze.test.ts checks the bounds.
//
// The statistic is z = delta / cluster-robust SE. Conditional power uses the B-value: with information fraction t, B(t) =
// z sqrt(t), and the rest of the run adds N(eta (1 - t), 1 - t), where eta = planned effect / SE at the full run (the
// interim SE times sqrt(t), since the run doubles its units). A z at or below minus the interim bound also stops, as a loss.
export const LOOKS = { fraction: 0.5, futility_cp: 0.10 } as const;
export type Bounds = { interim: number; final: number };
export type LookDecision = 'stop_efficacy' | 'stop_loss' | 'stop_futility' | 'continue';

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 on erf; absolute error under 1e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Probability that the final z reaches the final bound, given the interim z and the drift eta (in final-SE units). */
export function conditionalPower(zInterim: number, eta: number, bounds: Bounds, t: number = LOOKS.fraction): number {
  return 1 - normalCdf((bounds.final - zInterim * Math.sqrt(t) - eta * (1 - t)) / Math.sqrt(1 - t));
}

/** The interim decision for one contrast. */
export function lookDecision(o: { delta: number; se: number | null; plannedEffect: number; bounds: Bounds; t?: number }) {
  const t = o.t ?? LOOKS.fraction;
  const z = o.se && o.se > 0 ? o.delta / o.se : o.delta > 0 ? Infinity : o.delta < 0 ? -Infinity : 0;
  const eta = o.se && o.se > 0 ? o.plannedEffect / (o.se * Math.sqrt(t)) : Infinity;
  const cp = Number.isFinite(z) ? conditionalPower(z, eta, o.bounds, t) : z > 0 ? 1 : 0;
  const decision: LookDecision = z >= o.bounds.interim ? 'stop_efficacy' : z <= -o.bounds.interim ? 'stop_loss' : cp < LOOKS.futility_cp ? 'stop_futility' : 'continue';
  return { z: Number.isFinite(z) ? Number(z.toFixed(4)) : z, conditional_power: Number(cp.toFixed(4)), planned_effect: o.plannedEffect, bounds: o.bounds, decision };
}

/** Operating characteristics of the two looks at a true drift eta (final-SE units), futility judged at the planned drift.
 *  efficacy: false models a crossed efficacy bound that the run does not act on (a harm bar holds it), so it continues. */
export function designPower(etaTrue: number, etaPlanned: number, bounds: Bounds, o: { futility?: boolean; efficacy?: boolean; t?: number } = {}) {
  const t = o.t ?? LOOKS.fraction;
  const mu = etaTrue * Math.sqrt(t);
  const step = 0.0005;
  let power = 0, efficacy = 0, loss = 0, futility = 0;
  for (let z = mu - 9; z <= mu + 9; z += step) {
    const p = Math.exp(-((z - mu) ** 2) / 2) / Math.sqrt(2 * Math.PI) * step;
    if (z >= bounds.interim && o.efficacy !== false) { efficacy += p; power += p; continue; }
    if (z <= -bounds.interim) { loss += p; continue; }
    if (o.futility !== false && conditionalPower(z, etaPlanned, bounds, t) < LOOKS.futility_cp) { futility += p; continue; }
    power += p * conditionalPower(z, etaTrue, bounds, t);
  }
  const stop = efficacy + loss + futility;
  return { power, stop_efficacy: efficacy, stop_loss: loss, stop_futility: futility, expected_fraction: 1 - (1 - t) * stop };
}

/** The drift a design needs for the given power with both looks (bisection). */
export function driftFor(power: number, bounds: Bounds, o: { futility?: boolean } = {}): number {
  let lo = 0, hi = 8;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (designPower(mid, mid, bounds, o).power < power) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Two-look O'Brien-Fleming bounds at a test's own alpha (R113 as the team reads it): the interim bound is c / sqrt(t) and the
 *  final c, with c chosen so the chance of crossing either under no effect is alpha (one tail; a two-sided alpha is split
 *  evenly over the two tails). A two-sided 0.05 test gives 2.80 and 1.98; a one-sided 0.025 non-inferiority bar gives the
 *  same; an alpha that Holm splits gets wider bounds. nominal_* is the one-sided p each bound corresponds to. */
export function obfBounds(alpha: number, sides: 1 | 2, t: number = LOOKS.fraction): Bounds & { alpha: number; sides: 1 | 2; nominal_interim: number; nominal_final: number } {
  const tail = sides === 2 ? alpha / 2 : alpha;
  const cross = (c: number) => {
    const c1 = c / Math.sqrt(t), step = 0.001;
    let p = 1 - normalCdf(c1);
    for (let z = -9; z < c1; z += step) p += Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * step * (1 - normalCdf((c - Math.sqrt(t) * z) / Math.sqrt(1 - t)));
    return p;
  };
  let lo = 0.5, hi = 6;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cross(mid) > tail) lo = mid; else hi = mid; }
  const c = (lo + hi) / 2;
  return { alpha, sides, interim: c / Math.sqrt(t), final: c, nominal_interim: 1 - normalCdf(c / Math.sqrt(t)), nominal_final: 1 - normalCdf(c) };
}
