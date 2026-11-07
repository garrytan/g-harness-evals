#!/usr/bin/env bun
// internal-task (H10), wave 2: which preregistered conditional blocks run, from the money wave 1 actually spent. Run by the
// coordinator after wave 1's results are copied back and merged.
//
//   bun scripts/ubicloud/wave2-admit.ts --blocks <waves.json> --ledger <file> [--ledger <file> ...]
//     [--out <dir> --commit <sha> --dest <results root>]
//
// waves.json (committed with the preregistration): {"cap_usd": 150, "blocks": [{"id": "f-openclaw", "prereg":
// "docs/benchmarks/<run>/waves/f-openclaw/prereg.json", "precondition": {"holds": true, "note": "..."}, "size"?: "standard-16",
// "options"?: [...]}, ...]} in the preregistered block order.
//
//   1. Settled spend: the committed dollars (settled entries, plus any reservation still open, at its reserve) summed over
//      every --ledger given, which is every wave-1 ledger, counted and smoke. A ledger that is missing or not a SQLite
//      ledger is refused (HE-BUDGET-004), so a forgotten shard cannot make the headroom look larger.
//   2. Headroom = cap_usd minus that sum.
//   3. Walk the blocks in order. A block whose precondition does not hold is skipped (it was dropped in the prereg). A block
//      is admitted only when its counted ceiling plus its smoke ceiling fits what is left; one that does not fit is dropped,
//      never split, and the walk goes on to the next block.
//   Ceilings come from each block's own prereg.json, never typed in, and each leaves room for one more proxy call after the
//   planned spend. The metering proxy reserves a call's worst case against its lease before forwarding it (input plus the
//   whole output cap at list price), so a lease that cannot hold one reservation on top of what is spent refuses the call
//   while the VM keeps billing. R is the largest such reservation among the block's harness cells (smoke-lease.ts
//   callReservationUsd: 50,000 input tokens at the dearest cache-write rate the proxy applies, and the last
//   --max-output-tokens cap in the block's options as run-shard.sh reads it, 128,000 when not given; about $2.96 for
//   Opus 5.5 and $1.41 for GPT-6.1 Sol). counted = plan's cost_ceiling_usd (runner/run.ts
//   buildManifest) plus R; smoke = one member turn per harness cell at its per-turn ceiling (the one-trial smoke on a
//   one-turn task) plus R. Each is rounded up to the cent.
//   4. Print one line per block (ADMIT, SKIP or DROP) with its run id and both leases, and with --out first remove every
//      *.fanout.json an earlier run left there (CLEARED lines), then write each admitted block's fan-out manifest
//      (scripts/ubicloud/fanout.sh: one shard named after the block holding all its cells, lease_usd the counted ceiling,
//      --smoke-lease-usd the smoke ceiling, placed before any -- so run-shard.sh reads it and not the runner).
// No per-cell budget check runs inside runner/run.ts: a shard VM cannot see the other shards' spend, so admission happens here.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatPrice, ledgerStatus, reservationUsd } from '../../runner/ledger/budget-ledger.ts';
import { RunnerError } from '../../runner/errors.ts';
import { buildManifest, ceilingUsd, loadPrereg } from '../../runner/run.ts';
import { callReservationUsd, SHARD_MAX_OUTPUT_TOKENS } from './smoke-lease.ts';

export interface BlockSpec { id: string; prereg: string; precondition: { holds: boolean; note?: string }; size?: string; options?: string[] }
export interface WavesFile { cap_usd: number; blocks: BlockSpec[] }
export interface BlockCeilings { id: string; run_id: string; cells: string[]; counted_usd: number; smoke_usd: number }
export interface Decision extends BlockCeilings { verdict: 'admit' | 'skip' | 'drop'; why: string; headroom_before: number }

const upToCent = (usd: number) => Math.ceil(Math.round(usd * 1e6) / 1e4) / 100;

/** Committed dollars summed over the ledgers; HE-BUDGET-004 for a ledger that is missing or not SQLite. */
export function settledSpend(ledgers: string[]): { total: number; by_ledger: Array<{ ledger: string; usd: number }> } {
  if (!ledgers.length) throw new RunnerError('HE-BUDGET-004', 'no --ledger given; pass every wave-1 ledger, counted and smoke');
  const by = ledgers.map((ledger) => {
    if (!existsSync(ledger)) throw new RunnerError('HE-BUDGET-004', `ledger ${ledger} does not exist; every wave-1 ledger (counted and smoke) must be read before wave 2 is admitted`);
    const s = ledgerStatus({ ledgerPath: ledger });
    if (s.state !== 'sqlite') throw new RunnerError('HE-BUDGET-004', `ledger ${ledger} is not a SQLite budget ledger (state ${s.state})`);
    return { ledger, usd: s.totals.committed_usd };
  });
  return { total: by.reduce((a, b) => a + b.usd, 0), by_ledger: by };
}

