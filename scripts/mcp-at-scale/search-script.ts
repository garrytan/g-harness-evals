// The scripted model for the search-effort captures (upstream.ts, mode "search"): it plays a model that needs one catalog
// tool, finds it with the harness's own search mechanism, calls it, and stops. Its traces are real harness transcripts of a
// search (the search-effort parser fixtures) and an end-to-end check of the verifier's right-tool outcome. Nothing here is
// a model under test.
//
// Per agent-loop request (one that declares tools), by how many tool calls the conversation already holds (k):
//   the target declared to the model (direct exposure, tool search off, or loaded by an earlier search): call it;
//   k = 0, otherwise: search, with the first of these the request declares:
//     ToolSearch (Claude Code)     { query: "+<server> <tool words>", max_results: 5 }
//     tool_search (Hermes, OpenClaw, Pi deferred)   query / queries filled from its own schema
//     codemode (Pi)                 searchTools("<server words> <tool words>")
//     exec, custom (Codex)          ALL_TOOLS filtered by the tool's name (OpenClaw's exec is a shell tool and is never used)
//   k = 1, the target still not declared: call it through the harness's indirect route, by the exact name the search
//     result returned when it holds one (tool_call for Hermes and OpenClaw 2026.10, dispatch_action for OpenClaw 2026.11, a
//     codemode or exec script for Pi and Codex, mcp_call with the server id tool_search returned for QM);
//   otherwise: a short text answer, so the turn ends.
// Requests that declare no tools (titles, summaries) and Gemini routes get scripts/frontier-harbor/fake-upstream.ts's reply.
import { sse } from '../frontier-harbor/fake-upstream.ts';
import { declaredWithSchemas } from './request-shape.ts';
import { walk } from '../frontier-harbor/gstack-exposure.ts';

export interface SearchTarget { server: string; tool: string; args: Record<string, unknown>; query: string }
export const DONE_TEXT = 'Done: the scripted search model called the tool and is stopping here.';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const jsIdent = (s: string) => s.replace(/[^A-Za-z0-9_$]/g, '_');

/** The declared tool that is the target, if any: its normalized name ends with the tool and holds the server. */
export function declaredTarget(body: Record<string, any>, t: SearchTarget): string | null {
  const d = declaredWithSchemas(body).find((x) => { const n = norm(x.name); return n.endsWith('_' + norm(t.tool)) && n.includes(norm(t.server)); });
  return d ? d.name : null;
}

/** Tool calls the conversation already holds, and the text of the last tool result. */
export function history(body: Record<string, any>): { calls: number; lastCall: string | null; lastResult: string } {
  const w = walk(body);
  const results = [...w.results.values()];
  return { calls: w.calls.length, lastCall: w.calls.length ? w.calls[w.calls.length - 1]!.name : null, lastResult: results.length ? results[results.length - 1]! : '' };
}

/** The exact name a search result gave the target (mcp__ash_tracker__create_issue, ash-tracker__create_issue, ...). */
export function nameFromResult(text: string, t: SearchTarget): string | null {
  const re = /[A-Za-z0-9_.:-]{3,}/g;
  for (const m of text.matchAll(re)) {
    const n = norm(m[0]);
    if (n.endsWith('_' + norm(t.tool)) && n.includes(norm(t.server))) return m[0];
  }
  return null;
}

function searchArgs(schema: any, q: string): Record<string, unknown> {
  const p = schema?.properties ?? {};
  const out: Record<string, unknown> = {};
  if (p.queries) {
    const items = p.queries.items ?? p.queries.anyOf?.find((a: any) => a.type === 'array')?.items;
    out.queries = items?.type === 'object' ? [{ query: q }] : [q];
  } else out.query = q;
  for (const r of schema?.required ?? []) if (!(r in out) && /max|limit/.test(r)) out[r] = 5;
  return out;
}

type Call = { name: string; input: Record<string, unknown> } | { name: string; custom: string };

export function plan(body: Record<string, any>, t: SearchTarget): Call | 'text' | null {
  const declared = declaredWithSchemas(body);
  if (!declared.length) return null;
  const { calls, lastCall, lastResult } = history(body);
  if (calls >= 2) return 'text';
  const direct = declaredTarget(body, t);
  if (direct) return lastCall && norm(lastCall).endsWith(norm(direct)) ? 'text' : { name: direct, input: t.args };
  const has = (n: string) => declared.find((d) => d.name === n || d.name.endsWith('__' + n) || d.name.endsWith('.' + n));
  const codexExec = declared.find((d) => d.name === 'exec' && d.schema == null);
  const words = t.server.replace(/[-_]/g, ' ') + ' ' + t.tool.replace(/_/g, ' ');
  const found = nameFromResult(lastResult, t);
  const qualified = 'mcp__' + t.server.replace(/[^A-Za-z0-9_]/g, '_') + '__' + t.tool;
  if (calls === 0) {
    if (has('ToolSearch')) return { name: 'ToolSearch', input: { query: '+' + t.server + ' ' + t.tool.replace(/_/g, ' '), max_results: 5 } };
    const ts = has('tool_search');
    if (ts) return { name: ts.name, input: searchArgs(ts.schema, words) };
    if (has('codemode')) return { name: 'codemode', input: { code: 'const hits = await searchTools(' + JSON.stringify(words) + ');\ntext(JSON.stringify(hits.map((h) => h.name)));' } };
    if (codexExec) return { name: 'exec', custom: 'const hits = ALL_TOOLS.filter((t) => t.name.includes(' + JSON.stringify(t.tool) + ')).map((t) => t.name);\ntext(JSON.stringify(hits));\n' };
    return 'text';
  }
  if (has('mcp_call')) {
    const id = new RegExp('"server":"([a-z][a-z0-9-]*)","tool":' + JSON.stringify(t.tool)).exec(lastResult)?.[1] ?? t.server;
    return { name: 'mcp_call', input: { server: id, tool: t.tool, args: t.args } };
  }
  const name = found ?? qualified;
  if (has('tool_call')) {
    const tc = has('tool_call')!;
    const p = tc.schema?.properties ?? {};
    if (p.calls) return { name: tc.name, input: { calls: [{ name, arguments: t.args }] } };
    return { name: tc.name, input: { id: name, args: t.args } };
  }
  if (has('dispatch_action')) return { name: 'dispatch_action', input: { id: name, args: t.args } };
  if (has('codemode')) return { name: 'codemode', input: { code: 'const r = await tools.' + jsIdent(name) + '(' + JSON.stringify(t.args) + ');\ntext(typeof r === "string" ? r : JSON.stringify(r));' } };
  if (codexExec) return { name: 'exec', custom: 'const r = await tools.' + jsIdent(name) + '(' + JSON.stringify(t.args) + ');\ntext(JSON.stringify(r));\n' };
  return 'text';
}

