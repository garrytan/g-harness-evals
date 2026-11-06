// Tests for the frozen edition analysis (harnesses/qm/gstack/edition-analysis.ts) on synthetic turn records: a
// design that should KEEP, a null that should CUT, a pooled win with one model below 0 that should CUT, unequal
// repetitions, exclusions, reruns and the descriptive endpoints. No model calls.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, renderMarkdown, MODELS, type GradeRecord, type TurnRecord } from '../harnesses/qm/gstack/edition-analysis.ts';

const [OPUS, SOL] = MODELS;
const D6 = { tasks: 72, reps: 6 };
const FAMILIES = ['investigate', 'review', 'plan'];
interface Spec { model: string; arm: string; task: number; rep: number; success: boolean; status?: string; usd?: number; reply?: string }
function build(specs: Spec[]): { turns: TurnRecord[]; grades: GradeRecord[] } {
  const turns: TurnRecord[] = [], grades: GradeRecord[] = [];
  specs.forEach((s, i) => {
    const id = 'tr-' + i;
    const status = s.status ?? 'ok';
    turns.push({ trial_id: id, task_id: 'task-' + String(s.task).padStart(2, '0'), family: FAMILIES[s.task % 3]!, arm: s.arm, model: s.model, rep: s.rep, status, reply_text: s.reply ?? 'reply', counts: { open_matched: s.arm !== 'plain', open_any: s.arm !== 'plain', complete_read: s.arm === 'forced', first_step: s.arm === 'edition' ? s.rep % 2 === 0 : false, approvals_answered: 1, contaminated: false }, usage: { usd: s.usd ?? (s.arm === 'plain' ? 0.1 : 0.15), input_tokens: 1000, output_tokens: 100, cached_tokens: 500 }, wall_s: 30 });
    if (status === 'ok') grades.push({ trial_id: id, success: s.success, reply_chars: (s.reply ?? 'reply').length, final_chars: 3 });
  });
  return { turns, grades };
}
/** 72 tasks x reps per arm and model, with success decided by f(model, arm, task, rep). */
function design(f: (model: string, arm: string, task: number, rep: number) => boolean, reps = 6, arms = ['edition', 'plain']): Spec[] {
  const out: Spec[] = [];
  for (const model of MODELS) for (let task = 0; task < 72; task++) for (let rep = 0; rep < reps; rep++) for (const arm of arms) out.push({ model, arm, task, rep, success: f(model, arm, task, rep) });
  return out;
}

describe('edition-analysis: the verdict', () => {
  test('a clear gain on both models is KEEP', () => {
    const { turns, grades } = build(design((_m, arm, task, rep) => ((task + rep) % 5) < (arm === 'edition' && task % 4 !== 0 ? 3 : 2)));
    const r = analyze(turns, grades, D6);
    expect(r.verdict).toBe('KEEP');
    expect(r.verdict_reasons).toEqual([]);
    expect(r.primary.pooled!.n_tasks).toBe(72);
    expect(r.primary.pooled!.delta).toBeGreaterThan(0.1);
    expect(r.primary.pooled!.p_two_sided).toBeLessThan(0.001);
    expect(r.primary.pooled!.p_method).toBe('monte-carlo-sign-flip');
    expect(r.primary.pooled!.ci95![0]).toBeGreaterThan(0);
    for (const m of MODELS) expect(r.primary.per_model[m]!.delta).toBeGreaterThan(0);
  });

  test('no difference is CUT, with the reasons', () => {
    const { turns, grades } = build(design((_m, _arm, task, rep) => rep < 2 + (task % 3)));
    const r = analyze(turns, grades, D6);
    expect(r.verdict).toBe('CUT');
    expect(r.primary.pooled!.delta).toBe(0);
    expect(r.primary.pooled!.p_two_sided).toBe(1);
    expect(r.verdict_reasons.join(' ')).toContain('not above 0');
  });

  test('a significant pooled gain is CUT when one model is below 0', () => {
    const { turns, grades } = build(design((m, arm, task, rep) => {
      const plain = rep < 2;
      if (arm === 'plain') return plain;
      return m === OPUS ? rep < 5 : rep < 1 + (task % 2);
    }));
    const r = analyze(turns, grades, D6);
    expect(r.primary.pooled!.delta).toBeGreaterThan(0);
    expect(r.primary.pooled!.p_two_sided).toBeLessThan(0.05);
    expect(r.primary.per_model[SOL]!.delta).toBeLessThan(0);
    expect(r.verdict).toBe('CUT');
    expect(r.verdict_reasons).toEqual([SOL + "'s point estimate is -0.0833, below 0"]);
  });

  test('a small gain that the sign-flip test cannot separate from 0 is CUT', () => {
    const { turns, grades } = build(design((_m, arm, task, rep) => (arm === 'edition' && task < 3 ? rep < 3 : rep < 2)));
    const r = analyze(turns, grades, D6);
    expect(r.primary.pooled!.delta).toBeGreaterThan(0);
    expect(r.primary.pooled!.p_two_sided).toBeGreaterThan(0.05);
    expect(r.verdict).toBe('CUT');
  });
});

