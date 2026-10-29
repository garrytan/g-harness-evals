/**
 * Native stream metering through the real proxy CLI in lease mode (internal-task; TODOS eng-r2-native-4, eng-r2-outside-2):
 * Anthropic Messages SSE and OpenAI Responses SSE, complete and interrupted, and provider error answers. Keyless: the
 * proxy process gets an explicit environment holding placeholder keys only, and `--upstream` points both providers at a
 * fake HTTP server on the loopback, written on raw sockets so a test can drop the connection mid-stream.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Socket, TCPSocketListener } from 'bun';
import { BudgetRun, closeLedgers, installPaidRequestGuard, priceRequest, readLedger, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, PROVIDER_ERROR_NOT_BILLED, sseIncomplete, sseUsage, type Meter, type UsageLine } from '../runner/proxy/metering-proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'proxy-streams-'));
const CONTROL = `control-${process.pid}`;
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };
const PROMPT = 'fixture prompt text';
const REPLY = 'fixture reply text';

const sse = (type: string, data: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const ANTHROPIC_USAGE = { input_tokens: 120, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000 };
const A = {
  start: sse('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, usage: { ...ANTHROPIC_USAGE, output_tokens: 1 } } }),
  blocks: [
    sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }), sse('ping'),
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: REPLY } }), sse('content_block_stop', { index: 0 }),
  ],
  delta: sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { ...ANTHROPIC_USAGE, output_tokens: 350 } }),
  stop: sse('message_stop'),
  error: sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }),
};
/** claude-haiku-5-5 at $0.10 input, $0.01 cache read, $0.125 cache write and $0.50 output per million tokens. */
const ANTHROPIC_USD = (120 * 0.1 + 30000 * 0.01 + 2000 * 0.125 + 350 * 0.5) / 1e6;

const inProgress = { id: 'resp_fixture', object: 'response', status: 'in_progress', model: 'gpt-6-luna', output: [], usage: null };
const R = {
  head: [
    sse('response.created', { sequence_number: 0, response: inProgress }), sse('response.in_progress', { sequence_number: 1, response: inProgress }),
    sse('response.output_item.added', { sequence_number: 2, output_index: 0, item: { id: 'rs_fixture', type: 'reasoning', summary: [] } }),
    sse('response.output_text.delta', { sequence_number: 3, item_id: 'msg_fixture', output_index: 1, content_index: 0, delta: REPLY }),
  ],
  completed: sse('response.completed', { sequence_number: 4, response: { ...inProgress, status: 'completed', usage: {
    input_tokens: 40000, input_tokens_details: { cached_tokens: 32000 }, output_tokens: 900, output_tokens_details: { reasoning_tokens: 700 }, total_tokens: 40900 } } }),
  error: sse('error', { sequence_number: 4, code: 'server_error', message: 'The server had an error while processing your request.' }),
  failed: sse('response.failed', { sequence_number: 5, response: { ...inProgress, status: 'failed', error: { code: 'server_error', message: 'failed' } } }),
};
/** gpt-6-luna at $0.10 input, $0.01 cached input and $0.50 output per million tokens; reasoning tokens are inside output_tokens. */
const RESPONSES_USD = (8000 * 0.1 + 32000 * 0.01 + 900 * 0.5) / 1e6;

/** What the fake answers: a JSON or text body, or SSE events that end cleanly or with a dropped connection. */
interface Fixture { status?: number; body?: unknown; type?: string; events?: string[]; gate?: Promise<void>; after?: string[]; end?: 'clean' | 'reset' }
interface Seen { fixture: string; path: string; credential: string | null; body: any }
type Conn = { buf: string; done: boolean };
const fixtures = new Map<string, Fixture>();
const seen: Seen[] = [];

async function answer(s: Socket<Conn>, f: Fixture) {
  if (!f.events) {
    const text = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
    s.write(`HTTP/1.1 ${f.status ?? 200} Fixture\r\ncontent-type: ${f.type ?? 'application/json'}\r\ncontent-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`);
    s.end();
    return;
  }
  s.write('HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n');
  const chunk = (t: string) => s.write(`${Buffer.byteLength(t).toString(16)}\r\n${t}\r\n`);
  for (const e of f.events) chunk(e);
  if (f.gate) { await f.gate; for (const e of f.after ?? []) chunk(e); }
  if (f.end === 'reset') { await Bun.sleep(50); s.terminate(); return; }
  s.write('0\r\n\r\n');
  s.end();
}

