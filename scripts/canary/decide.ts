#!/usr/bin/env bun
// The regression canary's decision rule (plan decision 8), as a pure function from one tier's trials to a verdict.
//
//   bun scripts/canary/decide.ts --suite gstack|gbrain --tier T0|T1|T2|T3 --prereg <prereg-canary.json> --tasks <tasks.json>
//     --prev-sha <sha> --prev-version <v> --new-sha <sha> --new-version <v> --run-id <id> --out <dir>
//     [--trials <trials.jsonl>]... [--t0 <t0.json>] [--t0-exit <n>] [--suite-exit <n>] [--arms plain,prev,new]
//     [--models opus,sol[,particle]] [--earlier <verdict.json>] [--previous <verdict.json>] [--range <moves.json>]
//     [--bisect <json>] [--ref-moved] [--note <text>]... [--receipts-dir <path>] [--failure <reason> --check-first <text>]
//
// Writes <out>/verdict.json and <out>/alert.md (scripts/canary/alert.ts) and prints "<status> next=<next>". Exit 0 whatever
// the status, 2 on a usage error. The statistics:
//   - pass screen: exact one-sided sign test on the discordant tasks (b = previous passed and new failed, c = the reverse),
//     infra-class trials (infra_error, model_error, exam_fault) dropped pairwise, harness_error and timeout counted as fails;
//   - pass confirm (T3): the task-clustered paired mean difference and bootstrap interval from runner/stats/paired.ts, and the
//     exact one-sided sign-flip p over task clusters, computed by convolution so it stays exact above 20 clusters;
//   - cost: per-task log ratio new over previous, geometric mean, task bootstrap one-sided lower bound;
//   - exposure: exact one-sided Fisher test that the new release's skill-load or tool-call rate is below the previous one's.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, seededRandom, type PairedItem } from '../../runner/stats/paired.ts';
import type { Termination, TrialUsage } from '../../runner/contracts.ts';
import { renderAlert, renderOk } from './alert.ts';

export type Suite = 'gstack' | 'gbrain';
export type Arm = 'plain' | 'prev' | 'new';
export type ModelKey = 'opus' | 'sol' | 'particle';
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';
export type TrialTier = Exclude<Tier, 'T0'>;
export type Status = 'OK' | 'WATCH' | 'REGRESSION' | 'BROKEN' | 'INCOMPLETE';
export type Next = 'none' | 'T1' | 'T2' | 'T3' | 'bisect';

export interface CanaryBlock {
  suite: Suite; tier: TrialTier; arm: Arm; product_version: string | null; product_sha: string | null; model_key: ModelKey; task: string; attempt: number;
  exposure: { first_request_has_product: boolean | null; product_calls: number | null };
  safety: { cross_scope_reads: number | null; hidden_fact_leaks: number | null } | null;
}
export interface CanaryTrial {
  trial_id: string; task: string; harness: string; model: string; termination: Termination; grade: 'pass' | 'fail' | 'n/a';
  consent_violation?: boolean; cap_stop?: boolean; usage: TrialUsage | null; canary: CanaryBlock;
}
export interface TasksModel { harness: string; model: string; tasks: string[]; t1: string[]; digest: string[]; label?: string }
export interface TasksFile { suite: Suite; models: Partial<Record<ModelKey, TasksModel>> }
export interface T0Report { suite: Suite; ok: boolean; checks: Array<{ arm: string; harness: string; name: string; ok: boolean; detail: string }> }
export interface Release { sha: string; version: string }
export interface Move { tag: string; version: string; sha: string }
export interface Thresholds {
  screen_alpha: number; exposure_alpha: number; confirm_alpha: number; confirm_min_drop_points: number;
  cost_ratio: number; cost_lower_bound: number; cost_screen_level: number; cost_confirm_level: number;
  infra_max_share: number; bootstrap_draws: number; seed: number;
  /** gbrain releases at or above this version fixed the known leaks, so any cross-scope read or leak there is a REGRESSION. */
  gbrain_leak_free_from?: string;
}

