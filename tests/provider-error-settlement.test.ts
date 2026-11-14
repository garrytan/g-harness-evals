/**
 * What the metering proxy charges a lease for a provider's error answer, per provider and status, against recorded
 * answers (tests/fixtures/provider-errors/answers.json: live recordings, provider docs shapes, and shapes rebuilt from proxy
 * logs). An answer the provider does not bill settles at $0; anything else keeps its reservation and is marked
 * usage_unknown on its usage line. Keyless: placeholder keys and a fake upstream, no network.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, installPaidRequestGuard, ledgerStatus, priceRequest, readLedger, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, PROVIDER_ERROR_NOT_BILLED, type UsageLine } from '../runner/proxy/metering-proxy.ts';

interface Answer { provider: 'anthropic' | 'openai'; status: number; content_type: string; body: string; source: string }
const ANSWERS = (JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'provider-errors', 'answers.json'), 'utf8')) as { answers: Record<string, Answer> }).answers;
const tmp = mkdtempSync(join(tmpdir(), 'provider-errors-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const FAKE_ENV = { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' };
const ROUTE = { anthropic: '/v1/messages', openai: '/v1/responses' } as const;
const request = (provider: 'anthropic' | 'openai', stream: boolean) => provider === 'anthropic'
  ? { model: 'claude-opus-5-5', max_tokens: 4096, stream, messages: [{ role: 'user', content: 'fixture prompt' }] }
  : { model: 'gpt-6.1-sol', max_output_tokens: 4096, stream, input: 'fixture prompt' };
const answer = (a: Answer) => new Response(a.body, { status: a.status, headers: { 'content-type': a.content_type } });
let n = 0;

/** One request on its own lease through a lease-mode proxy whose upstream answers with the recorded answer. */
async function through(name: string) {
  const a = ANSWERS[name]!;
  expect(a).toBeDefined();
  const lease = BudgetRun.openLease({ runId: `errors-${++n}`, leaseUsd: 50, ledgerPath: join(tmp, `lease-${n}.sqlite`) });
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const proxy = new MeteringProxy({ fetchImpl: (async () => answer(a)) as unknown as typeof fetch, policy: { lease, env: FAKE_ENV, usageLog } });
  proxy.start();
  proxy.bind('c', 'k');
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/c/${a.provider}${ROUTE[a.provider]}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request(a.provider, a.content_type === 'text/event-stream')) });
    const text = await res.text();
    const meter = await proxy.finalize('k', 5000);
    const line = JSON.parse(readFileSync(usageLog, 'utf8').trim().split('\n').at(-1)!) as UsageLine;
    const entry = readLedger(lease.ledgerPath).entries[0]!;
    return { a, status: res.status, text, meter, line, entry, run: ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run! };
  } finally { proxy.stop(); }
}

describe('error answers the provider does not bill settle at $0', () => {
  beforeEach(() => closeLedgers());
  test.each([
    ['anthropic-401-authentication', undefined],
    ['anthropic-400-spend-limit', undefined],
    ['anthropic-403-permission', undefined],
    ['anthropic-413-request-too-large', undefined],
    ['anthropic-429-rate-limit', undefined],
    ['anthropic-500-api-error', 'api_error'],
    ['anthropic-503-credential-validation-text', 'credential_validation_failed'],
    ['anthropic-503-credential-validation-message', 'credential_validation_failed'],
    ['anthropic-503-credential-validation-envelope', 'credential_validation_failed'],
    ['anthropic-503-empty', 'empty_body'],
    ['anthropic-503-overloaded', 'overloaded_error'],
    ['anthropic-529-overloaded', 'overloaded_error'],
    ['anthropic-529-overloaded-as-stream', 'overloaded_error'],
    ['openai-401-invalid-key', undefined],
    ['openai-403-region', undefined],
    ['openai-429-rate-limit', undefined],
    ['openai-429-quota', undefined],
    ['openai-400-context-length', undefined],
    ['openai-500-server-error', 'server_error'],
    ['openai-503-overloaded', 'service_unavailable_error'],
    ['openai-503-engine-overloaded', 'server_error'],
  ] as Array<[string, string | undefined]>)('%s', async (name, kind) => {
    const o = await through(name);
    expect(o.status).toBe(o.a.status);
    expect(o.text).toBe(o.a.body);
    expect(o.line).toMatchObject({ outcome: 'forwarded', status: o.a.status, actual_usd: 0, charged_reservation: false, input_tokens: 0, output_tokens: 0 });
    expect(o.line.reserved_usd!).toBeGreaterThan(0);
    expect(o.line.reason).toBe(kind === undefined ? undefined : `HTTP ${o.a.status} ${kind}: ${PROVIDER_ERROR_NOT_BILLED}`);
    expect('usage_unknown' in o.line).toBe(false);
    expect(o.entry).toMatchObject({ status: 'reconciled', actual_usd: 0 });
    expect(o.meter).toMatchObject({ requests: 1, unpriced: 0, usd: 0 });
    expect(o.run).toMatchObject({ committed_usd: 0, measured_usd: 0, usage_unknown_usd: 0 });
  });
});

