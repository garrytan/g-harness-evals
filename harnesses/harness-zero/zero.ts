#!/usr/bin/env bun
// Harness Zero (HARN-22): the smallest agent harness we can reason about whole. One Bun process, Bun built-ins only (no
// npm packages, no provider SDKs), three hand-written wire clients, an MCP client, and a set of switchable features read
// from config/features.json and config/candidates.json. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error,
// 3 model error, 124 wall clock.
//
//   bun zero.ts run                        one turn from $HE_WORKSPACE_DIR/instruction.md, the reply on stdout
//   bun zero.ts serve                      the file queue in $HE_TURNS_DIR until SIGTERM
//   bun zero.ts explain --config <set> [--diff <set>] [--count-tokens <proxy base url>] [--provider p] [--model m]
//
// Exit mapping (docs/errors.md HE-ZERO rows): a provider 400 or 422 on a request Harness Zero built is 2 (HE-ZERO-004,
// with the provider request id); 401, 402, 403 and 429/500/502/503/529 after retries are 3 (HE-ZERO-007); an MCP server
// that cannot be initialized, or re-initialized after its session expired, is 2 (HE-ZERO-005); a crash is 2 (HE-ZERO-006,
// trace in $HE_LOG_DIR/zero-trace.log with secrets redacted). Nothing here ever reads a provider key: the model sees
// only HE_MODEL_API_KEY, the per-trial token, and no file, log line or ready record carries it.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HARNESS_DIR = import.meta.dir;
export type Wire = 'anthropic' | 'openai-responses' | 'chat-completions';
export type Provider = 'anthropic' | 'openai' | 'particle';
export const WIRES: Record<Wire, { path: string; providers: Provider[] }> = {
  anthropic: { path: '/v1/messages', providers: ['anthropic'] },
  'openai-responses': { path: '/v1/responses', providers: ['openai'] },
  'chat-completions': { path: '/v1/chat/completions', providers: ['openai', 'particle'] },
};
/** The features this code implements. features.json may not name another. */
export const KNOWN_FEATURES = ['caching', 'tool-search', 'layer-tool-use', 'layer-safety', 'layer-scope', 'layer-style', 'layer-planning',
  'scoped-notes', 'output-cap', 'mcp-instructions', 'effort-high'] as const;
const LAYERS = ['tool-use', 'safety', 'scope', 'style', 'planning'];
export interface Knobs { step_cap: number; retry_max: number; output_cap_bytes: number; max_tokens: number; wire: Record<Provider, Wire> }
export interface ResolvedSet { name: string; features: string[]; knobs: Knobs }
interface KnobSpec { default: unknown; min?: number; max?: number }
interface FeaturesFile { features: Array<{ slug: string }>; sets: Record<string, string[]>; knobs: Record<string, KnobSpec> }
type SetSpec = string[] | { features: string[]; knobs?: Record<string, unknown> };
interface CandidatesFile { sets: Record<string, SetSpec> }
export interface ZeroConfig { dir: string; features: FeaturesFile; candidates: CandidatesFile }

export class ZeroError extends Error {
  constructor(readonly code: string, message: string, readonly exit: 2 | 3 = 2) { super(code + ' ' + message); }
}

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();
type Json = Record<string, any>;

// ---- configuration ---------------------------------------------------------------------------------------------------

export function loadConfig(dir = HARNESS_DIR): ZeroConfig {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, 'config', f), 'utf8'));
  const features = read('features.json') as FeaturesFile, candidates = read('candidates.json') as CandidatesFile;
  const unknown = features.features.map((f) => f.slug).filter((s) => !(KNOWN_FEATURES as readonly string[]).includes(s));
  if (unknown.length) throw new ZeroError('HE-ZERO-002', `config/features.json names features this zero.ts does not implement: ${unknown.join(', ')}; fix: restore features.json from the checkout`);
  const frozen = [...Object.keys(features.sets), ...features.features.map((f) => ablationName(f.slug))];
  const shadowed = Object.keys(candidates.sets).filter((n) => frozen.includes(n) || n.startsWith('zero-full-no-'));
  if (shadowed.length) throw new ZeroError('HE-ZERO-002', `config/candidates.json redefines ${shadowed.join(', ')}, which features.json owns (its sets and every zero-full-no-<slug>); fix: give the candidate its own name, such as zero-lean`);
  return { dir, features, candidates };
}

/** zero-full-no-<slug>: zero-full without one feature. */
export const ablationName = (slug: string) => 'zero-full-no-' + slug;
/** The set an empty config picks: zero-full with mcp-instructions off (Phase D found it cost more and bought nothing). */
export const DEFAULT_SET = ablationName('mcp-instructions');

/** Every valid set name, in order: features.json's sets, one ablation per feature, then candidates.json's sets. The
 *  runner's dry-run and preflight read valid names from here. */
export function setNames(cfg: ZeroConfig = loadConfig()): string[] {
  return [...Object.keys(cfg.features.sets), ...cfg.features.features.map((f) => ablationName(f.slug)), ...Object.keys(cfg.candidates.sets)];
}

/** The features and every knob of a set; HE-ZERO-001 for an unknown name, HE-ZERO-002 for a bad feature or knob. */
export function resolveSet(input: string | undefined, cfg: ZeroConfig = loadConfig()): ResolvedSet {
  const name = input?.trim() || DEFAULT_SET;
  const slugs = cfg.features.features.map((f) => f.slug);
  const ablated = name.startsWith('zero-full-no-') && slugs.includes(name.slice(13)) ? (cfg.features.sets['zero-full'] ?? []).filter((s) => s !== name.slice(13)) : undefined;
  const spec = (Object.hasOwn(cfg.features.sets, name) ? cfg.features.sets[name] as SetSpec : undefined) ?? (Object.hasOwn(cfg.candidates.sets, name) ? cfg.candidates.sets[name] : undefined) ?? ablated;
  if (!spec) throw new ZeroError('HE-ZERO-001', `HE_HARNESS_CONFIG=${name} is not a Harness Zero set; fix: set it to one of ${setNames(cfg).join(', ')}`);
  const list = Array.isArray(spec) ? spec : spec.features;
  const over = Array.isArray(spec) ? {} : spec.knobs ?? {};
  const bad = list.filter((s) => !slugs.includes(s));
  if (bad.length) throw new ZeroError('HE-ZERO-002', `set ${name} names unknown features ${bad.join(', ')}; fix: use only ${slugs.join(', ')}`);
  const knobs: Json = {};
  for (const [k, s] of Object.entries(cfg.features.knobs)) knobs[k] = s.default;
  for (const [k, v] of Object.entries(over)) {
    const s = Object.hasOwn(cfg.features.knobs, k) ? cfg.features.knobs[k] : undefined;
    if (!s) throw new ZeroError('HE-ZERO-002', `set ${name} sets unknown knob ${k}; fix: use only ${Object.keys(cfg.features.knobs).join(', ')}`);
    if (k === 'wire') {
      const w = (v ?? {}) as Json;
      for (const [p, wire] of Object.entries(w)) if (!Object.hasOwn(WIRES, wire) || !WIRES[wire as Wire].providers.includes(p as Provider)) {
        throw new ZeroError('HE-ZERO-002', `set ${name} sets wire.${p}=${wire}; fix: use ${Object.entries(WIRES).filter(([, d]) => d.providers.includes(p as Provider)).map(([n]) => n).join(' or ') || 'no wire'} for ${p}`);
      }
      knobs.wire = { ...knobs.wire, ...w };
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < (s.min ?? -Infinity) || v > (s.max ?? Infinity)) {
      throw new ZeroError('HE-ZERO-002', `set ${name} sets knob ${k}=${JSON.stringify(v)}, outside ${s.min}..${s.max}; fix: an integer from ${s.min} to ${s.max}`);
    } else knobs[k] = v;
  }
  return { name, features: slugs.filter((s) => list.includes(s)), knobs: knobs as Knobs };
}

