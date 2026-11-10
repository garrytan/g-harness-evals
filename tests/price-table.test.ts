import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ANTHROPIC_CACHE_READ_MULT, ANTHROPIC_CACHE_READ_MULT_OVERRIDES, ANTHROPIC_CACHE_WRITE_5M_MULT, ANTHROPIC_LONG_PROMPT_THRESHOLD_TOKENS, CANONICAL_PRICING, PRICE_TABLE_FILE,
  canonicalLookup, parsePriceTable, priceTableIdentity } from '../runner/pricing/model-pricing.ts';
import { chatPrice, priceRequest } from '../runner/ledger/budget-ledger.ts';
import { RunnerError } from '../runner/errors.ts';
import { evaluate, snapshotExports, type IdentityCase } from './fixtures/price-table/identity-cases.ts';

/**
 * The dated price table (runner/pricing/prices-<date>.json) replaced the
 * rows hard-coded in model-pricing.ts. identity.json holds what main
 * (0b1f3cd62) charged for a fixed set of requests: every row, with and
 * without cache tokens, below and above each long-prompt threshold, other
 * spellings of rows and unknown ids, through the table and through the
 * metering ledger's chat path. Every case must come out identical.
 */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/price-table/identity.json', import.meta.url), 'utf8')) as {
  generated_from: string;
  exports: ReturnType<typeof snapshotExports>;
  cases: (IdentityCase & { expected: ReturnType<typeof evaluate> })[];
};

/**
 * The only rows allowed to differ, and only by floating-point noise: main
 * computed their cache-read rate as input x 0.1 (3 x 0.1 is
 * 0.30000000000000004 in binary floating point) where the table states the
 * published decimal (0.3). The difference is below 1e-15 of the price.
 */
const FLOAT_NOISE_ROWS = ['anthropic:claude-sonnet-4-6', 'anthropic:claude-haiku-5-5', 'anthropic:claude-3-5-sonnet-20241022', 'anthropic:claude-3-5-haiku-20241022'];

/** Rows a later dated table added, each reviewed in its own test below; every other row is held to the fixture. prices-2026-11-07: gpt-6-astra (internal-task); prices-2026-11-09: claude-fable-5-2. */
const ADDED_AFTER_FIXTURE = ['openai:gpt-6-astra', 'anthropic:claude-fable-5-2'];

/** Same shape and keys; every number within `relTol` of its counterpart (0 means bit-identical). */
function close(actual: unknown, expected: unknown, relTol: number, path = ''): string[] {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(actual - expected) <= relTol * Math.max(Math.abs(actual), Math.abs(expected)) ? [] : [`${path}: ${actual} vs ${expected}`];
  }
  if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
    const ka = Object.keys(actual).sort(), ke = Object.keys(expected).sort();
    if (ka.join() !== ke.join()) return [`${path}: keys ${ka} vs ${ke}`];
    return ke.flatMap(k => close((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], relTol, `${path}.${k}`));
  }
  return actual === expected ? [] : [`${path}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`];
}

describe('the dated price table changes no effective price', () => {
  test('the fixture came from main and covers every row, both long-prompt tiers, aliases and unknown ids', () => {
    expect(fixture.generated_from).toBe('0b1f3cd6243d71e292e529ae07402793f7b47526');
    expect(fixture.cases.length).toBe(229);
    const rows = new Set(fixture.cases.map(c => c.row));
    for (const key of Object.keys(fixture.exports.CANONICAL_PRICING)) expect(rows.has(key)).toBe(true);
    expect(fixture.cases.some(c => c.id.includes('above-threshold-cached'))).toBe(true);
    expect(fixture.cases.some(c => c.row === null && c.expected.pricing === null)).toBe(true);
  });

  test('every request prices identically through the table and the ledger', () => {
    const changed: string[] = [];
    for (const c of fixture.cases) {
      const actual = evaluate(c.model, c.request);
      if (JSON.stringify(actual) === JSON.stringify(c.expected)) continue;
      changed.push(c.id);
      expect(FLOAT_NOISE_ROWS).toContain(c.row ?? 'unknown id');
      expect(close(actual, c.expected, 1e-15)).toEqual([]);
    }
    expect(changed.length).toBe(33);
  });

  test('the table holds the same keys in the same order, apart from rows added by later dated tables, and the exported constants are unchanged', () => {
    const { CANONICAL_PRICING: before, ...constants } = fixture.exports;
    expect(Object.keys(CANONICAL_PRICING).filter(k => !ADDED_AFTER_FIXTURE.includes(k))).toEqual(Object.keys(before));
    for (const key of ADDED_AFTER_FIXTURE) expect(Object.hasOwn(before, key)).toBe(false);
    for (const [key, row] of Object.entries(before)) {
      expect(close(CANONICAL_PRICING[key], row, FLOAT_NOISE_ROWS.includes(key) ? 1e-15 : 0, key)).toEqual([]);
    }
    const { CANONICAL_PRICING: _now, ANTHROPIC_CACHE_READ_MULT_OVERRIDES: nowOverrides, ...now } = snapshotExports();
    const { ANTHROPIC_CACHE_READ_MULT_OVERRIDES: beforeOverrides, ...beforeConstants } = constants;
    expect(now).toEqual(beforeConstants);
    expect(Object.fromEntries(Object.entries(nowOverrides as Record<string, number>).filter(([k]) => !ADDED_AFTER_FIXTURE.includes(k)))).toEqual(beforeOverrides);
  });
});

