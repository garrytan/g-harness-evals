// internal-task: live ingestion (world/services/gbrain-ingest.ts). Every message posted into the world lands in the brain as one
// remember fact with provenance, in the source of its conversation, under that source's ingest token; the runner's flush waits
// for them; a refused write is reported, not swallowed. The upstream is a small server speaking gbrain's wire shape.

import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { conversationSources, memberPageList, memberSources, companyGrants } from '../gbrain/build-brain.ts';
import { responseFile, writeAtomic, type Harness } from '../runner/trial/harness.ts';
import { loadTask } from '../runner/trial/task.ts';
import { runTurns } from '../runner/trial/turns.ts';
import { TrialWorld } from '../runner/trial/world.ts';
import { ingestedCounts } from '../runner/trial/trial.ts';
import { flushIngestAfterFence } from '../runner/trial/turns.ts';
import { NOT_SENT, factFor, postedAt, sourceForMessage } from '../world/services/gbrain-ingest.ts';
import { slack, startWorld, tokenOf, world } from './world-helpers.ts';

const TOKENS: Record<string, string> = { 'private-dana-okafor': 'gbrain_' + 'd1'.repeat(32), 'private-june-osei': 'gbrain_' + 'e2'.repeat(32), 'private-sofia-marchetti': 'gbrain_' + 'b5'.repeat(32), 'team-north-members': 'gbrain_' + 'f3'.repeat(32), 'channel-general': 'gbrain_' + 'a4'.repeat(32) };
const writes: Array<{ token: string; args: Record<string, unknown> }> = [];
let refuse = false;
/** Scripted answers consumed one per call before the default (inserted): gbrain's real envelopes for a pending or capacity-held
 *  write (isError, code unavailable, the reason in write_error, the receipt under write_request with retry_after_ms), 'slow'
 *  (a pending answer asking for a 700 ms wait) and 'duplicate' (status duplicate with an existing fact's id, gbrain's content
 *  dedup; a replay of a committed request_id returns the first write's own outcome, which the fixture's default already is). */
const answers: Array<'write_pending' | 'queue_capacity' | 'slow' | 'duplicate' | 'flaky' | 'writer_busy'> = [];
/** When set, the upstream waits on it before answering, so a later message queues behind this write. */
let hold: Promise<void> | null = null;
let nextId = 1;
/** The id a held write reserved, returned by the duplicate answer that follows it. */
let reserved: string | null = null;
afterEach(() => { refuse = false; hold = null; answers.length = 0; });
const upstream = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/mcp') return Response.json({ error: 'not_found' }, { status: 404 });
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    if (!Object.values(TOKENS).includes(token)) return Response.json({ error: 'invalid_token' }, { status: 401 });
    const m = await req.json() as { id: number; params: { name: string; arguments: Record<string, unknown> } };
    if (hold) await hold;
    // A 503 is the sidecar failing the request before it took the fact (a busy PGLite); the queue resends under the same request_id.
    if (answers[0] === 'flaky') { answers.shift(); return new Response('busy', { status: 503 }); }
    writes.push({ token, args: m.params.arguments });
    // gbrain: one connection writes to one source; a source_id outside the token's grant is permission_denied.
    const granted = Object.entries(TOKENS).find(([, t]) => t === token)![0];
    const text = (v: unknown) => ({ type: 'text', text: JSON.stringify(v) });
    const scripted = answers.shift();
    const rid = m.params.arguments.request_id;
    if (scripted === 'queue_capacity') reserved = String(nextId++);
    const result = refuse ? { content: [text({ error: 'recovery_required', code: 'recovery_required' })], isError: true }
      : scripted === 'write_pending' || scripted === 'queue_capacity' ? { content: [text({ error: 'unavailable', code: 'unavailable', write_error: scripted, write_request: { request_id: rid, state: 'queued', retry_after_ms: 250 } })], isError: true }
      : scripted === 'writer_busy' ? { content: [text({ error: 'writer_busy', code: 'writer_busy', retryable: true })], isError: true }
      : scripted === 'slow' ? { content: [text({ error: 'unavailable', code: 'unavailable', write_error: 'write_pending', write_request: { request_id: rid, state: 'queued', retry_after_ms: 700 } })], isError: true }
      : scripted === 'duplicate' ? { content: [text({ id: reserved ?? String(nextId - 1), status: 'duplicate', request_id: rid, write_request: { request_id: rid, state: 'committed' } })] }
      : m.params.arguments.source_id !== granted ? { content: [text({ error: 'permission_denied', code: 'permission_denied' })], isError: true }
      : { content: [text({ id: String(nextId++), status: 'inserted', request_id: rid, write_request: { request_id: rid, state: 'committed' } })] };
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  },
});
afterAll(() => upstream.stop(true));

