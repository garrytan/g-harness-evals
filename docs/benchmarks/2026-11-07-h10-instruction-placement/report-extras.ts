#!/usr/bin/env bun
// The report's numbers that scripts/instruction-followed-h10.ts does not print, from the committed receipts, keyless:
//
//   bun docs/benchmarks/2026-11-07-h10-instruction-placement/report-extras.ts [--check]
//
// Inputs: results/ and smoke-measurement/ beside this script, and matrix-mu-2026-11's committed results/trials.jsonl.
// Output: results/report-extras.json. With --check it writes nothing and exits 1 when the output differs from disk.
//
// - Spend from the lease ledgers, to the 1e-7 dollar: each shard's counted ledger (results/<shard>.ledger.sqlite) and
//   smoke ledger (results/<shard>.smoke.ledger.sqlite) at the launch commit, and the first launch's and the smoke-only
//   measurement's ledgers (smoke-measurement/<shard>.ledger.sqlite). Committed = settled actual_usd plus the reservation
//   of every entry still open. Also the sum of the trial records' own usage.usd, as a cross-check.
// - Ubicloud VM list price: each results/*.shard-vm.json cost.list_price_usd, plus the two keyless one-VM pre-smokes,
//   which wrote no shard-vm.json, priced the same way (minutes from create to destroy rounded up, standard-16 rate plus
//   the IPv4 rate) from the create and destroy times in the run's VM map (written below as constants).
// - Followed share per cell with its 95% interval: the preregistered task-clustered bootstrap (10,000 draws, seed 7),
//   which scripts/instruction-followed-h10.ts does not print. Each member turn's outcome is scripts/instruction-followed.ts
//   turnOutcomes on the committed events.jsonl and turns.jsonl (the scorer's own rule), and the interval is
//   runner/stats/paired.ts clusteredPairedDelta with the control side fixed at 0, so its delta is the cell's share. The
//   counts are checked against results/instruction-followed-h10.json.
// - Cost per member turn per cell (trial USD over turns run), each route's cost per turn over its own control's, and
//   matrix-mu-2026-11's no-gbrain cell of the same harness and model on the same 10 tasks (4 repetitions; descriptive,
//   another run at another commit).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { clusteredPairedDelta } from '../../../runner/stats/paired.ts';
import { turnOutcomes } from '../../../scripts/instruction-followed.ts';
import type { TurnWindow } from '../../../runner/contracts.ts';
import type { WorldEvent } from '../../../world/services/events.ts';

const DIR = 'docs/benchmarks/2026-11-07-h10-instruction-placement';
const RES = join(DIR, 'results');
const OUT = join(RES, 'report-extras.json');
const SHARDS = ['cc-cli', 'cc-sdk', 'cx', 'he', 'oc'];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r7 = (x: number) => Math.round(x * 1e7) / 1e7;

function ledger(path: string) {
  const db = new Database(path, { readonly: true });
  const row = db.query("select count(*) as entries, sum(case when settled_at is null then 0 else actual_usd end) as settled, sum(case when settled_at is null then 1 else 0 end) as open_entries, sum(case when settled_at is null then reserved_usd else 0 end) as open_usd from entries").get() as { entries: number; settled: number | null; open_entries: number; open_usd: number | null };
  const runs = db.query('select sum(committed_usd) as c from runs').get() as { c: number };
  db.close();
  const settled = row.settled ?? 0;
  const open = row.open_usd ?? 0;
  return { entries: row.entries, settled_usd: r7(settled), open_entries: row.open_entries, open_usd: r7(open), committed_usd: r7(settled + open), runs_committed_usd: r7(runs.c) };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const spend = { counted: {} as Record<string, ReturnType<typeof ledger>>, smoke: {} as Record<string, ReturnType<typeof ledger>>, first_launch_and_measurement: {} as Record<string, ReturnType<typeof ledger>> };
for (const s of SHARDS) {
  spend.counted[s] = ledger(join(RES, s + '.ledger.sqlite'));
  spend.smoke[s] = ledger(join(RES, s + '.smoke.ledger.sqlite'));
  spend.first_launch_and_measurement[s] = ledger(join(DIR, 'smoke-measurement', s + '.ledger.sqlite'));
}
const tot = (o: Record<string, ReturnType<typeof ledger>>) => r7(sum(Object.values(o).map((l) => l.committed_usd)));
const openTot = (o: Record<string, ReturnType<typeof ledger>>) => r7(sum(Object.values(o).map((l) => l.open_usd)));

interface Trial { trial_id: string; cell: string; task: string; termination: string; grade: string; consent_violation: boolean; turns: { run: number }; usage?: { usd?: number } }
const read = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Trial);
const trials = read(join(RES, 'trials.jsonl'));