/** The prompt files a set loads, relative to the harness directory: the identity and one file per enabled layer. */
export function promptFiles(set: ResolvedSet): string[] {
  return ['config/prompts/identity.md', ...LAYERS.filter((l) => set.features.includes('layer-' + l)).map((l) => `config/prompts/${l}.md`)];
}

/** The candidate hash (R5): zero.ts, the resolved set with every knob, every prompt file the set loads, adapter.sh, the
 *  Dockerfile, and pin.json's base image digest and Bun version (the image holds all of them in /opt/harness). The set's
 *  name is not an input, so two names for the same behavior share a hash. zero.ts imports Bun built-ins only, so no lockfile. */
export function candidateHash(set: ResolvedSet, dir = HARNESS_DIR): { candidate_sha256: string; inputs: Json } {
  const file = (f: string) => sha256(readFileSync(join(dir, f)));
  const pin = JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8'));
  const inputs: Json = {
    zero_ts: file('zero.ts'),
    set: { features: [...set.features].sort(), knobs: Object.fromEntries(Object.entries(set.knobs).sort(([a], [b]) => a.localeCompare(b))) },
    prompts: Object.fromEntries(promptFiles(set).map((f) => [f, file(f)])),
    adapter_sh: file('adapter.sh'),
    dockerfile: file('Dockerfile'),
    base_image_digest: pin.base_image.digest,
    bun_version: pin.bun_version,
  };
  return { candidate_sha256: sha256(JSON.stringify(inputs)), inputs };
}

/** The provider a base URL names (its last path segment) and the wire the set uses there; HE-ZERO-003 on a mismatch. */
export function wireFor(baseUrl: string, set: ResolvedSet): { provider: Provider; wire: Wire } {
  const provider = baseUrl.replace(/\/+$/, '').split('/').pop() as Provider;
  const wire = set.knobs.wire[provider];
  if (!wire || !WIRES[wire]?.providers.includes(provider)) {
    throw new ZeroError('HE-ZERO-003', `HE_MODEL_BASE_URL ${baseUrl} ends in /${provider}, which set ${set.name} has no wire for; fix: use a base URL ending in /${Object.keys(set.knobs.wire).join(', /')}`);
  }
  return { provider, wire };
}

// ---- logging and secrets ---------------------------------------------------------------------------------------------

const env = process.env;
const trial = () => env.HE_TRIAL_ID ?? 'unknown';
function log(line: string) {
  const out = `${now()} harness-zero[${trial()}] ${redact(line)}\n`;
  process.stderr.write(out);
  if (env.HE_LOG_DIR) try { appendFileSync(join(env.HE_LOG_DIR, 'adapter.log'), out); } catch { /* the log dir is checked at start */ }
}

/** Every credential value in the environment, and anything shaped like a token, replaced. */
export function redact(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD/i.test(k)) out = out.split(v).join('[redacted]');
  return out.replace(/trial-token:[^\s"',]+/g, '[redacted]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted]').replace(/(Bearer\s+)[^\s"',]+/gi, '$1[redacted]');
}

function crashTrace(e: unknown): string {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  if (env.HE_LOG_DIR) try { appendFileSync(join(env.HE_LOG_DIR, 'zero-trace.log'), `${now()} ${redact(text)}\n`); } catch { /* best effort */ }
  return redact(e instanceof Error ? e.message : String(e)).slice(0, 200);
}

const writeAtomic = (path: string, data: string) => { writeFileSync(path + '.tmp', data); renameSync(path + '.tmp', path); };
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(signal.reason);
    const stop = () => { clearTimeout(t); rej(signal!.reason); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

// ---- MCP client ------------------------------------------------------------------------------------------------------

export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** A tools/call is stopped after this long, or after half the turn's remaining time if that is less, so a stuck tool
 *  leaves the model time to answer inside the turn budget. */
export const TOOL_CALL_TIMEOUT_MS = 60_000;
export interface ToolDef { name: string; description: string; schema: Json; server?: string; tool?: string; readOnly?: boolean }
interface ToolResult { text: string; isError: boolean; status: 'ok' | 'error' | 'unknown' }
class SessionExpired extends Error {}
class McpHttpError extends Error { constructor(readonly status: number, body: string) { super(`HTTP ${status}: ${body.slice(0, 200)}`); } }
class McpRpcError extends Error {}

/** The world server's tools that only read; it sends no annotations, so this audited list stands in for them. */
const WORLD_READS = new Set(['whoami', 'list_members', 'clock_now', 'list_channels', 'read_channel', 'search_messages', 'list_files', 'read_file', 'calendar_list', 'mail_list']);

/** A tool is read-only (and so safe to send again) only when the server says so or it is an audited world read. */
export function isReadOnly(t: { name: string; annotations?: { readOnlyHint?: boolean } }, server: string): boolean {
  return t.annotations?.readOnlyHint ?? (server === 'world' && WORLD_READS.has(t.name));
}

/** The JSON-RPC message with this id from an application/json or text/event-stream body. */
/** An SSE body read up to the event that answers id; a server may keep the stream open after it (MCP Streamable HTTP). */
async function readEvents(res: Response, id: number): Promise<string> {
  const reader = res.body!.getReader(), decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
    if (parseRpc(text, 'text/event-stream', id)) { await reader.cancel().catch(() => undefined); return text; }
  }
}

export function parseRpc(body: string, contentType: string, id: number): Json | null {
  const found: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) try { found.push(JSON.parse(data)); } catch { /* a keepalive or a partial event */ }
    }
  } else try { found.push(JSON.parse(body)); } catch { return null; }
  for (const c of found.flat()) if (c && typeof c === 'object' && (c as Json).id === id) return c as Json;
  return null;
}

