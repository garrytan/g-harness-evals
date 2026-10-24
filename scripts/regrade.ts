#!/usr/bin/env bun
// Re-grade recorded trials from their stored evidence with the grader at this commit.
//
//   bun scripts/regrade.ts --results <results/<run-id>> [--out trials.regraded.jsonl]
//
// Reads trials.jsonl and, per trial, snapshot.json, events.jsonl and turns.jsonl; runs gradeTrial again and
// writes one line per trial with the original and the new grade, consent_violation, approval_stop and
// predicates, plus the grader commit. Nothing in the run directory is rewritten: a regrade is a labelled
// second reading of the same evidence, never a replacement for the preregistered grader's record.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialEvidence, TrialRecord, TurnWindow, WorldSnapshot } from '../runner/contracts.ts';
import { gradeTrial } from '../runner/grade/index.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { taskDirFor } from '../runner/run.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const results = arg('results');
if (!results || !existsSync(join(results, 'trials.jsonl'))) {
  console.error('usage: bun scripts/regrade.ts --results <results/<run-id>> [--out <file>]');
  process.exit(2);
}
const repoRoot = resolve(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }> };
const commit = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
const lines = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const out: string[] = [];
let changed = 0;
for (const rec of lines) {
  const dir = rec.paths.dir!;
  if (!existsSync(join(dir, 'snapshot.json')) || !existsSync(join(dir, 'turns.jsonl'))) {
    out.push(JSON.stringify({ trial_id: rec.trial_id, regraded: false, reason: 'no snapshot or turns recorded' }));
    continue;
  }
  const cell = manifest.cells.find((c) => c.id === rec.cell) ?? { split: 'dev' as const };
  const split = cell.split;
  const evidence: TrialEvidence = {
    trial_id: rec.trial_id,
    task_dir: taskDirFor(cell, rec.task, join(repoRoot, 'tasks')),
    split,
    world_path: join(repoRoot, 'world', 'seed', 'world.json'),
    bot_member: 'assistant',
    snapshot: JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8')) as WorldSnapshot,
    events: readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent),
    turns: readFileSync(join(dir, 'turns.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TurnWindow),
  };
  const g = await gradeTrial(evidence);
  const differs = g.grade !== rec.grade || g.consent_violation !== rec.consent_violation;
  if (differs) changed += 1;
  out.push(JSON.stringify({
    trial_id: rec.trial_id, cell: rec.cell, task: rec.task, regraded: true, grader_commit: commit,
    original: { grade: rec.grade, consent_violation: rec.consent_violation, approval_stop: rec.approval_stop, failed: rec.predicates.filter((p) => !p.passed).map((p) => p.id) },
    regraded_result: { grade: g.grade, consent_violation: g.consent_violation, approval_stop: g.approval_stop, failed: g.predicates.filter((p) => !p.passed).map((p) => p.id) },
    changed: differs, predicates: g.predicates,
  }));
}
const file = arg('out', join(results, 'trials.regraded.jsonl'))!;
writeFileSync(file, out.join('\n') + '\n');
console.log(`regraded ${lines.length} trials with grader ${commit}; ${changed} changed grade or consent_violation; wrote ${file}`);
