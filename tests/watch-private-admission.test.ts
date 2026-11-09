// scripts/public-safety/watch-private-admission.ts marks open pull request heads private-admission=error when the
// private lane has gone quiet for 30 minutes. These tests drive it with a fake GitHub client and a fake fetch; no
// network, no real token.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXT, DESCRIPTION, MAX_DESCRIPTION, restClient, watch, type GitHub, type OpenPull, type Status } from '../scripts/public-safety/watch-private-admission.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const sha = (c: string) => c.repeat(40);

function fake(pulls: OpenPull[], statuses: Record<string, Status[]>, committed: Record<string, string>) {
  const posted: { sha: string; state: string; context: string; description: string }[] = [];
  const gh: GitHub = {
    openPulls: async () => pulls,
    statuses: async (s) => statuses[s] ?? [],
    committedAt: async (s) => committed[s] ?? ago(600),
    postStatus: async (s, st) => { posted.push({ sha: s, ...st }); },
  };
  return { gh, posted };
}

describe('description', () => {
  test('is the fixed public text within GitHub\'s 140-character limit, naming no internal thread code or command', () => {
    expect(DESCRIPTION).toBe('PS-PRIV-UNAVAILABLE: private lane unavailable; maintainers re-run private-admission for this head');
    expect(DESCRIPTION.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(DESCRIPTION.replace('PS-PRIV-UNAVAILABLE', '')).not.toMatch(/\b[A-Z]{2,}-\d+\b/);
    expect(DESCRIPTION).not.toContain('lane.ts');
  });

  test('docs/public-safety.md documents PS-PRIV-UNAVAILABLE under its own anchor with the exact description', () => {
    const doc = readFileSync(join(import.meta.dir, '..', 'docs', 'public-safety.md'), 'utf8');
    expect(doc).toContain('<a id="ps-priv-unavailable"></a>\n### PS-PRIV-UNAVAILABLE');
    expect(doc).toContain('`' + DESCRIPTION + '`');
    for (const s of ['## CI and the private lane', '## Docs-only fast path', '`pr-text`', '`public-safety-push`']) expect(doc).toContain(s);
  });
});

describe('watch', () => {
  test('posts error on a head with no status pushed over 30 minutes ago, and waits on a fresh one', async () => {
    const { gh, posted } = fake([{ number: 1, head: sha('1'), createdAt: ago(120) }, { number: 2, head: sha('2'), createdAt: ago(120) }], {}, { [sha('1')]: ago(31), [sha('2')]: ago(10) });
    const v = await watch(gh, NOW);
    expect(v.map((x) => [x.number, x.action])).toEqual([[1, 'posted'], [2, 'waiting']]);
    expect(posted).toEqual([{ sha: sha('1'), state: 'error', context: CONTEXT, description: DESCRIPTION }]);
  });

  test('a new pull request of an old commit counts from its creation', async () => {
    const { gh, posted } = fake([{ number: 3, head: sha('3'), createdAt: ago(5) }], {}, { [sha('3')]: ago(500) });
    expect((await watch(gh, NOW))[0]!.action).toBe('waiting');
    expect(posted).toEqual([]);
  });

  test('a newest pending status counts from its own time; a final status is left alone', async () => {
    const pulls = [4, 5, 6, 7, 8].map((n) => ({ number: n, head: sha(String(n)), createdAt: ago(300) }));
    const st = (state: Status['state'], min: number, context = CONTEXT): Status => ({ context, state, createdAt: ago(min) });
    const { gh, posted } = fake(pulls, {
      [sha('4')]: [st('pending', 45)],
      [sha('5')]: [st('pending', 10), st('pending', 90)],
      [sha('6')]: [st('success', 200)],
      [sha('7')]: [st('pending', 5), st('failure', 100)],
      [sha('8')]: [st('pending', 100, 'ubicloud/checks'), st('error', 50)],
    }, {});
    const v = await watch(gh, NOW);
    expect(v.map((x) => [x.number, x.action])).toEqual([[4, 'posted'], [5, 'waiting'], [6, 'final'], [7, 'waiting'], [8, 'final']]);
    expect(posted.map((p) => p.sha)).toEqual([sha('4')]);
  });

  test('a dry run posts nothing', async () => {
    const { gh, posted } = fake([{ number: 9, head: sha('9'), createdAt: ago(100) }], {}, {});
    expect((await watch(gh, NOW, true))[0]!.action).toBe('posted');
    expect(posted).toEqual([]);
  });
});

describe('restClient', () => {
  test('pages open pulls, reads the combined status and posts to the statuses endpoint with the token', async () => {
    const calls: { method: string; url: string; auth: string; body?: string }[] = [];
    const pulls = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, head: { sha: sha('f') }, created_at: ago(60) }));
    const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ method: init.method, url, auth: init.headers.authorization!, body: init.body });
      const json = url.includes('/pulls?') ? (url.endsWith('page=1') ? pulls.slice(0, 100) : pulls.slice(100))
        : url.includes('/status?') ? { statuses: [{ context: CONTEXT, state: 'pending', created_at: ago(40) }] }
        : url.includes('/commits/') ? { commit: { committer: { date: ago(70) } } } : {};
      return { ok: true, status: 200, json: async () => json };
    };
    const gh = restClient('owner/repo', 'synthetic-token', 'https://api.example.invalid', fetcher);
    expect((await gh.openPulls()).length).toBe(101);
    expect(await gh.statuses(sha('f'))).toEqual([{ context: CONTEXT, state: 'pending', createdAt: ago(40) }]);
    expect(await gh.committedAt(sha('f'))).toBe(ago(70));
    await gh.postStatus(sha('f'), { state: 'error', context: CONTEXT, description: 'd' });
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://api.example.invalid/repos/owner/repo/pulls?state=open&per_page=100&page=1',
      'GET https://api.example.invalid/repos/owner/repo/pulls?state=open&per_page=100&page=2',
      'GET https://api.example.invalid/repos/owner/repo/commits/' + sha('f') + '/status?per_page=100&page=1',
      'GET https://api.example.invalid/repos/owner/repo/commits/' + sha('f'),
      'POST https://api.example.invalid/repos/owner/repo/statuses/' + sha('f'),
    ]);
    expect(calls.every((c) => c.auth === 'Bearer synthetic-token')).toBe(true);
    expect(JSON.parse(calls[4]!.body!)).toEqual({ state: 'error', context: CONTEXT, description: 'd' });
  });

  test('a failed call throws without the token in the message', async () => {
    const gh = restClient('owner/repo', 'synthetic-token', 'https://api.example.invalid', async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const err = await gh.openPulls().then(() => null, (e: Error) => e.message);
    expect(err).toBe('GET /pulls?state=open&per_page=100&page=1 answered HTTP 403');
  });
});
