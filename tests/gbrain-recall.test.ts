// internal-task: the recall rung of scripts/gbrain-check.ts, keyless and without docker: the replay rebuilds exactly the facts
// gbrain-memory-2026-10's live ingestion wrote (every fact text the run's tap recorded, in all 450 live trials, equals the replay's
// text for the same id), the committed case list is what the generator writes, the replay loop against a stub gbrain (retries
// that cannot insert twice, error rows, routes), the pass rule, resume, --gbrain-config, and the sidecar's docker run arguments.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  degradedOf, figuresOf, gbrainConfigCommands, hotMemoryAgrees, hotMemoryOf, judgeRecall, loadHotMemoryIndex, oracleKeys, parseArgs, planRecall,
  RECALL_BASELINE, RECALL_CASES, RECALL_ERROR_EXIT, RECALL_HOT_MEMORY, readRecallBaseline, recallBaselineOf, recallVerdict, rememberFact, replayFacts, replayMismatches, replayTrial,
  resumeReceipt, startRecallSidecar, writeRecallBaseline, type RecallCase, type RecallHeader, type RecallSidecar, type RecallTrial, type ReplayFact,
} from '../scripts/gbrain-check.ts';
import { startGbrainSidecar } from '../runner/trial/gbrain.ts';
import type { World } from '../world/types.ts';

const ROOT = join(import.meta.dir, '..');
const TRIALS = join(ROOT, 'docs/benchmarks/2026-10-26-gbrain-memory/results/trials');
const world = JSON.parse(readFileSync(join(ROOT, 'world/seed/world.json'), 'utf8')) as World;
const events = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tmp = () => mkdtempSync(join(tmpdir(), 'he-recall-'));

test('the replay rebuilds every fact text the counted run recorded, in every live trial', () => {
  let trials = 0, recorded = 0;
  for (const cell of readdirSync(TRIALS).filter((c) => c.includes('gbrain-told-live'))) {
    for (const task of readdirSync(join(TRIALS, cell))) for (const rep of readdirSync(join(TRIALS, cell, task))) {
      const log = events(join(TRIALS, cell, task, rep, 'events.jsonl'));
      const facts = replayFacts(log, world);
      expect(replayMismatches(log, facts)).toEqual([]);
      trials += 1;
      recorded += log.reduce((n: number, e: { effect?: { facts?: unknown[] } }) => n + (e.effect?.facts?.length ?? 0), 0);
    }
  }
  expect(trials).toBe(450);
  expect(recorded).toBeGreaterThan(1000);
});

test('a replayed fact carries the ingestion\'s text, provenance and posting time', () => {
  const log = events(join(TRIALS, 'openclaw-sonnet-gbrain-told-live-mu-memory/cr-05-pellow-seat-retraction/r1/events.jsonl'));
  const facts = replayFacts(log, world);
  const correction = facts.find((f) => f.fact_id === '3')!;
  expect(correction.source).toBe('team-coastal-members');
  expect(correction.fact).toStartWith('Sofia Marchetti (sofia-marchetti, ');
  expect(correction.fact).toContain('wrote in #coastal-random on 2026-10-14 09:00: Correction for your records');
  expect(correction.valid_from).toBe('2026-10-14T09:00:00-05:00');
  expect(correction.provenance).toBe('sofia-marchetti, #coastal-random, 2026-10-14T09:00:00-05:00');
});

test('a harness\'s own remember is replayed under its member and takes the next fact id', () => {
  const log = events(join(TRIALS, 'openclaw-sonnet-gbrain-told-live-mu-memory/cn-06-driftmoor-contact-booking/r1/events.jsonl'));
  const facts = replayFacts(log, world);
  const own = facts.find((f) => f.harness_remember);
  expect(own?.fact_id).toBe('2');
  expect(own?.harness_remember?.grant).toBe('kwame-adjei');
  expect(replayMismatches(log, facts)).toEqual([]);
});

