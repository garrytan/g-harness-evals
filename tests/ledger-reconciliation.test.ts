/**
 * Ledger reconciliation for the metering proxy (keyless). One lease takes a mixed day of answers from
 * tests/fixtures/provider-errors/answers.json plus two successes, a cut stream and a lost connection. Then the usage log,
 * the trial meter, the ledger and the proxy's summary command must agree to the cent, and the ledger must split committed
 * spend into what providers reported (measured_usd) and what it holds for calls whose usage is unknown (usage_unknown_usd).
 */
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus, priceRequest, readLedger, usageCost, verifyLedger } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, type UsageLine } from '../runner/proxy/metering-proxy.ts';

interface Answer { provider: 'anthropic' | 'openai'; status: number; content_type: string; body: string }
const ANSWERS = (JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'provider-errors', 'answers.json'), 'utf8')) as { answers: Record<string, Answer> }).answers;
const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'ledger-reconcile-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const OPUS = { model: 'claude-opus-5-5', max_tokens: 4096, messages: [{ role: 'user', content: 'fixture prompt' }] };
const SOL = { model: 'gpt-6.1-sol', max_output_tokens: 4096, input: 'fixture prompt' };
const OPUS_USAGE = { input_tokens: 1200, cache_read_input_tokens: 30000, output_tokens: 400 };
const SOL_USAGE = { input_tokens: 9000, input_tokens_details: { cached_tokens: 8000 }, output_tokens: 700 };
const sse = (e: Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const SOL_STREAM = [
  sse({ type: 'response.created', response: { id: 'resp_r', status: 'in_progress', output: [], usage: null } }),
  sse({ type: 'response.completed', response: { id: 'resp_r', status: 'completed', output: [], usage: SOL_USAGE } }),
].join('');

/** Each call: a label, the provider, the request body, and what the upstream does. */
const CALLS: Array<[string, 'anthropic' | 'openai', Record<string, unknown>, () => Response]> = [
  ['opus ok', 'anthropic', OPUS, () => Response.json({ id: 'msg_r', type: 'message', content: [], usage: OPUS_USAGE })],
  ['sol stream ok', 'openai', { ...SOL, stream: true }, () => new Response(SOL_STREAM, { headers: { 'content-type': 'text/event-stream' } })],
  ...['anthropic-503-credential-validation-text', 'anthropic-503-credential-validation-text', 'anthropic-529-overloaded', 'anthropic-401-authentication',
    'openai-503-overloaded', 'openai-429-rate-limit', 'anthropic-504-timeout', 'openai-502-html', 'anthropic-stream-error-first',
    'openai-stream-error-invalid-request', 'anthropic-stream-error-after-start'].map((name): [string, 'anthropic' | 'openai', Record<string, unknown>, () => Response] => {
    const a = ANSWERS[name]!;
    const stream = a.content_type === 'text/event-stream';
    return [name, a.provider, { ...(a.provider === 'anthropic' ? OPUS : SOL), stream }, () => new Response(a.body, { status: a.status, headers: { 'content-type': a.content_type } })];
  }),
  ['lost connection', 'anthropic', OPUS, () => { throw new Error('socket hang up'); }],
];

test('usage lines, meter, ledger and the summary command reconcile, with measured and usage-unknown spend reported apart', async () => {
  const ledgerPath = join(tmp, 'day.sqlite'), usageLog = join(tmp, 'day.ndjson');
  const lease = BudgetRun.openLease({ runId: 'reconcile-day', leaseUsd: 100, ledgerPath });
  let i = 0;
  const fetchImpl = (async () => CALLS[i++]![3]()) as unknown as typeof fetch;
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' }, usageLog } });
  proxy.start();
  proxy.bind('c', 'trial');
  let meter;
  try {
    for (const [, provider, body] of CALLS) {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/c/${provider}${provider === 'anthropic' ? '/v1/messages' : '/v1/responses'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      await res.text();
    }
    meter = await proxy.finalize('trial', 10_000);
  } finally { proxy.stop(); }

  const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as UsageLine);
  expect(lines).toHaveLength(CALLS.length);
  const total = (ls: UsageLine[]) => ls.reduce((s, l) => s + l.actual_usd!, 0);
  const unknown = lines.filter(l => l.usage_unknown), known = lines.filter(l => !l.usage_unknown);
  expect(unknown.map(l => l.charged_reservation)).toEqual(unknown.map(() => true));
  expect(known.map(l => l.charged_reservation)).toEqual(known.map(() => false));

  const opus = usageCost(priceRequest('https://api.anthropic.com/v1/messages', OPUS)!, { usage: OPUS_USAGE })!.usd;
  const sol = usageCost(priceRequest('https://api.openai.com/v1/responses', { ...SOL, stream: true })!, { usage: SOL_USAGE })!.usd;
  expect(total(known)).toBeCloseTo(opus + sol, 12);
  expect(known.filter(l => l.actual_usd! > 0)).toHaveLength(2);
  expect(unknown).toHaveLength(6);
  for (const l of unknown) {
    expect(l.reported_usd!).toBeGreaterThanOrEqual(0);
    expect(l.reported_usd!).toBeLessThanOrEqual(l.actual_usd!);
    expect(l.actual_usd!).toBeGreaterThanOrEqual(l.reserved_usd!);
  }
  expect(unknown.filter(l => l.reported_usd! > 0)).toHaveLength(1);

  const run = ledgerStatus({ ledgerPath, runId: 'reconcile-day' }).run!;
  expect(run.committed_usd).toBeCloseTo(total(lines), 9);
  expect(run.measured_usd).toBeCloseTo(total(known), 9);
  expect(run.usage_unknown_usd).toBeCloseTo(total(unknown), 9);
  expect(run.measured_usd + run.usage_unknown_usd).toBeCloseTo(run.committed_usd, 9);
  expect(meter!.usd).toBeCloseTo(run.committed_usd, 9);
  expect(meter!.unpriced).toBe(unknown.length);
  expect(meter!.requests).toBe(lines.length);

  const summary = lease.summary();
  expect(summary).toMatchObject({ requests: lines.length, charged_reservations: unknown.length });
  expect(summary.measured_usd).toBeCloseTo(run.measured_usd, 9);
  expect(summary.usage_unknown_usd).toBeCloseTo(run.usage_unknown_usd, 9);
  const entries = readLedger(ledgerPath).entries;
  expect(entries.filter(e => e.status === 'charged-reservation')).toHaveLength(unknown.length);
  expect(entries.filter(e => e.status === 'reconciled' && e.actual_usd === 0)).toHaveLength(lines.length - unknown.length - 2);
  expect(verifyLedger(ledgerPath)).toMatchObject({ ok: true, problems: [] });
  const status = ledgerStatus({ ledgerPath });
  expect(status.totals.measured_usd + status.totals.usage_unknown_usd).toBeCloseTo(status.totals.committed_usd, 9);

  closeLedgers();
  const cli = Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', ledgerPath, '--run-id', 'reconcile-day'],
    { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp } });
  expect(cli.exitCode).toBe(0);
  const printed = JSON.parse(cli.stdout.toString()) as Record<string, number>;
  expect(printed.committed_usd).toBeCloseTo(run.committed_usd, 9);
  expect(printed.measured_usd).toBeCloseTo(run.measured_usd, 9);
  expect(printed.usage_unknown_usd).toBeCloseTo(run.usage_unknown_usd, 9);
  expect(printed.requests).toBe(lines.length);
});
