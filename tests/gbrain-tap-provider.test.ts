// internal-task (QM M1, provider-aware scoring): the tap tells QM's memory-provider client from the model's own gbrain calls by
// the bearer token (world/services/gbrain-tap.ts, upstream.provider), tells the provider client's per-turn recall from the
// model's memory search on the same credential by the provider's maxCharsArg, records which saved facts reached the model
// after QM's handling of the result (qmDelivery, QM b6786d67), keeps the member the provider call named as sent, and
// scripts/v03/mechanism.ts counts the callers apart under --provider-aware. Seeded positive and negative cases; no network,
// no model call.

import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../runner/grade/task.ts';
import { markdown, mechanism, trialMechanism, trialProviderMechanism, type MechRow } from '../scripts/v03/mechanism.ts';
import { EventLog, type WorldEvent } from '../world/services/events.ts';
import { handleGbrainRequest, MATCH_WORK_BUDGET, qmDelivery, QM_RECALL_MAX_CHARS, QM_SEARCH_MAX_LINES, type GbrainUpstream } from '../world/services/gbrain-tap.ts';
import type { Member } from '../world/types.ts';
import { startWorld } from './world-helpers.ts';

const BOT = 'xoxb-test-bot';
const PROVIDER = 'qm-provider-access-token';
const NEEDED = { id: 12, fact: 'Dana Okafor wrote in a direct message: my code word is marmoset-7731', source_id: 'private-dana-okafor' };
const FILLER = Array.from({ length: 80 }, (_, i) => ({ id: 100 + i, fact: 'Filler fact ' + i + ': the Covey & Lark dock schedule for berth ' + i + ' is unchanged this week.', source_id: 'public' }));
const text = (v: unknown) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) });
const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const NL = String.fromCharCode(10);

const base: GbrainUpstream = { url: 'http://gbrain.invalid', token: 'gbrain_unscoped' };
const withProvider: GbrainUpstream = { ...base, provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars' } };
/** QM's per-turn recall always sends maxChars (6000) through the provider's maxCharsArg. */
const recallArgs = (query: string) => ({ query, acting_user: 'dana-okafor', max_chars: QM_RECALL_MAX_CHARS });

/** One request through the tap with a stub upstream; returns the events, the forwarded body and the status. */
async function tap(upstream: GbrainUpstream, token: string, body: unknown, result: Record<string, unknown>, headers: Record<string, string> = {}, log = new EventLog('t', null, () => '2026-10-30T09:00:00Z'), delayMs = 0) {
  let forwarded: unknown = null;
  const res = await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), {
    upstream,
    resolveActor: (req) => (req.headers.get('authorization') === 'Bearer ' + BOT ? ({ id: 'assistant' } as Member) : null),
    log,
    fetchImpl: (async (_url: string, init: RequestInit) => {
      forwarded = JSON.parse(String(init.body));
      if (delayMs) await Bun.sleep(delayMs);
      return Response.json({ jsonrpc: '2.0', id: (forwarded as { id: number }).id, result });
    }) as unknown as typeof fetch,
  });
  return { status: res.status, events: log.events.filter((e) => e.via === 'gbrain'), forwarded, log };
}
type Delivery = { text_chars: number; delivered_chars: number; cap: number | null; lines?: number; dropped?: string; facts: boolean[] };
const deliveryOf = (e: WorldEvent) => (e.effect as { delivery: Delivery }).delivery;

const delivered = { content: [text({ facts: [NEEDED], results: [], total: 1 })] };
const truncated = { content: [text({ facts: [...FILLER, NEEDED], results: [], total: FILLER.length + 1 })] };
const errored = { isError: true, content: [text({ code: 'internal_error', facts: [NEEDED] })] };

test('a provider recall that delivers the needed fact: caller provider, provider_op recall, the actor as sent, delivered within the cap', async () => {
  const { status, events, forwarded } = await tap(withProvider, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered);
  expect(status).toBe(200);
  const [e] = events;
  expect(e).toMatchObject({ actor: 'assistant', tool: 'gbrain.recall', kind: 'read', caller: 'provider', provider_op: 'recall', provider_actor: { arg: 'dana-okafor', header: null }, args: recallArgs('code word') });
  expect(e!.effect).toMatchObject({ facts: [{ id: 12, fact: NEEDED.fact }], delivery: { cap: QM_RECALL_MAX_CHARS, facts: [true] } });
  expect(deliveryOf(e!).delivered_chars).toBeGreaterThan(0);
  expect(deliveryOf(e!)).not.toHaveProperty('dropped');
  expect((forwarded as { params: { arguments: Record<string, unknown> } }).params.arguments).toEqual(recallArgs('code word'));
});

test("a provider recall that returns the needed fact but QM's 6,000-character cap cuts it away: returned, not delivered", async () => {
  const { events } = await tap(withProvider, PROVIDER, call(2, 'recall', recallArgs('code word')), truncated);
  const effect = events[0]!.effect as { facts: Array<{ id: number }>; delivery: Delivery };
  expect(effect.facts.map((f) => f.id)).toContain(12);
  expect(effect.delivery.text_chars).toBeGreaterThan(QM_RECALL_MAX_CHARS);
  expect(effect.delivery.delivered_chars).toBe(QM_RECALL_MAX_CHARS);
  expect(effect.delivery.facts.at(-1)).toBe(false);
  expect(effect.delivery.facts[0]).toBe(true);
  // The cap is the maxChars the call carried, as QM slices to that same number.
  const small = await tap(withProvider, PROVIDER, call(3, 'recall', { query: 'x', max_chars: 40 }), delivered);
  expect(deliveryOf(small.events[0]!)).toMatchObject({ cap: 40, facts: [false] });
});

