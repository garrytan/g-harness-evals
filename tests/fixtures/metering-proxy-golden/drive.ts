// internal-task (H10): one fixed sequence of requests through a lease-mode MeteringProxy against a fake upstream (fetchImpl), for
// tests/metering-proxy-route-copies.test.ts. The proxy class and BudgetRun are passed in, so the same sequence ran through
// the proxy before H10 PR 5 (origin/harn18/h10-schema at 2f3839d7) to write golden.json, and runs through today's proxy in
// the test. Keyless: placeholder keys, no network.
import { join } from 'node:path';

export const RULE = 'Before you answer any member turn, call the gbrain search tool for the request first. Fixture rule bytes.';
export const PLACEBO = 'This is a team workspace with several people. Fixture placebo bytes of no instruction at all, ok.';
export const LISTING = 'Check GBrain first, before answering any turn.';
export const TOKEN = 'trial-token:golden.0123456789abcdef';

const sse = (type: string, data: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const USAGE = { input_tokens: 1200, output_tokens: 80 };
const STREAM = [
  sse('message_start', { message: { id: 'msg_g', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 900, output_tokens: 1 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }),
  sse('content_block_stop', { index: 0 }),
  sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 900, output_tokens: 40 } }),
  sse('message_stop'),
].join('');

/** The requests, in order: label, path under /s1, credential, body. */
export function requests(): Array<[string, string, string, Record<string, unknown>]> {
  const sys = [{ type: 'text', text: 'You are a team assistant.' }, { type: 'text', text: RULE }];
  const turn1 = { role: 'user', content: [{ type: 'text', text: RULE + '\n\nWhere is the dock?' }] };
  return [
    ['messages, rule in system and the turn', '/anthropic/v1/messages', TOKEN, { model: 'claude-opus-5-5', max_tokens: 1024, system: sys, messages: [turn1] }],
    ['messages, tool follow-up', '/anthropic/v1/messages', TOKEN, { model: 'claude-opus-5-5', max_tokens: 1024, messages: [turn1, { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { path: 'SKILL.md' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'name: brain-first\n' + RULE }, { type: 'text', text: 'reminder' }] }] }],
    ['messages, streamed second turn', '/anthropic/v1/messages', TOKEN, { model: 'claude-opus-5-5', max_tokens: 1024, stream: true, system: 'skills: ' + LISTING, messages: [turn1, { role: 'assistant', content: 'Dock 38.' }, { role: 'user', content: PLACEBO + '\n\nAnd the seats?' }] }],
    ['messages, housekeeping model', '/anthropic/v1/messages', TOKEN, { model: 'claude-haiku-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'title this: ' + RULE }] }],
    ['responses, model not on the slot', '/openai/v1/responses', TOKEN, { model: 'gpt-6.1-sol', input: RULE, max_output_tokens: 256 }],
    ['messages, provider 400', '/anthropic/v1/messages', TOKEN, { model: 'claude-opus-5-5', max_tokens: 1024, messages: [{ role: 'user', content: 'too long [fx:400]' }] }],
    ['messages, upstream connection lost', '/anthropic/v1/messages', TOKEN, { model: 'claude-opus-5-5', max_tokens: 1024, messages: [{ role: 'user', content: RULE + ' [fx:fail]' }] }],
    ['messages, wrong token', '/anthropic/v1/messages', 'not-the-token', { model: 'claude-opus-5-5', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] }],
  ];
}

async function fakeUpstream(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean; messages?: unknown[] };
  const text = JSON.stringify(body.messages ?? []);
  if (text.includes('[fx:fail]')) throw new Error('fixture: connection reset by peer');
  if (text.includes('[fx:400]')) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  if (body.stream) return new Response(STREAM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  return new Response(JSON.stringify({ id: 'msg_g', type: 'message', role: 'assistant', model: String(input).includes('anthropic') ? 'claude-opus-5-5' : 'x', content: [{ type: 'text', text: 'ok' }], usage: USAGE }), { status: 200, headers: { 'content-type': 'application/json' } });
}

type ProxyCtor = new (options: Record<string, unknown>) => { start(): void; stop(): void; port: number; bind(...a: unknown[]): void; finalize(key: string): Promise<unknown> };
type RunCtor = { openLease(o: { runId: string; leaseUsd: number; ledgerPath: string; maxOutputTokens?: number | null }): unknown };

/** Run the sequence; returns the usage log and ledger paths. routes binds the slot with routes; routeTexts gives the proxy texts. */
export async function drive(Proxy: ProxyCtor, BudgetRun: RunCtor, dir: string, o: { routes?: boolean; routeTexts?: { copies: string[]; listing: string[] } } = {}): Promise<{ usageLog: string; ledgerPath: string }> {
  const ledgerPath = join(dir, 'ledger.sqlite');
  const usageLog = join(dir, 'usage.ndjson');
  const lease = BudgetRun.openLease({ runId: 'golden-run', leaseUsd: 5, ledgerPath, maxOutputTokens: 4096 });
  const proxy = new Proxy({ hostname: '127.0.0.1', port: 0, fetchImpl: fakeUpstream, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, usageLog, maxOutputTokens: 4096, ...(o.routeTexts ? { routeTexts: o.routeTexts } : {}) } });
  proxy.start();
  try {
    proxy.bind('s1', 'trial-token:golden', TOKEN, ['anthropic:claude-opus-5-5', 'anthropic:claude-haiku-5-5'], null, o.routes === true);
    for (const [, path, credential, body] of requests()) {
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/s1' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': credential }, body: JSON.stringify(body) });
      await res.text();
    }
    await proxy.finalize('trial-token:golden');
  } finally { proxy.stop(); }
  return { usageLog, ledgerPath };
}

/** The usage log and ledger as compared: each usage line with its time set to "AT"; each ledger entry without its id and times. */
export function snapshot(usageText: string, entries: Array<Record<string, unknown>>): { usage: string[]; ledger: string[] } {
  const usage = usageText.split('\n').filter(Boolean).map((l) => JSON.stringify({ ...JSON.parse(l), at: 'AT' }));
  const ledger = entries.map((e) => JSON.stringify({ run_id: e.run_id, description: e.description, reserved_usd: e.reserved_usd, actual_usd: e.actual_usd, status: e.status, input_tokens: e.input_tokens, output_tokens: e.output_tokens }));
  return { usage, ledger };
}