export interface PassBlock {
  prev: number; new: number; n: number; tasks: number; b: number; c: number; worse: string[]; better: string[]; screen_p: number;
  harness_error: { prev: number; new: number }; excluded: { prev: number; new: number };
}
export interface CostBlock {
  prev_usd: number | null; new_usd: number | null; ratio: number | null; lower: number | null; upper: number | null; level: number; tasks: number;
  tokens_prev: number | null; tokens_new: number | null;
}
export interface Counts { prev: { a: number; n: number }; new: { b: number; n: number } }
export interface ModelReport {
  harness: string; model: string; label?: string; tier: TrialTier;
  pass: PassBlock;
  screen?: PassBlock & { tier: TrialTier };
  confirm?: { delta_points: number; ci95: [number, number] | null; p_less: number; tasks: number };
  cost: CostBlock;
  exposure: { called: Counts; listed: Counts; p: number | null; first_request_false: { prev: number; new: number }; plain_contaminated: number };
  safety: { prev: { reads: number; leaks: number }; new: { reads: number; leaks: number } } | null;
  plain: { pass: number; n: number } | null;
  digest?: { prev: number; new: number; n: number; b: number; c: number; p: number };
}
export interface Reason { rule: string; status: Status; model?: ModelKey; tier: Tier; detail: string; check_first: string; sticky: boolean; confirm_with?: 'T3' }
export interface Verdict {
  schema: 'canary-verdict/1';
  suite: Suite; run_id: string; tier: Tier; tiers_run: Tier[]; status: Status; next: Next;
  release: { prev: Release; new: Release; range: Move[]; bisect: { first_bad: string | null; note: string } | null };
  /** The product's install command per harness, from the preregistration. */
  install_route: Record<string, string> | null; receipts_dir: string;
  reasons: Reason[]; cleared: Reason[]; models: Partial<Record<ModelKey, ModelReport>>;
  particle_flags: string[]; digest: string[]; notes: string[];
}
export interface DecideInput {
  suite: Suite; tier: Tier; trials: CanaryTrial[]; tasks: TasksFile; thresholds: Thresholds;
  expected: { arms: Arm[]; models: ModelKey[] };
  release: { prev: Release; new: Release; range?: Move[]; bisect?: Verdict['release']['bisect'] };
  run_id: string; receipts_dir?: string; install_route?: Record<string, string> | null;
  t0?: { exit: number; report: T0Report | null } | null; suite_exit?: number | null;
  earlier?: Verdict | null; previous?: Verdict | null; ref_moved?: boolean; notes?: string[];
  /** A run-level failure (rig check, lock, releases, a crashed step): INCOMPLETE with this reason, no tier evaluated. */
  failure?: { detail: string; check_first: string } | null;
}

const RANK: Record<Status, number> = { OK: 0, WATCH: 1, REGRESSION: 2, INCOMPLETE: 3, BROKEN: 4 };
export const worst = (statuses: readonly Status[]): Status => statuses.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), 'OK');
const EXCLUDED: ReadonlySet<Termination> = new Set<Termination>(['infra_error', 'model_error', 'exam_fault']);
export const isExcluded = (t: CanaryTrial) => EXCLUDED.has(t.termination);
export const passed = (t: CanaryTrial) => t.grade === 'pass' && !t.consent_violation;

// ---- exact tests -----------------------------------------------------------------------------------------------------

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** One-sided exact sign test: P(X >= b) for X ~ Binomial(b + c, 1/2). 1 when nothing is discordant. */
export function signTestP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  let tail = 0;
  for (let k = b; k <= n; k++) tail += Math.exp(logChoose(n, k) - n * Math.LN2);
  return Math.min(1, tail);
}

/** One-sided exact Fisher test that the new rate (x2 of n2) is below the previous one (x1 of n1): P(X <= x2) under the margins. */
export function fisherLessP(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1;
  const k = x1 + x2, total = n1 + n2;
  const lo = Math.max(0, k - n1), hi = Math.min(k, n2);
  let p = 0;
  for (let x = lo; x <= Math.min(x2, hi); x++) p += Math.exp(logChoose(n2, x) + logChoose(n1, k - x) - logChoose(total, k));
  return Math.min(1, p);
}

/** Exact one-sided sign-flip p over clusters: P(S <= observed), S the sum of the cluster sums under random signs. The sums
 *  are integers (binary outcomes), so the null distribution is a convolution and no cluster limit applies. Equal to
 *  runner/stats/paired.ts p_less, which enumerates the same 2^clusters patterns up to 20 clusters. */
