#!/usr/bin/env bun
// A keyless fake OpenAI endpoint for tests/openai-branch.test.ts. It answers
// POST /v1/responses (the Responses API, streamed or not) and POST
// /v1/chat/completions (streamed or not) with one short assistant text "ok"
// and a usage block, records every request to an ndjson file (method, path,
// model, stream flag, reasoning fields, output cap and whether the credential was the
// placeholder it was started with, never the credential itself), and answers
// any other route 404. It binds the address it is given, never 0.0.0.0, and
// holds no credential.
//
//   bun tests/fixtures/openai-branch/fake-openai.ts --host 127.0.0.1 --port 0 --log requests.ndjson --expect-key placeholder-openai
//
// It prints "listening <port>" on stdout once it is up.
import { appendFileSync } from 'node:fs';

export interface FakeRequest { method: string; path: string; model: string | null; stream: boolean; reasoning: unknown; reasoning_effort: unknown; max_output_tokens: number | null; tools: number; credential: 'expected' | 'other' | 'none' }

const usage = { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 15 };

/** The Responses API body for a finished "ok" answer. */
export function responseBody(model: string): Record<string, unknown> {
  return {
    id: 'resp_fake_1', object: 'response', created_at: 1_790_000_000, status: 'completed', model, error: null, incomplete_details: null,
    output: [{ id: 'msg_fake_1', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
    usage,
  };
}

/** The Responses API SSE stream for the same answer, the event shapes the OpenAI SDKs decode. */
export function responseStream(model: string): string {
  const done = responseBody(model);
  const item = (done.output as Array<Record<string, unknown>>)[0];
  const events: Array<Record<string, unknown>> = [
    { type: 'response.created', response: { ...done, status: 'in_progress', output: [], usage: null } },
    { type: 'response.in_progress', response: { ...done, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'ok' },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: 'ok' },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: 'ok', annotations: [] } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: done },
  ];
  return events.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number: i })}\n\n`).join('');
}

/** The Chat Completions body for the same answer. */
export function chatBody(model: string): Record<string, unknown> {
  return { id: 'chatcmpl_fake_1', object: 'chat.completion', created: 1_790_000_000, model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 1 } } };
}

/** The Chat Completions SSE stream for the same answer, usage in the last chunk. */
export function chatStream(model: string): string {
  const base = { id: 'chatcmpl_fake_1', object: 'chat.completion.chunk', created: 1_790_000_000, model };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...base, choices: [], usage: (chatBody(model) as { usage: unknown }).usage },
  ];
  return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

export function startFakeOpenAI(o: { host: string; port: number; log: string; expectKey: string }): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: o.host, port: o.port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      let body: Record<string, any> = {};
      try { body = JSON.parse(await req.text() || '{}'); } catch {}
      const auth = req.headers.get('authorization') ?? '';
      const record: FakeRequest = {
        method: req.method, path, model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true,
        reasoning: body.reasoning ?? null, reasoning_effort: body.reasoning_effort ?? null, max_output_tokens: body.max_output_tokens ?? body.max_completion_tokens ?? null, tools: Array.isArray(body.tools) ? body.tools.length : 0,
        credential: !auth ? 'none' : auth === 'Bearer ' + o.expectKey ? 'expected' : 'other',
      };
      appendFileSync(o.log, JSON.stringify(record) + '\n');
      const model = record.model ?? 'unknown';
      const sse = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
      if (req.method === 'POST' && path === '/v1/responses') return record.stream ? sse(responseStream(model)) : Response.json(responseBody(model));
      if (req.method === 'POST' && path === '/v1/chat/completions') return record.stream ? sse(chatStream(model)) : Response.json(chatBody(model));
      return Response.json({ error: { message: `no route ${req.method} ${path}`, type: 'invalid_request_error' } }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const server = startFakeOpenAI({ host: one('--host') ?? '127.0.0.1', port: Number(one('--port') ?? 0), log: one('--log') ?? 'fake-openai.ndjson', expectKey: one('--expect-key') ?? 'placeholder-openai' });
  console.log(`listening ${server.port}`);
}
