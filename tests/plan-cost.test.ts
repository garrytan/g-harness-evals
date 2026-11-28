// Pilot-priced projection (scripts/plan-cost.ts, runner/cost/projection.ts), keyless.
//
// Value: protects=a counted plan's price comes from its own pilot, so a run whose measured cost is about twice its guess
// is seen as over its stop before launch; fails_when=the projection counts charged reservations
// twice, drops infra or rerun money, prices a cell from too few trials, double counts finished trials mid-run, reads the
// wrong units for a Harbor or runner plan, or writes an absolute path into its receipt; why_new=projections were done by
// hand after each canary; seam=plan folders, trial records and SQLite ledgers written to a temporary directory;
// no_claim=that a pilot predicts a counted run's cost within any bound.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MIN_SCORED_UNITS, project, VM_USD_PER_HOUR, type CostRecord, type PlanUnits } from '../runner/cost/projection.ts';
import { planCost, readPlan } from '../scripts/plan-cost.ts';
import { familyCounts } from '../world/owner-identity/generate.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-plan-cost-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
let n = 0;
const dir = (name: string) => { const d = join(tmp, `${name}-${++n}`); mkdirSync(d, { recursive: true }); return d; };

/** A frontier-harbor/1 plan folder: one plan file per shard, each holding one cell of tasks x attempts, and a Markdown plan with its stop. */
function harborPlan(cells: Array<{ id: string; model?: string; tasks: number; attempts?: number; lease?: number }>, stop: number | null, opts: { runId?: string } = {}): string {
  const folder = dir('plan');
  cells.forEach((c, i) => {
    const name = `s${String(i + 1).padStart(2, '0')}`;
    writeFileSync(join(folder, `prereg-harbor-${name}.json`), JSON.stringify({ schema: 'frontier-harbor/1', run_id: opts.runId ?? 'fixture-run', task_list: { file: 'x' }, shared_order_seed: 's', cap_usd: 1000, reserve_usd: 10, concurrency: 4,
      cells: [{ id: c.id, model: c.model ?? 'anthropic:claude-opus-5-5', harness: 'hermes', attempts: c.attempts ?? 3, tasks: { from: 0, to: c.tasks }, stage: 'core', priority: 1 }],
      shards: [{ name, cells: [c.id], lease_usd: c.lease ?? 500 }] }));
  });
  writeFileSync(join(folder, 'PREREGISTRATION.md'), `# Fixture\n\n## Eval loop\n\n- Size: counted run\n- Paid budget: $1,000\n- Model judge: none\n${stop === null ? '' : `\n## Cost projection\n\n- Spend stop: $${stop.toLocaleString('en-US')}\n`}`);
  return folder;
}

interface Rec { cell: string; usd: number; termination?: string; reserved?: number; wall_ms?: number; first_run_usd?: number }
function results(records: Rec[], name = 'pilot'): string {
  const d = dir(name);
  writeFileSync(join(d, 'trials.jsonl'), records.map((r, i) => JSON.stringify({ trial_id: `x/${r.cell}/t${i}`, cell: r.cell, task: `t${i}`, termination: r.termination ?? 'completed', grade: 'pass', wall_ms: r.wall_ms ?? 600_000,
    usage: { usd: r.usd, ...(r.reserved ? { usd_reserved: r.reserved } : {}) }, ...(r.first_run_usd ? { frontier: { first_run_usd: r.first_run_usd } } : {}) })).join('\n') + '\n');
  return d;
}
const many = (cell: string, k: number, usd: number, extra: Partial<Rec> = {}): Rec[] => Array.from({ length: k }, () => ({ cell, usd, ...extra }));

function ledger(name: string, settled: number[]): string {
  const path = join(tmp, `${name}-${++n}.sqlite`);
  const lease = BudgetRun.openLease({ runId: name, leaseUsd: 5000, ledgerPath: path });
  for (const usd of settled) lease.settle(lease.reserve(usd + 1, `anthropic:claude-opus-5-5 chat [${name}]`), { usd, input_tokens: 1, output_tokens: 1 });
  return path;
}

const base = { results: [] as string[], ledgers: [] as string[], planFiles: [] as string[], map: {}, stop: null, own: null };

describe('the projection prices each cell from its own pilot', () => {
  test('$/unit is pilot dollars over scored units; charged reservations are inside usd and counted once', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    const pilot = results([...many('a', 5, 1, { reserved: 0.4 })]);
    const r = planCost({ ...base, folder, pilot: [pilot] });
    const c = r.projection.cells[0]!;
    expect(c.usd_per_unit).toBeCloseTo(1, 9);
    expect(c.pilot_usd_reserved).toBeCloseTo(2, 9);
    expect(c.units).toBe(30);
    expect(c.projected_usd).toBeCloseTo(30, 9);
    expect(r.lines.find(l => l.startsWith('CELL: a'))).toContain('reserved_in_pilot=$2.00');
  });

  test('infra and model-error money stays in the price, their trials stay out of the denominator, and rerun money counts', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 1000);
    const pilot = results([...many('a', 5, 1), { cell: 'a', usd: 2, termination: 'infra_error' }, { cell: 'a', usd: 0, termination: 'model_error' }, { cell: 'a', usd: 1, first_run_usd: 3 }]);
    const c = planCost({ ...base, folder, pilot: [pilot] }).projection.cells[0]!;
    expect(c.pilot_scored).toBe(6);
    expect(c.usd_per_unit).toBeCloseTo((5 + 2 + 0 + 4) / 6, 9);
    expect(c.unscored_share).toBeCloseTo(2 / 8, 9);
  });

  test('a cell with fewer than five scored pilot units is UNPRICED: no number, exit 4, and the total is a lower bound', () => {
    expect(MIN_SCORED_UNITS).toBe(5);
    const folder = harborPlan([{ id: 'a', tasks: 10 }, { id: 'b', tasks: 10 }], 1000);
    const pilot = results([...many('a', 5, 1), ...many('b', 4, 1), { cell: 'b', usd: 9, termination: 'infra_error' }]);
    const r = planCost({ ...base, folder, pilot: [pilot] });
    const b = r.projection.cells.find(c => c.id === 'b')!;
    expect(b.priced).toBe(false);
    expect(b.usd_per_unit).toBeNull();
    expect(r.projection.unpriced).toEqual(['b']);
    expect(r.projection.lower_bound).toBe(true);
    expect(r.exit).toBe(4);
    expect(r.lines.join('\n')).toContain('CELL: b model=anthropic:claude-opus-5-5 UNPRICED pilot=4/5 scored (needs 5)');
    expect(r.lines.at(-1)).toContain('NEXT: run a pilot of each unpriced cell');
  });

  test('mid-run, finished counted trials are subtracted from the units and their spend comes from the ledgers', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 1000);
    const pilot = results(many('a', 5, 2));
    const counted = results([...many('a', 12, 2), { cell: 'a', usd: 1, termination: 'infra_error' }], 'counted');
    const l = ledger('counted', [10, 15]);
    const p = planCost({ ...base, folder, pilot: [pilot], results: [counted], ledgers: [l] }).projection;
    expect(p.cells[0]!.done).toBe(12);
    expect(p.cells[0]!.remaining).toBe(18);
    expect(p.remaining_usd).toBeCloseTo(36, 9);
    expect(p.spent_usd).toBeCloseTo(25, 9);
    expect(p.total_usd).toBeCloseTo(25 + 36 + p.vm_remaining_usd, 9);
  });

  test('VM: spent from shard-vm.json receipts, remaining from the pilot median wall time over the plan concurrency', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 1000);
    const pilot = results(many('a', 5, 1, { wall_ms: 3_600_000 }));
    writeFileSync(join(pilot, 'shard-vm.json'), JSON.stringify({ cost: { list_price_usd: 3.5 } }));
    const p = planCost({ ...base, folder, pilot: [pilot] }).projection;
    expect(p.vm_spent_usd).toBeCloseTo(3.5, 9);
    expect(p.vm_remaining_usd).toBeCloseTo(30 * 1 / 4 * VM_USD_PER_HOUR, 9);
  });

  test('own model use is added only when given, and the stop comes from the plan or, recorded as such, from --stop', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    const pilot = results(many('a', 5, 1));
    const plain = planCost({ ...base, folder, pilot: [pilot] });
    expect(plain.stop_source).toBe('stop from PREREGISTRATION.md');
    expect(plain.lines.join('\n')).toContain('own model use not included (pass --own-usd)');
    const own = planCost({ ...base, folder, pilot: [pilot], own: 7, stop: 50 });
    expect(own.projection.total_usd - plain.projection.total_usd).toBeCloseTo(7, 9);
    expect(own.stop_source).toBe('stop from the command line; the plan says $100.00');
    const frozen = harborPlan([{ id: 'a', tasks: 10 }], null);
    expect(() => planCost({ ...base, folder: frozen, pilot: [pilot] })).toThrow(/HE-BUDGET-005 .*states no spend stop/);
  });

  test('over the stop is exit 3 with the amount and the route out; under is exit 0', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 20);
    const r = planCost({ ...base, folder, pilot: [results(many('a', 5, 1))] });
    expect(r.exit).toBe(3);
    expect(r.lines.at(-2)).toMatch(/^VERDICT: OVER HE-BUDGET-005 the projected total \$\d+\.\d\d passes the stop \$20\.00 by/);
    expect(r.lines.at(-1)).toContain('--override "<reason>" --override-by <thread code>');
    expect(planCost({ ...base, folder, pilot: [results(many('a', 5, 0.1))] }).exit).toBe(0);
  });

  test('unpriced wins over over-stop in the exit code (2 > 4 > 3)', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }, { id: 'b', tasks: 10 }], 1);
    expect(planCost({ ...base, folder, pilot: [results([...many('a', 5, 1), ...many('b', 1, 1)])] }).exit).toBe(4);
  });

  test('the bootstrap upper bound is printed beside the mean and warns when only it passes the stop', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 70);
    const r = planCost({ ...base, folder, pilot: [results([...many('a', 9, 0.5), { cell: 'a', usd: 15 }])] });
    expect(r.projection.cells[0]!.usd_per_unit_upper!).toBeGreaterThan(r.projection.cells[0]!.usd_per_unit!);
    expect(r.exit).toBe(0);
    expect(r.lines.join('\n')).toMatch(/WARN: the upper95 total \$\d+\.\d\d passes the stop \$70\.00/);
  });
});

