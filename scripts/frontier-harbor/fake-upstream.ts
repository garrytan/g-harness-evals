#!/usr/bin/env bun
// A keyless fake model upstream for the frontier Harbor path's install check and smoke (internal-task). The metering proxy is
// started with --upstream anthropic=<this> --upstream openai=<this>, so every harness call goes container -> proxy ->
// here and nothing leaves the machine. It answers Anthropic /v1/messages, OpenAI /v1/responses and /v1/chat/completions,
// streamed or not, with one short text reply that ends the turn (its one bash block is mini-swe-agent's submit command,
// so that agent ends too), and GET /v1/models. Each request appends one line to
// --log: path, model, stream, the tool names and effort fields the request declared, whether a credential header came
// in and whether it equals the canary (--canary-env names the variable holding the fake provider key the proxy was
// given), and the body's sha256. With --bodies it also writes each body to that file, for the canary and token scans.
//
//   bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log <requests.jsonl> [--bodies <bodies.jsonl>]
//       [--canary-env FAKE_UPSTREAM_CANARY]
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const TEXT = 'Fake upstream reply: this is a keyless install check, so I am stopping here.\n\n```bash\necho COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n```';

export function sse(events: Array<[string | null, unknown]>): Response {
  const body = events.map(([e, d]) => (e ? 'event: ' + e + '\n' : '') + 'data: ' + (typeof d === 'string' ? d : JSON.stringify(d)) + '\n\n').join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

export function requestFacts(path: string, body: Record<string, any>) {
  const tools = Array.isArray(body.tools) ? body.tools.map((t: any) => t?.name ?? t?.function?.name ?? t?.type ?? null) : [];
  return {
    path, model: body.model ?? null, stream: body.stream === true, tools,
    effort: { output_config: body.output_config?.effort ?? null, thinking: body.thinking?.type ?? null, reasoning: body.reasoning?.effort ?? null, reasoning_effort: body.reasoning_effort ?? null },
    max_tokens: body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens ?? null,
  };
}

export function reply(path: string, body: Record<string, any>, n: number): Response {
  const model = body.model ?? 'fake';
  const stream = body.stream === true;
  if (path.endsWith('/v1/models')) return Response.json({ object: 'list', data: [] });
  if (path.endsWith('/v1/messages')) {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const id = 'msg_fake_' + n;
    if (!stream) return Response.json({ id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: TEXT }], stop_reason: 'end_turn', stop_sequence: null, usage });
    return sse([
      ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: TEXT } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  }
  if (path.endsWith('/v1/responses')) {
    const id = 'resp_fake_' + n;
    const item = { type: 'message', id: 'msg_fake_' + n, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: TEXT, annotations: [] }] };
    const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    if (!stream) return Response.json(response);
    const pending = { ...response, status: 'in_progress', output: [], usage: null };
    return sse([
      ['response.created', { type: 'response.created', sequence_number: 0, response: pending }],
      ['response.in_progress', { type: 'response.in_progress', sequence_number: 1, response: pending }],
      ['response.output_item.added', { type: 'response.output_item.added', sequence_number: 2, output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
      ['response.content_part.added', { type: 'response.content_part.added', sequence_number: 3, item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
      ['response.output_text.delta', { type: 'response.output_text.delta', sequence_number: 4, item_id: item.id, output_index: 0, content_index: 0, delta: TEXT }],
      ['response.output_text.done', { type: 'response.output_text.done', sequence_number: 5, item_id: item.id, output_index: 0, content_index: 0, text: TEXT }],
      ['response.content_part.done', { type: 'response.content_part.done', sequence_number: 6, item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
      ['response.output_item.done', { type: 'response.output_item.done', sequence_number: 7, output_index: 0, item }],
      ['response.completed', { type: 'response.completed', sequence_number: 8, response }],
    ]);
  }
  if (path.endsWith('/v1/chat/completions')) {
    const id = 'chatcmpl_fake_' + n;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!stream) return Response.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: TEXT } }], usage });
    const chunk = (delta: unknown, finish: string | null, extra: object = {}) => ({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
    return sse([[null, chunk({ role: 'assistant', content: TEXT }, null)], [null, chunk({}, 'stop')], [null, { id, object: 'chat.completion.chunk', model, choices: [], usage }], [null, '[DONE]']]);
  }
  return Response.json({ error: { type: 'not_found', message: 'fake upstream: no route ' + path } }, { status: 404 });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const [host, port] = (flag('--listen') ?? '127.0.0.1:8799').split(':') as [string, string];
  const log = flag('--log') ?? (console.error('fake-upstream.ts needs --log'), process.exit(2));
  const bodies = flag('--bodies');
  const canary = flag('--canary-env') ? process.env[flag('--canary-env')!] ?? null : null;
  let n = 0;
  Bun.serve({ hostname: host, port: Number(port), async fetch(req) {
    const path = new URL(req.url).pathname;
    const raw = req.method === 'POST' ? await req.text() : '';
    let body: Record<string, any> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    n += 1;
    const cred = req.headers.get('x-api-key') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), n, method: req.method, ...requestFacts(path, body), credential_present: !!cred, credential_is_canary: canary ? cred === canary : null, body_sha256: createHash('sha256').update(raw).digest('hex') }) + '\n');
    if (bodies && raw) appendFileSync(bodies, JSON.stringify({ n, path, body: raw }) + '\n');
    return reply(path, body, n);
  } });
  console.log('fake upstream on ' + host + ':' + port);
}
