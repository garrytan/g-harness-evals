// scripts/ubicloud/fanout.sh: an interrupt while shards run. fanout.sh is copied beside a fake run-shard.sh and given a fake
// ubi-runner.sh through its UBI_RUNNER hook, so the wait loop runs without a VM; the fake shard records the TERM it is forwarded.
//
// Value: protects=a TERM during the wait loop is forwarded to the shard and fanout.sh finishes its table and exits 1;
// fails_when=wait -n -p leaves done_pid unset on the signal and the guard in the loop reads it unguarded (unbound variable
// under set -u, the fan-out dies with the VMs still running); why_new=no test ran fanout.sh past --dry-run;
// seam=UBI_RUNNER (existing) and a fake run-shard.sh beside a copy of the script; no_claim=real shards, quota requeue.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FANOUT = join(import.meta.dir, '..', 'scripts', 'ubicloud', 'fanout.sh');

function script(dir: string, name: string, body: string) {
  const f = join(dir, name);
  writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(f, 0o755);
}

describe('fanout.sh interrupt', () => {
  test('SIGTERM while a shard runs is forwarded, the loop survives the interrupted wait and the exit is 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-'));
    try {
      copyFileSync(FANOUT, join(dir, 'fanout.sh'));
      script(dir, 'run-shard.sh', 'trap \'echo term > "' + dir + '/got-term"; exit 130\' TERM\nwhile :; do sleep 0.2; done');
      script(dir, 'ubi-runner.sh', 'echo "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), shards: [{ name: 'only', cells: 'c1', lease_usd: 1 }] }));
      const driver = 'bash "$1" --manifest "$2" & p=$!; sleep 4; kill -TERM $p; wait $p; echo "fanout exit $?"';
      const r = spawnSync('bash', ['-c', driver, 'driver', join(dir, 'fanout.sh'), join(dir, 'manifest.json')], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      expect(r.stderr).not.toContain('unbound variable');
      expect(r.stderr).toContain('interrupted: forwarding to 1 shard process(es)');
      expect(r.stderr).toContain('shard only exited 130');
      expect(existsSync(join(dir, 'got-term'))).toBe(true);
      expect(r.stdout).toContain('fanout exit 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('fanout.sh repeated interrupts', () => {
  // Value: protects=a TERM, HUP and INT in a row (a cancelled operation or a closed terminal) log the interrupt once and
  // forward one TERM to each shard, so a second signal never cuts into the shard's copy-back and VM destroy; fails_when=each
  // signal logs again or re-signals the shard; why_new=fanout.sh logged its interrupt three times (internal-task carried item,
  // lane follow-up item 6); seam=UBI_RUNNER and a fake run-shard.sh beside a copy of the script; no_claim=real shards
  test('three signals log the interrupt once and forward one TERM to the shard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-'));
    try {
      copyFileSync(FANOUT, join(dir, 'fanout.sh'));
      script(dir, 'run-shard.sh', 'trap \'echo term >> "' + dir + '/got-term"; sleep 1; exit 130\' TERM\nwhile :; do sleep 0.2; done');
      script(dir, 'ubi-runner.sh', 'echo "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), shards: [{ name: 'only', cells: 'c1', lease_usd: 1 }] }));
      const driver = 'bash "$1" --manifest "$2" & p=$!; sleep 4; kill -TERM $p; sleep 0.2; kill -HUP $p; sleep 0.2; kill -INT $p; wait $p; echo "fanout exit $?"';
      const r = spawnSync('bash', ['-c', driver, 'driver', join(dir, 'fanout.sh'), join(dir, 'manifest.json')], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      expect(r.stderr.split('\n').filter((l) => l.includes('interrupted: forwarding'))).toHaveLength(1);
      expect(readFileSync(join(dir, 'got-term'), 'utf8')).toBe('term\n');
      expect(r.stderr).toContain('shard only exited 130');
      expect(r.stdout).toContain('fanout exit 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
