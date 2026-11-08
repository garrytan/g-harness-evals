/**
 * internal-task: request-body capture for the contamination audit. Keyless: the upstream is a fake fetch and every key is a
 * canary placeholder that must never appear in a capture file.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, parseProxyArgs, type LeasePolicy, type Meter, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { DEFAULT_CAPTURE_MAX_BYTES } from '../runner/proxy/capture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'proxy-capture-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const CANARY = { ANTHROPIC_API_KEY: 'sk-' + 'ant-canary-anthropic-7c41d2', OPENAI_API_KEY: 'sk-canary-openai-93be07', GEMINI_API_KEY: 'canary-goog-5a10' };
const TOKEN = 'tok-' + 'canary-slot-e8f2';
const QUERY_KEY = 'canary-query-key-1d9a';
let n = 0;

const chainKey = (line: string) => createHash('sha256').update(line, 'utf8').digest('hex').slice(0, 16);

/** The checks scripts/frontier-harbor/audit.ts readCapture makes: seq is the line index, prev chains, and every request line is counted. */
function readChain(file: string) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  let prev = '', ok = true, truncated = false, requests = 0;
  const entries = lines.map((raw, i) => {
    const e = JSON.parse(raw) as { seq: number; prev: string; route?: string; body?: Record<string, unknown>; truncated?: boolean };
    ok = ok && e.seq === i && e.prev === prev;
    prev = chainKey(raw);
    if (e.truncated) truncated = true;
    else if (e.route !== undefined) requests++;
    return e;
  });
  return { ok, truncated, requests, entries };
}

