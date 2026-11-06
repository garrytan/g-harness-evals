// internal-task: ubi-runner.sh names every VM it creates with the TTL suffix gstack's runner (gstack#3652) writes and its reaper
// reads, ubirun-<owner>-<epoch>-<suffix>-t<hours>, and run-shard.sh sizes that TTL to outlive the shard. The runner talks to
// a fake Ubicloud API on 127.0.0.1 (UBICLOUD_API_URL) that answers vm list, refuses every create and records each request,
// so no test reaches the network or makes a VM.
//
// Value: protects=the ttl rule (UBI_TTL_HOURS rounded up, else 3, 1-999), the generated name's shape as gstack's reaper
// parses it (owner, epoch, TTL), up and run refusing without UBI_OWNER, a bad UBI_TTL_HOURS or a -n name without the suffix
// before any API request, the UBICLOUD: left= line run ends with, list --mine and down still handling the suffix-less names
// live VMs carry, and run-shard.sh handing up --timeout-hours plus 1 (or a longer inherited UBI_TTL_HOURS) and refusing a
// shorter one; fails_when=a VM can be created without a TTL or owner, the TTL can be shorter than the shard, or a legacy
// name stops listing or going down; why_new=the TTL is new; seam=UBICLOUD_API_URL (existing) and UBI_RUNNER (existing) for
// run-shard.sh; no_claim=gstack's reaper itself, a real create, SSH.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OWNER = 'HA' + 'RN-7';
const VM = 'ubi' + 'run-';

const ROOT = join(import.meta.dir, '..');
const RUNNER = join(ROOT, 'scripts', 'ubicloud', 'ubi-runner.sh');
const PLACEHOLDER = 'placeholder';

// gstack#3652's vm_rows (scripts/ubicloud/ubi-runner.sh at 715e3a1a): owner and creation epoch from the name, the TTL from
// its -t<hours> tail, expiry = epoch + hours * 3600, and the reaper destroys 600 s after that.
const GSTACK_OWNED = /^ubirun-([a-z][a-z0-9]{0,11})-([0-9]{10})-/;
const GSTACK_TTL = /-t([0-9]{1,3})$/;

type Fake = { url: string; calls: string[][]; rows: string[]; live: Set<string>; ghosts: boolean };
let api: Fake;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  api = { url: '', calls: [], rows: [], live: new Set(), ghosts: false };
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const { argv } = (await req.json()) as { argv: string[] };
      api.calls.push(argv);
      if (argv[0] === 'vm' && argv[1] === 'list') {
        const names = api.rows.filter((r) => api.live.has(r.split(/\s+/)[1]));
        if (api.ghosts) for (const c of api.calls) if (c[2] === 'create') names.push(c[1].replace('/', ' '));
        return new Response(names.map((r) => r + '\n').join(''));
      }
      const name = (argv[1] ?? '').split('/')[1] ?? '';
      if (argv[2] === 'create') return new Response('the fake API refuses every create\n', { status: 400 });
      if (argv[2] === 'show') return api.live.has(name) ? new Response('state: running\n') : new Response('not found\n', { status: 404 });
      if (argv[2] === 'destroy') {
        api.live.delete(name);
        return new Response('destroyed\n');
      }
      return new Response('unexpected request\n', { status: 500 });
    },
  });
  api.url = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function reset(rows: string[] = [], ghosts = false) {
  api.calls.length = 0;
  api.rows = rows;
  api.live = new Set(rows.map((r) => r.split(/\s+/)[1]));
  api.ghosts = ghosts;
}