/** A block's counted and smoke ceilings from its own preregistration, each with room for one more proxy call (see the header). */
export function blockCeilings(block: BlockSpec, tasksRoot?: string): BlockCeilings {
  if (!existsSync(block.prereg)) throw new RunnerError('HE-BUDGET-004', `block ${block.id}: ${block.prereg} does not exist`);
  const { prereg, sha256 } = loadPrereg(block.prereg);
  const manifest = buildManifest(prereg, sha256, undefined, tasksRoot ? { tasksRoot } : {});
  const harnessCells = prereg.cells.filter((c) => c.harness_mode !== 'scripted');
  const options = block.options ?? [];
  const maxOutputTokens = options.includes('--max-output-tokens') ? Number(options[options.lastIndexOf('--max-output-tokens') + 1]) : SHARD_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new RunnerError('HE-BUDGET-004', `block ${block.id}: --max-output-tokens in its options must be a positive whole number`);
  const call = Math.max(0, ...harnessCells.map((c) => {
    const usd = callReservationUsd({ chatPrice, reservationUsd }, c.model, maxOutputTokens);
    if (usd === null) throw new RunnerError('HE-BUDGET-004', `block ${block.id}: the metering proxy has no price for ${c.model} (cell ${c.id})`);
    return usd;
  }));
  return { id: block.id, run_id: prereg.run_id, cells: prereg.cells.map((c) => c.id), counted_usd: upToCent(manifest.cost_ceiling_usd + call), smoke_usd: upToCent(harnessCells.reduce((a, c) => a + ceilingUsd(c), 0) + call) };
}

/** Walk the blocks in order against the headroom (see the header). */
export function admit(capUsd: number, spentUsd: number, blocks: Array<BlockCeilings & { precondition: BlockSpec['precondition'] }>): { headroom: number; decisions: Decision[] } {
  let left = capUsd - spentUsd;
  const decisions = blocks.map(({ precondition, ...b }) => {
    const before = left;
    const need = b.counted_usd + b.smoke_usd;
    if (!precondition.holds) return { ...b, verdict: 'skip' as const, why: `precondition does not hold${precondition.note ? ` (${precondition.note})` : ''}`, headroom_before: before };
    if (need > left + 1e-9) return { ...b, verdict: 'drop' as const, why: `counted ${b.counted_usd.toFixed(2)} plus smoke ${b.smoke_usd.toFixed(2)} is ${need.toFixed(2)}, above the ${left.toFixed(2)} left`, headroom_before: before };
    left -= need;
    return { ...b, verdict: 'admit' as const, why: `${need.toFixed(2)} fits the ${before.toFixed(2)} left`, headroom_before: before };
  });
  return { headroom: capUsd - spentUsd, decisions };
}

/** The fan-out manifest of an admitted block. */
export function fanoutManifest(d: Decision, block: BlockSpec, commit: string, dest: string) {
  const options = [...(block.options ?? [])];
  const extras = options.indexOf('--');
  options.splice(extras < 0 ? options.length : extras, 0, '--smoke-lease-usd', d.smoke_usd.toFixed(2));
  return { commit, prereg: block.prereg, dest: join(dest, d.id), size: block.size ?? 'standard-16', options, shards: [{ name: d.id, cells: d.cells.join(','), lease_usd: d.counted_usd }] };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const ledgers = argv.flatMap((a, i) => (a === '--ledger' && argv[i + 1] ? [argv[i + 1]!] : []));
  try {
    const file = one('--blocks');
    if (!file || !existsSync(file)) throw new RunnerError('HE-RUN-002', 'usage: bun scripts/ubicloud/wave2-admit.ts --blocks <waves.json> --ledger <file> [--ledger <file> ...] [--out <dir> --commit <sha> --dest <results root>]');
    const waves = JSON.parse(await Bun.file(file).text()) as WavesFile;
    if (!(waves.cap_usd > 0) || !Array.isArray(waves.blocks)) throw new RunnerError('HE-BUDGET-004', `${file} needs cap_usd > 0 and a blocks list`);
    const out = one('--out'), commit = one('--commit'), dest = one('--dest');
    if (out && (!commit || !dest)) throw new RunnerError('HE-RUN-002', '--out needs --commit <the preregistration commit> and --dest <results root>');
    const spent = settledSpend(ledgers);
    const r = admit(waves.cap_usd, spent.total, waves.blocks.map((b) => ({ ...blockCeilings(b), precondition: b.precondition })));
    for (const l of spent.by_ledger) console.log(`LEDGER: ${l.ledger} settled ${l.usd.toFixed(4)}`);
    console.log(`HEADROOM: cap ${waves.cap_usd.toFixed(2)} minus wave-1 settled ${spent.total.toFixed(4)} over ${ledgers.length} ledger(s) = ${r.headroom.toFixed(4)}`);
    if (out) {
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(out).filter((f) => f.endsWith('.fanout.json')).sort()) {
        rmSync(join(out, f));
        console.log(`CLEARED: ${join(out, f)} (an earlier admission's manifest)`);
      }
    }
    for (const d of r.decisions) {
      let where = '';
      if (d.verdict === 'admit' && out) {
        where = join(out, `${d.id}.fanout.json`);
        writeFileSync(where, JSON.stringify(fanoutManifest(d, waves.blocks.find((b) => b.id === d.id)!, commit!, dest!), null, 2) + '\n');
      }
      console.log(`${d.verdict.toUpperCase()}: ${d.id} run=${d.run_id} counted_lease=${d.counted_usd.toFixed(2)} smoke_lease=${d.smoke_usd.toFixed(2)}: ${d.why}${where ? `; manifest ${where}` : ''}`);
    }
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
