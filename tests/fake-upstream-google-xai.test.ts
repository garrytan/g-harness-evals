import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GEMINI_SIGNATURE, GEMINI_SIGNATURE_ERROR, reply, SAFETY_MARKER } from '../scripts/frontier-harbor/fake-upstream.ts';
import { OPENROUTER_MODELS } from '../runner/proxy/metering-proxy.ts';
import { safetyStop } from '../runner/proxy/stops.ts';

/** The fake upstream's google and xai routes (internal-task): what the keyless install check and the proxy tests talk to. */
const gemini = (method: string, body: object) => reply('/google/v1beta/models/gemini-4-carbon:' + method, body as Record<string, any>, 1);
const text = (r: Response) => r.text();

describe('fake upstream: Gemini', () => {
  test('a text reply with usageMetadata, streamed as SSE chunks whose last carries the usage', async () => {
    const plain = await gemini('generateContent', { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }).json() as any;
    expect(plain.candidates[0].finishReason).toBe('STOP');
    expect(plain.usageMetadata).toMatchObject({ promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 4 });
    const streamed = gemini('streamGenerateContent', { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    expect(streamed.headers.get('content-type')).toBe('text/event-stream');
    const events = (await text(streamed)).split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
    expect(events.at(-1).usageMetadata.candidatesTokenCount).toBe(5);
  });

  test('a declared function is called once with a thought signature, and a replay that drops the signature gets Gemini\'s 400', async () => {
    const tools = [{ functionDeclarations: [{ name: 'run_shell_command', parameters: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } } }] }];
    const first = await gemini('generateContent', { contents: [{ role: 'user', parts: [{ text: 'go' }] }], tools }).json() as any;
    const part = first.candidates[0].content.parts[0];
    expect(part).toEqual({ functionCall: { name: 'run_shell_command', args: { command: 'true' } }, thoughtSignature: GEMINI_SIGNATURE });
    const turn = (call: object) => ({ tools, contents: [{ role: 'user', parts: [{ text: 'go' }] }, { role: 'model', parts: [call] }, { role: 'user', parts: [{ functionResponse: { name: 'run_shell_command', response: { output: 'ok' } } }] }] });
    const kept = await gemini('generateContent', turn(part)).json() as any;
    expect(kept.candidates[0].content.parts[0].text).toContain('Fake upstream reply');
    const dropped = gemini('generateContent', turn({ functionCall: part.functionCall }));
    expect(dropped.status).toBe(400);
    expect(JSON.stringify(await dropped.json())).toContain(GEMINI_SIGNATURE_ERROR);
  });

  test('the safety marker gets finishReason SAFETY, which the proxy records as a safety stop, streamed or not', async () => {
    const body = { contents: [{ role: 'user', parts: [{ text: 'please ' + SAFETY_MARKER }] }] };
    expect(safetyStop(await gemini('generateContent', body).json())).toEqual({ safety_stop: 'finishReason:SAFETY' });
    expect(safetyStop(await text(gemini('streamGenerateContent', body)))).toEqual({ safety_stop: 'finishReason:SAFETY' });
  });
});

describe('fake upstream: xAI', () => {
  const chat = (extra: object = {}) => ({ model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }], ...extra });
  test('Chat Completions and Responses answer with xAI usage, reasoning tokens and cost_in_usd_ticks', async () => {
    const c = await reply('/xai/v1/chat/completions', chat(), 1).json() as any;
    expect(c.usage).toMatchObject({ completion_tokens: 5, total_tokens: 19, completion_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 });
    const r = await reply('/xai/v1/responses', { model: 'grok-4.7', input: 'hi', store: false }, 2).json() as any;
    expect(r).toMatchObject({ status: 'completed', store: false, usage: { output_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 } });
    const s = await text(reply('/xai/v1/chat/completions', chat({ stream: true }), 3));
    expect(s.trim().endsWith('data: [DONE]')).toBe(true);
    expect(s).toContain('"cost_in_usd_ticks":1000');
  });

  test('the safety marker gets the content-filter stop on both routes, streamed or not', async () => {
    const marked = chat({ messages: [{ role: 'user', content: SAFETY_MARKER }] });
    expect(safetyStop(await reply('/xai/v1/chat/completions', marked, 1).json())).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(safetyStop(await text(reply('/xai/v1/chat/completions', { ...marked, stream: true }, 2)))).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(safetyStop(await reply('/xai/v1/responses', { model: 'grok-4.7', input: SAFETY_MARKER }, 3).json())).toEqual({ safety_stop: 'incomplete_details:content_filter' });
    expect(safetyStop(await text(reply('/xai/v1/responses', { model: 'grok-4.7', input: SAFETY_MARKER, stream: true }, 4)))).toEqual({ safety_stop: 'incomplete_details:content_filter' });
  });
});

