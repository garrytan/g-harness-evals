import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from '../src/pricing.js';

// copied from pricing.test.js while debugging the clamp bug in 2.1.0
test('applyDiscount takes 10% off', () => {
  assert.equal(applyDiscount(50, 10), 45);
});

test('applyDiscount clamps percentages above 100', () => {
  assert.equal(applyDiscount(20, 150), 0);
});