describe('the committed case list', () => {
  const plan = planRecall(RECALL_CASES, null, false);
  test('exact counts: 308 cases, 157 miss and 151 control, over 249 trials, per task as generated', () => {
    expect(plan.cases).toHaveLength(308);
    expect(plan.cases.filter((c) => c.kind === 'miss')).toHaveLength(157);
    expect(plan.cases.filter((c) => c.kind === 'control')).toHaveLength(151);
    expect(plan.trials).toHaveLength(249);
    const byTask: Record<string, number> = {};
    for (const c of plan.cases) byTask[c.task] = (byTask[c.task] ?? 0) + 1;
    expect(byTask).toEqual({ 'ar-04-mateo-hartford-mail': 44, 'ar-05-driftmoor-rate-to-bettina': 22, 'cn-05-coastal-date-formats': 44, 'cn-06-driftmoor-contact-booking': 39, 'cn-08-vantorre-standing-attendee': 28, 'cr-05-pellow-seat-retraction': 28, 'cr-07-pellucid-owner': 33, 'cr-08-orlavine-seat-count': 33, 'ms-05-vantorre-tickets': 37 });
    for (const c of plan.cases) { expect(existsSync(join(ROOT, c.events))).toBe(true); expect(c.needed.length).toBeGreaterThan(0); }
    const cr05 = plan.cases.filter((c) => c.task === 'cr-05-pellow-seat-retraction' && c.model === 'sonnet' && c.kind === 'miss');
    expect(cr05).toHaveLength(13);
    for (const c of cr05) expect(c.grant).toBe('kwame-adjei');
  });

  test('the three reads that were themselves errors in the counted run are excluded, and only they', () => {
    const excluded = plan.trials.flatMap((t) => [...t.excluded.entries()]).sort();
    expect(excluded).toEqual([
      ['openclaw-haiku-gbrain-told-live-mu-memory/ar-04-mateo-hartford-mail/r4#42', 'the counted read was an error (invalid_params)'],
      ['openclaw-haiku-gbrain-told-live-mu-memory/cr-07-pellucid-owner/r1#23', 'the counted read was an error (invalid_params)'],
      ['openclaw-haiku-gbrain-told-live-mu-memory/ms-05-vantorre-tickets/r3#16', 'the counted read was an error (invalid_params)'],
    ]);
  });

  test('--recall-tasks matches exact task ids and refuses a prefix', () => {
    expect(planRecall(RECALL_CASES, ['cr-05-pellow-seat-retraction'], false).cases).toHaveLength(28);
    expect(() => planRecall(RECALL_CASES, ['cr-05'], false)).toThrow(/HE-RUN-002 --recall-tasks names cr-05, which no case/);
  });

  test('--recall-routes refuses a case list without questions', () => {
    const dir = tmp();
    const file = join(dir, 'cases.json');
    writeFileSync(file, JSON.stringify({ cases: plan.cases.slice(0, 2).map((c) => ({ ...c, question: null })) }));
    expect(() => planRecall(file, null, true)).toThrow(/HE-RUN-002 --recall-routes needs each case's question; 2 case/);
  });

  const generator = join(ROOT, 'scripts', 'recall-audit.ts');
  test.skipIf(!existsSync(generator))('the committed case list is byte for byte what scripts/recall-audit.ts --cases writes', () => {
    const dir = tmp();
    const r = spawnSync('bun', [generator, '--out', join(dir, 'audit'), '--cases', join(dir, 'cases.json')], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'cases.json'), 'utf8')).toBe(readFileSync(join(ROOT, RECALL_CASES), 'utf8'));
  });
});

test('the two oracles: original is needed_ids, information adds the restatements; without needed_ids every needed entry is original', () => {
  const needed = [{ id: '1', channel: 'C1', ts: '1.1', author: 'a', source: 's' }, { id: '2', channel: 'C1', ts: '1.2', author: 'assistant', source: 's' }];
  expect(oracleKeys({ needed, needed_ids: ['1'], restatement_ids: ['2'] } as RecallCase, [])).toEqual({ original: ['C1/1.1'], information: ['C1/1.1', 'C1/1.2'] });
  expect(oracleKeys({ needed: needed.slice(0, 1) } as RecallCase, [])).toEqual({ original: ['C1/1.1'], information: ['C1/1.1'] });
  const facts = [{ fact_id: '7', channel: 'C9', ts: '9.9' }] as ReplayFact[];
  expect(oracleKeys({ needed: [], needed_ids: ['7'] } as unknown as RecallCase, facts).original).toEqual(['C9/9.9']);
});

test('judgeRecall passes on a needed fact in saved facts or hot memory, and never on another fact', () => {
  const idOf = new Map([['C1/1.000001', '1'], ['C2/2.000001', '3']]);
  expect(judgeRecall(['C2/2.000001'], idOf, [{ id: 1 }], []).pass).toBe(false);
  expect(judgeRecall(['C2/2.000001'], idOf, [{ id: 3 }], []).in_saved_facts).toEqual(['3']);
  expect(judgeRecall(['C2/2.000001'], idOf, [], [{ id: '3' }]).in_hot_memory).toEqual(['3']);
  expect(judgeRecall(['C2/2.000001'], new Map(), [{ id: 3 }], []).pass).toBe(false);
});

test('hotMemoryOf reads _meta.brain_hot_memory from the result or its JSON payload', () => {
  const block = { source_id: 'private-kwame-adjei', facts: [{ id: 6, fact: 'x' }] };
  expect(hotMemoryOf({ _meta: { brain_hot_memory: block } })?.facts).toEqual([{ id: '6', fact: 'x' }]);
  expect(hotMemoryOf({ content: [{ type: 'text', text: JSON.stringify({ _meta: { brain_hot_memory: block } }) }] })?.source_id).toBe('private-kwame-adjei');
  expect(hotMemoryOf({ content: [{ type: 'text', text: '[]' }] })).toBeNull();
});

test('Hermes hot memory against #92: counts by position, agreeing on absence or on source and fact count', () => {
  const index = loadHotMemoryIndex(RECALL_HOT_MEMORY);
  expect(index.get('hermes-sonnet-gbrain-told-live-mu-memory/ar-04-mateo-hartford-mail/r1#8')).toBeNull();
  expect(index.get('hermes-sonnet-gbrain-told-live-mu-memory/ar-04-mateo-hartford-mail/r1#20')).toEqual({ source_id: 'private-nadia-fennimore', facts: 1 });
  expect(hotMemoryAgrees(null, null)).toBe(true);
  expect(hotMemoryAgrees(null, { source_id: 'private-x', facts: [] })).toBe(true);
  expect(hotMemoryAgrees({ source_id: 'private-x', facts: 1 }, { source_id: 'private-x', facts: [{}] })).toBe(true);
  expect(hotMemoryAgrees({ source_id: 'private-x', facts: 1 }, { source_id: 'private-x', facts: [{}, {}] })).toBe(false);
  expect(hotMemoryAgrees({ source_id: 'private-x', facts: 1 }, null)).toBe(false);
});

