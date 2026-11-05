#!/usr/bin/env bun
// Re-grade recorded trials from their stored evidence with the grader at this commit.
//
//   bun scripts/regrade.ts --results <results/<run-id>> [--cells <id,id>] [--out <file>]
//
// Reads trials.jsonl and, per trial, snapshot.json, events.jsonl and turns.jsonl (or the same name with .gz,
// as committed results store snapshot.json.gz); runs gradeTrial again and writes one line per trial with the
// original and the new grade, consent_violation, approval_stop and predicates, plus the grader commit.
// Nothing in the run directory is rewritten: a regrade is a labelled second reading of the same evidence,
// never a replacement for the preregistered grader's record.
//
// Each trial's evidence is read from <results>/trials/<cell>/<task>/[<script>/]r<n>/, so a results directory
// that was moved or extracted elsewhere regrades the same; the absolute paths.dir in the record is used only
// when that directory does not exist. --cells regrades only the named cells. --out writes the file elsewhere
// (default <results>/trials.regraded.jsonl), so a results directory extracted read-only is never written to.
//
// Exit codes: 0 when every selected trial was regraded and none changed grade, consent_violation or
// approval_stop; 1 when any selected trial could not be regraded or changed (one line per such trial, with the
// failed predicates that moved); 2 on a usage error (no trials.jsonl, a missing flag value, an unknown cell) or when a
// set world the run pinned in set-worlds.json changed since the run (HE-RUN-008).
//
// regradeResults() is the same check as a function, for scripts that replicate a run; it throws RunnerError HE-RUN-008
// for a set-world pin mismatch.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PredicateResult, TrialEvidence, TrialRecord, TurnWindow, WorldSnapshot } from '../runner/contracts.ts';
import { gradeTrial } from '../runner/grade/index.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { RunnerError } from '../runner/errors.ts';
import { setWorldPath, setWorldPinProblem, taskDirFor, type Trial } from '../runner/run.ts';
import { trialDirFor } from '../runner/trial/run.ts';

export class RegradeUsageError extends Error {}

export interface Reading {
  grade: TrialRecord['grade'];
  consent_violation: boolean;
  approval_stop: boolean;
  failed: string[];
}

export interface RegradeRow {
  trial_id: string;
  cell: string;
  task: string;
  regraded: boolean;
  reason?: string;
  evidence_dir?: string;
  grader_commit?: string;
  original?: Reading;
  regraded_result?: Reading;
  changed?: boolean;
  moved?: string[];
  predicates?: PredicateResult[];
}

export interface RegradeSummary {
  selected: number;
  regraded: number;
  not_regraded: number;
  changed: number;
  grader_commit: string;
}

export interface RegradeReport {
  rows: RegradeRow[];
  summary: RegradeSummary;
  /** One line per trial that was not regraded or changed; empty means the regrade agrees with the record. */
  problems: string[];
}

function readEvidence(dir: string, name: string): string | undefined {
  if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8');
  if (existsSync(join(dir, `${name}.gz`))) return gunzipSync(readFileSync(join(dir, `${name}.gz`))).toString('utf8');
  return undefined;
}

