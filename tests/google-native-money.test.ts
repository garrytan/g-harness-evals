/**
 * Money fixes on the google route's native mode (internal-task PR 2, items 4 to 6): a request asking for more than one candidate
 * is refused before it is priced or forwarded (HE-PROXY-013), Google Maps grounding and file search are refused like the
 * other hosted tools (HE-PROXY-006), and the reservation covers thinking tokens on top of the output limit, so a single
 * candidate's settlement never exceeds it.
 * Keyless: the upstream is a Bun server on the loopback and every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus, priceRequest } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, UPSTREAM, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const tmp = mkdtempSync(join(tmpdir(), 'google-native-money-'));
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const seen: Record<string, any>[] = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  seen.push(await req.json() as Record<string, any>);
  const usage = JSON.parse(req.headers.get('x-fake-usage') ?? '{"promptTokenCount":10,"candidatesTokenCount":1,"totalTokenCount":11}');
  return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: usage });
} });
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
function leaseProxy() {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'native-' + id, leaseUsd: 50, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const proxy = new MeteringProxy({ upstream: { google: 'http://127.0.0.1:' + upstream.port }, policy: { lease, env: { GEMINI_API_KEY: 'placeholder-gemini' }, usageLog, maxOutputTokens: 128_000 } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, ['google:gemini-4-carbon']);
  const from = seen.length;
  return {
    google: (body: unknown, usage?: object) => fetch('http://127.0.0.1:' + proxy.port + '/t/google/v1beta/models/gemini-4-carbon:generateContent',
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN, ...(usage ? { 'x-fake-usage': JSON.stringify(usage) } : {}) }, body: JSON.stringify(body) }),
    usage: () => readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine),
    sent: () => seen.slice(from), committed: () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd, stop: () => proxy.stop(),
  };
}
const contents = { contents: [{ role: 'user', parts: [{ text: 'Say ok.' }] }] };

describe('hosted tools on the native google route', () => {
  test('Google Maps grounding and file search are refused with HE-PROXY-006 in either spelling, before pricing or forwarding', async () => {
    const t = leaseProxy();
    try {
      for (const tool of [{ googleMaps: {} }, { google_maps: { enableWidget: false } }, { fileSearch: { fileSearchStoreNames: ['fileSearchStores/x'] } }, { file_search: {} }]) {
        const r = await t.google({ ...contents, tools: [{ functionDeclarations: [{ name: 'bash' }] }, tool] });
        expect(r.status).toBe(400);
        expect((await r.json()).error.message).toContain('HE-PROXY-006');
      }
      expect(t.sent()).toEqual([]);
      expect(t.committed()).toBe(0);
      expect(t.usage().map((l) => l.reason!.match(/tools\[1\]\.\w+/)![0])).toEqual(['tools[1].googleMaps', 'tools[1].google_maps', 'tools[1].fileSearch', 'tools[1].file_search']);
    } finally { t.stop(); }
  });
});

describe('candidateCount on the native google route', () => {
  test('anything but 1 is refused before pricing or forwarding, at $0, with HE-PROXY-013; 1 or none is forwarded', async () => {
    const t = leaseProxy();
    try {
      for (const generationConfig of [{ candidateCount: 2 }, { candidate_count: 4 }, { candidateCount: 0 }, { candidateCount: '2' }]) {
        const r = await t.google({ ...contents, generationConfig });
        expect(r.status).toBe(400);
        expect((await r.json()).error.message).toContain('HE-PROXY-013');
      }
      expect(t.sent()).toEqual([]);
      expect(t.committed()).toBe(0);
      expect(t.usage().every((l) => l.outcome === 'refused' && l.reason!.startsWith('HE-PROXY-013 the request asks for candidateCount'))).toBe(true);
      expect((await t.google({ ...contents, generationConfig: { candidateCount: 1 } })).status).toBe(200);
      expect((await t.google(contents)).status).toBe(200);
      expect(t.sent()).toHaveLength(2);
    } finally { t.stop(); }
  });
});

describe('the reservation covers thinking on top of the output limit', () => {
  const NOV = new Date('2026-11-20T12:00:00Z');
  const price = (generationConfig: object) => priceRequest(UPSTREAM.google + '/v1beta/models/gemini-4-carbon:generateContent', { ...contents, generationConfig }, { now: NOV })!.maxOutputTokens;
  test('a positive thinkingBudget is added to the limit; a budget of 0 adds nothing; -1, a thinkingLevel alone or no thinkingConfig add the model ceiling', () => {
    expect(price({ maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 2048 } })).toBe(3048);
    expect(price({ maxOutputTokens: 1000, thinking_config: { thinking_budget: 0 } })).toBe(1000);
    expect(price({ maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: -1 } })).toBe(1000 + 65_536);
    expect(price({ maxOutputTokens: 1000, thinkingConfig: { thinkingLevel: 'HIGH' } })).toBe(1000 + 65_536);
    expect(price({ maxOutputTokens: 1000 })).toBe(1000 + 65_536);
    expect(price({})).toBe(65_536 + 65_536);
  });

  test('a single candidate that thinks at length settles within its reservation', async () => {
    const t = leaseProxy();
    try {
      const thought = { promptTokenCount: 10, candidatesTokenCount: 1000, thoughtsTokenCount: 60_000, totalTokenCount: 61_010 };
      expect((await t.google({ ...contents, generationConfig: { maxOutputTokens: 1000, thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } } }, thought)).status).toBe(200);
      expect((await t.google({ ...contents, generationConfig: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 2048 } } }, { ...thought, thoughtsTokenCount: 2048 })).status).toBe(200);
      const [level, budget] = t.usage();
      for (const l of [level!, budget!]) {
        expect(l).toMatchObject({ outcome: 'forwarded', charged_reservation: false });
        expect(l.reserved_usd!).toBeGreaterThanOrEqual(l.actual_usd!);
      }
      expect(level!.actual_usd).toBeCloseTo((10 * 2 + 61_000 * 10) / 1e6, 12);
    } finally { t.stop(); }
  });
});
