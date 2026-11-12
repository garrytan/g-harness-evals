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
//
// internal-task: a teardown pull over an earlier pull's read-only files (git objects in a trial workspace are 0444) failed at the
// merge, so the VM was kept with its results already copied back (internal-task, all five shards). The merge now makes the local
// tree writable first. A complete pull whose merge still fails replaces <dest>/results (the earlier tree moves aside and
// shard-vm.json names it) and the VM goes, except on a sealed shard, which keeps its VM. A kept VM prints a UBICLOUD line.
// A mid-run pull that cannot be merged deletes its staged copy and writes no mirror (midRun: the fake reports the shard
// running for two polls with --replicate-seconds 1 and records <dest>/.pull and the mirror after the first replicate).

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { spawnSync('chmod', ['-R', 'u+w', d]); rmSync(d, { recursive: true, force: true }); } });

type Pull = 'fails' | 'empty' | 'ok' | 'git';
const OBJ = 'trials/c/t/r1/workspace/.git/objects/ab/cdef';

function attach(o: { pull: Pull; exit?: number; remoteResults?: 'yes' | 'no'; earlier?: 'read-only' | 'conflict'; sealed?: boolean; downFails?: boolean; midRun?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'he-ubi-teardown-'));
  dirs.push(dir);
  const calls = join(dir, 'calls.log');
  const ok = 'mkdir -p "$3/results" && echo \'{"name": "s1"}\' > "$3/results/shard.json" && echo \'{"trial_id": "t"}\' > "$3/results/trials.jsonl"';
  const git = `mkdir -p "$3/results/$(dirname ${OBJ})" && echo new > "$3/results/${OBJ}" && chmod 444 "$3/results/${OBJ}"`;
  const results = { fails: 'exit 1', empty: 'exit 0', ok, git: `${ok} && ${git}` }[o.pull];
  const runner = join(dir, 'ubi-runner.sh');
  const dest = join(dir, 'dest');
  const replica = join(dir, 'replica');
  const snap = join(dir, 'mid-run.txt');
  const exitCheck = o.midRun
    ? 'if [ ! -f "' + snap + '.1" ]; then : > "' + snap + '.1"; elif [ -f "' + snap + '" ]; then echo ' + (o.exit ?? 0) + '; else { [ -e "' + dest + '/.pull" ] && echo pull=yes || echo pull=no; [ -e "' + replica + '/s1/results" ] && echo mirror=yes || echo mirror=no; } > "' + snap + '"; fi; echo "::trials 1"'
    : 'echo ' + (o.exit ?? 0) + '; echo "::trials 1"';
  writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'cmd=$1; shift',
    'printf "%s\\n" "$cmd $*" >> "' + calls + '"',
    'case "$cmd" in',
    '  pull) case "$2" in shard/results) ' + results + ' ;; *) exit 1 ;; esac ;;',
    '  down) exit ' + (o.downFails ? 1 : 0) + ' ;;',
    '  ssh) case "$2" in *"cat ~/shard/exit"*) ' + exitCheck + ' ;; *"shard-results="*) ' + (o.remoteResults ? 'echo shard-results=' + o.remoteResults : ':') + ' ;; esac; cat > /dev/null ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(runner, 0o755);
  mkdirSync(dest);
  if (o.earlier === 'read-only') {
    mkdirSync(join(dest, 'results', OBJ, '..'), { recursive: true });
    writeFileSync(join(dest, 'results', OBJ), 'old\n');
    chmodSync(join(dest, 'results', OBJ), 0o444);
  }
  if (o.earlier === 'conflict') mkdirSync(join(dest, 'results', 'trials.jsonl'), { recursive: true });
  writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 's1', vm: 'vm1', size: 'standard-16', sealed: o.sealed ?? false, workload: 'harness', cleanup: 'pending' }));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder-not-a-key' };
  const args = ['--attach', '--dest', dest, '--poll-seconds', '1', ...(o.midRun ? ['--replicate-seconds', '1', ...(o.sealed ? [] : ['--replicate-to', replica])] : [])];
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return {
    code: r.status,
    err: r.stderr,
    calls: read(calls).split('\n').filter(Boolean),
    pending: read(join(dest, 'cleanup-pending')),
    shardVm: JSON.parse(read(join(dest, 'shard-vm.json'))),
    laneLog: read(join(dest, 'lane.log')),
    midRun: read(snap),
    dest,
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
      expect(r.err).toContain('UBICLOUD: left=1 owner=test-owner vm=vm1 kept=1 reason=results-not-pulled');
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

  test.skipIf(process.getuid?.() === 0)('a pull over read-only git objects an earlier pull left merges them and destroys the VM', () => {
    const r = attach({ pull: 'git', earlier: 'read-only' });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain('down vm1');
    expect(r.pending).toBe('');
    expect(r.shardVm.cleanup).toBe('done');
    expect(readFileSync(join(r.dest, 'results', OBJ), 'utf8')).toBe('new\n');
    expect(existsSync(join(r.dest, '.pull'))).toBe(false);
  }, 60_000);

  test('a complete pull whose merge fails becomes results/, the earlier tree moves aside, and the VM is destroyed', () => {
    const r = attach({ pull: 'ok', earlier: 'conflict' });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain('down vm1');
    expect(r.shardVm.cleanup).toBe('done');
    expect(readFileSync(join(r.dest, 'results', 'trials.jsonl'), 'utf8')).toBe('{"trial_id": "t"}\n');
    const partial = readdirSync(r.dest).filter((f) => f.startsWith('results.partial-'));
    expect(partial).toHaveLength(1);
    expect(r.shardVm.results_partial).toBe(join(r.dest, partial[0]));
    expect(existsSync(join(r.dest, '.pull'))).toBe(false);
    expect(r.laneLog).toContain('could not be merged over');
  }, 60_000);

  test('a sealed shard whose pull cannot be merged keeps its VM and says so', () => {
    const r = attach({ pull: 'ok', earlier: 'conflict', sealed: true });
    expect(r.code, r.err).toBe(0);
    expect(r.calls.some((c) => c.startsWith('down '))).toBe(false);
    expect(r.pending).toBe('vm1\n');
    expect(r.shardVm.cleanup).toBe('pending');
    expect(r.err).toContain('UBICLOUD: left=1 owner=test-owner vm=vm1 kept=1 reason=results-not-pulled');
    expect(existsSync(join(r.dest, '.pull'))).toBe(false);
    expect(r.laneLog).toContain('its staged plaintext copy');
  }, 60_000);

  for (const sealed of [false, true]) {
    test(`a mid-run pull that cannot be merged deletes its staged copy and writes no mirror${sealed ? ' (sealed shard)' : ''}`, () => {
      const r = attach({ pull: 'ok', earlier: 'conflict', midRun: true, sealed });
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain(sealed ? 'its staged plaintext copy' : 'replicate: the pull from vm1 came back but could not be merged');
      expect(r.midRun).toBe('pull=no\nmirror=no\n');
    }, 60_000);
  }

  test('a failed down keeps the VM id and prints the UBICLOUD line', () => {
    const r = attach({ pull: 'ok', downFails: true });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain('down vm1');
    expect(r.pending).toBe('vm1\n');
    expect(r.shardVm.cleanup).toBe('failed');
    expect(r.err).toContain('UBICLOUD: left=1 owner=test-owner vm=vm1 kept=1 reason=down-failed');
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
