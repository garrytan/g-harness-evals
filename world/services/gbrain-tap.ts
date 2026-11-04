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
//
// internal-task (the install ladder): recall joins search and query in the row-count branch (its results carry slug, so
// cross-scope reads on the verbs surface are measurable), and effect.degraded carries gbrain's own stamp when a reply
// fell back to keyword search (recall's search_degraded or facts_degraded.reason), which the runner's semantic check reads.
//
// internal-task (gbrain#7481, scope "sources"): the upstream may carry the company brain's member-to-sources grants instead of
// member tokens. Every search and query (and, from gbrain#8074, recall and list_pages; SOURCE_SCOPED_TOOLS) then goes out
// under the trial's one unscoped token with source_ids set to the
// requesting member's granted sources (the public source before the first turn), intersected with any source_ids the
// harness itself named; a harness that names only sources outside the grant is answered permission_denied by the tap in
// gbrain's own shape, and nothing is forwarded. The event's args carry the source_ids as forwarded (and the harness's own
// under source_ids_requested when they differed), effect.sources the distinct source_id of the rows that came back, so a
// keyless check can prove no row's source lay outside the grant. The harness prompt does not change.
//
// internal-task (QM M1, provider-aware scoring; off unless the upstream carries provider): QM at b6786d67 can call gbrain itself on
// every turn as a memory provider (MEMORY_PROVIDER_CONFIG), and those calls reach the tap beside the model's own gbrain
// tool calls. QM's provider client authenticates with its own client-credentials access token, and its MCP connector with
// the bearer token the adapter registers, so the bearer is a signal the model cannot forge: it never sees either credential.
// With upstream.provider set, a request whose bearer is one of provider.tokens comes from the provider client (authenticated
// by them: a fixed list recorded under provider.actor, or the world OAuth issuer's map of issued token to member when
// provider.clients is set) and goes out whole-brain, under the unscoped token with no source_ids, whatever the scope; every
// other request is a model call through the connector, authenticated and scoped as before. The provider client serves two paths with the same token (a third, MemoryService.read, only on a route with
// manage: true, which the wiring must keep off; docs/gbrain-arm.md): the per-turn recall, which always sends maxChars (the
// provider's maxCharsArg), and the model's own memory search (QM's memory tool, action search), which never does; so
// provider_op says recall, query, write (a write tool, such as QM's explicit capture) or unknown (when the cell did not
// name max_chars_arg). Every gbrain event then carries
// caller; a provider event also carries provider_actor, the member it named (the acting_user argument, and the x-qm-actor
// header, which QM's provider client does not send before M2b) exactly as sent; a provider read carries effect.delivery,
// which of effect.facts reached QM's turn after its handling of the result (qmDelivery), and a model tools/call carries
// effect.returned_by_gbrain, the facts gbrain returned (an upper bound on what the model saw). Without
// upstream.provider nothing here runs and every event is byte-identical to the tap before this change.
// internal-task (internal-task, scope "member-sources"): the upstream carries both the member tokens and the grants, so each call goes
// out under the requesting member's own token (granted server-side with gbrain auth rescope at image build) and carries
// that member's source_ids as well: two layers, either of which alone keeps rows inside the grant at gbrain 0.60.522.0.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Member } from '../types.ts';
import type { EventLog } from './events.ts';

export interface GbrainUpstream {
  /** Base URL of the sidecar, for example http://127.0.0.1:41234; the tap posts to <url>/mcp. */
  url: string;
  /** The trial's unscoped token, minted by the sidecar; the only token without member scope. */
  token: string;
  /** internal-task: member scope. The company brain's tokens.json: one granted token per member and the public-only token. */
  tokens?: { members: Record<string, string>; public_only: string };
  /** internal-task (gbrain#7481): scope "sources". The company brain's grants: each member's readable source ids, and the sources
   *  every member may read (the public source), presented before the first turn. Every call keeps the unscoped token, unless
   *  tokens is set too (internal-task, scope "member-sources"), when it carries the member's token. */
  grants?: { members: Record<string, string[]>; public: string[] };
  /** internal-task: live ingestion (world/services/gbrain-ingest.ts): the per-source ingest tokens and the conversation map. The tap
   *  itself never uses them; the server builds the ingestion module from them when the upstream is set. */
  ingest?: { tokens: Record<string, string>; channels: Record<string, string>; dm_source_prefix: string };
  /** internal-task: provider-aware scoring for QM's memory provider. Absent, the tap behaves exactly as before. */
  provider?: GbrainProviderCallers;
}

