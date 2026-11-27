import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellTasks, taskHalf, type Cell, type Prereg } from '../runner/run.ts';

const fam = (id: string) => (id.endsWith('capture') ? 'owner_identity_C' : id.endsWith('live') ? 'owner_identity_L' : 'owner_identity_I');
const ids = [...Array.from({ length: 6 }, (_, i) => `oi-${String(i + 1).padStart(2, '0')}-import`), 'oi-07-live', 'oi-08-live', 'oi-09-live', 'oi-10-capture', 'oi-11-capture'];

describe('task halves for a run planned in two stages (internal-task, R113)', () => {
  const trials = ids.flatMap((task) => [1, 2, 3].map((r) => ({ task, task_dir: task, cell: 'c', repetition: r })));
  test('each half takes alternate tasks of every family, and together they cover each task once', () => {
    const one = taskHalf(trials, 1, (t) => fam(t.task_dir!));
    const two = taskHalf(trials, 2, (t) => fam(t.task_dir!));
    expect(one).toEqual(['oi-01-import', 'oi-03-import', 'oi-05-import', 'oi-07-live', 'oi-09-live', 'oi-10-capture'].sort());
    expect(two).toEqual(['oi-02-import', 'oi-04-import', 'oi-06-import', 'oi-08-live', 'oi-11-capture'].sort());
    expect([...one, ...two].sort()).toEqual([...ids].sort());
  });
  test('the halves do not depend on trial order', () => {
    expect(taskHalf([...trials].reverse(), 1, (t) => fam(t.task_dir!))).toEqual(taskHalf(trials, 1, (t) => fam(t.task_dir!)));
  });
  test('a trial with no task directory is refused', () => {
    expect(() => taskHalf([{ task: 'x' }], 1, () => 'f')).toThrow(/no task directory/);
  });
});

describe('cell families', () => {
  const root = mkdtempSync(join(tmpdir(), 'he-families-'));
  for (const id of ids) {
    mkdirSync(join(root, 'multiuser', 'fam-set', 'dev', id), { recursive: true });
    writeFileSync(join(root, 'multiuser', 'fam-set', 'dev', id, 'task.toml'), `id = "${id}"\nslice = "multiuser"\nfamily = "${fam(id)}"\nsplit = "dev"\ntime_budget_s = 60\nactors = ["a"]\n\n[[turns]]\nactor = "a"\nchannel = "dm"\ntext = "hi"\n`);
  }
  const prereg = { tasks: {} } as unknown as Prereg;
  const cell = (families?: string[]) => ({ id: 'c', harness: 'claude-code', model: 'm', slice: 'multiuser', split: 'dev', task_set: 'fam-set', repetitions: 1, ...(families ? { families } : {}) }) as unknown as Cell;
  test('a cell with families runs only those families', () => {
    expect(cellTasks(prereg, cell(['owner_identity_I', 'owner_identity_L']), root)).toEqual(ids.filter((i) => !i.endsWith('capture')));
    expect(cellTasks(prereg, cell(['owner_identity_C']), root)).toEqual(['oi-10-capture', 'oi-11-capture']);
    expect(cellTasks(prereg, cell(), root)).toEqual(ids);
  });
  test('families that match no task are refused', () => {
    expect(() => cellTasks(prereg, cell(['nope']), root)).toThrow(/no task of set fam-set is in families nope/);
  });
});
