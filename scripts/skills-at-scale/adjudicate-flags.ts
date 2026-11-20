#!/usr/bin/env bun
// Settles the flagged trials of the skills-at-scale eval by hand (internal-task's decision, 2026-11-19; flags.ts says which trials
// are flagged and why). Two readers each open a flagged trial's skill-flags.json (the flagged tool calls, their input and
// result) and record one verdict row per trial in their own file:
//   {"trial_id": "<id>", "reader": "<who>", "contaminated": true|false, "opened": ["<catalog skill>", ...], "note": "<one sentence>"}
// contaminated is the clean-arm verdict (a read of a gstack skill file outside the trial's catalog copy); opened is the set of
// catalog skills the trial read. A trial is settled when at least two different readers recorded it and all of them agree
// on both; otherwise it is a disagreement, listed with what differs, and it stays unsettled until the readers agree.
//
//   bun scripts/skills-at-scale/adjudicate-flags.ts --flagged <flagged.jsonl> --verdicts <reader-a.jsonl> --verdicts <reader-b.jsonl> --out <dir>
//
// writes <out>/settled.jsonl ({trial_id, contaminated, opened, readers}, what analyze.ts --settled reads),
// <out>/disagreements.jsonl and <out>/flag-settlement.json; exits 1 while any flagged trial is unsettled.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlaggedRow } from './flags.ts';

export type FlagVerdict = { trial_id: string; reader: string; contaminated: boolean; opened: string[]; note?: string };
export type Settled = { trial_id: string; contaminated: boolean; opened: string[]; readers: string[] };

export function settleFlags(flagged: Pick<FlaggedRow, 'trial_id'>[], verdicts: FlagVerdict[]) {
  const ids = new Set(flagged.map((f) => f.trial_id));
  const problems: string[] = [];
  const by = new Map<string, FlagVerdict[]>();
  for (const [i, v] of verdicts.entries()) {
    if (!ids.has(v.trial_id)) { problems.push('verdict ' + i + ': trial ' + v.trial_id + ' is not flagged'); continue; }
    if (typeof v.reader !== 'string' || !v.reader.trim() || typeof v.contaminated !== 'boolean' || !Array.isArray(v.opened)) { problems.push('verdict ' + i + ': reader, contaminated (true or false) and opened (a list) are required'); continue; }
    const list = by.get(v.trial_id) ?? [];
    if (list.some((x) => x.reader === v.reader)) { problems.push('verdict ' + i + ': ' + v.reader + ' recorded trial ' + v.trial_id + ' twice'); continue; }
    by.set(v.trial_id, [...list, { ...v, opened: [...new Set(v.opened.map(String))].sort() }]);
  }
  const settled: Settled[] = [], disagreements: Array<{ trial_id: string; differ: string[]; verdicts: FlagVerdict[] }> = [], unread: Array<{ trial_id: string; readers: string[] }> = [];
  for (const id of [...ids].sort()) {
    const vs = by.get(id) ?? [];
    if (vs.length < 2) { unread.push({ trial_id: id, readers: vs.map((v) => v.reader) }); continue; }
    const differ = [...(new Set(vs.map((v) => v.contaminated)).size > 1 ? ['contaminated'] : []), ...(new Set(vs.map((v) => JSON.stringify(v.opened))).size > 1 ? ['opened'] : [])];
    if (differ.length) disagreements.push({ trial_id: id, differ, verdicts: vs });
    else settled.push({ trial_id: id, contaminated: vs[0]!.contaminated, opened: vs[0]!.opened, readers: vs.map((v) => v.reader).sort() });
  }
  return { settled, disagreements, unread, problems,
    summary: { schema: 'he-skills-at-scale-flag-settlement/1', flagged: ids.size, settled: settled.length, disagreements: disagreements.length, unread: unread.length, problems: problems.length, all_settled: settled.length === ids.size && !problems.length } };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const all = (k: string) => a.flatMap((x, i) => (x === '--' + k && a[i + 1] ? [a[i + 1]!] : []));
  const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (!v('flagged') || !all('verdicts').length || !v('out')) { console.error('usage: adjudicate-flags.ts --flagged <flagged.jsonl> --verdicts <reader.jsonl>... --out <dir>'); process.exit(2); }
  try {
    const r = settleFlags(readJsonl(v('flagged')!), all('verdicts').flatMap(readJsonl));
    mkdirSync(v('out')!, { recursive: true });
    const w = (f: string, rows: unknown[]) => writeFileSync(join(v('out')!, f), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
    w('settled.jsonl', r.settled);
    w('disagreements.jsonl', r.disagreements);
    writeFileSync(join(v('out')!, 'flag-settlement.json'), JSON.stringify({ ...r.summary, unread: r.unread, problems: r.problems }, null, 1) + '\n');
    for (const d of r.disagreements) console.log('DISAGREE trial=' + d.trial_id + ' on=' + d.differ.join(','));
    for (const p of r.problems) console.log('PROBLEM ' + p);
    console.log('FLAGS_SETTLED flagged=' + r.summary.flagged + ' settled=' + r.summary.settled + ' disagreements=' + r.summary.disagreements + ' unread=' + r.summary.unread + ' problems=' + r.summary.problems);
    process.exit(r.summary.all_settled ? 0 : 1);
  } catch (e) { console.error('HE-SCALE-FLAGADJ-000 ' + (e as Error).message); process.exit(2); }
}
