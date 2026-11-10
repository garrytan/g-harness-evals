#!/usr/bin/env bun
// Keyless sensitivity regrade for the 2026-11-09 corrections (docs/corrections.md). Reads a committed multi-user
// results directory, regrades every trial from its stored evidence under one stated rule, and writes a copy of
// trials.jsonl with only grade, consent_violation, approval_stop and predicates replaced. The committed results are
// never written.
//
//   bun scripts/corrections/regrade-sensitivity.ts --results <dir> --rule withhold|v031|both --out <dir> [--tasks-root <dir>]
//
// --tasks-root names the tasks/ tree the task directories are read from (default: this checkout's tasks/).
//
// Rules:
// - withhold: the runner-posted final text is dropped on every turn where the bot had already posted into the turn's
//   conversation (an ok chat.postMessage write by the bot over any transport, to the channel's id or name, any thread)
//   inside the turn window, the rule runner/trial/turns.ts applies.
//   That is the runner contract from 2026-11-09 on (docs/adapters.md). The dropped message leaves the events, the
//   snapshot and the turn record, so no predicate reads it.
// - v031: the same evidence graded against the v0.3.1 task set (fixed excuse checks) instead of v0.3.
// - both: the two together.
//
// Output: <out>/trials.jsonl (the regraded copy), <out>/changes.jsonl (one line per trial whose grade moved, with the
// failed predicates before and after) and <out>/summary.json (per cell: trials, withheld turns, trials whose grade
// moved each way). A trial recorded with grade n/a (a harness error, timeout or excluded termination) is copied as
// it is: the rule changes what is graded, not which trials are scored.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PredicateResult, TrialEvidence, TrialRecord, TurnWindow, WorldSnapshot } from '../../runner/contracts.ts';
import { gradeTrial } from '../../runner/grade/index.ts';
import type { WorldEvent } from '../../world/services/events.ts';
import { setWorldPath, taskDirFor, type Trial } from '../../runner/run.ts';
import { trialDirFor } from '../../runner/trial/run.ts';

type Rule = 'withhold' | 'v031' | 'both';

