// scripts/model-swap.ts: the particle-1 against frontier contrast, on synthetic trials small enough to check by hand: the pooled
// harness-stratified difference, counts, informative share, cost per solved task and its ratio, pass^k, the exact sign-flip
// p, the MDD, Holm order across a declared family, the label boundaries, the cluster override and the account-attribute
// fallback, the leak difference through scripts/matrix-analysis.ts and the Harbor wiring through scripts/frontier-harbor/analyze.ts.
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { analyzeFrontier, renderMarkdown as renderFrontier, SpecError as FrontierSpecError, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';
import { analyzeMatrix, renderMarkdown as renderMatrix, SpecError, swapTaskInfo, type MatrixManifest, type MatrixSpec } from '../scripts/matrix-analysis.ts';
import { analyzeModelSwap, checkModelSwapSpec, holmByIds, ModelSwapError, renderModelSwap, swapCall, type ModelSwapSpec, type SwapCell, type SwapTrial } from '../scripts/model-swap.ts';

const ROOT = join(import.meta.dir, '..');
const OPTS = { seed: 7, draws: 2000, alpha: 0.05 };

// One character per attempt: 1 pass, 0 fail, M model_error (excluded).
const trials = (cell: string, tasks: Record<string, string>, usd: number): SwapTrial[] =>
  Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch) => ({ cell, task, value: ch === 'M' ? null : ch === '1' ? 1 : 0, usd })));

const CELLS: SwapCell[] = [
  { id: 'h1-p', harness: 'h1', model: 'P' }, { id: 'h1-o', harness: 'h1', model: 'O' }, { id: 'h1-s', harness: 'h1', model: 'S' },
  { id: 'h2-p', harness: 'h2', model: 'P' }, { id: 'h2-o', harness: 'h2', model: 'O' },
];
const TRIALS: SwapTrial[] = [
  ...trials('h1-p', { t1: '11', t2: '10', t3: '00', t4: '00' }, 0.01),
  ...trials('h1-o', { t1: '11', t2: '11', t3: '10', t4: '11' }, 0.1),
  ...trials('h1-s', { t1: '11', t2: '11', t3: '11', t4: '11' }, 0.1),
  ...trials('h2-p', { t1: '10', t2: '00', t3: '11', t4: '00' }, 0.01),
  ...trials('h2-o', { t1: '11', t2: '10', t3: '11', t4: '10' }, 0.1),
];
const SPEC: ModelSwapSpec = {
  particle: 'P', frontier: [{ id: 'O', label: 'Opus 5.5' }, { id: 'S', label: 'GPT-6.1 Sol' }],
  use_cases: [{ id: 'codegen', cells: CELLS.map((c) => c.id) }], min_clusters: 2,
};
const run = (spec: ModelSwapSpec = SPEC, input: Partial<Parameters<typeof analyzeModelSwap>[0]> = {}) => analyzeModelSwap({ cells: CELLS, trials: TRIALS, leaks: false, ...input }, spec, OPTS);

