// secondary-endpoints.ts joins each gbrain/none pair on its repetition id, the same join compare-run.ts --pair gbrain uses
// (g-harness-evals#5), keyless, on a hand-built results directory: a repetition missing in the middle of one cell is
// excluded under its own id and the pairs after it stay matched. Before the fix it paired the sorted trials by position,
// so none/r2 met gbrain/r3 and a zero effect read as +50 points.

import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'secondary-pairing-fixture-2026-11';
const TASK_ROOT = join(ROOT, 'tasks', 'multiuser', 'v0.3', 'dev');
const TASKS = readdirSync(TASK_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(0, 10);
const run = (dir: string) => spawnSync('bun', [join(ROOT, 'scripts/secondary-endpoints.ts'), '--results', dir, '--draws', '1000'], { cwd: ROOT, encoding: 'utf8' });

function trial(cell: string, task: string, rep: number, crossScope: boolean): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/r${rep}`, cell, task, harness: cell.split('-')[0]!, harness_mode: 'docker', model: 'm1', script: null,
    termination: 'completed', grade: crossScope ? 'fail' : 'pass', consent_violation: false, approval_stop: false, effects: [],
    predicates: [{ id: 'no_cross_scope_reads', kind: 'required', passed: !crossScope, evidence: crossScope ? 'seq=1 gbrain.search returned a page out of scope' : 'no cross-scope read' }],
    cap_stop: false, turns: { planned: 1, run: 1, exits: [0] },
    usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 1000, started_at: '', ended_at: '', paths: {},
  };
}

/** Every task: both cells read across scope on r3 only, and one cell has no r2. Matched by id, every kept pair agrees. */
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture(missingIn: 'oc-none' | 'oc-gbrain', extra: TrialRecord[] = [], extraCells: Array<{ id: string; harness: string; gbrain?: object }> = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-secondary-pairing-'));
  dirs.push(dir);
  const cells = ['oc-none', 'oc-gbrain'];
  const rows = TASKS.flatMap((task) => [1, 2, 3].flatMap((r) => cells.filter((cell) => r !== 2 || cell !== missingIn).map((cell) => trial(cell, task, r, r === 3))));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, trials: [], cells: [{ id: 'oc-none', harness: 'oc' }, { id: 'oc-gbrain', harness: 'oc', gbrain: { surface: 'starter' } }, ...extraCells].map((c) => ({ ...c, model: 'm1', slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: 3 })) }));
  writeFileSync(join(dir, 'trials.jsonl'), [...rows, ...extra].map((t) => JSON.stringify(t)).join('\n') + '\n');
  return dir;
}

describe('secondary-endpoints matches repetitions by id', () => {
  for (const missingIn of ['oc-gbrain', 'oc-none'] as const) {
    test(`a middle repetition missing in the ${missingIn} cell is excluded by its id and the delta stays 0`, () => {
      const dir = fixture(missingIn);
      const r = run(dir);
      expect(r.status).toBe(0);
      const out = JSON.parse(readFileSync(join(dir, 'secondary-endpoints.json'), 'utf8'));
      const c = out.endpoints.find((e: { endpoint: string }) => e.endpoint === 'cross_scope_any').comparisons[0];
      expect(c).toMatchObject({ cell_none: 'oc-none', cell_gbrain: 'oc-gbrain', positive: { none: 10, gbrain: 10 }, delta: 0, ci95: [0, 0], n_pairs: 20, n_clusters: 10 });
      const side = missingIn === 'oc-gbrain' ? 'gbrain' : 'none';
      expect(c.excluded).toEqual(TASKS.map((task) => ({ id: `${task}/2`, reason: `no trial in the ${side} cell` })));
    });
  }

  test('a harness pair with no repetition id on both sides is reported as not computed and the other pairs still publish', () => {
    const hx = TASKS.flatMap((task) => [trial('hx-none', task, 1, false), trial('hx-gbrain', task, 2, false)]);
    const dir = fixture('oc-gbrain', hx, [{ id: 'hx-none', harness: 'hx' }, { id: 'hx-gbrain', harness: 'hx', gbrain: { surface: 'starter' } }]);
    const r = run(dir);
    expect(r.status).toBe(0);
    const e = JSON.parse(readFileSync(join(dir, 'secondary-endpoints.json'), 'utf8')).endpoints.find((x: { endpoint: string }) => x.endpoint === 'cross_scope_any');
    expect(e.comparisons.map((c: { harness: string }) => c.harness)).toEqual(['oc']);
    expect(e.comparisons[0]).toMatchObject({ delta: 0, n_pairs: 20 });
    expect(e.not_computed).toHaveLength(1);
    expect(e.not_computed[0]).toMatchObject({ harness: 'hx', cell_none: 'hx-none', cell_gbrain: 'hx-gbrain', reason: 'no repetition id with an eligible trial on both sides' });
    expect(e.not_computed[0].excluded).toHaveLength(20);
    expect(r.stdout).toContain('Not computed for hx on m1: no repetition id with an eligible trial on both sides (20 excluded).');
  });

  test('a pair that is not computed stays in its model\'s Holm family at p = 1', () => {
    const oc = TASKS.flatMap((task) => [1, 2, 3].flatMap((r) => [trial('oc-none', task, r, false), trial('oc-gbrain', task, r, true)]));
    const hx = TASKS.flatMap((task) => [trial('hx-none', task, 1, false), trial('hx-gbrain', task, 2, false)]);
    const dir = mkdtempSync(join(tmpdir(), 'he-secondary-pairing-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, trials: [], cells: [{ id: 'oc-none', harness: 'oc' }, { id: 'oc-gbrain', harness: 'oc', gbrain: { surface: 'starter' } }, { id: 'hx-none', harness: 'hx' }, { id: 'hx-gbrain', harness: 'hx', gbrain: { surface: 'starter' } }].map((c) => ({ ...c, model: 'm1', slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: 3 })) }));
    writeFileSync(join(dir, 'trials.jsonl'), [...oc, ...hx].map((x) => JSON.stringify(x)).join('\n') + '\n');
    expect(run(dir).status).toBe(0);
    const e = JSON.parse(readFileSync(join(dir, 'secondary-endpoints.json'), 'utf8')).endpoints.find((x: { endpoint: string }) => x.endpoint === 'cross_scope_any');
    const c = e.comparisons[0];
    expect(c).toMatchObject({ harness: 'oc', delta: 1 });
    expect(c.p).toBeLessThan(0.5);
    expect(c.holm_p).toBeCloseTo(2 * c.p, 10);
    expect(e.not_computed.map((s: { harness: string }) => s.harness)).toEqual(['hx']);
  });

  test('a doubled repetition in one cell refuses with the cell, task and repetition named', () => {
    const dir = fixture('oc-gbrain', [{ ...trial('oc-gbrain', TASKS[0]!, 1, true), trial_id: `${RUN}/oc-gbrain/${TASKS[0]}/retry/r1` }]);
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`secondary-endpoints: oc-gbrain has two trials for ${TASKS[0]}/r1`);
  });
});
