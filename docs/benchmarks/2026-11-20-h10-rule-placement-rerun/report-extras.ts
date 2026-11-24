#!/usr/bin/env bun
// The report's numbers that scripts/instruction-followed-h10.ts does not print, from the committed receipts, keyless:
//
//   bun docs/benchmarks/2026-11-20-h10-rule-placement-rerun/report-extras.ts [--check]
//
// Inputs: results/ and pilot/ beside this script, and the original run's committed results/instruction-followed-h10.json.
// Output: results/report-extras.json (followed shares and cost per member turn) and results/spend.json (spend and VM list
// prices, which the public copy leaves out). With --check it writes nothing and exits 1 when either differs from disk.
//
// - Spend from the lease ledgers, to the 1e-7 dollar: each shard's counted ledger (results/<shard>.ledger.sqlite), smoke
//   ledger (results/<shard>.smoke.ledger.sqlite) and pilot ledger (pilot/<shard>.ledger.sqlite). Committed = settled
//   actual_usd plus the reservation of every entry still open. Also the sum of the trial records' own usage.usd.
// - Ubicloud VM list price: each results/*.shard-vm.json and pilot/*.shard-vm.json cost.list_price_usd.
// - Followed share per cell with its 95% interval: the preregistered task-clustered bootstrap (10,000 draws, seed 7), each
//   member turn's outcome from scripts/instruction-followed.ts turnOutcomes on the committed events.jsonl and turns.jsonl,
//   the interval from runner/stats/paired.ts clusteredPairedDelta with the control side fixed at 0. The counts are checked
//   against results/instruction-followed-h10.json. search_or_query counts the followed turns whose calls before the first
//   reply include gbrain.search or gbrain.query (turnOutcomes followed_search_query).
// - Cost per member turn per cell (trial USD over turns run, the trials the preregistered filter excludes left out) and over
//   its own control's; each harness's no-gbrain cell
//   beside its gbrain control (same run, same tasks); and each cell's followed count in the original run
//   (2026-11-07-h10-instruction-placement, gbrain 0.60.547.0 and GPT-6.1 Sol: descriptive, build and model both changed).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { clusteredPairedDelta } from '../../../runner/stats/paired.ts';
import { turnOutcomes } from '../../../scripts/instruction-followed.ts';
import type { TurnWindow } from '../../../runner/contracts.ts';
import type { WorldEvent } from '../../../world/services/events.ts';

const DIR = 'docs/benchmarks/2026-11-20-h10-rule-placement-rerun';
const RES = join(DIR, 'results');
const PILOT = join(DIR, 'pilot');
const ORIGINAL = 'docs/benchmarks/2026-11-07-h10-instruction-placement/results/instruction-followed-h10.json';
const OUT = join(RES, 'report-extras.json');
const SPEND_OUT = join(RES, 'spend.json');
const SHARDS = ['cc-cli', 'cc-sdk', 'cx', 'he', 'oc', 'qm'];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r7 = (x: number) => Math.round(x * 1e7) / 1e7;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function ledger(path: string) {
  const db = new Database(path, { readonly: true });
  const row = db.query("select count(*) as entries, sum(case when settled_at is null then 0 else actual_usd end) as settled, sum(case when settled_at is null then 1 else 0 end) as open_entries, sum(case when settled_at is null then reserved_usd else 0 end) as open_usd from entries").get() as { entries: number; settled: number | null; open_entries: number; open_usd: number | null };
  db.close();
  const settled = row.settled ?? 0;
  const open = row.open_usd ?? 0;
  return { entries: row.entries, settled_usd: r7(settled), open_entries: row.open_entries, open_usd: r7(open), committed_usd: r7(settled + open) };
}
type Ledger = ReturnType<typeof ledger>;
const spend = { counted: {} as Record<string, Ledger>, smoke: {} as Record<string, Ledger>, pilot: {} as Record<string, Ledger> };
for (const s of SHARDS) {
  spend.counted[s] = ledger(join(RES, s + '.ledger.sqlite'));
  spend.smoke[s] = ledger(join(RES, s + '.smoke.ledger.sqlite'));
}
for (const f of readdirSync(PILOT).filter((n) => n.endsWith('.ledger.sqlite')).sort()) spend.pilot[f.replace('.ledger.sqlite', '')] = ledger(join(PILOT, f));
const tot = (o: Record<string, Ledger>) => r7(sum(Object.values(o).map((l) => l.committed_usd)));