describe('edition-analysis: task means, exclusions and reruns', () => {
  test('unequal repetitions: each task weighs the same, and pooling averages the per-model task differences', () => {
    const specs: Spec[] = [
      { model: OPUS, arm: 'plain', task: 1, rep: 0, success: true }, { model: OPUS, arm: 'plain', task: 1, rep: 1, success: false },
      { model: OPUS, arm: 'edition', task: 1, rep: 0, success: true }, { model: OPUS, arm: 'edition', task: 1, rep: 1, success: true }, { model: OPUS, arm: 'edition', task: 1, rep: 2, success: true },
      { model: OPUS, arm: 'plain', task: 2, rep: 0, success: false }, { model: OPUS, arm: 'plain', task: 2, rep: 1, success: false }, { model: OPUS, arm: 'plain', task: 2, rep: 2, success: false }, { model: OPUS, arm: 'plain', task: 2, rep: 3, success: false },
      { model: OPUS, arm: 'edition', task: 2, rep: 0, success: false },
      { model: SOL, arm: 'plain', task: 1, rep: 0, success: false }, { model: SOL, arm: 'edition', task: 1, rep: 0, success: true },
      { model: SOL, arm: 'plain', task: 2, rep: 0, success: true }, { model: SOL, arm: 'edition', task: 2, rep: 0, success: true },
    ];
    const { turns, grades } = build(specs);
    const r = analyze(turns, grades, { tasks: 2, reps: 1 });
    expect(r.primary.per_model[OPUS]!.delta).toBeCloseTo((0.5 + 0) / 2, 12);
    expect(r.primary.per_model[SOL]!.delta).toBeCloseTo((1 + 0) / 2, 12);
    expect(r.primary.pooled!.delta).toBeCloseTo(((0.5 + 1) / 2 + (0 + 0) / 2) / 2, 12);
    expect(r.primary.pooled!.n_tasks).toBe(2);
  });

  test('model_error and infra_error are excluded; context_length, timeout and turn_error count as failures', () => {
    const specs: Spec[] = [];
    for (const model of MODELS) for (let task = 0; task < 10; task++) for (const arm of ['edition', 'plain']) for (let rep = 0; rep < 4; rep++) {
      const status = arm === 'edition' && task === 0 ? ['model_error', 'infra_error', 'context_length', 'timeout'][rep]! : arm === 'plain' && task === 1 && rep === 0 ? 'turn_error' : 'ok';
      specs.push({ model, arm, task, rep, success: true, status });
    }
    const r = analyze(build(specs).turns, build(specs).grades, { tasks: 10, reps: 4 });
    const e = r.cells[OPUS + '/edition']!, p = r.cells[OPUS + '/plain']!;
    expect([e.trials, e.excluded, e.valid, e.success.k, e.success.n]).toEqual([40, 2, 38, 36, 38]);
    expect([p.excluded, p.success.k, p.success.n]).toEqual([0, 39, 40]);
    expect(e.statuses).toEqual({ ok: 36, turn_error: 0, model_error: 1, infra_error: 1, context_length: 1, timeout: 1 });
    expect(r.exclusion_gap[OPUS]!.gap).toBeCloseTo(0.05, 12);
    expect(r.exclusion_gap[OPUS]!.flagged).toBe(false);
  });

  test('an exclusion gap above 5 points between edition and plain is flagged', () => {
    const specs = design(() => true, 2).map((s) => (s.arm === 'edition' && s.task < 12 && s.rep === 0 ? { ...s, status: 'infra_error' } : s));
    const r = analyze(build(specs).turns, build(specs).grades, { tasks: 72, reps: 2 });
    expect(r.exclusion_gap.pooled!.gap).toBeCloseTo(12 / 144, 12);
    expect(r.exclusion_gap.pooled!.flagged).toBe(true);
    expect(renderMarkdown(r)).toContain('FLAGGED');
  });

  test('only an infra_error is rerun, once: a rerun of anything else, or a second rerun, does not count but its spend does', () => {
    const specs: Spec[] = [
      { model: OPUS, arm: 'plain', task: 1, rep: 0, success: false, status: 'infra_error', usd: 0.5 }, { model: OPUS, arm: 'plain', task: 1, rep: 0, success: true, usd: 0.1 },
      { model: OPUS, arm: 'plain', task: 1, rep: 0, success: true, usd: 0.1 },
      { model: OPUS, arm: 'edition', task: 1, rep: 0, success: false }, { model: OPUS, arm: 'edition', task: 1, rep: 0, success: true },
      { model: SOL, arm: 'plain', task: 1, rep: 0, success: true }, { model: SOL, arm: 'edition', task: 1, rep: 0, success: true },
    ];
    const r = analyze(build(specs).turns, build(specs).grades, { tasks: 1, reps: 1 });
    expect(r.trials).toBe(4);
    expect(r.reruns.map((x) => [x.superseded, x.kept, x.superseded_status])).toEqual([['tr-0', 'tr-1', 'infra_error']]);
    expect(r.rerun_problems).toEqual([
      'tr-2 does not count: ' + OPUS + '|plain|task-01|0 already counts tr-1, its one rerun',
      'tr-4 does not count: ' + OPUS + '|edition|task-01|0 already counts tr-3, which ended ok, not infra_error',
    ]);
    expect(r.cells[OPUS + '/edition']!.success.k).toBe(0);
    const p = r.cells[OPUS + '/plain']!;
    expect([p.success.k, p.attempts]).toEqual([1, 3]);
    expect(p.usd_all_attempts).toBeCloseTo(0.7, 12);
    expect(p.cost_per_success).toBeCloseTo(0.7, 12);
    expect(r.verdict).not.toBe('INCOMPLETE');
  });

  test('a run missing a shard, an arm or repetitions is INCOMPLETE, never KEEP or CUT', () => {
    const full = design((_m, arm, task, rep) => ((task + rep) % 5) < (arm === 'edition' && task % 4 !== 0 ? 3 : 2));
    const cases: Array<[string, Spec[]]> = [
      ['a shard of 18 tasks on one model', full.filter((s) => !(s.model === SOL && s.task < 18))],
      ['the plain arm on one model', full.filter((s) => !(s.model === OPUS && s.arm === 'plain'))],
      ['a cap stop after the first trials of the last task', full.filter((s) => !(s.task === 71 && s.rep > 2))],
      ['a whole task everywhere', full.filter((s) => s.task !== 5)],
    ];
    for (const [label, specs] of cases) {
      const r = analyze(build(specs).turns, build(specs).grades, D6);
      expect([label, r.verdict]).toEqual([label, 'INCOMPLETE']);
      expect(r.missing.length).toBeGreaterThan(0);
    }
  });

  test('the graders used are reported, and alias-judge plan grades are labelled as a fallback and leave the verdict', () => {
    const { turns, grades } = build(design(() => true, 1));
    expect(analyze(turns, grades, { tasks: 72, reps: 1 }).primary.pooled!.n_tasks).toBe(72);
    const g = grades.map((x) => { const t = turns.find((y) => y.trial_id === x.trial_id)!; return { ...x, grader: t.family === 'plan' ? 'edition-grade/1+alias-judge/1' : 'edition-grade/1' }; });
    const r = analyze(turns, g, { tasks: 72, reps: 1 });
    expect(r.graders.plan).toEqual({ 'edition-grade/1+alias-judge/1': 96 });
    expect(r.plan_judge_fallback).toBe(true);
    expect(renderMarkdown(r)).toContain('not respected (a deviation), so plan is outside the verdict');
    expect(r.primary.pooled!.n_tasks).toBe(48);
    expect(r.by_family.plan!.pooled!.n_tasks).toBe(24);
    const planOnlyWins = build(design((_m, arm, task) => (task % 3 === 2 ? arm === 'edition' : true), 1));
    const families = new Set(planOnlyWins.turns.filter((t) => t.family === 'plan').map((t) => t.task_id));
    const regraded = planOnlyWins.grades.map((x) => { const t = planOnlyWins.turns.find((y) => y.trial_id === x.trial_id)!; return { ...x, grader: t.family === 'plan' ? 'edition-grade/1+alias-judge/1' : 'edition-grade/1' }; });
    expect(families.size).toBe(24);
    expect(analyze(planOnlyWins.turns, planOnlyWins.grades, { tasks: 72, reps: 1 }).primary.pooled!.delta).toBeGreaterThan(0);
    expect(analyze(planOnlyWins.turns, regraded, { tasks: 72, reps: 1 }).primary.pooled!.delta).toBe(0);
  });

  test('records the analysis cannot place are refused', () => {
    const { turns, grades } = build([{ model: OPUS, arm: 'plain', task: 1, rep: 0, success: true }]);
    const o = { tasks: 1, reps: 1 };
    expect(() => analyze([{ ...turns[0]!, status: 'crashed' }], grades, o)).toThrow('unknown status crashed');
    expect(() => analyze(turns, [], o)).toThrow('an ok trial has no grade');
    expect(() => analyze([{ ...turns[0]!, model: 'anthropic:claude-haiku-5-5' }], grades, o)).toThrow('unknown model');
    expect(() => analyze([turns[0]!, turns[0]!], grades, o)).toThrow('repeats');
  });
});

