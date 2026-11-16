/**
 * The OpenRouter route through the metering proxy: DeepSeek V4.1 Flash 1017 pinned to DeepSeek's own endpoint, priced from its
 * price-table row, refused when a request could leave that endpoint (HE-PROXY-008), and marked when an answer came from
 * another provider (HE-PROXY-009), which makes the trial infra_error. Keyless: the upstream is
 * tests/fixtures/openrouter/fake-openrouter.ts on the loopback (or a fetch stand-in), every key is a placeholder or a canary,
 * and the spawned runner gets an environment built from scratch (PATH and HOME, plus what the case needs).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus, priceRequest, reservationUsd, usageCost } from '../runner/ledger/budget-ledger.ts';
import { canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { MeteringProxy, OPENROUTER_MODELS, openrouterRefusal, parseProxyArgs, UPSTREAM, type LeasePolicy, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { buildManifest, ceilingUsd, loadPrereg, openrouterCellsWithoutRoute, type Prereg } from '../runner/run.ts';
import { trialTermination } from '../runner/trial/trial.ts';
import { FAKE_COST_USD, FAKE_USAGE, startFakeOpenRouter, type FakeOpenRouterRequest } from './fixtures/openrouter/fake-openrouter.ts';

const ROOT = resolve(import.meta.dir, '..');
const MODEL = 'deepseek/deepseek-v4.1-flash-1017';
const CELL_MODEL = 'openrouter:' + MODEL;
const tmp = mkdtempSync(join(tmpdir(), 'openrouter-route-'));
const KEY = 'placeholder-openrouter';
const FAKE_ENV = { OPENROUTER_API_KEY: KEY, OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' };
const fakeLog = join(tmp, 'fake.ndjson');
const fake = startFakeOpenRouter({ host: '127.0.0.1', port: 0, log: fakeLog, expectKey: KEY });
const elsewhereLog = join(tmp, 'fake-elsewhere.ndjson');
const elsewhere = startFakeOpenRouter({ host: '127.0.0.1', port: 0, log: elsewhereLog, expectKey: KEY, served: 'Chutes' });
afterAll(() => { fake.stop(true); elsewhere.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const TOKEN = 'trial-token:o.0123456789abcdef0123456789abcdef';
const lines = <T>(path: string): T[] => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T); } catch { return []; } };
/** The DeepSeek endpoint at peak: uncached input $0.30, cache hits $0.006, output (reasoning included) $1.20 per million tokens. */
const rowUsd = (prompt: number, cached: number, output: number) => ((prompt - cached) * 0.3 + cached * 0.006 + output * 1.2) / 1e6;
const PINNED = { only: ['deepseek'], allow_fallbacks: false, max_price: { prompt: 0.3, completion: 1.2 } };
let n = 0;

/** A lease proxy (output cap 128000, as every shard runs it) whose openrouter upstream is a fake, slot o bound to a per-trial token and the cell's model. */
function openrouterProxy(o: { extra?: Partial<LeasePolicy>; models?: string[] | null; fetchImpl?: typeof fetch; upstream?: ReturnType<typeof Bun.serve>; log?: string } = {}) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'openrouter-' + id, leaseUsd: 1, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const upstream = 'http://127.0.0.1:' + (o.upstream ?? fake).port;
  const proxy = new MeteringProxy({ fetchImpl: o.fetchImpl, upstream: { openrouter: upstream, openai: upstream }, policy: { lease, env: FAKE_ENV, usageLog, maxOutputTokens: 128_000, ...o.extra } });
  proxy.start();
  proxy.bind('o', 'trial-token:o', TOKEN, o.models === undefined ? [CELL_MODEL] : o.models);
  const log = o.log ?? fakeLog;
  const before = lines(log).length;
  const send = (method: string, path: string, body?: unknown) => fetch('http://127.0.0.1:' + proxy.port + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    proxy, lease, usageLog, send, post: (path: string, body: unknown) => send('POST', path, body),
    seen: () => lines<FakeOpenRouterRequest>(log).slice(before), usage: () => lines<UsageLine>(usageLog),
    committed: () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd,
  };
}
const ROUTE = '/o/openrouter/v1/chat/completions';
const chat = (extra: Record<string, unknown> = {}) => ({ model: MODEL, messages: [{ role: 'user', content: 'Say ok.' }], reasoning: { effort: 'high' }, ...extra });

