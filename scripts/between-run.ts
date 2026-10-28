// Between-run table of a rerun against an earlier run on the same tasks, descriptive (gbrain-memory-fix-2026-10b's
// preregistration, Endpoints item 4): per cell, passes over the shared tasks with each run's own task-clustered 95%
// interval, the none cells first as the run-to-run drift, and the task x cell matrix of passes. No difference interval
// and no test: the runs share no pairing, so compare-run.ts --against, which pairs repetitions by index, is not used.
//
//   bun scripts/between-run.ts --results <this run> --against <earlier run> --cell-suffix <this>=<earlier>
//                              [--tasks a,b,...] [--seed 7] [--draws 10000] [--out <dir>]
//
// A cell of this run is matched to the earlier run's cell whose id has this run's suffix replaced by the earlier one
// (--cell-suffix -mu-memory-fix=-mu-memory). The tasks default to the tasks of this run's trials; the earlier run is
// restricted to them. Pass and the interval are summarize-run.ts's: grade pass with no consent violation, trials that ended
// model_error, infra_error or exam_fault left out of n, tasks resampled with replacement under a seeded generator.
// Prints Markdown and, with --out, writes between-run.json and between-run.md there.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRandom } from '../runner/stats/paired.ts';

export type Trial = { trial_id: string; cell: string; task: string; termination: string; grade: string; consent_violation?: boolean };
export type Tally = { n: number; passes: number; excluded: number; rate: number; lower: number; upper: number; clusters: number };
export type CellRow = {
  cell: string; against_cell: string; none: boolean; this: Tally; against: Tally;
  per_task: Record<string, { this: [number, number]; against: [number, number] }>;
};

const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const passed = (t: Trial) => t.grade === 'pass' && !t.consent_violation;

export function tally(all: Trial[], seed = 7, draws = 10_000): Tally {
  const ts = all.filter((t) => !EXCLUDED.has(t.termination));
  const byTask = new Map<string, Trial[]>();
  for (const t of ts) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
  const tasks = [...byTask.values()];
  const rateOf = (sample: Trial[][]) => { const flat = sample.flat(); return flat.length ? flat.filter(passed).length / flat.length : 0; };
  const rnd = seededRandom(seed);
  const stats: number[] = [];
  for (let i = 0; i < draws && tasks.length; i++) stats.push(rateOf(tasks.map(() => tasks[Math.floor(rnd() * tasks.length)]!)));
  stats.sort((a, b) => a - b);
  return {
    n: ts.length, passes: ts.filter(passed).length, excluded: all.length - ts.length, rate: rateOf(tasks),
    lower: stats[Math.floor(0.025 * draws)] ?? 0, upper: stats[Math.min(draws - 1, Math.ceil(0.975 * draws))] ?? 0, clusters: tasks.length,
  };
}

export function betweenRun(mine: Trial[], theirs: Trial[], suffix: [string, string], tasks: string[], seed = 7, draws = 10_000): CellRow[] {
  const keep = new Set(tasks);
  for (const [ts, which] of [[mine, 'this run'], [theirs, 'the earlier run']] as const) {
    const known = new Set(ts.map((t) => t.task));
    for (const task of tasks) if (!known.has(task)) throw new Error(`task ${task} has no trial in ${which}`);
  }
  return [...new Set(mine.map((t) => t.cell))].map((cell) => {
    if (!cell.endsWith(suffix[0])) throw new Error(`cell ${cell} does not end with ${suffix[0]}`);
    const against = cell.slice(0, cell.length - suffix[0].length) + suffix[1];
    const a = mine.filter((t) => t.cell === cell && keep.has(t.task));
    const b = theirs.filter((t) => t.cell === against && keep.has(t.task));
    if (!b.length) throw new Error(`no trials of ${against} on these tasks in the earlier run`);
    const count = (ts: Trial[], task: string): [number, number] => {
      const kept = ts.filter((t) => t.task === task && !EXCLUDED.has(t.termination));
      return [kept.filter(passed).length, kept.length];
    };
    return {
      cell, against_cell: against, none: /-none-/.test(cell), this: tally(a, seed, draws), against: tally(b, seed, draws),
      per_task: Object.fromEntries(tasks.map((task) => [task, { this: count(a, task), against: count(b, task) }])),
    };
  });
}

const pct = (x: number) => (100 * x).toFixed(0);
const ci = (t: Tally) => `${t.passes} of ${t.n}, ${pct(t.rate)}% [${pct(t.lower)}, ${pct(t.upper)}]${t.excluded ? ` (${t.excluded} excluded)` : ''}`;
const short = (task: string) => task.split('-').slice(0, 2).join('-');

export function markdown(rows: CellRow[], tasks: string[], names: [string, string]): string {
  const out: string[] = [];
  const reps = Math.max(...rows.flatMap((r) => Object.values(r.per_task).flatMap((c) => [c.this[1], c.against[1]])));
  const frac = ([p, n]: [number, number]) => (n === reps ? `${p}` : `${p}/${n}`);
  const table = (sel: CellRow[]) => {
    out.push(`| Cell | ${names[0]}: passes, rate [95% CI, task-clustered] | ${names[1]}: passes, rate [95% CI, task-clustered] | Passes, difference |`);
    out.push('|---|---|---|---:|');
    for (const r of sel) {
      const d = r.this.passes - r.against.passes;
      out.push(`| ${r.cell} | ${ci(r.this)} | ${ci(r.against)} | ${d > 0 ? '+' : ''}${d} |`);
    }
  };
  out.push('None cells, the run-to-run drift the live cells are read against:', '');
  table(rows.filter((r) => r.none));
  out.push('', 'All cells:', '');
  table(rows);
  out.push('', `Passes of ${reps} per task, ${names[0]} (${names[1]} in brackets):`, '');
  out.push(`| Cell | ${tasks.map(short).join(' | ')} |`);
  out.push(`|---|${tasks.map(() => '---:').join('|')}|`);
  for (const r of rows) out.push(`| ${r.cell} | ${tasks.map((t) => `${frac(r.per_task[t]!.this)} (${frac(r.per_task[t]!.against)})`).join(' | ')} |`);
  return out.join('\n') + '\n';
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const load = (dir: string): Trial[] => readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Trial);

if (import.meta.main) {
  const results = arg('results'), against = arg('against'), suffix = arg('cell-suffix')?.split('=');
  if (!results || !against || suffix?.length !== 2 || !existsSync(join(results, 'trials.jsonl')) || !existsSync(join(against, 'trials.jsonl'))) {
    console.error('usage: bun scripts/between-run.ts --results <this run> --against <earlier run> --cell-suffix <this>=<earlier> [--tasks a,b] [--seed 7] [--draws 10000] [--out <dir>]');
    process.exit(2);
  }
  const mine = load(results), theirs = load(against);
  const tasks = arg('tasks')?.split(',') ?? [...new Set(mine.map((t) => t.task))];
  const seed = Number(arg('seed', '7')), draws = Number(arg('draws', '10000'));
  const runOf = (ts: Trial[]) => ts[0]?.trial_id.split('/')[0] ?? '?';
  const names: [string, string] = [runOf(mine), runOf(theirs)];
  const rows = betweenRun(mine, theirs, [suffix[0]!, suffix[1]!], tasks, seed, draws);
  const md = markdown(rows, tasks, names);
  process.stdout.write(md);
  const out = arg('out');
  if (out) {
    writeFileSync(join(out, 'between-run.json'), JSON.stringify({ run: names[0], against: names[1], tasks, seed, draws, cells: rows }, null, 2) + '\n');
    writeFileSync(join(out, 'between-run.md'), md);
  }
}
