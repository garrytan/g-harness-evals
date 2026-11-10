/**
 * model-pricing.ts: chat and completion list prices (USD per 1M tokens),
 * read from one dated JSON table beside this file.
 *
 * The rates live in runner/pricing/prices-<date>.json (PRICE_TABLE_FILE):
 * one row per provider:model id with input, output, cache write, cache read,
 * the long-prompt tier where a provider bills one, and the source URL and
 * date each price was read from. Change a price by adding a new dated file
 * and pointing PRICE_TABLE_FILE at it, never by editing a dated file in
 * place; priceTableIdentity() gives the file and its sha256 so a run or a
 * bundle can record which table priced it. The metering ledger
 * (runner/ledger/budget-ledger.ts chatPrice) keeps its own override rows and
 * falls back to this table.
 *
 * Scope: PAID CLOUD chat models only. Free/local providers (llama-server,
 * zero-cost rerankers) are intentionally absent: callers treat those as
 * zero-cost elsewhere. Embeddings live in embedding-pricing.ts (a single
 * per-token rate with its own lookup rules).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RunnerError } from '../errors.ts';
import { splitProviderModelId } from './model-id.ts';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /**
   * #4218 — USD per 1M prompt-cache-READ tokens. Optional: present only for
   * providers whose published cache pricing we've verified (Anthropic:
   * 0.1x input by default; Fable 5.1: 0.025x). Consumers that
   * price cache tokens fall back to the input rate when absent (conservative
   * over-estimate for reads).
   */
  cache_read?: number;
  /**
   * #4218 — USD per 1M prompt-cache-WRITE tokens at the default 5-minute
   * TTL (Anthropic: 1.25x input). The 1-hour TTL bills 2x input
   * (ANTHROPIC_CACHE_WRITE_1H_MULT): harness-evals' usageCost prices the
   * `usage.cache_creation.ephemeral_1h_input_tokens` Anthropic reports at
   * 2x input and the rest of `cache_creation_input_tokens` at this rate,
   * and reserves at 2x input when a request sets `cache_control.ttl: "1h"`.
   * Fall back to input rate when absent (under-estimate for writes;
   * documented, not silent).
   */
  cache_write?: number;
  /**
   * #6448 item 1 — long-prompt tier. Some providers bill the WHOLE request at
   * higher rates once its prompt exceeds `threshold_tokens` input tokens
   * (Anthropic's long-context pricing: Haiku 5.5 bills 5x on input, cache
   * and output above 100K). `priceAtPromptSize()` selects this tier from the
   * request's total input tokens (cache reads and writes included; they are
   * part of the prompt). Absent when the provider publishes one flat rate.
   */
  long_prompt?: LongPromptTier;
}