const dev = (id: string) => world.channels.find((c) => c.id === id)!;

test('the member brain: bot-visible pages in reader-set sources, a source for every loaded channel and every member, the channel map', () => {
  const pages = memberPageList(world, 'dev');
  expect(pages.map((p) => p.kind)).not.toContain('dm');
  expect(pages.every((p) => p.kind === 'channel' ? p.readers.length > 1 : p.source === 'public')).toBe(true);
  const sources = memberSources(world, 'dev', pages);
  const ids = sources.map((s) => s.id);
  expect(ids).toContain('public');
  expect(ids).toContain('channel-general');
  expect(ids.filter((s) => s.startsWith('private-')).length).toBe(companyGrants(world, 'dev', sources).length - 1);
  const map = conversationSources(world, 'dev');
  for (const c of world.channels.filter((c) => c.kind !== 'dm' && (c.split === 'dev' || c.split === 'both'))) expect(ids).toContain(map[c.id]!);
  expect(Object.keys(map)).not.toContain(world.channels.find((c) => c.kind === 'dm')!.id);
  // Every member's grant covers their own private source, public, and the channels they are in.
  const dana = companyGrants(world, 'dev', sources).find((g) => g.member === 'dana-okafor')!;
  expect(dana.write).toBe('private-dana-okafor');
  for (const c of world.channels.filter((c) => c.kind !== 'dm' && (c.split === 'dev' || c.split === 'both') && c.members.includes('dana-okafor'))) expect(dana.sources).toContain(map[c.id]!);
  for (const c of world.channels.filter((c) => c.kind !== 'dm' && (c.split === 'dev' || c.split === 'both') && !c.members.includes('dana-okafor'))) expect(dana.sources).not.toContain(map[c.id]!);
});