export function signFlipPLess(clusterSums: readonly number[]): number {
  if (!clusterSums.every(Number.isInteger)) throw new Error('signFlipPLess needs integer cluster sums');
  const span = clusterSums.reduce((s, v) => s + Math.abs(v), 0);
  let dist = new Float64Array(2 * span + 1);
  dist[span] = 1;
  for (const v of clusterSums) {
    const a = Math.abs(v);
    if (a === 0) continue;
    const next = new Float64Array(dist.length);
    for (let i = 0; i < dist.length; i++) {
      if (!dist[i]) continue;
      if (i + a < dist.length) next[i + a] += dist[i] / 2;
      if (i - a >= 0) next[i - a] += dist[i] / 2;
    }
    dist = next;
  }
  const observed = clusterSums.reduce((s, v) => s + v, 0);
  let p = 0;
  for (let i = 0; i <= observed + span; i++) p += dist[i];
  return Math.min(1, p);
}

/** Geometric mean of per-task ratios with a seeded task bootstrap; lower and upper are its (1 - level) and level quantiles. */
export function ratioBootstrap(ratios: readonly number[], level: number, options: { seed: number; draws: number }): { ratio: number; lower: number | null; upper: number | null } {
  const logs = ratios.map(Math.log);
  const ratio = Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length);
  if (logs.length < 2) return { ratio, lower: null, upper: null };
  const rng = seededRandom(options.seed);
  const draws = new Float64Array(options.draws);
  for (let i = 0; i < options.draws; i++) {
    let s = 0;
    for (let j = 0; j < logs.length; j++) s += logs[Math.floor(rng() * logs.length)];
    draws[i] = s / logs.length;
  }
  draws.sort();
  const q = (p: number) => Math.exp(draws[Math.min(options.draws - 1, Math.max(0, Math.floor(p * options.draws)))]);
  return { ratio, lower: q(1 - level), upper: q(level) };
}

// ---- per-model blocks ------------------------------------------------------------------------------------------------

type Rows = CanaryTrial[];
const slot = (t: CanaryTrial) => `${t.canary.task}\u0000${t.canary.attempt}`;

/** Pairs previous and new trials by task and attempt over `tasks`, dropping a pair when either side is infra-class. */
export function pairArms(prev: Rows, next: Rows, tasks: readonly string[]): Array<{ task: string; a: number; b: number }> {
  const want = new Set(tasks);
  const right = new Map(next.filter((t) => want.has(t.canary.task)).map((t) => [slot(t), t]));
  const pairs: Array<{ task: string; a: number; b: number }> = [];
  for (const p of prev) {
    const n = want.has(p.canary.task) ? right.get(slot(p)) : undefined;
    if (!n || isExcluded(p) || isExcluded(n)) continue;
    pairs.push({ task: p.canary.task, a: passed(p) ? 1 : 0, b: passed(n) ? 1 : 0 });
  }
  return pairs.sort((x, y) => (x.task < y.task ? -1 : x.task > y.task ? 1 : 0));
}

export function passBlock(prev: Rows, next: Rows, tasks: readonly string[]): PassBlock {
  const pairs = pairArms(prev, next, tasks);
  const byTask = new Map<string, { a: number; b: number }>();
  for (const p of pairs) {
    const s = byTask.get(p.task) ?? { a: 0, b: 0 };
    s.a += p.a; s.b += p.b;
    byTask.set(p.task, s);
  }
  const worse = [...byTask].filter(([, s]) => s.a > s.b).map(([t]) => t);
  const better = [...byTask].filter(([, s]) => s.b > s.a).map(([t]) => t);
  const count = (rows: Rows, f: (t: CanaryTrial) => boolean) => rows.filter((t) => tasks.includes(t.canary.task) && f(t)).length;
  return {
    prev: pairs.reduce((s, p) => s + p.a, 0), new: pairs.reduce((s, p) => s + p.b, 0), n: pairs.length, tasks: byTask.size,
    b: worse.length, c: better.length, worse, better, screen_p: signTestP(worse.length, better.length),
    harness_error: { prev: count(prev, (t) => t.termination === 'harness_error'), new: count(next, (t) => t.termination === 'harness_error') },
    excluded: { prev: count(prev, isExcluded), new: count(next, isExcluded) },
  };
}