describe('the plan units and the inputs', () => {
  test('a Harbor plan counts tasks x attempts per cell and takes a single-cell shard lease as the cell lease', () => {
    const { plan } = readPlan(harborPlan([{ id: 'a', tasks: 52, attempts: 3, lease: 180 }, { id: 'b', tasks: 10, attempts: 2 }], 100), []);
    expect(plan.cells.map(c => [c.id, c.units, c.lease_usd, c.shard])).toEqual([['a', 156, 180, 's01'], ['b', 20, 500, 's02']]);
    expect(plan.concurrency).toBe(4);
  });

  test('a Harbor cell picking tasks by { subset } or { ids } is counted, and one with no countable tasks is refused, never NaN', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 1);
    const file = join(folder, 'prereg-harbor-s01.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const shards = join(folder, 'shards.json');
    const text = JSON.stringify({ subsets: { s01: { tasks: ['t1', 't2', 't3', 't4'] }, dup: { tasks: ['t1', 't1'] } } });
    writeFileSync(shards, text);
    const withTasks = (tasks: object) => writeFileSync(file, JSON.stringify({ ...json, cells: [{ ...json.cells[0], tasks }] }));
    withTasks({ subset: shards, key: 's01', sha256: createHash('sha256').update(text).digest('hex') });
    expect(readPlan(folder, []).plan.cells[0]!.units).toBe(12);
    withTasks({ subset: shards, key: 's01', sha256: '0'.repeat(64) });
    expect(() => readPlan(folder, [])).toThrow(/HE-BUDGET-006 cell a .* does not have the preregistered sha256/);
    withTasks({ subset: shards, key: 'dup' });
    expect(() => readPlan(folder, [])).toThrow(/HE-BUDGET-006 cell a .* not a non-empty list of distinct task ids/);
    withTasks({ ids: ['t1', 't2', 't3'] });
    expect(readPlan(folder, []).plan.cells[0]!.units).toBe(9);
    withTasks({ from: 0 });
    expect(() => readPlan(folder, [])).toThrow(/HE-BUDGET-006 cell a .* has no countable tasks/);
  });

  test('a cell giving more than one task form is counted the way loadPlan runs it: ids, then subset, then range', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 1);
    const file = join(folder, 'prereg-harbor-s01.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const shards = join(folder, 'shards.json');
    writeFileSync(shards, JSON.stringify({ subsets: { s01: { tasks: ['t1', 't2', 't3', 't4', 't5'] } } }));
    const withTasks = (tasks: object) => writeFileSync(file, JSON.stringify({ ...json, cells: [{ ...json.cells[0], tasks }] }));
    withTasks({ subset: shards, key: 's01', from: 0, to: 1 });
    expect(readPlan(folder, []).plan.cells[0]!.units).toBe(15);
    withTasks({ ids: ['t1', 't2'], subset: shards, key: 's01', from: 0, to: 10 });
    expect(readPlan(folder, []).plan.cells[0]!.units).toBe(6);
  });

  test('a runner prereg.json counts its manifest trials and uses each cell ceiling', () => {
    const folder = dir('runner-plan');
    writeFileSync(join(folder, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: 'fixture-runner', question: 'fixture', tasks: { multiuser: ['cn-01-tamsin-cold-chain-site', 'cr-01-marrow-agrisupply-site-retraction'] }, wall_clock_s: { multiuser: 600 }, spend_cap_usd: 50, drop_order: [], minimum_v01: [],
      cells: [{ id: 'r1', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', utility_models: ['anthropic:claude-haiku-5-5'], slice: 'multiuser', split: 'dev', task_set: 'v0.3', config: 'route-hook', repetitions: 2, ceiling: { input_tokens: 250_000, output_tokens: 0 } }] }));
    const { plan } = readPlan(folder, []);
    expect(plan.format).toBe('runner');
    expect(plan.cells[0]).toMatchObject({ id: 'r1', units: 4, also: ['anthropic:claude-haiku-5-5'] });
    expect(plan.cells[0]!.lease_usd).toBeGreaterThan(0);
  });

  test('a folder with plans for several run ids is refused unless --plan-file names the ones that count', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    writeFileSync(join(folder, 'prereg-harbor-other.json'), JSON.stringify({ schema: 'frontier-harbor/1', run_id: 'another-run', concurrency: 1, cells: [{ id: 'z', model: 'anthropic:claude-opus-5-5', attempts: 1, tasks: { from: 0, to: 1 } }] }));
    expect(() => readPlan(folder, [])).toThrow(/HE-BUDGET-006 .* holds plans for 2 run ids/);
    expect(readPlan(folder, [join(folder, 'prereg-harbor-s01.json')]).plan.run_id).toBe('fixture-run');
  });

  test('a pilot whose cells match nothing is refused, and --map renames a pilot cell to its plan cell', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    const pilot = results(many('pilot-a', 5, 1));
    expect(() => planCost({ ...base, folder, pilot: [pilot] })).toThrow(/holds no records for this plan's cells \(it has pilot-a\).*--map/);
    expect(planCost({ ...base, folder, pilot: [pilot], map: { 'pilot-a': 'a' } }).projection.cells[0]!.priced).toBe(true);
  });

  test('a missing ledger is refused rather than read as $0 spent', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    expect(() => planCost({ ...base, folder, pilot: [results(many('a', 5, 1))], ledgers: [join(tmp, 'nope.sqlite')] })).toThrow(/HE-BUDGET-004/);
  });

  test('the receipt names inputs by repo-relative path or basename and sha256, never an absolute path', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    const r = planCost({ ...base, folder, pilot: [results(many('a', 5, 1))], ledgers: [ledger('pilot', [1])] });
    const text = JSON.stringify(r.receipt);
    expect(text).not.toContain(tmp);
    expect(text).not.toContain('/home/');
    expect(r.receipt).toMatchObject({ schema: 'plan-cost/1', run_id: 'fixture-run', verdict: 'under', stop_usd: 100 });
  });
});

