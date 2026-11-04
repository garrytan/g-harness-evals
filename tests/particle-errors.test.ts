/**
 * internal-task plan decision 12 in the runner: the metering proxy logs the status, `error.code` and `error.type` of a non-2xx
 * Particle answer on its usage line, and `trialTermination` (runner/trial/trial.ts, used by the multi-user and the
 * single-shot paths) reads those lines to decide whether a Particle trial is model_error. Keyless: every upstream is a fetch stand-in and every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { classify, trialTermination } from '../runner/trial/trial.ts';

const tmp = mkdtempSync(join(tmpdir(), 'particle-errors-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const ENV = { PARTICLE_API_KEY: 'placeholder-particle', OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' };
const TOKEN = 'trial-token:p.0123456789abcdef0123456789abcdef';
const MESSAGE = 'Invalid value for reasoning_effort: expected one of low, medium, high';
let n = 0;

/** A lease proxy whose upstream answers every request with status and body (a string is sent as text/html). */
function answering(status: number, body: unknown, models = ['particle:particle-1', 'openai:gpt-6-luna']) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'perr-' + id, leaseUsd: 1, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const fetchImpl = (async () => typeof body === 'string'
    ? new Response(body, { status, headers: { 'content-type': 'text/html' } })
    : Response.json(body, { status })) as unknown as typeof fetch;
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: ENV, usageLog, maxOutputTokens: 128_000 } });
  proxy.start();
  proxy.bind('p', 'trial-token:p', TOKEN, models);
  const post = (provider: string, model: string) => fetch('http://127.0.0.1:' + proxy.port + '/p/' + provider + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say ok.' }], reasoning_effort: 'medium' }) });
  const usage = () => readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  return { proxy, post, usage };
}

async function oneLine(status: number, body: unknown, provider = 'particle', model = 'particle-1'): Promise<UsageLine> {
  const t = answering(status, body);
  try {
    const res = await t.post(provider, model);
    expect(res.status).toBe(status);
    await res.text();
    await t.proxy.finalize('trial-token:p');
    const lines = t.usage();
    expect(lines).toHaveLength(1);
    return lines[0]!;
  } finally { t.proxy.stop(); }
}

