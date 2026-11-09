import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  analysisClasses, analyze, applyHolm, classOf, FALLBACK_BASIS, gbrainClaims, GRADED_BEFORE_FIX, labelStatus, labellerCheck, mddFor, mddOnly, PAIR_RUNS, renderMarkdown,
  retestSubsets, retrievalAnyMembers, RETRIEVAL_ANY, RETRIEVAL_ANY_CLASSES, SEEDS, testFamily,
} from '../scripts/failure-mining/analyze.ts';
import { designMdd } from '../scripts/paired-mdd.ts';
import type { LabelLine } from '../scripts/failure-mining/check-labels.ts';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts/failure-mining/analyze.ts');
const CODEBOOK = join(ROOT, 'tests/fixtures/failure-mining/analysis-codebook.json');
const REAL_CODEBOOK = join(ROOT, 'docs/benchmarks/2026-11-09-failure-mining/codebook.json');
const REAL_CORPUS = join(ROOT, 'docs/benchmarks/2026-11-09-failure-mining/corpus');
const PAIR_RUN = '2026-11-03-qm-c4-told-live';
const CODEBOOK_SHA = createHash('sha256').update(readFileSync(CODEBOOK)).digest('hex');
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

// Default population, multi-user, frontier. Cells: c1 = (tree, t1, h1, m1) trials A B C D; c2 = (tree, t2, h1, m1) trials E F G H;
// c3 = (tree, t1, h2, m1) trials I J from a run outside the pairs. A, B, E, F have no brain; C, D, G, H have one.
// Labels: B did_not_look (verified), C did_not_look (unverified), D did_not_look (verified), G unscoped_brain_search (verified),
// H labelling failed, I grader_defect (verified), J no label line. K is variant, L harbor, M not frontier: none counts in default.
const rows = [
  ['A', PAIR_RUN, 'res/none', 't1', 'h1', 'm1', 'pass', 'default', false],
  ['B', PAIR_RUN, 'res/none', 't1', 'h1', 'm1', 'fail', 'default', false],
  ['C', PAIR_RUN, 'res/brain', 't1', 'h1', 'm1', 'fail', 'default', true],
  ['D', PAIR_RUN, 'res/brain', 't1', 'h1', 'm1', 'fail', 'default', true],
  ['E', PAIR_RUN, 'res/none', 't2', 'h1', 'm1', 'pass', 'default', false],
  ['F', PAIR_RUN, 'res/none', 't2', 'h1', 'm1', 'pass', 'default', false],
  ['G', PAIR_RUN, 'res/brain', 't2', 'h1', 'm1', 'fail', 'default', true],
  ['H', PAIR_RUN, 'res/brain', 't2', 'h1', 'm1', 'fail', 'default', true],
  ['I', 'other-run', 'res/other', 't1', 'h2', 'm1', 'fail', 'default', false],
  ['J', 'other-run', 'res/other', 't1', 'h2', 'm1', 'fail', 'default', false],
  ['K', PAIR_RUN, 'res/brain', 't1', 'h1', 'm1', 'fail', 'variant', true],
] as const;
const calls: Record<string, number> = { C: 2, D: 0, G: 1, H: 0, K: 0 };

function manifestLine(id: string, run: string, dir: string, task: string, harness: string, model: string, grade: string, population: string, brain: boolean, extra: Record<string, unknown> = {}) {
  return {
    trial_id: id, run, results_dir: dir, cell: `${harness}-${brain ? 'gbrain' : 'none'}`, task, harness, model, grade, kind: 'multiuser', frontier: true, population, gstack_present: false,
    gbrain: brain ? { present: true, install: 'mcp', route: 'told', in_turn_calls: calls[id] ?? 0 } : { present: false }, ...extra,
  };
}

const meta = (model = 'particle:particle-1') => ({ model, codebook_sha256: CODEBOOK_SHA, prefix_sha256: `prefix-${model}` });
const label = (trial_id: string, root_cause: string, verified: boolean, model?: string): Partial<LabelLine> => ({ trial_id, status: 'ok', root_cause, check: { verified, reasons: verified ? [] : ['quote not found'] }, ...meta(model) });

