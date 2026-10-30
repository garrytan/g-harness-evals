// Tests for the turn grammar, logging, key check and caps added to the keyless
// fake Anthropic endpoint (scripts/gsta-135/fake-anthropic.ts) for the internal-task
// anatomy captures. The fake runs in-process on 127.0.0.1 with a random port,
// and once as a subprocess under env -i for the command-line flags. Every key
// here is a placeholder; nothing leaves the machine.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { findTool, minimalArguments, startFakeAnthropic, stream, validateScript, type FakeAnthropic, type FakeOptions, type Turn } from '../scripts/gsta-135/fake-anthropic.ts';

const ROOT = join(import.meta.dir, '..');
const KEY = 'trial-token:placeholder';
const fakes: FakeAnthropic[] = [];
afterAll(() => { for (const f of fakes) f.stop(); });
const tmp = () => mkdtempSync(join(tmpdir(), 'fake-grammar-'));
const start = (o: FakeOptions = {}) => { const f = startFakeAnthropic({ log: join(tmp(), 'requests.ndjson'), ...o }); fakes.push(f); return f; };
const post = (f: FakeAnthropic, body: unknown, headers: Record<string, string> = {}) =>
  fetch(f.url + '/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, ...headers }, body: JSON.stringify(body) });
const events = (sse: string) => sse.split('\n\n').filter(Boolean).map(chunk => JSON.parse(chunk.split('\n').find(l => l.startsWith('data: '))!.slice(6)));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const schema = {
  type: 'object',
  properties: {
    channel: { type: 'string' }, limit: { type: 'integer' }, ratio: { type: 'number' }, unread: { type: 'boolean' }, ids: { type: 'array' },
    filter: { type: 'object' }, mode: { type: 'string', enum: ['recent', 'all'] }, note: { type: ['null', 'string'] }, optional: { type: 'string' },
  },
  required: ['channel', 'limit', 'ratio', 'unread', 'ids', 'filter', 'mode', 'note'],
};
const tools = [
  { name: 'Read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } },
  { name: 'exec', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'mcp__world__read_channel', input_schema: schema },
  { name: 'world_search', input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
];
const agent = (extra: Record<string, unknown> = {}) => ({ model: 'claude-sonnet-5-5', max_tokens: 1024, tools, messages: [{ role: 'user', content: 'go' }], ...extra });
const side = (extra: Record<string, unknown> = {}) => ({ model: 'claude-haiku-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'title?' }], ...extra });

describe('fake-anthropic.ts call turns', () => {
  test('minimal arguments from an input_schema and tool lookup by exact name, __ suffix and _ suffix', () => {
    expect(minimalArguments(schema)).toEqual({ channel: 'x', limit: 1, ratio: 1, unread: false, ids: [], filter: {}, mode: 'recent', note: 'x' });
    expect(minimalArguments(undefined)).toEqual({});
    expect(findTool(tools, 'Read')?.name).toBe('Read');
    expect(findTool(tools, 'read_channel')?.name).toBe('mcp__world__read_channel');
    expect(findTool(tools, 'search')?.name).toBe('world_search');
    expect(findTool([{ name: 'world__search' }, { name: 'search' }], 'search')?.name).toBe('search');
    expect(findTool(tools, 'post_message')).toBeNull();
  });

  test('plays call turns as tool_use, JSON and streamed, with generated or given arguments', async () => {
    const f = start({ script: [{ call: 'read_channel' }, { call: 'search', arguments: { q: 'launch' } }, { call: 'Read' }] });
    const first = await (await post(f, agent())).json() as any;
    expect(first.stop_reason).toBe('tool_use');
    expect(first.content).toEqual([{ type: 'tool_use', id: 'toolu_fake_1', name: 'mcp__world__read_channel', input: minimalArguments(schema) }]);
    const sse = events(await (await post(f, agent({ stream: true }))).text());
    expect(sse.find(e => e.type === 'content_block_start').content_block).toEqual({ type: 'tool_use', id: 'toolu_fake_2', name: 'world_search', input: {} });
    expect(sse.find(e => e.type === 'content_block_delta').delta).toEqual({ type: 'input_json_delta', partial_json: '{"q":"launch"}' });
    expect(sse.find(e => e.type === 'message_delta').delta.stop_reason).toBe('tool_use');
    const third = await (await post(f, agent())).json() as any;
    expect(third.content[0]).toMatchObject({ name: 'Read', input: { file_path: 'x' } });
    expect(((await (await post(f, agent())).json()) as any).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(f.requests.map(r => r.played)).toEqual([{ call: 'read_channel' }, { call: 'search', arguments: { q: 'launch' } }, { call: 'Read' }, null]);
  });

  test('a call turn whose tool is not offered answers text and logs the turn missing', async () => {
    const f = start({ script: [{ call: 'post_message' }, { text: 'after', match: {} }] });
    const r = await (await post(f, agent({ stream: true }))).text();
    expect(events(r).find(e => e.type === 'content_block_delta').delta).toEqual({ type: 'text_delta', text: 'fake: tool post_message not offered' });
    expect(f.requests[0].played).toEqual({ call: 'post_message', missing: true });
    expect(((await (await post(f, agent())).json()) as any).content[0].text).toBe('after');
  });
});

describe('fake-anthropic.ts status turns', () => {
  test('529, 429 with retry-after, 500 and a chosen error_type, then success; streamed requests get the JSON error too', async () => {
    const f = start({ script: [{ status: 529 }, { status: 429, headers: { 'retry-after': '7' } }, { status: 500 }, { status: 400, error_type: 'invalid_request_error', message: 'too long' }, { text: 'Done.', match: {} }] });
    const a = await post(f, agent({ stream: true }));
    expect(a.status).toBe(529);
    expect(a.headers.get('content-type')).toContain('application/json');
    expect(await a.json()).toEqual({ type: 'error', error: { type: 'overloaded_error', message: 'fake endpoint answers 529' } });
    const b = await post(f, agent());
    expect(b.status).toBe(429);
    expect(b.headers.get('retry-after')).toBe('7');
    expect(((await b.json()) as any).error.type).toBe('rate_limit_error');
    const c = await post(f, agent());
    expect([c.status, ((await c.json()) as any).error.type]).toEqual([500, 'api_error']);
    const d = await post(f, agent());
    expect([d.status, await d.json()]).toEqual([400, { type: 'error', error: { type: 'invalid_request_error', message: 'too long' } }]);
    expect(((await (await post(f, agent())).json()) as any).content[0].text).toBe('Done.');
    expect(f.requests.map(r => r.status)).toEqual([529, 429, 500, 400, 200]);
    expect(f.requests[1].played).toEqual({ status: 429, headers: { 'retry-after': '7' } });
  });

  test('the Anthropic SDK retries through the schedule; the log keeps each attempt with x-stainless-retry-count and sent_at', async () => {
    const f = start({ requireKeyPrefix: 'trial-token:', script: [{ status: 529, headers: { 'retry-after-ms': '5' } }, { status: 429, headers: { 'retry-after-ms': '5' } }, { text: 'Recovered.', match: {}, usage: { input_tokens: 900, output_tokens: 12 } }] });
    const client = new Anthropic({ apiKey: KEY, authToken: null, baseURL: f.url + '/anthropic', maxRetries: 2 });
    const msg = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 64, tools: tools as any, messages: [{ role: 'user', content: 'go' }] });
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Recovered.' });
    expect(msg.usage.input_tokens).toBe(900);
    expect(f.requests.map(r => [r.status, r.headers['x-stainless-retry-count']])).toEqual([[529, '0'], [429, '1'], [200, '2']]);
    for (const r of f.requests) {
      expect(r.headers['anthropic-version']).toBeTruthy();
      expect(r.headers['user-agent']).toContain('Anthropic');
      expect(Object.keys(r.headers).some(k => k.startsWith('x-stainless-') && k !== 'x-stainless-retry-count')).toBe(true);
      expect(Date.parse(r.sent_at!)).toBeGreaterThanOrEqual(Date.parse(r.at));
      expect(r.authorization_sha256).toBe(sha256('Bearer ' + KEY));
    }
  });
});

describe('fake-anthropic.ts usage', () => {
  const usage = { input_tokens: 150000, output_tokens: 42, cache_read_input_tokens: 120000, cache_creation_input_tokens: 3000 };

  test('a turn\'s usage is reported in JSON and in SSE message_start and message_delta; the default stays 1/1', async () => {
    const f = start({ script: [{ text: 'big', match: {}, usage }, { call: 'Read', usage: { input_tokens: 5 } }, { text: 'big again', match: {}, usage }] });
    expect(((await (await post(f, agent())).json()) as any).usage).toEqual(usage);
    expect(((await (await post(f, agent())).json()) as any).usage).toEqual({ input_tokens: 5, output_tokens: 1 });
    const sse = events(await (await post(f, agent({ stream: true }))).text());
    expect(sse.find(e => e.type === 'message_start').message.usage).toEqual({ ...usage, output_tokens: 0 });
    expect(sse.find(e => e.type === 'message_delta').usage).toEqual(usage);
    expect(((await (await post(f, agent())).json()) as any).usage).toEqual({ input_tokens: 1, output_tokens: 1 });
    const plain = events(await (await post(f, agent({ stream: true }))).text());
    expect(plain.find(e => e.type === 'message_start').message.usage).toEqual({ input_tokens: 1, output_tokens: 0 });
    expect(plain.find(e => e.type === 'message_delta').usage).toEqual({ output_tokens: 1 });
  });

  test('stream() without usage is byte-for-byte what it was; the SDK reads streamed usage', async () => {
    const content = [{ type: 'text', text: 'hi' }];
    expect(stream({ id: 'm' }, content, 'end_turn')).toBe(stream({ id: 'm' }, content, 'end_turn', undefined));
    expect(stream({ id: 'm' }, content, 'end_turn')).toContain('"usage":{"input_tokens":1,"output_tokens":0}');
    const f = start({ script: [{ text: 'streamed', match: {}, usage }] });
    const client = new Anthropic({ apiKey: KEY, authToken: null, baseURL: f.url + '/anthropic', maxRetries: 0 });
    const msg = await client.messages.stream({ model: 'claude-sonnet-5-5', max_tokens: 64, tools: tools as any, messages: [{ role: 'user', content: 'go' }] }).finalMessage();
    expect(msg.usage).toMatchObject(usage);
  });
});

describe('fake-anthropic.ts match and side calls', () => {
  test('side calls without tools never consume a turn, streamed or not, wherever they fall', async () => {
    const f = start({ script: [{ call: 'Read' }, { text: 'two', match: {} }] });
    expect(((await (await post(f, side())).json()) as any).content[0].text).toBe('ok');
    expect(((await (await post(f, agent())).json()) as any).content[0].name).toBe('Read');
    expect(events(await (await post(f, side({ stream: true, tools: [] }))).text()).find(e => e.type === 'content_block_delta').delta.text).toBe('ok');
    expect(((await (await post(f, agent())).json()) as any).content[0].text).toBe('two');
    expect(f.requests.map(r => r.played === null)).toEqual([true, false, true, false]);
  });

  test('min_messages and system_contains hold a turn until an agent request matches; others get ok', async () => {
    const f = start({ script: [{ call: 'Read', match: { min_messages: 3 } }, { text: 'compacted', match: { system_contains: 'summary of the conversation' } }] });
    const ok = async (body: unknown) => ((await (await post(f, body)).json()) as any).content[0];
    expect(await ok(agent())).toEqual({ type: 'text', text: 'ok' });
    expect(await ok(side({ messages: [1, 2, 3].map(() => ({ role: 'user', content: 'x' })) }))).toEqual({ type: 'text', text: 'ok' });
    const three = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
    expect(await ok(agent({ messages: three }))).toMatchObject({ type: 'tool_use', name: 'Read', id: 'toolu_fake_1' });
    expect(await ok(agent({ messages: three, system: 'You are a coding agent.' }))).toEqual({ type: 'text', text: 'ok' });
    expect(await ok(agent({ system: [{ type: 'text', text: 'Base.' }, { type: 'text', text: 'Here is a summary of the conversation so far.' }] }))).toEqual({ type: 'text', text: 'compacted' });
    expect(f.requests.map(r => r.played && Object.keys(r.played)[0])).toEqual([null, null, 'call', null, 'text']);
  });

  test('tool and text turns without match keep the shell-tool gate; "match": {} opens a text turn to any tools array', async () => {
    const noShell = tools.filter(t => t.name !== 'exec');
    const f = start({ script: [{ tool: 'ls' }, { text: 'any tools', match: {} }] });
    expect(((await (await post(f, agent({ tools: noShell }))).json()) as any).content[0].text).toBe('ok');
    expect(((await (await post(f, agent())).json()) as any).content[0]).toEqual({ type: 'tool_use', id: 'toolu_fake_1', name: 'exec', input: { command: 'ls' } });
    expect(((await (await post(f, agent({ tools: noShell }))).json()) as any).content[0].text).toBe('any tools');
  });

  test('--loop replays new turns; --fail-status still answers every messages request with its error', async () => {
    const looped = start({ loop: true, script: [{ call: 'search' }] });
    for (const id of ['toolu_fake_1', 'toolu_fake_2']) expect(((await (await post(looped, agent())).json()) as any).content[0]).toMatchObject({ id, name: 'world_search', input: { q: 'x' } });
    const failing = start({ failStatus: 503, script: [{ call: 'Read' }] });
    const r = await post(failing, agent());
    expect([r.status, await r.json()]).toEqual([503, { type: 'error', error: { type: 'api_error', message: 'fake endpoint answers 503' } }]);
    expect(failing.requests[0]).toMatchObject({ status: 503, played: null });
  });

  test('validateScript accepts the new turns and refuses malformed ones', () => {
    const turns: Turn[] = [{ tool: 'ls' }, { text: 'x' }, { call: 'Read', arguments: {} }, { status: 529, headers: { 'retry-after': '1' } }];
    expect(validateScript(turns)).toEqual(turns);
    for (const bad of [{}, [{ call: 3 }], [{ status: '529' }], [{ usage: {} }], [null]]) expect(() => validateScript(bad)).toThrow('--script must be');
  });
});

describe('fake-anthropic.ts request log', () => {
  test('logs GET /v1/models, 404s and messages requests with headers, the credential hash and never its value', async () => {
    const log = join(tmp(), 'requests.ndjson');
    const f = start({ log });
    const h = { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'user-agent': 'probe/1', 'x-stainless-retry-count': '0', 'x-stainless-os': 'Linux', 'x-unrelated': 'dropped' };
    expect((await fetch(f.url + '/v1/models', { headers: { 'x-api-key': KEY, ...h } })).status).toBe(200);
    expect((await fetch(f.url + '/v1/nowhere', { method: 'POST', headers: { authorization: 'Bearer ' + KEY }, body: '{"a":1}' })).status).toBe(404);
    expect((await fetch(f.url + '/v1/messages/count_tokens', { method: 'GET' })).status).toBe(404);
    expect((await post(f, side(), h)).status).toBe(200);
    const text = readFileSync(log, 'utf8');
    expect(text).not.toContain(KEY);
    const rows = text.trim().split('\n').map(l => JSON.parse(l));
    expect(rows.map(r => [r.method, r.path, r.status])).toEqual([['GET', '/v1/models', 200], ['POST', '/v1/nowhere', 404], ['GET', '/v1/messages/count_tokens', 404], ['POST', '/anthropic/v1/messages', 200]]);
    expect(rows[0].headers).toEqual({ 'anthropic-beta': 'prompt-caching-2024-07-31', 'anthropic-version': '2023-06-01', 'user-agent': 'probe/1', 'x-stainless-os': 'Linux', 'x-stainless-retry-count': '0' });
    expect(rows[0].authorization_sha256).toBe(sha256(KEY));
    expect(rows[1].authorization_sha256).toBe(sha256('Bearer ' + KEY));
    expect(rows[2].authorization_sha256).toBeNull();
    expect('body' in rows[0]).toBe(false);
    expect(rows[1].body).toEqual({ a: 1 });
    expect(rows[3].body).toEqual(side());
    for (const r of rows) {
      expect(Object.keys(r)).toEqual(['at', 'method', 'path', 'status', ...('body' in r ? ['body'] : []), 'headers', 'authorization_sha256', 'played', 'sent_at']);
      expect(r.played).toBeNull();
      expect(Date.parse(r.sent_at)).toBeGreaterThanOrEqual(Date.parse(r.at));
    }
  });

  test('a body that is not JSON gets 400 and a log line', async () => {
    const f = start();
    const r = await fetch(f.url + '/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY }, body: 'not json' });
    expect([r.status, ((await r.json()) as any).error.type]).toEqual([400, 'invalid_request_error']);
    expect(f.requests[0]).toMatchObject({ method: 'POST', path: '/v1/messages', status: 400 });
  });
});

describe('fake-anthropic.ts key prefix and caps', () => {
  test('--require-key-prefix refuses any credential without the prefix, on every path, and logs the refusal', async () => {
    const f = start({ requireKeyPrefix: 'trial-token:', script: [{ call: 'Read' }] });
    const refused = [
      await post(f, agent(), { 'x-api-key': 'sk-ant-placeholder' }),
      await fetch(f.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer sk-placeholder' }, body: JSON.stringify(agent()) }),
      await fetch(f.url + '/v1/messages', { method: 'POST', body: JSON.stringify(agent()) }),
      await post(f, agent(), { authorization: 'Bearer sk-placeholder' }),
      await fetch(f.url + '/v1/models', { headers: { 'x-api-key': 'other' } }),
      await fetch(f.url + '/v1/nowhere', { headers: { 'x-api-key': 'other' } }),
    ];
    for (const r of refused) expect([r.status, ((await r.json()) as any).error.type]).toEqual([401, 'authentication_error']);
    expect(f.requests.map(r => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(f.requests[0].authorization_sha256).toBe(sha256('sk-ant-placeholder'));
    const ok = await fetch(f.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer ' + KEY }, body: JSON.stringify(agent()) });
    expect(((await ok.json()) as any).content[0]).toMatchObject({ type: 'tool_use', id: 'toolu_fake_1', name: 'Read' });
    expect(f.requests.at(-1)?.played).toEqual({ call: 'Read' });
  });

  test('--max-requests: later messages requests get ok, end_turn and capped: true, JSON and streamed', async () => {
    const f = start({ maxRequests: 2, loop: true, script: [{ call: 'Read' }] });
    expect(((await (await post(f, agent())).json()) as any).stop_reason).toBe('tool_use');
    expect((await fetch(f.url + '/v1/models')).status).toBe(200);
    expect(((await (await post(f, agent())).json()) as any).stop_reason).toBe('tool_use');
    const third = await (await post(f, agent())).json() as any;
    expect([third.stop_reason, third.content]).toEqual(['end_turn', [{ type: 'text', text: 'ok' }]]);
    const fourth = events(await (await post(f, agent({ stream: true }))).text());
    expect(fourth.find(e => e.type === 'message_delta').delta.stop_reason).toBe('end_turn');
    expect(f.requests.map(r => r.capped ?? false)).toEqual([false, false, false, true, true]);
    expect(f.requests[3].played).toBeNull();
  });

  test('--max-seconds: after the wall clock, messages requests are capped', async () => {
    const f = start({ maxSeconds: 0.3, loop: true, script: [{ call: 'Read' }] });
    expect(((await (await post(f, agent())).json()) as any).stop_reason).toBe('tool_use');
    await Bun.sleep(400);
    expect(((await (await post(f, agent())).json()) as any).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(f.requests.map(r => r.capped ?? false)).toEqual([false, true]);
  });
});

describe('fake-anthropic.ts command line', () => {
  test('the new flags work from the command line, spawned under env -i with placeholder keys only', async () => {
    const dir = tmp();
    const log = join(dir, 'requests.ndjson'), script = join(dir, 'script.json');
    writeFileSync(script, JSON.stringify([{ call: 'read_channel', usage: { input_tokens: 77 } }, { status: 529 }]));
    const child = Bun.spawn(['env', '-i', 'PATH=' + (process.env.PATH ?? '/usr/bin:/bin'), 'HOME=' + tmp(), process.execPath, join(ROOT, 'scripts', 'gsta-135', 'fake-anthropic.ts'),
      '--host', '127.0.0.1', '--port', '0', '--log', log, '--script', script, '--require-key-prefix', 'trial-token:', '--max-requests', '3', '--max-seconds', '600'], { stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = child.stdout.getReader();
      let out = '';
      while (!/listening on http:\/\/\S+ \(.*\)\n/.test(out)) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
      expect(out).toContain(', script 2 turns, key prefix required, cap 3 requests, cap 600 s)');
      const url = out.match(/listening on (http:\/\/\S+)/)![1];
      const f = { url } as FakeAnthropic;
      expect((await post(f, agent(), { 'x-api-key': 'sk-ant-placeholder' })).status).toBe(401);
      const first = await (await post(f, agent())).json() as any;
      expect([first.content[0].name, first.usage.input_tokens]).toEqual(['mcp__world__read_channel', 77]);
      expect((await post(f, agent())).status).toBe(529);
      expect(((await (await post(f, agent())).json()) as any).content[0].text).toBe('ok');
      expect(((await (await post(f, agent())).json()) as any).content[0].text).toBe('ok');
      const rows = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(rows.map(r => [r.status, r.capped ?? false])).toEqual([[401, false], [200, false], [529, false], [200, false], [200, true]]);
    } finally { child.kill(); }
  });
});
