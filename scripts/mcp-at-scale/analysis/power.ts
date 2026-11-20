#!/usr/bin/env bun
// Smallest detectable differences for the MCP-at-scale eval (internal-task plan, "Sample size and the smallest detectable
// difference", R78): 2.80 x sqrt(d x deff / n) for every comparison the plan lists, at design effect 1.5 and 2.5, where d is
// the discordant share of the pairs (assumed 20%) and 2.80 is z(0.975) + z(0.80), two-sided 5% at 80% power. The same
// number is the non-inferiority margin at 80% power at zero true difference with a one-sided 2.5% test, which decision 1
// uses for gbrain's surfaces.
//
//   bun scripts/mcp-at-scale/analysis/power.ts [--json]
//   bun scripts/mcp-at-scale/analysis/power.ts --pilot <pilot trials.jsonl> --sets <set.jsonl>... [--json]
//
// Pilot mode re-estimates d and the design effect per comparison family from the pilot's own pairs (right tool 30 against
// 300 per setup, set T 30 against 300, send-everything against search, verbs against full), using the cluster-robust
// variance from runner/stats/paired.ts, and recomputes each figure with them. A family the pilot cannot estimate (no pairs,
// or no discordant pair) keeps the assumption and says so.
import { normalQuantile } from '../../../runner/stats/paired.ts';
import { RUNGS, loadTrials, normalCdf, paired, readJsonl, requestIndex, setup, setupItemRep, taskSuccess, VALUES, type Trial } from './stats.ts';
import type { Item, TItem } from '../requests/sets.ts';

// Copied from internal-task's scripts/skills-at-scale/power.ts at commit 2127286e19 (branch skills-at-scale-analysis), unchanged:
// the standard error of a paired 0/1 difference with discordant share d over n pairs at design effect deff.
export const se = (share: number, n: number, deff: number) => Math.sqrt((share * deff) / n);

export const Z = 2.8;
export const ASSUMED = { d: 0.2, deffs: [1.5, 2.5] as const, power: 0.8, alpha: 0.05 };
export const sdd = (d: number, deff: number, n: number) => Z * se(d, n, deff);

/** Every comparison the plan sizes, with its pairs and the figure the plan states (points at deff 1.5 and 2.5). */
export const COMPARISONS = [
  { id: 'right_tool_per_setup_rung', family: 'right_tool', what: 'Right tool, one setup at one rung against its 30 rung', n: 240, plan: [10, 13] },
  { id: 'right_tool_per_two_model_harness', family: 'right_tool', what: 'Right tool, a two-model harness at one rung (both models pooled)', n: 480, plan: [7, 9] },
  { id: 'right_tool_pooled_10_setups', family: 'right_tool', what: 'Right tool, all 10 setups pooled at one rung', n: 2400, plan: [3, 4] },
  { id: 'tool_when_none_per_setup_rung', family: 'tool_when_none', what: 'Tool when none needed, one setup at one rung', n: 80, plan: [8, null] },
  { id: 'tool_when_none_pooled', family: 'tool_when_none', what: 'Tool when none needed, 10 setups pooled at one rung', n: 800, plan: [3, null] },
  { id: 'set_t_pooled', family: 'set_t', what: 'Set T success, 10 setups pooled, 300 against 30', n: 400, plan: [7, null] },
  { id: 'mechanism_per_arm_rung', family: 'mechanism', what: 'Mechanism arm against its harness\'s search, one rung', n: 240, plan: [10, 13] },
  { id: 'gbrain_surface_half_pooled', family: 'gbrain', what: 'gbrain surface against full, one half, 5 setups x 60 items x 2 reps (decision 1 margin)', n: 600, plan: [7, 9] },
  { id: 'gbrain_surface_both_halves_pooled', family: 'gbrain', what: 'gbrain surface against full, both halves, 5 setups x 120 items x 2 reps', n: 1200, plan: [6, null] },
  { id: 'gbrain_surface_half_per_harness', family: 'gbrain', what: 'gbrain surface against full, one half, one harness x 60 items x 2 reps (descriptive)', n: 120, plan: [18, null] },
  { id: 'gbrain_cost_to_core_pooled', family: 'gbrain', what: 'gbrain surface against no gbrain on 160 core requests, 5 setups pooled (one rep)', n: 800, plan: [null, null] },
] as const;
export type ComparisonId = (typeof COMPARISONS)[number]['id'];

