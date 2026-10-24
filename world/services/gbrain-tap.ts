// The gbrain tap: POST /gbrain on the world server. Every gbrain MCP request a harness makes goes through
// here, so it is attributed to the bot by the world's own token, forwarded upstream with the sidecar's
// bearer token (which the harness never sees), and recorded in the same event log as every world call,
// with via "gbrain" (docs/gbrain-arm.md, the shared contract between lanes D and E). The tap exists only
// when the server has an upstream; without one the route is a 404 like any other unknown path.
//
// One WorldEvent per JSON-RPC message for initialize, tools/list and tools/call (nothing for
// notifications, ping or other methods), recorded after the upstream reply so outcome and latency are
// known. effect.pages carries the gbrain page slugs the call returned or targeted.
//
// internal-task (company brain): under member scope the upstream also carries the company brain's per-member tokens, and
// the tap presents the token of the member whose turn is running (the requester the runner sets through
// POST /admin/gbrain/requester), or the public-only token before the first turn. The requester is read once, before
// the first await, so a turn change while a request is in flight cannot swap its token. Every gbrain event names the
// token it went out under in grant, and a tool result gbrain refused is classified by gbrain's own error code
// (permission_denied, page_not_found) instead of the generic tool_error.

import type { Member } from '../types.ts';
import type { EventLog } from './events.ts';

export interface GbrainUpstream {
  /** Base URL of the sidecar, for example http://127.0.0.1:41234; the tap posts to <url>/mcp. */
  url: string;
  /** The trial's unscoped token, minted by the sidecar; the only token without member scope. */
  token: string;
  /** internal-task: member scope. The company brain's tokens.json: one granted token per member and the public-only token. */
  tokens?: { members: Record<string, string>; public_only: string };
}

/** Starter-surface tools that change the brain; every other tool, and initialize and tools/list, is a read. */
export const GBRAIN_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'remember', 'forget', 'put_page', 'edit_page', 'capture', 'add_timeline_entry', 'cancel_write_request', 'cancel_job', 'mute_notice',
]);

/** Tools whose argument names the page the call targets, listed even when the result carries no slug. */
const TARGETED_BY_SLUG: ReadonlySet<string> = new Set(['get_page', 'put_page', 'edit_page']);

interface RpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

/** Parse a JSON or SSE-framed JSON-RPC body into its messages. Anything unparsable yields []. */
export function parseRpcBody(text: string, contentType: string | null): RpcMessage[] {
  if ((contentType ?? '').includes('text/event-stream')) {
    const out: RpcMessage[] = [];
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { const v = JSON.parse(data); out.push(...(Array.isArray(v) ? v : [v])); } catch { /* not a JSON frame */ }
    }
    return out;
  }
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : [v]; } catch { return []; }
}

/** Every string value under a key named slug, in order, deduplicated. */
export function collectSlugs(value: unknown, into: string[] = [], seen = new Set<string>()): string[] {
  if (Array.isArray(value)) { for (const v of value) collectSlugs(v, into, seen); return into; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'slug' && typeof v === 'string' && v && !seen.has(v)) { seen.add(v); into.push(v); }
      else collectSlugs(v, into, seen);
    }
  }
  return into;
}

/** The JSON a gbrain tool result carries: each content[].text that parses, plus structuredContent. _meta
 *  (notices, hot memory) is left out so a notice's suggested call never counts as a page the call touched. */
function resultPayloads(result: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const content = Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: string }> : [];
  for (const c of content) {
    if (typeof c.text !== 'string') continue;
    const t = c.text.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try { out.push(JSON.parse(t)); } catch { /* prose */ }
  }
  if (result.structuredContent !== undefined) out.push(result.structuredContent);
  return out;
}

export interface GbrainEffect { pages: string[]; count: number; latency_ms: number }

