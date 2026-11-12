// internal-task stage 0: while a frontier-harbor trial runs, Harbor's trial directory holds files owned by the container user,
// which the VM user cannot read until Harbor chowns them at the trial's end. A plain remote tar exits 2 on them, and
// run-shard.sh's pull_results dropped every mid-run pull, so no finished trial left the VM before teardown. Keyless, no VM.
//
// Value: protects=ubi-runner.sh pull with --skip-unreadable copies every readable file (a finished trial's result.json)
// and exits 0 while naming each skipped path on stderr, where a plain pull exits non-zero; run-shard.sh passes the flag only
// on a frontier-harbor shard's mid-run pull, which merges the finished trials, logs skipped paths inside a trial with no
// result.json as a live trial and warns about any other skipped path; the teardown pull and the harness workload's pulls
// stay strict, so a teardown pull that fails on an unreadable file keeps the VM; fails_when=a live trial's unreadable files
// fail the mid-run pull again, a skipped path outside a live trial goes unreported, or the teardown or a non-frontier pull
// skips files (and teardown destroys a VM that still holds them, or a sealed shard logs a trial path); why_new=the pull had
// no test with unreadable files; seam=a fake ssh on PATH that runs the remote command in a local folder (ubi-runner.sh),
// and UBI_RUNNER with a fake ubi-runner.sh driven through --attach and through a full launch (run-shard.sh);
// no_claim=a real VM, Harbor's own chown, or ssh.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
const locked: string[] = [];
afterAll(() => {
  for (const p of locked) if (existsSync(p)) chmodSync(p, 0o755);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
const asRoot = process.getuid?.() === 0;

describe('ubi-runner.sh pull --skip-unreadable', () => {
  test.skipIf(asRoot)('copies the finished trial and names the live trial\'s unreadable paths, where a plain pull fails', () => {
    const dir = tmp('he-ubi-pull-');
    const remote = join(dir, 'vm-home');
    const jobs = join(remote, 'shard/results/run/jobs/opus-full__a1');
    mkdirSync(join(jobs, 'task-a__done/verifier'), { recursive: true });
    writeFileSync(join(jobs, 'task-a__done/result.json'), '{"verifier_result": {"rewards": {"reward": 1}}}\n');
    writeFileSync(join(jobs, 'task-a__done/verifier/reward.txt'), '1\n');
    mkdirSync(join(jobs, 'task-b__live/agent'), { recursive: true });
    writeFileSync(join(jobs, 'task-b__live/agent/claude.txt'), 'running\n');
    writeFileSync(join(jobs, 'task-b__live/trial.log'), 'container-owned\n');
    writeFileSync(join(remote, 'shard/results/shard.json'), '{"name": "opus-full"}\n');
    for (const p of [join(jobs, 'task-b__live/agent'), join(jobs, 'task-b__live/trial.log')]) { chmodSync(p, 0o000); locked.push(p); }
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && exec bash -c "${@: -1}"\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    const pull = (to: string, ...flag: string[]) => spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', to, ...flag], { encoding: 'utf8', env });

    const plain = pull(join(dir, 'plain'));
    expect(plain.status).not.toBe(0);

    const out = join(dir, 'skip');
    const r = pull(out, '--skip-unreadable');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(out, 'results/run/jobs/opus-full__a1/task-a__done/result.json'), 'utf8')).toContain('"reward": 1');
    expect(existsSync(join(out, 'results/run/jobs/opus-full__a1/task-a__done/verifier/reward.txt'))).toBe(true);
    expect(existsSync(join(out, 'results/shard.json'))).toBe(true);
    expect(existsSync(join(out, 'results/run/jobs/opus-full__a1/task-b__live/trial.log'))).toBe(false);
    expect(r.stderr).toContain('tar: results/run/jobs/opus-full__a1/task-b__live/agent: Warning: Cannot open: Permission denied');
    expect(r.stderr).toContain('tar: results/run/jobs/opus-full__a1/task-b__live/trial.log: Warning: Cannot open: Permission denied');
  });
});

const PLACEHOLDER = 'placeholder-not-a-key';
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const script = (f: string, lines: string[]) => writeFileSync(f, ['#!/usr/bin/env bash', ...lines].join('\n') + '\n', { mode: 0o755 });

describe('run-shard.sh teardown pull stays strict', () => {
  test('the teardown pull runs without --skip-unreadable, and a teardown pull that fails on an unreadable file keeps the VM', () => {
    const dir = tmp('he-ubi-teardownpull-');
    const calls = join(dir, 'calls.log');
    const runner = join(dir, 'ubi-runner.sh');
    script(runner, [
      'cmd=$1; shift',
      'printf "%s\\n" "$cmd $*" >> "' + calls + '"',
      'case "$cmd" in',
      '  pull) case "$2" in shard/results) [ "${4:-}" != --skip-unreadable ] || exit 3',
      '      mkdir -p "$3/results/run/jobs/j__a1/t-done" && echo \'{}\' > "$3/results/run/jobs/j__a1/t-done/result.json"',
      '      echo "tar: results/run/jobs/j__a1/t-live/trial.log: Cannot open: Permission denied" >&2; exit 2 ;;',
      '    *) exit 1 ;; esac ;;',
      '  down) exit 0 ;;',
      '  ssh) case "$2" in *"cat ~/shard/exit"*) echo 0; echo "::trials 1" ;; esac; cat > /dev/null ;;',
      '  *) exit 0 ;;',
      'esac',
    ]);
    const dest = join(dir, 'dest');
    mkdirSync(dest);
    writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 's1', vm: 'vm1', size: 'standard-16', sealed: false, workload: 'frontier-harbor', cleanup: 'pending' }));
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: PLACEHOLDER };
    const r = spawnSync('bash', [join(ROOT, 'scripts/ubicloud/run-shard.sh'), '--attach', '--dest', dest, '--poll-seconds', '1'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = read(calls);
    expect(log, r.stderr).toContain('pull vm1 shard/results ' + join(dest, '.pull') + '\n');
    expect(log).not.toContain('--skip-unreadable');
    expect(log).not.toContain('down vm1');
    expect(read(join(dest, 'cleanup-pending'))).toContain('vm1');
    expect(read(join(dest, 'lane.log'))).toContain('vm1 is NOT destroyed');
    expect(existsSync(join(dest, '.pull'))).toBe(false);
  }, 60_000);
});

