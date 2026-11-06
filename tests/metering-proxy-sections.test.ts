// internal-task: the metering proxy's usage-line schema v1. With --log-sections off and on, every scenario forwards the same
// bytes, answers the client the same bytes, settles the same ledger entries, charges the same meter and writes the same
// existing usage-line fields; the flag only adds sections and tools_called (or sections_error) to forwarded chat lines,
// and every forwarded line carries cache_write_tokens, cache_write_1h_tokens and reasoning_tokens. Keyless: the upstream
// is a fake fetch and every key is a placeholder.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus, readLedger } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, parseProxyArgs, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { UNLISTED_TOOL } from '../runner/proxy/sections.ts';

const tmp = mkdtempSync(join(tmpdir(), 'proxy-sections-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const FAKE_ENV = { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic', VOYAGE_API_KEY: 'placeholder-voyage' };
const NEW_FIELDS = ['cache_write_tokens', 'cache_write_1h_tokens', 'reasoning_tokens'];
const FLAG_FIELDS = ['sections', 'tools_called', 'sections_error'];
let n = 0;

const ev = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
const sseResponse = (text: string) => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const TOOLS = [{ name: 'search_docs', description: 'DESC-search', input_schema: { type: 'object' } }];
const anthropicBody = (extra: Record<string, unknown> = {}) => ({ model: 'claude-haiku-5-5', max_tokens: 200, system: 'SYSTEM-fixture', tools: TOOLS,
  messages: [{ role: 'user', content: 'USER-question' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_docs', input: { q: 'Q-x' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'RESULT-y' }] }], ...extra });
const ANTHROPIC_USAGE = { input_tokens: 120, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } };
const RESP_USAGE = { input_tokens: 4000, input_tokens_details: { cached_tokens: 3000 }, output_tokens: 90, output_tokens_details: { reasoning_tokens: 70 } };
const CHAT_USAGE = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 9 } };
const R_TOOLS = [{ type: 'function', name: 'run_shell', parameters: { type: 'object' } }];
const C_TOOLS = [{ type: 'function', function: { name: 'lookup', parameters: {} } }];
const responsesBody = (extra: Record<string, unknown> = {}) => ({ model: 'gpt-6-luna', instructions: 'INSTR-x', tools: R_TOOLS, input: [{ role: 'user', content: 'USER-run' }, { type: 'reasoning', encrypted_content: 'ENC-x', summary: [] }], ...extra });
const chatBody = (extra: Record<string, unknown> = {}) => ({ model: 'gpt-4.1-mini', tools: C_TOOLS, messages: [{ role: 'system', content: 'SYS-x' }, { role: 'user', content: 'USER-q' }], ...extra });

interface Scenario { name: string; path: string; raw: string; respond: () => Response; chat?: boolean }
const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const truncated = (head: string) => () => {
  let pulls = 0;
  return new Response(new ReadableStream({ async pull(c) { if (pulls++ === 0) return c.enqueue(new TextEncoder().encode(head)); await Bun.sleep(30); c.error(new Error('connection reset by fixture')); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
const S = (name: string, path: string, body: unknown, respond: () => Response, chat = true): Scenario => ({ name, path, raw: typeof body === 'string' ? body : JSON.stringify(body), respond, chat });
const SCENARIOS: Scenario[] = [
  S('anthropic json with a declared and an undeclared tool', '/c/anthropic/v1/messages', anthropicBody(), json({ content: [{ type: 'tool_use', id: 'a', name: 'search_docs', input: {} }, { type: 'tool_use', id: 'b', name: 'SECRET-hallucinated', input: {} }], usage: { ...ANTHROPIC_USAGE, output_tokens: 50 } })),
  S('anthropic stream', '/c/anthropic/v1/messages', anthropicBody({ stream: true }), () => sseResponse([
    ev({ type: 'message_start', message: { usage: { ...ANTHROPIC_USAGE, output_tokens: 1 } } }), ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'search_docs', input: {} } }),
    ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { ...ANTHROPIC_USAGE, output_tokens: 350 } }), ev({ type: 'message_stop' })].join(''))),
  S('responses json', '/c/openai/v1/responses', responsesBody(), json({ output: [{ type: 'function_call', name: 'run_shell', arguments: '{}' }], usage: RESP_USAGE })),
  S('responses stream', '/c/openai/v1/responses', responsesBody({ stream: true }), () => sseResponse([
    ev({ type: 'response.output_item.added', item: { type: 'function_call', name: 'run_shell' } }), ev({ type: 'response.completed', response: { status: 'completed', output: [], usage: RESP_USAGE } })].join(''))),
  S('chat json', '/c/openai/v1/chat/completions', chatBody(), json({ choices: [{ message: { tool_calls: [{ function: { name: 'lookup', arguments: '{}' } }] } }], usage: CHAT_USAGE })),
  S('chat stream (the proxy adds stream_options and an output cap after the sections are read)', '/c/openai/v1/chat/completions', chatBody({ stream: true }), () => sseResponse([
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '' } }] } }] }), ev({ choices: [], usage: CHAT_USAGE }), 'data: [DONE]\n\n'].join(''))),
  S('a 200 that is not JSON', '/c/anthropic/v1/messages', anthropicBody(), () => new Response('<html>not json</html>', { status: 200 })),
  S('a JSON answer without usage', '/c/openai/v1/responses', responsesBody(), json({ output: [] })),
  S('a stream truncated before its final usage', '/c/anthropic/v1/messages', anthropicBody({ stream: true }), truncated(ev({ type: 'message_start', message: { usage: { ...ANTHROPIC_USAGE, output_tokens: 1 } } }))),
  S('a stream that carries no usage', '/c/openai/v1/chat/completions', chatBody({ stream: true }), () => sseResponse(ev({ choices: [{ delta: { content: 'x' } }] }) + 'data: [DONE]\n\n')),
  S('a 4xx without usage', '/c/openai/v1/chat/completions', chatBody(), json({ error: { message: 'bad request' } }, 400)),
  S('a 5xx not-billed envelope', '/c/anthropic/v1/messages', anthropicBody(), json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529)),
  S('a body whose sections cannot be partitioned', '/c/anthropic/v1/messages',
    '{"model":"claude-haiku-5-5","max_tokens":10,"messages":[{"role":"user","content":[{"type":"text","text":"","pad":[' + Array(300).fill('1e300').join(',') + ']}]}]}', json({ content: [], usage: { input_tokens: 5, output_tokens: 1 } })),
  S('an embeddings call (no section reader)', '/c/openai/v1/embeddings', { model: 'text-embedding-3-small', input: 'EMBED-x' }, json({ data: [], usage: { prompt_tokens: 3, total_tokens: 3 } }), false),
];

