// C4's mechanism count for v0.3 tasks, keyless: for each cell and each task whose task.toml carries a
// [mechanism] table, how often a gbrain read in the consumer turn (the task's last turn) returned the fact the live
// ingestion wrote from the needed turn's post, and, for corrections, returned it ahead of the superseded post.
// scripts/memory-fix-mechanism.ts (gbrain-memory-fix-2026-10b's two hard-coded tasks) is unchanged.
//
//   bun scripts/v03/mechanism.ts --results <run results dir> --tasks <task tree, e.g. tasks/multiuser/v0.3/dev> [--world <world.json>] [--out <dir>]
//
// --world is the world the tasks ran against (default world/seed/world.json, the public world). A task channel the world
// does not hold stops the count with MECH-CHANNEL-UNKNOWN instead of counting zero.
//
// A read is a gbrain.search, gbrain.query or gbrain.recall the tap recorded; its saved facts are effect.facts in the
// order gbrain returned them, each mapped to the message it was ingested from through its gbrain.ingest event
// (scripts/recall-audit.ts ingestedFacts). A post is identified by its author, its conversation (a channel id, or the
// author's private source for a DM turn) and its order among that author's posts there.
//
// internal-task (QM M1): --provider-aware adds a second table, for runs whose tap had upstream.provider set (gbrain-tap.ts): per
// task and cell, the consumer turn's QM memory-provider recalls with non-empty delivered text, the model's memory searches
// through the provider (QM's memory tool on the provider's credential), each with whether it returned the needed fact
// (effect.delivery.returned: in the text QM takes from the result, never a fact only in gbrain's _meta) and whether the fact reached QM's turn (effect.delivery.facts; an upper bound for a search; not delivered
// when the match was too large to run, counted apart), and its model-initiated gbrain calls with whether gbrain returned the
// needed fact (effect.returned_by_gbrain; an upper bound, since QM may cut a tool result before the model sees it). A run
// whose gbrain events carry no caller stops with
// MECH-CALLER-MISSING (in a run where some trial's events carry it, a trial with no caller and no OAuth event, another
// cell's, counts its gbrain calls as the model's), and one whose provider reads carry no recall or query provider_op (the tap had no max_chars_arg) with
// MECH-PROVIDER-OP-UNKNOWN, and one with gbrain calls but no member-scoped turn (no gbrain.requester event with a member, so
// no consumer turn to count in) with MECH-TURNS-MISSING, instead of counting zero. The consumer turn ends at the runner's
// requester reset after the last turn, so a provider call QM makes after it is not counted. Without the flag the output is
// byte-identical to the script before this change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTask, type Task } from '../../runner/grade/task.ts';
import { ingestedFacts, turnStarts } from '../recall-audit.ts';

type Ev = Parameters<typeof ingestedFacts>[0][number];

const READS = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall']);

export interface MechRow { cell: string; task: string; trials: number; passes: number; consumer_read: number; returned_needed: number; needed_ahead: number | null; provider?: ProviderMech }

/** internal-task: the provider-aware columns, present only under --provider-aware. Counts of trials, except provider_recalls,
 *  provider_searches, provider_delivery_unknown and model_calls, which count calls in the consumer turn summed over trials.
 *  QM calls the provider once per readable scope (src/memory/cross-scope.ts), so one recall or search is several calls.
 *  model_returned_by_gbrain_needed is an upper bound: gbrain returned the fact, and QM may cut it before the model sees it. */
export interface ProviderMech {
  provider_recall: number; provider_recalls: number; provider_returned_needed: number; provider_delivered_needed: number;
  provider_search: number; provider_searches: number; provider_search_returned_needed: number; provider_search_delivered_needed: number;
  provider_delivery_unknown: number;
  model_read: number; model_calls: number; model_returned_by_gbrain_needed: number;
}

type Fact = ReturnType<typeof ingestedFacts>[number];

/** The ingested fact written from a task turn's post, if the live ingestion wrote one. */
export function factOfTurn(task: Task, turn: number, facts: Fact[], channelIds: Map<string, string>): Fact | undefined {
  const t = task.turns[turn - 1];
  if (!t) return undefined;
  const same = (x: { actor: string; channel: string }) => x.actor === t.actor && x.channel === t.channel;
  const order = task.turns.slice(0, turn - 1).filter(same).length;
  const mine = facts.filter((f) => f.author === t.actor && (t.channel === 'dm' ? f.source === 'private-' + t.actor : f.channel === channelIds.get(t.channel))).sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  return mine[order];
}

