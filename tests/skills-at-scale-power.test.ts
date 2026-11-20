// Keyless test of scripts/skills-at-scale/power.ts: the plan's figures (about 9 points at 300 pairs and 6.5 at 600 for
// opened the right skill, about 3.5 pooled per rung, margins of about 4 to 5 on single-model harnesses at the discordance
// the plan implies), the zero-event floor, the joint per-model margin and shares read from an analysis (internal-task), and the
// two-look O'Brien-Fleming bounds and what the interim look costs (R113).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DESIGN_FILE, looks, obfBounds, power, render, sharesFromAnalysis, type Design } from '../scripts/skills-at-scale/power.ts';
import { conditionalPower, lookDecision } from '../scripts/skills-at-scale/sequential.ts';

const design = JSON.parse(readFileSync(DESIGN_FILE, 'utf8')) as Design;
const row = (p: ReturnType<typeof power>, h: string, bar: string) => p.rows.find((r) => r.harness === h && r.bar === bar) as any;

describe('skills-at-scale power', () => {
  test('reproduces the plan: about 9 points at 300 pairs, 6.5 at 600, about 3.5 pooled without OpenClaw, set T about 5', () => {
    const p = power(design);
    expect(row(p, 'claude-code', 'opened_right').smallest_detectable).toBeCloseTo(0.0886, 3);
    expect(row(p, 'hermes', 'opened_right').smallest_detectable).toBeCloseTo(0.0627, 3);
    expect(p.pooled.opened_right_per_rung_without_openclaw.smallest_detectable).toBeCloseTo(0.0362, 3);
    expect(p.pooled.set_t_success_per_rung.smallest_detectable).toBeGreaterThan(0.045);
    expect(p.pooled.set_t_success_per_rung.smallest_detectable).toBeLessThan(0.05);
    expect(p.pooled.no_skill_block_rate_half_width.per_setup).toBeCloseTo(0.0895, 3);
  });

  test('a harm discordance of 6 to 9% gives the plan\'s single-model margin of about 4 to 5 points', () => {
    for (const [share, lo, hi] of [[0.06, 0.04, 0.045], [0.09, 0.05, 0.055]] as const) {
      const d = { ...design, harnesses: { x: { 'anthropic:claude-opus-5-5': { opened_right: 0.25, wrong_skill: share, no_skill_open: share } } } };
      const m = row(power(d), 'x', 'wrong_skill').margin_per_model[0].margin;
      expect(m).toBeGreaterThan(lo);
      expect(m).toBeLessThan(hi);
    }
  });

  test('no discordance: the margin is the exact zero-event bound; two models passing together need a wider margin each', () => {
    const p = power(design);
    expect(row(p, 'claude-code', 'no_skill_open').margin_per_model[0].margin).toBeCloseTo(1 - 0.025 ** (1 / 120), 4);
    const oc = row(p, 'openclaw', 'wrong_skill');
    expect(oc.margin_joint[1].margin).toBeGreaterThan(oc.margin_per_model[1].margin);
    expect(render(p, design)).toContain('| codex | opened wrong skill |');
  });

  test('an icc widens the two-model figures and leaves single-pair clusters alone', () => {
    const p = power(design, { icc: 0.1 });
    expect(row(p, 'hermes', 'opened_right').smallest_detectable).toBeCloseTo(0.07, 2);
    expect(row(p, 'claude-code', 'no_skill_open').margin_per_model[0].margin).toBeCloseTo(row(power(design), 'claude-code', 'no_skill_open').margin_per_model[0].margin, 6);
  });

  test('shares from an analysis pool each model over its rungs', () => {
    const disc = (x: number, n: number) => ({ discordant: x, n_pairs: n, share: x / n });
    const s = sharesFromAnalysis({ per_rung: [
      { harness: 'pi', discordance: { m: { opened_right_skill: disc(30, 100), opened_wrong_skill: disc(5, 100), no_skill_opened_any: disc(0, 40) } } },
      { harness: 'pi', discordance: { m: { opened_right_skill: disc(10, 100), opened_wrong_skill: disc(5, 100), no_skill_opened_any: disc(4, 40) } } },
    ] });
    expect(s).toEqual({ pi: { m: { opened_right: 0.2, wrong_skill: 0.05, no_skill_open: 0.05 } } });
  });
});

describe('interim look (R113)', () => {
  test('two-sided 0.05 gives 2.80 and 1.98; a one-sided 0.025 harm bar gives the same; a Holm-split alpha gives wider bounds', () => {
    const b = obfBounds(0.05, 2);
    expect(b.interim.toFixed(2)).toBe('2.80');
    expect(b.final.toFixed(2)).toBe('1.98');
    expect(b.nominal_final).toBeCloseTo(0.024, 3);
    const ni = obfBounds(0.025, 1);
    expect(ni.interim).toBeCloseTo(b.interim, 6);
    expect(ni.final).toBeCloseTo(b.final, 6);
    const holm = obfBounds(0.025, 2);
    expect(holm.interim).toBeGreaterThan(3.1);
    expect(holm.final).toBeGreaterThan(2.2);
    expect(holm.final).toBeLessThan(holm.interim);
  });

  test('the two looks cost under half a point of power and keep alpha; futility saves about a sixth of the 1,500 units under no effect', () => {
    const l = looks(design);
    expect(l.at_planned_effect.with_futility.power).toBeGreaterThan(0.79);
    expect(l.at_planned_effect.with_futility.power).toBeLessThan(0.8);
    expect(l.at_no_effect.without_futility.power).toBeCloseTo(0.025, 3);
    expect(l.at_no_effect.with_futility.power).toBeLessThanOrEqual(0.0251);
    expect(1 - l.at_no_effect.with_futility.expected_fraction).toBeGreaterThan(0.14);
    expect(l.mdd_inflation.with_futility).toBeGreaterThan(1);
    expect(l.mdd_inflation.with_futility).toBeLessThan(1.01);
    expect(render(power(design), design)).toContain('| primary, opened right skill | 0.05 two-sided | 2.80 | 1.98 |');
  });

  test('a look decides by the bounds it is given, and conditional power falls with the interim z', () => {
    const b = obfBounds(0.05, 2);
    expect(lookDecision({ delta: 0.3, se: 0.1, plannedEffect: 0.089, bounds: b }).decision).toBe('stop_efficacy');
    expect(lookDecision({ delta: 0.3, se: 0.1, plannedEffect: 0.089, bounds: obfBounds(0.0125, 2) }).decision).toBe('continue');
    expect(lookDecision({ delta: -0.3, se: 0.1, plannedEffect: 0.089, bounds: b }).decision).toBe('stop_loss');
    expect(lookDecision({ delta: -0.05, se: 0.045, plannedEffect: 0.089, bounds: b }).decision).toBe('stop_futility');
    expect(conditionalPower(1.5, 2.8, b)).toBeGreaterThan(conditionalPower(0.5, 2.8, b));
  });
});
