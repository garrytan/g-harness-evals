#!/usr/bin/env bun
// Writes docs/scoreboard/paired-cost/<run id>.json for every scoreboard entry with paired_cost: per cell and task, the
// recorded spend (usage.usd plus the entry's extra spend fields), scored passes and scored trials from the run's trial
// records, with lookup fails scored as fails. When the entry names a correction, the records are first regraded and
// their reservation charges marked by that correction's own scripts, and a named egress-cut correction takes the cut
// requests' charges off their spend with its script, so the tables hold the corrected costs and solves.
// scripts/scoreboard/build.ts computes the README's paired cost ratios from these tables, so it needs no per-trial
// records, which the public copy leaves out for some runs.
// Usage: bun scripts/scoreboard/paired-cost.ts            (write)
//        bun scripts/scoreboard/paired-cost.ts --check    (exit 1 when a committed table differs from the trial records)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { loadEntries, PAIRED_COST_SCHEMA, pairedCostPath, perTaskCosts, readResults } from './build.ts';
import type { Entry, PairedCostCorrection } from './schema.ts';

const readLines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as TrialRecord);

/** The records after the correction: regraded under its rule, then each record's usage.usd_reserved set from the
 *  reservation charges its script finds, then each record's spend fields taken from scripts/corrections/harbor-cut.ts's
 *  copy, which has the 15 s egress cut's charges taken off. The scripts write copies to a scratch directory; nothing
 *  committed changes. */
function corrected(root: string, results: string, records: TrialRecord[], c: PairedCostCorrection): TrialRecord[] {
  const scratch = mkdtempSync(join(tmpdir(), 'paired-cost-'));
  try {
    const run = (script: string, args: string[], from = results) => {
      const r = spawnSync(process.execPath, [join(root, script), '--results', from, ...args], { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr.trim().slice(-500)}`);
    };
    let out = records;
    if (c.regrade) {
      run('scripts/corrections/regrade-sensitivity.ts', ['--rule', c.regrade, '--out', join(scratch, 'regrade')]);
      out = readLines(join(scratch, 'regrade', 'trials.jsonl'));
    }
    if (c.reservations) {
      run('scripts/corrections/reservation-cost.ts', ['--out', join(scratch, 'reserved'), ...(c.reservations === 'matrix' ? ['--layout', 'matrix'] : [])]);
      const reserved = new Map(readLines(join(scratch, 'reserved', 'trials.jsonl')).map((t) => [t.trial_id, t.usage?.usd_reserved]));
      out = out.map((t) => (t.usage && reserved.get(t.trial_id) !== undefined ? { ...t, usage: { ...t.usage, usd_reserved: reserved.get(t.trial_id) } } : t));
    }
    if (c.cut) {
      run('scripts/corrections/harbor-cut.ts', ['--merged', results, '--out', join(scratch, 'cut')], dirname(results));
      type Cut = TrialRecord & { frontier?: unknown };
      const cut = new Map((readLines(join(scratch, 'cut', 'trials.jsonl')) as Cut[]).map((t) => [t.trial_id, t]));
      out = out.map((t) => {
        const k = cut.get(t.trial_id);
        return k?.usage && t.usage ? { ...t, usage: { ...t.usage, usd: k.usage.usd, by_model: k.usage.by_model }, ...(k.frontier === undefined ? {} : { frontier: k.frontier }) } : t;
      });
    }
    return out;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** An entry's trial records, after the correction it names, and its lookup-fail ids. */
export function entryRecords(root: string, entry: Entry): { records: TrialRecord[]; lookups: Set<string> } {
  const pc = entry.paired_cost!;
  const base = dirname(entry.report);
  const read = readResults(root);
  const records = read(join(base, pc.trials));
  if (!Array.isArray(records)) throw new Error(`${entry.run_id}: ${pc.trials} is not a list of trial records`);
  const lf = pc.lookup_fails ? (read(join(base, pc.lookup_fails)) as { trial_ids?: string[] } | string[]) : [];
  const lookups = new Set(Array.isArray(lf) ? lf : lf.trial_ids ?? []);
  return { records: pc.correction ? corrected(root, join(root, base, dirname(pc.trials)), records as TrialRecord[], pc.correction) : records as TrialRecord[], lookups };
}

/** The committed table's text for one entry, computed from its trial records. */
export function pairedCostTable(root: string, entry: Entry): string {
  const pc = entry.paired_cost!;
  const base = dirname(entry.report);
  const { records, lookups } = entryRecords(root, entry);
  const cells = perTaskCosts(entry.cells, records, lookups, pc.extra_usd ?? []);
  return JSON.stringify({ schema: PAIRED_COST_SCHEMA, run_id: entry.run_id, note: `generated by scripts/scoreboard/paired-cost.ts from ${join(base, pc.trials)}${pc.correction ? `, after the ${pc.correction.label}${pc.correction.cut ? ` and the ${pc.correction.cut.label}` : ''}` : ''}; do not edit by hand`, cells }, null, 2) + '\n';
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const e of loadEntries(root).filter((x) => x.paired_cost)) {
    const p = join(root, pairedCostPath(e.run_id));
    const want = pairedCostTable(root, e);
    if (!check) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, want); continue; }
    if (!existsSync(p) || readFileSync(p, 'utf8') !== want) stale.push(relative(root, p));
  }
  if (stale.length) { console.error(`paired-cost: out of date: ${stale.join(', ')}; run bun scripts/scoreboard/paired-cost.ts, then bun scripts/scoreboard/build.ts`); process.exit(1); }
  console.log(check ? 'paired-cost: up to date' : 'paired-cost: wrote docs/scoreboard/paired-cost/');
}
