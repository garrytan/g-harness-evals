/**
 * internal-task PR A: the Particle-1 route through the metering proxy, its price row, the preregistration gate and the key
 * preflight. Keyless: the upstream is tests/fixtures/particle/fake-particle.ts on the loopback (or a fetch stand-in),
 * every key is a placeholder, and the one spawned process gets an environment built from scratch (PATH and HOME, plus the
 * placeholder it needs).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, chatPrice, closeLedgers, ledgerStatus, priceRequest, reservationUsd } from '../runner/ledger/budget-ledger.ts';
import { canonicalLookup } from '../runner/pricing/model-pricing.ts';
import { MeteringProxy, parseProxyArgs, UPSTREAM, type LeasePolicy, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { buildManifest, loadPrereg, particleCellsWithoutRoute, RunnerError, type Prereg } from '../runner/run.ts';
import { FAKE_USAGE, startFakeParticle, type FakeParticleRequest } from './fixtures/particle/fake-particle.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'particle-route-'));
const KEY = 'placeholder-particle';
const FAKE_ENV = { PARTICLE_API_KEY: KEY, OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic', VOYAGE_API_KEY: 'placeholder-voyage' };
const fakeLog = join(tmp, 'fake.ndjson');
const fake = startFakeParticle({ host: '127.0.0.1', port: 0, log: fakeLog, expectKey: KEY });
afterAll(() => { fake.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const TOKEN = 'trial-token:p.0123456789abcdef0123456789abcdef';
const lines = <T>(path: string): T[] => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T); } catch { return []; } };
/** Particle-1 at peak: uncached input $0.25, cached input $0.03, output (reasoning included) $1.00 per million tokens. */
const particleUsd = (prompt: number, cached: number, output: number) => ((prompt - cached) * 0.25 + cached * 0.03 + output * 1) / 1e6;
let n = 0;

/** A lease proxy (output cap 128000, as every shard runs it) whose particle upstream is the fake, with slot p bound to a
 *  per-trial token and the cell's model list. */
function particleProxy(extra: Partial<LeasePolicy> = {}, models: string[] | null = ['particle:particle-1'], fetchImpl?: typeof fetch) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'particle-' + id, leaseUsd: 1, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + id + '.ndjson');
  const upstream = 'http://127.0.0.1:' + fake.port;
  const proxy = new MeteringProxy({ fetchImpl, upstream: { particle: upstream, openai: upstream }, policy: { lease, env: FAKE_ENV, usageLog, maxOutputTokens: 128_000, ...extra } });
  proxy.start();
  proxy.bind('p', 'trial-token:p', TOKEN, models);
  const before = lines(fakeLog).length;
  const send = (method: string, path: string, body?: unknown) => fetch('http://127.0.0.1:' + proxy.port + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    proxy, usageLog, send, post: (path: string, body: unknown) => send('POST', path, body),
    seen: () => lines<FakeParticleRequest>(fakeLog).slice(before), usage: () => lines<UsageLine>(usageLog),
    committed: () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd,
  };
}
const ROUTE = '/p/particle/v1/chat/completions';
const chat = (extra: Record<string, unknown> = {}) => ({ model: 'particle-1', messages: [{ role: 'user', content: 'Say ok.' }], reasoning_effort: 'medium', ...extra });

