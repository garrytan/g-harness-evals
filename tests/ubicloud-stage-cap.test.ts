// internal-task-a pilot amendment lane gates (internal-task-b; internal-task-c's list for #294's open notes t4#1, t4#2, fc3#3 and fc4#3).
// Keyless: a fake ubi-runner.sh (UBI_RUNNER) records every call and a fake run-shard.sh beside a copy of fanout.sh records
// every launch, so no VM, no ssh and no spend. A launch a guard lets through meets a VM create that fails at once.
//
// Value: protects=(a) a fan-out whose shard leases, with the leases an earlier launch of the stage started from the same
// dest, sum past the manifest's stage_cap_usd exits 2 before any VM call, and a qm-driver fan-out without a stage cap is
// refused; (b) fanout.sh refuses the whole fan-out when any shard's shard-vm.json names a VM whose cleanup is not done;
// (c) run-shard.sh --resume needs shard-vm.json with cleanup done; (d) the live-VM refusal says to run --attach first;
// (e) every command in that refusal pastes into bash; (f) the cap sums every lease in each shard's append-only leases.jsonl,
// reads --resume only before "--", and a fan-out reserves its leases under a dest lock; fails_when=an over-cap stage
// launches, a qm-driver manifest skips the cap, a good shard launches beside a live VM, a resume uploads a mid-run ledger,
// a hint is a bash syntax error, a relaunch or a workload --resume drops an earlier lease, or two fan-outs share a budget;
// seam=UBI_RUNNER and a fake run-shard.sh; no_claim=a real VM, ssh or ledger.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const UBI = join(ROOT, 'scripts', 'ubicloud');
const PLACEHOLDER = 'placeholder-not-a-key';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const script = (f: string, body: string) => { writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(f, 0o755); };
const env = (dir: string, runner: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: PLACEHOLDER, ANTHROPIC_API_KEY: PLACEHOLDER, TMPDIR: dir });

type Shard = { name: string; cells: string; lease_usd: unknown; args?: string[] };
// seedLeases writes <dest>/<shard>/leases.jsonl lines; dest reuses an earlier fan-out's dest; the fake run-shard.sh records
// the UBI_LEASE_RESERVATION it was given. The scratch preregistration carries run_id and caps_usd (caps, or the manifest's
// cap as caps_usd.main), and a qm-driver fan-out gets --replicate-to (replica, or its own folder; null for none), where
// the stage ledger lives.
function fanout(o: { shards: Shard[]; cap?: unknown; workload?: string; options?: string[]; seed?: Record<string, object>; seedLeases?: Record<string, object[]>; dest?: string; extraEnv?: Record<string, string>; caps?: Record<string, number>; replica?: string | null }) {
  const dir = tmp('he-fanout-cap-');
  copyFileSync(join(UBI, 'fanout.sh'), join(dir, 'fanout.sh'));
  copyFileSync(join(UBI, 'prune-pending.sh'), join(dir, 'prune-pending.sh'));
  copyFileSync(join(UBI, 'stage_ledger.py'), join(dir, 'stage_ledger.py'));
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'stage-test', caps_usd: o.caps ?? (typeof o.cap === 'number' ? { main: o.cap } : {}) }));
  const replica = o.replica === undefined ? (o.workload === 'qm-driver' ? join(dir, 'replica') : null) : o.replica;
  script(join(dir, 'run-shard.sh'), 'echo "$* reservation=${UBI_LEASE_RESERVATION:-}" >> ' + JSON.stringify(join(dir, 'launched')) + '\nexit 0');
  script(join(dir, 'ubi-runner.sh'), 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\ncase $1 in usage) echo "total 0 0" ;; esac');
  const dest = o.dest ?? join(dir, 'dest');
  for (const [name, vm] of Object.entries(o.seed ?? {})) { mkdirSync(join(dest, name), { recursive: true }); writeFileSync(join(dest, name, 'shard-vm.json'), JSON.stringify(vm)); }
  for (const [name, rows] of Object.entries(o.seedLeases ?? {})) { mkdirSync(join(dest, name), { recursive: true }); writeFileSync(join(dest, name, 'leases.jsonl'), rows.map((x) => JSON.stringify(x) + '\n').join('')); }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), prereg: join(dir, 'prereg.json'), dest, options: o.options ?? [], ...(o.cap !== undefined ? { stage_cap_usd: o.cap } : {}), shards: o.shards }));
  const r = spawnSync('bash', [join(dir, 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), ...(o.workload ? ['--workload', o.workload] : []), ...(replica ? ['--replicate-to', replica] : [])], { encoding: 'utf8', timeout: 60_000, env: { ...env(dir, join(dir, 'ubi-runner.sh')), ...(o.extraEnv ?? {}) } });
  return { code: r.status, err: r.stderr, dest, replica, runner: join(dir, 'ubi-runner.sh'), calls: read(join(dir, 'calls')), launched: read(join(dir, 'launched')).split('\n').filter(Boolean) };
}
const qm = (name: string, lease: unknown): Shard => ({ name, cells: name, lease_usd: lease, args: ['--stage', 'main', '--shards', '8'] });