/** The rates a request pays once its prompt exceeds `threshold_tokens` (strictly greater). */
export interface LongPromptTier {
  threshold_tokens: number;
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

/**
 * Anthropic's long-context boundary: a prompt of MORE than 100,000 input
 * tokens bills at the long-prompt tier (platform.claude.com/docs/en/about-claude/pricing,
 * checked 2026-10-11). Exactly 100,000 is still the base tier.
 */
export const ANTHROPIC_LONG_PROMPT_THRESHOLD_TOKENS = 100_000;

/**
 * The flat rates a request of `inputTokens` prompt tokens pays: the
 * `long_prompt` tier when the prompt exceeds its threshold, else the base
 * row. Returns a tier-free `ModelPricing` so every consumer prices with one
 * `input`/`output`/`cache_*` set and cannot apply the base rate to part of a
 * long prompt. A missing or non-finite size prices at the base tier.
 */
export function priceAtPromptSize(pricing: ModelPricing, inputTokens: number | null | undefined): ModelPricing {
  const tier = pricing.long_prompt;
  if (!tier || typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens <= tier.threshold_tokens) {
    if (!tier) return pricing;
    const { long_prompt: _omit, ...base } = pricing;
    return base;
  }
  return {
    input: tier.input,
    output: tier.output,
    ...(tier.cache_read !== undefined ? { cache_read: tier.cache_read } : {}),
    ...(tier.cache_write !== undefined ? { cache_write: tier.cache_write } : {}),
  };
}

/** Anthropic prompt-cache multipliers (verified 2026-08 against published
 * provider pricing): reads bill 0.1x the base input rate; 5-minute-TTL
 * writes bill 1.25x. The price table states every row's cache rates;
 * tests/price-table.test.ts asserts each anthropic: row still follows them. */
export const ANTHROPIC_CACHE_READ_MULT = 0.1;
export const ANTHROPIC_CACHE_WRITE_5M_MULT = 1.25;
/** Anthropic 1-hour-TTL cache writes bill 2x the base input rate. */
export const ANTHROPIC_CACHE_WRITE_1H_MULT = 2;

/** The dated price table this module reads, in runner/pricing/. */
export const PRICE_TABLE_FILE = 'prices-2026-11-09.json';
const PRICE_TABLE_BYTES = readFileSync(new URL(`./${PRICE_TABLE_FILE}`, import.meta.url));

/** The price table's repository path and the sha256 of its bytes, for a run or bundle to record. */
export function priceTableIdentity(): { file: string; sha256: string } {
  return { file: `runner/pricing/${PRICE_TABLE_FILE}`, sha256: createHash('sha256').update(PRICE_TABLE_BYTES).digest('hex') };
}

/**
 * Parse a price table into canonical rows keyed `provider:model`, in file
 * order. Throws HE-PIN-004 on anything a price could silently go wrong with:
 * text that is not JSON, a row that is not an object, a missing or negative
 * rate, a duplicate or case-colliding key, a long-prompt tier without a
 * positive whole threshold or with every rate zero, or a row with no source
 * URL or a source date that is not a real calendar day.
 * A null cache rate leaves the field absent, so consumers fall back to input.
 */
export function parsePriceTable(text: string, file = PRICE_TABLE_FILE): Record<string, ModelPricing> {
  const refuse = (why: string) => new RunnerError('HE-PIN-004', `price table runner/pricing/${file}: ${why}; fix: correct the table, or add a new dated prices-<date>.json`);
  let table: { rows?: unknown } | null;
  try { table = JSON.parse(text) as { rows?: unknown } | null; } catch (e) { throw refuse(`not JSON (${(e as Error).message})`); }
  if (!table || typeof table !== 'object' || !Array.isArray(table.rows) || table.rows.length === 0) throw refuse('no rows');
  const out: Record<string, ModelPricing> = {};
  const folded = new Set<string>();
  for (const [index, raw] of (table.rows as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw refuse(`row ${index} must be an object`);
    const row = raw as Record<string, unknown>;
    const key = `${row.provider}:${row.model}`;
    const bad = (why: string) => refuse(`${key}: ${why}`);
    if (typeof row.provider !== 'string' || !row.provider || typeof row.model !== 'string' || !row.model) throw bad('provider and model must be non-empty strings');
    if (folded.has(key.toLowerCase())) throw bad('duplicate key (case-insensitive)');
    folded.add(key.toLowerCase());
    if (typeof row.source_url !== 'string' || !row.source_url.startsWith('https://')) throw bad('source_url must be an https URL');
    const date = row.source_date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(Date.parse(`${date}T00:00:00Z`) || 0).toISOString().slice(0, 10) !== date)
      throw bad('source_date must be a real YYYY-MM-DD date');
    const rates = (r: Record<string, unknown>, where: string) => {
      const rate = (field: string, optional: boolean) => {
        const v = r[field];
        if (optional && v === null) return undefined;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(`${where}${field} must be a non-negative number${optional ? ' or null' : ''}`);
        return v;
      };
      const cacheRead = rate('cache_read', true);
      const cacheWrite = rate('cache_write', true);
      return { input: rate('input', false)!, output: rate('output', false)!,
        ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}), ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}) };
    };
    const pricing: ModelPricing = rates(row, '');
    if (row.long_prompt !== null) {
      const tier = row.long_prompt as Record<string, unknown> | undefined;
      if (!tier || typeof tier !== 'object') throw bad('long_prompt must be an object or null');
      if (!Number.isInteger(tier.threshold_tokens) || (tier.threshold_tokens as number) <= 0) throw bad('long_prompt.threshold_tokens must be a positive whole number');
      const long = rates(tier, 'long_prompt.');
      if ([long.input, long.output, long.cache_read ?? 0, long.cache_write ?? 0].every(v => v === 0)) throw bad('long_prompt rates must not all be zero');
      pricing.long_prompt = { threshold_tokens: tier.threshold_tokens as number, ...long };
    }
    out[key] = pricing;
  }
  return out;
}