describe('Particle-1 through the metering proxy in lease mode', () => {
  test('a non-streamed call is forwarded with the proxy key and max_completion_tokens at the cap, and settles from its usage below the reservation', async () => {
    const t = particleProxy();
    try {
      const res = await t.post(ROUTE, chat());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model).toBe('particle-ai/particle-1');
      expect(body.choices[0].message.content).toBe('ok');
      expect(body.choices[0].message.reasoning_content).toBeString();
      expect(t.seen()).toEqual([{ method: 'POST', path: '/v1/chat/completions', model: 'particle-1', stream: false, include_usage: false, max_completion_tokens: 128_000, max_tokens: null, reasoning_effort: 'medium', tools: 0, credential: 'expected' }]);
      const meter = await t.proxy.finalize('trial-token:p');
      const [line, ...rest] = t.usage();
      expect(rest).toEqual([]);
      expect(line).toMatchObject({ key: 'trial-token:p', provider: 'particle', route: '/v1/chat/completions', model: 'particle-1', served_model: 'particle-ai/particle-1', outcome: 'forwarded', status: 200,
        input_tokens: FAKE_USAGE.prompt, cached_tokens: FAKE_USAGE.cached, output_tokens: FAKE_USAGE.reasoning + FAKE_USAGE.answer, charged_reservation: false, streamed: false, reasoning_effort: 'medium' });
      expect(line!.reason).toBeUndefined();
      expect(line!.actual_usd).toBeCloseTo(particleUsd(40, 32, 25), 12);
      expect(line!.actual_usd!).toBeGreaterThan(0);
      expect(line!.actual_usd!).toBeLessThan(line!.reserved_usd!);
      // One request at the 128,000-token output cap reserves its output at $1.00 per million plus its input bytes at $0.25.
      expect(line!.reserved_usd!).toBeGreaterThan(0.128);
      expect(line!.reserved_usd!).toBeLessThan(0.1281);
      expect(Object.keys(meter.byModel)).toEqual(['particle:particle-1']);
      expect(meter.usd).toBeCloseTo(line!.actual_usd!, 12);
      expect(meter.unpriced).toBe(0);
      expect(t.committed()).toBeCloseTo(line!.actual_usd!, 12);
      expect(readFileSync(t.usageLog, 'utf8')).not.toContain(KEY);
      expect(readFileSync(t.usageLog, 'utf8')).not.toContain(TOKEN);
    } finally { t.proxy.stop(); }
  });

  test('a streamed call gets stream_options.include_usage, passes reasoning_content then content through, and settles from its usage chunk below the reservation', async () => {
    const t = particleProxy();
    try {
      for (const extra of [{ stream: true }, { stream: true, stream_options: { include_usage: false } }]) {
        const res = await t.post(ROUTE, chat(extra));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const text = await res.text();
        expect(text).toContain('"reasoning_content"');
        expect(text.indexOf('"reasoning_content"')).toBeLessThan(text.indexOf('"content":"ok"'));
        expect(text).toContain('"usage"');
        await t.proxy.finalize('trial-token:p');
      }
      expect(t.seen().map(s => [s.stream, s.include_usage, s.max_completion_tokens, s.credential])).toEqual([[true, true, 128_000, 'expected'], [true, true, 128_000, 'expected']]);
      const usage = t.usage();
      expect(usage).toHaveLength(2);
      for (const line of usage) {
        expect(line).toMatchObject({ provider: 'particle', model: 'particle-1', served_model: 'particle-ai/particle-1', outcome: 'forwarded', status: 200, streamed: true, charged_reservation: false,
          input_tokens: 40, cached_tokens: 32, output_tokens: 25 });
        expect(line.reason).toBeUndefined();
        expect(line.actual_usd).toBeCloseTo(particleUsd(40, 32, 25), 12);
        expect(line.actual_usd!).toBeLessThan(line.reserved_usd!);
      }
      expect(t.committed()).toBeCloseTo(2 * particleUsd(40, 32, 25), 12);
    } finally { t.proxy.stop(); }
  });

  test('a stated cap is kept and priced, one above the cell cap is refused, and a cap the reasoning uses up still bills its tokens as output', async () => {
    const t = particleProxy();
    try {
      const short = await t.post(ROUTE, chat({ max_completion_tokens: 16 }));
      const body = await short.json();
      expect(body.choices[0]).toMatchObject({ message: { content: '' }, finish_reason: 'length' });
      expect((await t.post(ROUTE, chat({ max_completion_tokens: 2048 }))).status).toBe(200);
      const over = await t.post(ROUTE, chat({ max_tokens: 200_000 }));
      expect(over.status).toBe(400);
      expect((await over.json()).error.message).toContain('above this cell\'s cap of 128000');
      expect(t.seen().map(s => [s.max_completion_tokens, s.max_tokens])).toEqual([[16, null], [2048, null]]);
      const [cut, stated, refused] = t.usage();
      expect(cut).toMatchObject({ output_tokens: 16, charged_reservation: false });
      expect(cut!.actual_usd).toBeCloseTo(particleUsd(40, 32, 16), 12);
      const bytes = Buffer.byteLength(JSON.stringify(chat({ max_completion_tokens: 2048 })));
      expect(stated!.reserved_usd).toBeCloseTo(((bytes + 64) * 0.25 + 2048 * 1) / 1e6, 12);
      expect(refused).toMatchObject({ outcome: 'refused', status: 400 });
    } finally { t.proxy.stop(); }
  });

  test('a request stating max_tokens beside a larger max_completion_tokens reserves the larger, so it cannot reserve one token and be allowed 2048', async () => {
    const t = particleProxy();
    try {
      const body = chat({ max_tokens: 1, max_completion_tokens: 2048 });
      expect((await t.post(ROUTE, body)).status).toBe(200);
      expect(t.seen().map(s => [s.max_tokens, s.max_completion_tokens])).toEqual([[1, 2048]]);
      const [line] = t.usage();
      expect(line!.reserved_usd).toBeCloseTo(((Buffer.byteLength(JSON.stringify(body)) + 64) * 0.25 + 2048 * 1) / 1e6, 12);
      expect(priceRequest('https://api.openai.com/v1/chat/completions', { model: 'gpt-6-luna', messages: [], max_completion_tokens: 10, max_tokens: 500 })!.maxOutputTokens).toBe(500);
      expect(priceRequest('https://api.anthropic.com/v1/messages', { model: 'claude-opus-5-5', messages: [], max_tokens: 700 })!.maxOutputTokens).toBe(700);
    } finally { t.proxy.stop(); }
  });

  test('a limit in a field chat completions does not honor (max_output_tokens) bounds nothing: the cap is injected as max_completion_tokens and reserved', async () => {
    const t = particleProxy({ maxOutputTokens: 64 });
    try {
      const body = chat({ max_output_tokens: 1 });
      expect((await t.post(ROUTE, body)).status).toBe(200);
      expect(t.seen().map(s => [s.max_tokens, s.max_completion_tokens])).toEqual([[null, 64]]);
      const [line] = t.usage();
      expect(line!.reserved_usd).toBeCloseTo(((Buffer.byteLength(JSON.stringify({ ...body, max_completion_tokens: 64 })) + 64) * 0.25 + 64 * 1) / 1e6, 12);
      expect(line!.output_tokens).toBe(25);
      expect(line!.actual_usd!).toBeLessThan(line!.reserved_usd!);
      // A zero, negative or fractional limit would shrink the reservation without bounding the output, so it is refused.
      for (const limit of [{ max_completion_tokens: 0 }, { max_tokens: -1 }, { max_completion_tokens: 10.5 }]) {
        const res = await t.post(ROUTE, chat(limit));
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toContain('an output limit must be a positive whole number of tokens');
      }
      expect(t.seen()).toHaveLength(1);
    } finally { t.proxy.stop(); }
  });

  test('only POST /v1/chat/completions is routed: Responses, embeddings and model listings are refused before the upstream', async () => {
    const t = particleProxy();
    try {
      expect((await t.post('/p/particle/v1/responses', { model: 'particle-1', input: 'hi' })).status).toBe(403);
      expect((await t.post('/p/particle/v1/embeddings', { model: 'particle-1', input: 'hi' })).status).toBe(403);
      expect((await t.send('GET', '/p/particle/v1/models')).status).toBe(403);
      expect(t.seen()).toEqual([]);
      expect(t.usage().map(l => [l.outcome, l.route])).toEqual([['refused', '/v1/responses'], ['refused', '/v1/embeddings'], ['refused', '/v1/models']]);
      expect(t.committed()).toBe(0);
    } finally { t.proxy.stop(); }
  });

  test('every model but particle-1 is refused before any upstream: the echoed id, another Particle id, and a priced model off the slot list or the allowlist', async () => {
    const t = particleProxy();
    try {
      for (const model of ['particle-ai/particle-1', 'particle-2']) {
        const res = await t.post(ROUTE, chat({ model }));
        expect(res.status).toBe(402);
        expect((await res.json()).error.message).toContain('no chat price for particle:' + model);
      }
      const offList = await t.post('/p/openai/v1/chat/completions', chat({ model: 'gpt-6-luna' }));
      expect(offList.status).toBe(403);
      expect((await offList.json()).error.message).toContain('openai:gpt-6-luna is not on slot p\'s model list (particle:particle-1)');
      expect(t.seen()).toEqual([]);
      expect(t.committed()).toBe(0);
    } finally { t.proxy.stop(); }
    const a = particleProxy({ allowModels: ['openai:gpt-6-luna'] }, null);
    try {
      const res = await a.post(ROUTE, chat());
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toContain('particle:particle-1 is not on this cell\'s model allowlist');
      expect(a.seen()).toEqual([]);
    } finally { a.proxy.stop(); }
  });

  test('without PARTICLE_API_KEY in the proxy environment a Particle call is refused 503 and nothing is reserved', async () => {
    const t = particleProxy({ env: { OPENAI_API_KEY: 'placeholder-openai' } });
    try {
      const res = await t.post(ROUTE, chat());
      expect(res.status).toBe(503);
      expect((await res.json()).error.message).toContain('PARTICLE_API_KEY is not set in the proxy\'s environment');
      expect(t.seen()).toEqual([]);
      expect(t.committed()).toBe(0);
    } finally { t.proxy.stop(); }
  });

  test('a Particle 5xx keeps its reservation even in the envelope an OpenAI 503 settles at $0 for; a 4xx without usage settles at $0', async () => {
    const answers = [Response.json({ error: { type: 'server_error', code: null, message: 'down' } }, { status: 503 }), Response.json({ error: { type: 'invalid_request_error', code: 'unsupported_parameter' } }, { status: 400 })];
    const t = particleProxy({}, ['particle:particle-1'], (async () => answers.shift()!) as unknown as typeof fetch);
    try {
      expect((await t.post(ROUTE, chat())).status).toBe(503);
      expect((await t.post(ROUTE, chat())).status).toBe(400);
      const [down, bad] = t.usage();
      expect(down).toMatchObject({ provider: 'particle', status: 503, charged_reservation: true, reason: 'the response carried no usage' });
      expect(down!.actual_usd).toBe(down!.reserved_usd!);
      expect(bad).toMatchObject({ status: 400, actual_usd: 0, charged_reservation: false });
    } finally { t.proxy.stop(); }
  });
});

