#!/usr/bin/env bun
// A keyless fake model upstream for the frontier Harbor path's install check and smoke (internal-task). The metering proxy is
// started with --upstream anthropic=<this> --upstream openai=<this> --upstream particle=<this>/particle
// --upstream openrouter=<this>/openrouter, so every harness call goes container -> proxy ->
// here and nothing leaves the machine. It answers Anthropic /v1/messages, OpenAI /v1/responses and /v1/chat/completions,
// streamed or not, with one short text reply that ends the turn (its one bash block is mini-swe-agent's submit command,
// so that agent ends too), and GET /v1/models. A Responses request that declares a function tool and carries no tool output
// yet gets one call of that tool instead (its required arguments filled with placeholders), so the harness sends a second
// turn; a Responses request that chains on previous_response_id gets the HTTP 400 OpenAI's zero-data-retention
// organizations answer (org faq, 2026-11-14), so zdr-check.ts can tell from the captures how each harness continues a turn. The proxy's Particle upstream is <this>/particle: there
// /particle/v1/chat/completions answers the way Particle does (docs.particle.ai/reasoning): the model echoed as
// particle-ai/<id>, reasoning_content before the content, and reasoning tokens inside completion_tokens, repeated in
// completion_tokens_details. The proxy's OpenRouter upstream is <this>/openrouter: there /openrouter/v1/chat/completions
// answers the way OpenRouter's DeepSeek endpoint does, from the multi-user path's fake (tests/fixtures/openrouter/
// fake-openrouter.ts): provider DeepSeek, a gen- id, reasoning and reasoning_details beside the content, one call of the
// first declared tool and then "ok", and DeepSeek's 400 for a tool-call turn replayed without its reasoning, so a harness
// that drops the reasoning fails here as it would upstream. Each request appends one line to
// --log: path, model, stream, the tool names and effort fields the request declared, whether a credential header came
// in and whether it equals the canary (--canary-env names the variable holding the fake provider key the proxy was
// given), whether it chained on previous_response_id and its store field, the body's sha256, and on the OpenRouter route which reasoning fields each replayed assistant message carried. With --bodies it also writes each body to that file, for the canary and token scans.
//
//   bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log <requests.jsonl> [--bodies <bodies.jsonl>]
//       [--canary-env FAKE_UPSTREAM_CANARY]
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chatBody, chatStream, DEEPSEEK_REPLAY_ERROR, errorBody, replayedAssistants } from '../../tests/fixtures/openrouter/fake-openrouter.ts';

const TEXT = 'Fake upstream reply: this is a keyless install check, so I am stopping here.\n\n```bash\necho COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n```';
const REASONING = 'The install check wants a short answer.';

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
    previous_response_id: chained(body), store: body.store ?? null,
  };
}

export const ZDR_ERROR = 'Previous response cannot be used for this organization due to Zero Data Retention.';
export const chained = (body: Record<string, any>) => typeof body.previous_response_id === 'string' && body.previous_response_id !== '';
const inputItems = (body: Record<string, any>): Array<Record<string, any>> => (Array.isArray(body.input) ? body.input.filter((i: unknown) => i && typeof i === 'object') : []);
export const toolOutputSent = (body: Record<string, any>) => inputItems(body).some((i) => i.type === 'function_call_output' || i.type === 'custom_tool_call_output');

/** The first function or custom tool a Responses request declares, in tools[] or in an additional_tools input item, and
 *  inside a namespace (Codex 0.165.0 declares all its tools in namespaces, led by the custom JavaScript tool functions.exec). */
export function firstTool(body: Record<string, any>): { kind: 'function' | 'custom'; name: string; namespace?: string; parameters?: any } | null {
  const find = (list: unknown, namespace?: string): ReturnType<typeof firstTool> => {
    for (const t of Array.isArray(list) ? list : []) {
      if (t?.type === 'namespace') { const hit = find(t.tools, t.name); if (hit) return hit; continue; }
      if ((t?.type === 'function' || t?.type === 'custom') && typeof t.name === 'string') return { kind: t.type, name: t.name, ...(namespace ? { namespace } : {}), parameters: t.parameters };
    }
    return null;
  };
  for (const list of [body.tools, ...inputItems(body).filter((i) => i.type === 'additional_tools').map((i) => i.tools)]) {
    const hit = find(list);
    if (hit) return hit;
  }
  return null;
}

