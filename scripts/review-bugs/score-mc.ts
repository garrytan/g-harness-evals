#!/usr/bin/env bun
// Paired scoring for the review real-bugs eval, which asks whether gstack's code review catches real bugs better than a
// plain review prompt (plan sections "Numbers and verdict" and "Grading").
//
//   bun scripts/review-bugs/score-mc.ts --suite <suite.json> --root <arms root> --reference <plain arm id>
//     --variant <arm id> [--variant <arm id>] --exposure <arm id>=pass|fail [--exposure ...] --mdd <points>
//     --kappa pass|fail --seed <n> [--draws 10000] [--mc-seed <n>] [--mc-draws 10000] [--cell <name>] [--json] [--out <file>]
//
// Input is exactly what gstack-evals' noloss derive writes and noloss score reads: a suite file and ingested arms under
// <root>/<suite id>/<arm id>/ (arm contract v1: arm.json, findings/<unit>.jsonl, judgments.tsv, adjudication.tsv, and
// ingest.json, whose tree digest is checked). The H stratum is left out with derive --drop-file before this runs.
//
// For each gstack arm against the plain arm, on one cell:
// - Co-primary recall differences (arm minus plain), each bug's value being the share of an arm's passes that found it,
//   averaged over bugs, as noloss score does: blocking recall (blocking bugs, outcome F) and any-severity recall (bugs
//   that are not over-blocking, outcome F or D; noloss's detection metric).
// - A 95% PR-clustered bootstrap interval for each, from runner/stats/paired.ts clusteredPairedDelta, the same function
//   noloss score calls, so the same seed and draws give the same interval.
// - A seeded Monte Carlo sign-flip p for each (noloss-stats.ts mcSignFlip) on noloss's own cluster statistic. noloss's
//   exact test enumerates by convolution; with 110 to 150 PR clusters the plan freezes a Monte Carlo seed and draw count.
// - Holm's step-down on the two co-primaries' two-sided p together, within each comparison (the preregistration's
//   "Holm" line). A KEEP whose Holm-adjusted blocking p is above 0.05 becomes INCONCLUSIVE, with the unadjusted
//   verdict kept beside it.
// - The guard, arm minus plain, paired, with 95% intervals: must-fix false alarms per decoy PR (noloss score's
//   false-alarm gate, oriented arm minus plain) and false blockers per bug PR (noloss score's false-blocker tally on PRs
//   that are not decoys). Preset limit: +0.5 per PR on the upper bound. When the adjudication kappa check failed, false
//   blockers on bug PRs are descriptive and only the decoy false alarms guard the verdict.
// - The verdict (decideVerdict below), with the exposure-gate result and the MDD as inputs.
// No model is called. The output is deterministic for given seeds and draws.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, type PairedItem } from '../../runner/stats/paired.ts';
import { holmSteps, mcSignFlip, noTestReason, type McSignFlip } from './noloss-stats.ts';

export const RECORD = 'review-bugs-score-mc';
export const VERSION = 1;
/** The plan's preset guard limit: arm minus plain, per PR, on the 95% upper bound. */
export const LIMIT_PER_PR = 0.5;
export const DEFAULT_DRAWS = 10000;
export const RECALL_ONLY_KEEP = 'KEEP (recall only; false blockers on bug PRs unmeasured)';

type Counts = 'blocking' | 'detection' | 'over-blocking';
type Mapped = 'CRITICAL' | 'INFORMATIONAL';
type Outcome = 'F' | 'D' | 'M';
type Ruling = 'defect' | 'not-defect' | 'known-informational';

export interface Blocker { id: string; counts: Counts }
export interface Unit { id: string; repo: string; pr: number; head: string; cluster: string; group: string | null; blockers: Blocker[] }
export interface Suite { id: string; kind: string; units: Unit[] }

export interface Finding { key: string; mapped: Mapped | null }
export interface Judgment { unit: string; blocker: string; pass: number; outcome: Outcome; matched: string[]; saw_label: boolean; coverage: 'complete' | 'incomplete' }
export interface Adjudication { finding: string; ruling: Ruling; saw_label: boolean }
export interface ArmData {
  id: string;
  passes: number;
  status: 'complete' | 'stopped';
  tree_sha256: string | null;
  /** By unit id; null for a transcribed arm, which has no findings. */
  findings: Map<string, Finding[]> | null;
  judgments: Judgment[];
  adjudications: Adjudication[];
}