describe('the OpenRouter price row', () => {
  test('openrouter:deepseek/deepseek-v4.1-flash-1017 has one row at the DeepSeek endpoint\'s peak rates, with its cache-read rate', () => {
    expect(canonicalLookup(CELL_MODEL)).toEqual({ input: 0.3, output: 1.2, cache_read: 0.006 });
    expect(UPSTREAM.openrouter).toBe('https://openrouter.ai/api');
    expect(Object.keys(OPENROUTER_MODELS)[0]).toBe(MODEL);
    for (const id of Object.keys(OPENROUTER_MODELS)) expect(canonicalLookup('openrouter:' + id)).toBeDefined();
  });

  test('the ledger prices a pinned request from the row, refuses a max_price above it or none, and settles from tokens with usage.cost beside', () => {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const body = { ...chat(), provider: PINNED, max_completion_tokens: 128_000 };
    const price = priceRequest(url, body)!;
    expect(price).toMatchObject({ provider: 'openrouter', model: MODEL, kind: 'chat', input: 0.3, output: 1.2, cache_read: 0.006, rowPriced: true, maxOutputTokens: 128_000 });
    // 50,000 input tokens and 128,000 output tokens at peak: $0.015 plus $0.1536.
    expect(reservationUsd({ ...price, inputTokens: 50_000 })).toBeCloseTo(0.1686, 10);
    const settled = usageCost(price, { usage: { prompt_tokens: 40, prompt_tokens_details: { cached_tokens: 32 }, completion_tokens: 25, cost: FAKE_COST_USD } })!;
    expect(settled.usd).toBeCloseTo(rowUsd(40, 32, 25), 15);
    expect(settled.reported_usd).toBe(FAKE_COST_USD);
    expect(settled.usd).toBeGreaterThan(settled.reported_usd!);
    expect(() => priceRequest(url, { ...body, provider: { ...PINNED, max_price: { prompt: 0.3, completion: 2 } } })).toThrow('above its price row');
    expect(() => priceRequest(url, chat())).toThrow('sets no provider.max_price');
    // A model with no row keeps the old rule: priced at its max_price, settled at OpenRouter's reported cost.
    const other = priceRequest(url, { model: 'example/no-row', messages: [], provider: { max_price: { prompt: 1, completion: 2 } } })!;
    expect(other).toMatchObject({ input: 1, output: 2 });
    expect(other.rowPriced).toBeUndefined();
    expect(usageCost(other, { usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.5 } })).toEqual({ usd: 0.5, input_tokens: 10, output_tokens: 5 });
  });

  test('a preregistration with an OpenRouter cell passes the HE-PIN-002 preflight and gets its ceiling at peak rates', () => {
    const cell = { id: 'ds', harness: 'openclaw', model: CELL_MODEL, slice: 'hello' as const, split: 'dev' as const, repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } };
    const p: Prereg = { schema_version: 1, run_id: 'openrouter-test', question: 'q', tasks: { hello: ['hello'] }, cells: [cell], wall_clock_s: { hello: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    const file = join(mkdtempSync(join(tmp, 'prereg-')), 'prereg.json');
    writeFileSync(file, JSON.stringify(p));
    const { prereg, sha256 } = loadPrereg(file);
    // 100,000 input tokens at $0.30 plus 10,000 output tokens at $1.20 per million; the manifest rounds to cents.
    expect(ceilingUsd(cell)).toBeCloseTo(0.042, 12);
    expect(buildManifest(prereg, sha256, '2026-11-08T00:00:00Z').per_cell_ceiling_usd.ds).toBe(0.04);
  });
});

