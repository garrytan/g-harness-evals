// internal-task: the owner-identity analysis (scripts/owner-identity/analyze.ts) and its rate statistics
// (runner/stats/clustered-rate.ts) on hand-built verdict fixtures, the analysis config and claim checks a sealed preregistration
// needs, and row P's input modes. Keyless: no docker, no model call, no custody.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clusteredRate, wilson } from '../runner/stats/clustered-rate.ts';
import { analyze, analysisConfigProblems, markdown, parseMargin, type AnalysisConfig, type OITrial, type PTry } from '../scripts/owner-identity/analyze.ts';
import { claimProblems } from '../runner/heldout/openings.ts';
import { entryPair } from '../scripts/sealed/export.ts';
import { rowPInput } from '../scripts/owner-identity/row-p.ts';
import type { Gold, Verdicts } from '../runner/grade/owner-identity.ts';

const ROOT = resolve(import.meta.dir, '..');
const M = 'anthropic:claude-opus-5-5';
const TASKS = ['t1', 't2', 't3', 't4', 't5', 't6'];

interface F { id: string; primary: 'false_owner' | 'owner_recall' | 'secondary'; hard_case: string; fo?: boolean; recall?: boolean; sources?: string[] }
const fv = (f: F) => ({ id: f.id, token: f.id, primary: f.primary, hard_case: f.hard_case, claimant: 'c', text: '', owner_hit: !!f.recall, false_owner_hit: !!f.fo, correctly_reported: false,
  on_claimant_page: false, on_wrong_person_page: false, unattributed_visible: false, token_anywhere: true, attributed_to_seen: [], filed_as_user: false, owner_sources: f.fo ? (f.sources ?? ['model_write']) : [], occurrences: [] });
const verdicts = (task: string, family: 'I' | 'L' | 'C', arm: string, facts: F[]) => ({ schema_version: 1, task, family, source: 's', arm, store_kind: 'gbrain', owner: 'o', owner_slugs: [], facts: facts.map(fv), summary: {}, answers: null }) as unknown as Verdicts;
const gold = (task: string, cue: string): Gold => ({ task, family: 'I', source: 's', formats: [], hard_cases: [], questions: [],
  facts: [{ id: 'f2', cue } as unknown as Gold['facts'][number]] });
/** Per task: f1 another person's fact (group_chat), f2 a recorder-label fact, f3 the owner's own (owner_aliases). */
const facts = (o: { f1?: boolean; f2?: boolean; f2Sources?: string[]; recall?: boolean }): F[] => [
  { id: 'f1', primary: 'false_owner', hard_case: 'group_chat', fo: o.f1 },
  { id: 'f2', primary: 'false_owner', hard_case: 'recorder_label_absorbs', fo: o.f2, ...(o.f2Sources ? { sources: o.f2Sources } : {}) },
  { id: 'f3', primary: 'owner_recall', hard_case: 'owner_aliases', recall: o.recall ?? true },
];
const trial = (cell: string, harness: string, arm: string, task: string, fs: F[], extra: Partial<OITrial> = {}): OITrial => ({
  trial_id: `run/${cell}/${task}/r1`, cell, task, harness, model: M, arm, termination: 'completed', dropped_jobs: 0, timed_out_jobs: 0,
  verdicts: verdicts(task, 'I', arm, fs), capture: null, gold: gold(task, ['t1', 't2', 't3'].includes(task) ? 'clear' : 'weak'), plan: null, ...extra });
const config: AnalysisConfig = { seed: 3, draws: 2000, sdd: { g_vs_n_harness: 0.11, g_vs_n_pooled: 0.06, b_vs_g_harness: 0.11, b_vs_g_pooled: 0.06, p_vs_g: 0.07, harness_vs_harness: 0.13 }, p_vs_g: { model: M, margin: 0.1 } };

function fixture(): { trials: OITrial[]; p: PTry[] } {
  const trials = [
    ...TASKS.map((t) => trial('n-h1', 'h1', 'N', t, facts({}))),
    ...TASKS.map((t) => trial('n-h2', 'h2', 'N', t, facts({}))),
    ...TASKS.map((t) => trial('g-h1', 'h1', 'G', t, facts({ f1: true }), t === 't1' ? { dropped_jobs: 2 } : {})),
    ...TASKS.map((t) => trial('g-h2', 'h2', 'G', t, facts({ f2: true, f2Sources: ['hook'] }))),
    ...TASKS.map((t) => trial('b-h1', 'h1', 'B', t, facts({ f1: true, recall: false }))),
    { ...trial('b-h1', 'h1', 'B', 't1', []), trial_id: 'run/b-h1/t1/r2', termination: 'exam_fault', verdicts: null },
  ];
  const p = TASKS.map((t): PTry => ({ p_model: 'opus', extraction_model: 'anthropic:claude-opus-5-5', task: t, try: 1, verdicts: verdicts(t, 'I', 'P', facts({})), gold: gold(t, 'clear'), failed_steps: [] }));
  return { trials, p };
}

