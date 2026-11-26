// scripts/ubicloud/fanout.sh: each batch reads ubi-runner.sh usage once and launches no more shards than fit under
// UBI_QUOTA_VCPUS (464 by default) and the caller's --max-vcpus allowance. fanout.sh is copied beside a fake run-shard.sh
// and given a fake ubi-runner.sh through its UBI_RUNNER hook; the fake usage counts the fake shards that are running.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FANOUT = join(import.meta.dir, '..', 'scripts', 'ubicloud', 'fanout.sh');
const SHARDS = ['s1', 's2', 's3', 's4', 's5'];

function script(dir: string, name: string, body: string) {
  const f = join(dir, name);
  writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(f, 0o755);
}

// A fake project: usage is `base` vCPUs from other owners plus 16 per fake shard running. Each fake shard records how many
// shards were running when it started, runs 7 s (longer than fanout.sh's 2 s between launches) and exits 0.
function fanout(base: number | 'unreadable', args: string[], shard?: (dir: string, live: string) => string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'he-fanout-room-'));
  try {
    copyFileSync(FANOUT, join(dir, 'fanout.sh'));
    const live = join(dir, 'live');
    mkdirSync(live);
    script(dir, 'run-shard.sh', shard ? shard(dir, live).join('\n') : [
      'name=$(sed -E "s/.*--name ([^ ]+).*/\\1/" <<<"$*")',
      'touch "' + live + '/$name"',
      'ls "' + live + '" | wc -l >> "' + dir + '/concurrent"',
      'echo "$name" >> "' + dir + '/started"',
      'sleep 7',
      'rm -f "' + live + '/$name"',
      'exit 0',
    ].join('\n'));
    script(dir, 'ubi-runner.sh', base === 'unreadable'
      ? 'echo x >> "' + dir + '/usage-calls"; exit 1'
      : 'echo x >> "' + dir + '/usage-calls"; n=$(ls "' + live + '" | wc -l); echo "total $n $(( ' + base + ' + 16 * n ))"');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), size: 'standard-16', shards: SHARDS.map((name) => ({ name, cells: 'c-' + name, lease_usd: 1 })) }));
    const r = spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), ...args], {
      encoding: 'utf8',
      timeout: 150_000,
      env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
    });
    const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean) : []);
    return { status: r.status, stderr: r.stderr, concurrent: read('concurrent').map(Number), started: read('started'), usageCalls: read('usage-calls').length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('fanout.sh batches to the room left', () => {
  // Value: protects=no batch launches more than floor((464 - usage) / 16) standard-16 shards, so shards started together
  // cannot all pass the runner's per-VM preflight on the same usage and take the project past 464; fails_when=fanout.sh
  // launches every shard at once (or --parallel of them) without reading usage before each batch, as it did before;
  // why_new=the org quota rule (2026-11-16) says the preflight is no lock and a fan-out must size each batch to the room
  // left; seam=UBI_RUNNER (existing) and a fake run-shard.sh beside a copy of the script; no_claim=real Ubicloud usage or
  // other owners' creates between the usage read and the launch
  test('with 427 vCPUs in use, at most 2 shards run at once, usage is read once per batch, and all 5 finish', () => {
    const r = fanout(427, []);
    expect(r.stderr).toContain('batch: the project uses 427 of 464 vCPUs, room for 2 standard-16 VM(s); launching 2 of 5 queued');
    expect(Math.max(...r.concurrent)).toBe(2);
    expect([...r.started].sort()).toEqual(SHARDS);
    expect(r.usageCalls).toBe(r.stderr.split('\n').filter((l) => l.includes(' fanout: batch: ')).length + 1);
    expect(r.status).toBe(0);
  }, 150_000);
});

describe('fanout.sh keeps to the caller allowance', () => {
  // Value: protects=--max-vcpus is this fan-out's own allowance, counted against its running shards, so a 48 vCPU
  // allowance runs at most 3 standard-16 shards whatever other owners use; fails_when=--max-vcpus is read as the project
  // maximum (the old meaning: 16 vCPUs of other owners leave room for only 2) or is not checked again after the first
  // batch; why_new=a crew's evals keep to their own allowance (208 vCPUs a crew, 2026-11-16); seam=UBI_RUNNER (existing)
  // and a fake run-shard.sh; no_claim=one allowance shared by several fan-outs at once
  test('--max-vcpus 48 with 16 vCPUs of other owners runs at most 3 shards at once and all 5 finish', () => {
    const r = fanout(16, ['--max-vcpus', '48']);
    expect(r.stderr).toContain('this fan-out runs 0 of the 3 its 48 vCPUs allow; launching 3 of 5 queued');
    expect(Math.max(...r.concurrent)).toBe(3);
    expect([...r.started].sort()).toEqual(SHARDS);
    expect(r.status).toBe(0);
  }, 150_000);
});

describe('fanout.sh counts launched shards that have no VM yet', () => {
  // Value: protects=a shard that exits before its batch-mates have created their VMs does not hand their room to the next
  // batch, so the project stays under 464; fails_when=each batch sizes room from project usage alone, which does not list
  // a launched shard until its VM exists; why_new=the /ship review of this change (s1 exits at once, the next batch read
  // 427 and launched 2 more, 475 in use); seam=UBI_RUNNER (existing), a fake run-shard.sh that writes shard-vm.json's
  // created_epoch when its VM appears; no_claim=other owners' creates between the usage read and the launch
  test('with 427 vCPUs in use and one shard exiting before the others have VMs, at most 2 run at once', () => {
    const r = fanout(427, [], (dir, live) => [
      'name=$(sed -E "s/.*--name ([^ ]+).*/\\1/" <<<"$*")',
      'echo "$name" >> "' + dir + '/started"',
      '[ "$name" = s1 ] && exit 3',
      'sleep 5',
      'mkdir -p "' + dir + '/dest/$name" && echo "{\"created_epoch\": $(date +%s)}" > "' + dir + '/dest/$name/shard-vm.json"',
      'touch "' + live + '/$name"',
      'ls "' + live + '" | wc -l >> "' + dir + '/concurrent"',
      'sleep 6',
      'rm -f "' + live + '/$name"',
      'exit 0',
    ]);
    expect(Math.max(...r.concurrent)).toBe(2);
    expect([...r.started].sort()).toEqual(SHARDS);
    expect(r.status).toBe(1);
  }, 150_000);
});

describe('fanout.sh with unreadable usage', () => {
  // Value: protects=a failed usage read launches nothing, because the runner's own preflight lets a create through when it
  // cannot read usage; fails_when=an unreadable usage counts as 0 in use and every shard launches, as the old read did;
  // why_new=the old read defaulted to 0; seam=UBI_RUNNER (existing); no_claim=UBI_QUOTA_WAIT's wait loop
  test('refuses with exit 3 and starts no shard', () => {
    const r = fanout('unreadable', []);
    expect(r.stderr).toContain('usage is unreadable, so no VM launches this batch');
    expect(r.stderr).toContain('fanout: refused: not one standard-16 VM fits under 464 project vCPUs now');
    expect(r.started).toEqual([]);
    expect(r.status).toBe(3);
  }, 30_000);
});

describe('fanout.sh interrupted during a batch', () => {
  // Value: protects=a TERM that arrives while a batch is launching stops the rest of that batch, so no shard starts after
  // the interrupt and every shard that did start is sent TERM; fails_when=the batch loop launches its remaining shards
  // after the interrupt, and their VMs run to the end without a TERM; why_new=batch launches replaced the old launch loop,
  // which checked for an interrupt before each launch; seam=UBI_RUNNER (existing) and a fake run-shard.sh beside a copy
  // of the script; no_claim=real VM teardown
  test('a TERM one second into a batch of 3 starts only the first shard, and it gets TERM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-room-'));
    try {
      copyFileSync(FANOUT, join(dir, 'fanout.sh'));
      script(dir, 'run-shard.sh', [
        'name=$(sed -E "s/.*--name ([^ ]+).*/\\1/" <<<"$*")',
        'echo "$name" >> "' + dir + '/started"',
        'trap \'echo "$name" >> "' + dir + '/termed"; exit 130\' TERM',
        'sleep 8 & wait',
        'exit 0',
      ].join('\n'));
      script(dir, 'ubi-runner.sh', 'echo "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), size: 'standard-16', shards: ['s1', 's2', 's3'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1 })) }));
      const driver = 'bash "$1" --manifest "$2" & p=$!; sleep 1; kill -TERM $p; wait $p; echo "fanout exit $?"';
      const r = spawnSync('bash', ['-c', driver, 'driver', join(dir, 'fanout.sh'), join(dir, 'manifest.json')], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean) : []);
      expect(r.stderr).toContain('launching 3 of 3 queued');
      expect(read('started')).toEqual(['s1']);
      expect(read('termed')).toEqual(['s1']);
      expect(r.stdout).toContain('fanout exit 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});


describe('fanout.sh interrupted by a group TERM during a usage read', () => {
  // Value: protects=a TERM sent to the whole process group (a cancelled background operation) while a batch reads usage
  // or between launches leaves the controller alive until every shard has finished its teardown, so the VMs are destroyed
  // and the summary prints; fails_when=the killed usage read or sleep returns 143 under set -e and the controller exits
  // while shards are still tearing down, which lets the machine sleep and kill that teardown; why_new=batch launches read
  // usage in the loop, a new window for this; seam=UBI_RUNNER (existing), setsid and a fake run-shard.sh; no_claim=real
  // VM teardown
  test('the controller outlives the shard teardown and exits 1 with its summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-room-'));
    try {
      copyFileSync(FANOUT, join(dir, 'fanout.sh'));
      script(dir, 'run-shard.sh', [
        'name=$(sed -E "s/.*--name ([^ ]+).*/\\1/" <<<"$*")',
        'if [ "$name" = s1 ]; then sleep 2; touch "' + dir + '/s1done"; exit 0; fi',
        'trap \'trap "" TERM HUP INT; sleep 3; echo "$name" >> "' + dir + '/cleaned"; exit 130\' TERM',
        'sleep 30 & wait',
        'exit 0',
      ].join('\n'));
      script(dir, 'ubi-runner.sh', 'if [ -f "' + dir + '/s1done" ]; then touch "' + dir + '/inread"; sleep 3; fi\necho "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), size: 'standard-16', shards: ['s1', 's2', 's3'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1 })) }));
      const driver = [
        'setsid bash "$1" --manifest "$2" --parallel 2 > "$3/out" 2> "$3/err" & p=$!',
        'for i in $(seq 1 150); do [ -f "$3/inread" ] && break; sleep 0.1; done',
        'kill -TERM -- -$p; wait $p; echo "fanout exit $?"',
        'cat "$3/cleaned" 2>/dev/null | tr "\\n" " "; echo',
      ].join('\n');
      const r = spawnSync('bash', ['-c', driver, 'driver', join(dir, 'fanout.sh'), join(dir, 'manifest.json'), dir], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      expect(r.stdout).toContain('fanout exit 1');
      expect(r.stdout).toContain('s2');
      expect(readFileSync(join(dir, 'out'), 'utf8')).toContain('total: 3 shard(s)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});



describe('fanout.sh gives back the stage-cap reservation of a shard that never launched', () => {
  // Value: protects=a shard left with no room (no VM ever created for it) no longer keeps its reservation in leases.jsonl
  // and the stage ledger, so relaunching it is not refused over the cap with nothing spent, while a shard that launched
  // keeps its reservation; fails_when=a no-room shard's reservation still counts, as before (harness-evals#484 known issue
  // 2), or a launched shard's reservation is released; seam=UBI_RUNNER and a fake run-shard.sh that writes the launch
  // lines the real one writes; no_claim=a real VM, the interrupt path (released the same way) or the real run-shard.sh.
  test('the no-room shard is released and relaunches under the cap, and the launched shard still counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-release-'));
    try {
      for (const s of ['fanout.sh', 'stage_ledger.py', 'prune-pending.sh']) copyFileSync(join(FANOUT, '..', s), join(dir, s));
      writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'stage-test', caps_usd: { main: 2 } }));
      const dest = join(dir, 'dest'), replica = join(dir, 'replica');
      script(dir, 'run-shard.sh', [
        'arg() { sed -E "s/.* --$1 ([^ ]+).*/\\1/" <<<"$*"; }',
        'name=$(arg name "$*") d=$(arg dest "$*") rep=$(arg replicate-to "$*") at=2026-11-17T00:00:00Z',
        'echo "$name" >> "' + dir + '/started"',
        '[ "$name" != s1 ] || touch "' + dir + '/full"',
        'printf \'{"lease_usd": 1, "launched_at": "%s", "vm": "vm-%s", "resume": false, "reservation": "%s"}\\n\' "$at" "$name" "$UBI_LEASE_RESERVATION" >> "$d/leases.jsonl"',
        'printf \'{"run_id": "stage-test", "stage": "main", "dest": "%s", "lease_usd": 1, "resume": false, "launched_at": "%s", "vm": "vm-%s", "by": "run-shard.sh", "reservation": "%s"}\\n\' "$(realpath "$d")" "$at" "$name" "$UBI_LEASE_RESERVATION" >> "$rep/stage-ledger.jsonl"',
        'sleep 1',
        'exit 0',
      ].join('\n'));
      script(dir, 'ubi-runner.sh', 'case $1 in usage) if [ -e "' + dir + '/full" ]; then echo "total 29 464"; else echo "total 28 448"; fi ;; esac');
      const run = (names: string[]) => {
        rmSync(join(dir, 'full'), { force: true });
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: join(dir, 'prereg.json'), dest, size: 'standard-16', stage_cap_usd: 2, shards: names.map((name) => ({ name, cells: 'c-' + name, lease_usd: 1, args: ['--stage', 'main', '--shards', '8'] })) }));
        return spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), '--workload', 'qm-driver', '--replicate-to', replica], {
          encoding: 'utf8',
          timeout: 60_000,
          env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
        });
      };
      const rows = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
      const first = run(['s1', 's2']);
      expect(first.stderr).toContain('1 shard(s) not launched');
      expect(first.stderr).toContain('released the stage-cap reservation of s2, which never launched');
      expect(rows(join(dest, 's1', 'leases.jsonl')).some((e) => e.released)).toBe(false);
      expect(rows(join(dest, 's2', 'leases.jsonl')).filter((e) => e.released).length).toBe(1);
      expect(rows(join(replica, 'stage-ledger.jsonl')).filter((e) => e.released).map((e) => e.dest)).toEqual([join(dest, 's2')]);
      const again = run(['s2']);
      expect(again.stderr).not.toContain('refused');
      expect(again.status, again.stderr).toBe(0);
      const more = run(['s3']);
      expect(more.status).toBe(2);
      expect(more.stderr).toContain('the shard leases sum to $1 plus $2 launched earlier from ' + dest + ' (s1, s2)');
      expect(readFileSync(join(dir, 'started'), 'utf8').trim().split('\n')).toEqual(['s1', 's2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('fanout.sh gives back the reservation of a shard an interrupt left in the queue', () => {
  // Value: protects=after a TERM, a shard still in the queue gets its reservation released in leases.jsonl and the stage
  // ledger, while the shard that was running keeps its reservation; fails_when=the interrupt path skips the release, or
  // releases the running shard's reservation; why_new=the /ship review of the release (only the no-room path was tested);
  // seam=UBI_RUNNER and a fake run-shard.sh that writes the launch lines the real one writes; no_claim=a real VM or the
  // real run-shard.sh.
  test('a TERM while s1 runs releases queued s2 and keeps s1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-release-'));
    try {
      for (const s of ['fanout.sh', 'stage_ledger.py', 'prune-pending.sh']) copyFileSync(join(FANOUT, '..', s), join(dir, s));
      writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'stage-test', caps_usd: { main: 2 } }));
      const dest = join(dir, 'dest'), replica = join(dir, 'replica');
      script(dir, 'run-shard.sh', [
        'arg() { sed -E "s/.* --$1 ([^ ]+).*/\\1/" <<<"$*"; }',
        'name=$(arg name "$*") d=$(arg dest "$*") rep=$(arg replicate-to "$*") at=2026-11-17T00:00:00Z',
        'printf \'{"lease_usd": 1, "launched_at": "%s", "vm": "vm-%s", "resume": false, "reservation": "%s"}\\n\' "$at" "$name" "$UBI_LEASE_RESERVATION" >> "$d/leases.jsonl"',
        'printf \'{"run_id": "stage-test", "stage": "main", "dest": "%s", "lease_usd": 1, "resume": false, "launched_at": "%s", "vm": "vm-%s", "by": "run-shard.sh", "reservation": "%s"}\\n\' "$(realpath "$d")" "$at" "$name" "$UBI_LEASE_RESERVATION" >> "$rep/stage-ledger.jsonl"',
        'echo "$name" >> "' + dir + '/started"',
        'trap \'exit 130\' TERM',
        'sleep 8 & wait',
        'exit 0',
      ].join('\n'));
      script(dir, 'ubi-runner.sh', 'echo "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: join(dir, 'prereg.json'), dest, size: 'standard-16', stage_cap_usd: 2, shards: ['s1', 's2'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1, args: ['--stage', 'main', '--shards', '8'] })) }));
      const driver = [
        'bash "$1" --manifest "$2" --parallel 1 --workload qm-driver --replicate-to "$3/replica" & p=$!',
        'for i in $(seq 1 150); do [ -s "$3/started" ] && break; sleep 0.1; done',
        'kill -TERM $p; wait $p; echo "fanout exit $?"',
      ].join('\n');
      const r = spawnSync('bash', ['-c', driver, 'driver', join(dir, 'fanout.sh'), join(dir, 'manifest.json'), dir], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      const rows = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
      expect(readFileSync(join(dir, 'started'), 'utf8').trim().split('\n')).toEqual(['s1']);
      expect(r.stderr).toContain('released the stage-cap reservation of s2, which never launched');
      expect(rows(join(dest, 's2', 'leases.jsonl')).filter((e) => e.released).length).toBe(1);
      expect(rows(join(dest, 's1', 'leases.jsonl')).some((e) => e.released)).toBe(false);
      expect(rows(join(replica, 'stage-ledger.jsonl')).filter((e) => e.released).map((e) => e.dest)).toEqual([join(dest, 's2')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('fanout.sh releases nothing for a shard whose stage-ledger line cannot be written', () => {
  // Value: protects=a release whose stage-ledger write fails leaves that shard's leases.jsonl unreleased too, so both ledgers
  // still count the reservation, and says so; fails_when=leases.jsonl is released first and the stage ledger still counts
  // it, or the log claims a release that was not written; why_new=the /ship second-model review of the release order;
  // seam=UBI_RUNNER and a fake run-shard.sh that turns the stage ledger into a folder after its launch; no_claim=a real VM,
  // a drive mount or the real run-shard.sh.
  test('s2 is left counted in both ledgers and the log names it as not released', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fanout-release-'));
    try {
      for (const s of ['fanout.sh', 'stage_ledger.py', 'prune-pending.sh']) copyFileSync(join(FANOUT, '..', s), join(dir, s));
      writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'stage-test', caps_usd: { main: 2 } }));
      const dest = join(dir, 'dest'), replica = join(dir, 'replica');
      script(dir, 'run-shard.sh', [
        'arg() { sed -E "s/.* --$1 ([^ ]+).*/\\1/" <<<"$*"; }',
        'name=$(arg name "$*") d=$(arg dest "$*") rep=$(arg replicate-to "$*") at=2026-11-17T00:00:00Z',
        'echo "$name" >> "' + dir + '/started"',
        'touch "' + dir + '/full"',
        'printf \'{"lease_usd": 1, "launched_at": "%s", "vm": "vm-%s", "resume": false, "reservation": "%s"}\\n\' "$at" "$name" "$UBI_LEASE_RESERVATION" >> "$d/leases.jsonl"',
        '{ mv "$rep/stage-ledger.jsonl" "$rep/ledger.bak" 2>/dev/null || true; } && mkdir -p "$rep/stage-ledger.jsonl"',
        'exit 0',
      ].join('\n'));
      script(dir, 'ubi-runner.sh', 'case $1 in usage) if [ -e "' + dir + '/full" ]; then echo "total 29 464"; else echo "total 28 448"; fi ;; esac');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: join(dir, 'prereg.json'), dest, size: 'standard-16', stage_cap_usd: 2, shards: ['s1', 's2'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1, args: ['--stage', 'main', '--shards', '8'] })) }));
      const r = spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), '--workload', 'qm-driver', '--replicate-to', replica], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      const rows = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
      expect(r.stderr).toContain('1 shard(s) not launched');
      expect(r.stderr).toContain('fanout: releasing the reservation of s2 failed (');
      expect(r.stderr).not.toContain('released the stage-cap reservation of s2');
      expect(rows(join(dest, 's2', 'leases.jsonl')).length).toBe(1);
      expect(rows(join(dest, 's2', 'leases.jsonl')).some((e) => e.released)).toBe(false);
      expect(rows(join(replica, 'ledger.bak')).some((e) => e.released)).toBe(false);
      expect(readFileSync(join(dir, 'started'), 'utf8').trim().split('\n')).toEqual(['s1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