test('sourceForMessage and factFor: a channel maps through the manifest map, a DM with the bot to private-<member>, a stranger DM to nothing', () => {
  const cfg = { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' };
  expect(sourceForMessage(cfg, dev('C16V9M1OB60'), 'assistant')).toEqual({ source: 'team-north-members' });
  expect(sourceForMessage(cfg, { id: 'D1', kind: 'dm', members: ['assistant', 'dana-okafor'] }, 'assistant')).toEqual({ source: 'private-dana-okafor' });
  expect(sourceForMessage(cfg, { id: 'D2', kind: 'dm', members: ['june-osei', 'dana-okafor'] }, 'assistant')).toMatchObject({ reason: expect.stringContaining('not the bot and one member') });
  expect(sourceForMessage(cfg, { id: 'CX', kind: 'team', members: ['x'] }, 'assistant')).toMatchObject({ reason: expect.stringContaining('no source') });
  const dana = world.members.find((m) => m.id === 'dana-okafor')!;
  const f = factFor({ id: 'm-1', channel: 'D1', author: 'dana-okafor', ts: '1', date: '2026-10-14', date_basis: 'frontmatter', time_text: '09:00', text: 'Write dates as 20.03.2026.', split: 'both', slug: 'live/t' }, dana, { name: 'dm:assistant+dana-okafor', kind: 'dm' }, 'assistant', '2026-10-14T09:00:00-04:00');
  expect(f.fact).toBe('Dana Okafor (dana-okafor, ' + dana.role + ') wrote in a direct message with assistant on 2026-10-14 09:00: Write dates as 20.03.2026.');
  expect(f.provenance).toBe('dana-okafor, a direct message with assistant, 2026-10-14T09:00:00-04:00');
  const bot = { ...dana, id: 'assistant', name: 'assistant' };
  expect(factFor({ id: 'm-2', channel: 'D1', author: 'assistant', ts: '2', date: '2026-10-14', date_basis: 'frontmatter', time_text: '09:01', text: 'Noted.', split: 'both', slug: 'live/t' }, bot, { name: 'dm:assistant+dana-okafor', kind: 'dm' }, 'assistant', '2026-10-14T09:01:00-04:00').fact).toBe('assistant (the workspace bot) wrote in a direct message with dana-okafor on 2026-10-14 09:01: Noted.');
});

test('through the world: a DM turn, the bot reply and a channel post each become one fact under the right token; flush waits; a refusal is reported and recorded', async () => {
  const ws = startWorld('ingest-t1');
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const dana = tokenOf(ws, 'dana-okafor');
  const opened = await slack(ws, dana, 'conversations.open', { users: ws.credentials.bot.member });
  expect(opened.ok).toBe(true);
  const dm = String(opened.channel.id);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: dm, text: 'Write dates as 20.03.2026, just for me.' })).ok).toBe(true);
  expect((await slack(ws, ws.credentials.bot.token, 'chat.postMessage', { channel: dm, text: 'Noted, 20.03.2026 it is.' })).ok).toBe(true);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'When did Quarrendon renew?' })).ok).toBe(true);
  const flushed = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; ingest: string; written: number; skipped: number; failed: unknown[] };
  expect(flushed).toEqual({ ok: true, ingest: 'live', written: 3, skipped: 0, failed: [] });
  expect(writes.map((w) => [Object.entries(TOKENS).find(([, t]) => t === w.token)![0], w.args.source_id])).toEqual([['private-dana-okafor', 'private-dana-okafor'], ['private-dana-okafor', 'private-dana-okafor'], ['team-north-members', 'team-north-members']]);
  expect(String(writes[0]!.args.fact)).toContain('Dana Okafor (dana-okafor');
  expect(String(writes[0]!.args.fact)).toContain('Write dates as 20.03.2026, just for me.');
  // The time stamped (text, provenance and gbrain's valid_from) is the simulation time the message was posted, in the world's
  // clock offset (-05:00 in the seed), not UTC and not the clock when the write ran.
  const firstTs = String((await slack(ws, dana, 'conversations.history', { channel: dm })).messages[0].ts);
  const postedIso = postedAt(firstTs, world.time_zone.offset_minutes);
  expect(postedIso).toMatch(/^2026-10-14T09:00:00-05:00$/);
  expect(String(writes[0]!.args.provenance)).toBe(`dana-okafor, a direct message with assistant, ${postedIso}`);
  expect(String(writes[0]!.args.fact)).toContain(' on 2026-10-14 09:00: ');
  expect(writes[0]!.args.valid_from).toBe(postedIso);
  expect(String(writes[1]!.args.fact)).toContain('assistant (the workspace bot) wrote in a direct message with dana-okafor');
  expect(String(writes[2]!.args.provenance)).toMatch(/^dana-okafor, #north-team, /);
  const ingests = ws.log.events.filter((e) => e.tool === 'gbrain.ingest');
  expect(ingests.length).toBe(3);
  expect(ingests.every((e) => e.via === 'runner' && e.kind === 'admin' && e.outcome === 'ok' && e.actor === null)).toBe(true);
  expect(ingests.map((e) => (e.effect as { fact_id: string }).fact_id)).toEqual(['1', '2', '3']);
  expect((ingests[0]!.args as { channel: string; author: string; source: string }).channel).toBe(dm);
  expect((ingests[2]!.args as { source: string }).source).toBe('team-north-members');
  // A conversation the brain has no source for is skipped, not failed: a DM with a vendor (no token, so no private-<member>
  // source), and a group DM. The event says so in effect.skipped; flush reports the count and stays ok.
  const vendorDm = String((await slack(ws, ws.credentials.bot.token, 'conversations.open', { users: 'odile-brandt' })).channel.id);
  expect((await slack(ws, ws.credentials.bot.token, 'chat.postMessage', { channel: vendorDm, text: 'Can you confirm the Carrowmere maintenance window?' })).ok).toBe(true);
  const groupDm = String((await slack(ws, dana, 'conversations.open', { users: `${ws.credentials.bot.member},june-osei` })).channel.id);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: groupDm, text: 'Both of you: the Quarrendon call moved.' })).ok).toBe(true);
  // A retryable gbrain answer (write_pending in write_error under code unavailable) is sent again under the same request_id
  // and lands.
  answers.push('write_pending');
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Pending, then landed.' })).ok).toBe(true);
  const f1 = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; ingest: string; written: number; skipped: number; failed: unknown[] };
  expect(f1).toEqual({ ok: true, ingest: 'live', written: 4, skipped: 2, failed: [] });
  const skipped = ws.log.events.filter((e) => e.tool === 'gbrain.ingest' && typeof (e.effect as { skipped?: string }).skipped === 'string');
  expect(skipped.map((e) => [e.outcome, (e.effect as { skipped: string; fact_id: null }).skipped])).toEqual([
    ['ok', 'no ingest token for source private-odile-brandt'],
    ['ok', expect.stringMatching(/^DM D\w+ is between .*, not the bot and one member$/)],
  ]);
  expect(writes.length).toBe(5);
  expect(writes[3]!.args.request_id).toBe(writes[4]!.args.request_id);
  expect(String(writes[4]!.args.fact)).toContain('Pending, then landed.');
  // queue_capacity then a duplicate answer (a dedup hit on the resend): ok with that fact's id, one request_id, two calls, and
  // the id is new to this trial's events.
  answers.push('queue_capacity', 'duplicate');
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Held, then found.' })).ok).toBe(true);
  const f1b = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; written: number; failed: unknown[] };
  expect(f1b.ok).toBe(true);
  expect(f1b.written).toBe(5);
  expect(writes.length).toBe(7);
  expect(writes[5]!.args.request_id).toBe(writes[6]!.args.request_id);
  const ingestEvents = ws.log.events.filter((e) => e.tool === 'gbrain.ingest');
  const held = ingestEvents.at(-1)!;
  expect(held.outcome).toBe('ok');
  expect((held.effect as { fact_id: string }).fact_id).toBe(reserved!);
  expect(ingestEvents.slice(0, -1).some((e) => (e.effect as { fact_id: unknown }).fact_id === reserved)).toBe(false);
  // gbrain's retry_after_ms is honoured when it asks for longer than the fixed wait.
  answers.push('slow');
  const slowStart = Date.now();
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Slow to commit.' })).ok).toBe(true);
  expect((await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean }).ok).toBe(true);
  expect(Date.now() - slowStart).toBeGreaterThanOrEqual(690);
  expect(writes.length).toBe(9);
  // A message queued behind a slow write is stamped with its own posting time even when the clock advanced in between.
  let release!: () => void;
  hold = new Promise<void>((resolve) => { release = resolve; });
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Slow one.' })).ok).toBe(true);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Queued one.' })).ok).toBe(true);
  const queuedTs = String((await slack(ws, dana, 'conversations.history', { channel: 'C16V9M1OB60' })).messages[0].ts);
  expect((await (await fetch(`${ws.url}/clock/advance`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ seconds: 86_400 }) })).json() as { ok: boolean }).ok).toBe(true);
  release();
  hold = null;
  const f1c = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; written: number };
  expect(f1c).toMatchObject({ ok: true, written: 8 });
  const queued = writes.find((w) => String(w.args.fact).endsWith('Queued one.'))!;
  expect(queued.args.valid_from).toBe(postedAt(queuedTs, world.time_zone.offset_minutes));
  expect(String(queued.args.valid_from)).toMatch(/^2026-10-14T/);
  // Retry exhausted: three retryable answers, one request_id, then the failure names the reason and the count, and the next
  // message is not sent.
  answers.push('write_pending', 'write_pending', 'write_pending');
  const before = writes.length;
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Never lands.' })).ok).toBe(true);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Behind it.' })).ok).toBe(true);
  const f1d = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; written: number; failed: Array<{ error?: string }> };
  expect(f1d.ok).toBe(false);
  expect(f1d.written).toBe(8);
  expect(f1d.failed.map((x) => x.error)).toEqual(['write_pending after 3 attempts', NOT_SENT]);
  expect(writes.length - before).toBe(3);
  expect(new Set(writes.slice(before).map((w) => w.args.request_id)).size).toBe(1);
  ws.stop();
}, 30_000);

