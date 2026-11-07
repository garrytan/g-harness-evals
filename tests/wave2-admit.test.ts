// internal-task (H10) PR 5: wave-2 admission (scripts/ubicloud/wave2-admit.ts), keyless. Wave-1 ledgers are real SQLite budget
// ledgers with settled spend; block preregistrations are written to a temporary directory and priced by runner/run.ts.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, chatPrice, closeLedgers, reservationUsd } from '../runner/ledger/budget-ledger.ts';
import { admit, blockCeilings, fanoutManifest, settledSpend, type BlockSpec } from '../scripts/ubicloud/wave2-admit.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-wave2-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

/** A ledger whose lease settled the given dollars, as a wave-1 shard (counted or smoke) leaves it. */
function ledger(name: string, settled: number[]): string {
  const path = join(tmp, `${name}.sqlite`);
  const lease = BudgetRun.openLease({ runId: name, leaseUsd: 500, ledgerPath: path });
  for (const usd of settled) lease.settle(lease.reserve(usd + 1, `anthropic:claude-opus-5-5 chat [${name}]`), { usd, input_tokens: 1, output_tokens: 1 });
  return path;
}

/** A block prereg: cells on two v0.3 dev tasks (cn-01 has 2 member turns, cr-01 has 3) at $1 a turn (250,000 input tokens of Opus 5.5 at $4). */
function block(id: string, cells: number, precondition = true): BlockSpec {
  const dir = join(tmp, 'waves', id);
  mkdirSync(dir, { recursive: true });
  const prereg = { schema_version: 1, run_id: `h10-fixture-${id}`, question: 'fixture', tasks: { multiuser: ['cn-01-tamsin-cold-chain-site', 'cr-01-marrow-agrisupply-site-retraction'] }, wall_clock_s: { multiuser: 600 }, spend_cap_usd: 50, drop_order: [], minimum_v01: [],
    cells: Array.from({ length: cells }, (_, i) => ({ id: `${id}-c${i + 1}`, harness: 'openclaw', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', task_set: 'v0.3', config: 'route-hook', repetitions: 1, ceiling: { input_tokens: 250_000, output_tokens: 0 } })) };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg, null, 2));
  return { id, prereg: join(dir, 'prereg.json'), precondition: { holds: precondition, note: precondition ? 'landed' : 'did not land' } };
}

const F = block('f-openclaw', 2);
const G = block('g-slot', 1);
const withCeilings = (bs: BlockSpec[]) => bs.map((b) => ({ ...blockCeilings(b), precondition: b.precondition }));

describe('ceilings come from each block\'s preregistration', () => {
  test('counted is the plan ceiling and smoke one member turn per cell, each plus one proxy call reservation ($2.96 for Opus 5.5, input at the 1-hour cache-write rate), rounded up to the cent', () => {
    expect(blockCeilings(F)).toEqual({ id: 'f-openclaw', run_id: 'h10-fixture-f-openclaw', cells: ['f-openclaw-c1', 'f-openclaw-c2'], counted_usd: 12.96, smoke_usd: 4.96 });
    expect(blockCeilings(G)).toMatchObject({ counted_usd: 7.96, smoke_usd: 3.96 });
  });
  test('a one-cell Opus block\'s smoke lease holds the proxy\'s reservation for one call, so its first call is not refused', () => {
    const opus = chatPrice('anthropic:claude-opus-5-5')!;
    const call = reservationUsd({ provider: 'anthropic', model: 'claude-opus-5-5', kind: 'chat', input: opus.input, output: opus.output, cache_write: opus.cache_write, cacheWritePremium: true, cacheWrite1h: true, inputTokens: 50_000, maxOutputTokens: 128_000 });
    expect(call).toBeCloseTo(2.96, 9);
    const one = blockCeilings(block('o-opus', 1));
    expect(one.smoke_usd).toBeGreaterThanOrEqual(call);
    expect(one).toMatchObject({ smoke_usd: 3.96, counted_usd: 7.96 });
    const capped = blockCeilings({ ...block('o-opus-64k', 1), options: ['--', '--max-output-tokens', '64000'] });
    expect(capped).toMatchObject({ smoke_usd: 2.68, counted_usd: 6.68 });
    const repeated = blockCeilings({ ...block('o-opus-repeat', 1), options: ['--', '--max-output-tokens', '1024', '--max-output-tokens', '64000'] });
    expect(repeated).toMatchObject({ smoke_usd: 2.68, counted_usd: 6.68 });
  });
});

describe('admission against the wave-1 headroom', () => {
  test('both preconditions hold and both blocks fit: both are admitted, in order', () => {
    const spent = settledSpend([ledger('a-counted', [100, 10]), ledger('a-smoke', [10])]);
    expect(spent.total).toBeCloseTo(120, 9);
    const r = admit(150, spent.total, withCeilings([F, G]));
    expect(r.decisions.map((d) => d.verdict)).toEqual(['admit', 'admit']);
    expect(r.decisions[1]!.headroom_before).toBeCloseTo(12.08, 9);
  });
  test('headroom for only the first block: the second is dropped whole, never split', () => {
    const r = admit(150, settledSpend([ledger('b-counted', [115]), ledger('b-smoke', [10])]).total, withCeilings([F, G]));
    expect(r.decisions.map((d) => [d.id, d.verdict])).toEqual([['f-openclaw', 'admit'], ['g-slot', 'drop']]);
    expect(r.decisions[1]!.why).toContain('above the 7.08 left');
  });
  test('a block that does not fit is dropped and a later one that fits is still admitted', () => {
    const r = admit(150, 135, withCeilings([F, G]));
    expect(r.decisions.map((d) => d.verdict)).toEqual(['drop', 'admit']);
  });
  test('a failed precondition skips its block without using headroom', () => {
    const r = admit(150, 130, withCeilings([block('f-hermes', 2, false), G]));
    expect(r.decisions.map((d) => d.verdict)).toEqual(['skip', 'admit']);
    expect(r.decisions[0]!.why).toBe('precondition does not hold (did not land)');
  });
  test('smoke ledgers count toward the cap: leaving one out would have admitted a block that does not fit', () => {
    const counted = ledger('d-counted', [118]);
    const smoke = ledger('d-smoke', [5]);
    expect(admit(150, settledSpend([counted]).total, withCeilings([F, G])).decisions.map((d) => d.verdict)).toEqual(['admit', 'admit']);
    expect(admit(150, settledSpend([counted, smoke]).total, withCeilings([F, G])).decisions.map((d) => d.verdict)).toEqual(['admit', 'drop']);
  });
  test('a missing ledger, or none, is HE-BUDGET-004', () => {
    expect(() => settledSpend([join(tmp, 'nope.sqlite')])).toThrow(/^HE-BUDGET-004 ledger .*nope.sqlite does not exist/);
    expect(() => settledSpend([])).toThrow(/^HE-BUDGET-004 no --ledger given/);
  });
});

describe('the command', () => {
  test('prints the headroom and one line per block, and writes each admitted block\'s fan-out manifest', () => {
    const waves = join(tmp, 'waves.json');
    writeFileSync(waves, JSON.stringify({ cap_usd: 150, blocks: [F, block('f-hermes-x', 2, false), G] }));
    const out = join(tmp, 'admitted');
    const p = spawnSync('bun', [join(ROOT, 'scripts', 'ubicloud', 'wave2-admit.ts'), '--blocks', waves, '--ledger', ledger('e-counted', [110]), '--ledger', ledger('e-smoke', [10]), '--out', out, '--commit', 'abc123', '--dest', '/results/h10-wave2'],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(p.status, p.stderr).toBe(0);
    expect(p.stdout).toContain('HEADROOM: cap 150.00 minus wave-1 settled 120.0000 over 2 ledger(s) = 30.0000');
    expect(p.stdout).toMatch(/ADMIT: f-openclaw run=h10-fixture-f-openclaw counted_lease=12.96 smoke_lease=4.96/);
    expect(p.stdout).toMatch(/SKIP: f-hermes-x /);
    expect(p.stdout).toMatch(/ADMIT: g-slot run=h10-fixture-g-slot counted_lease=7.96 smoke_lease=3.96/);
    const m = JSON.parse(readFileSync(join(out, 'g-slot.fanout.json'), 'utf8'));
    expect(m).toEqual({ commit: 'abc123', prereg: G.prereg, dest: '/results/h10-wave2/g-slot', size: 'standard-16', options: ['--smoke-lease-usd', '3.96'], shards: [{ name: 'g-slot', cells: 'g-slot-c1', lease_usd: 7.96 }] });
    const bad = spawnSync('bun', [join(ROOT, 'scripts', 'ubicloud', 'wave2-admit.ts'), '--blocks', waves, '--ledger', join(tmp, 'gone.sqlite')], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^HE-BUDGET-004 /);
  });
});

describe('the fan-out manifests (#271 review, blockers 1 and 2)', () => {
  test('the smoke lease stays a run-shard.sh flag when the block options pass runner extras after --', () => {
    const d = admit(150, 0, withCeilings([G])).decisions[0]!;
    const m = fanoutManifest(d, { ...G, options: ['--gbrain-image', 'harness-eval/gbrain:dev', '--', '--max-output-tokens', '128000'] }, 'abc123', '/results/h10-wave2');
    expect(m.options).toEqual(['--gbrain-image', 'harness-eval/gbrain:dev', '--smoke-lease-usd', '3.96', '--', '--max-output-tokens', '128000']);
    expect(fanoutManifest(d, G, 'abc123', '/results/h10-wave2').options).toEqual(['--smoke-lease-usd', '3.96']);
  });
  test('a rerun clears the manifests an earlier run left in --out, so a block dropped now has none to launch', () => {
    const waves = join(tmp, 'waves-rerun.json');
    writeFileSync(waves, JSON.stringify({ cap_usd: 150, blocks: [F, G] }));
    const out = join(tmp, 'admitted-rerun');
    const run = (spent: number) => spawnSync('bun', [join(ROOT, 'scripts', 'ubicloud', 'wave2-admit.ts'), '--blocks', waves, '--ledger', ledger(`r${spent}`, [spent]), '--out', out, '--commit', 'abc123', '--dest', '/results/h10-wave2'],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    const first = run(100);
    expect(first.status, first.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['f-openclaw.fanout.json', 'g-slot.fanout.json']);
    writeFileSync(join(out, 'notes.txt'), 'kept');
    const second = run(135);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/DROP: f-openclaw /);
    expect(second.stdout).toMatch(/CLEARED: .*f-openclaw\.fanout\.json/);
    expect(readdirSync(out).sort()).toEqual(['g-slot.fanout.json', 'notes.txt']);
  });
});