export function table(params: Partial<Record<string, { d: number; deff: number; source: string }>> = {}) {
  return COMPARISONS.map((c) => {
    const est = params[c.family];
    const at = (deff: number) => Number((100 * sdd(est?.d ?? ASSUMED.d, deff, c.n)).toFixed(1));
    const row = { id: c.id, what: c.what, pairs: c.n, d: est?.d ?? ASSUMED.d, sdd_points_deff_1_5: at(1.5), sdd_points_deff_2_5: at(2.5), plan_points: c.plan,
      ...(est ? { pilot: { d: Number(est.d.toFixed(4)), deff: Number(est.deff.toFixed(3)), sdd_points: at(est.deff), source: est.source } } : {}) };
    const off = c.plan[0] !== null && Math.abs(row.sdd_points_deff_1_5 - c.plan[0]) > 1;
    return { ...row, plan_matches: c.plan[0] === null ? null : !off };
  });
}

const gbrainHalfPairs = COMPARISONS.find((c) => c.id === 'gbrain_surface_half_pooled')!.n;
/** The margin needed for 80% power at zero true difference and one-sided 2.5% alpha, not the preregistered margin. */
export const gbrainMargin = (d = ASSUMED.d, deff: number = ASSUMED.deffs[0]) => sdd(d, deff, gbrainHalfPairs);
export const GBRAIN_NI_MARGIN = 0.10;
export function gbrainNiPower(d: number) {
  return [1, 1.5].map((deff) => ({
    deff,
    margin_for_80_power: gbrainMargin(d, deff),
    power_at_10_points: normalCdf(GBRAIN_NI_MARGIN / se(d, gbrainHalfPairs, deff) - normalQuantile(0.975)),
  }));
}

/** Discordant share and design effect per family, from pilot pairs. */
export function pilotEstimates(trials: Trial[], items: Item[]) {
  const req = requestIndex(items);
  const cl = (t: Trial) => req.cluster(t.request);
  const out: Record<string, { d: number; deff: number; source: string } | { note: string }> = {};
  const fam = (name: string, cs: ReturnType<typeof paired>[]) => {
    const n = cs.reduce((s, c) => s + c.n_pairs, 0), disc = cs.reduce((s, c) => s + (c.discordant ?? 0), 0);
    const deffs = cs.filter((c) => c.design_effect !== null && c.n_pairs > 0);
    if (!n || !disc || !deffs.length) { out[name] = { note: 'not estimable from the pilot (' + n + ' pairs, ' + disc + ' discordant); the assumption stands' }; return; }
    const deff = deffs.reduce((s, c) => s + c.design_effect! * c.n_pairs, 0) / deffs.reduce((s, c) => s + c.n_pairs, 0);
    out[name] = { d: disc / n, deff: Math.max(1, deff), source: n + ' pilot pairs over ' + cs.length + ' contrast(s)' };
  };
  const native = trials.filter((t) => t.arm === 'native');
  const setups = [...new Set(native.map(setup))];
  const at = (rows: Trial[], r: number) => rows.filter((t) => t.rung === r);
  fam('right_tool', setups.map((s) => { const rows = native.filter((t) => setup(t) === s && t.set === 'R'); return paired(at(rows, 30), at(rows, 300), VALUES.right_tool, (t) => t.request, cl); }));
  fam('tool_when_none', setups.map((s) => { const rows = native.filter((t) => setup(t) === s && t.set === 'R'); return paired(at(rows, 30), at(rows, 300), VALUES.tool_when_none, (t) => t.request, cl); }));
  const tItems = new Map(items.filter((i) => i.set === 'T').map((i) => [i.id, i as TItem]));
  const ts = native.filter((t) => t.set === 'T');
  fam('set_t', [paired(at(ts, 30), at(ts, 300), (t) => taskSuccess(t, tItems.get(t.request)), (t) => setup(t) + '|' + t.request, cl)]);
  const mech: Array<[string, string, string]> = [['claude-code', 'native', 'tool-search-off'], ['pi', 'native', 'pi-direct'], ['pi', 'pi-deferred', 'pi-direct']];
  fam('mechanism', mech.flatMap(([h, a, b]) => RUNGS.map((r) => paired(trials.filter((t) => t.harness === h && t.arm === a && t.rung === r && t.set === 'R'), trials.filter((t) => t.harness === h && t.arm === b && t.rung === r && t.set === 'R'), VALUES.right_tool, (t) => t.model + '|' + t.request, cl))));
  const g = (s: string) => trials.filter((t) => t.arm === 'gbrain-' + s && t.set === 'G');
  fam('gbrain', [paired(g('full'), g('verbs'), VALUES.right_tool, setupItemRep, cl)]);
  return out;
}

