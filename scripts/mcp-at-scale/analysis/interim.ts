#!/usr/bin/env bun
// The one interim look of the MCP-at-scale counted run (R113; internal-task plan, dated change 2026-11-19): one look at half
// the units, per primary comparison over the paired units, with two-look O'Brien-Fleming bounds computed at each
// comparison's own frozen alpha (one-sided where the plan is one-sided, per comparison after any Holm step), a futility
// stop when the conditional power under the planned effect is below 10%, and no second look.
//
//   bun scripts/mcp-at-scale/analysis/interim.ts bounds [--design <interim-design.json>]
//   bun scripts/mcp-at-scale/analysis/interim.ts look --trials <trials.jsonl> --sets <set.jsonl>... --state <state.json>
//       --out <dir> [--design <interim-design.json>] [--margins <margins.json>]
//
// Units are clusters (requests/seal.ts clusterOf: a target core tool, a no-tool request, a set T task, a target gbrain tool
// within its half): the first half of each group in sha256(seed, cluster) order, which the run follows. Only trials of
// those units are read. Bounds: with information fraction t = 0.5 and c chosen so that P(Z(t) >= c / sqrt(t) or Z(1) >= c)
// is the comparison's one-tail alpha (alpha / 2 when two-sided), the interim bound is c / sqrt(t) and the final c; for a
// two-sided 0.05 test that is 2.80 and 1.98. The statistic is z = oriented delta / cluster-robust SE (plus the margin for a
// non-inferiority test). Conditional power uses the B-value: B(t) = z sqrt(t) and the rest of the run adds N(eta (1 - t),
// 1 - t), eta = planned effect (plus margin) / final SE, the final SE being the interim SE times sqrt(t).
// Decisions: z at or past the interim bound stops (efficacy; for a two-sided test a crossing on the other side stops too)
// and the output says "stopped early, estimate possibly overstated"; else conditional power below 10% stops for futility;
// else the run continues to the final look at the final bound.
// The state file records the look before any trial is read; a second call that finds it exits 4 and reads nothing.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusterOf } from '../requests/seal.ts';
import type { Item } from '../requests/sets.ts';
import { context, mechanismContrast, rungContrast, STOPPED_NOTE } from './analyze.ts';
import { gbrainMargin } from './power.ts';
import { loadTrials, normalCdf, paired, readJsonl, setupItemRep, VALUES, type Contrast, type Trial } from './stats.ts';

export const DESIGN_FILE = join(import.meta.dir, 'interim-design.json');
export { STOPPED_NOTE };
export interface Comparison { id: string; kind: 'slip' | 'gbrain_ni' | 'mechanism'; harness?: string; rung?: number; surface?: string; half?: 'starter' | 'full_only'; search?: string; send_everything?: string;
  alpha: number; sides: 1 | 2; direction: 'higher' | 'lower'; planned_effect: number; margin?: number | null }
export interface Design { fraction: number; futility_conditional_power: number; seed: string; comparisons: Comparison[] }

const phi = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
/** P(Z(t) >= c / sqrt(t) or Z(1) >= c) under no effect, Z(t) and Z(1) correlated sqrt(t); Simpson's rule over Z(t). */
export function crossingProbability(c: number, t: number): number {
  const b1 = c / Math.sqrt(t), lo = -10, steps = 4000, h = (b1 - lo) / steps;
  const f = (z: number) => phi(z) * (1 - normalCdf((c - Math.sqrt(t) * z) / Math.sqrt(1 - t)));
  let s = f(lo) + f(b1);
  for (let i = 1; i < steps; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
  return 1 - normalCdf(b1) + (s * h) / 3;
}

/** Two-look O'Brien-Fleming bounds at a comparison's own alpha. */
export function obfBounds(alpha: number, sides: 1 | 2, t = 0.5) {
  const tail = sides === 2 ? alpha / 2 : alpha;
  let lo = 0.5, hi = 6;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (crossingProbability(mid, t) > tail) lo = mid; else hi = mid; }
  const c = (lo + hi) / 2;
  return { alpha, sides, fraction: t, interim: c / Math.sqrt(t), final: c, nominal_interim_p: 1 - normalCdf(c / Math.sqrt(t)), nominal_final_p: 1 - normalCdf(c) };
}

export function conditionalPower(z: number, eta: number, final: number, t = 0.5): number {
  return 1 - normalCdf((final - z * Math.sqrt(t) - eta * (1 - t)) / Math.sqrt(1 - t));
}

/** The units of the look: the first half of each group's clusters in sha256(seed, cluster) order. */
export function interimUnits(items: Item[], seed: string, fraction = 0.5): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const it of items) { const c = clusterOf(it); (groups.get(c.group) ?? groups.set(c.group, new Set()).get(c.group)!).add(c.cluster); }
  const key = (x: string) => createHash('sha256').update(seed + '\u0000' + x).digest('hex');
  return new Set([...groups.values()].flatMap((cs) => [...cs].sort((a, b) => key(a).localeCompare(key(b))).slice(0, Math.floor(cs.size * fraction))));
}