export class McpClient {
  sessionId: string | null = null;
  protocol = MCP_PROTOCOL_VERSION;
  instructions: string | null = null;
  tools: ToolDef[] = [];
  private seq = 0;
  private broken = false;
  constructor(readonly name: string, private url: string, private token: string) {}

  private async post(message: Json, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { authorization: 'Bearer ' + this.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (message.method !== 'initialize') headers['mcp-protocol-version'] = this.protocol;
    return fetch(this.url, { method: 'POST', headers, body: JSON.stringify(message), signal });
  }

  async rpc(method: string, params: Json, signal?: AbortSignal): Promise<Json> {
    const id = ++this.seq;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, signal);
    const body = res.ok && (res.headers.get('content-type') ?? '').includes('text/event-stream') ? await readEvents(res, id) : await res.text();
    if (res.status === 404 && this.sessionId) throw new SessionExpired(`${this.name}: session not found`);
    if (!res.ok) throw new McpHttpError(res.status, body);
    const msg = parseRpc(body, res.headers.get('content-type') ?? '', id);
    if (!msg) throw new Error(`${this.name}: no JSON-RPC answer to ${method} in a ${res.headers.get('content-type')} body`);
    if (method === 'initialize') this.sessionId = res.headers.get('mcp-session-id');
    if (msg.error) throw new McpRpcError(`${this.name}: ${method} error ${msg.error.code}: ${String(msg.error.message).slice(0, 200)}`);
    return msg.result ?? {};
  }

  async initialize(signal?: AbortSignal) {
    this.sessionId = null;
    const r = await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'harness-zero', version: '1' } }, signal);
    this.protocol = typeof r.protocolVersion === 'string' ? r.protocolVersion : MCP_PROTOCOL_VERSION;
    this.instructions = typeof r.instructions === 'string' && r.instructions.trim() ? r.instructions : null;
    const res = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
    await res.text();
    if (!res.ok) throw new McpHttpError(res.status, 'notifications/initialized');
    const tools: ToolDef[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.rpc('tools/list', cursor ? { cursor } : {}, signal);
      for (const t of page.tools ?? []) tools.push({ name: `mcp__${this.name}__${t.name}`, tool: t.name, server: this.name, description: String(t.description ?? ''), schema: t.inputSchema ?? { type: 'object', properties: {} }, readOnly: isReadOnly(t, this.name) });
      cursor = page.nextCursor;
    } while (cursor);
    this.tools = tools;
  }

  /** One tools/call. A session that expired (404) is re-initialized once, which also reloads the tool list; only a read
   *  tool is then sent again. A write whose answer was lost, or that passed the per-call time limit, is reported to the
   *  model as an unknown outcome and never sent again; a read that passed the limit is an error and not sent again. The
   *  limit covers the whole call: a re-initialize and a read sent again share it, and a re-initialize that passes it is
   *  HE-ZERO-005. */
  async call(tool: ToolDef, args: Json, signal: AbortSignal, deadline: number): Promise<ToolResult> {
    const limit = AbortSignal.any([signal, AbortSignal.timeout(Math.min(TOOL_CALL_TIMEOUT_MS, Math.max(0, deadline - Date.now()) / 2))]);
    const once = async (): Promise<ToolResult> => {
      const r = await this.rpc('tools/call', { name: tool.tool, arguments: args }, limit);
      const text = (r.content ?? []).map((c: Json) => c.type === 'text' ? c.text : c.type === 'resource' ? JSON.stringify(c.resource) : `[${c.type} omitted]`).join('\n')
        || (r.structuredContent ? JSON.stringify(r.structuredContent) : '');
      return { text, isError: r.isError === true, status: r.isError === true ? 'error' : 'ok' };
    };
    const failed = (e: unknown): ToolResult => {
      if (signal.aborted) throw e;
      return { text: `${tool.tool} failed: ${String((e as Error).message).slice(0, 200)}`, isError: true, status: 'error' };
    };
    if (this.broken) {
      try { await this.initialize(limit); this.broken = false; } catch (e2) {
        if (signal.aborted) throw e2;
        throw new ZeroError('HE-ZERO-005', `MCP server ${this.name} is still down after a failed re-initialize: ${(e2 as Error).message.slice(0, 200)}`);
      }
      if (limit.aborted) {
        if (signal.aborted) throw signal.reason;
        return { text: `${tool.tool} was not sent: re-initializing the ${this.name} tool server used up the per-call time limit.`, isError: true, status: 'error' };
      }
    }
    try {
      return await once();
    } catch (e) {
      if (signal.aborted) throw e;
      if ((e as Error)?.name === 'TimeoutError') return tool.readOnly
        ? { text: `${tool.tool} did not answer before the per-call time limit, so it was stopped and not sent again.`, isError: true, status: 'error' }
        : { text: `${tool.tool} did not answer before the per-call time limit. The outcome is unknown: it may or may not have taken effect. Check before you try it again.`, isError: true, status: 'unknown' };
      if (e instanceof SessionExpired) {
        try { await this.initialize(limit); } catch (e2) {
          if (signal.aborted) throw e2;
          this.broken = true;
          throw new ZeroError('HE-ZERO-005', `MCP server ${this.name} session expired and re-initialize failed: ${(e2 as Error).message.slice(0, 200)}`);
        }
        log(`MCP ${this.name}: session expired; re-initialized with ${this.tools.length} tools (${tool.readOnly ? 'read tool sent again' : 'write not sent again'})`);
        if (!tool.readOnly) return { text: `The ${this.name} tool server session expired before ${tool.tool} ran, so it did not run. Call it again if it is still needed.`, isError: true, status: 'error' };
        return await once().catch(failed);
      }
      const lost = !(e instanceof McpRpcError) && !(e instanceof McpHttpError && e.status < 500);
      if (lost && !tool.readOnly) return { text: `The answer to ${tool.tool} was lost (${String((e as Error).message).slice(0, 120)}). The outcome is unknown: it may or may not have taken effect. Check before you try it again.`, isError: true, status: 'unknown' };
      if (lost) return await once().catch(failed);
      return failed(e);
    }
  }
}

// ---- wire clients ----------------------------------------------------------------------------------------------------