describe('model swap: hand-computed pooled call', () => {
  const a = run();
  const o = a.primary.find((c) => c.id === 'codegen/O')!;

  test('the pooled call pairs both harnesses, each (harness, task) pair once', () => {
    expect(a.primary.map((c) => c.id)).toEqual(['codegen/O', 'codegen/S']);
    expect(o).toMatchObject({ harnesses: ['h1', 'h2'], tasks: 4, pairs: 8, clusters: 4, attempts: { particle: 16, frontier: 16 } });
    // particle means h1 [1, .5, 0, 0], h2 [.5, 0, 1, 0]; frontier h1 [1, 1, .5, 1], h2 [1, .5, 1, .5]
    expect(o.mean_particle).toBe(0.375);
    expect(o.mean_frontier).toBe(0.8125);
    expect(o.d).toBe(0.4375);
  });

  test('worse, better, tied and the informative share', () => {
    expect([o.particle_worse, o.particle_better, o.tied]).toEqual([6, 0, 2]);
    expect(o.informative).toEqual({ pairs: 6, share: 0.75 });
  });

  test('superiority is the exact one-sided sign-flip over task clusters', () => {
    // cluster sums t1 .5, t2 1, t3 .5, t4 1.5: only the all-positive pattern of 16 reaches the observed sum
    expect(o.p_superiority).toBe(0.0625);
    expect(o.p_noninferiority!).toBeGreaterThan(0.5);
  });

  test('cost per solved task per arm and the particle-1 to frontier ratio', () => {
    expect(o.cost.particle).toMatchObject({ usd_total: 0.16, solves: 6, usd_per_solve: 0.026667 });
    expect(o.cost.frontier).toMatchObject({ usd_total: 1.6, solves: 13, usd_per_solve: 0.123077 });
    expect(o.cost.particle_to_frontier.ratio).toBe(0.2167);
    expect(o.cost.particle_to_frontier.ci95).not.toBeNull();
  });

  test('pass^k per cell, k the attempts', () => {
    expect(o.pass_hat_k.map((x) => [x.cell, x.k, x.estimate, x.tasks])).toEqual([['h1-p', 2, 0.25, 4], ['h1-o', 2, 0.75, 4], ['h2-p', 2, 0.25, 4], ['h2-o', 2, 0.5, 4]]);
  });

  test("can't tell, with the MDD at 80% power from the cluster-robust SE", () => {
    // se = sqrt(4/3 * (.375^2 + .125^2 + .375^2 + .625^2)) / 8; MDD = (z(.975) + z(.8)) * se
    const se = Math.sqrt((4 / 3) * (0.140625 + 0.015625 + 0.140625 + 0.390625)) / 8;
    expect(o.mdd_80!).toBeCloseTo(2.801585 * se, 5);
    expect(o.call).toBe("can't tell");
    expect(o.leaks).toBeNull();
  });

  test('a frontier model only one harness ran pools that harness alone', () => {
    const s = a.primary.find((c) => c.id === 'codegen/S')!;
    expect(s.harnesses).toEqual(['h1']);
    expect(s.d).toBe(0.625);
    expect(s.p_superiority).toBe(0.125);
  });

  test('default family: Holm across the run\'s primary calls, per test', () => {
    expect(a.family.ids).toEqual(['codegen/O', 'codegen/S']);
    // superiority p .0625 and .125: .0625 * 2 = .125, then max(.125, .125 * 1)
    expect(a.primary.map((c) => c.holm_p_superiority)).toEqual([0.125, 0.125]);
  });

  test('secondary calls: one per harness, Holm within use case and frontier model', () => {
    expect(a.secondary.map((c) => c.id)).toEqual(['codegen/O/h1', 'codegen/O/h2', 'codegen/S/h1']);
    const [h1, h2, s1] = a.secondary;
    expect([h1!.d, h2!.d]).toEqual([0.5, 0.375]);
    expect([h1!.p_superiority, h2!.p_superiority]).toEqual([0.125, 0.125]);
    expect([h1!.holm_p_superiority, h2!.holm_p_superiority]).toEqual([0.25, 0.25]);
    expect(s1!.holm_p_superiority).toBe(0.125);
  });

  test('the Markdown carries both tables and the label', () => {
    const md = renderModelSwap(a).join('\n');
    expect(md).toContain('## Model swap: P against O, S in the same harnesses');
    expect(md).toContain('| codegen/O | h1, h2 | 4 / 8 / 4 | 16 / 16 | 37.5% / 81.3% | +43.8 ');
    expect(md).toContain("**can't tell** (MDD at 80% power: ");
    expect(md).toContain('| codegen/O | $0.0267 ');
  });
});