const jsonl = <T>(text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const failedIds = (predicates: PredicateResult[]) => predicates.filter((p) => !p.passed).map((p) => p.id);

export async function regradeResults(opts: { results: string; cells?: string[]; repoRoot?: string }): Promise<RegradeReport> {
  const results = resolve(opts.results);
  const repoRoot = opts.repoRoot ?? resolve(import.meta.dir, '..');
  if (!existsSync(join(results, 'trials.jsonl'))) throw new RegradeUsageError(`no trials.jsonl in ${results}`);
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; split: 'dev' | 'heldout'; task_set?: string }> };
  const pinProblem = setWorldPinProblem(results, manifest.cells, repoRoot);
  if (pinProblem) throw new RunnerError('HE-RUN-008', pinProblem);
  const records = jsonl<TrialRecord>(readFileSync(join(results, 'trials.jsonl'), 'utf8'));
  const unknown = (opts.cells ?? []).filter((c) => !records.some((r) => r.cell === c));
  if (unknown.length) throw new RegradeUsageError(`--cells names cells with no trials in ${join(results, 'trials.jsonl')}: ${unknown.join(', ')}`);
  const selected = opts.cells ? records.filter((r) => opts.cells!.includes(r.cell)) : records;
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}

  const rows: RegradeRow[] = [];
  const problems: string[] = [];
  for (const rec of selected) {
    const base = { trial_id: rec.trial_id, cell: rec.cell, task: rec.task };
    const resolved = trialDirFor(results, { id: rec.trial_id } as Trial);
    const dir = existsSync(resolved) ? resolved : rec.paths?.dir && existsSync(rec.paths.dir) ? rec.paths.dir : undefined;
    const notRegraded = (reason: string) => {
      rows.push({ ...base, regraded: false, reason, ...(dir ? { evidence_dir: dir } : {}) });
      problems.push(`not regraded: ${rec.trial_id} (${reason})`);
    };
    if (!dir) {
      notRegraded(`no trial directory at ${resolved}`);
      continue;
    }
    const snapshot = readEvidence(dir, 'snapshot.json');
    const events = readEvidence(dir, 'events.jsonl');
    const turns = readEvidence(dir, 'turns.jsonl');
    const missing = [snapshot === undefined && 'snapshot.json', events === undefined && 'events.jsonl', turns === undefined && 'turns.jsonl'].filter(Boolean);
    if (missing.length) {
      notRegraded(`missing ${missing.join(', ')} (plain or .gz) in ${dir}`);
      continue;
    }
    const cell = manifest.cells.find((c) => c.id === rec.cell) ?? { split: 'dev' as const };
    let g;
    try {
      const evidence: TrialEvidence = {
        trial_id: rec.trial_id,
        task_dir: taskDirFor(cell, rec.task, join(repoRoot, 'tasks')),
        split: cell.split,
        world_path: setWorldPath(cell, join(repoRoot, 'tasks')) ?? join(repoRoot, 'world', 'seed', 'world.json'),
        bot_member: 'assistant',
        snapshot: JSON.parse(snapshot!) as WorldSnapshot,
        events: jsonl<WorldEvent>(events!),
        turns: jsonl<TurnWindow>(turns!),
      };
      g = await gradeTrial(evidence);
    } catch (e) {
      notRegraded(`grader error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const original: Reading = { grade: rec.grade, consent_violation: rec.consent_violation, approval_stop: rec.approval_stop, failed: failedIds(rec.predicates) };
    const regraded: Reading = { grade: g.grade, consent_violation: g.consent_violation, approval_stop: g.approval_stop, failed: failedIds(g.predicates) };
    const moved = [...original.failed.filter((id) => !regraded.failed.includes(id)), ...regraded.failed.filter((id) => !original.failed.includes(id))];
    const fields = (['grade', 'consent_violation', 'approval_stop'] as const).filter((k) => original[k] !== regraded[k]);
    const changed = fields.length > 0;
    rows.push({ ...base, regraded: true, evidence_dir: dir, grader_commit: commit, original, regraded_result: regraded, changed, moved, predicates: g.predicates });
    if (changed) problems.push(`changed: ${rec.trial_id} ${fields.map((k) => `${k} ${original[k]} -> ${regraded[k]}`).join(', ')}; failed predicates moved: ${moved.join(', ') || 'none'}`);
  }
  const regradedCount = rows.filter((r) => r.regraded).length;
  return {
    rows,
    summary: { selected: selected.length, regraded: regradedCount, not_regraded: rows.length - regradedCount, changed: rows.filter((r) => r.changed).length, grader_commit: commit },
    problems,
  };
}

if (import.meta.main) {
  const usage = 'usage: bun scripts/regrade.ts --results <results/<run-id>> [--cells <id,id>] [--out <file>]';
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const value = process.argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`--${name} needs a value\n${usage}`);
      process.exit(2);
    }
    return value;
  };
  const results = arg('results');
  if (!results) {
    console.error(usage);
    process.exit(2);
  }
  const cells = arg('cells')?.split(',').map((c) => c.trim()).filter(Boolean);
  let report: RegradeReport;
  try {
    report = await regradeResults({ results, cells });
  } catch (e) {
    if (e instanceof RunnerError) {
      console.error(e.message);
      process.exit(2);
    }
    if (!(e instanceof RegradeUsageError)) throw e;
    console.error(`${e.message}\n${usage}`);
    process.exit(2);
  }
  const file = resolve(arg('out') ?? join(results, 'trials.regraded.jsonl'));
  writeFileSync(file, report.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const line of report.problems) console.log(line);
  const s = report.summary;
  console.log(`regraded ${s.regraded} of ${s.selected} trials with grader ${s.grader_commit}; ${s.not_regraded} not regraded; ${s.changed} changed grade, consent_violation or approval_stop; wrote ${file}`);
  process.exit(report.problems.length ? 1 : 0);
}
