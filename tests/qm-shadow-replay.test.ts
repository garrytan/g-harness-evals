// internal-task shadow replay preflight, QM side: the shared check (scripts/skill-resolver/shadow-replay-check.ts) through
// harnesses/qm/shadow-replay.sh, which points the check's --gbrain at a wrapper running the arm image's own resolver in one
// container with no network. Keyless part: a stand-in docker on PATH runs the shared stand-in (scripts/skill-resolver/
// gbrain-stub.ts) on the host for "docker exec", so the wrapper's plumbing (the environment it passes, the arguments, the
// exit codes, the cleanup) is checked without a daemon: SHADOW_REPLAY_OK, BUDGET_REPLAY_OK with --until-exhausted, and
// SHADOW_REPLAY_FAIL (exit 1) for a stand-in whose shadow mode writes on mode's session state. Docker part, skipped unless
// docker answers and the arm images exist (qm-arms-check.ts builds them): the same three on harness-eval/qm:harn52-arm-catalog
// and its -shared variant.
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const WRAPPER = join(ROOT, 'harnesses/qm/shadow-replay.sh');
const STUB = join(ROOT, 'scripts/skill-resolver/gbrain-stub.ts');
const BUN = process.execPath;

/** A stand-in docker: run -d prints an id and records the image, exec runs the stand-in for that image with only the
 *  -e variables, rm records the cleanup. Images ending in -shared get the stand-in with one shared namespace. */
function fakeDocker() {
  const dir = mkdtempSync(join(tmpdir(), 'he-qm-replay-docker-'));
  const source = readFileSync(STUB, 'utf8'), shared = source.replace("(shadow ? 'shadow' : 'on')", "'on'");
  expect(shared).not.toBe(source);
  writeFileSync(join(dir, 'gbrain-stub-shared.ts'), shared);
  writeFileSync(join(dir, 'docker'), [
    '#!/usr/bin/env bash',
    'log=' + JSON.stringify(join(dir, 'docker.log')),
    'cmd=$1; shift',
    'case "$cmd" in',
    '  run) echo "run $*" >> "$log"; img=; name=; while [ $# -gt 0 ]; do case "$1" in --name) name=$2; shift 2 ;; -v|--user|--entrypoint|--network) shift 2 ;; -d|--rm) shift ;; *) img=$1; shift; break ;; esac; done',
    '       echo "$img" > ' + JSON.stringify(dir) + '/"$name".image; echo fake-id ;;',
    '  exec) envs=(); while [ $# -gt 0 ]; do case "$1" in -i) shift ;; -e) envs+=("$2"); shift 2 ;; *) break ;; esac; done',
    '       name=$1; shift 2; img=$(cat ' + JSON.stringify(dir) + '/"$name".image); stub=' + JSON.stringify(STUB),
    '       case "$img" in *-shared) stub=' + JSON.stringify(join(dir, 'gbrain-stub-shared.ts')) + ' ;; esac',
    '       for e in "${envs[@]}"; do case "$e" in HOME=*|GBRAIN_HOME=*|GBRAIN_SKILLS_NO_AUTOREBUILD=*) ;; *) echo "unexpected -e $e" >&2; exit 97 ;; esac; done',
    '       exec env -i PATH=/usr/bin:/bin "${envs[@]}" ' + BUN + ' "$stub" "$@" ;;',
    '  rm) echo "rm $*" >> "$log" ;;',
    '  *) echo "fake docker: $cmd" >&2; exit 98 ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'docker'), 0o755);
  return dir;
}
const replay = (image: string, args: string[], path: string) => spawnSync('bash', [WRAPPER, ...args], { encoding: 'utf8', timeout: 600_000, env: { PATH: path, HOME: process.env.HOME ?? '/tmp', QM_IMAGE: image } });

describe("QM's shadow replay wrapper, keyless (stand-in docker)", () => {
  test('SHADOW_REPLAY_OK through the wrapper; the container runs with no network and is removed', () => {
    const dir = fakeDocker();
    const r = replay('harness-eval/qm:harn52-arm-catalog', [], dir + ':' + process.env.PATH);
    expect(r.stdout).toMatch(/^SHADOW_REPLAY_OK turns=40 blocks=\d+ sequence_sha256=[0-9a-f]{64} harness=qm .*phases=under_half,half_to_80,over_80,exhausted /);
    expect(r.status).toBe(0);
    const log = readFileSync(join(dir, 'docker.log'), 'utf8');
    expect(log).toMatch(/^run -d --rm --name qm-shadow-replay-\S+ --network none --user \d+:\d+ --entrypoint sleep -v \S+ harness-eval\/qm:harn52-arm-catalog infinity\n/);
    expect(log).toMatch(/\nrm -f qm-shadow-replay-\S+\n$/);
  }, 300_000);

  test('BUDGET_REPLAY_OK with --until-exhausted: at most 2,000 block tokens, then three empty turns', () => {
    const r = replay('harness-eval/qm:harn52-arm-catalog', ['--until-exhausted'], fakeDocker() + ':' + process.env.PATH);
    const m = /^BUDGET_REPLAY_OK turns=(\d+) exhausted_at=(\d+) spent=(\d+) /.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(Number(m![3])).toBeLessThanOrEqual(2000);
    expect(Number(m![1])).toBe(Number(m![2]) + 3);
    expect(r.status).toBe(0);
  }, 300_000);

  test('a stand-in whose shadow mode writes on mode state fails with exit 1; a usage error exits 2', () => {
    const dir = fakeDocker();
    const bad = replay('harness-eval/qm:harn52-arm-catalog-shared', [], dir + ':' + process.env.PATH);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^SHADOW_REPLAY_FAIL .*the shadow block differs from the on block/);
    expect(replay('harness-eval/qm:harn52-arm-catalog', ['--bogus', 'x'], dir + ':' + process.env.PATH).status).toBe(2);
  }, 300_000);
});

const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const haveDocker = spawnSync('docker', ['info'], { env, stdio: 'ignore' }).status === 0;
const IMAGES = ['harness-eval/qm:harn52-arm-catalog', 'harness-eval/qm:harn52-arm-catalog-shared'];
const ready = haveDocker && IMAGES.every((i) => spawnSync('docker', ['image', 'inspect', i], { env, stdio: 'ignore' }).status === 0);

describe.if(ready)("QM's shadow replay on the arm image (docker)", () => {
  test("the image's own resolver: SHADOW_REPLAY_OK, BUDGET_REPLAY_OK, and the -shared variant fails", () => {
    const ok = replay(IMAGES[0]!, [], env.PATH);
    expect(ok.stdout).toStartWith('SHADOW_REPLAY_OK turns=40 ');
    expect(ok.status).toBe(0);
    const budget = replay(IMAGES[0]!, ['--until-exhausted'], env.PATH);
    expect(budget.stdout).toStartWith('BUDGET_REPLAY_OK ');
    expect(budget.status).toBe(0);
    const bad = replay(IMAGES[1]!, [], env.PATH);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^SHADOW_REPLAY_FAIL .*the shadow block differs from the on block/);
    expect(spawnSync('docker', ['ps', '-a', '--filter', 'name=qm-shadow-replay', '--format', '{{.Names}}'], { env, encoding: 'utf8' }).stdout.trim()).toBe('');
  }, 600_000);
});