export interface Call { id: string; name: string; args: Json | null; argError?: string }
export interface Step { text: string | null; calls: Call[]; stop: string; incomplete: boolean; assistant: Json[] }
export interface Session { key: string; scope: string; created_at: string; turns: number; wire: Wire; system: string; notes_shown: number; history: Json[] }
interface BuildContext { model: string; set: ResolvedSet; tools: ToolDef[]; session: Session }
const has = (set: ResolvedSet, f: string) => set.features.includes(f);
const cacheKey = (s: Session) => 'harness-zero-' + sha256(s.key).slice(0, 24);
function parseArgs(raw: unknown): { args: Json | null; argError?: string } {
  if (raw && typeof raw === 'object') return Array.isArray(raw) ? { args: null, argError: 'the arguments are not a JSON object' } : { args: raw as Json };
  try {
    const v = JSON.parse(String(raw ?? '') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? { args: v } : { args: null, argError: 'the arguments are not a JSON object' };
  } catch (e) { return { args: null, argError: `the arguments are not valid JSON (${(e as Error).message.slice(0, 80)})` }; }
}

export interface WireClient {
  build(c: BuildContext): Json;
  parse(json: Json): Step;
  user(history: Json[], text: string): void;
  results(history: Json[], results: Array<{ id: string; text: string; isError: boolean }>): void;
}

export const CLIENTS: Record<Wire, WireClient> = {
  anthropic: {
    build({ model, set, tools, session }) {
      const caching = has(set, 'caching');
      const messages = structuredClone(session.history);
      const last = messages.at(-1);
      if (caching && last && Array.isArray(last.content) && last.content.length) last.content[last.content.length - 1].cache_control = { type: 'ephemeral' };
      const body: Json = { model, max_tokens: set.knobs.max_tokens, system: [{ type: 'text', text: session.system, ...(caching ? { cache_control: { type: 'ephemeral' } } : {}) }], messages };
      if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
      if (has(set, 'effort-high')) { body.thinking = { type: 'adaptive' }; body.output_config = { effort: 'high' }; }
      return body;
    },
    parse(json) {
      if (!Array.isArray(json.content)) throw new ZeroError('HE-ZERO-007', `the provider answered 200 without a content array (type ${json.type})`, 3);
      const texts = json.content.filter((b: Json) => b.type === 'text').map((b: Json) => b.text).join('');
      const calls = json.content.filter((b: Json) => b.type === 'tool_use').map((b: Json) => ({ id: b.id, name: b.name, ...parseArgs(b.input) }));
      return { text: texts || null, calls, stop: json.stop_reason ?? 'unknown', incomplete: json.stop_reason === 'max_tokens', assistant: json.content.length ? [{ role: 'assistant', content: json.content }] : [] };
    },
    user(history, text) {
      const last = history.at(-1);
      if (last?.role === 'user') last.content.push({ type: 'text', text });
      else history.push({ role: 'user', content: [{ type: 'text', text }] });
    },
    results(history, results) {
      history.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) });
    },
  },
  'openai-responses': {
    build({ model, set, tools, session }) {
      const body: Json = { model, instructions: session.system, input: session.history, max_output_tokens: set.knobs.max_tokens, store: false, include: ['reasoning.encrypted_content'] };
      if (tools.length) body.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema }));
      if (has(set, 'effort-high')) body.reasoning = { effort: 'high' };
      if (has(set, 'caching')) body.prompt_cache_key = cacheKey(session);
      return body;
    },
    parse(json) {
      if (json.status === 'failed' || json.error) throw new ZeroError('HE-ZERO-007', `the provider answered 200 with a failed response (${String(json.error?.code ?? json.status)}: ${String(json.error?.message ?? '').slice(0, 200)})`, 3);
      if (!Array.isArray(json.output)) throw new ZeroError('HE-ZERO-007', `the provider answered 200 without an output array (status ${json.status})`, 3);
      const texts = json.output.filter((i: Json) => i.type === 'message').flatMap((i: Json) => (i.content ?? []).filter((c: Json) => c.type === 'output_text').map((c: Json) => c.text)).join('');
      const calls = json.output.filter((i: Json) => i.type === 'function_call').map((i: Json) => ({ id: i.call_id, name: i.name, ...parseArgs(i.arguments) }));
      const incomplete = json.status === 'incomplete';
      return { text: texts || null, calls, stop: incomplete ? 'incomplete:' + (json.incomplete_details?.reason ?? 'unknown') : json.status ?? 'unknown', incomplete, assistant: json.output };
    },
    user(history, text) { history.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }); },
    results(history, results) {
      for (const r of results) history.push({ type: 'function_call_output', call_id: r.id, output: r.isError ? 'ERROR: ' + r.text : r.text });
    },
  },
  'chat-completions': {
    build({ model, set, tools, session }) {
      const body: Json = { model, messages: [{ role: 'system', content: session.system }, ...session.history], max_completion_tokens: set.knobs.max_tokens };
      if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
      if (has(set, 'effort-high')) body.reasoning_effort = 'high';
      if (has(set, 'caching')) body.prompt_cache_key = cacheKey(session);
      return body;
    },
    parse(json) {
      const choice = json.choices?.[0];
      if (!choice?.message) throw new ZeroError('HE-ZERO-007', 'the provider answered 200 without choices[0].message', 3);
      const m = choice.message;
      const calls = (m.tool_calls ?? []).map((c: Json) => ({ id: c.id, name: c.function?.name, ...parseArgs(c.function?.arguments) }));
      const assistant: Json = { role: 'assistant', content: m.content ?? null };
      if (m.tool_calls?.length) assistant.tool_calls = m.tool_calls;
      if (m.reasoning_content) assistant.reasoning_content = m.reasoning_content;
      return { text: m.content || null, calls, stop: choice.finish_reason ?? 'unknown', incomplete: choice.finish_reason === 'length', assistant: [assistant] };
    },
    user(history, text) { history.push({ role: 'user', content: text }); },
    results(history, results) {
      for (const r of results) history.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? 'ERROR: ' + r.text : r.text });
    },
  },
};

// ---- model calls with retries ----------------------------------------------------------------------------------------

export const RETRY_STATUSES = [429, 500, 502, 503, 529];
export interface ModelTarget { baseUrl: string; apiKey: string; wire: Wire }

