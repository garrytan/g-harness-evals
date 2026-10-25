// The gbrain tap (world/services/gbrain-tap.ts): a harness's gbrain MCP calls pass through POST /gbrain,
// authenticated as the bot by the world token, forwarded with the sidecar's token, and recorded as
// via "gbrain" events with the slugs they touched (docs/gbrain-arm.md). The upstream here is a small
// bun server speaking gbrain's wire shape (SSE-framed JSON-RPC, 401 on a bad bearer).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { WorldEvent } from '../world/services/events.ts';
import { collectSlugs, describeCall, grantFor, parseRpcBody, scopeRequest } from '../world/services/gbrain-tap.ts';
import type { WorldServer } from '../world/services/server.ts';
import { startWorld } from './world-helpers.ts';

const GBRAIN_TOKEN = 'gbrain_' + 'ab'.repeat(32);
// internal-task (company brain): per-member tokens the upstream also accepts; a granted token sees only its own pages.
const MEMBER_TOKENS = { members: { 'dana-okafor': 'gbrain_' + 'cd'.repeat(32), 'june-osei': 'gbrain_' + 'ef'.repeat(32) }, public_only: 'gbrain_' + '01'.repeat(32) };
const ACCEPTED = new Set([GBRAIN_TOKEN, ...Object.values(MEMBER_TOKENS.members), MEMBER_TOKENS.public_only]);
const seen: Array<{ auth: string | null; accept: string | null; body: unknown }> = [];
let mode: 'ok' | 'http500' = 'ok';

const sse = (messages: unknown[]) => new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const text = (v: unknown) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) });

function toolResult(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search':
    case 'query':
      // internal-task (gbrain#7481): under source_ids the rows carry source_id and only the named sources answer.
      if (Array.isArray(args.source_ids) && args.source_ids.length) {
        const all = [{ slug: 'heldout/chats/north-random', source_id: 'channel-north-random' }, { slug: 'heldout/notes/public-handbook', source_id: 'public' }, { slug: 'heldout/chats/central-standup', source_id: 'team-central' }];
        return { content: [text(all.filter((r) => (args.source_ids as string[]).includes(r.source_id))), text('[gbrain search] Rows are a ranked top-K, not proof of coverage.')] };
      }
      // internal-task: after a remember, search carries the facts in a prose block and in _meta.retrieval.saved_facts, never as rows.
      if (String(args.query ?? '').includes('remembered')) return { _meta: { retrieval: { returned_count: 1, saved_facts: [{ id: 1, fact: 'Door 4B is the Covey & Lark dock', entity_slug: 'covey-lark', kind: 'fact', source: 'test' }] } }, content: [
        text([{ slug: 'heldout/chats/2025-10-15-saltmarsh-churn-risk', title: 'b' }]),
        text('Saved facts (remember): about the entity this query names (newest first), then facts those point to, then matches for its words; recall returns more:\n- Door 4B is the Covey & Lark dock'),
        text('[gbrain search] Rows are a ranked top-K, not proof of coverage.'),
      ] };
      if (String(args.query ?? '').includes('prose-only')) return { content: [
        text([{ slug: 'heldout/chats/2025-10-15-saltmarsh-churn-risk', title: 'b' }]),
        text('Saved facts (remember): about the entity this query names (newest first), then facts those point to, then matches for its words; recall returns more:\n- Door 4B is the Covey & Lark dock\n- Berth 2 closes Friday'),
      ] };
      return { _meta: { gbrain_notices: [{ code: 'degraded_recall', fix: { mcp: { tool: 'get_page', arguments: { slug: 'heldout/notice-must-not-count' } } } }] }, content: [
        text([{ slug: 'heldout/chats/2025-11-17-saltmarsh-discount-retraction', title: 'a', chunk_text: 'x' }, { slug: 'heldout/chats/2025-10-15-saltmarsh-churn-risk', title: 'b' }, { slug: 'heldout/chats/2025-11-17-saltmarsh-discount-retraction', title: 'a again' }]),
        text('[gbrain search] Rows are a ranked top-K, not proof of coverage.'),
      ] };
    case 'get_page':
      if (args.slug === 'heldout/chats/nope') return { content: [text({ error: 'page_not_found', code: 'page_not_found', message: 'Page not found' })], isError: true };
      if (args.slug === 'heldout/emails/sealed' && args.source_id) return { content: [text({ error: 'permission_denied', code: 'permission_denied', message: 'This token cannot read source ' + String(args.source_id) })], isError: true };
      if (args.slug === 'heldout/emails/sealed') return { content: [text('Something went wrong')], isError: true };
      return { content: [text({ id: 2, slug: args.slug, title: '#coastal-random (export)', compiled_truth: '...' })] };
    case 'remember':
      return { content: [text({ id: '1', status: 'inserted', entity_slug: 'probe' })] };
    case 'recall':
      return { content: [text({ facts: [{ id: 1, fact: 'Door 4B is the Covey & Lark dock', entity_slug: 'covey-lark', source_id: 'private-dana-okafor', source: 'test' }], total: 1, results: [{ slug: 'heldout/chats/2025-10-15-saltmarsh-churn-risk', title: 'b' }], search_degraded: 'embed_unavailable' })] };
    case 'list_pages':
      return { content: [text([{ slug: 'heldout/notes/a' }, { slug: 'heldout/notes/b' }])] };
    case 'entity':
      return { content: [text({ found: false, text_mentions: { pages: [{ slug: 'heldout/chats/coastal-team-banter' }] } })] };
    default:
      return { content: [text({ error: 'unknown_tool' })], isError: true };
  }
}