/** internal-task: how the tap tells QM's memory-provider recalls from the model's own gbrain calls. */
export interface GbrainProviderCallers {
  /** Bearer values only QM core's memory-provider client presents. Either a fixed list, or, with clients set, the world OAuth
   *  issuer's map of each access token it issued to the member its client acts as (oauth-issuer.ts), empty until core asks. */
  tokens: string[] | Record<string, string>;
  /** internal-task (#159): the OAuth client-credentials clients the world's issuer accepts, client id to its secret and the member
   *  it acts as. Set, the world serves the issuer and tokens is its issued map. */
  clients?: Record<string, { secret: string; member: string }>;
  /** The event actor for a provider call under a fixed token list: the world member the provider client stands for (the bot,
   *  in QM cells). Under clients the actor is the member the issued token's client acts as. */
  actor?: string;
  /** QM's recall cap when the call does not carry max_chars_arg; QM_RECALL_MAX_CHARS when absent. */
  max_chars?: number;
  /** The tool argument that names the member (QM's actorArg); acting_user when absent. */
  actor_arg?: string;
  /** The provider's maxCharsArg in MEMORY_PROVIDER_CONFIG. A provider call carrying it is the per-turn recall, one without it
   *  the model's memory search. Absent, provider_op is unknown and mechanism.ts --provider-aware refuses the run. */
  max_chars_arg?: string;
  /** The provider's timeoutMs; QM_PROVIDER_TIMEOUT_MS when absent. A provider reply slower than this is dropped by QM. */
  timeout_ms?: number;
}

/** QM's per-turn recall cap at b6786d67: RECALL_MAX_CHARS in src/memory/notebook.ts, passed as maxChars by
 *  src/resolution/turn-context.ts and applied by src/memory/mcp-memory-provider.ts. */
export const QM_RECALL_MAX_CHARS = 6000;

/** QM's default memory-provider timeout at b6786d67 (timeoutMs in src/memory/provider-config.ts, applied with withTimeout). */
export const QM_PROVIDER_TIMEOUT_MS = 3000;

/** The most lines a memory search can hand on at b6786d67: searchAcrossScopes clamps its limit to 1..50 (default 20) and the
 *  provider's query keeps that many non-empty lines (src/memory/cross-scope.ts, mcp-memory-provider.ts). */
export const QM_SEARCH_MAX_LINES = 50;

/** internal-task: which saved facts of one provider read reached QM's turn. facts lines up with effect.facts. */
export interface GbrainDelivery {
  /** Characters of the text QM takes from the result, before any cap. */
  text_chars: number;
  /** Characters left after QM's cap and trim; 0 means QM injects nothing for a provider recall. */
  delivered_chars: number;
  /** The cap applied: the recall cap for a provider recall, null for a search. */
  cap: number | null;
  /** A provider memory search only: the line cap applied, QM_SEARCH_MAX_LINES. The real limit is the model's (default 20) and
   *  the lines are shared with the notebook, so this delivery is an upper bound. */
  lines?: number;
  /** A call QM drops: tool_error (an isError result or any failed call: an HTTP error, a JSON-RPC error, a denial or no
   *  reply) or
   *  timeout (a provider call slower than timeout_ms, failed or not: its event can land in a later turn). delivered_chars is
   *  then 0 and every fact false. */
  dropped?: 'tool_error' | 'timeout';
  /** unknown: matching would take more than MATCH_WORK_BUDGET, so it was not run and every fact is false (not delivered). */
  match?: 'unknown';
  /** For each of effect.facts, whether QM hands it on: one of its occurrences survives and lies inside no longer fact's. */
  facts: boolean[];
  /** For each of effect.facts, whether gbrain returned it in the text QM takes from the result, before any cap: one of its
   *  occurrences lies inside no longer fact's. A fact only in _meta (gbrain's retrieval metadata) is never returned. False
   *  wherever facts is all false for a dropped call, an empty text or an unknown match; when matching the whole text would
   *  pass MATCH_WORK_BUDGET, it is the delivered facts only (a lower bound). */
  returned: boolean[];
}