describe('the Particle-1 price row', () => {
  test('particle:particle-1 has one canonical row at peak rates, and the ledger and the proxy price from it', () => {
    expect(canonicalLookup('particle:particle-1')).toEqual({ input: 0.25, output: 1, cache_read: 0.03 });
    expect(chatPrice('particle:particle-1')).toBe(canonicalLookup('particle:particle-1')!);
    expect(UPSTREAM.particle).toBe('https://api.particle.ai');
    const body = { model: 'particle-1', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 128_000 };
    const price = priceRequest('https://api.particle.ai/v1/chat/completions', body)!;
    expect(price).toMatchObject({ provider: 'particle', model: 'particle-1', kind: 'chat', input: 0.25, output: 1, cache_read: 0.03, cacheWritePremium: false, maxOutputTokens: 128_000 });
    // The plan's one-request reservation for a Particle cell (decision 9): 50,000 input tokens and 128,000 output tokens.
    expect(reservationUsd({ ...price, inputTokens: 50_000 })).toBeCloseTo(0.1405, 10);
    expect(() => priceRequest('https://api.particle.ai/v1/chat/completions', { ...body, model: 'particle-ai/particle-1' })).toThrow('no chat price for particle:particle-ai/particle-1');
  });

  test('the proxy CLI takes --upstream particle=<url>', () => {
    const a = parseProxyArgs(['--budget-ledger', join(tmp, 'cli.sqlite'), '--lease-usd', '0.05', '--run-id', 'cli', '--upstream', 'particle=http://127.0.0.1:9/']);
    expect(a.upstream).toEqual({ particle: 'http://127.0.0.1:9' });
  });
});

