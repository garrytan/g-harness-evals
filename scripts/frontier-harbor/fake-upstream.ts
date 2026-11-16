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
// fake-openrouter.ts): provider DeepSeek (for another pinned model, the provider OPENROUTER_MODELS pins it to), a gen- id, reasoning and reasoning_details beside the content, one call of the
// first declared tool and then "ok", and DeepSeek's 400 for a tool-call turn replayed without its reasoning, so a harness
// that drops the reasoning fails here as it would upstream. The proxy's google upstream is <this>/google and its xai upstream
// <this>/xai (internal-task): Gemini generateContent and streamGenerateContent (Gemini's 400 for a function call replayed without
// its thought signature), xAI Chat Completions and Responses with xAI's usage, and on both the provider's safety-filter stop
// for a request carrying SAFETY_MARKER. A google/ model on <this>/openrouter answers as OpenRouter's Google AI Studio Gemini
// endpoint does, thought signatures in reasoning_details included, for the google route's via-OpenRouter mode too
// (openrouterGeminiReply). Every OpenRouter request must carry the proxy's pin for its model (provider.only that one
// endpoint, allow_fallbacks false, and service_tier default where the pin names a tier), or it gets a 400 (unpinnedReason).
// A meta/ model on <this>/openrouter/v1/responses answers as the fake for Muse Code (museReply).
// Each request appends one line to
// --log: path, model, stream, the tool names and effort fields the request declared, whether a credential header came
// in and whether it equals the canary (--canary-env names the variable holding the fake provider key the proxy was
// given), whether it chained on previous_response_id and its store field, the body's sha256, and on the OpenRouter route which reasoning fields each replayed assistant message carried. With --bodies it also writes each body to that file, for the canary and token scans.
// With --tool-call (the delivery checks, internal-task d12) an agent-loop request (one that declares a shell tool) whose
// conversation holds no tool result yet gets one call of that shell tool, running `echo he-delivery-probe-$((6*7))`, instead of
// the text reply, so the harness sends a tool follow-up request; the follow-up gets the text reply and the turn ends.
// Codex 0.165.0 declares its tools inside a Responses input item (additional_tools) and its shell is the freeform code-mode
// tool exec, so Codex gets a custom_tool_call whose JavaScript runs the command through tools.exec_command.
// Without the flag every reply is the text reply, as before.
//
//   bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log <requests.jsonl> [--bodies <bodies.jsonl>]
//       [--canary-env FAKE_UPSTREAM_CANARY] [--tool-call]
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chatBody, chatStream, DEEPSEEK_REPLAY_ERROR, errorBody, replayedAssistants } from '../../tests/fixtures/openrouter/fake-openrouter.ts';
import { GEMINI_HOUSEKEEPING_MODELS, OPENROUTER_MODELS, type OpenRouterPin } from '../../runner/proxy/metering-proxy.ts';

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

/** The shell tools the five frontier harnesses declare, and the arguments each takes for one command. */
export const SHELL_TOOLS: Record<string, (command: string) => Record<string, unknown>> = {
  Bash: (command) => ({ command, description: 'Print a probe line' }),
  bash: (command) => ({ command }),
  exec_command: (command) => ({ cmd: command }),
  shell: (command) => ({ command: ['bash', '-c', command] }),
  terminal: (command) => ({ command }),
  exec: (command) => ({ command }),
};
/** The probe command and its output; the output is not a substring of the command, so a body holding it holds the tool result. */
export const PROBE_COMMAND = 'echo he-delivery-probe-$((6*7))';
export const PROBE_OUTPUT = 'he-delivery-probe-42';

/** Codex 0.165.0's shell in code mode: the freeform custom tool exec runs JavaScript whose nested tools.exec_command runs the command. */
export const CODEX_EXEC_SOURCE = 'const r = await tools.exec_command({ cmd: ' + JSON.stringify(PROBE_COMMAND) + ' });\ntext(r);\n';