/** Placeholder values for a tool's required arguments, by JSON schema type: a shell command reads ["true"] or "true". */
export function placeholderArgs(schema: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Array.isArray(schema?.required) ? schema.required : []) {
    const t = schema?.properties?.[k]?.type;
    const type = Array.isArray(t) ? t[0] : t;
    out[k] = type === 'array' ? ['true'] : type === 'number' || type === 'integer' ? 1 : type === 'boolean' ? false : type === 'object' ? {} : 'true';
  }
  return out;
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
    if (chained(body)) return Response.json({ error: { message: ZDR_ERROR, type: 'invalid_request_error', param: 'previous_response_id', code: null } }, { status: 400 });
    const id = 'resp_fake_' + n;
    const tool = toolOutputSent(body) ? null : firstTool(body);
    const ns = tool?.namespace ? { namespace: tool.namespace } : {};
    const item: Record<string, any> = tool?.kind === 'custom'
      ? { type: 'custom_tool_call', id: 'ctc_fake_' + n, call_id: 'call_fake_' + n, ...ns, name: tool.name, input: 'true', status: 'completed' }
      : tool
        ? { type: 'function_call', id: 'fc_fake_' + n, call_id: 'call_fake_' + n, ...ns, name: tool.name, arguments: JSON.stringify(placeholderArgs(tool.parameters)), status: 'completed' }
        : { type: 'message', id: 'msg_fake_' + n, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: TEXT, annotations: [] }] };
    const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    if (!stream) return Response.json(response);
    const pending = { ...response, status: 'in_progress', output: [], usage: null };
    const events: Array<[string, Record<string, unknown>]> = tool?.kind === 'custom'
      ? [
        ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', input: '' } }],
        ['response.custom_tool_call_input.delta', { item_id: item.id, output_index: 0, delta: item.input }],
        ['response.custom_tool_call_input.done', { item_id: item.id, output_index: 0, input: item.input }],
      ]
      : tool
      ? [
        ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } }],
        ['response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments }],
        ['response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments }],
      ]
      : [
        ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
        ['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
        ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: TEXT }],
        ['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: TEXT }],
        ['response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
      ];
    const all: Array<[string, Record<string, unknown>]> = [['response.created', { response: pending }], ['response.in_progress', { response: pending }], ...events, ['response.output_item.done', { output_index: 0, item }], ['response.completed', { response }]];
    return sse(all.map(([e, d], i) => [e, { type: e, sequence_number: i, ...d }]));
  }
  if (path.startsWith('/particle/') && path.endsWith('/v1/chat/completions')) {
    const id = 'chatcmpl_fake_' + n;
    const echoed = 'particle-ai/' + model;
    const usage = { prompt_tokens: 10, completion_tokens: 9, total_tokens: 19, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 4 } };
    if (!stream) return Response.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: echoed, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: TEXT, reasoning_content: REASONING } }], usage });
    const chunk = (delta: unknown, finish: string | null) => ({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: echoed, choices: [{ index: 0, delta, finish_reason: finish }] });
    return sse([[null, chunk({ role: 'assistant', content: '' }, null)], [null, chunk({ reasoning_content: REASONING }, null)], [null, chunk({ content: TEXT }, null)], [null, chunk({}, 'stop')], [null, { id, object: 'chat.completion.chunk', model: echoed, choices: [], usage }], [null, '[DONE]']]);
  }
  if (path.startsWith('/openrouter/') && path.endsWith('/v1/chat/completions')) {
    if (replayedAssistants(body).some((a) => a.tool_calls > 0 && !a.reasoning && !a.reasoning_content && !a.reasoning_details)) return Response.json(errorBody(400, DEEPSEEK_REPLAY_ERROR), { status: 400 });
    return stream ? new Response(chatStream(body), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(chatBody(body));
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
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), n, method: req.method, ...requestFacts(path, body), credential_present: !!cred, credential_is_canary: canary ? cred === canary : null, body_sha256: createHash('sha256').update(raw).digest('hex'), ...(path.startsWith('/openrouter/') ? { replayed: replayedAssistants(body) } : {}) }) + '\n');
    if (bodies && raw) appendFileSync(bodies, JSON.stringify({ n, path, body: raw }) + '\n');
    return reply(path, body, n);
  } });
  console.log('fake upstream on ' + host + ':' + port);
}