const usageA = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function anthropic(body: Record<string, any>, n: number, c: Call | 'text'): Response {
  const model = body.model ?? 'fake';
  const id = 'msg_script_' + n;
  const block = c === 'text' ? { type: 'text', text: DONE_TEXT } : { type: 'tool_use', id: 'toolu_script_' + n, name: c.name, input: 'input' in c ? c.input : { code: c.custom } };
  const stop = c === 'text' ? 'end_turn' : 'tool_use';
  if (body.stream !== true) return Response.json({ id, type: 'message', role: 'assistant', model, content: [block], stop_reason: stop, stop_sequence: null, usage: usageA });
  const start = block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} };
  const delta = block.type === 'text' ? { type: 'text_delta', text: DONE_TEXT } : { type: 'input_json_delta', partial_json: JSON.stringify((block as any).input) };
  return sse([
    ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usageA, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: start }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

function responses(body: Record<string, any>, n: number, c: Call | 'text', namespace?: string): Response {
  const model = body.model ?? 'fake';
  const item: Record<string, any> = c === 'text'
    ? { type: 'message', id: 'msg_script_' + n, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: DONE_TEXT, annotations: [] }] }
    : 'custom' in c
      ? { type: 'custom_tool_call', id: 'ctc_script_' + n, call_id: 'call_script_' + n, name: c.name, input: c.custom, status: 'completed' }
      : { type: 'function_call', id: 'fc_script_' + n, call_id: 'call_script_' + n, ...(namespace ? { namespace } : {}), name: c.name, arguments: JSON.stringify(c.input), status: 'completed' };
  const response = { id: 'resp_script_' + n, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  if (body.stream !== true) return Response.json(response);
  const pending = { ...response, status: 'in_progress', output: [], usage: null };
  const mid: Array<[string, Record<string, unknown>]> = c === 'text'
    ? [
      ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
      ['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
      ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: DONE_TEXT }],
      ['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: DONE_TEXT }],
      ['response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
    ]
    : 'custom' in c
      ? [
        ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', input: '' } }],
        ['response.custom_tool_call_input.delta', { item_id: item.id, output_index: 0, delta: item.input }],
        ['response.custom_tool_call_input.done', { item_id: item.id, output_index: 0, input: item.input }],
      ]
      : [
        ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } }],
        ['response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments }],
        ['response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments }],
      ];
  const all: Array<[string, Record<string, unknown>]> = [['response.created', { response: pending }], ['response.in_progress', { response: pending }], ...mid, ['response.output_item.done', { output_index: 0, item }], ['response.completed', { response }]];
  return sse(all.map(([e, d], i) => [e, { type: e, sequence_number: i, ...d }]));
}

function chat(body: Record<string, any>, n: number, c: Call | 'text'): Response {
  const model = body.model ?? 'fake';
  const id = 'chatcmpl_script_' + n;
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const message = c === 'text' ? { role: 'assistant', content: DONE_TEXT } : { role: 'assistant', content: null, tool_calls: [{ id: 'call_script_' + n, type: 'function', function: { name: c.name, arguments: JSON.stringify('input' in c ? c.input : { code: c.custom }) } }] };
  const finish = c === 'text' ? 'stop' : 'tool_calls';
  if (body.stream !== true) return Response.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, finish_reason: finish, message }], usage });
  const chunk = (delta: unknown, f: string | null) => ({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: f }] });
  const delta = c === 'text' ? message : { role: 'assistant', content: null, tool_calls: [{ index: 0, ...(message as any).tool_calls[0] }] };
  return sse([[null, chunk(delta, null)], [null, chunk({}, finish)], [null, { id, object: 'chat.completion.chunk', model, choices: [], usage }], [null, '[DONE]']]);
}

/** The scripted reply, or null to fall back to fake-upstream's reply (no tools declared, or a route this script does not speak). */
export function scriptedReply(path: string, body: Record<string, any>, n: number, t: SearchTarget): Response | null {
  if (!/\/v1\/(messages|responses|chat\/completions)$/.test(path)) return null;
  const c = plan(body, t);
  if (c === null) return null;
  if (path.endsWith('/v1/messages')) return anthropic(body, n, c);
  if (path.endsWith('/v1/responses')) {
    const ns = c !== 'text' && !('custom' in c) && c.name.includes('.') ? c.name.split('.')[0] : undefined;
    return responses(body, n, c === 'text' || !ns ? c : { ...c, name: c.name.split('.').slice(1).join('.') }, ns);
  }
  return chat(body, n, c);
}