let fake: TCPSocketListener<Conn>;
let proxy: { proc: ReturnType<typeof Bun.spawn>; port: number; ledger: string; usageLog: string };

beforeAll(async () => {
  fake = Bun.listen<Conn>({ hostname: '127.0.0.1', port: 0, socket: {
    open(s) { s.data = { buf: '', done: false }; },
    data(s, bytes) {
      if (s.data.done) return;
      s.data.buf += bytes.toString();
      const head = s.data.buf.indexOf('\r\n\r\n');
      if (head < 0) return;
      const lines = s.data.buf.slice(0, head).split('\r\n');
      const headers = new Map(lines.slice(1).map(l => [l.slice(0, l.indexOf(':')).trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
      const body = s.data.buf.slice(head + 4);
      if (Buffer.byteLength(body) < Number(headers.get('content-length') ?? 0)) return;
      s.data.done = true;
      const name = headers.get('x-fixture') ?? '';
      const bearer = headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
      seen.push({ fixture: name, path: lines[0].split(' ')[1], credential: headers.get('x-api-key') ?? bearer, body: body ? JSON.parse(body) : undefined });
      void answer(s, fixtures.get(name) ?? { status: 404, body: { error: { type: 'not_found', message: `no fixture ${name}` } } });
    },
  } });
  const ledger = join(tmp, 'streams.sqlite'), usageLog = join(tmp, 'streams.ndjson');
  const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', '127.0.0.1:0', '--budget-ledger', ledger, '--lease-usd', '5', '--run-id', 'streams',
    '--allow-models', 'anthropic:claude-haiku-5-5,openai:gpt-6-luna', '--max-output-tokens', '4096', '--usage-log', usageLog, '--control-token', CONTROL,
    '--upstream', `anthropic=http://127.0.0.1:${fake.port}`, '--upstream', `openai=http://127.0.0.1:${fake.port}`], { cwd: ROOT, env: ENV, stdout: 'ignore', stderr: 'pipe' });
  const reader = proc.stderr.getReader();
  let text = '';
  while (!/ on 127\.0\.0\.1:\d+;/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the proxy did not start: ${text}`);
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  proxy = { proc, port: Number(text.match(/ on 127\.0\.0\.1:(\d+);/)![1]), ledger, usageLog };
});

afterAll(async () => {
  proxy?.proc.kill('SIGTERM');
  await proxy?.proc.exited;
  fake?.stop(true);
  closeLedgers();
  rmSync(tmp, { recursive: true, force: true });
});

const control = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${proxy.port}/__proxy/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': CONTROL }, body: JSON.stringify(body) });

const anthropicBody = { model: 'claude-haiku-5-5', max_tokens: 2048, stream: true, thinking: { type: 'enabled', budget_tokens: 1024 }, messages: [{ role: 'user', content: PROMPT }] };
const responsesBody = { model: 'gpt-6-luna', stream: true, max_output_tokens: 2048, reasoning: { effort: 'low' }, input: PROMPT };

interface Outcome { status: number; text: string; error: string | null; meter: Meter; line: UsageLine; entry: { status: string; reserved_usd: number; actual_usd: number | null } }

/**
 * One request on its own slot and trial key: register the fixture, bind the slot with a per-trial token, send it the way
 * a harness would (x-api-key or a bearer), read the reply (or let `consume` read part of it and cancel), finalize the key
 * so its settlement has landed, and return the meter, the usage line and the ledger entry.
 */
async function send(name: string, provider: 'anthropic' | 'openai', body: unknown, fixture: Fixture, consume?: (res: Response) => Promise<string>): Promise<Outcome> {
  fixtures.set(name, fixture);
  const key = `trial-token:${name}`, token = `tok-${name}`;
  expect((await control('bind', { slot: name, key, token })).status).toBe(200);
  const route = provider === 'anthropic' ? '/v1/messages' : '/v1/responses';
  const credential: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': token } : { authorization: `Bearer ${token}` };
  const res = await fetch(`http://127.0.0.1:${proxy.port}/${name}/${provider}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture': name, ...credential }, body: JSON.stringify(body) });
  let text = '', error: string | null = null;
  try { text = consume ? await consume(res) : await res.text(); } catch (e) { error = (e as Error).message; }
  const meter = await (await control('finalize', { key, timeout_ms: 10_000 })).json() as Meter;
  await control('unbind', { slot: name });
  const lines = readFileSync(proxy.usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as UsageLine).filter(l => l.key === key);
  expect(lines).toHaveLength(1);
  const entries = readLedger(proxy.ledger).entries.filter(e => e.description.endsWith(`[${key}]`));
  expect(entries).toHaveLength(1);
  return { status: res.status, text, error, meter, line: lines[0], entry: entries[0] };
}

/** Read until `marker` arrives, then cancel the response the way a client that gave up would. */
const readUntil = (marker: string) => async (res: Response) => {
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes(marker)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  return text;
};

function gate() { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; }

function expectPriced(o: Outcome, usd: number, tokens: { input: number; output: number; cached: number }) {
  expect(o.line).toMatchObject({ outcome: 'forwarded', status: 200, streamed: true, charged_reservation: false, input_tokens: tokens.input, output_tokens: tokens.output, cached_tokens: tokens.cached });
  expect(o.line.reason).toBeUndefined();
  expect(o.line.actual_usd!).toBeCloseTo(usd, 12);
  expect(o.entry.status).toBe('reconciled');
  expect(o.entry.actual_usd!).toBeCloseTo(usd, 12);
  expect(o.meter).toMatchObject({ requests: 1, unpriced: 0 });
  expect(o.meter.usd).toBeCloseTo(usd, 12);
}

/** Charged its reservation, unpriced; `partial`: the tokens of the partial usage the stream reported before it ended (below the reservation). */
function expectReservation(o: Outcome, reason: RegExp, partial?: { input: number; output: number }) {
  expect(o.line).toMatchObject({ outcome: 'forwarded', status: 200, streamed: true, charged_reservation: true });
  expect(o.line.reason).toMatch(reason);
  expect(o.line.input_tokens).toBe(partial?.input);
  expect(o.line.output_tokens).toBe(partial?.output);
  expect(o.line.actual_usd).toBe(o.line.reserved_usd!);
  expect(o.line.reserved_usd!).toBeGreaterThan(0);
  expect(o.entry).toMatchObject({ status: 'charged-reservation', actual_usd: o.entry.reserved_usd });
  expect(o.meter).toMatchObject({ requests: 1, unpriced: 1 });
  expect(o.meter.usd).toBeCloseTo(o.line.reserved_usd!, 12);
}

describe('Anthropic Messages streams through the proxy', () => {
  test('a complete stream settles from message_start and message_delta usage, cache reads and cache writes at their own rates', async () => {
    const o = await send('a-complete', 'anthropic', anthropicBody, { events: [A.start, ...A.blocks, A.delta, A.stop] });
    expect(o.status).toBe(200);
    expect(o.text).toBe([A.start, ...A.blocks, A.delta, A.stop].join(''));
    expectPriced(o, ANTHROPIC_USD, { input: 32120, output: 350, cached: 30000 });
    expect(o.line).toMatchObject({ provider: 'anthropic', route: '/v1/messages', model: 'claude-haiku-5-5', thinking_type: 'enabled', thinking_budget_tokens: 1024 });
    expect(o.line.reasoning_effort).toBeUndefined();
    const up = seen.find(s => s.fixture === 'a-complete')!;
    expect(up).toMatchObject({ path: '/v1/messages', credential: 'placeholder-anthropic' });
    expect(up.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2048, stream: true, thinking: { type: 'enabled', budget_tokens: 1024 } });
  });

  const partial = { input: 32120, output: 1 }, delta = { input: 32120, output: 350 };
  test.each([
    ['a-truncated', 'a clean end after the content blocks', { events: [A.start, ...A.blocks] }, /^the end of the stream came before message_delta usage and message_stop$/, partial],
    ['a-no-stop', 'a clean end after message_delta, before message_stop', { events: [A.start, ...A.blocks, A.delta] }, /^the end of the stream came before message_delta usage and message_stop$/, delta],
    ['a-error', 'an error event mid-stream', { events: [A.start, ...A.blocks, A.error] }, /^stream error overloaded_error before final usage$/, partial],
    ['a-error-first', 'an error event before message_start', { events: [A.error] }, /^stream error overloaded_error before final usage$/, undefined],
    ['a-reset', 'a dropped connection mid-stream', { events: [A.start, ...A.blocks], end: 'reset' }, /^the stream failed before its final usage: /, partial],
  ] as Array<[string, string, Fixture, RegExp, { input: number; output: number } | undefined]>)('%s (%s) keeps its reservation and is marked unpriced, never settled below it', async (name, _what, fixture, reason, tokens) => {
    expect(sseUsage([A.start, ...A.blocks].join(''))).not.toBeNull();
    const o = await send(name, 'anthropic', anthropicBody, fixture);
    expectReservation(o, reason, tokens);
    if (name === 'a-reset') expect(o.error).not.toBeNull();
  });

  test('a truncated stream whose message_start reports more input than the reservation covers (a PDF by URL) is charged its observed usage, marked unpriced', async () => {
    const big = sse('message_start', { message: { id: 'msg_url', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, usage: { input_tokens: 30000, output_tokens: 1 } } });
    const body = { ...anthropicBody, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'url', url: 'https://example.invalid/report.pdf' } }, { type: 'text', text: PROMPT }] }] };
    const o = await send('a-url-input', 'anthropic', body, { events: [big, ...A.blocks] });
    const observed = (30000 * 0.1 + 1 * 0.5) / 1e6;
    expect(o.line.reserved_usd!).toBeLessThan(observed);
    expect(o.line).toMatchObject({ outcome: 'forwarded', status: 200, streamed: true, charged_reservation: true, input_tokens: 30000, output_tokens: 1,
      reason: 'the end of the stream came before message_delta usage and message_stop; charged its partial usage, which cost more than the reservation' });
    expect(o.line.actual_usd!).toBeCloseTo(observed, 12);
    expect(o.entry.status).toBe('charged-reservation');
    expect(o.entry.actual_usd!).toBeCloseTo(observed, 12);
    expect(o.meter).toMatchObject({ requests: 1, unpriced: 1 });
    expect(o.meter.usd).toBeCloseTo(observed, 12);
  });

  test('a client that cancels mid-stream does not stop the meter: the proxy reads the provider stream to its end and prices it', async () => {
    const g = gate();
    const pending = send('a-cancel', 'anthropic', anthropicBody, { events: [A.start, ...A.blocks], gate: g.p, after: [A.delta, A.stop] }, readUntil(REPLY));
    await Bun.sleep(200);
    g.open();
    const o = await pending;
    expect(o.text).toContain(REPLY);
    expect(o.text).not.toContain('message_stop');
    expectPriced(o, ANTHROPIC_USD, { input: 32120, output: 350, cached: 30000 });
  });

  test('a client that cancels and a provider stream that then drops keep the reservation', async () => {
    const g = gate();
    const pending = send('a-cancel-reset', 'anthropic', anthropicBody, { events: [A.start, ...A.blocks], gate: g.p, after: [], end: 'reset' }, readUntil(REPLY));
    await Bun.sleep(200);
    g.open();
    expectReservation(await pending, /^the stream failed before its final usage: /, { input: 32120, output: 1 });
  });
});