/** Every tool the request declares: body.tools, and the namespaces Codex 0.165.0 sends as a Responses input item of type additional_tools. */
export function declaredTools(body: Record<string, any>): { name: string; type: string | null }[] {
  const flat = (ts: any[]): { name: string; type: string | null }[] => ts.flatMap((t: any) => t?.type === 'namespace' && Array.isArray(t.tools) ? flat(t.tools)
    : [{ name: t?.name ?? t?.function?.name ?? t?.type ?? null, type: t?.type ?? null }]).filter((t) => t.name);
  const extra = Array.isArray(body.input) ? body.input.filter((i: any) => i?.type === 'additional_tools' && Array.isArray(i.tools)).flatMap((i: any) => i.tools) : [];
  return flat([...(Array.isArray(body.tools) ? body.tools : []), ...extra]);
}

/** The first shell tool the request declares (custom: Codex's freeform exec), or null. */
export function shellTool(body: Record<string, any>): { name: string; custom: boolean } | null {
  const t = declaredTools(body).find((t) => t.name in SHELL_TOOLS);
  return t ? { name: t.name, custom: t.type === 'custom' } : null;
}

/** True when the conversation already holds a tool result (Messages tool_result, Chat Completions role tool, Responses *_call_output). */
export function hasToolResult(body: Record<string, any>): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.some((m: any) => m?.role === 'tool' || (Array.isArray(m?.content) && m.content.some((b: any) => b?.type === 'tool_result')))) return true;
  return Array.isArray(body.input) && body.input.some((i: any) => typeof i?.type === 'string' && i.type.endsWith('_call_output'));
}

function toolReply(path: string, body: Record<string, any>, n: number, tool: { name: string; custom: boolean }): Response | null {
  const model = body.model ?? 'fake';
  const stream = body.stream === true;
  const name = tool.name;
  const args = SHELL_TOOLS[name]!(PROBE_COMMAND);
  const json = JSON.stringify(args);
  if (path.endsWith('/v1/messages')) {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const id = 'msg_fake_' + n;
    const use = { type: 'tool_use', id: 'toolu_fake_' + n, name, input: args };
    if (!stream) return Response.json({ id, type: 'message', role: 'assistant', model, content: [use], stop_reason: 'tool_use', stop_sequence: null, usage });
    return sse([
      ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { ...use, input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  }
  if (path.endsWith('/v1/responses')) {
    const id = 'resp_fake_' + n;
    const item: Record<string, unknown> = tool.custom
      ? { type: 'custom_tool_call', id: 'ctc_fake_' + n, call_id: 'call_fake_' + n, name, input: CODEX_EXEC_SOURCE, status: 'completed' }
      : { type: 'function_call', id: 'fc_fake_' + n, call_id: 'call_fake_' + n, name, arguments: json, status: 'completed' };
    const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    if (!stream) return Response.json(response);
    const pending = { ...response, status: 'in_progress', output: [], usage: null };
    return sse([
      ['response.created', { type: 'response.created', sequence_number: 0, response: pending }],
      ['response.in_progress', { type: 'response.in_progress', sequence_number: 1, response: pending }],
      ['response.output_item.added', { type: 'response.output_item.added', sequence_number: 2, output_index: 0, item: { ...item, status: 'in_progress', ...(tool.custom ? { input: '' } : { arguments: '' }) } }],
      ...(tool.custom ? [
        ['response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', sequence_number: 3, item_id: item.id, output_index: 0, delta: CODEX_EXEC_SOURCE }],
        ['response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', sequence_number: 4, item_id: item.id, output_index: 0, input: CODEX_EXEC_SOURCE }],
      ] : [
        ['response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', sequence_number: 3, item_id: item.id, output_index: 0, delta: json }],
        ['response.function_call_arguments.done', { type: 'response.function_call_arguments.done', sequence_number: 4, item_id: item.id, output_index: 0, arguments: json }],
      ]) as [string, unknown][],
      ['response.output_item.done', { type: 'response.output_item.done', sequence_number: 5, output_index: 0, item }],
      ['response.completed', { type: 'response.completed', sequence_number: 6, response }],
    ]);
  }
  if (path.endsWith('/v1/chat/completions')) {
    const id = 'chatcmpl_fake_' + n;
    const echoed = path.startsWith('/particle/') ? 'particle-ai/' + model : model;
    const call = { id: 'call_fake_' + n, type: 'function', function: { name, arguments: json } };
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!stream) return Response.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: echoed, choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [call] } }], usage });
    const chunk = (delta: unknown, finish: string | null) => ({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: echoed, choices: [{ index: 0, delta, finish_reason: finish }] });
    return sse([[null, chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, ...call }] }, null)], [null, chunk({}, 'tool_calls')], [null, { id, object: 'chat.completion.chunk', model: echoed, choices: [], usage }], [null, '[DONE]']]);
  }
  return null;
}