test('degraded: the keyword-only stamps are the brain\'s own; any other stamp marks a degraded reply', () => {
  expect(degradedOf({ _meta: { retrieval: { degraded: [{ stage: 'embed_unavailable', reason: 'embedding_disabled' }] } } })).toEqual({ keyword_only: true, degraded: [] });
  expect(degradedOf({ content: [{ type: 'text', text: JSON.stringify({ facts: [], facts_degraded: { reason: 'keyword_only_embedding_disabled' } }) }] })).toEqual({ keyword_only: true, degraded: [] });
  expect(degradedOf({ _meta: { retrieval: { degraded: [{ stage: 'embed_unavailable', reason: 'embed_timeout' }], projection_readiness: { ready: false } } } }).degraded).toEqual(['embed_timeout', 'projection_not_ready']);
});

test('figuresOf reads the message after the ingestion\'s header, not its date', () => {
  expect(figuresOf('Ruth (ruth, member) wrote in #pod on 2026-10-14 09:00: Orlavine has 40 seats, not 38.5.')).toEqual(['40', '38.5']);
  expect(figuresOf('remember: 12 desks')).toEqual(['12']);
});

// ---- the replay loop against a stub gbrain ----------------------------------------------------------------------------------

type StubFact = { id: number; fact: string; entity_slug: string | null; source: string };
function stubGbrain(o: { lostReplyOnce?: boolean; refuse?: string; pending?: { times: number; ms: number; status?: number }; nullResult?: string } = {}) {
  const facts: StubFact[] = [];
  const byRequest = new Map<string, number>();
  const seen = new Set<string>();
  const calls: Array<{ name: string; args: Record<string, unknown>; token: string }> = [];
  const entityOf = (fact: string) => (/Orlavine/.test(fact) ? 'orlavine' : /Pellow/.test(fact) ? 'pellow' : null);
  const words = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const match = (q: string) => facts.filter((f) => words(q).some((w) => f.fact.toLowerCase().includes(w)));
  const json = (result: unknown, status = 200) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status, headers: { 'content-type': 'application/json' } });
  const server = Bun.serve({ port: 0, async fetch(req) {
    const body = await req.json() as { params: { name: string; arguments: Record<string, unknown> } };
    const { name, arguments: args } = body.params;
    calls.push({ name, args, token: (req.headers.get('authorization') ?? '').replace('Bearer ', '') });
    if (name === 'remember') {
      const rid = String(args.request_id);
      if (o.refuse && String(args.fact).includes(o.refuse)) return json({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'invalid_params' }) }] });
      let id = byRequest.get(rid);
      if (id === undefined) { id = facts.length + 1; facts.push({ id, fact: String(args.fact), entity_slug: entityOf(String(args.fact)), source: String(args.source_id) }); byRequest.set(rid, id); }
      if (o.lostReplyOnce && !seen.has(rid)) { seen.add(rid); return new Response('upstream reset', { status: 503 }); }
      if (o.pending && calls.filter((c) => c.args.request_id === rid).length <= o.pending.times) return json({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'unavailable', write_error: 'write_pending', write_request: { request_id: rid, state: 'queued', retry_after_ms: o.pending.ms } }) }] }, o.pending.status);
      return json({ content: [{ type: 'text', text: JSON.stringify({ id: String(id), status: 'inserted', entity_slug: facts[id - 1]!.entity_slug, request_id: rid }) }] });
    }
    if (o.nullResult === name) return json(null);
    if (name === 'search') {
      const saved = match(String(args.query)).map((f) => ({ id: f.id, fact: f.fact, entity_slug: f.entity_slug }));
      return json({ _meta: { retrieval: { saved_facts: saved, degraded: [{ stage: 'embed_unavailable', reason: 'embedding_disabled' }] }, brain_hot_memory: { source_id: 'private-m', facts: facts.slice(0, 1).map((f) => ({ id: f.id, fact: f.fact })) } }, content: [{ type: 'text', text: '[]' }] });
    }
    if (name === 'recall') {
      const rows = typeof args.entity === 'string' ? facts.filter((f) => f.entity_slug === args.entity) : facts;
      return json({ content: [{ type: 'text', text: JSON.stringify({ facts: rows.map((f) => ({ id: f.id, fact: f.fact, entity_slug: f.entity_slug, fact_id: String(f.id) })), facts_degraded: { reason: 'keyword_only_embedding_disabled' } }) }] });
    }
    return json({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'internal_error' }) }] });
  } });
  return { url: 'http://127.0.0.1:' + server.port, facts, calls, stop: () => server.stop(true) };
}

const fact = (seq: number, id: string, ts: string, text: string): ReplayFact => ({ seq, fact_id: id, channel: 'C1', ts, author: 'ann', source: 'channel-x', fact: text, provenance: 'ann, #x', valid_from: '2026-10-14T09:00:00-05:00' });
const kase = (seq: number, turn: number, o: Partial<RecallCase>): RecallCase => ({ id: 'cell/cr-08-x/r1#' + seq, kind: 'control', task: 'cr-08-x', harness: 'hermes', model: 'sonnet', fact_type: 'correction', turn, grant: 'm', tool: 'search', args: { query: 'Orlavine seats' }, events: 'cell/cr-08-x/r1/events.jsonl', seq,
  needed: [{ id: '1', channel: 'C1', ts: '1.1', author: 'ann', source: 'channel-x' }, { id: '2', channel: 'C1', ts: '1.2', author: 'assistant', source: 'channel-x' }], needed_ids: ['1'], restatement_ids: ['2'], question: 'How many Orlavine seats are there now?', ...o });
const trialOf = (cases: RecallCase[], excluded = new Map<string, string>()): RecallTrial => ({ events: 'cell/cr-08-x/r1/events.jsonl', excluded, runSaved: new Map(), cases,
  facts: [fact(1, '1', '1.1', 'Ann (ann, member) wrote in #x on 2026-10-14 09:00: Orlavine has 40 seats now.'), fact(2, '2', '1.2', 'assistant wrote in #x on 2026-10-14 09:01: Noted: Orlavine seats are 40.'), fact(3, '3', '1.3', 'Bo (bo, member) wrote in #x on 2026-10-14 10:00: Pellow lunch for 40 people at noon.')] });