describe('(a) fanout.sh enforces the stage cap before any VM call', () => {
  test('an over-cap qm-driver manifest is refused before any VM call, the quota read included', () => {
    const r = fanout({ workload: 'qm-driver', cap: 520, shards: Array.from({ length: 8 }, (_, i) => qm('m' + i, 66)) });
    expect(r.code).toBe(2);
    expect(r.err).toContain('refused before any VM call: the shard leases sum to $528, above the stage cap of $520 (stage_cap_usd)');
    expect(r.calls).toBe('');
    expect(r.launched).toEqual([]);
  }, 60_000);

  test('a stage at its cap launches every shard', () => {
    const r = fanout({ workload: 'qm-driver', cap: 130, shards: [qm('m0', 65), qm('m1', 65)] });
    expect(r.code, r.err).toBe(0);
    expect(r.launched.length).toBe(2);
  }, 60_000);

  test('a qm-driver manifest without stage_cap_usd, or with a lease that is not a number, is refused before any VM call', () => {
    const none = fanout({ workload: 'qm-driver', shards: [qm('m0', 5)] });
    expect(none.code).toBe(2);
    expect(none.err).toContain('--workload qm-driver needs "stage_cap_usd" in the manifest');
    const text = fanout({ workload: 'qm-driver', cap: 10, shards: [qm('m0', '5')] });
    expect(text.code).toBe(2);
    expect(text.err).toContain('every lease_usd must be a number above 0 (not m0)');
    for (const r of [none, text]) { expect(r.calls).toBe(''); expect(r.launched).toEqual([]); }
  }, 60_000);

  test('a canary launched earlier from the same dest counts: the rest of the stage is refused when the sum passes the cap', () => {
    const seed = { canary: { vm: 'vmC', cleanup: 'done', launched_at: '2026-11-07T00:00:00Z', lease_usd: 65 } };
    const over = fanout({ workload: 'qm-driver', cap: 195, seed, shards: [qm('m0', 66), qm('m1', 66)] });
    expect(over.code).toBe(2);
    expect(over.err).toContain('the shard leases sum to $132 plus $65 launched earlier from ' + over.dest + ' (canary), above the stage cap of $195');
    expect(over.calls).toBe('');
    expect(over.launched).toEqual([]);
    const fits = fanout({ workload: 'qm-driver', cap: 195, seed, shards: [qm('m0', 65), qm('m1', 65)] });
    expect(fits.code, fits.err).toBe(0);
    expect(fits.launched.length).toBe(2);
  }, 60_000);

  test('a shard relaunched without --resume keeps its earlier lease in the sum; with --resume it counts once', () => {
    const seed = { m0: { vm: 'vm0', cleanup: 'done', launched_at: '2026-11-07T00:00:00Z', lease_usd: 6 } };
    const fresh = fanout({ workload: 'qm-driver', cap: 10, seed, shards: [qm('m0', 6)] });
    expect(fresh.code).toBe(2);
    expect(fresh.err).toContain('the shard leases sum to $6 plus $6 launched earlier');
    const resumed = fanout({ workload: 'qm-driver', cap: 10, seed, options: ['--resume'], shards: [qm('m0', 6)] });
    expect(resumed.code, resumed.err).toBe(0);
    expect(resumed.launched.length).toBe(1);
  }, 60_000);

  test('a harness manifest with stage_cap_usd is checked the same way; one without it is unchanged', () => {
    const over = fanout({ cap: 5, shards: [{ name: 'a', cells: 'c1', lease_usd: 3 }, { name: 'b', cells: 'c2', lease_usd: 3 }] });
    expect(over.code).toBe(2);
    expect(over.err).toContain('the shard leases sum to $6, above the stage cap of $5');
    expect(over.calls).toBe('');
    const plain = fanout({ shards: [{ name: 'a', cells: 'c1', lease_usd: 3 }, { name: 'b', cells: 'c2', lease_usd: 3 }] });
    expect(plain.code, plain.err).toBe(0);
    expect(plain.launched.length).toBe(2);
  }, 60_000);
});

