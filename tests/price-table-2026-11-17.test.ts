import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup, priceOnDate } from '../runner/pricing/model-pricing.ts';
import { priceRequest, usageCost } from '../runner/ledger/budget-ledger.ts';
import { SignatureStore, toChat } from '../runner/proxy/gemini-openrouter.ts';
import { GEMINI_HOUSEKEEPING_MODELS, OPENROUTER_MODELS } from '../runner/proxy/metering-proxy.ts';

/**
 * prices-2026-11-17 is prices-2026-11-16 with the cache-write rate of the four Gemini rows on OpenRouter corrected. Each row
 * listed five minutes of Google's hourly cache storage (1/12 of the hourly rate) as the whole cache-write price, so a cache
 * write billed at 4 to 19 percent of input. Google bills a cache write as its input tokens plus storage, so each row now bills
 * input plus those five minutes of storage. Since the provider-terms ruling of 2026-11-16 the three Gemini rows that were on
 * Google Vertex's global endpoint name Google AI Studio's standard endpoint instead, and GLM 5.3 names Baidu's fp8 endpoint
 * instead of Z.AI's, each read 2026-11-16 at the same rates. Nothing else changes.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;
const GEMINI = ['google/gemini-4-carbon', 'google/gemini-4-hydrogen', 'google/gemini-3-flash-preview', 'google/gemini-3.1-pro-preview-customtools'];
const key = (r: Record<string, unknown>) => r.provider + ':' + r.model;
const NOV = new Date('2026-11-30T23:59:59Z'), DEC = new Date('2026-12-01T00:00:00Z');
const PINS = { ...OPENROUTER_MODELS, ...GEMINI_HOUSEKEEPING_MODELS };
const GLM = 'openrouter:z-ai/glm-5.3';
const Z_AI = "Z.AI's own endpoint (tag z-ai/fp8, provider Z.AI), the one the metering proxy pins.";
const BAIDU = "Baidu's fp8 endpoint (tag baidu/fp8, provider Baidu, standard tier), the one the metering proxy pins since 2026-11-16, at the rates Z.AI's own endpoint also lists.";
const VERTEX = 'Google Vertex global endpoint (tag google-vertex/global, provider Google), the one the metering proxy pins';
const AI_STUDIO = "Google AI Studio's standard endpoint (tag google-ai-studio, provider Google AI Studio, standard tier), the one the metering proxy pins since 2026-11-16, at the rates Google Vertex's global endpoint also lists";

describe('prices-2026-11-17', () => {
  test('is the table model-pricing.ts reads: every prices-2026-11-16 row unchanged but the cache_write and note of the four Gemini rows on OpenRouter, the source date of the three moved to Google AI Studio, and the note and source date of GLM 5.3 on Baidu', () => {
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-17.json this test accepts the table it covers and the table that replaced it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-20.json this test accepts the table it covers and the table that replaced it
    expect(['prices-2026-11-17.json', 'prices-2026-11-20.json', 'prices-2026-11-21.json']).toContain(PRICE_TABLE_FILE);
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json the new table is checked against the table it replaces
    const before = read('prices-2026-11-16.json'), now = read('prices-2026-11-17.json'); // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-17.json this test reads its own historical table
    const { date: _was, rows: _wasRows, ...beforeRest } = before;
    const { date, rows, ...nowRest } = now;
    expect(date).toBe('2026-11-17');
    expect(nowRest).toEqual(beforeRest);
    expect(rows.map(key)).toEqual(before.rows.map(key));
    const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before.rows[i]) && key(r) !== GLM);
    expect(changed.map(key)).toEqual(GEMINI.map((m) => 'openrouter:' + m));
    const glm = rows.find((r) => key(r) === GLM)!, glmWas = before.rows.find((r) => key(r) === GLM)!;
    expect({ ...glm, note: null, source_date: null }).toEqual({ ...glmWas, note: null, source_date: null });
    expect([glm.source_date, glm.note]).toEqual(['2026-11-16', String(glmWas.note).replace(Z_AI, BAIDU)]);
    for (const row of changed) {
      const was = before.rows.find((r) => key(r) === key(row))!;
      const rest = ({ cache_write: _c, note: _n, source_date: _d, rate_change, ...r }: Record<string, unknown>) => ({ ...r, ...(rate_change ? { rate_change: { ...(rate_change as object), cache_write: null } } : {}) });
      expect(rest(row)).toEqual(rest(was));
      expect(row.cache_write).toBe((was.input as number) + (was.cache_write as number));
      const moved = String(was.note).includes(VERTEX);
      expect([key(row), row.source_date]).toEqual([key(row), moved ? '2026-11-16' : was.source_date]);
      expect(row.note).toStartWith(String(was.note).replace(VERTEX, AI_STUDIO));
      expect(String(row.note)).not.toContain('google-vertex');
      expect(PINS[row.model as string]).toMatchObject({ only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' });
      expect(row.note).toContain('five minutes of');
    }
    expect(GEMINI.map((m) => CANONICAL_PRICING['openrouter:' + m]!.cache_write)).toEqual([2.1875, 1.5833333333333333, 0.5833333333333333, 2.375]);
    expect(changed.filter((r) => r.rate_change).map((r) => [key(r), (r.rate_change as Record<string, unknown>).cache_write])).toEqual([['openrouter:google/gemini-4-carbon', 4.375]]);
  });

  test('Carbon on OpenRouter bills cache writes from 2026-12-01 at the new input plus five minutes of storage at twice the old rate, not at input', () => {
    const row = canonicalLookup('openrouter:google/gemini-4-carbon')!;
    expect(priceOnDate(row, NOV)).toMatchObject({ input: 2, cache_write: 2 + 2.25 / 12 });
    expect(priceOnDate(row, DEC)).toMatchObject({ input: 4, output: 20, cache_read: 0.2, cache_write: 4 + 4.5 / 12 });
    const { chat } = toChat({ contents: [{ role: 'user', parts: [{ text: 'Fix the build.' }] }] }, 'gemini-4-carbon', new SignatureStore());
    chat.provider = { only: [PINS['google/gemini-4-carbon']!.only], allow_fallbacks: false, max_price: { prompt: 4, completion: 20 } };
    const price = priceRequest('https://openrouter.ai/api/v1/chat/completions', chat, { now: DEC })!;
    const settled = usageCost(price, { usage: { prompt_tokens: 50_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 50_000 } } })!;
    expect(settled.usd).toBeCloseTo(50_000 * 4.375 / 1e6, 12);
  });

  test('a translated Gemini request with cache writes settles at no less than input for those tokens, before and after Carbon\'s rate change', () => {
    for (const model of GEMINI) {
      for (const at of [NOV, DEC]) {
        const row = priceOnDate(canonicalLookup('openrouter:' + model)!, at);
        const { chat } = toChat({ contents: [{ role: 'user', parts: [{ text: 'Fix the build.' }] }] }, model.slice('google/'.length), new SignatureStore());
        chat.provider = { only: [PINS[model]!.only], allow_fallbacks: false, max_price: { prompt: row.input, completion: row.output } };
        const price = priceRequest('https://openrouter.ai/api/v1/chat/completions', chat, { now: at })!;
        const settled = usageCost(price, { usage: { prompt_tokens: 100_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 20_000, cache_write_tokens: 50_000 } } })!;
        const writesAtInput = (80_000 * row.input + 20_000 * row.cache_read! + 1_000 * row.output) / 1e6;
        expect([model, at, settled.usd >= writesAtInput - 1e-12]).toEqual([model, at, true]);
        expect(settled.usd).toBeCloseTo((30_000 * row.input + 20_000 * row.cache_read! + 50_000 * (row.cache_write ?? row.input) + 1_000 * row.output) / 1e6, 12);
      }
    }
  });
});