export function costBlock(prev: Rows, next: Rows, tasks: readonly string[], level: number, th: Thresholds): CostBlock {
  type Sum = { usd: number; tokens: number; n: number };
  const perTask = (rows: Rows) => {
    const m = new Map<string, Sum>();
    for (const t of rows) {
      if (!tasks.includes(t.canary.task) || isExcluded(t) || !t.usage) continue;
      const s = m.get(t.canary.task) ?? { usd: 0, tokens: 0, n: 0 };
      s.usd += t.usage.usd; s.tokens += t.usage.input_tokens + t.usage.output_tokens; s.n += 1;
      m.set(t.canary.task, s);
    }
    return m;
  };
  const a = perTask(prev), b = perTask(next);
  const ratios: number[] = [];
  for (const [task, s] of a) {
    const t = b.get(task);
    if (t && s.usd > 0 && t.usd > 0) ratios.push(t.usd / t.n / (s.usd / s.n));
  }
  const mean = (m: Map<string, Sum>, f: 'usd' | 'tokens') => {
    const n = [...m.values()].reduce((s, x) => s + x.n, 0);
    return n ? [...m.values()].reduce((s, x) => s + x[f], 0) / n : null;
  };
  const boot = ratios.length ? ratioBootstrap(ratios, level, { seed: th.seed, draws: th.bootstrap_draws }) : { ratio: null, lower: null, upper: null };
  return { prev_usd: mean(a, 'usd'), new_usd: mean(b, 'usd'), ...boot, level, tasks: ratios.length, tokens_prev: mean(a, 'tokens'), tokens_new: mean(b, 'tokens') };
}

function exposureBlock(prev: Rows, next: Rows, plain: Rows): ModelReport['exposure'] {
  const counts = (known: (t: CanaryTrial) => boolean, hit: (t: CanaryTrial) => boolean): Counts => {
    const k = (rows: Rows) => rows.filter((t) => !isExcluded(t) && known(t));
    return { prev: { a: k(prev).filter(hit).length, n: k(prev).length }, new: { b: k(next).filter(hit).length, n: k(next).length } };
  };
  const called = counts((t) => t.canary.exposure.product_calls !== null, (t) => (t.canary.exposure.product_calls ?? 0) > 0);
  const listed = counts((t) => t.canary.exposure.first_request_has_product !== null, (t) => t.canary.exposure.first_request_has_product === true);
  return {
    called, listed,
    p: called.prev.n && called.new.n ? fisherLessP(called.prev.a, called.prev.n, called.new.b, called.new.n) : null,
    first_request_false: { prev: listed.prev.n - listed.prev.a, new: listed.new.n - listed.new.b },
    plain_contaminated: plain.filter((t) => t.canary.exposure.first_request_has_product === true || (t.canary.exposure.product_calls ?? 0) > 0).length,
  };
}

function safetyBlock(prev: Rows, next: Rows): ModelReport['safety'] {
  if (![...prev, ...next].some((t) => t.canary.safety)) return null;
  const sum = (rows: Rows) => ({
    reads: rows.reduce((s, t) => s + (t.canary.safety?.cross_scope_reads ?? 0), 0),
    leaks: rows.reduce((s, t) => s + (t.canary.safety?.hidden_fact_leaks ?? 0), 0),
  });
  return { prev: sum(prev), new: sum(next) };
}

// ---- the rule ----------------------------------------------------------------------------------------------------------

const family = (rule: string) => rule.split('_')[0];

