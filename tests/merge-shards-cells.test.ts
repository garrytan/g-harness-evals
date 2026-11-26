// scripts/merge-shards.ts --cells (internal-task, v0.4 PR B): a run that ran a subset of its preregistered cells (a calibration
// round, the frozen-dev read) merges with only those cells planned, and the merged manifest.json is restricted to them.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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


describe('merge-shards: leak preflight receipts (Amendment 1, 2026-11-22)', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const record = (arm: string, manifest: string, tokens = 'i') => ({ schema_version: 1, arm, split: 'dev', image: 'img', image_id: 'sha256:1', gbrain_commit: 'c', ok: true, layout: { sidecar: { brain: 'member' }, manifest_sha256: manifest, ingest_tokens_sha256: tokens }, facts: [], asked: [], write_carry: null, informational: {}, problems: [], summary: { askers: 0, facts: 0, database_only: 0, calls: 0 } });
  const withLeak = (root: string, name: string, cells: string[], arm: string, manifestSha: string) => {
    const d = shard(root, name, cells);
    writeFileSync(join(d, `leak-preflight-${arm}-dev.json`), JSON.stringify(record(arm, manifestSha)));
    return d;
  };
  // A shard as the counted run leaves it: its own build's manifest.json and ingest-tokens.json in a preflight directory, and
  // records whose hashes are those files' sha256.
  const built = (root: string, name: string, cells: string[], arms: string[], brain: { built_at: string; sources: string[]; tokenSeed: string; grants?: unknown }) => {
    const d = shard(root, name, cells);
    const p = join(d, 'preflight-gbrain-member-dev');
    mkdirSync(p, { recursive: true });
    const manifest = JSON.stringify({ schema_version: 3, built_at: brain.built_at, grants: brain.grants ?? [{ member: 'a', sources: ['private-a'] }], imports: Object.fromEntries(brain.sources.map((s, i) => [s, { pages: 2, duration_s: i + brain.built_at.length / 10 }])) });
    const tokens = JSON.stringify({ schema_version: 1, brain: 'member', split: 'dev', sources: Object.fromEntries(brain.sources.map((s) => [s, `tok-${brain.tokenSeed}-${s}`])) });
    writeFileSync(join(p, 'manifest.json'), manifest);
    writeFileSync(join(p, 'ingest-tokens.json'), tokens);
    for (const arm of arms) writeFileSync(join(d, `leak-preflight-${arm}-dev.json`), JSON.stringify(record(arm, sha(manifest), sha(tokens))));
    return d;
  };

  test('each shard\'s leak preflight record is kept under its shard name', () => {
    const root = dir();
    const shards = [{ name: 's1', dir: built(root, 's1', ['a', 'b'], ['open'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'x' }) }, { name: 's2', dir: built(root, 's2', ['c'], ['member-sources'], { built_at: '2026-11-25T02:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'y' }) }];
    const out = join(root, 'out');
    mergeShards(out, shards);
    expect(JSON.parse(readFileSync(join(out, 's1.leak-preflight-open-dev.json'), 'utf8')).arm).toBe('open');
    expect(JSON.parse(readFileSync(join(out, 's2.leak-preflight-member-sources-dev.json'), 'utf8')).arm).toBe('member-sources');
  });

  test('records of one split that disagree on the brain layout across shards are refused, naming both shards', () => {
    const root = dir();
    const shards = [{ name: 's1', dir: built(root, 's1', ['a', 'b'], ['open'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'x' }) }, { name: 's2', dir: built(root, 's2', ['c'], ['member-sources'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'x', grants: [{ member: 'a', sources: ['private-a', 'public'] }] }) }];
    expect(() => planMerge(join(root, 'out'), shards)).toThrow(/manifest_sha256 differ.*\(s1\/leak-preflight-open-dev\.json against s2\/leak-preflight-member-sources-dev\.json\)/);
    const sources = [{ name: 's1', dir: built(root, 't1', ['a', 'b'], ['open'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'x' }) }, { name: 's2', dir: built(root, 't2', ['c'], ['member-sources'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a'], tokenSeed: 'x' }) }];
    expect(() => planMerge(join(root, 'out2'), sources)).toThrow(/ingest_tokens_sha256 differ/);
  });

  test('across shards a new build of one layout merges: built_at, import timings and token values may differ', () => {
    const root = dir();
    const shards = [{ name: 's1', dir: built(root, 's1', ['a', 'b'], ['open'], { built_at: '2026-11-24T01:00:00Z', sources: ['private-a', 'public'], tokenSeed: 'x' }) }, { name: 's2', dir: built(root, 's2', ['c'], ['member-sources'], { built_at: '2026-11-25T02:00:00.5Z', sources: ['private-a', 'public'], tokenSeed: 'y' }) }];
    expect(() => planMerge(join(root, 'out'), shards)).not.toThrow();
  });

  test('within one shard the records are compared byte for byte, and a record whose files its shard lacks is refused', () => {
    const root = dir();
    const one = withLeak(root, 's1', ['a', 'b', 'c'], 'open', 'm');
    writeFileSync(join(one, 'leak-preflight-member-sources-dev.json'), JSON.stringify(record('member-sources', 'other')));
    expect(() => planMerge(join(root, 'out'), [{ name: 's1', dir: one }])).toThrow(/manifest_sha256 differ/);
    const shards = [{ name: 's1', dir: withLeak(root, 'u1', ['a', 'b'], 'open', 'm') }, { name: 's2', dir: withLeak(root, 'u2', ['c'], 'member-sources', 'm') }];
    expect(() => planMerge(join(root, 'out2'), shards)).toThrow(/s1\/leak-preflight-open-dev\.json: no preflight directory in its shard holds the manifest\.json/);
  });
});
