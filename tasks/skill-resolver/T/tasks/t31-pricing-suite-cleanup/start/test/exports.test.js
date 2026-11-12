import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pkg from '../src/index.js';

test('package exports applyDiscount and roundCents', () => {
  assert.deepEqual(Object.keys(pkg).sort(), ['applyDiscount', 'roundCents']);
});
