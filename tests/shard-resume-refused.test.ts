// The shard_resume stop rule (matrix-mu-2026-11): a VM lost mid-run ends its cell as incomplete and is never resumed.
// A resume from the backup's ledger would reissue spent lease: the lost VM spent $8 after the last pull, the restored
// ledger shows only $2, and the resumed proxy could charge $8 more, $18 against a $10 lease. These tests rebuild that case
// with the repository's ledger and show every resume path refusing before any VM call or charge: --resume on
// scripts/ubicloud/run-shard.sh, a pass-through `-- --resume`, a relaunch into the same --dest (results copied back, or only a
// shard-vm.json that records launched_at, as a lost VM leaves it), and on scripts/run-shard.sh
// both --resume and the implicit resume when <out> already holds trials.
import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetExceededError, BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';

const ROOT = join(import.meta.dir, '..');
const PLACEHOLDER = 'placeholder-not-a-key';
const LEASE = 'matrix-mu-test';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const committed = (path: string) => { const db = new Database(path, { readonly: true }); const row = db.query('SELECT committed_usd FROM runs WHERE run_id = ?').get(LEASE) as { committed_usd: number }; db.close(); return row.committed_usd; };
const charge = (path: string, usd: number) => { const run = BudgetRun.openLease({ runId: LEASE, leaseUsd: 10, ledgerPath: path, runner: 'test' }); run.settle(run.reserve(usd, 'trial'), { usd }); closeLedgers(); };

// The lost VM's ledger: $2 before the last backup pull (the snapshot), $8 after it, $10 in all.
function lostVm(dir: string): { live: string; snapshot: string } {
  const live = join(dir, 'vm-ledger.sqlite'), snapshot = join(dir, 'backup-ledger.sqlite');
  charge(live, 2);
  copyFileSync(live, snapshot);
  charge(live, 8);
  return { live, snapshot };
}

function shardOut(dir: string, snapshot: string, o: { shardJson?: boolean; trials?: boolean } = {}) {
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  copyFileSync(snapshot, join(out, 'ledger.sqlite'));
  if (o.shardJson) writeFileSync(join(out, 'shard.json'), JSON.stringify({ name: 's1' }));
  if (o.trials) writeFileSync(join(out, 'trials.jsonl'), JSON.stringify({ trial_id: `${LEASE}/opus/t1/r1` }) + '\n');
  return out;
}

function repoWithScripts(dir: string) {
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  return repo;
}

