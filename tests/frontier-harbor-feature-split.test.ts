import { expect, test } from 'bun:test';
import { analyze, extraCostPerExtraSolve, interaction, predictionReading, render } from '../scripts/frontier-harbor/feature-split.ts';
import { changedFiles, isNamed, labelTask } from '../scripts/frontier-harbor/diagnosis-label.ts';

const FABLE = 'anthropic:claude-fable-5-2', OPUS = 'anthropic:claude-opus-5-5';
const trial = (task: string, model: string, n: number, pass: boolean, usd: number, termination = 'completed') =>
  ({ trial_id: 'r/' + model + '/' + task + '/a' + n, task, model, termination, grade: pass ? 'pass' : 'fail', consent_violation: false, usage: { usd } }) as any;

// Fable solves every diagnosis task twice and Opus once each; on pointed tasks both solve once.
const diag = ['d1', 'd2', 'd3', 'd4'], pointed = ['p1', 'p2', 'p3', 'p4'];
const labels: Record<string, { label: 'diagnosis' | 'pointed' }> = Object.fromEntries([...diag.map((k) => [k, { label: 'diagnosis' as const }]), ...pointed.map((k) => [k, { label: 'pointed' as const }])]);
const trials = [
  ...diag.flatMap((k) => [trial(k, FABLE, 1, true, 3), trial(k, FABLE, 2, true, 3), trial(k, OPUS, 1, true, 1), trial(k, OPUS, 2, false, 1)]),
  ...pointed.flatMap((k, i) => [trial(k, FABLE, 1, i % 2 === 0, 3), trial(k, FABLE, 2, false, 3), trial(k, OPUS, 1, i % 2 === 0, 1), trial(k, OPUS, 2, false, 1)]),
  trial('d1', 'anthropic:claude-fable-5-1', 1, true, 9),
];

test('per-group differences, interaction and the prediction reading', () => {
  const r = analyze(trials, labels);
  expect(r.groups.diagnosis.tasks).toBe(4);
  expect(r.groups.diagnosis.difference.delta).toBeCloseTo(0.5);
  expect(r.groups.pointed.difference.delta).toBeCloseTo(0);
  expect(r.groups.all.tasks).toBe(8);
  expect(r.interaction.estimate).toBeCloseTo(0.5);
  expect(r.arms['Fable 5.2'].trials).toBe(16);
  expect(r.groups.diagnosis.extra_cost_per_extra_solve.usd_per_extra_solve).toBeCloseTo((4 * 6 - 4 * 2) / 4);
  expect(r.groups.pointed.extra_cost_per_extra_solve.usd_per_extra_solve).toBeNull();
  expect(render(r)).toContain('Needs diagnosis');
});

test('an excluded trial leaves its task scored on the other attempt and counts its spend', () => {
  const r = analyze([...trials.filter((t) => !(t.task === 'p1' && t.model === OPUS && t.trial_id.endsWith('a2'))), trial('p1', OPUS, 2, false, 5, 'infra_error')], labels);
  expect(r.arms['Opus 5.5'].excluded).toBe(1);
  expect(r.groups.pointed.cost_per_solve['Opus 5.5'].usd).toBeCloseTo(4 + 4 + 5 - 1);
});

test('dollars charged at a full reservation are left out of cost and reported beside', () => {
  const r = analyze([...trials.filter((t) => !(t.task === 'd1' && t.model === FABLE && t.trial_id.endsWith('a2'))), { ...trial('d1', FABLE, 2, true, 7), usage: { usd: 7, usd_reserved: 4 } }], labels);
  expect(r.arms['Fable 5.2'].usd_reserved).toBe(4);
  expect(r.arms['Opus 5.5'].usd_reserved).toBe(0);
  expect(r.groups.diagnosis.extra_cost_per_extra_solve.usd_per_extra_solve).toBeCloseTo((4 * 6 - 4 * 2) / 4);
  expect(r.groups.diagnosis.cost_per_solve['Fable 5.2'].usd).toBeCloseTo(24);
  expect(render(r)).toContain('left out of cost: Fable 5.2 $4.00');
});

test('a task with no label stops the analysis', () => {
  expect(() => analyze([trial('zz', FABLE, 1, true, 1)], labels)).toThrow('no label');
});

test('the prediction is disproved by a non-positive interaction or a diagnosis interval below zero', () => {
  expect(predictionReading({ estimate: 0, ci95: [-0.1, 0.1] }, [-0.1, 0.1])).toBe('disproved');
  expect(predictionReading({ estimate: 0.1, ci95: [-0.05, 0.2] }, [-0.3, -0.01])).toBe('disproved');
  expect(predictionReading({ estimate: 0.1, ci95: [0.01, 0.2] }, [0, 0.2])).toBe('supported');
  expect(predictionReading({ estimate: 0.1, ci95: [-0.01, 0.2] }, [-0.05, 0.2])).toBe('not shown');
});

test('interaction and extra cost are seeded and repeatable', () => {
  const rows = (n: number, d: number) => Array.from({ length: n }, (_, i) => ({ task: 't' + i, a: 0, b: i % 2 ? d : 0, usd_a: 1, usd_b: 3, solves_a: 0, solves_b: i % 2 ? 1 : 0 }));
  expect(interaction(rows(10, 1), rows(10, 0))).toEqual(interaction(rows(10, 1), rows(10, 0)));
  expect(extraCostPerExtraSolve(rows(10, 1)).usd_per_extra_solve).toBeCloseTo(20 / 5);
});

test('the label rule: changed files less tests and docs, named by path, file name or a specific stem', () => {
  const solve = ['diff --git a/src/dedup/MessageDeduplication.java b/src/dedup/MessageDeduplication.java', 'diff --git a/src/test/java/FooTest.java b/src/test/java/FooTest.java', 'diff --git a/CHANGELOG.md b/CHANGELOG.md', 'diff --git a/pkg/utils.go b/pkg/utils.go', 'diff --git a/a/b_test.go b/a/b_test.go'].join('\n');
  expect(changedFiles(solve)).toEqual(['src/dedup/MessageDeduplication.java', 'pkg/utils.go']);
  expect(isNamed('src/dedup/MessageDeduplication.java', 'the MessageDeduplication class races')).toBe(true);
  expect(isNamed('src/dedup/MessageDeduplication.java', 'MessageDeduplicationTest fails')).toBe(false);
  expect(isNamed('pkg/utils.go', 'something in utils breaks')).toBe(false);
  expect(isNamed('pkg/utils.go', 'see pkg/utils.go')).toBe(true);
  expect(labelTask('the broker accepts duplicates', solve).label).toBe('diagnosis');
  expect(labelTask('look at utils.go', solve)).toEqual({ label: 'pointed', changed: ['src/dedup/MessageDeduplication.java', 'pkg/utils.go'], named: ['pkg/utils.go'] });
  expect(() => labelTask('x', 'diff --git a/README.md b/README.md')).toThrow('no source file');
});