test('a provider-token call without max_chars is the model\'s memory search (provider_op query), with a 50-line upper-bound delivery, never a recall', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => (i === 54 ? '- ' + NEEDED.fact : '- line ' + i)).join(NL);
  const { events } = await tap(withProvider, PROVIDER, call(4, 'search', { query: 'code word', acting_user: 'dana-okafor' }), { content: [text([]), text('Saved facts (remember): x' + NL + lines)] });
  const e = events[0]!;
  expect(e).toMatchObject({ caller: 'provider', provider_op: 'query', provider_actor: { arg: 'dana-okafor', header: null } });
  expect((e.effect as { facts: unknown[] }).facts.length).toBe(60);
  expect(deliveryOf(e)).toMatchObject({ cap: null, lines: QM_SEARCH_MAX_LINES });
  expect(deliveryOf(e).facts.at(-6)).toBe(false);
  // The two lines above the facts ("[]" and the block heading) count, so facts 0 to 47 fit in 50 lines.
  expect(deliveryOf(e).facts.slice(0, 48).every(Boolean)).toBe(true);
  expect(deliveryOf(e).facts[48]).toBe(false);
  // Without max_chars_arg the tap cannot tell recall from search and says so.
  const blind = await tap({ ...base, provider: { tokens: [PROVIDER], actor: 'assistant' } }, PROVIDER, call(5, 'recall', recallArgs('x')), delivered);
  expect(blind.events[0]!.provider_op).toBe('unknown');
});

