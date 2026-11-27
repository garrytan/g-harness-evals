// The C2 standing-rules eval's analysis (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md, Analysis and What the result
// changes): per direction and pooled, the rules arm minus the switch-off control arm on the applied rate (the primary contrast,
// which decides), and the rules arm minus the remember arm (secondary, descriptive), each paired by item and direction, with
// Newcombe's paired 95% interval (the decision interval), a 95% item-cluster bootstrap interval beside it (10,000 draws, seed 3827)
// and the exact McNemar test; the coding check's paired solved counts per harness; the part-ran rates per cell; the cap stops
// (runner events, not harness or model failures); and the decision rule the primary contrast meets. Reads trials.jsonl from
// each results directory given, in order: the last line per trial id wins, so a rerun in a later directory replaces the earlier
// attempt, and every attempt is listed. Keyless.
// usage: bun scripts/c2-standing-rules/analyze.ts <results dir>... [--json <out>] [--md <out>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta, exactMcNemar, type PairedItem } from '../../runner/stats/paired.ts';
import { safetyStops } from '../gbrain-first-wow/analyze.ts';
import type { C2Score } from './score.ts';
import { COUNTED_ITEMS } from './items.ts';

export const STATED_DIFFERENCE = 0.15;
export const ALPHA = 0.05;
/** Rule 5: the section-on arm solving at least this many fewer of a harness's paired coding tasks fails the coding check. */
export const CODING_FAIL_GAP = 3;
/** A harness's coding check is complete with at least this many of its 15 seeds scored in both states; fewer blocks rule 1. */
export const CODING_MIN_PAIRS = 12;
/** Correction pairs the counted run plans: every counted item in both directions. */
export const PLANNED_PAIRS = COUNTED_ITEMS.length * 2;
export const BOOTSTRAP = { seed: 3827, draws: 10000 };
/** The primary contrast decides; the secondary is reported beside it and decides nothing. */
export const PRIMARY = { test: 'rules', base: 'control' } as const;
export const SECONDARY = { test: 'rules', base: 'remember' } as const;
/** Terminations that drop a trial (and its pair) instead of scoring it: no model ran it to an end we can read. */
export const DROPPED: ReadonlySet<string> = new Set(['infra_error', 'model_error', 'exam_fault']);

export interface Rec { dir?: string; trial_id: string; cell: string; task: string; harness: string; model: string; termination: string; cap_stop?: boolean; usage?: { usd?: number } | null; wall_ms?: number; first_wow?: Record<string, unknown> }

/** Every attempt in directory order, each tagged with its directory. A missing directory or a second run id is an error. */
export function readAttempts(dirs: readonly string[]): Rec[] {
  const all: Rec[] = [];
  for (const d of dirs) {
    const f = join(d, 'trials.jsonl');
    if (!existsSync(f)) throw new Error(`no trials.jsonl in ${d}`);
    for (const l of readFileSync(f, 'utf8').split('\n')) if (l.trim()) all.push({ ...(JSON.parse(l) as Rec), dir: d });
  }
  const runs = new Set(all.map((r) => r.trial_id.split('/')[0]));
  if (runs.size > 1) throw new Error(`results from more than one run: ${[...runs].join(', ')}`);
  return all;
}

export function readTrials(dirs: readonly string[]): Rec[] {
  const last = new Map<string, Rec>();
  for (const r of readAttempts(dirs)) last.set(r.trial_id, r);
  return [...last.values()];
}

export interface CorrectionRow { trial: string; cell: string; direction: string; kind: string | null; arm: 'rules' | 'remember' | 'floor'; item: number; applied: boolean | null; excluded?: string; score: C2Score | null; s1_files: number; usd: number; wall_ms: number }

