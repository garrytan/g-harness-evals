// Pilot-priced cost projection (docs/cost-projection.md). Pure: callers read files and pass records in.
//
// A plan's price comes from what each cell's pilot actually cost, never from the plan's guess:
//   $/unit       = every pilot dollar for the cell (usage.usd, which already holds usd_reserved, plus a Harbor record's
//                  frontier.first_run_usd and replaced_usd; infra and model-error records included, because a counted run
//                  pays for them too) / the pilot's scored units (records not ended by infra_error, model_error or exam_fault).
//   remaining    = the plan's counted units for the cell - scored counted records already in the results.
//   projected    = $/unit x remaining.
//   VM remaining = remaining x the pilot's median trial wall hours / the plan's concurrency x the standard-16 list price.
//   TOTAL        = settled ledger spend (pilot and counted) + VM spent + own model use (when given) + every priced cell's
//                  projected dollars + VM remaining.
// A cell with fewer than MIN_SCORED_UNITS scored pilot units is UNPRICED: it gets no number, and a total that leaves one out
// is a lower bound. The mean gates; a seeded bootstrap 95% upper bound is printed beside it.
import type { TrialRecord } from '../contracts.ts';

export const MIN_SCORED_UNITS = 5;
/** Ubicloud's standard-16 Germany list price ($0.00831 a minute) plus the public IPv4 ($3 a month), as docs/ubicloud.md prices a VM. */
export const VM_USD_PER_HOUR = 0.00831 * 60 + 3 / 720;
const UNSCORED = new Set(['infra_error', 'model_error', 'exam_fault']);
const BOOTSTRAP_RESAMPLES = 2000;

export interface PlanCell {
  id: string;
  model: string;
  /** provider:model ids the cell also calls (runner cells' utility_models). */
  also: string[];
  units: number;
  /** The cell's own cap: its manifest ceiling (runner plans) or its shard's lease when the shard holds this cell alone (Harbor plans). */
  lease_usd: number | null;
  shard: string | null;
}

export interface PlanUnits {
  run_id: string;
  format: 'runner' | 'frontier-harbor';
  concurrency: number;
  cells: PlanCell[];
  shards: Array<{ name: string; cells: string[]; lease_usd: number | null }>;
}

export interface CostRecord {
  cell: string;
  termination: string;
  usd: number;
  usd_reserved: number;
  wall_ms: number;
}

/** The cost fields of one trial record; a Harbor record's frontier block adds the first run a rerun replaced. */
export function costRecord(t: TrialRecord & { frontier?: { first_run_usd?: number; replaced_usd?: number } }): CostRecord {
  const f = t.frontier ?? {};
  return {
    cell: t.cell, termination: t.termination,
    usd: (t.usage?.usd ?? 0) + (f.first_run_usd ?? 0) + (f.replaced_usd ?? 0),
    usd_reserved: t.usage?.usd_reserved ?? 0,
    wall_ms: t.wall_ms ?? 0,
  };
}

export const isScored = (r: { termination: string }) => !UNSCORED.has(r.termination);

export interface CellProjection {
  id: string;
  model: string;
  shard: string | null;
  pilot_records: number;
  pilot_scored: number;
  pilot_usd: number;
  pilot_usd_reserved: number;
  /** Share of pilot records that were not scored (infra, model error, exam fault). */
  unscored_share: number;
  usd_per_unit: number | null;
  usd_per_unit_upper: number | null;
  units: number;
  done: number;
  remaining: number;
  projected_usd: number | null;
  projected_upper_usd: number | null;
  vm_remaining_usd: number | null;
  lease_usd: number | null;
  /** The cell's counted dollars so far plus its projection would pass its own lease or ceiling. */
  over_lease: boolean;
  priced: boolean;
}

export interface ProjectionInput {
  plan: PlanUnits;
  pilot: CostRecord[];
  results: CostRecord[];
  spent_usd: number;
  vm_spent_usd: number;
  own_usd: number | null;
  stop_usd: number;
  seed?: number;
}

export interface Projection {
  run_id: string;
  stop_usd: number;
  cells: CellProjection[];
  unpriced: string[];
  spent_usd: number;
  vm_spent_usd: number;
  own_usd: number | null;
  remaining_usd: number;
  remaining_upper_usd: number;
  vm_remaining_usd: number;
  total_usd: number;
  total_upper_usd: number;
  /** True when an unpriced cell with units left is left out, so the real total is higher. */
  lower_bound: boolean;
  over_stop: boolean;
  upper_over_stop: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 97.5th percentile of the resampled $/unit: records drawn with replacement, their dollars over their scored units. */
function upperBound(records: CostRecord[], seed: number): number {
  const rand = mulberry32(seed);
  const draws: number[] = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    let usd = 0, scored = 0;
    for (let j = 0; j < records.length; j++) {
      const r = records[Math.floor(rand() * records.length)]!;
      usd += r.usd;
      if (isScored(r)) scored++;
    }
    draws.push(scored ? usd / scored : Infinity);
  }
  draws.sort((a, b) => a - b);
  return draws[Math.ceil(0.975 * draws.length) - 1]!;
}

