// The headroom report and gate (runner/stats/headroom.ts, docs/methods.md "Headroom"): which tasks can tell a run's arms
// apart, the plain-English section summarize-run and scripts/headroom.ts print, and the gate that turns a "higher" or
// within-15 call without room into "can't tell: no room to improve" in matrix-analysis and frontier-harbor/analyze.
//
// Value: protects=no "better than" or "no worse than" call rests on tasks every arm aces or every arm fails;
// fails_when=a saturated run still gets a call, agreement between two arms counts against a call, the gate moves Holm, or a
// published spec's output changes; why_new=the audit found 11 of 20 multi-user tasks passed in every arm and nothing counted
// them; seam=pure functions plus the two analyses on hand fixtures and the committed matrix-mu receipts;
// no_claim=whether 10 tasks is the right minimum.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Termination, TrialRecord } from '../runner/contracts.ts';
import { holmAdjusted } from '../runner/stats/paired.ts';
import { NO_ROOM, noRoomReason, pairHeadroom, renderHeadroom, runCanTellApart, runHeadroom } from '../runner/stats/headroom.ts';
import { analyzeFrontier, renderMarkdown as renderFrontier, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';
import { analyzeMatrix, renderMarkdown as renderMatrix, type MatrixManifest, type MatrixSpec } from '../scripts/matrix-analysis.ts';
import { headroomGated, PUBLISHED_BEFORE_HEADROOM_GATE } from '../scripts/headroom.ts';

const ROOT = join(import.meta.dir, '..');
const MU = join(ROOT, 'docs', 'benchmarks', '2026-11-04-matrix-mu');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const RUN = 'headroom-test';

// One character per try: 1 pass, 0 fail, H harness_error, M model_error.
function cell(id: string, tasks: Record<string, string>): TrialRecord[] {
  return Object.entries(tasks).flatMap(([task, reps]) => [...reps].map((ch, i) => {
    const termination: Termination = ({ H: 'harness_error', M: 'model_error' } as Record<string, Termination>)[ch] ?? 'completed';
    return {
      trial_id: `${RUN}/${id}/${task}/r${i + 1}`, cell: id, task, harness: id.split('-')[1] ?? id, harness_mode: 'docker', model: 'm', script: null,
      termination, grade: ch === '1' ? 'pass' : termination === 'completed' ? 'fail' : 'n/a', consent_violation: false, approval_stop: false,
      effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [] }, usage: null,
      wall_ms: 1000, started_at: '2026-11-09T00:00:00.000Z', ended_at: '2026-11-09T00:00:01.000Z', paths: {},
    } as TrialRecord;
  }));
}
const tasks = (from: number, to: number, s: string) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`t${String(from + i).padStart(2, '0')}`, s]));
const manifestFor = (records: TrialRecord[]): MatrixManifest => ({
  run_id: RUN, cells: [...new Set(records.map((t) => t.cell))].map((id) => ({ id })), trials: records.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })),
});
const lines = <T>(f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);

