import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_PRICING, PRICE_TABLE_FILE, canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { chatPrice } from '../runner/ledger/budget-ledger.ts';
import { buildManifest, loadPrereg, type Prereg } from '../runner/run.ts';

/**
 * prices-2026-11-08 is prices-2026-11-07 plus one row, openrouter:deepseek/deepseek-v4.1-flash-1017, at the peak list rates of
 * OpenRouter's DeepSeek endpoint (the only endpoint the metering proxy lets an OpenRouter request reach), read from
 * openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints on 2026-11-08.
 */
const read = (file: string) => JSON.parse(readFileSync(new URL(`../runner/pricing/${file}`, import.meta.url), 'utf8')) as { date: string; about: string[]; rows: Record<string, unknown>[] };
const ROW = 'openrouter:deepseek/deepseek-v4.1-flash-1017';
const tmp = mkdtempSync(join(tmpdir(), 'prices-2026-11-08-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('prices-2026-11-08', () => {
  test('was the table model-pricing.ts read until prices-2026-11-10, and holds every 2026-11-07 row unchanged plus the OpenRouter DeepSeek row', () => {
    expect(['prices-2026-11-08.json', 'prices-2026-11-10.json']).toContain(PRICE_TABLE_FILE);
    const before = read('prices-2026-11-07.json'), now = read('prices-2026-11-08.json');
    expect(now.date).toBe('2026-11-08');
    const added = now.rows.filter(r => !before.rows.some(b => b.provider === r.provider && b.model === r.model));
    expect(added.map(r => `${r.provider}:${r.model}`)).toEqual([ROW]);
    expect(now.rows.filter(r => !added.includes(r))).toEqual(before.rows);
    expect(now.about.slice(0, before.about.length)).toEqual(before.about);
    expect(now.about.at(-1)).toContain('fetched');
  });

  test('the row carries the DeepSeek endpoint\'s peak rates, says off-peak billing is invisible, and is fetched from its source', () => {
    expect(CANONICAL_PRICING[ROW]).toEqual({ input: 0.3, output: 1.2, cache_read: 0.006 });
    const row = read('prices-2026-11-08.json').rows.at(-1)!;
    expect(row).toMatchObject({ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', cache_write: null, long_prompt: null, source_date: '2026-11-08', source_basis: 'fetched',
      source_url: 'https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints' });
    expect(String(row.note)).toContain('upper bound');
    expect(String(row.note)).toContain('usage.cost');
  });

  test('only the exact OpenRouter id is priced: no other OpenRouter spelling, suffix or direct DeepSeek id, and the ledger reads the same row', () => {
    expect(canonicalLookup(ROW)).toBeDefined();
    for (const id of ['openrouter:deepseek/deepseek-v4.1-flash', 'openrouter:deepseek/deepseek-v4.1-flash-1017:online', 'deepseek:deepseek-v4.1-flash-1017', 'openrouter:deepseek/deepseek-v4.1-flash-20261017']) {
      expect(canonicalLookup(id)).toBeUndefined();
    }
    expect(chatPrice(ROW)).toEqual(canonicalLookup(ROW));
  });

  test('a preregistration with the OpenRouter cell passes the HE-PIN-002 preflight and gets a priced ceiling', () => {
    const p: Prereg = { schema_version: 1, run_id: 'prices-2026-11-08', question: 'q', tasks: { hello: ['hello'] }, wall_clock_s: { hello: 600 }, spend_cap_usd: 10, drop_order: [], minimum_v01: [],
      cells: [{ id: 'ds', harness: 'hermes', model: ROW, slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1_000_000, output_tokens: 1_000_000 } }] };
    const file = join(tmp, 'prereg.json');
    writeFileSync(file, JSON.stringify(p));
    const { prereg, sha256 } = loadPrereg(file);
    // 1,000,000 input tokens at $0.30 plus 1,000,000 output tokens at $1.20.
    expect(buildManifest(prereg, sha256, '2026-11-08T00:00:00Z').per_cell_ceiling_usd.ds).toBeCloseTo(1.5, 10);
  });
});
