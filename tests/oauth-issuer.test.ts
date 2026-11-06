// internal-task-a (internal-task-b M1): the world's OAuth client-credentials issuer for QM's memory provider (world/services/oauth-issuer.ts).
// Off by default: without a provider block on the gbrain upstream every OAuth path answers the world's 404 and the tap its
// 401, byte for byte what main answered before the issuer existed (captured on main 5a9c066f). With the block, QM's own
// client (MCP SDK 1.32.1, the version and integrity QM's package-lock pins at b6786d67, ClientCredentialsProvider with
// expectedIssuer new URL('/', <MCP URL>) as src/mcp/mcp-client.ts builds it) authenticates and calls a tool through the tap.

import { afterAll, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { clientCredentials, type ProviderOAuth } from '../world/services/oauth-issuer.ts';
import { startWorld } from './world-helpers.ts';

const UPSTREAM_TOKEN = 'gbrain_' + 'ab'.repeat(32);
const calls: Array<{ auth: string | null; method: string; params: unknown }> = [];
const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    if (req.headers.get('authorization') !== `Bearer ${UPSTREAM_TOKEN}`) return Response.json({ error: 'invalid_token' }, { status: 401 });
    const msg = (await req.json()) as { id?: number; method: string; params?: Record<string, unknown> };
    calls.push({ auth: req.headers.get('authorization'), method: msg.method, params: msg.params });
    if (msg.id === undefined) return new Response(null, { status: 202 });
    const result = msg.method === 'initialize'
      ? { protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-gbrain', version: '0' } }
      : msg.method === 'tools/list' ? { tools: [{ name: 'recall', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
      : { content: [{ type: 'text', text: 'Saved fact: the dock code is heron-4471' }] };
    return Response.json({ jsonrpc: '2.0', id: msg.id, result });
  },
});
afterAll(() => upstream.stop(true));

type Snapshot = { status: number; headers: [string, string][]; body: string };
const NOT_FOUND: Snapshot = { status: 404, headers: [['content-length', '32'], ['content-type', 'application/json;charset=utf-8']], body: '{"ok":false,"error":"not_found"}' };
const TAP_401: Snapshot = { status: 401, headers: [['content-length', '95'], ['content-type', 'application/json'], ['www-authenticate', 'Bearer realm="world-gbrain"']], body: '{"jsonrpc":"2.0","error":{"code":-32001,"message":"unknown or missing bearer token"},"id":null}' };
const REQUESTS: Array<[string, string, Record<string, string>, string | undefined, Snapshot]> = [
  ['GET', '/.well-known/oauth-protected-resource', {}, undefined, NOT_FOUND],
  ['GET', '/.well-known/oauth-protected-resource/gbrain', {}, undefined, NOT_FOUND],
  ['GET', '/.well-known/oauth-authorization-server', {}, undefined, NOT_FOUND],
  ['POST', '/oauth/token', { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from('c:s').toString('base64') }, 'grant_type=client_credentials', NOT_FOUND],
  ['GET', '/oauth/authorize', {}, undefined, NOT_FOUND],
  ['POST', '/gbrain', { 'content-type': 'application/json', authorization: 'Bearer unknown' }, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', TAP_401],
  ['POST', '/gbrain', { 'content-type': 'application/json' }, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', TAP_401],
];

function provider(): ProviderOAuth {
  return { clients: { 'qm-memory-read': { secret: 'pf-secret-' + 'x'.repeat(20), member: 'assistant' } }, tokens: {} };
}

async function connect(url: string, clientSecret: string, expectedIssuer = new URL('/', url).href) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: new ClientCredentialsProvider({ clientId: 'qm-memory-read', clientSecret, expectedIssuer }),
    fetch: (u, init) => fetch(u, { ...init, redirect: 'error' }),
  });
  const client = new Client({ name: 'qm', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('default: no provider block, every OAuth path and the tap answer byte for byte as main did', async () => {
  for (const withGbrain of [true, false]) {
    const ws = startWorld(`oauth-default-${withGbrain}`);
    if (withGbrain) ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN });
    try {
      for (const [method, path, headers, body, want] of REQUESTS) {
        const expected = !withGbrain && path === '/gbrain' ? NOT_FOUND : want;
        const r = await fetch(ws.url + path, { method, headers, body });
        expect({ path, status: r.status, headers: [...r.headers].filter(([k]) => k !== 'date'), body: await r.text() }).toEqual({ path, ...expected });
      }
      expect(ws.log.events).toEqual([]);
    } finally { ws.stop(); }
  }
});

test('provider: QM\'s SDK client gets a token from the issuer at the MCP URL origin and calls through the tap as the bot', async () => {
  const ws = startWorld('oauth-ok');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  try {
    const mcpUrl = `${ws.url}/gbrain`;
    const prm = await (await fetch(`${ws.url}/.well-known/oauth-protected-resource/gbrain`)).json() as { resource: string; authorization_servers: string[] };
    const as = await (await fetch(`${ws.url}/.well-known/oauth-authorization-server`)).json() as { issuer: string; token_endpoint: string };
    expect(prm).toMatchObject({ resource: mcpUrl, authorization_servers: [new URL(mcpUrl).origin] });
    expect(as).toMatchObject({ issuer: new URL(mcpUrl).origin, token_endpoint: `${new URL(mcpUrl).origin}/oauth/token` });
    calls.length = 0;
    const client = await connect(mcpUrl, p.clients['qm-memory-read']!.secret);
    const result = await client.callTool({ name: 'recall', arguments: { query: 'dock code', max_chars: 6000 } });
    await client.close();
    expect(JSON.stringify(result)).toContain('heron-4471');
    expect(Object.values(p.tokens)).toEqual(['assistant']);
    expect(calls.every((c) => c.auth === `Bearer ${UPSTREAM_TOKEN}`)).toBe(true);
    const oauth = ws.log.events.filter((e) => e.via === 'oauth');
    expect(oauth.map((e) => [e.tool, e.outcome, e.actor, (e.args as Record<string, unknown>).auth_method])).toEqual([['oauth.token', 'ok', 'assistant', 'client_secret_basic']]);
    expect(JSON.stringify(ws.log.events)).not.toContain(p.clients['qm-memory-read']!.secret);
    expect(JSON.stringify(ws.log.events)).not.toContain(Object.keys(p.tokens)[0]!);
    const recall = ws.log.events.find((e) => e.via === 'gbrain' && e.tool === 'gbrain.recall');
    expect(recall).toMatchObject({ actor: 'assistant', outcome: 'ok', args: { query: 'dock code', max_chars: 6000 } });
  } finally { ws.stop(); }
});

test('provider: a wrong secret is refused at the token endpoint and nothing reaches gbrain', async () => {
  const ws = startWorld('oauth-wrong');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  try {
    calls.length = 0;
    await expect(connect(`${ws.url}/gbrain`, 'wrong-secret')).rejects.toThrow();
    expect(p.tokens).toEqual({});
    expect(calls).toEqual([]);
    const refused = ws.log.events.filter((e) => e.via === 'oauth').map((e) => [e.outcome, e.error]);
    expect(refused.length).toBeGreaterThan(0);
    expect(new Set(refused.map((r) => r.join(' ')))).toEqual(new Set(['denied invalid_client']));
    expect(ws.log.events.some((e) => e.via === 'gbrain')).toBe(false);
  } finally { ws.stop(); }
});

test('provider: a client bound to another issuer never presents its pair here', async () => {
  const ws = startWorld('oauth-issuer');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  try {
    await expect(connect(`${ws.url}/gbrain`, p.clients['qm-memory-read']!.secret, 'http://issuer.elsewhere.internal/')).rejects.toThrow();
    expect(ws.log.events.filter((e) => e.via === 'oauth')).toEqual([]);
    expect(p.tokens).toEqual({});
  } finally { ws.stop(); }
});

test('token endpoint: client_secret_post works, other grants and methods are refused', async () => {
  const ws = startWorld('oauth-post');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  const secret = p.clients['qm-memory-read']!.secret;
  const form = (body: Record<string, string>) => fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  try {
    const ok = await form({ grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: secret });
    expect(ok.status).toBe(200);
    const token = ((await ok.json()) as { access_token: string; token_type: string }).access_token;
    expect(p.tokens[token]).toBe('assistant');
    expect((await form({ grant_type: 'authorization_code', client_id: 'qm-memory-read', client_secret: secret })).status).toBe(400);
    expect((await form({ grant_type: 'client_credentials', client_id: 'nobody', client_secret: secret })).status).toBe(401);
    expect((await fetch(`${ws.url}/oauth/token`)).status).toBe(405);
    expect((await fetch(`${ws.url}/oauth/authorize?response_type=code`)).status).toBe(400);
    const tap = await fetch(`${ws.url}/gbrain`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(tap.status).toBe(200);
  } finally { ws.stop(); }
});

test('token endpoint: inherited client ids and a multibyte wrong secret are 401 invalid_client, each logged', async () => {
  const ws = startWorld('oauth-odd-clients');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  const secret = p.clients['qm-memory-read']!.secret;
  const form = (body: Record<string, string>) => fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  try {
    const tries = [
      ...['constructor', 'toString', '__proto__'].map((id) => ({ grant_type: 'client_credentials', client_id: id, client_secret: 'x' })),
      { grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: secret.slice(0, -1) + '\u00e9' },
    ];
    for (const body of tries) {
      const res = await form(body);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
    }
    const denied = ws.log.events.filter((e) => e.via === 'oauth' && e.outcome === 'denied').map((e) => (e.args as Record<string, unknown>).client_id);
    expect(denied).toEqual(['constructor', 'toString', '__proto__', 'qm-memory-read']);
    expect(Object.keys(p.tokens)).toEqual([]);
  } finally { ws.stop(); }
});

test('token endpoint: an oversized request is refused, and logged fields are clipped', async () => {
  const ws = startWorld('oauth-sizes');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  const form = (body: Record<string, string>) => fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  try {
    const big = await form({ grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: 'x', resource: 'r'.repeat(2 * 1024 * 1024) });
    expect(big.status).toBe(400);
    expect(((await big.json()) as { error: string }).error).toBe('invalid_request');
    expect((await form({ grant_type: 'client_credentials', client_id: 'c'.repeat(4000), client_secret: 'x' })).status).toBe(401);
    expect((await form({ grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: '\u00e9'.repeat(3000) })).status).toBe(400);
    const streamed = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new Blob(['grant_type=client_credentials&resource=', 'r'.repeat(20000)]).stream() });
    expect(streamed.status).toBe(400);
    const oauth = ws.log.events.filter((e) => e.via === 'oauth');
    expect(oauth.map((e) => [e.outcome, e.error])).toEqual([['denied', 'invalid_request'], ['denied', 'invalid_client'], ['denied', 'invalid_request'], ['denied', 'invalid_request']]);
    expect(JSON.stringify(oauth).length).toBeLessThan(2000);
  } finally { ws.stop(); }
});

test('token endpoint: the size cap counts bytes and stops reading a body that never ends', async () => {
  const ws = startWorld('oauth-bytes');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  try {
    const raw = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=qm-memory-read&client_secret=${'\u00e9'.repeat(5000)}` });
    expect(raw.status).toBe(400);
    const chunk = new TextEncoder().encode('r'.repeat(4096));
    const endless = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(chunk); } });
    const streamed = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: endless, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(400);
    expect(ws.log.events.filter((e) => e.via === 'oauth').map((e) => e.error)).toEqual(['invalid_request', 'invalid_request']);
  } finally { ws.stop(); }
}, 20_000);

test('token endpoint: each client keeps its 32 newest tokens', async () => {
  const ws = startWorld('oauth-token-cap');
  const p = provider();
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p });
  const secret = p.clients['qm-memory-read']!.secret;
  try {
    const issued: string[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: secret }) });
      expect(res.status).toBe(200);
      issued.push(((await res.json()) as { access_token: string }).access_token);
    }
    expect(Object.keys(p.tokens)).toEqual(issued.slice(-32));
    expect(p.issued!['qm-memory-read']).toEqual(issued.slice(-32));
    const effects = ws.log.events.filter((e) => e.via === 'oauth').map((e) => e.effect as { live: number; evicted: number });
    expect(effects.at(31)).toEqual({ live: 32, evicted: 0 });
    expect(effects.at(-1)).toEqual({ live: 32, evicted: 1 });
  } finally { ws.stop(); }
});

test('provider: a client mapped to an unknown member is refused when the upstream is set, and no issuer route exists', async () => {
  const ws = startWorld('oauth-bad-member');
  const p = provider();
  p.clients['qm-memory-read']!.member = 'nobody-here';
  try {
    expect(() => ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: UPSTREAM_TOKEN, provider: p })).toThrow('no member nobody-here');
    const res = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'qm-memory-read', client_secret: p.clients['qm-memory-read']!.secret }) });
    expect(res.status).toBe(404);
    expect(p.tokens).toEqual({});
  } finally { ws.stop(); }
});

test('clientCredentials parses Basic (form-urlencoded parts) and post bodies', () => {
  const basic = (v: string) => new Request('http://x/oauth/token', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(v).toString('base64') } });
  expect(clientCredentials(basic('a%3Ab:c%2Bd'), new URLSearchParams())).toEqual({ id: 'a:b', secret: 'c+d', method: 'client_secret_basic' });
  expect(clientCredentials(basic('no-colon'), new URLSearchParams())).toBeNull();
  expect(clientCredentials(new Request('http://x/'), new URLSearchParams('client_id=i&client_secret=s'))).toEqual({ id: 'i', secret: 's', method: 'client_secret_post' });
  expect(clientCredentials(new Request('http://x/'), new URLSearchParams('client_id=i'))).toBeNull();
});