export function correctionRows(recs: readonly Rec[], safety: ReadonlySet<string> = new Set()): CorrectionRow[] {
  return recs.filter((r) => r.first_wow && typeof r.first_wow.direction === 'string').map((r) => {
    const fw = r.first_wow as { direction: string; arm: string; item: number; score: C2Score | null; files_s1?: string[] };
    const score = fw.score ?? null;
    const excluded = safety.has(`${r.dir ?? ''}|${r.trial_id}`) ? 'safety_stop' : r.cap_stop ? 'cap_stop' : DROPPED.has(r.termination) ? r.termination : !score ? 'no_session_2' : undefined;
    return { trial: r.trial_id, cell: r.cell, direction: fw.direction, kind: score?.kind ?? null, arm: fw.arm.slice(3) as CorrectionRow['arm'], item: fw.item, applied: excluded ? null : score!.s2.applied,
      ...(excluded ? { excluded } : {}), score, s1_files: fw.files_s1?.length ?? 0, usd: r.usage?.usd ?? 0, wall_ms: r.wall_ms ?? 0 };
  });
}

function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

/** Newcombe's interval for a difference of paired proportions (1998, method 10, with its continuity-corrected phi), here p_b
 *  minus p_a. */
export function newcombePaired(pairs: ReadonlyArray<{ a: number; b: number }>): [number, number] | null {
  const n = pairs.length;
  if (!n) return null;
  const both = pairs.filter((p) => p.a && p.b).length, onlyA = pairs.filter((p) => p.a && !p.b).length, onlyB = pairs.filter((p) => !p.a && p.b).length;
  const none = n - both - onlyA - onlyB;
  const pa = (both + onlyA) / n, pb = (both + onlyB) / n;
  const [la, ua] = wilson(both + onlyA, n), [lb, ub] = wilson(both + onlyB, n);
  const den = Math.sqrt((both + onlyA) * (onlyB + none) * (both + onlyB) * (onlyA + none));
  const ad = both * none, bc = onlyA * onlyB;
  const phi = !den ? 0 : ad > bc ? Math.max(ad - bc - n / 2, 0) / den : (ad - bc) / den;
  const d = pb - pa;
  const lower = d - Math.sqrt(Math.max(0, (pb - lb) ** 2 - 2 * phi * (pb - lb) * (ua - pa) + (ua - pa) ** 2));
  const upper = d + Math.sqrt(Math.max(0, (ub - pb) ** 2 - 2 * phi * (ub - pb) * (pa - la) + (pa - la) ** 2));
  return [Math.max(-1, lower), Math.min(1, upper)];
}

export interface Contrast {
  label: string; test: string; base: string; n_pairs: number; dropped_pairs: number; rate_base: number; rate_test: number; delta: number;
  newcombe95: [number, number] | null; bootstrap95: [number, number] | null; mcnemar: { test_only: number; base_only: number; p_two_sided: number };
}

/** The test arm minus the base arm over the pairs (same item and direction) where both trials were scored; clusters are items. */
export function contrast(rows: readonly CorrectionRow[], label: string, directions: readonly string[], arms: { test: string; base: string }): Contrast | null {
  const key = (r: CorrectionRow) => `${r.direction}|${r.item}`;
  const sel = rows.filter((r) => directions.includes(r.direction));
  const base = new Map(sel.filter((r) => r.arm === arms.base).map((r) => [key(r), r]));
  const test = new Set(sel.filter((r) => r.arm === arms.test).map(key));
  const pairs: PairedItem[] = [];
  let dropped = [...base.keys()].filter((k) => !test.has(k)).length;
  for (const r of sel.filter((r) => r.arm === arms.test)) {
    const m = base.get(key(r));
    if (!m) { dropped++; continue; }
    if (r.applied === null || m.applied === null) { dropped++; continue; }
    pairs.push({ id: key(r), cluster: String(r.item), a: m.applied ? 1 : 0, b: r.applied ? 1 : 0 });
  }
  if (!pairs.length) return null;
  const boot = clusteredPairedDelta(pairs, BOOTSTRAP);
  const mc = exactMcNemar(pairs);
  return { label, test: arms.test, base: arms.base, n_pairs: pairs.length, dropped_pairs: dropped, rate_base: boot.mean_a, rate_test: boot.mean_b, delta: boot.delta,
    newcombe95: newcombePaired(pairs), bootstrap95: boot.ci95, mcnemar: { test_only: mc.wins, base_only: mc.losses, p_two_sided: mc.p_two_sided } };
}

