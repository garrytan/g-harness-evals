#!/usr/bin/env bun
/**
 * R126 check of the blind "lookup" readers (internal-task, 2026-11-25): each flagged trial's reader verdict against
 * audit.ts's own deterministic signals in the run's audit.json. The construction label is yes when the trial received
 * answer-key lines ("answer key received") or asked for a benchmark source ("benchmark source requested"); a canary
 * alone is no. Costs nothing: it reads committed files only.
 *
 *   bun scripts/corrections/check-lookup-readers.ts [--json]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', 'docs', 'benchmarks');
const RUNS = [
  { run: 'particle-swap a1', audit: '2026-11-09-particle-swap/results/a1/audit.json', reader: '2026-11-09-particle-swap/results/a1/lookup-fails.json' },
  { run: 'particle-swap codegen', audit: '2026-11-09-particle-swap/results/codegen/audit.json', reader: '2026-11-09-particle-swap/results/codegen/lookup-fails.json' },
  { run: 'frontier-harness', audit: '2026-11-07-frontier-harness/results/audit.json', reader: '2026-11-07-frontier-harness/results/lookup-fails.json' },
];
const KEY = new Set(['answer key received', 'benchmark source requested']);

interface Trial { trial_id: string; task: string; grade: string; signals: string[]; received: unknown[]; requested: number }
const out = RUNS.map((r) => {
  const audit = JSON.parse(readFileSync(join(ROOT, r.audit), 'utf8')) as { trials: Trial[] };
  const reader = JSON.parse(readFileSync(join(ROOT, r.reader), 'utf8')) as { trial_ids: string[]; verdicts?: Record<string, { verdict: string }> };
  const yes = new Set(reader.trial_ids);
  const flagged = audit.trials.filter((t) => t.signals.length);
  const unflagged = reader.trial_ids.filter((id) => !flagged.some((t) => t.trial_id === id));
  if (unflagged.length) throw new Error(r.run + ': reader ids the audit did not flag: ' + unflagged.join(', '));
  const rows = flagged.map((t) => ({ trial: t.trial_id, task: t.task, grade: t.grade, signals: t.signals, construction: t.signals.some((s) => KEY.has(s)) ? 'yes' : 'no',
    reader: reader.verdicts ? (reader.verdicts[t.trial_id]?.verdict ?? 'missing') : yes.has(t.trial_id) ? 'yes' : 'no' }));
  const table: Record<string, number> = {};
  for (const x of rows) table['construction ' + x.construction + ' | reader ' + x.reader] = (table['construction ' + x.construction + ' | reader ' + x.reader] ?? 0) + 1;
  return { run: r.run, flags: rows.length, reader_yes: rows.filter((x) => x.reader === 'yes').length, agree: rows.filter((x) => x.reader === x.construction).length, table,
    disagreements: rows.filter((x) => x.reader !== x.construction) };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else for (const o of out) {
  console.log(o.run + ': reader agrees with the construction label on ' + o.agree + ' of ' + o.flags + ' flags (reader yes on ' + o.reader_yes + ')');
  for (const [k, v] of Object.entries(o.table)) console.log('  ' + k + ': ' + v);
  for (const d of o.disagreements) console.log('  differs: ' + d.trial + ' (' + d.grade + '; signals ' + d.signals.join(', ') + '; construction ' + d.construction + ', reader ' + d.reader + ')');
}