describe('the run headroom table', () => {
  test('tags every task and counts the ones that can tell arms apart; one mixed try is enough', () => {
    const h = runHeadroom([
      ...['a', 'b'].flatMap((arm) => [1, 1].map((pass) => ({ arm, task: 'easy', pass: pass as 0 | 1 }))),
      ...['a', 'b'].flatMap((arm) => [0, 0].map((pass) => ({ arm, task: 'hard', pass: pass as 0 | 1 }))),
      { arm: 'a', task: 'mixed', pass: 1 }, { arm: 'a', task: 'mixed', pass: 1 }, { arm: 'b', task: 'mixed', pass: 1 }, { arm: 'b', task: 'mixed', pass: 0 },
    ]);
    expect(h.counts).toEqual({ tasks: 3, every_arm_passed: 1, every_arm_failed: 1, can_tell_apart: 1 });
    expect(h.tasks.map((t) => t.tag)).toEqual(['every_arm_passed', 'every_arm_failed', 'can_tell_apart']);
    expect(h.arms).toEqual([{ arm: 'a', passes: 4, tries: 6, pass_rate: 4 / 6 }, { arm: 'b', passes: 3, tries: 6, pass_rate: 0.5 }]);
    expect([...runCanTellApart([new Map([['easy', 1], ['hard', 0], ['mixed', 1]]), new Map([['easy', 1], ['hard', 0], ['mixed', 0.5]])])]).toEqual(['mixed']);
    const md = renderHeadroom(h);
    expect(md).toContain('**1 of 3 tasks can tell the arms apart.** 1 passed in every arm on every try and 1 failed in every arm on every try.');
    expect(md).toContain('| `mixed` | can tell apart | 2/2 | 1/2 |');
  });

  test('the committed multi-user run behind the README: 6 of 20 tasks can tell its arms apart', () => {
    const r = spawnSync('bun', ['scripts/headroom.ts', '--results', join(MU, 'results'), '--json'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).counts).toEqual({ tasks: 20, every_arm_passed: 11, every_arm_failed: 3, can_tell_apart: 6 });
  });

  test('summarize-run ends with the section and writes the headroom key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-headroom-sum-'));
    for (const f of ['trials.jsonl', 'manifest.json']) copyFileSync(join(MU, 'results', f), join(dir, f));
    const r = spawnSync('bun', ['scripts/summarize-run.ts', '--results', dir], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('## Headroom: which tasks can tell the arms apart');
    expect(r.stdout).toContain('**6 of 20 tasks can tell the arms apart.** 11 passed in every arm on every try and 3 failed in every arm on every try.');
    expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).headroom.counts).toEqual({ tasks: 20, every_arm_passed: 11, every_arm_failed: 3, can_tell_apart: 6 });
  }, 120_000);

  test('the CLI leaves out product-probe cells, as summarize-run does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-headroom-probe-'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: RUN, cells: [{ id: 'aa-x', split: 'dev' }, { id: 'pp-x', split: 'dev' }], trials: [] }));
    writeFileSync(join(dir, 'trials.jsonl'), [...cell('aa-x', { t01: '10' }), ...cell('pp-x', { 'qp-01-dm-recall-new-session': '11' })].map((t) => JSON.stringify(t)).join('\n') + '\n');
    const r = spawnSync('bun', ['scripts/headroom.ts', '--results', dir, '--json'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.status).toBe(0);
    const h = JSON.parse(r.stdout);
    expect(h.arms.map((a: { arm: string }) => a.arm)).toEqual(['aa-x']);
    expect(h.counts).toEqual({ tasks: 1, every_arm_passed: 0, every_arm_failed: 0, can_tell_apart: 1 });
  });

  test('the CLI refuses a run planned with a sealed root, naming no task', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-headroom-sealed-'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 's', cells: [], trials: [], sealed: { set: 'vsyn' } }));
    writeFileSync(join(dir, 'trials.jsonl'), JSON.stringify(cell('s-a', { 'sx-01-secret-task': '1' })[0]) + '\n');
    const r = spawnSync('bun', ['scripts/headroom.ts', '--results', dir], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE-SEALED-001');
    expect(r.stdout + r.stderr).not.toContain('sx-01-secret-task');
  });
});

