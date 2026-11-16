/**
 * The google and xai routes of the metering proxy (internal-task gates D and E): Gemini generateContent and
 * streamGenerateContent?alt=sse with the per-trial token in x-goog-api-key and GEMINI_API_KEY injected there, and xAI Chat
 * Completions and Responses with reasoning billed as output, cost_in_usd_ticks recorded, store forced false and
 * previous_response_id refused; provider-hosted tools are refused on both routes (HE-PROXY-006, HE-PROXY-013).
 * Keyless: the upstream is a Bun server on the loopback and every key is a placeholder.
 *
 * Value: protects=a Gemini or Grok call through a lease is priced, capped, settled from its usage and sent with the proxy's
 * key only; fails_when=the real key leaves in a URL or Bearer for Gemini, a stream settles without its final usage, xAI
 * reasoning goes unbilled, or a hosted tool or stored conversation reaches the provider; seam=upstream map; no_claim=the
 * real APIs' answers, which the paid smoke checks.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, geminiStreamIncomplete, ledgerStatus, priceRequest, streamUsageCost, usageCost } from '../runner/ledger/budget-ledger.ts';
import { hostedWebTools } from '../runner/proxy/hosted-tools.ts';
import { MeteringProxy, UPSTREAM, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const tmp = mkdtempSync(join(tmpdir(), 'google-xai-route-'));
const ENV = { GEMINI_API_KEY: 'placeholder-gemini', XAI_API_KEY: 'placeholder-xai', OPENAI_API_KEY: 'placeholder-openai' };
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const GEMINI = 'gemini-4-carbon';
const GROK = 'grok-4.7';
const GEM_USAGE = { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 1500 };
/** $2 uncached input, $0.10 cache reads, $10 output (thinking included) per million tokens. */
const GEM_USD = (600 * 2 + 400 * 0.1 + 500 * 10) / 1e6;
const XAI_USAGE = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1500, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 400 }, cost_in_usd_ticks: 47_000_000 };
/** $2 uncached input, $0.50 cache reads, $6 output (completion plus reasoning) per million tokens. */
const XAI_USD = (800 * 2 + 200 * 0.5 + 500 * 6) / 1e6;
const sse = (events: unknown[], done = false) => events.map((e) => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join('') + (done ? 'data: [DONE]\r\n\r\n' : '');

type Seen = { path: string; search: string; goog: string | null; auth: string | null; body: Record<string, any> };
const seen: Seen[] = [];
const upstream = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch: async (req) => {
    const url = new URL(req.url);
    const body = await req.json() as Record<string, any>;
    seen.push({ path: url.pathname, search: url.search, goog: req.headers.get('x-goog-api-key'), auth: req.headers.get('authorization'), body });
    const mode = req.headers.get('x-fake-mode');
    const event = { headers: { 'content-type': 'text/event-stream' } };
    if (url.pathname.endsWith(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: GEM_USAGE });
    if (url.pathname.endsWith(':streamGenerateContent')) {
      const first = { candidates: [{ content: { parts: [{ text: 'o' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1 } };
      const last = { candidates: [{ content: { parts: [{ text: 'k' }] }, finishReason: 'STOP' }], usageMetadata: GEM_USAGE };
      return new Response(sse(mode === 'cut' ? [first] : [first, last]), event);
    }
    if (url.pathname === '/v1/chat/completions' && body.stream) return new Response(sse([{ id: 'c1', model: GROK, choices: [{ delta: { content: 'ok' } }] }, { id: 'c1', model: GROK, choices: [], usage: XAI_USAGE }], true), event);
    if (url.pathname === '/v1/chat/completions') return Response.json({ id: 'c1', model: GROK, choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: XAI_USAGE });
    return Response.json({ id: 'r1', model: GROK, output: [], usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1500, input_tokens_details: { cached_tokens: 200 }, output_tokens_details: { reasoning_tokens: 400 }, cost_in_usd_ticks: 47_000_000 } });
  },
});
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const lines = (path: string): UsageLine[] => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine); } catch { return []; } };
let n = 0;
function leaseProxy(o: { refuseHostedTools?: boolean } = {}) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'google-xai-' + id, leaseUsd: 5, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const base = 'http://127.0.0.1:' + upstream.port;
  const proxy = new MeteringProxy({ upstream: { google: base, xai: base }, policy: { lease, env: ENV, usageLog, maxOutputTokens: 128_000, ...(o.refuseHostedTools ? { refuseHostedTools: true } : {}) } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, ['google:' + GEMINI, 'xai:' + GROK]);
  const before = seen.length;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch('http://127.0.0.1:' + proxy.port + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return {
    proxy, post, usage: () => lines(usageLog), sent: () => seen.slice(before),
    google: (method: string, body: unknown, query = '', headers: Record<string, string> = {}) => post('/t/google/v1beta/models/' + GEMINI + ':' + method + query, body, { 'x-goog-api-key': TOKEN, ...headers }),
    xai: (route: string, body: unknown) => post('/t/xai/v1/' + route, body, { authorization: 'Bearer ' + TOKEN }),
    committed: () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd,
    stop: () => proxy.stop(),
  };
}
const contents = { contents: [{ role: 'user', parts: [{ text: 'Say ok.' }] }] };

describe('Gemini prices and stream settlement in the ledger', () => {
  test('gemini-4-carbon is priced at $2 in, $10 out and $0.10 cache reads, reserving its stated output plus thinking', () => {
    const price = priceRequest(UPSTREAM.google + '/v1beta/models/' + GEMINI + ':generateContent', { ...contents, generationConfig: { maxOutputTokens: 1000 } })!;
    expect(price).toMatchObject({ provider: 'gemini', model: GEMINI, kind: 'chat', input: 2, output: 10, cache_read: 0.1, maxOutputTokens: 1000 });
    expect(price.long).toBeUndefined();
    expect(usageCost(price, { usageMetadata: GEM_USAGE })!.usd).toBeCloseTo(GEM_USD, 12);
  });

  test('a stream settles from its last usageMetadata and is final only once a candidate reports a finishReason', () => {
    const price = priceRequest(UPSTREAM.google + '/v1beta/models/' + GEMINI + ':streamGenerateContent', contents)!;
    const done = sse([{ candidates: [{}], usageMetadata: { promptTokenCount: 1000 } }, { candidates: [{ finishReason: 'STOP' }], usageMetadata: GEM_USAGE }]);
    expect(streamUsageCost(price, done)!.usd).toBeCloseTo(GEM_USD, 12);
    expect(geminiStreamIncomplete(done)).toBeNull();
    expect(geminiStreamIncomplete(sse([{ candidates: [{}], usageMetadata: GEM_USAGE }]))).toBe('the end of the stream came before a candidate finishReason');
    expect(geminiStreamIncomplete(sse([{ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } }]))).toBeNull();
    expect(geminiStreamIncomplete(sse([{ candidates: [{}], usageMetadata: GEM_USAGE }, { error: { code: 500, status: 'INTERNAL' } }]))).toBe('stream error INTERNAL before final usage');
  });
});