export function project(input: ProjectionInput): Projection {
  const { plan } = input;
  const cells = plan.cells.map((cell, i): CellProjection => {
    const pilot = input.pilot.filter(r => r.cell === cell.id);
    const scored = pilot.filter(isScored);
    const counted = input.results.filter(r => r.cell === cell.id);
    const done = Math.min(cell.units, counted.filter(isScored).length);
    const remaining = cell.units - done;
    const pilotUsd = sum(pilot.map(r => r.usd));
    const priced = scored.length >= MIN_SCORED_UNITS;
    const perUnit = priced ? pilotUsd / scored.length : null;
    const upper = priced ? upperBound(pilot, (input.seed ?? 20261122) + i) : null;
    const wallHours = median(scored.map(r => r.wall_ms)) / 3_600_000;
    const projected = perUnit === null ? null : perUnit * remaining;
    return {
      id: cell.id, model: cell.model, shard: cell.shard,
      pilot_records: pilot.length, pilot_scored: scored.length, pilot_usd: pilotUsd, pilot_usd_reserved: sum(pilot.map(r => r.usd_reserved)),
      unscored_share: pilot.length ? (pilot.length - scored.length) / pilot.length : 0,
      usd_per_unit: perUnit, usd_per_unit_upper: upper,
      units: cell.units, done, remaining,
      projected_usd: projected, projected_upper_usd: upper === null ? null : upper * remaining,
      vm_remaining_usd: priced ? remaining * wallHours / Math.max(1, plan.concurrency) * VM_USD_PER_HOUR : null,
      lease_usd: cell.lease_usd,
      over_lease: projected !== null && cell.lease_usd !== null && sum(counted.map(r => r.usd)) + projected > cell.lease_usd,
      priced,
    };
  });
  const priced = cells.filter(c => c.priced);
  const unpriced = cells.filter(c => !c.priced && c.remaining > 0).map(c => c.id);
  const remaining = sum(priced.map(c => c.projected_usd!));
  const remainingUpper = sum(priced.map(c => c.projected_upper_usd!));
  const vmRemaining = sum(priced.map(c => c.vm_remaining_usd!));
  const base = input.spent_usd + input.vm_spent_usd + (input.own_usd ?? 0) + vmRemaining;
  return {
    run_id: plan.run_id, stop_usd: input.stop_usd, cells, unpriced,
    spent_usd: input.spent_usd, vm_spent_usd: input.vm_spent_usd, own_usd: input.own_usd,
    remaining_usd: remaining, remaining_upper_usd: remainingUpper, vm_remaining_usd: vmRemaining,
    total_usd: base + remaining, total_upper_usd: base + remainingUpper,
    lower_bound: unpriced.length > 0,
    over_stop: base + remaining > input.stop_usd,
    upper_over_stop: base + remainingUpper > input.stop_usd,
  };
}

export const money = (n: number | null) => (n === null ? '-' : n === Infinity ? 'inf' : '$' + n.toFixed(2));

/** The text plan-cost prints: one CELL line per cell, then spend, the totals and any upper-bound warning. */
export function renderProjection(p: Projection, stopSource: string): string[] {
  const lines = [`PLAN: ${p.run_id} cells=${p.cells.length} stop=${money(p.stop_usd)} (${stopSource})`];
  for (const c of p.cells) {
    lines.push(c.priced
      ? `CELL: ${c.id} model=${c.model} pilot=${c.pilot_scored}/${c.pilot_records} scored usd_per_unit=${money(c.usd_per_unit)} upper95=${money(c.usd_per_unit_upper)} unscored=${(c.unscored_share * 100).toFixed(0)}% reserved_in_pilot=${money(c.pilot_usd_reserved)} units=${c.units} done=${c.done} remaining=${c.remaining} projected=${money(c.projected_usd)} lease=${money(c.lease_usd)}${c.over_lease ? ' OVER_LEASE' : ''}`
      : `CELL: ${c.id} model=${c.model} UNPRICED pilot=${c.pilot_scored}/${c.pilot_records} scored (needs ${MIN_SCORED_UNITS}) units=${c.units} done=${c.done} remaining=${c.remaining}`);
  }
  lines.push(`SPENT: ledgers ${money(p.spent_usd)}, VM ${money(p.vm_spent_usd)}, own model use ${p.own_usd === null ? 'not included (pass --own-usd)' : money(p.own_usd)}`);
  lines.push(`REMAINING: cells ${money(p.remaining_usd)} (upper95 ${money(p.remaining_upper_usd)}), VM ${money(p.vm_remaining_usd)} (estimate at $${VM_USD_PER_HOUR.toFixed(3)} an hour, per-VM setup not included)`);
  lines.push(`TOTAL: ${money(p.total_usd)}${p.lower_bound ? ` (lower bound: ${p.unpriced.length} unpriced cell(s) left out: ${p.unpriced.join(', ')})` : ''}; upper95 ${money(p.total_upper_usd)}; stop ${money(p.stop_usd)}`);
  if (p.upper_over_stop && !p.over_stop) lines.push(`WARN: the upper95 total ${money(p.total_upper_usd)} passes the stop ${money(p.stop_usd)}; the mean total ${money(p.total_usd)} does not`);
  return lines;
}
