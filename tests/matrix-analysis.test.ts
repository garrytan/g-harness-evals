// scripts/matrix-analysis.ts (internal-task, plan decision 8): the task-mean estimator with unequal repetitions, tasks missing
// from a cell, symmetric fault handling, Holm across exactly the preregistered primary family, floor and ceiling counts
// with the H3 inconclusive rule, and an incomplete run merged with scripts/merge-shards.ts --partial and then analysed.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Termination, TrialRecord } from '../runner/contracts.ts';
import { analyzeMatrix, holmFamily, loadResults, renderMarkdown, SpecError, type MatrixManifest, type MatrixSpec } from '../scripts/matrix-analysis.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'matrix-test';
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };

// One character per repetition: 1 pass, 0 fail, H harness_error, M model_error, I infra_error, E exam_fault,
// C graded pass with a consent violation.
function cell(id: string, tasks: Record<string, string>, extra: Partial<TrialRecord> = {}): TrialRecord[] {
  return Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch, i) => {
    const termination: Termination = ({ H: 'harness_error', M: 'model_error', I: 'infra_error', E: 'exam_fault' } as Record<string, Termination>)[ch] ?? 'completed';
    return {
      trial_id: `${RUN}/${id}/${task}/r${i + 1}`, cell: id, task, harness: id.split('-')[0]!, harness_mode: 'process', model: 'anthropic:claude-opus-5-5', script: null,
      termination, grade: ch === '1' || ch === 'C' ? 'pass' : termination === 'completed' ? 'fail' : 'n/a', consent_violation: ch === 'C', approval_stop: false,
      effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [0] }, usage: null, wall_ms: 1000 * (i + 1),
      started_at: '2026-11-01T00:00:00.000Z', ended_at: '2026-11-01T00:00:01.000Z', paths: {}, ...extra,
    } as TrialRecord;
  }));
}

const manifestFor = (records: TrialRecord[], unstarted: Array<{ id: string; cell: string; task: string }> = []): MatrixManifest => ({
  run_id: RUN,
  cells: [...new Set([...records.map((t) => t.cell), ...unstarted.map((t) => t.cell)])].map((id) => ({ id, harness: id.split('-')[0] })),
  trials: [...records.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })), ...unstarted],
});

const specFor = (cells: string[], o: Partial<MatrixSpec> = {}): MatrixSpec => {
  const [a, b] = cells;
  return {
    run_id: RUN, seed: 7, draws: 2000, primary_family_size: 6, cells: cells.map((id) => ({ id })),
    primary: Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, a: a!, b: b! })), ...o,
  };
};

const analyze = (records: TrialRecord[], spec: MatrixSpec, manifest: MatrixManifest = manifestFor(records)) =>
  analyzeMatrix({ manifest, records, eventsOf: () => null, usageRows: null }, spec);

