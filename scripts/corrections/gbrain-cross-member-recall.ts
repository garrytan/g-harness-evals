// Sizing for the cross-member recall defect (internal-task-a, internal-task-b): in a cell where the tap sends each gbrain call under the
// requesting member's token (gbrain.scope "member" or "member-sources"), a save the model makes during one member's turn lands
// in that member's private source (gbrain/build-brain.ts companyGrants gives every member token the write source
// private-<member>, and from gbrain 0.60.546.0 a member-bound remember is a private fact whatever source it names). No other
// member can recall it, even when the turn was in a shared channel.
//
//   bun scripts/corrections/gbrain-cross-member-recall.ts [--root docs/benchmarks] [--out <dir>]
//
// Keyless and read-only: reads every counted run's results/trials.jsonl (and results-acl/trials.jsonl), and for each trial in
// a member or member-sources cell its events.jsonl and turns.jsonl. Nothing under docs/benchmarks/ is written. With --out it
// writes gbrain-sizing.json and gbrain-sizing.md there; without it prints the Markdown.
//
// Per trial:
// - a shared save is a model gbrain write (GBRAIN_WRITE_TOOLS, outcome ok, not QM's provider client) made during a turn in a
//   non-DM channel. The turn is the last one whose started_seq is before the write (the requester holds through wait_s);
// - the trial is affected when a later turn belongs to a different member: that member's token could never read the save;
// - an affected trial's later member made a gbrain read when one of their gbrain reads came after the save (each such read
//   necessarily missed it; returned_save counts reads whose returned facts carry the saved text, which should be 0);
// - other conversation: the later member's turn was in a different conversation from the save's turn, so the message that
//   prompted the save was not in that turn's own channel history. This is the closest keyless proxy for "the fact was
//   available only through the save"; the bot can still read other channels through the world tools, so it is an upper bound.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GBRAIN_WRITE_TOOLS } from '../../world/services/gbrain-tap.ts';

interface TrialRecord { trial_id: string; cell: string; task: string; grade: string; paths?: { dir?: string }; gbrain?: { scope?: string; brain?: string; ingest?: string } }
interface Turn { turn: number; actor: string; channel: string; channel_type: string; started_seq: number }
interface Ev { seq: number; via?: string; tool?: string; kind?: string; outcome?: string; grant?: string; caller?: string; args?: Record<string, unknown>; effect?: { facts?: Array<{ fact?: string }> } }

export interface TrialRow {
  trial_id: string; task: string; grade: string;
  shared_saves: number; dm_saves: number; affected: boolean; later_reader_read: boolean; returned_save: number; other_conversation: boolean;
}
export interface CellRow {
  run: string; cell: string; scope: string; ingest: string; n: number; passed: number;
  trials_with_shared_save: number; affected: number; affected_failed: number;
  affected_later_read: number; affected_later_read_failed: number;
  affected_other_conversation: number; affected_other_conversation_failed: number;
  returned_save: number; dm_save_trials: number; examples: string[];
}

const READS = new Set(['search', 'query', 'recall', 'list_pages', 'get_page']);
const bare = (tool: unknown) => String(tool).replace(/^gbrain\./, '');

export function trialRow(rec: TrialRecord, turns: Turn[], events: Ev[]): TrialRow {
  const model = events.filter((e) => e.via === 'gbrain' && e.caller !== 'provider' && e.grant && e.grant !== 'bot' && e.grant !== 'public-only');
  const turnAt = (seq: number) => turns.filter((t) => t.started_seq < seq).at(-1);
  const writes = model.filter((e) => e.outcome === 'ok' && GBRAIN_WRITE_TOOLS.has(bare(e.tool)));
  const shared = writes.filter((e) => { const t = turnAt(e.seq); return t && t.channel_type !== 'dm'; });
  let affected = false, laterRead = false, other = false, returned = 0;
  for (const w of shared) {
    const t = turnAt(w.seq)!;
    const later = turns.filter((u) => u.turn > t.turn && u.actor !== w.grant);
    if (!later.length) continue;
    affected = true;
    if (later.some((u) => u.channel !== t.channel)) other = true;
    const fact = typeof w.args?.fact === 'string' ? w.args.fact.slice(0, 60) : null;
    for (const r of model.filter((e) => e.seq > w.seq && e.grant !== w.grant && READS.has(bare(e.tool)))) {
      laterRead = true;
      if (fact && (r.effect?.facts ?? []).some((f) => typeof f.fact === 'string' && f.fact.includes(fact))) returned++;
    }
  }
  return { trial_id: rec.trial_id, task: rec.task, grade: rec.grade, shared_saves: shared.length, dm_saves: writes.length - shared.length, affected, later_reader_read: laterRead, returned_save: returned, other_conversation: other };
}

