/**
 * Metering for Gemini 4 Carbon and Hydrogen on the google route (amendment 2 of frontier-shootout-2026-11, rulings B and C):
 * each forwarded line splits cached and thinking tokens and is priced from the dated rows (Carbon's rate change on
 * 2026-12-01, Hydrogen at $1.50, $7.50 and $0.075), records the finish reason and the output length, so a cut at a per-request
 * limit shows, and a 429 is logged with its Retry-After and Google's error JSON, with no key or token in the log.
 * Keyless: the upstream is a Bun server on the loopback and every key is a placeholder.
 *
 * Value: protects=the amendment's money and diagnostics for the Gemini cells in Hermes, OpenClaw and Pi; fails_when=a
 * Gemini line loses its cached or thinking split, is priced at the wrong row or day, drops its finish reason, or a 429 loses
 * its body or leaks a credential; seen=usage lines and the ledger; no_claim=Google's real usage numbers or quota answers.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { canonicalLookup, priceOnDate } from '../runner/pricing/model-pricing.ts';
import { MeteringProxy, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const tmp = mkdtempSync(join(tmpdir(), 'gemini-direct-metering-'));
const KEY = ['AIza', 'Sy', 'Q'.repeat(33)].join('');
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const USAGE = { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 200, thoughtsTokenCount: 300, totalTokenCount: 1500 };
const QUOTA = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota). key ' + KEY + ' token ' + TOKEN,
  details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count', quotaId: 'GenerateContentPaidTierInputTokensPerModelPerMinute', quotaValue: '2000000' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' }] } };

const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  await req.text();
  const mode = req.headers.get('x-fake-mode');
  if (mode === '429') return Response.json(QUOTA, { status: 429, headers: { 'retry-after': '31' } });
  const finish = mode === 'cut' ? 'MAX_TOKENS' : 'STOP';
  const usage = mode === 'cut' ? { promptTokenCount: 1000, candidatesTokenCount: 32_768, thoughtsTokenCount: 0, totalTokenCount: 33_768 } : USAGE;
  const answer = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: finish }], usageMetadata: usage };
  if (new URL(req.url).pathname.endsWith(':streamGenerateContent')) return new Response('data: ' + JSON.stringify(answer) + '\r\n\r\n', { headers: { 'content-type': 'text/event-stream' } });
  return Response.json(answer);
} });
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
function leaseProxy(model: string) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'gemini-direct-' + id, leaseUsd: 50, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const proxy = new MeteringProxy({ upstream: { google: 'http://127.0.0.1:' + upstream.port }, policy: { lease, env: { GEMINI_API_KEY: KEY }, usageLog, maxOutputTokens: 128_000 } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, ['google:' + model]);
  const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } };
  return {
    call: (path: string, mode = '') => fetch('http://127.0.0.1:' + proxy.port + '/t/google' + path,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN, ...(mode ? { 'x-fake-mode': mode } : {}) }, body: JSON.stringify(body) }),
    raw: () => readFileSync(usageLog, 'utf8'),
    usage: () => readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine),
    committed: () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd,
    stop: () => proxy.stop(),
  };
}

/** USAGE at a model's rates on the UTC day of the line: 600 uncached input, 400 cache reads, 200 + 300 output (thinking bills as output). */
const priced = (model: string, at: string) => { const r = priceOnDate(canonicalLookup('google:' + model)!, new Date(at)); return (600 * r.input + 400 * r.cache_read! + 500 * r.output) / 1e6; };

describe('Gemini 4 Carbon and Hydrogen lines on the google route', () => {
  test('the dated rows: Carbon $2, $10, $0.10 to 2026-11-30 and $4, $20, $0.20 from 2026-12-01; Hydrogen $1.50, $7.50, $0.075', () => {
    const at = (model: string, day: string) => { const r = priceOnDate(canonicalLookup('google:' + model)!, new Date(day + 'T12:00:00Z')); return [r.input, r.output, r.cache_read]; };
    expect(at('gemini-4-carbon', '2026-11-30')).toEqual([2, 10, 0.1]);
    expect(at('gemini-4-carbon', '2026-12-01')).toEqual([4, 20, 0.2]);
    expect(at('gemini-4-hydrogen', '2026-11-30')).toEqual([1.5, 7.5, 0.075]);
    expect(at('gemini-4-hydrogen', '2026-12-01')).toEqual([1.5, 7.5, 0.075]);
  });

  for (const model of ['gemini-4-carbon', 'gemini-4-hydrogen']) {
    for (const [method, query] of [['generateContent', ''], ['streamGenerateContent', '?alt=sse']] as const) {
      for (const prefix of ['', '/generativelanguage.googleapis.com']) {
        test(model + ' ' + method + (prefix ? ' through the Hermes alias' : '') + ': cached and thinking split, dated price, finish reason', async () => {
          const p = leaseProxy(model);
          try {
            const res = await p.call(prefix + '/v1beta/models/' + model + ':' + method + query);
            expect(res.status).toBe(200);
            await res.text();
            const [line] = p.usage().filter((l) => l.outcome === 'forwarded');
            expect(line).toMatchObject({ provider: 'google', model, status: 200, streamed: method === 'streamGenerateContent', route: '/v1beta/models/' + model + ':' + method,
              cached_tokens: 400, reasoning_tokens: 300, finish_reason: 'STOP', thinking_level: 'high' });
            expect(line!.input_tokens).toBe(1000);
            expect(line!.output_tokens).toBe(500);
            expect(line!.actual_usd).toBeCloseTo(priced(model, line!.at), 12);
            expect(p.committed()).toBeCloseTo(priced(model, line!.at), 12);
          } finally { p.stop(); }
        });
      }
    }

    test(model + ': a reply cut at a per-request limit shows as MAX_TOKENS with its output length (ruling B)', async () => {
      const p = leaseProxy(model);
      try {
        await (await p.call('/v1beta/models/' + model + ':streamGenerateContent?alt=sse', 'cut')).text();
        const [line] = p.usage().filter((l) => l.outcome === 'forwarded');
        expect(line).toMatchObject({ finish_reason: 'MAX_TOKENS', output_tokens: 32_768, reasoning_tokens: 0 });
      } finally { p.stop(); }
    });

    test(model + ': a 429 is logged with Retry-After and Google\'s error JSON, unbilled, with no key or token (ruling C)', async () => {
      const p = leaseProxy(model);
      try {
        const res = await p.call('/v1beta/models/' + model + ':generateContent', '429');
        expect(res.status).toBe(429);
        await res.text();
        const lines = p.usage();
        const line = lines.find((l) => l.status === 429)!;
        expect(line).toMatchObject({ provider: 'google', model, retry_after: '31' });
        const body = line.error_body as typeof QUOTA;
        expect(body.error.status).toBe('RESOURCE_EXHAUSTED');
        expect(body.error.code).toBe(429);
        expect(body.error.details).toEqual(QUOTA.error.details);
        expect(body.error.message).toStartWith('Resource has been exhausted (e.g. check quota). key ');
        expect(line.actual_usd ?? 0).toBe(0);
        expect(p.committed()).toBe(0);
        const raw = p.raw();
        expect(raw).not.toContain(KEY);
        expect(raw).not.toContain(TOKEN);
        expect(raw).not.toContain('0123456789abcdef0123456789abcdef');
      } finally { p.stop(); }
    });
  }
});
