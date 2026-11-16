#!/usr/bin/env bun
// The per-step failure table the gbrain maintainers fix from, worst step first (plan "Decisions each outcome drives"). New code, no Cat 41 counterpart.
//
//   bun scripts/gbrain-install/failure-table.ts <run dir> [--arm bare|paste] [--md <file>] [--csv <file>]
// Markdown goes to stdout unless --md names a file; --csv also writes CSV. One row per step (binary, brain, wired, saved, recalled)
// over the counted runs (verdict.ts): the runs that failed at that step, the person-needed events tagged with it, the most common last
// gbrain error codes of those failed runs, two example trial ids, and two empty columns, "as read" and "reader note", for the
// independent agent reader. A failed run's step is died_at_step when the probe never passed, else saved when the save turn made no
// successful gbrain call, else recalled.
import { writeFileSync } from 'node:fs';
import { RUN_STEPS, type RunStep } from './steps.ts';
import { excludedReason, readTrials, type InstallTrialRecord } from './verdict.ts';

export interface FailureRow { step: RunStep; failed_runs: number; person_needed: number; top_codes: Array<{ code: string; runs: number }>; examples: string[]; as_read: string; reader_note: string }

/** The step a counted run failed at, or null when it reached the finish line. */
export function failedStep(r: InstallTrialRecord): RunStep | null {
  if (r.install.outcome === 'recalled') return null;
  const c = r.install.classification;
  if (c.died_at_step && (RUN_STEPS as readonly string[]).includes(c.died_at_step)) return c.died_at_step as RunStep;
  return c.steps.saved_ms === null ? 'saved' : 'recalled';
}

export function failureTable(records: InstallTrialRecord[], arm?: string): FailureRow[] {
  const counted = records.filter(r => excludedReason(r) === null && (!arm || r.install.arm === arm)).sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  return RUN_STEPS.map(step => {
    const failed = counted.filter(r => failedStep(r) === step);
    const codes = new Map<string, number>();
    for (const r of failed) { const code = r.install.classification.last_gbrain_code; if (code) codes.set(code, (codes.get(code) ?? 0) + 1); }
    return {
      step, failed_runs: failed.length,
      person_needed: counted.reduce((a, r) => a + r.install.classification.person_needed.filter(p => p.step === step).length, 0),
      top_codes: [...codes].map(([code, runs]) => ({ code, runs })).sort((a, b) => b.runs - a.runs || a.code.localeCompare(b.code)).slice(0, 3),
      examples: failed.slice(0, 2).map(r => r.trial_id), as_read: '', reader_note: '',
    };
  });
}

const codesText = (r: FailureRow) => r.top_codes.map(c => `${c.code} (${c.runs})`).join(', ');
const md = (s: string) => s.replace(/\|/g, '\\|');
const csvField = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

export function failureMarkdown(rows: FailureRow[]): string {
  const out = ['| Step | Failed runs | Person-needed events | Top last gbrain codes | Example trials | As read | Reader note |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) out.push(`| ${r.step} | ${r.failed_runs} | ${r.person_needed} | ${md(codesText(r))} | ${md(r.examples.join(', '))} | ${md(r.as_read)} | ${md(r.reader_note)} |`);
  return out.join('\n') + '\n';
}

export function failureCsv(rows: FailureRow[]): string {
  const out = ['step,failed_runs,person_needed,top_last_gbrain_codes,example_trials,as_read,reader_note'];
  for (const r of rows) out.push([r.step, String(r.failed_runs), String(r.person_needed), codesText(r), r.examples.join(' '), r.as_read, r.reader_note].map(csvField).join(','));
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--md', '--csv', '--arm'].includes(args[i - 1]));
  if (!dir) { console.error('usage: bun scripts/gbrain-install/failure-table.ts <run dir> [--arm bare|paste] [--md <file>] [--csv <file>]'); process.exit(2); }
  const rows = failureTable(readTrials(dir), opt('--arm'));
  const mdFile = opt('--md'), csvFile = opt('--csv');
  if (mdFile) writeFileSync(mdFile, failureMarkdown(rows)); else process.stdout.write(failureMarkdown(rows));
  if (csvFile) writeFileSync(csvFile, failureCsv(rows));
}
