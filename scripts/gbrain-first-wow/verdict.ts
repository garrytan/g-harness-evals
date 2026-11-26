// Per-harness verdict for the gbrain time-to-first-wow eval: paired contrasts with 95% intervals, the one interim look at half the
// units, and internal-task's five decision rules applied mechanically. Pairs are trials of the same harness and fixture seed in two arms.
// Only history-rich and messy trials enter a contrast; no-history trials are summarised on their own and never averaged in.
import { clusteredPairedDelta, exactMcNemar, normalQuantile, type PairedItem } from '../../runner/stats/paired.ts';
import type { Arm } from './score.ts';

export interface Row {
  harness: string;
  model: string;
  arm: Arm;
  seed: number;
  persona: 'history-rich' | 'messy' | 'no-history';
  /** The finish line under the plan's reference rule; null for an excluded trial. */
  finish: boolean | null;
  /** Question-session wall time; a timeout is counted at the cap. */
  time_ms: number | null;
  /** End to end: the scripted setup plus the question session (zero setup in the plain arm). */
  total_ms?: number | null;
  timed_out: boolean;
  commands: number;
  person_needed: number;
  /** model_error, infra_error or exam_fault: dropped from both sides of every pair it is in, and listed. */
  excluded?: string;
  /** No-history only. */
  correct_abstention?: boolean;
  fallback_shown?: boolean | null;
}

/** O'Brien-Fleming bounds for one look at half the information and a final test, two-sided alpha 0.05 (Lan-DeMets, rounded down). */
export const INTERIM_P = 0.003;
export const FINAL_P = 0.049;
export const POWER = 0.8;

/** Smallest detectable difference on a paired binary outcome (finish-line rate), from the share of discordant pairs. */
export function mddFromDiscordance(discordance: number, pairs: number, alpha = FINAL_P, power = POWER): number {
  return (normalQuantile(1 - alpha / 2) + normalQuantile(power)) * Math.sqrt(discordance / pairs);
}

export interface Contrast { harness: string; a: Arm; b: Arm; label: string }

/** The preregistered contrasts: b minus a, so a positive delta favours b. */
export function contrastsFor(harness: string, arms: readonly Arm[]): Contrast[] {
  const has = (x: Arm) => arms.includes(x);
  const out: Contrast[] = [];
  const add = (a: Arm, b: Arm, label: string) => { if (has(a) && has(b)) out.push({ harness, a, b, label }); };
  add('defaults', 'full', 'primary: full candidate vs today\'s defaults');
  add('defaults', 'pr1', 'history import alone vs today\'s defaults');
  add('pr1', 'full', 'first-session suggestion on top of the import');
  add('plain', 'full', 'full candidate vs plain agent');
  add('plain', 'pr1', 'history import vs plain agent');
  add('plain', 'qm-native', 'QM with gbrain as its memory vs plain QM');
  return out;
}

export interface ContrastResult extends Contrast {
  n_pairs: number;
  excluded_pairs: number;
  rate_a: number;
  rate_b: number;
  delta: number;
  ci95: [number, number] | null;
  mcnemar: { wins: number; losses: number; p_two_sided: number };
  time_delta_ms: number;
  time_ci95_ms: [number, number] | null;
  total_delta_ms: number;
  total_ci95_ms: [number, number] | null;
  commands_delta: number;
  commands_ci95: [number, number] | null;
  person_needed_delta: number;
  person_needed_ci95: [number, number] | null;
}

const DRAWS = 10000;

export function pairRows(rows: readonly Row[], c: Contrast, seeds?: ReadonlySet<number>) {
  const key = (r: Row) => r.seed;
  const verdictRows = rows.filter(r => r.harness === c.harness && r.persona !== 'no-history' && (!seeds || seeds.has(r.seed)));
  const as = new Map(verdictRows.filter(r => r.arm === c.a).map(r => [key(r), r]));
  const bs = new Map(verdictRows.filter(r => r.arm === c.b).map(r => [key(r), r]));
  const pairs: Array<[Row, Row]> = [];
  let excluded = 0;
  for (const [k, ra] of as) {
    const rb = bs.get(k);
    if (!rb) continue;
    if (ra.excluded || rb.excluded || ra.finish === null || rb.finish === null) { excluded++; continue; }
    pairs.push([ra, rb]);
  }
  return { pairs, excluded };
}

