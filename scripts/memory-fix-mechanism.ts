// The mechanism counts of gbrain-memory-fix-2026-10b's secondary endpoints 2 and 3, keyless: for each live cell, what
// the brain returned to the harness on `cr-05-pellow-seat-retraction` and `cn-05-coastal-date-formats`.
//
//   bun scripts/memory-fix-mechanism.ts [--results docs/benchmarks/2026-10-26-gbrain-memory/results] [--out <dir>]
//
// Reads only trials.jsonl, each live trial's events.jsonl and the world seed; prints the Markdown tables and, with --out, writes
// mechanism.json and mechanism.md there. Nothing under --results is written. A read is a `gbrain.search`, `gbrain.query` or
// `gbrain.recall` call the tap recorded; its saved facts are `effect.facts` in the order gbrain returned them, each mapped to the
// message it was ingested from through its `gbrain.ingest` event (scripts/recall-audit.ts `ingestedFacts`).
//
// cr-05: the correction is the fact ingested from Sofia's post in #coastal-random, the retracted figure the fact ingested from her
// post in #coastal-team. A read returns the correction ahead of the retracted post when the correction is among its saved facts
// and the retracted fact is absent from that read or listed after it.
// cn-05: a read returns the asker's DM preference when one of its saved facts was ingested from a direct message the requester
// (the read's grant) wrote, into their own `private-<member>` source, and carries a date-format preference (recall-audit `NEEDS`).
// A read that ended in an error counts as a read (it returns no fact); each "of N" counts every trial of the cell in trials.jsonl.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { World } from '../world/types.ts';
import { ingestedFacts, NEEDS, queryText } from './recall-audit.ts';

export const CR05 = 'cr-05-pellow-seat-retraction';
export const CN05 = 'cn-05-coastal-date-formats';
const READS = new Set(['gbrain.search', 'gbrain.query', 'gbrain.recall']);
const CORRECTION = { author: 'sofia-marchetti', channel: 'coastal-random' };
const RETRACTED = { author: 'sofia-marchetti', channel: 'coastal-team' };

export type Ev = Parameters<typeof ingestedFacts>[0][number];
export interface TrialCounts { read: boolean; any_fact: boolean; correction: boolean; correction_ahead: boolean; asker_preference: boolean; queries: string[] }

/** One live trial's counts. `channelIds` maps a channel name to its world id. */
export function trialCounts(events: Ev[], channelIds: Map<string, string>): TrialCounts {
  const facts = ingestedFacts(events);
  const ids = (who: { author: string; channel: string }) => new Set(facts.filter((f) => f.author === who.author && f.channel === channelIds.get(who.channel)).map((f) => f.id));
  const correction = ids(CORRECTION), retracted = ids(RETRACTED);
  const preferences = new Set(facts.filter((f) => f.source === 'private-' + f.author && NEEDS[CN05]!.some((n) => n.pattern.test(f.text))).map((f) => f.id + '/' + f.author));
  const c: TrialCounts = { read: false, any_fact: false, correction: false, correction_ahead: false, asker_preference: false, queries: [] };
  for (const e of events) {
    if (!READS.has(e.tool) || e.via !== 'gbrain') continue;
    c.read = true;
    c.queries.push(queryText(e.args));
    const returned = ((e.effect?.facts as Array<{ id: number | string }> | undefined) ?? []).map((f) => String(f.id));
    if (returned.length) c.any_fact = true;
    const at = returned.findIndex((id) => correction.has(id));
    if (at >= 0) {
      c.correction = true;
      const before = returned.findIndex((id) => retracted.has(id));
      if (before < 0 || before > at) c.correction_ahead = true;
    }
    if (returned.some((id) => preferences.has(id + '/' + e.grant))) c.asker_preference = true;
  }
  return c;
}

export interface CellRow { cell: string; model: string; task: string; trials: number; passes: number; with_read: number; any_fact: number; correction: number; correction_ahead: number; asker_preference: number; queries: string[] }

export function mechanism(resultsDir: string, worldPath: string): CellRow[] {
  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as World;
  const channelIds = new Map(world.channels.map((ch) => [ch.name, ch.id]));
  const records = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cell: string; task: string; model: string; trial_id: string; grade: string });
  const rows = new Map<string, CellRow>();
  for (const rec of records) {
    if (!rec.cell.includes('gbrain-told-live') || (rec.task !== CR05 && rec.task !== CN05)) continue;
    const key = rec.task + '\t' + rec.cell;
    const row = rows.get(key) ?? { cell: rec.cell, model: rec.model, task: rec.task, trials: 0, passes: 0, with_read: 0, any_fact: 0, correction: 0, correction_ahead: 0, asker_preference: 0, queries: [] };
    rows.set(key, row);
    const events = readFileSync(join(resultsDir, 'trials', rec.cell, rec.task, rec.trial_id.split('/').pop()!, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev);
    const c = trialCounts(events, channelIds);
    row.trials++;
    if (rec.grade === 'pass') row.passes++;
    if (c.read) row.with_read++;
    if (c.any_fact) row.any_fact++;
    if (c.correction) row.correction++;
    if (c.correction_ahead) row.correction_ahead++;
    if (c.asker_preference) row.asker_preference++;
    for (const q of c.queries) if (!row.queries.includes(q)) row.queries.push(q);
  }
  return [...rows.values()].sort((a, b) => a.task.localeCompare(b.task) || b.model.localeCompare(a.model) || a.cell.localeCompare(b.cell));
}

export function markdown(rows: CellRow[]): string {
  const of = (n: number, r: CellRow) => n + ' of ' + r.trials;
  const qs = (r: CellRow) => r.queries.map((q) => q.replace(/\|/g, '/').replace(/\s*[\r\n]+\s*/g, ' ')).join('; ') || 'none';
  const L = ['## `' + CR05 + '`, live cells', '', '| cell | passes | trials with a read | a read returned any saved fact | a read returned the correction | the correction ahead of the 52-seat post | queries sent |', '|---|---:|---:|---:|---:|---:|---|'];
  for (const r of rows.filter((r) => r.task === CR05)) L.push('| ' + [r.cell, of(r.passes, r), of(r.with_read, r), of(r.any_fact, r), of(r.correction, r), of(r.correction_ahead, r), qs(r)].join(' | ') + ' |');
  L.push('', '## `' + CN05 + '`, live cells', '', "| cell | passes | trials with a read | a read returned any saved fact | a read returned the asker's DM preference | queries sent |", '|---|---:|---:|---:|---:|---|');
  for (const r of rows.filter((r) => r.task === CN05)) L.push('| ' + [r.cell, of(r.passes, r), of(r.with_read, r), of(r.any_fact, r), of(r.asker_preference, r), qs(r)].join(' | ') + ' |');
  return L.join('\n') + '\n';
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const rows = mechanism(resolve(arg('results') ?? 'docs/benchmarks/2026-10-26-gbrain-memory/results'), resolve('world/seed/world.json'));
  const md = markdown(rows);
  const out = arg('out');
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(join(resolve(out), 'mechanism.json'), JSON.stringify(rows, null, 1) + '\n');
    writeFileSync(join(resolve(out), 'mechanism.md'), md);
  }
  process.stdout.write(md);
}
