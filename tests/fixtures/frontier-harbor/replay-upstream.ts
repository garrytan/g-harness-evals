/**
 * A fake upstream for the reasoning-replay checks (internal-task round 3): it answers the metering proxy's OpenRouter, Anthropic
 * and OpenAI routes with two shell tool calls and then text, each tool-call turn carrying reasoning in the shape that
 * provider returns, and it records every opaque piece it sent (signatures, encrypted reasoning) keyed to the call id, so a
 * replayed turn can be compared byte for byte. It never refuses a replay: the check records what the harness sends back. A
 * Gemini signature counts only while its reasoning_details id still names the replayed tool call, as OpenRouter keys it.
 *
 * Shapes, from each provider's docs:
 * - OpenRouter Chat Completions: reasoning (text) and reasoning_details. Gemini models get a reasoning.text entry and a
 *   reasoning.encrypted entry keyed to the call id, format google-gemini-v1 (what OpenRouter's Gemini endpoint returns and
 *   checks). Muse Wonder gets a reasoning.summary and a reasoning.encrypted entry, format meta-responses-v1 (OpenRouter lists
 *   that format; whether Meta's endpoint sends encrypted reasoning is not checked keyless). Every other model gets one
 *   reasoning.text entry, format unknown.
 * - Anthropic Messages: a thinking block with a signature before the tool_use block.
 * - OpenAI Responses: a reasoning item with a summary and encrypted_content before the function_call item.
 */
import { PROBE_COMMAND, SHELL_TOOLS, shellTool, sse } from '../../../scripts/frontier-harbor/fake-upstream.ts';

export const TOOL_TURNS = 2;
export type Api = 'chat' | 'messages' | 'responses';
export type Emitted = { api: Api; callId: string; text: string; details?: Record<string, unknown>[]; opaque: string[] };
export type ReplayTurn = { callId: string; known: boolean; id_rewritten: boolean; fields: string[]; text_exact: boolean; opaque_sent: number; opaque_exact: number; key_ok: boolean };
export type ReplayRequest = { n: number; api: Api; chained: boolean; turns: ReplayTurn[] };

const b64 = (s: string) => Buffer.from(s).toString('base64');
export const openrouterFormat = (model: string) => model.startsWith('google/') ? 'google-gemini-v1' : model.startsWith('meta/') ? 'meta-responses-v1' : 'unknown';

function toolResults(api: Api, body: Record<string, any>): number {
  if (api === 'responses') return (Array.isArray(body.input) ? body.input : []).filter((i: any) => typeof i?.type === 'string' && i.type.endsWith('_call_output')).length;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (api === 'chat') return messages.filter((m: any) => m?.role === 'tool').length;
  return messages.flatMap((m: any) => Array.isArray(m?.content) ? m.content : []).filter((b: any) => b?.type === 'tool_result').length;
}

const bare = (id: string) => id.replace(/[^A-Za-z0-9]/g, '');

