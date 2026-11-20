import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { priceRequest, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { PRICE_TABLE_FILE, canonicalLookup, priceAtPromptSize } from '../runner/pricing/model-pricing.ts';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] } & Record<string, unknown>;

describe('prices-2026-11-20', () => {
  test('keeps the previous header and rows except for the date and the GPT-6.2 Sol row after GPT-6.1 Sol', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-20.json');
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-17.json the new table is checked against the table it replaces
    const before = read('prices-2026-11-17.json'), now = read('prices-2026-11-20.json');
    const { date: _was, rows: beforeRows, ...beforeHeader } = before;
    const { date, rows, ...header } = now;
    expect(date).toBe('2026-11-20');
    expect(header).toEqual(beforeHeader);
    const predecessor = beforeRows.findIndex(row => row.provider === 'openai' && row.model === 'gpt-6.1-sol');
    expect(predecessor).toBeGreaterThanOrEqual(0);
    const at = predecessor + 1;
    expect([...rows.slice(0, at), ...rows.slice(at + 1)]).toEqual(beforeRows);
    expect(rows[at]).toMatchObject({
      provider: 'openai', model: 'gpt-6.2-sol', input: 2, output: 10, cache_write: 2.5, cache_read: 0.1,
      long_prompt: { threshold_tokens: 272_000, input: 4, output: 15, cache_write: 5, cache_read: 0.2 },
      source_url: 'https://developers.openai.com/api/docs/pricing', source_date: '2026-11-19', source_basis: 'fetched',
    });
  });

  test('native OpenAI Responses reserves and settles GPT-6.2 Sol above the long-prompt threshold', () => {
    const price = priceRequest('https://api.openai.com/v1/responses', {
      model: 'gpt-6.2-sol', input: 'x'.repeat(816_000), max_output_tokens: 1_000,
    })!;
    expect(price.inputTokens).toBeGreaterThan(272_000);
    const listed = canonicalLookup('openai:gpt-6.2-sol')!;
    expect(price.long).toEqual({ above_input_tokens: 272_000, ...priceAtPromptSize(listed, 272_001) });
    expect(reservationUsd(price)).toBeCloseTo((price.inputTokens * 5 + 1_000 * 15) / 1e6, 12);
    expect(usageCost(price, { usage: { input_tokens: 272_000, output_tokens: 1_000 } })?.usd).toBeCloseTo(0.554, 12);
    expect(usageCost(price, { usage: { input_tokens: 272_001, output_tokens: 1_000 } })?.usd).toBeCloseTo(1.103004, 12);
  });
});