/** internal-task: the most matching work qmDelivery does for one call, in characters scanned plus pattern characters over every
 *  fact form. Above it the match is not run and the delivery is unknown (every fact not delivered), never a stall: a 6,000
 *  character recall with 100 forms is about 0.6 million, and a pathological search (one 200,000 character line, 64
 *  overlapping 1 KB facts) about 13 million. */
export const MATCH_WORK_BUDGET = 10_000_000;

/** Calls hit(i) for each start i < end of pattern s in text (Knuth-Morris-Pratt, so linear in end + s.length) until hit
 *  returns true. */
function occurrences(text: string, s: string, end: number, hit: (i: number) => boolean): boolean {
  const m = s.length;
  const fail = new Int32Array(m);
  for (let i = 1, k = 0; i < m; i++) {
    while (k && s.charCodeAt(i) !== s.charCodeAt(k)) k = fail[k - 1]!;
    if (s.charCodeAt(i) === s.charCodeAt(k)) k++;
    fail[i] = k;
  }
  for (let i = 0, k = 0, n = Math.min(text.length, end - 1 + m); i < n; i++) {
    while (k && text.charCodeAt(i) !== s.charCodeAt(k)) k = fail[k - 1]!;
    if (text.charCodeAt(i) === s.charCodeAt(k)) k++;
    if (k === m) {
      if (hit(i - m + 1)) return true;
      k = fail[k - 1]!;
    }
  }
  return false;
}

/** internal-task: what QM at b6786d67 hands on from a gbrain tool result to a provider read, and which facts survive in it. The
 *  text is the result's text parts joined by newlines and trimmed (src/mcp/mcp-client.ts mcpResultText), or structuredContent
 *  as JSON when there is none; _meta never reaches QM. A recall keeps the first cap characters and trims again
 *  (src/memory/mcp-memory-provider.ts); a memory search keeps the first lines non-empty lines (the provider's query) and is
 *  matched with empty lines dropped, from the text and from each fact. A fact is delivered when an occurrence of its text,
 *  raw or JSON-escaped, ends inside what QM hands on and lies inside no occurrence of a longer fact's text, so a cut row never
 *  rides on a kept row that contains its words. gbrain writes its tool results with JSON.stringify (src/core/agent-output.ts
 *  at a590ad07), so those two forms are the only spellings of a fact in its text. An empty fact is never delivered. Matching
 *  reads only the first end + longest form - 1 characters, and above MATCH_WORK_BUDGET it is not run (match unknown); a reply
 *  longer than MATCH_WORK_BUDGET characters is not matched either, and is never normalized or split whole.
 *  Later steps can only cut a provider call further (a route label, and recallAcrossScopes' shared budget when notebook
 *  rows outrank the provider's row; the model's search limit and the notebook's lines for a search), so delivered is exact
 *  for the provider step of a recall and an upper bound for the turn. Dropped calls (an isError result, a timeout) are the
 *  caller's to zero. */
