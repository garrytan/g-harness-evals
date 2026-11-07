#!/usr/bin/env bun
// H10 wave-1 leases (Captain decisions A1, E1 and F1, 2026-11-07): per shard, smoke lease = the plan's smoke ceiling plus k x Rmax,
// and the counted leases scaled pro rata from the plan's $143.90 so that every lease together stays at or under the $150 cap. Each
// lease is rounded down to the cent. Both factors are read from the matrix-mu-2026-11 receipts of the same harness and model
// (docs/benchmarks/2026-11-04-matrix-mu/results/<cell>.*), not typed in:
//   Rmax = the largest reserved_usd among the forwarded calls in <cell>.proxy-usage.ndjson;
//   k    = the most reservations held at the same time in <cell>.ledger.sqlite (each entry open from created_at to settled_at).
// R, the formula reservation (scripts/ubicloud/smoke-lease.ts callReservationUsd at 50,000 input and 128,000 output tokens), is
// printed beside them for reference. R and Rmax are floors: a call with a larger request body reserves more.
//
//   bun docs/benchmarks/2026-11-07-h10-instruction-placement/compute-leases.ts
//
// Prints one row per shard and the totals as a Markdown table; exits 1 when the totals pass the cap.
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatPrice, reservationUsd } from '../../../runner/ledger/budget-ledger.ts';
import { callReservationUsd, SHARD_MAX_OUTPUT_TOKENS } from '../../../scripts/ubicloud/smoke-lease.ts';

const CAP_USD = 150;
/** Plan v3 ("Run, sharding and cost"): each block's smoke ceiling, its counted lease (the cell ceiling, rounded up) and its base
 *  cost at the stated per-turn prices (30 turns per cell; Opus $0.135 a rule cell turn and $0.070 a no-rule one, gpt-6.1-sol half
 *  that), from which the worst-case margin of a counted lease is lease / base. */
const PLAN: Record<string, { smoke: number; counted: number; base: number }> = {
  'cc-cli': { smoke: 1.28, counted: 38.43, base: 18.3 },
  'cc-sdk': { smoke: 1.01, counted: 30.24, base: 14.4 },
  cx: { smoke: 1.02, counted: 30.54, base: 13.275 },
  he: { smoke: 0.86, counted: 25.88, base: 11.25 },
  oc: { smoke: 0.63, counted: 18.81, base: 8.175 },
};
/** F1: the matrix-mu cell (same harness, same model) whose receipts size each shard's Rmax and k. */
const MATRIX_MU_CELL: Record<string, string> = { 'cc-cli': 'cc-opus', 'cc-sdk': 'cc-opus', cx: 'cx-sol', he: 'he-sol', oc: 'oc-sol' };
const downToCent = (usd: number) => Math.floor(Math.round(usd * 1e6) / 1e4) / 100;

const dir = import.meta.dir;
const matrixMu = join(dir, '..', '2026-11-04-matrix-mu', 'results');
const prereg = JSON.parse(readFileSync(join(dir, 'prereg.json'), 'utf8')) as { cells: Array<{ id: string; model: string }> };
const shards = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8')) as Record<string, string[]>;
const model = new Map(prereg.cells.map((c) => [c.id, c.model]));

function rmax(cell: string): number {
  const reserved = readFileSync(join(matrixMu, `${cell}.proxy-usage.ndjson`), 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { outcome?: string; reserved_usd?: number })
    .filter((x) => x.outcome === 'forwarded' && typeof x.reserved_usd === 'number').map((x) => x.reserved_usd!);
  if (!reserved.length) throw new Error(`no forwarded call in ${cell}.proxy-usage.ndjson`);
  return Math.max(...reserved);
}

function concurrency(cell: string): number {
  const db = new Database(join(matrixMu, `${cell}.ledger.sqlite`), { readonly: true });
  const entries = db.query('SELECT created_at, settled_at FROM entries').all() as Array<{ created_at: string; settled_at: string | null }>;
  db.close();
  if (entries.some((e) => !e.settled_at)) throw new Error(`${cell}.ledger.sqlite has an unsettled entry`);
  const events = entries.flatMap((e) => [{ at: Date.parse(e.created_at), d: 1 }, { at: Date.parse(e.settled_at!), d: -1 }])
    .sort((a, b) => a.at - b.at || a.d - b.d);
  let open = 0, most = 0;
  for (const e of events) { open += e.d; most = Math.max(most, open); }
  return most;
}

const rows = Object.entries(PLAN).map(([shard, plan]) => {
  const cells = shards[shard];
  if (!cells?.length) throw new Error(`shards.json has no cells for ${shard}`);
  const r = Math.max(...cells.map((id) => {
    const usd = callReservationUsd({ chatPrice, reservationUsd }, model.get(id) ?? '', SHARD_MAX_OUTPUT_TOKENS);
    if (usd === null) throw new Error(`no proxy price for cell ${id}`);
    return usd;
  }));
  const source = MATRIX_MU_CELL[shard];
  const top = rmax(source);
  const k = concurrency(source);
  return { shard, plan, source, r, rmax: top, k, smoke: downToCent(plan.smoke + k * top) };
});
const smokeSum = rows.reduce((a, x) => a + x.smoke, 0);
const planCounted = rows.reduce((a, x) => a + x.plan.counted, 0);
const countedBudget = CAP_USD - smokeSum;
const out = rows.map((x) => ({ ...x, counted: downToCent(x.plan.counted * countedBudget / planCounted) }));
const countedSum = out.reduce((a, x) => a + x.counted, 0);
const usd = (n: number) => '$' + n.toFixed(2);
console.log(`Max output tokens ${SHARD_MAX_OUTPUT_TOKENS}; counted budget ${usd(CAP_USD)} - ${usd(smokeSum)} = ${usd(countedBudget)}, scale ${(countedBudget / planCounted).toFixed(6)} on the plan's ${usd(planCounted)}.`);
console.log('');
console.log('| Shard | matrix-mu receipts | R (formula, one call) | Rmax (matrix-mu) | k (most held at once) | Plan smoke ceiling | Smoke lease | Plan counted lease | Counted lease | Base | Margin (lease / base) | Margin after k x Rmax ((lease - k x Rmax) / base) |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const x of out) console.log(`| \`${x.shard}\` | \`${x.source}\` | ${usd(x.r)} (${x.r.toFixed(4)}) | ${usd(x.rmax)} (${x.rmax.toFixed(4)}) | ${x.k} | ${usd(x.plan.smoke)} | ${usd(x.smoke)} | ${usd(x.plan.counted)} | ${usd(x.counted)} | $${x.plan.base.toFixed(3)} | ${(x.counted / x.plan.base).toFixed(4)}x | ${((x.counted - x.k * x.rmax) / x.plan.base).toFixed(4)}x |`);
console.log(`| **Sum** | | | | | | **${usd(smokeSum)}** | ${usd(planCounted)} | **${usd(countedSum)}** | | | |`);
console.log('');
const worst = new Map<string, (typeof out)[number]>();
for (const x of out) { const m = model.get(shards[x.shard][0]) ?? ''; const w = worst.get(m); if (!w || x.counted / x.plan.base < w.counted / w.plan.base) worst.set(m, x); }
console.log(`Worst-case margin (lowest lease / base per model): ${[...worst].map(([m, x]) => `${m} ${(x.counted / x.plan.base).toFixed(4)}x (\`${x.shard}\`)`).join(', ')}.`);
console.log('');
console.log(`All leases: ${usd(smokeSum + countedSum)} against the ${usd(CAP_USD)} cap.`);
if (smokeSum + countedSum > CAP_USD + 1e-9) process.exit(1);