const IPV4 = 0.00006944;
const RATE16 = 0.00831;
const minutes = (a: string, b: string) => Math.ceil((Date.parse(b) - Date.parse(a)) / 60000);
const PRESMOKES = [
  { vm: '<vm name>', at: '45eb516 (first launch)', created_at: '2026-11-07T15:40:23Z', destroyed_at: '2026-11-07T15:47:54Z' },
  { vm: '<vm name>', at: 'fc5547d (launch commit)', created_at: '2026-11-07T20:15:44Z', destroyed_at: '2026-11-07T20:23:40Z' },
];
const vms: Array<{ file: string; vm: string; minutes: number; list_price_usd: number }> = [];
for (const f of ['cc-cli', 'cc-sdk', 'cx', 'he', 'oc'].map((s) => s + '.shard-vm.json').concat(['cx.first-launch.shard-vm.json', 'cc-cli.smoke-only.shard-vm.json', 'cc-sdk.smoke-only.shard-vm.json', 'he.smoke-only.shard-vm.json', 'oc.smoke-only.shard-vm.json'])) {
  const j = JSON.parse(readFileSync(join(RES, f), 'utf8')) as { vm: string; cost: { vm_minutes: number; list_price_usd: number } };
  vms.push({ file: f, vm: j.vm, minutes: j.cost.vm_minutes, list_price_usd: j.cost.list_price_usd });
}
for (const p of PRESMOKES) { const m = minutes(p.created_at, p.destroyed_at); vms.push({ file: 'pre-smoke at ' + p.at, vm: p.vm, minutes: m, list_price_usd: r4(m * (RATE16 + IPV4)) }); }
const launchVms = vms.filter((v) => /^(cc-cli|cc-sdk|cx|he|oc)\.shard-vm\.json$/.test(v.file) || v.file.includes('fc5547d'));
const firstVms = vms.filter((v) => !launchVms.includes(v));

const cells = [...new Set(trials.map((t) => t.cell))].sort();
const perCell: Record<string, { trials: number; turns: number; usd: number; usd_per_turn: number; control: string; usd_per_turn_over_control: number | null }> = {};
const controlOf = (c: string) => c.includes('-sdk-') ? c.replace(/sdk-(preset|default)-route-[a-z]+/, 'sdk-preset-route-tool') : c.replace(/route-[a-z]+-mu/, 'route-tool-mu');
for (const c of cells) {
  const ts = trials.filter((t) => t.cell === c);
  const usd = sum(ts.map((t) => t.usage?.usd ?? 0));
  const turns = sum(ts.map((t) => t.turns.run));
  perCell[c] = { trials: ts.length, turns, usd: r7(usd), usd_per_turn: r4(usd / turns), control: controlOf(c), usd_per_turn_over_control: null };
}
for (const c of cells) { const ctl = perCell[perCell[c].control]; perCell[c].usd_per_turn_over_control = ctl ? r4(perCell[c].usd_per_turn / ctl.usd_per_turn) : null; }