describe('the gate', () => {
  test('counts the run\'s tasks, not the pair\'s: two arms that agree keep their room', () => {
    const items = [...Array.from({ length: 16 }, (_, i) => ({ cluster: `t${i}`, a: 1, b: 1 })), ...Array.from({ length: 4 }, (_, i) => ({ cluster: `u${i}`, a: 0.5, b: 0.5 }))];
    const everyTask = new Set(items.map((i) => i.cluster));
    const h = pairHeadroom(items, everyTask)!;
    expect(h).toMatchObject({ tasks: 20, run_can_tell_apart: 20, both_passed: 16, both_failed: 0 });
    expect(h.room_below_a).toBeCloseTo(0.9, 10);
    expect(noRoomReason(h, { room: h.room_below_a, smallest_difference: 0.15, min_tasks: 10 })).toBeNull();
    const saturated = pairHeadroom(items, new Set(items.filter((i) => i.a < 1).map((i) => i.cluster)))!;
    expect(noRoomReason(saturated, { room: saturated.room_below_a, smallest_difference: 0.15, min_tasks: 10 })).toBe(`${NO_ROOM}: only 4 of 20 paired tasks can tell the arms of this run apart (the other 16 passed in every arm on every try, or failed in every arm on every try); a call needs at least 10`);
    expect(pairHeadroom([{ cluster: 't', a: 2, b: 1 }], everyTask)).toBeNull();
  });

  const frontierSpec = (cells: string[], extra: Partial<FrontierSpec> = {}): FrontierSpec => ({
    run_id: RUN, seed: 7, draws: 2000, primary_pairs: { m: cells.length - 1 },
    models: [{ id: 'm', label: 'Opus 5.5', home: cells[0]! }], cells: cells.map((id) => ({ id, model: 'm', harness: id.split('-')[1]!, attempts: 2 })), ...extra,
  });

  test('frontier: a within-15 pair in a saturated run reads no-room, and Holm is untouched', () => {
    const records = [
      ...cell('m-home', { ...tasks(1, 15, '11'), ...tasks(16, 20, '11') }),
      ...cell('m-near', { ...tasks(1, 15, '11'), t16: '10', ...tasks(17, 20, '11') }),
      ...cell('m-low', { ...tasks(1, 15, '11'), ...tasks(16, 20, '00') }),
    ];
    const a = analyzeFrontier({ records, manifest: null }, frontierSpec(['m-home', 'm-near', 'm-low']));
    const near = a.pairs.find((p) => p.cell === 'm-near')! as (typeof a.pairs)[number] & { headroom: { run_can_tell_apart: number }; no_room_reason: string | null };
    expect(near.holm_p_noninferiority!).toBeLessThanOrEqual(0.05);
    expect(a.cells.find((c) => c.id === 'm-near')!.verdict).toBe('no-room');
    expect(near.headroom.run_can_tell_apart).toBe(5);
    expect(near.no_room_reason).toContain('only 5 of 20 paired tasks can tell the arms of this run apart');
    expect(a.cells.find((c) => c.id === 'm-near')!.reason).toBe(near.no_room_reason!);
    const primary = a.pairs.filter((p) => p.family === 'primary');
    expect(primary.map((p) => p.holm_p_noninferiority)).toEqual(holmAdjusted(primary.map((p) => (p.tested && p.p_noninferiority !== null ? p.p_noninferiority : 1))).map((x) => Math.round(x * 1e8) / 1e8));
    expect(Object.keys(a.verdict_rules)).toEqual(['home', 'incomplete', 'descriptive', 'behind', 'no-room', 'within-15', 'saturated', 'inconclusive']);
    expect(renderFrontier(a)).toContain(`- **no-room**: ${NO_ROOM}:`);
  });

  test('frontier: a task one main cell never scored counts only by the cells that scored it, as in matrix', () => {
    const records = [
      ...cell('m-home', tasks(1, 20, '11')),
      ...cell('m-near', { ...tasks(1, 15, '11'), t16: '10', ...tasks(17, 20, '11') }),
      ...cell('m-low', { t01: 'MM', ...tasks(2, 15, '11'), ...tasks(16, 20, '00') }),
    ];
    const a = analyzeFrontier({ records, manifest: null }, frontierSpec(['m-home', 'm-near', 'm-low']));
    const near = a.pairs.find((p) => p.cell === 'm-near')! as unknown as { headroom: { tasks: number; run_can_tell_apart: number } };
    expect(near.headroom).toMatchObject({ tasks: 20, run_can_tell_apart: 5 });
    expect(a.cells.find((c) => c.id === 'm-near')!.verdict).toBe('no-room');
  });

  test('frontier: a harness that matches its home on most tasks keeps within-15 when the run has headroom', () => {
    const records = [
      ...cell('m-home', { ...tasks(1, 16, '11'), ...tasks(17, 20, '10') }),
      ...cell('m-same', { ...tasks(1, 16, '11'), ...tasks(17, 19, '10'), t20: '11' }),
      ...cell('m-low', tasks(1, 20, '00')),
    ];
    const a = analyzeFrontier({ records, manifest: null }, frontierSpec(['m-home', 'm-same', 'm-low']));
    expect(a.cells.find((c) => c.id === 'm-same')!.verdict).toBe('within-15');
    expect((a.pairs.find((p) => p.cell === 'm-same') as unknown as { headroom: { run_can_tell_apart: number; both_passed: number } }).headroom).toMatchObject({ run_can_tell_apart: 20, both_passed: 16 });
  });

  const matrixSpec = (o: Partial<MatrixSpec> = {}): MatrixSpec => ({
    run_id: RUN, seed: 7, draws: 2000, primary_family_size: 1, cells: [{ id: 'aa-opus' }, { id: 'bb-opus' }], primary: [{ id: 'p1', a: 'aa-opus', b: 'bb-opus' }], ...o,
  });
  const matrix = (records: TrialRecord[], spec: MatrixSpec) => analyzeMatrix({ manifest: manifestFor(records), records, eventsOf: () => null, usageRows: null }, spec);

  test('matrix: a "higher" call on 6 tasks that can tell the arms apart is refused after Holm', () => {
    const records = [...cell('aa-opus', { ...tasks(1, 6, '1111'), ...tasks(7, 12, '0000') }), ...cell('bb-opus', tasks(1, 12, '1111'))];
    const a = matrix(records, matrixSpec({ smallest_difference: 0.1 }));
    const c = a.primary.comparisons[0]! as (typeof a.primary.comparisons)[number] & { no_room_reason: string | null };
    expect(c.holm_p).toBeLessThanOrEqual(0.05);
    expect(c.verdict).toBe(NO_ROOM);
    expect(c.no_room_reason).toContain('only 6 of 12 paired tasks can tell the arms of this run apart');
    expect(renderMatrix(a)).toContain('### Headroom of each primary comparison');
  });

  test('matrix: a call with headroom stands, and the named smallest difference is checked', () => {
    const records = [
      ...cell('aa-opus', { ...tasks(1, 10, '0000'), ...tasks(11, 12, '1100') }),
      ...cell('bb-opus', { ...tasks(1, 10, '1111'), ...tasks(11, 12, '1100') }),
    ];
    expect(matrix(records, matrixSpec({ smallest_difference: 0.1 })).primary.comparisons[0]!.verdict).toBe('bb-opus higher');
    const big = matrix(records, matrixSpec({ smallest_difference: 0.95 })).primary.comparisons[0]! as { verdict: string; no_room_reason: string | null };
    expect(big.verdict).toBe(NO_ROOM);
    expect(big.no_room_reason).toContain('can move by at most 91.7 points, less than the 95-point smallest difference the preregistration named');
    const none = matrix(records, matrixSpec());
    expect(none.primary.comparisons[0]!.verdict).toBe('bb-opus higher');
    expect(renderMatrix(none)).toContain('the spec names no smallest difference, so only that count was checked');
    expect(() => matrix(records, matrixSpec({ smallest_difference: 10 }))).toThrow(/smallest_difference must be a pass-rate difference above 0 and at most 1/);
  });

  test('matrix: an "A higher" call is gated on the room above B', () => {
    const records = [
      ...cell('aa-opus', { ...tasks(1, 10, '1111'), ...tasks(11, 12, '1100') }),
      ...cell('bb-opus', { ...tasks(1, 10, '0000'), ...tasks(11, 12, '1100') }),
    ];
    expect(matrix(records, matrixSpec({ smallest_difference: 0.5 })).primary.comparisons[0]!.verdict).toBe('aa-opus higher');
    const big = matrix(records, matrixSpec({ smallest_difference: 0.95 })).primary.comparisons[0]! as { verdict: string; no_room_reason: string | null };
    expect(big.verdict).toBe(NO_ROOM);
    expect(big.no_room_reason).toContain('can move by at most 91.7 points, less than the 95-point smallest difference');
  });
});

