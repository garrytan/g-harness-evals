#!/usr/bin/env bun
/**
 * HARN-18 start-hook panel: the preregistered verdict, computed from cells.jsonl (and the manifest's planned order) alone.
 *
 *   bun scripts/tool-discipline/panel-score.ts <cells.jsonl> --manifest <manifest.json> [--json]
 *
 * The manifest's order is the plan, and it is required: without it a trial that never wrote a line would not count as absent.
 * The manifest must match the manifest.sha256 discovery.sh wrote beside it before trial 1, and must not be a dry run's.
 * A plan missing any of the nine (task, arm) cells for a harness, or a cells.jsonl with a repeated trial_id or a line whose trial_id,
 * harness, task or arm is not in the plan, is refused (exit 2). Cost per trial is usd_spent plus usd_charged_reservation, over trials
 * that sent a model request; trials with unresolved reservations (usd_reserved_unknown > 0) are counted beside it.
 * The rules are frozen by docs/benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION.md. Per harness:
 *
 * - Absent row: a planned row that is not eligible (scripts/gsta-135/report.ts eligible: it ran, its termination is not infra:*
 *   or not_run:*, its transcript is complete and it did not stop for length), including a planned row with no line at all.
 * - incomplete: some cell (harness, task, arm) has more than a quarter of its planned rows absent (more than 2 of 8).
 * - Primary: candidate starts (matching_skill_started, helper exit 0 observed) over tasks 1 and 2 pooled, worst case (an absent
 *   row is a non-start), at least START_BAR of 16 (scaled to the planned n). Below it: fail.
 * - Control guard: candidate opens on task 3, worst case (every planned row that is not an eligible row with no open counts as
 *   an open), at most CONTROL_ALLOW of 8 (scaled up). Above it: fail.
 * - Success guards: candidate task success on tasks 1 and 2, worst case (absent = failure), against the baseline arm and against
 *   the none arm, each best case (absent = success). Met when the candidate count is not below. Below with a Newcombe 95%
 *   interval for the difference entirely under 0: fail. Below otherwise: inconclusive (a drop not shown either way).
 * - Baseline starts, best case (absent = start), at the bar or above: inconclusive (the arms do not differ on the primary).
 * - Otherwise pass. Order: incomplete, fail, inconclusive, pass.
 *
 * Everything else it prints is descriptive: per-task starts and opens by arm, the Hermes task-2 secondary bar (at least 2 of 8
 * candidate starts), candidate minus baseline starts with its Newcombe interval, the R44 table (task success and cost per trial,
 * none against baseline and candidate), attempts whose exit the scorer could not attribute, and the smallest difference in
 * success the panel could show.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cells, eligible, wilson } from '../gsta-135/report.ts';

export const ARMS = ['none', 'baseline', 'candidate'], TASKS = [1, 2, 3];
export const START_BAR = 5, START_N = 16, CONTROL_ALLOW = 1, CONTROL_N = 8, HERMES_T2_BAR = 2, HERMES_T2_N = 8, ABSENT_SHARE = 0.25;
export type Verdict = 'pass' | 'fail' | 'inconclusive' | 'incomplete';
type Interval = { lo: number; hi: number };

/** Newcombe's hybrid score interval (method 10) for p1 - p2, from Wilson 95% intervals. */
export function newcombe(k1: number, n1: number, k2: number, n2: number): Interval & { d: number } {
  const p1 = n1 ? k1 / n1 : 0, p2 = n2 ? k2 / n2 : 0, w1 = wilson(k1, n1), w2 = wilson(k2, n2), d = p1 - p2;
  return { d, lo: d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2), hi: d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2) };
}

const metric = (r: any, k: string) => r.evidence?.metrics?.[k];
const usdOf = (r: any) => Number(r.usd_spent ?? 0) + Number(r.usd_charged_reservation ?? 0);
const scaled = (bar: number, of: number, n: number) => Math.ceil(bar * n / of);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface HarnessScore {
  harness: string; verdict: Verdict; reasons: string[];
  primary: { starts: number; n: number; bar: number; baseline_best: number; diff: Interval & { d: number } };
  control: { worst: number; n: number; allow: number };
  success: Record<'baseline' | 'none', { candidate_worst: number; other_best: number; n: number; diff: Interval & { d: number }; state: 'met' | 'fail' | 'inconclusive' }>;
  hermes_task2?: { starts: number; n: number; bar: number; met: boolean };
  incomplete_cells: string[];
  arms: Record<string, { opened: Record<string, number>; started: Record<string, number>; attempted_unattributed: number; success: number; success_n: number; cost_median: number | null; cost_interval: Interval | null; cost_n: number; cost_unresolved: number; planned: number; absent: number }>;
}