describe('answers that may have been billed keep their reservation, marked usage_unknown', () => {
  beforeEach(() => closeLedgers());
  test.each([
    ['anthropic-504-timeout', 'the response carried no usage'],
    ['anthropic-500-timeout', 'the response carried no usage'],
    ['anthropic-503-unknown-message', 'the response carried no usage'],
    ['anthropic-503-html', 'the response carried no usage'],
    ['openai-504-gateway', 'the response carried no usage'],
    ['openai-500-timeout', 'the response carried no usage'],
    ['openai-503-no-type', 'the response carried no usage'],
    ['openai-503-service-unavailable-no-code', 'the response carried no usage'],
    ['openai-502-html', 'the response carried no usage'],
    ['anthropic-stream-error-first', 'stream error overloaded_error before final usage'],
    ['openai-stream-error-invalid-request', 'stream error invalid_request before final usage'],
  ] as Array<[string, string]>)('%s', async (name, reason) => {
    const o = await through(name);
    expect(o.status).toBe(o.a.status);
    expect(o.line).toMatchObject({ outcome: 'forwarded', charged_reservation: true, usage_unknown: true, reported_usd: 0, reason });
    expect(o.line.reserved_usd!).toBeGreaterThan(0);
    expect(o.line.actual_usd).toBe(o.line.reserved_usd!);
    expect(o.entry).toMatchObject({ status: 'charged-reservation', actual_usd: o.entry.reserved_usd });
    expect(o.meter).toMatchObject({ requests: 1, unpriced: 1 });
    expect(o.run.committed_usd).toBeCloseTo(o.line.reserved_usd!, 12);
    expect(o.run).toMatchObject({ measured_usd: 0 });
    expect(o.run.usage_unknown_usd).toBeCloseTo(o.line.reserved_usd!, 12);
  });

  test('a stream cut after message_start keeps the larger of its reservation and the usage it reported, and records that usage', async () => {
    const o = await through('anthropic-stream-error-after-start');
    const partial = usageCost(priceRequest('https://api.anthropic.com/v1/messages', request('anthropic', true))!, { usage: { input_tokens: 20000, output_tokens: 1 } })!.usd;
    expect(partial).toBeGreaterThan(0);
    expect(o.line).toMatchObject({ charged_reservation: true, usage_unknown: true, input_tokens: 20000, output_tokens: 1, reason: 'stream error overloaded_error before final usage' });
    expect(o.line.reported_usd).toBeCloseTo(partial, 12);
    expect(o.line.actual_usd).toBe(Math.max(o.line.reserved_usd!, partial));
    expect(o.run.usage_unknown_usd).toBeCloseTo(o.line.actual_usd!, 12);
  });

  test('a Responses stream whose response.failed reports usage settles from that usage, not the reservation', async () => {
    const o = await through('openai-stream-failed-with-usage');
    const usd = usageCost(priceRequest('https://api.openai.com/v1/responses', request('openai', true))!, { usage: { input_tokens: 5000, output_tokens: 40 } })!.usd;
    expect(o.line).toMatchObject({ charged_reservation: false, input_tokens: 5000, output_tokens: 40 });
    expect(o.line.actual_usd).toBeCloseTo(usd, 12);
    expect('usage_unknown' in o.line).toBe(false);
    expect(o.run.measured_usd).toBeCloseTo(usd, 12);
    expect(o.run.usage_unknown_usd).toBe(0);
  });

  test('a lost connection keeps the reservation and is marked usage_unknown', async () => {
    const lease = BudgetRun.openLease({ runId: 'errors-lost', leaseUsd: 50, ledgerPath: join(tmp, 'lost.sqlite') });
    const usageLog = join(tmp, 'lost.ndjson');
    const proxy = new MeteringProxy({ fetchImpl: (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch, policy: { lease, env: FAKE_ENV, usageLog } });
    proxy.start();
    proxy.bind('c', 'k');
    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/c/anthropic/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request('anthropic', false)) });
      expect(res.status).toBe(502);
      const line = JSON.parse(readFileSync(usageLog, 'utf8').trim()) as UsageLine;
      expect(line).toMatchObject({ outcome: 'failed', charged_reservation: true, usage_unknown: true, reported_usd: 0 });
      expect(ledgerStatus({ ledgerPath: lease.ledgerPath, runId: 'errors-lost' }).run!.usage_unknown_usd).toBeCloseTo(line.reserved_usd!, 12);
    } finally { proxy.stop(); }
  });
});

