#!/usr/bin/env bun
// Provenance: the median, the 0.1 s rounding and the per-cell tally of runs, timings and person-needed events are ported from
// gbrain-evals eval/runner/cat41/tthw-verdict.ts (commit 4f27313a, sha256 dba6e468d0a4861156e7c57cb73dc992a3900a64ba229ab9dbe4505ebd8282ec),
// MIT, same owner. Changes: cells are cell and arm of a harness-evals run, the finish line is install.outcome "recalled" with a Wilson
// 95% interval, time is the median and interquartile range of finish_ms, and there are no frozen targets here (the preregistration
// holds them).
//
// Per cell and arm of one run's trials.jsonl (the install field, scripts/gbrain-install/README.md):
//   bun scripts/gbrain-install/verdict.ts <run dir> [--json]
// Counted runs are all runs but those docs/methodology.md item 9 excludes (model_error, infra_error, exam_fault), an adapter's
// HE-INSTALL-003 refusal (the cell was set up wrong) and an infra classification; the rest are listed apart with the reason. A
// timeout or another harness_error counts as a run that missed the finish line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialInstall, TrialRecord } from '../../runner/contracts.ts';

/** The fields of a trials.jsonl record these scripts read, on a trial that carries an install field. */
export type InstallTrialRecord = Pick<TrialRecord, 'trial_id' | 'cell' | 'harness' | 'model' | 'wall_ms' | 'started_at' | 'error'> & { termination: string; paths?: Record<string, string>; install: TrialInstall };

/** The install trials of a run directory: trials.jsonl records that carry an install field. */
export function readTrials(runDir: string): InstallTrialRecord[] {
  return readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(r => r && r.install);
}

const EXCLUDED_TERMINATIONS = ['model_error', 'infra_error', 'exam_fault'];

/** Why a trial is not counted, or null when it is: an excluded termination, an HE-INSTALL-003 refusal, or an infra classification. */
export function excludedReason(r: InstallTrialRecord): string | null {
  if (EXCLUDED_TERMINATIONS.includes(r.termination)) return r.termination;
  if (r.error?.startsWith('HE-INSTALL-003')) return 'harness_error: HE-INSTALL-003';
  return r.install.classification?.infra ? `infra: ${r.install.classification.infra}` : null;
}

/** Wilson score interval for k successes in n trials (z 1.96 for 95%); null when n is 0. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };

/** Linear-interpolation quantile (type 7, the R and NumPy default); null for an empty list. */
export function quantile(xs: number[], q: number): number | null {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const h = (a.length - 1) * q, lo = Math.floor(h);
  return a[lo] + (h - lo) * ((a[lo + 1] ?? a[lo]) - a[lo]);
}

const s1 = (ms: number) => Math.round(ms / 100) / 10;

export interface CellVerdict {
  cell: string; arm: string; harness: string; model: string; runs: number; n: number;
  excluded: Array<{ trial_id: string; reason: string }>;
  finish: { k: number; n: number; lo: number | null; hi: number | null };
  finish_s: { median: number | null; q1: number | null; q3: number | null };
  agent_turns_median: number | null;
  person_needed: { events: number; by_kind: Record<string, number>; runs_with_none: number };
  harness_memory: number;
  /** The release pin, from what was installed, never from the commands typed: over counted runs with a tag, the first and the last
   *  gbrain version the probe saw on PATH (the 1-second watcher and the end-of-turn probe, classification.probe_versions) when it was
   *  not the pinned release, and the runs where no gbrain version was seen at all. */
  pin: { first_version_off_pin: number; last_version_off_pin: number; no_version_seen: number };
  non_harness_requests: number;
  hinted: { ran: number; recalled: number };
}