describe('OpenAI Responses streams through the proxy', () => {
  test('a complete stream settles from response.completed usage, cached input at the cache rate and reasoning tokens as output', async () => {
    const o = await send('r-complete', 'openai', responsesBody, { events: [...R.head, R.completed] });
    expect(o.status).toBe(200);
    expect(o.text).toBe([...R.head, R.completed].join(''));
    expectPriced(o, RESPONSES_USD, { input: 40000, output: 900, cached: 32000 });
    expect(o.line).toMatchObject({ provider: 'openai', route: '/v1/responses', model: 'gpt-6-luna', reasoning_effort: 'low' });
    expect(o.line.thinking_type).toBeUndefined();
    const up = seen.find(s => s.fixture === 'r-complete')!;
    expect(up).toMatchObject({ path: '/v1/responses', credential: 'placeholder-openai' });
    expect(up.body).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 2048, stream: true, reasoning: { effort: 'low' } });
    expect(up.body.stream_options).toBeUndefined();
  });

  test('a request naming no output limit gets the cap in max_output_tokens', async () => {
    const { max_output_tokens: _, ...uncapped } = responsesBody;
    const o = await send('r-capped', 'openai', uncapped, { events: [...R.head, R.completed] });
    expect(o.line.charged_reservation).toBe(false);
    expect(seen.find(s => s.fixture === 'r-capped')!.body.max_output_tokens).toBe(4096);
  });

  test.each([
    ['r-truncated', 'a clean end after the text deltas', { events: R.head }, /^the end of the stream came before response\.completed usage$/],
    ['r-error', 'an error event and response.failed without usage', { events: [...R.head, R.error, R.failed] }, /^stream error server_error before final usage$/],
    ['r-failed', 'response.failed without usage', { events: [...R.head, R.failed] }, /^stream error server_error before final usage$/],
    ['r-reset', 'a dropped connection mid-stream', { events: R.head, end: 'reset' }, /^the stream failed before its final usage: /],
  ] as Array<[string, string, Fixture, RegExp]>)('%s (%s) keeps its reservation and is marked unpriced', async (name, _what, fixture, reason) => {
    expectReservation(await send(name, 'openai', responsesBody, fixture), reason);
  });

  test('a client that cancels mid-stream does not stop the meter; a provider stream that then drops keeps the reservation', async () => {
    const g1 = gate();
    const pending = send('r-cancel', 'openai', responsesBody, { events: R.head, gate: g1.p, after: [R.completed] }, readUntil(REPLY));
    await Bun.sleep(200);
    g1.open();
    expectPriced(await pending, RESPONSES_USD, { input: 40000, output: 900, cached: 32000 });
    const g2 = gate();
    const dropped = send('r-cancel-reset', 'openai', responsesBody, { events: R.head, gate: g2.p, after: [], end: 'reset' }, readUntil(REPLY));
    await Bun.sleep(200);
    g2.open();
    expectReservation(await dropped, /^the stream failed before its final usage: /);
  });

  test('a response.incomplete stream (max_output_tokens) is final and settles at its usage', async () => {
    const usage = { input_tokens: 5000, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 2048, output_tokens_details: { reasoning_tokens: 2000 }, total_tokens: 7048 };
    const incomplete = sse('response.incomplete', { sequence_number: 4, response: { ...inProgress, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage } });
    const o = await send('r-incomplete', 'openai', responsesBody, { events: [...R.head, incomplete] });
    expectPriced(o, (4000 * 0.1 + 1000 * 0.01 + 2048 * 0.5) / 1e6, { input: 5000, output: 2048, cached: 1000 });
  });
});