describe('published runs keep their output', () => {
  test('each listed spec file still hashes to its entry; an edited copy gets the gate', () => {
    for (const p of PUBLISHED_BEFORE_HEADROOM_GATE) expect(headroomGated(JSON.parse(readFileSync(join(ROOT, p.spec), 'utf8')))).toBe(false);
    const spec = JSON.parse(readFileSync(join(MU, 'matrix-spec.json'), 'utf8'));
    expect(headroomGated({ ...spec, smallest_difference: 0.1 })).toBe(true);
  });

  test('matrix-mu with its published spec gets no headroom fields; the same run under the gate shows why nothing could be called', () => {
    const input = { manifest: JSON.parse(readFileSync(join(MU, 'results', 'manifest.json'), 'utf8')), records: lines<TrialRecord>(join(MU, 'results', 'trials.jsonl')), eventsOf: () => null, usageRows: null };
    const spec = JSON.parse(readFileSync(join(MU, 'matrix-spec.json'), 'utf8')) as MatrixSpec;
    const published = analyzeMatrix(input, spec);
    expect('headroom_gate' in published).toBe(false);
    expect(published.primary.comparisons.every((c) => !('headroom' in c))).toBe(true);
    const gated = analyzeMatrix(input, { ...spec, smallest_difference: 0.1 });
    expect(gated.primary.comparisons.map((c) => (c as unknown as { headroom: { run_can_tell_apart: number } }).headroom.run_can_tell_apart)).toEqual([6, 6, 6, 5, 6, 5]);
  });
});