describe('matrix-analysis (internal-task)', () => {
  test('unequal repetitions: 4 against 5 reps, each task weighted once (task mean, not the pooled trial rate)', () => {
    const records = [...cell('cc-opus', { t1: '1000', t2: '1111', t3: '0000' }), ...cell('oc-opus', { t1: '11111', t2: '10000', t3: '11000' })];
    const a = analyze(records, specFor(['cc-opus', 'oc-opus']));
    const [cc, oc] = a.cells;
    expect(cc!.reps_per_task).toEqual({ min: 4, max: 4 });
    expect(oc!.reps_per_task).toEqual({ min: 5, max: 5 });
    expect(cc!.pass_rate!.estimate).toBeCloseTo((0.25 + 1 + 0) / 3, 6);
    expect(oc!.pass_rate!.estimate).toBeCloseTo((1 + 0.2 + 0.4) / 3, 6);
    const p = a.primary.comparisons[0]!;
    expect(p.tasks_paired).toBe(3);
    expect(p.tasks_dropped).toBe(0);
    expect(p.delta!).toBeCloseTo(((1 - 0.25) + (0.2 - 1) + (0.4 - 0)) / 3, 6);
    expect(p.ci95).not.toBeNull();
    expect(p.ci95![0]).toBeLessThanOrEqual(p.delta!);
    expect(p.ci95![1]).toBeGreaterThanOrEqual(p.delta!);
    expect(a.method.estimator).toContain('task-mean estimator');
    expect(a.method.estimator).toContain('clusteredPairedDelta');
  });

  test('missing tasks: a task absent from one cell, or with no scored trial there, drops from that comparison and is counted', () => {
    const records = [...cell('cc-opus', { t1: '11', t2: '10', t3: '00', t4: '11' }), ...cell('oc-opus', { t1: '10', t2: '11', t4: 'MI' })];
    const a = analyze(records, specFor(['cc-opus', 'oc-opus']));
    const p = a.primary.comparisons[0]!;
    expect(p.tasks_paired).toBe(2);
    expect(p.tasks_dropped).toBe(2);
    expect(p.dropped).toEqual([{ task: 't3', reason: 'no scored trial in oc-opus' }, { task: 't4', reason: 'no scored trial in oc-opus' }]);
    expect(p.mean_a).toBeCloseTo(0.75, 6);
    expect(p.mean_b).toBeCloseTo(0.75, 6);
    expect(a.cells[1]!.pass_rate!.tasks).toBe(2);
  });

  test('symmetric faults: harness_error is a fail on either side; model_error, infra_error and exam_fault are excluded and counted; a consent violation is a fail', () => {
    const records = [...cell('cc-opus', { t1: '1H', t2: '1M', t3: 'C1' }), ...cell('oc-opus', { t1: 'H1', t2: 'I1', t3: '1E' })];
    const a = analyze(records, specFor(['cc-opus', 'oc-opus']));
    const [cc, oc] = a.cells;
    expect(cc!.trials.excluded).toEqual({ model_error: 1, infra_error: 0, exam_fault: 0 });
    expect(oc!.trials.excluded).toEqual({ model_error: 0, infra_error: 1, exam_fault: 1 });
    expect(cc!.trials.harness_error_as_fail).toBe(1);
    expect(oc!.trials.harness_error_as_fail).toBe(1);
    expect(cc!.trials.scored).toBe(5);
    expect(oc!.trials.scored).toBe(4);
    expect(cc!.pass_rate!.estimate).toBeCloseTo((0.5 + 1 + 0.5) / 3, 6);
    expect(oc!.pass_rate!.estimate).toBeCloseTo((0.5 + 1 + 1) / 3, 6);
    expect(cc!.terminations.harness_error).toBe(1);
    expect(a.faults).toEqual({ scored_as_fail: ['harness_error'], excluded_with_counts: ['model_error', 'infra_error', 'exam_fault'], pass: 'grade pass with no consent violation' });
  });

  test('Holm runs across exactly the 6 preregistered primary comparisons, step-down; secondaries carry no test; a failure is "can\'t tell apart"', () => {
    const tasks = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, '0000']));
    const winners = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, '11111']));
    const ids = ['cc-opus', 'oc-opus', 'he-opus', 'cx-sol', 'oc-sol', 'he-sol'];
    const records = [...cell('cc-opus', tasks), ...cell('oc-opus', winners), ...ids.slice(2).flatMap((id) => cell(id, tasks))];
    const primary = [
      { id: 'opus:cc-vs-oc', a: 'cc-opus', b: 'oc-opus' }, { id: 'opus:cc-vs-he', a: 'cc-opus', b: 'he-opus' }, { id: 'opus:oc-vs-he', a: 'oc-opus', b: 'he-opus' },
      { id: 'sol:cx-vs-oc', a: 'cx-sol', b: 'oc-sol' }, { id: 'sol:cx-vs-he', a: 'cx-sol', b: 'he-sol' }, { id: 'sol:oc-vs-he', a: 'oc-sol', b: 'he-sol' },
    ];
    const spec = specFor(ids, { primary, secondary: [{ id: 'oc:opus-vs-sol', a: 'oc-opus', b: 'oc-sol' }] });
    const a = analyze(records, spec);
    expect(a.primary.holm_family_size).toBe(6);
    expect(a.primary.comparisons.map((c) => c.id)).toEqual(primary.map((c) => c.id));
    const first = a.primary.comparisons[0]!;
    expect(first.p_two_sided).toBeCloseTo(2 / 1024, 8);
    expect(first.holm_p).toBeCloseTo(6 * 2 / 1024, 8);
    expect(first.verdict).toBe('oc-opus higher');
    const second = a.primary.comparisons[1]!;
    expect(second.verdict).toBe("can't tell apart");
    expect(a.primary.comparisons.filter((c) => c.verdict === "can't tell apart")).toHaveLength(4);
    expect(a.primary.comparisons[2]!.verdict).toBe('oc-opus higher');
    for (const c of a.primary.comparisons) expect(c.verdict).not.toMatch(/tie/i);
    expect(a.secondary[0]).not.toHaveProperty('holm_p');
    expect(a.secondary[0]).not.toHaveProperty('p_two_sided');
    expect(a.secondary[0]!.label).toContain('secondary');
    expect(() => analyze(records, { ...spec, primary: primary.slice(0, 5) })).toThrow(SpecError);
    expect(() => analyze(records, { ...spec, primary: [...primary, { id: 'extra', a: 'cc-opus', b: 'he-opus' }] })).toThrow(/7 comparison\(s\); the spec preregisters 6/);
    expect(() => analyze(records, { ...spec, cells: [...spec.cells, { id: 'qm-opus' }] })).toThrow(/qm-opus is not in the run's manifest/);
    expect(() => analyze(records, { ...spec, run_id: 'other-run' })).toThrow(/spec run_id other-run is not the manifest's matrix-test/);
    expect(() => analyze(records, { ...spec, secondary: [{ id: 'opus:cc-vs-oc', a: 'cc-opus', b: 'he-opus' }] })).toThrow(/id opus:cc-vs-oc used twice/);
    expect(() => analyze(records, { ...spec, secondary: [{ id: 'self', a: 'cc-opus', b: 'cc-opus' }] })).toThrow(/compares cc-opus with itself/);
    expect(() => analyze(records, { ...spec, drop_differences: [{ id: 'h3', a: 'drop:none', b: 'drop:other' }] })).toThrow(/names drop:none, which the spec does not define/);
    expect(() => analyze(records, { ...spec, draws: 10 })).toThrow(/draws must be an integer of at least 1000/);
    expect(() => analyze(records, { ...spec, alpha: 1.5 })).toThrow(/alpha must be between 0 and 1/);

    // Step-down: 0.012 sits under its own threshold (0.05 / 4) but is not rejected, because the step before it failed.
    const h = holmFamily([0.001, 0.011, 0.012, 0.3, 0.5, 0.9], 0.05);
    expect(h.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h.map((x) => x.rejected)).toEqual([true, false, false, false, false, false]);
    expect(h[2]!.threshold).toBeCloseTo(0.0125, 10);
    expect(h[1]!.holm_p).toBeCloseTo(0.055, 10);
    expect(h[2]!.holm_p).toBeCloseTo(0.055, 10);
    const order = holmFamily([0.04, 0.001, 0.2, 0.009, 0.012, 0.011], 0.05);
    expect(order.map((x) => x.step)).toEqual([5, 1, 6, 2, 4, 3]);
    expect(order.map((x) => x.rejected)).toEqual([false, true, false, true, true, true]);
  });

  test('a primary comparison with no paired task counts as p = 1 inside the family and is "can\'t tell apart"', () => {
    const records = [...cell('cc-opus', { t1: '11' }), ...cell('oc-opus', { t2: '00' })];
    const a = analyze(records, specFor(['cc-opus', 'oc-opus']));
    const p = a.primary.comparisons[0]!;
    expect(p.tasks_paired).toBe(0);
    expect(p.delta).toBeNull();
    expect(p.holm_p).toBe(1);
    expect(p.verdict).toBe("can't tell apart");
  });

  test('floor and ceiling counts; H3 is inconclusive under 8 informative tasks and estimated at 8; ceiling warning over half', () => {
    // Twelve tasks. In both OpenClaw cells t0..t5 pass every rep (uninformative); t6..t11 move. Hermes: t0..t2 fail in both
    // cells. Informative in both drops: t6..t11, six tasks.
    const ocFront: Record<string, string> = {}, ocCheap: Record<string, string> = {}, heFront: Record<string, string> = {}, heCheap: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      const t = `t${i}`;
      ocFront[t] = i < 6 ? '1111' : i < 9 ? '1111' : '1100';
      ocCheap[t] = i < 6 ? '11111' : '10000';
      heFront[t] = i < 3 ? '0000' : '1100';
      heCheap[t] = i < 3 ? '00000' : '10000';
    }
    const records = [...cell('oc-opus', ocFront), ...cell('oc-particle', ocCheap), ...cell('he-opus', heFront), ...cell('he-particle', heCheap)];
    const ids = ['oc-opus', 'oc-particle', 'he-opus', 'he-particle'];
    const drops = [{ id: 'drop:oc', frontier: 'oc-opus', cheap: 'oc-particle' }, { id: 'drop:he', frontier: 'he-opus', cheap: 'he-particle' }];
    const spec = specFor(ids, { drops, drop_differences: [{ id: 'h3:oc-vs-he', a: 'drop:oc', b: 'drop:he' }] });
    const a = analyze(records, spec);
    const byId = Object.fromEntries(a.cells.map((c) => [c.id, c]));
    expect(byId['oc-opus']!.ceiling_tasks).toBe(9);
    expect(byId['oc-opus']!.floor_tasks).toBe(0);
    expect(byId['oc-particle']!.ceiling_tasks).toBe(6);
    expect(byId['he-opus']!.floor_tasks).toBe(3);
    expect(byId['he-particle']!.floor_tasks).toBe(3);
    const [oc, he] = a.drops;
    expect(oc!.all_tasks.tasks_paired).toBe(12);
    expect(oc!.informative_tasks.tasks_paired).toBe(6);
    expect(oc!.frontier_ceiling_tasks).toBe(9);
    expect(oc!.ceiling_warning).toBe(true);
    expect(he!.informative_tasks.tasks_paired).toBe(9);
    expect(he!.ceiling_warning).toBe(false);
    expect(oc!.all_tasks.delta!).toBeCloseTo((3 * (1 - 0.2) + 3 * (0.5 - 0.2)) / 12, 6);
    const h3 = a.drop_differences[0]!;
    expect(h3.tasks_in_all_four_cells).toBe(12);
    expect(h3.informative_tasks).toBe(6);
    expect(h3.informative.tasks_paired).toBe(6);
    expect(h3.status).toBe('inconclusive');
    expect(h3.reason).toBe('6 informative task(s), fewer than 8');
    const relaxed = analyze(records, { ...spec, h3_min_informative_tasks: 6 });
    expect(relaxed.drop_differences[0]!.status).toBe('estimated');

    // With eight informative tasks in both drops, the default rule estimates.
    const wide: Record<string, string> = {}, wideCheap: Record<string, string> = {};
    for (let i = 0; i < 8; i++) { wide[`t${i}`] = '1100'; wideCheap[`t${i}`] = '10000'; }
    const r8 = [...cell('oc-opus', wide), ...cell('oc-particle', wideCheap), ...cell('he-opus', wide), ...cell('he-particle', wideCheap)];
    const e = analyze(r8, spec);
    expect(e.drop_differences[0]!.informative_tasks).toBe(8);
    expect(e.drop_differences[0]!.status).toBe('estimated');
  });

  test('world-MCP use per cell counts via "mcp" events per trial with the event-log denominator', () => {
    const records = [...cell('cc-opus', { t1: '10' }), ...cell('oc-opus', { t1: '11' })];
    const mcp = { via: 'mcp' } as const, slack = { via: 'slack' } as const;
    const logs: Record<string, unknown[] | null> = {
      [`${RUN}/cc-opus/t1/r1`]: [mcp, mcp, slack], [`${RUN}/cc-opus/t1/r2`]: [slack],
      [`${RUN}/oc-opus/t1/r1`]: [mcp], [`${RUN}/oc-opus/t1/r2`]: null,
    };
    const a = analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: (t) => logs[t.trial_id] as never, usageRows: null }, specFor(['cc-opus', 'oc-opus']));
    expect(a.cells[0]!.world_mcp).toEqual({ trials: 2, trials_with_event_log: 2, calls: 2, calls_per_trial: 1, trials_with_call: 1, share_with_call: 0.5 });
    expect(a.cells[1]!.world_mcp).toEqual({ trials: 2, trials_with_event_log: 1, calls: 1, calls_per_trial: 1, trials_with_call: 1, share_with_call: 1 });
  });

  test('an incomplete shard (cap stop) merges with merge-shards --partial and is analysed from what exists: unstarted ids listed, nothing backfilled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-partial-'));
    const full = cell('cc-opus', { t1: '11', t2: '10', t3: '00' });
    const usage = (t: TrialRecord, usd: number) => ({ ...t, usage: { meter_id: `trial-token:${t.trial_id}`, requests: 1, refused: 0, failed: 0, usd, input_tokens: 1000, output_tokens: 10, cached_tokens: 0, unpriced: 0, by_model: { 'anthropic:claude-opus-5-5': { usd, requests: 1 } }, upstream: null } });
    const shardA = full.map((t) => usage(t, 0.0042));
    const planB = cell('oc-opus', { t1: '11', t2: '10', t3: '00' });
    const shardB = [usage(planB[0]!, 0.0042), { ...usage(planB[1]!, 0), termination: 'model_error', grade: 'n/a', cap_stop: true } as TrialRecord];
    const manifest = { ...manifestFor([...full, ...planB]), created_at: '2026-11-01T00:00:00.000Z' };
    const row = (t: TrialRecord) => ({ at: t.started_at + t.trial_id, key: `trial-token:${t.trial_id}`, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', status: 200, actual_usd: 0.0042, input_tokens: 1000, output_tokens: 10, cached_tokens: 0 });
    for (const [name, rows] of [['a', shardA], ['b', shardB]] as const) {
      const d = join(dir, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(d, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
      writeFileSync(join(d, 'proxy-usage.ndjson'), rows.filter((t) => t.usage!.usd > 0).map((t) => JSON.stringify(row(t))).join('\n') + '\n'
        + JSON.stringify({ at: 'x', key: `trial-token:${rows[0]!.trial_id}`, provider: 'openai', route: '/v1/models', model: null, outcome: 'forwarded', status: 200, actual_usd: 0 }) + '\n'
        + (name === 'b' ? JSON.stringify({ at: planB[1]!.started_at, key: `trial-token:${planB[1]!.trial_id}`, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'refused', reason: 'trial-token over its $0.50 budget', actual_usd: 0 }) + '\n' : ''));
      for (const t of rows) {
        const td = join(d, 'trials', ...t.trial_id.split('/').slice(1));
        mkdirSync(td, { recursive: true });
        writeFileSync(join(td, 'events.jsonl'), JSON.stringify({ seq: 1, via: 'mcp', tool: 'conversations.history' }) + '\n');
      }
    }
    const merge = (out: string, extra: string[]) => spawnSync(process.execPath, ['scripts/merge-shards.ts', '--out', out, '--shard', `a=${join(dir, 'a')}`, '--shard', `b=${join(dir, 'b')}`, ...extra], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const refused = merge(join(dir, 'strict'), []);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('4 manifest trial(s) in no shard');
    expect(refused.stderr).toContain('merged with --partial');
    expect(existsSync(join(dir, 'strict', 'trials.jsonl'))).toBe(false);

    const merged = join(dir, 'merged');
    const ok = merge(merged, ['--partial']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('Partial merge: 4 manifest trial(s) unstarted');
    const unstartedIds = planB.slice(2).map((t) => t.trial_id);
    expect(JSON.parse(readFileSync(join(merged, 'unstarted.json'), 'utf8'))).toEqual({ run_id: RUN, count: 4, trials: unstartedIds.map((id) => ({ id, cell: 'oc-opus' })), cap_stops: [{ cell: 'oc-opus', shard: 'b', cap_stop_trial: planB[1]!.trial_id }] });
    const lines = readFileSync(join(merged, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as TrialRecord);
    expect(lines.map((t) => t.trial_id)).toEqual([...shardA, ...shardB].map((t) => t.trial_id));

    const spec = join(dir, 'spec.json');
    writeFileSync(spec, JSON.stringify(specFor(['cc-opus', 'oc-opus'])));
    const res = spawnSync(process.execPath, ['scripts/matrix-analysis.ts', '--results', merged, '--spec', spec], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('**Incomplete run.** 8 of 12 planned trials recorded; 4 never started');
    const a = JSON.parse(readFileSync(join(merged, 'matrix-analysis.json'), 'utf8'));
    expect(a.complete).toBe(false);
    expect(a.trials_recorded).toBe(8);
    expect(a.trials_unstarted).toBe(4);
    expect(a.unstarted).toEqual({ 'oc-opus': unstartedIds });
    const oc = a.cells.find((c: { id: string }) => c.id === 'oc-opus');
    expect(oc.trials).toEqual({ planned: 6, recorded: 2, scored: 1, excluded: { model_error: 1, infra_error: 0, exam_fault: 0 }, harness_error_as_fail: 0, cap_stop: 1, unstarted: unstartedIds });
    expect(oc.pass_rate.tasks).toBe(1);
    expect(a.primary.comparisons[0].tasks_paired).toBe(1);
    expect(a.primary.comparisons[0].dropped).toEqual([{ task: 't2', reason: 'no scored trial in oc-opus' }, { task: 't3', reason: 'no scored trial in oc-opus' }]);
    expect(a.cost_split.status).toBe('reconciled');
    expect(a.cells[0].cache_write_share).toBe(0);
    expect(oc.world_mcp).toEqual({ trials: 2, trials_with_event_log: 2, calls: 2, calls_per_trial: 1, trials_with_call: 2, share_with_call: 1 });
    expect(readFileSync(join(merged, 'matrix-analysis.md'), 'utf8')).toContain(`- oc-opus (4): ${unstartedIds.join(', ')}`);
  });

  test('a cell whose VM was lost merges with --partial --vm-lost and no trial: listed in vm_lost, its comparisons untested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-vm-lost-'));
    const full = cell('cc-opus', { t1: '11', t2: '10', t3: '00' });
    const lost = cell('oc-opus', { t1: '11', t2: '10', t3: '00' });
    const manifest = { ...manifestFor([...full, ...lost]), created_at: '2026-11-01T00:00:00.000Z' };
    for (const [name, rows] of [['a', full], ['b', lost.slice(0, 2)]] as const) {
      const d = join(dir, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(d, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
      writeFileSync(join(d, 'proxy-usage.ndjson'), '');
    }
    const merge = (out: string, shards: string[], extra: string[]) => spawnSync(process.execPath, ['scripts/merge-shards.ts', '--out', join(dir, out), ...shards.flatMap((s) => ['--shard', `${s}=${join(dir, s)}`]), ...extra], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const noFlag = merge('no-flag', ['a'], ['--partial']);
    expect(noFlag.status).toBe(2);
    expect(noFlag.stderr).toContain('oc-opus (no recorded trial)');
    const noPartial = merge('no-partial', ['a'], ['--vm-lost', 'oc-opus']);
    expect(noPartial.status).toBe(2);
    expect(noPartial.stderr).toContain('--vm-lost needs --partial');
    const withRecords = merge('with-records', ['a', 'b'], ['--partial', '--vm-lost', 'oc-opus']);
    expect(withRecords.status).toBe(2);
    expect(withRecords.stderr).toContain('--vm-lost cell(s) oc-opus have recorded trials');
    const unknown = merge('unknown', ['a'], ['--partial', '--vm-lost', 'qm-opus']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('not in the manifest: qm-opus');

    const ok = merge('merged', ['a'], ['--partial', '--vm-lost', 'oc-opus']);
    expect(ok.status).toBe(0);
    const merged = join(dir, 'merged');
    expect(JSON.parse(readFileSync(join(merged, 'unstarted.json'), 'utf8'))).toEqual({ run_id: RUN, count: 6, trials: lost.map((t) => ({ id: t.trial_id, cell: 'oc-opus' })), cap_stops: [], vm_lost: ['oc-opus'] });
    expect(Object.keys(JSON.parse(readFileSync(join(merged, 'shards.json'), 'utf8')).shards)).toEqual(['a']);
    const spec = join(dir, 'spec.json');
    writeFileSync(spec, JSON.stringify(specFor(['cc-opus', 'oc-opus'])));
    const res = spawnSync(process.execPath, ['scripts/matrix-analysis.ts', '--results', merged, '--spec', spec], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(res.status).toBe(0);
    const a = JSON.parse(readFileSync(join(merged, 'matrix-analysis.json'), 'utf8'));
    expect(a.cells.find((c: { id: string }) => c.id === 'oc-opus').trials.recorded).toBe(0);
    expect(a.primary.comparisons[0].tested).toBe(false);
    expect(a.primary.comparisons[0].tasks_paired).toBe(0);
  });
test('the CLI refuses a sealed run and a results directory with no manifest.json, writing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-refuse-'));
    const records = cell('cc-opus', { t1: '1' });
    const spec = join(dir, 'spec.json');
    writeFileSync(spec, JSON.stringify(specFor(['cc-opus', 'oc-opus'], { primary_family_size: 1, primary: [{ id: 'p1', a: 'cc-opus', b: 'oc-opus' }] })));
    const sealed = join(dir, 'sealed');
    mkdirSync(sealed);
    writeFileSync(join(sealed, 'manifest.json'), JSON.stringify({ ...manifestFor([...records, ...cell('oc-opus', { t1: '0' })]), sealed: { set: 'v0.3' } }));
    writeFileSync(join(sealed, 'trials.jsonl'), records.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const run = (results: string) => spawnSync(process.execPath, ['scripts/matrix-analysis.ts', '--results', results, '--spec', spec], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const s = run(sealed);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain('was planned with a sealed root');
    expect(s.stdout).not.toContain('t1');
    expect(existsSync(join(sealed, 'matrix-analysis.json'))).toBe(false);
    const bare = join(dir, 'bare');
    mkdirSync(bare);
    writeFileSync(join(bare, 'trials.jsonl'), records.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const b = run(bare);
    expect(b.status).toBe(2);
    expect(b.stderr).toContain('the results directory must hold manifest.json');
    expect(b.stdout).toBe('');
    expect(existsSync(join(bare, 'matrix-analysis.json'))).toBe(false);
  });

  test('merge-shards --partial needs each incomplete cell to end on its own cap stop', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-partial-cells-'));
    const cc = cell('cc-opus', { t1: '11', t2: '11' });
    const oc = cell('oc-opus', { t1: '11', t2: '11' });
    const capped = { ...cc[1]!, termination: 'model_error', grade: 'n/a', cap_stop: true } as TrialRecord;
    const manifest = manifestFor([...cc, ...oc]);
    const write = (name: string, rows: TrialRecord[] | null) => {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, 'manifest.json'), JSON.stringify(manifest));
      if (rows) writeFileSync(join(dir, name, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    };
    const merge = (out: string, a: string, b: string, extra: string[]) => spawnSync(process.execPath, ['scripts/merge-shards.ts', '--out', join(dir, out), '--shard', `a=${join(dir, a)}`, '--shard', `b=${join(dir, b)}`, ...extra], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const refusal = (at: string) => JSON.stringify({ at, key: `trial-token:${capped.trial_id}`, outcome: 'refused', reason: 'trial-token over its $0.50 budget', actual_usd: 0 }) + '\n';
    write('a-capped', [cc[0]!, capped]);
    writeFileSync(join(dir, 'a-capped', 'proxy-usage.ndjson'), refusal('2026-10-31T23:00:00.000Z'));
    write('b-full', oc);
    const earlierOnly = merge('earlier-only', 'a-capped', 'b-full', ['--partial']);
    expect(earlierOnly.status).toBe(2);
    expect(earlierOnly.stderr).toContain(`cc-opus (last record ${capped.trial_id} has cap_stop, but shard a's proxy-usage.ndjson shows no cap refusal for it at or after its started_at)`);
    expect(existsSync(join(dir, 'earlier-only', 'trials.jsonl'))).toBe(false);
    writeFileSync(join(dir, 'a-capped', 'proxy-usage.ndjson'), refusal('2026-10-31T23:00:00.000Z') + refusal(capped.started_at));
    write('b-empty', null);
    expect(merge('strict', 'a-capped', 'b-empty', []).stderr).toContain('trials.jsonl is missing');
    expect(merge('strict-partial', 'a-capped', 'b-empty', ['--partial']).stderr).toContain('trials.jsonl is missing');
    write('b-none', []);
    const lost = merge('lost', 'a-capped', 'b-none', ['--partial']);
    expect(lost.status).toBe(2);
    expect(lost.stderr).toContain('1 cell(s) with unstarted trials show no cap stop: oc-opus (no recorded trial)');
    expect(existsSync(join(dir, 'lost', 'trials.jsonl'))).toBe(false);
    write('b-crashed', [oc[0]!]);
    const crashed = merge('crashed', 'a-capped', 'b-crashed', ['--partial']);
    expect(crashed.status).toBe(2);
    expect(crashed.stderr).toContain(`oc-opus (last record ${oc[0]!.trial_id} is not a cap stop)`);
    const hole = { ...oc[2]!, termination: 'model_error', grade: 'n/a', cap_stop: true } as TrialRecord;
    write('b-hole', [oc[0]!, hole]);
    const holed = merge('holed', 'a-capped', 'b-hole', ['--partial']);
    expect(holed.status).toBe(2);
    expect(holed.stderr).toContain(`oc-opus (${oc[1]!.trial_id} is missing but the later ${hole.trial_id} was recorded)`);
    const ok = merge('merged', 'a-capped', 'b-full', ['--partial']);
    expect(ok.status).toBe(0);
    const unstarted = JSON.parse(readFileSync(join(dir, 'merged', 'unstarted.json'), 'utf8'));
    expect(unstarted.trials).toEqual(cc.slice(2).map((t) => ({ id: t.trial_id, cell: 'cc-opus' })));
    expect(unstarted.cap_stops).toEqual([{ cell: 'cc-opus', shard: 'a', cap_stop_trial: capped.trial_id }]);
    mkdirSync(join(dir, 'stale'));
    writeFileSync(join(dir, 'stale', 'unstarted.json'), '{}\n');
    const stale = merge('stale', 'a-capped', 'b-full', ['--partial']);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain('already holds unstarted.json from an earlier merge');
  });

  test('records are checked against the manifest before scoring: duplicates, unplanned trials and cell or task mismatches are refused', () => {
    const records = [...cell('cc-opus', { t1: '10' }), ...cell('oc-opus', { t1: '11' })];
    const spec = specFor(['cc-opus', 'oc-opus']);
    const manifest = manifestFor(records);
    expect(() => analyze([...records, records[0]!], spec, manifest)).toThrow(/trial matrix-test\/cc-opus\/t1\/r1 is recorded twice/);
    expect(() => analyze([...records, ...cell('cc-opus', { t9: '1' })], spec, manifest)).toThrow(/trial matrix-test\/cc-opus\/t9\/r1 is not in the manifest/);
    expect(() => analyze([{ ...records[0]!, task: 't2' }, ...records.slice(1)], spec, manifest)).toThrow(/is recorded as cell cc-opus, task t2; the manifest plans cell cc-opus, task t1/);
  });

  test('a primary comparison with fewer than 10 paired tasks keeps its estimate but is not tested', () => {
    const lose = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i}`, '0000']));
    const win = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i}`, '1111']));
    const a = analyze([...cell('cc-opus', lose), ...cell('oc-opus', win)], specFor(['cc-opus', 'oc-opus']));
    const p = a.primary.comparisons[0]!;
    expect(p.delta).toBe(1);
    expect(p.p_two_sided).toBeCloseTo(2 / 256, 8);
    expect(p.tested).toBe(false);
    expect(p.holm_p).toBe(1);
    expect(p.verdict).toBe("can't tell apart");
    expect(p.untested_reason).toContain('fewer than 10 paired tasks');
  });

  test('earlier-attempt spend counts in USD total and per pass; a cell whose trial does not reconcile loses only its own cache-write share', () => {
    const cc = cell('cc-opus', { t1: '1' }, { started_at: '2026-11-01T01:00:00.000Z' });
    const oc = cell('oc-opus', { t1: '1' }, { started_at: '2026-11-01T01:00:00.000Z' });
    const withUsage = (t: TrialRecord, usd: number) => ({ ...t, usage: { meter_id: `trial-token:${t.trial_id}`, requests: 1, refused: 0, failed: 0, usd, input_tokens: 1000, output_tokens: 10, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null } });
    const records = [withUsage(cc[0]!, 0.0042), withUsage(oc[0]!, 0.0042)];
    const row = (t: TrialRecord, at: string, usd: number) => ({ at, key: `trial-token:${t.trial_id}`, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', actual_usd: usd, input_tokens: 1000, output_tokens: 10, cached_tokens: 0 });
    const usageRows = [row(cc[0]!, '2026-11-01T00:30:00.000Z', 0.5), row(cc[0]!, '2026-11-01T01:00:01.000Z', 0.0042), row(oc[0]!, '2026-11-01T01:00:01.000Z', 0.0042), row(oc[0]!, '2026-11-01T01:00:02.000Z', 0.0042)];
    const a = analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: () => null, usageRows }, specFor(['cc-opus', 'oc-opus']));
    const [c1, c2] = a.cells;
    expect(c1!.cost.usd_earlier_attempts).toBe(0.5);
    expect(c1!.cost.usd_recorded_trials).toBe(0.0042);
    expect(c1!.cost.usd_total).toBe(0.5042);
    expect(c1!.cost.usd_per_pass).toBe(0.5042);
    expect(c1!.cost.usd_per_recorded_trial).toBe(0.0042);
    expect(c1!.cost.usd_by_model).toEqual({ 'anthropic:claude-opus-5-5': 0.5042 });
    expect(c1!.tokens.input).toBe(1000);
    const bothAttempts = [{ ...records[0]!, usage: { ...records[0]!.usage!, input_tokens: 2000 } }, records[1]!];
    expect(analyzeMatrix({ manifest: manifestFor(records), records: bothAttempts, eventsOf: () => null, usageRows }, specFor(['cc-opus', 'oc-opus'])).cells[0]!.tokens.input).toBe(1000);
    const ocNoLog = [records[0]!, { ...records[1]!, usage: { ...records[1]!.usage!, input_tokens: 2000, by_model: { 'anthropic:claude-opus-5-5': { usd: 0.0042, requests: 1 } } } }];
    const ocRowsGone = usageRows.filter((r) => r.key !== `trial-token:${oc[0]!.trial_id}`);
    const missingShardLog = analyzeMatrix({ manifest: manifestFor(records), records: ocNoLog, eventsOf: () => null, usageRows: ocRowsGone }, specFor(['cc-opus', 'oc-opus']));
    expect(missingShardLog.cells[0]!.tokens.input).toBe(1000);
    expect(missingShardLog.cells[1]!.tokens.input).toBe(2000);
    expect(missingShardLog.cells[1]!.cost.usd_by_model).toEqual({ 'anthropic:claude-opus-5-5': 0.0042 });
    const staleAndFree = [...ocRowsGone, row(oc[0]!, '2026-11-01T00:30:00.000Z', 0.5), { ...row(oc[0]!, '2026-11-01T01:00:03.000Z', 0), route: '/v1/models', input_tokens: 0, output_tokens: 0 }];
    const onlyEarlierPaid = analyzeMatrix({ manifest: manifestFor(records), records: ocNoLog, eventsOf: () => null, usageRows: staleAndFree }, specFor(['cc-opus', 'oc-opus']));
    expect(onlyEarlierPaid.cells[1]!.tokens.input).toBe(2000);
    expect(onlyEarlierPaid.cells[1]!.cost.usd_by_model).toEqual({ 'anthropic:claude-opus-5-5': 0.5042 });
    expect(onlyEarlierPaid.cells[1]!.cost.usd_total).toBe(0.5042);
    const resumedAtCap = [records[0]!, { ...records[1]!, usage: { ...records[1]!.usage!, usd: 0, input_tokens: 1000, by_model: {} } }];
    const capRows = [...ocRowsGone, row(oc[0]!, '2026-11-01T00:30:00.000Z', 0.5), { ...row(oc[0]!, '2026-11-01T01:00:03.000Z', 0), outcome: 'refused', input_tokens: 0, output_tokens: 0 }];
    const capped = analyzeMatrix({ manifest: manifestFor(records), records: resumedAtCap, eventsOf: () => null, usageRows: capRows }, specFor(['cc-opus', 'oc-opus']));
    expect(capped.cells[1]!.tokens.input).toBe(0);
    expect(capped.cells[1]!.cost.usd_by_model).toEqual({ 'anthropic:claude-opus-5-5': 0.5 });
    const tiny = Array.from({ length: 100 }, (_, i) => ({ ...row(cc[0]!, `2026-11-01T00:40:00.${String(i).padStart(3, '0')}Z`, 0.0000004), model: 'tiny-model' }));
    const small = analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: () => null, usageRows: [...usageRows, ...tiny] }, specFor(['cc-opus', 'oc-opus']));
    expect(small.cells[0]!.cost.usd_by_model['anthropic:tiny-model']).toBe(0.00004);
    expect(small.cells[0]!.cost.usd_earlier_attempts).toBe(0.50004);
    expect(c1!.cache_write_share).toBe(0);
    expect(c1!.cache_write_share_note).toBeNull();
    expect(c2!.cache_write_share).toBeNull();
    expect(c2!.cache_write_share_note).toBe('a trial of this cell does not reconcile with its charged rows');
    expect(a.cost_split.status).toBe('refused');
    expect(a.cost_split.refused_cells).toEqual(['oc-opus']);
    expect(renderMarkdown(a)).toContain('plus charged rows from earlier, interrupted attempts');
    const planned = manifestFor(records, [{ id: 'matrix-test/oc-opus/t1/r2', cell: 'oc-opus', task: 't1' }]);
    const crashed = analyzeMatrix({ manifest: planned, records, eventsOf: () => null, usageRows: [...usageRows, { ...row(oc[0]!, '2026-11-01T01:00:05.000Z', 0.5), key: 'trial-token:matrix-test/oc-opus/t1/r2' }] }, specFor(['cc-opus', 'oc-opus']));
    expect(crashed.cells[1]!.cost.usd_earlier_attempts).toBe(0.5);
    expect(crashed.cells[1]!.cost.usd_total).toBe(0.5084);
    expect(crashed.cost_split.note ?? '').not.toContain('match no trial');
    expect(c2!.cost.usd_rows_beyond_records).toBe(0.0042);
    expect(c2!.cost.usd_total).toBe(0.0084);
    expect(c1!.cost.usd_rows_beyond_records).toBe(0);
    const noLog = analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: () => null, usageRows: null }, specFor(['cc-opus', 'oc-opus']));
    expect(noLog.cells[0]!.cost.usd_earlier_attempts).toBeNull();
    expect(noLog.cells[0]!.cost.usd_total).toBe(0.0042);
    expect(renderMarkdown(noLog)).toContain('but not earlier, interrupted attempts, because the results directory has no proxy usage log');
    const unpriced = analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: () => null, usageRows: [...usageRows, { ...row(cc[0]!, '2026-11-01T01:00:03.000Z', 0), model: 'mystery-model' }] }, specFor(['cc-opus', 'oc-opus']));
    expect(unpriced.cost_split.status).toBe('unavailable');
    expect(unpriced.cells[0]!.cost.usd_earlier_attempts).toBe(0.5);
    expect(unpriced.cells[0]!.cost.usd_total).toBe(0.5042);
  });

  test('the CLI reads a sealed manifest before anything else, withholds parser messages, and skips a cut-off last log line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-logs-'));
    const records = [...cell('cc-opus', { t1: '1' }), ...cell('oc-opus', { t1: '0' })];
    const spec = join(dir, 'spec.json');
    writeFileSync(spec, JSON.stringify(specFor(['cc-opus', 'oc-opus'], { primary_family_size: 1, primary: [{ id: 'p1', a: 'cc-opus', b: 'oc-opus' }] })));
    const run = (results: string) => spawnSync(process.execPath, ['scripts/matrix-analysis.ts', '--results', results, '--spec', spec], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const sealed = join(dir, 'sealed');
    mkdirSync(sealed);
    writeFileSync(join(sealed, 'manifest.json'), JSON.stringify({ ...manifestFor(records), sealed: { set: 'v0.3' } }));
    writeFileSync(join(sealed, 'trials.jsonl'), '{"task":SYNTHETIC_SEALED_TASK}\n');
    const s = run(sealed);
    expect(s.status).toBe(2);
    expect(s.stderr).toContain('was planned with a sealed root');
    expect(s.stderr + s.stdout).not.toContain('SYNTHETIC_SEALED_TASK');
    const bad = join(dir, 'bad');
    mkdirSync(bad);
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify(manifestFor(records)));
    writeFileSync(join(bad, 'trials.jsonl'), '{"task":SYNTHETIC_TASK}\n');
    const b = run(bad);
    expect(b.status).toBe(2);
    expect(b.stderr).toContain('HE-RUN-007');
    expect(b.stderr).toContain('line 1 is not JSON');
    expect(b.stderr + b.stdout).not.toContain('SYNTHETIC_TASK');
    const cut = join(dir, 'cut');
    mkdirSync(cut);
    writeFileSync(join(cut, 'manifest.json'), JSON.stringify(manifestFor(records)));
    writeFileSync(join(cut, 'trials.jsonl'), records.map((t) => JSON.stringify(t)).join('\n') + '\n');
    writeFileSync(join(cut, 'a.proxy-usage.ndjson'), '{"at":"x","key":"trial-token:none","outcome":"refused"}\n{"at":"2026-11-01T00:00:00.000Z","key":"tri');
    writeFileSync(join(cut, 'b.proxy-usage.ndjson'), '{"at":"2026-11-01T00:00:00.000Z","key":"tri{"at":"y","key":"trial-token:none","outcome":"refused"}\n{"at":"z","key":"trial-token:none","outcome":"refused"}\n');
    const td = join(cut, 'trials', 'cc-opus', 't1', 'r1');
    mkdirSync(td, { recursive: true });
    writeFileSync(join(td, 'events.jsonl'), '{"seq":1,"via":"mcp"}\n{"seq":2,"via":"mc');
    const c = run(cut);
    expect(c.status).toBe(0);
    const out = JSON.parse(readFileSync(join(cut, 'matrix-analysis.json'), 'utf8'));
    expect(out.truncated_log_lines).toEqual({ usage_logs: 2, event_logs: 1 });
    expect(out.cells[0].world_mcp.calls).toBe(1);
    expect(c.stdout).toContain('Cut-off log lines skipped: 2 in usage logs, 1 in event logs. A cut-off usage line may have held a charged row, so earlier-attempt USD is a lower bound.');
  });