/** A request whose text holds this marker gets the provider's safety-filter stop instead of a reply (Gemini finishReason
 *  SAFETY, xAI finish_reason content_filter or a Responses content_filter incomplete), so the proxy's safety_stop field can be
 *  checked keyless (internal-task, R95). */
export const SAFETY_MARKER = 'HE_FAKE_SAFETY_STOP';
/** Gemini's 400 for a function call replayed without the thought signature the model returned with it
 *  (ai.google.dev/gemini-api/docs/thought-signatures: Gemini 3 and later models validate them on function calls). */
export const GEMINI_SIGNATURE_ERROR = 'Function call is missing a thought_signature in functionCall parts.';
export const GEMINI_SIGNATURE = 'ZmFrZS10aG91Z2h0LXNpZ25hdHVyZQ==';
const GOOGLE_METHOD = /^\/google\/v1(beta)?\/models\/([A-Za-z0-9._-]+):(generateContent|streamGenerateContent)$/;

/** The Gemini routes the proxy forwards to <this>/google: one text reply, or one call of the first declared function with a thought
 *  signature when the conversation holds no function response yet; a replayed model function call without its signature gets
 *  Gemini's 400. Streamed with ?alt=sse (the proxy refuses streams without it), one candidate chunk then a final chunk with usage. */
function googleReply(path: string, body: Record<string, any>, stream: boolean): Response {
  const m = path.match(GOOGLE_METHOD)!;
  const contents: any[] = Array.isArray(body.contents) ? body.contents : [];
  const parts = contents.flatMap((c) => (Array.isArray(c?.parts) ? c.parts.map((p: any) => ({ role: c.role, part: p })) : []));
  if (parts.some(({ role, part }) => role === 'model' && part?.functionCall && !part.thoughtSignature && !part.thought_signature))
    return Response.json({ error: { code: 400, message: GEMINI_SIGNATURE_ERROR, status: 'INVALID_ARGUMENT' } }, { status: 400 });
  const usage = { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 4, totalTokenCount: 19, cachedContentTokenCount: 0 };
  const fn = (Array.isArray(body.tools) ? body.tools : []).flatMap((t: any) => t?.functionDeclarations ?? t?.function_declarations ?? [])[0];
  const answered = parts.some(({ part }) => part?.functionResponse || part?.function_response);
  const safety = JSON.stringify(body).includes(SAFETY_MARKER);
  const candidate = safety ? { finishReason: 'SAFETY', index: 0, safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH', blocked: true }] }
    : fn && !answered ? { content: { role: 'model', parts: [{ functionCall: { name: fn.name, args: placeholderArgs(fn.parameters ?? fn.parametersJsonSchema) }, thoughtSignature: GEMINI_SIGNATURE }] }, finishReason: 'STOP', index: 0 }
    : { content: { role: 'model', parts: [{ text: TEXT }] }, finishReason: 'STOP', index: 0 };
  const done = { candidates: [candidate], usageMetadata: usage, modelVersion: m[2], responseId: 'fake-gemini' };
  if (!stream) return Response.json(done);
  return sse([[null, { candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, index: 0 }], usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 }, modelVersion: m[2] }], [null, done]]);
}

/** OpenRouter's 400 when a Gemini tool-call turn comes back without the thought signature it was answered with. */
export const OPENROUTER_GEMINI_SIGNATURE_ERROR = 'Unable to submit request because Thought signature is not valid.';
/** The fake signature for one tool call id: opaque base64, different per call, so a swapped or rebuilt signature fails. */
export const signatureFor = (callId: string) => Buffer.from('fake-gemini-thought-signature:' + callId).toString('base64');
/** Tool calls the OpenRouter Gemini route makes before it answers in text: a three-turn loop (call, call, text). */
export const GEMINI_TOOL_TURNS = 2;
/** A probe command whose output (he-gemini-probe-<turn>-42) is not in the command; Gemini CLI refuses $(...) substitution. */
export const GEMINI_PROBE = (turn: number) => "printf 'he-gemini-probe-%s-%s\\n' " + turn + ' 42';