// Runs ubi-runner.sh asynchronously (the fake API answers on this process's event loop) with a scrubbed environment.
async function runner(args: string[], env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ubi-runner-ttl-'));
  try {
    const base: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      UBI_RUNNER_STATE: join(dir, 'state'),
      UBICLOUD_API_KEY: PLACEHOLDER,
      UBICLOUD_API_URL: api.url,
      UBI_POLL_SECONDS: '1',
      UBI_API_TIMEOUT: '5',
      UBI_DOWN_TIMEOUT: '20',
      UBI_CREATE_GRACE: '0',
    };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete base[k]; else base[k] = v;
    const p = Bun.spawn(['bash', RUNNER, ...args], { env: base, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const [stdout, stderr, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { stdout, stderr, exit, lines: stderr.trimEnd().split('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ttl = (value: string | undefined) => spawnSync('bash', [RUNNER, 'ttl'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ...(value === undefined ? {} : { UBI_TTL_HOURS: value }) } });

describe('ubi-runner.sh TTL', () => {
  test('ttl is UBI_TTL_HOURS rounded up to a whole hour, 3 when unset, and refuses anything outside 1-999', () => {
    for (const [value, hours] of [[undefined, '3'], ['', '3'], ['12', '12'], ['12.2', '13'], ['13.0', '13'], ['0.5', '1'], ['007', '7'], ['999', '999']] as const) {
      const r = ttl(value);
      expect([value, r.status, r.stdout.trim(), r.stderr]).toEqual([value, 0, hours, '']);
    }
    for (const value of ['0', '0.0', '-1', 'abc', '1000', '999.5', '1.', '3h']) {
      const r = ttl(value);
      expect([value, r.status, r.stdout]).toEqual([value, 1, '']);
      expect(r.stderr.trimEnd()).toBe(`ubi-runner: UBI_TTL_HOURS must be a number of hours that rounds up to 1-999 (got '${value}')`);
    }
  });

  test('up and run refuse without UBI_OWNER, and with a bad UBI_TTL_HOURS, before any API request', async () => {
    reset();
    for (const args of [['up'], ['run', '--', 'true']]) {
      const r = await runner(args, { UBI_OWNER: undefined });
      expect(r.exit).toBe(1);
      expect(r.stderr.trimEnd()).toBe('ubi-runner: UBI_OWNER is not set: every VM must carry its owner; export UBI_OWNER=<your thread code> and rerun');
      const bad = await runner(args, { UBI_OWNER: OWNER, UBI_TTL_HOURS: '0' });
      expect(bad.exit).toBe(1);
      expect(bad.stderr.trimEnd()).toBe("ubi-runner: UBI_TTL_HOURS must be a number of hours that rounds up to 1-999 (got '0')");
    }
    expect(api.calls).toEqual([]);
  }, 30_000);

  test('a -n name must be ubirun-<owner>-<epoch>-<suffix>-t<hours> for this owner; a conforming one is created as given', async () => {
    reset();
    const now = Math.floor(Date.now() / 1000);
    for (const bad of [`ubirun-harn7-${now}-pr5`, `ubirun-harn13-${now}-pr5-t3`, `ubirun-harn7-${now}-t3`, `ubirun-harn7-${now}-pr5-t0`, `ubirun-harn7-${now}-pr5-t1000`, `my-vm-t3`]) {
      const r = await runner(['up', '-n', bad], { UBI_OWNER: OWNER });
      expect(r.exit).toBe(1);
      expect(r.stderr.trimEnd()).toBe(`ubi-runner: invalid VM name '${bad}': a VM is named ubirun-harn7-<epoch>-<suffix>-t<hours>, so gstack's reaper can read its owner and TTL (omit -n for a generated name)`);
    }
    expect(api.calls).toEqual([]);
    for (const bad of [`ubirun-harn7-${now}-pr5`, `my-vm-t3`]) {
      const r = await runner(['run', '-n', bad, '--', 'true'], { UBI_OWNER: OWNER });
      expect(r.exit).toBe(1);
      expect(r.stderr.trimEnd()).toBe(`ubi-runner: invalid VM name '${bad}': a VM is named ubirun-harn7-<epoch>-<suffix>-t<hours>, so gstack's reaper can read its owner and TTL (omit -n for a generated name)`);
    }
    expect(api.calls).toEqual([]);
    const good = `ubirun-harn7-${now}-pr5-t3`;
    const r = await runner(['up', '-n', good], { UBI_OWNER: OWNER });
    expect(r.exit).toBe(1);
    expect(api.calls.filter((c) => c[2] === 'create').map((c) => c[1])).toEqual([`eu-central-h1/${good}`]);
  }, 30_000);

  test('run names its VM with the TTL, gstack\'s reaper reads owner, epoch and expiry from it, and run ends with the left= line', async () => {
    const legacy = VM + 'harn7-1793380000-ab12cd34';
    reset([`eu-central-h1 ${legacy}`, 'eu-central-h1 ' + VM + 'harn14-1793383503-08522507', 'eu-central-h1 ' + VM + 'gsta30-1793360524-154fa95a-t14']);
    const before = Math.floor(Date.now() / 1000);
    const r = await runner(['run', '--src', ROOT, '--', 'true'], { UBI_OWNER: OWNER, UBI_TTL_HOURS: '12.1' });
    const after = Math.ceil(Date.now() / 1000);
    expect(r.exit).toBe(1);
    const creates = api.calls.filter((c) => c[2] === 'create').map((c) => c[1].split('/')[1]);
    expect(creates).toHaveLength(1);
    const vm = creates[0];
    expect(vm).toMatch(/^ubirun-harn7-\d{10}-[0-9a-f]{8}-t13$/);
    const owned = vm.match(GSTACK_OWNED)!;
    expect(owned[1]).toBe('harn7');
    const epoch = Number(owned[2]);
    expect(epoch).toBeGreaterThanOrEqual(before); // gstack-timing-ok: the name's epoch is the create time
    expect(epoch).toBeLessThanOrEqual(after); // gstack-timing-ok: the name's epoch is the create time
    expect(Number(vm.match(GSTACK_TTL)![1])).toBe(13);
    expect(r.lines).toContain(`ubi-runner: creating eu-central-h1/${vm} (standard-16)`);
    expect(r.lines.at(-1)).toBe(`UBICLOUD: left=0 owner=harn7 vm=${vm} others=1`);
  }, 30_000);

  test('a run whose VM is still listed after teardown says left=1 and how to destroy it', async () => {
    reset([], true);
    const r = await runner(['run', '--src', ROOT, '--', 'true'], { UBI_OWNER: OWNER });
    const vm = api.calls.find((c) => c[2] === 'create')![1].split('/')[1];
    expect(vm).toMatch(/^ubirun-harn7-\d{10}-[0-9a-f]{8}-t3$/);
    expect(r.exit).toBe(1);
    expect(r.lines.slice(-2)).toEqual([`UBICLOUD: left=1 owner=harn7 vm=${vm} others=0`, `ubi-runner: VM cleanup not confirmed for ${vm} (left=1); destroy it with: ${RUNNER} down ${vm}`]);
  }, 30_000);

  test('list --mine and down still handle names without the suffix (VMs made before it)', async () => {
    const legacy = VM + 'harn7-1793380000-ab12cd34';
    const check = VM + 'harn7-1793382975-pr140';
    const suffixed = VM + 'harn7-1793390000-0a1b2c3d-t13';
    reset([`eu-central-h1 ${legacy}`, `eu-central-h1 ${check}`, `eu-central-h1 ${suffixed}`, 'eu-central-h1 ' + VM + 'harn13-1793378048-74375ba1-t13', 'eu-central-h1 ' + VM + '1793300000-deadbeef']);
    const list = await runner(['list', '--mine'], { UBI_OWNER: OWNER });
    expect(list.exit).toBe(0);
    expect(list.stdout).toBe(`eu-central-h1  ${legacy}\neu-central-h1  ${check}\neu-central-h1  ${suffixed}\n`);
    for (const name of [legacy, check, suffixed]) {
      const down = await runner(['down', name], { UBI_OWNER: OWNER });
      expect(down.exit).toBe(0);
      expect(down.lines).toEqual([`ubi-runner: destroy requested: eu-central-h1/${name}`, `ubi-runner: destroyed eu-central-h1/${name}`]);
    }
    expect(api.calls.filter((c) => c[2] === 'destroy').map((c) => c[1])).toEqual([legacy, check, suffixed].map((n) => `eu-central-h1/${n}`));
  }, 60_000);
});

// run-shard.sh against a fake runner (UBI_RUNNER) that records the UBI_TTL_HOURS its up sees and then fails the create, so
// the script stops at "VM creation failed" (exit 3) after the TTL decision; ttl goes to the real runner.
function shard(args: string[], env: Record<string, string> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ubi-shard-ttl-')));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
    const calls = join(dir, 'calls');
    const fake = join(dir, 'ubi-runner.sh');
    writeFileSync(fake, ['#!/usr/bin/env bash', `case $1 in ttl) exec bash "${RUNNER}" ttl ;; up) echo "up UBI_TTL_HOURS=\${UBI_TTL_HOURS-unset}" >> "${calls}"; exit 1 ;; owner) echo harn7 ;; *) echo "$1" >> "${calls}" ;; esac`].join('\n') + '\n');
    chmodSync(fake, 0o755);
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'ttl-test', cells: [] }));
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', join(dir, 'dest'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', HOME: dir, UBI_RUNNER: fake, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: OWNER, UBICLOUD_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER, ...env },
    });
    return { exit: r.status, stderr: r.stderr, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trimEnd().split('\n') : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ubicloud/run-shard.sh TTL', () => {
  test('up gets --timeout-hours plus 1 (13 by default), or an inherited UBI_TTL_HOURS that outlives the shard', () => {
    for (const [args, env, want] of [[[], {}, '13'], [['--timeout-hours', '5'], {}, '6'], [[], { UBI_TTL_HOURS: '20' }, '20'], [[], { UBI_TTL_HOURS: '12.5' }, '12.5']] as const) {
      const r = shard([...args], { ...env });
      expect(r.exit).toBe(3);
      expect(r.calls[0]).toBe(`up UBI_TTL_HOURS=${want}`);
    }
  }, 120_000);

  test('--attach to a VM whose TTL ends within half an hour stops the shard and copies back instead of polling on', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ubi-shard-attach-')));
    try {
      const calls = join(dir, 'calls');
      const fake = join(dir, 'ubi-runner.sh');
      writeFileSync(fake, ['#!/usr/bin/env bash', `echo "$1" >> "${calls}"`, 'case $1 in ssh) cat >/dev/null; echo "::trials 0" ;; pull) mkdir -p "$4/$(basename "$3")" ;; owner) echo harn7 ;; esac'].join('\n') + '\n');
      chmodSync(fake, 0o755);
      const dest = join(dir, 'dest');
      mkdirSync(dest);
      const vm = `ubirun-harn7-${Math.floor(Date.now() / 1000) - 2 * 3600}-ab12cd34-t2`;
      writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ vm, size: 'standard-16', name: 's1' }));
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), '--attach', '--dest', dest, '--poll-seconds', '1'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env.PATH ?? '', HOME: dir, UBI_RUNNER: fake, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: OWNER, UBICLOUD_API_KEY: PLACEHOLDER },
      });
      expect(r.status).toBe(3);
      const lane = readFileSync(join(dest, 'lane.log'), 'utf8');
      expect(lane).toMatch(new RegExp(`${vm}'s TTL ends at \\S+; the shard is stopped by \\S+ so its results come back first`));
      expect(lane).toContain('timeout after 12 h; stopping the shard');
      expect(readFileSync(calls, 'utf8')).toContain('down');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('an inherited UBI_TTL_HOURS that does not outlive the shard, or a bad --timeout-hours, exits 2 before the VM', () => {
    const short = shard([], { UBI_TTL_HOURS: '12' });
    expect(short.exit).toBe(2);
    expect(short.stderr.trimEnd()).toBe('run-shard (ubicloud): UBI_TTL_HOURS=12 gives the VM a 12h TTL, which would let the reaper destroy it before --timeout-hours 12 runs out; unset it or set it above 12');
    expect(short.calls).toEqual([]);
    for (const bad of ['0', '1.5', 'abc', '999']) {
      const r = shard(['--timeout-hours', bad]);
      expect(r.exit).toBe(2);
      expect(r.stderr.trimEnd()).toBe('run-shard (ubicloud): --timeout-hours must be a whole number of hours from 1 to 998');
      expect(r.calls).toEqual([]);
    }
  }, 120_000);
});