function retryAfterMs(res: Response): number | null {
  const ms = res.headers.get('retry-after-ms');
  if (ms !== null && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const v = res.headers.get('retry-after');
  if (v === null) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** POST one request; retry 429, 500, 502, 503, 529 and overloaded answers (and a refused connection) up to retry_max
 *  times with exponential backoff that honors retry-after, never past the turn's deadline. */
export async function callModel(target: ModelTarget, body: Json, retryMax: number, deadline: number, signal: AbortSignal, onRetry: () => void): Promise<Json> {
  const url = target.baseUrl.replace(/\/+$/, '') + WIRES[target.wire].path;
  const headers: Record<string, string> = target.wire === 'anthropic'
    ? { 'content-type': 'application/json', 'x-api-key': target.apiKey, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: 'Bearer ' + target.apiKey };
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null, failure = '', errType = '', text = '', broke = false;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); text = await res.text(); } catch (e) {
      if (signal.aborted) throw signal.reason;
      broke = res !== null;
      failure = `${broke ? `the model answer (${res!.status}) broke off` : 'the model endpoint could not be reached'} (${(e as Error).message.slice(0, 120)})`;
    }
    if (res && !broke) {
      if (res.ok) {
        try { return JSON.parse(text); } catch { throw new ZeroError('HE-ZERO-007', `the provider answered ${res.status} with a body that is not JSON`, 3); }
      }
      try { errType = JSON.parse(text)?.error?.type ?? ''; } catch { /* not JSON */ }
      const reqId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? 'none';
      failure = `${res.status} ${errType || 'error'}: ${redact(text).slice(0, 200)} (request id ${reqId})`;
    }
    const status = res?.status ?? 0;
    if (errType === 'budget') throw new ZeroError('HE-ZERO-007', `the metering proxy refused the request under its budget policy: ${failure}`, 3);
    if (!res || RETRY_STATUSES.includes(status) || (broke && res.ok) || errType === 'overloaded_error') {
      const wait = (res && retryAfterMs(res)) ?? Math.min(30_000, 500 * 2 ** attempt);
      if (attempt >= retryMax) throw new ZeroError('HE-ZERO-007', `model request failed after ${attempt} retries: ${failure}`, 3);
      if (Date.now() + wait >= deadline) throw new ZeroError('HE-ZERO-007', `model request failed and the next retry would pass the turn budget: ${failure}`, 3);
      onRetry();
      log(`model ${status || 'unreachable'}: retry ${attempt + 1} of ${retryMax} in ${wait} ms`);
      await sleep(wait, signal);
      continue;
    }
    if (status === 400 || status === 422) throw new ZeroError('HE-ZERO-004', `the provider rejected a request Harness Zero built: ${failure}`, 2);
    if (status < 500 && ![401, 402, 403].includes(status)) throw new ZeroError('HE-ZERO-004', `the provider refused the route or request: ${failure}`, 2);
    throw new ZeroError('HE-ZERO-007', `model request refused: ${failure}`, 3);
  }
}

// ---- sessions, notes, tools ------------------------------------------------------------------------------------------

const stateDir = (...p: string[]) => join(env.HE_SESSION_STATE_DIR ?? '/harness-state', 'zero', ...p);
/** dm:<member>, channel:<id>, :t<thread_ts> appended for a thread turn; the scope is the key without the thread. */
export function sessionKey(req: { actor: { member: string }; channel: { id: string; type: string }; thread_ts?: string | null }): string {
  return (req.channel.type === 'dm' ? 'dm:' + req.actor.member : 'channel:' + req.channel.id) + (req.thread_ts ? ':t' + req.thread_ts : '');
}
export const scopeOf = (key: string) => key.replace(/:t\d+(?:\.\d+)?$/, '');
export const sessionPath = (key: string) => stateDir('sessions', sha256(key) + '.json');
export const notesPath = (scope: string) => stateDir('notes', sha256(scope) + '.json');
const readNotes = (scope: string): Array<{ at: string; text: string }> => existsSync(notesPath(scope)) ? JSON.parse(readFileSync(notesPath(scope), 'utf8')).notes : [];

const LOCAL_TOOLS: Record<string, ToolDef> = {
  tool_search: { name: 'tool_search', description: 'Search the available tools by keywords. Returns the matching tools with their input schemas; call one with call_tool.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  call_tool: { name: 'call_tool', description: 'Call a tool found with tool_search, by its exact name, with arguments that follow its input schema.', schema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'] } },
  save_note: { name: 'save_note', description: 'Save a short note for later conversations in this same channel or direct message. Notes are shown at the start of a new conversation here and nowhere else.', schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
};

/** The tools a request offers: the MCP tools, or tool_search and call_tool under tool-search; save_note under scoped-notes. */
export function exposedTools(set: ResolvedSet, catalog: ToolDef[]): ToolDef[] {
  return [...(has(set, 'tool-search') ? [LOCAL_TOOLS.tool_search!, LOCAL_TOOLS.call_tool!] : catalog), ...(has(set, 'scoped-notes') ? [LOCAL_TOOLS.save_note!] : [])];
}

export function systemPrompt(set: ResolvedSet, servers: Array<{ name: string; instructions: string | null }>, notes: Array<{ text: string }>, dir = HARNESS_DIR): string {
  const parts = promptFiles(set).map((f) => readFileSync(join(dir, f), 'utf8').trim());
  if (has(set, 'mcp-instructions')) for (const s of servers) if (s.instructions) parts.push(`Instructions from the ${s.name} tool server:\n${s.instructions.trim()}`);
  if (notes.length) parts.push('Notes you saved earlier in this conversation:\n' + notes.map((n) => '- ' + n.text).join('\n'));
  return parts.join('\n\n');
}

export function capOutput(text: string, cap: number): string {
  const buf = Buffer.from(text);
  if (buf.length <= cap) return text;
  const kept = buf.subarray(0, cap).toString('utf8').replace(/\uFFFD+$/, '');
  return kept + `\n[harness-zero output-cap: cut ${buf.length - Buffer.byteLength(kept)} of ${buf.length} bytes]`;
}

