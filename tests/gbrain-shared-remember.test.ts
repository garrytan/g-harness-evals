// internal-task-a (internal-task-b's diagnosis): where a remember the model makes in a shared channel lands, under member tokens. The cell
// switch gbrain.channel_remember keeps gbrain's documented shape by default ("member": the member's token, a private fact)
// and, set to "conversation", sends a shared-channel remember under that channel source's ingest token, so a teammate in the
// channel can recall it, with or without live ingestion; a DM remember always keeps the member's token. The upstream here
// models gbrain from 0.60.546.0 (test/access-member-facts.test.ts at 2c469d1b): a remember made with a member-bound token is
// a private fact of that member whatever source it names, and one made with a source's ingest token (bound to no member) is
// a fact of that source. recall answers a member the facts of the sources it names plus that member's own private facts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyGrants, conversationSources, memberPageList, memberSources, type BrainIngest, type CompanyTokens, type IngestTokens } from '../gbrain/build-brain.ts';
import { loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { gbrainSummary, gbrainUpstream } from '../runner/trial/trial.ts';
import { parseRpcBody, type GbrainUpstream } from '../world/services/gbrain-tap.ts';
import type { WorldServer } from '../world/services/server.ts';
import { startWorld, world } from './world-helpers.ts';

const SPLIT = 'dev' as const;
const DANA = 'dana-okafor', JUNE = 'june-osei';
const NORTH_RANDOM = world.channels.find((c) => c.name === 'north-random')!;
const DM = 'D0DANADM';
const CHANNELS = conversationSources(world, SPLIT);
const UNMAPPED = world.channels.find((c) => !c.name.startsWith('dm:') && CHANNELS[c.id] === undefined)!;
const GRANTS = Object.fromEntries(companyGrants(world, SPLIT, memberSources(world, SPLIT, memberPageList(world, SPLIT))).filter((g) => g.member === DANA || g.member === JUNE).map((g) => [g.member, g.sources]));
const SHARED = CHANNELS[NORTH_RANDOM.id]!;
const MEMBER_TOKENS = { members: { [DANA]: 'gbrain_' + 'cd'.repeat(32), [JUNE]: 'gbrain_' + 'ef'.repeat(32) }, public_only: 'gbrain_' + '01'.repeat(32) };
const INGEST_TOKENS = Object.fromEntries([SHARED, `private-${DANA}`, `private-${JUNE}`].map((s, i) => [s, 'gbrain_' + String(i + 2).repeat(64)]));
const UNSCOPED = 'gbrain_' + 'ab'.repeat(32);

const memberOf = new Map(Object.entries(MEMBER_TOKENS.members).map(([m, t]) => [t, m]));
const sourceOf = new Map(Object.entries(INGEST_TOKENS).map(([s, t]) => [t, s]));
type Rpc = { id: number; params: { name: string; arguments: Record<string, unknown> } };
const facts: Array<{ id: number; fact: string; source_id: string; owner?: string }> = [];
const seen: string[] = [];

const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const member = memberOf.get(bearer), source = sourceOf.get(bearer);
    if (!member && !source && bearer !== UNSCOPED && bearer !== MEMBER_TOKENS.public_only) return Response.json({ error: 'invalid_token' }, { status: 401 });
    seen.push(bearer);
    const body = await req.json() as Rpc | Rpc[];
    const answer = (m: Rpc) => {
      const a = m.params.arguments;
      let result: unknown;
      if (m.params.name === 'remember') {
        const id = facts.length + 1;
        facts.push(member ? { id, fact: String(a.fact), source_id: `private-${member}`, owner: member } : { id, fact: String(a.fact), source_id: source ?? 'default' });
        result = { content: [{ type: 'text', text: JSON.stringify({ id, status: 'inserted' }) }] };
      } else {
        const named = Array.isArray(a.source_ids) ? a.source_ids as string[] : [];
        const visible = facts.filter((f) => (f.owner ? f.owner === member : named.includes(f.source_id)) && f.fact.includes(String(a.query ?? '')));
        result = { content: [{ type: 'text', text: JSON.stringify({ facts: visible, total: visible.length, results: [] }) }] };
      }
      return { jsonrpc: '2.0', id: m.id, result };
    };
    return Response.json(Array.isArray(body) ? body.map(answer) : answer(body));
  },
});

const base: GbrainUpstream = { url: `http://127.0.0.1:${upstream.port}`, token: UNSCOPED, tokens: MEMBER_TOKENS, grants: { members: GRANTS, public: ['public'] } };
let ws: WorldServer;
beforeAll(() => { ws = startWorld('gbrain-shared-remember', SPLIT); });
afterAll(() => { ws.stop(); upstream.stop(true); });

