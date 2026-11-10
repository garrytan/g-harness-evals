import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { CHAT_PRICE_OVERRIDES, chatPrice, priceRequest } from '../runner/ledger/budget-ledger.ts';

/**
 * prices-2026-11-09 is prices-2026-11-07 plus one row, anthropic:claude-fable-5-2, released 2026-11-09 at $8 input,
 * $10 five-minute cache writes, $0.20 cache hits and $40 output per million tokens
 * (platform.claude.com/docs/en/about-claude/pricing, read 2026-11-09).
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] };

describe('prices-2026-11-09', () => {
  test('is the table model-pricing.ts reads, and holds every 2026-11-07 row unchanged plus claude-fable-5-2', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-09.json');
    const before = read('prices-2026-11-07.json'), now = read('prices-2026-11-09.json'); // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-07.json the new table is checked against the table it replaces
    expect(now.date).toBe('2026-11-09');
    const added = now.rows.filter(r => !before.rows.some(b => b.provider === r.provider && b.model === r.model));
    expect(added.map(r => `${r.provider}:${r.model}`)).toEqual(['anthropic:claude-fable-5-2']);
    expect(now.rows.filter(r => !added.includes(r))).toEqual(before.rows);
  });

  test('the claude-fable-5-2 row carries the ledger\'s rates', () => {
    const ledger = CHAT_PRICE_OVERRIDES['anthropic:claude-fable-5-2']!;
    expect(ledger).toEqual({ input: 8, output: 40, cache_read: 0.2, cache_write: 10 });
    expect(CANONICAL_PRICING['anthropic:claude-fable-5-2']).toEqual({ input: 8, output: 40, cache_read: 0.2, cache_write: 10 });
  });

  test('the price table and the ledger both admit anthropic:claude-fable-5-2', () => {
    expect(canonicalLookup('anthropic:claude-fable-5-2')).toBeDefined();
    expect(chatPrice('anthropic:claude-fable-5-2')).toBeDefined();
    expect(priceRequest('https://api.anthropic.com/v1/messages', { model: 'claude-fable-5-2', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })).toMatchObject({ model: 'claude-fable-5-2', input: 8, output: 40 });
  });
});