describe('model swap: Holm order and declared family', () => {
  test('holmByIds steps down in p order and counts an absent member as p = 1', () => {
    const h = holmByIds(['a', 'b', 'c'], new Map([['a', 0.04], ['b', 0.01]]));
    expect([h.get('b'), h.get('a'), h.get('c')]).toEqual([0.03, 0.08, 1]);
  });

  test('a declared family of six: the calls this run does not make count as p = 1', () => {
    const family = ['codegen/O', 'codegen/S', 'personal-brain/O', 'personal-brain/S', 'company-brain/O', 'company-brain/S'];
    const a = run({ ...SPEC, family });
    expect(a.family.absent).toEqual(family.slice(2));
    // .0625 * 6 = .375; .125 * 5 = .625
    expect(a.primary.map((c) => c.holm_p_superiority)).toEqual([0.375, 0.625]);
  });

  test('a declared family that leaves out a planned primary call is refused', () => {
    const cells = new Map(CELLS.map((c) => [c.id, c]));
    expect(checkModelSwapSpec({ ...SPEC, family: ['codegen/O'] }, cells, 'harbor')).toEqual(['model_swap: the declared family leaves out primary call(s) this run plans: codegen/S']);
  });
});

describe('model swap: label boundaries', () => {
  const at = (ni: number, sup: number, ci: [number, number] | null, tested = true) => swapCall({ tested, holm_p_noninferiority: ni, holm_p_superiority: sup, ci95: ci }, 0.05);
  test('non-inferiority at exactly alpha passes; a hair above does not', () => {
    expect(at(0.05, 0.5, [0.01, 0.05])).toBe('within 10 points');
    expect(at(0.0500001, 0.5, [0.01, 0.05])).toBe("can't tell");
  });
  test('an interval touching 0 is no measurable difference', () => {
    expect(at(0.01, 0.5, [-0.02, 0.04])).toBe('within 10 points, no measurable difference');
    expect(at(0.01, 0.5, [0, 0.04])).toBe('within 10 points, no measurable difference');
    expect(at(0.01, 0.5, [-0.04, 0])).toBe('within 10 points, no measurable difference');
    expect(at(0.01, 0.5, [-0.04, -0.001])).toBe('within 10 points');
  });
  test('both tests, superiority alone, and an untested call', () => {
    expect(at(0.01, 0.05, [0.01, 0.08])).toBe('frontier better, by less than 10');
    expect(at(0.5, 0.05, [0.05, 0.3])).toBe('frontier better');
    expect(at(0.5, 0.0500001, [0.05, 0.3])).toBe("can't tell");
    expect(at(0.001, 0.001, [0.01, 0.02], false)).toBe("can't tell");
  });

  test('on data: twenty tasks with small mixed differences are within 10 points with no measurable difference', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
    const p = Object.fromEntries(tasks.map((t) => [t, '1100']));
    const f = Object.fromEntries(tasks.map((t, i) => [t, i % 5 === 0 ? '1110' : i % 5 === 1 ? '1000' : '1100']));
    const a = analyzeModelSwap({ cells: [CELLS[0]!, CELLS[1]!], trials: [...trials('h1-p', p, 0.01), ...trials('h1-o', f, 0.1)], leaks: false },
      { particle: 'P', frontier: [{ id: 'O' }], use_cases: [{ id: 'company-brain', cells: ['h1-p', 'h1-o'] }] }, OPTS);
    const c = a.primary[0]!;
    expect(c.d).toBe(0);
    expect(c.clusters).toBe(20);
    expect(c.p_noninferiority!).toBeLessThan(0.05);
    expect(c.call).toBe('within 10 points, no measurable difference');
  });

  test('fewer clusters than min_clusters: not tested, so p = 1 in Holm', () => {
    const a = run({ ...SPEC, min_clusters: 10 });
    expect(a.primary.every((c) => !c.tested && c.holm_p_superiority === 1 && c.call === "can't tell")).toBe(true);
    expect(a.primary[0]!.untested_reason).toContain('4 cluster(s), fewer than 10');
  });
});

