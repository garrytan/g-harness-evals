// A re-reading of gbrain-memory-2026-10 (internal-task): did gbrain give the harness back the fact the task needed, when the brain
// held it and the requester's grant could read it?
//
//   bun scripts/recall-audit.ts [--results docs/benchmarks/2026-10-26-gbrain-memory/results] [--out <dir>]
//
// Reads only the counted receipts (trials.jsonl, each live trial's events.jsonl and grade.json, turns.jsonl, and
// hot-memory-blocks.json) and the world seed; writes calls.jsonl (one row per gbrain read in a live cell), turns.jsonl (one row
// per live trial and consumer turn), summary.json and summary.md into --out (default docs/benchmarks/2026-10-26-gbrain-memory/
// recall-rereading). Nothing under results/ is written.
//
// A "consumer turn" is a turn whose predicate needs something said earlier in the scenario and written into the brain by the
// live ingestion (NEEDS below, one entry per task turn; tasks whose answers come only from the seeded pages, and the mirror
// turns where the right answer is to withhold, have none). For each consumer turn the needed facts are the ingested facts
// (gbrain.ingest events with outcome ok, earlier in the event log than the read) whose message text matches the entry's
// pattern, from the conversation of the named scenario turn(s) or, for "any", from any conversation; a fact is readable when its
// source is in the requesting member's grant (gbrain/build-brain.ts companyGrants over the member brain's sources, the grants
// the image minted tokens for). The bot's own acknowledgement restating the fact counts as a needed fact: it is in the brain
// and carries the same information.
//
// Two oracles, both per call: "original fact returned" (a member's own message carrying the fact came back) and "information
// returned (original or a correct assistant restatement)" (the original or a bot message restating it came back); recall hit,
// miss and the turn outcomes use the second, recall_original the first.
//
// What a read returned: the saved facts the world's tap recorded (effect.facts, by fact id); the tap does not record gbrain's
// _meta.brain_hot_memory block, so for Hermes the block is read from hot-memory-blocks.json (counts per call, no ids) and the
// needed fact is inferred present only when the block's member-authored and bot-authored counts equal what the requester's
// private source held at that moment. For OpenClaw and QM the block is not recorded, and their MCP clients build the model's
// tool result from content and structuredContent only, so a block gbrain sent was not shown to the model (README.md, Limits);
// their recall is saved facts only.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { companyGrants, conversationSources, memberPageList, memberSources } from '../gbrain/build-brain.ts';
import type { World } from '../world/types.ts';

export type FactType = 'correction' | 'preference' | 'plain fact';
export interface Need { turn: number; from: number[] | 'any'; pattern: RegExp; type: FactType; predicates: string[]; what: string }

/** The memory each consumer turn needs, read from the sealed task files (tasks/multiuser/v0.2/heldout/<task>/task.toml): the
 *  scenario turn(s) whose message carries it, a pattern over the ingested message text, and the predicates that fail without it. */
export const NEEDS: Record<string, Need[]> = {
  'cn-05-coastal-date-formats': [
    { turn: 3, from: [1], pattern: /3-Nov-2025|three-letter month/i, type: 'preference', predicates: ['bettina_format', 'bettina_not_other_forms'], what: "Bettina's DM: write her dates as 3-Nov-2025" },
    { turn: 4, from: [2], pattern: /03\.11\.2025|day dot month|day\.month\.year/i, type: 'preference', predicates: ['kwame_format', 'kwame_not_other_forms'], what: "Kwame's DM: write his dates as 03.11.2025" },
  ],
  'cn-06-driftmoor-contact-booking': [
    { turn: 3, from: [1], pattern: /wierzbicki/i, type: 'plain fact', predicates: ['notes_name'], what: "Kwame's DM: his Driftmoor night-dispatch contact is Tomasz Wierzbicki" },
  ],
  'cn-08-vantorre-standing-attendee': [
    { turn: 3, from: [1], pattern: /june/i, type: 'preference', predicates: ['booking'], what: "Ruth's DM: include June Osei-Lark in every Vantorre meeting" },
  ],
  'cr-05-pellow-seat-retraction': [
    { turn: 3, from: [2], pattern: /\b46\b/, type: 'correction', predicates: ['answer', 'not_retracted'], what: "Sofia's #coastal-random correction: 46 seats, not 52" },
  ],
  'cr-07-pellucid-owner': [
    { turn: 3, from: [2], pattern: /stays with kwame|pellucid stays|wrong PHL|covering pellow/i, type: 'correction', predicates: ['owner', 'not_retracted'], what: "Bettina's correction: Pellucid stays with Kwame" },
  ],
  'cr-08-orlavine-seat-count': [
    { turn: 2, from: [1], pattern: /\b50\b/, type: 'correction', predicates: ['answer', 'not_retracted'], what: "Gideon's #strategic-pod correction: Orlavine is at 50 seats, not 55" },
  ],
  'ms-05-vantorre-tickets': [
    { turn: 2, from: [1], pattern: /VT-55120/, type: 'plain fact', predicates: ['t2_hartford_ticket'], what: "Gideon's #inc-vtg-hartford post: root-cause ticket VT-55120" },
  ],
  'ar-04-mateo-hartford-mail': [
    { turn: 3, from: 'any', pattern: /mateo/i, type: 'plain fact', predicates: ['draft_created'], what: "Gideon's turn-1 request: the draft mail to Mateo the approval is for" },
  ],
  'ar-05-driftmoor-rate-to-bettina': [
    { turn: 3, from: 'any', pattern: /1,?480/, type: 'plain fact', predicates: ['draft_created'], what: "the Driftmoor rate ($1,480) the approved draft must carry" },
  ],
};