const jsonl = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

export function size(root: string): { cells: CellRow[]; trials: Record<string, TrialRow[]>; missing: string[] } {
  const cells: CellRow[] = [];
  const trials: Record<string, TrialRow[]> = {};
  const missing: string[] = [];
  for (const run of readdirSync(root).sort()) {
    for (const res of ['results', 'results-acl']) {
      const dir = join(root, run, res);
      const file = join(dir, 'trials.jsonl');
      if (!existsSync(file)) continue;
      const byCell = new Map<string, TrialRecord[]>();
      for (const r of jsonl<TrialRecord>(file)) if (r.gbrain?.scope === 'member' || r.gbrain?.scope === 'member-sources') byCell.set(r.cell, [...(byCell.get(r.cell) ?? []), r]);
      for (const [cell, rs] of byCell) {
        const rows: TrialRow[] = [];
        for (const r of rs) {
          const rel = r.paths?.dir?.split('/trials/').pop() ?? `${r.cell}/${r.task}/${r.trial_id.split('/').pop()}`;
          const t = join(dir, 'trials', rel);
          if (!existsSync(join(t, 'events.jsonl')) || !existsSync(join(t, 'turns.jsonl'))) { missing.push(`${run}/${res}/trials/${rel}`); continue; }
          rows.push(trialRow(r, jsonl<Turn>(join(t, 'turns.jsonl')), jsonl<Ev>(join(t, 'events.jsonl'))));
        }
        const failed = (xs: TrialRow[]) => xs.filter((x) => x.grade !== 'pass').length;
        const aff = rows.filter((x) => x.affected);
        const read = aff.filter((x) => x.later_reader_read);
        const other = aff.filter((x) => x.other_conversation);
        trials[`${run}/${res}/${cell}`] = rows.filter((x) => x.shared_saves || x.dm_saves);
        cells.push({
          run: res === 'results' ? run : `${run} (${res})`, cell, scope: rs[0]!.gbrain!.scope!, ingest: rs[0]!.gbrain!.ingest ?? 'off', n: rows.length, passed: rows.length - failed(rows),
          trials_with_shared_save: rows.filter((x) => x.shared_saves).length, affected: aff.length, affected_failed: failed(aff),
          affected_later_read: read.length, affected_later_read_failed: failed(read),
          affected_other_conversation: other.length, affected_other_conversation_failed: failed(other),
          returned_save: rows.reduce((s, x) => s + x.returned_save, 0), dm_save_trials: rows.filter((x) => x.dm_saves).length,
          examples: aff.slice(0, 3).map((x) => x.trial_id),
        });
      }
    }
  }
  return { cells, trials, missing };
}

export function markdown(cells: CellRow[]): string {
  const sum = (k: keyof CellRow) => cells.reduce((s, c) => s + (c[k] as number), 0);
  const ex = (c: CellRow) => c.examples.map((e) => '`' + e.split('/').slice(-2).join('/') + '`').join(', ');
  return [
    '| Run | Cell | Scope | Ingest | n | Passed | Shared save | Affected | Affected failed | Later member read | Read, failed | Other conversation | Other, failed | Examples |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...cells.map((c) => `| ${c.run} | ${c.cell} | ${c.scope} | ${c.ingest} | ${c.n} | ${c.passed} | ${c.trials_with_shared_save} | ${c.affected} | ${c.affected_failed} | ${c.affected_later_read} | ${c.affected_later_read_failed} | ${c.affected_other_conversation} | ${c.affected_other_conversation_failed} | ${ex(c)} |`),
    `| **All** | ${cells.length} cells | | | ${sum('n')} | ${sum('passed')} | ${sum('trials_with_shared_save')} | ${sum('affected')} | ${sum('affected_failed')} | ${sum('affected_later_read')} | ${sum('affected_later_read_failed')} | ${sum('affected_other_conversation')} | ${sum('affected_other_conversation_failed')} | |`,
  ].join('\n') + '\n';
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  const out = arg('--out');
  const { cells, trials, missing } = size(resolve(arg('--root') ?? 'docs/benchmarks'));
  const md = markdown(cells);
  if (!out) { process.stdout.write(md); process.exit(0); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'gbrain-sizing.json'), JSON.stringify({ schema_version: 1, generated_by: 'scripts/corrections/gbrain-cross-member-recall.ts', cells, trials, missing }, null, 1) + '\n');
  writeFileSync(join(out, 'gbrain-sizing.md'), md);
  console.log(`gbrain-cross-member-recall: ${cells.length} cells, ${cells.reduce((s, c) => s + c.affected, 0)} affected trials, ${missing.length} trials without receipts; wrote ${out}`);
}
