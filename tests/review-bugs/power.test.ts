import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { mdd, PLAN_ESTIMATES, powerAt, report, simulate, suiteClusters, syntheticClusters, type MddOptions } from '../../scripts/review-bugs/power.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'review-bugs');
const o: MddOptions = { passes: 2, alpha: 0.05, power: 0.8, spread: 2, dependence: 0, sims: 400, seed: 1 };

test('planning designs and suite clusters', () => {
  const c = syntheticClusters(80, 1.25);
  expect(c.length).toBe(80);
  expect(c.reduce((s, n) => s + n, 0)).toBe(100);
  expect(c.filter((n) => n === 2).length).toBe(20);
  expect(syntheticClusters(40, 1.25)).toEqual([...Array(10).fill(2), ...Array(30).fill(1)]);
  const fixture = suiteClusters(join(FIXTURES, 'noloss-small', 'suite.json'));
  expect(fixture.length).toBe(14);
  expect(fixture.reduce((s, n) => s + n, 0)).toBe(18);
});

test("the restated simulation gives noloss power's LOSS share exactly", async () => {
  const e = await Bun.file(join(FIXTURES, 'noloss-power-expected.json')).json();
  const clusters = [...Array(e.clusters.twos).fill(2), ...Array(e.clusters.ones).fill(1)];
  for (const dependence of [0, 0.5]) {
    const r = simulate({ clusters, passes_variant: e.passes, passes_reference: e.passes, recall: e.recall, spread: 2, delta_points: -e.loss_points, sims: e.sims, seed: e.seed, alpha: e.alpha, dependence });
    expect(r.loss).toBe(e.loss[String(dependence)]);
  }
});

test('power rises with the difference and the MDD falls with more PRs', () => {
  const c = syntheticClusters(80, 1.25);
  const low = powerAt(c, 0.2, 5, o).power;
  const high = powerAt(c, 0.2, 25, o).power;
  expect(low).toBeLessThan(0.5);
  expect(high).toBeGreaterThan(0.95);
  const m80 = mdd(c, 0.2, o).mdd_points!;
  const m150 = mdd(syntheticClusters(150, 1.25), 0.2, o).mdd_points!;
  expect(m150).toBeLessThan(m80);
  const r = mdd(c, 0.2, o);
  expect(r.power_at_mdd!.power).toBeGreaterThanOrEqual(0.8);
  expect(r.power_below!.power).toBeLessThan(0.8);
});

test('deterministic for a given seed, and every planning estimate is at or above the noloss-power MDD', () => {
  const a = report(syntheticClusters(80, 1.25), 'planning design', 0.15, o);
  expect(JSON.stringify(report(syntheticClusters(80, 1.25), 'planning design', 0.15, o))).toBe(JSON.stringify(a));
  expect(a).toMatchObject({ plain_rate: 0.15, sims: 400, seed: 1, alpha_two_sided: 0.05, power_goal: 0.8 });
  for (const e of PLAN_ESTIMATES) expect(mdd(syntheticClusters(e.prs, 1.25), e.plain_rate, o).mdd_points!).toBeLessThanOrEqual(e.mdd_points);
});

test('a difference no design can reach gives no MDD, and bad input is refused', () => {
  expect(mdd([1, 1], 0.5, o).mdd_points).toBeNull();
  expect(() => simulate({ clusters: [1, 1], passes_variant: 2, passes_reference: 2, recall: 0.3, spread: 2, delta_points: 5, sims: 10, seed: 1, alpha: 0.025, dependence: 0 })).toThrow(/gain is not simulated/);
  expect(() => syntheticClusters(1, 1.25)).toThrow(/at least 2/);
});