export interface CodingResult { harness: string; n_pairs: number; dropped_pairs: number; solved_on: number; solved_off: number; on_only: number; off_only: number; fails: boolean; section_seen_on: number; section_seen_off: number; treatment_failed: number }

/** The coding check: the same harness and seed with rules.session_start on and off, dropping a pair with a dropped trial. A pair
 *  counts only when the section loaded with the switch on and not with it off; any other pair is a failed treatment check. */
export function codingResults(recs: readonly Rec[], safety: ReadonlySet<string> = new Set()): CodingResult[] {
  const rows = recs.filter((r) => (r.first_wow as { standing_rules?: unknown } | undefined)?.standing_rules || /-coding-rules-(on|off)$/.test(r.cell)).map((r) => {
    const fw = (r.first_wow ?? {}) as { seed?: number; standing_rules?: { state: 'on' | 'off'; section_seen: boolean }; coding?: { grade: { passed: boolean } | null } };
    const ok = !safety.has(`${r.dir ?? ''}|${r.trial_id}`) && !r.cap_stop && !DROPPED.has(r.termination) && !!fw.coding?.grade;
    const state = fw.standing_rules?.state ?? (r.cell.endsWith('-on') ? 'on' : 'off');
    return { harness: r.harness, seed: fw.seed ?? Number(/seed-0*(\d+)/.exec(r.trial_id)?.[1]), state, passed: ok ? fw.coding!.grade!.passed : null, seen: fw.standing_rules?.section_seen ?? false };
  });
  return [...new Set(rows.map((r) => r.harness))].sort().map((harness) => {
    const on = new Map(rows.filter((r) => r.harness === harness && r.state === 'on').map((r) => [r.seed, r]));
    const off = rows.filter((r) => r.harness === harness && r.state === 'off');
    let n = 0, dropped = 0, treatment = 0, solvedOn = 0, solvedOff = 0, onOnly = 0, offOnly = 0;
    for (const f of off) {
      const o = on.get(f.seed);
      if (!o) continue;
      if (o.passed === null || f.passed === null) { dropped++; continue; }
      if (!o.seen || f.seen) { treatment++; continue; }
      n++; solvedOn += +o.passed; solvedOff += +f.passed; onOnly += +(o.passed && !f.passed); offOnly += +(!o.passed && f.passed);
    }
    return { harness, n_pairs: n, dropped_pairs: dropped, solved_on: solvedOn, solved_off: solvedOff, on_only: onOnly, off_only: offOnly, fails: solvedOff - solvedOn >= CODING_FAIL_GAP,
      section_seen_on: rows.filter((r) => r.harness === harness && r.state === 'on' && r.seen).length, section_seen_off: rows.filter((r) => r.harness === harness && r.state === 'off' && r.seen).length, treatment_failed: treatment };
  });
}

export type Decision = 'rule-1-turn-on' | 'rule-2-smaller-gain' | 'rule-3-why-null' | 'rule-4-worse' | 'rule-5-coding-fails' | 'undecided-stays-off' | 'run-incomplete';

/** The plan's decision rules on the primary contrast, in its order of precedence: the coding check first (rule 5 holds whatever
 *  the corrections say). */
