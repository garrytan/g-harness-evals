#!/usr/bin/env bun
// H10 Amendment 1 (Captain internal-task, 2026-11-07): wave-1 leases and smoke-cost gate re-costed from the measured smokes. Keyless,
// read only. Every input is a committed file:
//   smoke-measurement/<shard>.trials.jsonl and .ledger.sqlite   the uncounted sy-01 smokes of the gbrain cells (2026-11-07)
//   smoke-measurement/<shard>.proxy-usage.ndjson                the largest reservation those smokes made
//   ../2026-11-04-matrix-mu/results/trials.jsonl                 the no-gbrain arm of the same harness and model
//   ../2026-11-04-matrix-mu/results/<cell>.proxy-usage.ndjson     Rmax, as compute-leases.ts reads it
//   ../2026-11-04-matrix-mu/results/<cell>.ledger.sqlite          k, as compute-leases.ts reads it
// Per shard:
//   smoke $/turn      = max(usage.usd, the smoke ledger's entries for the trial) / turns.run, completed smokes only
//   ratio             = mean gbrain smoke $/turn / mean matrix-mu no-gbrain sy-01 $/turn (the same task, like for like)
//   adjusted $/turn   = matrix-mu no-gbrain all-turn $/turn x ratio
//   base              = adjusted $/turn x 30 turns x the shard's cells (no rule/no-rule split)
//   counted ceiling   = plan v3's ceiling/base factor (Opus 2.1, gpt-6.1-sol 2.3: compute-leases.ts PLAN counted / base) x base,
//                       rounded up to the cent
//   smoke lease       = 1.5 x largest smoke $/turn x cells + k x Rs, rounded up to the cent, where Rs is the larger of
//                       matrix-mu's Rmax and the largest reservation the smokes made (fix round, Captain internal-task, 2026-11-07)
//   counted lease     = counted ceiling x (cap - smoke leases) / (sum of counted ceilings), rounded down (compute-leases.ts)
//   gate (sy-01)      = adjusted $/turn x sy-01 factor (matrix-mu no-gbrain sy-01 / all-turn) x margin after k x Rs
//   internal-task ratios   = the route-tool (no-rule control) smoke $/turn, and the mean over all completed smokes, each over the
//                       matrix-mu no-gbrain sy-01 mean
//
//   bun docs/benchmarks/2026-11-07-h10-instruction-placement/compute-leases-amended.ts
//
// Prints the tables committed as leases-amended.txt; exits 1 when the leases pass the cap.
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAP_USD = 250;
const TURNS_PER_CELL = 30;
const FACTOR: Record<string, number> = { 'cc-cli': 2.1, 'cc-sdk': 2.1, cx: 2.3, he: 2.3, oc: 2.3 };
const MATRIX_MU_CELL: Record<string, string> = { 'cc-cli': 'cc-opus', 'cc-sdk': 'cc-opus', cx: 'cx-sol', he: 'he-sol', oc: 'oc-sol' };
const NO_GBRAIN: Record<string, string> = {
  'cc-cli': 'claude-code-opus-none-mu-v03-dev', 'cc-sdk': 'claude-code-opus-none-mu-v03-dev', cx: 'codex-sol-none-mu-v03-dev',
  he: 'hermes-sol-none-mu-v03-dev', oc: 'openclaw-sol-none-mu-v03-dev',
};
const SMOKE_TASK = 'sy-01-quarrendon-ticket-numbers';
const SMOKE_HEADROOM = 1.5;
const downToCent = (usd: number) => Math.floor(Math.round(usd * 1e6) / 1e4) / 100;
const upToCent = (usd: number) => Math.ceil(Math.round(usd * 1e6) / 1e4) / 100;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