describe('provider error answers through the proxy', () => {
  const whole = (b: Record<string, unknown>) => ({ ...b, stream: false });
  const route = (provider: 'anthropic' | 'openai') => whole(provider === 'anthropic' ? anthropicBody : responsesBody);
  const anthropicError = (type: string) => ({ type: 'error', error: { type, message: 'fixture error' } });
  const openaiError = (type: string | undefined, code: string | null) => ({ error: { message: 'fixture error', ...(type === undefined ? {} : { type }), param: null, code } });

  test.each([
    ['e-a500', 'anthropic', 500, anthropicError('api_error'), 'api_error'],
    ['e-529', 'anthropic', 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'overloaded_error'],
    ['e-o500', 'openai', 500, openaiError('server_error', null), 'server_error'],
    ['e-o500-code', 'openai', 500, openaiError('server_error', 'server_error'), 'server_error'],
    ['e-o500-code-only', 'openai', 500, openaiError(undefined, 'server_error'), 'server_error'],
    ['e-o503', 'openai', 503, openaiError('server_error', 'service_unavailable'), 'server_error'],
  ] as Array<[string, 'anthropic' | 'openai', number, unknown, string]>)('%s: a %s %d with the provider\'s own not-billed error envelope settles at $0 with a reason', async (name, provider, status, body, kind) => {
    const o = await send(name, provider, route(provider), { status, body });
    expect(o.status).toBe(status);
    expect(o.line).toMatchObject({ outcome: 'forwarded', status, actual_usd: 0, charged_reservation: false, streamed: false, input_tokens: 0, output_tokens: 0 });
    expect(o.line.reason).toBe(`HTTP ${status} ${kind}: ${PROVIDER_ERROR_NOT_BILLED}`);
    expect(o.entry).toMatchObject({ status: 'reconciled', actual_usd: 0 });
    expect(o.meter).toMatchObject({ requests: 1, unpriced: 0, usd: 0, upstream: { statuses: { [String(status)]: 1 } } });
    expect(JSON.stringify(JSON.parse(o.text))).toBe(JSON.stringify(body));
  });

  test.each([
    ['k-a504-timeout', 'anthropic', 504, anthropicError('timeout_error')],
    ['k-a500-timeout', 'anthropic', 500, anthropicError('timeout_error')],
    ['k-a529-unknown', 'anthropic', 529, anthropicError('mystery_error')],
    ['k-a503-overloaded', 'anthropic', 503, anthropicError('overloaded_error')],
    ['k-a500-no-envelope', 'anthropic', 500, { error: { type: 'api_error', message: 'fixture error' } }],
    ['k-a500-openai-shape', 'anthropic', 500, openaiError('server_error', null)],
    ['k-a500-gateway', 'anthropic', 500, { error: { status: 500, message: 'gateway error' } }],
    ['k-a529-array', 'anthropic', 529, [anthropicError('overloaded_error')]],
    ['k-a529-html', 'anthropic', 529, '<html><body>529 Site is overloaded</body></html>'],
    ['k-o504-gateway', 'openai', 504, { error: { status: 504, message: 'gateway timeout' } }],
    ['k-o504-server', 'openai', 504, openaiError('server_error', null)],
    ['k-o500-timeout', 'openai', 500, openaiError('timeout_error', null)],
    ['k-o503-timeout-code', 'openai', 503, openaiError('server_error', 'timeout')],
    ['k-o500-anthropic-shape', 'openai', 500, anthropicError('api_error')],
    ['k-o502-html', 'openai', 502, '<html><body>502 Bad Gateway</body></html>'],
  ] as Array<[string, 'anthropic' | 'openai', number, unknown]>)('%s: a %s %d that is not a known not-billed envelope keeps its reservation', async (name, provider, status, body) => {
    const o = await send(name, provider, route(provider), { status, body, ...(typeof body === 'string' ? { type: 'text/html' } : {}) });
    expect(o.status).toBe(status);
    expect(o.line).toMatchObject({ outcome: 'forwarded', status, charged_reservation: true, reason: 'the response carried no usage' });
    expect(o.line.reserved_usd!).toBeGreaterThan(0);
    expect(o.line.actual_usd).toBe(o.line.reserved_usd!);
    expect(o.entry).toMatchObject({ status: 'charged-reservation', actual_usd: o.entry.reserved_usd });
    expect(o.meter).toMatchObject({ requests: 1, unpriced: 1 });
  });

  test('a 4xx without usage settles at $0 with no reason', async () => {
    const rejected = await send('e-400', 'anthropic', whole(anthropicBody), { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } });
    expect(rejected.line).toMatchObject({ status: 400, actual_usd: 0, charged_reservation: false });
    expect(rejected.line.reason).toBeUndefined();
  });

  test('the usage log never carries a key, a trial token, a prompt or a reply', () => {
    const log = readFileSync(proxy.usageLog, 'utf8');
    expect(log.length).toBeGreaterThan(0);
    for (const s of ['placeholder-', 'tok-', PROMPT, REPLY, 'Overloaded', 'Bad Gateway']) expect(log).not.toContain(s);
  });
});