const sidecarOf = (url: string): RecallSidecar => ({ url, members: { m: 'tm' }, public_only: 'tp', sources: { 'channel-x': 'ti' }, config: [], ready_ms: 0, stop: async () => undefined });

describe('replayTrial against a stub gbrain', () => {
  test('writes each fact once under its source token, scores both oracles, and turns a tool error into an error row', async () => {
    const stub = stubGbrain({ lostReplyOnce: true });
    try {
      const rows: Array<Record<string, unknown>> = [];
      const hot = new Map([['cell/cr-08-x/r1#4', { source_id: 'private-m', facts: 1 }]]);
      const errors = await replayTrial(trialOf([kase(4, 2, {}), kase(5, 2, { kind: 'miss', args: { query: 'Pellow lunch' } }), kase(6, 3, { kind: 'miss', tool: 'query', args: { query: 'Orlavine' } })]), sidecarOf(stub.url), { routes: false, hot }, (r) => rows.push(r));
      expect(stub.facts).toHaveLength(3);
      expect(stub.calls.filter((c) => c.name === 'remember')).toHaveLength(6);
      expect(new Set(stub.calls.filter((c) => c.name === 'remember').map((c) => c.token))).toEqual(new Set(['ti']));
      expect(rows.map((r) => [r.id, r.outcome, r.pass_original, r.pass_information])).toEqual([
        ['cell/cr-08-x/r1#4', 'ok', true, true], ['cell/cr-08-x/r1#5', 'ok', true, true], ['cell/cr-08-x/r1#6', 'error', false, false]]);
      expect(rows[0]).toMatchObject({ needed_ids: ['1'], restatement_ids: ['2'], in_saved_facts: ['1'], in_hot_memory: ['1'], keyword_only: true, degraded: [], hermes_hot_memory: { recorded: { source_id: 'private-m', facts: 1 }, agrees: true } });
      expect(rows[1]).toMatchObject({ in_saved_facts: [], in_hot_memory: ['1'] });
      expect(rows[2]).toMatchObject({ error: 'internal_error' });
      const only = [] as Array<Record<string, unknown>>;
      await replayTrial(trialOf([kase(4, 2, { needed_ids: [] })]), sidecarOf(stub.url), { routes: false, hot: null }, (r) => only.push(r));
      expect(only[0]).toMatchObject({ pass_original: null, pass_information: true, needed_ids: [] });
      expect(errors).toBe(1);
      expect(recallVerdict(rows, { baseline: null, targets: [] }).exit).toBe(RECALL_ERROR_EXIT);
    } finally { stub.stop(); }
  });

  test('a write that never commits turns the trial\'s later reads into error rows, never misses', async () => {
    const stub = stubGbrain({ refuse: 'Pellow' });
    try {
      const rows: Array<Record<string, unknown>> = [];
      const excluded = new Map([['cell/cr-08-x/r1#9', 'the counted read was an error (invalid_params)']]);
      const errors = await replayTrial(trialOf([kase(2, 1, {}), kase(8, 2, {}), kase(9, 2, {})], excluded), sidecarOf(stub.url), { routes: false, hot: null }, (r) => rows.push(r));
      expect(rows.map((r) => r.outcome)).toEqual(['ok', 'error', 'error']);
      expect(String(rows[1]!.error)).toMatch(/^replay write failed: remember of ingest seq 3 into channel-x was refused/);
      expect(errors).toBe(1);
      expect(recallVerdict(rows, { baseline: null, targets: [] })).toMatchObject({ errors: ['cell/cr-08-x/r1#8'], excluded: [{ id: 'cell/cr-08-x/r1#9' }] });
    } finally { stub.stop(); }
  });

  test('routes: the turn\'s question four ways, once per consumer turn, the entity arm on the stored entity, figures under another entity', async () => {
    const stub = stubGbrain();
    try {
      const rows: Array<Record<string, unknown>> = [];
      await replayTrial(trialOf([kase(4, 2, {}), kase(5, 2, {}), kase(6, 3, { question: 'Who is joining the lunch?' })]), sidecarOf(stub.url), { routes: true, hot: null }, (r) => rows.push(r));
      const routes = rows.filter((r) => r.type === 'route');
      expect(routes.map((r) => [r.turn, r.route, r.outcome, r.pass_original])).toEqual([
        [2, 'search', 'ok', true], [2, 'query', 'error', false], [2, 'recall', 'ok', true], [2, 'recall_entity', 'ok', true],
        [3, 'search', 'ok', true], [3, 'query', 'error', false], [3, 'recall', 'ok', true], [3, 'recall_entity', 'ok', true]]);
      expect(routes[0]!.args).toEqual({ query: 'How many Orlavine seats are there now?' });
      expect(routes[3]).toMatchObject({ tool: 'recall', args: { question: 'How many Orlavine seats are there now?', entity: 'orlavine' }, entity: 'orlavine' });
      expect(routes[2]!.cross_entity_figures).toEqual([{ fact_id: '3', entity: 'pellow', figure: '40' }]);
    } finally { stub.stop(); }
  });

  test('routes: a needed fact stored with no entity makes the entity arm n/a', async () => {
    const stub = stubGbrain();
    try {
      const rows: Array<Record<string, unknown>> = [];
      const t = trialOf([kase(4, 2, {})]);
      t.facts[0] = { ...t.facts[0]!, fact: 'Ann (ann, member) wrote in #x on 2026-10-14 09:00: the seat count is 40 now.' };
      await replayTrial(t, sidecarOf(stub.url), { routes: true, hot: null }, (r) => rows.push(r));
      expect(rows.find((r) => r.route === 'recall_entity')).toMatchObject({ outcome: 'n/a', entity: null });
    } finally { stub.stop(); }
  });

  test('a reply with no tool result is an error row that exits 4, even where the baseline also missed', async () => {
    const stub = stubGbrain({ nullResult: 'search' });
    try {
      const rows: Array<Record<string, unknown>> = [];
      const errors = await replayTrial(trialOf([kase(4, 2, {})]), sidecarOf(stub.url), { routes: false, hot: null }, (r) => rows.push(r));
      expect(rows[0]).toMatchObject({ outcome: 'error', pass_original: false, error: expect.stringMatching(/^malformed_result/) });
      expect(errors).toBe(1);
      const baseline = { schema: 1 as const, source: 'test', header, cases: { [String(rows[0]!.id)]: { original: false, information: false, outcome: 'ok' } }, routes: {} };
      expect(recallVerdict(rows, { baseline, targets: [] }).exit).toBe(RECALL_ERROR_EXIT);
    } finally { stub.stop(); }
  });

  test('a pending remember waits the write_request.retry_after_ms gbrain asks for, then commits once under the same request_id', async () => {
    const orlavine = fact(1, '1', '1.1', 'Ann (ann, member) wrote in #x on 2026-10-14 09:00: Orlavine has 40 seats now.');
    const stub = stubGbrain({ pending: { times: 1, ms: 1_200 } });
    try {
      const t0 = Date.now();
      const w = await rememberFact(stub.url, 'ti', orlavine);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1_200);
      expect(w).toEqual({ id: '1', entity: 'orlavine' });
      const calls = stub.calls.filter((c) => c.name === 'remember');
      expect(calls).toHaveLength(2);
      expect(calls[0]!.args.request_id).toBe(calls[1]!.args.request_id);
      expect(stub.facts).toHaveLength(1);
    } finally { stub.stop(); }
  });

  test('remember follows the live ingestion: three attempts in all, and a non-2xx answer is final whatever its body says', async () => {
    const orlavine = fact(1, '1', '1.1', 'Ann (ann, member) wrote in #x on 2026-10-14 09:00: Orlavine has 40 seats now.');
    const thrice = stubGbrain({ pending: { times: 3, ms: 0 } });
    try {
      expect(await rememberFact(thrice.url, 'ti', orlavine)).toEqual({ error: expect.stringMatching(/did not commit after 3 attempts under request_id .*: write_pending$/) });
      expect(thrice.calls.filter((c) => c.name === 'remember')).toHaveLength(3);
    } finally { thrice.stop(); }
    const http400 = stubGbrain({ pending: { times: 1, ms: 0, status: 400 } });
    try {
      expect(await rememberFact(http400.url, 'ti', orlavine)).toEqual({ error: expect.stringMatching(/was refused: upstream_400$/) });
      expect(http400.calls.filter((c) => c.name === 'remember')).toHaveLength(1);
    } finally { http400.stop(); }
  });
});