/**
 * Canonical price table, read from PRICE_TABLE_FILE. Keys are
 * provider-prefixed (`provider:model`), matching the exact id strings
 * consumers pass. One physical model may carry more than one key when a
 * provider ships multiple id spellings (e.g. `google:gemini-2.0-flash` plus
 * the legacy `google:gemini-2-flash` alias); the table keeps them in lockstep.
 */
export const CANONICAL_PRICING: Record<string, ModelPricing> = parsePriceTable(PRICE_TABLE_BYTES.toString('utf8'));

/** Per-model cache-read multipliers where an anthropic: row's cache reads
 *  are not ANTHROPIC_CACHE_READ_MULT (0.1x) of its input rate, derived from
 *  the table (Fable 5.1: 0.025x; Opus 5.5: 0.05x). */
export const ANTHROPIC_CACHE_READ_MULT_OVERRIDES: Record<string, number> = Object.fromEntries(
  Object.entries(CANONICAL_PRICING)
    .filter(([key, p]) => key.startsWith('anthropic:') && p.cache_read !== undefined && Math.abs(p.cache_read - p.input * ANTHROPIC_CACHE_READ_MULT) > 1e-9)
    .map(([key, p]) => [key, p.cache_read! / p.input]),
);

/**
 * Resolve a model id to its canonical pricing, or `undefined` on miss.
 *
 * Accepts bare (`claude-opus-4-8`), colon (`anthropic:claude-opus-4-8`), and
 * slash (`anthropic/claude-opus-4-8`) forms. Bare ids default to the
 * `anthropic:` provider (matching the historical bare-key Anthropic tables);
 * non-Anthropic bare ids therefore miss, preserving the prior null-return
 * contract for ids like `gpt-5`.
 *
 * Nested OpenRouter ids (`openrouter:anthropic/claude-...`) intentionally MISS:
 * splitProviderModelId yields provider `openrouter`, model
 * `anthropic/claude-...`, and `openrouter:anthropic/claude-...` is not a
 * canonical key. OpenRouter markup ≠ native pricing, so we never reprice it as
 * the inner vendor.
 */
export function canonicalLookup(
  modelId: string | null | undefined,
): ModelPricing | undefined {
  if (!modelId) return undefined;
  // 1. Exact key — colon form, already-canonical ids, and slash-bearing model
  //    tails carried verbatim as keys (e.g. together:.../Llama-3.3-70B-...).
  const direct = ownRow(CANONICAL_PRICING, modelId);
  if (direct) return direct;
  // 2. Normalize bare/slash via the shared splitter (colon-first precedence).
  const { provider, model } = splitProviderModelId(modelId);
  if (!model) return undefined;
  const key = provider ? `${provider}:${model}` : `anthropic:${model}`;
  const normalized = ownRow(CANONICAL_PRICING, key);
  if (normalized) return normalized;
  // 3. #4123 (TODOS P3 case-sensitivity): case-insensitive fallback, folding
  //    BOTH sides — some canonical keys carry cased model tails verbatim
  //    (Llama-3.3-70B-...), so folding only the probe would miss those. Exact
  //    matches above stay first, so all-lowercase lookups pay nothing new.
  //    Safe only while no two canonical keys collide case-insensitively,
  //    which parsePriceTable refuses.
  const folded = canonicalFoldedView();
  return ownRow(folded, modelId.toLowerCase()) ?? ownRow(folded, key.toLowerCase());
}

/** A table's own row for a key, so ids such as `toString` or `__proto__` miss instead of returning Object.prototype members. */
export function ownRow<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

let _canonicalFoldedView: Record<string, ModelPricing> | null = null;
function canonicalFoldedView(): Record<string, ModelPricing> {
  if (!_canonicalFoldedView) {
    _canonicalFoldedView = {};
    for (const [k, v] of Object.entries(CANONICAL_PRICING)) {
      _canonicalFoldedView[k.toLowerCase()] = v;
    }
  }
  return _canonicalFoldedView;
}