const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (url.pathname !== '/mcp') return Response.json({ error: 'not_found' }, { status: 404 });
    if (req.method !== 'POST') return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { status: 405, headers: { allow: 'POST, DELETE' } });
    if (!ACCEPTED.has((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''))) return Response.json({ error: 'invalid_token' }, { status: 401 });
    const body = await req.json() as Record<string, unknown> | Record<string, unknown>[];
    seen.push({ auth: req.headers.get('authorization'), accept: req.headers.get('accept'), body });
    if (mode === 'http500') return Response.json({ error: 'internal' }, { status: 500 });
    const messages = Array.isArray(body) ? body : [body];
    const replies: unknown[] = [];
    for (const m of messages) {
      const method = m.method as string;
      if (method === 'notifications/initialized') continue;
      if (method === 'initialize') replies.push({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'gbrain', version: 'test' }, capabilities: { tools: {} } } });
      else if (method === 'tools/list') replies.push({ jsonrpc: '2.0', id: m.id, result: { tools: Array.from({ length: 33 }, (_, i) => ({ name: `tool_${i}`, inputSchema: { type: 'object' } })) } });
      else if (method === 'tools/call') { const p = m.params as { name: string; arguments?: Record<string, unknown> }; replies.push({ jsonrpc: '2.0', id: m.id, result: toolResult(p.name, p.arguments ?? {}) }); }
      else if (method === 'ping') replies.push({ jsonrpc: '2.0', id: m.id, result: {} });
      else replies.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    }
    if (!replies.length) return new Response(null, { status: 202 });
    return sse(replies);
  },
});

let ws: WorldServer;
beforeAll(() => { ws = startWorld('gbrain-tap-test', 'heldout'); ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN }); });
afterAll(() => { ws.stop(); upstream.stop(true); });

