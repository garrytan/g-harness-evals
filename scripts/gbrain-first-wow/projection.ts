// Planning projection for the gbrain time-to-first-wow eval, before any pilot. Per-trial rates are read off the closest measured runs
// (named per rate below); the pilot replaces every rate with scripts/plan-cost.ts before the plan freezes. Nothing here is a
// pilot-priced number.
//
//   bun scripts/gbrain-first-wow/projection.ts [--json]
export interface Rate { usd: number; high: number; source: string }
export const RATES: Record<string, Rate> = {
  'claude-code/opus': { usd: 0.6, high: 1.2, source: 'shared-brain-access-2026-11 $0.23 a trial (one gbrain question session) and gbrain-install-2026-11 $0.61 (several sessions); history reads in the plain arm may cost more' },
  'codex/sol': { usd: 0.4, high: 0.8, source: 'shared-brain-access-2026-11 $0.11 and gbrain-install-2026-11 $0.71 on GPT-6.1/6.2 Sol' },
  'qm/opus': { usd: 0.4, high: 0.8, source: 'harness-zero-h2h and matrix-mu $0.13, always-on-week $1.14 on QM with Opus 5.5' },
  'qm/sol': { usd: 0.3, high: 0.6, source: 'no QM Sol 6.2 run yet; set below QM Opus by the Codex-to-Claude-Code ratio' },
  'qm/particle': { usd: 0.15, high: 0.3, source: 'particle-1 at $0.16 to $0.18 a trial in OpenClaw and Hermes (particle-swap-2026-11, gbrain-install-2026-11); no QM particle-1 run yet' },
  'coding/claude-code': { usd: 0.55, high: 1.1, source: 'fable-5-2-coding-2026-11 Opus 5.5 control $0.51 to $0.55' },
  'coding/codex': { usd: 0.35, high: 0.7, source: 'Codex Sol coding set at about two thirds of Claude Code' },
};

export interface Line { what: string; rate: string; trials: number }
const per = (arms: number, verdict: number, noHistory: number) => arms * (verdict + noHistory);
export const MAIN: Line[] = [
  { what: 'Claude Code, Opus 5.5: 4 arms x (30 + 10 no-history)', rate: 'claude-code/opus', trials: per(4, 30, 10) },
  { what: 'Codex, GPT-6.2 Sol: 4 arms x (30 + 10)', rate: 'codex/sol', trials: per(4, 30, 10) },
  { what: 'QM, Opus 5.5: QM with gbrain memory and plain x (30 + 10)', rate: 'qm/opus', trials: per(2, 30, 10) },
  { what: 'QM, GPT-6.2 Sol: same two arms x (30 + 10)', rate: 'qm/sol', trials: per(2, 30, 10) },
  { what: 'QM, particle-1: same two arms x (30 + 10)', rate: 'qm/particle', trials: per(2, 30, 10) },
  { what: 'Coding check, Claude Code: full and defaults x 15 pairs', rate: 'coding/claude-code', trials: 30 },
  { what: 'Coding check, Codex: full and defaults x 15 pairs', rate: 'coding/codex', trials: 30 },
];
export const PILOT: Line[] = [
  { what: 'Pilot 1 (PR 1 build): Claude Code, defaults, PR 1 and plain x (3 coding-heavy + 2 no-history)', rate: 'claude-code/opus', trials: 15 },
  { what: 'Pilot 1: Codex, same', rate: 'codex/sol', trials: 15 },
  { what: 'Pilot 1: QM Opus 5.5, both arms x 5', rate: 'qm/opus', trials: 10 },
  { what: 'Pilot 1: QM GPT-6.2 Sol, both arms x 5', rate: 'qm/sol', trials: 10 },
  { what: 'Pilot 1: QM particle-1, both arms x 5', rate: 'qm/particle', trials: 10 },
  { what: 'Pilot 2 (PR 2 build): full candidate, Claude Code x 5', rate: 'claude-code/opus', trials: 5 },
  { what: 'Pilot 2: full candidate, Codex x 5', rate: 'codex/sol', trials: 5 },
  { what: 'Pilot 2: coding check, 3 pairs per harness', rate: 'coding/claude-code', trials: 12 },
  { what: 'Smokes: one per cell shape', rate: 'claude-code/opus', trials: 14 },
];
/** VM: standard-16 list price, about 5 minutes of wall time per sequential trial (setup, import, one session, container churn). */
export const VM = { usd_per_hour: 0.5, minutes_per_trial: 5, high_factor: 2 };
/** This thread's own Capy model use, by phase, low and high (R71 all-in). Building the draft cost about $8; recent evals spent $157
 *  (owner-identity) to about $335 (skills-at-scale, two threads) of own model use in all. */
export const OWN: Array<{ phase: string; low: number; high: number }> = [
  { phase: 'Build this preregistration, its tests and the dry run', low: 10, high: 20 },
  { phase: 'Pilot 1 on PR 1, its dated change and the second-model read of the plan', low: 50, high: 120 },
  { phase: 'Pilot 2 on PR 2, the freeze and its /ship', low: 60, high: 140 },
  { phase: 'Supervising the counted run (shards, interim look)', low: 30, high: 80 },
  { phase: 'Results, report and their /ship', low: 100, high: 240 },
];

export function projection() {
  const price = (ls: Line[], k: 'usd' | 'high') => ls.reduce((s, l) => s + l.trials * RATES[l.rate]![k], 0);
  const trials = (ls: Line[]) => ls.reduce((s, l) => s + l.trials, 0);
  const allTrials = trials(MAIN) + trials(PILOT);
  const vm = allTrials * VM.minutes_per_trial / 60 * VM.usd_per_hour;
  const paid = { main: price(MAIN, 'usd'), main_high: price(MAIN, 'high'), pilot: price(PILOT, 'usd'), pilot_high: price(PILOT, 'high') };
  const own = { low: OWN.reduce((s, o) => s + o.low, 0), high: OWN.reduce((s, o) => s + o.high, 0) };
  const low = paid.main + paid.pilot + vm + own.low;
  const high = paid.main_high + paid.pilot_high + vm * VM.high_factor + own.high;
  return { trials: { main: trials(MAIN), pilot: trials(PILOT) }, paid, vm: { central: vm, high: vm * VM.high_factor, vm_hours: allTrials * VM.minutes_per_trial / 60 }, own, all_in: { low, high } };
}

if (import.meta.main) {
  const p = projection();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(p, null, 2)); process.exit(0); }
  const d = (x: number) => '$' + x.toFixed(0);
  console.log('PROJECTION (planning rates, not pilot-priced): main ' + p.trials.main + ' trials ' + d(p.paid.main) + ' to ' + d(p.paid.main_high) + '; pilot and smokes ' + p.trials.pilot + ' trials ' + d(p.paid.pilot) + ' to ' + d(p.paid.pilot_high) + '; VM ' + d(p.vm.central) + ' to ' + d(p.vm.high) + '; own ' + d(p.own.low) + ' to ' + d(p.own.high) + '; all-in ' + d(p.all_in.low) + ' to ' + d(p.all_in.high));
}