const requester = (member: string | null, channel: string | null) => fetch(`${ws.url}/admin/gbrain/requester`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ member, channel }) });
let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<Array<{ fact: string; source_id: string }>> {
  const res = await fetch(`${ws.url}/gbrain`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.bot.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
  const reply = parseRpcBody(await res.text(), res.headers.get('content-type'))[0] as { result: { content: Array<{ text: string }> } };
  return (JSON.parse(reply.result.content[0]!.text) as { facts?: Array<{ fact: string; source_id: string }> }).facts ?? [];
}
const last = () => ws.log.events.filter((e) => e.via === 'gbrain').at(-1)!;

test('the test world: Dana and June both read north-random\'s source, and a DM is outside the channel map', () => {
  expect(NORTH_RANDOM.members).toEqual(expect.arrayContaining([DANA, JUNE]));
  expect(GRANTS[DANA]).toContain(SHARED);
  expect(GRANTS[JUNE]).toContain(SHARED);
  expect(CHANNELS[DM]).toBeUndefined();
});

describe('channel_remember "conversation" with ingestion off (the tap holds the ingest tokens, no ingester runs)', () => {
  beforeAll(() => ws.setGbrain({ ...base, channel_remember: { tokens: INGEST_TOKENS, channels: CHANNELS } }));

  test('a remember Dana\'s turn makes in a shared channel lands in the channel\'s source, and June can recall it in her turn', async () => {
    expect(ws.gbrainIngest()).toBeNull();
    await requester(DANA, NORTH_RANDOM.id);
    await call('remember', { fact: 'Berth 9 moved to Thursday', entity: 'berth-9' });
    const remembered = last();
    await requester(JUNE, NORTH_RANDOM.id);
    const recalled = await call('recall', { query: 'Berth 9' });
    expect(recalled.map((f) => [f.fact, f.source_id])).toEqual([['Berth 9 moved to Thursday', SHARED]]);
    expect(remembered).toMatchObject({ tool: 'gbrain.remember', grant: DANA, write_source: SHARED });
    expect(seen.at(-2)).toBe(INGEST_TOKENS[SHARED]);
    expect(seen.at(-1)).toBe(MEMBER_TOKENS.members[JUNE]);
    expect(last()).toMatchObject({ tool: 'gbrain.recall', grant: JUNE });
    expect(last().write_source).toBeUndefined();
  });

  test('a remember in a DM keeps the member\'s own token: it stays Dana\'s private fact and June cannot recall it', async () => {
    await requester(DANA, DM);
    await call('remember', { fact: 'Dana parks in bay 12', entity: 'dana-okafor' });
    expect(seen.at(-1)).toBe(MEMBER_TOKENS.members[DANA]);
    expect(last()).toMatchObject({ tool: 'gbrain.remember', grant: DANA, write_source: `private-${DANA}` });
    expect((await call('recall', { query: 'bay 12' })).map((f) => f.source_id)).toEqual([`private-${DANA}`]);
    await requester(JUNE, NORTH_RANDOM.id);
    expect(await call('recall', { query: 'bay 12' })).toEqual([]);
  });

  test('a batch that mixes a remember with a recall keeps Dana\'s token in a shared channel: the remember stays her private fact', async () => {
    await requester(DANA, NORTH_RANDOM.id);
    const res = await fetch(`${ws.url}/gbrain`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.bot.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify([
      { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'remember', arguments: { fact: 'Crane 4 is down', entity: 'crane-4' } } },
      { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'recall', arguments: { query: 'Crane 4' } } },
    ]) });
    expect(res.ok).toBe(true);
    expect(seen.at(-1)).toBe(MEMBER_TOKENS.members[DANA]);
    expect(ws.log.events.filter((e) => e.via === 'gbrain' && e.tool === 'gbrain.remember').at(-1)).toMatchObject({ grant: DANA, write_source: `private-${DANA}` });
    await requester(JUNE, NORTH_RANDOM.id);
    expect(await call('recall', { query: 'Crane 4' })).toEqual([]);
  });

  test('a remember in a shared channel outside the channel map keeps Dana\'s token and stays her private fact', async () => {
    await requester(DANA, UNMAPPED.id);
    await call('remember', { fact: 'Gate 2 badge reader is fixed', entity: 'gate-2' });
    expect(seen.at(-1)).toBe(MEMBER_TOKENS.members[DANA]);
    expect(last()).toMatchObject({ tool: 'gbrain.remember', grant: DANA, write_source: `private-${DANA}` });
    await requester(JUNE, NORTH_RANDOM.id);
    expect(await call('recall', { query: 'Gate 2' })).toEqual([]);
  });
});

describe('channel_remember "member", the default (live ingestion on, so the ingest tokens are on the upstream)', () => {
  beforeAll(() => ws.setGbrain({ ...base, ingest: { tokens: INGEST_TOKENS, channels: CHANNELS, dm_source_prefix: 'private-' } }));

  test('a shared-channel remember keeps Dana\'s token and stays her private fact, and the event names that write source', async () => {
    await requester(DANA, NORTH_RANDOM.id);
    await call('remember', { fact: 'Dock 3 closes at noon', entity: 'dock-3' });
    expect(seen.at(-1)).toBe(MEMBER_TOKENS.members[DANA]);
    expect(last()).toMatchObject({ tool: 'gbrain.remember', grant: DANA, write_source: `private-${DANA}` });
    await requester(JUNE, NORTH_RANDOM.id);
    expect(await call('recall', { query: 'Dock 3' })).toEqual([]);
  });
});

