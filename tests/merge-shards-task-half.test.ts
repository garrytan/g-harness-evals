// merge-shards.ts and a run planned in two (scripts/run-shard.sh --task-half, R113): the two stages run from separate dests
// and each records trials of the same cells, so the merge joins one cell's trials from the shard of half 1 and the shard of
// half 2 (shard.json task_half 1 and 2), copies both halves' trial directories and names the pair in shards.json's
// task_halves. A cell in two shards without that pair, two shards of one half, or a trial directory in both is refused.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeShards, planMerge } from '../scripts/merge-shards.ts';

const RUN = 'task-half-fixture-2026-11';
const id = (task: string) => `${RUN}/oi-cc-opus-g/${task}/r1`;
const row = (trial: string) => ({ trial_id: trial, cell: 'oi-cc-opus-g', task: trial.split('/')[2], termination: 'completed', grade: 'pass', cap_stop: false, usage: null, started_at: '' });

function shards(halves: Record<string, { half?: number; tasks: string[] }>): { root: string; input: Array<{ name: string; dir: string }> } {
  const root = mkdtempSync(join(tmpdir(), 'he-task-half-'));
  const manifest = { run_id: RUN, created_at: '2026-11-26T00:00:00.000Z', trials: ['t1', 't2', 't3', 't4'].map((t) => ({ id: id(t), cell: 'oi-cc-opus-g' })) };
  const input = Object.entries(halves).map(([name, { half, tasks }]) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'shard.json'), JSON.stringify({ name, commit: 'c'.repeat(40), ...(half ? { task_half: half } : {}) }));
    writeFileSync(join(dir, 'trials.jsonl'), tasks.map((t) => JSON.stringify(row(id(t)))).join('\n') + '\n');
    for (const t of tasks) {
      mkdirSync(join(dir, 'trials', 'oi-cc-opus-g', t, 'r1'), { recursive: true });
      writeFileSync(join(dir, 'trials', 'oi-cc-opus-g', t, 'r1', 'trial.json'), JSON.stringify({ id: id(t) }));
    }
    return { name, dir };
  });
  return { root, input };
}

describe('merge-shards: the two halves of a run planned in two', () => {
  test('one cell from the half 1 and half 2 shards merges with both halves\' trial directories', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2', 't4'] } });
    const out = join(root, 'out');
    const merged = mergeShards(out, input);
    expect(merged.task_halves).toEqual({ 'oi-cc-opus-g': ['h1', 'h2'] });
    expect(merged.cells).toEqual({ 'oi-cc-opus-g': 'h1' });
    expect(readFileSync(join(out, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).task)).toEqual(['t1', 't2', 't3', 't4']);
    for (const t of ['t1', 't2', 't3', 't4']) expect(existsSync(join(out, 'trials', 'oi-cc-opus-g', t, 'r1', 'trial.json'))).toBe(true);
  });

  test('a cell in two shards without the pair, two shards of one half, or one trial directory in both is refused', () => {
    const plain = shards({ a: { tasks: ['t1', 't3'] }, b: { tasks: ['t2', 't4'] } });
    expect(() => planMerge(join(plain.root, 'out'), plain.input)).toThrow('cell oi-cc-opus-g has trials in shards a and b');
    const same = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h1b: { half: 1, tasks: ['t2', 't4'] } });
    expect(() => planMerge(join(same.root, 'out'), same.input)).toThrow('cell oi-cc-opus-g has trials in shards h1 and h1b');
    const overlap = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2', 't4'] } });
    mkdirSync(join(overlap.input[1]!.dir, 'trials', 'oi-cc-opus-g', 't1'), { recursive: true });
    expect(() => planMerge(join(overlap.root, 'out'), overlap.input)).toThrow('trials/oi-cc-opus-g/t1 is in shards h1 and h2');
  });
});