const fmt = (rows: ReturnType<typeof table>) => ['| comparison | pairs | d | deff 1.5 | deff 2.5 | plan says | pilot (d, deff, points) |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => '| ' + [r.what, r.pairs, r.d, r.sdd_points_deff_1_5, r.sdd_points_deff_2_5, r.plan_points.map((x) => (x === null ? '-' : x)).join(' / ') + (r.plan_matches === false ? ' (differs)' : ''),
    'pilot' in r && r.pilot ? r.pilot.d + ', ' + r.pilot.deff + ', ' + r.pilot.sdd_points : '-'].join(' | ') + ' |')].join('\n');

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const after = argv.includes('--sets') ? argv.slice(argv.indexOf('--sets') + 1) : [];
  const end = after.findIndex((x) => x.startsWith('--'));
  const sets = end < 0 ? after : after.slice(0, end);
  const pilot = flag('--pilot');
  const est = pilot ? pilotEstimates(loadTrials(pilot), sets.flatMap((f) => readJsonl<Item>(f))) : {};
  const usable = Object.fromEntries(Object.entries(est).filter(([, v]) => 'd' in v)) as Record<string, { d: number; deff: number; source: string }>;
  const rows = table(usable);
  const z = normalQuantile(0.975) + normalQuantile(0.8);
  const d = usable.gbrain?.d ?? ASSUMED.d;
  const ni = gbrainNiPower(d);
  if (argv.includes('--json')) console.log(JSON.stringify({ z_plan: Z, z_exact: Number(z.toFixed(4)), assumed: ASSUMED, gbrain_margin: GBRAIN_NI_MARGIN, gbrain_ni: { pairs_per_half: gbrainHalfPairs, discordant_share: d, fixed_look: ni }, pilot: est, rows }, null, 1));
  else {
    console.log('Smallest detectable difference, 2.80 x sqrt(d x deff / n), in points (exact z sum ' + z.toFixed(3) + ').' + (pilot ? ' Pilot estimates: ' + JSON.stringify(est) : ' Assumed d = 0.2.'));
    console.log(fmt(rows));
    console.log('gbrain NI (fixed look, one-sided alpha 0.025, zero true difference; ' + gbrainHalfPairs + ' pairs per half, d=' + d.toFixed(4) + '): ' + ni.map((x) => 'deff ' + x.deff + ': 80% margin ' + (x.margin_for_80_power * 100).toFixed(2) + ' points, power at 10 points ' + (x.power_at_10_points * 100).toFixed(1) + '%').join('; '));
  }
}