test('the requester route records the channel beside the member, refuses a channel with no member, and clears both after the turns', async () => {
  ws.setGbrain(base);
  expect(await (await requester(JUNE, NORTH_RANDOM.id)).json()).toEqual({ ok: true, member: JUNE, channel: NORTH_RANDOM.id });
  expect(ws.log.events.at(-1)).toMatchObject({ via: 'runner', tool: 'gbrain.requester', args: { member: JUNE, channel: NORTH_RANDOM.id } });
  expect((await requester(null, NORTH_RANDOM.id)).status).toBe(400);
  expect(await (await requester(null, null)).json()).toEqual({ ok: true, member: null });
  await call('remember', { fact: 'outside every turn' });
  expect(seen.at(-1)).toBe(MEMBER_TOKENS.public_only);
  expect(last().write_source).toBeUndefined();
});

test('the runner hands the tap the ingest tokens under "conversation" without starting ingestion, and records the setting', () => {
  const ingest = { tokens: { schema_version: 1, brain: 'member', split: SPLIT, sources: INGEST_TOKENS } as IngestTokens, map: { channels: CHANNELS, dm_source_prefix: 'private-', token_names: [] } as BrainIngest };
  const sidecar = { url: 'http://gbrain.invalid', token: UNSCOPED, tokens: { schema_version: 1, brain: 'member', split: SPLIT, ...MEMBER_TOKENS } as CompanyTokens, grants: null, ingest: null };
  const up = gbrainUpstream({ ...sidecar, channelRemember: ingest });
  expect(up.channel_remember).toEqual({ tokens: INGEST_TOKENS, channels: CHANNELS });
  expect(up.ingest).toBeUndefined();
  expect(gbrainUpstream(sidecar).channel_remember).toBeUndefined();
  const config = { surface: 'starter' as const, install: 'mcp' as const, embeddings: 'off' as const, brain: 'member' as const, scope: 'member-sources' as const, ingest: 'off' as const };
  expect(gbrainSummary({ ...config, channel_remember: 'conversation' }, { image: 'i', ready_ms: 1 }, [], []).channel_remember).toBe('conversation');
  expect('channel_remember' in gbrainSummary(config, { image: 'i', ready_ms: 1 }, [], [])).toBe(false);
});

describe('the cell field gbrain.channel_remember', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-channel-remember-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const cell = (gbrain: Cell['gbrain'], extra: Partial<Cell> = {}): Cell => ({ id: 'fake-remember', harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain, ...extra });
  const load = (c: Cell, runId: string) => {
    const dir = join(tmp, runId);
    mkdirSync(dir, { recursive: true });
    const p: Prereg = { schema_version: 1, run_id: runId, question: 'channel_remember fixture', tasks: {}, cells: [c], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
    return loadPrereg(join(dir, 'prereg.json')).prereg.cells[0]!;
  };

  test('it loads on the member brain under scope member or member-sources', () => {
    expect(load(cell({ surface: 'starter', brain: 'member', scope: 'member-sources', channel_remember: 'conversation' }), 'cr-ok-ms').gbrain!.channel_remember).toBe('conversation');
    expect(load(cell({ surface: 'starter', brain: 'member', scope: 'member', ingest: 'live', channel_remember: 'member' }), 'cr-ok-m').gbrain!.channel_remember).toBe('member');
  });

  test('it is HE-GBRAIN-003 on any other scope, with another value, off the member brain or with access rules, and HE-GBRAIN-001 in process mode', () => {
    expect(() => load(cell({ surface: 'starter', brain: 'member', scope: 'sources', channel_remember: 'conversation' }), 'cr-sources')).toThrow(/HE-GBRAIN-003 .*channel_remember needs gbrain.scope "member" or "member-sources"/);
    expect(() => load(cell({ surface: 'starter', brain: 'member', channel_remember: 'member' }), 'cr-none')).toThrow(/HE-GBRAIN-003 .*channel_remember needs gbrain.scope/);
    expect(() => load(cell({ surface: 'starter', brain: 'member', scope: 'member', channel_remember: 'everyone' as 'member' }), 'cr-value')).toThrow(/HE-GBRAIN-003 .*channel_remember must be/);
    expect(() => load(cell({ surface: 'starter', brain: 'company', scope: 'member', channel_remember: 'conversation' }), 'cr-company')).toThrow(/HE-GBRAIN-003 .*needs gbrain.brain "member"/);
    expect(() => load(cell({ surface: 'starter', brain: 'member', scope: 'member', access: 'rules', channel_remember: 'conversation' }), 'cr-acl')).toThrow(/HE-GBRAIN-003 .*without access "rules"/);
    expect(() => load(cell({ surface: 'starter', brain: 'member', scope: 'member', channel_remember: 'conversation' }, { harness_mode: 'process' }), 'cr-process')).toThrow(/HE-GBRAIN-001 .*docker mode only/);
  });
});
