import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backoffMs, Gh, GhError, MAX_TRIES, parseIncluded, type GhResponse } from '../../scripts/review-bugs/github.ts';

const tmp = mkdtempSync(join(tmpdir(), 'rb-gh-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** A Gh client on a fake clock: sleeps advance the clock, the transport answers from a list. */
function client(answers: Array<(path: string) => GhResponse>, extra: { floor?: number } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const sleeps: number[] = [];
  const calls: Array<{ path: string; at: number }> = [];
  const logs: string[] = [];
  const gh = new Gh({
    cacheDir: join(tmp, 'c' + n++), now: () => clock.now, log: (l) => logs.push(l), ...extra,
    sleep: async (ms) => { sleeps.push(ms); clock.now += ms; },
    transport: ({ path }) => { calls.push({ path, at: clock.now }); return (answers.length > 1 ? answers.shift()! : answers[0]!)(path); },
  });
  return { gh, clock, sleeps, calls, logs };
}
const ok = (json: unknown, headers: Record<string, string> = {}): GhResponse => ({ status: 200, headers, json });

describe('the GitHub client', () => {
  test('parses gh api -i output', () => {
    const r = parseIncluded('HTTP/2.0 200 OK\r\nX-Ratelimit-Remaining: 59\r\nContent-Type: application/json\r\n\r\n{"a":1}');
    expect(r).toEqual({ status: 200, headers: { 'x-ratelimit-remaining': '59', 'content-type': 'application/json' }, json: { a: 1 } });
    expect(parseIncluded('HTTP/1.1 404 Not Found\n\nnot json').json).toBeNull();
  });

  test('paces core calls 0.8 s apart and search calls 2.1 s apart', async () => {
    const c = client([(p) => ok({ p })]);
    await c.gh.get('repos/a/b');
    await c.gh.get('repos/a/c');
    await c.gh.get('search/issues?q=1');
    await c.gh.get('search/issues?q=2');
    expect(c.calls[1]!.at - c.calls[0]!.at).toBe(800);
    expect(c.calls[3]!.at - c.calls[2]!.at).toBe(2_100);
    expect(c.gh.requests).toBe(4);
  });

  test('answers a repeated request from the disk cache, across instances', async () => {
    const c = client([(p) => ok({ p })]);
    expect(await c.gh.get('repos/a/b')).toEqual({ p: 'repos/a/b' });
    expect(await c.gh.get('repos/a/b')).toEqual({ p: 'repos/a/b' });
    expect(c.calls.length).toBe(1);
    const again = new Gh({ cacheDir: join(tmp, 'c' + (n - 1)), transport: () => { throw new Error('no network expected'); } });
    expect(await again.get('repos/a/b')).toEqual({ p: 'repos/a/b' });
  });

  test('backs off on 403 and 429, honouring retry-after and the reset time', async () => {
    expect(backoffMs({ status: 200, headers: {}, json: null }, 0, 0)).toBeNull();
    expect(backoffMs({ status: 403, headers: { 'retry-after': '7' }, json: null }, 0, 0)).toBe(7_000);
    expect(backoffMs({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100' }, json: null }, 0, 90_000)).toBe(12_000);
    expect(backoffMs({ status: 429, headers: {}, json: null }, 1, 0)).toBe(60_000);
    expect(backoffMs({ status: 403, headers: {}, json: null }, 9, 0)).toBe(15 * 60_000);
    const c = client([() => ({ status: 403, headers: {}, json: null }), () => ok({ fine: true })]);
    expect(await c.gh.get('search/issues?q=x')).toEqual({ fine: true });
    expect(c.sleeps).toContain(30_000);
    expect(c.logs[0]).toBe('gh: 403 on search, waiting 30 s (try 1 of 6)');
  });

  test('gives up after the last try with a code-only error', async () => {
    const c = client([() => ({ status: 429, headers: {}, json: null })]);
    const err = await c.gh.get('repos/a/b').catch((e: GhError) => e) as GhError;
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toBe('E_GH_429 repos/a/b');
    expect(c.calls.length).toBe(MAX_TRIES);
    const missing = client([() => ({ status: 404, headers: {}, json: null })]);
    expect(((await missing.gh.get('repos/a/b').catch((e: GhError) => e)) as GhError).status).toBe(404);
    expect(missing.calls.length).toBe(1);
  });

  test('holds a quota kind below its floor until the reset, without holding the others', async () => {
    const c = client([(p) => ok({ p }, p.startsWith('search/') ? { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': String(1_700_000_000 + 60) } : {})]);
    await c.gh.get('search/issues?q=1');
    const t0 = c.clock.now;
    await c.gh.get('repos/a/b');
    expect(c.calls[1]!.at).toBe(t0);
    await c.gh.get('search/issues?q=2');
    expect(c.calls[2]!.at).toBe((1_700_000_000 + 60) * 1000 + 1_000);
    expect(c.logs).toContain('gh: search quota at 2, holding until the reset');
  });
});
