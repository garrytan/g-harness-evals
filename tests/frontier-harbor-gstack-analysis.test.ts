// The gstack lift analysis (internal-task), keyless: the analysis of tests/fixtures/frontier-harbor/gstack-analysis-spec.json
// on synthetic trials (lift, lift difference, reach-frontier, Holm, the fewer-than-10-task rule, exclusions that drop only
// their own side), the run's two specs, the expected-MDD calculator and mdd.json, and the CLI's gstack branch.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { holmAdjusted, normalQuantile } from '../runner/stats/paired.ts';
import { analyzeGstack, checkGstackSpec, expectedMdd, renderGstackMarkdown, renderMdd, type GstackSpec } from '../scripts/frontier-harbor/analyze.ts';

const ROOT = resolve(import.meta.dir, '..');
const SPEC = join(ROOT, 'tests/fixtures/frontier-harbor/gstack-analysis-spec.json');
const RUN_DIR = join(ROOT, 'docs/benchmarks/2026-11-26-gstack-cheap-model');
const tmp = mkdtempSync(join(tmpdir(), 'gstack-lift-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const spec = () => JSON.parse(readFileSync(SPEC, 'utf8')) as GstackSpec;
const MODEL: Record<string, string> = { opus: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.2-sol', p1: 'particle:particle-1' };
const TASKS = Array.from({ length: 52 }, (_, i) => 'task-' + String(i).padStart(2, '0'));
const r6 = (x: number) => Number(x.toFixed(6));

export const gstackTrial = (cell: string, model: string, harness: string, task: string, attempt: number, pass: boolean, termination = 'completed', usd = 1) => ({
  trial_id: 'gstack-cheap-model-2026-11/' + cell + '/' + task + '/a' + attempt, cell, task, harness, harness_mode: 'docker', model: MODEL[model], script: null,
  termination, grade: termination !== 'completed' && termination !== 'harness_error' ? 'n/a' : pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [],
  cap_stop: false, turns: { planned: 1, run: 1, exits: [] }, usage: { usd }, wall_ms: 1000, started_at: '2026-11-27T00:00:00Z', ended_at: '2026-11-27T00:01:00Z', paths: {},
}) as unknown as TrialRecord;

type Pattern = (task: number, harness: string, attempt: number) => boolean;
interface Scenario { none: Record<string, Pattern>; gstack: Record<string, Pattern>; termination?: (cell: string, task: number, attempt: number) => string | undefined; tasks?: string[] }
const below = (k: number): Pattern => (i) => i < k;

function build(s: Scenario, sp: GstackSpec = spec()): TrialRecord[] {
  const records: TrialRecord[] = [];
  for (const c of sp.cells) (s.tasks ?? TASKS).forEach((task, i) => {
    for (let a = 1; a <= 3; a++) records.push(gstackTrial(c.id, c.model, c.harness, task, a, (c.arm === 'none' ? s.none : s.gstack)[c.model]!(i, c.harness, a), s.termination?.(c.id, i, a)));
  });
  return records;
}
const run = (s: Scenario, sp: GstackSpec = spec()) => analyzeGstack({ records: build(s, sp), manifest: null }, sp);
const base: Scenario = { none: { opus: below(26), sol: below(26), p1: below(26) }, gstack: { opus: below(26), sol: below(10), p1: below(42) } };

describe('the gstack analysis specs', () => {
  test('the fixture and both of the run\'s specs are valid, and the run\'s specs share the no-gstack cells', () => {
    expect(checkGstackSpec(spec(), null)).toEqual([]);
    const installed = JSON.parse(readFileSync(join(RUN_DIR, 'analysis-spec-installed.json'), 'utf8')) as GstackSpec;
    const told = JSON.parse(readFileSync(join(RUN_DIR, 'analysis-spec-told.json'), 'utf8')) as GstackSpec;
    expect(checkGstackSpec(installed, null)).toEqual([]);
    expect(checkGstackSpec(told, null)).toEqual([]);
    const ids = new Set([...installed.cells, ...told.cells].map((c) => c.id));
    expect([...ids].sort()).toEqual(['opus', 'sol', 'p1'].flatMap((m) => ['hermes', 'openclaw'].flatMap((h) => ['none', 'installed', 'told'].map((a) => m + '-' + h + '-' + a))).sort());
    expect(installed.cells.filter((c) => c.arm === 'none')).toEqual(told.cells.filter((c) => c.arm === 'none'));
    expect(installed.models).toEqual([{ id: 'opus', label: 'Opus 5.5', model: 'anthropic:claude-opus-5-5' }, { id: 'sol', label: 'GPT-6.2 Sol', model: 'openai:gpt-6.2-sol' }, { id: 'p1', label: 'particle-1', model: 'particle:particle-1' }]);
    expect([installed.seed, installed.draws, installed.min_paired_tasks, installed.ni_margin, installed.target]).toEqual([7, 10000, 10, 0.1, 'p1']);
    expect({ ...told, cells: [] }).toEqual({ ...installed, cells: [] });
  });
  test('each model needs one no-gstack and one gstack cell per harness, and a spec runs one gstack arm', () => {
    const s = spec();
    s.cells = s.cells.filter((c) => c.id !== 'sol-openclaw-none');
    s.cells.find((c) => c.id === 'p1-hermes-installed')!.arm = 'told';
    const problems = checkGstackSpec(s, null);
    expect(problems).toContain('model sol on openclaw needs one no-gstack cell and one gstack cell; the spec has 0 and 1');
    expect(problems).toContain('the cells must run exactly one gstack arm (installed or told) beside none; write one spec per gstack arm');
    const bad = spec();
    (bad.cells[1] as { arm: string }).arm = 'gstack-hook';
    expect(checkGstackSpec(bad, null)).toContain('cell opus-hermes-installed: arm must be none, installed, told');
  });
  test('a record whose model or harness is not its cell\'s is refused; the arm comes from the spec, never the record', () => {
    const records = build(base);
    (records[0] as { model: string }).model = MODEL.sol!;
    expect(() => analyzeGstack({ records, manifest: null }, spec())).toThrow(/ran openai:gpt-6.2-sol on hermes; cell opus-hermes-none is anthropic:claude-opus-5-5 on hermes/);
  });
});

describe('lift per model, Holm over three', () => {
  const a = run(base);
  const by = Object.fromEntries(a.lift.map((r) => [r.model, r]));
  test('helps, hurts and no measurable difference, pooled over both harnesses', () => {
    expect(a.arm).toBe('installed');
    expect([by.p1!.label, by.sol!.label, by.opus!.label]).toEqual(['helps', 'hurts', 'no measurable difference']);
    expect(by.p1!.delta).toBe(r6(16 / 52));
    expect(by.sol!.delta).toBe(r6(-16 / 52));
    expect(by.opus!.delta).toBe(0);
    expect([by.p1!.tasks, by.p1!.items]).toEqual([52, 104]);
    expect([by.p1!.tasks_better, by.p1!.tasks_worse, by.p1!.tasks_same]).toEqual([16, 0, 36]);
    expect([by.sol!.tasks_better, by.sol!.tasks_worse, by.sol!.tasks_same]).toEqual([0, 16, 36]);
    expect(by.p1!.cells).toEqual({ none: ['p1-hermes-none', 'p1-openclaw-none'], gstack: ['p1-hermes-installed', 'p1-openclaw-installed'] });
  });
  test('Holm adjusts the three two-sided p together', () => {
    expect(a.lift.map((r) => r.holm_p)).toEqual(holmAdjusted(a.lift.map((r) => r.p_two_sided!)).map((p) => Number(p.toFixed(8))));
    expect(by.p1!.holm_p!).toBeLessThan(0.05);
    expect(by.opus!.holm_p).toBe(1);
  });
  test('each side\'s pass rate carries its tasks and trials, and each harness has its own reading', () => {
    expect(by.p1!.rates.gstack).toEqual({ estimate: r6(42 / 52), items: 104, tasks: 52, trials: 312 });
    expect(by.p1!.rates.none).toEqual({ estimate: 0.5, items: 104, tasks: 52, trials: 312 });
    expect(by.p1!.per_harness.map((h) => [h.harness, h.tasks, h.delta])).toEqual([['hermes', 52, r6(16 / 52)], ['openclaw', 52, r6(16 / 52)]]);
  });
  test('the MDD comes from the run\'s own data, at alpha and at the first Holm step; no paired variation gives none', () => {
    expect(by.p1!.mdd!).toBeGreaterThan(0);
    expect(by.p1!.mdd_first_holm_step!).toBeGreaterThan(by.p1!.mdd!);
    expect(by.opus!.mdd).toBeNull();
  });
  test('the paired cost-per-solve ratio is gstack over no gstack', () => {
    expect(by.p1!.cost_per_solve_ratio.ratio).toBe(Number(((312 / (42 * 6)) / (312 / (26 * 6))).toFixed(4)));
    expect(by.p1!.cost_per_solve_ratio.ci95).not.toBeNull();
  });
});

describe('lift difference: particle-1\'s lift minus each frontier model\'s', () => {
  const a = run(base);
  test('per task from the four cells, Holm over two, primary from the spec', () => {
    expect(a.lift_difference.family).toBe('primary');
    const [opus, sol] = a.lift_difference.rows;
    expect(opus!.delta).toBe(r6(16 / 52));
    expect(sol!.delta).toBe(r6(32 / 52));
    expect([opus!.label, sol!.label]).toEqual(['larger lift for particle-1', 'larger lift for particle-1']);
    expect(a.lift_difference.rows.map((r) => r.holm_p)).toEqual(holmAdjusted(a.lift_difference.rows.map((r) => r.p_two_sided!)).map((p) => Number(p.toFixed(8))));
    expect(Object.keys(opus!.rates)).toEqual(['opus none', 'opus gstack', 'p1 none', 'p1 gstack']);
    expect(typeof opus!.mdd_within_limit).toBe('boolean');
  });
  test('secondary when the spec says so', () => {
    const sp = spec();
    sp.lift_difference.primary = false;
    expect(run(base, sp).lift_difference.family).toBe('secondary');
  });
  test('a smaller lift for the target is labelled', () => {
    const a2 = run({ none: base.none, gstack: { opus: below(42), sol: below(42), p1: below(26) } });
    expect(a2.lift_difference.rows.map((r) => r.label)).toEqual(['smaller lift for particle-1', 'smaller lift for particle-1']);
  });
});

describe('reach frontier: particle-1 with gstack against each frontier model without', () => {
  test('better, within 10 points and not shown, each Holm over two', () => {
    expect(run(base).reach.map((r) => r.label)).toEqual(['better', 'better']);
    const close = run({ none: { opus: below(26), sol: below(47), p1: below(20) }, gstack: { opus: below(26), sol: below(47), p1: below(27) } });
    const [opus, sol] = close.reach;
    expect(opus!.delta).toBe(r6(1 / 52));
    expect(opus!.label).toBe('within 10 points');
    expect(opus!.holm_p_noninferiority!).toBeLessThan(0.05);
    expect(opus!.holm_p_superiority!).toBeGreaterThan(0.05);
    expect(sol!.label).toBe('not shown');
    expect(close.reach.map((r) => r.holm_p_noninferiority)).toEqual(holmAdjusted(close.reach.map((r) => r.p_noninferiority!)).map((p) => Number(p.toFixed(8))));
    expect(close.reach.map((r) => r.holm_p_superiority)).toEqual(holmAdjusted(close.reach.map((r) => r.p_superiority!)).map((p) => Number(p.toFixed(8))));
    expect(Object.keys(opus!.rates)).toEqual(['opus none', 'p1 gstack']);
    expect(opus!.cost_per_solve_ratio.ratio).toBe(Number(((312 / (27 * 6)) / (312 / (26 * 6))).toFixed(4)));
    expect(opus!.cost_per_solve_ratio.ci95).not.toBeNull();
  });
});

describe('fewer than 10 paired tasks', () => {
  test('every comparison is not tested and counts as p = 1 in its Holm family', () => {
    const a = run({ ...base, tasks: TASKS.slice(0, 9) });
    for (const r of [...a.lift, ...a.lift_difference.rows]) expect([r.tasks, r.tested, r.label, r.holm_p]).toEqual([9, false, 'not tested', 1]);
    for (const r of a.reach) expect([r.tested, r.label, r.holm_p_noninferiority, r.holm_p_superiority]).toEqual([false, 'not tested', 1, 1]);
    expect(renderGstackMarkdown(a)).toContain('**not tested**');
  });
  test('10 paired tasks are enough', () => {
    expect(run({ ...base, tasks: TASKS.slice(0, 10) }).lift.every((r) => r.tested)).toBe(true);
  });
});

describe('exclusions drop only their own side', () => {
  const termination = (cell: string, task: number, attempt: number) => cell !== 'p1-hermes-installed' ? undefined
    : task === 30 ? ({ 1: 'infra_error', 2: 'model_error' } as Record<number, string>)[attempt] : task === 31 ? 'infra_error' : task === 32 && attempt === 1 ? 'harness_error' : undefined;
  const a = run({ ...base, termination });
  const p1 = a.lift.find((r) => r.model === 'p1')!;
  test('an excluded trial leaves its side; the other side keeps every trial of the task', () => {
    const hermes = p1.per_harness.find((h) => h.harness === 'hermes')!;
    expect([hermes.tasks, hermes.items]).toEqual([51, 51]);
    expect([p1.tasks, p1.items]).toEqual([52, 103]);
    expect(p1.rates.gstack.trials).toBe(312 - 2 - 3);
    expect(p1.rates.none.trials).toBe(312 - 3);
    expect(a.lift.find((r) => r.model === 'opus')!.rates.none.trials).toBe(312);
  });
  test('records of another run, the pilot included, are refused even with no manifest', () => {
    const records = build(base).map((r) => (r.cell === 'p1-hermes-installed' ? ({ ...r, trial_id: r.trial_id.replace('gstack-cheap-model-2026-11/', 'gstack-cheap-model-pilot-2026-11/') } as TrialRecord) : r));
    expect(() => analyzeGstack({ records, manifest: null }, spec())).toThrow(/156 record\(s\) are not trials of gstack-cheap-model-2026-11, for example gstack-cheap-model-pilot-2026-11\/p1-hermes-installed\//);
  });
  test('an agent timeout is a fail even when its verifier passed, and it is counted per cell (PREREGISTRATION.md, Scoring)', () => {
    const records = build(base);
    const t = records.find((r) => r.cell === 'p1-hermes-installed' && r.task === 'task-00' && r.trial_id.endsWith('/a1'))!;
    expect(t.grade).toBe('pass');
    const timedOut = records.map((r) => (r === t ? ({ ...r, termination: 'timeout' } as TrialRecord) : r));
    const before = analyzeGstack({ records, manifest: null }, spec());
    const after = analyzeGstack({ records: timedOut, manifest: null }, spec());
    const cell = (x: typeof after) => x.cells.find((c) => c.id === 'p1-hermes-installed')!;
    expect(cell(after).timeout_as_fail).toBe(1);
    expect(cell(after).pass_rate!.scored_trials).toBe(cell(before).pass_rate!.scored_trials);
    expect(cell(after).pass_rate!.estimate).toBe(r6(cell(before).pass_rate!.estimate - 1 / 3 / 52));
    expect(after.lift.find((r) => r.model === 'p1')!.delta!).toBeLessThan(before.lift.find((r) => r.model === 'p1')!.delta!);
    expect(after.method.scoring).toContain('an agent timeout whatever its grade');
  });
  test('excluded trials are counted per cell, and a harness_error is a fail', () => {
    const c = a.cells.find((x) => x.id === 'p1-hermes-installed')!;
    expect(c.excluded).toEqual({ model_error: 1, infra_error: 4, exam_fault: 0 });
    expect(c.harness_error_as_fail).toBe(1);
    expect(c.pass_rate!.scored_trials).toBe(156 - 5);
    expect(c.pass_rate!.tasks).toBe(51);
    expect(c.pass_rate!.estimate).toBe(r6((41 - 1 + 2 / 3) / 51));
    expect(a.cells.find((x) => x.id === 'p1-hermes-none')!.excluded).toEqual({ model_error: 0, infra_error: 0, exam_fault: 0 });
  });
});

describe('expected MDD and mdd.json', () => {
  test('expectedMdd uses the per-task Bernoulli variance and the pooled two-harness formula', () => {
    const records = ['hermes', 'openclaw'].flatMap((h) => TASKS.flatMap((task, i) => [1, 2].map((a) => ({ ...gstackTrial('opus-' + h, 'opus', h, task, a, i < 13 ? a === 1 : i < 26) }) as TrialRecord)));
    const m = expectedMdd(records, { tasks: 52, attempts: 3, baseline_attempts: 3, alpha: 0.05, power: 0.8, harnesses: ['hermes', 'openclaw'], lift_sd: 0 });
    expect(m.variances.map((v) => v.variance)).toEqual([r6(0.5 * 13 / 52), r6(0.5 * 13 / 52)]);
    const vsum = 2 * 0.125;
    const z = normalQuantile(0.975) + normalQuantile(0.8);
    expect(m.lift[0]!.mdd).toBe(r6(z * Math.sqrt((vsum * (2 / 3)) / (52 * 4))));
    expect(m.lift[0]!.first_holm_step).toBe(r6((normalQuantile(1 - 0.05 / 4) + normalQuantile(0.8)) * Math.sqrt((vsum * (2 / 3)) / (52 * 4))));
    expect(renderMdd(m)).toContain('| opus-hermes | anthropic:claude-opus-5-5 | hermes | 52 | 2 | 0.125 |');
  });
  test('mdd.json says GPT-6.2 Sol borrows GPT-6.1 Sol\'s variance, and its lift MDDs follow the formula', () => {
    const m = JSON.parse(readFileSync(join(RUN_DIR, 'mdd.json'), 'utf8'));
    expect(m.borrowed_variance).toMatchObject({ model: 'openai:gpt-6.2-sol', borrows_from: 'openai:gpt-6.1-sol' });
    const z = (a: number) => normalQuantile(1 - a / 2) + normalQuantile(0.8);
    for (const k of ['opus', 'sol', 'p1', 'p1_worst_case']) {
      const se = Math.sqrt((m.variance_sums[k] * (2 / 3)) / (52 * 4));
      expect([m.lift[k].mdd, m.lift[k].first_holm_step]).toEqual([Number((100 * z(0.05) * se).toFixed(1)), Number((100 * z(0.05 / 3) * se).toFixed(1))]);
    }
  });
});

test('the CLI writes gstack-analysis.json and gstack-analysis.md for a gstack spec, and no analysis.json', () => {
  const dir = join(tmp, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'trials.jsonl'), build(base).map((t) => JSON.stringify(t)).join('\n') + '\n');
  const res = spawnSync('bun', [join(ROOT, 'scripts/frontier-harbor/analyze.ts'), '--results', dir, '--spec', SPEC], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain('GSTACK_ANALYSIS: gstack-cheap-model-2026-11 arm installed');
  const a = JSON.parse(readFileSync(join(dir, 'gstack-analysis.json'), 'utf8'));
  expect(a.lift.map((r: { label: string }) => r.label)).toEqual(['helps', 'no measurable difference', 'hurts']);
  expect(readFileSync(join(dir, 'gstack-analysis.md'), 'utf8')).toContain('## Reach frontier: particle-1 with gstack against each frontier model without');
  expect(existsSync(join(dir, 'analysis.json'))).toBe(false);
}, 60_000);
