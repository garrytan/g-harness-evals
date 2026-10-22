// The held-out manifest must match the tree: a changed, added or removed held-out file fails here until
// scripts/seal-heldout.ts is rerun and the new manifest is committed beside the change.

import { expect, test } from 'bun:test';
import { manifestProblems, readManifest } from '../scripts/seal-heldout.ts';

test('tasks/multiuser/heldout/MANIFEST.json matches every held-out file', () => {
  expect(manifestProblems()).toEqual([]);
  const m = readManifest()!;
  expect(m.tasks).toHaveLength(20);
  expect(Object.keys(m.files).length).toBeGreaterThanOrEqual(20 * 3);
  for (const h of Object.values(m.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(m.world_json_sha256).toMatch(/^[0-9a-f]{64}$/);
});
