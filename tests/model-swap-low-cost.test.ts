// scripts/model-swap.ts low_cost_swap: the DeepSeek-V4.1-Flash-1017 against particle-1 contrast (amendment gate G1), on synthetic
// trials small enough to check by hand: the pooled difference, superiority each way, the TOST p, Holm over the declared
// families, every label, the excluded home harness beside the call, the frontier gap, the token cost basis and its missing
// fields, the Harbor and multi-user wiring, and that the model_swap output is byte for byte what it was before the block existed.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TrialRecord, TrialUsage } from '../runner/contracts.ts';
import { clusteredPairedDelta, nonInferiorityP } from '../runner/stats/paired.ts';
import { analyzeFrontier, renderMarkdown as renderFrontier, SpecError as FrontierSpecError, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';
import { analyzeMatrix, renderMarkdown as renderMatrix, type MatrixManifest, type MatrixSpec } from '../scripts/matrix-analysis.ts';
import { analyzeLowCostSwap, analyzeModelSwap, checkLowCostSwapSpec, lowCostCall, ModelSwapError, renderLowCostSwap, renderModelSwap, tokenCost, type LowCostSwapSpec, type LowCostTrial, type ModelSwapSpec, type SwapCell, type SwapTrial } from '../scripts/model-swap.ts';

const ROOT = join(import.meta.dir, '..');
const OPTS = { seed: 7, draws: 2000, alpha: 0.05 };
const PRICES = 'runner/pricing/prices-2026-11-08.json';
const ROWS = { D: 'openrouter:deepseek/deepseek-v4.1-flash-1017', P: 'particle:particle-1' };
const A = 'DeepSeek-V4.1-Flash-1017', B = 'particle-1';

// Every trial: 1M prompt tokens, 500K of them cache reads, and 100K output. usage.usd is 99 so a cost that read it would show.
const tokens = (model: string, extra: Partial<TrialUsage> = {}): TrialUsage => ({ meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 99, input_tokens: 1_000_000, output_tokens: 100_000, cached_tokens: 500_000, unpriced: 0, by_model: { [model]: { usd: 99, requests: 1 } }, upstream: null, ...extra });
// One character per attempt: 1 pass, 0 fail, M model_error (excluded).
const lt = (cell: string, model: string, tasks: Record<string, string>, extra: Partial<TrialUsage> = {}): LowCostTrial[] =>
  Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch) => ({ cell, task, value: ch === 'M' ? null : ch === '1' ? 1 : 0, usage: tokens(model, extra) })));