/** True when dotted version a is at or above b, comparing each numeric part. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function decide(input: DecideInput): Verdict {
  const th = input.thresholds;
  const { suite, tier } = input;
  const reasons: Reason[] = [];
  const notes = [...(input.earlier?.notes ?? []), ...(input.notes ?? [])];
  const digest = [...(input.earlier?.digest ?? [])];
  const particleFlags: string[] = [];
  const models: Verdict['models'] = {};
  const add = (r: Omit<Reason, 'tier' | 'sticky'> & { sticky?: boolean }) => reasons.push({ tier, sticky: false, ...r });
  const range = input.release.range ?? input.earlier?.release.range ?? [];

  if (input.ref_moved) add({ rule: 'ref_moved', status: 'INCOMPLETE', detail: `the ${suite} stable ref moved during the run`, check_first: 'rerun the canary: the stable ref moved while it ran' });
  if (input.suite_exit === 20) add({ rule: 'lease_stop', status: 'INCOMPLETE', detail: `${tier} stopped at its lease (exit 20)`, check_first: 'the run lease: re-price the tier or raise its lease by dated amendment' });
  else if (input.suite_exit != null && input.suite_exit !== 0) add({ rule: 'suite_failed', status: 'INCOMPLETE', detail: `the ${suite} ${tier} run exited ${input.suite_exit}`, check_first: `the ${tier} run log of the ${suite} rig` });

  if (input.failure) {
    add({ rule: 'run_failed', status: 'INCOMPLETE', detail: input.failure.detail, check_first: input.failure.check_first });
  } else if (tier === 'T0') {
    const t0 = input.t0;
    const failed = t0?.report?.checks.filter((c) => !c.ok) ?? [];
    if (!t0 || !t0.report || (t0.exit !== 0 && t0.exit !== 10)) {
      add({ rule: 't0_infra', status: 'INCOMPLETE', detail: `T0 exited ${t0?.exit ?? 'without running'}${t0?.report ? '' : ' and wrote no t0.json'}`, check_first: 'the T0 log: the install check itself did not run' });
    } else if (t0.exit === 10 || !t0.report.ok) {
      add({ rule: 't0_install', status: 'BROKEN', detail: failed.map((c) => `${c.arm}/${c.harness} ${c.name}: ${c.detail}`).join('; ') || 'T0 reported a failed check', check_first: failed[0] ? `install: ${failed[0].name} on ${failed[0].harness} (${failed[0].arm} arm)` : 'install: t0.json' });
    }
  } else {
    const rows = input.trials.filter((t) => t.canary?.suite === suite && t.canary.tier === tier);
    if (rows.some((t) => t.cap_stop)) add({ rule: 'lease_stop', status: 'INCOMPLETE', detail: `a ${tier} trial stopped at the lease (cap_stop)`, check_first: 'the run lease: re-price the tier or raise its lease by dated amendment' });
    for (const mk of input.expected.models) {
      const spec = input.tasks.models[mk];
      if (!spec) { add({ rule: 'missing_model', status: 'INCOMPLETE', model: mk, detail: `tasks.json has no ${mk} list`, check_first: 'tasks.json' }); continue; }
      const mine = rows.filter((t) => t.canary.model_key === mk);
      const arm = (a: Arm) => mine.filter((t) => t.canary.arm === a);
      for (const a of input.expected.arms) {
        const r = arm(a);
        if (!r.length) { add({ rule: 'missing_arm', status: 'INCOMPLETE', model: mk, detail: `no ${a} trials for ${mk}`, check_first: `the ${tier} log for the ${mk} ${a} arm` }); continue; }
        const ex = r.filter(isExcluded).length;
        if (ex / r.length > th.infra_max_share) add({ rule: 'infra', status: 'INCOMPLETE', model: mk, detail: `${ex} of ${r.length} ${a} trials for ${mk} ended infra_error, model_error or exam_fault`, check_first: `the infra errors in the ${mk} ${a} arm` });
      }
      const prev = arm('prev'), next = arm('new'), plain = arm('plain');
      if (!prev.length || !next.length) continue;
      const listed = tier === 'T1' ? spec.t1 : spec.tasks;
      const frontier = mk !== 'particle';
      const name = `${mk} (${spec.harness})`;
      const pass = passBlock(prev, next, listed);
      const cost = costBlock(prev, next, listed, tier === 'T3' ? th.cost_confirm_level : th.cost_screen_level, th);
      const exposure = exposureBlock(prev, next, plain);
      const safety = suite === 'gbrain' ? safetyBlock(prev, next) : null;
      const plainKept = plain.filter((t) => listed.includes(t.canary.task) && !isExcluded(t));
      const before = input.earlier?.models[mk];
      const report: ModelReport = {
        harness: spec.harness, model: spec.model, ...(spec.label ? { label: spec.label } : {}), tier, pass, cost, exposure, safety,
        plain: plain.length ? { pass: plainKept.filter(passed).length, n: plainKept.length } : (before?.plain ?? null),
      };
      if (tier !== 'T3') report.screen = { ...pass, tier };
      else if (before?.screen) report.screen = before.screen;
      models[mk] = report;
      const flag = (r: Omit<Reason, 'tier' | 'sticky' | 'model'> & { sticky?: boolean }) => {
        if (frontier) add({ ...r, model: mk });
        else particleFlags.push(`${r.rule}: ${r.detail}`);
      };

      if (exposure.first_request_false.prev + exposure.first_request_false.new > 0) {
        const what = suite === 'gstack' ? 'gstack skills or router absent from the first captured request' : 'gbrain listed no tools';
        add({ rule: 'exposure_broken', status: 'BROKEN', model: mk, detail: `${name}: ${what} in ${exposure.first_request_false.new} new and ${exposure.first_request_false.prev} previous trials`, check_first: suite === 'gstack' ? 'the installed skill files and router in the first captured request' : "gbrain's MCP tools/list in the trial" });
      }
      if (exposure.plain_contaminated) notes.push(`the plain arm for ${mk} reached ${suite} in ${exposure.plain_contaminated} trials (context only; it never changes the verdict)`);
      if (pass.harness_error.new > pass.harness_error.prev) notes.push(`${name} harness_error ${pass.harness_error.prev} -> ${pass.harness_error.new} (previous -> new) at ${tier}`);

      const newVersion = next.find((t) => t.canary.product_version)?.canary.product_version ?? null;
      const leakFree = !!(th.gbrain_leak_free_from && newVersion && versionAtLeast(newVersion, th.gbrain_leak_free_from));
      if (safety && leakFree && safety.new.reads + safety.new.leaks > 0) {
        flag({ rule: 'safety_fixed', status: 'REGRESSION', detail: `${name}: cross-scope reads ${safety.prev.reads} -> ${safety.new.reads}, leaks ${safety.prev.leaks} -> ${safety.new.leaks} on gbrain ${newVersion}, at or above ${th.gbrain_leak_free_from}, which fixed the member-bound write leak`, check_first: "gbrain's write visibility for member-bound credentials (readable_by on pages written into default)" });
      } else if (safety && safety.new.reads + safety.new.leaks > 0 && safety.prev.reads + safety.prev.leaks === 0) {
        const detail = `${name}: cross-scope reads ${safety.prev.reads} -> ${safety.new.reads}, leaks ${safety.prev.leaks} -> ${safety.new.leaks}`;
        if (tier === 'T3') flag({ rule: 'safety_confirm', status: 'REGRESSION', detail, check_first: "gbrain's scope defaults: the cross-scope read or hidden-fact leak repeated at T3" });
        else flag({ rule: 'safety', status: 'WATCH', detail, check_first: "gbrain's scope defaults: a cross-scope read or hidden-fact leak the previous release did not have", sticky: true, confirm_with: 'T3' });
      }
      const costFlag = cost.ratio !== null && cost.lower !== null && cost.ratio >= th.cost_ratio && cost.lower >= th.cost_lower_bound;
      const costDetail = `${name} cost per trial x${cost.ratio?.toFixed(2)} (${Math.round(cost.level * 100)}% lower bound ${cost.lower?.toFixed(2)})`;
      const costCheck = 'what the new release adds to each request: skill text, tool schemas or extra turns';
      if (tier === 'T3') {
        const pairs = pairArms(prev, next, listed);
        if (pairs.length) {
          const sums = new Map<string, number>();
          for (const p of pairs) sums.set(p.task, (sums.get(p.task) ?? 0) + p.b - p.a);
          const items: PairedItem[] = pairs.map((p, i) => ({ id: `${p.task}#${i}`, cluster: p.task, a: p.a, b: p.b }));
          const stats = clusteredPairedDelta(items, { seed: th.seed, draws: Math.max(1000, th.bootstrap_draws) });
          const pLess = signFlipPLess([...sums.values()]);
          report.confirm = { delta_points: stats.delta * 100, ci95: stats.ci95 ? [stats.ci95[0] * 100, stats.ci95[1] * 100] : null, p_less: pLess, tasks: sums.size };
          if (stats.delta * 100 <= -th.confirm_min_drop_points && pLess <= th.confirm_alpha) {
            flag({ rule: 'pass_confirm', status: 'REGRESSION', detail: `${name} pass ${pass.prev}/${pass.n} -> ${pass.new}/${pass.n} at T3, paired difference ${(stats.delta * 100).toFixed(1)} points, sign-flip p ${pLess.toFixed(4)}`, check_first: `the tasks that got worse: ${pass.worse.slice(0, 3).join(', ')}` });
          }
        }
        if (costFlag) flag({ rule: 'cost_confirm', status: 'REGRESSION', detail: costDetail, check_first: costCheck });
        continue;
      }
      if (pass.b > pass.c && pass.screen_p <= th.screen_alpha) {
        flag({ rule: 'pass_screen', status: 'WATCH', detail: `${name} pass ${pass.prev}/${pass.n} -> ${pass.new}/${pass.n} at ${tier}, ${pass.b} worse and ${pass.c} better, sign test p ${pass.screen_p.toFixed(4)}`, check_first: `the tasks that got worse: ${pass.worse.slice(0, 3).join(', ')}`, confirm_with: 'T3' });
      }
      if (costFlag) flag({ rule: 'cost_screen', status: 'WATCH', detail: costDetail, check_first: costCheck, confirm_with: 'T3' });
      const { called } = exposure;
      if (exposure.p !== null && exposure.p <= th.exposure_alpha && called.new.b * called.prev.n < called.prev.a * called.new.n) {
        flag({ rule: 'exposure_rate', status: 'WATCH', sticky: true, detail: `${name} ${suite === 'gstack' ? 'skill loads' : 'gbrain tool calls'} in ${called.prev.a}/${called.prev.n} -> ${called.new.b}/${called.new.n} trials, Fisher p ${exposure.p.toFixed(4)}`, check_first: suite === 'gstack' ? 'the skill descriptions and router text the model sees' : "gbrain's tool descriptions and server instructions" });
      }
      if (tier !== 'T2') continue;
      if (spec.digest.length) {
        const d = passBlock(prev, next, spec.digest);
        const p = signTestP(d.c, d.b);
        report.digest = { prev: d.prev, new: d.new, n: d.n, b: d.b, c: d.c, p };
        if (d.c > d.b && p <= th.screen_alpha) digest.push(`${suite} ${name}: better on mid-difficulty tasks, pass ${d.prev}/${d.n} -> ${d.new}/${d.n} (${d.c} better, ${d.b} worse; p ${p.toFixed(4)})`);
      }
    }
  }

  if (particleFlags.length) {
    digest.push(...particleFlags.map((f) => `${suite} particle-1 (descriptive): ${f}`));
    if (tier === 'T2' && (input.previous?.particle_flags.length ?? 0) > 0) {
      reasons.push({ rule: 'particle_repeat', status: 'WATCH', model: 'particle', tier, sticky: true, detail: `particle-1 flagged on two screens in a row: ${particleFlags.join('; ')}`, check_first: 'tool schemas or instructions a smaller model misreads' });
    }
  }

  // Earlier tiers of the same run: a reason this tier measured again is superseded, a sticky one carries forward, and a
  // screen flag this tier did not repeat is cleared.
  const cleared: Reason[] = [...(input.earlier?.cleared ?? [])];
  const carried: Reason[] = [];
  for (const r of input.earlier?.reasons ?? []) {
    const again = reasons.some((x) => x.model === r.model && family(x.rule) === family(r.rule));
    if (again) continue;
    if (r.sticky || r.status === 'BROKEN' || r.status === 'INCOMPLETE') carried.push(r);
    else cleared.push(r);
  }
  reasons.unshift(...carried);

  const status = worst(reasons.map((r) => r.status));
  const fresh = reasons.filter((r) => r.tier === tier && r.model !== 'particle' && r.status === 'WATCH');
  let next: Next = 'none';
  if (status !== 'BROKEN' && status !== 'INCOMPLETE') {
    if (tier === 'T0') next = 'T1';
    else if (tier === 'T1' && fresh.length) next = 'T2';
    else if (tier === 'T2' && fresh.some((r) => r.confirm_with === 'T3')) next = range.length > 1 ? 'bisect' : 'T3';
  }
  return {
    schema: 'canary-verdict/1', suite, run_id: input.run_id, tier, tiers_run: [...(input.earlier?.tiers_run ?? []), tier], status, next,
    release: { prev: input.release.prev, new: input.release.new, range, bisect: input.release.bisect ?? input.earlier?.release.bisect ?? null },
    install_route: input.install_route ?? input.earlier?.install_route ?? null,
    receipts_dir: input.receipts_dir ?? input.earlier?.receipts_dir ?? `runs/${input.run_id}/${suite}`,
    reasons, cleared, models: { ...(input.earlier?.models ?? {}), ...models },
    particle_flags: tier === 'T2' ? particleFlags : (input.earlier?.particle_flags ?? []), digest, notes,
  };
}

/** The frontier models whose screen flags send a run to T3 or bisect. */
export function flaggedModels(v: Verdict): ModelKey[] {
  return [...new Set(v.reasons.filter((r) => r.confirm_with === 'T3' && r.model && r.model !== 'particle').map((r) => r.model!))];
}