describe('the price table file', () => {
  const text = readFileSync(new URL(`../runner/pricing/${PRICE_TABLE_FILE}`, import.meta.url), 'utf8');
  const table = JSON.parse(text) as { date: string; rows: Record<string, unknown>[] };

  test('is dated in its name and body, and every row names its source and date', () => {
    expect(PRICE_TABLE_FILE).toBe(`prices-${table.date}.json`);
    for (const row of table.rows) {
      expect(String(row.source_url)).toStartWith('https://');
      expect(String(row.source_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(row.source_date) <= table.date).toBe(true);
      expect(['row', 'ledger', 'file-header', 'supplied']).toContain(String(row.source_basis));
    }
  });

  test('priceTableIdentity names the file and the sha256 of its bytes', () => {
    const sha256 = createHash('sha256').update(readFileSync(new URL(`../runner/pricing/${PRICE_TABLE_FILE}`, import.meta.url))).digest('hex');
    expect(priceTableIdentity()).toEqual({ file: `runner/pricing/${PRICE_TABLE_FILE}`, sha256 });
  });

  test('every anthropic: row follows the cache multipliers, with the listed cache-read exceptions', () => {
    const cacheReadExceptions: Record<string, number> = { 'anthropic:claude-fable-5-1': 0.025, 'anthropic:claude-fable-5-2': 0.025, 'anthropic:claude-opus-5-5': 0.05 };
    expect(ANTHROPIC_CACHE_READ_MULT_OVERRIDES).toEqual(cacheReadExceptions);
    for (const [key, p] of Object.entries(CANONICAL_PRICING).filter(([k]) => k.startsWith('anthropic:'))) {
      if (p.long_prompt) expect(p.long_prompt.threshold_tokens).toBe(ANTHROPIC_LONG_PROMPT_THRESHOLD_TOKENS);
      for (const tier of [p, p.long_prompt].filter(t => t !== undefined)) {
        expect(tier.cache_write).toBeCloseTo(tier.input * ANTHROPIC_CACHE_WRITE_5M_MULT, 12);
        expect(tier.cache_read).toBeCloseTo(tier.input * (tier === p ? cacheReadExceptions[key] ?? ANTHROPIC_CACHE_READ_MULT : ANTHROPIC_CACHE_READ_MULT), 12);
      }
    }
  });

  test('a malformed table is refused', () => {
    const row = { provider: 'p', model: 'm', input: 1, output: 2, cache_write: null, cache_read: null, long_prompt: null, source_url: 'https://example.com', source_date: '2026-11-04' };
    const parse = (...rows: object[]) => parsePriceTable(JSON.stringify({ rows }));
    expect(parse(row)).toEqual({ 'p:m': { input: 1, output: 2 } });
    expect(() => parse()).toThrow('no rows');
    expect(() => parse(row, { ...row, model: 'M' })).toThrow('duplicate key');
    expect(() => parse({ ...row, input: -1 })).toThrow('input must be');
    expect(() => parse({ ...row, output: undefined })).toThrow('output must be');
    expect(() => parse({ ...row, cache_read: '0.1' })).toThrow('cache_read must be');
    expect(() => parse({ ...row, source_url: 'http://example.com' })).toThrow('source_url');
    expect(() => parse({ ...row, source_date: undefined })).toThrow('source_date');
    expect(() => parse({ ...row, long_prompt: { threshold_tokens: 0, input: 1, output: 1, cache_read: null, cache_write: null } })).toThrow('threshold_tokens');
    expect(() => parse({ ...row, long_prompt: { threshold_tokens: 10, input: 1, output: 1 } })).toThrow('long_prompt.cache_read');
    expect(() => parse(null as unknown as object)).toThrow('row 0 must be an object');
    expect(() => parse(row, [] as unknown as object)).toThrow('row 1 must be an object');
    expect(() => parse({ ...row, source_date: '2026-13-45' })).toThrow('source_date must be a real');
    expect(() => parse({ ...row, source_date: '2026-02-30' })).toThrow('source_date must be a real');
    expect(parse({ ...row, source_date: '2024-02-29' })).toEqual({ 'p:m': { input: 1, output: 2 } });
    expect(() => parse({ ...row, long_prompt: { threshold_tokens: -5, input: 1, output: 1, cache_read: null, cache_write: null } })).toThrow('threshold_tokens');
    expect(() => parse({ ...row, long_prompt: { threshold_tokens: 10, input: 0, output: 0, cache_read: 0, cache_write: null } })).toThrow('long_prompt rates must not all be zero');
  });

  test('a malformed table is a RunnerError HE-PIN-004 that names the file', () => {
    for (const text of ['{', '{"rows":[]}', 'null', '{"rows":[null]}']) {
      try { parsePriceTable(text); throw new Error('accepted'); }
      catch (e) {
        expect(e).toBeInstanceOf(RunnerError);
        expect((e as RunnerError).code).toBe('HE-PIN-004');
        expect((e as Error).message).toContain(`runner/pricing/${PRICE_TABLE_FILE}`);
      }
    }
  });

  test('Object.prototype names are unknown models, so nothing reserves at a NaN price', () => {
    for (const id of ['toString', '__proto__', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(canonicalLookup(id)).toBeUndefined();
      expect(chatPrice(id)).toBeUndefined();
      expect(() => priceRequest('https://api.anthropic.com/v1/messages', { model: id, max_tokens: 10, messages: [] })).toThrow('no chat price');
    }
  });

  test('pregate maps the table, model-pricing.ts and budget-ledger.ts to this test', () => {
    const deps = (JSON.parse(readFileSync(new URL('../.gstack/pregate.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string[]> }).dependencies;
    for (const path of ['runner/pricing/prices-*.json', 'runner/pricing/model-pricing.ts', 'runner/ledger/budget-ledger.ts'])
      expect(deps[path]).toContain('tests/price-table.test.ts');
  });
});