/** Refuses rows the plan cannot account for: a repeated trial_id, or a trial the plan does not list with that harness, task and arm. */
export function checkPlan(rows: any[], order: any[]): void {
  if (!order.length) throw new Error('the manifest has no planned order');
  const key = (r: any) => [r.harness, r.task, r.arm].join('|');
  for (const h of new Set(order.map(o => o.harness))) for (const t of TASKS) for (const a of ARMS)
    if (!order.some(o => key(o) === key({ harness: h, task: t, arm: a }))) throw new Error('the plan has no ' + h + ' task ' + t + ' ' + a + ' trials; the panel is three arms on tasks 1 to 3');
  const plan = new Map<string, string>();
  for (const o of order) { if (plan.has(o.trial_id)) throw new Error('the plan lists trial ' + o.trial_id + ' twice'); plan.set(o.trial_id, key(o)); }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.trial_id)) throw new Error('cells.jsonl has trial ' + r.trial_id + ' more than once');
    seen.add(r.trial_id);
    if (plan.get(r.trial_id) !== key(r)) throw new Error('cells.jsonl has trial ' + r.trial_id + ' (' + key(r) + '), which the plan does not list');
  }
}

/** The order-statistic 95% interval for a median: the widest symmetric ranks whose binomial(n, 1/2) tails each hold at most 2.5%. Null under 6 values. */
export function medianInterval(xs: number[]): Interval | null {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  let tail = 0, l = 0;
  for (let k = 0, p = 2 ** -n; k < n; p = p * (n - k) / (k + 1), k++) { if (tail + p > 0.025) break; tail += p; l = k + 1; }
  return l ? { lo: s[l - 1], hi: s[n - l] } : null;
}

/** The smallest drop from n of n the success guard can call a fail at this n: the first k whose Newcombe interval lies under 0. */
export function smallestShownDrop(n: number): number | null {
  for (let k = n; k >= 0; k--) if (newcombe(k, n, n, n).hi < 0) return (n - k) / n;
  return null;
}

