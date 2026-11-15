#!/usr/bin/env bun
// The regression canary's baseline report (PREREGISTRATION.md, "The baseline"): from one suite's baseline T2 trials, per
// model, the real screen (previous against new, paired by task and attempt), the flip rate per arm, the measured false
// alarms (the T2 rule on every pair of attempts within one release arm), the modelled false alarms and power at the measured
// flip rate (simulate.ts), the plain-arm headroom and the exposure rates per release arm.
//
//   bun scripts/canary/baseline-report.ts --suite gstack|gbrain --trials <trials.jsonl> --prev-sha <sha> --prev-version <v>
//     --new-sha <sha> --new-version <v> [--prereg <prereg-canary.json>] [--tasks <tasks.json>] [--draws 10000] [--out <file.json>]
//
// Prints the report as JSON (and writes it to --out). The pass-rate statistics use decide.ts's own functions, and every
// same-release pair goes through decide() as a T2 tier, so a false alarm is exactly what the nightly rule would have flagged.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decide, isExcluded, passed, readTrials, type Arm, type CanaryTrial, type ModelKey, type Suite, type TasksFile, type Thresholds } from './decide.ts';
import { table } from './simulate.ts';

const DIR = join(resolve(import.meta.dir, '../..'), 'docs/benchmarks/2026-11-09-regression-canary');
const FRONTIER: readonly ModelKey[] = ['opus', 'sol'];

/** Wilson 95% interval for k of n. */
export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.959964, p = k / n, d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export const attemptPairs = (attempts: readonly number[]): Array<[number, number]> =>
  attempts.flatMap((a, i) => attempts.slice(i + 1).map((b) => [a, b] as [number, number]));

/** Share of tasks whose pass or fail differs between attempts a and b of one arm, over tasks where neither is infra-class. */
export function flipShare(rows: readonly CanaryTrial[], tasks: readonly string[], a: number, b: number): { flips: number; tasks: number } {
  const at = (n: number) => new Map(rows.filter((t) => t.canary.attempt === n && tasks.includes(t.canary.task)).map((t) => [t.canary.task, t]));
  const x = at(a), y = at(b);
  let flips = 0, n = 0;
  for (const [task, t] of x) {
    const u = y.get(task);
    if (!u || isExcluded(t) || isExcluded(u)) continue;
    n++;
    if (passed(t) !== passed(u)) flips++;
  }
  return { flips, tasks: n };
}

const relabel = (t: CanaryTrial, arm: Arm): CanaryTrial => ({ ...t, canary: { ...t.canary, arm, attempt: 1 } });

export interface ModelBaseline {
  model: ModelKey; frontier: boolean; tasks: number;
  trials: Record<Arm, number>; infra: Record<Arm, number>;
  flip: Record<Arm, { pairs: Array<{ a: number; b: number; flips: number; tasks: number }>; rate: number | null }>;
  flip_release: number | null;
  plain: { pass: number; n: number; rate: number | null; ci95: [number, number] | null };
  pass: Record<'prev' | 'new', { pass: number; n: number; rate: number | null; ci95: [number, number] | null }>;
  exposure: Record<'prev' | 'new', { called: number; listed: number; n: number }>;
  plain_contaminated: number;
  false_alarms: Array<{ arm: 'prev' | 'new'; a: number; b: number; status: string; rules: string[] }>;
  modelled: { flip: number; screen_null: number; joint_null: number; joint_drop30: number; screen_drop30: number } | null;
}

export interface BaselineReport {
  schema: 'canary-baseline-report/1'; suite: Suite; release: { prev: { sha: string; version: string }; new: { sha: string; version: string } };
  real: { status: string; next: string; reasons: Array<{ rule: string; status: string; model?: string; detail: string }>; models: Record<string, unknown> };
  models: ModelBaseline[];
  suite_totals: { trials: number; infra: number; infra_share: number; same_release_pairs: number; false_alarms: number };
}