export function replayUpstream(served: (model: string) => string) {
  const emitted = new Map<string, Emitted>();
  const requests: ReplayRequest[] = [];

  function analyse(api: Api, body: Record<string, any>, n: number) {
    const turns: ReplayTurn[] = [];
    const turn = (callId: string, fields: string[], text: string | null, opaque: string[], keyOk = true) => {
      const e = emitted.get(callId) ?? [...emitted.values()].find((x) => bare(x.callId) === bare(callId));
      turns.push({ callId, known: !!e, id_rewritten: !!e && e.callId !== callId, fields, text_exact: !!e && text === e.text, opaque_sent: e?.opaque.length ?? 0, opaque_exact: e ? e.opaque.filter((o) => opaque.includes(o)).length : 0, key_ok: keyOk });
    };
    if (api === 'chat') {
      for (const m of Array.isArray(body.messages) ? body.messages : []) {
        if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) continue;
        const fields = ['reasoning', 'reasoning_content', 'reasoning_details'].filter((f) => (typeof m[f] === 'string' && m[f] !== '') || (Array.isArray(m[f]) && m[f].length));
        if (m.tool_calls.some((c: any) => c?.extra_content)) fields.push('tool_calls[].extra_content');
        const details: any[] = Array.isArray(m.reasoning_details) ? m.reasoning_details : [];
        const text = typeof m.reasoning === 'string' && m.reasoning ? m.reasoning : typeof m.reasoning_content === 'string' && m.reasoning_content ? m.reasoning_content
          : details.filter((d) => d?.type === 'reasoning.text').map((d) => d.text).join('') || details.filter((d) => d?.type === 'reasoning.summary').map((d) => d.summary).join('') || null;
        const signatures = details.filter((d) => d?.type === 'reasoning.encrypted' && d.format === 'google-gemini-v1');
        turn(m.tool_calls[0].id, fields, text, details.flatMap((d) => [d?.data, d?.signature]).filter((x): x is string => typeof x === 'string'), signatures.every((d) => d.id === m.tool_calls[0].id));
      }
    } else if (api === 'messages') {
      for (const m of Array.isArray(body.messages) ? body.messages : []) {
        if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
        const use = m.content.find((b: any) => b?.type === 'tool_use');
        if (!use) continue;
        const thinking = m.content.filter((b: any) => b?.type === 'thinking' || b?.type === 'redacted_thinking');
        turn(use.id, thinking.length ? ['thinking'] : [], thinking.map((b: any) => b.thinking ?? '').join('') || null, thinking.flatMap((b: any) => [b.signature, b.data]).filter((x: unknown): x is string => typeof x === 'string'));
      }
    } else {
      const items: any[] = Array.isArray(body.input) ? body.input : [];
      items.forEach((it, i) => {
        if (it?.type !== 'function_call') return;
        let j = i - 1;
        while (j >= 0 && items[j]?.type === 'function_call') j--;
        const r = j >= 0 && items[j]?.type === 'reasoning' ? items[j] : null;
        const fields = r ? ['reasoning item' + (r.encrypted_content ? ' with encrypted_content' : '')] : [];
        turn(it.call_id, fields, r ? (r.summary ?? []).map((s: any) => s?.text ?? '').join('') || null : null, r && typeof r.encrypted_content === 'string' ? [r.encrypted_content] : []);
      });
    }
    requests.push({ n, api, chained: typeof body.previous_response_id === 'string' && body.previous_response_id !== '', turns });
  }

  function reply(path: string, body: Record<string, any>, n: number): Response {
    const api: Api | null = path.endsWith('/v1/chat/completions') ? 'chat' : path.endsWith('/v1/messages') ? 'messages' : path.endsWith('/v1/responses') ? 'responses' : null;
    if (!api) return path.endsWith('/v1/models') ? Response.json({ object: 'list', data: [] }) : Response.json({ error: { message: 'replay upstream: no route ' + path } }, { status: 404 });
    analyse(api, body, n);
    const model = String(body.model ?? 'fake');
    const stream = body.stream === true;
    const tool = toolResults(api, body) < TOOL_TURNS ? shellTool(body) : null;
    const callId = tool ? (api === 'messages' ? 'toolu_replay_' : 'call_replay_') + n : null;
    const args = tool ? JSON.stringify(SHELL_TOOLS[tool.name]!(PROBE_COMMAND)) : '';
    const text = 'Replay probe reasoning ' + n + ': run the probe once, then answer.';
    const answer = 'ok';
    if (api === 'chat') {
      const format = openrouterFormat(model);
      const key = callId ?? 'text_' + n;
      const head: Record<string, unknown> = { id: 'gen-replay-' + n, provider: served(model), model, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000) };
      const enc = { type: 'reasoning.encrypted', data: b64(format + ':' + key), id: key, format, index: 1 };
      const details: Record<string, unknown>[] = format === 'google-gemini-v1' ? [{ type: 'reasoning.text', text, format, index: 0 }, enc]
        : format === 'meta-responses-v1' ? [{ type: 'reasoning.summary', summary: text, id: 'rs_' + key, format, index: 0 }, { ...enc, id: 'rs_' + key }]
        : [{ type: 'reasoning.text', text, format, index: 0 }];
      if (callId) emitted.set(callId, { api, callId, text, details, opaque: details.flatMap((d) => [d.data, d.signature]).filter((x): x is string => typeof x === 'string') });
      const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.0001 };
      const finish = tool ? 'tool_calls' : 'stop';
      if (!stream) return Response.json({ ...head, object: 'chat.completion', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: tool ? null : answer, reasoning: text, reasoning_details: details,
        ...(tool ? { tool_calls: [{ id: callId, type: 'function', function: { name: tool.name, arguments: args } }] } : {}) } }], usage });
      const chunk = (delta: unknown, f: string | null = null) => ({ ...head, choices: [{ index: 0, delta, finish_reason: f }] });
      const events: Array<[string | null, unknown]> = [[null, chunk({ role: 'assistant', content: '' })], [null, chunk({ reasoning: text, reasoning_details: details.slice(0, 1) })]];
      if (tool) events.push([null, chunk({ tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: tool.name, arguments: args.slice(0, 5) } }] })], [null, chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] })]);
      else events.push([null, chunk({ content: answer })]);
      if (details.length > 1) events.push([null, chunk({ reasoning_details: details.slice(1) })]);
      events.push([null, chunk({}, finish)], [null, { ...head, choices: [], usage }], [null, '[DONE]']);
      return sse(events);
    }
    if (api === 'messages') {
      const signature = b64('anthropic-thinking-signature:' + (callId ?? 'text_' + n));
      if (callId) emitted.set(callId, { api, callId, text, opaque: [signature] });
      const id = 'msg_replay_' + n;
      const usage = { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const thinking = { type: 'thinking', thinking: text, signature };
      const second = tool ? { type: 'tool_use', id: callId, name: tool.name, input: JSON.parse(args) } : { type: 'text', text: answer };
      const stop = tool ? 'tool_use' : 'end_turn';
      if (!stream) return Response.json({ id, type: 'message', role: 'assistant', model, content: [thinking, second], stop_reason: stop, stop_sequence: null, usage });
      return sse([
        ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: text } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: tool ? { ...second, input: {} } : { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: tool ? { type: 'input_json_delta', partial_json: args } : { type: 'text_delta', text: answer } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } }],
        ['message_stop', { type: 'message_stop' }],
      ]);
    }
    const encrypted = b64('openai-encrypted-reasoning:' + (callId ?? 'text_' + n));
    if (callId) emitted.set(callId, { api, callId, text, opaque: [encrypted] });
    const id = 'resp_replay_' + n;
    const reasoning = { type: 'reasoning', id: 'rs_replay_' + n, summary: [{ type: 'summary_text', text }], encrypted_content: encrypted };
    const second: Record<string, any> = tool
      ? { type: 'function_call', id: 'fc_replay_' + n, call_id: callId, name: tool.name, arguments: args, status: 'completed' }
      : { type: 'message', id: 'msg_replay_' + n, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: answer, annotations: [] }] };
    const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [reasoning, second],
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 20 } } };
    if (!stream) return Response.json(response);
    const pending = { ...response, status: 'in_progress', output: [], usage: null };
    const events: Array<[string, Record<string, unknown>]> = [
      ['response.created', { response: pending }], ['response.in_progress', { response: pending }],
      ['response.output_item.added', { output_index: 0, item: { ...reasoning, summary: [] } }],
      ['response.reasoning_summary_part.added', { item_id: reasoning.id, output_index: 0, summary_index: 0, part: { type: 'summary_text', text: '' } }],
      ['response.reasoning_summary_text.delta', { item_id: reasoning.id, output_index: 0, summary_index: 0, delta: text }],
      ['response.reasoning_summary_text.done', { item_id: reasoning.id, output_index: 0, summary_index: 0, text }],
      ['response.reasoning_summary_part.done', { item_id: reasoning.id, output_index: 0, summary_index: 0, part: { type: 'summary_text', text } }],
      ['response.output_item.done', { output_index: 0, item: reasoning }],
      ...(tool ? [
        ['response.output_item.added', { output_index: 1, item: { ...second, status: 'in_progress', arguments: '' } }],
        ['response.function_call_arguments.delta', { item_id: second.id, output_index: 1, delta: args }],
        ['response.function_call_arguments.done', { item_id: second.id, output_index: 1, arguments: args }],
      ] : [
        ['response.output_item.added', { output_index: 1, item: { ...second, status: 'in_progress', content: [] } }],
        ['response.content_part.added', { item_id: second.id, output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
        ['response.output_text.delta', { item_id: second.id, output_index: 1, content_index: 0, delta: answer }],
        ['response.output_text.done', { item_id: second.id, output_index: 1, content_index: 0, text: answer }],
        ['response.content_part.done', { item_id: second.id, output_index: 1, content_index: 0, part: second.content[0] }],
      ]) as Array<[string, Record<string, unknown>]>,
      ['response.output_item.done', { output_index: 1, item: second }],
      ['response.completed', { response }],
    ];
    return sse(events.map(([e, d], i) => [e, { type: e, sequence_number: i, ...d }]));
  }

  return { reply, requests, emitted };
}