export function trialMechanism(task: Task, events: Ev[], channelIds: Map<string, string>): { read: boolean; needed: boolean; ahead: boolean | null } {
  const m = task.mechanism!;
  const facts = ingestedFacts(events);
  const needed = factOfTurn(task, m.needed_turn, facts, channelIds);
  const superseded = m.superseded_turn ? factOfTurn(task, m.superseded_turn, facts, channelIds) : undefined;
  const starts = turnStarts(events);
  const last = task.turns.length;
  let read = false, got = false, ahead = false;
  for (const e of events) {
    if (!READS.has(e.tool) || e.via !== 'gbrain') continue;
    if (starts.filter((s) => s < e.seq).length !== last) continue;
    read = true;
    const ids = ((e.effect?.facts as Array<{ id: number | string }> | undefined) ?? []).map((f) => String(f.id));
    const i = needed ? ids.indexOf(needed.id) : -1;
    if (i < 0) continue;
    got = true;
    const j = superseded ? ids.indexOf(superseded.id) : -1;
    if (j < 0 || j > i) ahead = true;
  }
  return { read, needed: got, ahead: m.superseded_turn ? ahead : null };
}

/** internal-task: one trial's provider-aware count. Provider recalls are the provider client's per-turn recalls (provider_op
 *  recall), counted when QM delivered non-empty text; provider searches are the model's memory searches on the provider's
 *  credential (provider_op query), every call counted except one QM dropped for its timeout. Every event, of every kind, is
 *  assigned to a turn by its log seq, which the tap sets when gbrain answers, so a late answer can move any call across the
 *  consumer-turn boundary into a later turn; a provider call that failed, that QM dropped
 *  (effect.delivery.dropped) or that handed QM no text (delivered_chars 0) counts as neither returned nor delivered. A provider
 *  read returned the needed fact only when it is in the text QM takes from the result (effect.delivery.returned); a fact that
 *  gbrain listed only in _meta never reaches QM and is not counted.
 *  Model calls are every other gbrain tools/call, and only the model's reads (search, query, recall) that succeeded can
 *  return the needed fact; that it was returned by gbrain is an upper bound on what the model saw. */
export function trialProviderMechanism(task: Task, events: Ev[], channelIds: Map<string, string>, o: { untaggedIsModel?: boolean } = {}): {
  provider_recalls: number; provider_returned: boolean; provider_delivered: boolean;
  provider_searches: number; provider_search_returned: boolean; provider_search_delivered: boolean;
  provider_delivery_unknown: number;
  model_calls: number; model_read: boolean; model_returned_by_gbrain: boolean;
} {
  const needed = factOfTurn(task, task.mechanism!.needed_turn, ingestedFacts(events), channelIds);
  const starts = turnStarts(events);
  const last = task.turns.length;
  const end = events.find((e) => e.tool === 'gbrain.requester' && !(e.args as { member?: unknown })?.member && starts.length > 0 && e.seq > starts[starts.length - 1]!)?.seq ?? Infinity;
  const out = { provider_recalls: 0, provider_returned: false, provider_delivered: false, provider_searches: 0, provider_search_returned: false, provider_search_delivered: false, provider_delivery_unknown: 0, model_calls: 0, model_read: false, model_returned_by_gbrain: false };
  // A trial with no caller on any gbrain event and no OAuth event ran without a provider block (another cell of a mixed run);
  // with untaggedIsModel its gbrain calls are the model's. A trial that shows either carries the split and needs it whole.
  const tagged = events.some((e) => e.via === 'oauth' || (e.via === 'gbrain' && (e as { caller?: unknown }).caller !== undefined));
  for (const e of events as Array<Ev & { caller?: unknown; kind?: unknown; provider_op?: unknown }>) {
    if (e.via !== 'gbrain') continue;
    const caller = e.caller ?? (o.untaggedIsModel && !tagged ? 'model' : undefined);
    if (caller !== 'provider' && caller !== 'model') throw new Error('MECH-CALLER-MISSING');
    if (e.tool === 'gbrain.initialize' || e.tool === 'gbrain.tools/list') continue;
    if (caller === 'provider' && e.kind === 'read' && e.provider_op !== 'recall' && e.provider_op !== 'query') throw new Error('MECH-PROVIDER-OP-UNKNOWN');
    if (!starts.length) throw new Error('MECH-TURNS-MISSING');
    if (e.seq > end || starts.filter((s) => s < e.seq).length !== last) continue;
    const facts = (e.effect?.facts as Array<{ id?: number | string }> | undefined) ?? [];
    const delivery = e.effect?.delivery as { delivered_chars?: number; facts?: boolean[]; returned?: boolean[]; dropped?: string; match?: string } | undefined;
    const hits = needed ? facts.flatMap((f, j) => (String(f.id) === needed.id ? [j] : [])) : [];
    const delivered = hits.some((j) => delivery?.facts?.[j] === true);
    const returned = hits.some((j) => delivery?.returned?.[j] === true);
    if (caller === 'provider') {
      if (e.kind !== 'read') continue;
      if (e.provider_op === 'query' && delivery?.dropped !== 'timeout') out.provider_searches++;
      if (e.outcome !== 'ok' || delivery?.dropped || !((delivery?.delivered_chars ?? 0) > 0)) continue;
      if (delivery?.match === 'unknown') out.provider_delivery_unknown++;
      if (e.provider_op === 'query') {
        if (returned) out.provider_search_returned = true;
        if (delivered) out.provider_search_delivered = true;
        continue;
      }
      out.provider_recalls++;
      if (returned) out.provider_returned = true;
      if (delivered) out.provider_delivered = true;
      continue;
    }
    out.model_calls++;
    if (!READS.has(e.tool)) continue;
    out.model_read = true;
    if (e.outcome !== 'ok' || !needed) continue;
    if (e.caller === undefined ? hits.length > 0 : (e.effect?.returned_by_gbrain as Array<number | string> | undefined)?.some((id) => String(id) === needed.id)) out.model_returned_by_gbrain = true;
  }
  return out;
}