const READ_TOOLS = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall', 'gbrain.get_page', 'gbrain.list_pages', 'gbrain.entity']);

interface Ev { seq: number; actor: string | null; via: string; tool: string; args?: Record<string, unknown>; outcome?: string; effect?: Record<string, unknown>; grant?: string }
interface Fact { id: string; source: string; channel: string; ts: string; author: string; seq: number; text: string }
interface HotCall { seq: number; tool: string; grant: string; hot_memory: null | { source_id: string; facts: number; member_authored: number; bot_authored: number; in_requester_grant: boolean } }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Every fact the live ingestion wrote in one trial, with the message text it was written from (the post with that channel
 *  and ts in the same event log). */
export function ingestedFacts(events: Ev[]): Fact[] {
  const text = new Map<string, string>();
  for (const e of events) {
    const ts = e.effect?.ts, ch = e.effect?.channel ?? e.args?.channel, t = e.args?.text;
    if (typeof ts === 'string' && typeof ch === 'string' && typeof t === 'string') text.set(ch + '/' + ts, t);
  }
  const seen = new Set<string>();
  return events.filter((e) => e.tool === 'gbrain.ingest' && e.outcome === 'ok' && e.effect?.fact_id != null && !seen.has(String(e.effect.fact_id)) && seen.add(String(e.effect.fact_id))).map((e) => {
    const a = e.args as { channel: string; ts: string; author: string; source: string };
    return { id: String(e.effect!.fact_id), source: a.source, channel: a.channel, ts: a.ts, author: a.author, seq: e.seq, text: text.get(a.channel + '/' + a.ts) ?? '' };
  });
}

/** Turn number of every event: the runner's gbrain.requester event with a member opens a turn. */
export function turnStarts(events: Ev[]): number[] {
  return events.filter((e) => e.tool === 'gbrain.requester' && (e.args as { member?: unknown })?.member).map((e) => e.seq);
}
const turnOf = (starts: number[], seq: number) => starts.filter((s) => s < seq).length;

export function queryText(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  for (const k of ['query', 'keyword', 'entity', 'name', 'slug', 'slug_prefix']) if (typeof args[k] === 'string') return String(args[k]);
  return JSON.stringify(args);
}

const pct = (iv: [number, number] | null) => (iv ? '[' + Math.round(100 * iv[0]) + ', ' + Math.round(100 * iv[1]) + ']' : 'n/a (under three tasks)');
const rate = (hit: number, n: number) => (n ? hit + '/' + n + ' (' + Math.round((100 * hit) / n) + '%)' : '0/0');