describe('the google route', () => {
  test('generateContent: the trial token in x-goog-api-key, GEMINI_API_KEY sent in x-goog-api-key only, ?key= dropped, the output cap injected, settled from usageMetadata', async () => {
    const t = leaseProxy();
    try {
      const res = await t.google('generateContent', contents, '?key=dummy-in-url');
      expect(res.status).toBe(200);
      const [sent, ...more] = t.sent();
      expect(more).toEqual([]);
      expect(sent).toMatchObject({ path: '/v1beta/models/' + GEMINI + ':generateContent', search: '', goog: ENV.GEMINI_API_KEY, auth: null });
      expect(sent!.body.generationConfig).toEqual({ maxOutputTokens: 128_000 });
      await t.proxy.finalize('trial-token:t');
      const [line, ...rest] = t.usage();
      expect(rest).toEqual([]);
      expect(line).toMatchObject({ provider: 'google', model: GEMINI, outcome: 'forwarded', status: 200, streamed: false, charged_reservation: false, input_tokens: 1000, output_tokens: 500, cached_tokens: 400, reasoning_tokens: 300 });
      expect(line!.actual_usd).toBeCloseTo(GEM_USD, 12);
      expect(t.committed()).toBeCloseTo(GEM_USD, 9);
    } finally { t.stop(); }
  });

  test('streamGenerateContent?alt=sse settles from the last usageMetadata; a cut stream is charged at no less than its reservation', async () => {
    const t = leaseProxy();
    try {
      const ok = await t.google('streamGenerateContent', contents, '?alt=sse');
      expect(ok.status).toBe(200);
      await ok.text();
      const cut = await t.google('streamGenerateContent', contents, '?alt=sse', { 'x-fake-mode': 'cut' });
      await cut.text();
      await t.proxy.finalize('trial-token:t');
      expect(t.sent().map((s) => s.search)).toEqual(['?alt=sse', '?alt=sse']);
      const [done, unfinished] = t.usage();
      expect(done).toMatchObject({ provider: 'google', streamed: true, charged_reservation: false, input_tokens: 1000, output_tokens: 500, cached_tokens: 400, reasoning_tokens: 300 });
      expect(done!.actual_usd).toBeCloseTo(GEM_USD, 12);
      expect(unfinished).toMatchObject({ streamed: true, charged_reservation: true, usage_unknown: true });
      expect(unfinished!.reason).toContain('the end of the stream came before a candidate finishReason');
      expect(unfinished!.actual_usd).toBe(unfinished!.reserved_usd!);
    } finally { t.stop(); }
  });

  test('refused before any upstream: a stream without alt=sse (HE-PROXY-013), hosted tools without --refuse-hosted-tools (HE-PROXY-006), an output limit over the cap, another token', async () => {
    const t = leaseProxy();
    try {
      const noSse = await t.google('streamGenerateContent', contents);
      expect(noSse.status).toBe(400);
      expect((await noSse.json()).error.message).toContain('HE-PROXY-013');
      for (const tool of [{ googleSearch: {} }, { codeExecution: {} }, { url_context: {} }, { googleSearchRetrieval: {} }]) {
        const r = await t.google('generateContent', { ...contents, tools: [{ functionDeclarations: [{ name: 'bash' }] }, tool] });
        expect(r.status).toBe(400);
        expect((await r.json()).error.message).toContain('HE-PROXY-006');
      }
      const over = await t.google('generateContent', { ...contents, generationConfig: { maxOutputTokens: 200_000 } });
      expect(over.status).toBe(400);
      const wrong = await t.post('/t/google/v1beta/models/' + GEMINI + ':generateContent', contents, { 'x-goog-api-key': 'not-the-token' });
      expect(wrong.status).toBe(403);
      const listing = await t.post('/t/google/v1beta/models/' + GEMINI + ':countTokens', contents, { 'x-goog-api-key': TOKEN });
      expect(listing.status).toBe(403);
      expect(t.sent()).toEqual([]);
      expect(t.committed()).toBe(0);
      expect(t.usage().every((l) => l.outcome === 'refused')).toBe(true);
    } finally { t.stop(); }
  });
});

