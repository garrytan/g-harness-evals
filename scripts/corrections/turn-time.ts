#!/usr/bin/env bun
// Keyless sensitivity for the 2026-11-09 correction on time per trial (docs/corrections.md). A multi-user trial's
// wall_ms starts before the runner starts the world, sidecar and harness containers and ends after it stops them,
// finalizes the proxy and grades (runner/trial/trial.ts). So "median time per trial" includes our rig starting and
// stopping each harness. This prints, per cell and over the scored trials the published median uses, the median
// wall time and the median in-turn time: the sum of each turn's window, from the member's message to the harness's
// answer, read from the committed turns.jsonl.
//
//   bun scripts/corrections/turn-time.ts --results <multi-user results dir> [--out <file>]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { TrialRecord, TurnWindow } from '../../runner/contracts.ts';
import { trialDirFor } from '../../runner/trial/run.ts';
import type { Trial } from '../../runner/run.ts';

const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };
const read = (dir: string, name: string): string | undefined => {
  if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8');
  if (existsSync(join(dir, name + '.gz'))) return gunzipSync(readFileSync(join(dir, name + '.gz'))).toString('utf8');
  return undefined;
};

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i < 0 ? undefined : process.argv[i + 1]; };
  const results = resolve(arg('results') ?? '');
  if (!existsSync(join(results, 'trials.jsonl'))) { console.error('usage: bun scripts/corrections/turn-time.ts --results <multi-user results dir> [--out <file>]'); process.exit(2); }
  const rows = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const by = new Map<string, { wall: number[]; turn: number[]; missing: number }>();
  for (const r of rows) {
    if (EXCLUDED.has(r.termination)) continue;
    const b = by.get(r.cell) ?? { wall: [], turn: [], missing: 0 };
    by.set(r.cell, b);
    b.wall.push(r.wall_ms);
    const turns = read(trialDirFor(results, { id: r.trial_id } as Trial), 'turns.jsonl');
    if (turns === undefined) { b.missing++; continue; }
    b.turn.push(turns.split('\n').filter(Boolean).map((l) => JSON.parse(l) as TurnWindow).reduce((a, w) => a + (Date.parse(w.ended_wall) - Date.parse(w.started_wall)), 0));
  }
  const s1 = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
  const cells = Object.fromEntries([...by].map(([c, b]) => [c, { scored: b.wall.length, median_wall_s: s1(median(b.wall)), median_in_turn_s: s1(median(b.turn)), median_outside_turns_s: s1(median(b.wall.length === b.turn.length ? b.wall.map((w, i) => w - b.turn[i]!) : [])), trials_without_turns: b.missing }]));
  const out = JSON.stringify({ results: results.slice(resolve(import.meta.dir, '..', '..').length + 1), cells }, null, 2) + '\n';
  if (arg('out')) writeFileSync(resolve(arg('out')!), out);
  process.stdout.write(out);
}