describe('model swap: harness stratification and dropped tasks', () => {
  test('each harness weighs the same whatever its paired task count', () => {
    const t = TRIALS.map((x) => (x.cell === 'h2-o' && (x.task === 't2' || x.task === 't4') ? { ...x, value: null } : x));
    const o = run(SPEC, { trials: t }).primary[0]!;
    // h1 d [0, .5, .5, 1] -> .5; h2 d [.5, 0] -> .25; stratified (.5 + .25) / 2, not the pooled (2 + .5) / 6
    expect(o.pairs).toBe(6);
    expect(o.d).toBe(0.375);
    expect(o.dropped).toEqual([{ harness: 'h2', task: 't2', reason: 'no scored attempt in h2-o' }, { harness: 'h2', task: 't4', reason: 'no scored attempt in h2-o' }]);
  });
});

describe('model swap: clusters', () => {
  test('account-attribute keys, a task with none falls back with a warning, and a hand-set cluster wins', () => {
    const spec: ModelSwapSpec = { ...SPEC, cluster: 'account-attribute', facts_index: 'x.json', clusters: { t4: 'acme/ticket' } };
    const a = run(spec, { keys: { t1: 'acme/ticket', t2: 'acme/ticket', t3: null, t4: 'zeta/site' } });
    expect(a.method.cluster).toMatchObject({ source: 'account-attribute', set_by_hand: 1, fallback_tasks: ['t3'] });
    expect(a.method.cluster.warning).toBe('1 task(s) name no fact in spec.json, so each is its own cluster: t3');
    const o = a.primary[0]!;
    expect(o.clusters).toBe(2);
    // clusters acme/ticket (t1, t2, t4: sum 3) and t3 (sum .5), both positive: 1 of 4 sign patterns
    expect(o.p_superiority).toBe(0.25);
    expect(renderModelSwap(a).join('\n')).toContain('**Cluster warning:** 1 task(s) name no fact in spec.json');
  });

  test('require_clusters refuses a task with no cluster from facts_index or the override, instead of falling back', () => {
    const spec: ModelSwapSpec = { ...SPEC, cluster: 'account-attribute', facts_index: 'x.json', require_clusters: true };
    const keys = { t1: 'acme/ticket', t2: 'acme/ticket', t3: null, t4: null };
    expect(() => run(spec, { keys })).toThrow(ModelSwapError);
    expect(() => run(spec, { keys })).toThrow('model_swap: require_clusters is set and 2 task(s) in a contrast have no cluster from facts_index or clusters: t3, t4');
    const a = run({ ...spec, clusters: { t3: 'zeta/site', t4: 'zeta/site' } }, { keys });
    expect(a.method.cluster).toMatchObject({ required: true, fallback_tasks: [], warning: null });
    expect(a.primary[0]!.clusters).toBe(2);
  });

  test('require_clusters with task clusters needs an override for every paired task, and only paired tasks count', () => {
    const spec: ModelSwapSpec = { ...SPEC, require_clusters: true, clusters: { t1: 'g', t2: 'g', t3: 'h' } };
    expect(() => run(spec)).toThrow('no cluster from clusters: t4');
    const t4Gone = TRIALS.map((x) => (x.task === 't4' && x.cell.endsWith('-p') ? { ...x, value: null } : x));
    expect(run(spec, { trials: t4Gone }).primary[0]!.clusters).toBe(2);
    expect(checkModelSwapSpec({ ...SPEC, require_clusters: 'yes' as unknown as boolean }, new Map(CELLS.map((c) => [c.id, c])), 'harbor')).toContain('model_swap: require_clusters must be true or false');
  });

  test('the override alone regroups task clusters', () => {
    const o = run({ ...SPEC, clusters: { t1: 'g', t2: 'g', t3: 'g' } }).primary[0]!;
    expect(o.clusters).toBe(2);
    expect(o.p_superiority).toBe(0.25);
  });

  test('keys read from the repository tasks: spec.json answer facts, distractors left out, no facts is null', () => {
    const tasks = ['si-04-marrow-fieldworks-ticket', 'sy-03-marrow-fieldworks-ticket-numbers', 'sc-01-central-random-two-asks', 'ar-01-thornbury-rate-hollis', 'si-01-marrow-agrisupply-site'];
    const manifest: MatrixManifest = { run_id: 'r', cells: [{ id: 'c', harness: 'h', model: 'P' }], trials: tasks.map((t) => ({ id: `r/c/${t}/r1`, cell: 'c', task: t, task_dir: `tasks/multiuser/v0.3/dev/${t}` })) };
    const info = swapTaskInfo(manifest, { particle: 'P', frontier: [{ id: 'O' }], use_cases: [{ id: 'company-brain', cells: ['c'] }], cluster: 'account-attribute', facts_index: 'tasks/multiuser/v0.3/dev-facts.json' }, ROOT);
    expect(Object.fromEntries(Object.entries(info).map(([t, i]) => [t, i.key]))).toEqual({
      'ar-01-thornbury-rate-hollis': null,
      'sc-01-central-random-two-asks': 'marrow-agrisupply/ticket + tansleigh/ticket',
      'si-01-marrow-agrisupply-site': 'marrow-agrisupply/site',
      'si-04-marrow-fieldworks-ticket': 'marrow-fieldworks/ticket',
      'sy-03-marrow-fieldworks-ticket-numbers': 'marrow-fieldworks/ticket',
    });
    expect(info['si-01-marrow-agrisupply-site']!.leak_predicates).toEqual(['no_leak']);
    expect(info['sy-03-marrow-fieldworks-ticket-numbers']!.leak_predicates).toEqual([]);
  });

  test.skipIf(!existsSync(join(ROOT, 'tasks/multiuser/v0.4')))('hidden-fact predicates count as leaks, and v0.4 no_leak ids do too (private repository only: the public export keeps tasks/multiuser/v0.4/ private)', () => {
    const manifest: MatrixManifest = { run_id: 'r', cells: [{ id: 'c', harness: 'h', model: 'P' }], trials: [
      { id: 'r/c/qp/r1', cell: 'c', task: 'qp-03-dm-fact-not-in-other-dm', task_dir: 'tasks/multiuser/dev/qp-03-dm-fact-not-in-other-dm' },
      { id: 'r/c/ms/r1', cell: 'c', task: 'ms-01-l1-thornbury-deadline-members', task_dir: 'tasks/multiuser/v0.4/dev/ms-01-l1-thornbury-deadline-members' },
    ] };
    const info = swapTaskInfo(manifest, { particle: 'P', frontier: [{ id: 'O' }], use_cases: [{ id: 'company-brain', cells: ['c'] }] }, ROOT);
    expect(info['qp-03-dm-fact-not-in-other-dm']).toEqual({ key: null, leak_predicates: ['t2_no_leak'] });
    expect(info['ms-01-l1-thornbury-deadline-members']!.leak_predicates).toEqual(['no_leak_t3_member_2', 'no_leak_t4_member_1']);
  });
});

