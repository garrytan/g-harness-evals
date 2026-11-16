// The canary's Ubicloud wrappers (scripts/canary/gbrain/remote.sh and scripts/canary/gstack/lib.sh canary_remote), keyless,
// against a stub ubi-runner.sh (tests/fixtures/canary-core/stub-ubi-runner.sh) in a throwaway clean checkout.
//
// Value: protects=a region with no standard-16 room moving the tier to the next location instead of failing the run, a
// tier where no location had room settling the lease to $0 through an empty trials.jsonl, and no VM left running by a
// retry; fails_when=a capacity failure ends the tier, the next location is not tried, a VM that never ran leaves no
// trials file and the lease charges the whole reservation (baseline-2026-11-11-r2, gbrain T2), a try whose VM cleanup was
// not confirmed is retried anyway, the final check looks only at the last VM name, or a failed down does not print the
// command that finishes it; seam=the stub runner; no_claim=Ubicloud itself.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'canary-remote-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function checkout(full: string[], more: { leak?: string[]; ghost?: string[]; copyfail?: string[]; pullfail?: string[]; downFails?: boolean } = {}) {
  const base = mkdtempSync(join(tmp, 'case-'));
  const home = join(base, 'home'), repo = join(base, 'repo'), stub = join(base, 'stub');
  for (const d of [home, stub, join(repo, 'scripts/canary/gbrain'), join(repo, 'scripts/canary/gstack'), join(repo, 'scripts/ubicloud')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = canary fixture\n\temail = fixture@example.invalid\n[init]\n\tdefaultBranch = main\n');
  copyFileSync(join(ROOT, 'scripts/canary/gbrain/remote.sh'), join(repo, 'scripts/canary/gbrain/remote.sh'));
  if (existsSync(join(ROOT, 'scripts/canary/gstack/lib.sh'))) copyFileSync(join(ROOT, 'scripts/canary/gstack/lib.sh'), join(repo, 'scripts/canary/gstack/lib.sh'));
  copyFileSync(join(ROOT, 'tests/fixtures/canary-core/stub-ubi-runner.sh'), join(repo, 'scripts/ubicloud/ubi-runner.sh'));
  chmodSync(join(repo, 'scripts/ubicloud/ubi-runner.sh'), 0o755);
  writeFileSync(join(repo, 'scripts/ubicloud/bootstrap.sh'), '#!/usr/bin/env bash\n');
  writeFileSync(join(stub, 'full'), full.map((l) => l + '\n').join(''));
  writeFileSync(join(stub, 'leak'), (more.leak ?? []).map((l) => l + '\n').join(''));
  writeFileSync(join(stub, 'ghost'), (more.ghost ?? []).map((l) => l + '\n').join(''));
  writeFileSync(join(stub, 'copyfail'), (more.copyfail ?? []).map((l) => l + '\n').join(''));
  writeFileSync(join(stub, 'pullfail'), (more.pullfail ?? []).map((l) => l + '\n').join(''));
  if (more.downFails) writeFileSync(join(stub, 'down-fails'), '');
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, UBI_OWNER: 'internal-task', UBICLOUD_API_KEY: 'stub', STUB_UBI_DIR: stub };
  for (const a of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'rig']]) spawnSync('git', a, { cwd: repo, env });
  const lines = (f: string) => (existsSync(join(stub, f)) ? readFileSync(join(stub, f), 'utf8').split('\n').filter(Boolean) : []);
  const tries = () => lines('tries');
  return { base, repo, env, tries, downs: () => lines('downs'), listed: () => lines('listed') };
}

const gbrain = (c: ReturnType<typeof checkout>) => {
  const out = join(c.base, 'out');
  const r = spawnSync('bash', [join(c.repo, 'scripts/canary/gbrain/remote.sh'), '--entry', 'run-tier', '--out', out, '--hours', '1', '--', '--tier', 'T2'], { cwd: c.repo, env: c.env, encoding: 'utf8' });
  return { code: r.status, out, err: r.stderr };
};
const gstack = (c: ReturnType<typeof checkout>) => {
  const out = join(c.base, 'out');
  mkdirSync(out, { recursive: true });
  const script = 'repo=$1; out=$2; here=$repo/scripts/canary/gstack; . "$here/lib.sh"; canary_remote run-tier.sh 1 1 --tier T2';
  const r = spawnSync('bash', ['-c', script, 'canary', c.repo, out], { cwd: c.repo, env: c.env, encoding: 'utf8' });
  return { code: r.status, out, err: r.stderr };
};