export function searchTools(catalog: ToolDef[], query: string): ToolDef[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return catalog.map((t) => ({ t, n: words.filter((w) => (t.name + ' ' + t.description).toLowerCase().includes(w)).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5).map((x) => x.t);
}

// ---- one turn --------------------------------------------------------------------------------------------------------

export interface Ctx { set: ResolvedSet; model: string; target: ModelTarget; servers: McpClient[]; catalog: ToolDef[] }
export interface TurnOutcome { exit: 0 | 2 | 3 | 124; reply: string | null; detail?: string; stop: string }
interface Tally { steps: number; retries: number; calls: Array<{ id: string; call_id: string; tool: string; via?: string; status: string; ms: number }>; notes_written: number; notes_shown: number }

/** One turn of a session. The session file is written when the turn completes. A turn that fails after a tool call ran
 *  keeps its history, with every call of an unfinished batch closed (a finished call keeps its result, the rest are marked
 *  unknown), so the next turn sees the calls that already ran. When the provider rejects a request (HE-ZERO-004), the
 *  rejected request is not kept, but the calls that ran before it are, with the last batch's results replaced by a
 *  dropped marker (they may be what the provider refused). A turn that fails before any tool call leaves the session as
 *  it was (a note saved during it stays saved). */
export async function runTurn(ctx: Ctx, key: string, prompt: string, budgetS: number, turn: number, stopSignal: AbortSignal): Promise<TurnOutcome> {
  const started = Date.now(), deadline = started + budgetS * 1000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('budget')), budgetS * 1000);
  const onStop = () => ac.abort(new Error('sigterm'));
  if (stopSignal.aborted) onStop(); else stopSignal.addEventListener('abort', onStop, { once: true });
  const scope = scopeOf(key);
  const t: Tally = { steps: 0, retries: 0, calls: [], notes_written: 0, notes_shown: 0 };
  const fresh = !existsSync(sessionPath(key));
  let session: Session;
  if (fresh) {
    const notes = has(ctx.set, 'scoped-notes') ? readNotes(scope).slice(-20) : [];
    t.notes_shown = notes.length;
    session = { key, scope, created_at: new Date(started).toISOString(), turns: 0, wire: ctx.target.wire, system: systemPrompt(ctx.set, ctx.servers, notes), notes_shown: notes.length, history: [] };
  } else session = JSON.parse(readFileSync(sessionPath(key), 'utf8'));
  const client = CLIENTS[ctx.target.wire];
  let reply: string | null = null, stop = 'unknown', outcome: TurnOutcome, kept = 0;
  let pending: { calls: Array<{ id: string }>; results: Array<{ id: string; text: string; isError: boolean }> } | null = null;
  let last: { at: number; ids: string[] } | null = null;
  try {
    client.user(session.history, prompt);
    for (;;) {
      if (t.steps >= ctx.set.knobs.step_cap) { stop = 'step_cap'; break; }
      const tools = exposedTools(ctx.set, ctx.catalog);
      const json = await callModel(ctx.target, client.build({ model: ctx.model, set: ctx.set, tools, session }), ctx.set.knobs.retry_max, deadline, ac.signal, () => t.retries++);
      const step = client.parse(json);
      t.steps++;
      session.history.push(...step.assistant);
      if (step.text && !step.calls.length) reply = step.text;
      stop = step.text || step.calls.length || step.incomplete ? step.stop : 'empty';
      if (!step.calls.length) break;
      const results: Array<{ id: string; text: string; isError: boolean }> = [];
      pending = { calls: step.calls, results };
      for (const call of step.calls) {
        const began = Date.now();
        let r: ToolResult;
        if (step.incomplete) r = { text: 'Not run: the response hit the output token limit before this call was complete. Send the call again, shorter.', isError: true, status: 'error' };
        else if (!call.args) r = { text: `Not run: ${call.argError}. Send the call again with a JSON object as arguments.`, isError: true, status: 'error' };
        else r = await runTool(ctx, call.name, call.args, scope, ac.signal, deadline, t);
        if (has(ctx.set, 'output-cap')) r.text = capOutput(r.text, ctx.set.knobs.output_cap_bytes);
        const viaSearch = call.name === 'call_tool' && has(ctx.set, 'tool-search') && typeof call.args?.name === 'string';
        const entry = { id: `${turn}.${t.calls.length + 1}`, call_id: call.id, tool: viaSearch ? String(call.args!.name) : call.name, ...(viaSearch ? { via: 'call_tool' } : {}), status: r.status, ms: Date.now() - began };
        t.calls.push(entry);
        log('ZERO_CALL ' + JSON.stringify(entry));
        results.push({ id: call.id, text: r.text, isError: r.isError });
      }
      last = { at: session.history.length, ids: step.calls.map((c) => c.id) };
      client.results(session.history, results);
      pending = null;
      kept = session.history.length;
    }
    session.turns++;
    mkdirSync(stateDir('sessions'), { recursive: true });
    writeAtomic(sessionPath(key), JSON.stringify(session));
    outcome = { exit: 0, reply, stop };
  } catch (e) {
    const reason = ac.signal.aborted ? (ac.signal.reason as Error)?.message : null;
    if (reason === 'budget') outcome = { exit: 124, reply: null, stop: 'budget', detail: `wall clock exceeded (${budgetS}s)` };
    else if (reason === 'sigterm') outcome = { exit: 2, reply: null, stop: 'sigterm', detail: 'stopped by SIGTERM during the turn' };
    else if (e instanceof ZeroError) outcome = { exit: e.exit, reply: null, stop: 'error', detail: redact(e.message).slice(0, 400) };
    else outcome = { exit: 2, reply: null, stop: 'crash', detail: `HE-ZERO-006 crash: ${crashTrace(e)}; trace in zero-trace.log` };
    const rejected = e instanceof ZeroError && e.code === 'HE-ZERO-004';
    if (!rejected && pending) {
      const done = pending.results;
      client.results(session.history, pending.calls.map((c, i) => done[i] ?? { id: c.id, text: 'The turn ended before this call finished, so its outcome is unknown: it may or may not have taken effect. Check before you try it again.', isError: true }));
      kept = session.history.length;
    }
    if (rejected && last) {
      session.history.length = last.at;
      client.results(session.history, last.ids.map((id) => ({ id, text: 'The provider rejected the next request (HE-ZERO-004), so this result was dropped from the history. The call itself ran: check its effect before you repeat it.', isError: false })));
      kept = session.history.length;
    }
    if (kept) {
      try {
        session.history.length = kept;
        session.turns++;
        mkdirSync(stateDir('sessions'), { recursive: true });
        writeAtomic(sessionPath(key), JSON.stringify(session));
      } catch (e2) { log(`session not saved after the failed turn: ${redact(String((e2 as Error).message)).slice(0, 200)}`); }
    }
  } finally {
    clearTimeout(timer);
    stopSignal.removeEventListener('abort', onStop);
  }
  const outcomes: Record<string, number> = { ok: 0, error: 0, unknown: 0 };
  for (const c of t.calls) outcomes[c.status] = (outcomes[c.status] ?? 0) + 1;
  log('ZERO_TURN ' + JSON.stringify({ turn, session: sha256(key).slice(0, 12), new_session: fresh, steps: t.steps, stop_reason: outcome.stop, retries: t.retries,
    tool_calls: t.calls.map((c) => ({ tool: c.tool, status: c.status })), tool_outcomes: outcomes, notes_written: t.notes_written, notes_shown: t.notes_shown, exit: outcome.exit, ms: Date.now() - started }));
  return outcome;
}

async function runTool(ctx: Ctx, name: string, args: Json, scope: string, signal: AbortSignal, deadline: number, t: Tally): Promise<ToolResult> {
  const search = has(ctx.set, 'tool-search');
  if (name === 'save_note' && has(ctx.set, 'scoped-notes')) {
    const text = String(args.text ?? '').trim().slice(0, 1000);
    if (!text) return { text: 'Not saved: the note is empty.', isError: true, status: 'error' };
    const notes = [...readNotes(scope), { at: new Date().toISOString(), text }].slice(-50);
    mkdirSync(stateDir('notes'), { recursive: true });
    writeAtomic(notesPath(scope), JSON.stringify({ scope, notes }));
    t.notes_written++;
    return { text: 'Saved.', isError: false, status: 'ok' };
  }
  if (name === 'tool_search' && search) {
    const found = searchTools(ctx.catalog, String(args.query ?? ''));
    const out = found.length ? found.map((x) => ({ name: x.name, description: x.description, input_schema: x.schema })) : { no_match: true, tools: ctx.catalog.map((x) => x.name) };
    return { text: JSON.stringify(out), isError: false, status: 'ok' };
  }
  if (name === 'call_tool' && search) {
    const inner = String(args.name ?? '');
    if (inner in LOCAL_TOOLS) return { text: `call_tool runs tools found with tool_search; call ${inner} directly.`, isError: true, status: 'error' };
    const parsed = parseArgs(args.arguments ?? {});
    if (!parsed.args) return { text: `Not run: call_tool's arguments for ${inner}: ${parsed.argError}. Send them again as a JSON object.`, isError: true, status: 'error' };
    return runTool(ctx, inner, parsed.args, scope, signal, deadline, t);
  }
  const tool = ctx.catalog.find((x) => x.name === name);
  if (!tool) return { text: `There is no tool named ${name}.`, isError: true, status: 'error' };
  const r = await ctx.servers.find((s) => s.name === tool.server)!.call(tool, args, signal, deadline);
  ctx.catalog = ctx.servers.flatMap((s) => s.tools);
  return r;
}