const CELLS: SwapCell[] = [
  { id: 'h1-d', harness: 'h1', model: 'D' }, { id: 'h1-p', harness: 'h1', model: 'P' }, { id: 'h1-o', harness: 'h1', model: 'O' },
  { id: 'h2-d', harness: 'h2', model: 'D' }, { id: 'h2-p', harness: 'h2', model: 'P' },
  { id: 'dsh-d', harness: 'dsh', model: 'D' }, { id: 'dsh-p', harness: 'dsh', model: 'P' },
];
const TRIALS: LowCostTrial[] = [
  ...lt('h1-d', ROWS.D, { t1: '11', t2: '10', t3: '11', t4: '00' }), ...lt('h1-p', ROWS.P, { t1: '10', t2: '10', t3: '00', t4: '00' }),
  ...lt('h2-d', ROWS.D, { t1: '11', t2: '11', t3: '10', t4: '10' }), ...lt('h2-p', ROWS.P, { t1: '11', t2: '00', t3: '10', t4: '00' }),
  ...lt('h1-o', 'anthropic:claude-opus-5-5', { t1: '11', t2: '11', t3: '11', t4: '11' }),
  ...lt('dsh-d', ROWS.D, { t1: '11', t2: '11', t3: '11', t4: '11' }), ...lt('dsh-p', ROWS.P, { t1: '00', t2: '00', t3: '00', t4: '00' }),
];
const SPEC: LowCostSwapSpec = {
  a: 'D', b: 'P', label_a: A, label_b: B, exclude_harnesses: ['dsh'],
  use_cases: [{ id: 'codegen', cells: CELLS.map((c) => c.id) }], family: ['codegen', 'personal-brain', 'company-brain'], margin: 0.1,
  cost_basis: { prices: PRICES, rows: { D: ROWS.D, P: ROWS.P } }, frontier: ['O', 'S'], min_clusters: 2,
};
const run = (spec: LowCostSwapSpec = SPEC, trials: LowCostTrial[] = TRIALS, cells: SwapCell[] = CELLS) => analyzeLowCostSwap({ cells, trials }, spec, OPTS, ROOT);
// One harness, twenty tasks, each side's attempts given per task.
const twenty = (d: string, p: string, extra: Partial<LowCostSwapSpec> = {}) => {
  const tasks = Array.from({ length: 20 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
  const cells: SwapCell[] = [{ id: 'h1-d', harness: 'h1', model: 'D' }, { id: 'h1-p', harness: 'h1', model: 'P' }];
  const trials = [...lt('h1-d', ROWS.D, Object.fromEntries(tasks.map((t) => [t, d]))), ...lt('h1-p', ROWS.P, Object.fromEntries(tasks.map((t) => [t, p])))];
  return run({ ...SPEC, use_cases: [{ id: 'codegen', cells: ['h1-d', 'h1-p'] }], min_clusters: 10, ...extra }, trials, cells).calls[0]!;
};

describe('low-cost swap: hand-computed pooled call', () => {
  const a = run();
  const c = a.calls[0]!;

  test('d is a minus b over the pooled harnesses, each (harness, task) pair once', () => {
    // DeepSeek h1 [1, .5, 1, 0], h2 [1, 1, .5, .5]; particle-1 h1 [.5, .5, 0, 0], h2 [1, 0, .5, 0]
    expect(c).toMatchObject({ id: 'codegen', harnesses: ['h1', 'h2'], tasks: 4, pairs: 8, clusters: 4, attempts: { a: 16, b: 16 }, mean_a: 0.6875, mean_b: 0.3125, d: 0.375 });
    expect([c.a_worse, c.a_better, c.tied]).toEqual([0, 4, 4]);
    expect(c.informative).toEqual({ pairs: 6, share: 0.75 });
  });

  test('superiority each way is the exact one-sided cluster sign-flip', () => {
    // cluster sums t1 .5, t2 1, t3 1, t4 .5: only the all-positive pattern of 16 reaches the observed sum
    expect(c.p_superiority_a).toBe(0.0625);
    expect(c.p_superiority_b).toBe(1);
  });

  test("the label is can't tell, with the MDD", () => {
    expect(c.call).toBe("can't tell");
    expect(c.mdd_80!).toBeGreaterThan(0);
    expect(renderLowCostSwap(a).join('\n')).toContain("**can't tell** (MDD at 80% power: 20.2 points)");
  });

  test('a is labelled a low-cost model, not frontier, and the wording templates are fixed', () => {
    expect(a.method.a_class).toBe('low-cost model, not frontier');
    expect(a.method.templates).toEqual(['<a> better', '<b> better', '<a> better, by less than <margin>', '<b> better, by less than <margin>', 'within <margin> points', 'within <margin> points, no measurable difference', "can't tell"]);
    expect(renderLowCostSwap(a).join('\n')).toContain(`## Low-cost swap: ${A} against ${B} in the same harnesses\n\n${A} is a low-cost model, not a frontier model.`);
  });

  test('the descriptive frontier minus a gap, per listed frontier model, with no test', () => {
    // Opus h1 [1, 1, 1, 1] minus DeepSeek h1 [1, .5, 1, 0]
    expect(c.frontier_gap[0]).toMatchObject({ frontier: 'O', harnesses: ['h1'], tasks: 4, pairs: 4, clusters: 4, mean_frontier: 1, mean_a: 0.625, gap: 0.375 });
    expect(c.frontier_gap[0]!.ci95).not.toBeNull();
    expect(c.frontier_gap[1]).toEqual({ frontier: 'S', reason: 'no pooled harness of codegen has cells of both S and D' });
    expect(renderLowCostSwap(a).join('\n')).toContain(`| codegen | O minus ${A} | h1 | 4 / 4 / 4 | 100.0% / 62.5% | +37.5 `);
  });
});

describe('low-cost swap: the excluded home harness', () => {
  test('dsh is left out of the pool and reported beside the call, descriptive', () => {
    const c = run().calls[0]!;
    expect(c.harnesses).toEqual(['h1', 'h2']);
    expect(c.excluded).toEqual([{ harness: 'dsh', tasks: 4, pairs: 4, clusters: 4, mean_a: 1, mean_b: 0, d: 1, ci95: [1, 1] }]);
    const md = renderLowCostSwap(run()).join('\n');
    expect(md).toContain(`| codegen | dsh (left out of the pool): ${A} minus ${B} | dsh | 4 / 4 / 4 | 100.0% / 0.0% | +100.0 [+100.0, +100.0] |`);
    expect(md).toContain('and leaves out dsh, reported beside it');
  });

  test('the pooled call is the same as a run with no dsh cells at all', () => {
    const cells = CELLS.filter((c) => c.harness !== 'dsh');
    const without = run({ ...SPEC, use_cases: [{ id: 'codegen', cells: cells.map((c) => c.id) }] }, TRIALS.filter((t) => !t.cell.startsWith('dsh')), cells).calls[0]!;
    const { excluded: _x, cost: _c, ...a } = run().calls[0]!;
    const { excluded: _y, cost: _d, ...b } = without;
    expect(a).toEqual(b);
  });

  test('without exclude_harnesses dsh pools like any harness', () => {
    const c = run({ ...SPEC, exclude_harnesses: [] }).calls[0]!;
    expect(c.harnesses).toEqual(['dsh', 'h1', 'h2']);
    // h1 and h2 d .375 each, dsh 1, each harness weighted the same
    expect(c.d).toBeCloseTo((0.375 + 0.375 + 1) / 3, 6);
    expect(c.excluded).toEqual([]);
  });

  test('an excluded harness with only one of the two models says so', () => {
    const cells = CELLS.filter((x) => x.id !== 'dsh-p');
    const c = run({ ...SPEC, use_cases: [{ id: 'codegen', cells: cells.map((x) => x.id) }] }, TRIALS.filter((t) => t.cell !== 'dsh-p'), cells).calls[0]!;
    expect(c.excluded).toEqual([{ harness: 'dsh', reason: 'dsh has no cell pair of D and P' }]);
  });
});

describe('low-cost swap: the TOST p', () => {
  test('p is the larger of the two one-sided bootstrap p-values at plus and minus the margin', () => {
    const c = run().calls[0]!;
    const items = [['h1', [1, 0.5, 1, 0], [0.5, 0.5, 0, 0]], ['h2', [1, 1, 0.5, 0.5], [1, 0, 0.5, 0]]] as const;
    const stats = clusteredPairedDelta(items.flatMap(([h, d, p]) => d.map((x, i) => ({ id: `${h}/t${i + 1}`, cluster: `t${i + 1}`, a: p[i]!, b: x }))), OPTS);
    const lower = nonInferiorityP(stats, 0.1, 'higher')!, upper = nonInferiorityP(stats, 0.1, 'lower')!;
    expect(c.p_tost_lower).toBe(Number(lower.toFixed(8)));
    expect(c.p_tost_upper).toBe(Number(upper.toFixed(8)));
    expect(c.p_tost).toBe(Number(Math.max(lower, upper).toFixed(8)));
    // d = .375 everywhere above +10 points: the upper test fails outright
    expect(c.p_tost).toBe(1);
  });

  test('a constant 5-point difference sits inside both bounds; a constant 15-point one does not', () => {
    // 11 of 20 against 10 of 20 on every task: d = .05 in every bootstrap draw, so each one-sided p is 1 / (draws + 1)
    const five = twenty('1'.repeat(11) + '0'.repeat(9), '1'.repeat(10) + '0'.repeat(10));
    expect([five.d, five.p_tost_lower, five.p_tost_upper, five.p_tost]).toEqual([0.05, 0.00049975, 0.00049975, 0.00049975]);
    const fifteen = twenty('1'.repeat(13) + '0'.repeat(7), '1'.repeat(10) + '0'.repeat(10));
    expect([fifteen.d, fifteen.p_tost_lower, fifteen.p_tost_upper, fifteen.p_tost]).toEqual([0.15, 0.00049975, 1, 1]);
  });
});

describe('low-cost swap: Holm over the declared families', () => {
  test('six superiority calls and three TOST calls; the use cases this run does not make count as p = 1', () => {
    const a = run();
    expect(a.family.superiority).toEqual([`codegen/${A} better`, `codegen/${B} better`, `personal-brain/${A} better`, `personal-brain/${B} better`, `company-brain/${A} better`, `company-brain/${B} better`]);
    expect(a.family.within).toEqual(['codegen/within', 'personal-brain/within', 'company-brain/within']);
    expect(a.family.absent).toEqual(['personal-brain', 'company-brain']);
    // .0625 * 6 = .375 with four absent members at p = 1
    expect(a.calls[0]!.holm_p_superiority_a).toBe(0.375);
    expect(a.calls[0]!.holm_p_superiority_b).toBe(1);
    // TOST: 2000-draw p of 1 / 2001 times 3
    const five = twenty('1'.repeat(11) + '0'.repeat(9), '1'.repeat(10) + '0'.repeat(10));
    expect(five.holm_p_tost).toBe(Number((3 / 2001).toFixed(8)));
    expect(five.holm_p_superiority_a).toBe(Number((6 / 2 ** 20).toFixed(8)));
  });

  test('the same data under a one-use-case family adjusts by two, not six', () => {
    const a = run({ ...SPEC, family: ['codegen'] });
    expect(a.calls[0]!.holm_p_superiority_a).toBe(0.125);
    expect(a.family.absent).toEqual([]);
  });

  test('a call with fewer than min_clusters clusters is not tested and counts as p = 1', () => {
    const c = run({ ...SPEC, min_clusters: 10 }).calls[0]!;
    expect(c).toMatchObject({ tested: false, holm_p_superiority_a: 1, holm_p_superiority_b: 1, holm_p_tost: 1, call: "can't tell" });
    expect(c.untested_reason).toContain('4 cluster(s), fewer than 10');
  });

  test('a use case the run makes is counted, and a declared family that leaves one out is refused', () => {
    const cells = new Map(CELLS.map((c) => [c.id, c]));
    expect(checkLowCostSwapSpec({ ...SPEC, family: ['personal-brain'] }, cells, 'harbor')).toEqual(['low_cost_swap: the declared family leaves out use case(s) this run plans: codegen']);
  });
});

describe('low-cost swap: labels', () => {
  const at = (sa: number, sb: number, tost: number, ci: [number, number] | null, tested = true) => lowCostCall({ tested, holm_p_superiority_a: sa, holm_p_superiority_b: sb, holm_p_tost: tost, ci95: ci }, { a: A, b: B, margin: 0.1 }, 0.05);
  test('every template, from the Holm-adjusted p-values', () => {
    expect(at(0.01, 1, 0.5, [0.2, 0.4])).toBe(`${A} better`);
    expect(at(1, 0.01, 0.5, [-0.4, -0.2])).toBe(`${B} better`);
    expect(at(0.01, 1, 0.01, [0.02, 0.06])).toBe(`${A} better, by less than 10`);
    expect(at(1, 0.01, 0.01, [-0.06, -0.02])).toBe(`${B} better, by less than 10`);
    expect(at(0.5, 0.5, 0.01, [0.01, 0.06])).toBe('within 10 points');
    expect(at(0.5, 0.5, 0.01, [-0.03, 0.04])).toBe('within 10 points, no measurable difference');
    expect(at(0.5, 0.5, 0.5, [-0.3, 0.3])).toBe("can't tell");
  });
  test('alpha is inclusive, and an untested call is can\'t tell whatever its p', () => {
    expect(at(0.05, 1, 0.5, [0.1, 0.3])).toBe(`${A} better`);
    expect(at(0.0500001, 1, 0.5, [0.1, 0.3])).toBe("can't tell");
    expect(at(0.001, 1, 0.001, [0.01, 0.02], false)).toBe("can't tell");
  });
  test('on data: each direction, each with and without the margin', () => {
    expect(twenty('1'.repeat(11) + '0'.repeat(9), '1'.repeat(10) + '0'.repeat(10)).call).toBe(`${A} better, by less than 10`);
    expect(twenty('1'.repeat(10) + '0'.repeat(10), '1'.repeat(11) + '0'.repeat(9)).call).toBe(`${B} better, by less than 10`);
    expect(twenty('1', '0').call).toBe(`${A} better`);
    expect(twenty('0', '1').call).toBe(`${B} better`);
  });
  test('on data: small mixed differences over forty tasks are within 10 points with no measurable difference', () => {
    const tasks = Array.from({ length: 40 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
    const cells: SwapCell[] = [{ id: 'h1-d', harness: 'h1', model: 'D' }, { id: 'h1-p', harness: 'h1', model: 'P' }];
    const trials = [...lt('h1-d', ROWS.D, Object.fromEntries(tasks.map((t) => [t, '11110000']))), ...lt('h1-p', ROWS.P, Object.fromEntries(tasks.map((t, i) => [t, i % 4 === 0 ? '11111000' : i % 4 === 1 ? '11100000' : '11110000'])))];
    const c = run({ ...SPEC, use_cases: [{ id: 'codegen', cells: ['h1-d', 'h1-p'] }], min_clusters: 10 }, trials, cells).calls[0]!;
    expect(c.d).toBe(0);
    expect(c.holm_p_tost).toBeLessThan(0.05);
    expect(c.call).toBe('within 10 points, no measurable difference');
  });
});

describe('low-cost swap: the token cost basis', () => {
  test('tokens times the dated peak list rates, cache reads included; usage.usd is never read', () => {
    const c = run().calls[0]!;
    // DeepSeek per trial: 500K uncached x $0.30 + 500K cache reads x $0.006 + 100K output x $1.20 = $0.273
    // particle-1 per trial: 500K x $0.25 + 500K x $0.03 + 100K x $1 = $0.24; 16 trials a side, 11 and 5 solves
    expect(c.cost.a).toMatchObject({ trials: 16, trials_priced: 16, usd_total: 4.368, solves: 11, usd_per_solve: 0.397091, missing: [] });
    expect(c.cost.b).toMatchObject({ trials: 16, trials_priced: 16, usd_total: 3.84, solves: 5, usd_per_solve: 0.768, missing: [] });
    // b to a: (3.84 / 5) / (4.368 / 11)
    expect(c.cost.b_to_a.ratio).toBe(Number(((3.84 / 5) / (4.368 / 11)).toFixed(4)));
    expect(c.cost.b_to_a.ci95).not.toBeNull();
    const a = run();
    expect(a.method.cost.rates.map((r) => [r.row, r.input, r.cache_read, r.cache_write, r.output])).toEqual([[ROWS.D, 0.3, 0.006, null, 1.2], [ROWS.P, 0.25, 0.03, null, 1]]);
    expect(a.method.cost).toMatchObject({ prices: PRICES, date: '2026-11-08' });
    expect(renderLowCostSwap(a).join('\n')).toContain(`| codegen | $0.3971 `);
  });

  test('cache writes bill at the cache-write rate, or at input when the row has none', () => {
    const d = { row: ROWS.D, input: 0.3, output: 1.2, cache_read: 0.006, cache_write: null, long_prompt: false };
    expect(tokenCost(tokens(ROWS.D, { cache_write_tokens: 200_000 }), d).usd).toBeCloseTo(0.273, 12);
    expect(tokenCost(tokens(ROWS.D), { ...d, cache_write: 0.5 })).toEqual({ usd: null, missing: ['usage.cache_write_tokens'] });
    // 300K uncached x .3 + 500K reads x .006 + 200K writes x .5 + 100K output x 1.2
    expect(tokenCost(tokens(ROWS.D, { cache_write_tokens: 200_000 }), { ...d, cache_write: 0.5 }).usd).toBeCloseTo(0.09 + 0.003 + 0.1 + 0.12, 12);
  });

  test('a trial whose record lacks what the basis needs names the field, and no cost or ratio is guessed', () => {
    const t = TRIALS.map((x, i) => (x.cell === 'h1-d' && i === 0 ? { ...x, usage: null } : x.cell === 'h1-d' && i === 1 ? { ...x, usage: tokens(ROWS.D, { unpriced: 1 }) } : x.cell === 'h2-d' && x.task === 't1' ? { ...x, usage: tokens(ROWS.D, { by_model: { [ROWS.D]: { usd: 1, requests: 1 }, 'anthropic:claude-haiku-5-5': { usd: 0.01, requests: 1 } } }) } : x));
    const c = run(SPEC, t).calls[0]!;
    expect(c.cost.a).toMatchObject({ trials: 16, trials_priced: 12, usd_total: null, usd_per_solve: null, ci95: null, usd_priced_trials: Number((12 * 0.273).toFixed(6)), note: '4 of 16 trial(s) lack the token counts, so no cost per solved task' });
    expect(c.cost.a.missing).toEqual([
      { field: 'usage', trials: 1 },
      { field: 'usage.by_model tokens: the trial also ran another model, and by_model carries only usd and requests', trials: 2 },
      { field: 'usage.unpriced: tokens of requests charged their reservation', trials: 1 },
    ]);
    expect(c.cost.b.usd_per_solve).toBe(0.768);
    expect(c.cost.b_to_a).toMatchObject({ ratio: null, ci95: null });
    expect(c.cost.b_to_a.note).toBe('not computed: trial records lack usage; usage.by_model tokens: the trial also ran another model, and by_model carries only usd and requests; usage.unpriced: tokens of requests charged their reservation');
    const md = renderLowCostSwap(run(SPEC, t)).join('\n');
    expect(md).toContain('**Fields the trial records lack for the token basis:**');
    expect(md).toContain(`- codegen, ${A}: usage (1 trial(s)); `);
  });

  test('a price row the file does not hold refuses the analysis', () => {
    expect(() => run({ ...SPEC, cost_basis: { prices: PRICES, rows: { D: 'openrouter:deepseek/none', P: ROWS.P } } })).toThrow(ModelSwapError);
    expect(() => run({ ...SPEC, cost_basis: { prices: PRICES, rows: { D: 'openrouter:deepseek/none', P: ROWS.P } } })).toThrow('low_cost_swap: runner/pricing/prices-2026-11-08.json has no row openrouter:deepseek/none (cost_basis.rows.D)');
  });
});

describe('low-cost swap: spec checks', () => {
  const cells = new Map([...CELLS.map((c) => [c.id, c] as const), ['h3-x', { id: 'h3-x', harness: 'h3', model: 'X' }]]);
  test('refuses a frontier model that is a or b, a cell on another model, a bad margin and a missing price row', () => {
    expect(checkLowCostSwapSpec(SPEC, cells, 'harbor')).toEqual([]);
    expect(checkLowCostSwapSpec({ ...SPEC, frontier: ['D'] }, cells, 'harbor')).toContain('low_cost_swap: frontier model D is a or b');
    expect(checkLowCostSwapSpec({ ...SPEC, use_cases: [{ id: 'codegen', cells: ['h1-d', 'h3-x'] }] }, cells, 'harbor')).toContain('low_cost_swap: cell h3-x runs X, which is neither a, b nor a listed frontier model');
    expect(checkLowCostSwapSpec({ ...SPEC, margin: 0 }, cells, 'harbor')).toContain('low_cost_swap: margin must be a number between 0 and 0.5');
    expect(checkLowCostSwapSpec({ ...SPEC, cost_basis: { prices: PRICES, rows: { D: ROWS.D } } }, cells, 'harbor')).toContain('low_cost_swap: cost_basis.rows names no price row for P');
    expect(checkLowCostSwapSpec({ ...SPEC, cluster: 'account-attribute', facts_index: 'f.json' }, cells, 'harbor')).toContain('low_cost_swap: Harbor tasks name no account, so cluster must be task (set any other grouping in clusters)');
  });
  test('require_clusters refuses a task with no cluster from the override', () => {
    expect(() => run({ ...SPEC, require_clusters: true, clusters: { t1: 'g', t2: 'g', t3: 'h' } })).toThrow('low_cost_swap: require_clusters is set and 1 task(s) in a contrast have no cluster from clusters: t4');
  });
});

// The model_swap inputs of tests/model-swap.test.ts, and the sha256 of each output as the code wrote it before low_cost_swap existed (c73197a911).
const swapTrials = (cell: string, tasks: Record<string, string>, usd: number): SwapTrial[] =>
  Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch) => ({ cell, task, value: ch === 'M' ? null : ch === '1' ? 1 : 0, usd })));
const SWAP_CELLS: SwapCell[] = [
  { id: 'h1-p', harness: 'h1', model: 'P' }, { id: 'h1-o', harness: 'h1', model: 'O' }, { id: 'h1-s', harness: 'h1', model: 'S' },
  { id: 'h2-p', harness: 'h2', model: 'P' }, { id: 'h2-o', harness: 'h2', model: 'O' },
];
const SWAP_TRIALS: SwapTrial[] = [
  ...swapTrials('h1-p', { t1: '11', t2: '10', t3: '00', t4: '00' }, 0.01), ...swapTrials('h1-o', { t1: '11', t2: '11', t3: '10', t4: '11' }, 0.1),
  ...swapTrials('h1-s', { t1: '11', t2: '11', t3: '11', t4: '11' }, 0.1), ...swapTrials('h2-p', { t1: '10', t2: '00', t3: '11', t4: '00' }, 0.01),
  ...swapTrials('h2-o', { t1: '11', t2: '10', t3: '11', t4: '10' }, 0.1),
];
const SWAP_SPEC: ModelSwapSpec = {
  particle: 'P', frontier: [{ id: 'O', label: 'Opus 5.5' }, { id: 'S', label: 'GPT-6.1 Sol' }], use_cases: [{ id: 'codegen', cells: SWAP_CELLS.map((c) => c.id) }], min_clusters: 2,
  family: ['codegen/O', 'codegen/S', 'personal-brain/O', 'personal-brain/S', 'company-brain/O', 'company-brain/S'],
};
function record(cell: string, model: string, task: string, rep: number, pass: boolean, extra: Partial<TrialRecord> = {}): TrialRecord {
  return {
    trial_id: `mu/${cell}/${task}/r${rep}`, cell, task, harness: 'hermes', harness_mode: 'docker', model, script: null, termination: 'completed', grade: pass ? 'pass' : 'fail',
    consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [0] },
    usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 0.05, input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 1000, started_at: '2026-11-01T00:00:00.000Z', ended_at: '2026-11-01T00:00:01.000Z', paths: {}, ...extra,
  } as TrialRecord;
}
const fail = (id: string) => ({ predicates: [{ id, kind: 'required' as const, passed: false, evidence: 'x' }] });
const MU_RECORDS = [
  record('he-p', 'P', 'u1', 1, false, fail('no_cross_scope_reads')), record('he-p', 'P', 'u1', 2, true),
  record('he-p', 'P', 'u2', 1, true), record('he-p', 'P', 'u2', 2, false, fail('no_leak')),
  record('he-o', 'O', 'u1', 1, true, { effects: ['finance_disclosure'] }), record('he-o', 'O', 'u1', 2, true),
  record('he-o', 'O', 'u2', 1, true), record('he-o', 'O', 'u2', 2, true, fail('not_distractor')),
];
const MU_MANIFEST: MatrixManifest = { run_id: 'mu', cells: [{ id: 'he-p', harness: 'hermes', model: 'P' }, { id: 'he-o', harness: 'hermes', model: 'O' }], trials: MU_RECORDS.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })) };
const MU_SPEC: MatrixSpec = {
  run_id: 'mu', seed: 7, draws: 2000, primary_family_size: 1, cells: [{ id: 'he-p' }, { id: 'he-o' }], primary: [{ id: 'p1', a: 'he-p', b: 'he-o' }],
  model_swap: { particle: 'P', frontier: [{ id: 'O', label: 'Opus 5.5' }], use_cases: [{ id: 'company-brain', cells: ['he-p', 'he-o'] }], min_clusters: 2 },
};
const MU_TASK_INFO = { u1: { key: null, leak_predicates: ['no_leak'] }, u2: { key: null, leak_predicates: ['no_leak'] } };
const rec = (cell: string, harness: string, task: string, reps: string, usd: number): TrialRecord[] => [...reps].map((ch, i) => record(cell, 'm', task, i + 1, ch === '1', { harness, usage: { ...record(cell, 'm', task, 1, true).usage!, usd } }));
const HB_RECORDS = [
  ...rec('p-oc', 'openclaw', 't1', '10', 0.01), ...rec('p-oc', 'openclaw', 't2', '00', 0.01),
  ...rec('o-oc', 'openclaw', 't1', '11', 0.1), ...rec('o-oc', 'openclaw', 't2', '10', 0.1),
  ...rec('o-cc', 'claude-code', 't1', '11', 0.1), ...rec('o-cc', 'claude-code', 't2', '11', 0.1),
  ...rec('p-he', 'hermes', 't1', '11', 0.01), ...rec('p-he', 'hermes', 't2', '00', 0.01),
];
const HB_SPEC: FrontierSpec = {
  run_id: 'h', seed: 7, draws: 2000, min_paired_tasks: 2,
  models: [{ id: 'opus', label: 'Opus 5.5', home: 'o-cc' }, { id: 'particle', home: 'p-he' }],
  cells: [{ id: 'o-cc', model: 'opus', harness: 'claude-code', attempts: 2 }, { id: 'o-oc', model: 'opus', harness: 'openclaw', attempts: 2 },
    { id: 'p-oc', model: 'particle', harness: 'openclaw', attempts: 2 }, { id: 'p-he', model: 'particle', harness: 'hermes', attempts: 2 }],
  model_swap: { particle: 'particle', frontier: [{ id: 'opus', label: 'Opus 5.5' }], use_cases: [{ id: 'codegen', cells: ['o-cc', 'o-oc', 'p-oc', 'p-he'] }], min_clusters: 2 },
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const BEFORE = {
  model_swap_json: '13dd7600cc203e978e5a1ee1125120be34276ae42af53eb150794da2f0c6ee78',
  model_swap_md: '95bebc984404c6d1db6b29c71a387adb5c24a46eed848b6de747d557f07fcd1d',
  harbor_json: '77d3c21e69dffb6f1cb1a4c104305bb4184c7e79b88a1a639f920497379e4608',
  harbor_md: '58ecf80956f14fcb8964acf01afb78aea9b3d5df3756ffbb3ad64ff844d049af',
  matrix_json: '80db019d536e8495c1889f6e888a060fac799a47e228eaa1633a9c8ff4f3f705',
  matrix_md: 'e1fa4e64f7f8392e3f3db880f860571864ee71530ede823dd08ac3dd2e14c735'
};

describe('low-cost swap: the model_swap output does not change', () => {
  test('model_swap, the Harbor analysis and the multi-user analysis hash to what they were before the block existed', () => {
    const sw = analyzeModelSwap({ cells: SWAP_CELLS, trials: SWAP_TRIALS, leaks: false }, SWAP_SPEC, OPTS);
    const fr = analyzeFrontier({ records: HB_RECORDS, manifest: null }, HB_SPEC);
    const mx = analyzeMatrix({ manifest: MU_MANIFEST, records: MU_RECORDS, eventsOf: () => null, usageRows: null, task_info: MU_TASK_INFO }, MU_SPEC);
    expect({
      model_swap_json: sha(JSON.stringify(sw)), model_swap_md: sha(renderModelSwap(sw).join('\n')),
      harbor_json: sha(JSON.stringify(fr)), harbor_md: sha(renderFrontier(fr)),
      matrix_json: sha(JSON.stringify(mx)), matrix_md: sha(renderMatrix(mx)),
    }).toEqual(BEFORE);
  });

  // A Harbor run with DeepSeek cells beside the particle-1 and Opus ones, dsh as DeepSeek's home harness.
  const dsUsage = (model: string) => ({ ...tokens(model), usd: 0.02 });
  const hb = (cell: string, harness: string, model: string, reps: Record<string, string>) => Object.entries(reps).flatMap(([task, r]) => rec(cell, harness, task, r, 0.01).map((t) => ({ ...t, usage: dsUsage(model) })));
  const records = [...HB_RECORDS, ...hb('d-oc', 'openclaw', ROWS.D, { t1: '11', t2: '10' }), ...hb('d-he', 'hermes', ROWS.D, { t1: '11', t2: '01' }), ...hb('d-dsh', 'dsh', ROWS.D, { t1: '11', t2: '11' }), ...hb('p-dsh', 'dsh', ROWS.P, { t1: '00', t2: '00' })];
  const base: FrontierSpec = { ...HB_SPEC, models: [...HB_SPEC.models, { id: 'deepseek', label: A, home: 'd-dsh' }],
    cells: [...HB_SPEC.cells, { id: 'd-oc', model: 'deepseek', harness: 'openclaw', attempts: 2 }, { id: 'd-he', model: 'deepseek', harness: 'hermes', attempts: 2 }, { id: 'd-dsh', model: 'deepseek', harness: 'dsh', attempts: 2 }, { id: 'p-dsh', model: 'particle', harness: 'dsh', attempts: 2, descriptive: true }] };
  const low: LowCostSwapSpec = { a: 'deepseek', b: 'particle', label_a: A, label_b: B, exclude_harnesses: ['dsh'], use_cases: [{ id: 'codegen', cells: ['d-oc', 'd-he', 'd-dsh', 'p-oc', 'p-he', 'p-dsh', 'o-oc', 'o-cc'] }],
    family: ['codegen', 'personal-brain', 'company-brain'], margin: 0.1, cost_basis: { prices: PRICES, rows: { deepseek: ROWS.D, particle: ROWS.P } }, frontier: ['opus'], min_clusters: 2 };

  test('adding low_cost_swap to a Harbor spec leaves every other field and the Markdown before its section as they were', () => {
    const plain = analyzeFrontier({ records, manifest: null }, base);
    const both = analyzeFrontier({ records, manifest: null }, { ...base, low_cost_swap: low });
    const { low_cost_swap: section, ...rest } = both;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain));
    expect('low_cost_swap' in plain).toBe(false);
    const md = renderFrontier(both), before = renderFrontier(plain);
    expect(md.startsWith(before.slice(0, -1))).toBe(true);
    expect(md.indexOf('## Low-cost swap')).toBeGreaterThan(md.indexOf('## Model swap'));
    // pooled over openclaw and hermes, dsh beside: d openclaw [.5, .5], hermes [0, .5]
    const c = section!.calls[0]!;
    expect(c.harnesses).toEqual(['hermes', 'openclaw']);
    expect(c.d).toBe(0.375);
    expect(c.excluded).toEqual([{ harness: 'dsh', tasks: 2, pairs: 2, clusters: 2, mean_a: 1, mean_b: 0, d: 1, ci95: [1, 1] }]);
    // Opus ran openclaw only: [1, .5] against DeepSeek's [1, .5] there
    expect(c.frontier_gap.map((g) => ('reason' in g ? g.reason : [g.harnesses, g.gap]))).toEqual([[['openclaw'], 0]]);
    // eight DeepSeek trials at $0.273 over six solves
    expect(c.cost.a.usd_per_solve).toBe(Number((8 * 0.273 / 6).toFixed(6)));
  });

  test('a low_cost_swap the Harbor spec gets wrong is refused as a SpecError', () => {
    expect(() => analyzeFrontier({ records, manifest: null }, { ...base, low_cost_swap: { ...low, frontier: ['deepseek'] } })).toThrow(FrontierSpecError);
    expect(() => analyzeFrontier({ records, manifest: null }, { ...base, low_cost_swap: { ...low, cost_basis: { prices: PRICES, rows: { deepseek: 'x:y', particle: ROWS.P } } } })).toThrow(/has no row x:y/);
  });

  test('adding low_cost_swap to a multi-user spec leaves model_swap and the rest as they were', () => {
    const muRecords = [...MU_RECORDS, ...MU_RECORDS.filter((t) => t.cell === 'he-p').map((t) => ({ ...t, trial_id: t.trial_id.replace('he-p', 'he-d'), cell: 'he-d', model: 'D', grade: 'pass' as const, predicates: [], usage: tokens(ROWS.D) }))]
      .map((t) => (t.cell === 'he-p' ? { ...t, usage: tokens(ROWS.P) } : t));
    const manifest: MatrixManifest = { ...MU_MANIFEST, cells: [...MU_MANIFEST.cells, { id: 'he-d', harness: 'hermes', model: 'D' }], trials: muRecords.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })) };
    const spec: MatrixSpec = { ...MU_SPEC, cells: [...MU_SPEC.cells, { id: 'he-d' }] };
    const lowMu: LowCostSwapSpec = { ...SPEC, use_cases: [{ id: 'company-brain', cells: ['he-d', 'he-p', 'he-o'] }], exclude_harnesses: [], frontier: ['O'] };
    const plain = analyzeMatrix({ manifest, records: muRecords, eventsOf: () => null, usageRows: null, task_info: MU_TASK_INFO }, spec);
    const both = analyzeMatrix({ manifest, records: muRecords, eventsOf: () => null, usageRows: null, task_info: MU_TASK_INFO }, { ...spec, low_cost_swap: lowMu });
    const { low_cost_swap: section, ...rest } = both;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain));
    const md = renderMatrix(both);
    expect(md.startsWith(renderMatrix(plain).slice(0, -1))).toBe(true);
    // DeepSeek passes all four, particle-1 two of four: d = .5
    expect(section!.calls[0]).toMatchObject({ id: 'company-brain', harnesses: ['hermes'], d: 0.5 });
    expect(section!.calls[0]!.cost.b_to_a.ratio).toBe(Number(((4 * 0.24 / 2) / (4 * 0.273 / 4)).toFixed(4)));
    expect(md).toContain('## Low-cost swap: DeepSeek-V4.1-Flash-1017 against particle-1 in the same harnesses');
  });
});
