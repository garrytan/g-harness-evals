import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount, roundCents } from '../src/pricing.js';

test('applyDiscount takes 10% off', () => {
  assert.equal(applyDiscount(50, 10), 45);
});

test('applyDiscount clamps percentages above 100', () => {
  assert.equal(applyDiscount(20, 150), 0);
});

test('applyDiscount rejects negative prices', () => {
  assert.throws(() => applyDiscount(-1, 10), RangeError);
});

test('roundCents rounds to two places', () => {
  assert.equal(roundCents(1.005 * 1000 / 1000), 1);
  assert.equal(roundCents(2.499), 2.5);
});