describe('DeepSeek V4.1 Flash 1017 through the metering proxy in lease mode', () => {
  test('a non-streamed call is pinned to DeepSeek, forwarded with the proxy key, priced from the row, and records the provider, model, generation id and usage.cost', async () => {
    const t = openrouterProxy();
    try {
      const res = await t.post(ROUTE, chat());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provider).toBe('DeepSeek');
      expect(body.choices[0].message).toMatchObject({ content: 'ok', reasoning: expect.any(String) });
      const [seen, ...more] = t.seen();
      expect(more).toEqual([]);
      expect(seen).toMatchObject({ method: 'POST', path: '/v1/chat/completions', model: MODEL, stream: false, max_completion_tokens: 128_000, max_tokens: null, provider: PINNED, reasoning: { effort: 'high' }, credential: 'expected' });
      const meter = await t.proxy.finalize('trial-token:o');
      const [line, ...rest] = t.usage();
      expect(rest).toEqual([]);
      expect(line).toMatchObject({ key: 'trial-token:o', provider: 'openrouter', route: '/v1/chat/completions', model: MODEL, outcome: 'forwarded', status: 200, served_provider: 'DeepSeek', served_model: MODEL,
        generation_id: expect.stringMatching(/^gen-fake-/), openrouter_cost_usd: FAKE_COST_USD, input_tokens: FAKE_USAGE.prompt, cached_tokens: FAKE_USAGE.cached, output_tokens: FAKE_USAGE.reasoning + FAKE_USAGE.answer,
        reasoning_tokens: FAKE_USAGE.reasoning, charged_reservation: false, streamed: false });
      expect(line!.served_elsewhere).toBeUndefined();
      expect(line!.reason).toBeUndefined();
      expect(line!.actual_usd).toBeCloseTo(rowUsd(40, 32, 25), 15);
      expect(line!.actual_usd!).toBeLessThan(line!.reserved_usd!);
      // The reservation: the request's bytes at $0.30 and the 128,000-token cap at $1.20 per million.
      expect(line!.reserved_usd!).toBeGreaterThan(0.1536);
      expect(line!.reserved_usd!).toBeLessThan(0.1537);
      expect(Object.keys(meter.byModel)).toEqual([CELL_MODEL]);
      expect(meter.usd).toBeCloseTo(line!.actual_usd!, 15);
      expect(t.committed()).toBeCloseTo(line!.actual_usd!, 15);
    } finally { t.proxy.stop(); }
  });

  test('a streamed call gets include_usage and the pin, and the provider, generation id and cost are read from its chunks', async () => {
    const t = openrouterProxy();
    try {
      const res = await t.post(ROUTE, chat({ stream: true }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('"reasoning"');
      await t.proxy.finalize('trial-token:o');
      expect(t.seen().map(s => [s.stream, s.include_usage, s.max_completion_tokens, JSON.stringify(s.provider)])).toEqual([[true, true, 128_000, JSON.stringify(PINNED)]]);
      const [line] = t.usage();
      expect(line).toMatchObject({ provider: 'openrouter', streamed: true, served_provider: 'DeepSeek', generation_id: expect.stringMatching(/^gen-fake-/), openrouter_cost_usd: FAKE_COST_USD, charged_reservation: false, output_tokens: 25 });
      expect(line!.actual_usd).toBeCloseTo(rowUsd(40, 32, 25), 15);
    } finally { t.proxy.stop(); }
  });

  test('a provider object the harness sent is replaced by the pin, so a sort, an order or fallbacks never reach OpenRouter', async () => {
    const t = openrouterProxy();
    try {
      expect((await t.post(ROUTE, chat({ provider: { order: ['chutes'], allow_fallbacks: true, sort: 'price', max_price: { prompt: 9, completion: 9 } } }))).status).toBe(200);
      expect(t.seen().map(s => s.provider)).toEqual([PINNED]);
    } finally { t.proxy.stop(); }
  });

  test('routing fields, variant suffixes and every other model id are refused with HE-PROXY-008 before any upstream or reservation', async () => {
    const t = openrouterProxy({ models: null });
    try {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ models: [MODEL, 'deepseek/deepseek-v4-pro'] }, 'sets models'],
        [{ route: 'fallback' }, 'sets route'],
        [{ plugins: [{ id: 'web' }] }, 'sets plugins'],
        [{ tools: [{ type: 'function', function: { name: 'read' } }, { type: 'openrouter:web_search' }] }, 'tools[1] is an OpenRouter server tool'],
        [{ web_search_options: {} }, 'sets web_search_options'],
        [{ web_search_options: { search_context_size: 'low' } }, 'sets web_search_options'],
        [{ model: MODEL + ':online' }, 'variant suffix :online'],
        [{ model: MODEL + ':nitro' }, 'variant suffix :nitro'],
        [{ model: MODEL + ':floor' }, 'variant suffix :floor'],
        [{ model: 'deepseek/deepseek-v4.1-flash' }, 'not on the proxy\'s OpenRouter allowlist'],
        [{ model: 'deepseek/deepseek-v4.1-flash-20261017' }, 'not on the proxy\'s OpenRouter allowlist'],
        [{ model: 'openrouter/auto' }, 'not on the proxy\'s OpenRouter allowlist'],
      ];
      for (const [extra, why] of cases) {
        const res = await t.post(ROUTE, chat(extra));
        expect(res.status).toBe(400);
        const message = (await res.json()).error.message as string;
        expect(message).toContain('HE-PROXY-008');
        expect(message).toContain(why);
      }
      expect(t.seen()).toEqual([]);
      expect(t.committed()).toBe(0);
      const usage = t.usage();
      expect(usage.every(l => l.outcome === 'refused' && l.status === 400 && l.reason!.startsWith('HE-PROXY-008'))).toBe(true);
      expect(usage.map(l => l.model)).toEqual(cases.map(([extra]) => (extra.model as string | undefined) ?? MODEL));
      expect(openrouterRefusal({ model: MODEL }, MODEL)).toBeNull();
      expect(openrouterRefusal({ model: MODEL, web_search_options: null }, MODEL)).toBeNull();
    } finally { t.proxy.stop(); }
  });

  test('only POST /v1/chat/completions is routed, and a slot bound to the cell model refuses another priced model', async () => {
    const t = openrouterProxy();
    try {
      expect((await t.post('/o/openrouter/v1/responses', { model: MODEL, input: 'hi' })).status).toBe(403);
      expect((await t.post('/o/openrouter/v1/embeddings', { model: MODEL, input: 'hi' })).status).toBe(403);
      expect((await t.send('GET', '/o/openrouter/v1/models')).status).toBe(403);
      const off = await t.post('/o/openai/v1/chat/completions', { model: 'gpt-6-luna', messages: [] });
      expect(off.status).toBe(403);
      expect((await off.json()).error.message).toContain('openai:gpt-6-luna is not on slot o\'s model list (' + CELL_MODEL + ')');
      expect(t.seen()).toEqual([]);
      expect(t.committed()).toBe(0);
    } finally { t.proxy.stop(); }
  });

  test('without OPENROUTER_API_KEY in the proxy environment the call is refused 503 and nothing is reserved', async () => {
    const t = openrouterProxy({ extra: { env: { OPENAI_API_KEY: 'placeholder-openai' } } });
    try {
      const res = await t.post(ROUTE, chat());
      expect(res.status).toBe(503);
      expect((await res.json()).error.message).toContain('OPENROUTER_API_KEY is not set in the proxy\'s environment');
      expect(t.seen()).toEqual([]);
      expect(t.committed()).toBe(0);
    } finally { t.proxy.stop(); }
  });

  test('an OpenRouter 5xx keeps its reservation, a 4xx without usage settles at $0, and neither is marked served elsewhere', async () => {
    const answers = [Response.json({ error: { code: 503, message: 'no endpoints' } }, { status: 503 }), Response.json({ error: { code: 400, message: 'bad' } }, { status: 400 })];
    const t = openrouterProxy({ fetchImpl: (async () => answers.shift()!) as unknown as typeof fetch });
    try {
      expect((await t.post(ROUTE, chat())).status).toBe(503);
      expect((await t.post(ROUTE, chat())).status).toBe(400);
      const [down, bad] = t.usage();
      expect(down).toMatchObject({ status: 503, charged_reservation: true });
      expect(down!.actual_usd).toBe(down!.reserved_usd!);
      expect(bad).toMatchObject({ status: 400, actual_usd: 0, charged_reservation: false });
      expect([down!.served_elsewhere, bad!.served_elsewhere]).toEqual([undefined, undefined]);
    } finally { t.proxy.stop(); }
  });
});