const jsonl = <T>(p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const scored = JSON.parse(readFileSync(join(RES, 'instruction-followed-h10.json'), 'utf8')) as { cells: Array<{ cell: string; followed: { k: number; n: number } }> };
const followed: Record<string, { k: number; n: number; rate: number; ci95: [number, number] | null; matches_scorer: boolean }> = {};
for (const c of cells) {
  const items: Array<{ id: string; cluster: string; a: number; b: number }> = [];
  for (const t of trials.filter((x) => x.cell === c && !['model_error', 'infra_error', 'exam_fault'].includes(x.termination))) {
    const dir = join(RES, 'trials', ...t.trial_id.split('/').slice(1));
    const outcomes = turnOutcomes(jsonl<WorldEvent>(join(dir, 'events.jsonl')), jsonl<TurnWindow>(join(dir, 'turns.jsonl')));
    outcomes.forEach((o, i) => items.push({ id: t.trial_id + '#' + i, cluster: t.task, a: 0, b: o.followed ? 1 : 0 }));
  }
  const s = clusteredPairedDelta(items, { seed: 7, draws: 10_000 });
  const k = items.filter((i) => i.b === 1).length;
  const sc = scored.cells.find((x) => x.cell === c)!;
  followed[c] = { k, n: items.length, rate: r4(k / items.length), ci95: s.ci95 ? [r4(s.ci95[0]), r4(s.ci95[1])] : null, matches_scorer: sc.followed.k === k && sc.followed.n === items.length };
}

const TASKS = [...new Set(trials.map((t) => t.task))].sort();
const mu = read('docs/benchmarks/2026-11-04-matrix-mu/results/trials.jsonl');
const MU: Record<string, { mu_cell: string; h10_control: string }> = {
  'Claude Code cli, Opus 5.5': { mu_cell: 'claude-code-opus-none-mu-v03-dev', h10_control: 'claude-code-opus-gbrain-route-tool-mu-v03-dev' },
  'Claude Code SDK preset, Opus 5.5': { mu_cell: 'claude-code-opus-none-mu-v03-dev', h10_control: 'claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev' },
  'Codex, gpt-6.1-sol': { mu_cell: 'codex-sol-none-mu-v03-dev', h10_control: 'codex-sol-gbrain-route-tool-mu-v03-dev' },
  'Hermes, gpt-6.1-sol': { mu_cell: 'hermes-sol-none-mu-v03-dev', h10_control: 'hermes-sol-gbrain-route-tool-mu-v03-dev' },
  'OpenClaw, gpt-6.1-sol': { mu_cell: 'openclaw-sol-none-mu-v03-dev', h10_control: 'openclaw-sol-gbrain-route-tool-mu-v03-dev' },
};
// The OpenClaw request charged its whole $1.4323 reservation with no usage reported (Amendment 1, section 8) sits in this trial's USD.
const TIMED_OUT = 'matrix-mu-2026-11/openclaw-sol-none-mu-v03-dev/cn-02-tansleigh-packaging-deadline/r4';
const crossRun: Record<string, unknown> = {};
for (const [label, m] of Object.entries(MU)) {
  const ts = mu.filter((t) => t.cell === m.mu_cell && TASKS.includes(t.task) && !['model_error', 'infra_error', 'exam_fault'].includes(t.termination));
  const usd = sum(ts.map((t) => t.usage?.usd ?? 0));
  const turns = sum(ts.map((t) => t.turns.run));
  const ctl = perCell[m.h10_control];
  const clean = ts.filter((t) => t.trial_id !== TIMED_OUT);
  const usdClean = sum(clean.map((t) => t.usage?.usd ?? 0));
  const turnsClean = sum(clean.map((t) => t.turns.run));
  crossRun[label] = { matrix_mu_cell: m.mu_cell, matrix_mu_trials: ts.length, matrix_mu_turns: turns, matrix_mu_usd_per_turn: r4(usd / turns), h10_control: m.h10_control, h10_control_usd_per_turn: ctl.usd_per_turn, ratio: r4(ctl.usd_per_turn / (usd / turns)), without_timed_out_charge: clean.length === ts.length ? null : { trials: clean.length, matrix_mu_usd_per_turn: r4(usdClean / turnsClean), ratio: r4(ctl.usd_per_turn / (usdClean / turnsClean)) } };
}

const out = {
  run_id: 'h10-instruction-placement-2026-11',
  spend: {
    ...spend,
    counted_total_usd: tot(spend.counted),
    smoke_total_usd: tot(spend.smoke),
    launch_total_usd: r7(tot(spend.counted) + tot(spend.smoke)),
    first_launch_and_measurement_total_usd: tot(spend.first_launch_and_measurement),
    first_launch_and_measurement_open_usd: openTot(spend.first_launch_and_measurement),
    paid_total_usd: r7(tot(spend.counted) + tot(spend.smoke) + tot(spend.first_launch_and_measurement)),
    trial_records_usd: r7(sum(trials.map((t) => t.usage?.usd ?? 0))),
  },
  vms: { rows: vms, launch_usd: r4(sum(launchVms.map((v) => v.list_price_usd))), first_launch_and_measurement_usd: r4(sum(firstVms.map((v) => v.list_price_usd))), total_usd: r4(sum(vms.map((v) => v.list_price_usd))) },
  followed: followed,
  per_cell: perCell,
  gbrain_vs_matrix_mu_no_gbrain_same_tasks: { tasks: TASKS, rows: crossRun },
};
const text = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const disk = readFileSync(OUT, 'utf8');
  if (disk !== text) { console.error('report-extras: ' + OUT + ' differs from the receipts'); process.exit(1); }
  console.log('report-extras: ' + OUT + ' matches');
} else {
  writeFileSync(OUT, text);
  const s = out.spend;
  console.log('spend: counted $' + s.counted_total_usd + ', smoke $' + s.smoke_total_usd + ', launch $' + s.launch_total_usd + '; first launch and measurement $' + s.first_launch_and_measurement_total_usd + ' (open $' + s.first_launch_and_measurement_open_usd + '); paid $' + s.paid_total_usd + '; trial records $' + s.trial_records_usd);
  console.log('vms: launch $' + out.vms.launch_usd + ', first launch and measurement $' + out.vms.first_launch_and_measurement_usd + ', total $' + out.vms.total_usd);
  for (const [c, v] of Object.entries(perCell)) console.log(c + ' followed ' + followed[c].k + '/' + followed[c].n + ' [' + followed[c].ci95 + '] scorer-match ' + followed[c].matches_scorer + '; $/turn ' + v.usd_per_turn + ' x control ' + v.usd_per_turn_over_control);
  for (const [l, v] of Object.entries(crossRun)) console.log(l + ' ' + JSON.stringify(v));
}
