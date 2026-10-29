// A small model client for the v0.3 generators (internal-task). Every paid call goes through runner/proxy/metering-proxy.ts,
// started here as a child process in lease mode on the loopback with its own ledger file, a random control token and a
// local usage log; one slot is bound without a token for the life of the client. Provider keys live only in the
// proxy's environment. This module never prints, logs or writes a key, a request body or a response body, except the
// response text it caches under the caller's cache directory.
//
// Responses are cached by sha256 of (model, system, prompt, maxTokens); a cache hit makes no call. Tests inject a
// transport instead of starting the proxy.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ALLOWED_MODELS = ['openai:gpt-6.1-sol', 'anthropic:claude-opus-5-5'] as const;
export type ModelId = (typeof ALLOWED_MODELS)[number];

export interface CompleteRequest { model: ModelId; system: string; prompt: string; maxTokens: number }
export type Transport = (req: CompleteRequest) => Promise<string>;

export interface LlmStats { calls: number; cache_hits: number; usd: number }

export interface Llm {
  complete(req: CompleteRequest): Promise<string>;
  stats(): LlmStats;
  close(): Promise<LlmStats>;
}

/** An error whose message is a short code only, safe to print. */
export class LlmError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function cacheKey(req: CompleteRequest): string {
  return createHash('sha256').update(JSON.stringify([req.model, req.system, req.prompt, req.maxTokens])).digest('hex');
}

export interface ProxyOptions {
  /** Directory for the ledger, the usage log and the proxy's stderr. Keep it outside the checkout. */
  dir: string;
  leaseUsd: number;
  runId: string;
}

export interface LlmOptions {
  cacheDir: string;
  /** Injected transport (keyless tests). When absent, proxy is required and started on the first cache miss. */
  transport?: Transport;
  proxy?: ProxyOptions;
}

const REPO_ROOT = join(import.meta.dir, '..', '..');

interface Proxy { base: string; token: string; child: ChildProcess; slot: string; key: string }

async function startProxy(o: ProxyOptions): Promise<Proxy> {
  mkdirSync(o.dir, { recursive: true });
  const token = randomBytes(24).toString('hex');
  const errFd = openSync(join(o.dir, 'proxy.stderr.log'), 'a');
  const child = spawn('bun', [join(REPO_ROOT, 'runner/proxy/metering-proxy.ts'),
    '--listen', '127.0.0.1:0', '--budget-ledger', join(o.dir, 'ledger.sqlite'), '--lease-usd', String(o.leaseUsd), '--run-id', o.runId,
    '--allow-models', ALLOWED_MODELS.join(','), '--control-token', token, '--usage-log', join(o.dir, 'usage.ndjson')],
  { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise<number>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new LlmError('E_PROXY_START_TIMEOUT')), 20_000);
    child.stderr!.on('data', (d: Buffer) => {
      writeFileSync(errFd, d);
      buf += d.toString('utf8');
      const m = buf.match(/ on 127\.0\.0\.1:(\d+);/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new LlmError('E_PROXY_EXITED')); });
  });
  const base = `http://127.0.0.1:${port}`;
  const slot = 'gen';
  const key = `gen:${o.runId}`;
  const res = await fetch(base + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': token }, body: JSON.stringify({ slot, key }) });
  if (!res.ok) { child.kill('SIGTERM'); throw new LlmError('E_PROXY_BIND'); }
  return { base, token, child, slot, key };
}

function proxyTransport(p: Proxy): Transport {
  return async (req) => {
    const [provider, model] = req.model.split(':') as ['openai' | 'anthropic', string];
    const res = provider === 'openai'
      ? await fetch(`${p.base}/${p.slot}/openai/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer unauthenticated' },
        body: JSON.stringify({ model, max_completion_tokens: req.maxTokens, reasoning_effort: 'low',
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }] }),
      })
      : await fetch(`${p.base}/${p.slot}/anthropic/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'unauthenticated', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }] }),
      });
    if (res.status === 402) throw new LlmError('E_BUDGET');
    if (!res.ok) throw new LlmError(`E_HTTP_${res.status}`);
    const j = await res.json() as any;
    const text = provider === 'openai'
      ? j?.choices?.[0]?.message?.content
      : (j?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('');
    if (typeof text !== 'string' || !text.trim()) throw new LlmError('E_EMPTY_RESPONSE');
    return text;
  };
}

export async function createLlm(o: LlmOptions): Promise<Llm> {
  mkdirSync(o.cacheDir, { recursive: true });
  const stats: LlmStats = { calls: 0, cache_hits: 0, usd: 0 };
  let proxy: Promise<Proxy> | null = null;
  const transport = async (): Promise<Transport> => {
    if (o.transport) return o.transport;
    if (!o.proxy) throw new LlmError('E_NO_TRANSPORT');
    proxy ??= startProxy(o.proxy);
    return proxyTransport(await proxy);
  };
  return {
    async complete(req) {
      if (!(ALLOWED_MODELS as readonly string[]).includes(req.model)) throw new LlmError('E_MODEL_NOT_ALLOWED');
      const path = join(o.cacheDir, cacheKey(req) + '.json');
      if (existsSync(path)) {
        stats.cache_hits += 1;
        return (JSON.parse(readFileSync(path, 'utf8')) as { text: string }).text;
      }
      const send = await transport();
      stats.calls += 1;
      const text = await send(req);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ model: req.model, text }) + '\n');
      return text;
    },
    stats: () => ({ ...stats }),
    async close() {
      if (!proxy) return { ...stats };
      const p = await proxy;
      proxy = null;
      const ctl = (path: string, body: unknown) => fetch(p.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': p.token }, body: JSON.stringify(body) });
      try {
        await ctl('/__proxy/unbind', { slot: p.slot });
        const meter = await (await ctl('/__proxy/finalize', { key: p.key, timeout_ms: 60_000 })).json() as { usd?: number };
        stats.usd = Number(meter.usd ?? 0);
      } finally {
        await new Promise<void>((resolve) => { p.child.once('exit', () => resolve()); p.child.kill('SIGTERM'); setTimeout(resolve, 5_000); });
      }
      return { ...stats };
    },
  };
}

/** Totals over a proxy usage log (one JSON line per request, never a body or a key). */
export function usageLogSpend(path: string): { requests: number; forwarded: number; refused: number; usd: number; input_tokens: number; output_tokens: number } {
  const out = { requests: 0, forwarded: 0, refused: 0, usd: 0, input_tokens: 0, output_tokens: 0 };
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const u = JSON.parse(line) as { outcome: string; actual_usd?: number; reserved_usd?: number; charged_reservation?: boolean; input_tokens?: number; output_tokens?: number };
    out.requests += 1;
    if (u.outcome === 'refused') out.refused += 1; else out.forwarded += 1;
    out.usd += u.actual_usd ?? (u.charged_reservation ? u.reserved_usd ?? 0 : 0);
    out.input_tokens += u.input_tokens ?? 0;
    out.output_tokens += u.output_tokens ?? 0;
  }
  return out;
}