describe('an answer from another provider (HE-PROXY-009)', () => {
  test('is passed through, settled at the row and marked, streamed or not, and makes the trial infra_error', async () => {
    const t = openrouterProxy({ upstream: elsewhere, log: elsewhereLog });
    try {
      expect((await t.post(ROUTE, chat())).status).toBe(200);
      await (await t.post(ROUTE, chat({ stream: true }))).text();
      await t.proxy.finalize('trial-token:o');
      const usage = t.usage();
      expect(usage).toHaveLength(2);
      for (const line of usage) {
        expect(line).toMatchObject({ outcome: 'forwarded', status: 200, served_provider: 'Chutes', served_elsewhere: true });
        expect(line.reason).toStartWith('HE-PROXY-009 OpenRouter answered from Chutes, not the pinned DeepSeek');
        expect(line.actual_usd).toBeCloseTo(rowUsd(40, 32, 25), 15);
      }
      const decided = trialTermination({ cellModel: CELL_MODEL, fromExits: 'completed', since: '1970-01-01T00:00:00Z', lines: usage });
      expect(decided.termination).toBe('infra_error');
      expect(decided.note).toContain('HE-PROXY-009 2 OpenRouter answer(s) came from Chutes');
    } finally { t.proxy.stop(); }
  });

  test('a DeepSeek answer, or a line from an earlier attempt, leaves the termination as the exits gave it; a cap stop still wins', () => {
    const deepseek = [{ at: '2026-11-08T10:00:00Z', provider: 'openrouter', outcome: 'forwarded', status: 200, served_provider: 'DeepSeek' }];
    expect(trialTermination({ cellModel: CELL_MODEL, fromExits: 'completed', since: '2026-11-08T00:00:00Z', lines: deepseek })).toEqual({ termination: 'completed' });
    const earlier = [{ at: '2026-11-07T10:00:00Z', provider: 'openrouter', outcome: 'forwarded', status: 200, served_provider: 'Chutes', served_elsewhere: true }];
    expect(trialTermination({ cellModel: CELL_MODEL, fromExits: 'harness_error', since: '2026-11-08T00:00:00Z', lines: earlier })).toEqual({ termination: 'harness_error' });
    expect(trialTermination({ cellModel: CELL_MODEL, fromExits: 'completed', since: '2026-11-07T00:00:00Z', lines: earlier, capStop: true })).toEqual({ termination: 'model_error' });
  });
});

