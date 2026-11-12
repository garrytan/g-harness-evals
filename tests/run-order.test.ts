// internal-task (H10) PR 5: the preregistered trial order (prereg.json order {kind: "interleave-task", seed}), baked into manifest.json
// by plan, and kept by run under --cells and --resume. Keyless: the fixture adapter as a host process, the real world and
// proxy with placeholder keys, a stub grader (as tests/trial-loop.test.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GradeResult } from '../runner/contracts.ts';
import { buildManifest, interleaveTrials, loadPrereg, renderPlan, type Cell, type Prereg, type Trial } from '../runner/run.ts';
import { executeRun, readRecords } from '../runner/trial/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'he-run-order-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const TASKS = join(tmp, 'tasks');
const PROXY_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };

for (const id of ['fx-one', 'fx-two', 'fx-three']) {
  const dir = join(TASKS, 'multiuser', 'dev', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.toml'), `id = "${id}"\nslice = "multiuser"\nsplit = "dev"\ntime_budget_s = 20\nactors = ["dana-okafor"]\n\n[[turns]]\nactor = "dana-okafor"\nchannel = "north-team"\ntext = "hello from ${id}"\n\n[predicates]\nrequired = []\nforbidden_effects = []\n`);
}
const cell = (id: string): Cell => ({ id, harness: '_fixture', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 2, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(FIXTURES, 'serve-adapter.ts') });

let n = 0;
function plan(cells: Cell[], order?: unknown, tasks = ['fx-one', 'fx-two']) {
  const runId = `order-run-${++n}`;
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const p: Omit<Prereg, 'order'> & { order?: unknown } = { schema_version: 1, run_id: runId, question: 'order', tasks: { multiuser: tasks }, cells, wall_clock_s: { multiuser: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [], ...(order === undefined ? {} : { order }) };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
  const { prereg, sha256 } = loadPrereg(join(dir, 'prereg.json'));
  const manifest = buildManifest(prereg, sha256, '2026-11-01T00:00:00Z', { tasksRoot: TASKS });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath: join(dir, 'manifest.json'), dir };
}

describe('interleave-task, planned', () => {
  test('the same seed gives the same order; the order is a permutation, repetition by repetition, each task\'s cells together', () => {
    const a = plan([cell('a'), cell('b'), cell('c')], { kind: 'interleave-task', seed: 11 }, ['fx-one', 'fx-two', 'fx-three']).manifest;
    const b = plan([cell('a'), cell('b'), cell('c')], { kind: 'interleave-task', seed: 11 }, ['fx-one', 'fx-two', 'fx-three']).manifest;
    const ids = (ts: Trial[]) => ts.map((t) => t.id.slice(t.id.indexOf('/') + 1));
    expect(ids(a.trials)).toEqual(ids(b.trials));
    expect(a.order).toEqual({ kind: 'interleave-task', seed: 11 });
    expect(a.trials).toHaveLength(18);
    expect(new Set(a.trials.map((t) => t.id)).size).toBe(18);
    expect(a.trials.map((t) => t.repetition)).toEqual([...Array(9).fill(1), ...Array(9).fill(2)]);
    for (let i = 0; i < 18; i += 3) expect(new Set(a.trials.slice(i, i + 3).map((t) => t.task)).size).toBe(1);
    const cellOrders = new Set([0, 3, 6, 9, 12, 15].map((i) => a.trials.slice(i, i + 3).map((t) => t.cell).join(',')));
    expect(cellOrders.size).toBeGreaterThan(1);
    const other = interleaveTrials([...a.trials].sort((x, y) => (x.id < y.id ? -1 : 1)), ['a', 'b', 'c'], 11);
    expect(other.map((t) => t.id)).toEqual(a.trials.map((t) => t.id));
    expect(interleaveTrials(a.trials, ['a', 'b', 'c'], 12).map((t) => t.id)).not.toEqual(a.trials.map((t) => t.id));
    expect(renderPlan(a)).toContain('ORDER: interleave-task seed=11');
  });
  test('without order the manifest is as before: cell by cell, no order key, no ORDER line', () => {
    const m = plan([cell('a'), cell('b')]).manifest;
    expect(m.trials.map((t) => t.cell)).toEqual(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
    expect('order' in m).toBe(false);
    expect(renderPlan(m)).not.toContain('ORDER:');
  });
  test('a malformed order is HE-PREREG-008', () => {
    for (const bad of [{ kind: 'random', seed: 1 }, { kind: 'interleave-task' }, { kind: 'interleave-task', seed: 1.5 }, { kind: 'interleave-task', seed: 1, extra: true }, 'interleave-task']) {
      expect(() => plan([cell('a')], bad)).toThrow(/^HE-PREREG-008 order must be/);
    }
  });
});

describe('interleave-task, run', () => {
  const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
  const opts = { harnessMode: 'process' as const, preamblePath: join(FIXTURES, 'preamble.md'), grade, proxyEnv: PROXY_ENV, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT };
  test('--cells runs its cells in manifest order, and --resume then runs the rest in manifest order', async () => {
    const { manifest, manifestPath, dir } = plan([cell('a'), cell('b')], { kind: 'interleave-task', seed: 5 });
    const first = await executeRun(manifest, manifestPath, { ...opts, cells: ['b'] });
    expect(first.records.map((r) => r.trial_id)).toEqual(manifest.trials.filter((t) => t.cell === 'b').map((t) => t.id));
    const second = await executeRun(manifest, manifestPath, { ...opts, resume: true });
    expect(second.skipped).toEqual(manifest.trials.filter((t) => t.cell === 'b').map((t) => t.id));
    expect(second.records.map((r) => r.trial_id)).toEqual(manifest.trials.filter((t) => t.cell === 'a').map((t) => t.id));
    expect(readRecords(dir).map((r) => r.trial_id)).toEqual([...first.records, ...second.records].map((r) => r.trial_id));
    expect(readFileSync(join(dir, 'run.log'), 'utf8')).toContain('4 trials to run, 4 already recorded');
  }, 180_000);
});

describe('interleave-task with blocks (internal-task)', () => {
  test('cells run block by block in the listed order, each block interleaved by task with the seed', () => {
    const order = { kind: 'interleave-task' as const, seed: 11, blocks: [{ name: 'first', cells: ['c', 'a'] }, { name: 'second', cells: ['b'] }] };
    const m = plan([cell('a'), cell('b'), cell('c')], order, ['fx-one', 'fx-two', 'fx-three']).manifest;
    expect(m.order).toEqual(order);
    expect(m.trials).toHaveLength(18);
    expect(new Set(m.trials.slice(0, 12).map((t) => t.cell))).toEqual(new Set(['a', 'c']));
    expect(m.trials.slice(12).every((t) => t.cell === 'b')).toBe(true);
    const firstBlock = m.trials.slice(0, 12);
    expect(firstBlock.map((t) => t.id)).toEqual(interleaveTrials(firstBlock, ['a', 'b', 'c'], 11).map((t) => t.id));
    for (let i = 0; i < 12; i += 2) expect(new Set(firstBlock.slice(i, i + 2).map((t) => t.task)).size).toBe(1);
    const plan2 = renderPlan(m);
    expect(plan2).toContain('ORDER: interleave-task seed=11: trials run repetition by repetition, tasks in a seeded order and each task\'s cells in a seeded order, block by block');
    expect(plan2).toContain('ORDER-BLOCK: 1 first trials=12 cells=c,a');
    expect(plan2).toContain('ORDER-BLOCK: 2 second trials=6 cells=b');
  });

  test('a cell in no block, in two blocks, an unknown cell, an empty or duplicate block are refused', () => {
    const cells = [cell('a'), cell('b')];
    const tryOrder = (blocks: unknown) => { try { plan(cells, { kind: 'interleave-task', seed: 1, blocks }); return 'ok'; } catch (e) { return (e as Error).message; } };
    expect(tryOrder([{ name: 'x', cells: ['a'] }])).toContain('every cell must be in one block; missing b');
    expect(tryOrder([{ name: 'x', cells: ['a', 'b'] }, { name: 'y', cells: ['b'] }])).toContain('cell b is in blocks x and y');
    expect(tryOrder([{ name: 'x', cells: ['a', 'b', 'z'] }])).toContain('names "z", which is not a cell');
    expect(tryOrder([{ name: 'x', cells: [] }, { name: 'y', cells: ['a', 'b'] }])).toContain('block x lists no cells');
    expect(tryOrder([{ name: 'x', cells: ['a'] }, { name: 'x', cells: ['b'] }])).toContain('must be a unique lowercase name');
    expect(tryOrder([])).toContain('non-empty list');
    expect(tryOrder([{ name: 'x', cells: ['a', 'b'] }])).toBe('ok');
  });
});

