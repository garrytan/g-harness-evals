/**
 * A chat model with no ledger row of its own (CHAT_PRICE_OVERRIDES, HARNESS_CHAT_PRICES) is priced from the dated price
 * table, which carries its long-context tier as `long_prompt` (threshold_tokens). chatPrice hands it on as `long`
 * (above_input_tokens), the shape the native OpenAI, Anthropic and xAI reservation and metering read, so a prompt above
 * the threshold is reserved and billed at the long rates (internal-task-a). Before the fix the tier was dropped: internal-task-b's
 * GPT-6.2 Sol request of 272,001 input and 1,000 output tokens, priced from its table row alone, metered $0.554002
 * against OpenAI's list price of $1.103004. OpenAI requests reserve their input at the cache-write rate ($2.50 short,
 * $5 long for Sol), since any of it may be written to the cache.
 */
import { describe, expect, test } from 'bun:test';
import { CHAT_PRICE_OVERRIDES, chatPrice, priceRequest, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { CANONICAL_PRICING } from '../runner/pricing/model-pricing.ts';

const SOL = 'openai:gpt-6.2-sol';

/** Runs `fn` with Sol's ledger row removed, so Sol is priced from the price table as a table-only model would be. */
function tableOnlySol<T>(fn: () => T): T {
  const own = CHAT_PRICE_OVERRIDES[SOL];
  delete CHAT_PRICE_OVERRIDES[SOL];
  try { return fn(); } finally { CHAT_PRICE_OVERRIDES[SOL] = own; }
}

describe("chatPrice's price-table fallback keeps the long-prompt tier", () => {
  test('every table row with a long tier comes back with it as long, at the same threshold and rates', () => {
    const tiered = Object.entries(CANONICAL_PRICING).filter(([, row]) => row.long_prompt);
    expect(tiered.length).toBeGreaterThan(0);
    for (const [id, row] of tiered) {
      const { threshold_tokens, ...rates } = row.long_prompt!;
      const fromTable = id === SOL ? tableOnlySol(() => chatPrice(id)) : chatPrice(id);
      expect(fromTable?.long, id).toBeDefined();
      if (CHAT_PRICE_OVERRIDES[id] && id !== SOL) continue;
      expect(fromTable!.long, id).toEqual({ ...rates, above_input_tokens: threshold_tokens });
      expect('long_prompt' in fromTable!, id).toBe(false);
    }
  });

  test("Sol's table row prices exactly as its ledger row does", () => {
    expect(tableOnlySol(() => chatPrice(SOL))).toEqual(chatPrice(SOL)!);
  });

  test("internal-task's GPT-6.2 Sol Responses request above 272,000 tokens is reserved and metered at the long rates", () => {
    const usage = { input_tokens: 272_001, output_tokens: 1_000, input_tokens_details: { cached_tokens: 0 } };
    tableOnlySol(() => {
      const long = priceRequest('https://api.openai.com/v1/responses', { model: 'gpt-6.2-sol', input: 'x'.repeat(3 * 272_001), max_output_tokens: 1_000 })!;
      expect(long.inputTokens).toBeGreaterThan(272_000);
      expect(long.cacheWritePremium).toBe(true);
      expect(reservationUsd(long)).toBeCloseTo((long.inputTokens * 5 + 1_000 * 15) / 1e6, 12);
      expect(usageCost(long, { usage })!.usd).toBeCloseTo(1.103004, 12);
      expect(usageCost(long, { usage: { ...usage, input_tokens: 272_000 } })!.usd).toBeCloseTo((272_000 * 2 + 1_000 * 10) / 1e6, 12);
      const short = priceRequest('https://api.openai.com/v1/responses', { model: 'gpt-6.2-sol', input: 'hello', max_output_tokens: 1_000 })!;
      expect(reservationUsd(short)).toBeCloseTo((short.inputTokens * 2.5 + 1_000 * 10) / 1e6, 12);
    });
  });

  test('xAI Grok 4.6, the one native-route model priced only from the table with a long tier, bills above 199,999 at the long rates', () => {
    const price = priceRequest('https://api.x.ai/v1/chat/completions', { model: 'grok-4.6', messages: [], max_completion_tokens: 1_000 })!;
    expect(price.long).toEqual({ above_input_tokens: 199_999, input: 4, output: 12, cache_read: 1 });
    expect(usageCost(price, { usage: { prompt_tokens: 200_000, completion_tokens: 10 } })!.usd).toBeCloseTo((200_000 * 4 + 10 * 12) / 1e6, 12);
    expect(usageCost(price, { usage: { prompt_tokens: 199_999, completion_tokens: 10 } })!.usd).toBeCloseTo((199_999 * 2 + 10 * 6) / 1e6, 12);
  });
});