export function contrast(rows: readonly Row[], c: Contrast, seeds?: ReadonlySet<number>): ContrastResult | null {
  const { pairs, excluded } = pairRows(rows, c, seeds);
  if (!pairs.length) return null;
  const items: PairedItem[] = pairs.map(([a, b]) => ({ id: String(a.seed), cluster: String(a.seed), a: a.finish ? 1 : 0, b: b.finish ? 1 : 0 }));
  const d = clusteredPairedDelta(items, { seed: 2026_11_24, draws: DRAWS });
  const mc = exactMcNemar(items);
  const paired = (f: (r: Row) => number | null | undefined) => {
    const ok = pairs.filter(([a, b]) => typeof f(a) === 'number' && typeof f(b) === 'number');
    return ok.length ? clusteredPairedDelta(ok.map(([a, b]) => ({ id: String(a.seed), cluster: String(a.seed), a: f(a)!, b: f(b)! })), { seed: 2026_11_24, draws: DRAWS }) : null;
  };
  const t = paired((r) => r.time_ms), total = paired((r) => r.total_ms), cmd = paired((r) => r.commands), person = paired((r) => r.person_needed);
  return {
    ...c, n_pairs: pairs.length, excluded_pairs: excluded,
    rate_a: d.mean_a, rate_b: d.mean_b, delta: d.delta, ci95: d.ci95,
    mcnemar: { wins: mc.wins, losses: mc.losses, p_two_sided: mc.p_two_sided },
    time_delta_ms: t ? t.delta : NaN, time_ci95_ms: t ? t.ci95 : null,
    total_delta_ms: total ? total.delta : NaN, total_ci95_ms: total ? total.ci95 : null,
    commands_delta: cmd ? cmd.delta : NaN, commands_ci95: cmd ? cmd.ci95 : null,
    person_needed_delta: person ? person.delta : NaN, person_needed_ci95: person ? person.ci95 : null,
  };
}

export type InterimCall = 'stop-candidate-ahead' | 'stop-candidate-behind' | 'continue';

/** The one interim look, on the primary contrast of each harness at half its seeds: stop early only past the O'Brien-Fleming bound. */
export function interimCall(r: ContrastResult): InterimCall {
  if (r.mcnemar.p_two_sided > INTERIM_P) return 'continue';
  return r.delta > 0 ? 'stop-candidate-ahead' : 'stop-candidate-behind';
}

export type Decision = 'rule-1-defaults-on' | 'rule-2-why-null' | 'rule-3-keep-today' | 'rule-5-defaults-off-undecided';

/**
 * internal-task's rules 1, 2, 3 and 5 on a harness's primary contrast, with the plan's operational reading:
 * rule 1 when the point estimate is at least the stated difference and the exact McNemar test clears the final bound;
 * rule 3 when the interval lies wholly below zero; rule 5 for a gain that clears the final bound but is smaller than the stated difference
 * (rule 5 names that case, so it wins where rule 2 would also hold); rule 2 when the interval lies wholly inside plus or minus the stated
 * difference; rule 5 otherwise (the eval can't decide this harness). An interim stop decides by its own direction.
 */
export function decide(r: ContrastResult, mdd: number, interim: InterimCall = 'continue'): Decision {
  if (interim === 'stop-candidate-ahead') return 'rule-1-defaults-on';
  if (interim === 'stop-candidate-behind') return 'rule-3-keep-today';
  if (r.delta >= mdd && r.mcnemar.p_two_sided <= FINAL_P) return 'rule-1-defaults-on';
  if (r.ci95 && r.ci95[1] < 0) return 'rule-3-keep-today';
  if (r.delta > 0 && r.mcnemar.p_two_sided <= FINAL_P) return 'rule-5-defaults-off-undecided';
  if (r.ci95 && r.ci95[0] > -mdd && r.ci95[1] < mdd) return 'rule-2-why-null';
  return 'rule-5-defaults-off-undecided';
}

/** Rule 4: the plain agent matches gbrain when the full candidate's lead over it is below the stated difference and its interval holds zero. */
export function plainMatches(r: ContrastResult, mdd: number): boolean {
  return r.delta < mdd && !!r.ci95 && r.ci95[0] <= 0 && r.ci95[1] >= 0;
}

export interface NoHistorySummary { harness: string; arm: Arm; n: number; correct_abstention: number; fallback_shown: number | null }

export function noHistorySummary(rows: readonly Row[]): NoHistorySummary[] {
  const out = new Map<string, NoHistorySummary>();
  for (const r of rows) {
    if (r.persona !== 'no-history' || r.excluded) continue;
    const k = r.harness + '|' + r.arm;
    const s = out.get(k) ?? { harness: r.harness, arm: r.arm, n: 0, correct_abstention: 0, fallback_shown: r.fallback_shown === null ? null : 0 };
    s.n++;
    if (r.correct_abstention) s.correct_abstention++;
    if (s.fallback_shown !== null && r.fallback_shown) s.fallback_shown++;
    out.set(k, s);
  }
  return [...out.values()];
}

const pct = (x: number) => (x * 100).toFixed(1);
const ci = (c: [number, number] | null, f = pct) => c ? '[' + f(c[0]) + ', ' + f(c[1]) + ']' : 'n/a';

export function contrastMarkdown(results: readonly ContrastResult[]): string {
  const head = '| Harness | Contrast | Pairs | Rate a | Rate b | Delta (points) | 95% interval | Wins/losses | McNemar p | Time delta (s) |\n|---|---|---|---|---|---|---|---|---|---|';
  const lines = results.map(r => '| ' + [r.harness, r.label + ' (' + r.b + ' minus ' + r.a + ')', r.n_pairs, pct(r.rate_a), pct(r.rate_b), pct(r.delta), ci(r.ci95), r.mcnemar.wins + '/' + r.mcnemar.losses, r.mcnemar.p_two_sided.toFixed(3), Number.isFinite(r.time_delta_ms) ? (r.time_delta_ms / 1000).toFixed(1) + ' ' + ci(r.time_ci95_ms, x => (x / 1000).toFixed(1)) : 'n/a'].join(' | ') + ' |');
  return [head, ...lines].join('\n') + '\n';
}
