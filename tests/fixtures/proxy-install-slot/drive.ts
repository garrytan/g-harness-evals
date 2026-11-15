// internal-task: one fixed mix of requests through a lease-mode MeteringProxy against a fake upstream (fetchImpl), for
// tests/proxy-install-slot.test.ts. The proxy class and BudgetRun are passed in, so the same mix ran through the proxy at
// origin/main (db705db2, before install slots) to write golden.json, and runs through today's proxy in the test, once on a
// slot bound without `install` (it must match golden.json) and once on an install slot. Keyless: placeholder keys, no network.
// Re-record golden.json from a checkout's proxy: bun tests/fixtures/proxy-install-slot/record.ts <checkout root> <out file>
import { join } from 'node:path';

export const TOKEN = 'trial-token:install.0123456789abcdef';
export const MODELS = ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol'];
export const KEY = 'trial-key:install';

const sse = (type: string, data: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const ANTHROPIC_STREAM = [
  sse('message_start', { message: { id: 'msg_i', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 900, output_tokens: 1 } } }),
  sse('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } }),
  sse('content_block_stop', { index: 0 }),
  sse('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'BODY-TEXT-answer' } }),
  sse('content_block_stop', { index: 1 }),
  sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 900, output_tokens: 40, server_tool_use: { web_search_requests: 2 } } }),
  sse('message_stop'),
].join('');
const searchCall = (id: string) => ({ type: 'web_search_call', id, status: 'completed', action: { type: 'search', query: 'BODY-TEXT-query' } });
const RESPONSE_OUTPUT = [searchCall('ws_1'), searchCall('ws_2'), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'BODY-TEXT-answer' }] }];
const RESPONSE_USAGE = { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } };
const RESPONSES_STREAM = [
  sse('response.created', { sequence_number: 0, response: { id: 'resp_i', status: 'in_progress', output: [] } }),
  sse('response.output_item.done', { sequence_number: 1, output_index: 0, item: searchCall('ws_3') }),
  sse('response.completed', { sequence_number: 2, response: { id: 'resp_i', status: 'completed', output: [searchCall('ws_3'), RESPONSE_OUTPUT[2]], usage: RESPONSE_USAGE } }),
].join('');

const DOCTOR_UA = 'gbrain/0.60.717 doctor\t(key sk-proj-abcdefgh)';
const CLAUDE_UA = 'claude-cli/2.0.1 (external, sdk-ts)';

/** The requests, in order: label, method, path under /i1, credential (null: none), user agent, body (undefined for a GET). */
export function requests(): Array<[string, string, string, string | null, string, Record<string, unknown> | undefined]> {
  const user = [{ role: 'user', content: 'BODY-TEXT-question' }];
  return [
    ['messages, plain', 'POST', '/anthropic/v1/messages', TOKEN, CLAUDE_UA, { model: 'claude-opus-5-5', max_tokens: 1024, messages: user }],
    ['messages, streamed with web search', 'POST', '/anthropic/v1/messages', TOKEN, CLAUDE_UA, { model: 'claude-opus-5-5', max_tokens: 1024, stream: true, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: user }],
    ['messages, web fetch', 'POST', '/anthropic/v1/messages', TOKEN, CLAUDE_UA, { model: 'claude-opus-5-5', max_tokens: 1024, tools: [{ type: 'web_fetch_20250910', name: 'web_fetch' }], messages: [{ role: 'user', content: 'BODY-TEXT-fetch [fx:fetch]' }] }],
    ['responses, web search', 'POST', '/openai/v1/responses', TOKEN, 'codex_cli_rs/0.60.0', { model: 'gpt-6.1-sol', max_output_tokens: 2048, tools: [{ type: 'web_search' }], input: 'BODY-TEXT-question' }],
    ['responses, streamed web search', 'POST', '/openai/v1/responses', TOKEN, 'codex_cli_rs/0.60.0', { model: 'gpt-6.1-sol', max_output_tokens: 2048, stream: true, tools: [{ type: 'web_search' }], input: 'BODY-TEXT-question' }],
    ['responses, web search preview', 'POST', '/openai/v1/responses', TOKEN, 'codex_cli_rs/0.60.0', { model: 'gpt-6.1-sol', max_output_tokens: 2048, tools: [{ type: 'web_search_preview' }], input: 'BODY-TEXT-question' }],
    ['chat completions, web_search_options', 'POST', '/openai/v1/chat/completions', TOKEN, 'hermes/1.0', { model: 'gpt-6.1-sol', max_completion_tokens: 512, web_search_options: {}, messages: user }],
    ['models list, token', 'GET', '/openai/v1/models', TOKEN, 'hermes/1.0', undefined],
    ['models read, token', 'GET', '/openai/v1/models/gpt-6.1-sol', TOKEN, 'hermes/1.0', undefined],
    ['models list, no credential', 'GET', '/openai/v1/models', null, DOCTOR_UA, undefined],
    ['models list, wrong credential, the token in the user agent', 'GET', '/openai/v1/models', 'sk-not-the-token', `gbrain/0.60.717 ${TOKEN}`, undefined],
    ['embeddings, token', 'POST', '/openai/v1/embeddings', TOKEN, DOCTOR_UA, { model: 'text-embedding-3-small', input: ['BODY-TEXT-embed'] }],
    ['messages, model not on the slot', 'POST', '/anthropic/v1/messages', TOKEN, CLAUDE_UA, { model: 'claude-haiku-5-5', max_tokens: 64, messages: user }],
    ['messages, no credential', 'POST', '/anthropic/v1/messages', null, DOCTOR_UA, { model: 'claude-opus-5-5', max_tokens: 64, messages: user }],
    ['count_tokens, token', 'POST', '/anthropic/v1/messages/count_tokens', TOKEN, CLAUDE_UA, { model: 'claude-opus-5-5', messages: user }],
    ['files, token', 'GET', '/openai/v1/files', TOKEN, 'hermes/1.0', undefined],
    ['messages, upstream connection lost', 'POST', '/anthropic/v1/messages', TOKEN, CLAUDE_UA, { model: 'claude-opus-5-5', max_tokens: 1024, messages: [{ role: 'user', content: 'BODY-TEXT [fx:fail]' }] }],
  ];
}

