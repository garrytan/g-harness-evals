// Shard launch fixes for the Ubicloud lane (internal-task): the bootstrap's install downloads have a deadline, --timeout-hours
// covers the time before the shard starts, Cursor cells run only keyless and no VM gets CURSOR_API_KEY, and a
// frontier-harbor shard with an OpenAI cell needs a passing zero-data-retention check (--zdr-gate) before any VM.
// Keyless: a fake ubi-runner.sh (UBI_RUNNER) records every call, and a date shim moves the clock, so no VM, no ssh and
// no spend.
//
// Value: protects=(a) every curl in bootstrap.sh has --max-time; (b) a shard whose sync ran past --timeout-hours never
// starts its bootstrap, and a bootstrap still running at the VM's TTL stop is cut, both with exit 3 and the VM destroyed;
// (c) a keyed Cursor cell is refused before any VM and the --cursor-offline rehearsal is not; (d) the key file a VM gets
// holds no CURSOR_API_KEY, and a Cursor shard's holds no key; (e) an OpenAI frontier-harbor cell is refused without
// --zdr-gate or with a gate that names no commit; fails_when=a stalled download or bootstrap holds the lane past its
// deadline, a keyed Cursor shard launches, a VM receives CURSOR_API_KEY, or a Sol shard launches unchecked;
// seam=UBI_RUNNER and a PATH date shim; no_claim=a real VM, ssh or install.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PLACEHOLDER = 'placeholder-not-a-key';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

type Cell = { id: string; harness: string; model: string };
// A scratch repository holding the lane scripts, a fake runner and a date shim; run-shard.sh runs from there.
function shard(o: { cells: Cell[]; workload?: string; args?: string[]; extra?: string[]; vm?: string; jumpAtSync?: number; hangBootstrap?: boolean; env?: Record<string, string> }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ubi-shard-launch-')));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'provider-keys.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  const calls = join(dir, 'calls'), keys = join(dir, 'keys'), offset = join(dir, 'offset');
  const fake = join(dir, 'ubi-runner.sh');
  writeFileSync(fake, [
    '#!/usr/bin/env bash',
    'echo "$1" >> ' + JSON.stringify(calls),
    'case $1 in',
    '  up) echo ' + JSON.stringify(o.vm ?? 'ubirun-harn7-legacy') + ' ;;',
    '  owner) echo harn7 ;;',
    '  sync) ' + (o.jumpAtSync ? 'echo ' + o.jumpAtSync + ' > ' + JSON.stringify(offset) : 'true') + ' ;;',
    '  ssh) case $3 in',
    '    *"bash -l ~/shard/bin/bootstrap.sh"*) ' + (o.hangBootstrap ? 'sleep 300' : 'true') + ' ;;',
    '    *"cat > ~/.ubirun-env"*) grep -o "^export [A-Z_]*" | sed "s/^export //" >> ' + JSON.stringify(keys) + ' ;;',
    '    *"bin/launch.sh &&"*) exit 1 ;;',
    '    *) cat > /dev/null ;;',
    '  esac ;;',
    '  pull) exit 1 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(fake, 0o755);
  const shim = join(dir, 'bin');
  mkdirSync(shim);
  const realDate = Bun.which('date')!;
  writeFileSync(join(shim, 'date'), '#!/usr/bin/env bash\nif [ "$*" = "+%s" ]; then echo $(( $(' + realDate + ' +%s) + $(cat ' + JSON.stringify(offset) + ' 2>/dev/null || echo 0) )); else exec ' + realDate + ' "$@"; fi\n');
  chmodSync(join(shim, 'date'), 0o755);
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'launch-test', cells: o.cells }));
  const dest = join(dir, 'dest');
  const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', o.cells.map((c) => c.id).join(',') || 'c1', '--lease-usd', '1', '--dest', dest, '--no-smoke', ...(o.workload ? ['--workload', o.workload] : []), ...(o.args ?? []), ...(o.extra ? ['--', ...o.extra] : [])], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 90_000,
    env: { PATH: shim + ':' + (process.env.PATH ?? '/usr/bin:/bin'), HOME: dir, TMPDIR: dir, UBI_RUNNER: fake, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'harn7', UBICLOUD_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER, ...(o.env ?? {}) },
  });
  return { exit: r.status, stderr: r.stderr, lane: read(join(dest, 'lane.log')), calls: read(calls).split('\n').filter(Boolean), keys: existsSync(keys) ? read(keys).split('\n').filter(Boolean) : null };
}

describe('(a) bootstrap.sh downloads have a deadline', () => {
  test('every curl call in bootstrap.sh carries --max-time, and no download is piped straight into a shell', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'ubicloud', 'bootstrap.sh'), 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const curls = src.filter((l) => /\bcurl\s+-/.test(l));
    expect(curls.length).toBeGreaterThanOrEqual(4);
    for (const l of curls) expect(l).toContain('--max-time');
    expect(src.join('\n')).not.toMatch(/curl[^\n|]*\|\s*sudo/);
  });
});

