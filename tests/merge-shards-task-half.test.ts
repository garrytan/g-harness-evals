// merge-shards.ts and a run planned in two (scripts/run-shard.sh --task-half, R113): the two stages run from separate dests
// and each records trials of the same cells, so the merge joins one cell's trials from the shard of half 1 and the shard of
// half 2 (shard.json task_half 1 and 2), copies both halves' trial directories and names the pair in shards.json's
// task_halves. A cell in two shards without that pair, two shards of one half (a third shard included), or a trial directory in both is refused.
// Each half shard's task-half.json says which trials it owes, so --partial checks each half on its own and the stage-1 look
// merges half 1 shards without owing half 2's trials when it is asked for (--stage1-look); a final merge owes both halves, and
// a half shard holding a trial of the other half's tasks is refused, as are task-half.json lists that do not split the cell's
// tasks between the halves or a half 1 list short of half the cell's tasks.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeShards, planMerge } from '../scripts/merge-shards.ts';

const RUN = 'task-half-fixture-2026-11';
const id = (task: string) => `${RUN}/oi-cc-opus-g/${task}/r1`;
const row = (trial: string) => ({ trial_id: trial, cell: 'oi-cc-opus-g', task: trial.split('/')[2], termination: 'completed', grade: 'pass', cap_stop: false, usage: null, started_at: '' });