// ---- the pass rule, the baseline and resume ----------------------------------------------------------------------------------

const header: RecallHeader = { type: 'header', schema: 1, harness_evals_commit: 'abc', dirty: false, cases_file: RECALL_CASES, cases_sha256: 'f'.repeat(64), recall_tasks: null, routes: true, image: 'harness-eval/gbrain:check-x', image_id: 'sha256:1', gbrain_commit: 'c'.repeat(40), gbrain_version: '0.60.1', gbrain_config: [] };
const row = (id: string, o: Record<string, unknown>) => ({ type: 'case', trial: 't', id, task: 'cr-05', kind: 'miss', outcome: 'ok', pass_original: false, pass_information: false, degraded: [], excluded: null, ...o });

test('the pass rule: a baseline pass lost, or a missed target, exits 1; other misses are counts; errors and degraded rows exit 4', () => {
  const baseline = recallBaselineOf([row('a', { pass_original: true }), row('b', { pass_original: true }), row('c', {}), row('x', { pass_original: true })], header);
  expect(baseline.cases.a).toEqual({ original: true, information: false, outcome: 'ok' });
  const now = [row('a', { pass_original: true }), row('b', {}), row('c', {}), row('x', { excluded: 'the counted read was an error (invalid_params)' })];
  expect(recallVerdict(now, { baseline, targets: [] })).toMatchObject({ exit: 1, regressions: ['b'], misses: ['b', 'c'], excluded: [{ id: 'x' }] });
  const fixed = [row('a', { pass_original: true }), row('b', { pass_original: true }), row('c', {})];
  expect(recallVerdict(fixed, { baseline, targets: [] }).exit).toBe(0);
  expect(recallVerdict(fixed, { baseline, targets: [{ task: 'cr-05', n: 2 }] })).toMatchObject({ exit: 0, targets: [{ task: 'cr-05', n: 2, got: 2, met: true }] });
  expect(recallVerdict(fixed, { baseline, targets: [{ task: 'cr-05', n: 3 }] }).exit).toBe(1);
  expect(recallVerdict([...fixed, row('d', { outcome: 'error' })], { baseline, targets: [] }).exit).toBe(RECALL_ERROR_EXIT);
  expect(recallVerdict([row('a', { degraded: ['embed_timeout'] }), row('b', { pass_original: true })], { baseline, targets: [] })).toMatchObject({ exit: RECALL_ERROR_EXIT, degraded: ['a'], regressions: [] });
  expect(recallVerdict([row('a', { pass_original: null, degraded: ['embed_timeout'] }), row('b', { pass_original: null })], { baseline, targets: [] })).toMatchObject({ exit: 0, misses: [], degraded: [] });
});