function geminiTool(body: Record<string, any>, turn: number): { name: string; args: Record<string, unknown> } | null {
  const tools = (Array.isArray(body.tools) ? body.tools : []).map((t: any) => t?.function).filter(Boolean);
  const shell = tools.find((f: any) => f.name === 'run_shell_command');
  if (shell) return { name: shell.name, args: { command: GEMINI_PROBE(turn), description: 'Print a probe line' } };
  return tools[0] ? { name: tools[0].name, args: placeholderArgs(tools[0].parameters) } : null;
}

const PINS: Record<string, OpenRouterPin> = { ...OPENROUTER_MODELS, ...GEMINI_HOUSEKEEPING_MODELS };
/** Why an OpenRouter request is not on its model's pinned endpoint, or null when it is: the proxy must have set provider
 *  {only: [the pinned endpoint], allow_fallbacks: false} and, for a tier-pinned model, service_tier default. The real
 *  OpenRouter would route such a request elsewhere; the fake refuses it, so a proxy that drops the pin fails the check. */
export function unpinnedReason(body: Record<string, any>): string | null {
  const pin = PINS[String(body.model ?? '')];
  if (!pin) return `model ${JSON.stringify(body.model ?? null)} has no pinned OpenRouter endpoint`;
  const p = body.provider;
  if (!p || typeof p !== 'object' || JSON.stringify(p.only) !== JSON.stringify([pin.only]) || p.allow_fallbacks !== false || p.order !== undefined || p.ignore !== undefined)
    return `provider routing ${JSON.stringify(p ?? null)} is not the pin {only: [${pin.only}], allow_fallbacks: false}`;
  if (pin.service_tier && body.service_tier !== pin.service_tier) return `service_tier ${JSON.stringify(body.service_tier ?? null)} is not the pinned ${pin.service_tier}`;
  return null;
}

/** OpenRouter's Chat Completions for a google/ model, the way OpenRouter's Google AI Studio endpoint answers (provider Google AI Studio):
 *  reasoning and a google-gemini-v1 reasoning_details entry, and on a tool turn one call whose thought signature rides in a
 *  reasoning.encrypted entry keyed to the call id. Two tool turns, then text; a replayed tool-call turn whose entry is
 *  missing or changed gets OpenRouter's 400; SAFETY_MARKER gets a content_filter finish with native reason SAFETY. */
function openrouterGeminiReply(body: Record<string, any>, n: number, stream: boolean): Response {
  const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) continue;
    const first = m.tool_calls[0].id;
    const signed = (m.reasoning_details ?? []).some((d: any) => d?.type === 'reasoning.encrypted' && d.format === 'google-gemini-v1' && d.id === first && d.data === signatureFor(first));
    if (!signed) return Response.json(errorBody(400, OPENROUTER_GEMINI_SIGNATURE_ERROR), { status: 400 });
  }
  const id = 'gen-gemini-' + n;
  const turn = messages.filter((m) => m?.role === 'tool').length;
  const safety = JSON.stringify(messages).includes(SAFETY_MARKER);
  const tool = !safety && turn < GEMINI_TOOL_TURNS ? geminiTool(body, turn + 1) : null;
  const callId = tool ? 'tool_' + n + '_' + tool.name : null;
  const args = tool ? JSON.stringify(tool.args) : '';
  const signature = callId ? { type: 'reasoning.encrypted', data: signatureFor(callId), id: callId, format: 'google-gemini-v1', index: 1 } : null;
  const thought = { type: 'reasoning.text', text: REASONING, format: 'google-gemini-v1', index: 0 };
  const [finish, native] = safety ? ['content_filter', 'SAFETY'] : tool ? ['tool_calls', 'STOP'] : ['stop', 'STOP'];
  const content = safety || tool ? '' : TEXT;
  const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.00042 };
  const head = { id, provider: PINS[String(body.model ?? '')]?.served ?? 'Google AI Studio', model: body.model, object: 'chat.completion' };
  if (!stream) return Response.json({ ...head, choices: [{ index: 0, finish_reason: finish, native_finish_reason: native, message: { role: 'assistant', content, reasoning: REASONING,
    reasoning_details: [thought, ...(signature ? [signature] : [])], ...(tool ? { tool_calls: [{ id: callId, type: 'function', function: { name: tool.name, arguments: args } }] } : {}) } }], usage });
  const chunk = (delta: unknown, f: string | null = null, nat: string | null = null) => ({ ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: f, native_finish_reason: nat }] });
  const events: Array<[string | null, unknown]> = [[null, chunk({ role: 'assistant', content: '' })], [null, chunk({ reasoning: REASONING, reasoning_details: [thought] })]];
  if (content) events.push([null, chunk({ content: content.slice(0, 20) })], [null, chunk({ content: content.slice(20) })]);
  if (tool) events.push([null, chunk({ tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: tool.name, arguments: args.slice(0, 10) } }] })],
    [null, chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }], reasoning_details: [signature] })]);
  events.push([null, chunk({}, finish, native)], [null, { ...head, object: 'chat.completion.chunk', choices: [], usage }], [null, '[DONE]']);
  return sse(events);
}

