import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { priceRequest, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { PRICE_TABLE_FILE, canonicalLookup, priceAtPromptSize } from '../runner/pricing/model-pricing.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;

describe('prices-2026-11-21', () => {
  test('keeps the previous header and rows except for the date and the GPT-6.2 Astra row after GPT-6 Astra', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-21.json');
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-20.json the new table is checked against the table it replaces
    const before = read('prices-2026-11-20.json'), now = read('prices-2026-11-21.json');
    const { date: _was, rows: beforeRows, ...beforeHeader } = before;
    const { date, rows, ...header } = now;
    expect(date).toBe('2026-11-21');
    expect(header).toEqual(beforeHeader);
    const predecessor = beforeRows.findIndex(row => row.provider === 'openai' && row.model === 'gpt-6-astra');
    expect(predecessor).toBeGreaterThanOrEqual(0);
    const at = predecessor + 1;
    expect([...rows.slice(0, at), ...rows.slice(at + 1)]).toEqual(beforeRows);
    expect(rows[at]).toMatchObject({
      provider: 'openai', model: 'gpt-6.2-astra', input: 8, output: 40, cache_write: 10, cache_read: 0.4,
      long_prompt: { threshold_tokens: 272_000, input: 16, output: 60, cache_write: 20, cache_read: 0.8 },
      source_url: 'https://developers.openai.com/api/docs/pricing', source_date: '2026-11-21', source_basis: 'fetched',
    });
  });

  test('native OpenAI Responses reserves and settles GPT-6.2 Astra above the long-prompt threshold', () => {
    const price = priceRequest('https://api.openai.com/v1/responses', {
      model: 'gpt-6.2-astra', input: 'x'.repeat(816_000), max_output_tokens: 1_000,
    })!;
    expect(price.inputTokens).toBeGreaterThan(272_000);
    const listed = canonicalLookup('openai:gpt-6.2-astra')!;
    expect(price.long).toEqual({ above_input_tokens: 272_000, ...priceAtPromptSize(listed, 272_001) });
    expect(reservationUsd(price)).toBeCloseTo((price.inputTokens * 20 + 1_000 * 60) / 1e6, 12);
    expect(usageCost(price, { usage: { input_tokens: 272_000, output_tokens: 1_000 } })?.usd).toBeCloseTo(2.216, 12);
    expect(usageCost(price, { usage: { input_tokens: 272_001, output_tokens: 1_000 } })?.usd).toBeCloseTo(4.412016, 12);
  });
});