export function qmDelivery(result: Record<string, unknown> | null, facts: GbrainFact[], cut: { cap: number } | { lines: number }): GbrainDelivery {
  const content = result && Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: unknown }> : [];
  const joined = content.flatMap((c) => (c?.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('\n').trim();
  const structured = result?.structuredContent;
  const text = joined || (structured == null ? '' : JSON.stringify(structured));
  const search = 'lines' in cut;
  const norm = (s: string) => (search ? s.split('\n').filter(Boolean).join('\n') : s);
  // A reply longer than the budget is never normalized or split whole (a 20 MB newline-heavy search reply cost about 600 ms
  // and 264 MiB there); its delivered text is read line by line from the front, and its match is unknown.
  const over = text.length > MATCH_WORK_BUDGET;
  const firstLines = (s: string, n: number) => {
    const kept: string[] = [];
    for (let i = 0; i <= s.length && kept.length < n;) {
      const j = s.indexOf('\n', i);
      const line = s.slice(i, j < 0 ? s.length : j);
      if (line) kept.push(line);
      if (j < 0) break;
      i = j + 1;
    }
    return kept.join('\n');
  };
  // Positions are in source (text, or for a search text without its empty lines), and what QM hands on is its first end
  // characters.
  const source = over ? '' : norm(text);
  const delivered = search ? (over ? firstLines(text, cut.lines) : source.split('\n').slice(0, cut.lines).join('\n')) : (text.length > cut.cap ? text.slice(0, cut.cap) : text).trim();
  const end = delivered.length;
  const out = { text_chars: text.length, delivered_chars: end, cap: search ? null : cut.cap, ...(search ? { lines: cut.lines } : {}) };
  const forms = facts.map((f) => (f.fact ? [...new Set([norm(f.fact), JSON.stringify(f.fact).slice(1, -1)])].filter(Boolean) : []));
  const none = forms.map(() => false);
  if (!end || !forms.some((f) => f.length)) return { ...out, facts: none, returned: none };
  if (over) return { ...out, match: 'unknown', facts: none, returned: none };
  const workTo = (limit: number) => forms.flat().reduce((w, s) => w + Math.min(source.length, limit - 1 + s.length) + s.length, 0);
  if (workTo(end) > MATCH_WORK_BUDGET) return { ...out, match: 'unknown', facts: none, returned: none };
  // The facts with an occurrence ending at or before limit that lies inside no longer fact's. endAt[p]: the furthest end of
  // an occurrence starting at p; before[p]: the furthest end of one starting before p. An occurrence [i, i + len) lies inside
  // a longer one when one starting before i reaches i + len, or one starting at i passes it. Only occurrences starting before
  // limit matter, as a counted one or as one containing it.
  const found = (limit: number) => {
    const endAt = new Int32Array(limit + 1).fill(-1);
    for (const f of forms) for (const s of f) occurrences(source, s, limit, (i) => { endAt[i] = Math.max(endAt[i]!, i + s.length); return false; });
    const before = new Int32Array(limit + 1).fill(-1);
    for (let p = 1; p <= limit; p++) before[p] = Math.max(before[p - 1]!, endAt[p - 1]!);
    return forms.map((f) => f.some((s) => occurrences(source, s, limit, (i) => i + s.length <= limit && before[i]! < i + s.length && endAt[i]! <= i + s.length)));
  };
  const handed = found(end);
  return { ...out, facts: handed, returned: end === source.length || workTo(source.length) > MATCH_WORK_BUDGET ? handed : found(source.length) };
}

/** Tools that take source_ids: search and query since gbrain 0.60.452.0 (gbrain#7481), recall and list_pages since 0.60.522.0
 *  (gbrain#8074, which leaves the field out of the starter surface's listed schema). The tap narrows exactly these under scope
 *  "sources"; at a pin before 0.60.522.0 gbrain ignores the list on recall and list_pages. */
export const SOURCE_SCOPED_TOOLS: ReadonlySet<string> = new Set(['search', 'query', 'recall', 'list_pages']);

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
/** internal-task: a query fact row's slug (facts/<id>) names a fact, not a page. */
export const FACT_ROW_SLUG = /^facts\/\d+$/;

export function collectSlugs(value: unknown, into: string[] = [], seen = new Set<string>()): string[] {
  if (Array.isArray(value)) { for (const v of value) collectSlugs(v, into, seen); return into; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'slug' && typeof v === 'string' && v && !FACT_ROW_SLUG.test(v) && !seen.has(v)) { seen.add(v); into.push(v); }
      else collectSlugs(v, into, seen);
    }
  }
  return into;
}

/** The JSON a gbrain tool result carries: each content[].text that parses, plus structuredContent. _meta
 *  (notices, hot memory) is left out so a notice's suggested call never counts as a page the call touched. Saved facts
 *  are not here either: search answers them in a prose block and in _meta.retrieval.saved_facts, never as rows (internal-task),
 *  so savedFactsOf reads them on their own. */
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

/** A fact gbrain returned beside a reply's rows: a remember landed in some source and search, query or recall surfaced it.
 *  source_id is present on recall's facts and absent from search's saved_facts at the pin. */
export interface GbrainFact { fact: string; id?: number | string; entity_slug?: string; source_id?: string; source?: string }

const SAVED_FACTS_BLOCK = /^Saved facts \(remember\):/;

/** internal-task: query's facts arm (on by default at the pin) returns matched facts as result rows, result_type "fact" with fact_id
 *  and the fact text at the end of chunk_text ("Saved fact (<kind>; valid from ...; provenance: <source>): <fact>"); search
 *  then leaves those facts out of saved_facts. They are facts, so they are read here and never as pages (collectSlugs drops
 *  the row's facts/<id> slug when a full-shape row carries it). */