export function decide(x: Contrast, cmp: Comparison, margin: number, design: Design) {
  const b = obfBounds(cmp.alpha, cmp.sides, design.fraction);
  if (!x.n_pairs || x.delta === null) return { id: cmp.id, decision: 'no data at the look' as const, contrast: x, bounds: b, z: null, conditional_power: null, note: 'no pairs among the interim units' };
  if (!x.se_cluster) return { id: cmp.id, decision: 'continue' as const, contrast: x, bounds: b, z: null, conditional_power: null, note: 'no paired variation among the interim units, so no z; continues to the final look' };
  const sign = cmp.direction === 'higher' ? 1 : -1;
  const shift = cmp.kind === 'gbrain_ni' ? margin : 0;
  const z = (sign * x.delta + shift) / x.se_cluster;
  const eta = (cmp.planned_effect + shift) / (x.se_cluster * Math.sqrt(design.fraction));
  const cp = conditionalPower(z, eta, b.final, design.fraction);
  const decision = z >= b.interim ? 'stop_efficacy' as const : cmp.sides === 2 && z <= -b.interim ? 'stop_opposite' as const : cp < design.futility_conditional_power ? 'stop_futility' as const : 'continue' as const;
  const note = decision === 'stop_efficacy' || decision === 'stop_opposite' ? STOPPED_NOTE : decision === 'stop_futility' ? 'stopped early for futility: conditional power ' + cp.toFixed(3) + ' under the planned effect' : 'continues to the final look at |z| >= ' + b.final.toFixed(2);
  return { id: cmp.id, decision, contrast: x, bounds: b, z: Number(z.toFixed(4)), conditional_power: Number(cp.toFixed(4)), ...(shift ? { margin } : {}), note };
}

export function look(o: { trials: Trial[]; items: Item[]; design: Design; margin?: number | null }) {
  const units = interimUnits(o.items, o.design.seed, o.design.fraction);
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const kept = o.trials.filter((t) => { const it = byId.get(t.request); return !!it && units.has(clusterOf(it).cluster); });
  const c = context(kept, o.items);
  const margin = o.margin ?? gbrainMargin();
  const results = o.design.comparisons.map((cmp) => {
    let x: Contrast;
    if (cmp.kind === 'slip') x = rungContrast(c, cmp.harness!, cmp.rung!);
    else if (cmp.kind === 'mechanism') x = mechanismContrast(c, { harness: cmp.harness!, search: cmp.search!, send_everything: cmp.send_everything! }, cmp.rung!);
    else {
      const g = (s: string) => kept.filter((t) => t.arm === 'gbrain-' + s && t.set === 'G' && t.rung === 150 && (byId.get(t.request) as { half_kind?: string } | undefined)?.half_kind === cmp.half);
      x = paired(g('full'), g(cmp.surface!), VALUES.right_tool, setupItemRep, c.cl);
    }
    return decide(x, cmp, cmp.margin ?? margin, o.design);
  });
  return { units: units.size, trials_read: kept.length, trials_outside_units: o.trials.length - kept.length, gbrain_margin: margin, results };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const designPath = flag('--design') ?? DESIGN_FILE;
  const design = JSON.parse(readFileSync(designPath, 'utf8')) as Design;
  if (argv[0] === 'bounds') {
    console.log('| comparison | alpha | sides | interim bound | final bound | interim nominal p | final nominal p |\n|---|---|---|---|---|---|---|');
    for (const cmp of design.comparisons) { const b = obfBounds(cmp.alpha, cmp.sides, design.fraction); console.log('| ' + [cmp.id, cmp.alpha, cmp.sides, b.interim.toFixed(3), b.final.toFixed(3), b.nominal_interim_p.toFixed(5), b.nominal_final_p.toFixed(5)].join(' | ') + ' |'); }
    process.exit(0);
  }
  const after = argv.includes('--sets') ? argv.slice(argv.indexOf('--sets') + 1) : [];
  const end = after.findIndex((x) => x.startsWith('--'));
  const sets = end < 0 ? after : after.slice(0, end);
  const trials = flag('--trials'), state = flag('--state'), out = flag('--out');
  if (argv[0] !== 'look' || !trials || !state || !out || !sets.length) { console.error('usage: interim.ts bounds [--design f] | look --trials <f> --sets <f>... --state <state.json> --out <dir> [--design f] [--margins f]'); process.exit(2); }
  if (existsSync(state)) {
    const s = JSON.parse(readFileSync(state, 'utf8')) as { at?: string; status?: string };
    console.error('refused: the interim look was already taken (' + (s.status ?? 'recorded') + ' at ' + (s.at ?? 'unknown time') + ', state file ' + state + '); R113 allows one look and no other');
    process.exit(4);
  }
  const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const record: Record<string, unknown> = { schema: 'he-mcp-at-scale-interim-state/1', look: 'interim', status: 'started', at: new Date().toISOString(), design_sha256: sha(designPath), trials_sha256: sha(trials), sets_sha256: sets.map(sha) };
  writeFileSync(state, JSON.stringify(record, null, 1) + '\n', { flag: 'wx' });
  const margins = flag('--margins') ? JSON.parse(readFileSync(flag('--margins')!, 'utf8')) as { gbrain?: number } : null;
  const r = look({ trials: loadTrials(trials), items: sets.flatMap((f) => readJsonl<Item>(f)), design, margin: margins?.gbrain ?? null });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'interim.json'), JSON.stringify(r, null, 1) + '\n');
  writeFileSync(state, JSON.stringify({ ...record, status: 'complete', completed_at: new Date().toISOString(), gbrain_margin: r.gbrain_margin,
    decisions: Object.fromEntries(r.results.map((x) => [x.id, x.decision])) }, null, 1) + '\n');
  console.log('interim look: ' + r.units + ' units, ' + r.trials_read + ' trials read (' + r.trials_outside_units + ' outside the interim units left unread)');
  for (const x of r.results) console.log(x.id + ': ' + x.decision + (x.z !== null ? ' (z ' + x.z + ', interim bound ' + x.bounds.interim.toFixed(2) + ', conditional power ' + x.conditional_power + ')' : '') + ' - ' + x.note);
}
