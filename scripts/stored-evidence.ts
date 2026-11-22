// A recorded trial's TrialEvidence from its stored files under <results>/trials/<cell>/<task>/<rep>/ (events.jsonl, turns.jsonl and
// snapshot.json, each plain or gzipped as publishing leaves them, and internal-task's harness-memory/ snapshots when the runner took
// them), with the task directory and world the trial ran on: compare-run's exposure endpoint and the leak tags (scripts/leak-tags.ts)
// grade it with this checkout's grader. A trial whose files are missing or disagree with its record gives a problem instead.

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { TrialEvidence, TrialRecord, TurnWindow, WorldSnapshot } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { isSealedCell, setWorldPath, taskDirFor } from '../runner/run.ts';
import { loadHarnessMemory } from '../runner/trial/harness-memory.ts';

export interface StoredEvidenceOptions {
  results: string;
  manifest: { cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }>; sealed?: { set: string } };
  repoRoot: string;
  sealedRoot?: string;
}

export function storedEvidence(t: TrialRecord, o: StoredEvidenceOptions): { evidence: TrialEvidence } | { problem: string } {
  const dir = join(o.results, 'trials', t.cell, t.task, t.trial_id.split('/').at(-1)!);
  const stored = (f: string): string | null => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : existsSync(join(dir, f + '.gz')) ? gunzipSync(readFileSync(join(dir, f + '.gz'))).toString('utf8') : null);
  const jsonl = <T>(text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
  if (!['events.jsonl', 'turns.jsonl', 'snapshot.json'].every((f) => existsSync(join(dir, f)) || existsSync(join(dir, f + '.gz')))) return { problem: `${t.trial_id}: no stored events, turns or snapshot` };
  try {
    const cell = o.manifest.cells.find((c) => c.id === t.cell) ?? { split: 'dev' as const };
    const sealed = isSealedCell(cell, o.manifest.sealed?.set);
    const turns = jsonl<TurnWindow>(stored('turns.jsonl')!);
    const run = t.turns?.run ?? 0;
    if (turns.length !== run || new Set(turns.map((w) => w.turn)).size !== run) return { problem: `${t.trial_id}: turns.jsonl holds ${turns.length} turn(s), the record says ${run} ran` };
    const snapshot = JSON.parse(stored('snapshot.json')!) as WorldSnapshot;
    const events = jsonl<WorldEvent>(stored('events.jsonl')!);
    const counted = (snapshot as { events?: unknown }).events;
    if (counted !== events.length || events.some((e, i) => e.seq !== i + 1)) return { problem: `${t.trial_id}: events.jsonl holds ${events.length} event(s) in seq order 1..n ${events.every((e, i) => e.seq === i + 1) ? 'yes' : 'no'}, the snapshot counts ${typeof counted === 'number' ? counted : 'none'}` };
    const harnessMemory = loadHarnessMemory(dir);
    return { evidence: {
      trial_id: t.trial_id, task_dir: taskDirFor(cell, t.task, sealed ? join(o.sealedRoot!, 'tasks') : join(o.repoRoot, 'tasks')), split: cell.split,
      world_path: o.manifest.sealed && o.sealedRoot ? join(o.sealedRoot, 'world', 'world.json') : setWorldPath(cell, join(o.repoRoot, 'tasks')) ?? join(o.repoRoot, 'world', 'seed', 'world.json'), bot_member: 'assistant',
      snapshot, events, turns, ...(harnessMemory ? { harness_memory: harnessMemory } : {}),
    } };
  } catch (err) {
    return { problem: `${t.trial_id}: stored evidence did not read (${(err as Error).name}: ${(err as Error).message})` };
  }
}