export function audit(resultsDir: string, worldPath: string) {
  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as World;
  const sources = memberSources(world, 'heldout', memberPageList(world, 'heldout'));
  const grants = Object.fromEntries(companyGrants(world, 'heldout', sources).map((g) => [g.member, new Set(g.sources)]));
  const channelSource = conversationSources(world, 'heldout');
  const channelId = new Map(world.channels.flatMap((c) => [[c.id, c.id], [c.name, c.id], ['#' + c.name, c.id]] as Array<[string, string]>));
  const hot = JSON.parse(readFileSync(join(resultsDir, 'hot-memory-blocks.json'), 'utf8')) as { trials: Array<{ cell: string; task: string; rep: string; calls: HotCall[] }> };
  const hotBy = new Map<string, HotCall>();
  for (const t of hot.trials) for (const c of t.calls) hotBy.set([t.cell, t.task, t.rep, c.seq].join('/'), c);

  const records = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cell: string; task: string; harness: string; model: string; trial_id: string; termination: string; grade: string; predicates: Array<{ id: string; passed: boolean }> });
  const calls: Record<string, unknown>[] = [];
  const turns: Record<string, unknown>[] = [];
  for (const rec of records) {
    if (!rec.cell.includes('gbrain-told-live')) continue;
    const rep = rec.trial_id.split('/').pop()!;
    const dir = join(resultsDir, 'trials', rec.cell, rec.task, rep);
    if (!existsSync(join(dir, 'events.jsonl')) || !existsSync(join(dir, 'turns.jsonl'))) throw new Error('recall-audit: ' + dir + ' has no events.jsonl or turns.jsonl');
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Ev);
    const facts = ingestedFacts(events);
    const starts = turnStarts(events);
    const scenario = readFileSync(join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { turn: number; channel: string; actor: string });
    const family = rec.task.slice(0, 2) === 'cn' ? 'continuity' : rec.task.slice(0, 2) === 'cr' ? 'corrections' : rec.task.slice(0, 2) === 'ms' ? 'synthesis' : 'approval_relay';
    const model = rec.model.includes('haiku') ? 'haiku' : 'sonnet';
    const passed = new Map(rec.predicates.map((p) => [p.id, p.passed]));
    const needs = NEEDS[rec.task] ?? [];
    const needFor = (turn: number) => needs.find((n) => n.turn === turn);
    const neededAt = (need: Need, seq: number) => {
      const chans = need.from === 'any' ? null : new Set(need.from.map((t) => scenario.find((s) => s.turn === t)?.channel).filter(Boolean));
      return facts.filter((f) => f.seq < seq && (!chans || chans.has(f.channel)) && need.pattern.test(f.text));
    };
    const isOriginal = (f: { author: string }) => f.author !== 'assistant';
    const base = { trial: rec.trial_id, cell: rec.cell, harness: rec.harness, model, task: rec.task, family, rep, termination: rec.termination, trial_pass: rec.grade === 'pass' };
    const rowsByTurn = new Map<number, Record<string, unknown>[]>();
    for (const e of events) {
      if (e.via !== 'gbrain' || !READ_TOOLS.has(e.tool)) continue;
      const turn = turnOf(starts, e.seq);
      const need = needFor(turn);
      const grant = e.grant ?? 'public-only';
      const readable = grants[grant] ?? new Set<string>();
      const returned = ((e.effect?.facts as Array<{ id: number | string }> | undefined) ?? []).map((f) => String(f.id));
      const inBrain = need ? neededAt(need, starts[turn - 1]!) : [];
      const neededReadable = inBrain.filter((f) => readable.has(f.source));
      const inFacts = neededReadable.filter((f) => returned.includes(f.id)).map((f) => f.id);
      const originalInFacts = neededReadable.some((f) => isOriginal(f) && returned.includes(f.id));
      const asked = scenario.find((s) => s.turn === turn);
      const currentQuestion = asked ? facts.filter((f) => f.seq > starts[turn - 1]! && f.seq < (starts[turn] ?? Infinity) && f.author === asked.actor && f.channel === asked.channel && returned.includes(f.id)).map((f) => f.id) : [];
      let hm: Record<string, unknown> | null = null;
      let inHot: boolean | null = null;
      let originalInHot = false;
      if (rec.harness === 'hermes') {
        const h = hotBy.get([rec.cell, rec.task, rep, e.seq].join('/'));
        const block = h?.hot_memory ?? null;
        hm = block ? { source_id: block.source_id, facts: block.facts, member_authored: block.member_authored, bot_authored: block.bot_authored } : { source_id: null, facts: 0 };
        const priv = 'private-' + grant;
        const privNeeded = neededReadable.filter((f) => f.source === priv);
        if (!h) inHot = null;
        else if (!privNeeded.length || !block) inHot = false;
        else {
          const held = facts.filter((f) => f.seq < e.seq && f.source === priv);
          const heldMember = held.filter((f) => f.author !== 'assistant').length, heldBot = held.length - heldMember;
          inHot = block.source_id === priv && block.member_authored === heldMember && block.bot_authored === heldBot ? true : null;
          originalInHot = inHot === true && privNeeded.some(isOriginal);
        }
      }
      const row = {
        ...base, seq: e.seq, turn, grant, tool: e.tool.replace('gbrain.', ''), query: queryText(e.args), args: e.args ?? {}, outcome: e.outcome,
        need: need ? need.what : null, fact_type: need ? need.type : null,
        where_fact_lives: need ? (neededReadable.length ? (neededReadable.some((f) => f.source.startsWith('private-')) ? 'dm' : 'channel') : (inBrain.length ? 'unreadable' : 'not in brain')) : null,
        needed_in_brain: inBrain.map((f) => f.id), needed_readable: neededReadable.map((f) => ({ id: f.id, source: f.source, author: f.author, channel: f.channel, ts: f.ts })),
        saved_facts: returned, saved_facts_current_question: currentQuestion, pages: (e.effect?.pages as string[] | undefined) ?? [], needed_in_saved_facts: inFacts,
        hot_memory: hm, needed_in_hot_memory: rec.harness === 'hermes' ? inHot : 'not shown to the model',
        recall: need && neededReadable.length ? (inFacts.length > 0 || inHot === true ? 'hit' : 'miss') : 'n/a',
        recall_original: need && neededReadable.length ? (originalInFacts || originalInHot ? 'hit' : 'miss') : 'n/a',
      };
      calls.push(row);
      if (!rowsByTurn.has(turn)) rowsByTurn.set(turn, []);
      rowsByTurn.get(turn)!.push(row);
    }
    for (const need of needs) {
      const start = starts[need.turn - 1];
      if (start === undefined) { turns.push({ ...base, turn: need.turn, need: need.what, fact_type: need.type, outcome: rec.termination !== 'completed' ? 'excluded (' + rec.termination + ')' : 'turn not run' }); continue; }
      const end = starts[need.turn] ?? Infinity;
      const requester = scenario.find((s) => s.turn === need.turn)?.actor ?? null;
      const readable = grants[requester ?? 'public-only'] ?? new Set<string>();
      const inBrain = neededAt(need, start);
      const neededReadable = inBrain.filter((f) => readable.has(f.source));
      const rows = rowsByTurn.get(need.turn) ?? [];
      const searches = rows.filter((r) => ['search', 'query', 'recall'].includes(String(r.tool)));
      const hit = rows.some((r) => r.recall === 'hit');
      const predOk = need.predicates.every((p) => passed.get(p) === true);
      const chans = need.from === 'any' ? null : new Set(need.from.map((t) => scenario.find((s) => s.turn === t)?.channel));
      const reread = chans ? events.some((e) => e.seq > start && e.seq < end && e.via === 'mcp' && /^conversations\.(history|replies)$/.test(e.tool) && chans.has(channelId.get(String(e.args?.channel ?? '')) ?? String(e.args?.channel ?? ''))) : null;
      const hotUnknown = rec.harness === 'hermes' && rows.some((r) => r.needed_in_hot_memory === null);
      const hotNotShown = rec.harness !== 'hermes' && neededReadable.some((f) => f.source === 'private-' + requester);
      let outcome: string;
      if (rec.termination !== 'completed') outcome = 'excluded (' + rec.termination + ')';
      else if (predOk) outcome = 'needed predicates passed';
      else if (!inBrain.length) outcome = 'fail: not in brain';
      else if (!neededReadable.length) outcome = 'fail: not readable under the grant';
      else if (!rows.length) outcome = 'fail: no gbrain read this turn';
      else if (!hit) outcome = hotUnknown ? 'fail: retrieval miss (saved facts; hot memory not recorded)' : hotNotShown ? 'fail: retrieval miss (saved facts; hot memory not shown to the model)' : 'fail: retrieval miss';
      else outcome = 'fail: returned, predicate still failed';
      turns.push({
        ...base, turn: need.turn, requester, need: need.what, fact_type: need.type, predicates: need.predicates, needed_predicates_passed: predOk,
        where_fact_lives: neededReadable.length ? (neededReadable.some((f) => f.source.startsWith('private-')) ? 'dm' : 'channel') : (inBrain.length ? 'unreadable' : 'not in brain'),
        needed_in_brain: inBrain.map((f) => f.id), needed_readable: neededReadable.map((f) => f.id), gbrain_reads: rows.length, gbrain_searches: searches.length,
        queries: searches.map((r) => r.tool + ': ' + r.query), returned_needed: hit, returned_original: rows.some((r) => r.recall_original === 'hit'), reread_source_conversation: reread, outcome,
      });
    }
  }
  return { calls, turns, grants: Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, [...v]])), channelSource };
}

