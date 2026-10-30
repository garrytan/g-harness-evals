/**
 * The extracted metering proxy (eval/runner/metering-proxy.ts). Keyless: every
 * upstream is a fake, and every "key" is a placeholder string.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, closeLedgers, closeRun, ledgerStatus, priceRequest, reservationUsd } from '../runner/ledger/budget-ledger.ts';
import { isWildcardHost, MeteringProxy, parseProxyArgs, PROVIDER_ERROR_NOT_BILLED, ProxyControl, sseUsage, upstreamTrouble, type LeasePolicy } from '../runner/proxy/metering-proxy.ts';
import { trialKey, trialToken } from '../runner/trial/proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'metering-proxy-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const FAKE_ENV = { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic', VOYAGE_API_KEY: 'placeholder-voyage' };
let n = 0;
const ledgerFile = () => join(tmp, `lease-${++n}.sqlite`);

interface Seen { url: string; headers: Headers; body: any }
function fakeUpstream(respond: (seen: Seen) => Response | Promise<Response> = () => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 } })) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const s = { url: String(url), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    return respond(s);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

/** A lease-mode proxy with the test slots c and c1 bound (without a token) under their slot:<id> keys, since the proxy
 *  forwards nothing for an unbound slot (2026-10-28). */
function leased(lease: BudgetRun, fetchImpl: typeof fetch, extra: Partial<LeasePolicy> = {}, bound: string[] = ['c', 'c1']) {
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: FAKE_ENV, usageLog, ...extra } });
  proxy.start();
  for (const slot of bound) proxy.bind(slot, `slot:${slot}`);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { proxy, post, usageLog };
}

const chat = (model = 'gpt-4.1-mini', extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: 'user', content: 'hello there' }], max_completion_tokens: 100, ...extra });

describe('lease mode refuses before forwarding', () => {
  beforeEach(() => closeLedgers());
  test('an unpriced model, an unknown route and a missing model never reach the upstream', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-a', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl);
    try {
      const unpriced = await post('/c1/openai/v1/chat/completions', chat('mystery-model-9'));
      expect(unpriced.status).toBe(402);
      expect((await unpriced.json()).error.kind).toBe('budget');
      expect((await post('/c1/openai/v1/fine_tuning/jobs', { model: 'gpt-4.1-mini' })).status).toBe(403);
      expect((await post('/c1/openai/v1/chat/completions', { messages: [] })).status).toBe(402);
      expect((await fetch(`http://127.0.0.1:${proxy.port}/nowhere`)).status).toBe(404);
      expect(up.seen).toHaveLength(0);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-a' }).run!.committed_usd).toBe(0);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines.map(l => l.outcome)).toEqual(['refused', 'refused', 'refused']);
      expect(readFileSync(usageLog, 'utf8')).not.toContain('placeholder');
    } finally { proxy.stop(); }
  });

  test('a model off the allowlist, an output request above the cap, a disabled stream and a forbidden marker are refused', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-b', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post } = leased(lease, up.fetchImpl, { allowModels: ['openai:gpt-4.1-mini'], maxOutputTokens: 1000, streaming: 'refuse', forbiddenMarkers: ['conv-26:q007'] });
    try {
      expect((await post('/c/openai/v1/chat/completions', chat('gpt-4o-mini'))).status).toBe(403);
      expect((await post('/c/openai/v1/chat/completions', chat('gpt-4.1-mini', { max_completion_tokens: 5000 }))).status).toBe(400);
      expect((await post('/c/openai/v1/chat/completions', chat('gpt-4.1-mini', { stream: true }))).status).toBe(400);
      const leak = await post('/c/openai/v1/chat/completions', chat('gpt-4.1-mini', { messages: [{ role: 'user', content: 'metadata conv-26:q007' }] }));
      expect(leak.status).toBe(403);
      expect(JSON.stringify(await leak.json())).not.toContain('conv-26:q007');
      expect(proxy.counts.tripwires).toBe(1);
      expect(up.seen).toHaveLength(0);
    } finally { proxy.stop(); }
  });

  test('a request that would pass the lease is refused and the ledger is unchanged', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-c', leaseUsd: 0.001, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post } = leased(lease, up.fetchImpl);
    try {
      const res = await post('/c/openai/v1/chat/completions', chat('gpt-5.5', { max_completion_tokens: 30000 }));
      expect(res.status).toBe(402);
      expect(up.seen).toHaveLength(0);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-c' }).run!.committed_usd).toBe(0);
    } finally { proxy.stop(); }
  });
});