// ---- entry points ----------------------------------------------------------------------------------------------------

async function startMcp(required: boolean): Promise<McpClient[]> {
  const servers: McpClient[] = [];
  for (const [name, u, k] of [['world', 'HE_WORLD_MCP_URL', 'HE_WORLD_MCP_TOKEN'], ['gbrain', 'HE_GBRAIN_MCP_URL', 'HE_GBRAIN_MCP_TOKEN']] as const) {
    if (env[u] && env[k]) servers.push(new McpClient(name, env[u]!, env[k]!));
  }
  if (required && !servers.some((s) => s.name === 'world')) throw new ZeroError('HE-ADAPTER-004', 'serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN; fix: pass both from the world trial.json');
  for (const s of servers) {
    try { await s.initialize(AbortSignal.timeout(30_000)); } catch (e) {
      throw new ZeroError('HE-ZERO-005', `MCP server ${s.name} could not be initialized: ${(e as Error).message.slice(0, 200)}; fix: check that the server answers at ${env[s.name === 'world' ? 'HE_WORLD_MCP_URL' : 'HE_GBRAIN_MCP_URL']}`);
    }
    log(`MCP server ${s.name}: protocol ${s.protocol}, ${s.tools.length} tools, instructions ${s.instructions ? 'yes' : 'no'}, session ${s.sessionId ? 'yes' : 'none'}`);
  }
  return servers;
}

async function setup(entry: string): Promise<Ctx> {
  if (!env.HE_LOG_DIR) throw new ZeroError('HE-ZERO-008', 'HE_LOG_DIR is not set; fix: start Harness Zero through adapter.sh with the environment docs/adapters.md lists');
  mkdirSync(env.HE_LOG_DIR, { recursive: true });
  const set = resolveSet(env.HE_HARNESS_CONFIG);
  const missing = ['HE_MODEL_BASE_URL', 'HE_MODEL_API_KEY', 'HE_MODEL_NAME'].filter((v) => !env[v]);
  if (missing.length) throw new ZeroError('HE-ZERO-008', `${missing.join(', ')} not set; fix: set them as docs/adapters.md "Environment" says`);
  const envBudget = Number(env.HE_TIME_BUDGET_S ?? 300);
  if (!(Number.isFinite(envBudget) && envBudget > 0)) throw new ZeroError('HE-ZERO-008', 'HE_TIME_BUDGET_S is not a positive number of seconds; fix: set it as docs/adapters.md "Environment" says');
  const { wire } = wireFor(env.HE_MODEL_BASE_URL!, set);
  const servers = await startMcp(entry === 'serve');
  log(`harness-zero set=${set.name} candidate=${candidateHash(set).candidate_sha256.slice(0, 12)} wire=${wire} model=${env.HE_MODEL_NAME} features=${set.features.join(',') || 'none'} entry=${entry}`);
  return { set, model: env.HE_MODEL_NAME!, target: { baseUrl: env.HE_MODEL_BASE_URL!, apiKey: env.HE_MODEL_API_KEY!, wire }, servers, catalog: servers.flatMap((s) => s.tools) };
}