describe('edition-analysis: descriptive endpoints', () => {
  test('opens, first steps, forced-arm comparisons, cost per task and per success, reply length and families', () => {
    const specs = design((_m, arm, task, rep) => (arm === 'forced' ? rep < 1 : arm === 'edition' ? ((task + rep) % 3) === 0 : ((task + rep) % 4) === 0), 3, ['edition', 'plain', 'forced'])
      .filter((s) => s.arm !== 'forced' || s.rep === 0)
      .map((s) => ({ ...s, reply: s.arm === 'edition' ? 'x'.repeat(900) : 'x'.repeat(300) }));
    const r = analyze(build(specs).turns, build(specs).grades, { tasks: 72, reps: 3 });
    const e = r.cells[OPUS + '/edition']!, f = r.cells[OPUS + '/forced']!, p = r.cells['pooled/plain']!;
    expect(e.open_matched).toEqual({ k: 216, n: 216 });
    expect(e.first_step.k).toBe(144);
    expect(f.trials).toBe(72);
    expect(f.complete_read).toEqual({ k: 72, n: 72 });
    expect(e.cost_per_task).toBeCloseTo(0.15, 12);
    expect(e.cost_per_success).toBeCloseTo((216 * 0.15) / e.success.k, 9);
    expect(e.reply_chars).toEqual({ mean: 900, median: 900 });
    expect(p.trials).toBe(432);
    expect(r.forced.vs_plain.pooled!.n_tasks).toBe(72);
    expect(r.forced.vs_edition.per_model[SOL]).not.toBeNull();
    expect(Object.keys(r.by_family)).toEqual(['investigate', 'plan', 'review']);
    expect(Object.keys(e.by_family)).toEqual(['investigate', 'plan', 'review']);
  });

  test('the same input gives the same output, and the command writes JSON and markdown', () => {
    const { turns, grades } = build(design((_m, arm, task, rep) => ((task + rep) % 5) < (arm === 'edition' ? 3 : 2)));
    expect(JSON.stringify(analyze(turns, grades, D6))).toBe(JSON.stringify(analyze(turns, grades, D6)));
    const dir = mkdtempSync(join(tmpdir(), 'edition-analysis-'));
    writeFileSync(join(dir, 'turns.jsonl'), turns.map((x) => JSON.stringify(x)).join('\n') + '\n');
    writeFileSync(join(dir, 'grades.jsonl'), grades.map((x) => JSON.stringify(x)).join('\n') + '\n');
    const r = spawnSync('bun', [join(import.meta.dir, '..', 'harnesses', 'qm', 'gstack', 'edition-analysis.ts'), '--turns', join(dir, 'turns.jsonl'), '--grades', join(dir, 'grades.jsonl'), '--tasks', '72', '--reps', '6', '--out', join(dir, 'out')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('verdict KEEP');
    expect(JSON.parse(readFileSync(join(dir, 'out', 'edition-analysis.json'), 'utf8')).verdict).toBe('KEEP');
    expect(readFileSync(join(dir, 'out', 'edition-analysis.md'), 'utf8')).toContain('**Verdict: KEEP.**');
  }, 30_000);
});
