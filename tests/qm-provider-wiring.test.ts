// internal-task (internal-task plan v3, C4 wiring): the gbrain upstream a real pi-memory-provider trial builds (runner/trial/trial.ts
// gbrainUpstream with harnesses/qm/memory-provider.ts's block) passes the world's setGbrain, QM core's client gets a token from
// the world's OAuth issuer (#159) and the tap takes that token as the provider (#152). A provider call goes out whole-brain,
// under the trial's unscoped token with no source_ids, whatever the cell's scope; model calls keep both scope layers. Keyless:
// a stub gbrain, no model call.

import { afterAll, expect, test } from 'bun:test';
import { memoryProviderWiring } from '../harnesses/qm/memory-provider.ts';
import { gbrainUpstream } from '../runner/trial/trial.ts';
import { EventLog } from '../world/services/events.ts';
import { handleGbrainRequest, type GbrainUpstream } from '../world/services/gbrain-tap.ts';
import type { Member } from '../world/types.ts';
import { startWorld } from './world-helpers.ts';

const UNSCOPED = 'gbrain_' + 'cd'.repeat(32);
const forwarded: Array<{ auth: string | null; body: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } } }> = [];
const stub = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    const body = (await req.json()) as { id?: number; method: string; params?: Record<string, unknown> };
    forwarded.push({ auth: req.headers.get('authorization'), body });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'Saved fact: the dock code is heron-4471' }] } });
  },
});
afterAll(() => stub.stop(true));

const recall = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall', arguments: { question: 'dock code', acting_user: 'dana', max_chars: 6000 } } };

test('a pi-memory-provider trial upstream passes setGbrain, the issuer mints a token, and the tap takes it as the provider, whole-brain', async () => {
  const ws = startWorld('qm-provider-wiring');
  const bot = ws.credentials.bot.member;
  const member = ws.credentials.actors[0]!.member;
  const wiring = memoryProviderWiring({ mcpUrl: `${ws.url}/gbrain`, actor: bot });
  // Scope "member", as the C4 draft's memory-provider cell: the member tokens are present, and the provider call must not use them.
  const sidecar = { url: `http://127.0.0.1:${stub.port}`, token: UNSCOPED, tokens: { members: { [member]: 'gbrain_member_token' }, public_only: 'gbrain_public_token' }, grants: null, ingest: null };
  try {
    ws.setGbrain(gbrainUpstream(sidecar as never, wiring.provider));
    const id = wiring.coreEnv.QM_GBRAIN_READ_CLIENT_ID!;
    const secret = wiring.coreEnv.QM_GBRAIN_READ_CLIENT_SECRET!;
    const minted = await fetch(`${ws.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') }, body: 'grant_type=client_credentials' });
    expect(minted.status).toBe(200);
    const token = ((await minted.json()) as { access_token: string }).access_token;
    expect(wiring.provider.tokens).toEqual({ [token]: bot });
    forwarded.length = 0;
    const res = await fetch(`${ws.url}/gbrain`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(recall) });
    expect(res.status).toBe(200);
    expect(forwarded.map((f) => f.auth)).toEqual([`Bearer ${UNSCOPED}`]);
    expect(forwarded[0]!.body.params!.arguments).toEqual(recall.params.arguments);
    const e = ws.log.events.find((x) => x.via === 'gbrain' && x.tool === 'gbrain.recall');
    expect(e).toMatchObject({ actor: bot, outcome: 'ok', caller: 'provider', provider_op: 'recall', grant: 'bot' });
    // A bearer the issuer never minted is still refused.
    const unissued = await fetch(`${ws.url}/gbrain`, { method: 'POST', headers: { authorization: 'Bearer wgat-not-issued', 'content-type': 'application/json' }, body: JSON.stringify(recall) });
    expect(unissued.status).toBe(401);
  } finally { ws.stop(); }
});

/** One request through the tap under scope member-sources for requester dana; returns what went upstream and the event. */
async function through(upstream: GbrainUpstream, bearer: string) {
  type Sent = { auth: string | null; body: { params: { arguments: Record<string, unknown> } } };
  const seen: Sent[] = [];
  const log = new EventLog('t', null, () => '2026-10-31T09:00:00Z');
  const res = await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' }, body: JSON.stringify(recall) }), {
    upstream, log, requester: () => 'dana',
    resolveActor: (req) => (req.headers.get('authorization') === 'Bearer xoxb-bot' ? ({ id: 'assistant' } as Member) : null),
    fetchImpl: (async (_u: string, init: RequestInit) => {
      seen.push({ auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
      return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } });
    }) as unknown as typeof fetch,
  });
  return { status: res.status, sent: seen[0], event: log.events.find((e) => e.via === 'gbrain') };
}

test('scope layers: a memory-provider call goes out under the whole-brain token with no source_ids; a route-tool model call keeps both layers', async () => {
  const scoped = { url: 'http://gbrain.invalid', token: UNSCOPED, tokens: { members: { dana: 'gbrain_dana' }, public_only: 'gbrain_public' }, grants: { members: { dana: ['public', 'private-dana'] }, public: ['public'] } };
  const memoryProvider: GbrainUpstream = { ...scoped, provider: { clients: { 'qm-memory-read': { secret: 's'.repeat(24), member: 'assistant' } }, tokens: { 'wgat-issued': 'assistant' }, actor: 'assistant', max_chars_arg: 'max_chars' } };
  // The issuer's shape (the C4 cell) and #152's fixed token list alike.
  const fixedList: GbrainUpstream = { ...scoped, provider: { tokens: ['wgat-issued'], actor: 'assistant', max_chars_arg: 'max_chars' } };
  for (const upstream of [memoryProvider, fixedList]) {
    const provider = await through(upstream, 'wgat-issued');
    expect(provider.status).toBe(200);
    expect(provider.sent!.auth).toBe(`Bearer ${UNSCOPED}`);
    expect(provider.sent!.body.params.arguments).not.toHaveProperty('source_ids');
    expect(provider.event).toMatchObject({ actor: 'assistant', caller: 'provider', provider_op: 'recall', grant: 'bot' });
  }
  // The same upstream's model calls (none in the memory-provider cell, which registers no gbrain tools) and a route-tool cell's keep both layers.
  for (const upstream of [memoryProvider, scoped]) {
    const model = await through(upstream, 'xoxb-bot');
    expect(model.status).toBe(200);
    expect(model.sent!.auth).toBe('Bearer gbrain_dana');
    expect(model.sent!.body.params.arguments.source_ids).toEqual(['public', 'private-dana']);
    expect(model.event).toMatchObject({ grant: 'dana' });
  }
});
