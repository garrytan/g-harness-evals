import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _clampPercent } from '../src/pricing.js';

test('_clampPercent caps at 100', () => {
  assert.equal(_clampPercent(150), 100);
});

test('_clampPercent floors at 0', () => {
  assert.equal(_clampPercent(-5), 0);
});
