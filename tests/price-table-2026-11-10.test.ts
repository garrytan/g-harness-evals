import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { chatPrice } from '../runner/ledger/budget-ledger.ts';

/**
 * prices-2026-11-10 joins two tables that each added one row to prices-2026-11-07: prices-2026-11-09 (claude-fable-5-2)
 * and prices-2026-11-08 (OpenRouter's DeepSeek endpoint for deepseek/deepseek-v4.1-flash-1017). No rate changes.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; about: string[]; rows: Record<string, unknown>[] };
const DS = 'openrouter:deepseek/deepseek-v4.1-flash-1017';

describe('prices-2026-11-10', () => {
  test('was the table model-pricing.ts read until prices-2026-11-15: every prices-2026-11-09 row unchanged, then the prices-2026-11-08 DeepSeek row unchanged', () => {
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-10.json this test accepts the table it covers and the table that replaced it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json this test accepts the table it covers and the tables that replaced it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json this test accepts the table it covers and the tables that replaced it
    expect(['prices-2026-11-10.json', 'prices-2026-11-15.json', 'prices-2026-11-16.json', 'prices-2026-11-17.json']).toContain(PRICE_TABLE_FILE);
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-09.json the new table is checked against the two tables it joins
    const fable = read('prices-2026-11-09.json'), deepseek = read('prices-2026-11-08.json'), now = read('prices-2026-11-10.json'); // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-10.json this test reads the table it covers by name
    expect(now.date).toBe('2026-11-10');
    expect(now.rows.slice(0, fable.rows.length)).toEqual(fable.rows);
    expect(now.rows.slice(fable.rows.length)).toEqual(deepseek.rows.filter(r => `${r.provider}:${r.model}` === DS));
    expect(now.about.slice(0, fable.about.length)).toEqual(fable.about);
    expect(now.about.slice(fable.about.length).every(line => deepseek.about.includes(line))).toBe(true);
  });

  test('both added models are priced in the table and the ledger', () => {
    for (const id of ['anthropic:claude-fable-5-2', DS]) {
      expect(canonicalLookup(id)).toBeDefined();
      expect(chatPrice(id)).toBeDefined();
    }
    expect(CANONICAL_PRICING[DS]).toEqual({ input: 0.3, output: 1.2, cache_read: 0.006 });
    expect(CANONICAL_PRICING['anthropic:claude-fable-5-2']).toEqual({ input: 8, output: 40, cache_read: 0.2, cache_write: 10 });
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-10.json the old table keeps the Sonnet 5.5 cache-read price the new table corrects
    expect(read('prices-2026-11-10.json').rows.find(r => r.model === 'claude-sonnet-5-5')?.cache_read).toBe(0.2);
  });
});