type Trial = { trial_id: string; cell: string; task: string; termination: string; turns: { run: number }; usage: { usd: number; meter_id: string } | null };
const dir = import.meta.dir;
const matrixMu = join(dir, '..', '2026-11-04-matrix-mu', 'results');
const shards = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8')) as Record<string, string[]>;
const jsonl = <T>(path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const mm = jsonl<Trial>(join(matrixMu, 'trials.jsonl'));

function forwardedReservations(path: string): number[] {
  return jsonl<{ outcome?: string; reserved_usd?: number }>(path).filter((x) => x.outcome === 'forwarded' && typeof x.reserved_usd === 'number').map((x) => x.reserved_usd!);
}
function concurrency(cell: string): number {
  const db = new Database(join(matrixMu, `${cell}.ledger.sqlite`), { readonly: true });
  const entries = db.query('SELECT created_at, settled_at FROM entries').all() as Array<{ created_at: string; settled_at: string | null }>;
  db.close();
  if (entries.some((e) => !e.settled_at)) throw new Error(`${cell}.ledger.sqlite has an unsettled entry`);
  const events = entries.flatMap((e) => [{ at: Date.parse(e.created_at), d: 1 }, { at: Date.parse(e.settled_at!), d: -1 }]).sort((a, b) => a.at - b.at || a.d - b.d);
  let open = 0, most = 0;
  for (const e of events) { open += e.d; most = Math.max(most, open); }
  return most;
}
function smokes(shard: string): Array<{ cell: string; perTurn: number }> {
  const db = new Database(join(dir, 'smoke-measurement', `${shard}.ledger.sqlite`), { readonly: true });
  const entries = db.query('SELECT description, reserved_usd, actual_usd FROM entries').all() as Array<{ description: string; reserved_usd: number; actual_usd: number | null }>;
  db.close();
  return jsonl<Trial>(join(dir, 'smoke-measurement', `${shard}.trials.jsonl`)).filter((t) => t.termination === 'completed' && t.turns.run > 0).map((t) => {
    const ledger = entries.filter((e) => e.description.includes(`[${t.usage!.meter_id}]`)).reduce((a, e) => a + (e.actual_usd ?? e.reserved_usd), 0);
    return { cell: t.cell, perTurn: Math.max(t.usage!.usd, ledger) / t.turns.run };
  });
}

const rows = Object.keys(FACTOR).map((shard) => {
  const cells = shards[shard].length;
  const none = mm.filter((t) => t.cell === NO_GBRAIN[shard] && t.usage);
  const allTurn = none.reduce((a, t) => a + t.usage!.usd, 0) / none.reduce((a, t) => a + t.turns.run, 0);
  const sy = none.filter((t) => t.task === SMOKE_TASK).map((t) => t.usage!.usd / t.turns.run);
  const s = smokes(shard);
  const g = s.map((x) => x.perTurn);
  const control = s.filter((x) => x.cell.includes('-route-tool-')).map((x) => x.perTurn);
  const ratio = mean(g) / mean(sy);
  const adjusted = allTurn * ratio;
  const syFactor = mean(sy) / allTurn;
  const base = adjusted * TURNS_PER_CELL * cells;
  const source = MATRIX_MU_CELL[shard];
  const rmax = Math.max(...forwardedReservations(join(matrixMu, `${source}.proxy-usage.ndjson`)));
  const smokeR = Math.max(...forwardedReservations(join(dir, 'smoke-measurement', `${shard}.proxy-usage.ndjson`)));
  const rs = Math.max(rmax, smokeR);
  const k = concurrency(source);
  const gMax = Math.max(...g);
  const smokeExact = SMOKE_HEADROOM * gMax * cells + k * rs;
  return { shard, cells, n: g.length, gMean: mean(g), gMax, syMean: mean(sy), allTurn, ratio, adjusted, syFactor, base, rmax, smokeR, rs, k,
    control: mean(control), controlN: control.length,
    ceiling: upToCent(FACTOR[shard] * base), smokeExact, smoke: upToCent(smokeExact), relaunch: mean(g) * cells, smokeBase: mean(g) * TURNS_PER_CELL * cells };
});
const smokeSum = rows.reduce((a, x) => a + x.smoke, 0);
const ceilingSum = rows.reduce((a, x) => a + x.ceiling, 0);
const scale = (CAP_USD - smokeSum) / ceilingSum;
const out = rows.map((x) => {
  const counted = downToCent(x.ceiling * scale);
  const after = (counted - x.k * x.rs) / x.base;
  return { ...x, counted, after, gate: x.adjusted * x.syFactor * after };
});
const countedSum = out.reduce((a, x) => a + x.counted, 0);
const baseSum = out.reduce((a, x) => a + x.base, 0);
const relaunch = out.reduce((a, x) => a + x.relaunch, 0);
const smokeBaseSum = out.reduce((a, x) => a + x.smokeBase, 0);
const usd = (n: number) => '$' + n.toFixed(2);
const f4 = (n: number) => n.toFixed(4);
const sh = (s: string) => '`' + s + '`';

console.log(`Cap ${usd(CAP_USD)}; ${TURNS_PER_CELL} turns per cell; smoke task ${SMOKE_TASK}.`);
console.log('');
console.log('| Shard | Cells | Smokes (completed) | gbrain smoke $/turn, mean | max | matrix-mu no-gbrain sy-01 $/turn | gbrain / no-gbrain on sy-01 | matrix-mu no-gbrain all-turn $/turn | sy-01 factor (sy-01 / all-turn) | Adjusted $/turn | Base |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const x of out) console.log(`| ${sh(x.shard)} | ${x.cells} | ${x.n} | ${f4(x.gMean)} | ${f4(x.gMax)} | ${f4(x.syMean)} | ${f4(x.ratio)}x | ${f4(x.allTurn)} | ${f4(x.syFactor)}x | ${f4(x.adjusted)} | ${usd(x.base)} (${f4(x.base)}) |`);
console.log(`| **Sum** | | | | | | | | | | **${usd(baseSum)}** |`);
console.log('');
console.log(`Smoke lease = ${SMOKE_HEADROOM} x largest smoke $/turn x cells + k x Rs, where Rs = max(matrix-mu Rmax, largest smoke reservation), rounded up to the cent:`);
console.log('');
console.log(`| Shard | ${SMOKE_HEADROOM} x largest smoke $/turn x cells | k | matrix-mu Rmax | Largest smoke reservation | Rs | Exact | Smoke lease |`);
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const x of out) console.log(`| ${sh(x.shard)} | ${SMOKE_HEADROOM} x ${f4(x.gMax)} x ${x.cells} = ${f4(SMOKE_HEADROOM * x.gMax * x.cells)} | ${x.k} | ${f4(x.rmax)} | ${f4(x.smokeR)} | ${f4(x.rs)} | ${f4(x.smokeExact)} | ${usd(x.smoke)} |`);
console.log(`| **Sum** | | | | | | | **${usd(smokeSum)}** |`);
console.log('');
console.log(`Counted budget ${usd(CAP_USD)} - ${usd(smokeSum)} = ${usd(CAP_USD - smokeSum)}; counted ceilings (factor x base, rounded up) sum to ${usd(ceilingSum)}; scale ${scale.toFixed(6)}.`);
console.log('');
console.log('| Shard | Factor | Counted ceiling | Counted lease | Margin (lease / base) | Margin after k x Rs ((lease - k x Rs) / base) | Gate: sy-01 ceiling $/turn |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const x of out) console.log(`| ${sh(x.shard)} | ${FACTOR[x.shard]} | ${usd(x.ceiling)} | ${usd(x.counted)} | ${f4(x.counted / x.base)}x | ${f4(x.after)}x | $${f4(x.gate)} |`);
console.log(`| **Sum** | | ${usd(ceilingSum)} | **${usd(countedSum)}** | | | |`);
console.log('');
console.log('Gate: sy-01 ceiling = adjusted $/turn x sy-01 factor x margin after k x Rs (equal to the mean gbrain smoke $/turn x that margin).');
console.log(`All leases: ${usd(smokeSum)} smoke + ${usd(countedSum)} counted = ${usd(smokeSum + countedSum)} against the ${usd(CAP_USD)} cap.`);
console.log(`Expected run spend: adjusted base ${usd(baseSum)} + one sy-01 smoke per cell at the measured mean ${usd(relaunch)} = ${usd(baseSum + relaunch)}.`);
console.log(`On the smoke-based base (mean gbrain smoke $/turn x ${TURNS_PER_CELL} x cells) instead: ${usd(smokeBaseSum)} + ${usd(relaunch)} = ${usd(smokeBaseSum + relaunch)}.`);
console.log(`One relaunch per shard reruns its smoke under a fresh smoke lease, outside the cap: at most ${usd(smokeSum)} more.`);
console.log('');
console.log('internal-task, sy-01 (one member turn): gbrain smoke $/turn over matrix-mu no-gbrain sy-01 $/turn.');
console.log('');
console.log('| Shard | Route-tool control smoke $/turn (n) | Control / no-gbrain | All completed smokes, mean $/turn (n) | All smokes / no-gbrain (rule injection included) |');
console.log('|---|---:|---:|---:|---:|');
for (const x of out) console.log(`| ${sh(x.shard)} | ${f4(x.control)} (${x.controlN}) | ${f4(x.control / x.syMean)}x | ${f4(x.gMean)} (${x.n}) | ${f4(x.ratio)}x |`);
if (smokeSum + countedSum > CAP_USD + 1e-9) process.exit(1);
