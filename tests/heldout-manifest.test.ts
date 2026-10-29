// Every held-out manifest must match its tree: a changed, added or removed held-out file fails here until
// scripts/seal-heldout.ts is rerun for that set and the new manifest is committed beside the change. A held-out
// tree that holds tasks but no manifest is unsealed and fails too.

import { expect, test } from 'bun:test';
import { buildManifest, heldoutSets, ledgerProblems, manifestProblems, readManifest, type HeldoutManifest } from '../scripts/seal-heldout.ts';

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
    // internal-task phase 3: a set in sealed custody lists no task or file publicly; its commitments are checked keyless instead.
    if (m.custody === 'sealed') {
      expect(m.tasks).toEqual([]);
      expect(m.sealed!.task_count).toBeGreaterThan(0);
      continue;
    }
    expect(m.tasks.length).toBeGreaterThan(0);
    for (const h of Object.values(m.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  }
});
// internal-task: the openings ledger sits outside the tree digest, so both sets keep the digests their runs were sealed under,
// and resealing an unchanged tree reproduces the committed manifest, ledger included.
test('the openings ledgers leave both tree digests unchanged and survive a reseal', () => {
  const [v01, v02] = heldoutSets();
  expect(readManifest(v01)!.tree_sha256).toBe('9a95a465632c705b2ba4485bde48f05bf95e6b0f2b7a5c9edb251ed97e330472');
  expect(readManifest(v02)!.tree_sha256).toBe('f12ba073f8f76fe8ffdcff5f3ac97d937e07dd9f55f1c05dba4423967ecd6c74');
  for (const set of [v01!, v02!]) {
    const committed = readManifest(set)!;
    expect(committed.openings!.length).toBeGreaterThan(0);
    expect(buildManifest(committed, set)).toEqual(committed);
    const { opening_budget: _b, alpha_per_opening: _a, status: _s, openings: _o, exposures: _e, ...tree } = committed;
    expect(buildManifest(tree as HeldoutManifest, set).tree_sha256).toBe(committed.tree_sha256);
  }
});

test('ledgerProblems names a missing field, a bad status or label, a dev row without a reason and a duplicate run id', () => {
  const m = readManifest(heldoutSets()[0])!;
  expect(ledgerProblems(m)).toEqual([]);
  const { exposures: _e, ...noExposures } = m;
  expect(ledgerProblems(noExposures as HeldoutManifest)).toContain('openings ledger: exposures is missing (a ledger has all of opening_budget, alpha_per_opening, status, openings, exposures)');
  const bad = { ...m, status: 'closed', openings: [{ run_id: 'x', status: 'opened', label: 'maybe', candidate_sha256: null }, { run_id: 'y', status: 'opened', label: 'dev', candidate_sha256: null }, { run_id: 'y', status: 'gone', label: 'dev', reason: 'r', candidate_sha256: 'abc' }] } as unknown as HeldoutManifest;
  expect(ledgerProblems(bad)).toEqual([
    'openings ledger: status must be one of open, spent, retired (got "closed")',
    'openings ledger: openings[0] (x): label must be one of confirmatory, dev (got "maybe")',
    'openings ledger: openings[1] (y): a dev row needs a reason',
    'openings ledger: openings[2] (y): run_id appears twice',
    'openings ledger: openings[2] (y): status must be one of planned, opened, withdrawn, superseded (got "gone")',
    'openings ledger: openings[2] (y): candidate_sha256 must be 64 hex characters or null (got "abc")',
  ]);
});