/** Task-clustered bootstrap interval (95 percent) of a pooled proportion: tasks resampled with replacement, calls kept whole.
 *  Under three tasks there is none: a bootstrap over two tasks can only return the two task rates and their pool. */
export function clusteredInterval(rows: Array<{ task: string; hit: boolean }>, seed = 7, draws = 10000): [number, number] | null {
  const tasks = [...new Set(rows.map((r) => r.task))];
  if (tasks.length < 3) return null;
  const by = tasks.map((t) => { const rs = rows.filter((r) => r.task === t); return [rs.filter((r) => r.hit).length, rs.length] as const; });
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const stats: number[] = [];
  for (let d = 0; d < draws; d++) {
    let h = 0, n = 0;
    for (let i = 0; i < by.length; i++) { const [hh, nn] = by[Math.floor(rand() * by.length)]!; h += hh; n += nn; }
    stats.push(n ? h / n : 0);
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(0.025 * draws)]!, stats[Math.min(draws - 1, Math.floor(0.975 * draws))]!];
}

/** The recall rung's case list (scripts/gbrain-check.ts --rungs recall): every search, query or recall at a consumer turn with
 *  a readable needed fact, kind miss or control by the information oracle and original_returned by the original-fact oracle, each
 *  with the receipt it replays, the requester's message at the consumer turn (question) and every readable needed fact: needed_ids
 *  the originals (a member's own message), restatement_ids the accepted assistant restatements, both as fact ids of the counted
 *  run's sidecar, and needed each fact's channel, ts, author and source. */
