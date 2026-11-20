#!/usr/bin/env bun
// Power for the skills-at-scale eval (internal-task): from discordant shares (a pilot's, or the stand-ins in power-design.json),
// cluster sizes and a design effect, the smallest detectable difference per bar and the non-inferiority margin that gives
// 80% power at zero true harm, per harness. Keyless; tests/skills-at-scale-power.test.ts checks it against the plan's
// figures.
//
//   bun scripts/skills-at-scale/power.ts [--design scripts/skills-at-scale/power-design.json] [--from-analysis <analysis.json>]
//       [--deff 1.2] [--icc <x>] [--json]
//
// A paired 0/1 difference with discordant share d has variance d at zero mean, so its standard error over n pairs is
// sqrt(d * deff / n). The smallest detectable difference is (z(1 - alpha/2) + z(power)) times that; the non-inferiority
// margin at zero true harm is (z(1 - ni_alpha) + z(power)) times it. The design effect is the design file's (or --deff)
// for any cluster of two or more pairs and 1 for single-pair clusters; with --icc it is 1 + (m - 1) icc for clusters of m
// pairs. A harm margin is never shown below the exact bound analyze.ts uses when no pair is discordant (Clopper-Pearson,
// zero events over the pairs), since a margin at or below it can never pass, and a share whose expected discordant count is under 10 is flagged as a weak normal
// approximation. Margins are sized for S = 1,500, the hardest case, since they are fixed before S is known.
// "Per model" is the rule the plan's F7 applies on two-model harnesses: each model's test must pass on its own pairs;
// "both models, joint 80%" sizes each so the two pass together with 80% power. --from-analysis takes the shares from an
// analyze.ts output (each model's discordance pooled over its rungs) and keeps the design's sizes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clopperPearson } from '../../runner/stats/exact.ts';
import { normalQuantile } from '../../runner/stats/paired.ts';
import { LOOKS, designPower, driftFor, normalCdf, type Bounds } from './sequential.ts';

/** Two-look O'Brien-Fleming bounds at a test's own alpha (R113, internal-task's reading): the interim bound is c / sqrt(t) and the
 *  final c, with c chosen so the chance of crossing either under no effect is alpha (one tail; a two-sided alpha is split
 *  evenly over the two tails). A two-sided 0.05 test gives 2.80 and 1.98; a one-sided 0.025 non-inferiority bar gives the
 *  same; an alpha that Holm splits gets wider bounds. nominal_* is the one-sided p each bound corresponds to. */
export function obfBounds(alpha: number, sides: 1 | 2, t: number = LOOKS.fraction): Bounds & { alpha: number; sides: 1 | 2; nominal_interim: number; nominal_final: number } {
  const tail = sides === 2 ? alpha / 2 : alpha;
  const cross = (c: number) => {
    const c1 = c / Math.sqrt(t), step = 0.001;
    let p = 1 - normalCdf(c1);
    for (let z = -9; z < c1; z += step) p += Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * step * (1 - normalCdf((c - Math.sqrt(t) * z) / Math.sqrt(1 - t)));
    return p;
  };
  let lo = 0.5, hi = 6;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cross(mid) > tail) lo = mid; else hi = mid; }
  const c = (lo + hi) / 2;
  return { alpha, sides, interim: c / Math.sqrt(t), final: c, nominal_interim: 1 - normalCdf(c / Math.sqrt(t)), nominal_final: 1 - normalCdf(c) };
}

export type Shares = { opened_right: number; wrong_skill: number; no_skill_open: number };
export type Design = { alpha: number; power: number; ni_alpha: number; design_effect: number; targets: number; requests_per_target: number; no_skill_requests: number;
  set_t: { pairs_per_rung: number; clusters: number; discordant: number }; harnesses: Record<string, Record<string, Shares>> };
export const DESIGN_FILE = join(import.meta.dir, 'power-design.json');

export const se = (share: number, n: number, deff: number) => Math.sqrt((share * deff) / n);
export const zSum = (oneSidedAlpha: number, power: number) => normalQuantile(1 - oneSidedAlpha) + normalQuantile(power);
/** The exact upper bound analyze.ts uses for a harm bar with no discordant pair. */
export const zeroEventBound = (pairs: number) => clopperPearson(0, pairs).upper;