describe('the proxy logs a non-2xx Particle answer\'s status and error code, and nothing else from it', () => {
  test('a 400 invalid_value carries status, error_code and error_type; the message and param stay out of the line', async () => {
    const line = await oneLine(400, { error: { message: MESSAGE, type: 'invalid_request_error', param: 'reasoning_effort', code: 'invalid_value' } });
    expect(line).toMatchObject({ provider: 'particle', outcome: 'forwarded', status: 400, error_code: 'invalid_value', error_type: 'invalid_request_error', actual_usd: 0 });
    expect(JSON.stringify(line)).not.toContain('Invalid value');
    expect(Object.keys(line)).not.toContain('param');
    expect(Object.keys(line)).not.toContain('message');
  });

  test('a 402 and a 429 carry their codes too', async () => {
    expect(await oneLine(402, { error: { message: 'Your credit balance is empty.', type: 'insufficient_credits_error', code: 'insufficient_credits' } }))
      .toMatchObject({ status: 402, error_code: 'insufficient_credits', error_type: 'insufficient_credits_error' });
    expect(await oneLine(429, { error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
      .toMatchObject({ status: 429, error_code: 'rate_limit_exceeded', error_type: 'rate_limit_error' });
  });

  test('an error with a code and no type logs the code alone', async () => {
    const line = await oneLine(400, { error: { message: MESSAGE, code: 'unsupported_parameter' } });
    expect(line.error_code).toBe('unsupported_parameter');
    expect('error_type' in line).toBe(false);
  });

  test('a body that is not JSON, or a code that is not a short token, logs the status alone', async () => {
    const html = await oneLine(400, '<html>Bad Request</html>');
    expect(html.status).toBe(400);
    expect('error_code' in html).toBe(false);
    const prose = await oneLine(400, { error: { message: MESSAGE, type: 'invalid request error', code: MESSAGE } });
    expect(prose.status).toBe(400);
    expect('error_code' in prose).toBe(false);
    expect('error_type' in prose).toBe(false);
    expect(JSON.stringify(prose)).not.toContain('Invalid value');
  });

  test('a 200 carries no error fields', async () => {
    const line = await oneLine(200, { model: 'particle-ai/particle-1', usage: { prompt_tokens: 10, completion_tokens: 2 } });
    expect(line.status).toBe(200);
    expect('error_code' in line).toBe(false);
    expect('error_type' in line).toBe(false);
  });

  test('a non-2xx answer sent as an event stream with a JSON body logs its code too', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: MESSAGE, type: 'invalid_request_error', code: 'invalid_value' } }), { status: 400, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const id = ++n;
    const lease = BudgetRun.openLease({ runId: 'perr-' + id, leaseUsd: 1, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
    const usageLog = join(tmp, 'usage-' + id + '.ndjson');
    const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: ENV, usageLog, maxOutputTokens: 128_000 } });
    proxy.start();
    proxy.bind('p', 'trial-token:p', TOKEN, ['particle:particle-1']);
    try {
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/p/particle/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ model: 'particle-1', messages: [], stream: true }) });
      expect(res.status).toBe(400);
      await res.text();
      await proxy.finalize('trial-token:p');
      const [line] = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
      expect(line).toMatchObject({ status: 400, streamed: true, error_code: 'invalid_value', error_type: 'invalid_request_error' });
      expect(JSON.stringify(line)).not.toContain('Invalid value');
    } finally { proxy.stop(); }
  });

  test('another provider\'s 400 is logged as before, with no error fields', async () => {
    const line = await oneLine(400, { error: { message: MESSAGE, type: 'invalid_request_error', code: 'invalid_value' } }, 'openai', 'gpt-6-luna');
    expect(line).toMatchObject({ provider: 'openai', status: 400 });
    expect('error_code' in line).toBe(false);
    expect('error_type' in line).toBe(false);
  });
});

