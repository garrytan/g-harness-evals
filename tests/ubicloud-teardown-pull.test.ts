// internal-task: scripts/ubicloud/run-shard.sh copies a shard's results off the VM only at teardown, so a teardown that destroys
// the VM after a failed pull loses the results. Keyless, no VM.
//
// Value: protects=teardown keeps the VM (no down call) when the pull of shard/results fails or <dest>/results is missing
// after it, writes the VM id to <dest>/cleanup-pending and leaves shard-vm.json at cleanup "pending" with a reason, and
// still destroys the VM after a good pull, when the shard stopped at the smoke (exit 4, no counted run) or when the VM
// answers that it holds no shard/results;
// fails_when=a failed or empty pull is followed by down, or a good pull no longer destroys the VM; why_new=the destroy was
// unconditional; seam=UBI_RUNNER with a fake ubi-runner.sh that records every call, driven through --attach;
// no_claim=a real VM, ssh or tar, and mid-run replication of results.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

type Pull = 'fails' | 'empty' | 'ok';

function attach(o: { pull: Pull; exit?: number; remoteResults?: 'yes' | 'no' }) {
  const dir = mkdtempSync(join(tmpdir(), 'he-ubi-teardown-'));
  dirs.push(dir);
  const calls = join(dir, 'calls.log');
  const results = { fails: 'exit 1', empty: 'exit 0', ok: 'mkdir -p "$3/results" && echo \'{"name": "s1"}\' > "$3/results/shard.json" && echo \'{"trial_id": "t"}\' > "$3/results/trials.jsonl"' }[o.pull];
  const runner = join(dir, 'ubi-runner.sh');
  writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'cmd=$1; shift',
    'printf "%s\\n" "$cmd $*" >> "' + calls + '"',
    'case "$cmd" in',
    '  pull) case "$2" in shard/results) ' + results + ' ;; *) exit 1 ;; esac ;;',
    '  down) exit 0 ;;',
    '  ssh) case "$2" in *"cat ~/shard/exit"*) echo ' + (o.exit ?? 0) + '; echo "::trials 1" ;; *"shard-results="*) ' + (o.remoteResults ? 'echo shard-results=' + o.remoteResults : ':') + ' ;; esac; cat > /dev/null ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(runner, 0o755);
  const dest = join(dir, 'dest');
  mkdirSync(dest);
  writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 's1', vm: 'vm1', size: 'standard-16', sealed: false, workload: 'harness', cleanup: 'pending' }));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder-not-a-key' };
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), '--attach', '--dest', dest, '--poll-seconds', '1'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return {
    code: r.status,
    err: r.stderr,
    calls: read(calls).split('\n').filter(Boolean),
    pending: read(join(dest, 'cleanup-pending')),
    shardVm: JSON.parse(read(join(dest, 'shard-vm.json'))),
    laneLog: read(join(dest, 'lane.log')),
  };
}

describe('ubicloud/run-shard.sh teardown keeps the VM when its results did not come back', () => {
  for (const pull of ['fails', 'empty'] as const) {
    test(`a pull that ${pull === 'fails' ? 'fails' : 'brings back no results/'} leaves the VM up, in cleanup-pending, with cleanup still pending`, () => {
      const r = attach({ pull });
      expect(r.code, r.err).toBe(0);
      expect(r.calls.some((c) => c.startsWith('pull vm1 shard/results '))).toBe(true);
      expect(r.calls.some((c) => c.startsWith('down '))).toBe(false);
      expect(r.pending).toBe('vm1\n');
      expect(r.shardVm.cleanup).toBe('pending');
      expect(r.shardVm.cleanup_reason).toBe('results not pulled; VM kept');
      expect(r.shardVm.destroyed_at).toBeUndefined();
      expect(r.laneLog).toContain('vm1 is NOT destroyed');
    }, 60_000);
  }

  test('a good pull still destroys the VM and records the destroy', () => {
    const r = attach({ pull: 'ok' });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain('down vm1');
    expect(r.pending).toBe('');
    expect(r.shardVm.cleanup).toBe('done');
    expect(r.shardVm.destroyed_at).toBeString();
  }, 60_000);

  test('a shard that failed before the counted run (exit 3) on a VM that answers it has no shard/results is destroyed', () => {
    const r = attach({ pull: 'fails', exit: 3, remoteResults: 'no' });
    expect(r.code).toBe(3);
    expect(r.calls).toContain('down vm1');
    expect(r.pending).toBe('');
    expect(r.shardVm.cleanup).toBe('done');
  }, 60_000);

  test('a shard that stopped at the smoke (exit 4, no counted run) is destroyed even though it has no results tree', () => {
    const r = attach({ pull: 'fails', exit: 4 });
    expect(r.code).toBe(4);
    expect(r.calls).toContain('down vm1');
    expect(r.pending).toBe('');
    expect(r.shardVm.cleanup).toBe('done');
  }, 60_000);
});