export function power(d: Design, o: { icc?: number } = {}) {
  const deff = (m: number) => (m < 2 ? 1 : o.icc === undefined ? d.design_effect : 1 + (m - 1) * o.icc);
  const two = zSum(d.alpha / 2, d.power);
  const ni = (p: number) => zSum(d.ni_alpha, p);
  const skillPairs = d.targets * d.requests_per_target;
  const sizes = { opened_right: { pairs: skillPairs, m: d.requests_per_target }, wrong_skill: { pairs: skillPairs, m: d.requests_per_target }, no_skill_open: { pairs: d.no_skill_requests, m: 1 } };
  const r4 = (x: number) => Number(x.toFixed(4));
  const rows = Object.entries(d.harnesses).flatMap(([harness, models]) => {
    const names = Object.keys(models).sort();
    const k = names.length;
    const mean = (bar: keyof Shares) => names.reduce((s, m) => s + models[m]![bar], 0) / k;
    return (['opened_right', 'wrong_skill', 'no_skill_open'] as const).map((bar) => {
      const z = sizes[bar];
      const pooledSe = se(mean(bar), z.pairs * k, deff(z.m * k));
      if (bar === 'opened_right') return { harness, bar, models: names, shares: names.map((m) => models[m]![bar]), pairs_per_model: z.pairs, smallest_detectable: r4(two * pooledSe) };
      const margin = (share: number, p: number) => {
        const normal = ni(p) * se(share, z.pairs, deff(z.m));
        return { margin: r4(Math.max(normal, zeroEventBound(z.pairs))), normal: r4(normal), weak: (share * z.pairs) / deff(z.m) < 10 };
      };
      const each = names.map((m) => ({ model: m, ...margin(models[m]![bar], d.power) }));
      const joint = names.map((m) => ({ model: m, ...margin(models[m]![bar], Math.sqrt(d.power)) }));
      return { harness, bar, models: names, shares: names.map((m) => models[m]![bar]), pairs_per_model: z.pairs,
        margin_per_model: each, margin_joint: k > 1 ? joint : null,
        margin_both_models_pooled: k > 1 ? r4(Math.max(ni(d.power) * pooledSe, zeroEventBound(z.pairs * k))) : null,
        zero_event_floor: r4(zeroEventBound(z.pairs)) };
    });
  });
  const allSetups = Object.values(d.harnesses).reduce((s, m) => s + Object.keys(m).length, 0);
  const withoutOpenclaw = allSetups - Object.keys(d.harnesses.openclaw ?? {}).length;
  const pooledRight = (setups: number) => r4(two * se(0.25, skillPairs * setups, deff(d.requests_per_target * setups)));
  const blockHalf = (n: number) => r4(normalQuantile(1 - d.alpha / 2) * Math.sqrt(0.25 / n));
  return {
    rows,
    pooled: {
      opened_right_per_rung_all_setups: { setups: allSetups, pairs: skillPairs * allSetups, smallest_detectable: pooledRight(allSetups) },
      opened_right_per_rung_without_openclaw: { setups: withoutOpenclaw, pairs: skillPairs * withoutOpenclaw, smallest_detectable: pooledRight(withoutOpenclaw) },
      set_t_success_per_rung: { pairs: d.set_t.pairs_per_rung, discordant: d.set_t.discordant, smallest_detectable: r4(two * se(d.set_t.discordant, d.set_t.pairs_per_rung, deff(d.set_t.pairs_per_rung / d.set_t.clusters))) },
      no_skill_block_rate_half_width: { per_setup: blockHalf(d.no_skill_requests), pooled_all_setups: blockHalf(d.no_skill_requests * allSetups), note: 'worst case, a true rate of 50%' },
    },
  };
}

/** What the two looks of R113 cost the primary, at the plan's alpha and power: the bounds, the power the fixed-design
 *  smallest detectable difference keeps with both looks, the chance of each stop and the expected share of the 1,500-rung
 *  units used, under the planned effect and under no effect, and the factor that widens the smallest detectable difference
 *  to win back 80%. The harm bars face a look only when the primary stops early, and carry no futility stop. */