test('--resume keeps only complete trials and refuses a receipt whose header differs in any field', () => {
  const dir = tmp();
  const file = join(dir, 'recall.jsonl');
  const lines = [header, row('a', { trial: 'A' }), { type: 'trial', trial: 'A', complete: true }, row('b', { trial: 'B' }), row('c', { trial: 'C' }), { type: 'trial', trial: 'C', complete: false }, { type: 'summary', exit: 1 }];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = resumeReceipt(file, header);
  expect([...r.done]).toEqual(['A']);
  expect(r.rows.map((x) => x.id ?? x.type)).toEqual(['a', 'trial']);
  expect(() => resumeReceipt(file, { ...header, image_id: 'sha256:2' })).toThrow(/HE-GBRAIN-014 --resume refused: .* image_id \("sha256:1" there, "sha256:2" now\)/);
  expect(() => resumeReceipt(file, { ...header, gbrain_config: [{ key: 'search.x', value: '1' }] })).toThrow(/HE-GBRAIN-014 .*gbrain_config/);
  expect(() => resumeReceipt(file, { ...header, dirty: true })).toThrow(/HE-GBRAIN-014 .*dirty/);
  expect(() => resumeReceipt(join(dir, 'none.jsonl'), header)).toThrow(/HE-GBRAIN-014 --resume names no receipt/);
});

test('--resume drops a torn last line, refuses any other line that is not JSON, and refuses a dirty tree', () => {
  const dir = tmp();
  const file = join(dir, 'recall.jsonl');
  const good = [header, row('a', { trial: 'A' }), { type: 'trial', trial: 'A', complete: true }, row('b', { trial: 'B' })].map((l) => JSON.stringify(l)).join('\n') + '\n';
  writeFileSync(file, good + JSON.stringify({ type: 'trial', trial: 'B', complete: true }).slice(0, 20));
  const r = resumeReceipt(file, header);
  expect([...r.done]).toEqual(['A']);
  expect(r.rows.map((x) => x.id ?? x.type)).toEqual(['a', 'trial']);
  writeFileSync(file, good.replace('"id":"b"', '"id":') + JSON.stringify({ type: 'trial', trial: 'B', complete: false }) + '\n');
  expect(() => resumeReceipt(file, header)).toThrow(/HE-GBRAIN-014 --resume refused: line 4 of .* is not a JSON row/);
  expect(() => resumeReceipt(file, { ...header, dirty: true })).toThrow(/HE-GBRAIN-014 --resume refused: the tree is dirty/);
});

test('the recall baseline: refused when missing, malformed or from another cases file; the committed pair reads', () => {
  const dir = tmp();
  const plan = planRecall(RECALL_CASES, null, false);
  expect(readRecallBaseline(RECALL_BASELINE, plan.sha256)).toMatchObject({ schema: 1, header: { cases_sha256: plan.sha256 } });
  expect(() => readRecallBaseline(join(dir, 'none.json'), plan.sha256)).toThrow(/HE-GBRAIN-014 no recall baseline at/);
  writeFileSync(join(dir, 'bad.json'), '{"schema":1,');
  expect(() => readRecallBaseline(join(dir, 'bad.json'), plan.sha256)).toThrow(/HE-GBRAIN-014 .* does not have the recall baseline shape/);
  writeFileSync(join(dir, 'shape.json'), JSON.stringify({ schema: 2, header, cases: {} }));
  expect(() => readRecallBaseline(join(dir, 'shape.json'), plan.sha256)).toThrow(/HE-GBRAIN-014 .* does not have the recall baseline shape/);
  writeFileSync(join(dir, 'other.json'), JSON.stringify(recallBaselineOf([row('a', {})], header)));
  expect(() => readRecallBaseline(join(dir, 'other.json'), plan.sha256)).toThrow(/HE-GBRAIN-014 .* was written from cases ffffffffffff, this run reads/);
});

test('--write-baseline: refused over error rows, over an existing file without --force, and for a filtered, configured or unnamed baseline', () => {
  const dir = tmp();
  const file = join(dir, 'baseline.json');
  const rows = [row('a', { pass_original: true })];
  expect(() => writeRecallBaseline(file, rows, header, RECALL_ERROR_EXIT, true)).toThrow(/HE-GBRAIN-010 .* no error or degraded row; nothing written/);
  expect(existsSync(file)).toBe(false);
  writeRecallBaseline(file, rows, header, 0, false);
  expect(JSON.parse(readFileSync(file, 'utf8')).cases.a).toEqual({ original: true, information: false, outcome: 'ok' });
  expect(() => writeRecallBaseline(file, [row('a', {})], header, 1, false)).toThrow(/HE-GBRAIN-010 .* exists; pass --force/);
  writeRecallBaseline(file, [row('a', {})], header, 1, true);
  expect(JSON.parse(readFileSync(file + '.prev', 'utf8')).cases.a.original).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).cases.a.original).toBe(false);
  const wb = ['--gbrain', 'x', '--rungs', 'recall', '--write-baseline'];
  expect(() => parseArgs([...wb, '--recall-tasks', 'cr-05-pellow-seat-retraction'])).toThrow(/HE-GBRAIN-010 .* refuses --recall-tasks/);
  expect(() => parseArgs([...wb, '--recall-baseline', 'none'])).toThrow(/HE-GBRAIN-010 .* refuses --recall-baseline none/);
  expect(() => parseArgs([...wb, '--gbrain-config', 'search.mode=x'])).toThrow(/HE-GBRAIN-010 .* refuses --gbrain-config/);
  expect(parseArgs(wb)).toMatchObject({ writeBaseline: true });
});