function factRowOf(r: unknown): GbrainFact | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const o = r as { result_type?: unknown; fact_id?: unknown; chunk_text?: unknown; source_id?: unknown; fact_row?: { id?: unknown } };
  if (o.result_type !== 'fact' && !o.fact_row) return null;
  const id = typeof o.fact_id === 'string' || typeof o.fact_id === 'number' ? o.fact_id : (typeof o.fact_row?.id === 'number' || typeof o.fact_row?.id === 'string' ? o.fact_row.id : undefined);
  const text = typeof o.chunk_text === 'string' ? o.chunk_text : '';
  const m = /^Saved fact \([^\n]*?\): ([\s\S]+)$/.exec(text);
  const fact = (m ? m[1]! : text).trim();
  if (!fact) return null;
  return { fact, ...(id !== undefined ? { id } : {}), ...(typeof o.source_id === 'string' ? { source_id: o.source_id } : {}) };
}

/** internal-task correction (internal-task): the saved facts a search, query or recall reply carries, read from _meta.retrieval.saved_facts
 *  when present, from recall's own facts array, from query's fact rows (internal-task), and otherwise from the prose
 *  "Saved facts (remember): ..." block whose lines begin "- ". The tap used to read only the JSON blocks and so never saw a
 *  remembered fact (the remember-then-search check always read "not found"); facts are recorded as their own kind, never as
 *  pages. */
export function savedFactsOf(result: Record<string, unknown>, payloads: unknown[]): GbrainFact[] {
  const pick = (f: unknown): GbrainFact | null => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
    const o = f as { fact?: unknown; id?: unknown; entity_slug?: unknown; source_id?: unknown; source?: unknown };
    if (typeof o.fact !== 'string' || !o.fact) return null;
    return {
      fact: o.fact,
      ...(typeof o.id === 'number' || typeof o.id === 'string' ? { id: o.id } : {}),
      ...(typeof o.entity_slug === 'string' ? { entity_slug: o.entity_slug } : {}),
      ...(typeof o.source_id === 'string' ? { source_id: o.source_id } : {}),
      ...(typeof o.source === 'string' ? { source: o.source } : {}),
    };
  };
  const meta = result._meta && typeof result._meta === 'object' ? result._meta as { retrieval?: { saved_facts?: unknown } } : null;
  const fromMeta = Array.isArray(meta?.retrieval?.saved_facts) ? meta!.retrieval!.saved_facts.map(pick).filter((f): f is GbrainFact => f !== null) : [];
  const fromPayload = payloads.flatMap((p) => (p && typeof p === 'object' && !Array.isArray(p) && Array.isArray((p as { facts?: unknown }).facts) ? (p as { facts: unknown[] }).facts.map(pick).filter((f): f is GbrainFact => f !== null) : []));
  const rows = (payloads.find((p) => Array.isArray(p)) as unknown[] | undefined) ?? payloads.flatMap((p) => (p && typeof p === 'object' && Array.isArray((p as { results?: unknown }).results) ? (p as { results: unknown[] }).results : []));
  const fromRows = rows.map(factRowOf).filter((f): f is GbrainFact => f !== null);
  if (fromMeta.length || fromPayload.length || fromRows.length) {
    const out: GbrainFact[] = [];
    const seen = new Set<string>();
    for (const f of [...fromPayload, ...fromMeta, ...fromRows]) { const k = `${f.id ?? ''}|${f.fact}`; if (!seen.has(k)) { seen.add(k); out.push(f); } }
    return out;
  }
  const content = Array.isArray(result.content) ? result.content as Array<{ text?: string }> : [];
  const block = content.find((c) => typeof c.text === 'string' && SAVED_FACTS_BLOCK.test(c.text.trim()));
  if (!block) return [];
  return block.text!.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => ({ fact: l.slice(2).trim() })).filter((f) => f.fact);
}

export interface GbrainEffect {
  pages: string[]; count: number; latency_ms: number;
  /** internal-task (gbrain#7481): the distinct source_id values of the rows a search, query or recall returned, in order of first appearance. */
  sources?: string[];
  /** internal-task: gbrain's degraded stamp on a search, query or recall reply, when present. */
  degraded?: string;
  /** internal-task correction (internal-task): the saved facts the reply carried beside its rows, when any; never counted in pages or count. */
  facts?: GbrainFact[];
}

