// A metered structured-output client for the failure-mining labeller (internal-task). Every paid call goes through
// runner/proxy/metering-proxy.ts, started here as a child process in lease mode on the loopback with its own ledger, a
// random control token and its own usage log; one slot is bound for the life of the client, limited to the models
// below. Provider keys live only in the proxy's environment. This module never prints, logs or writes a key, a request
// body or a response body; it caches only the structured record a reply carried, under the caller's cache directory.
//
// One request asks for one structured record: a fixed prefix (instructions and codebook) that every call shares and
// providers cache, then the packet, then a closing line. Per model:
// - anthropic:claude-opus-5-5, Messages API, with the Opus 5.5 judge settings (CREW.md, internal-task, 2026-11-08): no
//   temperature and no thinking field, output_config.effort low, tool_choice auto with one strict tool and a closing
//   line asking for exactly one call, max_tokens 8000, cache_control on the prefix block.
// - openai:gpt-6-astra and openai:gpt-6.1-sol, Responses API (the proxy forwards /v1/responses), with a strict
//   json_schema text format, reasoning effort low, max_output_tokens 8000, and explicit prompt caching: a
//   prompt_cache_breakpoint on the prefix block, prompt_cache_options mode explicit, and a prompt_cache_key derived from
//   the prefix (CREW.md, "Cache fixed prefixes", 2026-11-08).
// - particle:particle-1, Chat Completions (the only route Particle serves), with one function tool and tool_choice auto;
//   Particle's support for strict schemas is not documented, so the tool is not marked strict, and a reply that carries
//   the record as JSON in its content instead of a tool call is accepted. The caller validates every record.
//
// Records are cached by sha256 of (model, prefix, packet, schema, tool, feedback); a hit makes no call, and a reply with
// no record is never cached. A call made with refresh skips the cache read (it still writes), so a retry asks the model
// again. A cache file is written to a temporary name and renamed, so a crash never leaves a truncated entry. An HTTP
// error comes back as LlmError E_HTTP_<status> (E_BUDGET for 402); the caller decides on backoff. Tests inject a
// transport at the wire level instead of starting the proxy.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MODELS = ['anthropic:claude-opus-5-5', 'openai:gpt-6-astra', 'openai:gpt-6.1-sol', 'particle:particle-1'] as const;
export type ModelId = (typeof MODELS)[number];
export const MAX_TOKENS = 8000;

export interface StructuredRequest {
  model: ModelId;
  /** The fixed prefix every call of a run shares: instructions and codebook. Cached at the provider. */
  prefix: string;
  /** The per-item text: one packet. */
  packet: string;
  /** JSON schema of the one record the reply must carry. */
  schema: Record<string, unknown>;
  tool: { name: string; description: string };
  /** A retry's note on what the previous record got wrong, sent after the packet. */
  feedback?: string;
}

export interface WireRequest { provider: 'anthropic' | 'openai' | 'particle'; path: string; body: Record<string, unknown> }
export interface WireResponse { status: number; json: unknown }
export type Transport = (req: WireRequest) => Promise<WireResponse>;

export interface Usage { input_tokens: number; cached_input_tokens: number; cache_write_tokens: number; output_tokens: number }
export interface StructuredResult {
  /** The record the reply carried, parsed but not validated, or null when it carried none. */
  value: unknown;
  /** Where the record came from: a tool call, a strict json_schema text, or JSON in a Particle reply's content. */
  via: 'tool' | 'json_schema' | 'content_json' | 'none';
  cached: boolean;
  usage: Usage | null;
}

export interface LlmStats extends Usage { calls: number; cache_hits: number; no_record: number; usd: number }

export interface Llm {
  /** refresh: skip the cache read and ask the model again (the reply is still cached). */
  structured(req: StructuredRequest, opts?: { refresh?: boolean }): Promise<StructuredResult>;
  stats(): LlmStats;
  close(): Promise<LlmStats>;
}