export function baselineReport(input: {
  suite: Suite; trials: CanaryTrial[]; tasks: TasksFile; thresholds: Thresholds; draws: number;
  release: BaselineReport['release'];
}): BaselineReport {
  const { suite, tasks, thresholds: th } = input;
  const rows = input.trials.filter((t) => t.canary?.suite === suite && t.canary.tier === 'T2');
  const models = (Object.keys(tasks.models) as ModelKey[]).filter((m) => rows.some((t) => t.canary.model_key === m));
  const real = decide({ suite, tier: 'T2', trials: rows, tasks, thresholds: th, expected: { arms: ['plain', 'prev', 'new'], models }, release: input.release, run_id: 'baseline-report' });
  const out: ModelBaseline[] = [];
  for (const mk of models) {
    const list = tasks.models[mk]!.tasks;
    const mine = rows.filter((t) => t.canary.model_key === mk);
    const arm = (a: Arm) => mine.filter((t) => t.canary.arm === a);
    const attempts = [...new Set(mine.map((t) => t.canary.attempt))].sort((a, b) => a - b);
    const flip = {} as ModelBaseline['flip'];
    for (const a of ['plain', 'prev', 'new'] as Arm[]) {
      const pairs = attemptPairs(attempts).map(([x, y]) => ({ a: x, b: y, ...flipShare(arm(a), list, x, y) }));
      const usable = pairs.filter((p) => p.tasks > 0);
      flip[a] = { pairs, rate: usable.length ? usable.reduce((s, p) => s + p.flips / p.tasks, 0) / usable.length : null };
    }
    const rel = [flip.prev.rate, flip.new.rate].filter((x): x is number => x !== null);
    const flipRelease = rel.length ? rel.reduce((s, x) => s + x, 0) / rel.length : null;
    const rate = (rs: CanaryTrial[]) => {
      const scored = rs.filter((t) => list.includes(t.canary.task) && !isExcluded(t));
      const k = scored.filter(passed).length;
      return { pass: k, n: scored.length, rate: scored.length ? k / scored.length : null, ci95: wilson(k, scored.length) };
    };
    const exposure = (rs: CanaryTrial[]) => {
      const s = rs.filter((t) => !isExcluded(t));
      return { called: s.filter((t) => (t.canary.exposure.product_calls ?? 0) > 0).length, listed: s.filter((t) => t.canary.exposure.first_request_has_product === true).length, n: s.length };
    };
    const falseAlarms: ModelBaseline['false_alarms'] = [];
    for (const a of ['prev', 'new'] as const) {
      const version = input.release[a];
      for (const [x, y] of attemptPairs(attempts)) {
        const pair = [...arm(a).filter((t) => t.canary.attempt === x).map((t) => relabel(t, 'prev')), ...arm(a).filter((t) => t.canary.attempt === y).map((t) => relabel(t, 'new'))];
        const v = decide({ suite, tier: 'T2', trials: pair, tasks, thresholds: th, expected: { arms: ['prev', 'new'], models: [mk] }, release: { prev: version, new: version }, run_id: 'baseline-report' });
        const rules = v.reasons.filter((r) => r.model === mk && r.status !== 'OK' && r.status !== 'INCOMPLETE').map((r) => r.rule);
        falseAlarms.push({ arm: a, a: x, b: y, status: v.status, rules });
      }
    }
    let modelled: ModelBaseline['modelled'] = null;
    if (FRONTIER.includes(mk) && flipRelease !== null) {
      const f = Math.min(flipRelease, 0.5);
      const mine2 = table(th, input.draws, f).filter((r) => r.suite === suite && r.model === mk);
      const at = (d: number) => mine2.find((r) => r.drop === d)!;
      modelled = { flip: f, screen_null: at(0).screen, joint_null: at(0).joint, screen_drop30: at(30).screen, joint_drop30: at(30).joint };
    }
    const plainRate = rate(arm('plain'));
    out.push({
      model: mk, frontier: FRONTIER.includes(mk), tasks: list.length,
      trials: { plain: arm('plain').length, prev: arm('prev').length, new: arm('new').length },
      infra: { plain: arm('plain').filter(isExcluded).length, prev: arm('prev').filter(isExcluded).length, new: arm('new').filter(isExcluded).length },
      flip, flip_release: flipRelease,
      plain: plainRate, pass: { prev: rate(arm('prev')), new: rate(arm('new')) },
      exposure: { prev: exposure(arm('prev')), new: exposure(arm('new')) },
      plain_contaminated: arm('plain').filter((t) => t.canary.exposure.first_request_has_product === true || (t.canary.exposure.product_calls ?? 0) > 0).length,
      false_alarms: falseAlarms, modelled,
    });
  }
  const frontier = out.filter((m) => m.frontier);
  const infra = rows.filter(isExcluded).length;
  return {
    schema: 'canary-baseline-report/1', suite, release: input.release,
    real: { status: real.status, next: real.next, reasons: real.reasons.map((r) => ({ rule: r.rule, status: r.status, model: r.model, detail: r.detail })), models: real.models as Record<string, unknown> },
    models: out,
    suite_totals: {
      trials: rows.length, infra, infra_share: rows.length ? infra / rows.length : 0,
      same_release_pairs: frontier.reduce((s, m) => s + m.false_alarms.length, 0),
      false_alarms: frontier.reduce((s, m) => s + m.false_alarms.filter((f) => f.rules.length > 0).length, 0),
    },
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const need = (n: string) => flag(n) ?? (console.error(`baseline-report: ${n} is required`), process.exit(2));
  const suite = need('--suite') as Suite;
  if (suite !== 'gstack' && suite !== 'gbrain') { console.error('baseline-report: bad --suite'); process.exit(2); }
  const prereg = JSON.parse(readFileSync(flag('--prereg') ?? join(DIR, 'prereg-canary.json'), 'utf8')) as { thresholds: Thresholds };
  const tasks = JSON.parse(readFileSync(flag('--tasks') ?? join(DIR, `tasks-${suite}.json`), 'utf8')) as TasksFile;
  const report = baselineReport({
    suite, trials: readTrials([need('--trials')]), tasks, thresholds: prereg.thresholds, draws: Number(flag('--draws') ?? 10000),
    release: { prev: { sha: need('--prev-sha'), version: need('--prev-version') }, new: { sha: need('--new-sha'), version: need('--new-version') } },
  });
  const text = JSON.stringify(report, null, 2) + '\n';
  const out = flag('--out');
  if (out) writeFileSync(out, text);
  process.stdout.write(text);
}