describe('canary remote wrappers and Ubicloud capacity', () => {
  test('gbrain: a full region moves the tier to the next location', () => {
    const c = checkout(['eu-central-h1']);
    const r = gbrain(c);
    expect(r.err).not.toContain('unbound');
    expect(r.code).toBe(0);
    expect(c.tries()).toEqual(['eu-central-h1', 'eu-north-h1']);
    expect(JSON.parse(readFileSync(join(r.out, 'remote.json'), 'utf8')).location).toBe('eu-north-h1');
    expect(readFileSync(join(r.out, 'trials.jsonl'), 'utf8')).toContain('"usd":0.5');
    expect(readFileSync(join(r.out, 'lane.log'), 'utf8')).toContain('no capacity in eu-central-h1; nothing ran');
  });
  test('gbrain: no room anywhere leaves an empty trials.jsonl, so the lease settles to $0', () => {
    const c = checkout(['eu-central-h1', 'eu-north-h1', 'us-east-a2']);
    const r = gbrain(c);
    expect(r.code).toBe(3);
    expect(c.tries()).toEqual(['eu-central-h1', 'eu-north-h1', 'us-east-a2']);
    expect(readFileSync(join(r.out, 'trials.jsonl'), 'utf8')).toBe('');
  });
  test.skipIf(!existsSync(join(ROOT, 'scripts/canary/gstack/lib.sh')))('gstack: a full region moves the tier to the next location, and no room anywhere leaves an empty trials.jsonl (private repository only: publication/manifest.json keeps scripts/canary/gstack out of the public copy)', () => {
    const c = checkout(['eu-central-h1']);
    const r = gstack(c);
    expect(r.code).toBe(0);
    expect(c.tries()).toEqual(['eu-central-h1', 'eu-north-h1']);
    expect(readFileSync(join(r.out, 'trials.jsonl'), 'utf8')).toContain('"usd":0.5');
    const d = checkout(['eu-central-h1', 'eu-north-h1', 'us-east-a2']);
    const s = gstack(d);
    expect(s.code).toBe(3);
    expect(d.tries()).toEqual(['eu-central-h1', 'eu-north-h1', 'us-east-a2']);
    expect(readFileSync(join(s.out, 'trials.jsonl'), 'utf8')).toBe('');
  });

  const remoteJson = (out: string) => JSON.parse(readFileSync(join(out, 'remote.json'), 'utf8'));
  test('gbrain: a capacity failure whose VM cleanup was not confirmed is not retried, and the final check takes that VM down', () => {
    const c = checkout([], { leak: ['eu-central-h1'] });
    const r = gbrain(c);
    expect(r.code).toBe(3);
    expect(c.tries()).toEqual(['eu-central-h1']);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    const vm = remoteJson(r.out).vm;
    expect(c.downs()).toEqual([vm]);
    expect(c.listed()).toEqual([]);
    expect(readFileSync(join(r.out, 'lane.log'), 'utf8')).toContain(`VM ${vm} is still listed; destroying it`);
    expect(remoteJson(r.out).vm_left).toBe(0);
  });
  test('gbrain: a VM an earlier try left listed is found by its own name after the retry renamed the VM, and taken down', () => {
    const c = checkout([], { ghost: ['eu-central-h1'] });
    const r = gbrain(c);
    expect(r.code).toBe(0);
    expect(c.tries()).toEqual(['eu-central-h1', 'eu-north-h1']);
    const first = readFileSync(join(r.out, 'lane.log'), 'utf8').match(/UBICLOUD: left=0 owner=harn00 vm=(\S+)/)![1]!;
    expect(first).not.toBe(remoteJson(r.out).vm);
    expect(c.downs()).toEqual([first]);
    expect(c.listed()).toEqual([]);
  });
  test.skipIf(process.getuid?.() === 0)('gbrain: a failed copy of the results still takes a leftover VM down and leaves no trials.jsonl, so the lease charges the whole reservation', () => {
    const c = checkout([], { copyfail: ['eu-central-h1'] });
    const r = gbrain(c);
    expect(r.code).toBe(3);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    expect(c.downs()).toEqual([remoteJson(r.out).vm]);
    expect(c.listed()).toEqual([]);
    expect(readFileSync(join(r.out, 'lane.log'), 'utf8')).toContain('WARNING: copying the results back from');
  });
  test.skipIf(process.getuid?.() === 0 || !existsSync(join(ROOT, 'scripts/canary/gstack/lib.sh')))('gstack: a failed copy of the results keeps the pulled results, leaves no trials.jsonl and exits 3 (private repository only)', () => {
    const c = checkout([], { copyfail: ['eu-central-h1'] });
    const r = gstack(c);
    expect(r.code).toBe(3);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    expect(existsSync(join(r.out, '.remote/canary-out/trials.jsonl'))).toBe(true);
    expect(c.listed()).toEqual([]);
  });
  test('gbrain: a pull the runner reports as failed leaves no trials.jsonl and exits 3, so the lease charges the whole reservation', () => {
    const c = checkout([], { pullfail: ['eu-central-h1'] });
    const r = gbrain(c);
    expect(r.code).toBe(3);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    expect(readFileSync(join(r.out, 'lane.log'), 'utf8')).toContain('WARNING: pulling the results off the VM failed');
  });
  test.skipIf(!existsSync(join(ROOT, 'scripts/canary/gstack/lib.sh')))('gstack: a pull the runner reports as failed leaves no trials.jsonl and exits 3 (private repository only)', () => {
    const c = checkout([], { pullfail: ['eu-central-h1'] });
    const r = gstack(c);
    expect(r.code).toBe(3);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    expect(existsSync(join(r.out, '.remote/canary-out/trials.jsonl'))).toBe(true);
  });
  test('gbrain: a down that fails logs the exact command that finishes it', () => {
    const c = checkout([], { leak: ['eu-central-h1'], downFails: true });
    const r = gbrain(c);
    const vm = remoteJson(r.out).vm;
    expect(readFileSync(join(r.out, 'lane.log'), 'utf8')).toMatch(new RegExp(`WARNING: down ${vm} failed; run: UBI_OWNER=internal-task bash \\S+/scripts/ubicloud/ubi-runner\\.sh down ${vm}`));
    expect(remoteJson(r.out).vm_left).toBe(1);
  });
  test.skipIf(!existsSync(join(ROOT, 'scripts/canary/gstack/lib.sh')))('gstack: a capacity failure whose VM cleanup was not confirmed is not retried, a VM an earlier try left listed is taken down, and a failed down logs its command (private repository only)', () => {
    const c = checkout([], { leak: ['eu-central-h1'] });
    const r = gstack(c);
    expect(r.code).toBe(3);
    expect(c.tries()).toEqual(['eu-central-h1']);
    expect(existsSync(join(r.out, 'trials.jsonl'))).toBe(false);
    expect(c.downs()).toEqual(['ubirun-harn00-1700000000-stub1-t3']);
    expect(c.listed()).toEqual([]);
    expect(readFileSync(join(r.out, 'canary.log'), 'utf8')).toContain('remote: VM ubirun-harn00-1700000000-stub1-t3 is still listed; destroying it');
    const g = checkout([], { ghost: ['eu-central-h1'] });
    const s = gstack(g);
    expect(s.code).toBe(0);
    expect(g.tries()).toEqual(['eu-central-h1', 'eu-north-h1']);
    expect(g.downs()).toEqual(['ubirun-harn00-1700000000-stub1-t3']);
    const f = checkout([], { leak: ['eu-central-h1'], downFails: true });
    const t = gstack(f);
    expect(t.code).toBe(3);
    expect(readFileSync(join(t.out, 'canary.log'), 'utf8')).toMatch(/remote: WARNING: down ubirun-harn00-1700000000-stub1-t3 failed; run: UBI_OWNER=internal-task bash \S+\/scripts\/ubicloud\/ubi-runner\.sh down ubirun-harn00-1700000000-stub1-t3/);
  });
});