/** Grok Build's shell tool, and the encrypted reasoning the fake returns with each of its calls (keyed to the call). */
export const GROK_SHELL = 'run_terminal_command';
export const GROK_TOOL_TURNS = 2;
export const GROK_PROBE = (turn: number) => 'echo he-grok-probe-' + turn + '-$((6*7))';
export const grokEncrypted = (callId: string) => Buffer.from('fake-xai-encrypted-reasoning:' + callId).toString('base64');

/** The xAI routes the proxy forwards to <this>/xai: Chat Completions and Responses replies with xAI's usage (reasoning tokens
 *  beside completion tokens, cost_in_usd_ticks), and the content-filter stop for a request carrying SAFETY_MARKER. A Responses
 *  request that declares Grok Build's shell tool gets GROK_TOOL_TURNS calls of it, each after a reasoning item with
 *  encrypted_content, before the text reply; one that declares another harness's shell tool (Pi, Hermes or OpenClaw on
 *  Grok 4.7) gets one call of it the same way, so the next request shows whether the encrypted reasoning came back. */
function xaiReply(path: string, body: Record<string, any>, n: number, stream: boolean): Response {
  const model = body.model ?? 'fake';
  const safety = JSON.stringify(body).includes(SAFETY_MARKER);
  if (path.endsWith('/v1/responses')) {
    const id = 'resp_fake_xai_' + n;
    const turn = inputItems(body).filter((i) => i.type === 'function_call_output').length;
    const shell = !safety && turn < GROK_TOOL_TURNS && (Array.isArray(body.tools) ? body.tools : []).some((t: any) => t?.type === 'function' && t.name === GROK_SHELL);
    const other = !safety && !shell && turn < 1 ? shellTool(body) : null;
    const callId = 'call_fake_xai_' + n;
    const call = shell ? { name: GROK_SHELL, arguments: JSON.stringify({ command: GROK_PROBE(turn + 1), description: 'probe' }) }
      : other && !other.custom ? { name: other.name, arguments: JSON.stringify(SHELL_TOOLS[other.name]!(PROBE_COMMAND)) } : null;
    const item = call
      ? [{ type: 'reasoning', id: 'rs_fake_xai_' + n, summary: [{ type: 'summary_text', text: REASONING }], encrypted_content: grokEncrypted(callId), status: 'completed' },
        { type: 'function_call', id: 'fc_fake_xai_' + n, call_id: callId, ...call, status: 'completed' }]
      : [{ type: 'message', id: 'msg_fake_xai_' + n, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: TEXT, annotations: [] }] }];
    const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 19, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 };
    const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), model, store: false, usage,
      ...(safety ? { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] } : { status: 'completed', output: item }) };
    if (!stream) return Response.json(response);
    const items: Array<[string, unknown]> = safety ? [] : item.flatMap((it, output_index): Array<[string, unknown]> => [['response.output_item.added', { type: 'response.output_item.added', output_index, item: it }],
      ['response.output_item.done', { type: 'response.output_item.done', output_index, item: it }]]);
    const events: Array<[string, unknown]> = [['response.created', { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } }], ...items,
      [safety ? 'response.incomplete' : 'response.completed', { type: safety ? 'response.incomplete' : 'response.completed', response }]];
    return sse(events.map(([name, e], sequence_number) => [name, { ...(e as object), sequence_number }]));
  }
  const id = 'chatcmpl_fake_xai_' + n;
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 19, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 };
  const finish = safety ? 'content_filter' : 'stop';
  const content = safety ? '' : TEXT;
  if (!stream) return Response.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content, reasoning_content: REASONING } }], usage });
  const chunk = (delta: unknown, f: string | null) => ({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: f }] });
  return sse([[null, chunk({ role: 'assistant', reasoning_content: REASONING }, null)], [null, chunk({ content }, null)], [null, chunk({}, finish)], [null, { id, object: 'chat.completion.chunk', model, choices: [], usage }], [null, '[DONE]']]);
}