describe('(a) the stage cap counts every lease a dest started, and fan-outs reserve under a lock (fix round, 2026-11-07)', () => {
  const at = (h: number) => '2026-11-07T0' + h + ':00:00Z';
  test('every earlier launch of a shard counts after repeated fresh relaunches, and after shard-vm.json is moved aside', () => {
    const relaunched = fanout({ workload: 'qm-driver', cap: 18, seed: { m0: { vm: 'vmC', cleanup: 'done', launched_at: at(2), lease_usd: 5 } },
      seedLeases: { m0: [0, 1, 2].map((h) => ({ lease_usd: 5, launched_at: at(h), vm: 'vm' + h, resume: false })) }, shards: [qm('m0', 5)] });
    expect(relaunched.code).toBe(2);
    expect(relaunched.err).toContain('the shard leases sum to $5 plus $15 launched earlier');
    expect(relaunched.calls).toBe('');
    const movedAside = fanout({ workload: 'qm-driver', cap: 8, seedLeases: { old: [{ lease_usd: 4, launched_at: at(0), vm: 'vmOld', resume: false }] }, shards: [qm('m1', 5)] });
    expect(movedAside.code).toBe(2);
    expect(movedAside.err).toContain('the shard leases sum to $5 plus $4 launched earlier from ' + movedAside.dest + ' (old)');
    const resumedOnce = fanout({ workload: 'qm-driver', cap: 5, options: ['--resume'], seedLeases: { m0: [{ lease_usd: 5, launched_at: at(0), vm: 'vm0', resume: false }, { lease_usd: 5, launched_at: at(1), vm: 'vm1', resume: true }] }, shards: [qm('m0', 5)] });
    expect(resumedOnce.code, resumedOnce.err).toBe(0);
  }, 60_000);

  test('a --resume after "--" is a workload argument, so the earlier lease still counts', () => {
    const seed = { m0: { vm: 'vm0', cleanup: 'done', launched_at: at(0), lease_usd: 6 } };
    const r = fanout({ workload: 'qm-driver', cap: 10, seed, options: ['--', '--resume'], shards: [qm('m0', 6)] });
    expect(r.code).toBe(2);
    expect(r.err).toContain('the shard leases sum to $6 plus $6 launched earlier');
    expect(r.launched).toEqual([]);
  }, 60_000);

  test('a fan-out reserves its leases before any launch, so a second fan-out on the same dest counts them', () => {
    const first = fanout({ workload: 'qm-driver', cap: 10, shards: [qm('m0', 6)] });
    expect(first.code, first.err).toBe(0);
    const rows = read(join(first.dest, 'm0', 'leases.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ lease_usd: 6 });
    expect(typeof rows[0].reservation).toBe('string');
    expect(first.launched[0]).toContain('reservation=' + rows[0].reservation);
    const second = fanout({ workload: 'qm-driver', cap: 10, dest: first.dest, shards: [qm('m1', 6)] });
    expect(second.code).toBe(2);
    expect(second.err).toContain('the shard leases sum to $6 plus $6 launched earlier from ' + first.dest + ' (m0)');
    expect(second.launched).toEqual([]);
  }, 60_000);

  test('a fan-out refuses when another holds the dest stage lock past UBI_STAGE_LOCK_SECONDS', async () => {
    const dest = join(tmp('he-fanout-lock-'), 'dest');
    mkdirSync(dest, { recursive: true });
    const holder = Bun.spawn(['flock', join(dest, '.stage-cap.lock'), 'sleep', '30'], { stdout: 'ignore', stderr: 'ignore' });
    try {
      for (let i = 0; i < 50 && !existsSync(join(dest, '.stage-cap.lock')); i++) await Bun.sleep(100);
      await Bun.sleep(300);
      const r = fanout({ workload: 'qm-driver', cap: 10, dest, extraEnv: { UBI_STAGE_LOCK_SECONDS: '1' }, shards: [qm('m0', 1)] });
      expect(r.code).toBe(2);
      expect(r.err).toContain('holds the stage lock');
      expect(r.launched).toEqual([]);
    } finally { holder.kill(); }
  }, 60_000);
});

describe('(b) fanout.sh refuses the whole fan-out over a shard whose VM was never cleaned up', () => {
  test('the fan-out refusal offers the move-aside fallback only after --attach, and its commands paste into bash', () => {
    const r = fanout({ shards: [{ name: 'live', cells: 'c2', lease_usd: 1 }], seed: { live: { vm: 'vmLive', cleanup: 'pending', launched_at: '2026-11-07T00:00:00Z' } } });
    expect(r.code).toBe(2);
    const shardVm = join(r.dest, 'live', 'shard-vm.json');
    expect(r.err.indexOf('Only if the attach cannot reach the VM')).toBeGreaterThan(r.err.indexOf('--attach --dest ' + join(r.dest, 'live')));
    expect(r.err).toContain('move ' + shardVm + ' aside');
    const list = r.err.slice(r.err.indexOf('The list: ') + 'The list: '.length).split('\n')[0]!.trim();
    expect(list).toBe('bash ' + r.runner + ' list');
    const attach = r.err.slice(r.err.indexOf('The attach: ') + 'The attach: '.length).split('. ')[0]!.trim();
    for (const c of [list, attach]) expect(spawnSync('bash', ['-n', '-c', c], { encoding: 'utf8' }).status, c).toBe(0);
  }, 60_000);

  test('a good shard is not launched beside a shard whose shard-vm.json names a live VM; cleanup done lets both launch', () => {
    for (const cleanup of ['pending', 'failed']) {
      const r = fanout({ shards: [{ name: 'good', cells: 'c1', lease_usd: 1 }, { name: 'live', cells: 'c2', lease_usd: 1 }], seed: { live: { vm: 'vmLive', cleanup, launched_at: '2026-11-07T00:00:00Z' } } });
      expect(r.code).toBe(2);
      expect(r.err).toContain('refused: ' + join(r.dest, 'live', 'shard-vm.json') + ' names a VM (vmLive) whose cleanup is not done');
      expect(r.err).toContain('Run --attach first');
      expect(r.err).toContain('run-shard.sh --attach --dest ' + join(r.dest, 'live'));
      expect(r.launched).toEqual([]);
      expect(r.calls.split('\n').filter(Boolean).every((c) => c === 'usage')).toBe(true);
    }
    const done = fanout({ shards: [{ name: 'good', cells: 'c1', lease_usd: 1 }, { name: 'live', cells: 'c2', lease_usd: 1 }], seed: { live: { vm: 'vmLive', cleanup: 'done' } } });
    expect(done.code, done.err).toBe(0);
    expect(done.launched.length).toBe(2);
  }, 60_000);
});

// run-shard.sh against a dest prepared by the caller. With a repo copy (proceed), the lane scripts are committed in a
// throwaway repository so --commit HEAD resolves, and VM creation fails at once.
function runShard(o: { shardVm?: object; args: string[]; proceed?: boolean }) {
  const dir = tmp('he-ubi-resume-gate-');
  const runner = join(dir, 'ubi-runner.sh');
  script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
  const dest = join(dir, 'dest');
  mkdirSync(join(dest, 'results'), { recursive: true });
  writeFileSync(join(dest, 'results', 'shard.json'), JSON.stringify({ name: 's1' }));
  if (o.shardVm) writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify(o.shardVm));
  const prereg = join(dir, 'prereg.json');
  writeFileSync(prereg, JSON.stringify({ run_id: 'gate-test', cells: [{ id: 'c1', harness: 'hermes' }] }));
  let scriptDir = UBI;
  if (o.proceed) {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts', 'prune-pending.sh']) copyFileSync(join(UBI, f), join(repo, 'scripts', 'ubicloud', f));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
    scriptDir = join(repo, 'scripts', 'ubicloud');
  }
  const r = spawnSync('bash', [join(scriptDir, 'run-shard.sh'), '--commit', 'HEAD', '--prereg', prereg, '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', dest, ...o.args],
    { cwd: o.proceed ? dir : ROOT, encoding: 'utf8', timeout: 60_000, env: env(dir, runner), stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, err: r.stderr, dest, runner, calls: read(join(dir, 'calls')).split('\n').filter(Boolean) };
}

describe('(c) run-shard.sh --resume needs shard-vm.json with cleanup done', () => {
  test('a --resume with no shard-vm.json, or one whose cleanup is not done, is refused before any VM call', () => {
    for (const shardVm of [undefined, { cleanup: 'pending' }, { name: 's1', cleanup_reason: null }]) {
      const r = runShard({ shardVm, args: ['--resume'] });
      expect(r.code).toBe(2);
      expect(r.err).toContain('refused: --resume needs ' + r.dest + '/shard-vm.json with cleanup "done"');
      expect(r.err).toContain('--attach --dest ' + r.dest);
      expect(r.calls).toEqual([]);
    }
  }, 60_000);

  test('a --resume after a teardown that recorded cleanup done goes ahead to VM creation (which fails at once here)', () => {
    const r = runShard({ shardVm: { name: 's1', vm: 'vmOld', cleanup: 'done' }, args: ['--resume'], proceed: true });
    expect(r.err).not.toContain('refused');
    expect(r.calls[0]?.split(' ')[0]).toBe('up');
    expect(r.code).toBe(3);
  }, 60_000);
});

describe('(d, e) the live-VM refusal says --attach first, and its commands paste into bash', () => {
  const live = () => runShard({ shardVm: { name: 's1', vm: 'vmLive', cleanup: 'pending' }, args: [] });

  test('the refusal names --attach as the first step, before any move of shard-vm.json and before a --resume', () => {
    const r = live();
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.err).toContain('Run --attach first');
    expect(r.err).toContain('then a launch or a --resume can go ahead');
    expect(r.err.indexOf('--attach --dest ' + r.dest)).toBeLessThan(r.err.indexOf('move ' + r.dest + '/shard-vm.json aside'));
    expect(r.err.indexOf('Only if the attach cannot reach the VM')).toBeGreaterThan(r.err.indexOf('--attach --dest'));
  }, 60_000);

  test('every command in the refusal is valid bash as written (the old "list (every owner)" hint was not)', () => {
    const r = live();
    const commands = r.err.trim().split(/\. |; /).flatMap((part) => {
      const at = ['bash ', 'scripts/ubicloud/run-shard.sh '].map((w) => part.indexOf(w)).filter((i) => i >= 0);
      return at.length ? [part.slice(Math.min(...at)).trim()] : [];
    });
    expect(commands).toContain('bash ' + r.runner + ' list');
    expect(commands).toContain('scripts/ubicloud/run-shard.sh --attach --dest ' + r.dest);
    for (const c of commands) expect(spawnSync('bash', ['-n', '-c', c], { encoding: 'utf8' }).status, c).toBe(0);
  }, 60_000);
});

// A one-off qm-driver run-shard.sh launch from a throwaway repository holding the lane scripts (so --commit HEAD resolves),
// with the scratch preregistration's run_id and caps_usd and --replicate-to replica; VM creation fails at once.
// dest may be a function of the scratch directory, which is also the launch's working directory (for a relative dest).
function qmShard(o: { replica: string | null; lease: number; name?: string; stage?: string; reservation?: string; caps?: Record<string, number>; dest?: string | ((dir: string) => string) }) {
  const dir = tmp('he-ubi-stage-ledger-');
  const runner = join(dir, 'ubi-runner.sh');
  script(runner, 'echo "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1');
  const prereg = join(dir, 'prereg.json');
  writeFileSync(prereg, JSON.stringify({ run_id: 'stage-test', caps_usd: o.caps ?? { main: 520 } }));
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts', 'prune-pending.sh', 'stage_ledger.py']) copyFileSync(join(UBI, f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  const dest = typeof o.dest === 'function' ? o.dest(dir) : o.dest ?? join(dir, o.name ?? 'oneoff');
  const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', prereg, '--name', o.name ?? 'oneoff', '--cells', 'opus.b1', '--lease-usd', String(o.lease), '--dest', dest,
    '--workload', 'qm-driver', ...(o.replica ? ['--replicate-to', o.replica] : []), '--', '--stage', o.stage ?? 'main', '--shards', '8'],
    { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...env(dir, runner), ...(o.reservation ? { UBI_LEASE_RESERVATION: o.reservation } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, err: r.stderr, dest, calls: read(join(dir, 'calls')).split('\n').filter(Boolean) };
}
const ledgerRows = (replica: string) => read(join(replica, 'stage-ledger.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('(g) the stage ledger holds a stage cap across dests and one-off run-shard.sh launches (2026-11-07)', () => {
  test('a stage split across two dests is summed in the replica folder: the second half is refused past the cap', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const canary = fanout({ workload: 'qm-driver', cap: 520, replica, shards: [qm('m0', 65)] });
    expect(canary.code, canary.err).toBe(0);
    const rest = fanout({ workload: 'qm-driver', cap: 520, replica, shards: Array.from({ length: 7 }, (_, i) => qm('m' + (i + 1), 66)) });
    expect(rest.dest).not.toBe(canary.dest);
    expect(rest.code).toBe(2);
    expect(rest.err).toContain('fanout: refused before any VM call: the leases sum to $462 plus $65 launched earlier (' + join(canary.dest, 'm0') + ') for run stage-test stage main');
    expect(rest.err).toContain('above the preregistered stage cap of $520 (caps_usd.main)');
    expect(rest.calls).toBe('');
    expect(rest.launched).toEqual([]);
    const fits = fanout({ workload: 'qm-driver', cap: 520, replica, shards: Array.from({ length: 7 }, (_, i) => qm('m' + (i + 1), 65)) });
    expect(fits.code, fits.err).toBe(0);
    expect(fits.launched.length).toBe(7);
    const rows = ledgerRows(replica);
    expect(rows.length).toBe(8);
    expect(rows.every((x) => x.run_id === 'stage-test' && x.stage === 'main' && x.by === 'fanout.sh')).toBe(true);
    expect(rows.reduce((s, x) => s + x.lease_usd, 0)).toBe(520);
  }, 60_000);

  test('another stage of the same run, or another run, has its own sum', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    expect(fanout({ workload: 'qm-driver', cap: 45, caps: { main: 520, forced: 45 }, replica, shards: [{ ...qm('f0', 45), args: ['--stage', 'forced', '--shards', '1'] }] }).code).toBe(0);
    const main = fanout({ workload: 'qm-driver', cap: 520, caps: { main: 520, forced: 45 }, replica, shards: [qm('m0', 520)] });
    expect(main.code, main.err).toBe(0);
  }, 60_000);

  test('a one-off run-shard.sh launch into a new dest is refused before any VM call once the stage is spent', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const stage = fanout({ workload: 'qm-driver', cap: 520, replica, shards: Array.from({ length: 8 }, (_, i) => qm('m' + i, 65)) });
    expect(stage.code, stage.err).toBe(0);
    const r = qmShard({ replica, lease: 1 });
    expect(r.code).toBe(2);
    expect(r.err).toContain('run-shard (ubicloud): refused before any VM call: the leases sum to $1 plus $520 launched earlier');
    expect(r.calls).toEqual([]);
  }, 60_000);

  test('a one-off launch that fits reserves its lease in the stage ledger before the VM call, and the next one counts it', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const first = qmShard({ replica, lease: 300, name: 'one' });
    expect(first.err).not.toContain('refused');
    expect(first.calls[0]?.split(' ')[0]).toBe('up');
    const rows = ledgerRows(replica);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ run_id: 'stage-test', stage: 'main', dest: first.dest, lease_usd: 300, by: 'run-shard.sh', resume: false });
    expect(typeof rows[0].reservation).toBe('string');
    const second = qmShard({ replica, lease: 221, name: 'two' });
    expect(second.code).toBe(2);
    expect(second.err).toContain('the leases sum to $221 plus $300 launched earlier (' + first.dest + ')');
    expect(second.calls).toEqual([]);
  }, 60_000);

  test('a launch carrying its fan-out\'s reservation for its dest goes ahead, and the reservation counts once', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const fan = fanout({ workload: 'qm-driver', cap: 520, replica, shards: [qm('m0', 520)] });
    expect(fan.code, fan.err).toBe(0);
    const rid = fan.launched[0]!.split('reservation=')[1]!;
    const r = qmShard({ replica, lease: 520, dest: join(fan.dest, 'm0'), name: 'm0', reservation: rid });
    expect(r.err).not.toContain('refused');
    expect(r.calls[0]?.split(' ')[0]).toBe('up');
    expect(ledgerRows(replica).length).toBe(1);
    const elsewhere = qmShard({ replica, lease: 520, reservation: rid });
    expect(elsewhere.code).toBe(2);
    expect(elsewhere.err).toContain('UBI_LEASE_RESERVATION ' + rid + ' is not a reservation of $520 or more for ' + elsewhere.dest);
  }, 60_000);

  test('a relative or symlinked dest still finds its fan-out reservation, and the stage counts the lease once', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const fan = fanout({ workload: 'qm-driver', cap: 520, replica, shards: [qm('m0', 520)] });
    expect(fan.code, fan.err).toBe(0);
    const rid = fan.launched[0]!.split('reservation=')[1]!;
    const real = join(fan.dest, 'm0');
    const viaRelative = qmShard({ replica, lease: 520, name: 'm0', reservation: rid, dest: (dir) => relative(dir, real) });
    expect(viaRelative.err).not.toContain('refused');
    expect(viaRelative.calls[0]?.split(' ')[0]).toBe('up');
    const viaLink = qmShard({ replica, lease: 520, name: 'm0', reservation: rid, dest: (dir) => { symlinkSync(real, join(dir, 'link')); return join(dir, 'link'); } });
    expect(viaLink.err).not.toContain('refused');
    expect(viaLink.calls[0]?.split(' ')[0]).toBe('up');
    expect(ledgerRows(replica).length).toBe(1);
    const oneOff = qmShard({ replica, lease: 1, dest: (dir) => { symlinkSync(real, join(dir, 'again')); return 'again'; } });
    expect(oneOff.code).toBe(2);
    expect(oneOff.err).toContain('the leases sum to $1 plus $520 launched earlier (' + real + ')');
  }, 60_000);

  test('a launch naming a reservation the stage ledger lacks for its dest is refused, and qm-driver needs --replicate-to', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const forged = qmShard({ replica, lease: 5, reservation: 'made-up' });
    expect(forged.code).toBe(2);
    expect(forged.err).toContain('UBI_LEASE_RESERVATION made-up is not a reservation of $5 or more for ' + forged.dest);
    expect(forged.calls).toEqual([]);
    const none = qmShard({ replica: null, lease: 5 });
    expect(none.code).toBe(2);
    expect(none.err).toContain('--workload qm-driver needs --replicate-to');
    expect(none.calls).toEqual([]);
    const fan = fanout({ workload: 'qm-driver', cap: 10, replica: null, shards: [qm('m0', 5)] });
    expect(fan.code).toBe(2);
    expect(fan.err).toContain('--workload qm-driver needs --replicate-to');
    expect(fan.calls).toBe('');
  }, 60_000);
});

