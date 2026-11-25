import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { priceRequest, usageCost } from '../runner/ledger/budget-ledger.ts';
import { PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;

describe('prices-2026-11-25', () => {
  test('keeps the previous header and rows except for the date and the Gemini 4 Neon row after Gemini 4 Carbon', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-25.json');
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-21.json the new table is checked against the table it replaces
    const before = read('prices-2026-11-21.json'), now = read('prices-2026-11-25.json');
    const { date: _was, rows: beforeRows, ...beforeHeader } = before;
    const { date, rows, ...header } = now;
    expect(date).toBe('2026-11-25');
    expect(header).toEqual(beforeHeader);
    const predecessor = beforeRows.findIndex(row => row.provider === 'google' && row.model === 'gemini-4-carbon');
    expect(predecessor).toBeGreaterThanOrEqual(0);
    const at = predecessor + 1;
    expect([...rows.slice(0, at), ...rows.slice(at + 1)]).toEqual(beforeRows);
    expect(rows[at]).toMatchObject({
      provider: 'google', model: 'gemini-4-neon', input: 3, output: 15, cache_write: null, cache_read: 0.15, long_prompt: null,
      source_url: 'https://ai.google.dev/gemini-api/docs/pricing', source_date: '2026-11-25', source_basis: 'fetched',
    });
    expect(rows[at]).not.toHaveProperty('rate_change');
  });

  test("the ledger reserves and settles a Gemini 4 Neon request on Google's route at one rate for every prompt size", () => {
    expect(canonicalLookup('google:gemini-4-neon')).toMatchObject({ input: 3, output: 15, cache_read: 0.15 });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:generateContent';
    const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1000 } };
    const price = priceRequest(url, body)!;
    expect(price).toMatchObject({ provider: 'gemini', input: 3, output: 15, cache_read: 0.15 });
    expect(usageCost(price, { usageMetadata: { promptTokenCount: 1_000_000, cachedContentTokenCount: 0, candidatesTokenCount: 100_000 } })!.usd).toBeCloseTo(4.5, 9);
    expect(usageCost(price, { usageMetadata: { promptTokenCount: 1_000_000, cachedContentTokenCount: 800_000, candidatesTokenCount: 0, thoughtsTokenCount: 10_000 } })!.usd).toBeCloseTo(0.6 + 0.12 + 0.15, 9);
  });
});
