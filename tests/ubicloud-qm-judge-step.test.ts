// internal-task Amendment 3: the judge step in scripts/ubicloud/vm-shard.sh --workload qm-driver. A main or forced shard of the
// QM edition eval is graded on the VM by judge-shard.ts after the driver exits, on the shard's own lease; every other run
// (calibration, headroom, pilot) is not. A fake bun in the script's PATH records the calls, so no VM, no model and no spend.
//
// Value: protects=main and forced shards come back with both judges' grades made on their own lease, and the calibration
// shard (whose trial ids repeat main's) is never graded as main; fails_when=the judge step is skipped for a main or forced
// shard, runs for another run id or stage, gets another lease or the wrong keys, or a judge failure leaves the shard exit
// at 0; seam=a fake bun in vm-shard.sh's PATH; no_claim=judge-shard.ts itself (tests/qm-s1-edition-judges.test.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LEDGER_CLI = join(ROOT, 'runner', 'ledger', 'budget-ledger.ts');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function home(judgeExit = 0, keys = true) {
  const h = mkdtempSync(join(tmpdir(), 'he-vm-qm-judge-'));
  dirs.push(h);
  const repo = join(h, 'work', 'harness-evals');
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'x');
  if (keys) { mkdirSync(join(h, 'shard', 'tasks'), { recursive: true }); writeFileSync(join(h, 'shard', 'tasks', 'keys.json'), '{}'); writeFileSync(join(h, 'shard', 'tasks', 'tasks.json'), '[]'); }
  mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
  const bun = join(h, '.bun', 'bin', 'bun');
  writeFileSync(bun, [
    '#!/usr/bin/env bash',
    'case $1 in',
    '  --version) echo 1.0 ;;',
    '  runner/ledger/budget-ledger.ts) shift; exec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(LEDGER_CLI) + ' "$@" ;;',
    '  -e) exec ' + JSON.stringify(process.execPath) + ' "$@" ;;',
    '  harnesses/qm/gstack/s1e-probe.ts) [ "$2" = --dry-run ] && exit 0; echo "$*" >> "$HOME/driver.log" ;;',
    '  harnesses/qm/gstack/judge-shard.ts) echo "$*" >> "$HOME/judge.log"; exit ' + judgeExit + ' ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(bun, 0o755);
  return { h, commit: g('rev-parse', 'HEAD').trim() };
}

function vmShard(x: ReturnType<typeof home>, args: string[], lease = '61.25') {
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', x.commit, '--prereg', 'x.json', '--name', 'opus-b1', '--cells', 'opus.b1', '--lease-usd', lease, '--workload', 'qm-driver', '--', ...args],
    { cwd: x.h, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: x.h, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, driver: read(join(x.h, 'driver.log')), judge: read(join(x.h, 'judge.log')), exit: read(join(x.h, 'shard', 'exit')).trim() };
}

describe('vm-shard.sh --workload qm-driver judge step', () => {
  test('a main shard is graded after the driver, on its own lease, with the shard keys', () => {
    const x = home();
    const r = vmShard(x, ['--stage', 'main', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-main']);
    expect(r.code, r.out).toBe(0);
    expect(r.driver).toContain('--run-id qm-s1-edition-2026-11-main');
    expect(r.judge.trim()).toBe('harnesses/qm/gstack/judge-shard.ts --results ' + join(x.h, 'shard', 'results') + ' --run-id qm-s1-edition-2026-11-main --lease-usd 61.25 --keys ' + join(x.h, 'shard', 'tasks', 'keys.json') + ' --tasks ' + join(x.h, 'shard', 'tasks', 'tasks.json'));
  }, 60_000);

  test('a forced shard is graded the same way', () => {
    const x = home();
    const r = vmShard(x, ['--arms', 'forced', '--stage', 'forced', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-forced'], '5.62');
    expect(r.code, r.out).toBe(0);
    expect(r.judge).toContain('--run-id qm-s1-edition-2026-11-forced --lease-usd 5.62');
  }, 60_000);

  test('the calibration shard, a headroom shard and a mismatched stage are not graded', () => {
    for (const args of [
      ['--stage', 'main', '--shards', '1', '--run-id', 'qm-s1-edition-2026-11-calibration'],
      ['--stage', 'headroom', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-headroom'],
      ['--stage', 'forced', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-main'],
    ]) {
      const x = home();
      const r = vmShard(x, args);
      expect(r.code, r.out).toBe(0);
      expect(r.driver).not.toBe('');
      expect(r.judge).toBe('');
    }
  }, 120_000);

  test('a judge failure, or no keys to grade with, is the shard exit when the driver exited 0', () => {
    const failed = home(5);
    expect(vmShard(failed, ['--stage', 'main', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-main']).exit).toBe('5');
    const nokeys = home(0, false);
    const r = vmShard(nokeys, ['--stage', 'main', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-main']);
    expect(r.exit).toBe('5');
    expect(r.judge).toBe('');
    expect(r.out).toContain('the plan trials are ungraded');
  }, 120_000);
});