function corpus(): { dir: string; labels: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fm-analyze-'));
  const manifest = [
    ...rows.map(([id, run, dir, task, harness, model, grade, population, brain]) => manifestLine(id, run, dir, task, harness, model, grade, population, brain)),
    manifestLine('L', PAIR_RUN, 'res/none', 't1', 'h1', 'm1', 'fail', 'default', false, { kind: 'harbor' }),
    manifestLine('M', PAIR_RUN, 'res/none', 't1', 'h1', 'm1', 'fail', 'default', false, { frontier: false }),
  ];
  writeFileSync(join(dir, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
  const res = (d: string) => ({ results_dir: d, kind: 'multiuser', counted: true, tasks_root: 'tasks/multiuser', task_sets: ['v0.3'] });
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({ runs: { [PAIR_RUN]: { results: [res('res/none'), res('res/brain')] }, 'other-run': { results: [res('res/other')] } } }));
  const labels = join(dir, 'labels.jsonl');
  const lines = [label('B', 'did_not_look', true), label('C', 'did_not_look', false), label('D', 'did_not_look', true), label('G', 'unscoped_brain_search', true),
    { trial_id: 'H', status: 'failed', check: null, problems: ['no valid record after the retry'], ...meta() }, label('I', 'grader_defect', true), label('K', 'did_not_look', true), label('L', 'did_not_look', true)];
  writeFileSync(labels, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, labels };
}

const rate = (classes: Array<{ id: string; rate: number | null }>, id: string) => classes.find((c) => c.id === id)!.rate!;

describe('label status', () => {
  const ok = label('X', 'did_not_look', true) as LabelLine;
  test('verified, unverified, failed and missing', () => {
    expect(labelStatus(ok)).toBe('verified');
    expect(labelStatus(label('X', 'did_not_look', false) as LabelLine)).toBe('unverified');
    expect(labelStatus({ trial_id: 'X', status: 'failed', check: null } as unknown as LabelLine)).toBe('failed');
    expect(labelStatus({ trial_id: 'X', status: 'ok', check: null } as unknown as LabelLine)).toBe('failed');
    expect(labelStatus(undefined)).toBe('missing');
  });
  test('check-labels output overrides the stored check, but never revives a failed record', () => {
    expect(labelStatus(ok, { status: 'unverified' })).toBe('unverified');
    expect(labelStatus(label('X', 'did_not_look', false) as LabelLine, { status: 'verified' })).toBe('verified');
    expect(labelStatus({ trial_id: 'X', status: 'failed', check: null } as unknown as LabelLine, { status: 'verified' })).toBe('failed');
  });
  test('main counts verified and unverified; sensitivity counts verified only; the rest is unlabelled', () => {
    expect(classOf('verified', 'a', 'main')).toBe('a');
    expect(classOf('unverified', 'a', 'main')).toBe('a');
    expect(classOf('unverified', 'a', 'verified_only')).toBe('unlabelled');
    expect(classOf('verified', 'a', 'verified_only')).toBe('a');
    expect(classOf('failed', null, 'main')).toBe('unlabelled');
    expect(classOf('missing', null, 'main')).toBe('unlabelled');
  });
});

describe('codebook classes', () => {
  test('ids, groups and tested flags come from the codebook passed in', () => {
    const classes = analysisClasses(JSON.parse(readFileSync(CODEBOOK, 'utf8')));
    expect(classes.map((c) => [c.id, c.group, c.typical_stage, c.gbrain_claims, c.tested])).toEqual([
      ['did_not_look', 'agent', 'retrieve', ['B1', 'B3'], true],
      ['unscoped_brain_search', 'brain', 'retrieve', [], false],
      ['wrong_figure', 'agent', 'decide', [], false],
      ['grader_defect', 'task_or_grader', 'reply', [], false],
    ]);
    expect(testFamily(classes)).toEqual({ classes: ['did_not_look'], composite: ['did_not_look', 'unscoped_brain_search'], m: 2 });
  });
  test('the real codebook gives the preregistered test family: 5 classes and retrieval_any of 7, so m = 6', () => {
    const classes = analysisClasses(JSON.parse(readFileSync(REAL_CODEBOOK, 'utf8')));
    expect(RETRIEVAL_ANY_CLASSES.filter((id) => !classes.some((c) => c.id === id))).toEqual([]);
    expect([...retrievalAnyMembers(classes)].sort()).toEqual(['brain_miss', 'cross_scope_read', 'did_not_look', 'found_ignored', 'gave_up', 'unscoped_brain_search', 'wrong_place']);
    expect([...testFamily(classes).classes].sort()).toEqual(['did_not_look', 'found_ignored', 'gave_up', 'leak', 'wrong_place']);
    expect(testFamily(classes).m).toBe(6);
    expect(classes.filter((c) => c.group === 'brain').every((c) => !c.tested)).toBe(true);
    const out = Bun.spawnSync(['bun', SCRIPT, '--mdd', '--corpus', REAL_CORPUS, '--codebook', REAL_CODEBOOK], { env: ENV }).stdout.toString();
    expect(out).toContain('Holm first step (m=6) at 2%');
  });
  test('gbrain claims are read from strings, lists and objects, and gstack claims are ignored', () => {
    expect(gbrainClaims(['B2', 'G1', 'B10 and B2'])).toEqual(['B2', 'B10']);
    expect(gbrainClaims({ gbrain: 'B14, B15', gstack: 'B1' })).toEqual(['B14']);
    expect(gbrainClaims([{ id: 'B4' }, { claim: 'G2' }])).toEqual(['B4']);
    expect(gbrainClaims(undefined)).toEqual([]);
  });
});

describe('analysis on a hand-worked corpus', () => {
  const { dir, labels } = corpus();
  const a = analyze({ corpus: dir, codebook: CODEBOOK, labels });

  test('label status counts per population', () => {
    expect(a.label_status.default).toEqual({ failed_trials: 7, verified: 4, unverified: 1, failed: 1, missing: 1, mechanical: 0 });
    expect(a.label_status.variant).toEqual({ failed_trials: 1, verified: 1, unverified: 0, failed: 0, missing: 0, mechanical: 0 });
    expect(a.regrade).toBeNull();
  });

  test('prevalence: cell-weighted rates over all trials, passes included', () => {
    const main = a.A.populations.default!.main.overall;
    expect([main.n_trials, main.n_failed, main.n_cells, main.n_clusters]).toEqual([10, 7, 3, 2]);
    // c1 3 of 4, c2 0, c3 0: (3/4) / 3.
    expect(rate(main.classes, 'did_not_look')).toBeCloseTo(1 / 4, 12);
    expect(rate(main.classes, 'unscoped_brain_search')).toBeCloseTo(1 / 12, 12);
    expect(rate(main.classes, 'grader_defect')).toBeCloseTo(1 / 6, 12);
    // H (failed record) in c2 and J (no line) in c3: (1/4 + 1/2) / 3.
    expect(rate(main.classes, 'unlabelled')).toBeCloseTo(1 / 4, 12);
    const dnl = main.classes.find((c) => c.id === 'did_not_look')!;
    expect([dnl.trials, dnl.tasks, dnl.hm]).toEqual([3, 1, 1]);
    const ver = a.A.populations.default!.verified_only.overall;
    expect(rate(ver.classes, 'did_not_look')).toBeCloseTo(1 / 6, 12);
    expect(rate(ver.classes, 'unlabelled')).toBeCloseTo(1 / 3, 12);
    expect(rate(a.A.populations.default!.main.by_harness.h2!.classes, 'grader_defect')).toBeCloseTo(1 / 2, 12);
    expect(a.A.populations.variant!.main.overall.n_trials).toBe(1);
  });

  test('ranking leaves task_or_grader classes to repository fixes', () => {
    expect(a.A.ranking).toEqual(['did_not_look', 'unscoped_brain_search', 'wrong_figure']);
    expect(a.A.repository_fixes).toEqual(['grader_defect']);
  });

  test('pair difference: brain minus no brain per (pair, task) unit, averaged', () => {
    expect(a.B.pairs).toEqual([{ pair: `${PAIR_RUN}, h1, m1`, routes: ['mcp/told'], units: 2, trials_brain: 4, trials_none: 4 }]);
    const row = (id: string) => a.B.pooled.main!.find((r) => r.class === id)!;
    // t1: brain 2 of 2, none 1 of 2, +1/2; t2: 0 and 0. Mean +1/4.
    expect([row('did_not_look').mean_brain, row('did_not_look').mean_none, row('did_not_look').delta, row('did_not_look').worse]).toEqual([0.5, 0.25, 0.25, 1]);
    expect(row('unscoped_brain_search').delta).toBe(0.25);
    expect([row('unscoped_brain_search').tested, row('unscoped_brain_search').p, row('unscoped_brain_search').reading]).toEqual([false, null, 'brain-only class: brain-arm rate, descriptive, never tested']);
    expect(a.B.brain_only.unscoped_brain_search).toMatchObject({ brain_trials: 4, brain_with_class: 1, brain_rate: 0.25, no_brain_with_class: 0 });
    // retrieval_any = did_not_look + unscoped_brain_search. t1: brain 2 of 2, none 1 of 2; t2: brain 1 of 2 (G), none 0. Both +1/2.
    const any = row(RETRIEVAL_ANY);
    expect([any.members, any.tested, any.delta, any.worse]).toEqual([['did_not_look', 'unscoped_brain_search'], true, 0.5, 2]);
    // Two units of +1/2: half the sign patterns reach the observed sum.
    expect(any.p!).toBeGreaterThan(0.45);
    expect(any.p!).toBeLessThan(0.55);
    expect(a.B.pooled.main!.filter((r) => r.p_holm !== null).map((r) => r.class)).toEqual(['did_not_look', RETRIEVAL_ANY]);
    expect(a.B.holm_m).toBe(2);
    expect(row('did_not_look').tested).toBe(true);
    expect(row('wrong_figure').tested).toBe(false);
    expect(row('wrong_figure').p).toBeNull();
    // Two units, one of them zero: every sign pattern reaches the observed sum, so p is 1.
    expect(row('did_not_look').p).toBe(1);
    expect(row('did_not_look').reading).toBe('no measurable difference');
    // Verified only: C drops to unlabelled, so t1 is 1/2 against 1/2.
    expect(a.B.pooled.verified_only!.find((r) => r.class === 'did_not_look')!.delta).toBe(0);
  });

  test('exposure split and gstack verdict', () => {
    expect([a.C.called!.trials, a.C.not_called!.trials]).toEqual([2, 2]);
    expect(a.D.verdict).toBe('not exposed in this corpus');
    expect(a.E.status).toBe('not_checked');
  });

  test('MDD follows the paired-mdd variance rule', () => {
    const pooled = a.B.mdd.find((m) => m.scope === 'pooled')!;
    expect(pooled.holm_m).toBe(2);
    for (const r of pooled.rows) expect(r.mdd!).toBeCloseTo(designMdd(r.p, { tasks: 2, reps: 2 }).mdd!, 12);
    const uneven = mddFor('x', [{ n_brain: 4, n_none: 2 }, { n_brain: 4, n_none: 2 }, { n_brain: 2, n_none: 2 }], 1);
    const p = 0.05, v = p * (1 - p) * (2 * (1 / 4 + 1 / 2) + 1);
    expect(uneven.rows[1]!.se!).toBeCloseTo(Math.sqrt((3 / 2) * v) / 3, 12);
    expect(uneven.rows[1]!.mdd_holm_first).toBeCloseTo(uneven.rows[1]!.mdd!, 12);
    expect(mddOnly(dir, 2)).toEqual(a.B.mdd);
  });

  test('determinism: the same inputs give the same bytes', () => {
    const env = ENV;
    const outs = [join(dir, 'out1'), join(dir, 'out2')].map((out) => {
      const r = Bun.spawnSync(['bun', SCRIPT, '--corpus', dir, '--codebook', CODEBOOK, '--labels', labels, '--out', out], { env });
      expect(r.exitCode).toBe(0);
      return [readFileSync(join(out, 'analysis.json'), 'utf8'), readFileSync(join(out, 'analysis.md'), 'utf8')];
    });
    expect(outs[0]).toEqual(outs[1]!);
    expect(outs[0]![0]).toBe(JSON.stringify(a, null, 1) + '\n');
    expect(outs[0]![1]).toBe(renderMarkdown(a));
    const mdd = [0, 1].map(() => Bun.spawnSync(['bun', SCRIPT, '--mdd', '--corpus', dir, '--codebook', CODEBOOK], { env }).stdout.toString());
    expect(mdd[0]).toBe(mdd[1]!);
    expect(mdd[0]).toContain('| pooled | 2 | 4 / 4 |');
  });
});

describe('regrade', () => {
  const commit = 'abc1234';
  const row = (trial_id: string, from: string, to: string, grader_commit = commit) => ({ trial_id, grader_commit, original: { grade: from, consent_violation: false, approval_stop: false, failed: from === 'pass' ? [] : ['x'] }, regraded: { grade: to, consent_violation: false, approval_stop: false, failed: to === 'pass' ? [] : ['x'] } });
  const writeRegrade = (dir: string, rows: unknown[], name = 'regrade.jsonl') => { const p = join(dir, name); writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); return p; };
  // B (default, labelled did_not_look) and K (variant) regrade to pass; L regrades to pass but is harbor, out of scope;
  // A goes pass to fail and J n/a to fail, which change nothing; H stays fail with other predicates.
  const rows = [row('B', 'fail', 'pass'), row('K', 'fail', 'pass'), row('L', 'fail', 'pass'), row('A', 'pass', 'fail'), row('J', 'n/a', 'fail'), row('H', 'fail', 'fail')];

  test('a failed trial regraded to pass is graded_before_fix, mechanical, in main and verified only', () => {
    const { dir, labels } = corpus();
    const mddBefore = mddOnly(dir, 2);
    writeRegrade(dir, rows);
    const a = analyze({ corpus: dir, codebook: CODEBOOK, labels });
    expect(a.label_status.default).toEqual({ failed_trials: 7, verified: 3, unverified: 1, failed: 1, missing: 1, mechanical: 1 });
    expect(a.label_status.variant!.mechanical).toBe(1);
    const t = a.A.populations.default!;
    // c1: B is now graded_before_fix; C and D stay did_not_look.
    expect(rate(t.main.overall.classes, 'did_not_look')).toBeCloseTo(1 / 6, 12);
    expect(rate(t.main.overall.classes, GRADED_BEFORE_FIX)).toBeCloseTo(1 / 12, 12);
    expect(rate(t.verified_only.overall.classes, GRADED_BEFORE_FIX)).toBeCloseTo(1 / 12, 12);
    expect(rate(t.verified_only.overall.classes, 'did_not_look')).toBeCloseTo(1 / 12, 12);
    // Sensitivity: B is a pass.
    expect(t.regraded_as_pass.overall.n_failed).toBe(6);
    expect(rate(t.regraded_as_pass.overall.classes, GRADED_BEFORE_FIX)).toBe(0);
    expect(rate(t.regraded_as_pass.overall.classes, 'did_not_look')).toBeCloseTo(1 / 6, 12);
    expect(a.A.populations.variant!.regraded_as_pass.overall.n_failed).toBe(0);
    expect(a.A.ranking).not.toContain(GRADED_BEFORE_FIX);
    // t1 no-brain arm loses its did_not_look: brain 1, none 0.
    expect(a.B.pooled.main!.find((r) => r.class === 'did_not_look')!.delta).toBe(0.5);
    expect(a.regrade).toEqual({ file: 'regrade.jsonl', grader_commit: commit, rows: 6, overridden: 2, overridden_by_population_and_run: { default: { [PAIR_RUN]: 1 }, variant: { [PAIR_RUN]: 1 } }, to_pass_not_counted: 1, to_fail_unchanged: 2, other_unchanged: 1 });
    expect(a.inputs.regrade!.file).toBe('regrade.jsonl');
    expect(renderMarkdown(a)).toContain('| variant | 2026-11-03-qm-c4-told-live | 1 |');
    expect(JSON.stringify(analyze({ corpus: dir, codebook: CODEBOOK, labels }))).toBe(JSON.stringify(a));
    expect(mddOnly(dir, 2)).toEqual(mddBefore);
  });

  test('--regrade names the file, and the CLI agrees with the library', () => {
    const { dir, labels } = corpus();
    const p = writeRegrade(dir, rows, 'elsewhere.jsonl');
    const a = analyze({ corpus: dir, codebook: CODEBOOK, labels, regrade: p });
    expect(a.regrade!.overridden).toBe(2);
    const out = join(dir, 'out');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
    const r = Bun.spawnSync(['bun', SCRIPT, '--corpus', dir, '--codebook', CODEBOOK, '--labels', labels, '--regrade', p, '--out', out], { env });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(out, 'analysis.json'), 'utf8')).toBe(JSON.stringify(a, null, 1) + '\n');
  });

  test('fails loudly on an unknown trial or mixed grader commits', () => {
    const { dir, labels } = corpus();
    writeRegrade(dir, [row('B', 'fail', 'pass'), row('ZZ', 'fail', 'pass')]);
    expect(() => analyze({ corpus: dir, codebook: CODEBOOK, labels })).toThrow('not in corpus/manifest.jsonl: ZZ');
    writeRegrade(dir, [row('B', 'fail', 'pass'), row('K', 'fail', 'pass', 'def5678')]);
    expect(() => analyze({ corpus: dir, codebook: CODEBOOK, labels })).toThrow('grader_commit values differ: abc1234, def5678');
  });
});

