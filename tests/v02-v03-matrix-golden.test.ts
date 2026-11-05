// v0.4 (internal-task) regression: the v0.2 and v0.3 task matrices and grades are byte-identical to the ones recorded before
// v0.4's world expiry, record retirement and lifecycle fields landed. For every v0.2 task (dev and held-out, as the matrix
// test already plays them) and every v0.3 dev task, the parsed task.toml and, for the oracle and each mutation, the grade,
// the snapshot and the event log (wall-clock stamps removed) hash to the digests in the fixture. Keyless.
//
// Regenerate the fixture only for a change that is meant to alter v0.2 or v0.3 grading:
//   HE_WRITE_GOLDEN=1 bun test tests/v02-v03-matrix-golden.test.ts

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script } from '../runner/contracts.ts';
import { gradeTrial } from '../runner/grade/index.ts';
import { playScript } from '../runner/grade/play.ts';
import { loadTask } from '../runner/grade/task.ts';
import { digest } from '../world/services/events.ts';
import { world } from './world-helpers.ts';

const ROOT = join(import.meta.dir, '..', 'tasks', 'multiuser');
const FIXTURE = join(import.meta.dir, 'fixtures', 'v02-v03-matrix-golden.json');
const SETS: Array<[string, Array<'dev' | 'heldout'>]> = [['v0.2', ['dev', 'heldout']], ['v0.3', ['dev']]];

function taskDirs(set: string, split: string): string[] {
  const dir = join(ROOT, set, split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'task.toml'))).map((d) => join(dir, d.name)).sort();
}

function scripts(dir: string): Array<[string, string]> {
  const mut = join(dir, 'mutations');
  const muts = existsSync(mut) ? readdirSync(mut).filter((f) => f.endsWith('.json')).sort().map((f): [string, string] => [`mutation:${f}`, join(mut, f)]) : [];
  return [['oracle', join(dir, 'oracle.json')], ...muts];
}

const entries = SETS.flatMap(([set, splits]) => splits.flatMap((split) => taskDirs(set, split).map((dir) => ({ key: `${set}/${split}/${dir.split('/').at(-1)}`, dir }))));
const writing = process.env.HE_WRITE_GOLDEN === '1';
const golden: Record<string, Record<string, string>> = writing || !existsSync(FIXTURE) ? {} : JSON.parse(readFileSync(FIXTURE, 'utf8'));
const fresh: Record<string, Record<string, string>> = {};

describe('v0.2 and v0.3 matrices are unchanged by v0.4', () => {
  test('the fixture covers every v0.2 task and every v0.3 dev task', () => {
    if (writing) return;
    expect(Object.keys(golden).sort()).toEqual(entries.map((e) => e.key).sort());
    expect(entries.length).toBe(50);
  });

  for (const { key, dir } of entries) {
    test(key, async () => {
      const task = loadTask(dir);
      const row: Record<string, string> = { task: digest(task) };
      for (const [name, path] of scripts(dir)) {
        const evidence = await playScript(dir, task, JSON.parse(readFileSync(path, 'utf8')) as Script, { world });
        const grade = await gradeTrial(evidence, task);
        row[`${name}:grade`] = digest(grade);
        row[`${name}:snapshot`] = digest(evidence.snapshot);
        row[`${name}:events`] = digest(evidence.events.map(({ wall_ts: _w, ...rest }) => rest));
      }
      fresh[key] = row;
      if (writing) return;
      expect(row).toEqual(golden[key]!);
    }, 60_000);
  }

  test('write the fixture when asked', () => {
    if (!writing) return;
    writeFileSync(FIXTURE, JSON.stringify(Object.fromEntries(Object.entries(fresh).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
  });
});
