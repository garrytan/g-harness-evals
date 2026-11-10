// The input check every scorer runs on a run's trials.jsonl before it scores (methodology item 12: JSONL schema,
// uniqueness and membership are validated before scoring). Used by summarize-run.ts, compare-run.ts, matrix-analysis.ts
// and frontier-harbor/analyze.ts.
//
// A record is malformed when it is not an object, when trial_id, cell or task is not a non-empty string, when termination
// is not one of runner/contracts.ts Termination, when grade is not pass, fail or n/a, when consent_violation is not a
// boolean, or when usage is neither null nor an object with a finite usd. A trial id recorded twice is refused. With the
// run's manifest (its trials list, which runner/run.ts plan writes), a record the manifest does not plan is refused, and so
// is one whose cell or task differs from the planned trial's. Without a manifest, or with one whose trials list is missing
// or empty (a hand-built fixture; every manifest runner/run.ts plan writes plans at least one trial), only the schema and
// uniqueness are checked. A problem names the trial id (or the
// record's position among the file's records when it has none), never a record's other content.

import type { Termination } from '../runner/contracts.ts';

export const TERMINATIONS: readonly Termination[] = ['completed', 'timeout', 'approval_stop', 'harness_error', 'model_error', 'infra_error', 'exam_fault'];
const GRADES = ['pass', 'fail', 'n/a'];

export interface PlannedTrials { trials?: Array<{ id: string; cell: string; task?: string }> }

export function validateRecords(records: unknown[], manifest: PlannedTrials | null): string[] {
  const planned = manifest?.trials?.length ? new Map(manifest.trials.map((t) => [t.id, t])) : null;
  const seen = new Set<string>();
  const problems: string[] = [];
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  records.forEach((raw, i) => {
    const t = raw as Record<string, unknown> | null;
    if (!t || typeof t !== 'object' || Array.isArray(t)) { problems.push(`record ${i + 1} is not a JSON object`); return; }
    const id = text(t.trial_id) ? String(t.trial_id) : null;
    const usage = t.usage as { usd?: unknown } | null | undefined;
    const bad = [
      ...(id ? [] : ['trial_id']), ...(text(t.cell) ? [] : ['cell']), ...(text(t.task) ? [] : ['task']),
      ...(TERMINATIONS.includes(t.termination as Termination) ? [] : ['termination']),
      ...(GRADES.includes(t.grade as string) ? [] : ['grade']),
      ...(typeof t.consent_violation === 'boolean' ? [] : ['consent_violation']),
      ...(usage === null || (typeof usage === 'object' && !Array.isArray(usage) && Number.isFinite(usage.usd)) ? [] : ['usage']),
    ];
    if (bad.length) problems.push(`${id ? `trial ${id}` : `record ${i + 1}`} is malformed (${bad.join(', ')})`);
    if (!id) return;
    if (seen.has(id)) problems.push(`trial ${id} is recorded twice`);
    seen.add(id);
    if (!planned) return;
    const p = planned.get(id);
    if (!p) problems.push(`trial ${id} is not in the manifest`);
    else if (p.cell !== t.cell || (p.task !== undefined && p.task !== t.task)) problems.push(`trial ${id} is recorded as cell ${t.cell}, task ${t.task}; the manifest plans cell ${p.cell}, task ${p.task}`);
  });
  return problems;
}

/** The problems on one line: the first ten, then how many more. */
export const describeProblems = (problems: string[]) => `${problems.slice(0, 10).join('; ')}${problems.length > 10 ? `; and ${problems.length - 10} more` : ''}`;
