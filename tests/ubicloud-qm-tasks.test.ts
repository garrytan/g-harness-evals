// The qm-driver shard's task step in scripts/ubicloud/vm-shard.sh: --tasks-bank and --tasks-seed among the shard's
// arguments generate the task repositories on the VM with the real edition-fixture.ts, check them against fixtures.json,
// record their digests in ~/shard/results/tasks-gen.json, and hand the driver --tasks. Keyless: a fake bun in the
// script's PATH runs the real generator for the generator call and records every other call, so no VM, no model and no spend.
//
// Value: protects=a paid qm-driver shard gets the preregistered tasks on its VM, generated with no key in the environment,
// and a failed generation or check stops the shard before the smoke and any paid call; fails_when=the step is missing (the
// driver gets --tasks-bank instead of --tasks), the generator sees a key, a tampered repository passes, or a failure still
// reaches the ledger; seam=a fake bun in vm-shard.sh's PATH; no_claim=a real VM, docker or the driver itself.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BANK = join(ROOT, 'tests', 'fixtures', 'qm-s1-edition', 'test-only-bank.json');
const PLACEHOLDER = 'placeholder-not-a-key';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function shard(opts: { bank?: string; tamper?: boolean }) {
  const home = mkdtempSync(join(tmpdir(), 'he-vm-qm-tasks-'));
  dirs.push(home);
  const repo = join(home, 'work', 'harness-evals');
  mkdirSync(join(repo, 'bank'), { recursive: true });
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  copyFileSync(BANK, join(repo, 'bank', 'bank.json'));
  writeFileSync(join(repo, 'bank', 'broken.json'), '{}\n');
  writeFileSync(join(repo, 'bank', 'seed.txt'), 'test-seed/vm-shard\n');
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'x');
  const commit = g('rev-parse', 'HEAD').trim();
  if (opts.tamper) writeFileSync(join(home, 'tamper'), '');
  mkdirSync(join(home, '.bun', 'bin'), { recursive: true });
  const bun = join(home, '.bun', 'bin', 'bun');
  writeFileSync(bun, [
    '#!/usr/bin/env bash',
    'k=unset; [ -n "${ANTHROPIC_API_KEY:+x}" ] && k=set',
    'echo "$k $1" >> "$HOME/bun.log"',
    'case $1 in',
    '  --version) echo 1.0 ;;',
    '  runner/ledger/budget-ledger.ts) touch "$4" ;;',
    '  harnesses/qm/gstack/edition-fixture.ts) shift; ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(join(ROOT, 'harnesses', 'qm', 'gstack', 'edition-fixture.ts')) + ' "$@" || exit $?',
    '    [ -f "$HOME/tamper" ] && echo x > "$HOME/shard/tasks/repos/$(ls "$HOME/shard/tasks/repos" | head -1)/stray.txt"; exit 0 ;;',
    '  harnesses/qm/gstack/s1e-probe.ts) echo "$k $*" >> "$HOME/driver.log" ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(bun, 0o755);
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', commit, '--prereg', 'x.json', '--name', 'opus-b1', '--cells', 'opus.b1', '--lease-usd', '5.62', '--workload', 'qm-driver',
    '--', '--stage', 'headroom', '--shards', '8', '--tasks-bank', opts.bank ?? 'bank/bank.json', '--tasks-seed', 'bank/seed.txt', '--seed', '1514'],
    { cwd: home, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, home, repo, bun: read(join(home, 'bun.log')).split('\n').filter(Boolean), driver: read(join(home, 'driver.log')).split('\n').filter(Boolean), exit: read(join(home, 'shard', 'exit')).trim() };
}

describe('vm-shard.sh --workload qm-driver task step', () => {
  test('generates the tasks keyless before the smoke, records their digests and passes --tasks to the driver', () => {
    const r = shard({});
    const h = r.home;
    expect(r.code, r.out).toBe(0);
    expect(r.bun.indexOf('unset harnesses/qm/gstack/edition-fixture.ts')).toBeGreaterThanOrEqual(0);
    expect(r.bun.indexOf('unset harnesses/qm/gstack/edition-fixture.ts')).toBeLessThan(r.bun.indexOf('unset harnesses/qm/gstack/s1e-probe.ts'));
    const counted = r.driver.find((l) => l.includes('--ledger'))!;
    expect(counted).toStartWith('set ');
    expect(counted).toContain('--stage headroom --shards 8 --seed 1514 --tasks ' + h + '/shard/tasks/tasks.json');
    expect(counted).not.toContain('--tasks-bank');
    expect(counted).not.toContain('--tasks-seed');
    const rec = JSON.parse(read(join(h, 'shard', 'results', 'tasks-gen.json')));
    const tasks = JSON.parse(read(join(h, 'shard', 'tasks', 'tasks.json')));
    expect(rec.tasks).toBe(JSON.parse(read(BANK)).templates.length);
    expect(rec.tasks).toBe(tasks.length);
    expect(rec.tasks_json_sha256).toBe(sha(join(h, 'shard', 'tasks', 'tasks.json')));
    expect(rec.bank_sha256).toBe(sha(join(r.repo, 'bank', 'bank.json')));
    expect(rec.seed_sha256).toBe(sha(join(r.repo, 'bank', 'seed.txt')));
  }, 120_000);

  test('a repository that is not at its recorded head with a clean tree stops the shard before the smoke and the ledger', () => {
    const r = shard({ tamper: true });
    expect(r.code, r.out).toBe(4);
    expect(r.exit).toBe('4');
    expect(r.out).toContain('the check against fixtures.json failed');
    expect(r.bun.some((l) => l.includes('s1e-probe.ts') || l.includes('budget-ledger.ts'))).toBe(false);
    expect(existsSync(join(r.home, 'shard', 'results', 'tasks-gen.json'))).toBe(false);
  }, 120_000);

  test('a generation failure stops the shard before the smoke and the ledger', () => {
    const r = shard({ bank: 'bank/broken.json' });
    expect(r.code, r.out).toBe(4);
    expect(r.exit).toBe('4');
    expect(r.out).toContain('tasks: generation failed');
    expect(r.bun.some((l) => l.includes('s1e-probe.ts') || l.includes('budget-ledger.ts'))).toBe(false);
  }, 120_000);
});