async function drive(s: Scenario, logSections: boolean) {
  const lease = BudgetRun.openLease({ runId: `sections-${++n}`, leaseUsd: 5, ledgerPath: join(tmp, `lease-${n}.sqlite`) });
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const forwarded: string[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => { forwarded.push(String(init?.body)); return s.respond(); }) as unknown as typeof fetch;
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: FAKE_ENV, usageLog, logSections } });
  proxy.start();
  proxy.bind('c', 'slot:c');
  try {
    const client = await fetch(`http://127.0.0.1:${proxy.port}${s.path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: s.raw })
      .then(async (res) => ({ status: res.status, text: await res.text().catch(() => 'the client body failed') }), () => ({ status: 0, text: 'the client connection failed' }));
    const meter = await proxy.finalize('slot:c', 5000);
    const ledger = readLedger(lease.ledgerPath).entries.map(({ description, reserved_usd, actual_usd, status, input_tokens, output_tokens }) => ({ description, reserved_usd, actual_usd, status, input_tokens, output_tokens }));
    const committed = ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd;
    const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as UsageLine & Record<string, unknown>);
    return { forwarded, client, meter, ledger, committed, lines, status: proxy.status() };
  } finally { proxy.stop(); }
}

const without = (line: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(line).filter(([k]) => k !== 'at' && !keys.includes(k)));

describe('--log-sections changes nothing that is forwarded, settled or charged', () => {
  beforeEach(() => closeLedgers());
  for (const s of SCENARIOS) {
    test(s.name, async () => {
      const off = await drive(s, false);
      const on = await drive(s, true);
      expect(on.forwarded).toEqual(off.forwarded);
      expect(on.client).toEqual(off.client);
      expect(on.meter).toEqual(off.meter);
      expect(on.ledger).toEqual(off.ledger);
      expect(on.committed).toBe(off.committed);
      expect(on.lines).toHaveLength(1);
      expect(off.lines).toHaveLength(1);
      const [a, b] = [off.lines[0]!, on.lines[0]!];
      expect(without(b, FLAG_FIELDS)).toEqual(without(a, []));
      for (const k of FLAG_FIELDS) expect(k in a).toBe(false);
      if (a.outcome === 'forwarded') for (const k of NEW_FIELDS) { expect(typeof a[k]).toBe('number'); expect(b[k]).toBe(a[k]); }
      expect([off.status.log_sections, on.status.log_sections]).toEqual([false, true]);
      if (!s.chat) for (const k of FLAG_FIELDS) expect(k in b).toBe(false);
      else if (s.name.startsWith('a body whose sections')) {
        expect(b.sections_error).toContain('request sections: the sections re-serialize to');
        expect('sections' in b || 'tools_called' in b).toBe(false);
      } else {
        expect(b.sections!.v).toBe(1);
        expect(b.sections!.body_bytes).toBe(Buffer.byteLength(s.raw));
        expect(Array.isArray(b.tools_called)).toBe(true);
        expect('sections_error' in b).toBe(false);
      }
    });
  }
});

describe('the usage-line schema v1 fields', () => {
  beforeEach(() => closeLedgers());
  test('Anthropic: cache writes and the 1-hour part on every line; tools_called names declared tools and hides an undeclared one', async () => {
    const off = await drive(SCENARIOS[0]!, false);
    expect(Object.keys(off.lines[0]!).sort()).toEqual(['at', 'key', 'provider', 'route', 'model', 'outcome', 'status', 'reserved_usd', 'actual_usd', 'input_tokens', 'output_tokens', 'cached_tokens', 'charged_reservation', 'streamed', ...NEW_FIELDS].sort());
    expect(off.lines[0]).toMatchObject({ cache_write_tokens: 2000, cache_write_1h_tokens: 1500, reasoning_tokens: 0 });
    const on = await drive(SCENARIOS[0]!, true);
    expect(on.lines[0]!.tools_called).toEqual(['search_docs', UNLISTED_TOOL]);
    expect(on.lines[0]!.sections!.tools_declared).toEqual([{ name: 'search_docs', bytes: Buffer.byteLength(JSON.stringify(TOOLS[0])) }]);
    expect(on.lines[0]!.sections!.tool_results).toHaveLength(1);
    expect(JSON.stringify(on.lines[0])).not.toContain('SECRET-hallucinated');
    expect(JSON.stringify(on.lines[0])).not.toContain('RESULT-y');
    const stream = await drive(SCENARIOS[1]!, true);
    expect(stream.lines[0]).toMatchObject({ streamed: true, cache_write_tokens: 2000, cache_write_1h_tokens: 1500, reasoning_tokens: 0, tools_called: ['search_docs'] });
  });
  test('OpenAI: reasoning tokens from the details, and the sections of a streamed chat request are the body as the client sent it', async () => {
    expect((await drive(SCENARIOS[2]!, false)).lines[0]).toMatchObject({ reasoning_tokens: 70, cache_write_tokens: 0, cache_write_1h_tokens: 0 });
    expect((await drive(SCENARIOS[3]!, true)).lines[0]).toMatchObject({ streamed: true, reasoning_tokens: 70, tools_called: ['run_shell'] });
    const chat = await drive(SCENARIOS[5]!, true);
    expect(chat.lines[0]).toMatchObject({ reasoning_tokens: 9, tools_called: ['lookup'] });
    expect(chat.lines[0]!.sections!.body_bytes).toBe(Buffer.byteLength(SCENARIOS[5]!.raw));
    expect(Buffer.byteLength(chat.forwarded[0]!)).not.toBe(Buffer.byteLength(SCENARIOS[5]!.raw));
    expect(JSON.parse(chat.forwarded[0]!).stream_options).toEqual({ include_usage: true });
  });
  test('a truncated stream, a body that is not JSON and a missing usage write zeros, never an error', async () => {
    for (const i of [6, 7, 8]) expect((await drive(SCENARIOS[i]!, true)).lines[0]).toMatchObject({ outcome: 'forwarded', cache_write_tokens: i === 8 ? 2000 : 0, reasoning_tokens: 0, tools_called: [] });
  });
  test('the free count_tokens line carries zeros and no sections; refused and failed lines carry none of the new fields', async () => {
    const lease = BudgetRun.openLease({ runId: 'sections-count', leaseUsd: 1, ledgerPath: join(tmp, 'count.sqlite') });
    const usageLog = join(tmp, 'count.ndjson');
    let fail = false;
    const fetchImpl = (async () => { if (fail) throw new Error('connect refused by fixture'); return Response.json({ input_tokens: 12 }); }) as unknown as typeof fetch;
    const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: FAKE_ENV, usageLog, freeCountTokens: true, logSections: true } });
    proxy.start();
    proxy.bind('c', 'slot:c');
    try {
      const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${proxy.port}${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect((await post('/c/anthropic/v1/messages/count_tokens', { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }] })).status).toBe(200);
      expect((await post('/c/anthropic/v1/messages', { model: 'mystery-model', max_tokens: 5, messages: [] })).status).toBe(402);
      fail = true;
      expect((await post('/c/anthropic/v1/messages', anthropicBody())).status).toBe(502);
      const lines = readFileSync(usageLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines[0]).toMatchObject({ outcome: 'forwarded', route: '/v1/messages/count_tokens', cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0 });
      expect('sections' in lines[0]).toBe(false);
      for (const l of lines.slice(1)) for (const k of [...NEW_FIELDS, ...FLAG_FIELDS]) expect(k in l).toBe(false);
      expect(lines.slice(1).map((l) => l.outcome)).toEqual(['refused', 'failed']);
    } finally { proxy.stop(); }
  });
  test('--log-sections is parsed and off by default; /__proxy/status reports it, and in-process mode reports false', async () => {
    const base = ['--budget-ledger', 'l.sqlite', '--run-id', 'r', '--lease-usd', '1'];
    expect(parseProxyArgs(base).logSections).toBe(false);
    expect(parseProxyArgs([...base, '--log-sections']).logSections).toBe(true);
    const inProcess = new MeteringProxy({});
    inProcess.start();
    try { expect((await (await fetch(`http://127.0.0.1:${inProcess.port}/__proxy/status`)).json()).log_sections).toBe(false); } finally { inProcess.stop(); }
  });
});