async function tap(token: string | null, body: unknown, accept = 'application/json, text/event-stream'): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${ws.url}/gbrain`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const gbrainEvents = () => ws.log.events.filter((e) => e.via === 'gbrain');
const last = (): WorldEvent => gbrainEvents().at(-1)!;
async function replyOf(res: Response): Promise<Record<string, unknown>[]> { return parseRpcBody(await res.text(), res.headers.get('content-type')) as Record<string, unknown>[]; }

test('the tap needs the world bot token and never forwards an unauthenticated request', async () => {
  const before = seen.length;
  expect((await tap(null, call(1, 'search', { query: 'x' }))).status).toBe(401);
  expect((await tap('xoxb-wrong', call(1, 'search', { query: 'x' }))).status).toBe(401);
  expect(seen.length).toBe(before);
  expect(gbrainEvents().length).toBe(0);
});

test('GET /gbrain is 405 like gbrain itself, and a world without an upstream has no route', async () => {
  const res = await fetch(`${ws.url}/gbrain`, { headers: { authorization: `Bearer ${ws.credentials.bot.token}` } });
  expect(res.status).toBe(405);
  expect(res.headers.get('allow')).toBe('POST');
  const plain = startWorld('gbrain-tap-none');
  try { expect((await fetch(`${plain.url}/gbrain`, { method: 'POST', headers: { authorization: `Bearer ${plain.credentials.bot.token}` }, body: '{}' })).status).toBe(404); }
  finally { plain.stop(); }
});

test('the bearer header is swapped for the sidecar token, Accept and the body pass through, the SSE reply comes back unchanged', async () => {
  const res = await tap(ws.credentials.bot.token, call(7, 'get_page', { slug: 'heldout/chats/coastal-team-banter' }), 'text/event-stream, application/json');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const up = seen.at(-1)!;
  expect(up.auth).toBe(`Bearer ${GBRAIN_TOKEN}`);
  expect(up.accept).toBe('text/event-stream, application/json');
  expect(up.body).toEqual(call(7, 'get_page', { slug: 'heldout/chats/coastal-team-banter' }));
  const [reply] = await replyOf(res);
  expect(reply.id).toBe(7);
  expect(JSON.stringify(reply)).not.toContain(GBRAIN_TOKEN);
  const e = last();
  expect(e).toMatchObject({ via: 'gbrain', actor: ws.credentials.bot.member, tool: 'gbrain.get_page', kind: 'read', outcome: 'ok', args: { slug: 'heldout/chats/coastal-team-banter' } });
  expect(e.effect).toMatchObject({ pages: ['heldout/chats/coastal-team-banter'], count: 1 });
  expect(typeof (e.effect as { latency_ms: number }).latency_ms).toBe('number');
  expect(e.args_digest).toHaveLength(64);
});

test('search records every row slug once, counts rows, and ignores slugs inside _meta notices', async () => {
  await tap(ws.credentials.bot.token, call(2, 'search', { query: 'saltmarsh discount', limit: 3 }));
  const e = last();
  expect(e.tool).toBe('gbrain.search');
  expect(e.kind).toBe('read');
  expect(e.effect).toMatchObject({ pages: ['heldout/chats/2025-11-17-saltmarsh-discount-retraction', 'heldout/chats/2025-10-15-saltmarsh-churn-risk'], count: 3 });
});

test('saved facts are recorded as their own kind (internal-task): from _meta.retrieval.saved_facts, from the prose block alone, and from recall\'s facts array; never as pages or rows', async () => {
  await tap(ws.credentials.bot.token, call(20, 'search', { query: 'remembered dock', limit: 3 }));
  let e = last();
  expect(e.effect).toMatchObject({ pages: ['heldout/chats/2025-10-15-saltmarsh-churn-risk'], count: 1, facts: [{ id: 1, fact: 'Door 4B is the Covey & Lark dock', entity_slug: 'covey-lark', source: 'test' }] });
  expect((e.effect as { facts: unknown[] }).facts).toHaveLength(1);
  await tap(ws.credentials.bot.token, call(21, 'search', { query: 'prose-only dock', limit: 3 }));
  e = last();
  expect(e.effect).toMatchObject({ pages: ['heldout/chats/2025-10-15-saltmarsh-churn-risk'], count: 1, facts: [{ fact: 'Door 4B is the Covey & Lark dock' }, { fact: 'Berth 2 closes Friday' }] });
  await tap(ws.credentials.bot.token, call(22, 'recall', { query: 'dock', limit: 3 }));
  e = last();
  expect(e.effect).toMatchObject({ pages: ['heldout/chats/2025-10-15-saltmarsh-churn-risk'], count: 1, degraded: 'embed_unavailable', facts: [{ id: 1, fact: 'Door 4B is the Covey & Lark dock', source_id: 'private-dana-okafor' }] });
  await tap(ws.credentials.bot.token, call(23, 'search', { query: 'saltmarsh discount', limit: 3 }));
  expect(last().effect).not.toHaveProperty('facts');
});

test('remember is a write with the arguments as sent and no pages; list_pages and entity list what they returned', async () => {
  await tap(ws.credentials.bot.token, call(3, 'remember', { fact: 'Door 4B', entity: 'Covey & Lark', provenance: 'test' }));
  expect(last()).toMatchObject({ tool: 'gbrain.remember', kind: 'write', outcome: 'ok', args: { fact: 'Door 4B', entity: 'Covey & Lark', provenance: 'test' }, effect: { pages: [], count: 0 } });
  await tap(ws.credentials.bot.token, call(4, 'list_pages', { limit: 2 }));
  expect(last().effect).toMatchObject({ pages: ['heldout/notes/a', 'heldout/notes/b'], count: 2 });
  await tap(ws.credentials.bot.token, call(5, 'entity', { name: 'Saltmarsh' }));
  expect(last().effect).toMatchObject({ pages: ['heldout/chats/coastal-team-banter'], count: 1 });
});

test('initialize and tools/list are reads with empty args; tools/list counts the tools; notifications and ping leave no event', async () => {
  const before = gbrainEvents().length;
  await tap(ws.credentials.bot.token, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  expect(last()).toMatchObject({ tool: 'gbrain.initialize', kind: 'read', args: {}, outcome: 'ok', effect: { pages: [], count: 0 } });
  const n = await tap(ws.credentials.bot.token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  expect(n.status).toBe(202);
  await tap(ws.credentials.bot.token, { jsonrpc: '2.0', id: 9, method: 'ping' });
  await tap(ws.credentials.bot.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  expect(last()).toMatchObject({ tool: 'gbrain.tools/list', kind: 'read', args: {}, outcome: 'ok', effect: { pages: [], count: 33 } });
  expect(gbrainEvents().length - before).toBe(2);
});

test('a batched body yields one event per message', async () => {
  const before = gbrainEvents().length;
  const res = await tap(ws.credentials.bot.token, [call(11, 'search', { query: 'a' }), call(12, 'get_page', { slug: 'heldout/notes/a' }), { jsonrpc: '2.0', id: 13, method: 'ping' }]);
  expect((await replyOf(res)).length).toBe(3);
  const added = gbrainEvents().slice(before);
  expect(added.map((e) => e.tool)).toEqual(['gbrain.search', 'gbrain.get_page']);
});

test('a tool result with isError is an error event named by gbrain\'s own code (page_not_found, permission_denied), tool_error without one; it still names the requested page', async () => {
  const res = await tap(ws.credentials.bot.token, call(21, 'get_page', { slug: 'heldout/chats/nope' }));
  expect(res.status).toBe(200);
  expect(last()).toMatchObject({ tool: 'gbrain.get_page', outcome: 'error', error: 'page_not_found', effect: { pages: ['heldout/chats/nope'], count: 1 }, grant: 'bot' });
  await tap(ws.credentials.bot.token, call(22, 'get_page', { slug: 'heldout/emails/sealed', source_id: 'team-central' }));
  expect(last()).toMatchObject({ tool: 'gbrain.get_page', outcome: 'error', error: 'permission_denied', effect: { pages: ['heldout/emails/sealed'], count: 1 } });
  await tap(ws.credentials.bot.token, call(23, 'get_page', { slug: 'heldout/emails/sealed' }));
  expect(last()).toMatchObject({ tool: 'gbrain.get_page', outcome: 'error', error: 'tool_error' });
});

// internal-task (company brain): member scope.
test('grantFor: no tokens means the bot token; member scope presents public-only outside turns and the requester\'s token inside, null for a member without one', () => {
  expect(grantFor({ url: 'u', token: 't' }, 'dana-okafor')).toEqual({ grant: 'bot', token: 't' });
  expect(grantFor({ url: 'u', token: 't', tokens: MEMBER_TOKENS }, null)).toEqual({ grant: 'public-only', token: MEMBER_TOKENS.public_only });
  expect(grantFor({ url: 'u', token: 't', tokens: MEMBER_TOKENS }, 'june-osei')).toEqual({ grant: 'june-osei', token: MEMBER_TOKENS.members['june-osei'] });
  expect(grantFor({ url: 'u', token: 't', tokens: MEMBER_TOKENS }, 'nobody')).toEqual({ grant: 'nobody', token: null });
});

test('under member scope the tap presents the requester\'s token set through /admin/gbrain/requester, public-only before any turn, and every event names its grant; an unknown member is refused and a member without a token is a 502', async () => {
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN, tokens: MEMBER_TOKENS });
  const admin = (member: string | null) => fetch(`${ws.url}/admin/gbrain/requester`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ member }) });
  try {
    expect(ws.gbrainRequester()).toBeNull();
    seen.length = 0;
    await tap(ws.credentials.bot.token, call(51, 'search', { query: 'before any turn' }));
    expect(seen.at(-1)!.auth).toBe(`Bearer ${MEMBER_TOKENS.public_only}`);
    expect(last()).toMatchObject({ tool: 'gbrain.search', grant: 'public-only', actor: 'assistant' });

    const set = await admin('dana-okafor');
    expect(await set.json()).toEqual({ ok: true, member: 'dana-okafor' });
    expect(ws.gbrainRequester()).toBe('dana-okafor');
    expect(ws.log.events.at(-1)).toMatchObject({ via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, actor: null });
    await tap(ws.credentials.bot.token, call(52, 'get_page', { slug: 'heldout/chats/coastal-team-banter' }));
    expect(seen.at(-1)!.auth).toBe(`Bearer ${MEMBER_TOKENS.members['dana-okafor']}`);
    expect(last()).toMatchObject({ tool: 'gbrain.get_page', grant: 'dana-okafor', outcome: 'ok' });

    expect((await admin('nobody-here')).status).toBe(400);
    expect(ws.gbrainRequester()).toBe('dana-okafor');
    expect((await fetch(`${ws.url}/admin/gbrain/requester`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ member: null }) })).status).toBe(401);

    await admin('kwame-adjei');
    const before = gbrainEvents().length;
    const res = await tap(ws.credentials.bot.token, call(53, 'search', { query: 'no token for kwame' }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('no gbrain token for member kwame-adjei');
    expect(gbrainEvents().length).toBe(before);

    await admin(null);
    expect(ws.gbrainRequester()).toBeNull();
    await tap(ws.credentials.bot.token, call(54, 'search', { query: 'after the turns' }));
    expect(last()).toMatchObject({ grant: 'public-only' });
  } finally {
    await admin(null);
    ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN });
  }
});

test('under scope "sources" every search and query carries the requester\'s source_ids under the unscoped token, the event records the grant and the returned sources, a harness source_ids is intersected, and one naming only foreign sources is denied by the tap in gbrain\'s shape', async () => {
  const GRANTS = { members: { 'dana-okafor': ['private-dana-okafor', 'public', 'channel-north-random'], 'hollis-mbeki': ['private-hollis-mbeki', 'public', 'team-central'] }, public: ['public'] };
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN, grants: GRANTS });
  const admin = (member: string | null) => fetch(`${ws.url}/admin/gbrain/requester`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ member }) });
  const forwarded = () => (seen.at(-1)!.body as { params: { arguments: Record<string, unknown> } }).params.arguments;
  try {
    expect(grantFor({ url: '', token: GBRAIN_TOKEN, grants: GRANTS }, null)).toEqual({ grant: 'public-only', token: GBRAIN_TOKEN, sources: ['public'] });
    expect(grantFor({ url: '', token: GBRAIN_TOKEN, grants: GRANTS }, 'hollis-mbeki')).toEqual({ grant: 'hollis-mbeki', token: GBRAIN_TOKEN, sources: GRANTS.members['hollis-mbeki'] });
    expect(grantFor({ url: '', token: GBRAIN_TOKEN, grants: GRANTS }, 'nobody')).toMatchObject({ grant: 'nobody', sources: null });
    expect(scopeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_page', arguments: { slug: 'x' } } }, ['public'])).toEqual({ request: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_page', arguments: { slug: 'x' } } } });

    seen.length = 0;
    const before = await replyOf(await tap(ws.credentials.bot.token, call(61, 'search', { query: 'before any turn', limit: 5 })));
    expect(seen.at(-1)!.auth).toBe(`Bearer ${GBRAIN_TOKEN}`);
    expect(forwarded()).toEqual({ query: 'before any turn', limit: 5, source_ids: ['public'] });
    expect(last()).toMatchObject({ tool: 'gbrain.search', grant: 'public-only', args: { source_ids: ['public'] }, effect: { count: 1, pages: ['heldout/notes/public-handbook'], sources: ['public'] } });
    expect((before[0]!.result as { content: unknown[] }).content).toHaveLength(2);

    await admin('dana-okafor');
    await tap(ws.credentials.bot.token, call(62, 'query', { query: 'north' }));
    expect(forwarded()).toEqual({ query: 'north', source_ids: GRANTS.members['dana-okafor'] });
    expect(last()).toMatchObject({ tool: 'gbrain.query', grant: 'dana-okafor', outcome: 'ok', effect: { pages: ['heldout/chats/north-random', 'heldout/notes/public-handbook'], sources: ['channel-north-random', 'public'] } });
    expect((last().args as { source_ids_requested?: unknown }).source_ids_requested).toBeUndefined();

    await tap(ws.credentials.bot.token, call(63, 'search', { query: 'narrowed', source_ids: ['public', 'team-central'] }));
    expect(forwarded()).toEqual({ query: 'narrowed', source_ids: ['public'] });
    expect(last()).toMatchObject({ grant: 'dana-okafor', outcome: 'ok', args: { source_ids: ['public'], source_ids_requested: ['public', 'team-central'] }, effect: { sources: ['public'] } });

    const sent = seen.length;
    const denied = await tap(ws.credentials.bot.token, call(64, 'search', { query: 'foreign only', source_ids: ['team-central'] }));
    expect(denied.status).toBe(200);
    expect(seen.length).toBe(sent);
    const [reply] = await replyOf(denied);
    expect(reply).toMatchObject({ jsonrpc: '2.0', id: 64, result: { isError: true } });
    expect(JSON.parse(((reply!.result as { content: Array<{ text: string }> }).content[0]!).text)).toMatchObject({ code: 'permission_denied', error: 'permission_denied' });
    expect(last()).toMatchObject({ tool: 'gbrain.search', grant: 'dana-okafor', outcome: 'error', error: 'permission_denied', args: { source_ids: [], source_ids_requested: ['team-central'] }, effect: { count: 0, pages: [] } });

    await admin('hollis-mbeki');
    await tap(ws.credentials.bot.token, call(65, 'search', { query: 'same question' }));
    expect(forwarded()).toEqual({ query: 'same question', source_ids: GRANTS.members['hollis-mbeki'] });
    expect(last()).toMatchObject({ grant: 'hollis-mbeki', effect: { sources: ['public', 'team-central'] } });
    await tap(ws.credentials.bot.token, call(66, 'get_page', { slug: 'heldout/chats/coastal-team-banter' }));
    expect(forwarded()).toEqual({ slug: 'heldout/chats/coastal-team-banter' });
    expect(last()).toMatchObject({ tool: 'gbrain.get_page', grant: 'hollis-mbeki', outcome: 'ok' });

    await admin('kwame-adjei');
    const res = await tap(ws.credentials.bot.token, call(67, 'search', { query: 'no grant for kwame' }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: { message: string } }).error.message).toContain('no gbrain source grant for member kwame-adjei');
  } finally {
    await admin(null);
    ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN });
  }
});

test('an upstream 500 is relayed and recorded as upstream_500; an unreachable upstream is a 502 and upstream_unreachable', async () => {
  mode = 'http500';
  try {
    const res = await tap(ws.credentials.bot.token, call(31, 'search', { query: 'x' }));
    expect(res.status).toBe(500);
    expect(last()).toMatchObject({ tool: 'gbrain.search', outcome: 'error', error: 'upstream_500', effect: { pages: [], count: 0 } });
  } finally { mode = 'ok'; }
  ws.setGbrain({ url: 'http://127.0.0.1:1', token: GBRAIN_TOKEN });
  try {
    const res = await tap(ws.credentials.bot.token, call(32, 'search', { query: 'x' }));
    expect(res.status).toBe(502);
    expect(last()).toMatchObject({ tool: 'gbrain.search', outcome: 'error', error: 'upstream_unreachable' });
  } finally { ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: GBRAIN_TOKEN }); }
});

test('a gbrain event carries the shared log fields and lands between the world events around it, so a turn window brackets it', async () => {
  const startedSeq = ws.log.events.length;
  await tap(ws.credentials.bot.token, call(41, 'search', { query: 'inside the window' }));
  const endedSeq = ws.log.events.length;
  const e = last();
  expect(e.seq).toBeGreaterThan(startedSeq);
  expect(e.seq).toBeLessThanOrEqual(endedSeq);
  expect(e.trial_id).toBe('gbrain-tap-test');
  expect(e.sim_ts).toBe(ws.clock.nowIso());
  expect(e.wall_ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('helpers: SSE and JSON parsing, slug collection, and describeCall for a JSON-RPC error', () => {
  expect(parseRpcBody('event: message\ndata: {"id":1,"result":{}}\n\nevent: message\ndata: {"id":2,"result":{}}\n\n', 'text/event-stream').map((m) => m.id)).toEqual([1, 2]);
  expect(parseRpcBody('[{"id":1},{"id":2}]', 'application/json').length).toBe(2);
  expect(parseRpcBody('not json', 'application/json')).toEqual([]);
  expect(collectSlugs({ a: [{ slug: 'x' }, { slug: 'x' }], b: { c: { slug: 'y' }, slug: 3 } })).toEqual(['x', 'y']);
  const d = describeCall({ id: 1, method: 'tools/call', params: { name: 'recall', arguments: { query: 'q' } } }, { id: 1, error: { code: -32602, message: 'bad' } }, 12, 200)!;
  expect(d).toMatchObject({ tool: 'gbrain.recall', kind: 'read', outcome: 'error', error: 'rpc_-32602', effect: { pages: [], count: 0, latency_ms: 12 } });
  expect(describeCall({ id: 1, method: 'ping' }, { id: 1, result: {} }, 1, 200)).toBeNull();
  // internal-task: recall's results are the rows (count and slugs), and gbrain's degraded stamp is kept on the effect.
  const recall = describeCall({ id: 1, method: 'tools/call', params: { name: 'recall', arguments: { query: 'q' } } }, { id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ facts: [], total: 0, results: [{ slug: 'dev/chats/a', score: 1 }, { slug: 'dev/chats/b', score: 0.5 }], search_degraded: 'keyword_only_no_embedding_provider' }) }] } }, 7, 200)!;
  expect(recall).toMatchObject({ tool: 'gbrain.recall', outcome: 'ok', effect: { pages: ['dev/chats/a', 'dev/chats/b'], count: 2, latency_ms: 7, degraded: 'keyword_only_no_embedding_provider' } });
  const clean = describeCall({ id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'q' } } }, { id: 1, result: { content: [{ type: 'text', text: JSON.stringify([{ slug: 'dev/chats/a' }]) }] } }, 7, 200)!;
  expect(clean.effect).toEqual({ pages: ['dev/chats/a'], count: 1, latency_ms: 7 });
  const facts = describeCall({ id: 1, method: 'tools/call', params: { name: 'recall', arguments: { question: 'q' } } }, { id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ facts: [], results: [], facts_degraded: { reason: 'no_query_terms' } }) }] } }, 7, 200)!;
  expect(facts.effect).toMatchObject({ count: 0, degraded: 'no_query_terms' });
  expect(describeCall({ id: 1, method: 'tools/call', params: { name: 'forget', arguments: {} } }, { id: 1, result: { content: [] } }, 1, 200)!.kind).toBe('write');
});
