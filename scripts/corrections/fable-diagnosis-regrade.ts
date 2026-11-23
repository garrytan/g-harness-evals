#!/usr/bin/env bun
// Rebuilds every number in docs/corrections/2026-11-23/ from committed receipts, keyless: the fable-diagnosis run's
// merged trial list and labels, and docs/corrections/2026-11-23/regrade.jsonl (one line per try: its recorded grade, the
// grade of its replayed diff on the task's own tests, its grade on the stronger tests, and the two blind reads of every
// try that failed either). It reruns scripts/frontier-harbor/feature-split.ts's own analyze() on re-graded copies of the
// trial list, in which only the grade changes, so seeds, draws and cost figures are the published analysis's.
//
//   bun scripts/corrections/fable-diagnosis-regrade.ts --out <sensitivity.json>
//
// Readings: published (as recorded); stronger tests (a try passes when its replayed diff passes the task's own tests and
// the stronger tests; a try whose replay did not reproduce its recorded grade keeps the recorded grade); stronger tests
// plus reads (as before, and a failing try also passes when both readers called it a correct fix failed only by a test
// flaw); and both re-graded readings without the tasks whose replay did not reproduce a recorded grade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { analyze } from '../frontier-harbor/feature-split.ts';

const ROOT = join(import.meta.dir, '..', '..');
const RUN = join(ROOT, 'docs/benchmarks/2026-11-14-fable-diagnosis');
const DIR = join(ROOT, 'docs/corrections/2026-11-23');
type Row = { task: string; model: string; attempt: string; recorded: 0 | 1; replay: 0 | 1; stronger: 0 | 1; read_opus: string | null; read_astra: string | null };

export function load() {
  const trials = readFileSync(join(RUN, 'results/merged/trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
  const labels = JSON.parse(readFileSync(join(RUN, 'labels.json'), 'utf8')).tasks;
  const rows = readFileSync(join(DIR, 'regrade.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
  return { trials, labels, rows };
}

const id = (task: string, model: string, attempt: string) => task + '|' + model + '|' + attempt;
const mismatch = (r: Row) => r.replay !== r.recorded;
const g1 = (r: Row) => (mismatch(r) ? r.recorded : r.replay === 1 && r.stronger === 1 ? 1 : 0);
const g2 = (r: Row) => (g1(r) === 1 || (!mismatch(r) && r.read_opus === 'flaw' && r.read_astra === 'flaw') ? 1 : 0);

function regraded(trials: readonly TrialRecord[], rows: readonly Row[], grade: (r: Row) => 0 | 1): TrialRecord[] {
  const by = new Map(rows.map((r) => [id(r.task, r.model, r.attempt), r]));
  return trials.map((t) => {
    const r = by.get(id(t.task, t.model, t.trial_id.split('/').pop()!));
    if (!r) throw new Error('no regrade row for ' + t.trial_id);
    return { ...t, grade: grade(r) ? 'pass' : 'fail' } as TrialRecord;
  });
}

function compact(a: ReturnType<typeof analyze>) {
  const g = (x: any) => ({
    tasks: x.tasks,
    pass_rate: { fable: x.pass_rate['Fable 5.2'].estimate, opus: x.pass_rate['Opus 5.5'].estimate },
    difference: { delta: x.difference.delta, ci95: x.difference.ci95 },
    mde80: x.power.mde,
    fable_lower_same_higher: [x.lower.length, x.same, x.higher.length],
    cost_per_solve: { fable: x.cost_per_solve['Fable 5.2'].usd_per_solve, opus: x.cost_per_solve['Opus 5.5'].usd_per_solve },
    cost_ratio: { ratio: x.cost_ratio.ratio, ci95: x.cost_ratio.ci95 },
    extra_cost_per_extra_solve: { usd: x.extra_cost_per_extra_solve.usd_per_extra_solve, ci95: x.extra_cost_per_extra_solve.ci95 },
    reading: x.reading,
  });
  return { all: g(a.groups.all), diagnosis: g(a.groups.diagnosis), pointed: g(a.groups.pointed), interaction: { estimate: a.interaction.estimate, ci95: a.interaction.ci95 }, prediction: a.prediction };
}

export function build() {
  const { trials, labels, rows } = load();
  const mm = rows.filter(mismatch);
  const keep = [...new Set(rows.map((r) => r.task))].filter((t) => !mm.some((r) => r.task === t)).sort();
  const read = rows.filter((r) => !mismatch(r) && (r.replay === 0 || r.stronger === 0));
  const cats = ['flaw', 'wrong', 'unclear'];
  const agree = read.filter((r) => r.read_opus === r.read_astra).length;
  const pe = cats.reduce((s, c) => s + (read.filter((r) => r.read_opus === c).length / read.length) * (read.filter((r) => r.read_astra === c).length / read.length), 0);
  const pairs: Record<string, number> = {};
  for (const r of read) pairs[r.read_opus + ' / ' + r.read_astra] = (pairs[r.read_opus + ' / ' + r.read_astra] ?? 0) + 1;
  const byModel = (rs: Row[]) => ({ fable: rs.filter((r) => r.model.includes('fable')).length, opus: rs.filter((r) => r.model.includes('opus')).length });
  const recordedPass = rows.filter((r) => !mismatch(r) && r.recorded === 1);
  return {
    about: 'docs/corrections/2026-11-23/README.md. Rates are shares (0.079 is 7.9 points); intervals come from feature-split.ts analyze() with its seed 20261114 and 10,000 draws. Rebuild: bash scripts/corrections/reproduce-2026-11-23.sh <scratch dir> --check.',
    counts: {
      tries: rows.length,
      replay_reproduced_recorded_grade: rows.length - mm.length,
      replay_mismatches: mm.map((r) => ({ task: r.task, model: r.model, attempt: r.attempt, recorded: r.recorded, replay: r.replay })),
      recorded_passes: byModel(rows.filter((r) => r.recorded === 1)),
      recorded_passes_replay_reproduced: byModel(recordedPass),
      recorded_passes_failing_stronger_tests: byModel(recordedPass.filter((r) => r.stronger === 0)),
      stronger_test_passes: byModel(rows.filter((r) => !mismatch(r) && g1(r) === 1)),
      tries_read: byModel(read),
      reads_agree: agree,
      reads_kappa: (agree / read.length - pe) / (1 - pe),
      read_pairs_opus_astra: pairs,
      both_reads_flaw: byModel(read.filter((r) => r.read_opus === 'flaw' && r.read_astra === 'flaw')),
      tasks_without_mismatches: keep.length,
    },
    readings: {
      published: compact(analyze(trials, labels)),
      stronger_tests: compact(analyze(regraded(trials, rows, g1), labels)),
      stronger_tests_and_reads: compact(analyze(regraded(trials, rows, g2), labels)),
      stronger_tests_without_mismatched_tasks: compact(analyze(regraded(trials, rows, g1), labels, keep)),
      stronger_tests_and_reads_without_mismatched_tasks: compact(analyze(regraded(trials, rows, g2), labels, keep)),
    },
  };
}

if (import.meta.main) {
  const i = process.argv.indexOf('--out');
  if (i < 0 || !process.argv[i + 1]) { console.error('usage: fable-diagnosis-regrade.ts --out <sensitivity.json>'); process.exit(2); }
  writeFileSync(process.argv[i + 1]!, JSON.stringify(build(), null, 1) + '\n');
}