async function serve(ctx: Ctx, stop: AbortController): Promise<number> {
  const dir = env.HE_TURNS_DIR ?? '/he-turns';
  mkdirSync(dir, { recursive: true });
  const hash = candidateHash(ctx.set);
  const ready = { harness: 'harness-zero', trial: trial(), ready_at: new Date().toISOString(), session_keys: 'dm:<member> | channel:<id>, :t<thread_ts> for a thread; files sha256(key) under /harness-state/zero/sessions',
    config: ctx.set.name, candidate_sha256: hash.candidate_sha256, candidate_inputs: hash.inputs, features: ctx.set.features, knobs: ctx.set.knobs, wire: ctx.target.wire, model: ctx.model,
    mcp_servers: ctx.servers.map((s) => s.name).join(' '), adapter_sha256: env.HE_ZERO_ADAPTER_SHA256 ?? null };
  writeAtomic(join(env.HE_LOG_DIR!, 'ready'), JSON.stringify(ready) + '\n');
  log(`serve: ready; polling ${dir}`);
  while (!stop.signal.aborted) {
    for (const f of readdirSync(dir).filter((n) => /^turn-\d+\.request\.json$/.test(n)).sort()) {
      if (stop.signal.aborted) break;
      const resp = join(dir, f.replace('.request.json', '.response.json'));
      if (existsSync(resp)) continue;
      const startedAt = new Date().toISOString();
      let turn = Number(f.slice(5, -13)), out: TurnOutcome, req: Json = {}, bad: string | null = null;
      try { req = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { bad = `is not JSON (${(e as Error).message.slice(0, 120)})`; }
      const budget = req?.time_budget_s === undefined ? Number(env.HE_TIME_BUDGET_S ?? 300) : req.time_budget_s;
      bad ??= !req || typeof req !== 'object' ? 'is not a JSON object'
        : !Number.isInteger(req.turn) || req.turn < 1 ? 'has no turn number'
        : typeof req.prompt !== 'string' ? 'has no prompt'
        : typeof req.actor?.member !== 'string' ? 'has no actor.member'
        : typeof req.channel?.id !== 'string' || !['dm', 'channel'].includes(req.channel.type) ? 'has no channel id and type'
        : typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0 ? 'has no positive time_budget_s'
        : null;
      if (bad) out = { exit: 2, reply: null, stop: 'bad-request', detail: `HE-ZERO-009 ${f} ${bad}; fix: the runner writes a whole TurnRequest (runner/contracts.ts) and renames it into place` };
      else try {
        turn = req.turn;
        const key = sessionKey(req as Parameters<typeof sessionKey>[0]);
        const started = stateDir('started', f);
        if (existsSync(started)) out = { exit: 2, reply: null, stop: 'restarted', detail: `HE-ZERO-006 turn ${turn} was already started by an earlier serve process that ended before answering; its tool calls may have run, so it is not run again` };
        else {
          mkdirSync(stateDir('started'), { recursive: true });
          writeFileSync(started, startedAt);
          log(`turn ${turn}: session ${key}, budget ${budget}s`);
          out = await runTurn(ctx, key, req.prompt, budget, turn, stop.signal);
        }
      } catch (e) { out = { exit: 2, reply: null, stop: 'crash', detail: `HE-ZERO-006 crash: ${crashTrace(e)}; trace in zero-trace.log` }; }
      const response = { turn, exit: out.exit, reply_text: out.exit === 0 ? out.reply : null, started_at: startedAt, ended_at: new Date().toISOString(), ...(out.detail ? { detail: out.detail } : {}) };
      writeAtomic(resp, JSON.stringify(response));
      log(`turn ${turn}: exit ${out.exit}${out.detail ? ' (' + out.detail + ')' : ''}`);
    }
    await sleep(250, stop.signal).catch(() => undefined);
  }
  log('serve: stopped on signal');
  return 0;
}

async function run(ctx: Ctx, stop: AbortController): Promise<number> {
  const path = join(env.HE_WORKSPACE_DIR ?? '/workspace', 'instruction.md');
  if (!existsSync(path)) throw new ZeroError('HE-ZERO-008', `no readable ${path}; fix: the runner copies the task instruction.md into the workspace`);
  const out = await runTurn(ctx, 'run:' + trial(), readFileSync(path, 'utf8'), Number(env.HE_TIME_BUDGET_S ?? 300), 1, stop.signal);
  if (out.exit === 0) { process.stdout.write((out.reply ?? '') + '\n'); log(`completed (${out.stop})`); } else log(`exit ${out.exit}: ${out.detail}`);
  return out.exit;
}

// ---- explain ---------------------------------------------------------------------------------------------------------

const SAMPLE_SERVER = { name: 'world', instructions: 'Sample instructions: explain uses this sample tool catalog, not a live server.' };
const SAMPLE_TOOLS: ToolDef[] = [
  { name: 'mcp__world__read_channel', tool: 'read_channel', server: 'world', readOnly: true, description: 'Read recent messages in a channel.', schema: { type: 'object', properties: { channel: { type: 'string' } }, required: ['channel'] } },
  { name: 'mcp__world__post_message', tool: 'post_message', server: 'world', description: 'Post a message to a channel as the bot.', schema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },
];

/** The first request body a set sends for a sample DM, on the sample tool catalog. */
export function firstRequest(set: ResolvedSet, provider: Provider, model: string): { wire: Wire; body: Json } {
  const { wire } = wireFor('http://explain/' + provider, set);
  const session: Session = { key: 'dm:sample-member', scope: 'dm:sample-member', created_at: '', turns: 0, wire, system: systemPrompt(set, [SAMPLE_SERVER], []), notes_shown: 0, history: [] };
  CLIENTS[wire].user(session.history, 'Sample request: what changed in #general today?');
  return { wire, body: CLIENTS[wire].build({ model, set, tools: exposedTools(set, SAMPLE_TOOLS), session }) };
}

/** JSON paths whose values differ between two bodies. */
export function diffPaths(a: unknown, b: unknown, path = ''): Array<{ path: string; a: unknown; b: unknown }> {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => diffPaths((a as Json)[k], (b as Json)[k], path + (Array.isArray(a) ? `[${k}]` : `.${k}`)));
  }
  return [{ path: path || '.', a, b }];
}

async function explain(argv: string[]): Promise<number> {
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const set = resolveSet(opt('--config') ?? '');
  const provider = (opt('--provider') ?? 'anthropic') as Provider;
  const model = opt('--model') ?? env.HE_MODEL_NAME ?? (provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-6.1-sol');
  const a = firstRequest(set, provider, model);
  const sha = candidateHash(set).candidate_sha256;
  const other = opt('--diff');
  if (other) {
    const setB = resolveSet(other);
    const b = firstRequest(setB, provider, model);
    process.stdout.write(JSON.stringify({ a: set.name, b: setB.name, provider, wire: a.wire, a_candidate_sha256: sha, b_candidate_sha256: candidateHash(setB).candidate_sha256,
      features_only_in_a: set.features.filter((f) => !setB.features.includes(f)), features_only_in_b: setB.features.filter((f) => !set.features.includes(f)),
      first_request_changes: diffPaths(a.body, b.body).map((d) => ({ path: d.path, a: JSON.stringify(d.a)?.slice(0, 160) ?? null, b: JSON.stringify(d.b)?.slice(0, 160) ?? null })) }, null, 2) + '\n');
    return 0;
  }
  const bytes = Buffer.byteLength(JSON.stringify(a.body));
  let tokens: Json = { estimate: Math.ceil(bytes / 4), label: 'estimate: request bytes / 4' };
  const countUrl = opt('--count-tokens');
  if (countUrl) {
    if (a.wire !== 'anthropic') throw new ZeroError('HE-ZERO-003', `--count-tokens needs the anthropic wire; set ${set.name} on ${provider} uses ${a.wire}; fix: drop --count-tokens (no exact count on OpenAI or Particle)`);
    const { max_tokens: _cap, ...countBody } = a.body;
    const res = await fetch(countUrl.replace(/\/+$/, '') + '/v1/messages/count_tokens', { method: 'POST', body: JSON.stringify(countBody),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(env.HE_MODEL_API_KEY ? { 'x-api-key': env.HE_MODEL_API_KEY } : {}) } });
    const j = await res.json().catch(() => ({})) as Json;
    if (!res.ok || typeof j.input_tokens !== 'number') throw new ZeroError('HE-ZERO-007', `count_tokens answered ${res.status}: ${redact(JSON.stringify(j)).slice(0, 200)}`, 3);
    tokens = { exact: j.input_tokens, label: 'exact: Anthropic count_tokens through the proxy' };
  }
  process.stdout.write(JSON.stringify({ config: set.name, candidate_sha256: sha, provider, wire: a.wire, model, features: set.features, knobs: set.knobs,
    tool_catalog: 'sample: 2 tools and sample instructions, not a live server', first_request: a.body, first_request_bytes: bytes, tokens }, null, 2) + '\n');
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const entry = argv[0] ?? 'run';
  if (entry === 'explain') return explain(argv.slice(1));
  if (entry !== 'run' && entry !== 'serve') { log(`unknown entry point: ${entry}; 'run', 'serve' and 'explain' are implemented`); return 2; }
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => stop.abort(new Error('sigterm')));
  const ctx = await setup(entry);
  if (stop.signal.aborted) { log('stopped by SIGTERM before ready'); return entry === 'serve' ? 0 : 2; }
  return entry === 'serve' ? serve(ctx, stop) : run(ctx, stop);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof ZeroError) log(e.message);
    else log(`HE-ZERO-006 crash: ${crashTrace(e)}; trace in zero-trace.log`);
    process.exit(e instanceof ZeroError ? e.exit : 2);
  });
}