/** internal-task: recall's search_degraded or facts_degraded.reason from a result payload; null when the reply carries neither. */
export function degradedStampOf(payloads: unknown[]): string | null {
  for (const p of payloads) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const o = p as { search_degraded?: unknown; facts_degraded?: { reason?: unknown } };
    if (typeof o.search_degraded === 'string') return o.search_degraded;
    if (typeof o.facts_degraded?.reason === 'string') return o.facts_degraded.reason;
  }
  return null;
}

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
    // search and query answer an array of rows; recall answers an object whose results are the rows (internal-task).
    const rows = (payloads.find((p) => Array.isArray(p)) as unknown[] | undefined)
      ?? (name === 'recall' ? (payloads.find((p) => p && typeof p === 'object' && Array.isArray((p as { results?: unknown }).results)) as { results: unknown[] } | undefined)?.results : undefined);
    // A query's fact rows are facts, not pages, so the count stays the page rows (effect.facts carries the facts).
    effect.count = (name === 'search' || name === 'query' || name === 'recall') && rows ? rows.filter((r) => !factRowOf(r)).length : effect.pages.length;
    if (name === 'search' || name === 'query' || name === 'recall') {
      const sources = [...new Set((rows ?? []).map((r) => (r && typeof r === 'object' ? (r as { source_id?: unknown }).source_id : undefined)).filter((s): s is string => typeof s === 'string' && s !== ''))];
      if (sources.length) effect.sources = sources;
      const d = degradedStampOf(payloads); if (d) effect.degraded = d;
      if (result) { const facts = savedFactsOf(result, payloads); if (facts.length) effect.facts = facts; }
    }
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

/** internal-task: which token the tap presents for this request, named as the event's grant. internal-task: under scope "sources" the
 *  token is always the unscoped one and sources lists the requester's granted source ids (the public sources outside turns);
 *  null sources for a member the grants do not cover. */
export function grantFor(upstream: GbrainUpstream, requester: string | null): { grant: string; token: string | null; sources?: string[] | null } {
  if (upstream.grants) {
    // internal-task (scope "member-sources"): with member tokens beside the grants, the call carries the member's own token as well.
    const t = upstream.tokens;
    if (requester === null) return { grant: 'public-only', token: t ? t.public_only : upstream.token, sources: upstream.grants.public };
    return { grant: requester, token: t ? t.members[requester] ?? null : upstream.token, sources: upstream.grants.members[requester] ?? null };
  }
  if (!upstream.tokens) return { grant: 'bot', token: upstream.token };
  if (requester === null) return { grant: 'public-only', token: upstream.tokens.public_only };
  return { grant: requester, token: upstream.tokens.members[requester] ?? null };
}

/** gbrain's own permission_denied tool result (0.60.452.0 shape, the fields the tap and graders read), for a request the
 *  tap refuses to forward because every source the harness named lies outside the requester's grant. */
function deniedReply(id: RpcMessage['id'], requested: string[], grant: string): RpcMessage {
  const body = { error: 'permission_denied', code: 'permission_denied', message: 'Requested source is outside your granted sources', suggestion: `${requested.join(', ')} not granted to ${grant}; omit source_ids to read within this member's sources.`, retryable: false };
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true } };
}

/** internal-task (gbrain#7481): the request as the tap forwards it under scope "sources": every SOURCE_SCOPED_TOOLS call gains source_ids set to the
 *  grant, intersected with the harness's own source_ids when it sent any. denied is set when that intersection is empty. */
export function scopeRequest(request: RpcMessage, sources: string[]): { request: RpcMessage; requested?: string[]; denied?: string[] } {
  if (request.method !== 'tools/call' || !SOURCE_SCOPED_TOOLS.has(String(request.params?.name ?? ''))) return { request };
  const args = (request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {}) as Record<string, unknown>;
  const own = Array.isArray(args.source_ids) ? args.source_ids.filter((s): s is string => typeof s === 'string' && s !== '') : [];
  const narrowed = own.length ? sources.filter((s) => own.includes(s)) : sources;
  const scoped = { ...request, params: { ...request.params, arguments: { ...args, source_ids: narrowed } } };
  return { request: scoped, ...(own.length && narrowed.length !== own.length ? { requested: own } : {}), ...(own.length && !narrowed.length ? { denied: own } : {}) };
}