test('an isError reply to a provider recall delivers nothing (QM\'s MCP client throws on it); so does a reply slower than the provider timeout', async () => {
  const err = await tap(withProvider, PROVIDER, call(6, 'recall', recallArgs('code word')), errored);
  expect(err.events[0]).toMatchObject({ outcome: 'error', provider_op: 'recall' });
  expect(deliveryOf(err.events[0]!)).toMatchObject({ delivered_chars: 0, dropped: 'tool_error' });
  expect(deliveryOf(err.events[0]!).text_chars).toBeGreaterThan(0);
  const slow = await tap({ ...base, provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars', timeout_ms: 20 } }, PROVIDER, call(7, 'recall', recallArgs('code word')), delivered, {}, undefined, 80);
  expect(slow.events[0]!.outcome).toBe('ok');
  expect(deliveryOf(slow.events[0]!)).toMatchObject({ delivered_chars: 0, dropped: 'timeout', facts: [false] });
  expect((slow.events[0]!.effect as { facts: unknown[] }).facts).toHaveLength(1);
});

test('a model call: caller model, no provider fields, no delivery; returned_by_gbrain lists the facts gbrain returned (an upper bound)', async () => {
  const { events } = await tap(withProvider, BOT, call(8, 'recall', { query: 'code word' }), truncated);
  const e = events[0]!;
  expect(e.caller).toBe('model');
  expect(e).not.toHaveProperty('provider_actor');
  expect(e).not.toHaveProperty('provider_op');
  expect(e.effect).not.toHaveProperty('delivery');
  expect((e.effect as { returned_by_gbrain: unknown }).returned_by_gbrain).toEqual([...FILLER, NEEDED].map((f) => f.id));
});

test('a forged acting_user, max_chars and x-qm-actor from the model path stay a model call with nothing attested', async () => {
  const { events, forwarded } = await tap(withProvider, BOT, call(9, 'recall', recallArgs('code word')), delivered, { 'x-qm-actor': 'dana-okafor' });
  const e = events[0]!;
  expect(e.caller).toBe('model');
  expect(e).not.toHaveProperty('provider_actor');
  expect(e.args).toEqual(recallArgs('code word'));
  expect((forwarded as { params: { arguments: Record<string, unknown> } }).params.arguments).toEqual(recallArgs('code word'));
  // A made-up provider token is not a provider call either: unknown to the world, it is refused.
  expect((await tap(withProvider, 'qm-provider-guess', call(10, 'recall', { query: 'x' }), delivered)).status).toBe(401);
});

test('the x-qm-actor header on a provider call is recorded verbatim beside acting_user; initialize carries caller too', async () => {
  const { events } = await tap(withProvider, PROVIDER, call(11, 'recall', { query: 'x', acting_user: 'U0DANA', max_chars: 6000 }), delivered, { 'x-qm-actor': 'person:dana-okafor' });
  expect(events[0]!.provider_actor).toEqual({ arg: 'U0DANA', header: 'person:dana-okafor' });
  const init = await tap(withProvider, PROVIDER, { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, { protocolVersion: '2025-03-26' });
  expect(init.events[0]).toMatchObject({ tool: 'gbrain.initialize', caller: 'provider', provider_actor: { arg: null, header: null } });
  expect(init.events[0]).not.toHaveProperty('provider_op');
  expect(init.events[0]!.effect).not.toHaveProperty('delivery');
});

test('without upstream.provider the tap adds nothing, and a provider token is just an unknown bearer', async () => {
  const { events } = await tap(base, BOT, call(12, 'recall', recallArgs('x')), delivered);
  const e = events[0]!;
  expect(Object.keys(e)).toEqual(['seq', 'trial_id', 'wall_ts', 'sim_ts', 'args_digest', 'actor', 'via', 'tool', 'kind', 'args', 'outcome', 'effect', 'grant']);
  expect(Object.keys(e.effect!)).toEqual(['pages', 'count', 'latency_ms', 'facts']);
  expect((await tap(base, PROVIDER, call(13, 'recall', { query: 'x' }), delivered)).status).toBe(401);
});

test('the world refuses provider tokens that overlap its own tokens', () => {
  const ws = startWorld('gbrain-provider-overlap');
  try {
    for (const t of [ws.credentials.bot.token, ws.credentials.actors[0]!.token, ws.credentials.admin_token, ws.credentials.bot.app_token]) {
      expect(() => ws.setGbrain({ ...base, provider: { tokens: ['qm-provider-own', t], actor: ws.credentials.bot.member } })).toThrow('provider.tokens overlaps a world token');
    }
    expect(ws.gbrain()).toBeNull();
    ws.setGbrain({ ...base, provider: { tokens: ['qm-provider-own'], actor: ws.credentials.bot.member } });
    expect(ws.gbrain()?.provider?.tokens).toEqual(['qm-provider-own']);
  } finally { ws.stop(); }
});

test('qmDelivery follows QM b6786d67: text parts joined and trimmed, structuredContent fallback, _meta never delivered, JSON-escaped facts found, search lines', () => {
  const quoted = { fact: 'Dana said "ship it" on Friday' };
  expect(qmDelivery({ content: [text('  first'), { type: 'image', data: 'x' }, text('second  ')] }, [{ fact: 'first' + NL + 'second' }], { cap: 6000 })).toEqual({ text_chars: 12, delivered_chars: 12, cap: 6000, facts: [true], returned: [true] });
  expect(qmDelivery({ content: [], structuredContent: { facts: [quoted] } }, [quoted], { cap: 6000 }).facts).toEqual([true]);
  expect(qmDelivery({ content: [text('rows only')], _meta: { retrieval: { saved_facts: [NEEDED] } } }, [NEEDED], { cap: 6000 }).facts).toEqual([false]);
  expect(qmDelivery({ content: [text('abc   ' + 'x'.repeat(10))] }, [], { cap: 6 })).toMatchObject({ delivered_chars: 3 });
  expect(qmDelivery(null, [], { cap: 6000 })).toMatchObject({ text_chars: 0, delivered_chars: 0 });
  expect(qmDelivery({ content: [] }, [], { cap: 6000 })).toMatchObject({ text_chars: 0, delivered_chars: 0 });
  expect(qmDelivery({ content: [text('a' + NL + NL + 'b' + NL + 'c')] }, [{ fact: 'b' }, { fact: 'c' }], { lines: 2 })).toEqual({ text_chars: 6, delivered_chars: 3, cap: null, lines: 2, facts: [true, false], returned: [true, true] });
});

// The mechanism count over events the tap itself wrote: turn 1 is Dana's DM whose post live ingestion wrote as fact 12;
// turn 2 is the consumer turn.
const task = { turns: [{ actor: 'dana-okafor', channel: 'dm', text: 'my code word is marmoset-7731' }, { actor: 'dana-okafor', channel: 'dm', text: 'what is my code word?' }], mechanism: { needed_turn: 1 } } as unknown as Task;
const channels = new Map<string, string>();
const none = { provider_recalls: 0, provider_returned: false, provider_delivered: false, provider_searches: 0, provider_search_returned: false, provider_search_delivered: false, provider_delivery_unknown: 0, model_calls: 0, model_read: false, model_returned_by_gbrain: false };

async function trial(calls: Array<{ token: string; body: unknown; result: Record<string, unknown>; headers?: Record<string, string> }>, upstream = withProvider): Promise<WorldEvent[]> {
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: 'D0DANA', ts: '100.1', author: 'dana-okafor', source: 'private-dana-okafor' }, outcome: 'ok', effect: { fact_id: 12 } });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  for (const c of calls) await tap(upstream, c.token, c.body, c.result, c.headers ?? {}, log);
  return log.events;
}

test('mechanism: a delivering provider recall, a truncated one, a model read and a forged model call are counted apart', async () => {
  const provider = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: delivered }]);
  expect(trialProviderMechanism(task, provider as never[], channels)).toEqual({ ...none, provider_recalls: 1, provider_returned: true, provider_delivered: true });
  const cut = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: truncated }]);
  expect(trialProviderMechanism(task, cut as never[], channels)).toEqual({ ...none, provider_recalls: 1, provider_returned: true });
  const model = await trial([{ token: BOT, body: call(1, 'search', { query: 'code word' }), result: { content: [text([]), text('Saved facts (remember): x' + NL + '- ' + NEEDED.fact)], _meta: { retrieval: { saved_facts: [NEEDED] } } } }]);
  expect(trialProviderMechanism(task, model as never[], channels)).toEqual({ ...none, model_calls: 1, model_read: true, model_returned_by_gbrain: true });
  const forged = await trial([{ token: BOT, body: call(1, 'recall', recallArgs('code word')), result: delivered, headers: { 'x-qm-actor': 'dana-okafor' } }]);
  expect(trialProviderMechanism(task, forged as never[], channels)).toEqual({ ...none, model_calls: 1, model_read: true, model_returned_by_gbrain: true });
  // The existing count is unchanged by the option: every one of these is a consumer-turn read that returned the fact.
  for (const events of [provider, cut, model, forged]) expect(trialMechanism(task, events as never[], channels)).toEqual({ read: true, needed: true, ahead: null });
});

