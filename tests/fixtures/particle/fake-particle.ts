#!/usr/bin/env bun
// A keyless fake of Particle's Chat Completions endpoint (internal-task), shared by tests/particle-branch.test.ts (the harness
// adapters on a Particle cell) and tests/particle-route.test.ts (the metering proxy's particle route). It answers
// POST <any prefix>/v1/chat/completions the way api.particle.ai does (docs.particle.ai/reasoning): the response echoes the
// model as particle-ai/<requested id>, the answer carries reasoning_content before content, and usage is OpenAI-shaped
// (prompt_tokens, prompt_tokens_details.cached_tokens, completion_tokens with the reasoning tokens inside it, repeated as
// completion_tokens_details.reasoning_tokens and a top-level reasoning_tokens, as the live API answered on 2026-10-31).
// A stream carries a usage chunk only when the request sets stream_options.include_usage. A request whose output cap is
// below what the reasoning needs gets empty content with finish_reason "length". POST <prefix>/v1/responses answers 405
// (Particle serves Responses over WebSocket only) and any other route 404. With --fail <status>:<code> every chat request
// is answered with that status and Particle's error body for it, the code in its own field (docs.particle.ai/errors),
// for the adapters' error mapping. Every request is recorded to an ndjson file (method, path, model, stream flag,
// include_usage, both output-cap fields, reasoning_effort, the tool count and whether the credential was the placeholder
// it was started with, never the credential itself). It binds the address it is given and holds no credential.
//
//   bun tests/fixtures/particle/fake-particle.ts --host 127.0.0.1 --port 0 --log requests.ndjson --expect-key placeholder-particle [--fail 400:invalid_value]
//
// It prints "listening <port>" on stdout once it is up.
import { appendFileSync } from 'node:fs';

export interface FakeParticleRequest {
  method: string; path: string; model: string | null; stream: boolean; include_usage: boolean;
  max_completion_tokens: number | null; max_tokens: number | null; reasoning_effort: unknown; tools: number; credential: 'expected' | 'other' | 'none';
}
export type ParticleRequest = FakeParticleRequest;

/** Tokens the fake reports: 40 prompt tokens (32 of them cached), 20 reasoning tokens and 5 answer tokens. */
export const FAKE_USAGE = { prompt: 40, cached: 32, reasoning: 20, answer: 5 } as const;
const REASONING = ['The user wants ', 'a short answer. '];

/** The output cap a request states, or null. */
const capOf = (body: Record<string, unknown>) => (typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : typeof body.max_tokens === 'number' ? body.max_tokens : null);

/** Usage and answer for a request: a cap below the reasoning plus answer spends it all on reasoning and returns no content. */
function answer(body: Record<string, unknown>) {
  const cap = capOf(body);
  const full = FAKE_USAGE.reasoning + FAKE_USAGE.answer;
  const cut = cap !== null && cap < full;
  const completion = cut ? cap : full;
  return {
    content: cut ? '' : 'ok',
    finish: cut ? 'length' : 'stop',
    usage: {
      prompt_tokens: FAKE_USAGE.prompt, completion_tokens: completion, total_tokens: FAKE_USAGE.prompt + completion,
      prompt_tokens_details: { cached_tokens: FAKE_USAGE.cached }, completion_tokens_details: { reasoning_tokens: cut ? cap : FAKE_USAGE.reasoning },
      reasoning_tokens: cut ? cap : FAKE_USAGE.reasoning,
    },
  };
}

export const echoed = (model: string) => `particle-ai/${model}`;

/** The non-streamed Chat Completions body. */
export function chatBody(body: Record<string, unknown>): Record<string, unknown> {
  const a = answer(body);
  return {
    id: 'chatcmpl-particle-fake-1', object: 'chat.completion', created: 1_790_000_000, model: echoed(String(body.model ?? 'unknown')),
    choices: [{ index: 0, message: { role: 'assistant', content: a.content, reasoning_content: REASONING.join('') }, finish_reason: a.finish }],
    usage: a.usage,
  };
}

/** The Chat Completions SSE stream: reasoning_content deltas, then content, the finish chunk, a usage chunk when asked, [DONE]. */
export function chatStream(body: Record<string, unknown>): string {
  const a = answer(body);
  const base = { id: 'chatcmpl-particle-fake-1', object: 'chat.completion.chunk', created: 1_790_000_000, model: echoed(String(body.model ?? 'unknown')) };
  const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });
  const chunks: Array<Record<string, unknown>> = [
    delta({ role: 'assistant', content: '' }),
    ...REASONING.map(r => delta({ reasoning_content: r })),
    ...(a.content ? [delta({ content: a.content })] : []),
    delta({}, a.finish),
  ];
  if ((body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true) chunks.push({ ...base, choices: [], usage: a.usage });
  return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** The error body Particle's gateway sends for a refused request: OpenAI's shape (docs.particle.ai/errors), the code in its
 *  own field and not in the message. */
export function errorBody(status: number, code: string): Record<string, unknown> {
  if (status === 402) return { error: { message: 'Your credit balance is empty. Add credits to continue.', type: 'insufficient_credits_error', code } };
  if (status === 429) return { error: { message: 'Rate limit exceeded: the serving fleet is at capacity', type: 'rate_limit_error', code } };
  return { error: { message: "Invalid value for 'reasoning_effort'", type: 'invalid_request_error', param: 'reasoning_effort', code } };
}

export function startFakeParticle(o: { host: string; port: number; log: string; expectKey: string; fail?: { status: number; code: string } }): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: o.host, port: o.port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      let body: Record<string, any> = {};
      try { body = JSON.parse(await req.text() || '{}'); } catch {}
      const auth = req.headers.get('authorization') ?? '';
      const record: FakeParticleRequest = {
        method: req.method, path, model: typeof body.model === 'string' ? body.model : null, stream: body.stream === true, include_usage: body.stream_options?.include_usage === true,
        max_completion_tokens: typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : null, max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
        reasoning_effort: body.reasoning_effort ?? null, tools: Array.isArray(body.tools) ? body.tools.length : 0,
        credential: !auth ? 'none' : auth === 'Bearer ' + o.expectKey ? 'expected' : 'other',
      };
      appendFileSync(o.log, JSON.stringify(record) + '\n');
      if (req.method === 'POST' && path.endsWith('/v1/chat/completions')) {
        if (o.fail) return Response.json(errorBody(o.fail.status, o.fail.code), { status: o.fail.status, headers: o.fail.status === 429 ? { 'retry-after': '1' } : {} });
        return record.stream ? new Response(chatStream(body), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(chatBody(body));
      }
      if (path.endsWith('/v1/responses')) return Response.json({ error: { message: 'Method Not Allowed', type: 'invalid_request_error' } }, { status: 405 });
      return Response.json({ error: { message: `no route ${req.method} ${path}`, type: 'invalid_request_error', code: 'not_found' } }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const fail = one('--fail')?.split(':');
  const server = startFakeParticle({ host: one('--host') ?? '127.0.0.1', port: Number(one('--port') ?? 0), log: one('--log') ?? 'fake-particle.ndjson', expectKey: one('--expect-key') ?? 'placeholder-particle',
    ...(fail ? { fail: { status: Number(fail[0]), code: fail[1] } } : {}) });
  console.log(`listening ${server.port}`);
}