describe('trialTermination: plan decision 12 from the proxy record', () => {
  const PARTICLE = 'particle:particle-1';
  const SINCE = '2026-11-01T10:00:00.000Z';
  const AT = '2026-11-01T10:00:05.000Z';
  const ok = { at: AT, provider: 'particle', outcome: 'forwarded', status: 200 };
  const err = (status: number, error_code?: string, at = AT) => ({ at, provider: 'particle', outcome: 'forwarded', status, ...(error_code ? { error_code } : {}) });
  const fromExits = (exits: number[]) => classify(exits, null, null, false);
  const decide = (model: string, lines: Array<Record<string, unknown>>, exits: number[], extra: Record<string, unknown> = {}) =>
    trialTermination({ cellModel: model, fromExits: fromExits(exits), since: SINCE, lines: lines as never, ...extra });

  test('a 400 invalid_value or unsupported_parameter is model_error, whatever the adapter exited', () => {
    for (const code of ['invalid_value', 'unsupported_parameter']) {
      for (const exits of [[2], [3], [0, 2], [0]]) {
        const d = decide(PARTICLE, [ok, err(400, code)], exits);
        expect(d.termination).toBe('model_error');
        expect(d.note).toContain('HE-MODEL-002');
        expect(d.note).toContain(code);
      }
    }
  });

  test('any other 400 keeps the harness\'s own exit: exit 2 is harness_error', () => {
    for (const lines of [[err(400, 'context_length_exceeded')], [err(400)]]) {
      const d = decide(PARTICLE, lines, [0, 2]);
      expect(d.termination).toBe('harness_error');
      expect(d.note).toBeUndefined();
    }
  });

  test('a 402 is model_error, whatever its code and the adapter\'s exit', () => {
    for (const exits of [[2], [3], [124]]) {
      expect(decide(PARTICLE, [err(402, 'insufficient_credits')], exits).termination).toBe('model_error');
      expect(decide(PARTICLE, [err(402)], exits).termination).toBe('model_error');
    }
  });

  test('a 429 keeps the current classification', () => {
    expect(decide(PARTICLE, [err(429, 'rate_limit_exceeded')], [3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [err(429, 'rate_limit_exceeded')], [2])).toEqual({ termination: 'harness_error' });
    expect(decide(PARTICLE, [err(429, 'rate_limit_exceeded')], [124])).toEqual({ termination: 'timeout' });
  });

  test('QM\'s blanket exit 3 on a 400 that is not listed is harness_error, not model_error', () => {
    const d = decide(PARTICLE, [ok, err(400, 'context_length_exceeded')], [0, 3]);
    expect(d.termination).toBe('harness_error');
    expect(d.note).toContain('HE-MODEL-002');
    expect(d.note).toContain('context_length_exceeded');
  });

  test('an exit 3 stays model_error when the trial also logged a 429, a 5xx or a failed request, on any provider', () => {
    const unlisted = err(400, 'context_length_exceeded');
    expect(decide(PARTICLE, [unlisted, err(429, 'rate_limit_exceeded')], [3, 3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [unlisted, err(503)], [0, 3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [unlisted, { at: AT, provider: 'particle', outcome: 'failed' }], [3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [unlisted, { at: AT, provider: 'anthropic', outcome: 'forwarded', status: 529 }], [3])).toEqual({ termination: 'model_error' });
  });

  test('the proxy\'s own refusals are not Particle answers', () => {
    const refused = { at: AT, provider: 'particle', outcome: 'refused', status: 400, reason: 'an output limit of 0' };
    expect(decide(PARTICLE, [refused], [3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [refused], [2])).toEqual({ termination: 'harness_error' });
  });

  test('a Particle trial with no error answer keeps its exits', () => {
    expect(decide(PARTICLE, [ok], [0])).toEqual({ termination: 'completed' });
    expect(decide(PARTICLE, [], [3])).toEqual({ termination: 'model_error' });
  });

  test('lines from before this attempt started (a resumed trial) do not count', () => {
    const before = '2026-11-01T09:59:59.000Z';
    expect(decide(PARTICLE, [err(402, 'insufficient_credits', before), ok], [0, 0, 0])).toEqual({ termination: 'completed' });
    expect(decide(PARTICLE, [err(400, 'context_length_exceeded', before)], [3])).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [err(400, 'invalid_value', SINCE)], [0]).termination).toBe('model_error');
  });

  test('an exam_fault stays exam_fault', () => {
    const fault = classify([0], null, 'exam_fault', false);
    expect(trialTermination({ cellModel: PARTICLE, fromExits: fault, since: SINCE, lines: [err(400, 'invalid_value'), err(402)] as never })).toEqual({ termination: 'exam_fault' });
  });

  test('a cap stop or a foreign model is model_error and an infra failure infra_error, with no decision-12 note', () => {
    const lines = [err(400, 'context_length_exceeded')];
    expect(decide(PARTICLE, lines, [3], { capStop: true })).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, lines, [2], { modelMismatch: true })).toEqual({ termination: 'model_error' });
    expect(decide(PARTICLE, [err(402)], [0], { infra: true })).toEqual({ termination: 'infra_error' });
    expect(decide('openai:gpt-6-luna', [], [0], { capStop: true })).toEqual({ termination: 'model_error' });
  });

  test('a cell on another model is unchanged, even with a listed code on its lines', () => {
    for (const model of ['openai:gpt-6-luna', 'anthropic:claude-opus-5-5']) {
      const provider = model.split(':')[0]!;
      const lines = [{ at: AT, provider, outcome: 'forwarded', status: 400, error_code: 'invalid_value' }, { at: AT, provider, outcome: 'forwarded', status: 402 }];
      expect(decide(model, lines, [2])).toEqual({ termination: 'harness_error' });
      expect(decide(model, lines, [3])).toEqual({ termination: 'model_error' });
      expect(decide(model, lines, [0])).toEqual({ termination: 'completed' });
    }
  });
});