describe('xAI prices in the ledger', () => {
  test('grok-4.7 bills reasoning beside completion tokens as output, at the long-context rates once a prompt reaches 200,000 tokens', () => {
    const price = priceRequest(UPSTREAM.xai + '/v1/chat/completions', { model: GROK, messages: [], max_completion_tokens: 1000 })!;
    expect(price).toMatchObject({ provider: 'xai', model: GROK, input: 2, output: 6, cache_read: 0.5, long: { above_input_tokens: 199_999, input: 4, output: 12, cache_read: 1 } });
    expect(usageCost(price, { usage: XAI_USAGE })).toMatchObject({ input_tokens: 1000, output_tokens: 500 });
    expect(usageCost(price, { usage: XAI_USAGE })!.usd).toBeCloseTo(XAI_USD, 12);
    expect(usageCost(price, { usage: { ...XAI_USAGE, total_tokens: 1100 } })!.output_tokens).toBe(100);
    const long = usageCost(price, { usage: { prompt_tokens: 200_000, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } } })!;
    expect(long.usd).toBeCloseTo((200_000 * 4 + 10 * 12) / 1e6, 12);
    expect(usageCost(price, { usage: { prompt_tokens: 199_999, completion_tokens: 10 } })!.usd).toBeCloseTo((199_999 * 2 + 10 * 6) / 1e6, 12);
  });
});

