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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTask, type Task } from '../../runner/grade/task.ts';
import { ingestedFacts, turnStarts } from '../recall-audit.ts';

type Ev = Parameters<typeof ingestedFacts>[0][number];

const READS = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall']);

export interface MechRow { cell: string; task: string; trials: number; passes: number; consumer_read: number; returned_needed: number; needed_ahead: number | null }

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

export function mechanism(resultsDir: string, tasksDir: string, channelIds: Map<string, string>): MechRow[] {
  const records = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { cell: string; task: string; trial_id: string; grade: string });
  const tasks = new Map<string, Task | null>();
  const rows = new Map<string, MechRow>();
  for (const rec of records) {
    if (!tasks.has(rec.task)) tasks.set(rec.task, existsSync(join(tasksDir, rec.task, 'task.toml')) ? loadTask(join(tasksDir, rec.task)) : null);
    const task = tasks.get(rec.task);
    if (!task?.mechanism) continue;
    if (task.turns.some((t) => t.channel !== 'dm' && !channelIds.has(t.channel))) throw new Error('MECH-CHANNEL-UNKNOWN');
    const key = rec.task + '\t' + rec.cell;
    const row = rows.get(key) ?? { cell: rec.cell, task: rec.task, trials: 0, passes: 0, consumer_read: 0, returned_needed: 0, needed_ahead: task.mechanism.superseded_turn ? 0 : null };
    rows.set(key, row);
    const path = join(resultsDir, 'trials', rec.cell, rec.task, rec.trial_id.split('/').pop()!, 'events.jsonl');
    const events = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev) : [];
    const c = trialMechanism(task, events, channelIds);
    row.trials++;
    if (rec.grade === 'pass') row.passes++;
    if (c.read) row.consumer_read++;
    if (c.needed) row.returned_needed++;
    if (c.ahead && row.needed_ahead !== null) row.needed_ahead++;
  }
  return [...rows.values()].sort((a, b) => a.task.localeCompare(b.task) || a.cell.localeCompare(b.cell));
}

export function markdown(rows: MechRow[]): string {
  const of = (n: number, r: MechRow) => n + ' of ' + r.trials;
  const L = ['| task | cell | passes | consumer turn read gbrain | a read returned the needed fact | needed fact ahead of the superseded one |', '|---|---|---:|---:|---:|---:|'];
  for (const r of rows) L.push('| ' + [r.task, r.cell, of(r.passes, r), of(r.consumer_read, r), of(r.returned_needed, r), r.needed_ahead === null ? 'n/a' : of(r.needed_ahead, r)].join(' | ') + ' |');
  return L.join('\n') + '\n';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const results = arg('results'), tasksDir = arg('tasks');
  if (!results || !tasksDir) { console.error('usage: bun scripts/v03/mechanism.ts --results <dir> --tasks <dir> [--world <world.json>] [--out <dir>]'); process.exit(1); }
  const world = JSON.parse(readFileSync(arg('world') ?? join(import.meta.dir, '..', '..', 'world', 'seed', 'world.json'), 'utf8')) as { channels: Array<{ name: string; id: string }> };
  let rows: MechRow[];
  try { rows = mechanism(results, tasksDir, new Map(world.channels.map((c) => [c.name, c.id]))); } catch (e) {
    if ((e as Error).message !== 'MECH-CHANNEL-UNKNOWN') throw e;
    console.error('mechanism: error MECH-CHANNEL-UNKNOWN (pass --world with the world the tasks ran against)');
    process.exit(1);
  }
  const md = markdown(rows);
  const out = arg('out');
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'mechanism.json'), JSON.stringify(rows, null, 2) + '\n'); writeFileSync(join(out, 'mechanism.md'), md); }
  process.stdout.write(md);
}