export function score(rows: any[], order: any[]): HarnessScore[] {
  checkPlan(rows, order);
  const cs = cells(rows, order);
  const harnesses = [...new Set(cs.map(c => c.harness))].sort();
  return harnesses.map(h => {
    const mine = cs.filter(c => c.harness === h);
    const cell = (task: number, arm: string) => mine.find(c => c.task === task && c.arm === arm);
    const absent = (c: any) => c ? c.planned - c.eligible : 0;
    const sumOf = (arm: string, tasks: number[], f: (c: any) => number) => tasks.reduce((s, t) => { const c = cell(t, arm); return s + (c ? f(c) : 0); }, 0);
    const T = [1, 2];
    const incomplete = mine.filter(c => absent(c) > Math.floor(c.planned * ABSENT_SHARE)).map(c => 'task ' + c.task + ' ' + c.arm + ': ' + absent(c) + ' of ' + c.planned + ' absent');
    const n = sumOf('candidate', T, c => c.planned), bar = scaled(START_BAR, START_N, n);
    const starts = sumOf('candidate', T, c => c.started);
    const bN = sumOf('baseline', T, c => c.planned), baselineBest = sumOf('baseline', T, c => c.started + absent(c));
    const ctl = cell(3, 'candidate');
    const ctlN = ctl?.planned ?? 0, ctlAllow = Math.ceil(CONTROL_ALLOW * ctlN / CONTROL_N);
    const ctlWorst = ctl ? ctl.planned - ctl.rows.filter((r: any) => eligible(r) && metric(r, 'control_false_open') === 0).length : 0;
    const candWorst = sumOf('candidate', T, c => c.success);
    const guard = (arm: 'baseline' | 'none') => {
      const on = sumOf(arm, T, c => c.planned), best = sumOf(arm, T, c => c.success + absent(c));
      const diff = newcombe(candWorst, n, best, on);
      const state = on === 0 ? 'met' as const : candWorst * on >= best * n ? 'met' as const : diff.hi < 0 ? 'fail' as const : 'inconclusive' as const;
      return { candidate_worst: candWorst, other_best: best, n: on, diff, state };
    };
    const success = { baseline: guard('baseline'), none: guard('none') };
    const reasons: string[] = [];
    let verdict: Verdict = 'pass';
    if (incomplete.length) { verdict = 'incomplete'; reasons.push('more than ' + Math.round(ABSENT_SHARE * 100) + '% of a cell absent: ' + incomplete.join('; ')); }
    else {
      const fails: string[] = [], inconc: string[] = [];
      if (starts < bar) fails.push('candidate starts ' + starts + ' of ' + n + ', under the bar of ' + bar);
      if (ctlWorst > ctlAllow) fails.push('candidate control opens ' + ctlWorst + ' of ' + ctlN + ' (worst case), over ' + ctlAllow);
      for (const arm of ['baseline', 'none'] as const) {
        const g = success[arm];
        if (g.state === 'fail') fails.push('candidate success ' + g.candidate_worst + ' of ' + n + ' below ' + arm + ' ' + g.other_best + ' of ' + g.n + ', difference interval under 0');
        if (g.state === 'inconclusive') inconc.push('candidate success ' + g.candidate_worst + ' of ' + n + ' below ' + arm + ' ' + g.other_best + ' of ' + g.n + ', drop not shown either way');
      }
      if (baselineBest >= bar) inconc.push('baseline starts reach the bar too (' + baselineBest + ' of ' + bN + ', best case)');
      if (fails.length) { verdict = 'fail'; reasons.push(...fails); }
      else if (inconc.length) { verdict = 'inconclusive'; reasons.push(...inconc); }
      else reasons.push('candidate starts ' + starts + ' of ' + n + ' at or over ' + bar + ', baseline ' + baselineBest + ' of ' + bN + ' under it, guards met');
    }
    const arms: HarnessScore['arms'] = {};
    for (const arm of [...new Set(mine.map(c => c.arm))].sort()) {
      const rs = mine.filter(c => c.arm === arm);
      const runRows = rs.flatMap(c => c.run).filter((r: any) => Number(r.requests_forwarded ?? 0) > 0);
      arms[arm] = {
        opened: Object.fromEntries(T.map(t => [String(t), cell(t, arm)?.opened ?? 0])),
        started: Object.fromEntries(T.map(t => [String(t), cell(t, arm)?.started ?? 0])),
        attempted_unattributed: rs.flatMap(c => c.rows).filter((r: any) => eligible(r) && metric(r, 'started_attempted') === 1 && metric(r, 'matching_skill_started') !== 1 && (metric(r, 'started_exit') === 'ambiguous' || metric(r, 'started_exit') === null)).length,
        success: sumOf(arm, T, c => c.success), success_n: sumOf(arm, T, c => c.planned),
        cost_median: median(runRows.map(usdOf)), cost_interval: medianInterval(runRows.map(usdOf)), cost_n: runRows.length,
        cost_unresolved: runRows.filter((r: any) => Number(r.usd_reserved_unknown ?? 0) > 0).length,
        planned: rs.reduce((s, c) => s + c.planned, 0), absent: rs.reduce((s, c) => s + absent(c), 0),
      };
    }
    const t2 = cell(2, 'candidate');
    return {
      harness: h, verdict, reasons,
      primary: { starts, n, bar, baseline_best: baselineBest, diff: newcombe(starts, n, sumOf('baseline', T, c => c.started), bN) },
      control: { worst: ctlWorst, n: ctlN, allow: ctlAllow }, success, incomplete_cells: incomplete, arms,
      ...(h === 'hermes' && t2 ? { hermes_task2: { starts: t2.started, n: t2.planned, bar: scaled(HERMES_T2_BAR, HERMES_T2_N, t2.planned), met: t2.started >= scaled(HERMES_T2_BAR, HERMES_T2_N, t2.planned) } } : {}),
    };
  });
}