describe('lease mode forwarding', () => {
  beforeEach(() => closeLedgers());
  test('inbound credentials are stripped, the proxy key is injected, the output cap is injected and usage settles the reservation', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-d', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post } = leased(lease, up.fetchImpl, { maxOutputTokens: 2048 });
    try {
      const body = { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] };
      const res = await post('/c/openai/v1/chat/completions', body, { authorization: 'Bearer dummy-from-container', 'x-api-key': 'dummy2' });
      expect(res.status).toBe(200);
      expect(up.seen[0].headers.get('authorization')).toBe('Bearer placeholder-openai');
      expect(up.seen[0].headers.get('x-api-key')).toBeNull();
      expect(up.seen[0].body.max_completion_tokens).toBe(2048);
      expect(up.seen[0].url).toBe('https://api.openai.com/v1/chat/completions');
      const anth = await post('/c/anthropic/v1/messages', { model: 'claude-sonnet-5-5', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': 'dummy' });
      expect(anth.status).toBe(200);
      expect(up.seen[1].headers.get('x-api-key')).toBe('placeholder-anthropic');
      expect(up.seen[1].headers.get('authorization')).toBeNull();
      const run = ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-d' }).run!;
      expect(run.committed_usd).toBeCloseTo((10 * 0.4 + 5 * 1.6) / 1e6 + (10 * 2 + 5 * 10) / 1e6, 12);
    } finally { proxy.stop(); }
  });

  test('a 4xx without usage settles at $0; an OpenAI 503 server_error envelope and no usage settles at $0 with a reason (2026-10-29); any other 5xx keeps its reservation', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-4xx', leaseUsd: 1, ledgerPath: ledgerFile() });
    let status = 400;
    let body: unknown = { error: { message: 'bad request' } };
    const up = fakeUpstream(() => typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status }));
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl);
    try {
      expect((await post('/c/openai/v1/chat/completions', chat())).status).toBe(400);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-4xx' }).run!.committed_usd).toBe(0);
      status = 503;
      body = { error: { message: 'The engine is currently overloaded, please try again later', type: 'server_error', param: null, code: 'service_unavailable' } };
      expect((await post('/c/openai/v1/chat/completions', chat())).status).toBe(503);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-4xx' }).run!.committed_usd).toBe(0);
      body = { error: { message: 'bad request' } };
      expect((await post('/c/openai/v1/chat/completions', chat())).status).toBe(503);
      body = '<html>503 Service Unavailable</html>';
      expect((await post('/c/openai/v1/chat/completions', chat())).status).toBe(503);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines.map(l => [l.status, l.actual_usd === 0, l.charged_reservation])).toEqual([[400, true, false], [503, true, false], [503, false, true], [503, false, true]]);
      expect(lines.map(l => l.reason)).toEqual([undefined, `HTTP 503 server_error: ${PROVIDER_ERROR_NOT_BILLED}`, 'the response carried no usage', 'the response carried no usage']);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-4xx' }).run!.committed_usd).toBeCloseTo(lines[2].reserved_usd + lines[3].reserved_usd, 12);
    } finally { proxy.stop(); }
  });

  test('the input reservation is bounded by request bytes, not bytes over three', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-e', leaseUsd: 1, ledgerPath: ledgerFile() });
    let reserved = 0;
    const up = fakeUpstream(() => new Response('no usage', { status: 200 }));
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl);
    try {
      const body = chat('gpt-4.1-mini', { messages: [{ role: 'user', content: 'x'.repeat(30_000) }] });
      await post('/c/openai/v1/chat/completions', body);
      reserved = JSON.parse(readFileSync(usageLog, 'utf8').trim()).reserved_usd;
      const ledgerBound = reservationUsd(priceRequest('https://api.openai.com/v1/chat/completions', body)!);
      expect(reserved).toBeGreaterThan(ledgerBound * 2.5);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-e' }).run!.committed_usd).toBeCloseTo(reserved, 12);
    } finally { proxy.stop(); }
  });

  test('concurrent requests cannot overspend the lease', async () => {
    const body = chat('gpt-4.1-mini', { max_completion_tokens: 1000 });
    const one = reservationUsd({ ...priceRequest('https://api.openai.com/v1/chat/completions', body)!, inputTokens: Buffer.byteLength(JSON.stringify(body)) + 64 });
    const leaseUsd = one * 7.5;
    const lease = BudgetRun.openLease({ runId: 'lease-f', leaseUsd, ledgerPath: ledgerFile() });
    const up = fakeUpstream(async () => { await Bun.sleep(20); return new Response('{}', { status: 200 }); });
    const { proxy, post } = leased(lease, up.fetchImpl);
    try {
      const statuses = await Promise.all(Array.from({ length: 40 }, () => post('/c/openai/v1/chat/completions', body).then(r => r.status)));
      expect(statuses.filter(s => s === 200)).toHaveLength(7);
      expect(statuses.filter(s => s === 402)).toHaveLength(33);
      expect(up.seen).toHaveLength(7);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-f' }).run!.committed_usd).toBeLessThanOrEqual(leaseUsd + 1e-12);
    } finally { proxy.stop(); }
  });

  test('streams pass through and settle from their usage events, or at the reservation', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-g', leaseUsd: 1, ledgerPath: ledgerFile() });
    let withUsage = true;
    const up = fakeUpstream(seen => {
      const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', ...(withUsage ? ['data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\n'] : []), 'data: [DONE]\n\n'];
      expect(seen.body.stream_options.include_usage).toBe(true);
      return new Response(chunks.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl);
    try {
      const text = await (await post('/c/openai/v1/chat/completions', chat('gpt-4.1-mini', { stream: true }))).text();
      expect(text).toContain('[DONE]');
      withUsage = false;
      await (await post('/c/openai/v1/chat/completions', chat('gpt-4.1-mini', { stream: true }))).text();
      await proxy.finalize('slot:c', 5000);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0]).toMatchObject({ streamed: true, charged_reservation: false, input_tokens: 100, output_tokens: 20 });
      expect(lines[1]).toMatchObject({ streamed: true, charged_reservation: true });
      expect(lines[1].actual_usd).toBe(lines[1].reserved_usd);
    } finally { proxy.stop(); }
  });

  test('Anthropic stream usage merges message_start input with message_delta output', () => {
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":30}}\n\n';
    expect(sseUsage(sse)).toEqual({ input_tokens: 50, output_tokens: 30 });
    expect(sseUsage('data: [DONE]\n')).toBeNull();
  });
});