test('a clustered rate: a bootstrap at 5% or more, Wilson on the design-effect effective n below it', () => {
  const half = clusteredRate(TASKS.map((t) => ({ cluster: t, num: 1, den: 2 })), { seed: 1, draws: 2000 });
  expect([half.rate, half.method, half.ci95, half.n_clusters]).toEqual([0.5, 'bootstrap', [0.5, 0.5], 6]);
  const zero = clusteredRate(TASKS.map((t) => ({ cluster: t, num: 0, den: 3 })), { seed: 1, draws: 2000 });
  expect([zero.rate, zero.method, zero.design_effect, zero.design_effect_source, zero.effective_n]).toEqual([0, 'wilson-deff', 3, 'mean_cluster_size', 6]);
  expect(zero.ci95![1]).toBeCloseTo(wilson(0, 6)![1], 12);
  expect(zero.ci95![1]).toBeCloseTo(3.8415 / 9.8415, 3);
  expect(clusteredRate(TASKS.map((t) => ({ cluster: t, num: 0, den: 3 })), { seed: 1, draws: 2000, designEffectFallback: 1.5 }).effective_n).toBe(12);
  // two events, both in one task of ten facts: the design effect is estimated and widens the Wilson interval
  const lumped = clusteredRate([{ cluster: 'a', num: 2, den: 10 }, ...['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((c) => ({ cluster: c, num: 0, den: 10 }))], { seed: 1, draws: 2000 });
  expect(lumped.method).toBe('wilson-deff');
  expect(lumped.design_effect_source).toBe('estimated');
  expect(lumped.design_effect!).toBeGreaterThan(1);
  expect(lumped.ci95![1]).toBeGreaterThan(wilson(2, 100)![1]);
  expect(clusteredRate([], { seed: 1, draws: 2000 }).rate).toBeNull();
});

test('per cell: rates with intervals, trials, tasks, exclusions and dropped extraction jobs', () => {
  const { trials, p } = fixture();
  const a = analyze(trials, p, config);
  const cell = (id: string) => a.cells.find((c) => c.cell === id)!;
  expect(cell('g-h1').false_owner).toMatchObject({ num: 6, den: 12, rate: 0.5, method: 'bootstrap' });
  expect(cell('g-h1').extraction).toEqual({ trials_with_dropped: 1, dropped_jobs: 2, timed_out_jobs: 0 });
  expect(cell('n-h1').false_owner).toMatchObject({ num: 0, den: 12, method: 'wilson-deff', effective_n: 6 });
  expect(cell('b-h1')).toMatchObject({ n_trials: 7, n_tasks: 6, scored: 6, excluded: { exam_fault: 1 } });
  expect(cell('b-h1').owner_recall.rate).toBe(0);
  expect(cell('g-h2').recorder_label.clear).toMatchObject({ num: 3, den: 3 });
  expect(cell('g-h2').recorder_label.all).toMatchObject({ num: 6, den: 6 });
  expect(a.row_p).toEqual([expect.objectContaining({ p_model: 'opus', tries: 6, n_tasks: 6 })]);
  expect(markdown(a)).not.toContain('t1');
});

test('paired comparisons: G vs N and B vs G per harness with Holm and pooled, P against G, harness vs harness with the hook and sweep sensitivity', () => {
  const { trials, p } = fixture();
  const a = analyze(trials, p, config, [parseMargin('N/h1/' + M + ',G/h1/' + M + ',0.6,lower,false_owner')]);
  const c = (id: string) => a.comparisons.find((x) => x.id === id)!;
  const gn = c(`g_vs_n/false_owner/${M}/h1`);
  expect(gn).toMatchObject({ a: `N/h1/${M}`, b: `G/h1/${M}`, endpoint: 'false_owner', delta: 0.5, ci95: [0.5, 0.5], n_pairs: 12, n_clusters: 6, unpaired: 0, sdd: 0.11, beyond_sdd: true });
  expect(gn.p).toBeCloseTo(2 / 64, 12);
  expect(gn.holm_p).toBeCloseTo(4 / 64, 12);
  expect(gn.noninferiority).toMatchObject({ margin: 0.6, direction: 'lower' });
  expect(gn.noninferiority!.p!).toBeLessThan(0.01);
  expect(c(`g_vs_n/false_owner/${M}/pooled`)).toMatchObject({ delta: 0.5, n_pairs: 24, n_clusters: 6, sdd: 0.06 });
  expect(c(`b_vs_g/owner_recall/${M}/h1`)).toMatchObject({ delta: -1, a: `G/h1/${M}`, b: `B/h1/${M}` });
  expect(a.comparisons.some((x) => x.kind === 'b_vs_g' && x.harness === 'h2')).toBe(false);
  const all = c(`harness_vs_harness/false_owner/${M}/h1 vs h2/I`), strict = c(`harness_vs_harness/false_owner/${M}/h1 vs h2/I/no_hook_sweep`);
  expect([all.delta, all.p]).toEqual([0, 1]);
  expect(strict.delta).toBe(-0.5);
  const pg = c(`p_vs_g/false_owner/${M}/pooled/I`);
  expect(pg).toMatchObject({ a: `G/pooled/${M}`, b: 'P/opus', delta: -0.5, noninferiority: { margin: 0.1, direction: 'lower' } });
  expect(pg.noninferiority!.p!).toBeLessThan(0.001);
  expect(c(`p_vs_g/owner_recall/${M}/pooled/I`).noninferiority).toMatchObject({ margin: 0.1, direction: 'higher', p: null });
  expect(a.recommendation).toEqual([{ model: M, harness: null, reason: expect.stringContaining('no harness is distinguishably better') }]);
});

test('hard cases, the 1% bar per arm and the stage-1 look', () => {
  const { trials, p } = fixture();
  const a = analyze(trials, p, config);
  const hc = (scope: string, h: string) => a.hard_cases.find((x) => x.scope === scope && x.hard_case === h)!;
  expect(hc('G', 'group_chat')).toMatchObject({ model: M, flagged: true, false_owner: { num: 6, den: 12 } });
  expect(hc('P', 'group_chat')).toMatchObject({ model: 'opus', flagged: false, false_owner: { num: 0, den: 6 } });
  expect(hc('G', 'owner_aliases').false_owner.den).toBe(0);
  expect(a.arms.map((x) => [x.arm, x.above_bar])).toEqual([['B', true], ['G', true], ['N', false], ['P', false]]);
  expect(a.look).toEqual({ headroom_stop: false, fault_stop: true, headroom_cells: ['n-h1', 'n-h2'], fault_cells: ['b-h1'], unseen_cells: [] });
  const ceiling = analyze(trials.filter((t) => t.arm === 'N'), [], config);
  expect(ceiling.look.headroom_stop).toBe(true);
  const unseen = analyze(trials.filter((t) => t.arm === 'N'), [], config, [], ['n-h1', 'n-h2', 'g-h1']);
  expect(unseen.look).toMatchObject({ headroom_stop: false, unseen_cells: ['g-h1'] });
  const faulted = trials.map((t) => (t.cell === 'n-h2' ? { ...t, termination: 'infra_error' as const, verdicts: null } : t)).filter((t) => t.arm === 'N');
  const empty = analyze(faulted, [], config);
  expect(empty.cells.find((c) => c.cell === 'n-h2')!.false_owner.rate).toBeNull();
  expect(empty.look).toMatchObject({ headroom_stop: false, headroom_cells: ['n-h1'] });
});

test('family C per harness: a worker that never started is not run, and its brief leaves the denominator', () => {
  const v = verdicts('c1', 'C', 'G', [
    { id: 'w4', primary: 'false_owner', hard_case: 'agent_brief_as_user', fo: true },
    { id: 'w5', primary: 'false_owner', hard_case: 'agent_brief_as_user', fo: true },
    { id: 'o1', primary: 'owner_recall', hard_case: 'control', recall: true },
  ]);
  const g = { task: 'c1', family: 'C', source: 'session', formats: [], hard_cases: [], questions: [], facts: [
    { id: 'w4', where: { session: 4 }, launch: 'env' }, { id: 'w5', where: { session: 5 }, launch: 'detected' }, { id: 'o1', where: { session: 1 }, launch: 'typed' },
  ] } as unknown as Gold;
  const session = (n: number, kind: string, banked: boolean) => ({ n, kind, launch: kind === 'worker' ? 'env' : 'typed', tokens: 1, expected: null, sessions: banked ? [`s${n}`] : [], files: [], observed: null, pass: banked, reason: null });
  const capture = { task: 'c1', corpus_dir: '', corpus_files: 4, corpus_sessions: 4, mixed: [], heartbeat: null, pass: false,
    sessions: [session(1, 'owner', true), session(2, 'owner', true), session(3, 'orchestrator', true), session(4, 'worker', true), session(5, 'worker', false)],
    launch: { file: '', ancestors: [], harness_ancestor: true, workers: [{ worker: 1, launch: 'env', exit: 0, seconds: 1 }] } };
  const plan = { schema_version: 1, task: 'c1', launcher: '', agent_label: '', orchestrator_turn: 3, sessions: [], workers: [{ n: 1, session: 4, launch: 'env', agent: 'x', brief: '' }, { n: 2, session: 5, launch: 'detected', agent: null, brief: '' }] };
  const t = (harness: string): OITrial => ({ trial_id: `run/${harness}-c/c1/r1`, cell: `${harness}-c`, task: 'c1', harness, model: M, arm: 'G', termination: 'completed', dropped_jobs: 0, timed_out_jobs: 0, verdicts: v, capture: capture as never, gold: g, plan: plan as never });
  const a = analyze([t('claude-code'), t('codex')], [], null);
  expect(a.family_c.map((x) => x.harness)).toEqual(['claude-code', 'codex']);
  const cc = a.family_c[0]!;
  expect(cc.sessions).toEqual({ owner: { planned: 2, banked: 2 }, orchestrator: { planned: 1, banked: 1 }, worker: { planned: 2, started: 1, not_run: 1, banked: 1, speaker_ok: 1 } });
  expect(cc.worker_briefs_as_owner.env).toMatchObject({ num: 1, den: 1 });
  expect(cc.worker_briefs_as_owner.detected.den).toBe(0);
  expect(cc.worker_briefs_as_owner.not_run_facts).toBe(1);
  expect(cc.false_owner).toMatchObject({ num: 1, den: 1 });
  expect(a.arms.find((x) => x.arm === 'G')).toBeUndefined();
});

test('family C is never pooled: the capture cells leave the G arm, hard cases, comparisons and the stage-1 look', () => {
  const { trials, p } = fixture();
  const capture = TASKS.map((t): OITrial => ({ ...trial('gc-h1', 'h1', 'G', `c-${t}`, facts({ f1: true, f2: true, recall: false })),
    verdicts: verdicts(`c-${t}`, 'C', 'G', facts({ f1: true, f2: true, recall: false })), gold: { ...gold(`c-${t}`, 'clear'), family: 'C', facts: [{ id: 'f2', cue: 'clear', where: { session: 1 } } as unknown as Gold['facts'][number]] } }));
  const base = analyze(trials, p, config, [], ['n-h1', 'n-h2', 'g-h1', 'g-h2']);
  const both = analyze([...trials, ...capture], p, config, [], ['n-h1', 'n-h2', 'g-h1', 'g-h2']);
  expect(both.cells.find((c) => c.cell === 'gc-h1')!.false_owner).toMatchObject({ num: 12, den: 12 });
  expect(both.family_c.map((x) => [x.harness, x.trials])).toEqual([['h1', 6]]);
  expect(both.arms).toEqual(base.arms);
  expect(both.hard_cases).toEqual(base.hard_cases);
  expect(both.comparisons).toEqual(base.comparisons);
  expect(both.look).toEqual(base.look);
});

test('tasks with an import gbrain cannot parse are their own stratum in the cell, row P and arm tables and leave P against G', () => {
  const { trials, p } = fixture();
  const unknown = (g: Gold | null): Gold => ({ ...g!, formats: [{ file: 'export.weird', format: 'weird', format_known_to_gbrain: false }] });
  const base = analyze(trials, p, config);
  const a = analyze(trials.map((t) => (t.task === 't6' ? { ...t, gold: unknown(t.gold) } : t)), p.map((x) => (x.task === 't6' ? { ...x, gold: unknown(x.gold) } : x)), config);
  expect(a.cells.find((c) => c.cell === 'g-h1')!.unknown_format).toMatchObject({ n_tasks: 1, false_owner: { num: 1, den: 2 } });
  expect(a.cells.find((c) => c.cell === 'g-h1')!.false_owner).toEqual(base.cells.find((c) => c.cell === 'g-h1')!.false_owner);
  expect(a.row_p[0]!.unknown_format.n_tasks).toBe(1);
  expect(a.arms.find((x) => x.arm === 'P')!.unknown_format.n_tasks).toBe(1);
  expect(base.cells.find((c) => c.cell === 'g-h1')!.unknown_format.n_tasks).toBe(0);
  const pg = (x: typeof a) => x.comparisons.filter((c) => c.kind === 'p_vs_g').map((c) => [c.metric, c.n_pairs]);
  expect(pg(base)).toEqual([['false_owner', 12], ['owner_recall', 6]]);
  expect(pg(a)).toEqual([['false_owner', 10], ['owner_recall', 5]]);
});

test('the analysis config and the claim checks for comparisons.owner-identity.json', () => {
  expect(analysisConfigProblems(config)).toEqual([]);
  expect(analysisConfigProblems({ sdd: { g_vs_n_harness: 2 } })).toContain('owner_identity.sdd.g_vs_n_harness must be a fraction between 0 and 1');
  expect(analysisConfigProblems({ ...config, p_vs_g: { model: M } })[0]).toMatch(/^owner_identity.p_vs_g must be/);
  const claim = { id: 'OI-1', sentence: 'G cuts false-owner against N on Claude Code', source: 'comparisons.owner-identity.json', path: 'comparisons', where: { id: `g_vs_n/false_owner/${M}/claude-code` }, rule: 'superiority', direction: 'decrease' };
  expect(claimProblems([claim], ['a', 'b'])).toEqual([expect.stringMatching(/^heldout.owner_identity is missing/)]);
  expect(claimProblems([claim], ['a', 'b'], { sdd: {} })).toContain('heldout.owner_identity.sdd.p_vs_g must be a fraction between 0 and 1');
  expect(claimProblems([claim], ['a', 'b'], config)).toEqual([]);
  expect(claimProblems([{ ...claim, source: 'analysis.json' }], ['a', 'b'], config)[0]).toMatch(/source must be comparisons.json, comparisons.gbrain.json or comparisons.owner-identity.json, the three export.ts makes/);
  // a noninferiority claim's --margin names the entry's metric, since both metrics share one cell pair
  expect(entryPair({ a: 'G/pooled/m', b: 'P/opus', endpoint: 'false_owner' })).toEqual(['G/pooled/m', 'P/opus', 'false_owner']);
  expect(entryPair({ a: 'x', b: 'y' })).toEqual(['x', 'y']);
  expect(parseMargin('G/pooled/m,P/opus,0.07,lower,false_owner')).toEqual({ a: 'G/pooled/m', b: 'P/opus', margin: 0.07, direction: 'lower', endpoint: 'false_owner' });
});

test('row P reads a set dev tree or a sealed root, exactly one, and a sealed --out inside a checkout is refused before anything runs', () => {
  const dev = rowPInput({ set: 'tasks/multiuser/owner-identity' });
  expect(dev.sealed).toBeNull();
  expect(dev.tasks.length).toBeGreaterThan(0);
  expect(dev.corpus).toBe(join(resolve('tasks/multiuser/owner-identity'), 'corpus', 'dev'));
  expect(() => rowPInput({})).toThrow(/^HE-RUN-002 row P reads --set/);
  const tmp = mkdtempSync(join(tmpdir(), 'rowp-'));
  try {
    expect(() => rowPInput({ sealedRoot: tmp })).toThrow(/^HE-SEALED-003 .* has no opening-receipt.json/);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'owner-identity', 'row-p.ts'), '--sealed-root', tmp, '--lease', 'l', '--cap-usd', '1', '--out', join(ROOT, 'tmp-row-p-out'), '--image', 'x'],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^HE-SEALED-002 --out .* is inside a git work tree/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('row P: a try whose import or extraction step exited non-zero is counted as failed and adds no fact', () => {
  const { trials, p } = fixture();
  const failed: PTry = { ...p[0]!, try: 2, verdicts: verdicts('t1', 'I', 'P', facts({ f1: true, recall: false })), failed_steps: ['extract'] };
  const a = analyze(trials, [...p, failed], config);
  const b = analyze(trials, p, config);
  expect(a.row_p).toEqual([expect.objectContaining({ p_model: 'opus', tries: 7, failed_tries: 1 })]);
  expect(a.row_p[0]!.false_owner).toEqual(b.row_p[0]!.false_owner);
  expect(a.row_p[0]!.owner_recall).toEqual(b.row_p[0]!.owner_recall);
  expect(markdown(a)).toContain('| row-p/opus | P | none | anthropic:claude-opus-5-5 | 7 | 6 | 1 |');
});