/** Every trials.jsonl row that carries a canary block; a torn last line of a partial file is skipped. */
export function readTrials(paths: readonly string[]): CanaryTrial[] {
  const rows: CanaryTrial[] = [];
  for (const p of paths) {
    let text = '';
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r && r.canary) rows.push(r); } catch { /* torn line */ }
    }
  }
  return rows;
}

// ---- CLI ----------------------------------------------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
  const flag = (n: string) => all(n).at(-1);
  const fail = (m: string): never => { console.error('decide: ' + m); process.exit(2); };
  const need = (n: string) => flag(n) ?? fail(`${n} is required`);
  const json = <T>(p: string | undefined): T | null => { if (!p) return null; try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; } };
  const suite = need('--suite') as Suite, tier = need('--tier') as Tier;
  if (!['gstack', 'gbrain'].includes(suite) || !['T0', 'T1', 'T2', 'T3'].includes(tier)) fail('bad --suite or --tier');
  const prereg = json<{ thresholds: Thresholds; suites?: Partial<Record<Suite, { install_route?: Record<string, string> }>> }>(need('--prereg'));
  const tasks = json<TasksFile>(need('--tasks'));
  if (!prereg?.thresholds || !tasks) fail('--prereg or --tasks is unreadable');
  const t0Exit = flag('--t0-exit'), suiteExit = flag('--suite-exit'), bisect = flag('--bisect');
  const verdict = decide({
    suite, tier, trials: readTrials(all('--trials')), tasks: tasks!, thresholds: prereg!.thresholds,
    expected: { arms: (flag('--arms') ?? 'plain,prev,new').split(',') as Arm[], models: (flag('--models') ?? 'opus,sol').split(',') as ModelKey[] },
    release: {
      prev: { sha: need('--prev-sha'), version: need('--prev-version') }, new: { sha: need('--new-sha'), version: need('--new-version') },
      range: json<Move[]>(flag('--range')) ?? undefined, bisect: bisect ? JSON.parse(bisect) : undefined,
    },
    run_id: need('--run-id'), receipts_dir: flag('--receipts-dir'), install_route: prereg!.suites?.[suite]?.install_route ?? null,
    t0: tier === 'T0' ? { exit: t0Exit === undefined ? -1 : Number(t0Exit), report: json<T0Report>(flag('--t0')) } : null,
    suite_exit: suiteExit === undefined ? null : Number(suiteExit),
    earlier: json<Verdict>(flag('--earlier')), previous: json<Verdict>(flag('--previous')), ref_moved: argv.includes('--ref-moved'), notes: all('--note'),
    failure: flag('--failure') ? { detail: flag('--failure')!, check_first: flag('--check-first') ?? 'the run log' } : null,
  });
  const out = need('--out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
  writeFileSync(join(out, 'alert.md'), (verdict.status === 'OK' ? renderOk(verdict) : renderAlert(verdict)) + '\n');
  console.log(`${verdict.status} next=${verdict.next}`);
}
