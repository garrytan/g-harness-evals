// internal-task-a run path (internal-task-b, plan step 2, decisions D and E): mid-run results replication, the VM-to-shard map, kept VMs
// in fanout.sh, the launch refusal into a dest with a kept VM, cleanup-pending pruning and the qm-driver workload's VM
// side. Keyless: a fake ubi-runner.sh (UBI_RUNNER) records every call, so no VM, no ssh and no spend.
//
// Value: protects=results leave the VM on an interval and a failed, cut or empty pull never replaces the last good copy;
// the map is in the replicate dir before the shard finishes; a kept VM makes fanout.sh exit non-zero with a kept: line;
// no launch but --attach (fresh or --resume) starts while a kept VM may hold newer results; prune removes only stale entries; qm-driver
// runs the driver's keyless dry run as its smoke and passes the shard's arguments through; fails_when=results come back only
// at teardown, a bad pull wipes the copy, the map appears only at the end, a kept VM exits 0, a launch ignores the marker,
// prune drops a live VM or keeps a dead one, or the driver gets a key in its smoke; seam=UBI_RUNNER, a fake run-shard.sh
// beside a copy of fanout.sh, and a fake bun in vm-shard.sh's PATH; no_claim=a real VM, ssh, tar or Capy drive.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const UBI = join(ROOT, 'scripts', 'ubicloud');
const PLACEHOLDER = 'placeholder-not-a-key';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const script = (f: string, body: string) => { writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(f, 0o755); };
const baseEnv = (dir: string, runner: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: PLACEHOLDER });

