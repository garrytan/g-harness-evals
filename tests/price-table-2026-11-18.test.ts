import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PRICE_TABLE_FILE, canonicalLookup, priceOnDate } from '../runner/pricing/model-pricing.ts';
import { priceRequest, usageCost } from '../runner/ledger/budget-ledger.ts';

/**
 * prices-2026-11-18 is prices-2026-11-17 plus one row, google:gemini-4-hydrogen: Gemini 4 Hydrogen on Google's Gemini API at the paid
 * tier's standard rates ($1.50 input, $7.50 output with thinking, $0.075 cache hits, implicit caching only), read from
 * ai.google.dev/gemini-api/docs/pricing on 2026-11-16. Amendment 2 of frontier-shootout-2026-11 sends Hydrogen in OpenClaw and Pi to
 * that API through the metering proxy's google route, which prices each request at this row. Nothing else changes.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;
const key = (r: Record<string, unknown>) => r.provider + ':' + r.model;
const NOV = new Date('2026-11-30T23:59:59Z'), DEC = new Date('2026-12-01T00:00:00Z');

describe('prices-2026-11-18', () => {
  test('is the table model-pricing.ts reads: every prices-2026-11-17 row unchanged and in order, with google:gemini-4-hydrogen added after google:gemini-4-carbon', () => {
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-26.json this test accepts every table that has replaced the one it covers
    expect(['prices-2026-11-18.json', 'prices-2026-11-26.json']).toContain(PRICE_TABLE_FILE);
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-17.json the new table is checked against the table it replaces
    const before = read('prices-2026-11-17.json'), now = read('prices-2026-11-18.json');
    const { date: _was, rows: wasRows, ...beforeRest } = before;
    const { date, rows, ...nowRest } = now;
    expect(date).toBe('2026-11-18');
    expect(nowRest).toEqual(beforeRest);
    const at = wasRows.findIndex((r) => key(r) === 'google:gemini-4-carbon') + 1;
    expect(rows.map(key)).toEqual([...wasRows.slice(0, at).map(key), 'google:gemini-4-hydrogen', ...wasRows.slice(at).map(key)]);
    expect(rows.filter((r) => key(r) !== 'google:gemini-4-hydrogen')).toEqual(wasRows);
    expect(rows[at]).toMatchObject({ input: 1.5, output: 7.5, cache_write: null, cache_read: 0.075, long_prompt: null, source_url: 'https://ai.google.dev/gemini-api/docs/pricing', source_date: '2026-11-16', source_basis: 'fetched' });
    expect('rate_change' in rows[at]!).toBe(false);
  });

  test('Hydrogen on the google route bills the same rates on both sides of 2026-12-01, with cache hits at $0.075 and no cache write; Carbon still doubles', () => {
    for (const at of [NOV, DEC]) expect(priceOnDate(canonicalLookup('google:gemini-4-hydrogen')!, at)).toMatchObject({ input: 1.5, output: 7.5, cache_read: 0.075 });
    expect(priceOnDate(canonicalLookup('google:gemini-4-carbon')!, DEC)).toMatchObject({ input: 4, output: 20, cache_read: 0.2 });
    const body = { contents: [{ role: 'user', parts: [{ text: 'Fix the build.' }] }], generationConfig: { maxOutputTokens: 65_536 } };
    const price = priceRequest('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent', body, { now: NOV })!;
    expect(price.model).toBe('gemini-4-hydrogen');
    const settled = usageCost(price, { usageMetadata: { promptTokenCount: 100_000, cachedContentTokenCount: 40_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 3_000 } })!;
    expect(settled.usd).toBeCloseTo((60_000 * 1.5 + 40_000 * 0.075 + 4_000 * 7.5) / 1e6, 12);
  });
});
