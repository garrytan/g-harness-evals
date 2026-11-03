import { expect, test } from 'bun:test';
import { calibrationLease, mainCap, mde, MULT, nFor, plannedJudgeExtras, plannedMain, plannedPilot, PILOT_CAP, simulateCut, simulateGuard, taskCount, totalCap } from '../scripts/qm-brain-power.ts';

const r2 = (x: number) => Math.round(x * 100) / 100;

test('the frozen task-count rule and cap ladder (PREREGISTRATION.md, Power, cost and caps)', () => {
  expect(r2(MULT)).toBe(3.48);
  expect(r2(100 * mde(0.4, 88))).toBe(14.84);
  expect(nFor(0.51)).toBe(140);
  expect([0.3, 0.4, 0.41, 0.45, 0.5, 0.6].map(taskCount)).toEqual([88, 88, 91, 109, 135, 135]);
  expect([88, 109, 135].map(totalCap)).toEqual([600, 710, 850]);
  expect(mainCap(88) + PILOT_CAP).toBe(600);
  expect(plannedMain(88)).toBeLessThan(mainCap(88));
  expect(1.1 * plannedPilot()).toBeLessThanOrEqual(PILOT_CAP);
});

test('calibration, blinding and audit calls have a lease inside the main cap', () => {
  expect([88, 135].map(n => r2(plannedJudgeExtras(n)))).toEqual([23.24, 27.05]);
  expect([88, 135].map(calibrationLease)).toEqual([30, 35]);
  for (let n = 88; n <= 135; n++) expect(plannedMain(n) + calibrationLease(n)).toBeLessThanOrEqual(mainCap(n));
});

test('simulated chances quoted in the preregistration', () => {
  const at40 = simulateCut(0.4, 88);
  expect(r2(at40.joint)).toBe(0.71);
  expect(r2(simulateCut(0.51, 135).joint)).toBe(0.67);
  expect(r2(simulateGuard(0))).toBe(0.02);
  expect(r2(simulateGuard(0.3))).toBe(0.4);
});
