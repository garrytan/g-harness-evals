#!/usr/bin/env bun
// A keyless fake of OpenRouter's Chat Completions endpoint for DeepSeek V4.1 Flash 1017, shared by
// tests/openrouter-route.test.ts (the metering proxy's openrouter route) and tests/openrouter-branch.test.ts (the OpenClaw
// and Hermes configs on an OpenRouter cell). It answers POST <any prefix>/v1/chat/completions the way openrouter.ai does
// (openrouter.ai/docs: usage accounting, reasoning tokens): a generation id gen-..., the serving provider's name in a
// top-level provider field (DeepSeek, or the one named by --served), the model echoed as requested, the reasoning as
// reasoning and reasoning_details [{type: "reasoning.text"}] beside the content, and usage with
// prompt_tokens_details.cached_tokens, completion_tokens_details.reasoning_tokens and OpenRouter's own cost in USD.
// A stream sends the same top-level fields on every chunk and ends with a usage chunk, then [DONE].
//
// Tool calls, as DeepSeek thinking mode needs them: a request that declares tools and whose last message is not a tool
// result gets one call of its first tool (finish_reason tool_calls); once the tool result is back the answer is "ok".
// DeepSeek refuses a thinking-mode request whose earlier assistant tool-call turn carries no reasoning ("The
// reasoning_content in the thinking mode must be passed back to the API"), and so does this fake, with OpenRouter's error
// shape, so a harness that drops the reasoning on replay fails here as it would upstream. With --fail <status>:<message>
// every chat request gets that status and OpenRouter's error body.
//
// Every request is recorded to an ndjson file: method, path, model, stream and include_usage, both output-cap fields, the
// provider routing object and the reasoning fields as sent, the tool count, which reasoning fields each earlier assistant
// message carried, and whether the credential was the placeholder it was started with (never the credential itself).
// It binds the address it is given and holds no credential.
//
//   bun tests/fixtures/openrouter/fake-openrouter.ts --host 127.0.0.1 --port 0 --log requests.ndjson --expect-key placeholder-openrouter [--served Chutes] [--fail 429:rate_limited]
//
// It prints "listening <port>" on stdout once it is up.
import { appendFileSync } from 'node:fs';

/** Which reasoning fields one earlier assistant message carried when the request replayed it. */
export interface ReplayedAssistant { tool_calls: number; reasoning: boolean; reasoning_content: boolean; reasoning_details: boolean }
export interface FakeOpenRouterRequest {
  method: string; path: string; model: string | null; stream: boolean; include_usage: boolean;
  max_completion_tokens: number | null; max_tokens: number | null; provider: unknown; reasoning: unknown; reasoning_effort: unknown;
  tools: number; assistants: ReplayedAssistant[]; credential: 'expected' | 'other' | 'none';
}

/** Tokens the fake reports: 40 prompt tokens (32 of them cached), 20 reasoning tokens and 5 answer tokens. */
export const FAKE_USAGE = { prompt: 40, cached: 32, reasoning: 20, answer: 5 } as const;
/** The cost OpenRouter reports for FAKE_USAGE: DeepSeek's off-peak rates, half the peak row ($0.15 input, $0.003 cache hits,
 *  $0.60 output per million), what a request in a discount window is billed. */
export const FAKE_COST_USD = ((FAKE_USAGE.prompt - FAKE_USAGE.cached) * 0.15 + FAKE_USAGE.cached * 0.003 + (FAKE_USAGE.reasoning + FAKE_USAGE.answer) * 0.6) / 1e6;
export const REASONING = 'The user wants a short answer.';
export const DEEPSEEK_REPLAY_ERROR = 'The reasoning_content in the thinking mode must be passed back to the API.';
let generation = 0;