// A full shard through run-shard.sh against a fake ubi-runner.sh. Each pull of shard/results takes the next step of
// pulls (the last one repeats): ok:<line> brings back results/ with that trials.jsonl line, warn:<line> does the same and
// exits 1 (tar's "file changed as we read it"), db:<line> adds ledger.sqlite and wal:<line> adds ledger.sqlite with its
// -wal and -shm, empty brings back nothing, fails exits 1 with nothing. The shard reports
// exit 0 once exitAfter pulls have happened; each poll records whether vm-map.jsonl was already in the replicate dir.
// seed and seeds are files put in <dest> before the launch that the VM never has; workload is passed as --workload.
function shard(o: { pulls: string[]; exitAfter: number; seed?: string; seeds?: string[]; workload?: string }) {
  const dir = tmp('he-ubi-runpath-');
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts', 'prune-pending.sh']) copyFileSync(join(UBI, f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  const commit = g('rev-parse', 'HEAD').trim();
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'runpath-test', cells: [{ id: 'c1', harness: 'hermes' }] }));
  writeFileSync(join(dir, 'pulls'), o.pulls.join('\n') + '\n');
  const rep = join(dir, 'rep');
  const runner = join(dir, 'ubi-runner.sh');
  script(runner, [
    'd=' + JSON.stringify(dir),
    'cmd=$1; shift',
    'printf "%s\\n" "$cmd $*" >> "$d/calls.log"',
    'case "$cmd" in',
    '  up) echo vm1 ;;',
    '  owner) echo test-owner ;;',
    '  pull) case "$2" in shard/results)',
    '      n=$(( $(cat "$d/npull" 2>/dev/null || echo 0) + 1 )); echo $n > "$d/npull"',
    '      step=$(sed -n "${n}p" "$d/pulls"); [ -n "$step" ] || step=$(tail -1 "$d/pulls")',
    '      case $step in fails) exit 1 ;; empty) exit 0 ;; ok:*|warn:*|db:*|wal:*) mkdir -p "$3/results" && printf "%s\\n" "${step#*:}" > "$3/results/trials.jsonl" && echo "{\\"name\\": \\"s1\\"}" > "$3/results/shard.json"',
    '        case $step in warn:*) exit 1 ;; db:*) echo "${step#*:}" > "$3/results/ledger.sqlite" ;; wal:*) for f in ledger.sqlite ledger.sqlite-wal ledger.sqlite-shm; do echo "${step#*:}" > "$3/results/$f"; done ;; esac ;; esac ;;',
    '    *) exit 1 ;; esac ;;',
    '  ssh) case "$2" in',
    '      *"::trials"*) [ -s ' + JSON.stringify(join(rep, 'vm-map.jsonl')) + ' ] && echo map=yes >> "$d/polls" || echo map=no >> "$d/polls"',
    '        [ "$(cat "$d/npull" 2>/dev/null || echo 0)" -ge ' + o.exitAfter + ' ] && echo 0; echo "::trials 1" ;;',
    '      *) cat > /dev/null ;; esac ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n'));
  const dest = join(dir, 'dest');
  for (const s of [...(o.seed ? [o.seed] : []), ...(o.seeds ?? [])]) { mkdirSync(dirname(join(dest, s)), { recursive: true }); writeFileSync(join(dest, s), 'local only\n'); }
  const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', commit, '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, '--poll-seconds', '1', '--replicate-seconds', '1', '--replicate-to', rep, ...(o.workload ? ['--workload', o.workload] : [])],
    { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER, ...(o.workload ? { OPENAI_API_KEY: PLACEHOLDER } : {}), TMPDIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    code: r.status, err: r.stderr, dest, rep,
    calls: read(join(dir, 'calls.log')).split('\n').filter(Boolean),
    polls: read(join(dir, 'polls')).split('\n').filter(Boolean),
    laneLog: read(join(dest, 'lane.log')),
    map: read(join(rep, 'vm-map.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

describe('ubicloud/run-shard.sh mid-run replication', () => {
  test('a shard longer than the interval is pulled while it runs; a failed and an empty pull keep the last good copy', () => {
    const r = shard({ pulls: ['ok:v1', 'fails', 'empty', 'fails'], exitAfter: 3 });
    expect(r.code, r.err).toBe(0);
    const pulls = r.calls.filter((c) => c.startsWith('pull vm1 shard/results '));
    expect(pulls.length).toBeGreaterThanOrEqual(4);
    expect(r.laneLog.indexOf('replicate: 1 records')).toBeGreaterThan(-1);
    expect(r.laneLog.indexOf('replicate: 1 records')).toBeLessThan(r.laneLog.indexOf('the shard on vm1 exited 0'));
    expect(r.laneLog).toContain('WARNING: replicate: the pull from vm1 failed or brought back no results/');
    expect(read(join(r.dest, 'results', 'trials.jsonl'))).toBe('v1\n');
    expect(existsSync(join(r.dest, '.pull'))).toBe(false);
    // the final pull failed, so #288's guard keeps the VM; the mirror and the map say so too
    expect(r.calls.some((c) => c.startsWith('down '))).toBe(false);
    expect(read(join(r.rep, 's1', 'results', 'trials.jsonl'))).toBe('v1\n');
    expect(JSON.parse(read(join(r.rep, 's1', 'shard-vm.json'))).cleanup_reason).toBe('results not pulled; VM kept');
    expect(r.map.map((m) => m.event)).toEqual(['created', 'kept']);
  }, 120_000);

  test('the VM map is in the replicate dir before the shard finishes, and a good final pull is mirrored and destroys the VM', () => {
    const r = shard({ pulls: ['ok:v1', 'ok:v2'], exitAfter: 1 });
    expect(r.code, r.err).toBe(0);
    expect(r.polls[0]).toBe('map=yes');
    expect(r.map[0]).toMatchObject({ event: 'created', shard: 's1', vm: 'vm1', owner: 'test-owner', dest: r.dest });
    expect(r.map[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(r.map.at(-1).event).toBe('destroyed');
    expect(r.calls).toContain('down vm1');
    expect(read(join(r.dest, 'results', 'trials.jsonl'))).toBe('v2\n');
    expect(read(join(r.rep, 's1', 'results', 'trials.jsonl'))).toBe('v2\n');
    expect(JSON.parse(read(join(r.rep, 's1', 'shard-vm.json'))).cleanup).toBe('done');
  }, 120_000);

  test('a pull merges over the local copy, so files the VM lacks stay, and a full pull that exits 1 counts', () => {
    const state = join('results', 'trials', 'c1', 't1', 'r1', 'state', 'x');
    const r = shard({ pulls: ['warn:v1', 'warn:v2'], exitAfter: 1, seed: state });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('replicate: 1 records');
    expect(r.laneLog).not.toContain('WARNING: replicate: the pull from vm1');
    expect(read(join(r.dest, 'results', 'trials.jsonl'))).toBe('v2\n');
    expect(read(join(r.dest, state))).toBe('local only\n');
    expect(r.calls).toContain('down vm1');
  }, 120_000);

  test('a ledger that comes back without its -wal and -shm drops the ones an earlier pull left', () => {
    const r = shard({ pulls: ['wal:v1', 'db:v2'], exitAfter: 1 });
    expect(r.code, r.err).toBe(0);
    expect(read(join(r.dest, 'results', 'ledger.sqlite'))).toBe('v2\n');
    expect(existsSync(join(r.dest, 'results', 'ledger.sqlite-wal'))).toBe(false);
    expect(existsSync(join(r.dest, 'results', 'ledger.sqlite-shm'))).toBe(false);
  }, 120_000);

  test('a frontier-harbor mirror leaves out proxy-capture/ and results/run/, which stay in the dest', () => {
    const capture = join('results', 'trials', 'c1', 't1', 'a1', 'harbor', 'proxy-capture', 'proxy-requests.ndjson');
    const record = join('results', 'trials', 'c1', 't1', 'a1', 'harbor', 'result.json');
    const job = join('results', 'run', 'jobs', 'c1__a1', 't1__x', 'result.json');
    const r = shard({ pulls: ['ok:v1', 'ok:v2'], exitAfter: 1, seeds: [capture, record, job], workload: 'frontier-harbor' });
    expect(r.code, r.err).toBe(0);
    for (const f of [capture, record, job]) expect(read(join(r.dest, f))).toBe('local only\n');
    expect(read(join(r.rep, 's1', 'results', 'trials.jsonl'))).toBe('v2\n');
    expect(read(join(r.rep, 's1', record))).toBe('local only\n');
    expect(existsSync(join(r.rep, 's1', capture))).toBe(false);
    expect(existsSync(join(r.rep, 's1', 'results', 'run'))).toBe(false);
  }, 120_000);

  test('key-shaped text in the results stops the mirror and keeps the previous one', () => {
    const shaped = 'sk-' + 'ant-api03-' + 'x'.repeat(24);
    const r = shard({ pulls: ['ok:v1', 'ok:' + shaped], exitAfter: 1 });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in results/trials.jsonl');
    expect(r.laneLog).not.toContain(shaped);
    expect(read(join(r.rep, 's1', 'results', 'trials.jsonl'))).toBe('v1\n');
  }, 120_000);
});

describe('fanout.sh kept VMs and --resume', () => {
  function fanout(o: { shardBody: string; options?: string[]; pending?: string; list?: string; replica?: object }) {
    const dir = tmp('he-fanout-kept-');
    copyFileSync(join(UBI, 'fanout.sh'), join(dir, 'fanout.sh'));
    copyFileSync(join(UBI, 'prune-pending.sh'), join(dir, 'prune-pending.sh'));
    script(join(dir, 'run-shard.sh'), 'echo launched >> ' + JSON.stringify(join(dir, 'launched')) + '\nwhile [ $# -gt 0 ]; do [ "$1" = --dest ] && dest=$2; shift; done\n' + o.shardBody);
    script(join(dir, 'ubi-runner.sh'), 'case $1 in usage) echo "total 0 0" ;; list) printf "%s\\n" ' + JSON.stringify(o.list ?? '') + ' ;; esac');
    const dest = join(dir, 'dest');
    if (o.pending) { mkdirSync(join(dest, 'only'), { recursive: true }); writeFileSync(join(dest, 'only', 'cleanup-pending'), o.pending); }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest, options: o.options ?? [], shards: [{ name: 'only', cells: 'c1', lease_usd: 1 }] }));
    const rep = join(dir, 'rep');
    if (o.replica) { mkdirSync(join(rep, 'only'), { recursive: true }); writeFileSync(join(rep, 'only', 'shard-vm.json'), JSON.stringify(o.replica)); }
    const r = spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), ...(o.replica ? ['--replicate-to', rep] : [])], { encoding: 'utf8', timeout: 60_000, env: baseEnv(dir, join(dir, 'ubi-runner.sh')) });
    return { code: r.status, out: r.stdout, err: r.stderr, dest, rep, launched: existsSync(join(dir, 'launched')) };
  }

  test('a shard whose VM was kept after a failed final pull makes the fan-out exit 1 with a kept: line and a kept count', () => {
    const r = fanout({ shardBody: 'printf \'{"vm": "vmK", "exit": 0, "cleanup": "pending", "cleanup_reason": "results not pulled; VM kept"}\\n\' > "$dest/shard-vm.json"; echo vmK > "$dest/cleanup-pending"; exit 0' });
    expect(r.code, r.err).toBe(1);
    expect(r.out).toContain('kept: shard only  vm vmK  reason "results not pulled; VM kept"  cleanup-pending ' + join(r.dest, 'only', 'cleanup-pending') + '; recover: ');
    expect(r.out).toContain('--attach --dest ' + join(r.dest, 'only'));
    expect(r.out).toContain('0 not exit 0, 1 kept VM(s)');
  }, 60_000);

  test('a shard that exits 0 and destroys its VM still exits 0 with no kept: line', () => {
    const r = fanout({ shardBody: 'printf \'{"vm": "vmK", "exit": 0, "cleanup": "done", "cleanup_reason": null}\\n\' > "$dest/shard-vm.json"; exit 0' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain('kept:');
    expect(r.out).toContain('0 kept VM(s)');
  }, 60_000);

  test('--resume into a dest whose kept VM still exists is refused before any shard launches', () => {
    const r = fanout({ shardBody: 'exit 0', options: ['--resume'], pending: 'vmK\n', list: 'eu-central-h1 vmK' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('refused: ' + join(r.dest, 'only') + ' has a kept VM (vmK');
    expect(r.err).toContain('a new launch would overwrite shard-vm.json and lose track of it');
    expect(r.err).toContain('--attach --dest ' + join(r.dest, 'only'));
    expect(r.launched).toBe(false);
  }, 60_000);

  test('a fan-out over another VM\'s mirror whose cleanup is not done is refused before any shard launches', () => {
    for (const options of [[], ['--resume']]) {
      const r = fanout({ shardBody: 'exit 0', options, replica: { vm: 'vmOld', cleanup: 'pending' } });
      expect(r.code).toBe(2);
      expect(r.err).toContain('refused: ' + join(r.rep, 'only') + ' holds the mirror of another VM (vmOld)');
      expect(r.err).toContain('use a new --replicate-to');
      expect(r.launched).toBe(false);
    }
    const done = fanout({ shardBody: 'exit 0', replica: { vm: 'vmOld', cleanup: 'done' } });
    expect(done.err).not.toContain('holds the mirror of another VM');
    expect(done.launched).toBe(true);
  }, 60_000);

  test('a bad shard after a good one refuses the whole fan-out instead of launching the good one', () => {
    const dir = tmp('he-fanout-badargs-');
    copyFileSync(join(UBI, 'fanout.sh'), join(dir, 'fanout.sh'));
    copyFileSync(join(UBI, 'prune-pending.sh'), join(dir, 'prune-pending.sh'));
    script(join(dir, 'run-shard.sh'), 'echo launched >> ' + JSON.stringify(join(dir, 'launched')) + '\nexit 0');
    script(join(dir, 'ubi-runner.sh'), 'case $1 in usage) echo "total 0 0" ;; esac');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest: join(dir, 'dest'), shards: [{ name: 'a', cells: 'c1', lease_usd: 1 }, { name: 'b', cells: 'c2', lease_usd: 1, args: '--shards 2' }] }));
    const r = spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json')], { encoding: 'utf8', timeout: 60_000, env: baseEnv(dir, join(dir, 'ubi-runner.sh')) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('fanout: shard b: args must be a list of strings');
    expect(existsSync(join(dir, 'launched'))).toBe(false);
  }, 60_000);

  test('a fresh launch into a dest with a kept VM is refused, and goes ahead once a prune finds the VM gone', () => {
    const dir = tmp('he-fanout-fresh-');
    copyFileSync(join(UBI, 'fanout.sh'), join(dir, 'fanout.sh'));
    copyFileSync(join(UBI, 'prune-pending.sh'), join(dir, 'prune-pending.sh'));
    script(join(dir, 'run-shard.sh'), 'echo launched >> ' + JSON.stringify(join(dir, 'launched')) + '\nexit 0');
    const listed = join(dir, 'listed');
    script(join(dir, 'ubi-runner.sh'), 'case $1 in usage) echo "total 0 0" ;; list) cat ' + JSON.stringify(listed) + ' ;; esac');
    const dest = join(dir, 'dest');
    mkdirSync(join(dest, 'only'), { recursive: true });
    writeFileSync(join(dest, 'only', 'cleanup-pending'), 'vmK\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: 'prereg.json', dest, shards: [{ name: 'only', cells: 'c1', lease_usd: 1 }] }));
    const run = () => spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json')], { encoding: 'utf8', timeout: 60_000, env: baseEnv(dir, join(dir, 'ubi-runner.sh')) });
    writeFileSync(listed, 'eu-central-h1 vmK\n');
    const refused = run();
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('refused: ' + join(dest, 'only') + ' has a kept VM (vmK');
    expect(refused.stderr).toContain('a new launch would overwrite shard-vm.json and lose track of it');
    expect(existsSync(join(dir, 'launched'))).toBe(false);
    writeFileSync(listed, 'eu-central-h1 vmOther\n');
    const after = run();
    expect(after.status, after.stderr).toBe(0);
    expect(after.stderr).toContain('removed vmK (not in the VM list)');
    expect(existsSync(join(dir, 'launched'))).toBe(true);
    expect(existsSync(join(dest, 'only', 'cleanup-pending'))).toBe(false);
  }, 60_000);

  test('a stale entry (the VM is gone) is pruned at start and the --resume goes ahead', () => {
    const r = fanout({ shardBody: 'exit 0', options: ['--resume'], pending: 'vmGone\n', list: 'eu-central-h1 vmOther' });
    expect(r.err).toContain('removed vmGone (not in the VM list)');
    expect(r.launched).toBe(true);
    expect(existsSync(join(r.dest, 'only', 'cleanup-pending'))).toBe(false);
  }, 60_000);
});

describe('ubicloud/run-shard.sh launching into a dest with a kept VM', () => {
  test('a fresh launch and a --resume are refused before the VM, naming the VM and the recovery', () => {
    const dir = tmp('he-ubi-resume-kept-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\ncase $1 in list) echo "eu-central-h1 vmK" ;; *) exit 1 ;; esac');
    const dest = join(dir, 'dest');
    mkdirSync(dest);
    writeFileSync(join(dest, 'cleanup-pending'), 'vmK\n');
    for (const resume of [[], ['--resume'], ['--', '--resume']]) {
      const r = spawnSync('bash', [join(UBI, 'run-shard.sh'), '--commit', 'a'.repeat(40), '--prereg', 'p.json', '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, ...resume],
        { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('refused: ' + dest + ' has a kept VM (vmK');
      expect(r.stderr).toContain('a new launch would overwrite shard-vm.json and lose track of it');
      expect(r.stderr).toContain('run-shard.sh --attach --dest ' + dest);
    }
    expect(read(join(dir, 'calls')).split('\n').filter(Boolean).every((c) => c === 'list')).toBe(true);
  }, 60_000);

  test('a --dest at <replicate-to>/<name>, where the mirror would replace it, is refused before any VM call', () => {
    const dir = tmp('he-ubi-replica-dest-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
    const rep = join(dir, 'r'), dest = join(rep, 's1');
    mkdirSync(join(dest, 'results'), { recursive: true });
    writeFileSync(join(dest, 'results', 'kept'), 'x');
    const r = spawnSync('bash', [join(UBI, 'run-shard.sh'), '--commit', 'a'.repeat(40), '--prereg', 'p.json', '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, '--replicate-to', rep],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--dest must be outside ' + dest + ', where the mirror replaces what it finds');
    expect(read(join(dir, 'calls'))).toBe('');
    expect(read(join(dest, 'results', 'kept'))).toBe('x');
  }, 60_000);

  test('a fresh launch and a --resume over another VM\'s mirror whose cleanup is not done are refused before any VM call', () => {
    const dir = tmp('he-ubi-replica-other-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
    const dest = join(dir, 'dest'), rep = join(dir, 'rep');
    mkdirSync(dest);
    mkdirSync(join(rep, 's1'), { recursive: true });
    const launch = (extra: string[]) => spawnSync('bash', [join(UBI, 'run-shard.sh'), '--commit', 'a'.repeat(40), '--prereg', 'p.json', '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, '--replicate-to', rep, ...extra],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(join(rep, 's1', 'shard-vm.json'), JSON.stringify({ vm: 'vmOld', created_at: '2026-11-03T00:00:00Z' }));
    for (const resume of [[], ['--resume'], ['--', '--resume']]) {
      const r = launch(resume);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('refused: ' + rep + '/s1 holds the mirror of another VM (vmOld)');
      expect(r.stderr).toContain('run-shard.sh --attach --dest <its dest>');
      expect(r.stderr).toContain('copy ' + rep + '/s1 out and move it aside, or use a new --replicate-to');
    }
    expect(read(join(dir, 'calls'))).toBe('');
    writeFileSync(join(rep, 's1', 'shard-vm.json'), JSON.stringify({ vm: 'vmOld', cleanup: 'done' }));
    expect(launch([]).stderr).not.toContain('holds the mirror of another VM');
    writeFileSync(join(rep, 's1', 'shard-vm.json'), JSON.stringify({ vm: 'vmMine', cleanup: 'pending' }));
    writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ vm: 'vmMine' }));
    expect(launch([]).stderr).not.toContain('holds the mirror of another VM');
  }, 60_000);

  test('a fresh launch and a --resume into a dest whose own VM is not cleaned up (a dead controller mid-run) are refused before any VM call', () => {
    const dir = tmp('he-ubi-live-vm-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
    const dest = join(dir, 'dest');
    mkdirSync(join(dest, 'results'), { recursive: true });
    writeFileSync(join(dest, 'results', 'shard.json'), JSON.stringify({ name: 's1' }));
    const prereg = join(dir, 'prereg.json');
    writeFileSync(prereg, JSON.stringify({ run_id: 'runpath-test', cells: [{ id: 'c1', harness: 'hermes' }] }));
    const launch = (extra: string[]) => spawnSync('bash', [join(UBI, 'run-shard.sh'), '--commit', 'HEAD', '--prereg', prereg, '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, ...extra],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const cleanup of ['pending', 'failed']) {
      const vmJson = JSON.stringify({ vm: 'vmLive', cleanup, cleanup_reason: null });
      writeFileSync(join(dest, 'shard-vm.json'), vmJson);
      for (const resume of [[], ['--resume'], ['--', '--resume']]) {
        const r = launch(resume);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('refused: ' + dest + '/shard-vm.json names a VM (vmLive) whose cleanup is not done');
        expect(r.stderr).toContain('run-shard.sh --attach --dest ' + dest);
        expect(read(join(dest, 'shard-vm.json'))).toBe(vmJson);
      }
    }
    expect(read(join(dir, 'calls'))).toBe('');
    writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ vm: 'vmLive', cleanup: 'done' }));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts', 'prune-pending.sh']) copyFileSync(join(UBI, f), join(repo, 'scripts', 'ubicloud', f));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
    const upFails = join(dir, 'up-fails.sh');
    script(upFails, 'echo "$1" >> ' + JSON.stringify(join(dir, 'up-calls')) + '\nexit 1');
    const done = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', prereg, '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, '--resume'],
      { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, upFails), ANTHROPIC_API_KEY: PLACEHOLDER, TMPDIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(done.stderr).not.toContain('whose cleanup is not done');
    expect(read(join(dir, 'up-calls')).split('\n')).toContain('up');
  }, 60_000);

  test('--attach with a --dest at <replicate-to>/<the shard name in shard-vm.json> is refused before any VM call', () => {
    const dir = tmp('he-ubi-attach-replica-dest-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
    const rep = join(dir, 'r'), dest = join(rep, 's1');
    mkdirSync(join(dest, 'results'), { recursive: true });
    writeFileSync(join(dest, 'results', 'kept'), 'x');
    writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 's1', vm: 'vm1', size: 'standard-16', cleanup: 'pending' }));
    const r = spawnSync('bash', [join(UBI, 'run-shard.sh'), '--attach', '--dest', dest, '--replicate-to', rep, '--poll-seconds', '1'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...baseEnv(dir, runner), ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--dest must be outside ' + dest + ', where the mirror replaces what it finds');
    expect(read(join(dir, 'calls'))).toBe('');
    expect(read(join(dest, 'results', 'kept'))).toBe('x');
  }, 60_000);
});

describe('prune-pending.sh', () => {
  function prune(list: string | null) {
    const dir = tmp('he-prune-');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, list === null ? 'exit 1' : 'case $1 in list) printf "%s\\n" ' + JSON.stringify(list) + ' ;; *) exit 1 ;; esac');
    const a = join(dir, 'a'), b = join(dir, 'b');
    mkdirSync(a); mkdirSync(b);
    writeFileSync(join(a, 'cleanup-pending'), 'vm-live\nvm-gone\nvm-done\nvm-live\n');
    writeFileSync(join(a, 'shard-vm.json'), JSON.stringify({ vm: 'vm-done', cleanup: 'done' }));
    writeFileSync(join(b, 'cleanup-pending'), 'vm-gone\n');
    const r = spawnSync('bash', [join(UBI, 'prune-pending.sh'), a, b], { encoding: 'utf8', timeout: 30_000, env: baseEnv(dir, runner) });
    return { code: r.status, out: r.stdout, err: r.stderr, a: read(join(a, 'cleanup-pending')), bExists: existsSync(join(b, 'cleanup-pending')) };
  }

  test('removes a VM that is gone and one a later attach pulled and destroyed, and keeps a live one', () => {
    const r = prune('eu-central-h1 vm-live\neu-central-h1 vm-done');
    expect(r.code, r.err).toBe(0);
    expect(r.a).toBe('vm-live\n');
    expect(r.bExists).toBe(false);
    expect(r.out).toContain('removed vm-gone (not in the VM list)');
    expect(r.out).toContain('removed vm-done (shard-vm.json: pulled and destroyed later)');
  }, 30_000);

  test('when the VM list cannot be read, only the destroyed entry goes', () => {
    const r = prune(null);
    expect(r.code, r.err).toBe(0);
    expect(r.a).toBe('vm-live\nvm-gone\n');
    expect(r.bExists).toBe(true);
    expect(r.err).toContain('the VM list could not be read');
  }, 30_000);
});

describe('vm-shard.sh --workload qm-driver', () => {
  function vmShard(smokeRc: number) {
    const home = tmp('he-vm-qm-');
    const repo = join(home, 'work', 'harness-evals');
    mkdirSync(repo, { recursive: true });
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
    writeFileSync(join(repo, 'README.md'), 'x\n');
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'x');
    const commit = g('rev-parse', 'HEAD').trim();
    mkdirSync(join(home, '.bun', 'bin'), { recursive: true });
    script(join(home, '.bun', 'bin', 'bun'), [
      'k=unset; [ -n "${ANTHROPIC_API_KEY:+x}" ] && k=set',
      'echo "$k $*" >> "$HOME/bun.log"',
      'case $1 in --version) echo 1.0 ;; runner/ledger/budget-ledger.ts) touch "$4" ;; harnesses/qm/gstack/s1e-probe.ts) [ "$2" = --dry-run ] && exit ' + smokeRc + ' ;; esac',
      'exit 0',
    ].join('\n'));
    const r = spawnSync('bash', [join(UBI, 'vm-shard.sh'), '--commit', commit, '--prereg', 'x.json', '--name', 's1', '--cells', 'opus.b1', '--lease-usd', '3', '--workload', 'qm-driver', '--', '--stage', 'main', '--shards', '8'],
      { cwd: home, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', ANTHROPIC_API_KEY: PLACEHOLDER }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: r.status, out: r.stdout + r.stderr, home, bun: read(join(home, 'bun.log')).split('\n').filter(Boolean), exit: read(join(home, 'shard', 'exit')).trim() };
  }

  test('smokes with the keyless dry run, creates the ledger at the lease, then passes the shard arguments through', () => {
    const r = vmShard(0);
    const h = r.home;
    expect(r.code, r.out).toBe(0);
    expect(r.exit).toBe('0');
    expect(r.bun).toContain('unset harnesses/qm/gstack/s1e-probe.ts --dry-run --work ' + h + '/shard/smoke/work --out ' + h + '/shard/smoke/results');
    expect(r.bun).toContain('set runner/ledger/budget-ledger.ts init --budget-ledger ' + h + '/shard/results/ledger.sqlite --program-cap-usd 3 --reason qm-driver shard s1');
    expect(r.bun).toContain('set harnesses/qm/gstack/s1e-probe.ts --ledger ' + h + '/shard/results/ledger.sqlite --lease-usd 3 --out ' + h + '/shard/results --work ' + h + '/shard/work --skip-build --stage main --shards 8');
  }, 60_000);

  test('a failed smoke stops the shard with exit 4 before any counted call', () => {
    const r = vmShard(1);
    expect(r.code).toBe(4);
    expect(r.exit).toBe('4');
    expect(r.bun.some((l) => l.includes('--ledger'))).toBe(false);
  }, 60_000);
});