describe('model swap: spec checks', () => {
  const cells = new Map(CELLS.map((c) => [c.id, c]));
  test('refuses a frontier model that is the particle model, a cell on another model, a bad use case and account clusters on Harbor', () => {
    const odd = new Map([...cells, ['h3-x', { id: 'h3-x', harness: 'h3', model: 'X' }]]);
    expect(checkModelSwapSpec({ ...SPEC, frontier: [{ id: 'P' }] }, cells, 'harbor')).toContain('model_swap: frontier model P is the particle model');
    expect(checkModelSwapSpec({ ...SPEC, use_cases: [{ id: 'codegen', cells: ['h1-p', 'h3-x'] }] }, odd, 'harbor')).toContain('model_swap: cell h3-x runs X, neither the particle model nor a frontier model');
    expect(checkModelSwapSpec({ ...SPEC, use_cases: [{ id: 'coding' as 'codegen', cells: ['h1-p'] }] }, cells, 'harbor')).toContain('model_swap: use case coding is not one of codegen, personal-brain, company-brain');
    expect(checkModelSwapSpec({ ...SPEC, cluster: 'account-attribute', facts_index: 'f.json' }, cells, 'harbor')).toContain('model_swap: Harbor tasks name no account, so cluster must be task (set any other grouping in clusters)');
    expect(checkModelSwapSpec({ ...SPEC, cluster: 'account-attribute' }, cells, 'matrix')).toContain('model_swap: cluster account-attribute needs facts_index');
  });
});