const iv = (x: Interval & { d?: number }) => (x.d !== undefined ? (x.d >= 0 ? '+' : '') + x.d.toFixed(2) + ' ' : '') + '[' + x.lo.toFixed(2) + ', ' + x.hi.toFixed(2) + ']';
const kn = (k: number, n: number) => { const w = wilson(k, n); return k + ' of ' + n + ' (' + w.lo.toFixed(2) + ' to ' + w.hi.toFixed(2) + ')'; };

export function markdown(scores: HarnessScore[]): string {
  const out: string[] = ['# Start-hook panel verdict (scripts/tool-discipline/panel-score.ts)', ''];
  for (const s of scores) {
    out.push('## ' + s.harness + ': ' + s.verdict, '', ...s.reasons.map(r => '- ' + r), '');
    out.push('- primary: candidate starts ' + kn(s.primary.starts, s.primary.n) + ', bar ' + s.primary.bar + '; candidate minus baseline ' + iv(s.primary.diff) + '; baseline best case ' + s.primary.baseline_best);
    out.push('- control guard: candidate opens on task 3, worst case, ' + s.control.worst + ' of ' + s.control.n + ', allowed ' + s.control.allow);
    for (const arm of ['baseline', 'none'] as const) { const g = s.success[arm]; if (!g.n) { out.push('- success guard vs ' + arm + ': no ' + arm + ' arm in this panel'); continue; } out.push('- success guard vs ' + arm + ': candidate ' + g.candidate_worst + ' of ' + s.primary.n + ' (worst) against ' + g.other_best + ' of ' + g.n + ' (best), difference ' + iv(g.diff) + ': ' + g.state); }
    if (s.hermes_task2) out.push('- secondary, Hermes task 2: candidate starts ' + s.hermes_task2.starts + ' of ' + s.hermes_task2.n + ', bar ' + s.hermes_task2.bar + ': ' + (s.hermes_task2.met ? 'met' : 'not met'));
    const usd = (a: HarnessScore['arms'][string]) => a.cost_median === null ? 'none run' : '$' + a.cost_median.toFixed(4) + (a.cost_interval ? ' [' + a.cost_interval.lo.toFixed(4) + ', ' + a.cost_interval.hi.toFixed(4) + ']' : ' (under 6 run, no interval)') + (a.cost_unresolved ? ', ' + a.cost_unresolved + ' with unresolved reservations' : '');
    out.push('', '| arm | opened t1 | opened t2 | started t1 | started t2 | exit not attributable | task success t1+t2 | cost median [95% interval] | trials with a model request | absent of planned |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [arm, a] of Object.entries(s.arms)) out.push('| ' + [arm, a.opened['1'], a.opened['2'], a.started['1'], a.started['2'], a.attempted_unattributed, kn(a.success, a.success_n), usd(a), a.cost_n, a.absent + ' of ' + a.planned].join(' | ') + ' |');
    const b = s.arms.baseline, nn = s.arms.none, c = s.arms.candidate;
    if (b && nn && c) {
      const nb = newcombe(nn.success, nn.success_n, b.success, b.success_n), nc = newcombe(nn.success, nn.success_n, c.success, c.success_n);
      const drop = smallestShownDrop(c.success_n);
      out.push('', '- R44: task success, none minus baseline ' + iv(nb) + ', none minus candidate ' + iv(nc) + '; cost median per trial with its 95% interval: none ' + usd(nn) + ', baseline ' + usd(b) + ', candidate ' + usd(c) + '.');
      out.push('- smallest success drop this panel can show: ' + (drop === null ? 'none at ' + c.success_n + ' trials' : Math.round(drop * c.success_n) + ' of ' + c.success_n + ' (' + drop.toFixed(2) + ') from ' + c.success_n + ' of ' + c.success_n + ', the first drop whose Newcombe interval lies under 0') + '; anything smaller is not shown either way.');
    }
    out.push('');
  }
  return out.join('\n');
}

/** The preregistered arms of tool-discipline-start-2026-11. */
export const PANEL_ARMS = {
  none: { gstack_sha: 'none', start_hook: 'off' },
  baseline: { gstack_sha: '482ffd1440ab13d105bfd3e571be3d7a0a7bb99a', start_hook: 'off' },
  candidate: { gstack_sha: 'b9fda18c6ac232de2b5a99ac3e6893955c55d7c0', start_hook: 'on' },
} as const;

/** The rest of the preregistered design a manifest must carry. */
export const PANEL_DESIGN = { model: 'claude-opus-5-5', hermes_mode: 'chat', max_tokens: 128000, trials_per_cell: 8, per_trial_usd: 1, panel_cap_usd: 28, tree_dirty: false } as const;
const PANEL_HARNESSES = ['openclaw', 'hermes'];

/** Why a manifest is not this run's panel (the preregistered SHAs, the hook on the candidate alone, the real upstream, the model,
 *  Hermes mode, max_tokens, 8 trials in each of the 18 cells, the per-trial bar, the cap, a clean tree), or null. */
export function panelManifestProblem(manifest: any): string | null {
  if (manifest.upstream !== 'default') return 'upstream is ' + JSON.stringify(manifest.upstream) + ', not default (a fake or overridden upstream is never a counted run)';
  for (const [key, want] of Object.entries(PANEL_DESIGN)) if (manifest[key] !== want) return key + ' is ' + JSON.stringify(manifest[key]) + ', not ' + JSON.stringify(want);
  const cells = new Map<string, number>();
  for (const o of Array.isArray(manifest.order) ? manifest.order : []) cells.set(o.harness + ' task ' + o.task + ' ' + o.arm, (cells.get(o.harness + ' task ' + o.task + ' ' + o.arm) ?? 0) + 1);
  for (const h of PANEL_HARNESSES) for (const t of [1, 2, 3]) for (const arm of Object.keys(PANEL_ARMS)) {
    const n = cells.get(h + ' task ' + t + ' ' + arm) ?? 0;
    if (n !== PANEL_DESIGN.trials_per_cell) return 'the order plans ' + n + ' trials for ' + h + ' task ' + t + ' ' + arm + ', not ' + PANEL_DESIGN.trials_per_cell;
  }
  const planned = new Set(PANEL_HARNESSES.flatMap(h => [1, 2, 3].flatMap(t => Object.keys(PANEL_ARMS).map(arm => h + ' task ' + t + ' ' + arm))));
  const extra = [...cells.keys()].filter(k => !planned.has(k));
  if (extra.length) return 'the order plans cells outside the 18 preregistered ones: ' + extra.join(', ');
  if (manifest.start_hook?.arm !== 'candidate') return 'start_hook.arm is ' + JSON.stringify(manifest.start_hook?.arm) + ', not candidate (discovery.sh ran without --start-hook candidate)';
  for (const [arm, want] of Object.entries(PANEL_ARMS)) {
    const got = manifest.arms?.[arm];
    if (got?.gstack_sha !== want.gstack_sha) return arm + ' gstack_sha is ' + JSON.stringify(got?.gstack_sha) + ', not ' + want.gstack_sha;
    if (got?.start_hook !== want.start_hook) return arm + ' start_hook is ' + JSON.stringify(got?.start_hook) + ', not ' + want.start_hook;
  }
  return null;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--manifest');
  const mi = args.indexOf('--manifest');
  if (!file || mi < 0 || !args[mi + 1]) { console.error('usage: panel-score.ts <cells.jsonl> --manifest <manifest.json> [--json]'); process.exit(64); }
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const text = readFileSync(args[mi + 1], 'utf8'), seal = join(dirname(args[mi + 1]), 'manifest.sha256');
  if (!existsSync(seal) || readFileSync(seal, 'utf8').trim() !== createHash('sha256').update(text).digest('hex')) { console.error('panel-score: ' + args[mi + 1] + ' does not match the manifest.sha256 beside it'); process.exit(2); }
  const manifest = JSON.parse(text), order = manifest.order;
  if (manifest.dry_run === true) { console.error('panel-score: ' + args[mi + 1] + ' is a dry run\'s manifest'); process.exit(2); }
  if (!Array.isArray(order)) { console.error('panel-score: ' + args[mi + 1] + ' has no order array'); process.exit(2); }
  const notPanel = panelManifestProblem(manifest);
  if (notPanel) { console.error('panel-score: ' + args[mi + 1] + ' is not the preregistered start-hook panel: ' + notPanel); process.exit(2); }
  let scores: HarnessScore[];
  try { scores = score(rows, order); } catch (e) { console.error('panel-score: ' + (e as Error).message); process.exit(2); }
  console.log(args.includes('--json') ? JSON.stringify(scores, null, 2) : markdown(scores));
}