function setup(prereg: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'he-shard-resume-'));
  dirs.push(dir);
  const repo = repoWithScripts(dir);
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: LEASE, cells: [{ id: 'opus', harness: 'hermes', model: 'anthropic:claude-opus-5-5' }], ...prereg }));
  const { snapshot } = lostVm(dir);
  const runner = join(dir, 'ubi-runner.sh');
  writeFileSync(runner, '#!/usr/bin/env bash\necho "$1" >> "$(dirname "$0")/calls"\nexit 1\n');
  chmodSync(runner, 0o755);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER, OPENAI_API_KEY: PLACEHOLDER };
  const calls = () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '');
  // scripts/ubicloud/run-shard.sh with --dest <dir>/dest; its results/ holds the backup copy when withResults is set.
  const ubi = (args: string[], withResults: boolean, shardVm?: Record<string, unknown>) => {
    const dest = join(dir, 'dest');
    rmSync(dest, { recursive: true, force: true });
    if (shardVm) { mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify(shardVm)); }
    if (withResults) { mkdirSync(join(dest, 'results'), { recursive: true }); copyFileSync(snapshot, join(dest, 'results', 'ledger.sqlite')); writeFileSync(join(dest, 'results', 'shard.json'), JSON.stringify({ name: 's1' })); }
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'opus', '--lease-usd', '10', '--dest', dest, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env });
    return { code: r.status, err: r.stderr, ledger: withResults ? committed(join(dest, 'results', 'ledger.sqlite')) : null };
  };
  // scripts/run-shard.sh (the runner on the VM, and the Capy shard path) with --out holding the backup copy.
  const direct = (args: string[], o: { shardJson?: boolean; trials?: boolean }) => {
    rmSync(join(dir, 'out'), { recursive: true, force: true });
    const out = shardOut(dir, snapshot, o);
    const r = spawnSync('bash', [join(repo, 'scripts', 'run-shard.sh'), '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'opus', '--lease-usd', '10', '--out', out, '--skip-build', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env });
    return { code: r.status, err: r.stderr, ledger: committed(join(out, 'ledger.sqlite')) };
  };
  return { dir, snapshot, calls, ubi, direct };
}

describe('shard_resume refused: a lost VM is never resumed (matrix-mu-2026-11)', () => {
  test('the hazard: resuming on the backup ledger lets $18 be charged against a $10 lease', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-shard-hazard-'));
    dirs.push(dir);
    const { live, snapshot } = lostVm(dir);
    expect(committed(live)).toBe(10);
    expect(() => charge(live, 8)).toThrow(BudgetExceededError);
    expect(committed(snapshot)).toBe(2);
    charge(snapshot, 8);
    expect(committed(live) + committed(snapshot) - 2).toBe(18);
  });

  test('scripts/ubicloud/run-shard.sh refuses --resume, a pass-through -- --resume and a relaunch into the same --dest, before any VM call or charge', () => {
    const s = setup({ shard_resume: 'refused' });
    for (const [args, withResults] of [[['--resume'], true], [['--', '--resume'], false], [[], true]] as const) {
      const r = s.ubi([...args], withResults);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`run ${LEASE}'s preregistration sets shard_resume refused`);
      if (r.ledger !== null) expect(r.ledger).toBe(2);
    }
    expect(s.calls()).toBe('');
  }, 60_000);

  test('scripts/ubicloud/run-shard.sh refuses a rerun into a --dest whose shard-vm.json records launched_at, with no results copied back (a lost VM)', () => {
    const s = setup({ shard_resume: 'refused' });
    const launched = { name: 's1', vm: 'he-s1-lost', launched_at: '2026-11-05T01:00:00Z', cleanup: 'pending' };
    for (const args of [[], ['--', '--resume']]) {
      const r = s.ubi(args, false, launched);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`run ${LEASE}'s preregistration sets shard_resume refused`);
    }
    expect(s.calls()).toBe('');
    expect(s.ubi([], false, { name: 's1', vm: 'he-s1-prebuild', cleanup: 'done', exit: 4 }).err).not.toContain('shard_resume refused');
    expect(s.calls()).not.toBe('');
  }, 60_000);

  test('scripts/run-shard.sh refuses --resume and the implicit resume of an <out> that holds trials, leaving the backup ledger at $2', () => {
    const s = setup({ shard_resume: 'refused' });
    for (const [args, o] of [[['--resume'], { shardJson: true, trials: true }], [[], { trials: true }], [[], { shardJson: true }]] as const) {
      const r = s.direct([...args], o);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`run ${LEASE}'s preregistration sets shard_resume refused`);
      expect(r.ledger).toBe(2);
    }
  }, 60_000);

  test('without shard_resume, both scripts let a resume past the check', () => {
    const s = setup({});
    expect(s.ubi(['--resume'], true).err).not.toContain('shard_resume refused');
    expect(s.calls()).not.toBe('');
    expect(s.direct(['--resume'], { shardJson: true, trials: true }).err).not.toContain('shard_resume refused');
  }, 60_000);

  test('with shard_resume refused, a fresh launch into an empty --dest passes the check', () => {
    const s = setup({ shard_resume: 'refused' });
    expect(s.ubi([], false).err).not.toContain('shard_resume refused');
    expect(s.calls()).not.toBe('');
  }, 60_000);
});