test('loadResults keeps a row a resumed proxy appended after a cut-off line, keeps two whole rows sharing a line, and reads event logs only inside the results directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-load-'));
    const res = join(dir, 'results');
    mkdirSync(res);
    writeFileSync(join(res, 'a.proxy-usage.ndjson'), '{"at":"1","key":"k","actual_usd":0.1}{"at":"2","key":"k","actual_usd":0.2}\n{"at":"3","key":"tri{"at":"4","key":"k","actual_usd":0.004}\n');
    const outside = join(dir, 'outside-events.jsonl');
    writeFileSync(outside, '{"seq":1,"via":"mcp"}\n');
    const trialAt = (id: string) => ({ trial_id: id, paths: { events: outside } }) as unknown as TrialRecord;
    writeFileSync(join(res, 'b.proxy-usage.ndjson'), '{"at":"5","key":"k","actual_usd":1}{"at":"6","key":"tri{"at":"7","key":"k","actual_usd":2}{"at":"8","key":"k","actual_usd":3}\n');
    const input = loadResults(res, manifestFor([]));
    expect(input.usageRows!.map((r) => r.at)).toEqual(['1', '2', '4', '5', '7', '8']);
    expect(input.truncated!.usage_logs).toBe(2);
    expect(input.eventsOf(trialAt('matrix-test/cc-opus/t1/r1'))).toBeNull();
    const td = join(res, 'trials', 'cc-opus', 't1', 'r1');
    mkdirSync(td, { recursive: true });
    writeFileSync(join(td, 'events.jsonl'), 'xx{"seq":1,"via":"mcp"}\n{"seq":2,"via":"mcp"}\n');
    expect(() => input.eventsOf(trialAt('matrix-test/cc-opus/t1/r1'))).toThrow(/line 1 is not JSON/);
    writeFileSync(join(res, 'bak.proxy-usage.ndjson'), '{"at":"5","key":"k","actual_usd":1}\r\n{"at":"7","key":"k","act');
    expect(() => loadResults(res, manifestFor([]))).toThrow(/bak\.proxy-usage\.ndjson shares rows with .*b\.proxy-usage\.ndjson/);
  });