test('mechanism: a provider-token call without max_chars counts as a memory search, not a recall', async () => {
  const events = await trial([{ token: PROVIDER, body: call(1, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), result: delivered }]);
  expect(trialProviderMechanism(task, events as never[], channels)).toEqual({ ...none, provider_searches: 1, provider_search_returned: true, provider_search_delivered: true });
});

test('mechanism: an errored provider recall is neither a recall with text nor delivered', async () => {
  const events = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: errored }]);
  expect(trialProviderMechanism(task, events as never[], channels)).toEqual(none);
});

test('mechanism: an empty provider recall is not a recall with text; a provider write and a model write are not reads', async () => {
  const events = await trial([
    { token: PROVIDER, body: call(1, 'recall', recallArgs('nothing')), result: { content: [text('   ')] } },
    { token: PROVIDER, body: call(2, 'remember', { content: 'x', acting_user: 'dana-okafor' }), result: { content: [text({ id: '1', status: 'inserted' })] } },
    { token: BOT, body: call(3, 'remember', { fact: 'y' }), result: { content: [text({ id: '2', status: 'inserted' })] } },
  ]);
  expect(trialProviderMechanism(task, events as never[], channels)).toEqual({ ...none, model_calls: 1 });
});

test('mechanism: in a run where some trial is tagged, an untagged trial (another cell, no provider block) counts its gbrain calls as the model\'s; a tagged trial with an untagged call still stops', async () => {
  const plain = await trial([{ token: BOT, body: call(1, 'recall', { query: 'code word' }), result: delivered }], base);
  expect(trialProviderMechanism(task, plain as never[], channels, { untaggedIsModel: true })).toEqual({ ...none, model_calls: 1, model_read: true, model_returned_by_gbrain: true });
  const mixed = [...plain, { ...(plain.find((e) => e.via === 'gbrain' && e.tool !== 'gbrain.initialize')!), seq: 9999, via: 'oauth', tool: 'oauth.token' }];
  expect(() => trialProviderMechanism(task, mixed as never[], channels, { untaggedIsModel: true })).toThrow('MECH-CALLER-MISSING');
});

test('mechanism: events from a tap without upstream.provider stop with MECH-CALLER-MISSING; provider reads without max_chars_arg with MECH-PROVIDER-OP-UNKNOWN', async () => {
  const events = await trial([{ token: BOT, body: call(1, 'recall', { query: 'code word' }), result: delivered }], base);
  expect(() => trialProviderMechanism(task, events as never[], channels)).toThrow('MECH-CALLER-MISSING');
  expect(trialMechanism(task, events as never[], channels)).toEqual({ read: true, needed: true, ahead: null });
  const blind = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: delivered }], { ...base, provider: { tokens: [PROVIDER], actor: 'assistant' } });
  expect(() => trialProviderMechanism(task, blind as never[], channels)).toThrow('MECH-PROVIDER-OP-UNKNOWN');
  // The check covers every provider read, not only the consumer turn's: a run without max_chars_arg whose provider reads
  // all fell in earlier turns stops too, instead of counting zero.
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  await tap({ ...base, provider: { tokens: [PROVIDER], actor: 'assistant' } }, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered, {}, log);
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  expect(() => trialProviderMechanism(task, log.events as never[], channels)).toThrow('MECH-PROVIDER-OP-UNKNOWN');
});

test('a provider write is provider_op write with no delivery, never a query, and mechanism leaves it out', async () => {
  const { events } = await tap(withProvider, PROVIDER, call(1, 'remember', { content: 'my code word is marmoset-7731', acting_user: 'dana-okafor' }), { content: [text({ id: '1', status: 'inserted' })] });
  expect(events[0]).toMatchObject({ kind: 'write', caller: 'provider', provider_op: 'write', provider_actor: { arg: 'dana-okafor', header: null } });
  expect(events[0]!.effect).not.toHaveProperty('delivery');
  // Without max_chars_arg a write is still a write, so it never trips MECH-PROVIDER-OP-UNKNOWN.
  const blind = await trial([{ token: PROVIDER, body: call(1, 'remember', { content: 'x', acting_user: 'dana-okafor' }), result: { content: [text({ id: '1', status: 'inserted' })] } }], { ...base, provider: { tokens: [PROVIDER], actor: 'assistant' } });
  expect(blind.filter((e) => e.via === 'gbrain').map((e) => e.provider_op)).toEqual(['write']);
  expect(trialProviderMechanism(task, blind as never[], channels)).toEqual(none);
});