describe('(b) --timeout-hours covers the time before the shard starts', () => {
  test('a sync that runs past --timeout-hours: the bootstrap never starts, exit 3, the VM is destroyed', () => {
    const r = shard({ cells: [], jumpAtSync: 13 * 3600 });
    expect(r.exit, r.stderr).toBe(3);
    expect(r.lane).toContain('timeout after 12 h before the shard started: bootstrap did not start; no smoke and no trial ran');
    expect(r.calls.filter((c) => c === 'ssh').length).toBeLessThan(6);
    expect(r.calls).toContain('down');
    expect(r.keys).toBeNull();
  }, 90_000);

  test('a bootstrap still running when the VM TTL stop comes is cut there, exit 3, the VM is destroyed', () => {
    const now = Math.floor(Date.now() / 1000);
    const vm = 'ubirun-harn7-' + (now + 6 - 1800) + '-ab12cd34-t1';
    const t0 = Date.now();
    const r = shard({ cells: [], vm, hangBootstrap: true });
    expect(r.exit, r.stderr).toBe(3);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(r.lane).toMatch(new RegExp(vm + "'s TTL ends at \\S+; the shard is stopped by \\S+ so its results come back first"));
    expect(r.lane).toContain('timeout after 12 h before the shard started: bootstrap was cut at the deadline; no smoke and no trial ran');
    expect(r.calls).toContain('down');
    expect(r.keys).toBeNull();
  }, 90_000);
});

describe('(c, d) Cursor cells run only keyless, and no VM gets CURSOR_API_KEY', () => {
  const cursor: Cell = { id: 'cur', harness: 'cursor', model: 'anthropic:claude-opus-5-5' };
  test('a keyed Cursor cell is refused before any VM, with or without CURSOR_API_KEY in the shell', () => {
    for (const env of [{}, { CURSOR_API_KEY: PLACEHOLDER }] as Record<string, string>[]) {
      const r = shard({ cells: [cursor], env });
      expect(r.exit).toBe(2);
      expect(r.stderr).toContain('run harness cursor with a key, which is refused');
      expect(r.calls).toEqual([]);
    }
  }, 90_000);

  test('the --cursor-offline rehearsal launches and its VM gets no key at all', () => {
    const r = shard({ cells: [cursor], extra: ['--cursor-offline'], env: { CURSOR_API_KEY: PLACEHOLDER, OPENAI_API_KEY: PLACEHOLDER } });
    expect(r.calls).toContain('up');
    expect(r.keys).toEqual([]);
  }, 90_000);

  test('a proxied shard gets its model keys and never CURSOR_API_KEY', () => {
    const r = shard({ cells: [], env: { CURSOR_API_KEY: PLACEHOLDER, OPENAI_API_KEY: PLACEHOLDER } });
    expect(r.keys).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  }, 90_000);

  // Value: protects=XAI_API_KEY reaching the VM key file from the shared registry (internal-task gate F), and GEMINI_API_KEY
  // reaching only a shard with a Gemini CLI cell on the direct route (shard_keys); fails_when=the forward loop keeps a hand
  // list, or forwards GEMINI_API_KEY to every shard again; seam=UBI_RUNNER; no_claim=the proxy on the VM.
  test('XAI_API_KEY goes to the VM beside the other model keys, from provider-keys.sh; GEMINI_API_KEY only to a Gemini CLI shard on the direct route', () => {
    const env = { CURSOR_API_KEY: PLACEHOLDER, GEMINI_API_KEY: PLACEHOLDER, XAI_API_KEY: PLACEHOLDER };
    expect(shard({ cells: [], env }).keys).toEqual(['ANTHROPIC_API_KEY', 'XAI_API_KEY']);
    const gemini: Cell = { id: 'carbon-gemini', harness: 'gemini-cli', model: 'google:gemini-4-carbon' };
    expect(shard({ cells: [gemini], env }).keys).toEqual(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY']);
    expect(shard({ cells: [gemini], env, extra: ['--gemini-cli-route', 'openrouter-fallback'] }).keys).toEqual(['ANTHROPIC_API_KEY', 'XAI_API_KEY']);
  }, 180_000);
});

describe('(e) the zero-data-retention gate refuses an unchecked OpenAI frontier-harbor shard', () => {
  const sol: Cell = { id: 'sol-dsh', harness: 'dsh', model: 'openai:gpt-6.1-sol' };
  const env = { OPENAI_API_KEY: PLACEHOLDER };
  test('no --zdr-gate: refused before any VM', () => {
    const r = shard({ cells: [sol], workload: 'frontier-harbor', env });
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain('HE-FRONTIER-013 refused: cells sol-dsh call OpenAI, whose organization enforces zero data retention, and no --zdr-gate was given');
    expect(r.calls).toEqual([]);
  }, 90_000);

  test('a gate directory whose install-check.json names no commit: refused before any VM', () => {
    const gate = mkdtempSync(join(tmpdir(), 'zdr-gate-'));
    dirs.push(gate);
    const r = shard({ cells: [sol], workload: 'frontier-harbor', args: ['--zdr-gate', gate], env });
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain('install-check.json names no commit this repository holds');
    expect(r.calls).toEqual([]);
  }, 90_000);

  test('a shard with no OpenAI cell needs no gate', () => {
    const r = shard({ cells: [{ id: 'opus-dsh', harness: 'dsh', model: 'anthropic:claude-opus-5-5' }], workload: 'frontier-harbor', env });
    expect(r.stderr).not.toContain('HE-FRONTIER-013');
    expect(r.calls).toContain('up');
  }, 90_000);
});
