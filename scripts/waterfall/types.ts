// Shared shapes for the token waterfall (internal-task): the billing classes a request's dollars split into, the content
// sections of the usage-line contract (schema v1, written by runner/proxy/metering-proxy.ts with --log-sections), and
// the models a headline may rest on.
import type { Components } from '../anatomy/cost-split.ts';

/** Billing classes, in waterfall order. Their dollars sum to the receipt's actual_usd. */
export const BILLING_CLASSES = ['uncached_input', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'output', 'embedding', 'failed', 'unknown', 'remainder'] as const;
export type BillingClass = typeof BILLING_CLASSES[number];
export const BILLING_LABELS: Record<BillingClass, string> = {
  uncached_input: 'Uncached input', cache_read: 'Cache read', cache_write_5m: 'Cache write, 5 min', cache_write_1h: 'Cache write, 1 hour',
  output: 'Output (incl. reasoning)', embedding: 'Embeddings', failed: 'Failed, reservation kept', unknown: 'Unknown (reservation only)', remainder: 'Unexplained remainder',
};

/** The content partition of a request body; the nine byte fields sum to body_bytes. */
export const SECTION_NAMES = ['system', 'tools', 'user_text', 'tool_result', 'assistant_text', 'tool_use', 'opaque', 'media', 'other'] as const;
export type SectionName = typeof SECTION_NAMES[number];

export interface SectionsV1 extends Record<SectionName, number> {
  v: 1;
  body_bytes: number;
  message_count: number;
  tools_declared: Array<{ name: string; bytes: number }>;
  conv_sha256: string;
  boundary_sha256: string[];
  tool_results: Array<{ digest: string; bytes: number; index: number }>;
}

/** Models a headline may rest on; every other model is labelled secondary. */
export const HEADLINE_MODELS = ['claude-opus-5-5', 'gpt-6.1-sol', 'gpt-6-astra'];
export const isHeadline = (model: string) => HEADLINE_MODELS.includes(model.replace(/^[a-z]+:/, ''));

export interface Bill {
  requests: number;
  inferred_requests: number;
  measured_requests: number;
  clamped_requests: number;
  actual_usd: number;
  usd: Record<BillingClass, number>;
  tokens: { uncached_input: number; cache_read: number; cache_write_5m: number; cache_write_1h: number; output: number; reasoning: number; embedding: number };
}

export function emptyBill(): Bill {
  return { requests: 0, inferred_requests: 0, measured_requests: 0, clamped_requests: 0, actual_usd: 0,
    usd: Object.fromEntries(BILLING_CLASSES.map((k) => [k, 0])) as Record<BillingClass, number>,
    tokens: { uncached_input: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0, reasoning: 0, embedding: 0 } };
}

export function billOf(c: Components): Bill {
  return {
    requests: c.requests, inferred_requests: c.inferred_requests, measured_requests: c.measured_requests, clamped_requests: c.clamped_requests, actual_usd: c.actual_usd,
    usd: { uncached_input: c.uncached_input_usd, cache_read: c.cache_read_usd, cache_write_5m: c.cache_write_usd - c.cache_write_1h_usd, cache_write_1h: c.cache_write_1h_usd,
      output: c.output_usd, embedding: c.embedding_usd, failed: c.failed_usd, unknown: c.unknown_usd, remainder: c.remainder_usd },
    tokens: { uncached_input: c.uncached_input_tokens, cache_read: c.cache_read_tokens, cache_write_5m: c.cache_write_tokens - c.cache_write_1h_tokens,
      cache_write_1h: c.cache_write_1h_tokens, output: c.output_tokens, reasoning: c.reasoning_tokens, embedding: c.embedding_tokens },
  };
}

export function addBill(a: Bill, b: Bill): Bill {
  const out = emptyBill();
  for (const k of ['requests', 'inferred_requests', 'measured_requests', 'clamped_requests', 'actual_usd'] as const) out[k] = a[k] + b[k];
  for (const k of BILLING_CLASSES) out.usd[k] = a.usd[k] + b.usd[k];
  for (const k of Object.keys(out.tokens) as (keyof Bill['tokens'])[]) out.tokens[k] = a.tokens[k] + b.tokens[k];
  return out;
}