describe('attribution across processes', () => {
  beforeEach(() => closeLedgers());
  test('the harness binds a slot to a question, and the meter shows what the provider answered', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-ctl', leaseUsd: 1, ledgerPath: ledgerFile() });
    let mode: 'ok' | '503' | 'garbled' = 'ok';
    const up = fakeUpstream(() => mode === '503' ? new Response('{"error":"overloaded"}', { status: 503 }) : mode === 'garbled' ? new Response('<html>oops</html>', { status: 200 }) : Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const proxy = new MeteringProxy({ fetchImpl: up.fetchImpl, controlToken: 'tok', policy: { lease, env: FAKE_ENV } });
    proxy.start();
    const base = `http://127.0.0.1:${proxy.port}`;
    const ctl = new ProxyControl(base, 'tok');
    const post = () => fetch(`${base}/extract-first/openai/v1/chat/completions`, { method: 'POST', body: JSON.stringify(chat()) });
    try {
      expect((await fetch(`${base}/__proxy/bind`, { method: 'POST', body: JSON.stringify({ slot: 'extract-first', key: 'x' }) })).status).toBe(403);
      const ok = await ctl.around('extract-first', 'q:1', async () => { await post(); mode = '503'; await post(); return 'done'; });
      expect(ok.value).toBe('done');
      expect(ok.meter).toMatchObject({ requests: 2, upstream: { statuses: { '200': 1, '503': 1 }, failed: 0, unparseable: 0 } });
      expect(upstreamTrouble(ok.meter)).toBe(true);
      mode = 'garbled';
      const bad = await ctl.around('extract-first', 'q:2', () => post());
      expect(bad.meter.upstream).toEqual({ statuses: {}, failed: 0, unparseable: 1 });
      mode = 'ok';
      const clean = await ctl.around('extract-first', 'q:3', () => post());
      expect(upstreamTrouble(clean.meter)).toBe(false);
      const unbound = await post();
      expect(unbound.status).toBe(403);
      expect((await unbound.json()).error.message).toContain('not bound');
      expect(proxy.meters.has('slot:extract-first')).toBe(false);
    } finally { proxy.stop(); }
  });
});