describe('OPENROUTER_API_KEY reaches only the proxy process (canary)', () => {
  test('the canary goes upstream as the bearer and nowhere a harness or a receipt can read it', async () => {
    const canary = 'sk-or-v1-canary' + 'c0ffee'.repeat(8);
    const dir = mkdtempSync(join(tmp, 'canary-'));
    const log = join(dir, 'fake.ndjson');
    const upstream = startFakeOpenRouter({ host: '127.0.0.1', port: 0, log, expectKey: canary });
    const lease = BudgetRun.openLease({ runId: 'openrouter-canary', leaseUsd: 1, ledgerPath: join(dir, 'lease.sqlite') });
    const usageLog = join(dir, 'usage.ndjson');
    const proxy = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + upstream.port }, policy: { lease, env: { OPENROUTER_API_KEY: canary }, usageLog, maxOutputTokens: 128_000 } });
    proxy.start();
    proxy.bind('o', 'trial-token:o', TOKEN, [CELL_MODEL]);
    const client: string[] = [];
    try {
      for (const body of [chat(), chat({ stream: true }), chat({ model: MODEL + ':online' })]) {
        const res = await fetch('http://127.0.0.1:' + proxy.port + ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body) });
        client.push(JSON.stringify([...res.headers.entries()]), await res.text());
      }
      // A request without the slot's token is refused and never upstream, even though the proxy holds the key.
      const anon = await fetch('http://127.0.0.1:' + proxy.port + ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + canary }, body: JSON.stringify(chat()) });
      expect(anon.status).toBe(403);
      client.push(await anon.text());
      await proxy.finalize('trial-token:o');
      expect(lines<FakeOpenRouterRequest>(log).map(r => r.credential)).toEqual(['expected', 'expected']);
      for (const text of client) expect(text).not.toContain(canary);
      for (const f of readdirSync(dir)) if (statSync(join(dir, f)).isFile()) expect(readFileSync(join(dir, f), 'latin1')).not.toContain(canary);
      expect(readFileSync(usageLog, 'utf8')).not.toContain(TOKEN);
    } finally { proxy.stop(); upstream.stop(true); }
    // No harness file names the key: adapters, configs, compose files and images get the proxy URL and the per-trial token only.
    const named = spawnSync('grep', ['-rl', 'OPENROUTER_API_KEY', join(ROOT, 'harnesses')], { encoding: 'utf8' });
    expect(named.stdout.trim()).toBe('');
  });
});

