#!/usr/bin/env bun
/**
 * Writes docs/benchmarks/prereg-ledger.json: one entry per experiment in docs/benchmarks/preregistrations.json and
 * preregistrations.d/ whose preregistration was on main at the cutover (the private prereg commit, its date, its PR number,
 * and the sha256 of the preregistration and of the result manifest). Every experiment must be on main at the cutover, or
 * writing refuses. runner/prereg/prereg.ts --public reads it, and fails when more than one commit changed it.
 *
 *   bun scripts/prereg-ledger.ts [--cutover <ISO-8601>] [--out <path>]   write the ledger (the cutover defaults to the
 *                                                                         one the existing ledger records)
 *   bun scripts/prereg-ledger.ts --check [--out <path>]                  exit 1 unless the ledger is what writing it would give
 *
 * Run it from a full clone of the private main (not shallow). The public export runs it last and drops earlier versions of
 * the ledger from the rebuilt history, so one commit adds it there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildLedger, LEDGER_PATH, loadManifest, readLedger } from '../runner/prereg/prereg.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

export function ledgerText(cutover: string, cwd = process.cwd()): string {
  return JSON.stringify(buildLedger(loadManifest(cwd), cutover, cwd), null, 2) + '\n';
}

if (import.meta.main) {
  const out = arg('out') ?? LEDGER_PATH;
  const cutover = arg('cutover') ?? (existsSync(out) ? readLedger(out).cutover : undefined);
  if (!cutover) {
    console.error('usage: bun scripts/prereg-ledger.ts --cutover <ISO-8601> [--out <path>] | --check [--out <path>] (no ledger yet, so --cutover is required)');
    process.exit(64);
  }
  let text: string;
  try { text = ledgerText(cutover); } catch (e) {
    console.error(`prereg-ledger: ${(e as Error).message}`);
    process.exit(1);
  }
  const n = (JSON.parse(text) as { experiments: unknown[] }).experiments.length;
  if (process.argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === text;
    console.log(same ? `prereg-ledger: ${out} is current (${n} experiments, cutover ${cutover})` : `prereg-ledger: ${out} is stale; the export rewrites it (bun scripts/prereg-ledger.ts --cutover <instant>) in the one commit that adds it to the public history`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(out, text);
  console.log(`prereg-ledger: wrote ${out} (${n} experiments, cutover ${new Date(cutover).toISOString()})`);
}