const PARTICLE_CELL = { id: 'p', harness: 'openclaw', model: 'particle:particle-1', slice: 'hello' as const, split: 'dev' as const, repetitions: 5, ceiling: { input_tokens: 100_000, output_tokens: 10_000 } };
const prereg = (cells: Prereg['cells']): Prereg => ({ schema_version: 1, run_id: 'particle-test', question: 'q', tasks: { hello: ['hello', 'hello-2'] }, cells, wall_clock_s: { hello: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] });
const writePrereg = (p: Prereg) => { const file = join(mkdtempSync(join(tmp, 'prereg-')), 'prereg.json'); writeFileSync(file, JSON.stringify(p)); return file; };

describe('a preregistration with a Particle-1 cell', () => {
  test('passes loadPrereg and buildManifest through the price table (HE-PIN-002), with its ceiling at peak rates', () => {
    const { prereg: p, sha256 } = loadPrereg(writePrereg(prereg([PARTICLE_CELL])));
    const m = buildManifest(p, sha256, '2026-10-31T00:00:00Z');
    expect(m.trials).toHaveLength(2 * 5);
    // 100,000 input tokens at $0.25 plus 10,000 output tokens at $1.00 per million: $0.035 a trial, 10 trials.
    expect(m.per_cell_ceiling_usd.p).toBeCloseTo(0.35, 10);
    try { loadPrereg(writePrereg(prereg([{ ...PARTICLE_CELL, model: 'particle:particle-one' }]))); }
    catch (e) { expect(e).toBeInstanceOf(RunnerError); expect((e as RunnerError).code).toBe('HE-PIN-002'); return; }
    throw new Error('an unpriced Particle id was not refused');
  });

  test('preflight and run require PARTICLE_API_KEY for a cell that calls Particle, and preflight does not for one that does not', () => {
    const preflight = (cell: Prereg['cells'][number], env: Record<string, string>, cmd: string[] = ['preflight']) => {
      const { prereg: p, sha256 } = loadPrereg(writePrereg(prereg([cell])));
      const dir = mkdtempSync(join(tmp, 'run-'));
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(buildManifest(p, sha256)));
      const r = spawnSync(process.execPath, ['runner/run.ts', ...cmd, '--manifest', join(dir, 'manifest.json')], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, ...env } });
      return { code: r.status, out: r.stdout + r.stderr };
    };
    const processCell = { ...PARTICLE_CELL, harness_mode: 'process' as const, adapter: 'harnesses/openclaw/adapter.sh' };
    const missing = preflight(processCell, {});
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain('HE-PROXY-001 cells p call Particle and PARTICLE_API_KEY is not set in this shell');
    // With the key set, a cell on a harness whose pin declares no Particle transport is still refused (HE-PIN-003). _fake's pin
    // never routes Particle; OpenClaw, Hermes and QM gain model_particle in #170, so they are not used for this row.
    const unrouted = { ...PARTICLE_CELL, harness: '_fake', harness_mode: 'process' as const, adapter: 'harnesses/_fake/adapter.sh' };
    for (const cmd of [['preflight'], ['run', '--harness-mode', 'process']]) {
      const set = preflight(unrouted, { PARTICLE_API_KEY: KEY }, cmd);
      expect(set.code).not.toBe(0);
      expect(set.out).toContain('HE-PIN-003 cells p (_fake) call Particle, but their harness pin declares no Particle transport');
      expect(set.out).not.toContain(KEY);
    }
    const anthropic = preflight({ ...processCell, model: 'anthropic:claude-opus-5-5' }, {});
    expect(anthropic.out).toContain('PREFLIGHT: ok run=particle-test');
    expect(anthropic.out).not.toContain('PARTICLE_API_KEY');
    // A scripted cell plays a script and calls no model, so it needs no key whatever model it names.
    const scripted = preflight({ ...PARTICLE_CELL, harness: 'scripted', harness_mode: 'scripted', script: 'oracle' }, {});
    expect(scripted.out).not.toContain('PARTICLE_API_KEY');
    // A resumed shard skips a preflight that already passed (scripts/run-shard.sh), so run checks before anything starts.
    const run = preflight(processCell, {}, ['run', '--harness-mode', 'process']);
    expect(run.code).not.toBe(0);
    expect(run.out).toContain('HE-PROXY-001 cells p call Particle and PARTICLE_API_KEY is not set in this shell');
  }, 120_000);

  test('a Particle cell needs a harness whose pin declares model_particle', () => {
    const root = mkdtempSync(join(tmp, 'pins-'));
    const pin = (h: string, body: object) => { mkdirSync(join(root, 'harnesses', h), { recursive: true }); writeFileSync(join(root, 'harnesses', h, 'pin.json'), JSON.stringify(body)); };
    pin('routed', { model_particle: { api: 'chat_completions' } });
    pin('plain', { version: '1' });
    const cells = [{ id: 'a', harness: 'routed' }, { id: 'b', harness: 'plain' }, { id: 'c', harness: 'absent' }];
    expect(particleCellsWithoutRoute(cells, root).map((c) => c.id)).toEqual(['b', 'c']);
    expect(particleCellsWithoutRoute([{ id: 'p', harness: '_fake' }], ROOT).map((c) => c.id)).toEqual(['p']);
  });
});