/** One harness run's verdict: every replayed tool-call turn the harness sent back, and whether each carried the reasoning
 *  this fake returned with that call, its opaque parts byte for byte. */
export function replayVerdict(requests: ReplayRequest[]) {
  const turns = requests.flatMap((r) => r.turns.filter((t) => t.known));
  const fields = [...new Set(turns.flatMap((t) => t.fields))].sort();
  const opaqueSent = turns.reduce((s, t) => s + t.opaque_sent, 0), opaqueExact = turns.reduce((s, t) => s + t.opaque_exact, 0);
  const carried = turns.filter((t) => t.fields.length > 0).length;
  const chained = requests.some((r) => r.chained);
  const verdict = !turns.length ? (chained ? 'chained on previous_response_id' : 'no replayed turn')
    : carried === turns.length && opaqueExact === opaqueSent && turns.every((t) => t.key_ok && (t.text_exact || t.opaque_sent > 0)) ? 'replays'
    : carried === 0 ? 'drops' : 'partial';
  return { verdict, replayed_turns: turns.length, carried, ids_rewritten: turns.filter((t) => t.id_rewritten).length, keys_broken: turns.filter((t) => !t.key_ok).length, text_exact: turns.filter((t) => t.text_exact).length, opaque_sent: opaqueSent, opaque_exact: opaqueExact, fields, chained };
}