export function mechanism(resultsDir: string, tasksDir: string, channelIds: Map<string, string>, opts: { providerAware?: boolean } = {}): MechRow[] {
  const records = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { cell: string; task: string; trial_id: string; grade: string });
  const tasks = new Map<string, Task | null>();
  const rows = new Map<string, MechRow>();
  const eventsPath = (rec: { cell: string; task: string; trial_id: string }) => join(resultsDir, 'trials', rec.cell, rec.task, rec.trial_id.split('/').pop()!, 'events.jsonl');
  // A run where some trial's tap tagged callers (a provider cell beside other cells): untagged trials there are model-only.
  const runTagged = !!opts.providerAware && records.some((rec) => existsSync(eventsPath(rec)) && readFileSync(eventsPath(rec), 'utf8').includes('"caller":'));
  for (const rec of records) {
    if (!tasks.has(rec.task)) tasks.set(rec.task, existsSync(join(tasksDir, rec.task, 'task.toml')) ? loadTask(join(tasksDir, rec.task)) : null);
    const task = tasks.get(rec.task);
    if (!task?.mechanism) continue;
    if (task.turns.some((t) => t.channel !== 'dm' && !channelIds.has(t.channel))) throw new Error('MECH-CHANNEL-UNKNOWN');
    const key = rec.task + '\t' + rec.cell;
    const row = rows.get(key) ?? { cell: rec.cell, task: rec.task, trials: 0, passes: 0, consumer_read: 0, returned_needed: 0, needed_ahead: task.mechanism.superseded_turn ? 0 : null };
    rows.set(key, row);
    const path = eventsPath(rec);
    if (opts.providerAware && !existsSync(path)) throw new Error('MECH-EVENTS-MISSING');
    const events = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev) : [];
    const c = trialMechanism(task, events, channelIds);
    row.trials++;
    if (rec.grade === 'pass') row.passes++;
    if (c.read) row.consumer_read++;
    if (c.needed) row.returned_needed++;
    if (c.ahead && row.needed_ahead !== null) row.needed_ahead++;
    if (!opts.providerAware) continue;
    const p = trialProviderMechanism(task, events, channelIds, { untaggedIsModel: runTagged });
    const q = row.provider ??= { provider_recall: 0, provider_recalls: 0, provider_returned_needed: 0, provider_delivered_needed: 0, provider_search: 0, provider_searches: 0, provider_search_returned_needed: 0, provider_search_delivered_needed: 0, provider_delivery_unknown: 0, model_read: 0, model_calls: 0, model_returned_by_gbrain_needed: 0 };
    if (p.provider_recalls) q.provider_recall++;
    q.provider_recalls += p.provider_recalls;
    if (p.provider_returned) q.provider_returned_needed++;
    if (p.provider_delivered) q.provider_delivered_needed++;
    if (p.provider_searches) q.provider_search++;
    q.provider_searches += p.provider_searches;
    if (p.provider_search_returned) q.provider_search_returned_needed++;
    if (p.provider_search_delivered) q.provider_search_delivered_needed++;
    q.provider_delivery_unknown += p.provider_delivery_unknown;
    if (p.model_read) q.model_read++;
    q.model_calls += p.model_calls;
    if (p.model_returned_by_gbrain) q.model_returned_by_gbrain_needed++;
  }
  return [...rows.values()].sort((a, b) => a.task.localeCompare(b.task) || a.cell.localeCompare(b.cell));
}