/** An error whose message is a short code only, safe to print. */
export class LlmError extends Error {
  constructor(readonly code: string) { super(code); }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function cacheKey(req: StructuredRequest): string {
  return sha256(JSON.stringify([req.model, req.prefix, req.packet, req.schema, req.tool, req.feedback ?? null]));
}

export function closingLine(req: Pick<StructuredRequest, 'model' | 'tool'>): string {
  return req.model.startsWith('openai:')
    ? 'Return exactly one record for this packet as JSON matching the schema.'
    : `Call ${req.tool.name} exactly once with the one record for this packet.`;
}

/** The provider request for one structured call. Exported so tests can check every setting without a network. */
export function buildWire(req: StructuredRequest): WireRequest {
  const [provider, model] = req.model.split(':') as [WireRequest['provider'], string];
  const tail = [req.packet, ...(req.feedback ? [req.feedback] : []), closingLine(req)];
  if (provider === 'anthropic') {
    return {
      provider, path: '/v1/messages',
      body: {
        model, max_tokens: MAX_TOKENS, output_config: { effort: 'low' },
        system: [{ type: 'text', text: req.prefix, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: tail.map((text) => ({ type: 'text', text })) }],
        tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.schema, strict: true }],
        tool_choice: { type: 'auto' },
      },
    };
  }
  if (provider === 'openai') {
    const cacheName = `failure-mining-${sha256(req.prefix).slice(0, 24)}`;
    return {
      provider, path: '/v1/responses',
      body: {
        model, max_output_tokens: MAX_TOKENS, reasoning: { effort: 'low' },
        prompt_cache_key: cacheName,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: req.prefix, prompt_cache_breakpoint: { mode: 'explicit' } }] },
          { role: 'user', content: tail.map((text) => ({ type: 'input_text', text })) },
        ],
        text: { format: { type: 'json_schema', name: req.tool.name, schema: req.schema, strict: true } },
      },
    };
  }
  return {
    provider, path: '/v1/chat/completions',
    body: {
      model, max_completion_tokens: MAX_TOKENS,
      messages: [{ role: 'system', content: req.prefix }, { role: 'user', content: tail.join('\n\n') }],
      tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.schema } }],
      tool_choice: 'auto',
    },
  };
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { return null; }
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The record and usage a provider reply carried. */
export function parseWire(provider: WireRequest['provider'], toolName: string, json: unknown): { value: unknown; via: StructuredResult['via']; usage: Usage | null } {
  const j = (json ?? {}) as any;
  if (provider === 'anthropic') {
    const u = j.usage;
    const usage = u ? { input_tokens: num(u.input_tokens), cached_input_tokens: num(u.cache_read_input_tokens), cache_write_tokens: num(u.cache_creation_input_tokens), output_tokens: num(u.output_tokens) } : null;
    const calls = (Array.isArray(j.content) ? j.content : []).filter((c: any) => c?.type === 'tool_use' && c?.name === toolName);
    return calls.length === 1 && calls[0].input && typeof calls[0].input === 'object' ? { value: calls[0].input, via: 'tool', usage } : { value: null, via: 'none', usage };
  }
  if (provider === 'openai') {
    const u = j.usage;
    const usage = u ? { input_tokens: num(u.input_tokens), cached_input_tokens: num(u.input_tokens_details?.cached_tokens), cache_write_tokens: num(u.input_tokens_details?.cache_write_tokens), output_tokens: num(u.output_tokens) } : null;
    const texts = (Array.isArray(j.output) ? j.output : []).filter((o: any) => o?.type === 'message').flatMap((o: any) => (Array.isArray(o.content) ? o.content : [])).filter((c: any) => c?.type === 'output_text').map((c: any) => String(c.text ?? ''));
    const value = texts.length ? parseJson(texts.join('')) : null;
    return value && typeof value === 'object' ? { value, via: 'json_schema', usage } : { value: null, via: 'none', usage };
  }
  const u = j.usage;
  const usage = u ? { input_tokens: num(u.prompt_tokens), cached_input_tokens: num(u.prompt_tokens_details?.cached_tokens), cache_write_tokens: 0, output_tokens: num(u.completion_tokens) } : null;
  const m = j.choices?.[0]?.message ?? {};
  const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).filter((c: any) => c?.function?.name === toolName);
  if (calls.length === 1) {
    const value = parseJson(String(calls[0].function.arguments ?? ''));
    return value && typeof value === 'object' ? { value, via: 'tool', usage } : { value: null, via: 'none', usage };
  }
  if (!calls.length && typeof m.content === 'string') {
    const value = parseJson(m.content);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value, via: 'content_json', usage };
  }
  return { value: null, via: 'none', usage };
}

