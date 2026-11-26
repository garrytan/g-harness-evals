/**
 * Endpoint pins and metering for every OpenRouter model of frontier-shootout-2026-11, as amendment 1 rewires Hermes and
 * OpenClaw onto their built-in openrouter providers (internal-task). Both providers can put OpenRouter provider-routing fields on a
 * request: Hermes's provider_routing config (sort, only, ignore, order, require_parameters, data_collection) and OpenClaw's
 * per-model provider params (also allow_fallbacks, quantizations, max_price, zdr, enforce_distillable_text). The metering
 * proxy must replace that object with the model's pin (Google AI Studio at the standard tier, Meta, Moonshot AI, Baidu's
 * fp8 host at the standard tier, DeepSeek) whatever it held, and still write a correct usage line: tokens, the list-price
 * cost from the dated price row, OpenRouter's reported cost beside it, the provider that answered and the effort asked
 * for. DeepSeek V4.1 Flash 1017 is the cheap case: its line must carry its few millionths of a dollar exactly, not round
 * to zero. Keyless: the upstream is a loopback fake and every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { canonicalLookup, priceOnDate } from '../runner/pricing/model-pricing.ts';
import { MeteringProxy, OPENROUTER_MODELS, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const MODELS = ['google/gemini-4-carbon', 'google/gemini-4-hydrogen', 'meta/muse-wonder', 'moonshotai/kimi-k3.1-pro', 'z-ai/glm-5.3', 'deepseek/deepseek-v4.1-flash-1017'];
const PIN_ONLY: Record<string, string> = { 'google/gemini-4-carbon': 'google-ai-studio', 'google/gemini-4-hydrogen': 'google-ai-studio', 'meta/muse-wonder': 'meta',
  'moonshotai/kimi-k3.1-pro': 'moonshotai', 'z-ai/glm-5.3': 'baidu/fp8', 'deepseek/deepseek-v4.1-flash-1017': 'deepseek' };
const TIERED = new Set(['google/gemini-4-carbon', 'google/gemini-4-hydrogen', 'z-ai/glm-5.3']);
/** Every provider-routing field either harness can set, each pointing away from the pin. */
const HOSTILE = { order: ['google-vertex', 'chutes'], only: ['google-vertex'], ignore: ['google-ai-studio', 'meta', 'moonshotai', 'baidu/fp8', 'deepseek'], allow_fallbacks: true,
  sort: 'price', quantizations: ['fp4'], max_price: { prompt: 999, completion: 999 }, data_collection: 'allow', require_parameters: false, zdr: false, enforce_distillable_text: false };
const USAGE = { prompt: 1200, cached: 200, completion: 300, reasoning: 120, cost: 0.000123 };
const KEY = 'placeholder-openrouter';
const TOKEN = 'trial-token:p.0123456789abcdef0123456789abcdef';
const tmp = mkdtempSync(join(tmpdir(), 'openrouter-pins-'));
const seen: Array<Record<string, any>> = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const body = await req.json() as Record<string, any>;
  seen.push(body);
  const model = String(body.model);
  const head = { id: 'gen-pins-' + seen.length, provider: OPENROUTER_MODELS[model]?.served, model, created: 1 };
  const usage = { prompt_tokens: USAGE.prompt, completion_tokens: USAGE.completion, total_tokens: USAGE.prompt + USAGE.completion,
    prompt_tokens_details: { cached_tokens: USAGE.cached }, completion_tokens_details: { reasoning_tokens: USAGE.reasoning }, cost: USAGE.cost };
  if (!body.stream) return Response.json({ ...head, object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok', reasoning: 'r' } }], usage });
  const chunk = (delta: unknown, finish: string | null) => 'data: ' + JSON.stringify({ ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
  return new Response(chunk({ role: 'assistant', content: 'ok' }, null) + chunk({}, 'stop') + 'data: ' + JSON.stringify({ ...head, choices: [], usage }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
} });
afterAll(() => { upstream.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
function proxyFor(model: string) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'pins-' + id, leaseUsd: 5, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const proxy = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + upstream.port }, policy: { lease, env: { OPENROUTER_API_KEY: KEY }, usageLog, maxOutputTokens: 128_000 } });
  proxy.start();
  proxy.bind('p', 'trial-token:p', TOKEN, ['openrouter:' + model]);
  const post = (body: unknown) => fetch('http://127.0.0.1:' + proxy.port + '/p/openrouter/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body) });
  const usage = () => readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  const committed = () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd;
  return { proxy, post, usage, committed };
}
const request = (model: string, extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: 'user', content: 'Say ok.' }], reasoning: { effort: 'high' }, session_id: 'gwk_session', provider: HOSTILE, ...extra });
const row = (model: string) => priceOnDate(canonicalLookup('openrouter:' + model)!, new Date());
const listUsd = (model: string) => { const r = row(model); return ((USAGE.prompt - USAGE.cached) * r.input + USAGE.cached * (r.cache_read ?? r.input) + USAGE.completion * r.output) / 1e6; };