export function recallCases(calls: Record<string, unknown>[], resultsDir: string) {
  const root = resolve('.');
  const scenarios = new Map<string, Array<{ turn: number; text: string }>>();
  const questionOf = (dir: string, turn: number) => {
    if (!scenarios.has(dir)) scenarios.set(dir, readFileSync(join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    return scenarios.get(dir)!.find((s) => s.turn === turn)?.text ?? null;
  };
  return {
    source: 'bun scripts/recall-audit.ts --cases <this file>: generated from the gbrain-memory-2026-10 receipts; kind miss means the counted run did not return the needed information (the original fact or a correct assistant restatement), kind control means it did; original_returned says whether the original fact came back',
    cases: calls.filter((c) => c.recall !== 'n/a' && ['search', 'query', 'recall'].includes(String(c.tool))).map((c) => {
      const readable = c.needed_readable as Array<{ id: string; source: string; author: string; channel: string; ts: string }>;
      const dir = join(resultsDir, 'trials', String(c.cell), String(c.task), String(c.rep));
      return { id: String(c.trial).replace('gbrain-memory-2026-10/', '') + '#' + c.seq, kind: c.recall === 'hit' ? 'control' : 'miss', original_returned: c.recall_original === 'hit', task: c.task, harness: c.harness, model: c.model, fact_type: c.fact_type, turn: c.turn, grant: c.grant, tool: c.tool, args: c.args,
        events: join(dir, 'events.jsonl').replace(root + '/', ''), seq: c.seq, question: questionOf(dir, Number(c.turn)),
        needed_ids: readable.filter((f) => f.author !== 'assistant').map((f) => f.id), restatement_ids: readable.filter((f) => f.author === 'assistant').map((f) => f.id),
        needed: readable.map((f) => ({ id: f.id, channel: f.channel, ts: f.ts, author: f.author, source: f.source })) };
    }),
  };
}

function group<T extends Record<string, unknown>>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function summarize(calls: Record<string, unknown>[], turns: Record<string, unknown>[]) {
  const eligible = calls.filter((c) => c.recall !== 'n/a');
  const searchEligible = eligible.filter((c) => ['search', 'query', 'recall'].includes(String(c.tool)));
  const byDims: Record<string, Array<{ group: string; calls: number; tasks: number; original_hits: number; original_interval: [number, number] | null; saved_facts_hits: number; hot_memory_hits: number; any_hits: number; any_interval: [number, number] | null }>> = {};
  const interval = (rs: Record<string, unknown>[], key: string) => clusteredInterval(rs.map((r) => ({ task: String(r.task), hit: r[key] === 'hit' })));
  const dims: Record<string, (r: Record<string, unknown>) => string> = {
    family: (r) => String(r.family), tool: (r) => String(r.tool), fact_type: (r) => String(r.fact_type), where_fact_lives: (r) => String(r.where_fact_lives),
    model: (r) => String(r.model), harness_model: (r) => r.harness + ' ' + r.model, task: (r) => String(r.task),
  };
  for (const [name, f] of Object.entries(dims)) byDims[name] = group(searchEligible, f).map(([g, rs]) => ({ group: g, calls: rs.length, tasks: new Set(rs.map((r) => r.task)).size, original_hits: rs.filter((r) => r.recall_original === 'hit').length, original_interval: name === 'task' ? null : interval(rs, 'recall_original'), any_interval: name === 'task' ? null : interval(rs, 'recall'), saved_facts_hits: rs.filter((r) => (r.needed_in_saved_facts as string[]).length > 0).length, hot_memory_hits: rs.filter((r) => r.needed_in_hot_memory === true).length, any_hits: rs.filter((r) => r.recall === 'hit').length }));
  const scored = turns.filter((t) => !String(t.outcome).startsWith('excluded') && t.outcome !== 'turn not run');
  const outcomes = group(scored, (t) => String(t.outcome)).map(([k, rs]) => ({ outcome: k, turns: rs.length }));
  const outcomesBy = (f: (t: Record<string, unknown>) => string) => group(scored, f).map(([g, rs]) => ({ group: g, ...Object.fromEntries(group(rs, (t) => String(t.outcome)).map(([o, x]) => [o, x.length])) }));
  const misses = searchEligible.filter((r) => r.recall === 'miss');
  const missesWithFacts = misses.filter((r) => (r.saved_facts as string[]).length > 0);
  return {
    oracles: {
      original: { name: 'original fact returned', means: 'a member\'s own message carrying the needed fact came back', fields: 'recall_original, original_hits' },
      information: { name: 'information returned (original or a correct assistant restatement)', means: 'the original or a bot message restating the fact came back', fields: 'recall, any_hits' },
    },
    overall: { calls: searchEligible.length, tasks: new Set(searchEligible.map((r) => r.task)).size, original_hits: searchEligible.filter((r) => r.recall_original === 'hit').length, original_interval: interval(searchEligible, 'recall_original'), saved_facts_hits: searchEligible.filter((r) => (r.needed_in_saved_facts as string[]).length > 0).length, any_hits: searchEligible.filter((r) => r.recall === 'hit').length, any_interval: interval(searchEligible, 'recall') },
    misses: { calls: misses.length, returned_saved_facts: missesWithFacts.length, current_question_among_them: missesWithFacts.filter((r) => (r.saved_facts_current_question as string[]).length > 0).length, only_the_current_question: missesWithFacts.filter((r) => (r.saved_facts as string[]).every((id) => (r.saved_facts_current_question as string[]).includes(id))).length },
    reads: calls.length, reads_by_tool: Object.fromEntries(group(calls, (c) => String(c.tool)).map(([k, v]) => [k, v.length])),
    reads_at_consumer_turns_with_readable_fact: eligible.length, search_query_recall_with_readable_fact: searchEligible.length,
    recall: byDims, consumer_turns: scored.length, outcomes, outcomes_by_task: outcomesBy((t) => String(t.task)), outcomes_by_harness_model: outcomesBy((t) => t.harness + ' ' + t.model),
  };
}

export function markdown(s: ReturnType<typeof summarize>, turns: Record<string, unknown>[]): string {
  const L: string[] = [];
  L.push('# Recall re-reading of gbrain-memory-2026-10: derived tables', '', 'Generated by `bun scripts/recall-audit.ts` from the counted receipts under `../results/`. Not a counted result; see README.md for the definitions and limits.', '');
  L.push('gbrain reads in the six live cells: ' + s.reads + ' (' + Object.entries(s.reads_by_tool).map(([k, v]) => v + ' ' + k).join(', ') + '). Reads at a consumer turn while the needed fact was in the brain and readable under the requester\'s grant: ' + s.reads_at_consumer_turns_with_readable_fact + ', of which search, query or recall: ' + s.search_query_recall_with_readable_fact + '.', '', 'Recall over those ' + s.overall.calls + ' calls (' + s.overall.tasks + ' tasks), by two oracles. ' + s.oracles.original.name[0]!.toUpperCase() + s.oracles.original.name.slice(1) + ' (' + s.oracles.original.means + '): ' + rate(s.overall.original_hits, s.overall.calls) + ', ' + pct(s.overall.original_interval) + ' task-clustered. ' + s.oracles.information.name[0]!.toUpperCase() + s.oracles.information.name.slice(1) + ': ' + rate(s.overall.any_hits, s.overall.calls) + ', ' + pct(s.overall.any_interval) + ' task-clustered, in saved facts or (Hermes, inferred) hot memory; ' + rate(s.overall.saved_facts_hits, s.overall.calls) + ' in saved facts alone. OpenClaw and QM do not show the hot-memory block to the model, so their recall is saved facts only.', '');
  L.push('Of the ' + s.misses.calls + ' calls that missed (information oracle), ' + s.misses.returned_saved_facts + ' returned saved facts; ' + s.misses.current_question_among_them + ' of those included the asker\'s own current message, and in ' + s.misses.only_the_current_question + ' it was the only fact returned.', '');
  for (const [dim, rows] of Object.entries(s.recall)) {
    L.push('## Recall per call by ' + dim.replace(/_/g, ' '), '', '| ' + dim + ' | calls (tasks) | original fact returned | original, task-clustered 95% interval | information in saved facts | information in hot memory (Hermes, inferred) | information returned (original or restatement) | information, task-clustered 95% interval |', '|---|---:|---:|---|---:|---:|---:|---|');
    for (const r of rows) L.push('| ' + r.group + ' | ' + r.calls + ' (' + r.tasks + ') | ' + rate(r.original_hits, r.calls) + ' | ' + pct(r.original_interval) + ' | ' + rate(r.saved_facts_hits, r.calls) + ' | ' + r.hot_memory_hits + ' | ' + rate(r.any_hits, r.calls) + ' | ' + pct(r.any_interval) + ' |');
    L.push('');
  }
  L.push('## Consumer turns by outcome (' + s.consumer_turns + ' turns in completed live trials)', '', '| outcome | turns |', '|---|---:|');
  for (const o of s.outcomes) L.push('| ' + o.outcome + ' | ' + o.turns + ' |');
  L.push('');
  const cols = [...new Set(s.outcomes.map((o) => o.outcome))];
  for (const [title, rows] of [['task', s.outcomes_by_task], ['harness and model', s.outcomes_by_harness_model]] as const) {
    L.push('## Consumer-turn outcomes by ' + title, '', '| ' + title + ' | ' + cols.join(' | ') + ' |', '|---|' + cols.map(() => '---:').join('|') + '|');
    for (const r of rows) L.push('| ' + r.group + ' | ' + cols.map((c) => String((r as Record<string, unknown>)[c] ?? 0)).join(' | ') + ' |');
    L.push('');
  }
  L.push('## Every failing consumer turn with a readable needed fact', '', '| trial | turn | outcome | gbrain searches (tool: query) | re-read the source conversation |', '|---|---:|---|---|---|');
  for (const t of turns.filter((t) => String(t.outcome).startsWith('fail') && (t.needed_readable as string[] | undefined)?.length)) {
    L.push('| ' + String(t.trial).replace('gbrain-memory-2026-10/', '') + ' | ' + t.turn + ' | ' + String(t.outcome).replace('fail: ', '') + ' | ' + ((t.queries as string[]).map((q) => q.replace(/\|/g, '/')).join('; ') || 'none') + ' | ' + (t.reread_source_conversation === null ? 'n/a' : t.reread_source_conversation ? 'yes' : 'no') + ' |');
  }
  L.push('');
  return L.join('\n');
}

if (import.meta.main) {
  const results = resolve(arg('results', 'docs/benchmarks/2026-10-26-gbrain-memory/results')!);
  const out = resolve(arg('out', join(results, '..', 'recall-rereading'))!);
  const { calls, turns } = audit(results, resolve('world/seed/world.json'));
  const summary = summarize(calls, turns);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'calls.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(join(out, 'turns.jsonl'), turns.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  writeFileSync(join(out, 'summary.md'), markdown(summary, turns));
  const casesPath = arg('cases');
  if (casesPath) writeFileSync(resolve(casesPath), JSON.stringify(recallCases(calls, results), null, 1) + '\n');
  console.log('recall-audit: ' + calls.length + ' gbrain reads, ' + turns.length + ' consumer turns -> ' + out);
}
