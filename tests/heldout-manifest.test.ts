// Every held-out manifest must match its tree: a changed, added or removed held-out file fails here until
// scripts/seal-heldout.ts is rerun for that set and the new manifest is committed beside the change. A held-out
// tree that holds tasks but no manifest is unsealed and fails too.

import { expect, test } from 'bun:test';
import { heldoutSets, manifestProblems, readManifest } from '../scripts/seal-heldout.ts';

test('tasks/multiuser/heldout/MANIFEST.json matches every v0.1 held-out file', () => {
  const [v01] = heldoutSets();
  expect(v01!.name).toBe('v0.1');
  expect(manifestProblems(v01)).toEqual([]);
  const m = readManifest(v01)!;
  expect(m.tasks).toHaveLength(20);
  expect(Object.keys(m.files).length).toBeGreaterThanOrEqual(20 * 3);
  for (const h of Object.values(m.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(m.world_json_sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('every other held-out tree is sealed and matches its manifest', () => {
  for (const set of heldoutSets().slice(1)) {
    expect(manifestProblems(set)).toEqual([]);
    const m = readManifest(set)!;
    expect(m.tasks.length).toBeGreaterThan(0);
    for (const h of Object.values(m.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  }
});
