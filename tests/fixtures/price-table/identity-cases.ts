/**
 * The price identity cases: a fixed set of requests priced through the
 * chat price table (runner/pricing/model-pricing.ts) and through the
 * metering ledger's chat path (runner/ledger/budget-ledger.ts chatPrice,
 * usageCost and reservationUsd), which falls back to that table.
 *
 * generate-identity.ts ran this once against origin/main before the table
 * moved into runner/pricing/prices-<date>.json and wrote identity.json;
 * tests/price-table.test.ts prices the same requests with the current code
 * and compares. Do not regenerate identity.json to make that test pass: an
 * intended price change is a new dated table and its own reviewed fixture.
 */
import { ANTHROPIC_CACHE_READ_MULT, ANTHROPIC_CACHE_READ_MULT_OVERRIDES, ANTHROPIC_CACHE_WRITE_1H_MULT, ANTHROPIC_CACHE_WRITE_5M_MULT,
  ANTHROPIC_LONG_PROMPT_THRESHOLD_TOKENS, CANONICAL_PRICING, canonicalLookup, priceAtPromptSize } from '../../../runner/pricing/model-pricing.ts';
import { chatPrice, reservationUsd, usageCost, type RequestPrice } from '../../../runner/ledger/budget-ledger.ts';
import { splitProviderModelId } from '../../../runner/pricing/model-id.ts';

export interface IdentityRequest { input: number; output: number; cache_read: number; cache_write: number; cache_write_1h: number }
export interface IdentityCase { id: string; model: string | null; row: string | null; request: IdentityRequest }

const req = (input: number, output: number, cache_read = 0, cache_write = 0, cache_write_1h = 0): IdentityRequest =>
  ({ input, output, cache_read, cache_write, cache_write_1h });

const GENERIC: Record<string, IdentityRequest> = {
  small: req(1_200, 800),
  'small-cached': req(1_200, 800, 30_000, 4_000, 1_000),
  large: req(300_000, 8_000),
  'large-cached': req(220_000, 8_000, 60_000, 20_000, 5_000),
};

function tiered(threshold: number): Record<string, IdentityRequest> {
  return {
    'at-threshold': req(threshold, 1_000),
    'above-threshold': req(threshold + 1, 1_000),
    'at-threshold-cached': req(threshold - 30_000, 1_000, 20_000, 10_000, 2_000),
    'above-threshold-cached': req(threshold - 29_999, 1_000, 20_000, 10_000, 2_000),
  };
}

/** Other spellings of a row, and ids that must miss. `row` is the canonical key the id should resolve to, or null. */
const ALIASES: [string | null, string | null][] = [
  ['claude-opus-5-5', 'anthropic:claude-opus-5-5'],
  ['claude-haiku-5-5', 'anthropic:claude-haiku-5-5'],
  ['anthropic/claude-sonnet-4-6', 'anthropic:claude-sonnet-4-6'],
  ['openai/gpt-6.1-sol', 'openai:gpt-6.1-sol'],
  ['ANTHROPIC:CLAUDE-OPUS-5-5', 'anthropic:claude-opus-5-5'],
  ['Anthropic/Claude-Fable-5-1', 'anthropic:claude-fable-5-1'],
  ['together:meta-llama/llama-3.3-70b-instruct-turbo', 'together:meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  ['together/meta-llama/Llama-3.3-70B-Instruct-Turbo', 'together:meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  ['  claude-opus-5  ', 'anthropic:claude-opus-5'],
  ['claude-haiku-4-5-20251001', 'anthropic:claude-haiku-4-5-20251001'],
  ['particle/particle-1', 'particle:particle-1'],
  ['claude-3-5-haiku-20241022', 'anthropic:claude-3-5-haiku-20241022'],
  ['anthropic:claude-opus-9', null],
  ['gpt-5', null],
  ['openrouter:anthropic/claude-opus-5-5', null],
  ['openai:gpt-6.1-sol-2026-10-06', null],
  ['deepseek:deepseek-v9', null],
  ['', null],
  [null, null],
];

/** Every row of the table as it stands, each with the generic requests and, for a long-prompt row, the threshold requests; then the aliases. */
export function buildCases(): IdentityCase[] {
  const out: IdentityCase[] = [];
  for (const [key, pricing] of Object.entries(CANONICAL_PRICING)) {
    const requests = { ...GENERIC, ...(pricing.long_prompt ? tiered(pricing.long_prompt.threshold_tokens) : {}) };
    for (const [name, request] of Object.entries(requests)) out.push({ id: `${key} ${name}`, model: key, row: key, request });
  }
  for (const [model, row] of ALIASES) {
    const requests = { small: GENERIC.small, 'small-cached': GENERIC['small-cached'], 'large-cached': GENERIC['large-cached'],
      ...(row && CANONICAL_PRICING[row]?.long_prompt ? tiered(CANONICAL_PRICING[row].long_prompt!.threshold_tokens) : {}) };
    for (const [name, request] of Object.entries(requests)) out.push({ id: `alias ${JSON.stringify(model)} ${name}`, model, row, request });
  }
  return out;
}

/** What the current code charges for one case: the row, the tier the request pays, the table's cost, and the ledger's settled and reserved cost. */
export function evaluate(model: string | null, r: IdentityRequest) {
  const pricing = canonicalLookup(model) ?? null;
  const prompt = r.input + r.cache_read + r.cache_write;
  const rates = pricing ? priceAtPromptSize(pricing, prompt) : null;
  const cost_usd = rates
    ? (r.input * rates.input + r.cache_read * (rates.cache_read ?? rates.input) + r.cache_write * (rates.cache_write ?? rates.input) + r.output * rates.output) / 1e6
    : null;
  const ledgerRow = model === null ? undefined : chatPrice(model);
  let ledger: { usage_usd: number | null; reservation_usd: number } | null = null;
  if (ledgerRow) {
    const long = 'long' in ledgerRow ? ledgerRow.long : undefined;
    const price: RequestPrice = {
      provider: splitProviderModelId(model).provider ?? 'anthropic', model: model ?? '', kind: 'chat',
      input: ledgerRow.input, output: ledgerRow.output, cache_read: ledgerRow.cache_read, cache_write: ledgerRow.cache_write,
      cacheWritePremium: r.cache_write > 0 && ledgerRow.cache_write !== undefined && ledgerRow.cache_write > ledgerRow.input,
      ...(long ? { long } : {}), inputTokens: prompt, maxOutputTokens: r.output,
    };
    const usage = { input_tokens: r.input, output_tokens: r.output, cache_read_input_tokens: r.cache_read, cache_creation_input_tokens: r.cache_write,
      ...(r.cache_write_1h ? { cache_creation: { ephemeral_1h_input_tokens: r.cache_write_1h } } : {}) };
    ledger = { usage_usd: usageCost(price, { usage })?.usd ?? null, reservation_usd: reservationUsd(price) };
  }
  return { pricing, rates, cost_usd, ledger };
}

/** The exported constants and the whole table, as the current code exposes them. */
export function snapshotExports() {
  return {
    ANTHROPIC_LONG_PROMPT_THRESHOLD_TOKENS, ANTHROPIC_CACHE_READ_MULT, ANTHROPIC_CACHE_WRITE_5M_MULT, ANTHROPIC_CACHE_WRITE_1H_MULT,
    ANTHROPIC_CACHE_READ_MULT_OVERRIDES, CANONICAL_PRICING,
  };
}