describe('which labels build the tables', () => {
  const truth = (i: number) => ['did_not_look', 'wrong_figure', 'grader_defect', 'unscoped_brain_search'][i % 4]!;
  const jsonl = (path: string, ls: unknown[]) => { writeFileSync(path, ls.map((l) => JSON.stringify(l)).join('\n') + '\n'); return path; };
  /** corpus() plus packet-index, a gold sample (g0..g{n-1} and B), two gold files and a fallback file. */
  function goldCorpus(o: { candidateGood: boolean; astraLabels?: number; sampleSize?: number }) {
    const { dir, labels } = corpus();
    const n = o.sampleSize ?? 40;
    const g = Array.from({ length: n }, (_, i) => `g${i}`);
    const idx = (trial_id: string, layer1_primary: string | null, population = 'default') => ({ trial_id, population, harness: 'h1', model: 'm1', layer1_primary, packet_sha256: 'sha' });
    jsonl(join(dir, 'packet-index.jsonl'), [idx('B', 'source_not_read'), idx('C', 'source_not_read'), idx('D', 'read_not_found'), idx('G', null), idx('H', 'source_not_read'), idx('I', 'forbidden_content'), idx('K', 'source_not_read', 'variant')]);
    writeFileSync(join(dir, 'samples.json'), JSON.stringify({ pool: { populations: ['default', 'variant'] }, samples: [{ name: 'codebook', trial_ids: [] }, { name: 'gold', trial_ids: [...g, 'B'] }] }));
    const goldA = jsonl(join(dir, 'gold-a.jsonl'), [...g.map((id, i) => label(id, truth(i), true, 'anthropic:claude-opus-5-5')), label('B', 'did_not_look', true, 'anthropic:claude-opus-5-5')]);
    const goldB = jsonl(join(dir, 'gold-b.jsonl'), [...g.slice(0, o.astraLabels ?? n).map((id, i) => label(id, truth(i), true, 'openai:gpt-6-astra')), label('B', 'did_not_look', true, 'openai:gpt-6-astra')]);
    writeFileSync(labels, readFileSync(labels, 'utf8') + g.map((id, i) => JSON.stringify(label(id, o.candidateGood ? truth(i) : 'did_not_look', true))).join('\n') + '\n');
    const fallback = jsonl(join(dir, 'fallback.jsonl'), ['B', 'C', 'D', 'G', 'H', 'I', 'J', 'K'].map((id) => label(id, 'wrong_figure', true, 'openai:gpt-6.1-sol')));
    return { dir, labels, goldA, goldB, fallback };
  }

  test('a passing candidate: tables from its file, gold-sample trials included, and the layer-1 crosstab', () => {
    const c = goldCorpus({ candidateGood: true });
    const a = analyze({ corpus: c.dir, codebook: CODEBOOK, labels: c.labels, fallback: c.fallback, check: { goldA: c.goldA, goldB: c.goldB } });
    expect([a.E.status, a.E.layer2, a.tables.source, a.tables.gated]).toEqual(['passes', 'gated', 'candidate', true]);
    expect(a.E.fallback!.status).toBe('not_reached');
    // B is a gold-sample trial and counts from the same file as the rest: only J is missing.
    expect(a.label_status.default).toMatchObject({ verified: 4, missing: 1 });
    expect(rate(a.A.populations.default!.main.overall.classes, 'did_not_look')).toBeCloseTo(1 / 4, 12);
    expect(a.A.crosstab.default).toEqual({
      rows: ['forbidden_content', 'none', 'not in packet-index', 'read_not_found', 'source_not_read'],
      columns: ['did_not_look', 'unscoped_brain_search', 'grader_defect', 'unlabelled'],
      counts: { forbidden_content: { grader_defect: 1 }, none: { unscoped_brain_search: 1 }, 'not in packet-index': { unlabelled: 1 }, read_not_found: { did_not_look: 1 }, source_not_read: { did_not_look: 2, unlabelled: 1 } },
    });
    expect(a.A.crosstab.variant.counts).toEqual({ source_not_read: { did_not_look: 1 } });
    expect(renderMarkdown(a)).toContain('### Layer-1 primary label by layer-2 class, default, main');
    expect(a.E.retest_subsets!['particle:particle-1']).toHaveLength(41);
  });

  test('a failing candidate and a passing fallback: every table comes from the fallback labels', () => {
    const c = goldCorpus({ candidateGood: false });
    const a = analyze({ corpus: c.dir, codebook: CODEBOOK, labels: c.labels, fallback: c.fallback, check: { goldA: c.goldA, goldB: c.goldB } });
    expect([a.E.status, a.E.fallback!.status, a.E.layer2, a.tables.source, a.tables.file]).toEqual(['fails', 'passes', 'gated_fallback', 'fallback', 'fallback.jsonl']);
    const main = a.A.populations.default!.main.overall;
    // Every default failure is wrong_figure in the fallback: c1 3 of 4, c2 2 of 4, c3 2 of 2.
    expect(rate(main.classes, 'wrong_figure')).toBeCloseTo((3 / 4 + 2 / 4 + 1) / 3, 12);
    expect(rate(main.classes, 'did_not_look')).toBe(0);
    expect(a.B.pooled.main!.find((r) => r.class === 'wrong_figure')!.mean_brain).toBe(1);
    expect(a.verdicts.gbrain).toContain(FALLBACK_BASIS);
    expect(a.provenance.fallback!.models).toEqual({ 'openai:gpt-6.1-sol': 8 });
  });

  test('both fail: the tables come from the candidate, marked descriptive, and nothing says gated', () => {
    const c = goldCorpus({ candidateGood: false, sampleSize: 100, astraLabels: 40 });
    const a = analyze({ corpus: c.dir, codebook: CODEBOOK, labels: c.labels, fallback: c.fallback, check: { goldA: c.goldA, goldB: c.goldB } });
    expect([a.E.status, a.E.fallback!.status, a.E.layer2, a.tables.source, a.tables.gated]).toEqual(['fails', 'fails', 'descriptive', 'candidate', false]);
    expect(a.E.judge!.gold_labellers.agreement.n).toBe(101);
    expect(rate(a.A.populations.default!.main.overall.classes, 'did_not_look')).toBeCloseTo(1 / 4, 12);
    const md = renderMarkdown(a);
    expect(md).not.toMatch(/\bgated\b/i);
    expect(md).toContain('DESCRIPTIVE');
    expect(a.verdicts.gbrain).toBe('descriptive only (labeller check: fails)');
  });

  test('refuses a labels file that mixes labellers or does not match --codebook', () => {
    const c = goldCorpus({ candidateGood: true });
    const run = (labels: string, fallback?: string) => () => analyze({ corpus: c.dir, codebook: CODEBOOK, labels, fallback });
    const base = readFileSync(c.labels, 'utf8');
    const variant = (name: string, extra: unknown) => { const p = join(c.dir, name); writeFileSync(p, base + JSON.stringify(extra) + '\n'); return p; };
    expect(run(variant('two-models.jsonl', label('Z', 'did_not_look', true, 'openai:gpt-6-astra')))).toThrow('more than one model: openai:gpt-6-astra, particle:particle-1');
    expect(run(variant('other-codebook.jsonl', { ...label('Z', 'did_not_look', true), codebook_sha256: 'f'.repeat(64) }))).toThrow('more than one codebook_sha256');
    expect(run(variant('other-prefix.jsonl', { ...label('Z', 'did_not_look', true), prefix_sha256: 'other' }))).toThrow('model particle:particle-1 has more than one prefix_sha256');
    expect(run(variant('no-meta.jsonl', { trial_id: 'Z', status: 'ok', root_cause: 'did_not_look' }))).toThrow('line for Z has no model');
    const wrongCb = join(c.dir, 'wrong-cb.jsonl');
    jsonl(wrongCb, [{ ...label('B', 'did_not_look', true), codebook_sha256: 'e'.repeat(64) }]);
    expect(run(wrongCb)).toThrow('is not sha256(--codebook)');
    const fb = (name: string, ls: unknown[]) => jsonl(join(c.dir, name), ls);
    expect(run(c.labels, fb('same-family.jsonl', [label('B', 'wrong_figure', true, 'm1:labeller')]))).toThrow('the same family');
    expect(run(c.labels, fb('two-per-family.jsonl', [label('B', 'wrong_figure', true, 'openai:gpt-6.1-sol'), label('C', 'wrong_figure', true, 'openai:gpt-6-astra')]))).toThrow('labelled by both');
    expect(run(c.labels, fb('not-in-manifest.jsonl', [label('g0', 'wrong_figure', true, 'openai:gpt-6.1-sol')]))).toThrow('g0 is not in corpus/manifest.jsonl');
    const env = ENV;
    const r = Bun.spawnSync(['bun', SCRIPT, '--corpus', c.dir, '--codebook', CODEBOOK, '--labels', wrongCb, '--out', join(c.dir, 'refused')], { env });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain('refusing to build tables from it');
  });

  test('moving a brain-arm failure between retrieval classes moves the class rows, never retrieval_any', () => {
    const { dir, labels } = corpus();
    const moved = join(dir, 'moved.jsonl');
    writeFileSync(moved, readFileSync(labels, 'utf8').split('\n').map((l) => (l.includes('"trial_id":"D"') ? JSON.stringify({ ...JSON.parse(l), root_cause: 'unscoped_brain_search' }) : l)).join('\n'));
    const before = analyze({ corpus: dir, codebook: CODEBOOK, labels }).B.pooled.main!, after = analyze({ corpus: dir, codebook: CODEBOOK, labels: moved }).B.pooled.main!;
    const get = (rows: typeof before, id: string) => rows.find((r) => r.class === id)!;
    expect([get(before, 'did_not_look').delta, get(after, 'did_not_look').delta]).toEqual([0.25, 0]);
    const strip = ({ class: _, ...r }: (typeof before)[number]) => r;
    expect(strip(get(after, RETRIEVAL_ANY))).toEqual(strip(get(before, RETRIEVAL_ANY)));
  });
});