describe('regression shape: a plan priced from guesses', () => {
  // Synthetic records whose measured per-trial cost runs 1.5 to 2.2 times the planned guess, the shape a November 2026
  // counted run hit. The stop here is 1.2x the guessed total. This pins the arithmetic on that shape; it is not evidence
  // the tool predicts.
  test('pilot prices put the guessed plan over its stop before launch', () => {
    const cells = [['a-hermes', 0.58, 0.96], ['a-openclaw', 0.54, 0.83], ['b-hermes', 0.94, 1.79], ['c-hermes', 0.72, 1.58]] as const;
    const guessed = cells.reduce((a, [, plan]) => a + plan * 156, 0);
    const folder = harborPlan(cells.map(([id]) => ({ id, tasks: 52, attempts: 3 })), Math.round(guessed * 1.2));
    const pilot = results(cells.flatMap(([id, , measured]) => many(id, 8, measured)));
    const r = planCost({ ...base, folder, pilot: [pilot] });
    expect(r.exit).toBe(3);
    expect(r.projection.remaining_usd).toBeCloseTo(cells.reduce((a, [, , m]) => a + m * 156, 0), 6);
  });
});

describe('the command line', () => {
  const run = (args: string[]) => spawnSync('bun', ['scripts/plan-cost.ts', ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  test('exit codes and the receipt file', () => {
    const folder = harborPlan([{ id: 'a', tasks: 10 }], 100);
    const pilot = results(many('a', 5, 1));
    const out = join(tmp, 'receipt.json');
    const ok = run([folder, '--pilot', pilot, '--out', out]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('VERDICT: UNDER');
    expect(JSON.parse(readFileSync(out, 'utf8')).schema).toBe('plan-cost/1');
    expect(run([folder, '--pilot', pilot, '--stop', '5']).status).toBe(3);
    expect(run([folder]).status).toBe(4);
    expect(run([]).status).toBe(2);
    expect(run([folder, '--pilot', pilot, '--bogus', 'x']).stderr).toContain('unknown flag --bogus');
  });
});

test('project() alone: an unpriced cell with nothing left to run does not make the total a lower bound', () => {
  const plan: PlanUnits = { run_id: 'p', format: 'frontier-harbor', concurrency: 1, cells: [{ id: 'a', model: 'm', also: [], units: 2, lease_usd: null, shard: null }], shards: [] };
  const done: CostRecord[] = [{ cell: 'a', termination: 'completed', usd: 1, usd_reserved: 0, wall_ms: 1 }, { cell: 'a', termination: 'completed', usd: 1, usd_reserved: 0, wall_ms: 1 }];
  const p = project({ plan, pilot: [], results: done, spent_usd: 2, vm_spent_usd: 0, own_usd: null, stop_usd: 10 });
  expect(p.lower_bound).toBe(false);
  expect(p.total_usd).toBe(2);
});

describe('a sealed held-out plan (owner-identity-2026-11)', () => {
  const folder = join(ROOT, 'docs/benchmarks/2026-11-21-owner-identity');
  const prereg = join(folder, 'prereg.json');

  test('each sealed cell counts its family profile from public files: 42 import and live tasks or 6 capture tasks, times 3 tries', () => {
    expect(familyCounts(48)).toEqual({ owner_identity_I: 38, owner_identity_L: 4, owner_identity_C: 6 });
    expect(familyCounts(17)).toEqual({ owner_identity_I: 11, owner_identity_L: 4, owner_identity_C: 2 });
    expect(familyCounts(49)).toBeNull();
    const { plan } = readPlan(folder, [prereg]);
    expect(plan.cells).toHaveLength(30);
    expect(plan.cells.find(c => c.id === 'cc-opus-n')).toMatchObject({ units: 126, lease_usd: null });
    expect(plan.cells.find(c => c.id === 'codex-sol-gc')).toMatchObject({ units: 18, lease_usd: null });
    expect(plan.cells.reduce((a, c) => a + c.units, 0)).toBe(3564);
  });

  test('a sealed cell whose families have no public count is refused, never counted as zero', () => {
    const copy = dir('sealed-plan');
    const json = JSON.parse(readFileSync(prereg, 'utf8'));
    json.cells[0].families = ['owner_identity_I', 'owner_identity_X'];
    writeFileSync(join(copy, 'prereg.json'), JSON.stringify(json));
    expect(() => readPlan(copy, [])).toThrow(/HE-BUDGET-006 cell cc-opus-n: sealed set owner-identity-b1 \(48 tasks\) has no public task count for families owner_identity_I, owner_identity_X/);
  });

  const strace = spawnSync('strace', ['-V'], { encoding: 'utf8' }).status === 0;
  test.skipIf(!strace)('pricing it opens nothing outside the repository and the runtime, and nothing of custody: no sealed root, key, bundle, drive or .git', () => {
    const log = join(dir('trace'), 'strace.log');
    const r = spawnSync('strace', ['-f', '-qq', '-e', 'trace=openat,execve', '-o', log, 'bun', 'scripts/plan-cost.ts', folder, '--plan-file', prereg, '--stop', '1650'],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('CELL: cc-opus-n model=anthropic:claude-opus-5-5 UNPRICED pilot=0/0 scored (needs 5) units=126');
    const lines = readFileSync(log, 'utf8').split('\n');
    const opened = lines.filter(l => / openat\(/.test(l) && /= \d+$/.test(l)).map(l => l.match(/openat\([^,]*, "([^"]*)"/)?.[1] ?? '');
    const execs = lines.filter(l => / execve\(/.test(l) && /= 0$/.test(l)).map(l => basename(l.match(/execve\("([^"]*)"/)?.[1] ?? ''));
    expect(opened).toContain(join(ROOT, 'tasks/multiuser/owner-identity-b1/heldout/MANIFEST.json'));
    const home = process.env.HOME ?? '/nonexistent';
    const runtime = ['/usr/', '/lib', '/proc/', '/sys/', '/etc/', '/dev/', '/tmp/', '/opt/', '/run/', `${dirname(process.execPath)}/`, ...['.bun', '.gstack', '.local', '.cache'].map(d => `${home}/${d}/`)];
    expect(opened.filter(p => p.split('/').includes('..'))).toEqual([]);
    const outside = opened.filter(p => p.startsWith('/') && !(p + '/').startsWith(ROOT + '/') && !(ROOT + '/').startsWith(p.replace(/\/?$/, '/')) && !runtime.some(r => p.startsWith(r)));
    expect(outside).toEqual([]);
    expect(opened.filter(p => p.startsWith(join(ROOT, '.git')) || /\.capy\/drive|\.age(-key)?$|bundle\.tar|\/custody\//.test(p))).toEqual([]);
    expect(execs.filter(e => ['git', 'age', 'ssh', 'gh'].includes(e))).toEqual([]);
  });
});

