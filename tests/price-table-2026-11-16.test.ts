import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup, parsePriceTable, priceOnDate } from '../runner/pricing/model-pricing.ts';
import { chatPrice, priceRequest, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { GEMINI_HOUSEKEEPING_MODELS, OPENROUTER_MAX_OUTPUT, OPENROUTER_MODELS } from '../runner/proxy/metering-proxy.ts';

/**
 * prices-2026-11-16 is prices-2026-11-15 (internal-task's tool_fees on the 2026-11-10 rows) with claude-sonnet-5-5's cache hits repriced to 0.05x input, as Anthropic's pricing
 * page lists them, plus the internal-task lineup rows: Gemini 4 Carbon on Google's own API and on OpenRouter's Google Vertex
 * global endpoint (both with Google's dated rate change on 2026-12-01), Gemini 4 Hydrogen, Muse Wonder, Kimi K3.1 Pro and
 * GLM 5.3 on the OpenRouter endpoints the metering proxy pins, and Grok 4.7 on xAI's own API; then the harness housekeeping
 * models, never cell models: Gemini CLI's two on their pinned OpenRouter endpoints and Grok Build's session-title model.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; about: string[]; rows: Record<string, unknown>[]; tool_fees?: unknown[] };
const ADDED = ['google:gemini-4-carbon', 'openrouter:google/gemini-4-carbon', 'openrouter:google/gemini-4-hydrogen', 'openrouter:meta/muse-wonder',
  'openrouter:moonshotai/kimi-k3.1-pro', 'openrouter:z-ai/glm-5.3', 'xai:grok-4.7'];
const HOUSEKEEPING = ['openrouter:google/gemini-3-flash-preview', 'openrouter:google/gemini-3.1-pro-preview-customtools', 'xai:grok-4.6'];
const LINEUP = ['anthropic:claude-opus-5-5', 'anthropic:claude-fable-5-2', 'anthropic:claude-sonnet-5-5', 'openai:gpt-6-astra', 'openai:gpt-6.1-sol',
  'openrouter:deepseek/deepseek-v4.1-flash-1017', ...ADDED];
const NOV = new Date('2026-11-30T23:59:59Z'), DEC = new Date('2026-12-01T00:00:00Z');
// pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json this test reads the table it covers by name, since prices-2026-11-17 corrects four of its Gemini cache-write rates
const TABLE = parsePriceTable(readFileSync(new URL('../runner/pricing/prices-2026-11-16.json', import.meta.url), 'utf8'), 'prices-2026-11-16.json');
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const orBody = (model: string, at: Date) => {
  const row = priceOnDate(canonicalLookup(`openrouter:${model}`)!, at);
  return { model, messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 1000, provider: { only: [OPENROUTER_MODELS[model]!.only], allow_fallbacks: false, max_price: { prompt: row.input, completion: row.output } } };
};

describe('prices-2026-11-16', () => {
  test('was the table model-pricing.ts read until prices-2026-11-17: every prices-2026-11-15 row in order, one repriced, then the lineup rows, and its tool_fees unchanged', () => {
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json this test accepts the table it covers and the table that replaced it
    expect(['prices-2026-11-16.json', 'prices-2026-11-17.json']).toContain(PRICE_TABLE_FILE);
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json the new table is checked against the table it replaces
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json this test reads the table it covers by name
    const before = read('prices-2026-11-15.json'), now = read('prices-2026-11-16.json');
    expect(now.date).toBe('2026-11-16');
    expect(now.tool_fees).toEqual(before.tool_fees);
    expect(now.about.slice(0, before.about.length)).toEqual(before.about);
    expect(now.about.at(-1)).toContain('rate_change');
    const sonnet = (r: Record<string, unknown>) => r.provider === 'anthropic' && r.model === 'claude-sonnet-5-5';
    expect(now.rows.slice(0, before.rows.length).filter(r => !sonnet(r))).toEqual(before.rows.filter(r => !sonnet(r)));
    expect(now.rows.slice(before.rows.length).map(r => `${r.provider}:${r.model}`)).toEqual([...ADDED, ...HOUSEKEEPING]);
    const s = now.rows.find(sonnet)!, was = before.rows.find(sonnet)!;
    const rest = ({ cache_read: _c, source_date: _d, source_basis: _b, note: _n, ...r }: Record<string, unknown>) => r;
    expect(rest(s)).toEqual(rest(was));
    expect([was.cache_read, s.cache_read, s.source_basis]).toEqual([0.2, 0.1, 'fetched']);
    expect(CANONICAL_PRICING['anthropic:claude-sonnet-5-5']).toEqual({ input: 2, output: 10, cache_write: 2.5, cache_read: 0.1 });
    expect(chatPrice('anthropic:claude-sonnet-5-5')).toEqual({ input: 2, output: 10, cache_write: 2.5, cache_read: 0.1 });
  });

  test('every lineup model has a price, so its cells pass the HE-PIN-002 preflight, and every OpenRouter model the proxy forwards has a row', () => {
    for (const id of LINEUP) expect(canonicalLookup(id)).toBeDefined();
    for (const id of Object.keys(OPENROUTER_MODELS)) expect(canonicalLookup(`openrouter:${id}`)).toBeDefined();
    expect(Object.keys(OPENROUTER_MODELS).map(id => `openrouter:${id}`)).toEqual(LINEUP.filter(id => id.startsWith('openrouter:')));
    expect(OPENROUTER_MODELS['google/gemini-4-carbon']).toEqual({ only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' });
    expect(OPENROUTER_MODELS['meta/muse-wonder']).toEqual({ only: 'meta', served: 'Meta' });
  });

  test("Gemini CLI's and Grok Build's housekeeping models have rows, Gemini's have pinned endpoints, are forwarded only by the google route, and are held to Gemini's 65,536 output tokens", () => {
    expect(Object.keys(GEMINI_HOUSEKEEPING_MODELS).map(id => `openrouter:${id}`)).toEqual(HOUSEKEEPING.filter(id => id.startsWith('openrouter:')));
    expect(CANONICAL_PRICING['xai:grok-4.6']).toEqual(CANONICAL_PRICING['xai:grok-4.7']);
    expect(GEMINI_HOUSEKEEPING_MODELS).toEqual({ 'google/gemini-3-flash-preview': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' },
      'google/gemini-3.1-pro-preview-customtools': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' } });
    for (const id of Object.keys(GEMINI_HOUSEKEEPING_MODELS)) expect(OPENROUTER_MODELS[id]).toBeUndefined();
    expect(TABLE['openrouter:google/gemini-3-flash-preview']).toEqual({ input: 0.5, output: 3, cache_write: 0.0833333333333333, cache_read: 0.05 });
    expect(TABLE['openrouter:google/gemini-3.1-pro-preview-customtools']).toEqual({ input: 2, output: 12, cache_write: 0.375, cache_read: 0.2,
      long_prompt: { threshold_tokens: 200_000, input: 4, output: 18, cache_read: 0.4 } });
    expect(OPENROUTER_MAX_OUTPUT).toEqual({ 'google/gemini-4-carbon': 65_536, 'google/gemini-4-hydrogen': 65_536, 'google/gemini-3-flash-preview': 65_536, 'google/gemini-3.1-pro-preview-customtools': 65_536 });
  });

  test('the rows hold the listed rates', () => {
    expect(TABLE['openrouter:google/gemini-4-hydrogen']).toEqual({ input: 1.5, output: 7.5, cache_write: 0.0833333333333333, cache_read: 0.075 });
    expect(CANONICAL_PRICING['openrouter:meta/muse-wonder']).toEqual({ input: 4, output: 20, cache_read: 0.2 });
    expect(CANONICAL_PRICING['openrouter:moonshotai/kimi-k3.1-pro']).toEqual({ input: 2, output: 10, cache_read: 0.2 });
    expect(CANONICAL_PRICING['openrouter:z-ai/glm-5.3']).toEqual({ input: 1.4, output: 4.4, cache_read: 0.26 });
    expect(CANONICAL_PRICING['xai:grok-4.7']).toEqual({ input: 2, output: 6, cache_read: 0.5, long_prompt: { threshold_tokens: 199_999, input: 4, output: 12, cache_read: 1 } });
    expect(chatPrice('xai:grok-4.7')).toEqual({ input: 2, output: 6, cache_read: 0.5, long: { above_input_tokens: 199_999, input: 4, output: 12, cache_read: 1 } });
  });

  test("Carbon bills Google's introductory rate through 2026-11-30 and the full rate from 2026-12-01, on both routes", () => {
    for (const key of ['google:gemini-4-carbon', 'openrouter:google/gemini-4-carbon']) {
      const row = CANONICAL_PRICING[key]!;
      // The 2026-11-17 table (the one CANONICAL_PRICING reads) adds Carbon's cache-write rate from 2026-12-01 on OpenRouter.
      const write = key.startsWith('openrouter:') ? { cache_write: 4.375 } : {};
      expect(row.rate_change).toEqual({ from: '2026-12-01', input: 4, output: 20, cache_read: 0.2, ...write });
      expect(priceOnDate(row, NOV)).toMatchObject({ input: 2, output: 10, cache_read: 0.1 });
      expect(priceOnDate(row, DEC)).toEqual({ input: 4, output: 20, cache_read: 0.2, ...write });
      expect(priceOnDate(row, NOV).rate_change).toBeUndefined();
    }
    expect(priceOnDate(TABLE['openrouter:google/gemini-4-carbon']!, NOV)).toEqual({ input: 2, output: 10, cache_read: 0.1, cache_write: 0.1875 });
    const grok = CANONICAL_PRICING['xai:grok-4.7']!;
    expect(priceOnDate(grok, DEC)).toBe(grok);
  });

  test("the ledger reserves and settles a Carbon request at the rate of the day it reaches the proxy, on Google's route and OpenRouter's", () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent';
    const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1000 } };
    const usage = { usageMetadata: { promptTokenCount: 1_000_000, cachedContentTokenCount: 0, candidatesTokenCount: 100_000 } };
    const nov = priceRequest(url, body, { now: NOV })!, dec = priceRequest(url, body, { now: DEC })!;
    expect(nov).toMatchObject({ provider: 'gemini', input: 2, output: 10, cache_read: 0.1, maxOutputTokens: 1000 + 65_536 });
    expect(dec).toMatchObject({ provider: 'gemini', input: 4, output: 20, cache_read: 0.2 });
    expect(usageCost(nov, usage)!.usd).toBeCloseTo(3, 9);
    expect(usageCost(dec, usage)!.usd).toBeCloseTo(6, 9);
    const orNov = priceRequest(OR_URL, orBody('google/gemini-4-carbon', NOV), { now: NOV })!;
    expect(orNov).toMatchObject({ input: 2, output: 10, cache_read: 0.1, cache_write: 2.1875, rowPriced: true });
    expect(priceRequest(OR_URL, orBody('google/gemini-4-carbon', DEC), { now: DEC })).toMatchObject({ input: 4, output: 20, cache_read: 0.2, rowPriced: true });
    expect(priceRequest(OR_URL, orBody('google/gemini-4-carbon', DEC), { now: DEC })!.cache_write).toBe(4.375);
    expect(() => priceRequest(OR_URL, orBody('google/gemini-4-carbon', DEC), { now: NOV })).toThrow('above its price row');
  });

  test('an OpenRouter request settles its cache writes at the row and its long prompts at the long-prompt tier', () => {
    const price = priceRequest(OR_URL, orBody('google/gemini-4-carbon', NOV), { now: NOV })!;
    const settled = usageCost(price, { usage: { prompt_tokens: 100_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 50_000, cache_write_tokens: 40_000 }, cost: 0.123 } })!;
    expect(settled.usd).toBeCloseTo((10_000 * 2 + 50_000 * 0.1 + 40_000 * 2.1875 + 1_000 * 10) / 1e6, 12);
    expect(settled.reported_usd).toBe(0.123);
    const tiered = parsePriceTable(JSON.stringify({ rows: [{ provider: 'openrouter', model: 'x/y', input: 1, output: 2, cache_write: null, cache_read: null,
      long_prompt: { threshold_tokens: 10, input: 3, output: 4, cache_write: null, cache_read: null }, source_url: 'https://example.com', source_date: '2026-11-15' }] }))['openrouter:x/y']!;
    expect(tiered.long_prompt).toEqual({ threshold_tokens: 10, input: 3, output: 4 });
    expect(reservationUsd({ ...price, input: 1, output: 2, cache_read: undefined, cache_write: undefined, long: { above_input_tokens: 10, input: 3, output: 4 }, inputTokens: 11, maxOutputTokens: 1 })).toBeCloseTo((11 * 3 + 4) / 1e6, 12);
  });

  test('a malformed rate change is refused', () => {
    const row = { provider: 'p', model: 'm', input: 1, output: 2, cache_write: null, cache_read: null, long_prompt: null, source_url: 'https://example.com', source_date: '2026-11-15' };
    const parse = (r: object) => parsePriceTable(JSON.stringify({ rows: [r] }));
    expect(parse({ ...row, rate_change: null })).toEqual({ 'p:m': { input: 1, output: 2 } });
    expect(parse({ ...row, rate_change: { from: '2026-12-01', input: 3, output: 4, cache_write: null, cache_read: 1 } })['p:m']!.rate_change).toEqual({ from: '2026-12-01', input: 3, output: 4, cache_read: 1 });
    expect(() => parse({ ...row, rate_change: [] })).toThrow('rate_change must be an object');
    expect(() => parse({ ...row, rate_change: { from: '2026-11-15', input: 3, output: 4, cache_write: null, cache_read: null } })).toThrow('after source_date');
    expect(() => parse({ ...row, rate_change: { from: '2026-02-30', input: 3, output: 4, cache_write: null, cache_read: null } })).toThrow('rate_change.from');
    expect(() => parse({ ...row, rate_change: { from: '2026-12-01', input: -1, output: 4, cache_write: null, cache_read: null } })).toThrow('rate_change.input must be');
    expect(() => parse({ ...row, rate_change: { from: '2026-12-01', input: 3, output: 4 } })).toThrow('rate_change.cache_read must be');
  });
});
