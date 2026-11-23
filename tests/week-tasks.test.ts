// The week tasks (docs/tasks.md, "Week events"), scripted: the four week predicates (told_by, timer_set, max_bot_posts,
// no_repeat_posts). Keyless. The scripted executor plays the fixture week task's oracle and mutations, and every task under
// tasks/multiuser/week/, through the real runner and the real grader, so each mutation fails exactly the predicate it is named
// for. Scripted runs start no metering proxy, so this file runs in scripts/run-tests.sh's parallel phase; the week cases that
// start one are in tests/week-rig.test.ts.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '../runner/contracts.ts';
import type { Cell } from '../runner/run.ts';
import { loadGrader } from '../runner/trial/trial.ts';
import { ROOT, runWeek } from './helpers/week-run.ts';

const FIXTURES = join(import.meta.dir, 'fixtures', 'week-tasks');
const tmp = mkdtempSync(join(tmpdir(), 'he-week-tasks-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Oracle and every mutation of each week task under root, played by the scripted executor through the real runner and grader. */
async function matrix(root: string, taskSet?: string) {
  const base = join(root, 'multiuser', ...(taskSet ? [taskSet] : []), 'dev');
  const ids = existsSync(base) ? readdirSync(base).filter((d) => existsSync(join(base, d, 'task.toml'))).sort() : [];
  const grade = await loadGrader();
  for (const id of ids) {
    test(`${taskSet ?? 'fixture'} ${id}: the oracle passes every predicate and each mutation fails exactly its own`, async () => {
      const cell = (cid: string, script: 'oracle' | 'mutations'): Cell => ({ id: cid, harness: 'scripted', model: 'none', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 0, output_tokens: 0 },
        harness_mode: 'scripted', script, tasks: [id], ...(taskSet ? { task_set: taskSet } : {}) });
      const { records, lines } = await runWeek(tmp, [cell('oracle', 'oracle'), cell('mut', 'mutations')], root, grade);
      const mutations = readdirSync(join(base, id, 'mutations')).map((f) => f.replace(/\.json$/, '')).sort();
      expect(records).toHaveLength(1 + mutations.length);
      for (const rec of records) {
        const failed = rec.predicates.filter((p) => !p.passed).map((p) => p.id);
        const name = rec.script!.split('/').pop()!.replace(/\.json$/, '');
        const also = name === 'oracle' ? [] : (JSON.parse(readFileSync(join(base, id, 'mutations', `${name}.json`), 'utf8')) as Script).also_fails ?? [];
        expect(rec.termination, `${name}: ${rec.error ?? lines.slice(-5).join(' | ')}`).toBe('completed');
        expect(failed, `${name}: ${rec.predicates.filter((p) => !p.passed).map((p) => p.evidence).join(' | ')}`).toEqual(name === 'oracle' ? [] : [name, ...also].sort());
      }
    }, 180_000);
  }
  return ids;
}

describe('week tasks, scripted', async () => {
  const fixtures = await matrix(FIXTURES);
  test('the fixture week task is there', () => expect(fixtures).toEqual(['fx-03-week']));
  const week = await matrix(join(ROOT, 'tasks'), 'week');
  test('the week set has its ten dev tasks', () => expect(week).toHaveLength(10));
});