describe('fake upstream: OpenRouter Chat Completions for each pinned model', () => {
  test('every pinned OpenRouter model is answered by its pinned provider, streamed or not, so the proxy never marks the smoke served elsewhere', async () => {
    let n = 0;
    for (const [model, pin] of Object.entries(OPENROUTER_MODELS)) {
      const body = { model, messages: [{ role: 'user', content: 'hi' }], provider: { only: [pin.only], allow_fallbacks: false }, ...(pin.service_tier ? { service_tier: pin.service_tier } : {}) };
      expect([model, (await reply('/openrouter/v1/chat/completions', body, ++n).json() as any).provider]).toEqual([model, pin.served]);
      const chunks = (await text(reply('/openrouter/v1/chat/completions', { ...body, stream: true }, ++n))).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)));
      expect([model, [...new Set(chunks.map((c) => c.provider))]]).toEqual([model, [pin.served]]);
    }
  });
});

describe('fake upstream: the server the install check starts', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fake-upstream-server-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  test('serves Gemini generateContent and streamGenerateContent?alt=sse, and xAI Chat Completions and Responses, each with usage, logging the path without its query', async () => {
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    const log = join(tmp, 'requests.jsonl');
    const proc = Bun.spawn(['bun', resolve(import.meta.dir, '../scripts/frontier-harbor/fake-upstream.ts'), '--listen', '127.0.0.1:' + port, '--log', log], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = proc.stdout.getReader();
      let started = '';
      while (!started.includes('fake upstream on')) { const { value, done } = await reader.read(); if (done) break; started += new TextDecoder().decode(value); }
      expect(started).toContain('fake upstream on 127.0.0.1:' + port);
      const post = (path: string, body: object, headers: Record<string, string>) => fetch('http://127.0.0.1:' + port + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const goog = { 'x-goog-api-key': 'placeholder' };
      const ask = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
      const plain = await (await post('/google/v1beta/models/gemini-4-carbon:generateContent', ask, goog)).json() as any;
      expect(plain.candidates[0].finishReason).toBe('STOP');
      expect(plain.usageMetadata).toMatchObject({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 19 });
      const streamed = await post('/google/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse', ask, goog);
      expect(streamed.headers.get('content-type')).toBe('text/event-stream');
      const last = (await text(streamed)).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).at(-1);
      expect(last.candidates[0].finishReason).toBe('STOP');
      expect(last.usageMetadata).toMatchObject({ candidatesTokenCount: 5, totalTokenCount: 19 });
      const bearer = { authorization: 'Bearer placeholder' };
      const chat = await (await post('/xai/v1/chat/completions', { model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }] }, bearer)).json() as any;
      expect(chat.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 19 });
      const responses = await (await post('/xai/v1/responses', { model: 'grok-4.7', input: 'hi', store: false }, bearer)).json() as any;
      expect(responses).toMatchObject({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 19 } });
      const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      expect(rows.map((r) => [r.path, r.stream, r.credential_present])).toEqual([
        ['/google/v1beta/models/gemini-4-carbon:generateContent', false, true],
        ['/google/v1beta/models/gemini-4-carbon:streamGenerateContent', false, true],
        ['/xai/v1/chat/completions', false, true],
        ['/xai/v1/responses', false, true],
      ]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 30_000);
});