const read = (dir: string, name: string): string | undefined => {
  if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8');
  if (existsSync(join(dir, name + '.gz'))) return gunzipSync(readFileSync(join(dir, name + '.gz'))).toString('utf8');
  return undefined;
};
const jsonl = <T>(text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const failedIds = (ps: PredicateResult[]) => ps.filter((p) => !p.passed).map((p) => p.id);

type Ev = WorldEvent & { seq: number; actor?: string | null; via?: string; tool?: string; outcome?: string; effect?: Record<string, unknown> };

/** Drops the runner-posted reply on each turn where the bot posted into the turn's channel itself; returns how many. */
export function withholdRunnerReplies(turns: TurnWindow[], events: Ev[], snapshot: WorldSnapshot): number {
  let withheld = 0;
  for (const t of turns) {
    if (!t.reply_ts) continue;
    const own = events.some((e) => e.seq > t.started_seq && e.seq <= t.ended_seq && e.actor === 'assistant' && e.tool === 'chat.postMessage' && e.kind === 'write' && e.outcome === 'ok'
      && (e.effect?.channel === t.channel || e.effect?.channel === t.channel_name));
    if (!own) continue;
    const ts = t.reply_ts;
    const isReply = (e: Ev) => e.via === 'slack' && e.tool === 'chat.postMessage' && e.effect?.ts === ts && e.effect?.channel === t.channel;
    for (let i = events.length - 1; i >= 0; i--) if (isReply(events[i]!)) events.splice(i, 1);
    const snap = snapshot as unknown as { messages: Array<{ ts: string; channel: string }>; events?: Ev[] };
    snap.messages = snap.messages.filter((m) => !(m.ts === ts && m.channel === t.channel));
    if (Array.isArray(snap.events)) snap.events = snap.events.filter((e) => !isReply(e));
    (t as TurnWindow & { reply_withheld?: string }).reply_withheld = 'bot_posted';
    t.reply_ts = null;
    t.reply_text = null;
    withheld++;
  }
  return withheld;
}

export const v031 = (taskSet: string | undefined) => {
  if (!taskSet || !/^v0\.3(\/|$)/.test(taskSet)) throw new Error('cell task_set ' + taskSet + ' is not a v0.3 set');
  return taskSet.replace(/^v0\.3/, 'v0.3.1');
};

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i < 0 ? undefined : process.argv[i + 1]; };
  const results = resolve(arg('results') ?? '');
  const rule = arg('rule') as Rule;
  const out = resolve(arg('out') ?? '');
  if (!existsSync(join(results, 'trials.jsonl')) || !['withhold', 'v031', 'both'].includes(rule) || !arg('out')) {
    console.error('usage: bun scripts/corrections/regrade-sensitivity.ts --results <dir> --rule withhold|v031|both --out <dir>');
    process.exit(2);
  }
  const repoRoot = resolve(import.meta.dir, '..', '..');
  const tasksRoot = resolve(arg('tasks-root') ?? join(repoRoot, 'tasks'));
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }> };
  const records = jsonl<TrialRecord>(readFileSync(join(results, 'trials.jsonl'), 'utf8'));
  mkdirSync(out, { recursive: true });
  const outRows: string[] = [], changes: string[] = [];
  const summary: Record<string, { trials: number; regraded: number; not_regraded: number; withheld_turns: number; fail_to_pass: number; pass_to_fail: number; other_moves: number }> = {};
  for (const rec of records) {
    const s = (summary[rec.cell] ??= { trials: 0, regraded: 0, not_regraded: 0, withheld_turns: 0, fail_to_pass: 0, pass_to_fail: 0, other_moves: 0 });
    s.trials++;
    const dir = trialDirFor(results, { id: rec.trial_id } as Trial);
    const snapshot = existsSync(dir) ? read(dir, 'snapshot.json') : undefined, events = existsSync(dir) ? read(dir, 'events.jsonl') : undefined, turns = existsSync(dir) ? read(dir, 'turns.jsonl') : undefined;
    if (rec.grade === 'n/a' || snapshot === undefined || events === undefined || turns === undefined) { s.not_regraded++; outRows.push(JSON.stringify(rec)); continue; }
    const cell = manifest.cells.find((c) => c.id === rec.cell)!;
    const gradeCell = rule === 'withhold' ? cell : { ...cell, task_set: v031(cell.task_set) };
    const ev = jsonl<Ev>(events), tw = jsonl<TurnWindow>(turns), snap = JSON.parse(snapshot) as WorldSnapshot;
    if (rule !== 'v031') s.withheld_turns += withholdRunnerReplies(tw, ev, snap);
    const evidence: TrialEvidence = {
      trial_id: rec.trial_id,
      task_dir: taskDirFor(gradeCell, rec.task, tasksRoot),
      split: cell.split,
      world_path: setWorldPath(cell, join(repoRoot, 'tasks')) ?? join(repoRoot, 'world', 'seed', 'world.json'),
      bot_member: 'assistant',
      snapshot: snap,
      events: ev as WorldEvent[],
      turns: tw,
    };
    const g = await gradeTrial(evidence);
    s.regraded++;
    const next = { ...rec, grade: g.grade, consent_violation: g.consent_violation, approval_stop: g.approval_stop, predicates: g.predicates };
    outRows.push(JSON.stringify(next));
    const moved = rec.grade !== g.grade || rec.consent_violation !== g.consent_violation || rec.approval_stop !== g.approval_stop;
    if (moved) {
      const was = rec.grade === 'pass' && !rec.consent_violation, now = g.grade === 'pass' && !g.consent_violation;
      if (!was && now) s.fail_to_pass++; else if (was && !now) s.pass_to_fail++; else s.other_moves++;
      changes.push(JSON.stringify({ trial_id: rec.trial_id, cell: rec.cell, task: rec.task, termination: rec.termination, before: { grade: rec.grade, consent_violation: rec.consent_violation, failed: failedIds(rec.predicates) }, after: { grade: g.grade, consent_violation: g.consent_violation, failed: failedIds(g.predicates) } }));
    }
  }
  writeFileSync(join(out, 'trials.jsonl'), outRows.join('\n') + '\n');
  writeFileSync(join(out, 'changes.jsonl'), changes.join('\n') + (changes.length ? '\n' : ''));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ results: results.slice(repoRoot.length + 1), rule, cells: summary }, null, 2) + '\n');
  for (const [c, s] of Object.entries(summary)) console.log(c.padEnd(52), JSON.stringify(s));
}
