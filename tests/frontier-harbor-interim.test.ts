// The interim look of the gstack cheap-model run (internal-task), keyless: each cell's first half of trials by score time, and every
// stop rule (harm, futility, the 20-task floor, infra share, no-gstack contamination) on synthetic records.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import type { GstackSpec } from '../scripts/frontier-harbor/analyze.ts';
import { bootstrapInterval, interimLook, renderDecisions } from '../scripts/frontier-harbor/interim.ts';

const ROOT = resolve(import.meta.dir, '..');
const RUN_DIR = join(ROOT, 'docs/benchmarks/2026-11-26-gstack-cheap-model');
const SPEC_INSTALLED = join(RUN_DIR, 'analysis-spec-installed.json');
const SPEC_TOLD = join(RUN_DIR, 'analysis-spec-told.json');
const specs = () => [SPEC_INSTALLED, SPEC_TOLD].map((p) => JSON.parse(readFileSync(p, 'utf8')) as GstackSpec);
const tmp = mkdtempSync(join(tmpdir(), 'gstack-interim-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const MODEL: Record<string, string> = { opus: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.2-sol', p1: 'particle:particle-1' };
const TASKS = Array.from({ length: 52 }, (_, i) => 'task-' + String(i).padStart(2, '0'));
const CELLS = [...new Map(specs().flatMap((s) => s.cells).map((c) => [c.id, c])).values()];
const T0 = Date.parse('2026-11-27T00:00:00Z');
const PER_TASK = CELLS.length * 3;

type Pattern = (task: number, attempt: number) => boolean;
interface Scenario { pass: (model: string, arm: string) => Pattern; termination?: (cell: string, task: number, attempt: number) => string | undefined }
const below = (k: number): Pattern => (i) => i < k;

/** Every trial of the run, scored task by task: task i of every cell ends before task i + 1 of any cell. */
function build(s: Scenario): TrialRecord[] {
  return CELLS.flatMap((c, ci) => TASKS.flatMap((task, i) => [1, 2, 3].map((a) => {
    const termination = s.termination?.(c.id, i, a) ?? 'completed';
    return {
      trial_id: 'gstack-cheap-model-2026-11/' + c.id + '/' + task + '/a' + a, cell: c.id, task, harness: c.harness, harness_mode: 'docker', model: MODEL[c.model], script: null,
      termination, grade: termination !== 'completed' ? 'n/a' : s.pass(c.model, c.arm)(i, a) ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [],
      cap_stop: false, turns: { planned: 1, run: 1, exits: [] }, usage: { usd: 1 }, wall_ms: 1000, started_at: new Date(T0).toISOString(),
      ended_at: new Date(T0 + 1000 * (i * PER_TASK + ci * 3 + a)).toISOString(), paths: {},
    } as unknown as TrialRecord;
  })));
}
const look = (s: Scenario, lookAt = 26 * PER_TASK, reads?: Record<string, number> | null, records = build(s)) => interimLook({ records, specs: specs(), look_at: lookAt, gstack_reads: reads === undefined ? noneReads(records) : reads, planned: 2808 });
const noneReads = (records: TrialRecord[]): Record<string, number> => Object.fromEntries(records.filter((t) => t.cell.endsWith('-none')).map((t) => [t.trial_id, 0]));
const stopped = (l: ReturnType<typeof look>) => l.decisions.filter((d) => d.stop).map((d) => [d.cell, d.stopped_by.join('+')]);

const helps: Scenario = { pass: (m, arm) => (arm !== 'none' && m === 'p1' ? below(20) : below(13)) };

describe('the look', () => {
  test('it keeps the first N trials by ended_at, ties by trial id, and leaves out a record with no score time', () => {
    const records = build(helps).reverse();
    (records[0] as { ended_at: string }).ended_at = '';
    const l = look(helps, 26 * PER_TASK, undefined, records);
    expect([l.look_at, l.trials_recorded, l.trials_with_score_time, l.trials_without_score_time]).toEqual([1404, 2808, 2807, 1]);
    expect(l.look_ends_at).toBe(new Date(T0 + 1000 * (25 * PER_TASK + (CELLS.length - 1) * 3 + 3)).toISOString());
    expect(l.score_time).toContain('ended_at');
    expect(l.decisions.every((d) => d.trials_in_look === 78)).toBe(true);
    expect(l.internal.arms.map((a) => a.analysis.lift.map((r) => r.tasks))).toEqual([[26, 26, 26], [26, 26, 26]]);
  });
  test('it refuses to look before N trials have a score time', () => {
    expect(() => look(helps, 2809)).toThrow(/only 2808 trial\(s\) have a score time so far; the look is at 2809/);
    expect(() => look(helps, 26 * PER_TASK + 1)).toThrow(/does not split evenly over the 18 cells/);
  });
  test('it takes each cell\'s first half, so cells that ran early never stand in for cells that ran late', () => {
    const late = (cell: string) => cell.includes('-openclaw-');
    const records = build(helps).map((t) => (late(t.cell) ? { ...t, ended_at: new Date(Date.parse(t.ended_at) + 1e9).toISOString() } : t));
    const l = look(helps, 26 * PER_TASK, undefined, records);
    expect(l.decisions.every((d) => d.trials_in_look === 78)).toBe(true);
    expect(l.internal.arms.map((a) => a.analysis.lift.map((r) => r.tasks))).toEqual([[26, 26, 26], [26, 26, 26]]);
    const early = records.filter((t) => !late(t.cell) || Date.parse(t.ended_at) < T0 + 1e9 + 1000 * 10 * PER_TASK);
    expect(() => look(helps, 26 * PER_TASK, undefined, early)).toThrow(/the look takes each cell's first 78 finished trials, and 9 cell\(s\) have fewer so far: [a-z0-9]+-openclaw-[a-z]+ \(30\)/);
  });
  test('the specs must be the run\'s two arms with the same no-gstack cells', () => {
    const [a] = specs();
    expect(() => interimLook({ records: build(helps), specs: [a!, a!], look_at: 10, gstack_reads: null, planned: null })).toThrow(/same gstack arm/);
  });
  test('a run where no rule holds continues every cell', () => {
    const l = look(helps);
    expect(stopped(l)).toEqual([]);
    expect(l.decisions).toHaveLength(18);
  });
});

describe('harm', () => {
  const harm: Scenario = { pass: (m, arm) => (arm === 'told' && m === 'sol' ? below(3) : arm !== 'none' && m === 'p1' ? below(20) : below(13)) };
  test('a model\'s two cells in one arm stop when its lift there has a 99.5% interval wholly below 0', () => {
    const l = look(harm);
    expect(stopped(l)).toEqual([['sol-hermes-told', 'harm'], ['sol-openclaw-told', 'harm']]);
    const sol = l.internal.arms.find((a) => a.arm === 'told')!.models.find((m) => m.model === 'sol')!;
    expect(sol.ci995![1]).toBeLessThan(0);
    expect(sol.harm).toBe(true);
  });
  test('19 paired tasks are too few, 20 are enough', () => {
    expect(stopped(look(harm, 19 * PER_TASK))).toEqual([]);
    expect(stopped(look(harm, 20 * PER_TASK))).toEqual([['sol-hermes-told', 'harm'], ['sol-openclaw-told', 'harm']]);
  });
  test('a lift whose interval reaches 0 does not stop', () => {
    const mixed: Scenario = { pass: (m, arm) => (arm === 'told' && m === 'sol' ? (i) => (i < 13 ? i >= 4 : i < 15) : arm !== 'none' && m === 'p1' ? below(20) : below(13)) };
    const l = look(mixed);
    const sol = l.internal.arms.find((a) => a.arm === 'told')!.models.find((m) => m.model === 'sol')!;
    expect(sol.lift!).toBeLessThan(0);
    expect(sol.ci995![1]).toBeGreaterThanOrEqual(0);
    expect(stopped(l)).toEqual([]);
  });
});

describe('futility', () => {
  test('all six cells of an arm stop when every model\'s lift there has a 99.5% upper bound below 5 points', () => {
    const flat: Scenario = { pass: (m, arm) => (arm === 'told' && m === 'p1' ? below(20) : below(13)) };
    const l = look(flat);
    expect(stopped(l)).toEqual(CELLS.filter((c) => c.arm === 'installed').map((c) => [c.id, 'futility']));
    expect(l.internal.arms.find((a) => a.arm === 'installed')!.futility).toBe(true);
    expect(l.internal.arms.find((a) => a.arm === 'told')!.futility).toBe(false);
  });
  test('one model with fewer than 20 paired tasks keeps the arm going', () => {
    const flat: Scenario = { pass: () => below(13), termination: (cell, task) => (cell === 'opus-hermes-installed' || cell === 'opus-openclaw-installed') && task >= 19 ? 'model_error' : undefined };
    const l = look(flat);
    expect(l.internal.arms.find((a) => a.arm === 'installed')!.models.find((m) => m.model === 'opus')!.paired_tasks).toBe(19);
    expect(stopped(l)).toEqual(CELLS.filter((c) => c.arm === 'told').map((c) => [c.id, 'futility']));
  });
});

describe('infra and contamination', () => {
  test('a cell stops when more than 20% of its trials in the look are infra_error, and 20% exactly continues', () => {
    const s: Scenario = { pass: () => below(3), termination: (cell, task, a) => (cell === 'opus-hermes-none' && task < 3 && a === 1) || (cell === 'opus-openclaw-none' && task < 4 && a === 1) ? 'infra_error' : undefined };
    const l = look(s, 5 * PER_TASK);
    expect(l.decisions.find((d) => d.cell === 'opus-hermes-none')).toMatchObject({ stop: false, trials_in_look: 15, infra_errors: 3 });
    expect(stopped(l)).toEqual([['opus-openclaw-none', 'infra']]);
  });
  test('a no-gstack cell stops when any of its trials read a gstack file, a gstack cell does not, and a trial past the look counts', () => {
    const records = build(helps);
    const id = (cell: string, task: number) => 'gstack-cheap-model-2026-11/' + cell + '/' + TASKS[task] + '/a1';
    const reads = { ...noneReads(records), [id('opus-hermes-none', 40)]: 2, [id('p1-hermes-installed', 0)]: 5 };
    const l = look(helps, 26 * PER_TASK, reads, records);
    expect(stopped(l)).toEqual([['opus-hermes-none', 'contamination']]);
    expect(l.decisions.find((d) => d.cell === 'opus-hermes-none')!.gstack_read_trials).toBe(1);
    expect(l.decisions.find((d) => d.cell === 'p1-hermes-installed')!.gstack_read_trials).toBeNull();
    expect(() => look(helps, 10, { ...noneReads(records), 'no-such-trial': 1 })).toThrow(/--gstack-reads names 1 trial/);
  });
  test('a --gstack-reads map that leaves out a no-gstack trial is refused, so a partial audit never certifies a cell', () => {
    const records = build(helps);
    const reads = noneReads(records);
    const left = records.find((t) => t.cell === 'sol-openclaw-none')!.trial_id;
    delete reads[left];
    expect(() => look(helps, 26 * PER_TASK, reads, records)).toThrow(/--gstack-reads must give a count for every no-gstack trial, and leaves out 1: /);
    expect(() => look(helps, 26 * PER_TASK, {}, records)).toThrow(/leaves out 936: /);
  });
  test('without the audit the look is refused, so it never gives a decision with contamination unchecked', () => {
    expect(() => look(helps, 26 * PER_TASK, null)).toThrow(/--gstack-reads is required/);
  });
  test('records of another run, the pilot included, and a trial id recorded twice are refused', () => {
    const records = build(helps);
    const pilot = records.map((t) => (t.cell === 'p1-hermes-told' && t.task === 'task-00' ? ({ ...t, trial_id: t.trial_id.replace('gstack-cheap-model-2026-11/', 'gstack-cheap-model-pilot-2026-11/') } as TrialRecord) : t));
    expect(() => look(helps, 26 * PER_TASK, noneReads(pilot), pilot)).toThrow(/3 record\(s\) are not trials of gstack-cheap-model-2026-11, for example gstack-cheap-model-pilot-2026-11\/p1-hermes-told\/task-00\/a1/);
    expect(() => look(helps, 26 * PER_TASK, undefined, [...records, records[0]!])).toThrow(/1 trial id\(s\) appear in more than one record/);
  });
});

test('bootstrapInterval takes the two-sided percentile interval, and [0, 0] when nothing varied', () => {
  const draws = Array.from({ length: 10000 }, (_, i) => i / 10000);
  const stats = { n_clusters: 30, delta: 0.5, bootstrap: draws } as unknown as Parameters<typeof bootstrapInterval>[0];
  expect(bootstrapInterval(stats, 0.995)).toEqual([25 / 10000, 9974 / 10000]);
  expect(bootstrapInterval({ n_clusters: 30, delta: 0, bootstrap: [] } as unknown as Parameters<typeof bootstrapInterval>[0], 0.995)).toEqual([0, 0]);
  expect(bootstrapInterval(null, 0.995)).toBeNull();
});

test('the CLI reads shard results dirs, writes interim.json with pass rates only under internal, and prints only decisions', () => {
  const harm: Scenario = { pass: (m, arm) => (arm === 'told' && m === 'sol' ? below(3) : arm !== 'none' && m === 'p1' ? below(20) : below(13)) };
  const records = build(harm);
  const shards = ['s1', 's2'].map((s, k) => {
    const d = join(tmp, s);
    mkdirSync(d, { recursive: true });
    const mine = records.filter((_, i) => i % 2 === k);
    if (k === 0) writeFileSync(join(d, 'trials.jsonl'), mine.map((t) => JSON.stringify(t)).join('\n') + '\n');
    else writeFileSync(join(d, 'trials.journal.jsonl'), mine.map((record) => JSON.stringify({ journaled_at: record.ended_at, meter_total_usd: 0, record })).join('\n') + '\n');
    return d;
  });
  const reads = join(tmp, 'reads.json');
  writeFileSync(reads, JSON.stringify({ ...noneReads(records), [records.find((t) => t.cell === 'p1-openclaw-none')!.trial_id]: 1 }));
  const out = join(tmp, 'out');
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  const args = [join(ROOT, 'scripts/frontier-harbor/interim.ts'), '--results', shards[0]!, '--results', shards[1]!, '--spec', SPEC_INSTALLED, '--spec', SPEC_TOLD, '--look-at', '1404', '--gstack-reads', reads];
  expect(spawnSync('bun', args, { encoding: 'utf8', env }).status).toBe(2);
  const res = spawnSync('bun', [...args, '--out', out], { encoding: 'utf8', env });
  expect(res.status).toBe(0);
  const lines = res.stdout.trim().split('\n');
  expect(lines[0]).toStartWith('INTERIM: gstack-cheap-model-2026-11: look at 1404 of unknown planned trials, ordered by ended_at');
  const cellLines = lines.slice(1, -2);
  expect(cellLines).toHaveLength(18);
  for (const line of cellLines) expect(line).toMatch(/^[a-z0-9]+-(hermes|openclaw)-(none|installed|told): (continue|stop \((harm|contamination): .*\))$/);
  expect(cellLines.filter((x) => x.includes(': stop')).sort()).toEqual([
    'p1-openclaw-none: stop (contamination: 1 trial(s) read a gstack file)',
    'sol-hermes-told: stop (harm: this model\'s lift with gstack told has a 99.5% interval wholly below 0 on at least 20 paired tasks)',
    'sol-openclaw-told: stop (harm: this model\'s lift with gstack told has a 99.5% interval wholly below 0 on at least 20 paired tasks)',
  ]);
  expect(res.stdout).not.toMatch(/pass/i);
  const j = JSON.parse(readFileSync(join(out, 'interim.json'), 'utf8'));
  expect(JSON.stringify(j.decisions)).not.toContain('pass_rate');
  expect(j.internal.note).toStartWith('internal:');
  expect(j.internal.arms[1].analysis.cells[0].pass_rate.estimate).toBeGreaterThan(0);
}, 120_000);