async function fakeUpstream(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  if ((init?.method ?? 'GET') === 'GET') return json(url.endsWith('/v1/models') ? { object: 'list', data: [{ id: 'gpt-6.1-sol', object: 'model' }] } : { id: 'gpt-6.1-sol', object: 'model' });
  const raw = String(init?.body ?? '{}');
  if (raw.includes('[fx:fail]')) throw new Error('fixture: connection reset by peer');
  const body = JSON.parse(raw) as { stream?: boolean };
  if (url.includes('/v1/embeddings')) return json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 4, total_tokens: 4 } });
  if (url.includes('/v1/responses')) {
    if (body.stream) return new Response(RESPONSES_STREAM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return json({ id: 'resp_i', object: 'response', status: 'completed', model: 'gpt-6.1-sol', output: RESPONSE_OUTPUT, usage: RESPONSE_USAGE });
  }
  if (url.includes('/v1/chat/completions')) return json({ id: 'cc_i', object: 'chat.completion', model: 'gpt-6.1-sol', choices: [{ index: 0, message: { role: 'assistant', content: 'BODY-TEXT-answer' } }], usage: { prompt_tokens: 300, completion_tokens: 20 } });
  if (body.stream) return new Response(ANTHROPIC_STREAM, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const fetchTool = raw.includes('[fx:fetch]') ? { server_tool_use: { web_fetch_requests: 1 } } : {};
  return json({ id: 'msg_i', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'BODY-TEXT-answer' }], usage: { input_tokens: 1200, output_tokens: 80, ...fetchTool } });
}

type ProxyCtor = new (options: Record<string, unknown>) => { start(): void; stop(): void; port: number; bind(...a: unknown[]): void; finalize(key: string): Promise<unknown> };
type RunCtor = { openLease(o: { runId: string; leaseUsd: number; ledgerPath: string; maxOutputTokens?: number | null }): unknown };

/** Run the mix; returns the usage log and ledger paths and each answer's status and body. `install` binds the slot as an install slot. */
export async function drive(Proxy: ProxyCtor, BudgetRun: RunCtor, dir: string, o: { install?: boolean } = {}): Promise<{ usageLog: string; ledgerPath: string; answers: string[] }> {
  const ledgerPath = join(dir, 'ledger.sqlite');
  const usageLog = join(dir, 'usage.ndjson');
  const lease = BudgetRun.openLease({ runId: 'install-run', leaseUsd: 5, ledgerPath, maxOutputTokens: 4096 });
  const proxy = new Proxy({ hostname: '127.0.0.1', port: 0, fetchImpl: fakeUpstream, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, usageLog, maxOutputTokens: 4096 } });
  proxy.start();
  const answers: string[] = [];
  try {
    proxy.bind('i1', KEY, TOKEN, MODELS, null, false, {}, null, ...(o.install ? [true] : []));
    for (const [, method, path, credential, ua, body] of requests()) {
      const headers: Record<string, string> = { 'user-agent': ua, ...(body ? { 'content-type': 'application/json' } : {}), ...(credential ? { authorization: `Bearer ${credential}` } : {}) };
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/i1' + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      answers.push(`${res.status} ${await res.text()}`);
    }
    await proxy.finalize(KEY);
  } finally { proxy.stop(); }
  return { usageLog, ledgerPath, answers };
}