describe('the in-process proxy and the paid-request guard apply the same rule', () => {
  beforeEach(() => closeLedgers());
  const price = (a: Answer) => priceRequest(`https://api.${a.provider}.com${ROUTE[a.provider]}`, request(a.provider, false))!;

  test.each([
    ['anthropic-503-credential-validation-text', 0],
    ['anthropic-503-empty', 0],
    ['openai-503-overloaded', 0],
    ['anthropic-504-timeout', 1],
  ] as Array<[string, number]>)('in-process mode: %s', async (name, charged) => {
    const a = ANSWERS[name]!;
    const proxy = new MeteringProxy({ fetchImpl: (async () => answer(a)) as unknown as typeof fetch });
    proxy.start();
    proxy.bind('c', 'k');
    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/c/${a.provider}${ROUTE[a.provider]}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request(a.provider, false)) });
      expect(res.status).toBe(a.status);
      const meter = await proxy.finalize('k', 5000);
      expect(meter.unpriced).toBe(charged);
      expect(meter.usd).toBeCloseTo(charged * reservationUsd(price(a)), 12);
    } finally { proxy.stop(); }
  });

  test.each([
    ['anthropic-503-credential-validation-text', 0],
    ['anthropic-503-empty', 0],
    ['anthropic-529-overloaded', 0],
    ['openai-503-overloaded', 0],
    ['openai-502-html', 1],
  ] as Array<[string, number]>)('paid-request guard: %s', async (name, charged) => {
    const a = ANSWERS[name]!;
    const run = BudgetRun.openLease({ runId: `guard-${++n}`, leaseUsd: 50, ledgerPath: join(tmp, `guard-${n}.sqlite`) });
    const guard = installPaidRequestGuard(run, { fetchImpl: (async () => answer(a)) as unknown as typeof fetch });
    try {
      const res = await fetch(`https://api.${a.provider}.com${ROUTE[a.provider]}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request(a.provider, false)) });
      expect(res.status).toBe(a.status);
    } finally { guard.uninstall(); }
    const s = run.summary();
    expect(s.charged_reservations).toBe(charged);
    expect(s.actual_usd).toBeCloseTo(charged * reservationUsd(price(a)), 12);
    expect(s.usage_unknown_usd).toBeCloseTo(s.actual_usd, 12);
    expect(s.measured_usd).toBe(0);
  });

  test('a 503 whose body broke off keeps its reservation in in-process mode and the paid-request guard', async () => {
    const broken = () => new Response(new ReadableStream({ start(c) { c.error(new Error('connection reset')); } }), { status: 503, headers: { 'content-type': 'text/event-stream' } });
    const body = JSON.stringify(request('anthropic', true));
    const reserved = reservationUsd(priceRequest('https://api.anthropic.com/v1/messages', request('anthropic', true))!);
    const proxy = new MeteringProxy({ fetchImpl: (async () => broken()) as unknown as typeof fetch });
    proxy.start();
    proxy.bind('c', 'k');
    try {
      await fetch(`http://127.0.0.1:${proxy.port}/c/anthropic/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => r.text()).catch(() => '');
      const meter = await proxy.finalize('k', 5000);
      expect(meter.unpriced).toBe(1);
      expect(meter.usd).toBeCloseTo(reserved, 12);
    } finally { proxy.stop(); }
    const run = BudgetRun.openLease({ runId: `guard-${++n}`, leaseUsd: 50, ledgerPath: join(tmp, `guard-${n}.sqlite`) });
    const guard = installPaidRequestGuard(run, { fetchImpl: (async () => broken()) as unknown as typeof fetch });
    try { await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => r.text()).catch(() => ''); }
    finally { guard.uninstall(); }
    const s = run.summary();
    expect(s.charged_reservations).toBe(1);
    expect(s.usage_unknown_usd).toBeCloseTo(s.actual_usd, 12);
    expect(s.actual_usd).toBeGreaterThan(0);
  });
});
