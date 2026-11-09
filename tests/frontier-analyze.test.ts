// scripts/frontier-harbor/analyze.ts: per-cell estimates, pairwise exclusions, flips, Holm within model, the verdict tags
// and the results table, on fixtures small enough to check by hand.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Termination, TrialRecord } from '../runner/contracts.ts';
import { analyzeFrontier, renderMarkdown, SpecError, VERDICTS, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'frontier-test';

// One character per attempt: 1 pass, 0 fail, H harness_error, I infra_error, M model_error.
function cell(id: string, harness: string, tasks: Record<string, string>, usd = 1): TrialRecord[] {
  return Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch, i) => {
    const termination: Termination = ({ H: 'harness_error', I: 'infra_error', M: 'model_error' } as Record<string, Termination>)[ch] ?? 'completed';
    return {
      trial_id: `${RUN}/${id}/${task}/r${i + 1}`, cell: id, task, harness, harness_mode: 'docker', model: 'm', script: null,
      termination, grade: ch === '1' ? 'pass' : termination === 'completed' ? 'fail' : 'n/a', consent_violation: false, approval_stop: false,
      effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [] },
      usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd, input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
      wall_ms: 1000 * (i + 1), started_at: '2026-11-07T00:00:00.000Z', ended_at: '2026-11-07T00:00:01.000Z', paths: {},
    } as TrialRecord;
  }));
}
const repeat = (n: number, s: string, prefix = 't') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${String(i + 1).padStart(2, '0')}`, s]));

describe('hand-computed cell and pair', () => {
  const records = [
    ...cell('opus-cc', 'claude-code', { t1: '11', t2: '10', t3: '11', t4: '00' }, 1),
    ...cell('opus-hermes', 'hermes', { t1: '11', t2: '0I', t3: '01', t4: '00' }, 2),
  ];
  const spec: FrontierSpec = {
    run_id: RUN, seed: 7, draws: 2000, min_paired_tasks: 2, primary_pairs: { opus: 1 },
    models: [{ id: 'opus', label: 'Opus 5.5', home: 'opus-cc' }],
    cells: [{ id: 'opus-cc', model: 'opus', harness: 'claude-code', attempts: 2 }, { id: 'opus-hermes', model: 'opus', harness: 'hermes', attempts: 2 }],
  };
  const a = analyzeFrontier({ records, manifest: null }, spec);
  const cc = a.cells.find((c) => c.id === 'opus-cc')!, he = a.cells.find((c) => c.id === 'opus-hermes')!;
  const pair = a.pairs[0]!;

  test('per-cell task mean, rerun flip, pass^2, pass@2, exclusions', () => {
    expect(cc.pass_rate!.estimate).toBe(0.625);
    expect(cc.rerun_flip!.estimate).toBe(0.25);
    expect(cc.reliability.pass_hat_k!.estimate).toBe(0.5);
    expect(cc.reliability.pass_at_k!.estimate).toBe(0.75);
    expect(he.pass_rate!.estimate).toBe(0.375);
    expect(he.trials.excluded.infra_error).toBe(1);
    expect(he.trials.scored).toBe(7);
    expect(he.rerun_flip!).toMatchObject({ estimate: 0.333333, tasks: 3 });
    expect(he.reliability.pass_hat_k!.estimate).toBe(0.333333);
    expect(he.reliability.pass_at_k!.estimate).toBe(0.666667);
    expect(he.reliability.tasks_with_fewer_than_k).toBe(1);
  });

  test('cost per solve and median wall time (contended)', () => {
    expect(cc.cost).toMatchObject({ usd_total: 8, solves: 5, usd_per_solve: 1.6 });
    expect(he.cost).toMatchObject({ usd_total: 16, solves: 3, usd_per_solve: 5.333333 });
    expect(cc.wall_s_median_contended).toBe(1.5);
  });

  test('cost per solve leaves out the USD of a run a rerun replaced unless cost_with_replaced (merge-stages.ts frontier.replaced_usd)', () => {
    const rows = cell('opus-cc', 'claude-code', { t1: '11', t2: '10', t3: '11', t4: '00' }, 1);
    (rows[0] as TrialRecord & { frontier: object }).frontier = { replaced_usd: 2 };
    const input = { records: [...rows, ...records.filter((t) => t.cell === 'opus-hermes')], manifest: null };
    const cc = (a: ReturnType<typeof analyzeFrontier>) => a.cells.find((x) => x.id === 'opus-cc')!;
    const plain = analyzeFrontier(input, spec);
    expect(cc(plain).cost).toMatchObject({ usd_total: 8, solves: 5, usd_per_solve: 1.6 });
    expect(plain.method.cost).toContain('not a record');
    const all = analyzeFrontier({ ...input, cost_with_replaced: true }, spec);
    expect(cc(all).cost).toMatchObject({ usd_total: 10, solves: 5, usd_per_solve: 2 });
    expect(all.method.cost).toContain('--cost-with-replaced');
  });

  test('cost per solve counts the first run of a rerun its lease stopped with or without cost_with_replaced (merge-stages.ts frontier.first_run_usd)', () => {
    const rows = cell('opus-cc', 'claude-code', { t1: '11', t2: '10', t3: '11', t4: '00' }, 1);
    (rows[0] as TrialRecord & { frontier: object }).frontier = { first_run_usd: 2 };
    const input = { records: [...rows, ...records.filter((t) => t.cell === 'opus-hermes')], manifest: null };
    const cc = (a: ReturnType<typeof analyzeFrontier>) => a.cells.find((x) => x.id === 'opus-cc')!;
    expect(cc(analyzeFrontier(input, spec)).cost).toMatchObject({ usd_total: 10, solves: 5, usd_per_solve: 2 });
    expect(cc(analyzeFrontier({ ...input, cost_with_replaced: true }, spec)).cost).toMatchObject({ usd_total: 10, solves: 5, usd_per_solve: 2 });
  });

  test('the infra attempt drops from both cells of the pair', () => {
    expect(pair.attempts_dropped_pairwise).toBe(1);
    expect(pair.tasks_paired).toBe(4);
    expect(pair.mean_home).toBe(0.75);
    expect(pair.mean_cell).toBe(0.375);
    expect(pair.delta).toBe(-0.375);
    expect(pair.p_two_sided).toBe(0.5);
    expect(pair.p_method).toBe('exact-sign-flip');
    expect(pair.holm_p).toBe(0.5);
    expect(pair.harness_flip!.estimate).toBe(0.375);
    expect(pair.cost_per_solve_ratio.ratio).toBe(3.3333);
  });

  test('plan.ts trial ids (/a<n>) give the attempt number, not the start order', () => {
    const renamed = records.map((t) => ({ ...t, trial_id: t.trial_id.replace(/\/r(\d+)$/, '/a$1'), started_at: t.trial_id.endsWith('/r1') ? '2026-11-07T02:00:00.000Z' : '2026-11-07T01:00:00.000Z' }));
    expect(analyzeFrontier({ records: renamed, manifest: null }, spec).models[0]!.drift).toMatchObject({ attempt_1: 0.75, attempt_2: 0.5 });
  });

  test('drift of the home cell, attempt 2 minus attempt 1, against the threshold', () => {
    expect(a.models[0]!.drift).toMatchObject({ cell: 'opus-cc', tasks: 4, attempt_1: 0.75, attempt_2: 0.5, delta: -0.25, threshold: null, exceeds: null });
    const flagged = analyzeFrontier({ records, manifest: null }, { ...spec, drift_threshold: 0.1 }).models[0]!.drift;
    expect(flagged.exceeds).toBe(true);
    expect(analyzeFrontier({ records, manifest: null }, { ...spec, drift_threshold: 0.25 }).models[0]!.drift.exceeds).toBe(false);
    expect(renderMarkdown(analyzeFrontier({ records, manifest: null }, { ...spec, drift_threshold: 0.1 }))).toContain('**over threshold**');
  });

  test('model noise view and the verdicts', () => {
    expect(a.models[0]!.noise.rerun_flip!.estimate).toBe(0.375);
    expect(a.models[0]!.noise.harness_flip!.estimate).toBe(0.375);
    expect(a.models[0]!.noise.harness_minus_rerun).toBe(0);
    expect(cc.verdict).toBe('home');
    expect(he.verdict).toBe('inconclusive');
  });

  test('task lists: passed every scored attempt in every cell, and never passed in any cell', () => {
    expect(a.tasks).toEqual({ total: 4, passed_every_attempt_in_every_cell: ['t1'], never_passed_in_any_cell: ['t4'] });
    const b = analyzeFrontier({ records, manifest: null, lookup_fails: [`${RUN}/opus-hermes/t1/r1`] }, spec);
    expect(b.tasks.passed_every_attempt_in_every_cell).toEqual([]);
  });
  test('a confirmed answer-key lookup turns a pass into a fail', () => {
    const b = analyzeFrontier({ records, manifest: null, lookup_fails: [`${RUN}/opus-hermes/t1/r1`] }, spec);
    const h = b.cells.find((c) => c.id === 'opus-hermes')!;
    expect(h.trials.lookup_fails).toBe(1);
    expect(h.pass_rate!.estimate).toBe(0.25);
    expect(() => analyzeFrontier({ records, manifest: null, lookup_fails: ['no-such-trial'] }, spec)).toThrow(SpecError);
  });
});

describe('verdict tags', () => {
  const records = [
    ...cell('m-home', 'claude-code', repeat(20, '11')),
    ...cell('m-within', 'hermes', { ...repeat(19, '11'), t20: '10' }),
    ...cell('m-behind', 'openclaw', repeat(20, '00')),
    ...cell('m-sat', 'pi', { ...repeat(17, '11'), t18: '00', t19: '00', t20: '00' }),
    ...cell('x-home', 'codex', repeat(20, '1')),
    ...cell('x-ext', 'pi', repeat(20, '0')),
    ...cell('y-home', 'codex', repeat(20, '1')),
    ...cell('y-short', 'hermes', { t01: '1' }),
  ];
  const spec: FrontierSpec = {
    run_id: RUN, seed: 7, draws: 2000, primary_pairs: { m: 3, x: 0, y: 1 },
    models: [{ id: 'm', label: 'Opus 5.5', home: 'm-home' }, { id: 'x', label: 'GPT-6 Astra', home: 'x-home' }, { id: 'y', label: 'Other', home: 'y-home' }],
    cells: [
      { id: 'm-home', model: 'm', harness: 'claude-code', attempts: 2 }, { id: 'm-within', model: 'm', harness: 'hermes', attempts: 2 },
      { id: 'm-behind', model: 'm', harness: 'openclaw', attempts: 2 }, { id: 'm-sat', model: 'm', harness: 'pi', attempts: 2 },
      { id: 'x-home', model: 'x', harness: 'codex', attempts: 1 }, { id: 'x-ext', model: 'x', harness: 'pi', attempts: 1, descriptive: true },
      { id: 'y-home', model: 'y', harness: 'codex', attempts: 1 }, { id: 'y-short', model: 'y', harness: 'hermes', attempts: 1 },
    ],
  };
  const a = analyzeFrontier({ records, manifest: null }, spec);
  const v = (id: string) => a.cells.find((c) => c.id === id)!.verdict;

  test('each rule in its order', () => {
    expect(v('m-home')).toBe('home');
    expect(v('m-behind')).toBe('behind');
    expect(v('m-within')).toBe('within-15');
    expect(v('m-sat')).toBe('saturated');
    expect(v('x-ext')).toBe('descriptive');
    expect(v('y-short')).toBe('incomplete');
    const p = a.pairs.find((x) => x.cell === 'm-within')!;
    expect(p.holm_p_noninferiority!).toBeLessThanOrEqual(0.05);
    expect(p.lower_bound_90!).toBeGreaterThan(-0.15);
    expect(a.pairs.find((x) => x.cell === 'x-ext')!.holm_p).toBeNull();
  });

  test('an unstarted planned trial makes the cell incomplete', () => {
    const small = records.filter((t) => t.cell.startsWith('m-'));
    const manifest = { run_id: RUN, cells: spec.cells.filter((c) => c.model === 'm').map((c) => ({ id: c.id })),
      trials: [...small.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })), { id: `${RUN}/m-sat/t21/r1`, cell: 'm-sat', task: 't21' }] };
    const b = analyzeFrontier({ records: small, manifest }, { ...spec, primary_pairs: { m: 3 }, models: [spec.models[0]!], cells: spec.cells.filter((c) => c.model === 'm') });
    expect(b.cells.find((c) => c.id === 'm-sat')!.verdict).toBe('incomplete');
    expect(b.complete).toBe(false);
    expect(b.trials_unstarted).toBe(1);
  });

  test('the spec is checked', () => {
    expect(() => analyzeFrontier({ records, manifest: null }, { ...spec, primary_pairs: { m: 2 } })).toThrow(/preregisters 2/);
    expect(() => analyzeFrontier({ records, manifest: null }, { ...spec, models: [{ id: 'm', home: 'x-home' }, ...spec.models.slice(1)] })).toThrow(/a cell of model x/);
    expect(() => analyzeFrontier({ records, manifest: null }, { ...spec, cells: [...spec.cells, { id: 'z', model: 'nope', harness: 'pi', attempts: 1 }] })).toThrow(/does not define/);
  });

  test('the markdown states every rule and lays harnesses out against models', () => {
    const md = renderMarkdown(a);
    for (const tag of VERDICTS) expect(md).toContain(`- **${tag}**:`);
    expect(md).toContain('| Harness | Opus 5.5 | GPT-6 Astra | Other |');
    expect(md).toMatch(/\| openclaw \| 0\.0% \[0\.0%, 0\.0%\]<br>no solve<br>1\.5 s median \(contended\)<br>\*\*behind\*\* \| not run \| not run \|/);
    expect(md).toContain('$1.0000 per solve [$1.0000, $1.0000]');
    expect(md).not.toMatch(/\u2014/);
  });
});

describe('CLI', () => {
  test('writes analysis.json and analysis.md from a results directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-analyze-'));
    const records = [...cell('a-home', 'claude-code', repeat(12, '10')), ...cell('a-pi', 'pi', repeat(12, '11'))];
    writeFileSync(join(dir, 'trials.jsonl'), records.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const spec: FrontierSpec = { run_id: RUN, draws: 1000, models: [{ id: 'a', home: 'a-home' }], cells: [{ id: 'a-home', model: 'a', harness: 'claude-code', attempts: 2 }, { id: 'a-pi', model: 'a', harness: 'pi', attempts: 2 }] };
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/frontier-harbor/analyze.ts'), '--results', dir, '--spec', join(dir, 'spec.json')], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmpdir() } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('FRONTIER_ANALYSIS: frontier-test: 2 cells, 1 pairs, 48 trials recorded');
    const out = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
    expect(out.cells.find((c: { id: string }) => c.id === 'a-pi').verdict).toBe('within-15');
    expect(readFileSync(join(dir, 'analysis.md'), 'utf8')).toContain('# Frontier harness analysis: frontier-test');
    const bad = spawnSync(process.execPath, [join(ROOT, 'scripts/frontier-harbor/analyze.ts'), '--results', dir, '--spec', join(dir, 'spec.json'), '--lookup-fails', join(dir, 'spec.json')], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmpdir() } });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('refused');
  });
});
