// internal-task: install slots in the metering proxy (runner/proxy/metering-proxy.ts, a bind with install: true), keyless.
// The mix in tests/fixtures/proxy-install-slot/drive.ts runs against a fake upstream with placeholder keys. golden.json is
// what the proxy at origin/main (db705db2, before install slots) wrote and answered for that mix; a slot bound without
// install must still write and answer exactly that, times aside.
import { afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
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
    // A tokenless request is refused from its headers, before its body is read, so its line names no model.
    expect(r.line('messages, no credential')).toMatchObject({ key: 'slot:i1', outcome: 'refused', endpoint: 'generation', model: null, non_harness: true });
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

  test('finalize does not wait for a tokenless install request whose body never finishes', async () => {
    const dir = join(tmp, 'tokenless-slow-body');
    mkdirSync(dir, { recursive: true });
    const lease = BudgetRun.openLease({ runId: 'tokenless-slow-run', leaseUsd: 5, ledgerPath: join(dir, 'ledger.sqlite'), maxOutputTokens: 4096 });
    const fetchImpl = async () => new Response(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic' }, usageLog: join(dir, 'usage.ndjson'), maxOutputTokens: 4096 } } as never);
    proxy.start();
    const stuck = connect({ host: '127.0.0.1', port: proxy.port });
    try {
      proxy.bind('s1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      // Headers and the start of a body that never finishes, with no credential.
      await new Promise<void>((res, rej) => { stuck.once('error', rej); stuck.write('POST /s1/anthropic/v1/messages HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 4096\r\n\r\n{"model":', () => res()); });
      // A complete request with the token, sent after the stuck one has been written, is the barrier: once it is answered, the
      // proxy has had the stuck request's headers for at least that long.
      const ok = await fetch(`http://127.0.0.1:${proxy.port}/s1/anthropic/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'q' }] }) });
      expect(ok.status).toBe(200);
      const t0 = Date.now();
      const m = await proxy.finalize(KEY, 30_000);
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(m.requests).toBe(1);
      expect(m.undrained).toBeUndefined();
    } finally { stuck.destroy(); proxy.stop(); }
  });

  test('a Responses stream that completed 30 web searches and sent no final usage is charged its reservation plus the 30 searches', async () => {
    const dir = join(tmp, 'no-usage-web');
    mkdirSync(dir, { recursive: true });
    const ledgerPath = join(dir, 'ledger.sqlite'), usageLog = join(dir, 'usage.ndjson');
    const lease = BudgetRun.openLease({ runId: 'no-usage-web-run', leaseUsd: 5, ledgerPath, maxOutputTokens: 4096 });
    const items = Array.from({ length: 30 }, (_, i) => ({ type: 'web_search_call', id: 'ws_' + i, status: 'completed', action: { type: 'search', query: 'q' } }));
    const events = [
      ...items.map((item, i) => ({ type: 'response.output_item.done', sequence_number: i, output_index: i, item })),
      { type: 'response.completed', sequence_number: 30, response: { id: 'resp_n', object: 'response', status: 'completed', model: 'gpt-6.1-sol', output: items } },
    ];
    const sseText = events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
    const fetchImpl = async () => new Response(sseText, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { OPENAI_API_KEY: 'placeholder-openai' }, usageLog, maxOutputTokens: 4096 } } as never);
    proxy.start();
    try {
      proxy.bind('w1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      const res = await fetch('http://127.0.0.1:' + proxy.port + '/w1/openai/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', max_output_tokens: 64, stream: true, input: 'q', tools: [{ type: 'web_search', max_uses: 5 }] }) });
      expect(res.status).toBe(200);
      await res.text();
      await proxy.finalize(KEY);
    } finally { proxy.stop(); }
    const line = JSON.parse(readFileSync(usageLog, 'utf8').trim()) as UsageLine;
    expect(line).toMatchObject({ outcome: 'forwarded', streamed: true, charged_reservation: true, usage_unknown: true, web_search_calls: 30 });
    expect(line.web_search_usd).toBeCloseTo(0.3, 12);
    expect(line.actual_usd! - line.reserved_usd!).toBeGreaterThanOrEqual(0.3 - 1e-12);
    const entry = readLedger(ledgerPath).entries[0]!;
    expect(entry.actual_usd!).toBeCloseTo(line.actual_usd!, 12);
    expect(entry.actual_usd! - entry.reserved_usd).toBeGreaterThanOrEqual(0.3 - 1e-12);
  });

  test('an unauthenticated install request whose body never finishes is refused from its headers: nothing in flight, nothing undrained', async () => {
    const dir = join(tmp, 'tokenless-refused-early');
    mkdirSync(dir, { recursive: true });
    const lease = BudgetRun.openLease({ runId: 'tokenless-early-run', leaseUsd: 5, ledgerPath: join(dir, 'ledger.sqlite'), maxOutputTokens: 4096 });
    let upstream = 0;
    const fetchImpl = async () => { upstream++; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const usageLog = join(dir, 'usage.ndjson');
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic' }, usageLog, maxOutputTokens: 4096 } } as never);
    proxy.start();
    const stuck = connect({ host: '127.0.0.1', port: proxy.port });
    try {
      proxy.bind('s1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      const answered = new Promise<string>((res) => { let got = ''; stuck.on('data', (d) => { got += d.toString(); if (got.includes('\r\n\r\n')) res(got); }); });
      stuck.write('POST /s1/anthropic/v1/messages HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 4096\r\n\r\n{"model":');
      const head = await Promise.race([answered, Bun.sleep(5000).then(() => 'no answer')]);
      expect(head).toStartWith('HTTP/1.1 403');
      const inflight = (proxy as unknown as { inflight: Map<string, number> }).inflight;
      expect(inflight.get(KEY) ?? 0).toBe(0);
      expect(inflight.get('slot:s1') ?? 0).toBe(0);
      const m = await proxy.finalize(KEY, 1000);
      expect(m.undrained ?? 0).toBe(0);
      expect(upstream).toBe(0);
      expect(JSON.parse(readFileSync(usageLog, 'utf8').trim())).toMatchObject({ key: 'slot:s1', outcome: 'refused', status: 403, token_presented: false, model: null });
    } finally { stuck.destroy(); proxy.stop(); }
  });

  test('a token-bearing install request whose body stalls past the read deadline is refused 408 and leaves nothing in flight', async () => {
    const dir = join(tmp, 'token-deadline');
    mkdirSync(dir, { recursive: true });
    const lease = BudgetRun.openLease({ runId: 'token-deadline-run', leaseUsd: 5, ledgerPath: join(dir, 'ledger.sqlite'), maxOutputTokens: 4096 });
    const usageLog = join(dir, 'usage.ndjson');
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl: async () => new Response('{}'), installBodyDeadlineMs: 300, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic' }, usageLog, maxOutputTokens: 4096 } } as never);
    proxy.start();
    const stuck = connect({ host: '127.0.0.1', port: proxy.port });
    try {
      proxy.bind('s1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      const answered = new Promise<string>((res) => { let got = ''; stuck.on('data', (d) => { got += d.toString(); if (got.includes('\r\n\r\n')) res(got); }); });
      stuck.write('POST /s1/anthropic/v1/messages HTTP/1.1\r\nhost: 127.0.0.1\r\nauthorization: Bearer ' + TOKEN + '\r\ncontent-type: application/json\r\ncontent-length: 4096\r\n\r\n{"model":');
      const head = await Promise.race([answered, Bun.sleep(5000).then(() => 'no answer')]);
      expect(head).toStartWith('HTTP/1.1 408');
      const m = await proxy.finalize(KEY, 1000);
      expect(m.undrained ?? 0).toBe(0);
      expect(JSON.parse(readFileSync(usageLog, 'utf8').trim())).toMatchObject({ key: KEY, outcome: 'refused', status: 408, token_presented: true });
    } finally { stuck.destroy(); proxy.stop(); }
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
    expect(s.install['slot:i1']).toEqual({ requests: 3, non_harness: { generation: 1, models: 2, embeddings: 0, count_tokens: 0, probe: 0, other: 0 }, web_search_calls: 0, web_search_usd: 0, web_fetch_calls: 0, web_fetch_usd: 0 });
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

// Precondition of the gbrain install preregistration: no install cell runs unless this passes. Hermes and Claude Code probe what
// serves their base URL at startup; with the slot's token those probes are the harness's own and must count as non_harness 0.
describe('harness startup probes on an install slot', () => {
  const PROBES: Array<[string, string, string]> = [
    ['hermes', 'POST', '/anthropic/api/show'], ['hermes', 'GET', '/anthropic/api/tags'], ['hermes', 'GET', '/anthropic/props'], ['hermes', 'GET', '/anthropic/v1/props'],
    ['hermes', 'GET', '/anthropic/version'], ['hermes', 'GET', '/anthropic/models'], ['hermes', 'GET', '/anthropic/api/v1/models'],
    ['hermes', 'POST', '/openai/api/show'], ['hermes', 'GET', '/openai/api/tags'], ['hermes', 'GET', '/openai/props'], ['hermes', 'GET', '/openai/v1/props'],
    ['hermes', 'GET', '/openai/version'], ['hermes', 'GET', '/openai/models'], ['hermes', 'GET', '/openai/api/v1/models'],
    ['claude-cli/2.1.312', 'HEAD', '/anthropic/api/hello'],
  ];
  async function probeRun(credential: string | null) {
    const dir = join(tmp, `probes-${credential ? 'token' : 'none'}`);
    mkdirSync(dir, { recursive: true });
    const usageLog = join(dir, 'usage.ndjson');
    const lease = BudgetRun.openLease({ runId: `probe-run-${credential ? 't' : 'n'}`, leaseUsd: 5, ledgerPath: join(dir, 'ledger.sqlite'), maxOutputTokens: 4096 });
    const upstream: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL) => { upstream.push(String(input)); return new Response('{}', { status: 200 }); };
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, fetchImpl, policy: { lease, env: { ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, usageLog, maxOutputTokens: 4096 } } as never);
    proxy.start();
    const statuses: number[] = [];
    try {
      proxy.bind('p1', KEY, TOKEN, MODELS, null, false, {}, null, true);
      for (const [ua, method, path] of PROBES) {
        const res = await fetch(`http://127.0.0.1:${proxy.port}/p1${path}`, { method, headers: { 'user-agent': ua, ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify({ model: 'claude-opus-5-5' }) } : {}) });
        statuses.push(res.status);
        await res.arrayBuffer();
      }
      await proxy.finalize(KEY);
    } finally { proxy.stop(); }
    const lines = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
    return { lines, statuses, upstream };
  }

  test('with the token, every probe is refused 403 at $0, classed probe, and no non_harness count is above zero', async () => {
    const r = await probeRun(TOKEN);
    expect(r.statuses.every((s) => s === 403)).toBe(true);
    expect(r.upstream).toEqual([]);
    expect(r.lines).toHaveLength(PROBES.length);
    for (const l of r.lines) expect(l).toMatchObject({ kind: 'install_slot', key: KEY, outcome: 'refused', status: 403, endpoint: 'probe', token_presented: true, non_harness: false });
    expect(r.lines.every((l) => (l.actual_usd ?? 0) === 0)).toBe(true);
    const totals = installTotals(r.lines);
    expect(Object.keys(totals)).toEqual([KEY]);
    expect(Object.values(totals[KEY]!.non_harness).every((n) => n === 0)).toBe(true);
  });

  test('without the token, the same probes stay non_harness under slot:<id>', async () => {
    const r = await probeRun(null);
    expect(r.statuses.every((s) => s === 403)).toBe(true);
    for (const l of r.lines) expect(l).toMatchObject({ key: 'slot:p1', endpoint: 'probe', token_presented: false, non_harness: true });
    expect(installTotals(r.lines)['slot:p1']!.non_harness.probe).toBe(PROBES.length);
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
    expect(endpointClass('POST', '/api/show')).toBe('probe');
    expect(endpointClass('GET', '/api/tags')).toBe('probe');
    expect(endpointClass('GET', '/v1/props')).toBe('probe');
    expect(endpointClass('HEAD', '/api/hello')).toBe('probe');
    expect(endpointClass('GET', '/api/hello')).toBe('other');
    expect(endpointClass('POST', '/version')).toBe('other');
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
