#!/usr/bin/env bun
// A keyless streaming model upstream for the DeepSeek Harness (dsh) tests (tests/dsh-*.test.ts). dsh sends every model request
// through pi-ai with stream: true, so this fake answers the three wires dsh's four routes speak, streamed the way each provider
// streams: Anthropic Messages (POST <prefix>/v1/messages, SSE content blocks with a signed thinking block), OpenAI Responses
// (POST <prefix>/v1/responses, SSE output items with an encrypted reasoning item) and Chat Completions (POST
// <prefix>/v1/chat/completions, SSE chunks). On Chat Completions the reasoning comes the way the route's provider sends it:
// under a prefix ending in /openrouter as OpenRouter does (delta.reasoning plus delta.reasoning_details, a reasoning.text entry),
// anywhere else as Particle does (delta.reasoning_content).
//
// Markers in the newest user message drive it, so the same fake serves run and serve turns:
//   [fake:call <tool> <json>]   the first answer of the turn calls <tool> with <json>; the answer after its result is text
//   [fake:status <code>]        answer with that HTTP status and the provider's error body
// A request without tools (dsh's session-title request) is answered with a JSON title. Every other request is answered with the
// text "fake reply <n>" (after a tool result: "fake reply <n> after <tool>").
//
// Every request is recorded whole (method, path, wire, the request body, whether the credential header matched the expected
// token, never the credential itself), and the raw request text and headers are scanned for each canary string.
import { createHash } from 'node:crypto';

type Json = Record<string, any>;
export type Wire = 'anthropic' | 'openai-responses' | 'chat-completions';
export interface Seen {
  method: string; path: string; prefix: string; wire: Wire | null; body: Json; status: number;
  credential: 'expected' | 'other' | 'none'; canaries: string[];
}

const WIRES: Record<string, Wire> = { '/v1/messages': 'anthropic', '/v1/responses': 'openai-responses', '/v1/chat/completions': 'chat-completions' };
const sse = (events: Array<[string | null, Json | string]>) => events.map(([e, d]) => (e ? 'event: ' + e + '\n' : '') + 'data: ' + (typeof d === 'string' ? d : JSON.stringify(d)) + '\n\n').join('');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const flat = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: Json) => typeof x === 'string' ? x : x.text ?? '').join('\n') : '';

/** The text of the user messages after the last assistant message (dsh sends the task and then a runtime-context message),
 *  tool results left out, on any wire. */
export function lastUser(wire: Wire, b: Json): string {
  const list = (wire === 'openai-responses' ? b.input : b.messages) ?? [];
  const items = (Array.isArray(list) ? list : []) as Json[];
  let from = 0;
  items.forEach((x, i) => { if (x.role === 'assistant' || x.type === 'function_call') from = i + 1; });
  return items.slice(from).filter((x) => x.role === 'user').map((x) => Array.isArray(x.content) && x.content.length && x.content.every((y: Json) => y.type === 'tool_result') ? '' : flat(x.content)).join('\n');
}

/** The tool whose result closes the request, or null when the newest message is not a tool result. */
function answeredTool(wire: Wire, b: Json): string | null {
  if (wire === 'openai-responses') {
    const items = (b.input ?? []) as Json[];
    const last = items[items.length - 1];
    if (last?.type !== 'function_call_output') return null;
    return items.find((x) => x.type === 'function_call' && x.call_id === last.call_id)?.name ?? '?';
  }
  const m = (b.messages ?? []) as Json[];
  const last = m[m.length - 1];
  if (wire === 'anthropic') {
    const r = Array.isArray(last?.content) ? last.content.find((x: Json) => x.type === 'tool_result') : null;
    if (!r) return null;
    for (const msg of m) for (const blk of Array.isArray(msg.content) ? msg.content : []) if (blk.type === 'tool_use' && blk.id === r.tool_use_id) return blk.name;
    return '?';
  }
  if (last?.role !== 'tool') return null;
  for (const msg of m) for (const c of msg.tool_calls ?? []) if (c.id === last.tool_call_id) return c.function?.name ?? '?';
  return '?';
}

