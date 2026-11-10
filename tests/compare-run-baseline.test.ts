// compare-run.ts --baseline (harness-zero-select-2026-11's Endpoints), keyless, on a hand-built results directory: each baseline is
// paired only with the other cells of its model (Opus cells at 5 repetitions, Sol cells at 3, so a cross-model pair could not
// pair), and a trial that ended as model_error, infra_error or exam_fault, or is missing, leaves both sides of its pair with
// its reason. Without --baseline the output keeps its old shape.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'baseline-fixture-2026-11';
const TASKS = ['ar-01-thornbury-rate-hollis', 'cn-01-tamsin-cold-chain-site', 'cr-01-marrow-agrisupply-site-retraction'];
const OPUS = 'anthropic:claude-opus-5-5', SOL = 'openai:gpt-6.1-sol';
const run = (args: string[]) => spawnSync('bun', [join(ROOT, 'scripts/compare-run.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });

function trial(cell: string, model: string, task: string, rep: number, pass: boolean, extra: Partial<TrialRecord> = {}): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/r${rep}`, cell, task, harness: 'harness-zero', harness_mode: 'docker', model, script: null,
    termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [],
    predicates: [{ id: 'answer', kind: 'required', passed: pass, evidence: pass ? 'matched' : 'no match' }],
    cap_stop: false, turns: { planned: 3, run: 3, exits: [0, 0, 0] },
    usage: { meter_id: 'k', requests: 3, refused: 0, failed: 0, usd: 0.1, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 60_000, started_at: '', ended_at: '', paths: {}, ...extra,
  };
}

/** Opus: zf-a, zf-b and no-ts at 5 repetitions; Sol: zf-sol and zm-sol at 3. no-ts has one model_error and one exam_fault; zf-b
 *  is missing one repetition; zm-sol has one infra_error. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-baseline-'));
  const cells = [
    { id: 'zf-a', model: OPUS, reps: 5, passes: [5, 3, 1] },
    { id: 'zf-b', model: OPUS, reps: 5, passes: [4, 3, 2] },
    { id: 'no-ts', model: OPUS, reps: 5, passes: [5, 1, 0] },
    { id: 'zf-sol', model: SOL, reps: 3, passes: [3, 2, 1] },
    { id: 'zm-sol', model: SOL, reps: 3, passes: [2, 2, 0] },
  ];
  const rows: TrialRecord[] = [];
  for (const c of cells) TASKS.forEach((task, ti) => { for (let r = 1; r <= c.reps; r++) rows.push(trial(c.id, c.model, task, r, r <= c.passes[ti]!)); });
  const find = (cell: string, ti: number, r: number) => rows.find((t) => t.cell === cell && t.task === TASKS[ti] && t.trial_id.endsWith(`/r${r}`))!;
  Object.assign(find('no-ts', 0, 1), { termination: 'model_error', grade: 'n/a' });
  Object.assign(find('no-ts', 2, 5), { termination: 'exam_fault', grade: 'n/a' });
  Object.assign(find('zm-sol', 1, 3), { termination: 'infra_error', grade: 'n/a' });
  const kept = rows.filter((t) => t !== find('zf-b', 1, 4));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, cells: cells.map((c) => ({ id: c.id, harness: 'harness-zero', model: c.model, slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: c.reps })) }));
  writeFileSync(join(dir, 'trials.jsonl'), kept.map((t) => JSON.stringify(t)).join('\n') + '\n');
  return dir;
}

describe('compare-run --baseline', () => {
  test('pairs each baseline only with the cells of its model and excludes faulted or missing pairs on both sides', () => {
    const dir = fixture();
    const r = run(['--results', dir, '--baseline', 'zf-a,zf-sol', '--draws', '1000']);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.json'), 'utf8'));
    expect(out.baselines).toEqual(['zf-a', 'zf-sol']);
    const by = Object.fromEntries(out.comparisons.map((c: { a: string; b: string }) => [`${c.b} vs ${c.a}`, c]));
    expect(Object.keys(by).sort()).toEqual(['no-ts vs zf-a', 'zf-b vs zf-a', 'zm-sol vs zf-sol']);
    expect(by['zf-b vs zf-a'].excluded).toEqual([{ id: `${TASKS[1]}/r4`, reason: 'missing in zf-b' }]);
    expect(by['zf-b vs zf-a'].n_pairs).toBe(14);
    expect(by['no-ts vs zf-a'].excluded.map((x: { reason: string }) => x.reason).sort()).toEqual(['no-ts exam_fault', 'no-ts model_error']);
    expect(by['no-ts vs zf-a'].n_pairs).toBe(13);
    expect(by['zm-sol vs zf-sol'].excluded).toEqual([{ id: `${TASKS[1]}/r3`, reason: 'zm-sol infra_error' }]);
    expect(by['zm-sol vs zf-sol'].n_pairs).toBe(8);
    expect(r.stdout).toContain('Excluded pairs');
  });

  test('refuses two baselines on one model, an unknown cell, an empty list, and --baseline with --pair or --against', () => {
    const dir = fixture();
    expect(run(['--results', dir, '--baseline', 'zf-a,zf-b']).status).toBe(2);
    expect(run(['--results', dir, '--baseline', 'nope']).status).toBe(2);
    expect(run(['--results', dir, '--baseline', ',']).status).toBe(2);
    expect(run(['--results', dir, '--baseline']).status).toBe(2);
    expect(run(['--results', dir, '--baseline', 'zf-a', '--pair', 'gbrain']).status).toBe(2);
    expect(run(['--results', dir, '--baseline', 'zf-a', '--against', dir]).status).toBe(2);
  });

  test('refuses a cell with two trials for one task and repetition', () => {
    const dir = fixture();
    const lines = readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean);
    writeFileSync(join(dir, 'trials.jsonl'), [...lines, lines[0]].join('\n') + '\n');
    const r = run(['--results', dir, '--baseline', 'zf-a,zf-sol', '--draws', '100']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is recorded twice');
  });

  test('without --baseline the comparisons file keeps its old keys', () => {
    const dir = fixture();
    const sol = mkdtempSync(join(tmpdir(), 'he-baseline-default-'));
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    writeFileSync(join(sol, 'manifest.json'), JSON.stringify({ ...m, cells: m.cells.filter((c: { id: string }) => c.id === 'zf-sol' || c.id === 'zm-sol') }));
    writeFileSync(join(sol, 'trials.jsonl'), readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter((l) => /"cell":"(zf-sol|zm-sol)"/.test(l)).concat('').join('\n'));
    const r = run(['--results', sol, '--draws', '1000']);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(join(sol, 'comparisons.json'), 'utf8'));
    expect(out.baselines).toBeUndefined();
    expect(out.comparisons[0].excluded).toBeUndefined();
    expect(r.stdout).not.toContain('Excluded pairs');
  });
});