/** Muse Code's shell tool (inside its one namespace tool, muse), and the encrypted reasoning the fake returns with each call. */
export const MUSE_SHELL = 'bash';
export const MUSE_TOOL_TURNS = 2;
export const MUSE_PROBE = (turn: number) => 'echo he-muse-probe-' + turn + '-$((6*7))';
export const museEncrypted = (callId: string) => Buffer.from('fake-meta-encrypted-reasoning:' + callId).toString('base64');
export const MUSE_REPLAY_ERROR = 'fake upstream: a replayed function_call has no reasoning item with its encrypted_content before it';

/** A meta/ model on <this>/openrouter/v1/responses, for Muse Code (internal-task): the shape of OpenRouter's Responses API as its
 *  docs show it (no provider field, usage with cost). Muse declares its tools as one namespace tool whose tools include
 *  MUSE_SHELL; a request declaring that gets MUSE_TOOL_TURNS calls of it, each after a reasoning item with encrypted_content
 *  keyed to the call, then text. A request declaring a reminder_decision tool (Muse's reminder observers, on the cell model)
 *  gets one call of it deciding none. A replayed function_call without its reasoning item and encrypted_content is refused
 *  with a 400 so a harness that drops it fails here; whether OpenRouter refuses it the same way is not known. */
function museReply(body: Record<string, any>, n: number, stream: boolean): Response {
  const items = inputItems(body);
  const dropped = items.some((it, i) => it.type === 'function_call' && !(items[i - 1]?.type === 'reasoning' && items[i - 1].encrypted_content === museEncrypted(it.call_id)));
  if (dropped) return Response.json({ error: { code: 400, message: MUSE_REPLAY_ERROR } }, { status: 400 });
  const tools: any[] = (Array.isArray(body.tools) ? body.tools : []).flatMap((t: any) => t?.type === 'namespace' ? (t.tools ?? []).map((x: any) => ({ ...x, namespace: t.name })) : [t]);
  const outputs = items.filter((i) => i.type === 'function_call_output').length;
  const remind = tools.find((t) => /reminder_decision/.test(t?.name ?? ''));
  const shell = tools.find((t) => t?.name === MUSE_SHELL && t.namespace);
  const call = remind ? (outputs ? null : { tool: remind, args: { decision: 'none' } })
    : shell && outputs < MUSE_TOOL_TURNS ? { tool: shell, args: { command: MUSE_PROBE(outputs + 1), description: 'Print a probe line' } } : null;
  const callId = 'call_fake_meta_' + n;
  const reasoning = { type: 'reasoning', id: 'rs_fake_meta_' + n, summary: [{ type: 'summary_text', text: REASONING }], encrypted_content: museEncrypted(callId) };
  const item: Record<string, any> = call
    ? { type: 'function_call', id: 'fc_fake_meta_' + n, call_id: callId, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}), name: call.tool.name, arguments: JSON.stringify(call.args), status: 'completed' }
    : { type: 'message', id: 'msg_fake_meta_' + n, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] };
  const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 }, cost: 0.0001 };
  const response = { id: 'gen-fake-meta-' + n, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: body.model, output: [reasoning, item], usage };
  if (!stream) return Response.json(response);
  const pending = { ...response, status: 'in_progress', output: [], usage: null };
  const tail: Array<[string, Record<string, unknown>]> = call
    ? [['response.output_item.added', { output_index: 1, item: { ...item, arguments: '', status: 'in_progress' } }], ['response.function_call_arguments.delta', { item_id: item.id, output_index: 1, delta: item.arguments }],
      ['response.function_call_arguments.done', { item_id: item.id, output_index: 1, arguments: item.arguments }]]
    : [['response.output_item.added', { output_index: 1, item: { ...item, content: [], status: 'in_progress' } }], ['response.content_part.added', { item_id: item.id, output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
      ['response.output_text.delta', { item_id: item.id, output_index: 1, content_index: 0, delta: 'ok' }], ['response.output_text.done', { item_id: item.id, output_index: 1, content_index: 0, text: 'ok' }],
      ['response.content_part.done', { item_id: item.id, output_index: 1, content_index: 0, part: item.content?.[0] }]];
  const all: Array<[string, Record<string, unknown>]> = [['response.created', { response: pending }], ['response.in_progress', { response: pending }],
    ['response.output_item.added', { output_index: 0, item: { ...reasoning, summary: [] } }],
    ['response.reasoning_summary_text.delta', { item_id: reasoning.id, output_index: 0, summary_index: 0, delta: REASONING }],
    ['response.reasoning_summary_text.done', { item_id: reasoning.id, output_index: 0, summary_index: 0, text: REASONING }],
    ['response.output_item.done', { output_index: 0, item: reasoning }], ...tail, ['response.output_item.done', { output_index: 1, item }], ['response.completed', { response }]];
  return sse(all.map(([e, d], i) => [e, { type: e, sequence_number: i, ...d }]));
}

export function reply(path: string, body: Record<string, any>, n: number, opts: { toolCall?: boolean } = {}): Response {
  const model = body.model ?? 'fake';
  const stream = body.stream === true;
  if (path.endsWith('/v1/models')) return Response.json({ object: 'list', data: [] });
  if (GOOGLE_METHOD.test(path)) return googleReply(path, body, path.endsWith(':streamGenerateContent'));
  if (path.startsWith('/xai/') && (path.endsWith('/v1/chat/completions') || path.endsWith('/v1/responses'))) return xaiReply(path, body, n, stream);
  if (path.startsWith('/openrouter/') && (path.endsWith('/v1/responses') || path.endsWith('/v1/chat/completions'))) {
    const off = unpinnedReason(body);
    if (off) return Response.json(errorBody(400, 'fake upstream: ' + off), { status: 400 });
  }
  if (path.startsWith('/openrouter/') && path.endsWith('/v1/responses') && String(body.model ?? '').startsWith('meta/')) return museReply(body, n, stream);
  const tool = opts.toolCall && !hasToolResult(body) ? shellTool(body) : null;
  const called = tool ? toolReply(path, body, n, tool) : null;
  if (called) return called;
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
  if (path.startsWith('/openrouter/') && path.endsWith('/v1/chat/completions') && String(body.model ?? '').startsWith('google/')) return openrouterGeminiReply(body, n, stream);
  if (path.startsWith('/openrouter/') && path.endsWith('/v1/chat/completions')) {
    if (replayedAssistants(body).some((a) => a.tool_calls > 0 && !a.reasoning && !a.reasoning_content && !a.reasoning_details)) return Response.json(errorBody(400, DEEPSEEK_REPLAY_ERROR), { status: 400 });
    const served = OPENROUTER_MODELS[String(body.model ?? '')]?.served ?? 'DeepSeek';
    return stream ? new Response(chatStream(body, served), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(chatBody(body, served));
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
  const toolCall = argv.includes('--tool-call');
  let n = 0;
  Bun.serve({ hostname: host, port: Number(port), async fetch(req) {
    const path = new URL(req.url).pathname;
    const raw = req.method === 'POST' ? await req.text() : '';
    let body: Record<string, any> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    n += 1;
    const cred = req.headers.get('x-api-key') ?? req.headers.get('x-goog-api-key') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), n, method: req.method, ...requestFacts(path, body), credential_present: !!cred, credential_is_canary: canary ? cred === canary : null, body_sha256: createHash('sha256').update(raw).digest('hex'), ...(path.startsWith('/openrouter/') ? { replayed: replayedAssistants(body) } : {}) }) + '\n');
    if (bodies && raw) appendFileSync(bodies, JSON.stringify({ n, path, body: raw }) + '\n');
    return reply(path, body, n, { toolCall });
  } });
  console.log('fake upstream on ' + host + ':' + port + (toolCall ? ' (one shell tool call per session)' : ''));
}