test('matrix-analysis refuses a merged results directory missing the proxy usage log of a shard with spend, or holding one cut short', () => {
    const res = mkdtempSync(join(tmpdir(), 'matrix-copyback-'));
    const records = [...cell('cc-opus', { t1: '1' }), ...cell('oc-opus', { t1: '0' })];
    writeFileSync(join(res, 'manifest.json'), JSON.stringify(manifestFor(records)));
    writeFileSync(join(res, 'trials.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(res, 'shards.json'), JSON.stringify({ cells: { 'cc-opus': 'cc', 'oc-opus': 'oc' }, shards: { cc: {}, oc: {} } }));
    writeFileSync(join(res, 'cc.proxy-usage.ndjson'), '{"at":"1","key":"k","actual_usd":0.1}\n');
    const spec = join(res, 'spec.json');
    writeFileSync(spec, JSON.stringify(specFor(['cc-opus', 'oc-opus'])));
    const run = () => spawnSync(process.execPath, ['scripts/matrix-analysis.ts', '--results', res, '--spec', spec], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    const spent = records.map((r) => ({ ...r, usage: { usd: 0.1 } }) as unknown as TrialRecord);
    writeFileSync(join(res, 'trials.jsonl'), spent.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(res, 'cc.proxy-usage.ndjson'), JSON.stringify({ at: '1', key: `trial-token:${spent[0]!.trial_id}`, actual_usd: 0.1 }) + '\n');
    const lost = run();
    expect(lost.status).toBe(2);
    expect(lost.stderr).toContain('matrix-analysis: refused: shards.json lists 1 shard(s) with spend whose proxy usage log is not in');
    expect(lost.stderr).toContain('oc.proxy-usage.ndjson');
    expect(existsSync(join(res, 'matrix-analysis.json'))).toBe(false);
    writeFileSync(join(res, 'oc.proxy-usage.ndjson'), '{"at":"2","key":"k","actual_usd":0.2}\n');
    const cut = run();
    expect(cut.status).toBe(2);
    expect(cut.stderr).toContain(`1 trial(s) with spend have no row in their shard's proxy usage log, so the log that came back is cut short (a copy taken while the shard ran): ${spent[1]!.trial_id} (shard oc)`);
    writeFileSync(join(res, 'oc.proxy-usage.ndjson'), JSON.stringify({ at: '2', key: `trial-token:${spent[1]!.trial_id}`, actual_usd: 0.1 }) + '\n');
    expect(run().status).toBe(0);
  });
test('matrix-analysis reads a missing proxy usage log as empty when every trial of that shard recorded $0', () => {
    const res = mkdtempSync(join(tmpdir(), 'matrix-zero-shard-'));
    const records = [...cell('cc-opus', { t1: '1' }), ...cell('oc-opus', { t1: 'H' })].map((r) => ({ ...r, usage: { usd: r.cell === 'cc-opus' ? 0.1 : 0 } }) as unknown as TrialRecord);
    writeFileSync(join(res, 'manifest.json'), JSON.stringify(manifestFor(records)));
    writeFileSync(join(res, 'trials.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(res, 'shards.json'), JSON.stringify({ cells: { 'cc-opus': 'cc', 'oc-opus': 'oc' }, shards: { cc: {}, oc: {} } }));
    writeFileSync(join(res, 'cc.proxy-usage.ndjson'), JSON.stringify({ at: '1', key: `trial-token:${records[0]!.trial_id}`, actual_usd: 0.1 }) + '\n');
    const input = loadResults(res, manifestFor(records));
    expect(input.records.map((t) => t.termination)).toEqual(records.map((t) => t.termination));
    expect(input.usageRows).toHaveLength(1);
    writeFileSync(join(res, 'trials.jsonl'), records.map((r) => JSON.stringify(r.cell === 'oc-opus' ? { ...r, usage: { usd: 0.0042 } } : r)).join('\n') + '\n');
    expect(() => loadResults(res, manifestFor(records))).toThrow(/shards\.json lists 1 shard\(s\) with spend whose proxy usage log is not in .*oc\.proxy-usage\.ndjson/);
  });
});
