// Per-trial view of the mechanism counts (gbrain-memory-fix-2026-10b, Endpoints items 2 and 3), keyless: for every live trial of
// `cr-05-pellow-seat-retraction` and `cn-05-coastal-date-formats`, its grade beside what its gbrain reads returned, so a pass can be
// read against the correction (or the asker's DM preference) coming back in the same trial. The counting is
// scripts/memory-fix-mechanism.ts `trialCounts`, unchanged; this script only keeps the trial-level rows its cell totals sum.
//
//   bun scripts/memory-fix-per-trial.ts [--results docs/benchmarks/2026-10-28-gbrain-memory-fix-b/results] [--out <dir>]
//
// Prints Markdown and, with --out, writes mechanism-trials.json and mechanism-trials.md there.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { World } from '../world/types.ts';
import { CN05, CR05, trialCounts, type Ev } from './memory-fix-mechanism.ts';

export interface TrialRow { trial_id: string; cell: string; task: string; grade: string; read: boolean; correction: boolean; correction_ahead: boolean; asker_preference: boolean }

export function perTrial(resultsDir: string, worldPath: string): TrialRow[] {
  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as World;
  const channelIds = new Map(world.channels.map((ch) => [ch.name, ch.id]));
  const records = readFileSync(join(resultsDir, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cell: string; task: string; trial_id: string; grade: string });
  return records.filter((r) => r.cell.includes('gbrain-told-live') && (r.task === CR05 || r.task === CN05)).map((r) => {
    const events = readFileSync(join(resultsDir, 'trials', r.cell, r.task, r.trial_id.split('/').pop()!, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev);
    const c = trialCounts(events, channelIds);
    return { trial_id: r.trial_id, cell: r.cell, task: r.task, grade: r.grade, read: c.read, correction: c.correction, correction_ahead: c.correction_ahead, asker_preference: c.asker_preference };
  }).sort((a, b) => a.task.localeCompare(b.task) || a.trial_id.localeCompare(b.trial_id));
}

export function markdown(rows: TrialRow[]): string {
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  const L: string[] = [];
  for (const task of [CR05, CN05]) {
    const sel = rows.filter((r) => r.task === task);
    const tally = (pass: boolean, hit: boolean) => sel.filter((r) => (r.grade === 'pass') === pass && (task === CR05 ? r.correction_ahead : r.asker_preference) === hit).length;
    const hit = task === CR05 ? 'the correction ahead of the 52-seat post' : "the asker's DM preference";
    L.push('## `' + task + '`, live trials', '');
    L.push('Passes with ' + hit + ' returned: ' + tally(true, true) + '; passes without it: ' + tally(true, false) + '; fails with it: ' + tally(false, true) + '; fails without it: ' + tally(false, false) + '.', '');
    L.push('| trial | grade | a gbrain read | ' + (task === CR05 ? 'the correction returned | the correction ahead |' : "the asker's DM preference returned |"));
    L.push(task === CR05 ? '|---|---|---|---|---|' : '|---|---|---|---|');
    for (const r of sel) L.push('| ' + [r.trial_id.split('/').slice(1).join('/'), r.grade, yes(r.read), ...(task === CR05 ? [yes(r.correction), yes(r.correction_ahead)] : [yes(r.asker_preference)])].join(' | ') + ' |');
    L.push('');
  }
  return L.join('\n');
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const rows = perTrial(resolve(arg('results') ?? 'docs/benchmarks/2026-10-28-gbrain-memory-fix-b/results'), resolve('world/seed/world.json'));
  const md = markdown(rows);
  const out = arg('out');
  if (out) {
    writeFileSync(join(resolve(out), 'mechanism-trials.json'), JSON.stringify(rows, null, 1) + '\n');
    writeFileSync(join(resolve(out), 'mechanism-trials.md'), md);
  }
  process.stdout.write(md);
}
