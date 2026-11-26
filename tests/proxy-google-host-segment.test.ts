/**
 * The google route's one path alias (amendment 2 of frontier-shootout-2026-11): Hermes v0.23.1 runs its native Gemini client
 * only for a base URL that contains generativelanguage.googleapis.com, so its Gemini cells point it at
 * <proxy>/<slot>/google/generativelanguage.googleapis.com/v1beta and the proxy drops that one segment (GOOGLE_HOST_SEGMENT).
 * Keyless: the upstream is a Bun server on the loopback and every key is a placeholder.
 *
 * Value: protects=Hermes's Gemini calls reach Google's own path, metered like any other Gemini call, and the alias changes
 * nothing else; fails_when=the segment is stripped twice, anywhere but straight after /google, on another route, or in another
 * spelling, or an aliased call is priced or capped differently; seen=upstream path, usage line route and status; no_claim=
 * Google's answer to the real path, which the paid smoke checks.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { GOOGLE_HOST_SEGMENT, MeteringProxy, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const tmp = mkdtempSync(join(tmpdir(), 'google-host-segment-'));
const ENV = { GEMINI_API_KEY: 'placeholder-gemini', XAI_API_KEY: 'placeholder-xai', OPENROUTER_API_KEY: 'placeholder-openrouter' };
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const GEMINI = 'gemini-4-carbon';
const USAGE = { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 1500 };
const HOST = 'generativelanguage.googleapis.com';

const seen: Array<{ path: string; search: string; goog: string | null; body: Record<string, any> }> = [];
const upstream = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch: async (req) => {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    seen.push({ path: url.pathname, search: url.search, goog: req.headers.get('x-goog-api-key'), body });
    if (url.pathname.endsWith(':streamGenerateContent')) {
      const last = { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: USAGE };
      return new Response('data: ' + JSON.stringify(last) + '\r\n\r\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.pathname.endsWith(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: USAGE });
    return Response.json({ id: 'c1', model: 'x', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  },
});
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
function proxyFor() {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'google-host-segment-' + id, leaseUsd: 5, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const base = 'http://127.0.0.1:' + upstream.port;
  const proxy = new MeteringProxy({ upstream: { google: base, xai: base, openrouter: base }, policy: { lease, env: ENV, usageLog, maxOutputTokens: 128_000 } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, ['google:' + GEMINI, 'xai:grok-4.7', 'openrouter:deepseek/deepseek-v4.1-flash-1017']);
  const mine: typeof seen = [];
  const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
  const call = async (path: string, init: RequestInit) => {
    const start = seen.length;
    const res = await fetch('http://127.0.0.1:' + proxy.port + path, init);
    const text = await res.text();
    mine.push(...seen.slice(start));
    return { status: res.status, text: () => text };
  };
  return {
    gemini: (path: string, query = '') => call(path + query, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN }, body: JSON.stringify(body) }),
    post: (path: string, b: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(b) }),
    sent: () => mine,
    usage: (): UsageLine[] => { try { return readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine); } catch { return []; } },
    stop: () => proxy.stop(),
  };
}

describe('the google route drops generativelanguage.googleapis.com once, straight after /google, and nowhere else', () => {
  test('the segment is exactly the host name between two slashes', () => {
    expect(GOOGLE_HOST_SEGMENT).toBe('/' + HOST + '/');
  });

  for (const [method, query] of [['generateContent', ''], ['streamGenerateContent', '?alt=sse']] as const) {
    test('an aliased ' + method + ' reaches Google\'s own path and is metered as the plain path is', async () => {
      const plain = proxyFor();
      const aliased = proxyFor();
      try {
        const a = await plain.gemini('/t/google/v1beta/models/' + GEMINI + ':' + method, query);
        const b = await aliased.gemini('/t/google/' + HOST + '/v1beta/models/' + GEMINI + ':' + method, query);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(b.text()).toBe(a.text());
        expect(aliased.sent().map((s) => s.path)).toEqual(['/v1beta/models/' + GEMINI + ':' + method]);
        expect(aliased.sent().map((s) => [s.search, s.goog, s.body])).toEqual(plain.sent().map((s) => [s.search, s.goog, s.body]));
        expect(aliased.sent()[0]!.goog).toBe(ENV.GEMINI_API_KEY);
        const strip = (l: UsageLine) => { const { at, ms, ttfb_ms, ...rest } = l as UsageLine & Record<string, unknown>; return rest; };
        expect(aliased.usage().map(strip)).toEqual(plain.usage().map(strip));
        expect(aliased.usage()[0]!.route).toBe('/v1beta/models/' + GEMINI + ':' + method);
      } finally { plain.stop(); aliased.stop(); }
    });
  }

  // Each path the alias must leave alone, next to a control path that differs only in the segment's spelling: both must
  // give the same status, forward the same upstream path (or none) and log the route unchanged.
  const ROUTE = '/v1beta/models/' + GEMINI + ':generateContent';
  const cases: Array<[string, string, string]> = [
    ['twice in a row (stripped once, the second stays)', '/t/google/' + HOST + '/' + HOST + ROUTE, '/t/google/' + HOST + '/example.invalid' + ROUTE],
    ['after the API version', '/t/google/v1beta/' + HOST + '/models/' + GEMINI + ':generateContent', '/t/google/v1beta/example.invalid/models/' + GEMINI + ':generateContent'],
    ['in another case', '/t/google/GenerativeLanguage.googleapis.com' + ROUTE, '/t/google/example.invalid' + ROUTE],
    ['with a prefix', '/t/google/x' + HOST + ROUTE, '/t/google/example.invalid' + ROUTE],
    ['with no slash after it', '/t/google/' + HOST, '/t/google/example.invalid'],
  ];
  for (const [name, path, control] of cases) {
    test('the segment ' + name + ' is not dropped', async () => {
      const p = proxyFor();
      const c = proxyFor();
      try {
        const a = await p.gemini(path);
        const b = await c.gemini(control);
        expect(a.status).toBe(b.status);
        expect(a.status).not.toBe(200);
        const want = name.startsWith('twice') ? path.slice('/t/google'.length + HOST.length + 1) : path.slice('/t/google'.length);
        expect(p.usage().map((l) => l.route)).toEqual([want]);
        expect(p.sent().length).toBe(c.sent().length);
      } finally { p.stop(); c.stop(); }
    });
  }

  for (const [prov, route, body] of [
    ['xai', '/v1/chat/completions', { model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }] }],
    ['openrouter', '/v1/chat/completions', { model: 'deepseek/deepseek-v4.1-flash-1017', messages: [{ role: 'user', content: 'hi' }] }],
  ] as const) {
    test('on the ' + prov + ' route the segment is a path like any other', async () => {
      const p = proxyFor();
      const c = proxyFor();
      try {
        const a = await p.post('/t/' + prov + '/' + HOST + route, body);
        const b = await c.post('/t/' + prov + '/example.invalid' + route, body);
        expect(a.status).toBe(b.status);
        expect(a.status).not.toBe(200);
        expect(p.sent().length).toBe(c.sent().length);
        expect(p.usage().map((l) => l.route)).toEqual(['/' + HOST + route]);
        const ok = proxyFor();
        try { expect((await ok.post('/t/' + prov + route, body)).status).toBe(200); } finally { ok.stop(); }
      } finally { p.stop(); c.stop(); }
    });
  }
});