export function markdown(rows: MechRow[]): string {
  const of = (n: number, r: MechRow) => n + ' of ' + r.trials;
  const L = ['| task | cell | passes | consumer turn read gbrain | a read returned the needed fact | needed fact ahead of the superseded one |', '|---|---|---:|---:|---:|---:|'];
  for (const r of rows) L.push('| ' + [r.task, r.cell, of(r.passes, r), of(r.consumer_read, r), of(r.returned_needed, r), r.needed_ahead === null ? 'n/a' : of(r.needed_ahead, r)].join(' | ') + ' |');
  if (rows.some((r) => r.provider)) {
    L.push('', 'Consumer turn by caller: QM\'s per-turn provider recall, the model\'s memory search through the provider, and the model\'s own gbrain calls. Calls columns count calls summed over trials; the rest count trials. Search delivery is an upper bound, and so is the model column: gbrain returned the fact, and QM may cut a tool result before the model sees it. A provider read whose match was too large to run counts as not delivered and in the unknown column.', '');
    L.push('| task | cell | provider recall with text | provider recalls with text (calls, one per readable scope) | provider returned the needed fact | provider delivered it | model memory search via provider | memory searches via provider (calls, one per readable scope) | search returned the needed fact | search delivered it | provider delivery unknown (calls) | model gbrain read | model gbrain calls | gbrain returned the needed fact to a model read (upper bound) |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      const p = r.provider;
      if (!p) continue;
      L.push('| ' + [r.task, r.cell, of(p.provider_recall, r), p.provider_recalls, of(p.provider_returned_needed, r), of(p.provider_delivered_needed, r), of(p.provider_search, r), p.provider_searches, of(p.provider_search_returned_needed, r), of(p.provider_search_delivered_needed, r), p.provider_delivery_unknown, of(p.model_read, r), p.model_calls, of(p.model_returned_by_gbrain_needed, r)].join(' | ') + ' |');
    }
  }
  return L.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const results = arg('results'), tasksDir = arg('tasks');
  if (!results || !tasksDir) { console.error('usage: bun scripts/v03/mechanism.ts --results <dir> --tasks <dir> [--world <world.json>] [--out <dir>] [--provider-aware]'); process.exit(1); }
  const world = JSON.parse(readFileSync(arg('world') ?? join(import.meta.dir, '..', '..', 'world', 'seed', 'world.json'), 'utf8')) as { channels: Array<{ name: string; id: string }> };
  let rows: MechRow[];
  try { rows = mechanism(results, tasksDir, new Map(world.channels.map((c) => [c.name, c.id])), argv.includes('--provider-aware') ? { providerAware: true } : {}); } catch (e) {
    if ((e as Error).message === 'MECH-CALLER-MISSING') {
      console.error('mechanism: error MECH-CALLER-MISSING (a gbrain event carries no caller; --provider-aware needs a run whose tap had upstream.provider set)');
      process.exit(1);
    }
    if ((e as Error).message === 'MECH-EVENTS-MISSING') {
      console.error('mechanism: error MECH-EVENTS-MISSING (a scored trial has no events.jsonl; --provider-aware counts nothing it cannot see)');
      process.exit(1);
    }
    if ((e as Error).message === 'MECH-TURNS-MISSING') {
      console.error('mechanism: error MECH-TURNS-MISSING (a scored trial has gbrain calls but no member-scoped turn; provider cells must run with upstream tokens or grants)');
      process.exit(1);
    }
    if ((e as Error).message === 'MECH-PROVIDER-OP-UNKNOWN') {
      console.error('mechanism: error MECH-PROVIDER-OP-UNKNOWN (a provider read is neither recall nor query; set upstream.provider.max_chars_arg to the provider\'s maxCharsArg)');
      process.exit(1);
    }
    if ((e as Error).message !== 'MECH-CHANNEL-UNKNOWN') throw e;
    console.error('mechanism: error MECH-CHANNEL-UNKNOWN (pass --world with the world the tasks ran against)');
    process.exit(1);
  }
  const md = markdown(rows);
  const out = arg('out');
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'mechanism.json'), JSON.stringify(rows, null, 2) + '\n'); writeFileSync(join(out, 'mechanism.md'), md); }
  process.stdout.write(md);
}