export interface ProxyOptions {
  /** Directory for the usage log and the proxy's stderr. Keep it outside the checkout. */
  dir: string;
  /** The lease ledger; defaults to <dir>/ledger.sqlite. A lease that already exists in it is resumed. */
  ledger?: string;
  leaseUsd: number;
  runId: string;
}

export interface LlmOptions {
  cacheDir: string;
  /** Injected transport (keyless tests). When absent, proxy is required and started on the first cache miss. */
  transport?: Transport;
  proxy?: ProxyOptions;
  /** Runs once, before the first request that is not a cache hit, and may throw to stop it (the preregistration gate). */
  beforeFirstRequest?: () => void | Promise<void>;
}

const REPO_ROOT = join(import.meta.dir, '..', '..');

interface Proxy { base: string; token: string; child: ChildProcess; slot: string; key: string }

async function startProxy(o: ProxyOptions): Promise<Proxy> {
  mkdirSync(o.dir, { recursive: true });
  const token = randomBytes(24).toString('hex');
  const errFd = openSync(join(o.dir, 'proxy.stderr.log'), 'a');
  const child = spawn('bun', [join(REPO_ROOT, 'runner/proxy/metering-proxy.ts'),
    '--listen', '127.0.0.1:0', '--budget-ledger', o.ledger ?? join(o.dir, 'ledger.sqlite'), '--lease-usd', String(o.leaseUsd), '--run-id', o.runId,
    '--allow-models', MODELS.join(','), '--control-token', token, '--usage-log', join(o.dir, 'usage.ndjson')],
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
  const slot = 'label';
  const key = `label:${o.runId}`;
  const res = await fetch(base + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': token }, body: JSON.stringify({ slot, key, models: [...MODELS] }) });
  if (!res.ok) { child.kill('SIGTERM'); throw new LlmError('E_PROXY_BIND'); }
  return { base, token, child, slot, key };
}

function proxyTransport(p: Proxy): Transport {
  return async (w) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (w.provider === 'anthropic') { headers['x-api-key'] = 'unauthenticated'; headers['anthropic-version'] = '2023-06-01'; } else headers.authorization = 'Bearer unauthenticated';
    const res = await fetch(`${p.base}/${p.slot}/${w.provider}${w.path}`, { method: 'POST', headers, body: JSON.stringify(w.body) });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  };
}

export async function createLlm(o: LlmOptions): Promise<Llm> {
  mkdirSync(o.cacheDir, { recursive: true });
  const stats: LlmStats = { calls: 0, cache_hits: 0, no_record: 0, usd: 0, input_tokens: 0, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
  let proxy: Promise<Proxy> | null = null;
  let gate: Promise<void> | null = null;
  const transport = async (): Promise<Transport> => {
    if (o.transport) return o.transport;
    if (!o.proxy) throw new LlmError('E_NO_TRANSPORT');
    proxy ??= startProxy(o.proxy);
    return proxyTransport(await proxy);
  };
  return {
    async structured(req, opts) {
      if (!(MODELS as readonly string[]).includes(req.model)) throw new LlmError('E_MODEL_NOT_ALLOWED');
      const path = join(o.cacheDir, cacheKey(req) + '.json');
      if (!opts?.refresh && existsSync(path)) {
        stats.cache_hits += 1;
        const hit = JSON.parse(readFileSync(path, 'utf8')) as { value: unknown; via: StructuredResult['via'] };
        return { value: hit.value, via: hit.via, cached: true, usage: null };
      }
      gate ??= Promise.resolve(o.beforeFirstRequest?.());
      await gate;
      const wire = buildWire(req);
      const send = await transport();
      stats.calls += 1;
      const res = await send(wire);
      if (res.status === 402) throw new LlmError('E_BUDGET');
      if (res.status < 200 || res.status >= 300) throw new LlmError(`E_HTTP_${res.status}`);
      const parsed = parseWire(wire.provider, req.tool.name, res.json);
      if (parsed.usage) for (const k of ['input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens'] as const) stats[k] += parsed.usage[k];
      if (parsed.value === null) { stats.no_record += 1; return { ...parsed, cached: false }; }
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(tmp, JSON.stringify({ model: req.model, via: parsed.via, value: parsed.value }) + '\n');
      renameSync(tmp, path);
      return { ...parsed, cached: false };
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