describe('a preregistration with an OpenRouter cell', () => {
  const PREREG = (harness: string): Prereg => ({ schema_version: 1, run_id: 'openrouter-preflight', question: 'q', tasks: { hello: ['hello'] }, wall_clock_s: { hello: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [],
    cells: [{ id: 'o', harness, model: CELL_MODEL, slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 100_000, output_tokens: 10_000 }, harness_mode: 'process', adapter: 'harnesses/' + harness + '/adapter.sh' }] });
  const preflight = (harness: string, env: Record<string, string>, cmd: string[] = ['preflight']) => {
    const dir = mkdtempSync(join(tmp, 'run-'));
    const file = join(dir, 'prereg.json');
    writeFileSync(file, JSON.stringify(PREREG(harness)));
    const { prereg: p, sha256 } = loadPrereg(file);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(buildManifest(p, sha256)));
    const r = spawnSync(process.execPath, ['runner/run.ts', ...cmd, '--manifest', join(dir, 'manifest.json')], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, ...env } });
    return { code: r.status, out: r.stdout + r.stderr };
  };

  test('preflight and run require OPENROUTER_API_KEY, and with it refuse a harness whose pin declares no model_openrouter (HE-PIN-005)', () => {
    const missing = preflight('openclaw', {});
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain('HE-PROXY-001 cells o call OpenRouter and OPENROUTER_API_KEY is not set in this shell');
    for (const harness of ['_fake', 'qm']) {
      for (const cmd of [['preflight'], ['run', '--harness-mode', 'process']]) {
        const r = preflight(harness, { OPENROUTER_API_KEY: KEY }, cmd);
        expect(r.code).not.toBe(0);
        expect(r.out).toContain('HE-PIN-005 cells o (' + harness + ') call OpenRouter, but their harness pin declares no OpenRouter transport');
        expect(r.out).not.toContain(KEY);
      }
    }
    const run = preflight('hermes', {}, ['run', '--harness-mode', 'process']);
    expect(run.code).not.toBe(0);
    expect(run.out).toContain('HE-PROXY-001 cells o call OpenRouter and OPENROUTER_API_KEY is not set in this shell');
  }, 120_000);

  test('OpenClaw and Hermes declare model_openrouter; QM, whose multi-user worktree has no OpenRouter branch, and _fake do not', () => {
    const cells = ['openclaw', 'hermes', 'qm', '_fake', 'absent'].map((harness) => ({ id: harness, harness }));
    expect(openrouterCellsWithoutRoute(cells, ROOT).map((c) => c.id)).toEqual(['qm', '_fake', 'absent']);
  });

  test('the proxy CLI takes --upstream openrouter=<url> and a bind with a nested model id', async () => {
    expect(parseProxyArgs(['--budget-ledger', join(tmp, 'cli.sqlite'), '--lease-usd', '0.05', '--run-id', 'cli', '--upstream', 'openrouter=http://127.0.0.1:9/']).upstream).toEqual({ openrouter: 'http://127.0.0.1:9' });
    const lease = BudgetRun.openLease({ runId: 'openrouter-bind', leaseUsd: 1, ledgerPath: join(tmp, 'bind.sqlite') });
    const proxy = new MeteringProxy({ controlToken: 'c', policy: { lease, env: FAKE_ENV } });
    proxy.start();
    try {
      const bind = (models: unknown) => fetch('http://127.0.0.1:' + proxy.port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': 'c' }, body: JSON.stringify({ slot: 's', key: 'k', models }) });
      expect((await bind([CELL_MODEL, 'anthropic:claude-opus-5-5'])).status).toBe(200);
      for (const bad of [['openrouter:deepseek//x'], ['openrouter:/x'], ['openrouter:x/'], ['no-provider']]) expect((await bind(bad)).status).toBe(400);
    } finally { proxy.stop(); }
  });
});