// A full launch through run-shard.sh against a fake ubi-runner.sh, as in tests/ubicloud-run-path.test.ts. A pull of
// shard/results with --skip-unreadable brings back a finished and a live trial and names two of the live trial's paths and
// results/proxy.log as unreadable; a pull without it brings back results/ cleanly. The shard exits once one pull happened,
// so the first pull is the mid-run replicate pull and the last one is the teardown pull.
function launch(workload: 'frontier-harbor' | 'harness') {
  const dir = tmp('he-ubi-replicatepull-');
  const repo = join(dir, 'repo');
  const UBI = join(ROOT, 'scripts', 'ubicloud');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts', 'prune-pending.sh']) copyFileSync(join(UBI, f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  const commit = g('rev-parse', 'HEAD').trim();
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'livepull-test', cells: [{ id: 'c1', harness: 'hermes' }] }));
  const runner = join(dir, 'ubi-runner.sh');
  script(runner, [
    'd=' + JSON.stringify(dir),
    'cmd=$1; shift',
    'printf "%s\\n" "$cmd $*" >> "$d/calls.log"',
    'case "$cmd" in',
    '  up) echo vm1 ;;',
    '  owner) echo test-owner ;;',
    '  pull) case "$2" in shard/results)',
    '      echo $(( $(cat "$d/npull" 2>/dev/null || echo 0) + 1 )) > "$d/npull"',
    '      mkdir -p "$3/results" && echo v1 > "$3/results/trials.jsonl" && echo \'{"name": "s1"}\' > "$3/results/shard.json"',
    '      if [ "${4:-}" = --skip-unreadable ]; then',
    '        mkdir -p "$3/results/run/jobs/j__a1/t-done" && echo \'{}\' > "$3/results/run/jobs/j__a1/t-done/result.json"',
    '        for p in run/jobs/j__a1/t-live/agent run/jobs/j__a1/t-live/trial.log proxy.log; do echo "tar: results/$p: Warning: Cannot open: Permission denied" >&2; done',
    '      fi ;;',
    '    *) exit 1 ;; esac ;;',
    '  ssh) case "$2" in',
    '      *"::trials"*) [ "$(cat "$d/npull" 2>/dev/null || echo 0)" -ge 1 ] && echo 0; echo "::trials 1" ;;',
    '      *) cat > /dev/null ;; esac ;;',
    '  *) exit 0 ;;',
    'esac',
  ]);
  const dest = join(dir, 'dest');
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER, OPENAI_API_KEY: PLACEHOLDER, TMPDIR: dir };
  const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', commit, '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, '--poll-seconds', '1', '--replicate-seconds', '1', '--workload', workload],
    { cwd: dir, encoding: 'utf8', timeout: 120_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const calls = read(join(dir, 'calls.log')).split('\n').filter(Boolean);
  return { code: r.status, err: r.stderr, dest, calls, pulls: calls.filter((c) => c.startsWith('pull vm1 shard/results ')), laneLog: read(join(dest, 'lane.log')) };
}

describe('run-shard.sh mid-run replicate pull', () => {
  test('a frontier-harbor shard\'s mid-run pull skips unreadable files, merges the finished trial and logs the live trial and the warning', () => {
    const r = launch('frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.pulls.length, r.laneLog).toBeGreaterThanOrEqual(2);
    expect(r.pulls[0]).toEndWith(' --skip-unreadable');
    expect(r.pulls.at(-1)).not.toContain('--skip-unreadable');
    expect(existsSync(join(r.dest, 'results/run/jobs/j__a1/t-done/result.json'))).toBe(true);
    expect(r.laneLog).toContain('pull: skipped 2 unreadable path(s) in 1 live trial(s)');
    expect(r.laneLog).toContain('WARNING: pull: 1 path(s) on the VM could not be read and are not part of a live trial, so they are missing here: results/proxy.log');
    expect(r.laneLog).toContain('replicate: 1 records, 1 finished trial(s)');
    expect(r.calls).toContain('down vm1');
  }, 120_000);

  test('a harness shard\'s pulls, mid-run and teardown, never pass --skip-unreadable', () => {
    const r = launch('harness');
    expect(r.code, r.err).toBe(0);
    expect(r.pulls.length, r.laneLog).toBeGreaterThanOrEqual(2);
    for (const p of r.pulls) expect(p).not.toContain('--skip-unreadable');
    expect(r.laneLog).toContain('replicate: 1 records in');
    expect(r.laneLog).not.toContain('pull: skipped');
    expect(r.calls).toContain('down vm1');
  }, 120_000);
});