describe('bound slots and per-trial tokens (2026-10-28)', () => {
  beforeEach(() => closeLedgers());
  // Generated by the ship Step 7 coverage audit.
  // Value: protects=rebinding revokes the old token and stale cleanup preserves the new binding;
  // fails_when=the old token remains authorized or unbind ignores the expected key;
  // why_new=existing token coverage never reuses a slot or conditionally unbinds; seam=none;
  // no_claim=runner cleanup ordering, this exercises the real proxy with a fake provider.
  test('rebinding a slot revokes its previous token and ignores cleanup for a previous key', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-rebind', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, {}, []);
    try {
      proxy.bind('reused', 'old-key', 'old-token');
      expect((await post('/reused/openai/v1/chat/completions', chat(), { authorization: 'Bearer old-token' })).status).toBe(200);
      proxy.bind('reused', 'new-key', 'new-token');
      proxy.unbind('reused', 'old-key');
      expect((await post('/reused/openai/v1/chat/completions', chat(), { authorization: 'Bearer old-token' })).status).toBe(403);
      expect((await post('/reused/openai/v1/chat/completions', chat(), { authorization: 'Bearer new-token' })).status).toBe(200);
      proxy.unbind('reused', 'new-key');
      expect((await post('/reused/openai/v1/chat/completions', chat(), { authorization: 'Bearer new-token' })).status).toBe(403);
      expect(up.seen).toHaveLength(2);
      expect((await proxy.finalize('old-key')).requests).toBe(1);
      expect((await proxy.finalize('new-key')).requests).toBe(1);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines.map(l => [l.key, l.outcome])).toEqual([['old-key', 'forwarded'], ['slot:reused', 'refused'], ['new-key', 'forwarded'], ['slot:reused', 'refused']]);
    } finally { proxy.stop(); }
  });

  // Value: protects=a tokenless slot rebound to a new key charges the new key and a stale-key unbind leaves it bound;
  // fails_when=unbind ignores its key argument or a rebind keeps the old key; why_new=the rebind test above covers token
  // slots only; seam=none; no_claim=runner cleanup ordering (fake provider).