test('mechanism: gbrain calls with no member-scoped turn stop with MECH-TURNS-MISSING; a provider call after the requester reset is not counted', async () => {
  const unscoped = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  await tap(withProvider, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered, {}, unscoped);
  expect(() => trialProviderMechanism(task, unscoped.events as never[], channels)).toThrow('MECH-TURNS-MISSING');
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  for (const member of ['dana-okafor', 'dana-okafor', null]) log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member }, outcome: 'ok' });
  await tap(withProvider, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered, {}, log);
  expect(trialProviderMechanism(task, log.events as never[], channels)).toEqual(none);
});

test('mechanism: provider and model calls before the consumer turn are not counted', async () => {
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: 'D0DANA', ts: '100.1', author: 'dana-okafor', source: 'private-dana-okafor' }, outcome: 'ok', effect: { fact_id: 12 } });
  await tap(withProvider, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered, {}, log);
  await tap(withProvider, PROVIDER, call(2, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), delivered, {}, log);
  await tap(withProvider, BOT, call(3, 'search', { query: 'code word' }), delivered, {}, log);
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  expect(trialProviderMechanism(task, log.events as never[], channels)).toEqual(none);
});

test('mechanism --provider-aware counts trials per row and sums calls; without the flag the row has no provider field', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mech-provider-'));
  try {
    mkdirSync(join(tmp, 'tasks', 'cr-09-x'), { recursive: true });
    writeFileSync(join(tmp, 'tasks', 'cr-09-x', 'task.toml'), 'id = "cr-09-x"\nslice = "multiuser"\nfamily = "corrections"\nsplit = "dev"\ntitle = "t"\ntime_budget_s = 1500\nactors = ["dana-okafor"]\n[[turns]]\nactor = "dana-okafor"\nchannel = "dm"\ntext = "my code word is marmoset-7731"\n[[turns]]\nactor = "dana-okafor"\nchannel = "dm"\ntext = "what is my code word?"\n[predicates]\nrequired = ["n"]\nforbidden_effects = []\n[mechanism]\nneeded_turn = 1\n[[predicate]]\nid = "n"\nkind = "no_cross_scope_reads"\nturns = [2]\n');
    const trials = {
      t1: await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: delivered }, { token: PROVIDER, body: call(2, 'recall', recallArgs('code word')), result: delivered }]),
      t2: await trial([
        { token: PROVIDER, body: call(1, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), result: delivered },
        { token: PROVIDER, body: call(2, 'recall', { query: 'dock schedule', acting_user: 'dana-okafor' }), result: { content: [text('')] } },
        { token: BOT, body: call(3, 'search', { query: 'code word' }), result: delivered },
        { token: BOT, body: call(4, 'remember', { fact: 'y' }), result: { content: [text({ id: '2', status: 'inserted' })] } },
      ]),
    };
    for (const [id, events] of Object.entries(trials)) {
      mkdirSync(join(tmp, 'results', 'trials', 'qm-mp', 'cr-09-x', id), { recursive: true });
      writeFileSync(join(tmp, 'results', 'trials', 'qm-mp', 'cr-09-x', id, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join(NL) + NL);
    }
    writeFileSync(join(tmp, 'results', 'trials.jsonl'), [{ trial_id: 'qm-mp/cr-09-x/t1', grade: 'pass' }, { trial_id: 'qm-mp/cr-09-x/t2', grade: 'fail' }].map((r) => JSON.stringify({ cell: 'qm-mp', task: 'cr-09-x', ...r })).join(NL) + NL);
    const row = { cell: 'qm-mp', task: 'cr-09-x', trials: 2, passes: 1, consumer_read: 2, returned_needed: 2, needed_ahead: null };
    expect(mechanism(join(tmp, 'results'), join(tmp, 'tasks'), channels)).toEqual([row]);
    expect(mechanism(join(tmp, 'results'), join(tmp, 'tasks'), channels, { providerAware: true })).toEqual([{ ...row, provider: { provider_recall: 1, provider_recalls: 2, provider_returned_needed: 1, provider_delivered_needed: 1, provider_search: 1, provider_searches: 2, provider_search_returned_needed: 1, provider_search_delivered_needed: 1, provider_delivery_unknown: 0, model_read: 1, model_calls: 2, model_returned_by_gbrain_needed: 1 } }]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('mechanism: a provider recall or search QM dropped for its timeout counts as neither returned nor delivered, and the search is not counted (it may have started in an earlier turn)', async () => {
  const slow: GbrainUpstream = { ...base, provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars', timeout_ms: 20 } };
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: 'D0DANA', ts: '100.1', author: 'dana-okafor', source: 'private-dana-okafor' }, outcome: 'ok', effect: { fact_id: 12 } });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  await tap(slow, PROVIDER, call(1, 'recall', recallArgs('code word')), delivered, {}, log, 80);
  await tap(slow, PROVIDER, call(2, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), delivered, {}, log, 80);
  expect(log.events.filter((e) => e.via === 'gbrain').map((e) => [e.outcome, (e.effect as { delivery: Delivery }).delivery.dropped])).toEqual([['ok', 'timeout'], ['ok', 'timeout']]);
  expect(trialProviderMechanism(task, log.events as never[], channels)).toEqual(none);
});

