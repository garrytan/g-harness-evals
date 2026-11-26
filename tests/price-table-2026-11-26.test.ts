import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { priceRequest, usageCost } from '../runner/ledger/budget-ledger.ts';
import { PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';

/**
 * prices-2026-11-26 joins two tables that replaced prices-2026-11-17 on different branches: prices-2026-11-25 (main: GPT-6.2 Sol,
 * GPT-6.2 Astra and Gemini 4 Neon) and prices-2026-11-18 (frontier-shootout-2026-11's amendment 2: google:gemini-4-hydrogen, the
 * row its Hydrogen cells in OpenClaw and Pi were metered at). It is prices-2026-11-25 with that one row added after
 * google:gemini-4-carbon, byte for byte as prices-2026-11-18 has it. No rate changes.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL('../runner/pricing/' + file, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;
const key = (r: Record<string, unknown>) => r.provider + ':' + r.model;

describe('prices-2026-11-26', () => {
  test('is prices-2026-11-25 with prices-2026-11-18\'s google:gemini-4-hydrogen row added after google:gemini-4-carbon', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-26.json');
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-25.json the new table is checked against the table it replaces
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-18.json the added row is checked against the table that metered it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-25.json the table this one replaced, read to check what changed
    const before = read('prices-2026-11-25.json'), shootout = read('prices-2026-11-18.json'), now = read('prices-2026-11-26.json');
    const { date: _was, rows: beforeRows, ...beforeHeader } = before;
    const { date, rows, ...header } = now;
    expect(date).toBe('2026-11-26');
    expect(header).toEqual(beforeHeader);
    const at = beforeRows.findIndex((r) => key(r) === 'google:gemini-4-carbon') + 1;
    expect(at).toBeGreaterThan(0);
    expect(key(rows[at]!)).toBe('google:gemini-4-hydrogen');
    expect([...rows.slice(0, at), ...rows.slice(at + 1)]).toEqual(beforeRows);
    expect(rows[at]).toEqual(shootout.rows.find((r) => key(r) === 'google:gemini-4-hydrogen')!);
  });

  test('Hydrogen on Google\'s route and Neon both price as their rows say', () => {
    expect(canonicalLookup('google:gemini-4-hydrogen')).toMatchObject({ input: 1.5, output: 7.5, cache_read: 0.075 });
    expect(canonicalLookup('google:gemini-4-neon')).toMatchObject({ input: 3, output: 15, cache_read: 0.15 });
    const body = { contents: [{ role: 'user', parts: [{ text: 'Fix the build.' }] }], generationConfig: { maxOutputTokens: 65_536 } };
    const price = priceRequest('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent', body)!;
    expect(price.model).toBe('gemini-4-hydrogen');
    expect(usageCost(price, { usageMetadata: { promptTokenCount: 100_000, cachedContentTokenCount: 40_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 3_000 } })!.usd).toBeCloseTo((60_000 * 1.5 + 40_000 * 0.075 + 4_000 * 7.5) / 1e6, 12);
  });
});