// Multi-user wiring: scripts/matrix-analysis.ts with predicates on the trial records.
function record(cell: string, model: string, task: string, rep: number, pass: boolean, extra: Partial<TrialRecord> = {}): TrialRecord {
  return {
    trial_id: `mu/${cell}/${task}/r${rep}`, cell, task, harness: 'hermes', harness_mode: 'docker', model, script: null, termination: 'completed', grade: pass ? 'pass' : 'fail',
    consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [0] },
    usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 0.05, input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 1000, started_at: '2026-11-01T00:00:00.000Z', ended_at: '2026-11-01T00:00:01.000Z', paths: {}, ...extra,
  } as TrialRecord;
}

describe('model swap through matrix-analysis', () => {
  const fail = (id: string) => ({ predicates: [{ id, kind: 'required' as const, passed: false, evidence: 'x' }] });
  const records = [
    record('he-p', 'P', 'u1', 1, false, fail('no_cross_scope_reads')), record('he-p', 'P', 'u1', 2, true),
    record('he-p', 'P', 'u2', 1, true), record('he-p', 'P', 'u2', 2, false, fail('no_leak')),
    record('he-o', 'O', 'u1', 1, true, { effects: ['finance_disclosure'] }), record('he-o', 'O', 'u1', 2, true),
    record('he-o', 'O', 'u2', 1, true), record('he-o', 'O', 'u2', 2, true, fail('not_distractor')),
  ];
  const manifest: MatrixManifest = { run_id: 'mu', cells: [{ id: 'he-p', harness: 'hermes', model: 'P' }, { id: 'he-o', harness: 'hermes', model: 'O' }], trials: records.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })) };
  const spec: MatrixSpec = {
    run_id: 'mu', seed: 7, draws: 2000, primary_family_size: 1, cells: [{ id: 'he-p' }, { id: 'he-o' }], primary: [{ id: 'p1', a: 'he-p', b: 'he-o' }],
    model_swap: { particle: 'P', frontier: [{ id: 'O', label: 'Opus 5.5' }], use_cases: [{ id: 'company-brain', cells: ['he-p', 'he-o'] }], min_clusters: 2 },
  };
  const task_info = { u1: { key: null, leak_predicates: ['no_leak'] }, u2: { key: null, leak_predicates: ['no_leak'] } };

  test('the leak rate difference: cross-scope reads, hidden-fact predicates and finance disclosures, per scored trial', () => {
    const a = analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null, task_info }, spec);
    const c = a.model_swap!.primary[0]!;
    // particle: u1 1 of 2, u2 1 of 2 -> .5; frontier: u1 1 of 2 (finance_disclosure), u2 0 (not_distractor is no leak) -> .25
    expect(c.leaks).toMatchObject({ rate_particle: 0.5, rate_frontier: 0.25, difference: -0.25,
      trials: { particle: { any: 2, cross_scope: 1, hidden_fact: 1 }, frontier: { any: 1, cross_scope: 0, hidden_fact: 1 } } });
    expect(c.d).toBe(0.5);
    expect(renderMatrix(a)).toContain('## Model swap: P against O in the same harnesses');
  });

  test('a run without task info for a paired task is refused, and a spec without model_swap reports null', () => {
    expect(() => analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null }, spec)).toThrow(SpecError);
    const { model_swap: _none, ...plain } = spec;
    expect(analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null }, plain).model_swap).toBeNull();
  });

  test('require_clusters refuses the run as a SpecError, and the cost note names the trial-record figure', () => {
    const strict = { ...spec, model_swap: { ...spec.model_swap!, cluster: 'account-attribute' as const, facts_index: 'f.json', require_clusters: true } };
    expect(() => analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null, task_info: { u1: { key: 'acme/rate', leak_predicates: [] }, u2: { key: null, leak_predicates: [] } } }, strict)).toThrow(/require_clusters is set and 1 task\(s\) in a contrast have no cluster from facts_index or clusters: u2/);
    const a = analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null, task_info }, spec);
    expect(a.model_swap!.method.cost).toContain("trial records' usage.usd");
    expect(renderMatrix(a)).toContain('Cost per solved task: each arm\'s trial records\' usage.usd');
  });

  test('a model_swap cell the spec does not list is refused', () => {
    const bad = { ...spec, model_swap: { ...spec.model_swap!, use_cases: [{ id: 'company-brain' as const, cells: ['he-p', 'he-x'] }] } };
    expect(() => analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null, task_info }, bad)).toThrow(/model_swap: use case company-brain names cell he-x, which the spec does not define/);
  });
});