describe('the xai route', () => {
  test('chat completions: Bearer key swapped for XAI_API_KEY, the output cap injected, reasoning billed and cost_in_usd_ticks recorded; a stream asks for usage and settles the same', async () => {
    const t = leaseProxy();
    try {
      expect((await t.xai('chat/completions', { model: GROK, messages: [{ role: 'user', content: 'Say ok.' }] })).status).toBe(200);
      const streamed = await t.xai('chat/completions', { model: GROK, messages: [{ role: 'user', content: 'Say ok.' }], stream: true });
      await streamed.text();
      await t.proxy.finalize('trial-token:t');
      const [plain, stream] = t.sent();
      expect(plain).toMatchObject({ path: '/v1/chat/completions', auth: 'Bearer ' + ENV.XAI_API_KEY, goog: null });
      expect(plain!.body.max_completion_tokens).toBe(128_000);
      expect(stream!.body.stream_options).toEqual({ include_usage: true });
      for (const line of t.usage()) {
        expect(line).toMatchObject({ provider: 'xai', model: GROK, outcome: 'forwarded', charged_reservation: false, input_tokens: 1000, output_tokens: 500, cached_tokens: 200, reasoning_tokens: 400, cost_in_usd_ticks: 47_000_000 });
        expect(line.actual_usd).toBeCloseTo(XAI_USD, 12);
      }
      expect(t.usage().map((l) => l.streamed)).toEqual([false, true]);
    } finally { t.stop(); }
  });

  test('responses: sent with store false and settled with reasoning and ticks; previous_response_id (HE-PROXY-013) and server-side tools (HE-PROXY-006) are refused', async () => {
    const t = leaseProxy();
    try {
      expect((await t.xai('responses', { model: GROK, input: 'Say ok.', store: true })).status).toBe(200);
      const chained = await t.xai('responses', { model: GROK, input: 'And again.', previous_response_id: 'resp_1' });
      expect(chained.status).toBe(400);
      expect((await chained.json()).error.message).toContain('HE-PROXY-013');
      for (const body of [{ tools: [{ type: 'x_search' }] }, { tools: [{ type: 'web_search' }] }, { tools: [{ type: 'code_interpreter' }] }, { tools: [{ type: 'mcp', server_url: 'https://example.com' }] }]) {
        const r = await t.xai('responses', { model: GROK, input: 'x', ...body });
        expect(r.status).toBe(400);
        expect((await r.json()).error.message).toContain('HE-PROXY-006');
      }
      const live = await t.xai('chat/completions', { model: GROK, messages: [], search_parameters: { mode: 'auto' } });
      expect(live.status).toBe(400);
      await t.proxy.finalize('trial-token:t');
      const sent = t.sent();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toMatchObject({ store: false, max_output_tokens: 128_000 });
      const forwarded = t.usage().filter((l) => l.outcome === 'forwarded');
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]).toMatchObject({ route: '/v1/responses', output_tokens: 500, reasoning_tokens: 400, cost_in_usd_ticks: 47_000_000 });
      expect(forwarded[0]!.actual_usd).toBeCloseTo(XAI_USD, 12);
    } finally { t.stop(); }
  });
});

describe('hosted tools by provider', () => {
  test('the google and xai shapes count only on their own route; a function tool passes everywhere', () => {
    const fn = { type: 'function', function: { name: 'web_search' } };
    expect(hostedWebTools({ tools: [{ googleSearch: {} }, { functionDeclarations: [] }] }, 'google')).toEqual(['tools[0].googleSearch']);
    expect(hostedWebTools({ tools: [{ googleSearch: {} }] }, 'openai')).toEqual([]);
    expect(hostedWebTools({ tools: [fn, { type: 'x_search' }], search_parameters: { mode: 'on' } }, 'xai')).toEqual(['tools[1].type x_search', 'search_parameters']);
    expect(hostedWebTools({ tools: [{ type: 'x_search' }, { type: 'code_interpreter' }] }, 'openai')).toEqual([]);
    expect(hostedWebTools({ tools: [fn], search_parameters: null }, 'xai')).toEqual([]);
  });
});
