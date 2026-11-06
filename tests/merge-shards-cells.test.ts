// scripts/merge-shards.ts --cells (internal-task, v0.4 PR B): a run that ran a subset of its preregistered cells (a calibration
// round, the frozen-dev read) merges with only those cells planned, and the merged manifest.json is restricted to them.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeShards, planMerge } from '../scripts/merge-shards.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'merge-cells-'));
const trials = ['a', 'b', 'c'].flatMap((cell) => [1, 2].map((r) => ({ id: `run/${cell}/t1/r${r}`, cell, task: 't1', repetition: r })));
const manifest = { schema_version: 1, run_id: 'run', prereg_sha256: 'x', created_at: '2026-11-02T00:00:00Z', cells: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], trials, cost_ceiling_usd: 6, per_cell_ceiling_usd: { a: 1, b: 2, c: 3 }, spend_cap_usd: 10 };
function shard(root: string, name: string, cells: string[], preflight: unknown = { clean: true }): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
  if (preflight !== null) writeFileSync(join(d, 'preflight-clean-arm.json'), JSON.stringify(preflight));
  writeFileSync(join(d, 'trials.jsonl'), trials.filter((t) => cells.includes(t.cell)).map((t) => JSON.stringify({ trial_id: t.id, cell: t.cell, task: t.task, termination: 'completed', grade: 'pass' })).join('\n') + '\n');
  return d;
}

describe('merge-shards --cells', () => {
  test('only the listed cells are planned and the merged manifest is restricted to them', () => {
    const root = dir();
    const shards = [{ name: 's1', dir: shard(root, 's1', ['a']) }, { name: 's2', dir: shard(root, 's2', ['c']) }];
    expect(() => planMerge(join(root, 'out0'), shards)).toThrow(/2 manifest trial\(s\) in no shard: run\/b\/t1\/r1, run\/b\/t1\/r2/);
    const out = join(root, 'out');
    const f = mergeShards(out, shards, { cells: ['a', 'c'] });
    expect(f.cells).toEqual({ a: 's1', c: 's2' });
    const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect([m.cells.map((c: { id: string }) => c.id), m.trials.length, m.per_cell_ceiling_usd, m.cost_ceiling_usd, m.subset]).toEqual([['a', 'c'], 4, { a: 1, c: 3 }, 4, { prereg_cells: 3, prereg_trials: 6, cells: 2, trials: 4 }]);
    expect(readFileSync(join(out, 'trials.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4);
    expect(JSON.parse(readFileSync(join(out, 's2.manifest.json'), 'utf8')).trials).toHaveLength(6);
  });

  test('a listed cell missing its trials, a trial of an unlisted cell, and an unknown cell are refused', () => {
    const root = dir();
    const shards = [{ name: 's1', dir: shard(root, 's1', ['a']) }, { name: 's2', dir: shard(root, 's2', ['c']) }];
    expect(() => planMerge(join(root, 'o1'), shards, { cells: ['a', 'b', 'c'] })).toThrow(/in no shard: run\/b\/t1\/r1/);
    expect(() => planMerge(join(root, 'o2'), shards, { cells: ['a'] })).toThrow(/2 trial\(s\) not in the manifest's --cells: run\/c\/t1\/r1 \(shard s2\)/);
    expect(() => planMerge(join(root, 'o3'), shards, { cells: ['a', 'z'] })).toThrow(/--cells names z, not in the manifest/);
    expect(() => planMerge(join(root, 'o4'), shards, { cells: ['a', 'a'] })).toThrow(/distinct/);
  });

  test('every shard needs a clean-arm preflight that records clean: true, and the refusal names the shard; without --cells it is not read', () => {
    const root = dir();
    const missing = [{ name: 's1', dir: shard(root, 's1', ['a']) }, { name: 's2', dir: shard(root, 's2', ['c'], null) }];
    expect(() => planMerge(join(root, 'p1'), missing, { cells: ['a', 'c'] })).toThrow(/^shard s2: .*preflight-clean-arm\.json is missing/);
    const dirty = [{ name: 's1', dir: shard(root, 'd1', ['a'], { clean: false }) }, { name: 's2', dir: shard(root, 'd2', ['c']) }];
    expect(() => planMerge(join(root, 'p2'), dirty, { cells: ['a', 'c'] })).toThrow(/^shard s1: .*does not record clean: true/);
    const whole = [{ name: 's1', dir: shard(root, 'w1', ['a', 'b'], null) }, { name: 's2', dir: shard(root, 'w2', ['c'], null) }];
    expect(planMerge(join(root, 'p3'), whole).rows).toHaveLength(6);
  });

  test('a manifest without cells is a MergeError under --cells, not a crash', () => {
    const root = dir();
    const d = shard(root, 's1', ['a', 'b', 'c']);
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ ...manifest, cells: undefined }));
    expect(() => planMerge(join(root, 'o'), [{ name: 's1', dir: d }], { cells: ['a'] })).toThrow(/needs shard manifests that list their cells/);
  });
});