interface Trial { trial_id: string; cell: string; task: string; termination: string; cap_stop?: boolean; turns: { run: number }; usage?: { usd?: number } }
const jsonl = <T>(p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const trials = jsonl<Trial>(join(RES, 'trials.jsonl'));

const vms: Array<{ file: string; vm: string; minutes: number; list_price_usd: number }> = [];
for (const [d, label] of [[RES, 'results'], [PILOT, 'pilot']] as const) {
  for (const f of readdirSync(d).filter((n) => n.endsWith('.shard-vm.json')).sort()) {
    const j = JSON.parse(readFileSync(join(d, f), 'utf8')) as { vm: string; cost: { vm_minutes: number; list_price_usd: number } };
    vms.push({ file: label + '/' + f, vm: j.vm, minutes: j.cost.vm_minutes, list_price_usd: j.cost.list_price_usd });
  }
}
const vmTot = (p: (f: string) => boolean) => r4(sum(vms.filter((v) => p(v.file)).map((v) => v.list_price_usd)));

const EXCLUDED = ['model_error', 'infra_error', 'exam_fault'];
const cells = [...new Set(trials.map((t) => t.cell))].sort();
const controlOf = (c: string) => c.includes('-none-') ? c : c.includes('-sdk-') ? c.replace(/sdk-(preset|default)-route-[a-z]+/, 'sdk-preset-route-tool') : c.replace(/route-[a-z]+-mu/, 'route-tool-mu');
const perCell: Record<string, { trials: number; turns: number; usd: number; usd_per_turn: number; control: string; usd_per_turn_over_control: number | null }> = {};
for (const c of cells) {
  const ts = trials.filter((t) => t.cell === c && !EXCLUDED.includes(t.termination) && !t.cap_stop);
  const usd = sum(ts.map((t) => t.usage?.usd ?? 0));
  const turns = sum(ts.map((t) => t.turns.run));
  perCell[c] = { trials: ts.length, turns, usd: r7(usd), usd_per_turn: r4(usd / turns), control: controlOf(c), usd_per_turn_over_control: null };
}
for (const c of cells) { const ctl = perCell[perCell[c].control]; perCell[c].usd_per_turn_over_control = ctl && ctl !== perCell[c] ? r4((perCell[c].usd / perCell[c].turns) / (ctl.usd / ctl.turns)) : null; }

const scored = JSON.parse(readFileSync(join(RES, 'instruction-followed-h10.json'), 'utf8')) as { cells: Array<{ cell: string; followed: { k: number; n: number } }> };
const original = existsSync(ORIGINAL) ? JSON.parse(readFileSync(ORIGINAL, 'utf8')) as { cells: Array<{ cell: string; followed: { k: number; n: number } }> } : { cells: [] };
const followed: Record<string, { k: number; search_or_query: number; n: number; rate: number; ci95: [number, number] | null; matches_scorer: boolean; original: { k: number; n: number } | null }> = {};
for (const c of cells) {
  const items: Array<{ id: string; cluster: string; a: number; b: number }> = [];
  let search = 0;
  for (const t of trials.filter((x) => x.cell === c && !EXCLUDED.includes(x.termination) && !x.cap_stop)) {
    const dir = join(RES, 'trials', ...t.trial_id.split('/').slice(1));
    const outcomes = turnOutcomes(jsonl<WorldEvent>(join(dir, 'events.jsonl')), jsonl<TurnWindow>(join(dir, 'turns.jsonl')));
    outcomes.forEach((o, i) => items.push({ id: t.trial_id + '#' + i, cluster: t.task, a: 0, b: o.followed ? 1 : 0 }));
    search += outcomes.filter((o) => o.followed_search_query).length;
  }
  const s = clusteredPairedDelta(items, { seed: 7, draws: 10_000 });
  const k = items.filter((i) => i.b === 1).length;
  const sc = scored.cells.find((x) => x.cell === c)!;
  const o = original.cells.find((x) => x.cell === c.replace('-mu-v031-dev', '-mu-v03-dev'));
  followed[c] = { k, search_or_query: search, n: items.length, rate: r4(k / items.length), ci95: s.ci95 ? [r4(s.ci95[0]), r4(s.ci95[1])] : null, matches_scorer: sc.followed.k === k && sc.followed.n === items.length, original: o ? o.followed : null };
}

const spendOut = {
  run_id: 'h10-rule-placement-rerun-2026-11',
  spend: {
    ...spend,
    counted_total_usd: tot(spend.counted),
    smoke_total_usd: tot(spend.smoke),
    pilot_total_usd: tot(spend.pilot),
    paid_total_usd: r7(tot(spend.counted) + tot(spend.smoke) + tot(spend.pilot)),
    trial_records_usd: r7(sum(trials.map((t) => t.usage?.usd ?? 0))),
  },
  vms: { rows: vms, counted_usd: vmTot((f) => f.startsWith('results/')), pilot_usd: vmTot((f) => f.startsWith('pilot/')), total_usd: vmTot(() => true) },
};
const out = { run_id: spendOut.run_id, followed, per_cell: perCell };
const files: Array<[string, string]> = [[OUT, JSON.stringify(out, null, 1) + '\n'], [SPEND_OUT, JSON.stringify(spendOut, null, 1) + '\n']];
if (process.argv.includes('--check')) {
  const stale = files.filter(([f, text]) => !existsSync(f) || readFileSync(f, 'utf8') !== text).map(([f]) => f);
  if (stale.length) { console.error('report-extras: ' + stale.join(', ') + ' differ from the receipts'); process.exit(1); }
  console.log('report-extras: ' + files.map(([f]) => f).join(' and ') + ' match');
} else {
  for (const [f, text] of files) writeFileSync(f, text);
  for (const [c, v] of Object.entries(perCell)) console.log(c + ' followed ' + followed[c].k + '/' + followed[c].n + ' [' + followed[c].ci95 + '] scorer-match ' + followed[c].matches_scorer + ' original ' + JSON.stringify(followed[c].original) + '; $/turn ' + v.usd_per_turn + ' x control ' + v.usd_per_turn_over_control);
}