test('parseArgs: the recall flags, repeatable targets and --gbrain-config key=value', () => {
  expect(parseArgs(['--gbrain', 'x', '--rungs', 'recall'])).toMatchObject({ rungs: ['recall'], recallCases: RECALL_CASES, recallBaseline: RECALL_BASELINE, recallTargets: [], recallRoutes: false, gbrainConfig: [], resume: null, recallTasks: null });
  expect(parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--recall-target', 'cr-05-pellow-seat-retraction=20', '--recall-target', 'cr-08-orlavine-seat-count=28', '--recall-routes', '--gbrain-config', 'search.mode=keyword=strict', '--gbrain-config', 'facts.limit=5', '--resume', 'results/gbrain-check/x', '--recall-tasks', 'cr-05-pellow-seat-retraction']))
    .toMatchObject({ recallTargets: [{ task: 'cr-05-pellow-seat-retraction', n: 20 }, { task: 'cr-08-orlavine-seat-count', n: 28 }], recallRoutes: true, gbrainConfig: [{ key: 'search.mode', value: 'keyword=strict' }, { key: 'facts.limit', value: '5' }], resume: 'results/gbrain-check/x', recallTasks: ['cr-05-pellow-seat-retraction'] });
  expect(() => parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', 'search.mode'])).toThrow(/HE-RUN-002 --gbrain-config takes <key>=<value>/);
  expect(() => parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', '=1'])).toThrow(/HE-RUN-002 --gbrain-config/);
  expect(() => parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', 'a=1', '--gbrain-config', 'a=2'])).toThrow(/HE-RUN-002 a is given twice/);
  expect(() => parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--recall-target', 'cr-05=x'])).toThrow(/HE-RUN-002 --recall-target/);
  expect(() => parseArgs(['--gbrain', 'x', '--recall-routes'])).toThrow(/HE-RUN-002 --recall-routes belong to the recall rung/);
  expect(() => planRecall(RECALL_CASES, null, false, ['cr-05'])).toThrow(/HE-RUN-002 --recall-target names cr-05, which no case/);
  expect(() => planRecall(RECALL_CASES, ['cr-08-orlavine-seat-count'], false, ['cr-05-pellow-seat-retraction'])).toThrow(/HE-RUN-002 --recall-target names cr-05-pellow-seat-retraction, which no case .* under --recall-tasks/);
});

test('--gbrain-config refuses the keys gbrain treats as secrets, without echoing their values', () => {
  for (const kv of ['openai_api_key=sentinel-value', 'anthropic_api_key=sentinel-value', 'auth.token=sentinel-value', 'db_password=sentinel-value', 'OPENAI-SECRET=sentinel-value']) {
    let message = '';
    try { parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', kv]); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^HE-RUN-002 --gbrain-config refuses .*: a secret, a connection string or a URL with credentials/);
    expect(message).not.toContain('sentinel-value');
  }
  let message = '';
  try { parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', '=sentinel-value']); } catch (e) { message = (e as Error).message; }
  expect(message).toMatch(/^HE-RUN-002 --gbrain-config takes/);
  expect(message).not.toContain('sentinel-value');
  for (const kv of ['database_url=postgres://sentinel-value@db/brain', 'search.endpoint=https://user:sentinel-value@host/x', 'embedding.dsn=sentinel-value']) {
    let m = '';
    try { parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', kv]); } catch (e) { m = (e as Error).message; }
    expect(m).toMatch(/^HE-RUN-002 --gbrain-config refuses .*: a secret, a connection string or a URL with credentials/);
    expect(m).not.toContain('sentinel-value');
  }
  expect(parseArgs(['--gbrain', 'x', '--rungs', 'recall', '--gbrain-config', 'search.keyword_boost=2']).gbrainConfig).toEqual([{ key: 'search.keyword_boost', value: '2' }]);
});

test('--gbrain-config: stop, copy the brain out, set and get in a one-off container with no network, copy it in, start', () => {
  const c = gbrainConfigCommands({ container: 'he-gbrain-s', image: 'img', brainDir: '/out/config-brain', split: 'heldout', user: '1:2', settings: [{ key: 'search.x', value: '7' }] });
  const cli = ['docker', 'run', '--rm', '--network', 'none', '--user', '1:2', '-v', '/out/config-brain:/brain/.gbrain', '-e', 'GBRAIN_HOME=/brain', '-e', 'HOME=/tmp', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'NO_COLOR=1', '--entrypoint', 'bun', 'img', '/opt/gbrain/src/cli.ts', 'config'];
  expect(c).toEqual({ stop: ['docker', 'stop', '-t', '10', 'he-gbrain-s'], copyOut: ['docker', 'cp', '-a', 'he-gbrain-s:/brain/.gbrain', '/out/config-brain'], set: [[...cli, 'set', 'search.x', '7']], get: [[...cli, 'get', 'search.x']],
    copyIn: ['docker', 'cp', '-a', '/out/config-brain/.', 'he-gbrain-s:/brains/heldout-member/.gbrain'], start: ['docker', 'start', 'he-gbrain-s'] });
});

// ---- the sidecar's docker run arguments, through a fake docker on PATH ---------------------------------------------------------
// Bun.spawn resolves docker on the PATH the process started with, so each case runs in a child bun whose PATH starts with the fake.

describe('docker run arguments', () => {
  const dir = tmp();
  const log = join(dir, 'docker.log');
  let health: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    health = Bun.serve({ port: 0, fetch: () => new Response('ok') });
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'docker'), [
      '#!/usr/bin/env bash',
      'printf "%s\\037" "$@" >> "$FAKE_DOCKER_LOG"; printf "\\n" >> "$FAKE_DOCKER_LOG"',
      'last=""; prev=""; out=""; get=""',
      'for a in "$@"; do if [ "$prev" = -v ]; then out="$a"; fi; [ "$a" = get ] && get=1; prev="$a"; last="$a"; done',
      'case "$1" in',
      '  image) [ "$3" = -f ] && echo sha256:fake; exit 0 ;;',
      '  run) if [ "$2" = -d ]; then o="$(echo "$out" | sed "s#:/he-gbrain##")"; printf tok > "$o/token"',
      '        echo \'{"schema_version":1,"brain":"member","split":"heldout","members":{"m":"tm"},"public_only":"tp"}\' > "$o/tokens.json"',
      '        echo \'{"schema_version":3,"brain":"member","split":"heldout","sources":[{"id":"channel-x","readers":["m"]}],"grants":[],"ingest":{"channels":{},"dm_source_prefix":"private-"}}\' > "$o/manifest.json"',
      '        echo \'{"schema_version":1,"brain":"member","split":"heldout","sources":{"channel-x":"ti"}}\' > "$o/ingest-tokens.json"; echo cid',
      '      elif [ -n "$get" ]; then echo 7; fi; exit 0 ;;',
      '  port) echo "127.0.0.1:$FAKE_PORT" ;;',
      '  inspect) echo "running 0" ;;',
      '  cp) case "$last" in *:*) ;; *) mkdir -p "$last"; touch "$last/config.json" ;; esac ;;',
      'esac',
      'exit 0',
    ].join('\n') + '\n');
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
  });
  afterAll(() => { health.stop(true); });
  /** Runs one module body in a child bun with the fake docker first on PATH, asynchronously so this process's stub /health
   *  answers it; returns its docker calls and its stdout. */
  const child = async (body: string) => {
    writeFileSync(log, '');
    const file = join(dir, 'child-' + Math.random().toString(36).slice(2) + '.ts');
    writeFileSync(file, "import { startGbrainSidecar } from '" + join(ROOT, 'runner/trial/gbrain.ts') + "';\nimport { startRecallSidecar } from '" + join(ROOT, 'scripts/gbrain-check.ts') + "';\n" + body);
    const p = Bun.spawn(['bun', file], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, FAKE_DOCKER_LOG: log, FAKE_PORT: String(health.port) } });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(stderr.includes('error:') ? stderr : '').toBe('');
    return { calls: readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split('\x1f').slice(0, -1)), stdout };
  };
  const user = process.getuid!() + ':' + process.getgid!();
  const runArgs = (slug: string, out: string, trial: string, brain: string, scope: string, ingest: string, image: string) => ['run', '-d', '--name', 'he-gbrain-' + slug, '--user', user, '--network', 'he-gbrain-' + slug + '-net', '--add-host', 'host.docker.internal:host-gateway', '-p', '127.0.0.1:0:3131', '-v', out + ':/he-gbrain',
    '-e', 'HE_GBRAIN_SPLIT=heldout', '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', 'HE_TRIAL_ID=' + trial, '-e', 'HE_GBRAIN_BRAIN=' + brain, '-e', 'HE_GBRAIN_SCOPE=' + scope, '-e', 'HE_GBRAIN_INGEST=' + ingest, '-e', 'HE_GBRAIN_SURFACE=starter', '-e', 'HE_GBRAIN_EMBEDDINGS=off', image];

  test('the default docker run arguments of startGbrainSidecar are unchanged', async () => {
    const out = join(dir, 'default');
    const { calls } = await child("const sc = await startGbrainSidecar({ trialId: 't1', trialSlug: 's1', split: 'heldout', outDir: '" + out + "' });\nawait sc.stop();\n");
    expect(calls.filter((c) => c[0] === 'run')).toEqual([runArgs('s1', out, 't1', 'bot-visible', 'none', 'off', 'harness-eval/gbrain:dev')]);
  }, 60_000);

  test('the rung starts its sidecar with the live member-brain arguments, and --gbrain-config changes nothing in them', async () => {
    const start = (settings: string) => child("const sc = await startRecallSidecar('img', '" + join(dir, 'r') + "', 'recall-a', 0, " + settings + ");\nawait sc.stop();\nconsole.log(JSON.stringify(sc.config));\n");
    const plain = await start('[]');
    const configured = await start("[{ key: 'search.x', value: '7' }]");
    const expected = runArgs('recall-a', join(dir, 'r', 'sidecar-0'), 'gbrain-check-recall-0', 'member', 'member', 'live', 'img');
    expect(plain.calls.filter((c) => c[0] === 'run')).toEqual([expected]);
    expect(configured.calls.filter((c) => c[0] === 'run' && c[1] === '-d')).toEqual([expected]);
    const after = configured.calls.slice(configured.calls.findIndex((c) => c[0] === 'run' && c[1] === '-d') + 1).map((c) => (c[0] === 'run' ? c.slice(-3).join(' ') : c[0]!));
    expect(after.filter((c) => !['port', 'inspect', 'image', 'logs', 'rm', 'network'].includes(c))).toEqual(['stop', 'cp', 'set search.x 7', 'config get search.x', 'cp', 'start', 'stop']);
    expect(JSON.parse(plain.stdout)).toEqual([]);
    expect(JSON.parse(configured.stdout)).toEqual([{ key: 'search.x', value: '7', read_back: '7' }]);
  }, 60_000);
});
