// The scorers check their input before they score (docs/methodology.md item 12): summarize-run.ts and compare-run.ts run
// scripts/validate-records.ts on trials.jsonl and refuse (exit 2, nothing written) a trial id recorded twice, a trial the
// run's manifest never planned, a record in another cell than planned and a malformed record. The internal-task repro: five
// copies of a passing row and one row for an unplanned trial used to move a cell's pass rate and exit 0.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'input-check-2026-11';
const TASKS = ['ar-01-thornbury-rate-hollis', 'cn-01-tamsin-cold-chain-site', 'cr-01-marrow-agrisupply-site-retraction'];
const CELLS = ['cc-opus', 'oc-opus'];
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const run = (script: string, args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });

function trial(cell: string, task: string, rep: number, pass: boolean): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/r${rep}`, cell, task, harness: cell.split('-')[0]!, harness_mode: 'docker', model: 'anthropic:claude-opus-5-5', script: null,
    termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [],
    predicates: [{ id: 'answer', kind: 'required', passed: pass, evidence: pass ? 'matched' : 'no match' }], cap_stop: false,
    turns: { planned: 1, run: 1, exits: [0] },
    usage: { meter_id: `trial-token:${RUN}/${cell}/${task}/r${rep}`, requests: 1, refused: 0, failed: 0, usd: 0.1, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 60_000, started_at: '2026-11-09T00:00:00.000Z', ended_at: '2026-11-09T00:01:00.000Z', paths: {},
  };
}

function fixture(): { dir: string; rows: TrialRecord[] } {
  const dir = mkdtempSync(join(tmpdir(), 'he-input-check-'));
  const rows = CELLS.flatMap((cell, ci) => TASKS.flatMap((task, ti) => [1, 2].map((rep) => trial(cell, task, rep, (ci + ti + rep) % 2 === 0))));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN,
    cells: CELLS.map((id) => ({ id, harness: id.split('-')[0], model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: 2 })),
    trials: rows.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })) }));
  writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
  return { dir, rows };
}
const append = (dir: string, rows: unknown[]) => appendFileSync(join(dir, 'trials.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

describe('scorer input check', () => {
  test('a run whose records match its manifest is summarized and compared', () => {
    const { dir } = fixture();
    expect(run('summarize-run.ts', ['--results', dir]).status).toBe(0);
    expect(existsSync(join(dir, 'summary.json'))).toBe(true);
    expect(run('compare-run.ts', ['--results', dir, '--draws', '1000']).status).toBe(0);
  });

  test('five duplicate rows and a row the manifest never planned are refused, and nothing is written', () => {
    const { dir, rows } = fixture();
    const pass = rows.find((t) => t.grade === 'pass')!;
    append(dir, [pass, pass, pass, pass, pass, { ...pass, trial_id: `${RUN}/${pass.cell}/zz-99-ghost/r1`, task: 'zz-99-ghost' }]);
    const s = run('summarize-run.ts', ['--results', dir]);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain(`trial ${pass.trial_id} is recorded twice`);
    expect(s.stderr).toContain(`trial ${RUN}/${pass.cell}/zz-99-ghost/r1 is not in the manifest`);
    expect(existsSync(join(dir, 'summary.json'))).toBe(false);
    const c = run('compare-run.ts', ['--results', dir, '--draws', '1000']);
    expect(c.status).toBe(2);
    expect(c.stderr).toContain('is recorded twice');
    expect(existsSync(join(dir, 'comparisons.json'))).toBe(false);
  });

  test('a malformed record and a record in another cell than planned are refused', () => {
    const { dir, rows } = fixture();
    const { grade: _, ...noGrade } = rows[0]!;
    writeFileSync(join(dir, 'trials.jsonl'), [noGrade, { ...rows[1]!, cell: 'oc-opus' }, ...rows.slice(2)].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const s = run('summarize-run.ts', ['--results', dir]);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain(`trial ${rows[0]!.trial_id} is malformed (grade)`);
    expect(s.stderr).toContain(`the manifest plans cell ${rows[1]!.cell}`);
    expect(run('compare-run.ts', ['--results', dir, '--draws', '1000']).status).toBe(2);
  });

  test('compare-run --against checks the second run against its own manifest', () => {
    const a = fixture(), b = fixture();
    append(b.dir, [b.rows[0]]);
    const c = run('compare-run.ts', ['--results', a.dir, '--against', b.dir, '--draws', '1000']);
    expect(c.status).toBe(2);
    expect(c.stderr).toContain(join(b.dir, 'trials.jsonl'));
    expect(c.stderr).toContain('is recorded twice');
  });
});