function start(extra: Partial<LeasePolicy> = {}, respond: () => Response | Promise<Response> = () => Response.json({ usage: { input_tokens: 20, output_tokens: 5, prompt_tokens: 20, completion_tokens: 5 } })) {
  const seen: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond();
  }) as unknown as typeof fetch;
  const root = join(tmp, `root-${++n}`);
  const lease = BudgetRun.openLease({ runId: `capture-${n}`, leaseUsd: 20, ledgerPath: join(tmp, `lease-${n}.sqlite`) });
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: CANARY, usageLog, maxOutputTokens: 4096, captureRoot: root, ...extra } });
  proxy.start();
  const base = `http://127.0.0.1:${proxy.port}`;
  const control = async (path: string, body: unknown) => {
    const res = await fetch(`${base}/__proxy/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  const send = async (slot: string, path: string, body: unknown) => {
    const res = await fetch(`${base}/${slot}${path}?key=${QUERY_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': TOKEN, authorization: `Bearer ${TOKEN}`, 'x-goog-api-key': TOKEN }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  const get = async (slot: string, path: string) => (await fetch(`${base}/${slot}${path}?key=${QUERY_KEY}`, { headers: { authorization: `Bearer ${TOKEN}` } })).status;
  const lines = () => existsSync(usageLog) ? readFileSync(usageLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as UsageLine) : [];
  return { proxy, seen, root, lease, control, send, get, lines };
}

const messages = (text: string) => ({ model: 'claude-opus-5-5', max_tokens: 1000, output_config: { effort: 'high' }, messages: [{ role: 'user', content: text }] });
const responses = { model: 'gpt-6.1-sol', reasoning: { effort: 'high' }, input: 'Fix the failing test.' };
const chat = { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 500 };

describe('request-body capture', () => {
  beforeEach(() => closeLedgers());

  test('every forwarded body is chained into the trial\'s proxy-requests.ndjson as forwarded, and the count matches usage.requests', async () => {
    const p = start();
    try {
      expect((await p.control('bind', { slot: 's', key: 'trial-token:a', token: TOKEN, capture: 'trials/a' })).status).toBe(200);
      for (const [path, body] of [['/anthropic/v1/messages', messages('one')], ['/openai/v1/responses', responses], ['/openai/v1/chat/completions', chat]] as const) {
        expect((await p.send('s', path, body)).status).toBe(200);
      }
      expect(await p.get('s', '/openai/v1/models')).toBe(200);
      const meter = (await p.control('finalize', { key: 'trial-token:a' })).body as Meter;
      const file = join(p.root, 'trials/a/proxy-requests.ndjson');
      const c = readChain(file);
      expect(c).toMatchObject({ ok: true, truncated: false, requests: 4 });
      expect(c.requests).toBe(meter.requests);
      expect(c.entries.map((e) => e.route)).toEqual(['/v1/messages', '/v1/responses', '/v1/chat/completions', '/v1/models']);
      expect(c.entries.map((e) => e.body)).toEqual(p.seen.map((s) => s.body ?? null));
      expect(c.entries[1]!.body).toMatchObject({ max_output_tokens: 4096, reasoning: { effort: 'high' } });
      expect(p.seen.every((s) => s.url.includes(`key=${QUERY_KEY}`))).toBe(true);
    } finally { p.proxy.stop(); }
  });

  test('no canary key, slot token or key= query value ever reaches the capture', async () => {
    const p = start();
    try {
      await p.control('bind', { slot: 's', key: 'trial-token:b', token: TOKEN, capture: 'b' });
      await p.send('s', '/anthropic/v1/messages', messages('two'));
      await p.send('s', '/openai/v1/responses', responses);
      await p.control('finalize', { key: 'trial-token:b' });
      expect(p.seen[0]!.headers.get('x-api-key')).toBe(CANARY.ANTHROPIC_API_KEY);
      const text = readFileSync(join(p.root, 'b/proxy-requests.ndjson'), 'utf8');
      for (const secret of [...Object.values(CANARY), TOKEN, QUERY_KEY, 'canary']) expect(text).not.toContain(secret);
      for (const header of ['x-api-key', 'authorization', 'x-goog-api-key', 'key=']) expect(text.toLowerCase()).not.toContain(header);
    } finally { p.proxy.stop(); }
  });

  test('at the size cap a chained truncated line is written once and requests keep flowing', async () => {
    const p = start({ captureMaxBytes: 700 });
    try {
      await p.control('bind', { slot: 's', key: 'trial-token:c', capture: 'c' });
      for (let i = 0; i < 6; i++) expect((await p.send('s', '/anthropic/v1/messages', messages(`request ${i} ${'x'.repeat(100)}`))).status).toBe(200);
      await p.control('finalize', { key: 'trial-token:c' });
      const file = join(p.root, 'c/proxy-requests.ndjson');
      const c = readChain(file);
      expect(c.ok).toBe(true);
      expect(c.truncated).toBe(true);
      expect(c.requests).toBeGreaterThan(0);
      expect(c.requests).toBeLessThan(6);
      expect(c.entries.at(-1)).toEqual({ seq: c.entries.length - 1, prev: c.entries.length > 1 ? chainKey(readFileSync(file, 'utf8').split('\n').at(-3)!) : '', truncated: true });
      expect(c.entries.filter((e) => e.truncated)).toHaveLength(1);
      expect(p.seen).toHaveLength(6);
    } finally { p.proxy.stop(); }
  });

  test('a slot bound again for the same trial continues the chain; a failed send is captured and counted', async () => {
    let fail = false;
    const p = start({}, () => { if (fail) throw new Error('connection reset'); return Response.json({ usage: { input_tokens: 20, output_tokens: 5 } }); });
    try {
      await p.control('bind', { slot: 's', key: 'trial-token:d', capture: 'd' });
      await p.send('s', '/anthropic/v1/messages', messages('first'));
      await p.control('unbind', { slot: 's' });
      await p.control('finalize', { key: 'trial-token:d' });
      await p.control('bind', { slot: 's2', key: 'trial-token:d', capture: 'd' });
      fail = true;
      expect((await p.send('s2', '/anthropic/v1/messages', messages('second'))).status).toBe(502);
      const meter = (await p.control('finalize', { key: 'trial-token:d' })).body as Meter;
      const c = readChain(join(p.root, 'd/proxy-requests.ndjson'));
      expect(c).toMatchObject({ ok: true, requests: 2 });
      expect(meter.requests).toBe(1);
      expect(p.lines().map((l) => l.outcome)).toEqual(['forwarded', 'failed']);
    } finally { p.proxy.stop(); }
  });

  test('a capture that cannot be written refuses the request with HE-PROXY-007 before sending it and releases the reservation', async () => {
    const p = start();
    try {
      await p.control('bind', { slot: 's', key: 'trial-token:e', capture: 'e' });
      rmSync(join(p.root, 'e'), { recursive: true, force: true });
      const r = await p.send('s', '/anthropic/v1/messages', messages('lost'));
      expect(r.status).toBe(500);
      expect(r.body.error.message).toContain('HE-PROXY-007');
      expect(p.seen).toHaveLength(0);
      expect(ledgerStatus({ ledgerPath: p.lease.ledgerPath, runId: p.lease.runId }).run!.committed_usd).toBe(0);
      expect(p.lines()).toMatchObject([{ outcome: 'refused', status: 500 }]);
    } finally { p.proxy.stop(); }
  });

  test('off by default: no capture root refuses a capture bind, a slot bound without capture writes nothing, and a path outside the root is refused', async () => {
    const off = start({ captureRoot: undefined });
    try {
      expect((await off.control('bind', { slot: 's', key: 'k', capture: 'x' })).body.error.message).toContain('needs a lease proxy started with --capture-bodies');
      expect(off.proxy.status()).toMatchObject({ capture_bodies: false });
    } finally { off.proxy.stop(); }
    const p = start();
    try {
      expect(p.proxy.status()).toMatchObject({ capture_bodies: true });
      for (const bad of ['../escape', '/etc', '', '.', 'a/../..', 7]) expect((await p.control('bind', { slot: 's', key: 'k', capture: bad })).status).toBe(400);
      await p.control('bind', { slot: 's', key: 'trial-token:f' });
      expect((await p.send('s', '/anthropic/v1/messages', messages('plain'))).status).toBe(200);
      expect(existsSync(p.root)).toBe(false);
    } finally { p.proxy.stop(); }
  });
});

describe('capture flags', () => {
  const base = ['--budget-ledger', join(tmp, 'cli.sqlite'), '--lease-usd', '1', '--run-id', 'cli'];
  test('--capture-bodies and --capture-max-bytes are parsed, off by default, and a bad cap is refused', () => {
    expect(parseProxyArgs(base)).toMatchObject({ captureBodies: null, captureMaxBytes: null });
    expect(parseProxyArgs([...base, '--capture-bodies', '/runs/r1', '--capture-max-bytes', '1048576'])).toMatchObject({ captureBodies: '/runs/r1', captureMaxBytes: 1_048_576 });
    expect(() => parseProxyArgs([...base, '--capture-bodies', '/runs/r1', '--capture-max-bytes', '0'])).toThrow('--capture-max-bytes must be');
    expect(() => parseProxyArgs([...base, '--capture-max-bytes', '100'])).toThrow('needs --capture-bodies');
    expect(DEFAULT_CAPTURE_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
});