export function looks(d: Design) {
  const r4 = (x: number) => Number(x.toFixed(4));
  const primary = obfBounds(d.alpha, 2);
  const harm = obfBounds(d.ni_alpha, 1);
  const fixed = zSum(d.alpha / 2, d.power);
  const op = (eta: number, futility: boolean) => { const x = designPower(eta, fixed, primary, { futility }); return { power: r4(x.power), stop_efficacy: r4(x.stop_efficacy), stop_loss: r4(x.stop_loss), stop_futility: r4(x.stop_futility), expected_fraction: r4(x.expected_fraction) }; };
  const withFutility = driftFor(d.power, primary);
  const noFutility = driftFor(d.power, primary, { futility: false });
  const harmFixed = zSum(d.ni_alpha, d.power);
  const interimFloor = (pairs: number) => r4(clopperPearson(0, Math.floor(pairs * LOOKS.fraction), 2 * harm.nominal_interim).upper);
  const held = (eta: number) => { const x = designPower(eta, fixed, primary, { efficacy: false }); return { power: r4(x.power), stop_efficacy: 0, stop_loss: r4(x.stop_loss), stop_futility: r4(x.stop_futility), expected_fraction: r4(x.expected_fraction) }; };
  return {
    bounds: { primary, harm, holm_split_primary: obfBounds(d.alpha / 2, 2) },
    fixed_drift: r4(fixed),
    at_planned_effect: { with_futility: op(fixed, true), without_futility: op(fixed, false) },
    at_no_effect: { with_futility: op(0, true), without_futility: op(0, false) },
    harm_floor_at_interim: { wrong_skill: interimFloor(d.targets * d.requests_per_target), no_skill_open: interimFloor(d.no_skill_requests) },
    efficacy_held: { at_planned_effect: held(fixed), at_no_effect: held(0) },
    mdd_inflation: { with_futility: r4(withFutility / fixed), without_futility: r4(noFutility / fixed), harm_margin: r4(driftFor(d.power, harm, { futility: false }) / harmFixed) },
  };
}

/** Each model's discordant share per bar from an analyze.ts output, pooled over the rungs it ran. */
export function sharesFromAnalysis(a: { per_rung: Array<{ harness: string; discordance: Record<string, Record<string, { discordant: number; n_pairs: number }>> }> }): Record<string, Record<string, Shares>> {
  const acc: Record<string, Record<string, Record<string, [number, number]>>> = {};
  const key: Record<string, keyof Shares> = { opened_right_skill: 'opened_right', opened_wrong_skill: 'wrong_skill', no_skill_opened_any: 'no_skill_open' };
  for (const r of a.per_rung) for (const [model, bars] of Object.entries(r.discordance)) for (const [bar, x] of Object.entries(bars)) {
    const k = key[bar];
    if (!k) continue;
    const e = (((acc[r.harness] ??= {})[model] ??= {})[k] ??= [0, 0]);
    e[0] += x.discordant; e[1] += x.n_pairs;
  }
  return Object.fromEntries(Object.entries(acc).map(([h, ms]) => [h, Object.fromEntries(Object.entries(ms).map(([m, bars]) => [m, Object.fromEntries(Object.entries(bars).map(([b, [x, n]]) => [b, n ? x / n : 0])) as Shares]))]));
}

