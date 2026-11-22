// compare-run.ts --pair gbrain joins each pair on its repetition id (g-harness-evals#5), keyless, on hand-built results
// directories: a repetition missing in the middle of one cell is excluded under its own id and the pairs after it stay
// matched, on the arm design and on the install ladder. Before the fix both paths paired the sorted trials by position, so
// none/r2 met gbrain/r3 and a zero effect read as -50 points.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'pairing-fixture-2026-11';
const TASK_ROOT = join(ROOT, 'tasks', 'multiuser', 'v0.3', 'dev');
const TASKS = readdirSync(TASK_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(0, 10);
const FAMILIES = [...new Set(TASKS.map((t) => readFileSync(join(TASK_ROOT, t, 'task.toml'), 'utf8').match(/^family = "([^"]+)"/m)![1]!))];
const run = (args: string[]) => spawnSync('bun', [join(ROOT, 'scripts/compare-run.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });

function trial(cell: string, task: string, rep: number, pass: boolean): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/r${rep}`, cell, task, harness: 'oc', harness_mode: 'docker', model: 'm1', script: null,
    termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [],
    predicates: [{ id: 'answer', kind: 'required', passed: pass, evidence: pass ? 'matched' : 'no match' }],
    cap_stop: false, turns: { planned: 1, run: 1, exits: [0] },
    usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 1000, started_at: '', ended_at: '', paths: {},
  };
}

/** Every task: the base cell passes r1 and r2 and fails r3; the other cell does the same but has no r2 (or, with
 *  missingIn 'base', the base cell has no r2). Matched by id, every kept pair agrees, so the paired delta is 0. */
function fixture(cells: Array<{ id: string; gbrain?: object }>, missingIn: 'base' | 'other', extra: TrialRecord[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-pairing-'));
  const [base, other] = cells.map((c) => c.id) as [string, string];
  const rows = TASKS.flatMap((task) => [1, 2, 3].flatMap((r) => [base, other].filter((cell) => r !== 2 || cell !== (missingIn === 'base' ? base : other)).map((cell) => trial(cell, task, r, r < 3))));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, trials: [], cells: cells.map((c) => ({ ...c, harness: 'oc', model: 'm1', slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: 3 })) }));
  writeFileSync(join(dir, 'trials.jsonl'), [...rows, ...extra].map((t) => JSON.stringify(t)).join('\n') + '\n');
  return dir;
}

const ARM = [{ id: 'oc-none' }, { id: 'oc-gbrain', gbrain: { surface: 'starter' } }];
const LADDER = [{ id: 'oc-none' }, { id: 'oc-gbrain-mcp', gbrain: { surface: 'starter' } }];
const comparisons = (dir: string) => JSON.parse(readFileSync(join(dir, `comparisons.gbrain.${FAMILIES.join('-')}.json`), 'utf8'));

describe('compare-run --pair gbrain matches repetitions by id', () => {
  for (const missingIn of ['other', 'base'] as const) {
    test(`arm design: a middle repetition missing in the ${missingIn === 'other' ? 'gbrain' : 'none'} cell is excluded by its id and the delta stays 0`, () => {
      const dir = fixture(ARM, missingIn);
      const r = run(['--results', dir, '--pair', 'gbrain', '--design', 'arm', '--families', FAMILIES.join(','), '--draws', '1000']);
      expect(r.status).toBe(0);
      const c = comparisons(dir).scopes[0].comparisons[0];
      expect(c).toMatchObject({ delta: 0, ci95: [0, 0], n_pairs: 20, n_clusters: 10 });
      const side = missingIn === 'other' ? 'gbrain' : 'none';
      expect(c.excluded).toEqual(TASKS.map((task) => ({ id: `${task}/2`, task, side, reason: `no trial in the ${side} cell`, gbrain_calls: null })));
      expect(c.per_task.every((t: { reps: number }) => t.reps === 3)).toBe(true);
    });
  }

  test('arm design: a doubled repetition in one cell refuses with the cell, task and repetition named', () => {
    const dir = fixture(ARM, 'other', [{ ...trial('oc-gbrain', TASKS[0]!, 1, false), trial_id: `${RUN}/oc-gbrain/${TASKS[0]}/retry/r1` }]);
    const r = run(['--results', dir, '--pair', 'gbrain', '--design', 'arm', '--families', FAMILIES.join(','), '--draws', '1000']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`--pair gbrain: oc-gbrain has two trials for ${TASKS[0]}/r1`);
  });

  for (const missingIn of ['other', 'base'] as const) {
    test(`install ladder: a middle repetition missing in the ${missingIn === 'other' ? 'rung' : 'base'} cell is excluded by its id and the answer delta stays 0`, () => {
      const dir = fixture(LADDER, missingIn);
      const r = run(['--results', dir, '--pair', 'gbrain', '--design', 'ladder', '--families', FAMILIES.join(','), '--draws', '1000']);
      expect(r.status).toBe(0);
      const c = comparisons(dir).scopes[0].endpoints.pass.comparisons[0];
      expect(c).toMatchObject({ cell: 'oc-gbrain-mcp', base_cell: 'oc-none', delta: 0, ci95: [0, 0], n_pairs: 20, n_clusters: 10, discordant: { rung_only: 0, base_only: 0, both: 10, neither: 10 } });
      const side = missingIn === 'other' ? 'rung' : 'base';
      expect(c.excluded).toEqual(TASKS.map((task) => ({ id: `${task}/2`, reason: `no trial in the ${side} cell` })));
    });
  }
});
