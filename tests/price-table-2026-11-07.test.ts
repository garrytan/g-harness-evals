import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { CHAT_PRICE_OVERRIDES, chatPrice, priceRequest } from '../runner/ledger/budget-ledger.ts';
import { buildManifest, loadPrereg, type Prereg } from '../runner/run.ts';

/**
 * prices-2026-11-07 (internal-task) is prices-2026-11-04 plus one row, openai:gpt-6-astra, at the rates the metering ledger has
 * charged since 2026-10-22, so the HE-PIN-002 preflight admits the frontier models the ledger already prices.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; rows: Record<string, unknown>[] };
const tmp = mkdtempSync(join(tmpdir(), 'prices-2026-11-07-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('prices-2026-11-07', () => {
  test('is the table model-pricing.ts reads, and holds every 2026-11-04 row unchanged plus gpt-6-astra', () => {
    expect(PRICE_TABLE_FILE).toBe('prices-2026-11-07.json');
    const before = read('prices-2026-11-04.json'), now = read('prices-2026-11-07.json'); // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-04.json the new table is checked against the table it replaces
    expect(now.date).toBe('2026-11-07');
    const added = now.rows.filter(r => !before.rows.some(b => b.provider === r.provider && b.model === r.model));
    expect(added.map(r => `${r.provider}:${r.model}`)).toEqual(['openai:gpt-6-astra']);
    expect(now.rows.filter(r => !added.includes(r))).toEqual(before.rows);
  });

  test('the gpt-6-astra row carries the ledger\'s rates and its 272K long-prompt tier', () => {
    const ledger = CHAT_PRICE_OVERRIDES['openai:gpt-6-astra']!;
    expect(CANONICAL_PRICING['openai:gpt-6-astra']).toEqual({
      input: ledger.input, output: ledger.output, cache_read: ledger.cache_read, cache_write: ledger.cache_write,
      long_prompt: { threshold_tokens: ledger.long!.above_input_tokens, input: ledger.long!.input, output: ledger.long!.output, cache_read: ledger.long!.cache_read, cache_write: ledger.long!.cache_write },
    });
    expect(CANONICAL_PRICING['openai:gpt-6-astra']).toMatchObject({ input: 10, output: 50, cache_read: 1, cache_write: 12.5, long_prompt: { threshold_tokens: 272_000, input: 20, output: 75 } });
  });

  test('the price table and the ledger both admit openai:gpt-6-astra and anthropic:claude-fable-5-1', () => {
    for (const id of ['openai:gpt-6-astra', 'anthropic:claude-fable-5-1']) {
      expect(canonicalLookup(id)).toBeDefined();
      expect(chatPrice(id)).toBeDefined();
    }
    expect(priceRequest('https://api.openai.com/v1/responses', { model: 'gpt-6-astra', input: 'hi', max_output_tokens: 100 })).toMatchObject({ model: 'gpt-6-astra', input: 10, output: 50 });
    expect(priceRequest('https://api.anthropic.com/v1/messages', { model: 'claude-fable-5-1', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })).toMatchObject({ model: 'claude-fable-5-1', input: 10, output: 50 });
  });

  test('a preregistration with gpt-6-astra and claude-fable-5-1 cells passes the HE-PIN-002 preflight and gets a priced ceiling', () => {
    const cell = (id: string, model: string) => ({ id, harness: 'openclaw', model, slice: 'hello' as const, split: 'dev' as const, repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } });
    const p: Prereg = { schema_version: 1, run_id: 'prices-2026-11-07', question: 'q', tasks: { hello: ['hello'] }, cells: [cell('astra', 'openai:gpt-6-astra'), cell('fable', 'anthropic:claude-fable-5-1')],
      wall_clock_s: { hello: 600 }, spend_cap_usd: 10, drop_order: [], minimum_v01: [] };
    const file = join(tmp, 'prereg.json');
    writeFileSync(file, JSON.stringify(p));
    const { prereg, sha256 } = loadPrereg(file);
    const m = buildManifest(prereg, sha256, '2026-11-07T00:00:00Z');
    // 100,000 input tokens at $10 plus 10,000 output tokens at $50 per million: $1.50 a trial for both models.
    expect(m.per_cell_ceiling_usd.astra).toBeCloseTo(1.5, 10);
    expect(m.per_cell_ceiling_usd.fable).toBeCloseTo(1.5, 10);
  });
});
