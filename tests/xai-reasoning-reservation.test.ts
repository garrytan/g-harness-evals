/**
 * xAI reservations cover reasoning (internal-task PR 2, item 8). xAI's max_completion_tokens bounds the answer but not the
 * reasoning, which Grok 4.7 always does and which bills as output, so an xAI request reserves its output limit plus the
 * model's reasoning ceiling (XAI_REASONING_CEILING) at the output rate, and a request for an xAI model with no ceiling is
 * refused before forwarding. Keyless: the upstream is a Bun server on the loopback and every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, priceRequest, reservationUsd, usageCost, XAI_REASONING_CEILING } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, UPSTREAM, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const tmp = mkdtempSync(join(tmpdir(), 'xai-reasoning-'));
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
/** A long think: 300,000 reasoning tokens beside a short answer, under a max_completion_tokens of 1,000. */
const THINK = { prompt_tokens: 20, completion_tokens: 900, total_tokens: 300_920, completion_tokens_details: { reasoning_tokens: 300_000 } };
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  const path = new URL(req.url).pathname;
  await req.json();
  if (path === '/v1/responses') return Response.json({ id: 'r1', model: 'grok-4.7', output: [], usage: { input_tokens: 20, output_tokens: 900, total_tokens: 300_920, output_tokens_details: { reasoning_tokens: 300_000 } } });
  return Response.json({ id: 'c1', model: 'grok-4.7', choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: THINK });
} });
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

describe('xAI reservations', () => {
  test('add the model reasoning ceiling to the output limit, so a response with heavy reasoning settles within its reservation', () => {
    const price = priceRequest(UPSTREAM.xai + '/v1/chat/completions', { model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 1000 })!;
    expect(price.maxOutputTokens).toBe(1000 + XAI_REASONING_CEILING['grok-4.7']!);
    const settled = usageCost(price, { usage: THINK })!;
    expect(settled.output_tokens).toBe(300_900);
    expect(reservationUsd(price)).toBeGreaterThanOrEqual(settled.usd);
    expect(priceRequest(UPSTREAM.xai + '/v1/responses', { model: 'grok-4.6', input: 'hi', max_output_tokens: 100 })!.maxOutputTokens).toBe(100 + 500_000);
    expect(() => priceRequest(UPSTREAM.xai + '/v1/chat/completions', { model: 'grok-9', messages: [] })).toThrow();
  });

  test('through the proxy: every forwarded xAI line reserves at least what it settled', async () => {
    const lease = BudgetRun.openLease({ runId: 'xai-reasoning', leaseUsd: 50, ledgerPath: join(tmp, 'lease.sqlite') });
    const usageLog = join(tmp, 'usage.ndjson');
    const proxy = new MeteringProxy({ upstream: { xai: 'http://127.0.0.1:' + upstream.port }, policy: { lease, env: { XAI_API_KEY: 'placeholder-xai' }, usageLog, maxOutputTokens: 128_000 } });
    proxy.start();
    proxy.bind('t', 'trial-token:t', TOKEN, ['xai:grok-4.7']);
    try {
      const post = (route: string, body: unknown) => fetch('http://127.0.0.1:' + proxy.port + '/t/xai/v1/' + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body) });
      expect((await post('chat/completions', { model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 1000 })).status).toBe(200);
      expect((await post('responses', { model: 'grok-4.7', input: 'hi', max_output_tokens: 1000 })).status).toBe(200);
      await proxy.finalize('trial-token:t');
      const lines = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        expect(l).toMatchObject({ outcome: 'forwarded', output_tokens: 300_900, charged_reservation: false });
        expect(l.reserved_usd!).toBeGreaterThanOrEqual(l.actual_usd!);
      }
    } finally { proxy.stop(); }
  });
});