describe('Holm', () => {
  test('adjusts tested rows only, ranked by raw p', () => {
    const out = applyHolm([{ tested: true, p: 0.04 }, { tested: true, p: 0.01 }, { tested: false, p: 0.001 }, { tested: true, p: 0.03 }, { tested: true, p: null }]);
    expect(out.map((r) => r.holm_rank)).toEqual([3, 1, null, 2, null]);
    [0.06, 0.03, null, 0.06, null].forEach((x, i) => (x === null ? expect(out[i]!.p_holm).toBeNull() : expect(out[i]!.p_holm!).toBeCloseTo(x, 12)));
  });
});

describe('labeller check', () => {
  test('fewer than 40 gold items draws 100 more from the remaining pool with seed 2023', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-gold-'));
    const write = (name: string, ls: Array<Partial<LabelLine>>) => { const p = join(dir, name); writeFileSync(p, ls.map((l) => JSON.stringify(l)).join('\n') + '\n'); return p; };
    const g = (rc: string[]) => rc.map((r, i) => label(`g${i}`, r, true));
    const files = { goldA: write('a.jsonl', g(['did_not_look', 'grader_defect', 'wrong_figure'])), goldB: write('b.jsonl', g(['did_not_look', 'grader_defect', 'unscoped_brain_search'])) };
    const candidate = write('c.jsonl', g(['did_not_look', 'wrong_figure', 'wrong_figure']));
    const row = (trial_id: string, population = 'default', packet: string | null = 'sha') => ({ trial_id, population, harness: 'h1', model: 'm1', layer1_primary: 'p1', packet_sha256: packet });
    const pool = { index: [row('g0'), row('g1'), row('g2'), row('p3'), row('p4', 'variant'), row('p5', 'uncounted'), row('p6', 'default', null), row('p7')], samples: { pool: { populations: ['default', 'variant'] }, samples: [{ trial_ids: ['g0', 'g1'] }, { trial_ids: ['g2'] }] } };
    const classes = ['did_not_look', 'unscoped_brain_search', 'wrong_figure', 'grader_defect', 'other', 'unlabelled'];
    const e = labellerCheck(files, candidate, undefined, classes, pool);
    expect(e.status).toBe('insufficient_gold');
    expect(e.judge!.gold.n).toBe(2);
    expect(e.layer2).toBe('pending');
    expect(e.extra_gold_draw).toEqual(['p3', 'p4', 'p7']);
    expect(e.step_agreement!.candidate_vs_gold_a_on_gold.n).toBe(2);
    expect(labellerCheck(files, candidate, undefined, classes, pool)).toEqual(e);
    expect(labellerCheck({}, candidate, undefined, classes, pool).status).toBe('not_checked');
    expect(e.tables).toEqual({ source: 'candidate', gated: false });
  });

  test('a passing candidate gates layer 2; a failing one hands the tables to a fallback gated on the frontier labellers agreeing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-gate-'));
    const write = (name: string, rc: (i: number) => string | null, n = 40) => { const p = join(dir, name); writeFileSync(p, Array.from({ length: n }, (_, i) => rc(i)).flatMap((c, i) => (c ? [JSON.stringify(label(`t${i}`, c, true))] : [])).join('\n') + '\n'); return p; };
    const truth = (i: number) => ['did_not_look', 'wrong_figure', 'grader_defect', 'unscoped_brain_search'][i % 4]!;
    const goldA = write('a.jsonl', truth), goldB = write('b.jsonl', truth);
    const classes = ['did_not_look', 'unscoped_brain_search', 'wrong_figure', 'grader_defect'];
    const good = labellerCheck({ goldA, goldB }, write('good.jsonl', truth), undefined, classes, null);
    expect([good.layer2, good.tables]).toEqual(['gated', { source: 'candidate', gated: true }]);
    const bad = write('bad.jsonl', () => 'did_not_look');
    expect(labellerCheck({ goldA, goldB }, bad, undefined, classes, null).layer2).toBe('pending');
    // The fallback's own labels are never scored against gold: a fallback file that is wrong everywhere still passes when the frontier labellers agree.
    const fb = labellerCheck({ goldA, goldB }, bad, bad, classes, null);
    expect([fb.status, fb.fallback!.status, fb.fallback!.kappa, fb.fallback!.basis, fb.layer2, fb.tables]).toEqual(['fails', 'passes', 1, FALLBACK_BASIS, 'gated_fallback', { source: 'fallback', gated: true }]);
    // 40 gold items, but Astra missed 60 more trials of a 100-trial gold sample: kappa over the sample is under 0.6.
    const goldA100 = write('a100.jsonl', truth, 100), goldB40 = write('b40.jsonl', (i) => (i < 40 ? truth(i) : null), 100);
    const pool = { index: [{ trial_id: 'x', population: 'default', harness: 'h', model: 'm', layer1_primary: null, packet_sha256: 's' }], samples: { pool: { populations: ['default'] }, samples: [{ name: 'gold', trial_ids: Array.from({ length: 100 }, (_, i) => `t${i}`) }] } };
    const both = labellerCheck({ goldA: goldA100, goldB: goldB40 }, bad, bad, classes, pool);
    expect(both.judge!.gold.n).toBe(40);
    expect([both.status, both.fallback!.status, both.fallback!.n, both.layer2, both.tables]).toEqual(['fails', 'fails', 100, 'descriptive', { source: 'candidate', gated: false }]);
    expect(both.fallback!.kappa!).toBeLessThan(0.6);
    expect(labellerCheck({ goldA, goldB }, write('good2.jsonl', truth), bad, classes, null).fallback!.status).toBe('not_reached');
  });

  test('retest subsets: a seed-2024 shuffle of the gold sample, the first 100 for particle-1 and the first 40 for Opus', () => {
    expect(SEEDS.retest).toBe(2024);
    const gold = Array.from({ length: 200 }, (_, i) => `trial-${String(i).padStart(3, '0')}`);
    const s = retestSubsets([...gold].reverse());
    expect(s).toEqual(retestSubsets(gold));
    expect([s['particle:particle-1'].length, s['anthropic:claude-opus-5-5'].length]).toEqual([100, 40]);
    expect(s['anthropic:claude-opus-5-5']).toEqual(s['particle:particle-1'].slice(0, 40));
    expect(new Set(s['particle:particle-1']).size).toBe(100);
    expect(s['particle:particle-1'].every((id) => gold.includes(id))).toBe(true);
    expect(s['particle:particle-1']).not.toEqual(gold.slice(0, 100));
    const real = JSON.parse(readFileSync(join(REAL_CORPUS, 'samples.json'), 'utf8')).samples.find((x: { name: string }) => x.name === 'gold').trial_ids as string[];
    const printed = Bun.spawnSync(['bun', SCRIPT, '--retest-ids', '--corpus', REAL_CORPUS], { env: ENV }).stdout.toString().trim().split('\n').map((l) => l.split('\t'));
    const want = retestSubsets(real);
    expect(printed).toEqual([...want['particle:particle-1'].map((id) => ['particle:particle-1', id]), ...want['anthropic:claude-opus-5-5'].map((id) => ['anthropic:claude-opus-5-5', id])]);
  });
});

test('the pair runs are the four the spec names', () => {
  expect([...PAIR_RUNS]).toEqual(['2026-10-31-v03-opus-dev', '2026-11-01-installer-cc-codex', '2026-11-03-qm-c4-told-live', '2026-11-06-harness-zero-h2h']);
});
