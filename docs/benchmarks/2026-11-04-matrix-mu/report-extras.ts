#!/usr/bin/env bun
// The report's numbers that scripts/matrix-analysis.ts does not print, from the committed receipts, keyless:
//
//   bun docs/benchmarks/2026-11-04-matrix-mu/report-extras.ts [--check]
//
// Inputs: results/trials.jsonl and matrix-spec.json beside this script. Output: results/report-extras.json.
// With --check it writes nothing and exits 1 when the output differs from what is on disk.
//
// - Cost per pass with an interval, per cell: recorded-trial USD (excluded trials included) over scored passes,
//   tasks resampled with replacement (the spec's seed and draws). It uses each record's own USD, so it leaves out
//   charged rows logged after a trial's meter closed, which matrix-analysis.ts adds to its USD total.
// - Minimum detectable difference per comparison: runner/stats/paired.ts powerNote (80% power, two-sided) on the
//   same per-task pairs matrix-analysis.ts uses, at alpha 0.05 and at the first Holm step's alpha (0.05 / 6).
// - Which tasks separate any cell: tasks every cell passed on every scored repetition, tasks no cell ever passed,
//   and for each comparison the tasks whose two task means differ.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, powerNote, seededRandom } from '../../../runner/stats/paired.ts';

const DIR = 'docs/benchmarks/2026-11-04-matrix-mu';
const OUT = join(DIR, 'results', 'report-extras.json');
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);

interface Trial { cell: string; task: string; termination: string; grade: string; consent_violation: boolean; usage?: { usd?: number } }
interface Pair { id: string; a: string; b: string }
const spec = JSON.parse(readFileSync(join(DIR, 'matrix-spec.json'), 'utf8')) as { seed: number; draws: number; primary_family_size: number; cells: Array<{ id: string; label: string }>; primary: Pair[]; secondary: Pair[] };
const trials = readFileSync(join(DIR, 'results', 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Trial);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

type TaskStat = { usd: number; passes: number; scored: number };
const byCell = new Map<string, Map<string, TaskStat>>();
for (const t of trials) {
  const tasks = byCell.get(t.cell) ?? new Map<string, TaskStat>();
  const s = tasks.get(t.task) ?? { usd: 0, passes: 0, scored: 0 };
  s.usd += t.usage?.usd ?? 0;
  if (!EXCLUDED.has(t.termination)) {
    s.scored += 1;
    if (t.grade === 'pass' && !t.consent_violation) s.passes += 1;
  }
  tasks.set(t.task, s);
  byCell.set(t.cell, tasks);
}
const taskMeans = (cell: string) => new Map([...byCell.get(cell)!].filter(([, s]) => s.scored > 0).map(([task, s]) => [task, s.passes / s.scored]));

const cells = spec.cells.map(({ id, label }) => {
  const stats = [...byCell.get(id)!.values()];
  const usd = stats.reduce((x, s) => x + s.usd, 0), passes = stats.reduce((x, s) => x + s.passes, 0);
  const rnd = seededRandom(spec.seed);
  const boot: number[] = [];
  for (let i = 0; i < spec.draws; i++) {
    let u = 0, p = 0;
    for (let j = 0; j < stats.length; j++) { const s = stats[Math.floor(rnd() * stats.length)]!; u += s.usd; p += s.passes; }
    if (p > 0) boot.push(u / p);
  }
  boot.sort((x, y) => x - y);
  return { id, label, recorded_trial_usd: r4(usd), scored_passes: passes, usd_per_pass: r4(usd / passes), ci95: [r4(boot[Math.floor(boot.length * 0.025)]!), r4(boot[Math.ceil(boot.length * 0.975) - 1]!)], draws_with_a_pass: boot.length };
});

const compare = (c: Pair) => {
  const a = taskMeans(c.a), b = taskMeans(c.b);
  const items = [...a.keys()].filter((t) => b.has(t)).sort().map((t) => ({ id: t, cluster: t, a: a.get(t)!, b: b.get(t)! }));
  const d = clusteredPairedDelta(items, { seed: spec.seed, draws: spec.draws });
  const mdd = (alpha: number) => { const m = powerNote(d, { alpha }).mde; return m === null ? null : r4(m); };
  return { id: c.id, a: c.a, b: c.b, tasks_paired: d.n_pairs, delta: r4(d.delta), mdd_alpha_0_05: mdd(0.05), mdd_first_holm_step: mdd(0.05 / spec.primary_family_size), tasks_that_differ: items.filter((i) => i.a !== i.b).map((i) => i.id) };
};

const allTasks = [...new Set(trials.map((t) => t.task))].sort();
const everyCell = (pred: (m: number) => boolean) => allTasks.filter((t) => spec.cells.every(({ id }) => { const m = taskMeans(id).get(t); return m === undefined || pred(m); }));
const out = {
  run_id: 'matrix-mu-2026-11',
  generator: DIR + '/report-extras.ts',
  seed: spec.seed,
  draws: spec.draws,
  cells,
  tasks: { total: allTasks.length, passed_every_rep_in_every_cell: everyCell((m) => m === 1), never_passed_in_any_cell: everyCell((m) => m === 0) },
  primary: spec.primary.map(compare),
  secondary: spec.secondary.map(compare),
};
const text = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
  console.log(same ? OUT + ': up to date' : OUT + ': differs');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text);
console.log('wrote ' + OUT);
