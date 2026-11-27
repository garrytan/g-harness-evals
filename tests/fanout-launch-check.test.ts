// scripts/ubicloud/fanout.sh's launch check (internal-task): a counted manifest launches a shard only on a launch-preflight.json
// that ran at the manifest's commit for that shard, says pass or overridden, and is under an hour old. fanout.sh runs from a
// fixture repository (so the manifest's prereg is a path at its commit, which is what makes it counted) beside a fake
// run-shard.sh and a fake ubi-runner.sh. No VM, no key.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FANOUT = join(import.meta.dir, '..', 'scripts', 'ubicloud', 'fanout.sh');

function script(file: string, body: string) {
  writeFileSync(file, '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(file, 0o755);
}

/** A fixture repository with fanout.sh and a committed prereg; the fake usage read runs `onUsage` (the moment between the
 *  up-front check and the launches). */
function repo(onUsage = '') {
  const dir = mkdtempSync(join(tmpdir(), 'he-fanout-check-'));
  const ubi = join(dir, 'scripts', 'ubicloud');
  mkdirSync(ubi, { recursive: true });
  copyFileSync(FANOUT, join(ubi, 'fanout.sh'));
  script(join(ubi, 'run-shard.sh'), 'name=$(sed -E "s/.*--name ([^ ]+).*/\\1/" <<<"$*"); echo "$name" >> "' + dir + '/started"; exit 0');
  script(join(dir, 'ubi-runner.sh'), onUsage + '\necho "total 0 0"');
  mkdirSync(join(dir, 'docs', 'run'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'run', 'prereg.json'), '{"run_id": "fixture"}\n');
  writeFileSync(join(dir, 'scratch-prereg.json'), '{"run_id": "scratch"}\n');
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: dir } }).stdout.trim();
  git('init', '-q');
  git('add', 'scripts', 'docs');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture');
  return { dir, commit: git('rev-parse', 'HEAD'), dest: join(dir, 'dest') };
}

function manifest(r: ReturnType<typeof repo>, over: Record<string, unknown> = {}) {
  const file = join(r.dir, 'fanout.json');
  writeFileSync(file, JSON.stringify({ commit: r.commit, prereg: 'docs/run/prereg.json', dest: r.dest, size: 'standard-16', shards: ['s1', 's2'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1 })), ...over }));
  return file;
}

function receipt(r: ReturnType<typeof repo>, shard: string, over: Record<string, unknown> = {}) {
  mkdirSync(join(r.dest, shard), { recursive: true });
  writeFileSync(join(r.dest, shard, 'launch-preflight.json'), JSON.stringify({ schema: 'launch-preflight/1', at: new Date().toISOString(), commit: r.commit, run_id: 'fixture', shard: { name: shard, cells: ['c-' + shard], lease_usd: 1 }, verdict: 'pass', ...over }));
}

function fanout(r: ReturnType<typeof repo>, file: string, args: string[] = ['--dry-run']) {
  return spawnSync('bash', [join(r.dir, 'scripts', 'ubicloud', 'fanout.sh'), '--manifest', file, ...args], { cwd: r.dir, encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: r.dir, UBI_OWNER: 'internal-task', UBI_RUNNER: join(r.dir, 'ubi-runner.sh') } });
}