test('finalize waits for in-flight requests across a rebind and attributes a late settlement to the key it was admitted under; a short timeout reports the undrained count', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-inflight', leaseUsd: 1, ledgerPath: ledgerFile() });
    const gates: Array<() => void> = [];
    const up = fakeUpstream(() => new Promise<Response>((resolve) => { gates.push(() => resolve(Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 } }))); }));
    const { proxy, post } = leased(lease, up.fetchImpl, {}, []);
    const settledFinalize = <T,>(p: Promise<T>) => Promise.race([p.then(() => true), Bun.sleep(40).then(() => false)]);
    try {
      proxy.bind('h', 'old-key', 'old-token');
      const first = post('/h/openai/v1/chat/completions', chat(), { authorization: 'Bearer old-token' });
      while (gates.length < 1) await Bun.sleep(5);
      // inflight x finalize: the finalization stays pending while the request is out, through a rebind of the slot.
      const finalizing = proxy.finalize('old-key', 10_000);
      expect(await settledFinalize(finalizing)).toBe(false);
      proxy.bind('h', 'new-key', 'new-token');
      expect(await settledFinalize(finalizing)).toBe(false);
      gates.shift()!();
      expect((await first).status).toBe(200);
      const meter = await finalizing;
      expect(meter.requests).toBe(1);
      expect(meter.undrained).toBeUndefined();
      expect(proxy.meters.has('old-key')).toBe(false);
      expect(proxy.meters.has('new-key')).toBe(false);
      // timeout-undrained x finalize: a bounded wait reports the undrained count; the late settlement lands under the key the
      // request was admitted with, and a replacement binding of the slot is untouched.
      const second = post('/h/openai/v1/chat/completions', chat(), { authorization: 'Bearer new-token' });
      while (gates.length < 1) await Bun.sleep(5);
      const partial = await proxy.finalize('new-key', 20);
      expect(partial.undrained).toBe(1);
      expect(partial.requests).toBe(0);
      proxy.bind('h', 'third-key', 'third-token');
      gates.shift()!();
      expect((await second).status).toBe(200);
      expect(proxy.meters.get('new-key')?.requests).toBe(1);
      expect(proxy.meters.has('third-key')).toBe(false);
      const late = await proxy.finalize('new-key', 20);
      expect(late.requests).toBe(1);
      expect(late.undrained).toBeUndefined();
      expect((await post('/h/openai/v1/chat/completions', chat(), { authorization: 'Bearer new-token' })).status).toBe(403);
    } finally { proxy.stop(); }
  });

  test('rebinding a tokenless slot moves attribution to the new key and a stale-key unbind leaves it bound', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-rebind-tokenless', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post } = leased(lease, up.fetchImpl, {}, []);
    try {
      proxy.bind('s', 'old');
      expect((await post('/s/openai/v1/chat/completions', chat())).status).toBe(200);
      proxy.bind('s', 'new');
      proxy.unbind('s', 'old');
      expect((await post('/s/openai/v1/chat/completions', chat())).status).toBe(200);
      expect((await proxy.finalize('old')).requests).toBe(1);
      expect((await proxy.finalize('new')).requests).toBe(1);
      proxy.unbind('s', 'new');
      expect((await post('/s/openai/v1/chat/completions', chat())).status).toBe(403);
      expect(up.seen).toHaveLength(2);
    } finally { proxy.stop(); }
  });

  // Generated by the ship Step 7 coverage audit.
  // Value: protects=fresh per-trial credentials coexist with sidecar attribution on a second slot;
  // fails_when=tokens become deterministic or the sidecar binding relaxes the harness token check;
  // why_new=existing tests use fixed tokens and a single slot per key; seam=none;
  // no_claim=sidecar launch wiring or embedding quality, provider responses are fake.
  test('fresh trial tokens guard the harness independently of a tokenless sidecar sharing its meter', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-sidecar', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, {}, []);
    const ctl = new ProxyControl(`http://127.0.0.1:${proxy.port}`, null);
    const key = trialKey('shared');
    const token = trialToken('shared');
    const retryToken = trialToken('shared');
    expect(token).toMatch(/^trial-token:shared\.[0-9a-f]{32}$/);
    expect(retryToken).not.toBe(token);
    try {
      await ctl.bind('shared', key, token);
      await ctl.bind('shared.gbrain', key);
      expect((await post('/shared/openai/v1/chat/completions', chat(), { authorization: `Bearer ${retryToken}` })).status).toBe(403);
      expect((await post('/shared/openai/v1/chat/completions', chat())).status).toBe(403);
      expect(up.seen).toHaveLength(0);
      expect((await post('/shared/openai/v1/chat/completions', chat(), { authorization: `Bearer ${token}` })).status).toBe(200);
      expect((await post('/shared.gbrain/openai/v1/embeddings', { model: 'text-embedding-3-small', input: 'query' })).status).toBe(200);
      expect(up.seen).toHaveLength(2);
      expect((await ctl.finalize(key)).requests).toBe(2);
      await ctl.unbind('shared.gbrain');
      expect((await post('/shared.gbrain/openai/v1/embeddings', { model: 'text-embedding-3-small', input: 'query' })).status).toBe(403);
      expect(up.seen).toHaveLength(2);
      const log = readFileSync(usageLog, 'utf8');
      expect(log).not.toContain(token);
      expect(log).not.toContain(retryToken);
      // A request without the slot's token is nobody's: it is logged under slot:<id>, never under the trial's meter.
      expect(log.trim().split('\n').map(l => JSON.parse(l).key)).toEqual(['slot:shared', 'slot:shared', key, key, 'slot:shared.gbrain']);
    } finally { proxy.stop(); }
  });

  test('an unbound slot is refused before the upstream and logged under slot:<id>; binding it forwards', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-unbound', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, {}, []);
    try {
      const res = await post('/outsider/anthropic/v1/messages', { model: 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': 'guess' });
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toContain('slot outsider is not bound');
      expect(up.seen).toHaveLength(0);
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-unbound' }).run!.committed_usd).toBe(0);
      const line = JSON.parse(readFileSync(usageLog, 'utf8').trim().split('\n').at(-1)!);
      expect(line).toMatchObject({ key: 'slot:outsider', outcome: 'refused', status: 403, provider: 'anthropic', route: '/v1/messages' });
      proxy.bind('outsider', 'trial-token:t1');
      expect((await post('/outsider/anthropic/v1/messages', { model: 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })).status).toBe(200);
      expect(up.seen).toHaveLength(1);
      proxy.unbind('outsider');
      expect((await post('/outsider/anthropic/v1/messages', { model: 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })).status).toBe(403);
      expect(up.seen).toHaveLength(1);
    } finally { proxy.stop(); }
  });

  test('a slot bound with a token forwards only requests that present it, as x-api-key or a bearer, and meters them under the key', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-token', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = fakeUpstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, {}, []);
    const ctl = new ProxyControl(`http://127.0.0.1:${proxy.port}`, null);
    try {
      await ctl.bind('t', 'trial-token:t2', 'trial-token:t2.0123456789abcdef0123456789abcdef');
      const wrong = await post('/t/openai/v1/chat/completions', chat(), { authorization: 'Bearer trial-token:t2' });
      expect(wrong.status).toBe(403);
      expect((await wrong.json()).error.message).toContain('not the slot\'s token');
      expect((await post('/t/openai/v1/chat/completions', chat())).status).toBe(403);
      expect(up.seen).toHaveLength(0);
      expect((await post('/t/openai/v1/chat/completions', chat(), { authorization: 'Bearer trial-token:t2.0123456789abcdef0123456789abcdef' })).status).toBe(200);
      expect((await post('/t/anthropic/v1/messages', { model: 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': 'trial-token:t2.0123456789abcdef0123456789abcdef' })).status).toBe(200);
      expect(up.seen).toHaveLength(2);
      expect(up.seen[0].headers.get('authorization')).toBe('Bearer placeholder-openai');
      expect(up.seen[1].headers.get('x-api-key')).toBe('placeholder-anthropic');
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines.map(l => [l.key, l.outcome])).toEqual([['slot:t', 'refused'], ['slot:t', 'refused'], ['trial-token:t2', 'forwarded'], ['trial-token:t2', 'forwarded']]);
      expect(readFileSync(usageLog, 'utf8')).not.toContain('0123456789abcdef');
      expect((await proxy.finalize('trial-token:t2')).requests).toBe(2);
    } finally { proxy.stop(); }
  });

  test('the proxy refuses to listen on a wildcard address', () => {
    for (const host of ['0.0.0.0', '::', '[::]', '', '0', '0.0', '00.0.0.0', '::0', '0:0:0:0:0:0:0:0', 'junk host']) {
      expect(isWildcardHost(host)).toBe(true);
      const proxy = new MeteringProxy({ hostname: host });
      expect(() => proxy.start()).toThrow(/wildcard/);
    }
    expect(isWildcardHost('127.0.0.1')).toBe(false);
    expect(isWildcardHost('172.17.0.1')).toBe(false);
    expect(parseProxyArgs(['--listen', '0.0.0.0:8787', '--budget-ledger', 'x', '--lease-usd', '1', '--run-id', 'r']).host).toBe('0.0.0.0');
  });
});

describe('per-slot model lists (internal-task)', () => {
  beforeEach(() => closeLedgers());
  const responses = (model: string) => ({ model, input: 'hello there', max_output_tokens: 100 });
  const upstream = () => fakeUpstream(() => Response.json({ usage: { input_tokens: 10, output_tokens: 5 } }));

  test('a slot bound to gpt-6-luna refuses gpt-6.1-sol with 403 at $0 although --allow-models admits it; a slot bound without models and a sibling slot still forward it', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-slot-models', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = upstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, { allowModels: ['openai:gpt-6-luna', 'openai:gpt-6.1-sol'] }, []);
    const base = `http://127.0.0.1:${proxy.port}`;
    const ctl = new ProxyControl(base, null);
    try {
      expect(await ctl.bind('luna', 'trial-token:luna', 'luna-token', ['openai:gpt-6-luna'])).toEqual({ ok: true });
      expect(await ctl.bind('legacy', 'trial-token:legacy', 'legacy-token')).toEqual({ ok: true });
      const auth = (t: string) => ({ authorization: `Bearer ${t}` });
      expect((await post('/luna/openai/v1/responses', responses('gpt-6-luna'), auth('luna-token'))).status).toBe(200);
      const sol = await post('/luna/openai/v1/responses', responses('gpt-6.1-sol'), auth('luna-token'));
      expect(sol.status).toBe(403);
      expect((await sol.json()).error).toMatchObject({ kind: 'budget', message: "metering proxy: openai:gpt-6.1-sol is not on slot luna's model list (openai:gpt-6-luna)" });
      expect((await post('/legacy/openai/v1/responses', responses('gpt-6.1-sol'), auth('legacy-token'))).status).toBe(200);
      expect(up.seen.map(s => s.body.model)).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const refused = lines.filter(l => l.outcome === 'refused');
      expect(refused).toEqual([expect.objectContaining({ key: 'trial-token:luna', provider: 'openai', route: '/v1/responses', model: 'gpt-6.1-sol', status: 403, reason: "openai:gpt-6.1-sol is not on slot luna's model list (openai:gpt-6-luna)" })]);
      expect(refused[0].reserved_usd).toBeUndefined();
      const luna = await proxy.finalize('trial-token:luna');
      expect(luna.requests).toBe(1);
      expect(Object.keys(luna.byModel)).toEqual(['openai:gpt-6-luna']);
      const committed = ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'lease-slot-models' }).run!.committed_usd;
      expect(committed).toBeCloseTo(luna.usd + (await proxy.finalize('trial-token:legacy')).usd, 12);
    } finally { proxy.stop(); }
  });

  test('the run-wide --allow-models stays the outer bound: a model on the slot list but off the allowlist is refused by the allowlist', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-slot-outer', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = upstream();
    const { proxy, post, usageLog } = leased(lease, up.fetchImpl, { allowModels: ['openai:gpt-6-luna'] }, []);
    try {
      proxy.bind('s', 'k', null, ['openai:gpt-6-luna', 'openai:gpt-6.1-sol']);
      expect((await post('/s/openai/v1/responses', responses('gpt-6.1-sol'))).status).toBe(403);
      expect(up.seen).toHaveLength(0);
      expect(JSON.parse(readFileSync(usageLog, 'utf8').trim()).reason).toBe("openai:gpt-6.1-sol is not on this cell's model allowlist");
    } finally { proxy.stop(); }
  });

  test('an empty model list refuses every priced request; a malformed models field is a 400 and leaves the slot unbound', async () => {
    const lease = BudgetRun.openLease({ runId: 'lease-slot-empty', leaseUsd: 1, ledgerPath: ledgerFile() });
    const up = upstream();
    const { proxy, post } = leased(lease, up.fetchImpl, {}, []);
    const bind = (body: unknown) => fetch(`http://127.0.0.1:${proxy.port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      expect((await bind({ slot: 'none', key: 'k', models: [] })).status).toBe(200);
      expect((await post('/none/openai/v1/responses', responses('gpt-6-luna'))).status).toBe(403);
      for (const models of ['openai:gpt-6-luna', [1], ['gpt-6-luna'], ['openai:gpt 6'], null]) {
        expect((await bind({ slot: 'bad', key: 'k', models })).status, JSON.stringify(models)).toBe(400);
      }
      const unbound = await post('/bad/openai/v1/responses', responses('gpt-6-luna'));
      expect((await unbound.json()).error.message).toContain('is not bound');
      expect(up.seen).toHaveLength(0);
    } finally { proxy.stop(); }
  });
});

describe('leases survive restarts without replay', () => {
  beforeEach(() => closeLedgers());
  test('reopening resumes committed spend; a closed lease, another amount or a second lease is refused', async () => {
    const path = ledgerFile();
    const first = BudgetRun.openLease({ runId: 'lease-h', leaseUsd: 0.5, ledgerPath: path });
    const id = first.reserve(0.4, 'spent before the crash');
    first.settle(id, null);
    closeLedgers();
    const again = BudgetRun.openLease({ runId: 'lease-h', leaseUsd: 0.5, ledgerPath: path });
    expect(() => again.reserve(0.2, 'after restart')).toThrow(/over its \$0\.50 budget/);
    expect(() => BudgetRun.openLease({ runId: 'lease-h', leaseUsd: 1, ledgerPath: path })).toThrow(/program cap mismatch|opened for/);
    expect(() => BudgetRun.openLease({ runId: 'lease-other', leaseUsd: 0.5, ledgerPath: path })).toThrow(/still holds open lease lease-h; pass --new-run/);
    closeRun(path, 'lease-h');
    expect(() => BudgetRun.openLease({ runId: 'lease-h', leaseUsd: 0.5, ledgerPath: path })).toThrow(/never reopened/);
  });

  test('one ledger holds a cell\'s reruns: --new-run closes the open lease, each lease keeps its own budget and output cap', () => {
    const path = ledgerFile();
    const a = BudgetRun.openLease({ runId: 'rerun-1', leaseUsd: 0.5, ledgerPath: path, maxOutputTokens: 64000 });
    a.settle(a.reserve(0.45, 'first run'), null);
    expect(() => BudgetRun.openLease({ runId: 'rerun-1', leaseUsd: 0.5, ledgerPath: path })).toThrow(/output cap of 64000, not the default/);
    const b = BudgetRun.openLease({ runId: 'rerun-2', leaseUsd: 0.5, ledgerPath: path, newRun: true });
    expect(ledgerStatus({ ledgerPath: path, runId: 'rerun-1' }).run!.finished_at).not.toBeNull();
    expect(() => BudgetRun.openLease({ runId: 'rerun-1', leaseUsd: 0.5, ledgerPath: path, maxOutputTokens: 64000 })).toThrow(/never reopened/);
    expect(() => b.reserve(0.49, 'second run')).not.toThrow();
    expect(() => b.reserve(0.02, 'over')).toThrow(/over its \$0\.50 budget/);
    expect(ledgerStatus({ ledgerPath: path }).totals.program_cap_usd).toBeCloseTo(1, 9);
    expect(BudgetRun.leaseMaxOutputTokens(path, 'rerun-1')).toBe(64000);
    expect(BudgetRun.leaseMaxOutputTokens(path, 'rerun-2')).toBeNull();
    expect(BudgetRun.runRequests(path, 'rerun-2')).toBe(1);
  });

  test('a ledger that is not a lease ledger is never used as one', () => {
    const path = ledgerFile();
    BudgetRun.open({ runner: 'some-runner', budgetUsd: 1, ledgerPath: path, programCapUsd: 5 });
    expect(() => BudgetRun.openLease({ runId: 'sneaky', leaseUsd: 1, ledgerPath: path })).toThrow(/not a lease ledger/);
  });

  test('the CLI proxy, restarted on the same lease, keeps refusing once the lease is spent', async () => {
    const path = ledgerFile();
    const seen: string[] = [];
    const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async req => { seen.push(req.headers.get('authorization') ?? ''); return Response.json({ id: 'no-usage' }); } });
    const body = chat('gpt-4.1-mini', { max_completion_tokens: 1000 });
    const one = reservationUsd({ ...priceRequest('https://api.openai.com/v1/chat/completions', body)!, inputTokens: Buffer.byteLength(JSON.stringify(body)) + 64 });
    const leaseUsd = (one * 2.5).toFixed(6);
    const start = async () => {
      let stderr = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
        const port = probe.port!;
        probe.stop(true);
        const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', `127.0.0.1:${port}`, '--budget-ledger', path, '--lease-usd', leaseUsd, '--run-id', 'lease-cli',
          '--upstream', `openai=http://127.0.0.1:${upstream.port}`], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...FAKE_ENV }, stdout: 'pipe', stderr: 'pipe' });
        for (let i = 0; i < 100; i++) {
          if (proc.exitCode !== null) break;
          try { await fetch(`http://127.0.0.1:${port}/__proxy/status`); return { proc, port }; } catch { await Bun.sleep(50); }
        }
        proc.kill('SIGKILL'); await proc.exited;
        stderr = await new Response(proc.stderr).text();
      }
      throw new Error(`proxy did not start: ${stderr}`);
    };
    const call = (port: number) => fetch(`http://127.0.0.1:${port}/openai/v1/chat/completions`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer container-dummy' } }).then(r => r.status);
    const bindDefault = (port: number) => fetch(`http://127.0.0.1:${port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'default', key: 'cli' }) });
    try {
      let p = await start();
      expect(await call(p.port)).toBe(403);
      await bindDefault(p.port);
      expect(await call(p.port)).toBe(200);
      p.proc.kill('SIGKILL'); await p.proc.exited;
      p = await start();
      await bindDefault(p.port);
      const status = await (await fetch(`http://127.0.0.1:${p.port}/__proxy/status`)).json();
      expect(status.committed_usd).toBeGreaterThan(0);
      expect(await call(p.port)).toBe(200);
      expect(await call(p.port)).toBe(402);
      p.proc.kill('SIGTERM'); await p.proc.exited;
      expect(seen).toEqual(['Bearer placeholder-openai', 'Bearer placeholder-openai']);
      closeLedgers();
      const summary = Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', path, '--run-id', 'lease-cli'], { cwd: ROOT });
      expect(JSON.parse(summary.stdout.toString())).toMatchObject({ run_id: 'lease-cli', lease_usd: Number(leaseUsd), max_output_tokens: 32768, requests: 2 });
    } finally { upstream.stop(true); }
  }, 30_000);

  test('the CLI refuses to start without a lease', () => {
    expect(() => parseProxyArgs(['--listen', '0.0.0.0:8787'])).toThrow(/never forwards without a lease/);
    expect(parseProxyArgs(['--listen', '0.0.0.0:9', '--budget-ledger', 'x', '--lease-usd', '2', '--run-id', 'r']).host).toBe('0.0.0.0');
  });
});

