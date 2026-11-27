// The gbrain first-run eval's mid-run pulls (run-shard.sh --incremental-pull): each pull copies only what changed on the
// shard VM since the last pull, so a shard of a few hundred trials is not copied back whole every 20 minutes. Keyless, no VM.
//
// Value: protects=ubi-runner.sh pull --since-mark copies every file on the first pull, then only files changed since the
// mark (by change time, so a backdated fixture file still comes back) plus every sqlite file and its journal, leaves out each --exclude path, and moves the mark only after a good
// extract of a complete listing (a folder find cannot read, or a listed file tar cannot read, keeps the old mark); fails_when=a second pull re-copies unchanged files, drops a ledger's -wal, brings back an excluded raw database,
// or moves the mark after a failed extract; why_new=the pull had no incremental mode; seam=a fake ssh on PATH that runs the
// remote command in a local folder; no_claim=a real VM or ssh.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('ubi-runner.sh pull --since-mark', () => {
  test('the first pull copies everything but the excluded paths, the next only what changed and the ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-since-'));
    dirs.push(dir);
    const remote = join(dir, 'vm-home');
    const results = join(remote, 'shard/results');
    const trial = join(results, 'trials/cc-opus-full/seed-0101/r1');
    const write = (p: string, body: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };
    write(join(trial, 'first-wow.json'), '{}');
    write(join(trial, 'state/.gbrain/brain.pglite.tgz'), 'packed');
    write(join(trial, 'state/AGENTS.md'), 'notes');
    write(join(results, 'trials/cc-opus-full/seed-0102/r1/state/.gbrain/brain.pglite/base/page'), 'raw');
    write(join(results, 'trials/cc-opus-full/seed-0102/r1/state/.bun/install/cache/pkg.js'), 'cache');
    write(join(results, 'ledger.sqlite'), 'db');
    write(join(results, 'ledger.sqlite-wal'), 'wal');
    write(join(results, 'trials.jsonl'), '{"trial_id":"a"}\n');
    const hourAgo = Date.now() / 1000 - 3600;
    for (const f of ['first-wow.json', 'state/.gbrain/brain.pglite.tgz', 'state/AGENTS.md']) utimesSync(join(trial, f), hourAgo, hourAgo);
    for (const f of ['ledger.sqlite', 'ledger.sqlite-wal', 'trials.jsonl']) utimesSync(join(results, f), hourAgo, hourAgo);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && HOME="$FAKE_VM_HOME" exec bash -c "${@: -1}"\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    const pull = (to: string) => spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', to,
      '--since-mark', 'shard/.pull-mark', '--exclude', '*/.gbrain/brain.pglite', '--exclude', '*/.bun/install/cache'], { encoding: 'utf8', env });

    Bun.sleepSync(6000);
    const first = join(dir, 'first');
    const r1 = pull(first);
    expect(r1.status, r1.stderr).toBe(0);
    const got1 = join(first, 'results');
    expect(readFileSync(join(got1, 'trials/cc-opus-full/seed-0101/r1/state/.gbrain/brain.pglite.tgz'), 'utf8')).toBe('packed');
    expect(existsSync(join(got1, 'trials/cc-opus-full/seed-0101/r1/first-wow.json'))).toBe(true);
    expect(existsSync(join(got1, 'trials.jsonl'))).toBe(true);
    expect(existsSync(join(got1, 'trials/cc-opus-full/seed-0102/r1/state/.gbrain/brain.pglite'))).toBe(false);
    expect(existsSync(join(got1, 'trials/cc-opus-full/seed-0102/r1/state/.bun/install/cache'))).toBe(false);
    expect(existsSync(join(remote, 'shard/.pull-mark'))).toBe(true);
    expect(existsSync(join(remote, 'shard/.pull-mark.next'))).toBe(false);

    write(join(results, 'trials/cc-opus-full/seed-0102/r1/first-wow.json'), '{"new":true}');
    write(join(results, 'trials/cc-opus-full/seed-0103/r1/home/history/session.jsonl'), 'backdated');
    utimesSync(join(results, 'trials/cc-opus-full/seed-0103/r1/home/history/session.jsonl'), 1577836800, 1577836800);
    const second = join(dir, 'second');
    const r2 = pull(second);
    expect(r2.status, r2.stderr).toBe(0);
    const got2 = join(second, 'results');
    expect(readFileSync(join(got2, 'trials/cc-opus-full/seed-0102/r1/first-wow.json'), 'utf8')).toBe('{"new":true}');
    expect(readFileSync(join(got2, 'trials/cc-opus-full/seed-0103/r1/home/history/session.jsonl'), 'utf8')).toBe('backdated');
    expect(readFileSync(join(got2, 'ledger.sqlite-wal'), 'utf8')).toBe('wal');
    expect(existsSync(join(got2, 'ledger.sqlite'))).toBe(true);
    expect(existsSync(join(got2, 'trials/cc-opus-full/seed-0101/r1/first-wow.json'))).toBe(false);
    expect(existsSync(join(got2, 'trials.jsonl'))).toBe(false);
  }, 30_000);

  test('a failed extract leaves the mark where it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-since-'));
    dirs.push(dir);
    const remote = join(dir, 'vm-home');
    mkdirSync(join(remote, 'shard/results'), { recursive: true });
    writeFileSync(join(remote, 'shard/results/trials.jsonl'), '{}\n');
    writeFileSync(join(remote, 'shard/.pull-mark'), '100\n');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && HOME="$FAKE_VM_HOME" exec bash -c "${@: -1}"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'tar'), '#!/usr/bin/env bash\nfor a; do [ "$a" = -xzf ] && { cat >/dev/null; exit 2; }; done\nexec /usr/bin/tar "$@"\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    const r = spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', join(dir, 'out'), '--since-mark', 'shard/.pull-mark'], { encoding: 'utf8', env });
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(remote, 'shard/.pull-mark'), 'utf8')).toBe('100\n');
  });

  test.skipIf(process.getuid?.() === 0)('a folder find cannot read keeps the mark where it was, so the next pull sends its files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-since-'));
    dirs.push(dir);
    const remote = join(dir, 'vm-home');
    const locked = join(remote, 'shard/results/trials/cc-opus-full/seed-0104/r1/state');
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, 'AGENTS.md'), 'notes');
    writeFileSync(join(remote, 'shard/results/trials.jsonl'), '{}\n');
    writeFileSync(join(remote, 'shard/.pull-mark'), '100\n');
    chmodSync(locked, 0o000);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && HOME="$FAKE_VM_HOME" exec bash -c "${@: -1}"\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    try {
      const r = spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', join(dir, 'out'), '--since-mark', 'shard/.pull-mark'], { encoding: 'utf8', env });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(dir, 'out/results/trials.jsonl'))).toBe(true);
      expect(readFileSync(join(remote, 'shard/.pull-mark'), 'utf8')).toBe('100\n');
      expect(existsSync(join(remote, 'shard/.pull-mark.next'))).toBe(false);
      expect(existsSync(join(remote, 'shard/.pull-mark.find'))).toBe(false);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test.skipIf(process.getuid?.() === 0)('a listed file tar cannot read keeps the mark where it was, so the next pull sends it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-since-'));
    dirs.push(dir);
    const remote = join(dir, 'vm-home');
    const trial = join(remote, 'shard/results/trials/cc-opus-full/seed-0105/r1');
    mkdirSync(trial, { recursive: true });
    writeFileSync(join(trial, 'first-wow.json'), '{}');
    writeFileSync(join(trial, 'root-owned.log'), 'written by the container user');
    writeFileSync(join(remote, 'shard/results/trials.jsonl'), '{}\n');
    writeFileSync(join(remote, 'shard/.pull-mark'), '100\n');
    chmodSync(join(trial, 'root-owned.log'), 0o000);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && HOME="$FAKE_VM_HOME" exec bash -c "${@: -1}"\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    try {
      for (let pull = 0; pull < 2; pull++) {
        const r = spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', join(dir, 'out'), '--since-mark', 'shard/.pull-mark'], { encoding: 'utf8', env });
        expect(r.status, r.stderr).toBe(0);
        expect(existsSync(join(dir, 'out/results/trials/cc-opus-full/seed-0105/r1/first-wow.json'))).toBe(true);
        expect(existsSync(join(dir, 'out/results/trials/cc-opus-full/seed-0105/r1/root-owned.log'))).toBe(false);
        expect(r.stderr).toContain('root-owned.log');
        expect(r.stderr).toContain('pull: mark kept');
        expect(readFileSync(join(remote, 'shard/.pull-mark'), 'utf8')).toBe('100\n');
        expect(existsSync(join(remote, 'shard/.pull-mark.next'))).toBe(false);
        expect(existsSync(join(remote, 'shard/.pull-mark.tar'))).toBe(false);
      }
    } finally {
      chmodSync(join(trial, 'root-owned.log'), 0o644);
    }
  });

  test('a listed file that vanishes before tar reads it is skipped and the mark still moves', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-since-'));
    dirs.push(dir);
    const remote = join(dir, 'vm-home');
    mkdirSync(join(remote, 'shard/results'), { recursive: true });
    writeFileSync(join(remote, 'shard/results/trials.jsonl'), '{}\n');
    writeFileSync(join(remote, 'shard/.pull-mark'), '100\n');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/usr/bin/env bash\ncd "$FAKE_VM_HOME" && HOME="$FAKE_VM_HOME" exec bash -c "${@: -1}"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'find'), '#!/usr/bin/env bash\n/usr/bin/find "$@"; rc=$?; printf \'results/ledger.sqlite-wal\\0\'; exit $rc\n', { mode: 0o755 });
    const state = join(dir, 'state');
    mkdirSync(join(state, 'vm1'), { recursive: true });
    writeFileSync(join(state, 'vm1/env'), 'IP=127.0.0.1\n');
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: dir, UBI_RUNNER_STATE: state, FAKE_VM_HOME: remote, UBICLOUD_API_KEY: 'placeholder-not-a-key' };
    const r = spawnSync('bash', [join(ROOT, 'scripts/ubicloud/ubi-runner.sh'), 'pull', 'vm1', 'shard/results', join(dir, 'out'), '--since-mark', 'shard/.pull-mark'], { encoding: 'utf8', env });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('Cannot stat');
    expect(r.stderr).not.toContain('pull: mark kept');
    expect(existsSync(join(dir, 'out/results/trials.jsonl'))).toBe(true);
    expect(readFileSync(join(remote, 'shard/.pull-mark'), 'utf8')).not.toBe('100\n');
    expect(existsSync(join(remote, 'shard/.pull-mark.next'))).toBe(false);
  });
});
