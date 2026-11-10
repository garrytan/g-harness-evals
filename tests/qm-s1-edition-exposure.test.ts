// internal-task Amendment 3: the exposure rate report script and the calibration script's pure parts. Keyless.
//
// Value: protects=the exposure rate counts only counted edition trials with all three exposure flags, clusters its
// interval by task, and prints the preregistered Why-null line only below a 10 percent upper bound; the red-team plans
// name every constraint and distractor; the plan band uses the Wilson interval; fails_when=a plain or forced trial, an
// excluded status or a superseded record enters the rate, the line fires above the bound, or a red-team plan drops an item;
// seam=exposure-rate.ts exposureRate, judge-calibration.ts redTeamPlan/wilson/fullRule; no_claim=the judges' calls.
import { describe, expect, test } from 'bun:test';
import { exposureRate } from '../harnesses/qm/gstack/exposure-rate.ts';
import { fullRule, redTeamPlan, wilson } from '../harnesses/qm/gstack/judge-calibration.ts';

const turn = (task: string, model: string, arm: string, rep: number, exposedFlags: boolean, status = 'ok', id = '') => ({ trial_id: id || task + '-' + arm + '-' + model + '-k' + rep, task_id: task, family: task.startsWith('plan') ? 'plan' : 'review', arm, model, rep, status, counts: { open_matched: exposedFlags, complete_read: exposedFlags, first_step: exposedFlags } });
const OPUS = 'anthropic:claude-opus-5-5', SOL = 'openai:gpt-6.1-sol';

describe('exposure-rate.ts', () => {
  test('counts counted edition trials with all three flags; plain, forced, excluded and superseded records stay out', () => {
    const turns = [
      turn('plan-01', SOL, 'edition', 1, true), turn('plan-02', SOL, 'edition', 1, false), turn('rev-01', SOL, 'edition', 1, true),
      turn('plan-03', SOL, 'edition', 1, true, 'infra_error'), turn('plan-03', SOL, 'edition', 1, false, 'ok', 'plan-03-edition-sol-k1-r2'),
      turn('plan-04', SOL, 'edition', 1, true, 'model_error'),
      turn('plan-01', SOL, 'plain', 1, true), turn('plan-01', SOL, 'forced', 1, true),
      { ...turn('rev-02', SOL, 'edition', 1, true), counts: { open_matched: true, complete_read: false, first_step: true } },
    ];
    const r = exposureRate(turns as never).models[SOL]!;
    expect([r.k, r.n, r.tasks]).toEqual([2, 5, 5]);
    expect(r.families.plan!.n).toBe(3);
    expect(r.why_null_line).toBeNull();
  });

  test('the Why-null line fires only when the upper bound is below 10 percent', () => {
    const none = Array.from({ length: 48 }, (_, i) => turn('plan-' + String(i + 1).padStart(2, '0'), OPUS, 'edition', 1, false));
    const r = exposureRate(none as never).models[OPUS]!;
    expect(r.ci95![1]).toBeLessThan(0.1);
    expect(r.why_null_line).toContain('the edition reached Opus 5.5 in 0 of 48 edition trials');
    const some = none.map((t, i) => (i < 12 ? { ...t, counts: { open_matched: true, complete_read: true, first_step: true } } : t));
    expect(exposureRate(some as never).models[OPUS]!.why_null_line).toBeNull();
  });
});

describe('judge-calibration.ts pure parts', () => {
  test('a red-team plan names every constraint and distractor of its key', () => {
    const item = (id: string) => ({ id, description: 'Description of ' + id + '.', all_of: [[id]] });
    const key = { constraints: ['a', 'b', 'c'].map(item), distractors: ['d', 'e', 'f', 'g', 'h'].map(item) };
    const plan = redTeamPlan(key);
    for (const i of [...key.constraints, ...key.distractors]) { expect(plan).toContain(i.description); expect(plan).toContain(i.id); }
  });

  test('the full rule and the Wilson interval', () => {
    expect([fullRule(2, 6), fullRule(1, 1), fullRule(3, 7)]).toEqual([true, false, false]);
    const [lo, hi] = wilson(6, 24);
    expect(lo).toBeCloseTo(0.1199, 3);
    expect(hi).toBeCloseTo(0.449, 3);
  });
});
