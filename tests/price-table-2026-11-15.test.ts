import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, parsePriceTable, parseToolFees, TOOL_FEES } from '../runner/pricing/model-pricing.ts';

/**
 * prices-2026-11-15 (internal-task) is prices-2026-11-10 with every row unchanged plus `tool_fees`: the per-call fees of the
 * provider-hosted web tools the metering proxy charges on install slots, each read from its source on 2026-11-15.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; about: string[]; rows: unknown[]; tool_fees?: Record<string, unknown>[] };

describe('prices-2026-11-15', () => {
  test('was the table model-pricing.ts read until prices-2026-11-16: every prices-2026-11-10 row and about line unchanged, plus tool_fees', () => {
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json this test accepts the table it covers and the table that replaced it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-16.json this test accepts the table it covers and the tables that replaced it
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-17.json this test accepts the table it covers and the table that replaced it
    expect(['prices-2026-11-15.json', 'prices-2026-11-16.json', 'prices-2026-11-17.json', 'prices-2026-11-20.json']).toContain(PRICE_TABLE_FILE);
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-10.json the new table is checked against the table it replaces
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json this test reads the table it covers by name
    const before = read('prices-2026-11-10.json'), now = read('prices-2026-11-15.json');
    expect(now.date).toBe('2026-11-15');
    expect(now.rows).toEqual(before.rows);
    expect(now.about.slice(0, before.about.length)).toEqual(before.about);
    expect(now.about).toHaveLength(before.about.length + 1);
    expect(before.tool_fees).toBeUndefined();
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json this test reads the table it covers by name
    expect(parsePriceTable(readFileSync(new URL('../runner/pricing/prices-2026-11-15.json', import.meta.url), 'utf8'), 'prices-2026-11-15.json')).toEqual(parsePriceTable(readFileSync(new URL('../runner/pricing/prices-2026-11-10.json', import.meta.url), 'utf8'), 'prices-2026-11-10.json')); // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-10.json the replaced table still parses to today's canonical pricing
  });

  test('prices Anthropic web search at $10 and web fetch at $0, and OpenAI web search at $10, per 1,000 calls, each with its source', () => {
    expect(TOOL_FEES).toEqual({ 'anthropic:web_search': 0.01, 'anthropic:web_fetch': 0, 'openai:web_search': 0.01 });
    // pregate-literal: PRICE_TABLE_FILE=prices-2026-11-15.json this test reads the table it covers by name
    const sources = Object.fromEntries(read('prices-2026-11-15.json').tool_fees!.map((r) => [`${r.provider}:${r.tool}`, [r.source_url, r.source_date, r.source_basis]]));
    expect(sources).toEqual({
      'anthropic:web_search': ['https://platform.claude.com/docs/en/about-claude/pricing', '2026-11-15', 'fetched'],
      'anthropic:web_fetch': ['https://platform.claude.com/docs/en/about-claude/pricing', '2026-11-15', 'fetched'],
      'openai:web_search': ['https://developers.openai.com/api/docs/pricing', '2026-11-15', 'fetched'],
    });
  });

  test('a malformed tool_fees list is refused', () => {
    const row = { provider: 'p', tool: 'web_search', usd_per_1000_calls: 10, source_url: 'https://example.com', source_date: '2026-11-15' };
    const parse = (fees: unknown) => parseToolFees(JSON.stringify({ rows: [], tool_fees: fees }));
    expect(parseToolFees(JSON.stringify({ rows: [] }))).toEqual({});
    expect(parse([row])).toEqual({ 'p:web_search': 0.01 });
    expect(() => parse({})).toThrow('tool_fees must be a list');
    expect(() => parse([row, row])).toThrow('duplicate key');
    expect(() => parse([{ ...row, usd_per_1000_calls: -1 }])).toThrow('usd_per_1000_calls');
    expect(() => parse([{ ...row, usd_per_1000_calls: undefined }])).toThrow('usd_per_1000_calls');
    expect(() => parse([{ ...row, source_url: 'http://example.com' }])).toThrow('source_url');
    expect(() => parse([{ ...row, source_date: '2026-02-30' }])).toThrow('source_date');
    expect(() => parse([{ ...row, tool: '' }])).toThrow('provider and tool');
    expect(() => parse([null])).toThrow('row 0 must be an object');
  });
});