export function decide(pooled: Contrast | null, byDirection: ReadonlyArray<Contrast | null>, coding: readonly CodingResult[], planned?: number): { decision: Decision; why: string } {
  const accounted = (pooled?.n_pairs ?? 0) + (pooled?.dropped_pairs ?? 0);
  if (planned !== undefined && accounted < planned) return { decision: 'run-incomplete', why: `${accounted} of ${planned} planned pairs are scored or listed as dropped; reconcile the run before deciding` };
  if (coding.some((c) => c.fails)) return { decision: 'rule-5-coding-fails', why: `the section-on arm solved at least ${CODING_FAIL_GAP} fewer paired coding tasks in ${coding.filter((c) => c.fails).map((c) => c.harness).join(', ')}` };
  if (!pooled || !pooled.newcombe95) return { decision: 'undecided-stays-off', why: 'no scored pairs' };
  const [lo, hi] = pooled.newcombe95;
  const sig = pooled.mcnemar.p_two_sided <= ALPHA;
  const dirsPositive = byDirection.length === 2 && byDirection.every((d) => !!d && d.delta > 0);
  const codingOk = coding.length === 2 && coding.every((c) => !c.fails && c.n_pairs >= CODING_MIN_PAIRS);
  if (sig && pooled.delta >= STATED_DIFFERENCE && dirsPositive && codingOk) return { decision: 'rule-1-turn-on', why: 'pooled gain at least the stated difference, McNemar significant, both directions above 0, coding check passed in both harnesses' };
  if (hi < 0) return { decision: 'rule-4-worse', why: 'the pooled interval lies wholly below 0' };
  if (sig && pooled.delta > 0) return { decision: 'rule-2-smaller-gain', why: pooled.delta < STATED_DIFFERENCE ? 'significant but under the stated difference' : 'significant, but a direction at or below 0 or the coding check incomplete' };
  if (lo > -STATED_DIFFERENCE && hi < STATED_DIFFERENCE) return { decision: 'rule-3-why-null', why: `the pooled interval lies inside plus or minus ${STATED_DIFFERENCE * 100} points` };
  return { decision: 'undecided-stays-off', why: 'not significant, and the interval is too wide to rule out a difference of the stated size' };
}

const pct = (x: number) => (x * 100).toFixed(1);
const ci = (c: [number, number] | null) => (c ? `${pct(c[0])} to ${pct(c[1])}` : 'n/a');

export function analyze(dirs: readonly string[]) {
  const attempts = readAttempts(dirs);
  const recs = readTrials(dirs);
  const safety = new Set(dirs.flatMap((d) => [...safetyStops(d)].map((t) => `${d}|${t}`)));
  const rows = correctionRows(recs, safety);
  const directions = [...new Set(rows.map((r) => r.direction))].sort();
  const side = (arms: { test: string; base: string }) => ({ by_direction: directions.map((d) => contrast(rows, d, [d], arms)), pooled: contrast(rows, 'pooled', directions, arms) });
  const primary = side(PRIMARY), secondary = side(SECONDARY);
  const kinds = [...new Set(rows.map((r) => r.kind).filter((k): k is string => !!k))].sort();
  const byKind = kinds.map((k) => contrast(rows.filter((r) => r.kind === k), k, directions, PRIMARY));
  const coding = codingResults(recs, safety);
  const cells = [...new Set(rows.map((r) => r.cell))].sort().map((cell) => {
    const rs = rows.filter((r) => r.cell === cell), scored = rs.filter((r) => r.score && !r.excluded);
    const n = (f: (s: C2Score) => boolean) => scored.filter((r) => f(r.score!)).length;
    return { cell, n: rs.length, scored: rs.filter((r) => r.applied !== null).length, applied: rs.filter((r) => r.applied).length, excluded: rs.filter((r) => r.excluded).map((r) => `${r.trial}: ${r.excluded}`),
      s1_mistake: n((s) => s.s1_mistake === true), saved_correct: n((s) => ['correct', 'both'].includes(s.part.saved_with)), saved_remember: n((s) => ['remember', 'both'].includes(s.part.saved_with)),
      saved_none: n((s) => s.part.saved_with === 'none'), approved: n((s) => s.part.approved === true), section_seen: n((s) => s.part.section_seen), rules_path_ran: n((s) => s.part.rules_path_ran === true),
      s2_searched: n((s) => s.part.s2_reads > 0), s1_wrote_files: scored.filter((r) => r.s1_files > 0).length, out_missing: n((s) => !s.s2.answered), usd: Number(rs.reduce((a, r) => a + r.usd, 0).toFixed(4)) };
  });
  const tries = new Map<string, Rec[]>();
  for (const a of attempts) tries.set(a.trial_id, [...(tries.get(a.trial_id) ?? []), a]);
  const reruns = [...tries].filter(([, t]) => t.length > 1).map(([trial, t]) => ({ trial, attempts: t.length, cap_stops: t.filter((a) => a.cap_stop).length, terminations: t.map((a) => a.termination) }));
  return { trials: recs.length, attempts: attempts.length, safety_stops: [...safety].map((s) => s.split('|').slice(1).join('|')), cap_stops: attempts.filter((r) => r.cap_stop).map((r) => r.trial_id).sort(), reruns, cells, primary, secondary, primary_by_kind: byKind, coding, ...decide(primary.pooled, primary.by_direction, coding, PLANNED_PAIRS) };
}