export function startFakeUpstream(o: { token: string; canaries?: string[]; host?: string; port?: number }) {
  const seen: Seen[] = [];
  let n = 0;
  const server = Bun.serve({ hostname: o.host ?? '127.0.0.1', port: o.port ?? 0, idleTimeout: 0, async fetch(req) {
    const url = new URL(req.url);
    const at = url.pathname.indexOf('/v1/');
    const path = at >= 0 ? url.pathname.slice(at) : url.pathname;
    const prefix = at >= 0 ? url.pathname.slice(0, at) : '';
    const raw = await req.text();
    let body: Json = {};
    try { body = JSON.parse(raw); } catch {}
    const headerText = [...req.headers.entries()].map(([k, v]) => k + ': ' + v).join('\n');
    const presented = req.headers.get('x-api-key') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const wire = WIRES[path] ?? null;
    const rec: Seen = { method: req.method, path, prefix, wire, body, status: 200, credential: presented ? (presented === o.token ? 'expected' : 'other') : 'none',
      canaries: (o.canaries ?? []).filter((c) => raw.includes(c) || headerText.includes(c) || url.search.includes(c)) };
    seen.push(rec);
    if (!wire || req.method !== 'POST') { rec.status = 404; return Response.json({ error: { message: 'no route ' + path } }, { status: 404 }); }
    if (rec.credential !== 'expected') { rec.status = 401; return Response.json({ error: { type: 'authentication_error', message: 'bad credential' } }, { status: 401 }); }
    const k = ++n;
    const user = lastUser(wire, body);
    const done = answeredTool(wire, body);
    const status = user.match(/\[fake:status (\d{3})\]/);
    if (status && !done) {
      rec.status = Number(status[1]);
      return Response.json(wire === 'anthropic' ? { type: 'error', error: { type: 'invalid_request_error', message: 'fake ' + rec.status } } : { error: { type: 'invalid_request_error', code: null, message: 'fake ' + rec.status } }, { status: rec.status });
    }
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const call = !done && hasTools ? user.match(/\[fake:call ([A-Za-z0-9_.-]+) (\{.*?\})\]/) : null;
    const text = !hasTools ? JSON.stringify({ title: 'Fake title' }) : done ? 'fake reply ' + k + ' after ' + done : call ? '' : 'fake reply ' + k;
    const thought = 'fake reasoning ' + k + ' ' + sha(raw);
    const tool = call ? { id: (wire === 'anthropic' ? 'toolu_' : 'call_') + k, name: call[1]!, args: call[2]! } : null;
    const usage = { input: 40, cached: 8, output: 12, reasoning: 5 };
    const headers = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' };

    if (wire === 'anthropic') {
      const ev: Array<[string, Json]> = [['message_start', { type: 'message_start', message: { id: 'msg_' + k, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: usage.cached, cache_creation_input_tokens: 0 } } }]];
      let i = 0;
      if (body.thinking && body.thinking.type !== 'disabled') {
        ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: thought } }],
          ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'sig-' + k } }],
          ['content_block_stop', { type: 'content_block_stop', index: i }]);
        i++;
      }
      if (text) {
        ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } }],
          ['content_block_stop', { type: 'content_block_stop', index: i }]);
        i++;
      }
      if (tool) {
        ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } }],
          ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: tool.args } }],
          ['content_block_stop', { type: 'content_block_stop', index: i }]);
      }
      ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output } }],
        ['message_stop', { type: 'message_stop' }]);
      return new Response(sse(ev), { headers });
    }

    if (wire === 'openai-responses') {
      const output: Json[] = [];
      const ev: Array<[string, Json]> = [];
      const id = 'resp_' + k;
      ev.push(['response.created', { type: 'response.created', response: { id, object: 'response', status: 'in_progress', model: body.model, output: [] } }]);
      const add = (item: Json, deltas: Array<[string, Json]> = []) => {
        const idx = output.length;
        output.push(item);
        ev.push(['response.output_item.added', { type: 'response.output_item.added', output_index: idx, item: { ...item, ...(item.type === 'message' ? { content: [] } : {}), ...(item.type === 'function_call' ? { arguments: '' } : {}) } }]);
        for (const [t, d] of deltas) ev.push([t, { type: t, output_index: idx, item_id: item.id, ...d }]);
        ev.push(['response.output_item.done', { type: 'response.output_item.done', output_index: idx, item }]);
      };
      if (body.reasoning?.effort) add({ type: 'reasoning', id: 'rs_' + k, summary: [{ type: 'summary_text', text: thought }], encrypted_content: 'enc-' + k });
      if (text) add({ type: 'message', id: 'msg_' + k, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
        [['response.content_part.added', { content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }], ['response.output_text.delta', { content_index: 0, delta: text }],
          ['response.output_text.done', { content_index: 0, text }], ['response.content_part.done', { content_index: 0, part: { type: 'output_text', text, annotations: [] } }]]);
      if (tool) add({ type: 'function_call', id: 'fc_' + k, call_id: tool.id, name: tool.name, arguments: tool.args, status: 'completed' },
        [['response.function_call_arguments.delta', { delta: tool.args }], ['response.function_call_arguments.done', { arguments: tool.args }]]);
      ev.push(['response.completed', { type: 'response.completed', response: { id, object: 'response', status: 'completed', model: body.model, output,
        usage: { input_tokens: usage.input, input_tokens_details: { cached_tokens: usage.cached }, output_tokens: usage.output, output_tokens_details: { reasoning_tokens: usage.reasoning }, total_tokens: usage.input + usage.output } } }]);
      return new Response(sse(ev), { headers });
    }

    const openrouter = prefix.endsWith('/openrouter');
    const base = { id: 'chatcmpl_' + k, object: 'chat.completion.chunk', created: 1_790_000_000, model: openrouter ? body.model : 'particle-ai/' + body.model };
    const chunk = (delta: Json, finish: string | null = null): [null, Json] => [null, { ...base, choices: [{ index: 0, delta, finish_reason: finish }] }];
    const ev: Array<[null, Json | string]> = [chunk({ role: 'assistant', content: '' })];
    const thinking = openrouter ? !!body.reasoning?.effort && body.reasoning.effort !== 'none' : !!body.reasoning_effort;
    if (thinking) ev.push(chunk(openrouter ? { reasoning: thought, reasoning_details: [{ type: 'reasoning.text', text: thought, format: 'unknown', index: 0 }] } : { reasoning_content: thought }));
    if (text) ev.push(chunk({ content: text }));
    if (tool) ev.push(chunk({ tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.args } }] }));
    ev.push(chunk({}, tool ? 'tool_calls' : 'stop'));
    if (body.stream_options?.include_usage) ev.push([null, { ...base, choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output,
      prompt_tokens_details: { cached_tokens: usage.cached }, completion_tokens_details: { reasoning_tokens: usage.reasoning } } }]);
    ev.push([null, '[DONE]']);
    return new Response(sse(ev), { headers });
  } });
  return { port: server.port as number, url: 'http://' + (o.host ?? '127.0.0.1') + ':' + server.port, seen, stop: () => server.stop(true) };
}
export type FakeUpstream = ReturnType<typeof startFakeUpstream>;

if (import.meta.main) {
  const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1]! : d; };
  const f = startFakeUpstream({ token: arg('token')!, host: arg('host', '127.0.0.1'), port: Number(arg('port', '0')), canaries: (arg('canaries', '') ?? '').split(',').filter(Boolean) });
  const log = arg('log');
  console.log('listening ' + f.port);
  if (log) setInterval(() => { void Bun.write(log, f.seen.map((s) => JSON.stringify(s)).join('\n') + '\n'); }, 200);
}
