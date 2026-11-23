// merge-shards.ts --amendment (shared-brain-access-2026-11's lease amendment): shards planned after a dated amendment changed
// the preregistration merge with the shards planned before it when they differ only in prereg_sha256 and spend_cap_usd and
// the amendment's preregistration hashes to their prereg_sha256. Without --amendment the merge refuses exactly as before, and
// any other difference, an unused amendment or one naming the first shard's own preregistration is refused.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MergeError, mergeShards, planMerge, resolveAmendment } from '../scripts/merge-shards.ts';

const RUN = 'amendment-fixture-2026-11';
const BASE = 'a'.repeat(64);
const AMENDED = 'b'.repeat(64);
const ids = (cell: string) => ['t1', 't2'].map((task) => `${RUN}/${cell}/${task}/r1`);
const row = (id: string) => ({ trial_id: id, cell: id.split('/')[1], task: id.split('/')[2], termination: 'completed', grade: 'pass', cap_stop: false, usage: null, started_at: '' });

/** Cell x ran under the original plan; cell y under the amendment, with a higher cap. */
function shards(overrides: Record<string, unknown> = {}): { root: string; input: Array<{ name: string; dir: string }> } {
  const root = mkdtempSync(join(tmpdir(), 'he-merge-amendment-'));
  const trials = ['x', 'y'].flatMap((cell) => ids(cell).map((id) => ({ id, cell })));
  const plans: Record<string, Record<string, unknown>> = {
    x: { run_id: RUN, created_at: '2026-11-21T00:00:00.000Z', prereg_sha256: BASE, spend_cap_usd: 521, trials },
    y: { run_id: RUN, created_at: '2026-11-23T00:00:00.000Z', prereg_sha256: AMENDED, spend_cap_usd: 541, trials, ...overrides },
  };
  const input = Object.entries(plans).map(([cell, manifest]) => {
    const dir = join(root, cell);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'trials.jsonl'), ids(cell).map((id) => JSON.stringify(row(id))).join('\n') + '\n');
    return { name: cell, dir };
  });
  return { root, input };
}
const refusal = (f: () => unknown): string => { try { f(); } catch (e) { if (e instanceof MergeError) return e.message; throw e; } return 'no refusal'; };

describe('merge-shards --amendment', () => {
  test('without --amendment, shards planned under different preregistrations are refused exactly as before', () => {
    const { root, input } = shards();
    expect(refusal(() => planMerge(join(root, 'out'), input))).toBe("shard y: manifest.json differs from shard x's in prereg_sha256, spend_cap_usd; every shard must run plan at the same commit on the same preregistration");
  });

  test("an amended shard merges, the first shard's manifest is kept, and shards.json names the amendment and its shards", () => {
    const { root, input } = shards();
    const out = join(root, 'out');
    const f = mergeShards(out, input, { amendments: [{ commit: 'c0ffee', prereg_sha256: AMENDED }] });
    expect(Object.keys(f.cells).sort()).toEqual(['x', 'y']);
    expect(f.amendments).toEqual([{ commit: 'c0ffee', prereg_sha256: AMENDED, spend_cap_usd: 541, shards: ['y'] }]);
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).prereg_sha256).toBe(BASE);
    expect(JSON.parse(readFileSync(join(out, 'y.manifest.json'), 'utf8')).prereg_sha256).toBe(AMENDED);
    expect(readFileSync(join(out, 'trials.jsonl'), 'utf8').trim().split('\n').length).toBe(4);
  });

  test('an amended shard that differs in any other field is still refused', () => {
    const { root, input } = shards({ gbrain_commit: 'deadbeef' });
    expect(refusal(() => planMerge(join(root, 'out'), input, { amendments: [{ commit: 'c0ffee', prereg_sha256: AMENDED }] }))).toContain('differs from shard x\'s in prereg_sha256, spend_cap_usd, gbrain_commit');
  });

  test('a shard whose preregistration is not the named amendment is refused', () => {
    const { root, input } = shards();
    expect(refusal(() => planMerge(join(root, 'out'), input, { amendments: [{ commit: 'c0ffee', prereg_sha256: 'c'.repeat(64) }] }))).toContain("shard y: manifest.json differs from shard x's in prereg_sha256, spend_cap_usd");
  });

  test("an amendment no shard was planned under, or one naming the first shard's preregistration, is refused", () => {
    const { root, input } = shards();
    const both = [{ commit: 'c0ffee', prereg_sha256: AMENDED }];
    expect(refusal(() => planMerge(join(root, 'out'), input, { amendments: [...both, { commit: 'feed', prereg_sha256: 'c'.repeat(64) }] }))).toBe('--amendment feed: no shard was planned under its preregistration (sha256 cccccccccccc)');
    expect(refusal(() => planMerge(join(root, 'out'), input, { amendments: [...both, { commit: 'base', prereg_sha256: BASE }] }))).toBe('--amendment base: its preregistration is the one shard x was planned under; an amendment names a later preregistration');
  });

  test("resolveAmendment hashes the run's prereg.json at a commit in the checkout's history and refuses one outside it", () => {
    const repo = mkdtempSync(join(tmpdir(), 'he-merge-amendment-git-'));
    const home = mkdtempSync(join(tmpdir(), 'he-merge-amendment-home-'));
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home } });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(repo, 'docs/benchmarks/run'), { recursive: true });
    const write = (cap: number) => { const text = JSON.stringify({ run_id: RUN, spend_cap_usd: cap }) + '\n'; writeFileSync(join(repo, 'docs/benchmarks/run/prereg.json'), text); return text; };
    write(521); git('add', '.'); git('commit', '-q', '-m', 'plan');
    const amended = write(541); git('add', '.'); git('commit', '-q', '-m', 'amend');
    const head = git('rev-parse', 'HEAD').stdout.trim();
    expect(resolveAmendment('HEAD', RUN, repo)).toEqual({ commit: head, prereg_sha256: createHash('sha256').update(amended).digest('hex') });
    expect(refusal(() => resolveAmendment('HEAD', 'other-run', repo))).toBe('--amendment HEAD: no docs/benchmarks/*/prereg.json at that commit has run_id other-run');
    git('checkout', '-q', '-b', 'side', 'HEAD~1');
    expect(refusal(() => resolveAmendment(head, RUN, repo))).toBe(`--amendment ${head}: not in this checkout's history; merge from a checkout that holds the amendment`);
    expect(refusal(() => resolveAmendment('nope', RUN, repo))).toBe('--amendment nope: not a commit in this checkout');
  });
});