describe('a bundled provider\'s routing fields never move an OpenRouter cell off its pinned endpoint', () => {
  for (const model of MODELS) {
    test(model + ': every routing field is replaced by the pin, and the usage line is metered from the dated row', async () => {
      const t = proxyFor(model);
      const before = seen.length;
      try {
        const res = await t.post(request(model));
        expect(res.status).toBe(200);
        await res.text();
        await t.proxy.finalize('trial-token:p');
        const [sent, ...more] = seen.slice(before);
        expect(more).toEqual([]);
        const r = row(model);
        expect(sent!.provider).toEqual({ only: [PIN_ONLY[model]], allow_fallbacks: false, max_price: { prompt: r.input, completion: r.output } });
        expect(sent!.service_tier).toBe(TIERED.has(model) ? 'default' : undefined);
        expect(sent!.reasoning).toEqual({ effort: 'high' });
        const [line, ...rest] = t.usage();
        expect(rest).toEqual([]);
        expect(line).toMatchObject({ provider: 'openrouter', model, outcome: 'forwarded', status: 200, served_provider: OPENROUTER_MODELS[model]!.served, served_model: model,
          input_tokens: USAGE.prompt, cached_tokens: USAGE.cached, output_tokens: USAGE.completion, reasoning_tokens: USAGE.reasoning, openrouter_cost_usd: USAGE.cost, reasoning_effort: 'high' });
        expect(line!.served_elsewhere).toBeUndefined();
        expect(line!.actual_usd).toBeCloseTo(listUsd(model), 12);
        expect(t.committed()).toBeCloseTo(listUsd(model), 12);
      } finally { t.proxy.stop(); }
    });
  }

  test('a tier other than the standard one is refused for the tier-pinned models before anything is forwarded', async () => {
    for (const model of [...TIERED]) {
      const t = proxyFor(model);
      const before = seen.length;
      try {
        expect((await t.post(request(model, { service_tier: 'flex' }))).status).toBe(400);
        expect((await t.post(request(model, { speed: 'fast' }))).status).toBe(400);
        expect(seen.length).toBe(before);
      } finally { t.proxy.stop(); }
    }
  });

  test('the cheap case: a streamed DeepSeek V4.1 Flash 1017 call is metered to the millionth of a dollar, not rounded away', async () => {
    const model = 'deepseek/deepseek-v4.1-flash-1017';
    const t = proxyFor(model);
    try {
      const res = await t.post(request(model, { stream: true }));
      expect(res.status).toBe(200);
      await res.text();
      await t.proxy.finalize('trial-token:p');
      const [line] = t.usage();
      // 1,000 uncached input tokens at $0.30, 200 cache reads at $0.006 and 300 output tokens at $1.20 per million.
      const expected = (1000 * 0.3 + 200 * 0.006 + 300 * 1.2) / 1e6;
      expect(expected).toBeCloseTo(0.0006612, 12);
      expect(line).toMatchObject({ streamed: true, served_provider: 'DeepSeek', reasoning_effort: 'high', input_tokens: 1200, output_tokens: 300, openrouter_cost_usd: USAGE.cost });
      expect(line!.actual_usd).toBeGreaterThan(0);
      expect(line!.actual_usd).toBeCloseTo(expected, 12);
      expect(t.committed()).toBeCloseTo(expected, 12);
    } finally { t.proxy.stop(); }
  });
});