test('a provider call that fails at HTTP delivers nothing, even when the body carries a result', async () => {
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + PROVIDER, 'content-type': 'application/json' }, body: JSON.stringify(call(1, 'recall', recallArgs('code word'))) }), {
    upstream: withProvider,
    resolveActor: () => null,
    log,
    fetchImpl: (async () => Response.json({ jsonrpc: '2.0', id: 1, result: delivered }, { status: 500 })) as unknown as typeof fetch,
  });
  const [e] = log.events.filter((x) => x.via === 'gbrain');
  expect(e).toMatchObject({ outcome: 'error', error: 'upstream_500', caller: 'provider', provider_op: 'recall' });
  expect(deliveryOf(e!)).toMatchObject({ delivered_chars: 0, dropped: 'tool_error', facts: [false] });
});

test('a model call that fails at HTTP records nothing returned by gbrain, and mechanism counts a failed model read as not returned', async () => {
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: 'D0DANA', ts: '100.1', author: 'dana-okafor', source: 'private-dana-okafor' }, outcome: 'ok', effect: { fact_id: 12 } });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + BOT, 'content-type': 'application/json' }, body: JSON.stringify(call(1, 'search', { query: 'code word' })) }), {
    upstream: withProvider,
    resolveActor: () => ({ id: 'assistant' } as Member),
    log,
    fetchImpl: (async () => Response.json({ jsonrpc: '2.0', id: 1, result: delivered }, { status: 500 })) as unknown as typeof fetch,
  });
  const [e] = log.events.filter((x) => x.via === 'gbrain');
  expect(e).toMatchObject({ outcome: 'error', error: 'upstream_500', caller: 'model', effect: { returned_by_gbrain: [] } });
  expect(e!.effect).not.toHaveProperty('delivery');
  expect(trialProviderMechanism(task, log.events as never[], channels)).toEqual({ ...none, model_calls: 1, model_read: true });
  const err = await trial([{ token: BOT, body: call(1, 'search', { query: 'code word' }), result: errored }]);
  expect(trialProviderMechanism(task, err as never[], channels)).toEqual({ ...none, model_calls: 1, model_read: true });
});

test('a model call that fails at HTTP with an isError body records nothing returned by gbrain', async () => {
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + BOT, 'content-type': 'application/json' }, body: JSON.stringify(call(1, 'search', { query: 'code word' })) }), {
    upstream: withProvider,
    resolveActor: () => ({ id: 'assistant' } as Member),
    log,
    fetchImpl: (async () => Response.json({ jsonrpc: '2.0', id: 1, result: errored }, { status: 500 })) as unknown as typeof fetch,
  });
  const [e] = log.events.filter((x) => x.via === 'gbrain');
  expect(e).toMatchObject({ outcome: 'error', error: 'upstream_500', caller: 'model', effect: { returned_by_gbrain: [] } });
  expect(e!.effect).not.toHaveProperty('delivery');
});

test('mechanism --provider-aware stops on a scored trial with no events.jsonl instead of counting zero', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mech-provider-'));
  try {
    mkdirSync(join(tmp, 'tasks', 'cr-09-x'), { recursive: true });
    writeFileSync(join(tmp, 'tasks', 'cr-09-x', 'task.toml'), 'id = "cr-09-x"\nslice = "multiuser"\nfamily = "corrections"\nsplit = "dev"\ntitle = "t"\ntime_budget_s = 1500\nactors = ["dana-okafor"]\n[[turns]]\nactor = "dana-okafor"\nchannel = "dm"\ntext = "a"\n[[turns]]\nactor = "dana-okafor"\nchannel = "dm"\ntext = "b"\n[predicates]\nrequired = ["n"]\nforbidden_effects = []\n[mechanism]\nneeded_turn = 1\n[[predicate]]\nid = "n"\nkind = "no_cross_scope_reads"\nturns = [2]\n');
    mkdirSync(join(tmp, 'results'));
    writeFileSync(join(tmp, 'results', 'trials.jsonl'), JSON.stringify({ cell: 'qm-mp', task: 'cr-09-x', trial_id: 'qm-mp/cr-09-x/t1', grade: 'pass' }) + NL);
    expect(mechanism(join(tmp, 'results'), join(tmp, 'tasks'), channels)).toHaveLength(1);
    expect(() => mechanism(join(tmp, 'results'), join(tmp, 'tasks'), channels, { providerAware: true })).toThrow('MECH-EVENTS-MISSING');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a blank bearer never passes as the provider, and the world refuses empty or padded provider tokens', async () => {
  const blank = await tap({ ...base, provider: { tokens: [''], actor: 'assistant', max_chars_arg: 'max_chars' } }, String.fromCharCode(0xa0), call(1, 'recall', recallArgs('code word')), delivered);
  expect(blank.status).toBe(401);
  expect(blank.events).toHaveLength(0);
  const ws = startWorld('gbrain-provider-blank');
  try {
    for (const tokens of [[], [''], [' qm-provider-own'], ['qm-provider-own ']]) {
      expect(() => ws.setGbrain({ ...base, provider: { tokens, actor: ws.credentials.bot.member } })).toThrow('provider.tokens must be a non-empty list');
    }
    expect(() => ws.setGbrain({ ...base, provider: { tokens: 'qm-provider-own' as unknown as string[], actor: ws.credentials.bot.member } })).toThrow('provider.tokens must be a non-empty list');
    expect(() => ws.setGbrain({ ...base, provider: { tokens: ['qm-provider-own'], actor: 'no-such-member' } })).toThrow('no member no-such-member');
    for (const bad of [{ max_chars: 0 }, { max_chars: 0.5 }, { timeout_ms: Number.NaN }, { max_chars_arg: '' }, { actor_arg: 7 as unknown as string }]) {
      expect(() => ws.setGbrain({ ...base, provider: { tokens: ['qm-provider-own'], actor: ws.credentials.bot.member, ...bad } })).toThrow('must be a positive integer');
    }
    expect(ws.gbrain()).toBeNull();
  } finally { ws.stop(); }
});