export class ScoreMcError extends Error {}
const fail = (message: string): never => {
  throw new ScoreMcError(message);
};
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function loadSuite(path: string): { suite: Suite; sha256: string } {
  const text = readFileSync(path, 'utf8');
  const suite = JSON.parse(text) as Suite;
  if (typeof suite.id !== 'string' || !Array.isArray(suite.units) || !suite.units.length) fail('suite ' + path + ' has no id or no units');
  return { suite, sha256: sha256(text) };
}

/** noloss resolveUnit: [<owner>/<repo>#]<pr>[@<head prefix>], with __ for / in a file name. */
export function resolveUnit(suite: Suite, ref: string): Unit {
  const m = /^(?:([A-Za-z0-9_.-]+)(?:\/|__)([A-Za-z0-9_.-]+)#)?(\d+)(?:@([0-9a-f]{7,40}))?$/.exec(ref);
  if (!m) return fail(JSON.stringify(ref) + ' is not a unit ref');
  const repo = m[1] ? m[1] + '/' + m[2] : null;
  const hits = suite.units.filter((u) => u.pr === Number(m[3]) && (repo === null || u.repo === repo) && (!m[4] || u.head.startsWith(m[4])));
  if (hits.length !== 1) fail(JSON.stringify(ref) + ' names ' + hits.length + ' units of suite ' + suite.id);
  return hits[0]!;
}

function parseTsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
  const header = lines[0]?.split('\t') ?? [];
  return lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((c, i) => [header[i] ?? '', c])));
}

const rawLabel = (f: Record<string, unknown>) => String(typeof f.label === 'string' && f.label ? f.label : f.severity).split(',')[0]!.trim();
type SeverityMap = { default?: Record<string, Mapped>; by_reader?: Record<string, Record<string, Mapped>> };
function mapSeverity(map: SeverityMap | undefined, raw: string, reader: string | null): Mapped | null {
  if (raw === 'CRITICAL' || raw === 'INFORMATIONAL') return raw;
  return (reader !== null ? map?.by_reader?.[reader]?.[raw] : undefined) ?? map?.default?.[raw] ?? null;
}

function readTree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    if (name === 'findings') for (const f of readdirSync(join(dir, name))) files.set('findings/' + f, readFileSync(join(dir, name, f)));
    else files.set(name, readFileSync(join(dir, name)));
  }
  return files;
}

/** noloss treeDigest: sha256 over each file's name and sha256, ingest.json left out. */
const treeDigest = (files: Map<string, Buffer>) => sha256([...files].filter(([k]) => k !== 'ingest.json').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + '\0' + sha256(v)).join('\n'));