describe('in-process mode (Cat 40 callers)', () => {
  test('fails closed on an unpriced request instead of forwarding it free', async () => {
    const up = fakeUpstream();
    const proxy = new MeteringProxy({ fetchImpl: up.fetchImpl });
    proxy.start();
    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/slot0/openai/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'unknown-model', messages: [] }) });
      expect(res.status).toBe(402);
      expect(up.seen).toHaveLength(0);
    } finally { proxy.stop(); }
  });
  test('a request the provider rejects before generating (413, a prompt over the context window) is metered at $0; a 5xx keeps its reservation', async () => {
    let status = 413;
    const up = fakeUpstream(() => Response.json({ type: 'error', error: { type: status === 413 ? 'request_too_large' : 'invalid_request_error', message: status === 413 ? 'Request exceeds the maximum size' : 'prompt is too long: 210000 tokens > 200000 maximum' } }, { status }));
    const proxy = new MeteringProxy({ fetchImpl: up.fetchImpl });
    proxy.start();
    const body = { model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: 'x'.repeat(3000) }] };
    const call = () => fetch(`http://127.0.0.1:${proxy.port}/slot0/anthropic/v1/messages`, { method: 'POST', body: JSON.stringify(body) });
    try {
      expect((await call()).status).toBe(413);
      status = 400;
      expect((await call()).status).toBe(400);
      const rejected = await proxy.finalize('slot:slot0');
      expect(rejected).toMatchObject({ usd: 0, requests: 2, unpriced: 0 });
      status = 500;
      expect((await call()).status).toBe(500);
      const failed = await proxy.finalize('slot:slot0');
      expect(failed.usd).toBeCloseTo(reservationUsd(priceRequest('https://api.anthropic.com/v1/messages', body)!), 9);
      expect(failed.unpriced).toBe(1);
    } finally { proxy.stop(); }
  });
});