test('qmDelivery never lets a cut fact ride on a longer fact that contains its text, and an empty fact is never delivered', () => {
  const OLD = { id: 11, fact: 'The code is marmoset-OLD' };
  const NEW = { id: 12, fact: 'The code is marmoset' };
  const rows = OLD.fact + '\n' + NEW.fact;
  expect(qmDelivery({ content: [text(rows)] }, [OLD, NEW], { cap: OLD.fact.length + 3 }).facts).toEqual([true, false]);
  expect(qmDelivery({ content: [text(rows)] }, [OLD, NEW], { cap: rows.length }).facts).toEqual([true, true]);
  expect(qmDelivery({ content: [text(NEW.fact + '\n' + OLD.fact)] }, [OLD, NEW], { cap: NEW.fact.length }).facts).toEqual([false, true]);
  expect(qmDelivery({ content: [text(rows)] }, [{ id: 13, fact: '' }], { cap: rows.length }).facts).toEqual([false]);
});

test('qmDelivery checks containment against the whole result in a search: a cut needed row never rides on the cut half of a longer row', () => {
  const LONG = { id: 11, fact: 'alpha' + NL + 'beta' };
  const SHORT = { id: 12, fact: 'alpha' };
  const rows = Array.from({ length: 49 }, (_, i) => 'filler ' + i).concat([LONG.fact, SHORT.fact]).join(NL);
  expect(qmDelivery({ content: [text(rows)] }, [LONG, SHORT], { lines: 50 }).facts).toEqual([false, false]);
  expect(qmDelivery({ content: [text(rows)] }, [LONG, SHORT], { lines: 52 }).facts).toEqual([true, true]);
});

test('qmDelivery stays linear on overlapping facts: a 10 KB reply through the tap takes under 50 ms', async () => {
  const facts = Array.from({ length: 8 }, (_, i) => ({ id: 200 + i, fact: 'a'.repeat(i + 1), source_id: 'public' }));
  const reply = { content: [text('a'.repeat(10_000))], _meta: { retrieval: { saved_facts: facts } } };
  const upstream: GbrainUpstream = { ...base, provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars', max_chars: 20_000 } };
  let ms = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    const r = await tap(upstream, PROVIDER, call(1, 'recall', { query: 'a', acting_user: 'dana-okafor', max_chars: 20_000 }), reply);
    ms = Math.min(ms, performance.now() - t0);
    expect(deliveryOf(r.events[0]!).facts).toEqual(facts.map((_, i) => i === facts.length - 1));
  }
  expect(ms).toBeLessThan(50);
});

test('qmDelivery matches a search after QM drops empty lines and scans only what QM hands on', () => {
  expect(qmDelivery({ content: [text('alpha' + NL + NL + 'beta')] }, [{ fact: 'alpha' + NL + 'beta' }], { lines: 5 }).facts).toEqual([true]);
  expect(qmDelivery({ content: [text('x' + NL + NL + 'y')] }, [{ fact: 'x' + NL + NL + 'y' }], { lines: 1 }).facts).toEqual([false]);
  const facts = Array.from({ length: 64 }, (_, i) => ({ fact: 'a'.repeat(i + 1) }));
  const t0 = performance.now();
  const d = qmDelivery({ content: [text('a'.repeat(200_000))] }, facts, { cap: 6000 });
  expect(performance.now() - t0).toBeLessThan(200);
  expect(d.facts).toEqual(facts.map((_, i) => i === facts.length - 1));
});

test('a provider read too large to match records match unknown at once, and mechanism counts it as not delivered', async () => {
  const facts = Array.from({ length: 64 }, (_, i) => ({ id: 300 + i, fact: 'a'.repeat(1024 + i), source_id: 'public' }));
  const reply = { content: [text('a'.repeat(200_000) + NL + 'b'.repeat(68_000))], _meta: { retrieval: { saved_facts: facts } } };
  const t0 = performance.now();
  const { events } = await tap(withProvider, PROVIDER, call(1, 'recall', { query: 'a', acting_user: 'dana-okafor' }), reply);
  expect(performance.now() - t0).toBeLessThan(500);
  expect(deliveryOf(events[0]!)).toMatchObject({ match: 'unknown', lines: QM_SEARCH_MAX_LINES, facts: facts.map(() => false) });
  expect(deliveryOf(events[0]!).delivered_chars).toBeGreaterThan(0);
  const counted = await trial([{ token: PROVIDER, body: call(1, 'recall', { query: 'a', acting_user: 'dana-okafor' }), result: reply }]);
  expect(trialProviderMechanism(task, counted as never[], channels)).toEqual({ ...none, provider_searches: 1, provider_delivery_unknown: 1 });
});