export function verdict(records: InstallTrialRecord[]): CellVerdict[] {
  const keys = [...new Set(records.map(r => `${r.cell}\t${r.install.arm}`))].sort();
  return keys.map(key => {
    const rs = records.filter(r => `${r.cell}\t${r.install.arm}` === key).sort((a, b) => a.trial_id.localeCompare(b.trial_id));
    const counted = rs.filter(r => excludedReason(r) === null);
    const done = counted.filter(r => r.install.outcome === 'recalled');
    const w = wilson(done.length, counted.length);
    const times = done.map(r => r.install.finish_ms).filter((x): x is number => typeof x === 'number');
    const byKind: Record<string, number> = {};
    for (const p of counted.flatMap(r => r.install.classification.person_needed)) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    const q = (p: number) => { const x = quantile(times, p); return x === null ? null : s1(x); };
    const hinted = counted.filter(r => r.install.hinted.ran);
    const pinned = counted.filter(r => !!r.install.tag);
    return {
      cell: rs[0].cell, arm: rs[0].install.arm, harness: rs[0].harness, model: rs[0].model, runs: rs.length, n: counted.length,
      excluded: rs.filter(r => excludedReason(r) !== null).map(r => ({ trial_id: r.trial_id, reason: excludedReason(r)! })),
      finish: { k: done.length, n: counted.length, lo: w?.lo ?? null, hi: w?.hi ?? null },
      finish_s: { median: q(0.5), q1: q(0.25), q3: q(0.75) },
      agent_turns_median: median(counted.map(r => r.install.agent_turns)),
      person_needed: { events: Object.values(byKind).reduce((a, b) => a + b, 0), by_kind: byKind, runs_with_none: counted.filter(r => r.install.classification.person_needed.length === 0).length },
      harness_memory: counted.filter(r => r.install.outcome === 'harness-memory').length,
      pin: {
        first_version_off_pin: pinned.filter(r => { const v = r.install.classification.probe_versions?.first; return !!v && v !== pinVersion(r); }).length,
        last_version_off_pin: pinned.filter(r => { const v = r.install.classification.probe_versions?.last; return !!v && v !== pinVersion(r); }).length,
        no_version_seen: pinned.filter(r => !r.install.classification.probe_versions?.first).length,
      },
      non_harness_requests: counted.reduce((a, r) => a + (r.install.non_harness_requests ?? 0), 0),
      hinted: { ran: hinted.length, recalled: hinted.filter(r => r.install.hinted.reply && r.install.hinted.gbrain_call).length },
    };
  });
}

const pinVersion = (r: InstallTrialRecord) => r.install.tag.replace(/^v/, '');

const pct = (x: number | null) => x === null ? 'n/a' : `${Math.round(x * 100)}%`;

export function verdictMarkdown(cells: CellVerdict[]): string {
  const out = ['| Cell | Arm | n | Finish line (95% interval) | Seconds to finish, median (IQR) | Agent turns, median | Runs needing no person | Person-needed events (reply, blocked step, question) | Harness memory | First gbrain version not the pin | Last gbrain version not the pin | No gbrain version seen | Non-harness provider requests | Hinted recall (descriptive) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const c of cells) {
    const k = c.person_needed.by_kind;
    out.push(`| ${c.cell} | ${c.arm} | ${c.n} | ${c.finish.k}/${c.finish.n} (${pct(c.finish.lo)} to ${pct(c.finish.hi)}) | ${c.finish_s.median ?? 'n/a'} (${c.finish_s.q1 ?? 'n/a'} to ${c.finish_s.q3 ?? 'n/a'}) | ${c.agent_turns_median ?? 'n/a'} | ${c.person_needed.runs_with_none}/${c.n} | ${c.person_needed.events} (${k['scripted-reply'] ?? 0}, ${k['blocked-step'] ?? 0}, ${k.question ?? 0}) | ${c.harness_memory} | ${c.pin.first_version_off_pin} | ${c.pin.last_version_off_pin} | ${c.pin.no_version_seen} | ${c.non_harness_requests} | ${c.hinted.recalled}/${c.hinted.ran} |`);
  }
  const excluded = cells.flatMap(c => c.excluded.map(e => `- ${e.trial_id}: ${e.reason}`));
  if (excluded.length) out.push('', 'Not counted:', ...excluded);
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--'));
  if (!dir) { console.error('usage: bun scripts/gbrain-install/verdict.ts <run dir> [--json]'); process.exit(2); }
  const cells = verdict(readTrials(dir));
  process.stdout.write(args.includes('--json') ? JSON.stringify(cells, null, 2) + '\n' : verdictMarkdown(cells));
}
