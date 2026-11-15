// internal-task: install slots in the metering proxy (runner/proxy/metering-proxy.ts, a bind with install: true), keyless.
// The mix in tests/fixtures/proxy-install-slot/drive.ts runs against a fake upstream with placeholder keys. golden.json is
// what the proxy at origin/main (db705db2, before install slots) wrote and answered for that mix; a slot bound without
// install must still write and answer exactly that, times aside.
import { afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, closeRun, readLedger } from '../runner/ledger/budget-ledger.ts';
import { endpointClass, installTotals, MeteringProxy, sanitizeUserAgent, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { unpricedWebTools, WEB_TOOL_ALLOWANCE_CALLS, webToolAllowance, webToolUse } from '../runner/proxy/hosted-tools.ts';
import { TOOL_FEES } from '../runner/pricing/model-pricing.ts';
import { snapshot } from './fixtures/metering-proxy-golden/drive.ts';
import { drive, KEY, MODELS, requests, TOKEN } from './fixtures/proxy-install-slot/drive.ts';

const ROOT = join(import.meta.dir, '..');
const GOLDEN = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'proxy-install-slot', 'golden.json'), 'utf8')) as { usage: string[]; ledger: string[]; answers: string[] };
const tmp = mkdtempSync(join(tmpdir(), 'proxy-install-slot-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
async function run(install: boolean) {
  const dir = join(tmp, String(++n));
  mkdirSync(dir, { recursive: true });
  const out = await drive(MeteringProxy as never, BudgetRun as never, dir, { install });
  const text = readFileSync(out.usageLog, 'utf8');
  const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  const labels = requests().map(([label]) => label);
  const line = (label: string) => lines[labels.indexOf(label)]!;
  const answer = (label: string) => out.answers[labels.indexOf(label)]!;
  return { ...out, text, lines, line, answer, entries: readLedger(out.ledgerPath).entries };
}

describe('a slot bound without install', () => {
  test('writes the usage lines and ledger entries, and gives the answers, the proxy gave before install slots', async () => {
    const r = await run(false);
    const snap = snapshot(r.text, r.entries as never);
    expect(snap.usage).toEqual(GOLDEN.usage);
    expect(snap.ledger).toEqual(GOLDEN.ledger);
    expect(r.answers).toEqual(GOLDEN.answers);
    expect(r.lines.some((l) => 'kind' in l || 'non_harness' in l || 'web_search_calls' in l)).toBe(false);
  });
});

describe('an install slot', () => {
  test('records every request once, forwarded or refused, with the status the proxy answered', async () => {
    const r = await run(true);
    expect(r.lines).toHaveLength(requests().length);
    r.lines.forEach((l, i) => {
      expect(l).toMatchObject({ kind: 'install_slot', status: Number(r.answers[i]!.slice(0, 3)) });
      expect(typeof l.non_harness).toBe('boolean');
      expect(typeof l.token_presented).toBe('boolean');
      expect(l.method).toBe(requests()[i]![1]);
    });
  });

  test('a GET /v1/models without the token is refused at $0 and recorded as non_harness under slot:<id>', async () => {
    const r = await run(true);
    expect(r.answer('models list, no credential')).toStartWith('403 ');
    expect(r.answer('models list, no credential')).toContain('HE-PROXY-010');
    expect(r.line('models list, no credential')).toMatchObject({ key: 'slot:i1', outcome: 'refused', status: 403, method: 'GET', endpoint: 'models', token_presented: false, non_harness: true, model: null });
    expect(r.line('models list, wrong credential, the token in the user agent')).toMatchObject({ key: 'slot:i1', outcome: 'refused', token_presented: false, non_harness: true });
    expect(r.line('messages, no credential')).toMatchObject({ key: 'slot:i1', outcome: 'refused', endpoint: 'generation', model: 'claude-opus-5-5', non_harness: true });
  });

  test('a GET /v1/models with the token is forwarded free and recorded as the harness', async () => {
    const r = await run(true);
    for (const label of ['models list, token', 'models read, token']) {
      expect(r.answer(label)).toStartWith('200 ');
      expect(r.line(label)).toMatchObject({ key: KEY, outcome: 'forwarded', status: 200, endpoint: 'models', token_presented: true, non_harness: false, actual_usd: 0 });
    }
  });

  test('an embeddings request with the token, an off-model generation and an unlisted route are refused at $0 as non_harness', async () => {
    const r = await run(true);
    expect(r.line('embeddings, token')).toMatchObject({ key: KEY, outcome: 'refused', status: 403, endpoint: 'embeddings', model: 'text-embedding-3-small', token_presented: true, non_harness: true });
    expect(r.line('messages, model not on the slot')).toMatchObject({ key: KEY, outcome: 'refused', status: 403, endpoint: 'generation', model: 'claude-haiku-5-5', token_presented: true, non_harness: true });
    expect(r.line('files, token')).toMatchObject({ key: KEY, outcome: 'refused', status: 403, endpoint: 'other', non_harness: true });
    for (const label of ['embeddings, token', 'messages, model not on the slot', 'files, token']) expect(r.line(label).reason).toStartWith('HE-PROXY-010 ');
    expect(r.line('count_tokens, token')).toMatchObject({ outcome: 'refused', endpoint: 'count_tokens', model: 'claude-opus-5-5', non_harness: false });
    expect(r.line('messages, upstream connection lost')).toMatchObject({ outcome: 'failed', status: 502, non_harness: false });
    expect(r.entries.filter((e) => /haiku|embedding/.test(e.description))).toHaveLength(0);
  });

  test('an Anthropic stream that used web search is charged its searches on top of its tokens, and web fetch counts at $0', async () => {
    const [off, on] = [await run(false), await run(true)];
    const label = 'messages, streamed with web search';
    const before = JSON.parse(GOLDEN.usage[requests().findIndex(([l]) => l === label)]!) as UsageLine;
    expect(TOOL_FEES['anthropic:web_search']).toBe(0.01);
    expect(on.line(label)).toMatchObject({ outcome: 'forwarded', streamed: true, web_search_calls: 2, web_search_usd: 0.02, web_fetch_calls: 0, web_fetch_usd: 0, non_harness: false });
    expect(on.line(label).actual_usd).toBeCloseTo(before.actual_usd! + 0.02, 12);
    expect(off.line(label).actual_usd).toBe(before.actual_usd!);
    const entry = (r: typeof on, i: number) => r.entries.filter((e) => e.description.startsWith('anthropic:claude-opus-5-5'))[i]!;
    expect(entry(on, 1).actual_usd).toBeCloseTo(before.actual_usd! + 0.02, 12);
    expect(on.line('messages, web fetch')).toMatchObject({ web_fetch_calls: 1, web_fetch_usd: 0, web_search_calls: 0 });
    expect(on.line('messages, web fetch').actual_usd).toBe(off.line('messages, web fetch').actual_usd);
  });

  test('an OpenAI Responses answer with web_search_call items is charged one search per item, streamed or not', async () => {
    const [off, on] = [await run(false), await run(true)];
    expect(TOOL_FEES['openai:web_search']).toBe(0.01);
    expect(on.line('responses, web search')).toMatchObject({ outcome: 'forwarded', streamed: false, web_search_calls: 2, web_search_usd: 0.02 });
    expect(on.line('responses, web search').actual_usd).toBeCloseTo(off.line('responses, web search').actual_usd! + 0.02, 12);
    expect(on.line('responses, streamed web search')).toMatchObject({ outcome: 'forwarded', streamed: true, web_search_calls: 1, web_search_usd: 0.01 });
    expect(on.line('responses, streamed web search').actual_usd).toBeCloseTo(off.line('responses, streamed web search').actual_usd! + 0.01, 12);
  });

  test('the reservation covers the declared hosted web tools: max_uses calls when set, else 20, at each tool fee row, so the streamed search has no overshoot', async () => {
    const r = await run(true);
    const golden = (label: string) => JSON.parse(GOLDEN.usage[requests().findIndex(([l]) => l === label)]!) as UsageLine;
    const stream = 'messages, streamed with web search';
    expect(r.line(stream).reserved_usd).toBeCloseTo(golden(stream).reserved_usd! + 5 * 0.01, 12);
    expect(r.line(stream).actual_usd!).toBeLessThanOrEqual(r.line(stream).reserved_usd!);
    const entry = r.entries.filter((e) => e.description.startsWith('anthropic:claude-opus-5-5'))[1]!;
    expect(entry.reserved_usd).toBeCloseTo(golden(stream).reserved_usd! + 0.05, 12);
    expect(entry.actual_usd!).toBeLessThanOrEqual(entry.reserved_usd);
    expect(WEB_TOOL_ALLOWANCE_CALLS).toBe(20);
    expect(r.line('responses, web search').reserved_usd).toBeCloseTo(golden('responses, web search').reserved_usd! + 20 * 0.01, 12);
    expect(r.line('messages, web fetch').reserved_usd).toBe(golden('messages, web fetch').reserved_usd!);
    expect(r.line('messages, plain').reserved_usd).toBe(golden('messages, plain').reserved_usd!);
    expect(r.entries.every((e) => e.actual_usd === null || e.actual_usd <= e.reserved_usd + 1e-12)).toBe(true);
    expect(webToolAllowance('anthropic', { tools: [{ type: 'web_search_20250305', max_uses: 0 }, { type: 'function', name: 'web_search' }] })).toBeCloseTo(0.2, 12);
  });

  test('an answer that ran more searches than the reservation allowed settles at the calls it reports, above its reservation, and the ledger keeps the overshoot', async () => {
    const dir = join(tmp, 'overshoot');
    mkdirSync(dir, { recursive: true });
    const ledgerPath = join(dir, 'ledger.sqlite'), usageLog = join(dir, 'usage.ndjson');
    const lease = BudgetRun.openLease({ runId: 'overshoot-run', leaseUsd: 5, ledgerPath, maxOutputTokens: 4096 });
    const output = Array.from({ length: WEB_TOOL_ALLOWANCE_CALLS + 5 }, (_, i) => ({ type: 'web_search_call', id: `ws_${i}`, status: 'completed', action: { type: 'search', query: 'q' } }));
    const fetchImpl = async () => new Response(JSON.stringify({ id: 'resp_o', object: 'response', status: 'completed', model: 'gpt-6.1-sol', output, usage: { input_tokens: 1000, output_tokens: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { OPENAI_API_KEY: 'placeholder-openai' }, usageLog, maxOutputTokens: 4096 } } as never);
    proxy.start();
    try {
      proxy.bind('o1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      const res = await fetch(`http://127.0.0.1:${proxy.port}/o1/openai/v1/responses`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', max_output_tokens: 64, input: 'q', tools: [{ type: 'web_search' }] }) });
      expect(res.status).toBe(200);
      await res.text();
      await proxy.finalize(KEY);
    } finally { proxy.stop(); }
    const line = JSON.parse(readFileSync(usageLog, 'utf8').trim()) as UsageLine;
    expect(line).toMatchObject({ outcome: 'forwarded', web_search_calls: 25 });
    expect(line.web_search_usd).toBeCloseTo(0.25, 12);
    expect(line.actual_usd!).toBeGreaterThan(line.reserved_usd!);
    const entry = readLedger(ledgerPath).entries[0]!;
    expect(entry.reserved_usd).toBeCloseTo(line.reserved_usd!, 12);
    expect(entry.actual_usd!).toBeCloseTo(line.actual_usd!, 12);
    expect(entry.actual_usd!).toBeGreaterThan(entry.reserved_usd);
  });

  test('finalize waits for an install request whose body is still arriving, so the trial meter counts it', async () => {
    const dir = join(tmp, 'slow-body');
    mkdirSync(dir, { recursive: true });
    const lease = BudgetRun.openLease({ runId: 'slow-run', leaseUsd: 5, ledgerPath: join(dir, 'ledger.sqlite'), maxOutputTokens: 4096 });
    const fetchImpl = async () => new Response(JSON.stringify({ id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic' }, usageLog: join(dir, 'usage.ndjson'), maxOutputTokens: 4096 } } as never);
    proxy.start();
    try {
      proxy.bind('s1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      const text = new TextEncoder().encode(JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'q' }] }));
      let rest!: () => void;
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(text.slice(0, 10)); rest = () => { c.enqueue(text.slice(10)); c.close(); }; } });
      const answer = fetch(`http://127.0.0.1:${proxy.port}/s1/anthropic/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
      await Bun.sleep(200);
      const meter = proxy.finalize(KEY, 5000);
      await Bun.sleep(100);
      rest();
      expect((await answer).status).toBe(200);
      const m = await meter;
      expect(m.requests).toBe(1);
      expect(m.undrained).toBeUndefined();
    } finally { proxy.stop(); }
  });

  test('a hosted web tool with no fee row is refused 400 (HE-PROXY-011), never metered at $0', async () => {
    const r = await run(true);
    for (const label of ['responses, web search preview', 'chat completions, web_search_options']) {
      expect(r.answer(label)).toStartWith('400 ');
      expect(r.line(label)).toMatchObject({ outcome: 'refused', status: 400, non_harness: false });
      expect(r.line(label).reason).toStartWith('HE-PROXY-011 ');
    }
    expect(unpricedWebTools('anthropic', { tools: [{ type: 'web_search_20260318' }, { type: 'web_fetch_20260318' }, { type: 'function', name: 'web_search' }] })).toEqual([]);
    expect(unpricedWebTools('openai', { tools: [{ type: 'web_search' }, { type: 'web_search_2025_08_26' }, { type: 'web_search_preview_2025_03_11' }] })).toEqual(['tools[2].type web_search_preview_2025_03_11']);
    expect(unpricedWebTools('particle', { web_search_options: {} })).toEqual(['web_search_options']);
  });

  test('the usage log holds no token and no request or response text', async () => {
    const r = await run(true);
    expect(r.text).not.toContain(TOKEN);
    expect(r.text).not.toContain('BODY-TEXT');
    expect(r.text).not.toContain('sk-proj-');
    expect(r.text).not.toContain('placeholder-');
    expect(r.line('models list, wrong credential, the token in the user agent').user_agent).toBe('gbrain/0.60.717 [masked]');
    expect(r.line('models list, no credential').user_agent).toBe('gbrain/0.60.717 doctor (key [masked])');
  });

  test('summary prints install totals per key from the usage log', async () => {
    const r = await run(true);
    const out = Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', r.ledgerPath, '--run-id', 'install-run', '--usage-log', r.usageLog],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp } });
    expect(out.exitCode).toBe(0);
    const s = JSON.parse(out.stdout.toString()) as { install: Record<string, { requests: number; non_harness: Record<string, number>; web_search_calls: number; web_search_usd: number; web_fetch_calls: number; web_fetch_usd: number }> };
    expect(Object.keys(s.install).sort()).toEqual(['slot:i1', KEY]);
    expect(s.install['slot:i1']).toEqual({ requests: 3, non_harness: { generation: 1, models: 2, embeddings: 0, count_tokens: 0, other: 0 }, web_search_calls: 0, web_search_usd: 0, web_fetch_calls: 0, web_fetch_usd: 0 });
    const mine = s.install[KEY]!;
    expect(mine).toMatchObject({ requests: requests().length - 3, non_harness: { generation: 1, models: 0, embeddings: 1, count_tokens: 0, other: 1 }, web_search_calls: 5, web_fetch_calls: 1, web_fetch_usd: 0 });
    expect(mine.web_search_usd).toBeCloseTo(0.05, 12);
    expect(installTotals(r.lines)).toEqual(s.install as never);
  });

  test('summary counts only the install lines written while the lease was open', async () => {
    const r = await run(true);
    closeRun(r.ledgerPath, 'install-run');
    appendFileSync(r.usageLog, ['2000-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z'].flatMap((at) => r.lines.map((l) => JSON.stringify({ ...l, at }) + '\n')).join(''));
    const out = Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', r.ledgerPath, '--run-id', 'install-run', '--usage-log', r.usageLog],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp } });
    expect(out.exitCode).toBe(0);
    const s = JSON.parse(out.stdout.toString()) as { finished_at: string | null; install: unknown };
    expect(s.finished_at).not.toBeNull();
    expect(s.install).toEqual(installTotals(r.lines) as never);
  });

  test('a slot bound without install adds no install key to summary', async () => {
    const r = await run(false);
    const out = Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', r.ledgerPath, '--run-id', 'install-run', '--usage-log', r.usageLog],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp } });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout.toString()).install).toBeUndefined();
  });
});

describe('binding an install slot', () => {
  const start = (refuseHostedTools: boolean) => {
    const lease = BudgetRun.openLease({ runId: `bind-${++n}`, leaseUsd: 1, ledgerPath: join(tmp, `bind-${n}.sqlite`) });
    const proxy = new MeteringProxy({ fetchImpl: (async () => Response.json({})) as unknown as typeof fetch, policy: { lease, env: {}, usageLog: join(tmp, `bind-${n}.ndjson`), ...(refuseHostedTools ? { refuseHostedTools } : {}) } });
    proxy.start();
    const bind = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${proxy.port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { proxy, bind };
  };

  test('is refused on a proxy started with --refuse-hosted-tools, over HTTP and in process', async () => {
    const { proxy, bind } = start(true);
    try {
      const res = await bind({ slot: 's', key: 'k', token: 't', models: MODELS, install: true });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('--refuse-hosted-tools');
      expect(() => proxy.bind('s', 'k', 't', MODELS, null, false, {}, null, true)).toThrow('--refuse-hosted-tools');
      expect((await bind({ slot: 's', key: 'k', token: 't', models: MODELS })).status).toBe(200);
    } finally { proxy.stop(); }
  });

  test('needs a token, models and a boolean install', async () => {
    const { proxy, bind } = start(false);
    try {
      expect((await bind({ slot: 's', key: 'k', models: MODELS, install: true })).status).toBe(400);
      expect((await bind({ slot: 's', key: 'k', token: 't', install: true })).status).toBe(400);
      expect((await bind({ slot: 's', key: 'k', token: 't', models: MODELS, install: 'yes' })).status).toBe(400);
      expect((await bind({ slot: 's', key: 'k', token: 't', models: MODELS, install: true })).status).toBe(200);
      expect(() => new MeteringProxy().bind('s', 'k', 't', MODELS, null, false, {}, null, true)).toThrow('a lease proxy');
    } finally { proxy.stop(); }
  });
});

describe('helpers', () => {
  test('endpointClass', () => {
    expect(endpointClass('POST', '/v1/messages')).toBe('generation');
    expect(endpointClass('POST', '/v1/responses')).toBe('generation');
    expect(endpointClass('POST', '/v1/chat/completions')).toBe('generation');
    expect(endpointClass('GET', '/v1/models')).toBe('models');
    expect(endpointClass('GET', '/v1/models/gpt-6.1-sol')).toBe('models');
    expect(endpointClass('POST', '/v1/models')).toBe('other');
    expect(endpointClass('POST', '/v1/embeddings')).toBe('embeddings');
    expect(endpointClass('POST', '/v1/messages/count_tokens')).toBe('count_tokens');
    expect(endpointClass('POST', '/v1/rerank')).toBe('other');
  });

  test('sanitizeUserAgent keeps printable ASCII, masks the token and token-like runs, and stops at 120 characters', () => {
    expect(sanitizeUserAgent('claude-cli/2.0.1 (external, sdk-ts)', 'tok')).toBe('claude-cli/2.0.1 (external, sdk-ts)');
    expect(sanitizeUserAgent('a\u0000b\u00e9c', null)).toBe('a b c');
    expect(sanitizeUserAgent('x my-secret-token y', 'my-secret-token')).toBe('x [masked] y');
    expect(sanitizeUserAgent('k sk-abc12345 and ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', null)).toBe('k [masked] and [masked]');
    expect(sanitizeUserAgent('a'.repeat(19) + ' ' + 'b/'.repeat(200), null)).toHaveLength(120);
    expect(sanitizeUserAgent(null, null)).toBe('');
  });

  test('webToolUse counts the searches a cut-off Responses stream completed, each once', () => {
    const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    const call = (id: string) => ({ type: 'web_search_call', id, status: 'completed' });
    const cut = [1, 2, 3].map((i) => sse({ type: 'response.output_item.done', item: call(`ws_${i}`) })).join('');
    expect(webToolUse('openai', '/v1/responses', cut, true)).toMatchObject({ web_search_calls: 3 });
    expect(webToolUse('openai', '/v1/responses', cut, true).web_search_usd).toBeCloseTo(0.03, 12);
    const done = cut + sse({ type: 'response.completed', response: { output: [call('ws_1'), call('ws_2'), call('ws_3'), call('ws_4')] } });
    expect(webToolUse('openai', '/v1/responses', done, true)).toMatchObject({ web_search_calls: 4 });
  });

  test('webToolUse reads nothing from other routes and providers', () => {
    expect(webToolUse('openai', '/v1/chat/completions', { usage: { server_tool_use: { web_search_requests: 3 } } }, false)).toEqual({ web_search_calls: 0, web_search_usd: 0, web_fetch_calls: 0, web_fetch_usd: 0 });
    expect(webToolUse('anthropic', '/v1/messages', { usage: { server_tool_use: { web_search_requests: -1, web_fetch_requests: 'x' } } }, false)).toEqual({ web_search_calls: 0, web_search_usd: 0, web_fetch_calls: 0, web_fetch_usd: 0 });
  });
});