// #152 ship review: the budget is checked against the reply's raw length before the whole reply is normalized or split.
test('a reply longer than MATCH_WORK_BUDGET is not matched, normalized or split whole: match unknown, delivered text read from the front', () => {
  const head = ['row one', '', 'row two', 'row three'].join(NL);
  const search = qmDelivery({ content: [text(head + NL.repeat(MATCH_WORK_BUDGET) + 'tail')] }, [{ fact: 'row one' }], { lines: 2 });
  expect(search).toEqual({ text_chars: head.length + MATCH_WORK_BUDGET + 4, delivered_chars: 'row one\nrow two'.length, cap: null, lines: 2, match: 'unknown', facts: [false], returned: [false] });
  const recall = qmDelivery({ content: [text('row one ' + 'x'.repeat(MATCH_WORK_BUDGET))] }, [{ fact: 'row one' }], { cap: QM_RECALL_MAX_CHARS });
  expect(recall).toMatchObject({ delivered_chars: QM_RECALL_MAX_CHARS, match: 'unknown', facts: [false] });
  const atBudget = qmDelivery({ content: [text('row one' + NL + 'x'.repeat(MATCH_WORK_BUDGET - 8))] }, [{ fact: 'row one' }], { lines: 1 });
  expect(atBudget.match).toBeUndefined();
  expect(atBudget.facts).toEqual([true]);
});

test('a provider search slower than the timeout is a timeout even when it failed, and is not counted as a search', async () => {
  const slow: GbrainUpstream = { ...base, provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars', timeout_ms: 20 } };
  const log = new EventLog('t', null, () => '2026-10-30T09:00:00Z');
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: 'D0DANA', ts: '100.1', author: 'dana-okafor', source: 'private-dana-okafor' }, outcome: 'ok', effect: { fact_id: 12 } });
  log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: 'dana-okafor' }, outcome: 'ok' });
  await tap(slow, PROVIDER, call(1, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), errored, {}, log, 80);
  const [e] = log.events.filter((x) => x.via === 'gbrain');
  expect(deliveryOf(e!)).toMatchObject({ delivered_chars: 0, dropped: 'timeout', facts: [false] });
  expect(trialProviderMechanism(task, log.events as never[], channels)).toEqual(none);
});

test('mechanism (R40): a fact gbrain listed only in _meta is not returned to the provider, even when QM got other text', async () => {
  const meta = { _meta: { retrieval: { saved_facts: [NEEDED] } } };
  const recall = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: { content: [text('rows only')], ...meta } }]);
  expect(deliveryOf(recall.find((x) => x.via === 'gbrain' && x.tool === 'gbrain.recall')!)).toMatchObject({ delivered_chars: 'rows only'.length, facts: [false], returned: [false] });
  expect(trialProviderMechanism(task, recall as never[], channels)).toEqual({ ...none, provider_recalls: 1 });
  const search = await trial([{ token: PROVIDER, body: call(1, 'recall', { query: 'code word', acting_user: 'dana-okafor' }), result: { content: [text('rows only')], ...meta } }]);
  expect(trialProviderMechanism(task, search as never[], channels)).toEqual({ ...none, provider_searches: 1 });
  const cut = await trial([{ token: PROVIDER, body: call(1, 'recall', { ...recallArgs('code word'), max_chars: 10 }), result: { content: [text('x'.repeat(20) + NL + NEEDED.fact)], ...meta } }]);
  expect(trialProviderMechanism(task, cut as never[], channels)).toEqual({ ...none, provider_recalls: 1, provider_returned: true });
  expect(qmDelivery({ content: [text('rows only')], ...meta }, [NEEDED], { cap: 6000 })).toMatchObject({ facts: [false], returned: [false] });
});

test('mechanism: a provider recall that handed QM no text has not returned the fact, even when _meta carried it', async () => {
  const events = await trial([{ token: PROVIDER, body: call(1, 'recall', recallArgs('code word')), result: { content: [], _meta: { retrieval: { saved_facts: [NEEDED] } } } }]);
  expect(trialProviderMechanism(task, events as never[], channels)).toEqual(none);
});

test('qmDelivery ignores a null content entry instead of throwing', () => {
  expect(qmDelivery({ content: [null, text(NEEDED.fact)] }, [NEEDED], { cap: QM_RECALL_MAX_CHARS })).toMatchObject({ delivered_chars: NEEDED.fact.length, facts: [true] });
});

test('markdown adds the caller table only when a row carries provider counts', () => {
  const row: MechRow = { cell: 'qm-mp', task: 'ct-01', trials: 5, passes: 3, consumer_read: 5, returned_needed: 4, needed_ahead: null };
  const plain = markdown([row]);
  expect(plain.split(NL).filter(Boolean)).toHaveLength(3);
  const aware = markdown([{ ...row, provider: { provider_recall: 5, provider_recalls: 6, provider_returned_needed: 4, provider_delivered_needed: 3, provider_search: 2, provider_searches: 3, provider_search_returned_needed: 1, provider_search_delivered_needed: 1, provider_delivery_unknown: 0, model_read: 1, model_calls: 2, model_returned_by_gbrain_needed: 1 } }]);
  expect(aware.startsWith(plain.trimEnd())).toBe(true);
  expect(aware).toContain('| ct-01 | qm-mp | 5 of 5 | 6 | 4 of 5 | 3 of 5 | 2 of 5 | 3 | 1 of 5 | 1 of 5 | 0 | 1 of 5 | 2 | 1 of 5 |');
});