type Message = { role?: unknown; content?: unknown; tool_calls?: unknown; reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
const nonEmpty = (v: unknown) => (typeof v === 'string' && v.trim().length > 0) || (Array.isArray(v) && v.length > 0);

/** The earlier assistant messages of a request and the reasoning each carried. */
export function replayedAssistants(body: Record<string, unknown>): ReplayedAssistant[] {
  const messages = Array.isArray(body.messages) ? body.messages as Message[] : [];
  return messages.filter((m) => m?.role === 'assistant').map((m) => ({
    tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0,
    reasoning: nonEmpty(m.reasoning), reasoning_content: nonEmpty(m.reasoning_content), reasoning_details: nonEmpty(m.reasoning_details),
  }));
}

/** What the model does next: call the first declared tool, or answer once a tool result came back (or no tool is declared). */
function nextCall(body: Record<string, unknown>): { id: string; name: string } | null {
  const messages = Array.isArray(body.messages) ? body.messages as Message[] : [];
  const tools = Array.isArray(body.tools) ? body.tools as Array<{ function?: { name?: unknown } }> : [];
  const name = tools[0]?.function?.name;
  return typeof name === 'string' && messages.at(-1)?.role !== 'tool' ? { id: 'call_fake_1', name } : null;
}

const usage = () => ({
  prompt_tokens: FAKE_USAGE.prompt, completion_tokens: FAKE_USAGE.reasoning + FAKE_USAGE.answer, total_tokens: FAKE_USAGE.prompt + FAKE_USAGE.reasoning + FAKE_USAGE.answer,
  prompt_tokens_details: { cached_tokens: FAKE_USAGE.cached }, completion_tokens_details: { reasoning_tokens: FAKE_USAGE.reasoning },
  cost: FAKE_COST_USD, is_byok: false,
});
const details = () => [{ type: 'reasoning.text', text: REASONING, format: 'unknown', index: 0 }];

/** The non-streamed Chat Completions body. */
export function chatBody(body: Record<string, unknown>, served = 'DeepSeek'): Record<string, unknown> {
  const call = nextCall(body);
  const message = call
    ? { role: 'assistant', content: '', reasoning: REASONING, reasoning_details: details(), tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: '{}' } }] }
    : { role: 'assistant', content: 'ok', reasoning: REASONING, reasoning_details: details() };
  return {
    id: 'gen-fake-' + ++generation, provider: served, model: String(body.model ?? 'unknown'), object: 'chat.completion', created: 1_792_300_000,
    choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop', native_finish_reason: call ? 'tool_calls' : 'stop' }],
    usage: usage(),
  };
}

/** The SSE stream: a reasoning delta, then content or a tool call, the finish chunk, the usage chunk, [DONE]. */
export function chatStream(body: Record<string, unknown>, served = 'DeepSeek'): string {
  const call = nextCall(body);
  const base = { id: 'gen-fake-' + ++generation, provider: served, model: String(body.model ?? 'unknown'), object: 'chat.completion.chunk', created: 1_792_300_000 };
  const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish, native_finish_reason: finish }] });
  const chunks: Array<Record<string, unknown>> = [
    delta({ role: 'assistant', content: '' }),
    delta({ reasoning: REASONING, reasoning_details: details() }),
    call ? delta({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: '{}' } }] }) : delta({ content: 'ok' }),
    delta({}, call ? 'tool_calls' : 'stop'),
    { ...base, choices: [], usage: usage() },
  ];
  return chunks.map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
}

/** OpenRouter's error body: a numeric code and the message, with the upstream provider in metadata. */
export function errorBody(status: number, message: string): Record<string, unknown> {
  return { error: { code: status, message, metadata: { provider_name: 'DeepSeek' } } };
}

export function startFakeOpenRouter(o: { host: string; port: number; log: string; expectKey: string; served?: string; fail?: { status: number; message: string } }): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: o.host, port: o.port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      let body: Record<string, any> = {};
      try { body = JSON.parse(await req.text() || '{}'); } catch {}
      const auth = req.headers.get('authorization') ?? '';
      const assistants = replayedAssistants(body);
      const record: FakeOpenRouterRequest = {
        method: req.method, path, model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true, include_usage: body.stream_options?.include_usage === true,
        max_completion_tokens: typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : null, max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
        provider: body.provider ?? null, reasoning: body.reasoning ?? null, reasoning_effort: body.reasoning_effort ?? null,
        tools: Array.isArray(body.tools) ? body.tools.length : 0, assistants,
        credential: !auth ? 'none' : auth === 'Bearer ' + o.expectKey ? 'expected' : 'other',
      };
      appendFileSync(o.log, JSON.stringify(record) + '\n');
      if (req.method === 'POST' && path.endsWith('/v1/chat/completions')) {
        if (o.fail) return Response.json(errorBody(o.fail.status, o.fail.message), { status: o.fail.status });
        if (assistants.some((a) => a.tool_calls > 0 && !a.reasoning && !a.reasoning_content && !a.reasoning_details)) return Response.json(errorBody(400, DEEPSEEK_REPLAY_ERROR), { status: 400 });
        return record.stream ? new Response(chatStream(body, o.served), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(chatBody(body, o.served));
      }
      return Response.json({ error: { code: 404, message: 'no route ' + req.method + ' ' + path } }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const fail = one('--fail');
  const server = startFakeOpenRouter({ host: one('--host') ?? '127.0.0.1', port: Number(one('--port') ?? 0), log: one('--log') ?? 'fake-openrouter.ndjson', expectKey: one('--expect-key') ?? 'placeholder-openrouter',
    ...(one('--served') ? { served: one('--served') } : {}), ...(fail ? { fail: { status: Number(fail.slice(0, fail.indexOf(':'))), message: fail.slice(fail.indexOf(':') + 1) } } : {}) });
  console.log('listening ' + server.port);
}