export function markdown(r: ReturnType<typeof analyze>): string {
  const lines: string[] = [];
  for (const [name, s, arms] of [['Primary (decides)', r.primary, PRIMARY], ['Secondary (descriptive)', r.secondary, SECONDARY]] as const) {
    lines.push(`**${name}: ${arms.test} minus ${arms.base}**`, '', `| Contrast | Pairs | Dropped | ${arms.base} | ${arms.test} | ${arms.test} minus ${arms.base} | Newcombe 95% | Bootstrap 95% | ${arms.test} only / ${arms.base} only | McNemar p |`, '|---|---|---|---|---|---|---|---|---|---|');
    for (const c of [...s.by_direction, s.pooled]) if (c) lines.push(`| ${c.label} | ${c.n_pairs} | ${c.dropped_pairs} | ${pct(c.rate_base)}% | ${pct(c.rate_test)}% | ${pct(c.delta)} | ${ci(c.newcombe95)} | ${ci(c.bootstrap95)} | ${c.mcnemar.test_only} / ${c.mcnemar.base_only} | ${c.mcnemar.p_two_sided.toFixed(4)} |`);
    lines.push('');
  }
  lines.push('**Primary contrast by item type (descriptive, decides nothing)**', '', '| Item type | Pairs | Dropped | control | rules | rules minus control | Newcombe 95% |', '|---|---|---|---|---|---|---|');
  for (const c of r.primary_by_kind) if (c) lines.push(`| ${c.label} | ${c.n_pairs} | ${c.dropped_pairs} | ${pct(c.rate_base)}% | ${pct(c.rate_test)}% | ${pct(c.delta)} | ${ci(c.newcombe95)} |`);
  lines.push('');
  lines.push('| Cell | Trials | Scored | Applied | Session 1 used the wrong value (roles and values) | Called correct | Called remember | Called neither | Approved | Section in session 2 | Rules path ran | Session 2 searched | Session 1 wrote a file | out.md missing | Paid $ |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of r.cells) lines.push(`| ${c.cell} | ${c.n} | ${c.scored} | ${c.applied} | ${c.s1_mistake} | ${c.saved_correct} | ${c.saved_remember} | ${c.saved_none} | ${c.approved} | ${c.section_seen} | ${c.rules_path_ran} | ${c.s2_searched} | ${c.s1_wrote_files} | ${c.out_missing} | ${c.usd.toFixed(2)} |`);
  lines.push('', '| Coding check | Pairs | Dropped | Solved, section on | Solved, section off | On only | Off only | Section seen (on / off) | Section check failed | Fails rule 5 |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const c of r.coding) lines.push(`| ${c.harness} | ${c.n_pairs} | ${c.dropped_pairs} | ${c.solved_on} | ${c.solved_off} | ${c.on_only} | ${c.off_only} | ${c.section_seen_on} / ${c.section_seen_off} | ${c.treatment_failed} | ${c.fails ? 'yes' : 'no'} |`);
  lines.push('', `Cap stops (runner events, rerun under a fresh lease): ${r.cap_stops.length ? r.cap_stops.join(', ') : 'none'}.`);
  lines.push('', `**Decision (provisional until the 40-output scorer check passes, at least 36 of 40; below that the verdict is FIX-METHOD):** ${r.decision} (${r.why}).`);
  return lines.join('\n') + '\n';
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dirs = args.filter((a, i) => !a.startsWith('--') && !['--json', '--md'].includes(args[i - 1] ?? ''));
  const r = analyze(dirs);
  if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(r, null, 1) + '\n');
  const md = markdown(r);
  if (opt('--md')) writeFileSync(opt('--md')!, md); else process.stdout.write(md);
}