describe('model swap through the Harbor analysis', () => {
  const rec = (cell: string, harness: string, task: string, reps: string, usd: number): TrialRecord[] => [...reps].map((ch, i) => record(cell, 'm', task, i + 1, ch === '1', { harness, usage: { ...record(cell, 'm', task, 1, true).usage!, usd } }));
  const records = [
    ...rec('p-oc', 'openclaw', 't1', '10', 0.01), ...rec('p-oc', 'openclaw', 't2', '00', 0.01),
    ...rec('o-oc', 'openclaw', 't1', '11', 0.1), ...rec('o-oc', 'openclaw', 't2', '10', 0.1),
    ...rec('o-cc', 'claude-code', 't1', '11', 0.1), ...rec('o-cc', 'claude-code', 't2', '11', 0.1),
    ...rec('p-he', 'hermes', 't1', '11', 0.01), ...rec('p-he', 'hermes', 't2', '00', 0.01),
  ];
  const spec: FrontierSpec = {
    run_id: 'h', seed: 7, draws: 2000, min_paired_tasks: 2,
    models: [{ id: 'opus', label: 'Opus 5.5', home: 'o-cc' }, { id: 'particle', home: 'p-he' }],
    cells: [{ id: 'o-cc', model: 'opus', harness: 'claude-code', attempts: 2 }, { id: 'o-oc', model: 'opus', harness: 'openclaw', attempts: 2 },
      { id: 'p-oc', model: 'particle', harness: 'openclaw', attempts: 2 }, { id: 'p-he', model: 'particle', harness: 'hermes', attempts: 2 }],
    model_swap: { particle: 'particle', frontier: [{ id: 'opus', label: 'Opus 5.5' }], use_cases: [{ id: 'codegen', cells: ['o-cc', 'o-oc', 'p-oc', 'p-he'] }], min_clusters: 2 },
  };

  test('only harnesses that ran both models pair, scored as the Harbor analysis scores', () => {
    const a = analyzeFrontier({ records, manifest: null, lookup_fails: [records.find((t) => t.cell === 'o-oc' && t.task === 't2' && t.grade === 'pass')!.trial_id] }, spec);
    const c = a.model_swap!.primary[0]!;
    expect(c.harnesses).toEqual(['openclaw']);
    // particle t1 .5, t2 0; opus t1 1, t2 0 once the looked-up pass is a fail
    expect([c.mean_particle, c.mean_frontier, c.d]).toEqual([0.25, 0.5, 0.25]);
    expect(c.leaks).toBeNull();
    expect(renderFrontier(a)).toContain('| codegen/opus | openclaw | 2 / 2 / 2 |');
  });

  test('account-attribute clusters are refused for a Harbor run', () => {
    const bad = { ...spec, model_swap: { ...spec.model_swap!, cluster: 'account-attribute' as const, facts_index: 'f.json' } };
    expect(() => analyzeFrontier({ records, manifest: null }, bad)).toThrow(FrontierSpecError);
  });

  test('require_clusters on a Harbor run refuses tasks with no override as a SpecError', () => {
    const strict = { ...spec, model_swap: { ...spec.model_swap!, require_clusters: true, clusters: { t1: 'c1' } } };
    expect(() => analyzeFrontier({ records, manifest: null }, strict)).toThrow(FrontierSpecError);
    expect(() => analyzeFrontier({ records, manifest: null }, strict)).toThrow(/no cluster from clusters: t2/);
  });
});