function shards(halves: Record<string, { half?: number; tasks: string[]; halfTasks?: string[]; capStop?: string }>): { root: string; input: Array<{ name: string; dir: string }> } {
  const root = mkdtempSync(join(tmpdir(), 'he-task-half-'));
  const manifest = { run_id: RUN, created_at: '2026-11-26T00:00:00.000Z', trials: ['t1', 't2', 't3', 't4'].map((t) => ({ id: id(t), cell: 'oi-cc-opus-g' })) };
  const input = Object.entries(halves).map(([name, { half, tasks, halfTasks: halfTaskList, capStop }]) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'shard.json'), JSON.stringify({ name, commit: 'c'.repeat(40), cells: 'oi-cc-opus-g', ...(half ? { task_half: half } : {}) }));
    if (half) writeFileSync(join(dir, 'task-half.json'), JSON.stringify({ half, tasks: halfTaskList ?? (half === 1 ? ['t1', 't3'] : ['t2', 't4']) }));
    writeFileSync(join(dir, 'trials.jsonl'), tasks.map((t) => JSON.stringify(t === capStop ? { ...row(id(t)), termination: 'model_error', grade: 'n/a', cap_stop: true, started_at: '2026-11-27T00:00:00.000Z' } : row(id(t)))).join('\n') + '\n');
    if (capStop) writeFileSync(join(dir, 'proxy-usage.ndjson'), JSON.stringify({ at: '2026-11-27T00:01:00.000Z', key: `trial-token:${id(capStop)}`, outcome: 'refused', reason: 'trial-token over its $0.50 budget', actual_usd: 0 }) + '\n');
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

  test('--partial merges a cell whose half 2 stopped on its cap, checking each half against its own tasks and shard', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2'], capStop: 't2' } });
    expect(() => planMerge(join(root, 'out'), input)).toThrow('1 manifest trial(s) in no shard');
    const plan = planMerge(join(root, 'out'), input, { partial: true });
    expect(plan.capStops).toEqual([{ cell: 'oi-cc-opus-g', shard: 'h2', cap_stop_trial: id('t2') }]);
    expect(plan.unstarted).toEqual([{ id: id('t4'), cell: 'oi-cc-opus-g' }]);
    const nocap = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2'] } });
    expect(() => planMerge(join(nocap.root, 'out'), nocap.input, { partial: true })).toThrow(`oi-cc-opus-g in shard h2 (last record ${id('t2')} is not a cap stop)`);
  });

  test('the stage-1 look (--stage1-look) merges half 1 shards alone: half 2 trials are not owed, and a half 1 gap still is', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] } });
    const plan = planMerge(join(root, 'out'), input, { stage1Look: true });
    expect(plan.rows.map((r) => r.task)).toEqual(['t1', 't3']);
    expect(plan.unstarted).toEqual([]);
    const short = shards({ h1: { half: 1, tasks: ['t1'] } });
    expect(() => planMerge(join(short.root, 'out'), short.input, { stage1Look: true })).toThrow(`1 manifest trial(s) in no shard: ${id('t3')}`);
    const both = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2', 't4'] } });
    expect(() => planMerge(join(both.root, 'out'), both.input, { stage1Look: true })).toThrow('--stage1-look merges the half 1 shards of a run planned in two, and h2 is a half 2 shard');
    const plain = shards({ s1: { tasks: ['t1', 't2', 't3', 't4'] } });
    expect(() => planMerge(join(plain.root, 'out'), plain.input, { stage1Look: true })).toThrow('no shard given is one');
  });

  test('a final merge that leaves out a half\'s shard is refused, with --partial too: without --stage1-look a half shard\'s cell owes every planned trial', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] } });
    expect(() => planMerge(join(root, 'out'), input)).toThrow(`2 manifest trial(s) in no shard: ${id('t2')}, ${id('t4')}; an incomplete shard`);
    expect(() => planMerge(join(root, 'out'), input)).toThrow('merges its half 1 shards with --stage1-look');
    expect(() => planMerge(join(root, 'out'), input, { partial: true })).toThrow(`oi-cc-opus-g (2 trial(s) of a half with no shard given, such as ${id('t2')}`);
  });

  test('a half shard that recorded a trial of the other half\'s tasks is refused (a resume without its --task-half)', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't2', 't3'] } });
    expect(() => planMerge(join(root, 'out'), input, { stage1Look: true })).toThrow(`shard h1 records trial ${id('t2')}, whose task is not in its task-half.json (half 1)`);
    const pair = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2', 't4'], halfTasks: ['t2'] } });
    expect(() => planMerge(join(pair.root, 'out'), pair.input)).toThrow(`shard h2 records trial ${id('t4')}, whose task is not in its task-half.json (half 2)`);
  });

  test('task-half.json lists that do not split the cell\'s tasks, or a half 1 list short of half, are refused', () => {
    const gap = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2: { half: 2, tasks: ['t2'], halfTasks: ['t2'] } });
    expect(() => planMerge(join(gap.root, 'out'), gap.input)).toThrow('cell oi-cc-opus-g: the task-half.json lists of shards h1 and h2 leave out t4');
    const shared = shards({ h1: { half: 1, tasks: ['t1', 't3'], halfTasks: ['t1', 't2', 't3'] }, h2: { half: 2, tasks: ['t4'], halfTasks: ['t2', 't4'] } });
    expect(() => planMerge(join(shared.root, 'out'), shared.input)).toThrow('the task-half.json lists of shards h1 and h2 share t2');
    const short = shards({ h1: { half: 1, tasks: ['t1'], halfTasks: ['t1'] } });
    expect(() => planMerge(join(short.root, 'out'), short.input, { stage1Look: true })).toThrow("shard h1: its task-half.json lists 1 of cell oi-cc-opus-g's 4 tasks");
  });

  test('a half shard with no task-half.json is refused, since its owed trials cannot be told apart', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] } });
    rmSync(join(input[0]!.dir, 'task-half.json'));
    expect(() => planMerge(join(root, 'out'), input)).toThrow('task-half.json, the half\'s task list the runner writes, is missing');
  });

  test('a third shard of a half the cell already has is refused, though it pairs with the other half', () => {
    const { root, input } = shards({ h1: { half: 1, tasks: ['t1', 't3'] }, h2a: { half: 2, tasks: ['t2'] }, h2b: { half: 2, tasks: ['t4'] } });
    expect(() => planMerge(join(root, 'out'), input)).toThrow('cell oi-cc-opus-g has trials in shards h2a and h2b');
  });
});