test('the queue: a flush past its deadline reports the pending writes as one failure event and latches; a throw inside a write is a failure event; stop() records nothing more', async () => {
  const ws = startWorld('ingest-t3');
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const dana = tokenOf(ws, 'dana-okafor');
  const ingest = ws.gbrainIngest()!;
  let release!: () => void;
  hold = new Promise<void>((resolve) => { release = resolve; });
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Stuck.' })).ok).toBe(true);
  const timedOut = await ingest.flush(50);
  expect(timedOut.failed.map((x) => x.error)).toEqual(['flush timed out after 50 ms with 1 write(s) pending']);
  const timeoutEvent = ws.log.events.filter((e) => e.tool === 'gbrain.ingest').at(-1)!;
  expect(timeoutEvent).toMatchObject({ outcome: 'error', error: 'flush timed out after 50 ms with 1 write(s) pending', args: { channel: '', ts: '', source: '' } });
  // The latch holds: the next message is not sent; the stuck write still lands when released (it was in flight).
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Behind the stuck one.' })).ok).toBe(true);
  release();
  hold = null;
  const after = await ingest.flush();
  expect(after.written).toBe(1);
  expect(after.failed.map((x) => x.error)).toEqual(['flush timed out after 50 ms with 1 write(s) pending', NOT_SENT]);
  expect(ingestedCounts(ws.log.events.filter((e) => e.tool === 'gbrain.ingest'))).toEqual({ ok: 1, skipped: 0, failed: 2 });
  // After stop(), nothing is recorded: a message posted later leaves no event and no result.
  const eventsBefore = ws.log.events.length;
  ingest.stop();
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Too late.' })).ok).toBe(true);
  await Bun.sleep(50);
  expect(ws.log.events.filter((e) => e.tool === 'gbrain.ingest').length).toBe(3);
  expect(ws.log.events.length).toBe(eventsBefore + 1);
  ws.stop();
  // A throw inside write() (here: a message whose author the service cannot resolve throws through a broken log) is a failure
  // event, never a message with no result.
  const ws2 = startWorld('ingest-t4');
  ws2.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const ingest2 = ws2.gbrainIngest()!;
  const realAppend = ws2.log.append.bind(ws2.log);
  let appends = 0;
  ws2.log.append = ((e: Parameters<typeof realAppend>[0]) => { if (e.tool === 'gbrain.ingest' && appends++ === 0) throw new Error('disk full'); return realAppend(e); }) as typeof ws2.log.append;
  expect((await slack(ws2, tokenOf(ws2, 'dana-okafor'), 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'First.' })).ok).toBe(true);
  expect((await slack(ws2, tokenOf(ws2, 'dana-okafor'), 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Second.' })).ok).toBe(true);
  const f = await ingest2.flush();
  expect(f.failed.map((x) => x.error)).toEqual(['ingest_exception: disk full', NOT_SENT]);
  expect(ws2.log.events.filter((e) => e.tool === 'gbrain.ingest').map((e) => [e.outcome, (e as { error?: string }).error])).toEqual([['error', 'ingest_exception: disk full'], ['error', NOT_SENT]]);
  ws2.stop();
});

test('through the world: a refusal is reported and recorded, and the queue behind it is not sent', async () => {
  const ws = startWorld('ingest-t2');
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const dana = tokenOf(ws, 'dana-okafor');
  writes.length = 0;
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'When did Quarrendon renew?' })).ok).toBe(true);
  expect((await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean }).ok).toBe(true);
  // A refusal is a failure flush reports; every message queued behind it is recorded as failed without a call upstream, so
  // a brain that stopped taking writes does not hold the trial for a timeout per message.
  refuse = true;
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Again?' })).ok).toBe(true);
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'And again.' })).ok).toBe(true);
  const f2 = await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json() as { ok: boolean; written: number; skipped: number; failed: Array<{ source: string; error?: string }> };
  refuse = false;
  expect(f2.ok).toBe(false);
  expect(f2.written).toBe(1);
  expect(f2.skipped).toBe(0);
  expect(f2.failed).toEqual([
    expect.objectContaining({ source: 'team-north-members', error: 'recovery_required' }),
    expect.objectContaining({ source: 'team-north-members', error: NOT_SENT, fact_id: null }),
  ]);
  expect(writes.length).toBe(2);
  expect(ws.log.events.filter((e) => e.tool === 'gbrain.ingest' && e.outcome === 'error').length).toBe(2);
  // No token is in any event.
  for (const t of Object.values(TOKENS)) expect(JSON.stringify(ws.log.events)).not.toContain(t);
  // Without ingest on the upstream, flush is a no-op that says so.
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32) });
  expect(await (await fetch(`${ws.url}/admin/gbrain/flush`, { method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}` }, body: '{}' })).json()).toEqual({ ok: true, ingest: 'off', written: 0, skipped: 0, failed: [] });
  ws.stop();
});

test('the turn loop: a message the brain refused ends the trial as exam_fault HE-GBRAIN-011 before the harness gets the turn, the code once', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-ingest-loop-'));
  const turnsDir = join(tmp, 'turns');
  mkdirSync(turnsDir);
  const task = loadTask(resolve(import.meta.dir, 'fixtures', 'tasks', 'multiuser', 'dev', 'fx-leak'));
  const tw = new TrialWorld({ trialId: 'ingest-loop', split: 'dev', actors: task.actors, outDir: tmp, reachableFromContainers: false });
  tw.server.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const requests: unknown[] = [];
  const harness: Harness = { kind: 'process', waitReady: async () => undefined, exited: async () => null, notify: (req) => { requests.push(req); }, stop: async () => undefined, kill: async () => undefined };
  const lines: string[] = [];
  refuse = true;
  try {
    const res = await runTurns({ task, preamble: 'You are {{bot_name}}. {{message}}', world: tw, harness, turnsDir, trialId: 'ingest-loop', graceS: 1, log: (l) => lines.push(l) });
    expect(res.ended_early).toBe('exam_fault');
    expect(res.error).toMatch(/^HE-GBRAIN-011 turn 1: 1 message\(s\) were not written into the brain \(.* -> private-sofia-marchetti: recovery_required\)$/);
    expect(res.error).not.toMatch(/HE-GBRAIN-011 .*HE-GBRAIN-011/);
    expect(res.windows).toEqual([]);
    expect(requests).toEqual([]);
    expect(lines).toContain(res.error!);
  } finally {
    refuse = false;
    tw.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the turn loop: a refusal of the bot\'s reply ends the trial after the turn (window recorded, no next turn); after the fence the queue drains, a failure is the fault only on a completed trial', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-ingest-loop2-'));
  const turnsDir = join(tmp, 'turns');
  mkdirSync(turnsDir);
  const task = loadTask(resolve(import.meta.dir, 'fixtures', 'tasks', 'multiuser', 'dev', 'fx-leak'));
  const tw = new TrialWorld({ trialId: 'ingest-loop2', split: 'dev', actors: task.actors, outDir: tmp, reachableFromContainers: false });
  tw.server.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  // The harness answers every turn at once; before it answers turn 1 the brain starts refusing, so the actor's message landed
  // and the reply does not.
  const harness: Harness = { kind: 'process', waitReady: async () => undefined, exited: async () => null, notify: (req) => { refuse = true; writeAtomic(join(turnsDir, responseFile(req.turn)), JSON.stringify({ turn: req.turn, exit: 0, reply_text: 'Noted.', started_at: 'x', ended_at: 'y' })); }, stop: async () => undefined, kill: async () => undefined };
  const lines: string[] = [];
  try {
    const res = await runTurns({ task, preamble: 'You are {{bot_name}}. {{message}}', world: tw, harness, turnsDir, trialId: 'ingest-loop2', graceS: 1, log: (l) => lines.push(l) });
    expect(res.ended_early).toBe('exam_fault');
    expect(res.error).toMatch(/^HE-GBRAIN-011 turn 1: 1 message\(s\) were not written into the brain \(.* -> private-sofia-marchetti: recovery_required\)$/);
    expect(res.windows.length).toBe(1);
    expect(res.windows[0]).toMatchObject({ turn: 1, exit: 0, reply_text: 'Noted.' });
    expect(lines.filter((l) => l.startsWith('turn 2')).length).toBe(0);
    expect(lines).toContain(res.error!);
    expect(lines.some((l) => l === 'turn 1: brain current (1 message(s) ingested so far)')).toBe(true);
    // After the fence: the queue is drained on every path. With the loop ended early, the failures stay in the record and the
    // termination does not change; a trial that completed its turns would get the fault.
    refuse = false;
    await tw.fence();
    expect(await flushIngestAfterFence(tw, res.ended_early, (l) => lines.push(l))).toBeNull();
    expect(lines.at(-1)).toMatch(/^brain current after the fence \(1 message\(s\) ingested, 1 failed on a trial that ended early \(exam_fault\)\)$/);
    expect(await flushIngestAfterFence(tw, null, (l) => lines.push(l))).toEqual({ ended_early: 'exam_fault', error: expect.stringMatching(/^HE-GBRAIN-011 after the last turn: 1 message\(s\) were not written into the brain/) });
    tw.server.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32) });
    expect(await flushIngestAfterFence(tw, null, (l) => lines.push(l))).toBeNull();
  } finally {
    refuse = false;
    tw.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the queue: a 5xx, a dropped connection and a gbrain error stamped retryable are resent under the same request_id, a 4xx is final; a duplicate is ok with its status', async () => {
  const ws = startWorld('ingest-t5');
  ws.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const dana = tokenOf(ws, 'dana-okafor');
  const ingest = ws.gbrainIngest()!;
  const before = writes.length;
  answers.push('flaky', 'flaky');
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Through a busy sidecar.' })).ok).toBe(true);
  const f = await ingest.flush();
  expect(f.written).toBe(1);
  expect(writes.length).toBe(before + 1);
  const okEvent = ws.log.events.filter((e) => e.tool === 'gbrain.ingest').at(-1)!;
  expect(okEvent).toMatchObject({ outcome: 'ok', effect: { status: 'inserted', source: 'team-north-members' } });
  answers.push('queue_capacity', 'duplicate');
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Said twice.' })).ok).toBe(true);
  expect((await ingest.flush()).written).toBe(2);
  expect(ws.log.events.filter((e) => e.tool === 'gbrain.ingest').at(-1)!).toMatchObject({ outcome: 'ok', effect: { status: 'duplicate' } });
  answers.push('writer_busy');
  expect((await slack(ws, dana, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Past a busy writer.' })).ok).toBe(true);
  expect((await ingest.flush()).written).toBe(3);
  expect(ws.log.events.filter((e) => e.tool === 'gbrain.ingest').at(-1)!).toMatchObject({ outcome: 'ok', effect: { status: 'inserted' } });
  ws.stop();
  // A 4xx is final on the first attempt.
  const ws2 = startWorld('ingest-t6');
  const gone = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('gone', { status: 404 }) });
  ws2.setGbrain({ url: `http://127.0.0.1:${gone.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  expect((await slack(ws2, tokenOf(ws2, 'dana-okafor'), 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Nobody home.' })).ok).toBe(true);
  expect((await ws2.gbrainIngest()!.flush()).failed.map((x) => x.error)).toEqual(['upstream_404']);
  ws2.stop();
  // A port nobody listens on: three attempts, then one failure naming the transport.
  const closedPort = gone.port;
  gone.stop(true);
  const ws3 = startWorld('ingest-t7');
  ws3.setGbrain({ url: `http://127.0.0.1:${closedPort}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  expect((await slack(ws3, tokenOf(ws3, 'dana-okafor'), 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Dead port.' })).ok).toBe(true);
  const dead = (await ws3.gbrainIngest()!.flush()).failed.map((x) => x.error);
  expect(dead).toHaveLength(1);
  expect(dead[0]).toMatch(/^upstream_unreachable: .* after 3 attempts$/);
  ws3.stop();
}, 20_000);

test('the drain after the fence waits for a write still in flight, then closes the queue so nothing lands after the snapshot', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-ingest-drain-'));
  const tw = new TrialWorld({ trialId: 'ingest-drain', split: 'dev', actors: ['dana-okafor'], outDir: tmp, reachableFromContainers: false });
  tw.server.setGbrain({ url: `http://127.0.0.1:${upstream.port}`, token: 'gbrain_' + '00'.repeat(32), ingest: { tokens: TOKENS, channels: conversationSources(world, 'dev'), dm_source_prefix: 'private-' } });
  const lines: string[] = [];
  try {
    let release!: () => void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    expect((await tw.slack(tw.actor('dana-okafor').token, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'Posted just before the fence.' })).ok).toBe(true);
    await tw.fence();
    const draining = flushIngestAfterFence(tw, null, (l) => lines.push(l));
    await Bun.sleep(30);
    expect(lines).toEqual([]);
    release();
    hold = null;
    expect(await draining).toBeNull();
    expect(lines).toEqual(['brain current after the fence (1 message(s) ingested)']);
    expect(ingestedCounts(tw.events.filter((e) => e.tool === 'gbrain.ingest'))).toEqual({ ok: 1, skipped: 0, failed: 0 });
    // Closed: the fence refuses posts anyway, and the queue records nothing more.
    expect((await tw.slack(tw.actor('dana-okafor').token, 'chat.postMessage', { channel: 'C16V9M1OB60', text: 'After the fence.' })).ok).toBe(false);
    expect(tw.events.filter((e) => e.tool === 'gbrain.ingest').length).toBe(1);
  } finally {
    tw.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});
