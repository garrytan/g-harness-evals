import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, loadPrereg, renderPlan, RunnerError, type Prereg } from '../runner/run.ts';

const base: Prereg = {
  schema_version: 1,
  run_id: 'test-run',
  question: 'q',
  tasks: { hello: ['hello', 'hello-2'] },
  cells: [
    { id: 'a', harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', slice: 'hello', split: 'dev', repetitions: 5, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } },
    { id: 'b', harness: 'hermes', model: 'openai:gpt-6.1-sol', slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } },
  ],
  wall_clock_s: { hello: 600 },
  spend_cap_usd: 1,
  drop_order: ['b'],
  minimum_v01: ['a'],
};

function write(p: Prereg): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-prereg-'));
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify(p));
  return file;
}

describe('manifest', () => {
  test('preallocates one trial id per cell, task and repetition and prices the ceiling from the pin table', () => {
    const { prereg, sha256 } = loadPrereg(write(base));
    const m = buildManifest(prereg, sha256, '2026-10-22T00:00:00Z');
    expect(m.trials.length).toBe(2 * 5 + 2 * 1);
    expect(new Set(m.trials.map(t => t.id)).size).toBe(m.trials.length);
    expect(m.trials[0]!.id).toBe('test-run/a/hello/r1');
    // Sonnet 5.5 list price: $2 in, $10 out per million; 100k in + 10k out = $0.30 per trial, 10 trials.
    expect(m.per_cell_ceiling_usd.a).toBeCloseTo(3.0, 2);
    expect(m.cost_ceiling_usd).toBeGreaterThan(m.per_cell_ceiling_usd.a!);
    expect(m.trial_hours_at_cap).toBe(2);
    expect(m.prereg_sha256).toHaveLength(64);
  });

  test('renders a warning when the ceiling exceeds the preregistered cap', () => {
    const { prereg, sha256 } = loadPrereg(write(base));
    const out = renderPlan(buildManifest(prereg, sha256));
    expect(out).toContain('WARN: HE-BUDGET-003');
    expect(out.split('\n').filter(l => l.startsWith('CELL:')).length).toBe(2);
  });
});

describe('refusals carry stable codes', () => {
  const expectCode = (p: Prereg, code: string) => {
    try { loadPrereg(write(p)); } catch (e) { expect(e).toBeInstanceOf(RunnerError); expect((e as RunnerError).code).toBe(code); return; }
    throw new Error('expected a refusal');
  };
  test('unpriced model', () => expectCode({ ...base, cells: [{ ...base.cells[0]!, model: 'anthropic:claude-made-up-9' }] }, 'HE-PIN-002'));
  test('slice without tasks', () => expectCode({ ...base, cells: [{ ...base.cells[0]!, slice: 'work' }] }, 'HE-PREREG-004'));
  test('missing cap', () => expectCode({ ...base, spend_cap_usd: 0 }, 'HE-BUDGET-002'));
  test('missing file', () => {
    try { loadPrereg('/nonexistent/prereg.json'); } catch (e) { expect((e as RunnerError).code).toBe('HE-PREREG-001'); return; }
    throw new Error('expected a refusal');
  });
});

describe('multi-user cells', () => {
  const FIXTURE_TASKS = join(import.meta.dir, 'fixtures', 'tasks');
  const mu: Prereg = {
    ...base,
    tasks: {},
    cells: [
      { id: 'mu', harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 2, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } },
      { id: 'oracle', harness: 'scripted', model: 'none', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 0, output_tokens: 0 }, harness_mode: 'scripted', script: 'oracle' },
      { id: 'mutations', harness: 'scripted', model: 'none', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 0, output_tokens: 0 }, harness_mode: 'scripted', script: 'mutations' },
    ],
    wall_clock_s: { multiuser: 1500 },
  };

  test('tasks resolve from tasks/multiuser/<split>/, a trial is priced as turns x the per-turn ceiling, and scripted cells cost nothing', () => {
    const { prereg, sha256 } = loadPrereg(write(mu));
    const m = buildManifest(prereg, sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS });
    // fx-leak has 3 turns; 100k in + 10k out at Sonnet 5.5 list price is $0.30 per turn, so $0.90 per trial, two repetitions.
    expect(m.per_cell_ceiling_usd.mu).toBeCloseTo(1.8, 2);
    expect(m.per_cell_ceiling_usd.oracle).toBe(0);
    expect(m.per_cell_ceiling_usd.mutations).toBe(0);
    expect(m.trials.filter(t => t.cell === 'mu').map(t => t.id)).toEqual(['test-run/mu/fx-leak/r1', 'test-run/mu/fx-leak/r2']);
    expect(m.trials.find(t => t.cell === 'mu')).toMatchObject({ task_dir: join(FIXTURE_TASKS, 'multiuser', 'dev', 'fx-leak'), turns: 3 });
    expect(m.trials.filter(t => t.cell === 'oracle').map(t => t.script)).toEqual([join(FIXTURE_TASKS, 'multiuser', 'dev', 'fx-leak', 'oracle.json')]);
    expect(m.trials.filter(t => t.cell === 'mutations').map(t => t.id)).toEqual(['test-run/mutations/fx-leak/mut-no_cross_scope_reads/r1', 'test-run/mutations/fx-leak/mut-no_leak/r1']);
    expect(m.trial_hours_at_cap).toBeCloseTo(5 * 1500 / 3600, 1);
    expect(renderPlan(m)).toContain('CELL: mu harness=openclaw mode=docker model=anthropic:claude-sonnet-5-5 slice=multiuser split=dev reps=2 trials=2 turns=6 ceiling_usd=1.8');
  });

  test('an explicit task list wins, and a task without task.toml is refused with HE-TASK-001', () => {
    const { prereg, sha256 } = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, tasks: ['fx-leak'] }] }));
    expect(buildManifest(prereg, sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }).trials).toHaveLength(2);
    const missing = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, tasks: ['no-such-task'] }] }));
    try { buildManifest(missing.prereg, missing.sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }); } catch (e) { expect((e as RunnerError).code).toBe('HE-TASK-001'); return; }
    throw new Error('expected a refusal');
  });

  test('a scripted cell must say so consistently; model none is only for scripted cells', () => {
    const expectCode = (p: Prereg, code: string) => {
      try { loadPrereg(write(p)); } catch (e) { expect((e as RunnerError).code).toBe(code); return; }
      throw new Error('expected a refusal');
    };
    expectCode({ ...mu, cells: [{ ...mu.cells[1]!, harness: 'openclaw' }] }, 'HE-PREREG-006');
    expectCode({ ...mu, cells: [{ ...mu.cells[1]!, script: undefined }] }, 'HE-PREREG-006');
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, model: 'none' }] }, 'HE-PIN-002');
  });
});