describe('reasoning settings on the usage line', () => {
  const MARKER = 'private-marker-7f3a9c';
  /** A request the proxy refuses before forwarding (its output limit is above the cap), on its own slot and key. */
  async function refused(name: string, provider: 'anthropic' | 'openai', body: unknown) {
    const key = `trial-token:${name}`, token = `tok-${name}`;
    expect((await control('bind', { slot: name, key, token })).status).toBe(200);
    const route = provider === 'anthropic' ? '/v1/messages' : '/v1/responses';
    const credential: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': token } : { authorization: `Bearer ${token}` };
    const res = await fetch(`http://127.0.0.1:${proxy.port}/${name}/${provider}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...credential }, body: JSON.stringify(body) });
    await res.text();
    await control('unbind', { slot: name });
    return { status: res.status, lines: readFileSync(proxy.usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as UsageLine).filter(l => l.key === key) };
  }

  test('only allowlisted values are logged; a private marker in thinking.type or reasoning.effort never reaches the usage log, forwarded or refused', async () => {
    const a = await send('h-thinking', 'anthropic', { ...anthropicBody, thinking: { type: MARKER, budget_tokens: 1.5 } }, { events: [A.start, ...A.blocks, A.delta, A.stop] });
    const r = await send('h-effort', 'openai', { ...responsesBody, reasoning: { effort: MARKER } }, { events: [...R.head, R.completed] });
    const ok = await send('h-adaptive', 'anthropic', { ...anthropicBody, thinking: { type: 'adaptive', budget_tokens: -5 } }, { events: [A.start, ...A.blocks, A.delta, A.stop] });
    const okEffort = await send('h-xhigh', 'openai', { ...responsesBody, reasoning: { effort: 'xhigh' } }, { events: [...R.head, R.completed] });
    for (const o of [a, r]) {
      expect(o.line.charged_reservation).toBe(false);
      expect(o.line.reasoning_effort).toBeUndefined();
      expect(o.line.thinking_type).toBeUndefined();
      expect(o.line.thinking_budget_tokens).toBeUndefined();
    }
    expect(seen.find(s => s.fixture === 'h-thinking')!.body.thinking.type).toBe(MARKER);
    expect(ok.line).toMatchObject({ thinking_type: 'adaptive' });
    expect(ok.line.thinking_budget_tokens).toBeUndefined();
    expect(okEffort.line).toMatchObject({ reasoning_effort: 'xhigh' });
    const capped = { ...anthropicBody, max_tokens: 999_999, thinking: { type: MARKER, budget_tokens: 1024 } };
    const refusedA = await refused('h-refused-a', 'anthropic', capped);
    const refusedR = await refused('h-refused-r', 'openai', { ...responsesBody, max_output_tokens: 999_999, reasoning: { effort: MARKER } });
    for (const x of [refusedA, refusedR]) {
      expect(x.status).toBe(400);
      expect(x.lines).toHaveLength(1);
      expect(x.lines[0]).toMatchObject({ outcome: 'refused', status: 400 });
    }
    expect(readFileSync(proxy.usageLog, 'utf8')).not.toContain(MARKER);
  });
});

describe('cache write TTLs', () => {
  const url = 'https://api.anthropic.com/v1/messages';
  const cached = (ttl?: string) => ({ model: 'claude-haiku-5-5', max_tokens: 100, system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral', ...(ttl ? { ttl } : {}) } }], messages: [{ role: 'user', content: PROMPT }] });

  test('1-hour cache writes cost 2x input and the rest of cache_creation_input_tokens the 5-minute rate; a 1h request reserves its input at 2x', () => {
    const price = priceRequest(url, cached('1h'))!;
    const usage = { input_tokens: 100, cache_creation_input_tokens: 3000, cache_read_input_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 }, output_tokens: 50 };
    expect(usageCost(price, { usage })!.usd).toBeCloseTo((100 * 0.1 + 500 * 0.01 + 1000 * 0.125 + 2000 * 0.2 + 50 * 0.5) / 1e6, 15);
    const { cache_creation: _, ...noSplit } = usage;
    expect(usageCost(price, { usage: noSplit })!.usd).toBeCloseTo((100 * 0.1 + 500 * 0.01 + 3000 * 0.125 + 50 * 0.5) / 1e6, 15);
    const long = { input_tokens: 150_000, cache_creation_input_tokens: 10_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10_000 }, output_tokens: 10 };
    expect(usageCost(price, { usage: long })!.usd).toBeCloseTo((150_000 * 0.5 + 10_000 * 1.0 + 10 * 2.5) / 1e6, 15);
    expect(price.cacheWrite1h).toBe(true);
    expect(reservationUsd(price)).toBeCloseTo((price.inputTokens * 0.2 + 100 * 0.5) / 1e6, 15);
    const fiveMinute = priceRequest(url, cached())!;
    expect(fiveMinute.cacheWrite1h).toBeUndefined();
    expect(reservationUsd(fiveMinute)).toBeCloseTo((fiveMinute.inputTokens * 0.125 + 100 * 0.5) / 1e6, 15);
  });

  test('through the proxy, a stream reporting 1-hour cache writes settles at the 2x rate for them', async () => {
    const usage = { input_tokens: 120, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } };
    const start = sse('message_start', { message: { id: 'msg_1h', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
    const delta = sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 120, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: 350 } });
    const o = await send('a-cache-1h', 'anthropic', { ...cached('1h'), stream: true }, { events: [start, ...A.blocks, delta, A.stop] });
    expectPriced(o, (120 * 0.1 + 30000 * 0.01 + 500 * 0.125 + 1500 * 0.2 + 350 * 0.5) / 1e6, { input: 32120, output: 350, cached: 30000 });
  });
});

describe('the paid-request guard and in-process mode charge an unfinished stream the larger of its reservation and its partial usage', () => {
  const body = { model: 'claude-haiku-5-5', max_tokens: 2048, stream: true, messages: [{ role: 'user', content: PROMPT }] };
  const big = sse('message_start', { message: { id: 'msg_url', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, usage: { input_tokens: 30000, output_tokens: 1 } } });
  const observed = (30000 * 0.1 + 1 * 0.5) / 1e6;
  const reserved = () => reservationUsd(priceRequest('https://api.anthropic.com/v1/messages', body)!);
  const upstream = (events: () => string[]) => (async () => new Response(events().join(''), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

  test('installPaidRequestGuard: a truncated Anthropic stream is charged-reservation at its reservation, or at its partial usage when that is larger', async () => {
    const ledgerPath = join(tmp, 'guard.sqlite');
    const run = BudgetRun.openLease({ runId: 'guard-streams', leaseUsd: 1, ledgerPath });
    let events: string[] = [];
    const guard = installPaidRequestGuard(run, { fetchImpl: upstream(() => events) });
    try {
      for (const e of [[A.start, ...A.blocks], [big, ...A.blocks], [A.start, ...A.blocks, A.delta, A.stop]]) {
        events = e;
        await (await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify(body) })).text();
      }
    } finally { guard.uninstall(); }
    expect(observed).toBeGreaterThan(reserved());
    const entries = readLedger(ledgerPath).entries.filter(e => e.run_id === 'guard-streams');
    expect(entries.map(e => e.status)).toEqual(['charged-reservation', 'charged-reservation', 'reconciled']);
    expect(entries[0].actual_usd!).toBeCloseTo(reserved(), 12);
    expect(entries[1].actual_usd!).toBeCloseTo(observed, 12);
    expect(entries[1]).toMatchObject({ input_tokens: 30000, output_tokens: 1 });
    expect(entries[2].actual_usd!).toBeCloseTo(ANTHROPIC_USD, 12);
  });

  test('in-process mode: the same stream is metered unpriced at the larger of its reservation and its partial usage', async () => {
    let events: string[] = [];
    const proxy = new MeteringProxy({ fetchImpl: upstream(() => events) });
    proxy.start();
    try {
      const call = async (slot: string, e: string[]) => {
        events = e;
        await (await fetch(`http://127.0.0.1:${proxy.port}/${slot}/anthropic/v1/messages`, { method: 'POST', body: JSON.stringify(body) })).text();
        return proxy.finalize(`slot:${slot}`);
      };
      const small = await call('ip-small', [A.start, ...A.blocks]);
      expect(small).toMatchObject({ requests: 1, unpriced: 1 });
      expect(small.usd).toBeCloseTo(reserved(), 12);
      const large = await call('ip-large', [big, ...A.blocks]);
      expect(large).toMatchObject({ requests: 1, unpriced: 1 });
      expect(large.usd).toBeCloseTo(observed, 12);
      const done = await call('ip-done', [A.start, ...A.blocks, A.delta, A.stop]);
      expect(done).toMatchObject({ requests: 1, unpriced: 0 });
      expect(done.usd).toBeCloseTo(ANTHROPIC_USD, 12);
    } finally { proxy.stop(); }
  });
});

describe('sseIncomplete', () => {
  test('names what a stream lacks, and is null for a finished stream or one that carries usage only at its end', () => {
    expect(sseIncomplete([A.start, ...A.blocks, A.delta, A.stop].join(''))).toBeNull();
    expect(sseIncomplete([A.start, ...A.blocks, A.stop].join(''))).toBe('the end of the stream came before message_delta usage and message_stop');
    expect(sseIncomplete([...R.head, R.completed].join(''))).toBeNull();
    const incomplete = sse('response.incomplete', { response: { ...inProgress, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 4096 } } });
    expect(sseIncomplete([...R.head, incomplete].join(''))).toBeNull();
    expect(sseIncomplete('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n')).toBeNull();
    expect(sseIncomplete('data: {"type":"error","error":{"type":"has spaces in it"}}\n\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n'))
      .toBe('stream error of an unnamed type before final usage');
    expect(sseIncomplete(A.error)).toBe('stream error overloaded_error before final usage');
    expect(sseIncomplete([A.start, ...A.blocks, A.error].join(''))).toBe('stream error overloaded_error before final usage');
    expect(sseIncomplete([...R.head, R.error, R.failed].join(''))).toBe('stream error server_error before final usage');
  });
});
