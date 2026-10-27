// scripts/ubicloud/smoke-lease.ts: the default smoke lease vm-shard.sh derives from the proxy's per-call reservation.
//
// Value: protects=the derived lease is twice the largest per-call reservation (50,000 input tokens plus the output cap at
// the model's list price) among the named harness cells, rounded up to $0.50 and never under $1, so a Sonnet 5.5 smoke at
// the 128000 default gets $3 (the $0.50 default refused its $1.42 reservation in gbrain-memory-2026-10); fails_when=the
// figure drops below one reservation, scripted cells or cells outside --cells count, --max-output-tokens is ignored, or a
// model without a list price passes silently; why_new=the script is new; seam=none (the repository's own price table);
// no_claim=what the proxy actually reserves for a given prompt.

import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'ubicloud', 'smoke-lease.ts');

const CELLS = [
  { id: 'sonnet', harness: 'hermes', model: 'anthropic:claude-sonnet-5-5' },
  { id: 'haiku', harness: 'openclaw', model: 'anthropic:claude-haiku-5-5' },
  { id: 'opus', harness: 'hermes', model: 'anthropic:claude-opus-5-5' },
  { id: 'scripted', harness: 'scripted', model: 'anthropic:claude-opus-5-5' },
  { id: 'unknown', harness: 'hermes', model: 'anthropic:no-such-model-9' },
  { id: 'scripted-mode', harness: 'hermes', harness_mode: 'scripted', model: 'anthropic:claude-opus-5-5' },
  { id: 'nomodel', harness: 'hermes' },
  { id: 'gemini', harness: 'hermes', model: 'gemini:gemini-3.8-flash' },
  { id: 'dated', harness: 'hermes', model: 'anthropic:claude-sonnet-5-5-20261001' },
];