describe('the other providers are unchanged', () => {
  test('OpenAI chat streams still get include_usage and max_completion_tokens, Responses max_output_tokens, Anthropic max_tokens, Voyage no cap; no line carries served_model', async () => {
    const bodies: Array<{ url: string; body: any }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      return Response.json({ model: 'echoed-model', usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }) as unknown as typeof fetch;
    const t = particleProxy({ maxOutputTokens: 1000 }, null, fetchImpl);
    try {
      expect((await t.post('/p/openai/v1/chat/completions', { model: 'gpt-6-luna', messages: [], stream: true })).status).toBe(200);
      expect((await t.post('/p/openai/v1/responses', { model: 'gpt-6-luna', input: 'hi' })).status).toBe(200);
      expect((await t.post('/p/anthropic/v1/messages', { model: 'claude-opus-5-5', messages: [], stream: true })).status).toBe(200);
      expect((await t.post('/p/voyage/v1/embeddings', { model: 'voyage-4-lite', input: ['hi'] })).status).toBe(200);
      expect(bodies.map(b => b.url.replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/embeddings']);
      expect(bodies[0]!.body).toMatchObject({ stream_options: { include_usage: true }, max_completion_tokens: 1000 });
      expect(bodies[1]!.body).toMatchObject({ max_output_tokens: 1000 });
      expect(bodies[1]!.body.stream_options).toBeUndefined();
      expect(bodies[2]!.body).toMatchObject({ max_tokens: 1000 });
      expect(bodies[2]!.body.stream_options).toBeUndefined();
      expect(Object.keys(bodies[3]!.body).sort()).toEqual(['input', 'model']);
      const usage = t.usage();
      expect(usage.map(l => [l.provider, l.outcome])).toEqual([['openai', 'forwarded'], ['openai', 'forwarded'], ['anthropic', 'forwarded'], ['voyage', 'forwarded']]);
      expect(usage.every(l => !('served_model' in l))).toBe(true);
    } finally { t.proxy.stop(); }
  });

  test('a zero, negative or fractional output limit is refused on the Anthropic and Responses routes too, and nothing is forwarded', async () => {
    let forwarded = 0;
    const t = particleProxy({}, null, (async () => { forwarded++; return Response.json({}); }) as unknown as typeof fetch);
    try {
      for (const [path, body] of [['/p/anthropic/v1/messages', { model: 'claude-opus-5-5', messages: [], max_tokens: 0 }], ['/p/openai/v1/responses', { model: 'gpt-6-luna', input: 'hi', max_output_tokens: 2.5 }], ['/p/openai/v1/chat/completions', { model: 'gpt-6-luna', messages: [], max_completion_tokens: -1 }]] as const) {
        const res = await t.post(path, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toContain('an output limit must be a positive whole number of tokens');
      }
      expect(forwarded).toBe(0);
    } finally { t.proxy.stop(); }
  });
});