/** The event fields for one request message and its reply. tool is gbrain.<name>; kind follows GBRAIN_WRITE_TOOLS. */
export function describeCall(request: RpcMessage, reply: RpcMessage | undefined, latencyMs: number, upstreamStatus: number | null): {
  tool: string; kind: 'read' | 'write'; args: unknown; outcome: 'ok' | 'error'; error?: string; effect: GbrainEffect;
} | null {
  const method = request.method;
  if (method !== 'initialize' && method !== 'tools/list' && method !== 'tools/call') return null;
  const name = method === 'tools/call' ? String(request.params?.name ?? 'unknown') : method;
  const args = method === 'tools/call' ? (request.params?.arguments ?? {}) : {};
  const kind = GBRAIN_WRITE_TOOLS.has(name) ? 'write' : 'read';
  const effect: GbrainEffect = { pages: [], count: 0, latency_ms: latencyMs };
  let outcome: 'ok' | 'error' = 'ok';
  let error: string | undefined;
  const result = reply?.result && typeof reply.result === 'object' ? reply.result as Record<string, unknown> : null;
  if (upstreamStatus !== null && (upstreamStatus < 200 || upstreamStatus >= 300)) { outcome = 'error'; error = `upstream_${upstreamStatus}`; }
  else if (!reply) { outcome = 'error'; error = 'no_response'; }
  else if (reply.error) { outcome = 'error'; error = `rpc_${reply.error.code ?? 'error'}`; }
  else if (result?.isError === true) {
    const code = resultPayloads(result).map((p) => (p && typeof p === 'object' ? (p as { code?: unknown }).code : undefined)).find((v) => typeof v === 'string' && /^[a-z_]+$/.test(v));
    outcome = 'error'; error = typeof code === 'string' ? code : 'tool_error';
  }
  if (method === 'tools/list') {
    effect.count = Array.isArray(result?.tools) ? (result!.tools as unknown[]).length : 0;
  } else if (method === 'tools/call') {
    const requested = TARGETED_BY_SLUG.has(name) && typeof (args as Record<string, unknown>).slug === 'string' ? [(args as Record<string, unknown>).slug as string] : [];
    const payloads = result ? resultPayloads(result) : [];
    const seen = new Set(requested);
    effect.pages = [...requested];
    for (const p of payloads) collectSlugs(p, effect.pages, seen);
    const rows = payloads.find((p) => Array.isArray(p)) as unknown[] | undefined;
    effect.count = (name === 'search' || name === 'query') && rows ? rows.length : effect.pages.length;
  }
  return { tool: `gbrain.${name}`, kind, args, outcome, ...(error ? { error } : {}), effect };
}

const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), { status, headers: { 'content-type': 'application/json', ...extra } });

export interface GbrainTapOptions {
  upstream: GbrainUpstream;
  resolveActor: (req: Request) => Member | null;
  log: EventLog;
  /** internal-task: the member whose turn is running, or null outside every turn; only read under member scope. */
  requester?: () => string | null;
  fetchImpl?: typeof fetch;
}

/** internal-task: which token the tap presents for this request, named as the event's grant. */
export function grantFor(upstream: GbrainUpstream, requester: string | null): { grant: string; token: string | null } {
  if (!upstream.tokens) return { grant: 'bot', token: upstream.token };
  if (requester === null) return { grant: 'public-only', token: upstream.tokens.public_only };
  return { grant: requester, token: upstream.tokens.members[requester] ?? null };
}

export async function handleGbrainRequest(req: Request, o: GbrainTapOptions): Promise<Response> {
  if (req.method !== 'POST') {
    // gbrain's own HTTP transport answers GET /mcp with 405 (it opens no server-initiated stream); the tap says the same.
    return rpcError(405, -32000, 'Method not allowed; the gbrain tap is stateless and only serves POST', { allow: 'POST' });
  }
  const actor = o.resolveActor(req);
  if (!actor) return rpcError(401, -32001, 'unknown or missing bearer token', { 'www-authenticate': 'Bearer realm="world-gbrain"' });
  const { grant, token } = grantFor(o.upstream, o.requester?.() ?? null);
  if (token === null) return rpcError(502, -32000, `no gbrain token for member ${grant}; the company brain's tokens.json does not cover this requester`);
  const bodyText = await req.text();
  const requests = parseRpcBody(bodyText, 'application/json');
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': req.headers.get('content-type') ?? 'application/json',
    accept: req.headers.get('accept') ?? 'application/json, text/event-stream',
  };
  const protocol = req.headers.get('mcp-protocol-version');
  if (protocol) headers['mcp-protocol-version'] = protocol;

  const started = Date.now();
  let upstream: Response | null = null;
  let replyText = '';
  let fetchError: string | null = null;
  try {
    upstream = await (o.fetchImpl ?? fetch)(`${o.upstream.url}/mcp`, { method: 'POST', headers, body: bodyText });
    replyText = await upstream.text();
  } catch (e) {
    fetchError = (e as Error).message;
  }
  const latency = Date.now() - started;
  const replies = upstream ? parseRpcBody(replyText, upstream.headers.get('content-type')) : [];
  const byId = new Map<string, RpcMessage>();
  for (const r of replies) if (r.id !== undefined && r.id !== null) byId.set(String(r.id), r);
  const status = upstream ? upstream.status : null;
  for (const request of requests) {
    const reply = request.id !== undefined && request.id !== null ? byId.get(String(request.id)) : undefined;
    const d = describeCall(request, reply, latency, fetchError ? 502 : status);
    if (!d) continue;
    o.log.append({ actor: actor.id, via: 'gbrain', tool: d.tool, kind: d.kind, args: d.args, outcome: d.outcome, ...(d.error ? { error: fetchError ? 'upstream_unreachable' : d.error } : {}), effect: { ...d.effect }, grant });
  }
  if (!upstream) return rpcError(502, -32000, `gbrain upstream unreachable: ${fetchError}`);
  const out = new Headers();
  for (const h of ['content-type', 'cache-control', 'mcp-session-id', 'mcp-protocol-version']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  const bodyless = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(bodyless ? null : replyText, { status: upstream.status, headers: out });
}