/** Reads an arm the way noloss score does, for the fields this scorer needs. A missing judgment row is an error, never a miss. */
export function loadArm(dir: string, suite: Suite, suiteSha256: string): ArmData {
  if (!existsSync(join(dir, 'arm.json'))) fail('no arm at ' + dir);
  const files = readTree(dir);
  let tree: string | null = null;
  const record = files.get('ingest.json');
  if (record) {
    const r = JSON.parse(record.toString('utf8')) as { tree_sha256?: string; suite_sha256?: string };
    tree = treeDigest(files);
    if (r.tree_sha256 !== tree) fail(dir + ': files hash to tree ' + tree + ', not the ' + r.tree_sha256 + ' ingest recorded');
    if (r.suite_sha256 !== suiteSha256) fail(dir + ': ingested against suite digest ' + r.suite_sha256 + ', but the suite hashes to ' + suiteSha256);
  }
  const arm = JSON.parse(files.get('arm.json')!.toString('utf8')) as { id: string; suite: string; passes: number; status?: 'complete' | 'stopped'; provenance?: string; severity_map?: SeverityMap };
  if (arm.suite !== suite.id) fail(dir + ': arm names suite ' + arm.suite + ', not ' + suite.id);
  if (!Number.isSafeInteger(arm.passes) || arm.passes < 1) fail(dir + ': passes must be a positive integer');
  let findings: Map<string, Finding[]> | null = null;
  const byRef = new Map<string, { id: string; index: number }[]>();
  if (arm.provenance !== 'transcribed') {
    findings = new Map();
    for (const [name, bytes] of files) {
      if (!name.startsWith('findings/')) continue;
      const unit = resolveUnit(suite, name.slice('findings/'.length).replace(/\.jsonl$/, ''));
      const list: Finding[] = [];
      const lines = bytes.toString('utf8').replace(/\n$/, '').split('\n').filter((l, i, all) => !(all.length === 1 && l === ''));
      lines.forEach((text, index) => {
        const f = JSON.parse(text) as Record<string, unknown>;
        const pass = (f.pass as number | undefined) ?? 1;
        const id = String(f.id ?? f.fingerprint ?? '#' + index);
        const key = unit.id + '\0' + pass + '\0' + id;
        list.push({ key, mapped: mapSeverity(arm.severity_map, rawLabel(f), (f.reader ?? f.specialist ?? f.voice ?? null) as string | null) });
        const k = unit.id + '\0' + pass;
        byRef.set(k, [...(byRef.get(k) ?? []), { id, index }]);
      });
      findings.set(unit.id, list);
    }
    for (const u of suite.units) if (!findings.has(u.id)) fail(dir + ': no findings file for ' + u.id);
  }
  const findingKey = (unit: Unit, pass: number, ref: string) => {
    const list = byRef.get(unit.id + '\0' + pass) ?? [];
    const f = list.find((x) => x.id === ref) ?? (/^#\d+$/.test(ref) ? list.find((x) => x.index === Number(ref.slice(1))) : undefined);
    return f ? unit.id + '\0' + pass + '\0' + f.id : fail(dir + ': ' + JSON.stringify(ref) + ' is not a pass-' + pass + ' finding of ' + unit.id);
  };
  const jText = files.get('judgments.tsv') ?? fail(dir + ': no judgments.tsv; the arm is not judged');
  const judgments: Judgment[] = [];
  const seen = new Set<string>();
  for (const c of parseTsv(jText.toString('utf8'))) {
    const unit = resolveUnit(suite, c.pr ?? '');
    const pass = c.pass ? Number(c.pass) : 1;
    if (!unit.blockers.some((b) => b.id === c.blocker_id)) fail(dir + ': ' + unit.id + ' has no blocker ' + c.blocker_id);
    const k = unit.id + ' ' + c.blocker_id + ' ' + pass;
    if (seen.has(k)) fail(dir + ': a second judgment row for ' + k);
    seen.add(k);
    const refs = (c.matched_finding ?? '').split(';').map((s) => s.trim()).filter((s) => s && s !== '-' && s !== 'none' && s !== 'unavailable');
    judgments.push({ unit: unit.id, blocker: c.blocker_id!, pass, outcome: c.outcome as Outcome, matched: findings ? refs.map((r) => findingKey(unit, pass, r)) : [], saw_label: c.saw_label === 'yes', coverage: c.coverage === 'incomplete' ? 'incomplete' : 'complete' });
  }
  for (const u of suite.units) for (const b of u.blockers) for (let p = 1; p <= arm.passes; p++) if (!seen.has(u.id + ' ' + b.id + ' ' + p)) fail(dir + ': no judgment row for ' + u.id + ' ' + b.id + ' pass ' + p);
  const adjudications: Adjudication[] = [];
  const aText = files.get('adjudication.tsv');
  if (aText && findings)
    for (const c of parseTsv(aText.toString('utf8'))) {
      const unit = resolveUnit(suite, c.pr ?? '');
      adjudications.push({ finding: findingKey(unit, c.pass ? Number(c.pass) : 1, c.finding ?? ''), ruling: c.ruling as Ruling, saw_label: c.saw_label === 'yes' });
    }
  return { id: arm.id, passes: arm.passes, status: arm.status ?? 'complete', tree_sha256: tree, findings, judgments, adjudications };
}

const judgmentIndex = (arm: ArmData) => new Map(arm.judgments.map((j) => [j.unit + ' ' + j.blocker + ' ' + j.pass, j]));

function share(arm: ArmData, js: Map<string, Judgment>, u: Unit, b: Blocker, hit: (j: Judgment) => boolean): number {
  let n = 0;
  for (let p = 1; p <= arm.passes; p++) {
    const j = js.get(u.id + ' ' + b.id + ' ' + p);
    if (j && hit(j)) n++;
  }
  return n / arm.passes;
}

/** Per-bug paired values, a = plain and b = the gstack arm, clustered by PR, in suite order. */
export function bugPairs(suite: Suite, variant: ArmData, reference: ArmData, endpoint: 'blocking' | 'any_severity'): PairedItem[] {
  const keep = endpoint === 'blocking' ? (b: Blocker) => b.counts === 'blocking' : (b: Blocker) => b.counts !== 'over-blocking';
  const hit = endpoint === 'blocking' ? (j: Judgment) => j.outcome === 'F' : (j: Judgment) => j.outcome !== 'M';
  const jv = judgmentIndex(variant);
  const jr = judgmentIndex(reference);
  return suite.units.flatMap((u) => u.blockers.filter(keep).map((b) => ({ id: u.id + ' ' + b.id, cluster: u.cluster, a: share(reference, jr, u, b, hit), b: share(variant, jv, u, b, hit) })));
}

export interface Endpoint {
  bugs: number;
  clusters: number;
  recall: { variant: number; reference: number };
  /** Arm minus plain, as a share (0.1 is 10 points). */
  delta: number;
  ci95: [number, number] | null;
  sign_flip: McSignFlip | null;
  sign_flip_reason: string | null;
  /** Holm-adjusted two-sided p, the two co-primaries of one comparison adjusted together. */
  p_holm: number | null;
}

function endpoint(pairs: PairedItem[], passes: number[], o: Options): Endpoint {
  if (!pairs.length) fail('the suite has no bugs for this endpoint');
  const d = clusteredPairedDelta(pairs, { seed: o.seed, draws: o.draws });
  return {
    bugs: pairs.length,
    clusters: d.n_clusters,
    recall: { variant: round(d.mean_b), reference: round(d.mean_a) },
    delta: round(d.delta),
    ci95: d.ci95 ? [round(d.ci95[0]), round(d.ci95[1])] : null,
    sign_flip: mcSignFlip(pairs, passes, { seed: o.mc_seed, draws: o.mc_draws }),
    sign_flip_reason: noTestReason(pairs),
    p_holm: null,
  };
}

interface Tally { false: number; unadjudicated: number; labelled: boolean; blind: boolean }

/** noloss tallyFalseBlockers, per unit: every blocking finding once, settled by judgments.tsv, else by adjudication.tsv. */
export function tallyFalse(suite: Suite, arm: ArmData): Map<string, Tally> | null {
  if (!arm.findings) return null;
  const blockerOf = new Map(suite.units.flatMap((u) => u.blockers.map((b) => [u.id + ' ' + b.id, b] as const)));
  const matched = new Map<string, Blocker[]>();
  for (const j of arm.judgments) for (const f of j.matched) matched.set(f, [...(matched.get(f) ?? []), blockerOf.get(j.unit + ' ' + j.blocker)!]);
  const ruled = new Map(arm.adjudications.map((a) => [a.finding, a]));
  const out = new Map<string, Tally>();
  for (const u of suite.units) {
    const t: Tally = { false: 0, unadjudicated: 0, labelled: false, blind: false };
    for (const f of arm.findings.get(u.id) ?? []) {
      if (f.mapped !== 'CRITICAL') continue;
      const blockers = matched.get(f.key) ?? [];
      if (blockers.some((b) => b.counts !== 'over-blocking')) continue;
      const row = blockers.length ? undefined : ruled.get(f.key);
      if (row) {
        t.labelled ||= row.saw_label;
        t.blind ||= !row.saw_label;
      }
      const ruling = blockers.length ? 'known-informational' : row?.ruling;
      if (ruling === undefined) t.unadjudicated++;
      else if (ruling !== 'defect') t.false++;
    }
    out.set(u.id, t);
  }
  return out;
}

export interface Guard {
  /** decoys: false alarms per decoy PR; bug_prs: false blockers per bug PR. */
  scope: 'decoys' | 'bug_prs';
  /** guard: it can stop a KEEP; descriptive: reported only (the adjudication kappa check failed). */
  role: 'guard' | 'descriptive';
  prs: number;
  per_pr: { variant: number; reference: number };
  difference: number | null;
  ci95: [number, number] | null;
  limit: number;
  /** Whether the interval's upper bound is at or under the limit; null when the reading is incomplete. */
  within_limit: boolean | null;
  reasons: string[];
}

/** noloss score's decoys: units whose every blocker is a bait (group decoy in a plan suite). */
export const isDecoy = (suite: Suite, u: Unit) => (suite.kind === 'plan' ? u.group === 'decoy' : u.blockers.every((b) => b.counts === 'over-blocking'));

function guard(suite: Suite, v: ArmData, r: ArmData, scope: Guard['scope'], role: Guard['role'], noVerdict: string | null, o: Options): Guard {
  const units = suite.units.filter((u) => isDecoy(suite, u) === (scope === 'decoys'));
  const reasons: string[] = noVerdict ? [noVerdict] : [];
  const tv = tallyFalse(suite, v);
  const tr = tallyFalse(suite, r);
  for (const [a, t] of [[v, tv], [r, tr]] as const) if (!t) reasons.push('arm ' + a.id + ' is transcribed: it has no findings to adjudicate');
  if (!units.length) reasons.push(scope === 'decoys' ? 'the suite has no decoy PRs' : 'the suite has no bug PRs');
  const base = { scope, role, limit: LIMIT_PER_PR };
  if (!tv || !tr || !units.length) return { ...base, prs: 0, per_pr: { variant: 0, reference: 0 }, difference: null, ci95: null, within_limit: null, reasons };
  const flag = (k: 'labelled' | 'blind') => units.some((u) => tv.get(u.id)![k] || tr.get(u.id)![k]);
  if (flag('labelled') && flag('blind')) reasons.push('labelled and blind adjudication are never pooled');
  else if (scope === 'decoys' && flag('labelled')) reasons.push('the decoy rulings are labelled adjudication, and the gate reads blind adjudication only');
  for (const [a, t] of [[v, tv], [r, tr]] as const) {
    const n = units.reduce((s, u) => s + t.get(u.id)!.unadjudicated, 0);
    if (n) reasons.push('arm ' + a.id + ' has ' + n + ' blocking finding' + (n > 1 ? 's' : '') + ' with no adjudication row on ' + (scope === 'decoys' ? 'decoys' : 'bug PRs'));
  }
  const items: PairedItem[] =
    scope === 'decoys'
      ? units.map((u) => ({ id: u.id, cluster: u.cluster, a: tr.get(u.id)!.false / r.passes, b: tv.get(u.id)!.false / v.passes }))
      : [...new Set(units.map((u) => u.cluster))].sort().map((c) => {
          const sum = (t: Map<string, Tally>) => units.filter((u) => u.cluster === c).reduce((s, u) => s + t.get(u.id)!.false, 0);
          return { id: c, cluster: c, a: sum(tr) / r.passes, b: sum(tv) / v.passes };
        });
  const mean = (k: 'a' | 'b') => round(items.reduce((s, x) => s + x[k], 0) / items.length);
  const per_pr = { variant: mean('b'), reference: mean('a') };
  if (reasons.length) return { ...base, prs: items.length, per_pr, difference: null, ci95: null, within_limit: null, reasons };
  const d = clusteredPairedDelta(items, { seed: o.seed, draws: o.draws });
  const ci95: [number, number] | null = d.ci95 ? [round(d.ci95[0]), round(d.ci95[1])] : null;
  return { ...base, prs: items.length, per_pr, difference: round(d.delta), ci95, within_limit: ci95 ? ci95[1] <= LIMIT_PER_PR + 1e-9 : null, reasons: ci95 ? [] : ['fewer than 2 PRs, so no interval'] };
}

export type Label = 'KEEP' | typeof RECALL_ONLY_KEEP | 'LOSS' | 'CUT-CANDIDATE' | 'FIX-METHOD' | 'INCONCLUSIVE' | 'NO VERDICT';

export interface VerdictInput {
  blocking: [number, number] | null;
  any_severity: [number, number] | null;
  exposure: 'pass' | 'fail';
  mdd_points: number;
  kappa: 'pass' | 'fail';
  /** The guards that apply: decoy false alarms always, bug-PR false blockers only when the kappa check passed. */
  guards: Array<Pick<Guard, 'scope' | 'ci95' | 'within_limit' | 'reasons'>>;
  no_verdict: string | null;
}

/**
 * The plan's verdict rules, in this order. Intervals are 95% and in shares; "above zero" is a lower bound over 0 and
 * "below zero" an upper bound under 0.
 * 1. FIX-METHOD when the exposure gate failed.
 * 2. LOSS when either co-primary interval is below zero.
 * 3. Recall rose (both co-primary intervals above zero, or blocking above zero with any-severity not below zero):
 *    KEEP when every guard's upper bound is at or under +0.5 per PR (the recall-only KEEP label when the adjudication
 *    kappa check failed), FIX-METHOD when one is over, INCONCLUSIVE when a guard could not be read.
 * 4. CUT-CANDIDATE when the blocking interval's upper bound is below the MDD. It stands only after one "Why null?"
 *    cycle, and one attempt to raise plain's ceiling if plain is near it.
 * 5. INCONCLUSIVE otherwise.
 * A stopped arm or a judgment with coverage incomplete gives NO VERDICT, as in noloss score.
 */
export function decideVerdict(i: VerdictInput): { label: Label; rule: string } {
  if (i.no_verdict) return { label: 'NO VERDICT', rule: i.no_verdict };
  if (i.exposure === 'fail') return { label: 'FIX-METHOD', rule: 'the exposure gate failed, so the arm did not run gstack as shipped' };
  const b = i.blocking;
  const a = i.any_severity;
  if (!b || !a) return { label: 'NO VERDICT', rule: 'a co-primary has no interval (fewer than 2 PR clusters)' };
  if (b[1] < 0 || a[1] < 0) return { label: 'LOSS', rule: (b[1] < 0 ? 'the blocking' : 'the any-severity') + ' recall interval is below zero' };
  if (b[0] > 0 && (a[0] > 0 || a[1] >= 0)) {
    const unread = i.guards.filter((g) => g.within_limit === null);
    if (unread.length) return { label: 'INCONCLUSIVE', rule: 'recall rose, but the false-alarm guard could not be read: ' + unread.map((g) => g.scope + ', ' + g.reasons.join('; ')).join('; ') };
    const over = i.guards.filter((g) => g.within_limit === false);
    if (over.length) return { label: 'FIX-METHOD', rule: 'recall rose with false alarms over the limit of +' + LIMIT_PER_PR + ' per PR: ' + over.map((g) => (g.scope === 'decoys' ? 'false alarms per decoy PR' : 'false blockers per bug PR') + ' upper bound +' + g.ci95![1].toFixed(2)).join('; ') };
    const both = a[0] > 0 ? 'both co-primary intervals are above zero' : 'the blocking interval is above zero and the any-severity interval is not below zero';
    if (i.kappa === 'fail') return { label: RECALL_ONLY_KEEP, rule: both + ', and false alarms on decoys are within the limit; the adjudication kappa check failed, so false blockers on bug PRs are descriptive' };
    return { label: 'KEEP', rule: both + ', and every false-alarm upper bound is at or under +' + LIMIT_PER_PR + ' per PR' };
  }
  if (b[1] * 100 < i.mdd_points) return { label: 'CUT-CANDIDATE', rule: 'the exposure gate passed and the blocking interval\'s upper bound (' + (b[1] * 100).toFixed(1) + ' points) is below the MDD (' + i.mdd_points + ' points); a candidate until one "Why null?" cycle, and one attempt to raise plain\'s ceiling if plain is near it' };
  return { label: 'INCONCLUSIVE', rule: 'the blocking interval crosses zero and its upper bound (' + (b[1] * 100).toFixed(1) + ' points) is not below the MDD (' + i.mdd_points + ' points)' };
}

export interface Options {
  seed: number;
  draws: number;
  mc_seed: number;
  mc_draws: number;
  mdd_points: number;
  kappa: 'pass' | 'fail';
  /** Exposure-gate result per gstack arm id. */
  exposure: Record<string, 'pass' | 'fail'>;
}

export interface Comparison {
  variant: { id: string; passes: number; tree_sha256: string | null };
  exposure: 'pass' | 'fail';
  blocking: Endpoint;
  any_severity: Endpoint;
  false_alarms_per_decoy: Guard;
  false_blockers_per_bug_pr: Guard;
  verdict: { label: Label; rule: string };
  /** Whether a KEEP's blocking difference also holds after Holm (adjusted two-sided p at or under 0.05); null outside a KEEP. */
  keep_holds_after_holm: boolean | null;
  /** The KEEP that Holm turned into INCONCLUSIVE, shown beside it; null otherwise. */
  unadjusted_verdict: { label: Label; rule: string } | null;
}

export interface ScoreMcRecord {
  record: typeof RECORD;
  version: number;
  cell: string | null;
  suite: { id: string; sha256: string };
  reference: { id: string; passes: number; tree_sha256: string | null };
  inputs: { seed: number; draws: number; mc_seed: number; mc_draws: number; mdd_points: number; kappa: 'pass' | 'fail'; limit_per_pr: number };
  holm: { family: string[]; on: string } | null;
  comparisons: Comparison[];
}

/** Scores one cell: each gstack arm against plain, with Holm over its two co-primaries. */
export function scoreCell(suite: Suite, suiteSha256: string, reference: ArmData, variants: ArmData[], o: Options, cell: string | null = null): ScoreMcRecord {
  if (!variants.length) fail('give at least one gstack arm');
  if (!Number.isFinite(o.mdd_points) || o.mdd_points <= 0) fail('--mdd is a positive number of points');
  for (const a of [reference, ...variants]) if (new Set(a.judgments.map((j) => j.saw_label)).size > 1) fail('arm ' + a.id + ' mixes labelled and blind judgments; they are never pooled');
  const comparisons = variants.map((v): Comparison => {
    const exposure = o.exposure[v.id] ?? fail('no exposure-gate result for arm ' + v.id + '; pass --exposure ' + v.id + '=pass|fail');
    if (v.judgments[0]!.saw_label !== reference.judgments[0]!.saw_label) fail(v.id + ' vs ' + reference.id + ' would pool labelled and blind judgments');
    const stopped = [v, reference].filter((a) => a.status === 'stopped').map((a) => a.id);
    const incomplete = [v, reference].filter((a) => a.judgments.some((j) => j.coverage === 'incomplete')).map((a) => a.id);
    const noVerdict = stopped.length ? 'arm ' + stopped.join(' and ') + ' stopped, so there is no verdict' : incomplete.length ? 'arm ' + incomplete.join(' and ') + ' has bugs recorded with coverage incomplete, so there is no verdict' : null;
    const passes = [v.passes, reference.passes];
    const blocking = endpoint(bugPairs(suite, v, reference, 'blocking'), passes, o);
    const anySeverity = endpoint(bugPairs(suite, v, reference, 'any_severity'), passes, o);
    const decoys = guard(suite, v, reference, 'decoys', 'guard', noVerdict, o);
    const bugPrs = guard(suite, v, reference, 'bug_prs', o.kappa === 'pass' ? 'guard' : 'descriptive', noVerdict, o);
    const [pb, pa] = holmSteps([blocking.sign_flip?.p_two_sided ?? 1, anySeverity.sign_flip?.p_two_sided ?? 1]).adjusted;
    blocking.p_holm = round(pb!, 6);
    anySeverity.p_holm = round(pa!, 6);
    const raw = decideVerdict({ blocking: blocking.ci95, any_severity: anySeverity.ci95, exposure, mdd_points: o.mdd_points, kappa: o.kappa, guards: o.kappa === 'pass' ? [decoys, bugPrs] : [decoys], no_verdict: noVerdict });
    const keep = raw.label === 'KEEP' || raw.label === RECALL_ONLY_KEEP;
    const holds = keep ? blocking.p_holm <= 0.05 : null;
    const verdict = holds === false ? { label: 'INCONCLUSIVE' as const, rule: 'the blocking difference does not hold after Holm (adjusted p ' + fmtP(blocking.p_holm) + ' is above 0.05); unadjusted: ' + raw.label } : raw;
    return { variant: { id: v.id, passes: v.passes, tree_sha256: v.tree_sha256 }, exposure, blocking, any_severity: anySeverity, false_alarms_per_decoy: decoys, false_blockers_per_bug_pr: bugPrs, verdict, keep_holds_after_holm: holds, unadjusted_verdict: holds === false ? raw : null };
  });
  const holm: ScoreMcRecord['holm'] = { family: ['blocking', 'any_severity'], on: 'two-sided Monte Carlo sign-flip p, the two co-primaries together within each comparison' };
  return {
    record: RECORD,
    version: VERSION,
    cell,
    suite: { id: suite.id, sha256: suiteSha256 },
    reference: { id: reference.id, passes: reference.passes, tree_sha256: reference.tree_sha256 },
    inputs: { seed: o.seed, draws: o.draws, mc_seed: o.mc_seed, mc_draws: o.mc_draws, mdd_points: o.mdd_points, kappa: o.kappa, limit_per_pr: LIMIT_PER_PR },
    holm,
    comparisons,
  };
}

const pts = (x: number) => (x > 0 ? '+' : '') + (x * 100).toFixed(1);
const per = (x: number) => (x > 0 ? '+' : '') + x.toFixed(2);
const fmtP = (p: number) => (p >= 0.01 ? p.toFixed(3) : p.toPrecision(2));

/** The short plain-English summary. */
export function renderText(rec: ScoreMcRecord): string {
  const out: string[] = [];
  const i = rec.inputs;
  out.push((rec.cell ? 'Cell ' + rec.cell + ', ' : '') + 'suite ' + rec.suite.id + ' (sha256 ' + rec.suite.sha256.slice(0, 12) + '), plain arm ' + rec.reference.id + '. Bootstrap seed ' + i.seed + ', ' + i.draws + ' draws; sign-flip seed ' + i.mc_seed + ', ' + i.mc_draws + ' Monte Carlo draws. MDD ' + i.mdd_points + ' points, adjudication kappa check ' + i.kappa + '.');
  for (const c of rec.comparisons) {
    out.push('');
    out.push(c.variant.id + ' vs ' + rec.reference.id + ' (exposure gate ' + c.exposure + '):');
    for (const [name, e] of [['blocking recall', c.blocking], ['any-severity recall', c.any_severity]] as const) {
      const sf = e.sign_flip;
      out.push('  ' + name + ' ' + (e.recall.variant * 100).toFixed(1) + '% vs ' + (e.recall.reference * 100).toFixed(1) + '% on ' + e.bugs + ' bugs in ' + e.clusters + ' PRs: ' + pts(e.delta) + ' points' + (e.ci95 ? ' [95% CI ' + pts(e.ci95[0]) + ', ' + pts(e.ci95[1]) + ']' : ' (no interval)') + (sf ? ', two-sided sign-flip p ' + fmtP(sf.p_two_sided) + ' (Monte Carlo SE ' + sf.mc_se.two_sided.toFixed(4) + ')' : ', no sign-flip test (' + e.sign_flip_reason + ')') + (e.p_holm !== null ? ', Holm ' + fmtP(e.p_holm) + ' over the ' + rec.holm!.family.length + ' co-primaries' : '') + '.');
    }
    for (const g of [c.false_alarms_per_decoy, c.false_blockers_per_bug_pr]) {
      const what = g.scope === 'decoys' ? 'false alarms per decoy PR' : 'false blockers per bug PR';
      out.push('  ' + what + (g.role === 'descriptive' ? ' (descriptive)' : '') + ': ' + c.variant.id + ' ' + g.per_pr.variant.toFixed(2) + ', ' + rec.reference.id + ' ' + g.per_pr.reference.toFixed(2) + (g.difference === null ? ', not read (' + g.reasons.join('; ') + ')' : ', difference ' + per(g.difference) + (g.ci95 ? ' [95% CI ' + per(g.ci95[0]) + ', ' + per(g.ci95[1]) + ']' : '') + ' on ' + g.prs + ' PRs; limit +' + g.limit + ': ' + (g.within_limit ? 'within' : 'over')) + '.');
    }
    out.push('  verdict: ' + c.verdict.label + ' (' + c.verdict.rule + ').');
    if (c.unadjusted_verdict) out.push('  unadjusted verdict: ' + c.unadjusted_verdict.label + ' (' + c.unadjusted_verdict.rule + ').');
  }
  return out.join('\n') + '\n';
}

function main(argv: string[]): void {
  const flags = new Map<string, string[]>();
  const repeat = new Set(['--variant', '--exposure']);
  const known = new Set(['--suite', '--root', '--reference', '--variant', '--exposure', '--mdd', '--kappa', '--seed', '--draws', '--mc-seed', '--mc-draws', '--cell', '--out', '--json']);
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (!known.has(a)) fail('score-mc does not take ' + JSON.stringify(a));
    if (a === '--json') {
      flags.set(a, ['true']);
      continue;
    }
    const v = argv[++k];
    if (v === undefined || v.startsWith('--')) fail(a + ' needs a value');
    if (!repeat.has(a) && flags.has(a)) fail(a + ' is given twice');
    flags.set(a, [...(flags.get(a) ?? []), v!]);
  }
  const need = (n: string) => flags.get(n)?.[0] ?? fail('score-mc needs ' + n);
  const int = (n: string, fallback?: number) => {
    const raw = flags.get(n)?.[0];
    if (raw === undefined) return fallback ?? fail('score-mc needs ' + n);
    const x = Number(raw);
    return Number.isSafeInteger(x) && x >= 0 ? x : fail(n + ' is a non-negative integer, not ' + JSON.stringify(raw));
  };
  const kappaRaw = need('--kappa');
  const kappa = kappaRaw === 'pass' || kappaRaw === 'fail' ? kappaRaw : fail('--kappa is pass or fail');
  const exposure: Record<string, 'pass' | 'fail'> = {};
  for (const e of flags.get('--exposure') ?? []) {
    const m = /^([A-Za-z0-9][A-Za-z0-9_-]*)=(pass|fail)$/.exec(e) ?? fail('--exposure takes <arm id>=pass|fail, not ' + JSON.stringify(e));
    exposure[m[1]!] = m[2] as 'pass' | 'fail';
  }
  const seed = int('--seed');
  const o: Options = { seed, draws: int('--draws', DEFAULT_DRAWS), mc_seed: int('--mc-seed', seed), mc_draws: int('--mc-draws', DEFAULT_DRAWS), mdd_points: Number(need('--mdd')), kappa, exposure };
  const { suite, sha256: suiteSha } = loadSuite(need('--suite'));
  const dir = join(need('--root'), suite.id);
  const variants = (flags.get('--variant') ?? fail('score-mc needs --variant')).map((id) => loadArm(join(dir, id), suite, suiteSha));
  const rec = scoreCell(suite, suiteSha, loadArm(join(dir, need('--reference')), suite, suiteSha), variants, o, flags.get('--cell')?.[0] ?? null);
  const json = JSON.stringify(rec, null, 2) + '\n';
  const out = flags.get('--out')?.[0];
  if (out) writeFileSync(out, json);
  process.stdout.write(flags.has('--json') ? json : renderText(rec));
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ScoreMcError)) throw e;
    process.stderr.write('score-mc: ' + e.message + '\n');
    process.exit(2);
  }
}