function run(cells: string, extra: string[] = []): { code: number | null; out: string; err: string } {
  const dir = mkdtempSync(join(tmpdir(), 'he-smoke-lease-'));
  try {
    const prereg = join(dir, 'prereg.json');
    writeFileSync(prereg, JSON.stringify({ run_id: 'test', cells: CELLS }));
    const r = spawnSync('bun', [SCRIPT, '--prereg', prereg, '--cells', cells, ...extra], { cwd: ROOT, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('smoke-lease.ts', () => {
  test('Sonnet 5.5 at the 128000 default: $1.38 a call, $3.00 lease', () => {
    const r = run('sonnet');
    expect(r.code).toBe(0);
    expect(r.out).toBe('3.00');
    expect(r.err).toContain('one call reserves up to $1.38');
  });

  test('Haiku 5.5 stays at the $1 floor and Opus 5.5 needs $6', () => {
    expect(run('haiku').out).toBe('1.00');
    expect(run('opus').out).toBe('6.00');
  });

  test('a model the proxy prices outside the canonical table (a harness row, a dated snapshot id) gets a lease too', () => {
    expect(run('gemini').out).toBe('1.50');
    expect(run('dated').out).toBe('3.00');
  });

  test('the largest cell wins and scripted cells and cells outside --cells do not count', () => {
    expect(run('haiku,sonnet').out).toBe('3.00');
    expect(run('haiku,sonnet,scripted').out).toBe('3.00');
    expect(run('scripted').out).toBe('1.00');
    expect(run('scripted-mode').out).toBe('1.00');
  });

  test('a smaller output cap lowers the figure', () => {
    expect(run('sonnet', ['--max-output-tokens', '16000']).out).toBe('1.00');
    expect(run('opus', ['--max-output-tokens', '64000']).out).toBe('3.00');
  });

  test('a model without a list price is exit 2 with the cell named', () => {
    const r = run('sonnet,unknown');
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain('no list price for anthropic:no-such-model-9 (cell unknown)');
    const bare = run('nomodel');
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('no list price for no model (cell nomodel)');
  });

  test('missing arguments are exit 2', () => {
    const r = spawnSync('bun', [SCRIPT, '--cells', 'sonnet'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(run('sonnet', ['--max-output-tokens', 'lots']).code).toBe(2);
    expect(run('sonnet', ['--max-output-tokens', '-1']).code).toBe(2);
  });
});

// scripts/ubicloud/vm-shard.sh and run-shard.sh around the derived lease. vm-shard.sh runs with a temporary HOME holding a
// checkout whose scripts/run-shard.sh is a recorder, and fake git and bun on PATH (the fake bun runs the real
// smoke-lease.ts); run-shard.sh runs as a copy inside a one-commit throwaway repository (it clones and checks out its own
// root, which here holds only the lane scripts) against a fake ubi-runner.sh (its UBI_RUNNER hook) that records what is uploaded.
//
// Value: protects=vm-shard.sh derives the smoke lease only when none is given and passes it to the smoke run and its scratch
// prereg, with --max-output-tokens read from the extra arguments; an underivable lease is exit 2 before any run;
// fails_when=the derivation runs despite an override or --no-smoke, the cap is not read from the extra arguments, the
// lease stops reaching run-shard.sh or the prereg, or a failure is swallowed; why_new=smoke-lease.ts is tested alone, nothing
// ran vm-shard.sh; seam=fake git, bun and run-shard.sh under a temp HOME; no_claim=git, bun install, docker and the real run.
//
// Value: protects=run-shard.sh forwards --smoke-lease-usd to the VM only when given and ships smoke-lease.ts beside
// vm-shard.sh; fails_when=the flag is always passed (an empty or stale figure defeats the derivation) or the upload list
// drops smoke-lease.ts (every VM then fails at the lease); why_new=no test ran run-shard.sh; seam=UBI_RUNNER (existing);
// no_claim=sync, bootstrap, polling, teardown and cost figures.

const VM_SHARD = join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh');
const RUN_SHARD = join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh');
const COMMIT = 'a'.repeat(40);
const PLACEHOLDER = 'placeholder';

function fake(dir: string, name: string, body: string) {
  const f = join(dir, name);
  writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(f, 0o755);
}

function vmShard(cellIds: string, args: string[]) {
  const home = mkdtempSync(join(tmpdir(), 'he-vm-shard-'));
  const checkout = join(home, 'work', 'harness-evals');
  mkdirSync(join(checkout, 'scripts'), { recursive: true });
  mkdirSync(join(checkout, 'tasks', 'multiuser', 'dev', 't1'), { recursive: true });
  symlinkSync(join(ROOT, 'runner'), join(checkout, 'runner'));
  const bin = join(home, 'fakebin');
  mkdirSync(bin);
  fake(bin, 'git', 'case "$1" in rev-parse) echo ' + COMMIT + ' ;; esac');
  fake(bin, 'bun', 'case "$1" in install) exit 0 ;; --version) echo 1.0.0 ;; *smoke-lease.ts) echo "bun $*" >> "$HOME/bun.log"; exec ' + process.execPath + ' "$@" ;; *) echo "fake bun: $*" >&2; exit 9 ;; esac');
  fake(join(checkout, 'scripts'), 'run-shard.sh', 'echo "run-shard $*" >> "$HOME/calls.log"; out=""; while [ $# -gt 0 ]; do [ "$1" = --out ] && out=$2; shift; done; mkdir -p "$out"; echo \'{"trial_id":"t","termination":"completed"}\' > "$out/trials.jsonl"');
  writeFileSync(join(home, 'prereg.json'), JSON.stringify({ run_id: 'test', spend_cap_usd: 99, cells: CELLS }));
  const r = spawnSync('bash', [VM_SHARD, '--commit', COMMIT, '--prereg', join(home, 'prereg.json'), '--name', 's1', '--cells', cellIds, '--lease-usd', '7', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: bin + ':' + process.env.PATH, HOME: home, HE_SHARD_IN_DOCKER_GROUP: '1' },
  });
  const read = (rel: string) => (existsSync(join(home, rel)) ? readFileSync(join(home, rel), 'utf8') : '');
  const calls = read('calls.log').split('\n').filter(Boolean);
  const smokeCap = existsSync(join(home, 'shard', 'smoke', 'prereg.json')) ? JSON.parse(read('shard/smoke/prereg.json')).spend_cap_usd : undefined;
  const result = { code: r.status, out: r.stdout + r.stderr, calls, smokeCap, bunLog: read('bun.log'), exitFile: read('shard/exit').trim() };
  rmSync(home, { recursive: true, force: true });
  return result;
}

describe('vm-shard.sh smoke lease', () => {
  test('without --smoke-lease-usd the lease is derived, honours --max-output-tokens and reaches the smoke run and its prereg', () => {
    const a = vmShard('sonnet', []);
    expect(a.code).toBe(0);
    expect(a.out).toContain("smoke lease: $3.00 (derived from the proxy's reservation at 128000 output tokens");
    expect(a.smokeCap).toBe(3);
    expect(a.calls).toHaveLength(2);
    expect(a.calls[0]).toContain('--name smoke-s1 --cells sonnet --lease-usd 3.00 ');
    expect(a.calls[1]).toContain('--name s1 --cells sonnet --lease-usd 7 ');

    const b = vmShard('sonnet', ['--', '--max-output-tokens', '16000']);
    expect(b.code).toBe(0);
    expect(b.out).toContain("smoke lease: $1.00 (derived from the proxy's reservation at 16000 output tokens");
    expect(b.smokeCap).toBe(1);
    expect(b.calls[0]).toContain('--lease-usd 1.00 ');
    expect(b.calls[0]).toContain('--max-output-tokens 16000');
    expect(b.calls[1]).toContain('--max-output-tokens 16000');
  }, 30_000);

  test('--smoke-lease-usd and --no-smoke never run the derivation, even for a cell it would refuse', () => {
    const given = vmShard('unknown', ['--smoke-lease-usd', '2']);
    expect(given.code).toBe(0);
    expect(given.bunLog).toBe('');
    expect(given.out).not.toContain('smoke lease:');
    expect(given.smokeCap).toBe(2);
    expect(given.calls[0]).toContain('--name smoke-s1 --cells unknown --lease-usd 2 ');

    const skipped = vmShard('unknown', ['--no-smoke']);
    expect(skipped.code).toBe(0);
    expect(skipped.bunLog).toBe('');
    expect(skipped.calls).toHaveLength(1);
    expect(skipped.calls[0]).toContain('--name s1 ');
  }, 30_000);

  test('a cell with no list price is exit 2 with the cell named, written to the exit file, before any run-shard.sh call', () => {
    const r = vmShard('sonnet,unknown', []);
    expect(r.code).toBe(2);
    expect(r.exitFile).toBe('2');
    expect(r.out).toContain('no list price for anthropic:no-such-model-9 (cell unknown)');
    expect(r.out).toContain('smoke lease: could not be derived; pass --smoke-lease-usd');
    expect(r.calls).toEqual([]);
  }, 30_000);
});

describe('ubicloud/run-shard.sh smoke lease flag', () => {
  function laneRun(extraArgs: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-lane-'));
    const store = join(dir, 'uploads');
    mkdirSync(store);
    const runner = join(dir, 'ubi-runner.sh');
    fake(dir, 'ubi-runner.sh', [
      'cmd=$1; shift',
      'case "$cmd" in',
      '  up) echo vm1 ;;',
      '  owner) echo fake-owner ;;',
      '  ssh) shift; c=$1; case "$c" in',
      '    "cat > "*) cat > "' + store + '/$(basename "${c#cat > }")" ;;',
      '    *"cat ~/shard/exit"*) cat > /dev/null; echo 0; echo "::trials 0" ;;',
      '    *) cat > /dev/null ;;',
      '  esac ;;',
      '  *) cat > /dev/null 2>&1 < /dev/null || true ;;',
      'esac',
    ].join('\n'));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'lane-test', cells: CELLS }));
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'sonnet', '--lease-usd', '7', '--dest', join(dir, 'dest'), '--poll-seconds', '1', ...extraArgs], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        UBI_RUNNER: runner,
        UBI_RUNNER_STATE: join(dir, 'state'),
        UBI_OWNER: 'test-owner',
        UBICLOUD_API_KEY: PLACEHOLDER,
        ANTHROPIC_API_KEY: PLACEHOLDER,
        OPENAI_API_KEY: PLACEHOLDER,
      },
    });
    const uploaded = readdirSync(store).sort();
    const launch = existsSync(join(store, 'launch.sh')) ? readFileSync(join(store, 'launch.sh'), 'utf8') : '';
    const shipped = existsSync(join(store, 'smoke-lease.ts')) ? readFileSync(join(store, 'smoke-lease.ts'), 'utf8') : '';
    rmSync(dir, { recursive: true, force: true });
    return { code: r.status, err: r.stderr, uploaded, launch, shipped };
  }

  test('--smoke-lease-usd is forwarded only when given, and smoke-lease.ts is uploaded with vm-shard.sh', () => {
    const unset = laneRun([]);
    expect(unset.code).toBe(0);
    expect(unset.uploaded).toEqual(expect.arrayContaining(['bootstrap.sh', 'launch.sh', 'smoke-lease.ts', 'vm-shard.sh']));
    expect(unset.shipped).toBe(readFileSync(SCRIPT, 'utf8'));
    expect(unset.launch).toContain('--lease-usd 7');
    expect(unset.launch).not.toContain('--smoke-lease-usd');

    const given = laneRun(['--smoke-lease-usd', '2.5']);
    expect(given.code).toBe(0);
    expect(given.launch).toContain('--smoke-lease-usd 2.5');
  }, 60_000);
});