export async function handleGbrainRequest(req: Request, o: GbrainTapOptions): Promise<Response> {
  if (req.method !== 'POST') {
    // gbrain's own HTTP transport answers GET /mcp with 405 (it opens no server-initiated stream); the tap says the same.
    return rpcError(405, -32000, 'Method not allowed; the gbrain tap is stateless and only serves POST', { allow: 'POST' });
  }
  // internal-task: under upstream.provider, the provider client's bearer authenticates it on its own; the model never holds it.
  const provider = o.upstream.provider;
  const bearer = provider ? (/^bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim() ?? null) : null;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const issued = provider && !Array.isArray(provider.tokens) ? provider.tokens : null;
  const providerToken = provider && bearer ? (issued ? Object.keys(issued) : provider.tokens as string[]).reduce<string | null>((hit, t) => (timingSafeEqual(digest(t), digest(bearer)) ? t : hit), null) : null;
  const providerCall = providerToken !== null;
  const actorId = providerCall ? (issued ? issued[providerToken] : provider!.actor) : o.resolveActor(req)?.id;
  if (!actorId) return rpcError(401, -32001, 'unknown or missing bearer token', { 'www-authenticate': 'Bearer realm="world-gbrain"' });
  const actor = { id: actorId };
  // internal-task (plan v3): QM's provider client holds one credential and names no attested member at b6786d67, so a provider call
  // goes out whole-brain, under the trial's unscoped token with no source_ids, whatever the cell's scope. Model calls keep it.
  const { grant, token, sources } = providerCall ? { grant: 'bot', token: o.upstream.token, sources: undefined } : grantFor(o.upstream, o.requester?.() ?? null);
  if (token === null) return rpcError(502, -32000, `no gbrain token for member ${grant}; the company brain's tokens.json does not cover this requester`);
  if (sources === null) return rpcError(502, -32000, `no gbrain source grant for member ${grant}; the company brain's manifest does not cover this requester`);
  const rawText = await req.text();
  const incoming = parseRpcBody(rawText, 'application/json');
  // Under scope "sources" the body is rewritten: SOURCE_SCOPED_TOOLS calls carry the requester's source_ids; a request the tap denies
  // is answered here (in gbrain's shape) and left out of what goes upstream.
  const scoped: ReturnType<typeof scopeRequest>[] = sources ? incoming.map((r) => scopeRequest(r, sources)) : incoming.map((request) => ({ request }));
  const requests = scoped.map((s) => s.request);
  const requestedById = new Map(scoped.filter((s) => s.requested).map((s) => [String(s.request.id), s.requested!]));
  const eventArgs = (request: RpcMessage, args: unknown) => {
    const own = requestedById.get(String(request.id));
    return own && args && typeof args === 'object' ? { ...(args as Record<string, unknown>), source_ids_requested: own } : args;
  };
  // internal-task: the caller fields, effect.delivery on provider reads and effect.returned_by_gbrain on model calls, empty without
  // upstream.provider so every event stays as it was.
  // A provider call is the per-turn recall when it carries max_chars_arg and the model's memory search when it does not; QM
  // drops an isError result or any failed call (its MCP client throws) and a reply slower than the provider's timeout.
  const tagged = (request: RpcMessage, reply: RpcMessage | undefined, effect: GbrainEffect, ok: boolean): { effect: { delivery?: GbrainDelivery; returned_by_gbrain?: Array<number | string> }; event: { caller?: 'provider' | 'model'; provider_actor?: { arg: unknown; header: string | null }; provider_op?: 'recall' | 'query' | 'write' | 'unknown' } } => {
    if (!provider) return { effect: {}, event: {} };
    const call = request.method === 'tools/call';
    const args = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments as Record<string, unknown> : {};
    const result = reply?.result && typeof reply.result === 'object' ? reply.result as Record<string, unknown> : null;
    const facts = effect.facts ?? [];
    // A model call records only which facts gbrain returned: QM may still cut its tool result before the model sees it
    // (agent-tools.ts capResultText, a tool-output store), so this is an upper bound on what reached the model.
    if (!providerCall) return { effect: call ? { returned_by_gbrain: ok ? facts.flatMap((f) => (f.id === undefined ? [] : [f.id])) : [] } : {}, event: { caller: 'model' } };
    const event = { caller: 'provider' as const, provider_actor: { arg: call ? args[provider.actor_arg ?? 'acting_user'] ?? null : null, header: req.headers.get('x-qm-actor') } };
    if (!call) return { effect: {}, event };
    if (GBRAIN_WRITE_TOOLS.has(String(request.params?.name ?? ''))) return { effect: {}, event: { ...event, provider_op: 'write' } };
    const key = provider.max_chars_arg;
    const op = key === undefined ? 'unknown' : args[key] !== undefined ? 'recall' : 'query';
    const sent = key !== undefined && Number.isInteger(args[key]) && (args[key] as number) > 0 ? args[key] as number : undefined;
    const d = qmDelivery(result, facts, op === 'query' ? { lines: QM_SEARCH_MAX_LINES } : { cap: sent ?? provider.max_chars ?? QM_RECALL_MAX_CHARS });
    const dropped = effect.latency_ms > (provider.timeout_ms ?? QM_PROVIDER_TIMEOUT_MS) ? 'timeout' : !ok || result?.isError === true ? 'tool_error' : undefined;
    return { effect: { delivery: dropped ? { ...d, delivered_chars: 0, facts: d.facts.map(() => false), returned: d.returned.map(() => false), dropped } : d }, event: { ...event, provider_op: op } };
  };
  const local = new Map<string, RpcMessage>();
  for (const s of scoped) if (s.denied && s.request.id !== undefined && s.request.id !== null) local.set(String(s.request.id), deniedReply(s.request.id, s.denied, grant));
  const forward = scoped.filter((s) => !s.denied).map((s) => s.request);
  const batched = rawText.trimStart().startsWith('[');
  const bodyText = !sources ? rawText : JSON.stringify(batched ? forward : forward[0] ?? null);
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
  if (local.size && !forward.length) {
    // Everything in the body was denied here: answer it as JSON without an upstream round trip.
    const latency = Date.now() - started;
    for (const request of requests) {
      const reply = local.get(String(request.id));
      const d = describeCall(request, reply, latency, null);
      if (!d) continue;
      const t = tagged(request, reply, d.effect, d.outcome === 'ok');
      o.log.append({ actor: actor.id, via: 'gbrain', tool: d.tool, kind: d.kind, args: eventArgs(request, d.args), outcome: d.outcome, ...(d.error ? { error: d.error } : {}), effect: { ...d.effect, ...t.effect }, grant, ...t.event });
    }
    const out = [...local.values()];
    return new Response(JSON.stringify(batched ? out : out[0]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  try {
    upstream = await (o.fetchImpl ?? fetch)(`${o.upstream.url}/mcp`, { method: 'POST', headers, body: bodyText });
    replyText = await upstream.text();
  } catch (e) {
    fetchError = (e as Error).message;
  }
  const latency = Date.now() - started;
  const replies = upstream ? parseRpcBody(replyText, upstream.headers.get('content-type')) : [];
  const byId = new Map<string, RpcMessage>(local);
  for (const r of replies) if (r.id !== undefined && r.id !== null) byId.set(String(r.id), r);
  const status = upstream ? upstream.status : null;
  for (const request of requests) {
    const reply = request.id !== undefined && request.id !== null ? byId.get(String(request.id)) : undefined;
    const denied = reply !== undefined && local.has(String(request.id));
    const d = describeCall(request, reply, latency, denied ? null : fetchError ? 502 : status);
    if (!d) continue;
    const t = tagged(request, reply, d.effect, d.outcome === 'ok');
    o.log.append({ actor: actor.id, via: 'gbrain', tool: d.tool, kind: d.kind, args: eventArgs(request, d.args), outcome: d.outcome, ...(d.error ? { error: fetchError && !denied ? 'upstream_unreachable' : d.error } : {}), effect: { ...d.effect, ...t.effect }, grant, ...t.event });
  }
  if (!upstream) return rpcError(502, -32000, `gbrain upstream unreachable: ${fetchError}`);
  if (local.size && batched && upstream.ok) {
    // A batch with denied and forwarded requests: splice the local replies in beside the upstream's, as JSON.
    return new Response(JSON.stringify([...replies, ...local.values()]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const out = new Headers();
  for (const h of ['content-type', 'cache-control', 'mcp-session-id', 'mcp-protocol-version']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  const bodyless = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(bodyless ? null : replyText, { status: upstream.status, headers: out });
}