describe('(h) a qm-driver stage cap is the preregistered cap of the one --stage its shards run (2026-11-07)', () => {
  test('a stage_cap_usd other than caps_usd for the shards\' --stage is refused before any VM call', () => {
    const r = fanout({ workload: 'qm-driver', cap: 500, caps: { main: 520 }, shards: [qm('m0', 65)] });
    expect(r.code).toBe(2);
    expect(r.err).toContain('fanout: stage_cap_usd $500 is not the preregistered cap of --stage main, caps_usd.main = $520');
    expect(r.calls).toBe('');
    expect(r.launched).toEqual([]);
    const wrongStage = fanout({ workload: 'qm-driver', cap: 520, caps: { main: 520, forced: 45 }, shards: [{ ...qm('f0', 5), args: ['--stage', 'forced', '--shards', '1'] }] });
    expect(wrongStage.code).toBe(2);
    expect(wrongStage.err).toContain('stage_cap_usd $520 is not the preregistered cap of --stage forced, caps_usd.forced = $45');
    expect(wrongStage.launched).toEqual([]);
  }, 60_000);

  test('shards that disagree on --stage, a shard without --stage and a stage the preregistration has no cap for are refused', () => {
    const split = fanout({ workload: 'qm-driver', cap: 520, caps: { main: 520, forced: 45 }, shards: [qm('m0', 5), { ...qm('f0', 5), args: ['--stage', 'forced', '--shards', '1'] }] });
    expect(split.code).toBe(2);
    expect(split.err).toContain('the shards disagree on --stage (forced, main)');
    const bare = fanout({ workload: 'qm-driver', cap: 520, shards: [qm('m0', 5), { ...qm('m1', 5), args: ['--shards', '8'] }] });
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('every qm-driver shard needs --stage in its args');
    const uncapped = fanout({ workload: 'qm-driver', cap: 10, caps: { main: 520 }, shards: [{ ...qm('p0', 5), args: ['--stage', 'pilot', '--shards', '1'] }] });
    expect(uncapped.code).toBe(2);
    expect(uncapped.err).toContain('has no caps_usd entry for --stage pilot');
    for (const r of [split, bare, uncapped]) { expect(r.calls).toBe(''); expect(r.launched).toEqual([]); }
  }, 60_000);

  test('a one-off launch takes its cap from caps_usd for its --stage', () => {
    const replica = join(tmp('he-stage-replica-'), 'replica');
    const r = qmShard({ replica, lease: 46, stage: 'forced', caps: { main: 520, forced: 45 } });
    expect(r.code).toBe(2);
    expect(r.err).toContain('above the preregistered stage cap of $45 (caps_usd.forced)');
    expect(r.calls).toEqual([]);
  }, 60_000);
});
