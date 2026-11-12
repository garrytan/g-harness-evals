import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, loadPrereg, renderPlan, RunnerError, staleTaskSetWarnings, type Prereg } from '../runner/run.ts';

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
    expect(renderPlan(m)).toContain('CELL: mu harness=openclaw mode=docker model=anthropic:claude-sonnet-5-5 slice=multiuser split=dev task_set=v0.1 reps=2 trials=2 turns=6 ceiling_usd=1.8');
  });

  test('an explicit task list wins, and a listed task without task.toml in the cell\'s set is refused once with HE-PREREG-004 naming the set and the list', () => {
    const { prereg, sha256 } = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, tasks: ['fx-leak'] }] }));
    expect(buildManifest(prereg, sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }).trials).toHaveLength(2);
    const missing = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, tasks: ['no-such-task'] }] }));
    try { buildManifest(missing.prereg, missing.sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }); } catch (e) {
      expect((e as RunnerError).code).toBe('HE-PREREG-004');
      expect((e as RunnerError).message).toContain('cell.tasks names no-such-task');
      expect((e as RunnerError).message).toContain('task set v0.1');
      return;
    }
    throw new Error('expected a refusal');
  });

  test('task_set selects tasks/multiuser/<set>/<split>/, is printed on every cell line, and a v0.1 id against the v0.2 set is refused', () => {
    const v02 = { ...mu, cells: [{ ...mu.cells[0]!, id: 'mu-v02', task_set: 'v0.2' }, { ...mu.cells[0]!, id: 'mu-v01', task_set: 'v0.1' }] };
    const { prereg, sha256 } = loadPrereg(write(v02));
    const m = buildManifest(prereg, sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS });
    expect(m.trials.filter((t) => t.cell === 'mu-v02').map((t) => t.task)).toEqual(['fx-recall', 'fx-recall']);
    expect(m.trials.find((t) => t.cell === 'mu-v02')!.task_dir).toBe(join(FIXTURE_TASKS, 'multiuser', 'v0.2', 'dev', 'fx-recall'));
    expect(m.trials.filter((t) => t.cell === 'mu-v01').map((t) => t.task)).toEqual(['fx-leak', 'fx-leak']);
    expect(m.cells.find((c) => c.id === 'mu-v02')!.task_set).toBe('v0.2');
    const plan = renderPlan(m);
    expect(plan).toContain('CELL: mu-v02 harness=openclaw mode=docker model=anthropic:claude-sonnet-5-5 slice=multiuser split=dev task_set=v0.2 reps=2');
    expect(plan).toContain('CELL: mu-v01 harness=openclaw mode=docker model=anthropic:claude-sonnet-5-5 slice=multiuser split=dev task_set=v0.1 reps=2');
    const wrong = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, task_set: 'v0.2', tasks: ['fx-leak'] }] }));
    try { buildManifest(wrong.prereg, wrong.sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }); } catch (e) {
      expect((e as RunnerError).code).toBe('HE-PREREG-004');
      expect((e as RunnerError).message).toContain('task set v0.2 has no such task');
      return;
    }
    throw new Error('expected a refusal');
  });

  test('a dev cell on a v0.3 task set gets a WARN pointing at v0.3.1, and v0.3.1 resolves the same task ids under tasks/multiuser/v0.3.1/', () => {
    const TASKS = join(import.meta.dir, '..', 'tasks');
    const at = (id: string, task_set: string, task: string) => ({ ...mu.cells[0]!, id, task_set, tasks: [task] });
    const sets = { ...mu, cells: [
      at('old', 'v0.3', 'cr-01-marrow-agrisupply-site-retraction'), at('old-draw-2', 'v0.3/dev-draw-2', 'cr-01-marrow-fieldworks-seat-count'),
      at('new', 'v0.3.1', 'cr-01-marrow-agrisupply-site-retraction'), at('new-draw-2', 'v0.3.1/dev-draw-2', 'cr-01-marrow-fieldworks-seat-count'),
      at('v02', 'v0.2', readdirSync(join(TASKS, 'multiuser', 'v0.2', 'dev')).sort()[0]!),
    ] };
    const { prereg, sha256 } = loadPrereg(write(sets));
    const m = buildManifest(prereg, sha256, '2026-11-09T00:00:00Z', { tasksRoot: TASKS });
    expect(m.trials.find((t) => t.cell === 'new')!.task_dir).toBe(join(TASKS, 'multiuser', 'v0.3.1', 'dev', 'cr-01-marrow-agrisupply-site-retraction'));
    expect(m.trials.find((t) => t.cell === 'new-draw-2')!.task_dir).toBe(join(TASKS, 'multiuser', 'v0.3.1', 'dev-draw-2', 'dev', 'cr-01-marrow-fieldworks-seat-count'));
    expect(renderPlan(m)).not.toContain('WARN: cell ');
    expect(staleTaskSetWarnings(m.cells)).toEqual([
      'WARN: cell old names task set v0.3, whose not_retracted and not_distractor checks fail some correct replies; use v0.3.1, the same tasks with fixed checks (tasks/multiuser/v0.3.1/README.md)',
      'WARN: cell old-draw-2 names task set v0.3/dev-draw-2, whose not_retracted and not_distractor checks fail some correct replies; use v0.3.1/dev-draw-2, the same tasks with fixed checks (tasks/multiuser/v0.3.1/README.md)',
    ]);
  });

  test('unknown cell keys, a bad task_set value and a bad session_scope are refused with HE-PREREG-007; session_scope turn is printed', () => {
    const expectCode = (p: Prereg, code: string, text: string) => {
      try { loadPrereg(write(p)); } catch (e) { expect((e as RunnerError).code).toBe(code); expect((e as RunnerError).message).toContain(text); return; }
      throw new Error('expected a refusal');
    };
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, taskset: 'v0.2' } as unknown as Prereg['cells'][number]] }, 'HE-PREREG-007', 'unknown key(s) taskset');
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, task_set: 'V 2' }] }, 'HE-PREREG-007', 'task_set must be a name');
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, session_scope: 'never' as 'turn' }] }, 'HE-PREREG-007', 'session_scope must be');
    const noSet = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, task_set: 'v9.9' }] }));
    try { buildManifest(noSet.prereg, noSet.sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }); throw new Error('expected a refusal'); } catch (e) { expect((e as RunnerError).code).toBe('HE-PREREG-004'); expect((e as RunnerError).message).toContain('multiuser/v9.9/'); }
    const { prereg, sha256 } = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, session_scope: 'turn' }] }));
    expect(renderPlan(buildManifest(prereg, sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }))).toContain('task_set=v0.1 session_scope=turn reps=2');
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, utility_models: ['haiku'] }] }, 'HE-PREREG-007', 'utility_models must be');
    expectCode({ ...mu, cells: [{ ...mu.cells[0]!, utility_models: [] }] }, 'HE-PREREG-007', 'utility_models must be');
    const util = loadPrereg(write({ ...mu, cells: [{ ...mu.cells[0]!, utility_models: ['anthropic:claude-haiku-5-5'] }] }));
    expect(renderPlan(buildManifest(util.prereg, util.sha256, '2026-10-22T00:00:00Z', { tasksRoot: FIXTURE_TASKS }))).toContain('task_set=v0.1 utility_models=anthropic:claude-haiku-5-5 reps=2');
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