describe("fanout.sh's launch check", () => {
  test('a counted manifest with no receipt is refused before any VM call, naming each shard and the command to run', () => {
    const r = repo('echo x >> "$(dirname "$0")/usage-calls"');
    try {
      const out = fanout(r, manifest(r));
      expect(out.status).toBe(2);
      expect(out.stderr).toContain('refused before any VM call');
      expect(out.stderr).toContain('s1: no ' + join(r.dest, 's1', 'launch-preflight.json'));
      expect(out.stderr).toContain('s2: no ');
      expect(out.stderr).toContain('bun scripts/launch-preflight.ts <plan folder> --manifest');
      expect(existsSync(join(r.dir, 'usage-calls'))).toBe(false);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  test('fresh passing or overridden receipts at the commit for each shard let it through', () => {
    const r = repo();
    try {
      receipt(r, 's1');
      receipt(r, 's2', { verdict: 'overridden' });
      const out = fanout(r, manifest(r));
      expect(out.stderr).not.toContain('refused');
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('--name s1');
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  test('a refused verdict, another commit, shard, run, cell list or lease, a stale receipt or one from the future is refused, each with its reason', () => {
    const r = repo();
    try {
      const old = new Date(Date.now() - 61 * 60_000).toISOString();
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ verdict: 'refused' }, 'verdict refused'],
        [{ commit: 'b'.repeat(40) }, "ran at commit bbbbbbbbbbbb, not the manifest's " + r.commit.slice(0, 12)],
        [{ shard: { name: 's2' } }, "checked shard 's2', not s1"],
        [{ at: old }, 'it is 61 minutes old (limit 60)'],
        [{ at: new Date(Date.now() + 3600_000).toISOString() }, 'is in the future'],
        [{ schema: 'other/1' }, "schema 'other/1', not launch-preflight/1"],
        [{ run_id: 'other-run' }, "checked run 'other-run', not the prereg's 'fixture'"],
        [{ shard: { name: 's1', cells: ['c-s1', 'c-extra'], lease_usd: 1 } }, "checked cells c-s1,c-extra, not the manifest's c-s1"],
        [{ shard: { name: 's1', cells: ['c-s1'], lease_usd: 5 } }, "checked a lease of 5, not the manifest's 1"],
        [{ shard: { name: 's1', cells: ['c-s1'], lease_usd: 1, gemini_cli_route: 'openrouter-fallback' } }, "checked Gemini CLI route openrouter-fallback, not the manifest's native"],
      ];
      receipt(r, 's2');
      for (const [over, why] of cases) {
        receipt(r, 's1', over);
        const out = fanout(r, manifest(r));
        expect(out.status, why).toBe(2);
        expect(out.stderr, why).toContain(why);
        expect(out.stderr, why).not.toContain('s2:');
      }
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  // Value: protects=a fetch of a commit the controller lacks cannot hang the fan-out before its first VM; fails_when=the git
  // fetch has no timeout and a stuck remote holds the controller; seam=origin at an ssh URL and a fake ssh on PATH that
  // sleeps; no_claim=a real remote.
  test('a fetch of a missing commit that hangs gives up after UBI_LAUNCH_FETCH_SECONDS', () => {
    const r = repo();
    try {
      const bin = join(r.dir, 'bin');
      mkdirSync(bin);
      script(join(bin, 'ssh'), 'sleep 30');
      spawnSync('git', ['remote', 'add', 'origin', 'ssh://fixture.invalid/repo.git'], { cwd: r.dir });
      const started = Date.now();
      const out = spawnSync('bash', [join(r.dir, 'scripts', 'ubicloud', 'fanout.sh'), '--manifest', manifest(r, { commit: 'c'.repeat(40) }), '--dry-run'], { cwd: r.dir, encoding: 'utf8', timeout: 60_000,
        env: { PATH: bin + ':' + (process.env.PATH ?? ''), HOME: r.dir, UBI_OWNER: 'internal-task', UBI_RUNNER: join(r.dir, 'ubi-runner.sh'), UBI_LAUNCH_FETCH_SECONDS: '2' } });
      expect(Date.now() - started).toBeLessThan(25_000);
      expect(out.stderr).toContain('fetching ' + 'c'.repeat(40) + ' for the launch check timed out');
      expect(out.stderr).toContain('launch check skipped: commit ' + 'c'.repeat(40) + ' is not in this repository');
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a scratch prereg, a keyless install check and the gstack-laneb workload are not counted, so no receipt is needed', () => {
    const r = repo();
    try {
      const scratch = fanout(r, manifest(r, { prereg: join(r.dir, 'scratch-prereg.json') }));
      expect(scratch.status).toBe(0);
      expect(scratch.stderr).toContain('launch check skipped');
      expect(fanout(r, manifest(r, { options: ['--install-check'] }), ['--dry-run', '--workload', 'frontier-harbor']).status).toBe(0);
      expect(fanout(r, manifest(r), ['--dry-run', '--workload', 'gstack-laneb']).status).toBe(0);
      expect(fanout(r, manifest(r), ['--dry-run', '--workload', 'frontier-harbor']).status).toBe(2);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  test('each shard is checked again as it launches: one whose receipt went stale after the up-front check is not launched', () => {
    const r = repo();
    try {
      receipt(r, 's1');
      receipt(r, 's2');
      script(join(r.dir, 'ubi-runner.sh'), `rm -f "${join(r.dest, 's2', 'launch-preflight.json')}"\necho "total 0 0"`);
      const out = fanout(r, manifest(r), []);
      expect(readFileSync(join(r.dir, 'started'), 'utf8').trim().split('\n')).toEqual(['s1']);
      expect(out.stderr).toContain('refused shard s2');
      expect(out.stderr).toContain('shard s2 not launched');
      expect(out.stdout).toMatch(/s2\s+c-s2\s+\?/);
      expect(out.status).toBe(1);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  test('a shard refused at launch does not end the fan-out: the shards behind it launch, and its stage-cap reservation is released', () => {
    const r = repo();
    try {
      for (const s of ['s1', 's2', 's3']) receipt(r, s);
      script(join(r.dir, 'ubi-runner.sh'), `rm -f "${join(r.dest, 's1', 'launch-preflight.json')}"\necho "total 0 0"`);
      const file = manifest(r, { stage_cap_usd: 10, shards: ['s1', 's2', 's3'].map((name) => ({ name, cells: 'c-' + name, lease_usd: 1 })) });
      const out = fanout(r, file, ['--parallel', '1']);
      expect(readFileSync(join(r.dir, 'started'), 'utf8').trim().split('\n')).toEqual(['s2', 's3']);
      expect(out.stderr).toContain('shard s1 not launched');
      expect(out.stderr).toContain('released the stage-cap reservation of s1, which never launched');
      const rows = readFileSync(join(r.dest, 's1', 'leases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(rows.at(-1)).toMatchObject({ reservation: rows[0].reservation, released: true, by: 'fanout.sh' });
      expect(out.stdout).toMatch(/s1\s+c-s1\s+\?/);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });

  test("an interrupt during a shard's launch check launches nothing more and releases the reservations of the shards left", () => {
    const r = repo();
    try {
      for (const s of ['s1', 's2']) receipt(r, s);
      const file = manifest(r, { stage_cap_usd: 10 });
      const shim = join(r.dir, 'shim');
      mkdirSync(shim);
      const python = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
      script(join(shim, 'python3'), `in=$(cat)\nif [ -n "\${5:-}" ] && grep -q launch-preflight.json <<<"$in" && [ ! -e "${r.dir}/signalled" ]; then touch "${r.dir}/signalled"; kill -TERM "$PPID"; fi\nexec "${python}" "$@" <<<"$in"`);
      const out = spawnSync('bash', [join(r.dir, 'scripts', 'ubicloud', 'fanout.sh'), '--manifest', file, '--parallel', '1'], { cwd: r.dir, encoding: 'utf8', timeout: 60_000,
        env: { PATH: shim + ':' + (process.env.PATH ?? ''), HOME: r.dir, UBI_OWNER: 'internal-task', UBI_RUNNER: join(r.dir, 'ubi-runner.sh') } });
      expect(existsSync(join(r.dir, 'signalled'))).toBe(true);
      expect(existsSync(join(r.dir, 'started'))).toBe(false);
      expect(out.stderr).toContain('interrupted');
      expect(out.stderr).toMatch(/released the stage-cap reservation of (s1 s2|s2 s1), which never launched/);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });
});
