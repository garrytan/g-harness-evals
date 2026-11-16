// ubi-runner.sh capacity: whether one more VM fits the project's vCPU quota, without creating one. The Ubicloud API has no
// quota read, so the command sends a create with a valid size and an invalid unix user, which Ubicloud refuses either for
// quota (reporting the real used and maximum counts) or, once the quota check passed, for the user name. The runner talks to a
// fake Ubicloud API on 127.0.0.1 (UBICLOUD_API_URL), so no test reaches the network or makes a VM.
//
// Value: protects=the regression canary's wait for room (scripts/canary/run.sh room) reading the real cap and use from a
// quota refusal, room=yes only on the user-name refusal, an unknown answer being exit 1 rather than room, and a probe that
// somehow created a VM destroying it; fails_when=a refusal for quota reads as room, the probe's create could make a VM
// (no invalid user, or a bad name), or an unexpected answer reads as room or no room; seam=UBICLOUD_API_URL (existing);
// no_claim=Ubicloud's order of checks, which was checked live on 2026-11-16 (quota refusal at 504 of 512 used, user refusal
// for standard-2).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = join(import.meta.dir, '..', 'scripts', 'ubicloud', 'ubi-runner.sh');
const tmp = mkdtempSync(join(tmpdir(), 'ubi-capacity-'));
let mode: 'quota' | 'user' | 'other' | 'created' | 'created-then-error' = 'quota';
let calls: string[][] = [];
let live = new Set<string>();
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const { argv } = (await req.json()) as { argv: string[] };
      calls.push(argv);
      const name = (argv[1] ?? '').split('/')[1] ?? '';
      if (argv[2] === 'create') {
        if (mode === 'quota') return new Response('! Unexpected response status: 400\nDetails: Validation failed for following fields: size\n  size: Insufficient quota for requested size. Requested vCPU count: 16, currently used vCPU count: 504, maximum allowed vCPU count: 512, remaining vCPU count: 8\n', { status: 400 });
        if (mode === 'user') return new Response('! Unexpected response status: 400\nDetails: Validation failed for following fields: user\n  user: OS user name must only contain lowercase letters, numbers, hyphens and underscore and cannot start with a number or hyphen. It also have max length of 32.\n', { status: 400 });
        if (mode === 'created') { live.add(name); return new Response('VM created with id: vm0000\n'); }
        if (mode === 'created-then-error') { live.add(name); return new Response('gateway timeout\n', { status: 504 }); }
        return new Response('internal error\n', { status: 500 });
      }
      if (argv[0] === 'vm' && argv[1] === 'list') return new Response('');
      if (argv[2] === 'show') return live.has(name) ? new Response('state: running\n') : new Response('not found\n', { status: 404 });
      if (argv[2] === 'destroy') { live.delete(name); return new Response('destroyed\n'); }
      return new Response('unexpected request\n', { status: 500 });
    },
  });
});
afterAll(() => { server.stop(true); rmSync(tmp, { recursive: true, force: true }); });

/** Runs the command asynchronously, so the fake API in this process can answer it. */
async function capacity(args: string[] = [], env: Record<string, string> = {}) {
  calls = [];
  const p = Bun.spawn(['bash', RUNNER, 'capacity', ...args], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, UBICLOUD_API_KEY: 'placeholder', UBICLOUD_API_URL: `http://127.0.0.1:${server.port}`, UBI_OWNER: 'HARN00', UBI_RUNNER_STATE: join(tmp, 'state'), UBI_POLL_SECONDS: '0', ...env },
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim(), err };
}

describe('ubi-runner.sh capacity', () => {
  test('a quota refusal is room=no with the real used and maximum counts, exit 3', async () => {
    mode = 'quota';
    const r = await capacity();
    expect(r.code).toBe(3);
    expect(r.out).toBe('UBICLOUD_CAPACITY: room=no size=standard-16 need=16 used=504 max=512 free=8');
    const create = calls.filter((c) => c[2] === 'create');
    expect(create.length).toBe(1);
    expect(create[0]).toEqual(expect.arrayContaining(['-s', 'standard-16', '-u', '0capacity-probe']));
    expect(create[0][1]).toMatch(/^eu-central-h1\/ubirun-harn00-[0-9]{10}-[a-z0-9]+-t3$/);
  });
  test('a refusal of the invalid user means the quota check passed: room=yes, exit 0', async () => {
    mode = 'user';
    const r = await capacity(['-s', 'standard-2', '-l', 'eu-north-h1']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('UBICLOUD_CAPACITY: room=yes size=standard-2 location=eu-north-h1');
  });
  test('any other answer is room=unknown, exit 1, with the answer on stderr', async () => {
    mode = 'other';
    const r = await capacity();
    expect(r.code).toBe(1);
    expect(r.out).toBe('UBICLOUD_CAPACITY: room=unknown size=standard-16');
    expect(r.err).toContain('internal error');
    expect(r.err).not.toContain('not confirmed gone');
  });
  test('an unclear answer after the create made a VM still takes that VM down', async () => {
    mode = 'created-then-error';
    live = new Set();
    const r = await capacity();
    expect(r.code).toBe(1);
    expect(r.out).toBe('UBICLOUD_CAPACITY: room=unknown size=standard-16');
    expect(calls.some((c) => c[2] === 'destroy')).toBe(true);
    expect(live.size).toBe(0);
  });
  test('a probe that created a VM destroys it at once and reports room', async () => {
    mode = 'created';
    live = new Set();
    const r = await capacity();
    expect(r.code).toBe(0);
    expect(r.err).toContain('WARNING: the capacity probe created');
    expect(calls.some((c) => c[2] === 'destroy')).toBe(true);
    expect(live.size).toBe(0);
  });
  test('it needs UBI_OWNER, like every command that names a VM', async () => {
    const r = await capacity([], { UBI_OWNER: '' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('UBI_OWNER is not set');
    expect(calls.length).toBe(0);
  });
});