const pts = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (100 * v).toFixed(1));
export function render(p: ReturnType<typeof power>, d: Design, l: ReturnType<typeof looks> = looks(d)): string {
  const out = ['Power at 80%, design effect ' + d.design_effect + ', ' + d.targets + ' targets x ' + d.requests_per_target + ' requests and ' + d.no_skill_requests + ' no-skill requests per setup and rung. Points.', '',
    '| harness | bar | models | discordant share | pairs per model | smallest detectable difference (models pooled) | margin per model (80% each) | margin per model (80% joint) | margin, both models pooled |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of p.rows) {
    const short = r.models.map((m) => m.split(':')[1]).join(', ');
    const shares = r.shares.map((s) => pts(s) + '%').join(', ');
    if (!('margin_per_model' in r)) { out.push('| ' + [r.harness, 'opened right skill', short, shares, r.pairs_per_model, pts(r.smallest_detectable), '-', '-', '-'].join(' | ') + ' |'); continue; }
    const fmt = (xs: Array<{ margin: number; weak: boolean }> | null | undefined) => (xs ? xs.map((x) => pts(x.margin) + (x.weak ? '*' : '')).join(', ') : '-');
    out.push('| ' + [r.harness, r.bar === 'wrong_skill' ? 'opened wrong skill' : 'no-skill open', short, shares, r.pairs_per_model, '-', fmt(r.margin_per_model), fmt(r.margin_joint), pts(r.margin_both_models_pooled)].join(' | ') + ' |');
  }
  const q = p.pooled;
  const floor = (bar: string) => pts((p.rows.find((r) => r.bar === bar) as { zero_event_floor?: number } | undefined)?.zero_event_floor);
  out.push('', '* fewer than 10 expected discordant pairs per model: the normal approximation is weak. A margin must sit above the exact bound a test with no discordant pair reaches, or it can never pass: ' + floor('wrong_skill') + ' over ' + d.targets * d.requests_per_target + ' skill-needing pairs, ' + floor('no_skill_open') + ' over ' + d.no_skill_requests + ' no-skill pairs, at one rung and one model.', '',
    'Opened the right skill, pooled per rung: ' + pts(q.opened_right_per_rung_all_setups.smallest_detectable) + ' points over ' + q.opened_right_per_rung_all_setups.setups + ' setups, ' + pts(q.opened_right_per_rung_without_openclaw.smallest_detectable) + ' without OpenClaw (' + q.opened_right_per_rung_without_openclaw.setups + ' setups).',
    'Set T success, pooled per rung: ' + pts(q.set_t_success_per_rung.smallest_detectable) + ' points on ' + q.set_t_success_per_rung.pairs + ' pairs at a discordant share of ' + pts(q.set_t_success_per_rung.discordant) + '%.',
    'No-skill block rate: about +/-' + pts(q.no_skill_block_rate_half_width.per_setup) + ' points per setup and +/-' + pts(q.no_skill_block_rate_half_width.pooled_all_setups) + ' pooled (' + q.no_skill_block_rate_half_width.note + ').');
  const b = (x: { alpha: number; sides: number; interim: number; final: number; nominal_interim: number; nominal_final: number }, name: string) => '| ' + [name, x.alpha + (x.sides === 2 ? ' two-sided' : ' one-sided'), x.interim.toFixed(2), x.final.toFixed(2), x.nominal_interim.toFixed(5), x.nominal_final.toFixed(4)].join(' | ') + ' |';
  const o = (x: ReturnType<typeof looks>['at_planned_effect']['with_futility']) => [pts(x.power), pts(x.stop_efficacy), pts(x.stop_futility), pts(x.stop_loss), pts(x.expected_fraction)].join(' | ');
  out.push('', 'The interim look (R113): one look at half the target skills on each harness\'s 1,500-rung primary, O\'Brien-Fleming bounds at each test\'s own alpha, a futility stop below ' + LOOKS.futility_cp * 100 + '% conditional power under the planned effect.', '',
    '| test | alpha | interim bound | final bound | interim nominal p | final nominal p |', '|---|---|---|---|---|---|',
    b(l.bounds.primary, 'primary, opened right skill'), b(l.bounds.harm, 'harm bars (non-inferiority)'), b(l.bounds.holm_split_primary, 'a primary split in two by Holm'), '',
    '| truth | futility stop | chance to pass | stop early, efficacy | stop, futility | stop, loss | expected share of 1,500 units |', '|---|---|---|---|---|---|---|',
    '| planned effect | yes | ' + o(l.at_planned_effect.with_futility) + ' |', '| planned effect | no | ' + o(l.at_planned_effect.without_futility) + ' |',
    '| no effect | yes | ' + o(l.at_no_effect.with_futility) + ' |', '| no effect | no | ' + o(l.at_no_effect.without_futility) + ' |',
    '| planned effect | yes, efficacy stop held | ' + o(l.efficacy_held.at_planned_effect) + ' |', '| no effect | yes, efficacy stop held | ' + o(l.efficacy_held.at_no_effect) + ' |', '',
    'An efficacy stop also needs the 1,500 step\'s harm bars to pass on the interim units at the interim nominal p. With no discordant pair at all, those bars reach ' + pts(l.harm_floor_at_interim.wrong_skill) + ' points (wrong skill, ' + Math.floor(d.targets * d.requests_per_target * LOOKS.fraction) + ' pairs) and ' + pts(l.harm_floor_at_interim.no_skill_open) + ' (no-skill open, ' + Math.floor(d.no_skill_requests * LOOKS.fraction) + ' pairs) per model, so any margin below that holds the stop and the look works as a futility look only (the rows marked held).', '',
    'Cost: at the fixed-design smallest detectable difference the chance to pass drops from ' + pts(d.power) + '% to ' + pts(l.at_planned_effect.with_futility.power) + '%. Winning back ' + pts(d.power) + '% widens the smallest detectable difference by ' + ((l.mdd_inflation.with_futility - 1) * 100).toFixed(1) + '% (' + ((l.mdd_inflation.without_futility - 1) * 100).toFixed(1) + '% without the futility stop; ' + ((l.mdd_inflation.harm_margin - 1) * 100).toFixed(1) + '% on a harm margin when the primary stops early). With no effect the futility stop saves ' + pts(1 - l.at_no_effect.with_futility.expected_fraction) + '% of the 1,500-rung units.');
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const d = JSON.parse(readFileSync(v('design') ?? DESIGN_FILE, 'utf8')) as Design;
  if (v('deff')) d.design_effect = Number(v('deff'));
  if (v('from-analysis')) d.harnesses = sharesFromAnalysis(JSON.parse(readFileSync(v('from-analysis')!, 'utf8')));
  const p = power(d, { icc: v('icc') === undefined ? undefined : Number(v('icc')) });
  console.log(a.includes('--json') ? JSON.stringify({ ...p, looks: looks(d) }, null, 1) : render(p, d));
}
