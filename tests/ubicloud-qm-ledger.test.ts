// The qm-driver shard's ledger step in scripts/ubicloud/vm-shard.sh, against the real ledger code: the ledger the step
// leaves behind is one the metering proxy's BudgetRun.openLease accepts, the lease still caps spending on it, and a
// ledger that already holds a run that is not a lease stops the shard. A fake bun in the script's PATH hands the ledger
// CLI and the step's inline script to the real bun and records the driver's call, so no VM, no model and no spend.
//
// Value: protects=a paid qm-driver shard's proxy can open its lease on the shard ledger, and the lease still binds;
// fails_when=the step leaves a program ledger (openLease refuses it, HE-PROXY-003), the marker lets a reservation past the
// lease through, or a ledger holding another run is reused; seam=a fake bun in vm-shard.sh's PATH; no_claim=a real VM,
// docker or the driver itself.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetExceededError, BudgetRun } from '../runner/ledger/budget-ledger.ts';

const ROOT = join(import.meta.dir, '..');
const LEDGER_CLI = join(ROOT, 'runner', 'ledger', 'budget-ledger.ts');
const PLACEHOLDER = 'placeholder-not-a-key';
const RUN_ID = 'qm-s1-edition-2026-11-headroom';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const cleanEnv = (home: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home });

function home() {
  const h = mkdtempSync(join(tmpdir(), 'he-vm-qm-ledger-'));
  dirs.push(h);
  const repo = join(h, 'work', 'harness-evals');
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'x');
  mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
  const bun = join(h, '.bun', 'bin', 'bun');
  writeFileSync(bun, [
    '#!/usr/bin/env bash',
    'case $1 in',
    '  --version) echo 1.0 ;;',
    '  runner/ledger/budget-ledger.ts) shift; exec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(LEDGER_CLI) + ' "$@" ;;',
    '  -e) exec ' + JSON.stringify(process.execPath) + ' "$@" ;;',
    '  harnesses/qm/gstack/s1e-probe.ts) [ "$2" = --dry-run ] && exit 0; echo "$*" >> "$HOME/driver.log" ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(bun, 0o755);
  return { h, commit: g('rev-parse', 'HEAD').trim(), ledger: join(h, 'shard', 'results', 'ledger.sqlite') };
}

function vmShard(x: ReturnType<typeof home>, lease = '4.92') {
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', x.commit, '--prereg', 'x.json', '--name', 'opus-b1', '--cells', 'opus.b1', '--lease-usd', lease, '--workload', 'qm-driver', '--', '--stage', 'headroom', '--shards', '8'],
    { cwd: x.h, encoding: 'utf8', timeout: 60_000, env: { ...cleanEnv(x.h), USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, driver: read(join(x.h, 'driver.log')), exit: read(join(x.h, 'shard', 'exit')).trim() };
}

const cli = (x: ReturnType<typeof home>, ...a: string[]) => execFileSync(process.execPath, [LEDGER_CLI, ...a], { cwd: x.h, encoding: 'utf8', env: cleanEnv(x.h) });

describe('vm-shard.sh --workload qm-driver ledger step, real ledger code', () => {
  test('the ledger it creates is a lease ledger openLease accepts, at the lease', () => {
    const x = home();
    const r = vmShard(x);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('ledger: lease ledger at $4.92, no runs yet');
    expect(r.driver).toContain('--ledger ' + x.ledger + ' --lease-usd 4.92');
    const run = BudgetRun.openLease({ runId: RUN_ID, leaseUsd: 4.92, ledgerPath: x.ledger, maxOutputTokens: 128_000, runner: 'metering-proxy' });
    expect(run.programCapUsd).toBeCloseTo(4.92, 9);
  }, 60_000);

  test('a reservation past the lease is refused on that ledger, so the cap still binds', () => {
    const x = home();
    expect(vmShard(x).code).toBe(0);
    const run = BudgetRun.openLease({ runId: RUN_ID, leaseUsd: 4.92, ledgerPath: x.ledger, maxOutputTokens: 128_000, runner: 'metering-proxy' });
    expect(() => run.reserve(5, 'one call above the lease')).toThrow(BudgetExceededError);
    run.reserve(4, 'within the lease');
    expect(() => run.reserve(1, 'a second call past the lease')).toThrow(BudgetExceededError);
  }, 60_000);

  test('a ledger that already holds a run that is not a lease stops the shard before the driver', () => {
    const x = home();
    mkdirSync(join(x.h, 'shard', 'results'), { recursive: true });
    cli(x, 'init', '--budget-ledger', x.ledger, '--program-cap-usd', '4.92', '--reason', 'test');
    cli(x, 'open', '--budget-ledger', x.ledger, '--runner', 'other-runner', '--budget-usd', '1');
    const r = vmShard(x);
    expect(r.code, r.out).toBe(2);
    expect(r.exit).toBe('2');
    expect(r.out).toContain('and is not a lease ledger');
    expect(r.driver).toBe('');
    expect(() => BudgetRun.openLease({ runId: RUN_ID, leaseUsd: 4.92, ledgerPath: x.ledger, maxOutputTokens: 128_000, runner: 'metering-proxy' })).toThrow(BudgetExceededError);
  }, 60_000);

  test('a resumed lease ledger that holds its lease run is kept, and the lease continues', () => {
    const x = home();
    expect(vmShard(x).code).toBe(0);
    BudgetRun.openLease({ runId: RUN_ID, leaseUsd: 4.92, ledgerPath: x.ledger, maxOutputTokens: 128_000, runner: 'metering-proxy' }).reserve(1, 'first attempt');
    rmSync(join(x.h, 'driver.log'));
    const r = vmShard(x);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('ledger: lease ledger with 1 run(s); the proxy continues its lease');
    const run = BudgetRun.openLease({ runId: RUN_ID, leaseUsd: 4.92, ledgerPath: x.ledger, maxOutputTokens: 128_000, runner: 'metering-proxy' });
    expect(() => run.reserve(4, 'past what is left of the lease')).toThrow(BudgetExceededError);
  }, 60_000);

  test('a fresh ledger whose program cap is not the lease stops the shard', () => {
    const x = home();
    mkdirSync(join(x.h, 'shard', 'results'), { recursive: true });
    cli(x, 'init', '--budget-ledger', x.ledger, '--program-cap-usd', '9', '--reason', 'test');
    const r = vmShard(x);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain('not the lease $4.92');
    expect(r.driver).toBe('');
  }, 60_000);
});