test('the plan names the starter tool count the run will see: the preregistration\'s gbrain_surface_tools, else the pin\'s only for the pinned commit', () => {
  const pin = JSON.parse(readFileSync(join(import.meta.dir, '..', 'gbrain', 'pin.json'), 'utf8')) as { gbrain: { commit: string }; surfaces: { starter: { tools: number } } };
  const other = 'b'.repeat(40);
  const g: Prereg = {
    ...base,
    tasks: {},
    cells: [{ id: 'g', harness: 'openclaw', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 }, gbrain: { surface: 'starter' } }],
    wall_clock_s: { multiuser: 1500 },
    drop_order: ['g'],
    minimum_v01: ['g'],
  };
  const plan = (p: Prereg) => { const { prereg, sha256 } = loadPrereg(write(p)); return renderPlan(buildManifest(prereg, sha256, '2026-11-12T00:00:00Z', { tasksRoot: join(import.meta.dir, 'fixtures', 'tasks') })); };
  expect(other).not.toBe(pin.gbrain.commit);
  expect(plan(g)).toContain(`the ${pin.surfaces.starter.tools}-tool starter surface`);
  expect(plan({ ...g, gbrain_commit: pin.gbrain.commit })).toContain(`the ${pin.surfaces.starter.tools}-tool starter surface`);
  const unstated = plan({ ...g, gbrain_commit: other });
  expect(unstated).toContain('the starter surface of gbrain bbbbbbbb (no tool count');
  expect(unstated).not.toContain('-tool starter surface');
  expect(plan({ ...g, gbrain_commit: other, gbrain_surface_tools: { starter: 33 } })).toContain('the 33-tool starter surface');
});
