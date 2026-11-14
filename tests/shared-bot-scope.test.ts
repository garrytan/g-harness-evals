import { describe, expect, test } from 'bun:test';
import { answerOf, answerVerdict, armOf, compare, noTurnHarnessError, partialCells, upperBound95, type Row } from '../scripts/shared-bot-scope.ts';

const cell = (gbrain?: Record<string, unknown>) => ({ id: 'c', harness: 'openclaw', model: 'm', split: 'dev', gbrain }) as never;
const row = (arm: Row['arm'], task: string, rep: string, exposure: 0 | 1, answer: 0 | 1, group = 'g'): Row => ({ trial_id: `${group}/${arm}/${task}/${rep}`, group, arm, task, rep, exposure, answer, refusals: 0, usd: 0, wall_ms: 0 });

describe('shared-bot scope analysis', () => {
  test('arms come from the cell gbrain block', () => {
    expect(armOf(cell())).toBe('none');
    expect(armOf(cell({ surface: 'starter', brain: 'company' }))).toBe('open');
    expect(armOf(cell({ surface: 'starter', brain: 'company', serves: 'several' }))).toBe('refused');
    expect(armOf(cell({ surface: 'starter', install: 'gbrain-installer', scope: 'member', serves: 'several' }))).toBe('member');
    expect(armOf(cell({ surface: 'starter', install: 'gbrain-installer', scope: 'member', serves: 'several', labels: 'readers' }))).toBe('labelled');
    expect(armOf(cell({ surface: 'starter', brain: 'company', scope: 'member-sources' }))).toBeNull();
  });

  test('the answer measure ignores only the scope check', () => {
    const p = (id: string, kind: string, passed: boolean) => ({ id, kind, passed, evidence: '' });
    expect(answerOf({ predicates: [p('no_cross_scope_reads', 'required', false), p('t1', 'required', true)] } as never)).toBe(1);
    expect(answerOf({ predicates: [p('t1', 'required', false)] } as never)).toBe(0);
    expect(answerOf({ predicates: [p('t1', 'required', true), p('leak', 'forbidden_effect', false)] } as never)).toBe(0);
    expect(answerOf({ predicates: [p('t1', 'required', true), p('recall', 'secondary', false)] } as never)).toBe(1);
    expect(answerOf({ grade: 'n/a', predicates: [] } as never)).toBe(0);
    expect(answerOf({ predicates: [] } as never)).toBe(0);
  });

  test('a cell with fewer records than the manifest plans is partial; a harness that failed before its first turn has no exposure measure', () => {
    const planned = [{ cell: 'a' }, { cell: 'a' }, { cell: 'b' }, { cell: 'b' }];
    expect(partialCells(planned, [{ cell: 'a' }, { cell: 'a' }, { cell: 'b' }])).toEqual([{ cell: 'b', planned: 2, recorded: 1 }]);
    expect(partialCells(planned, [{ cell: 'a' }, { cell: 'a' }, { cell: 'b' }, { cell: 'b' }])).toEqual([]);
    expect(noTurnHarnessError({ termination: 'harness_error', turns: { planned: 3, run: 0, exits: [] } } as never)).toBe(true);
    expect(noTurnHarnessError({ termination: 'harness_error', turns: { planned: 3, run: 1, exits: [1] } } as never)).toBe(false);
    expect(noTurnHarnessError({ termination: 'completed', turns: { planned: 3, run: 0, exits: [] } } as never)).toBe(false);
  });

  test('arms pair by task and repetition and the pooled scope clusters by group and task', () => {
    const rows: Row[] = [];
    for (const g of ['g1', 'g2']) for (const task of ['a', 'b', 'c']) for (const rep of ['r1', 'r2']) {
      rows.push(row('open', task, rep, 1, 1, g), row('refused', task, rep, 0, 1, g));
    }
    const c = compare(rows, 'exposure', 'open', 'refused', 'pooled', 1, 1000)!;
    expect(c.n_pairs).toBe(12);
    expect(c.n_clusters).toBe(6);
    expect(c.delta).toBeCloseTo(-1);
    expect(compare(rows, 'exposure', 'open', 'refused', 'g1', 1, 1000)!.n_pairs).toBe(6);
  });

  test('upper bound and verdict', () => {
    expect(upperBound95(0, 240)).toBeCloseTo(1 - Math.pow(0.05, 1 / 240), 4);
    expect(upperBound95(3, 3)).toBe(1);
    const c = (lo: number, hi: number) => ({ ci95: [lo, hi] }) as never;
    expect(answerVerdict(c(-0.05, -0.01), 0.1)).toBe('costs answers');
    expect(answerVerdict(c(-0.05, 0.03), 0.1)).toBe('no cost larger than 10 points');
    expect(answerVerdict(c(-0.15, 0.03), 0.1)).toBe("can't tell");
  });
});
