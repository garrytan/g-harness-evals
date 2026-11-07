#!/usr/bin/env bun
// Builds the joint-cut run's preregistration files from committed inputs, keyless:
//
//   bun docs/benchmarks/2026-11-06-prompt-archaeology-joint/build-prereg.ts [--check]
//
// Inputs: the prompt-archaeology run's prereg.json (each arm's layer map, map sha256, layers, per-turn ceiling, network and
// housekeeping models, copied from its launch 3 cells), its results/trials.jsonl (cost and wall time per turn, and the pass
// spreads the MDD plans from), its calibration/projection.json (the per-call reservations), harnesses/ablation/manifest.json
// and harnesses/*/pin.json (checked against launch 3), and tasks/multiuser/v0.4/dev (the 40 primary-family tasks at L2 and L3).
//
// Outputs, beside this script: prereg-probe.json (run prompt-archaeology-joint-probe-2026-11), prereg.json (run
// prompt-archaeology-joint-2026-11), lease-plan.json, budget.json, mdd.json, mdd.md, and the generated blocks of
// PREREGISTRATION.md (between <!-- build-prereg:NAME --> and <!-- /build-prereg:NAME -->). No cell is written by hand.
// With --check it writes nothing and exits 1 when any output differs from what is on disk.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../../../runner/contracts.ts';
import type { Cell, Prereg } from '../../../runner/run.ts';
import { loadTask, taskFamily } from '../../../runner/grade/task.ts';
import { normalQuantile } from '../../../runner/stats/paired.ts';
import { familyPooledMdd, LAYERS, mapLayers } from '../../../scripts/prompt-archaeology/tables.ts';

const DIR = 'docs/benchmarks/2026-11-06-prompt-archaeology-joint';
const PA = 'docs/benchmarks/2026-11-01-prompt-archaeology';
const TASKS_DIR = 'tasks/multiuser/v0.4/dev';
const V03_DIR = 'tasks/multiuser/v0.3/dev';
const PROBE_RUN = 'prompt-archaeology-joint-probe-2026-11';
const MAIN_RUN = 'prompt-archaeology-joint-2026-11';
const FAMILIES: Record<string, string> = { cr: 'corrections', ar: 'approval_relay', er: 'expired_recall', ms: 'memory_scope', ss: 'session_synthesis' };
const LEVELS = ['l2', 'l3'];
const PROBE_REPS = 1;
const MAIN_REPS = 4;
const VALIDITY_AR = 'ar-05-l2-brackenwater-rate-hollis';
const LAUNCH3_PINS: Record<string, string> = { 'claude-code': '2.1.312', openclaw: '2026.10.6', codex: '0.165.0' };
const LEASE_FACTOR = 1.4;
const SMOKE_LEASE = 6;
const VM_USD_PER_MIN = 0.00831 + 0.00006944;
const VM_SETUP_HOURS = 0.5;
const ALPHA = 0.05;
const POWER = 0.8;
const HOLM_PAIRS = 4;
const R71 = { ceiling_usd: 2000, spent_usd: 1133.03, since: '2026-11-03T13:30Z', lane_cap_usd: 500 };
const OWN_USE = { expected_usd: 120, bound_usd: 150 };
const VM_BOUND = 25;
const MAIN_BOUND = 245;
const check = process.argv.includes('--check');

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const round = (x: number, d = 4) => Number(x.toFixed(d));
const ceilHalf = (x: number) => Math.ceil(x * 2) / 2;
const usd = (x: number) => '$' + x.toFixed(2);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const pct = (x: number) => Math.round(100 * x) + '%';
const BT = String.fromCharCode(96);
const code = (s: string) => BT + s + BT;

if (!existsSync('runner/run.ts')) throw new Error('run from the repository root');

// Tasks: the five primary families at L2 and L3, four per family and level, family and level read from the task name.
const v04 = readdirSync(TASKS_DIR).filter((t) => existsSync(join(TASKS_DIR, t, 'task.toml'))).sort();
const tasksOf = (fam: string, lvl: string) => v04.filter((t) => t.startsWith(fam + '-') && t.split('-')[2] === lvl);
for (const fam of Object.keys(FAMILIES)) for (const lvl of LEVELS) {
  const ts = tasksOf(fam, lvl);
  if (ts.length !== 4) throw new Error(fam + ' ' + lvl + ': expected 4 v0.4 dev tasks, found ' + ts.length);
  for (const t of ts) if (taskFamily(join(TASKS_DIR, t)) !== FAMILIES[fam]) throw new Error(t + ' is not in family ' + FAMILIES[fam]);
}
const turnsOf = (t: string) => loadTask(join(TASKS_DIR, t)).turns.length;
if (!tasksOf('ar', 'l2').includes(VALIDITY_AR)) throw new Error(VALIDITY_AR + ' is not an approval relay L2 task');
const VALIDITY_TASKS = [VALIDITY_AR, tasksOf('er', 'l2')[0]!, tasksOf('ms', 'l2')[0]!];

// Arms. Each copies its map, map sha256, layers, ceiling, network and housekeeping models from the launch 3 cell it names; the
// joint arm keeps the full cell's map and binds exactly memory-skills and tool-descriptions.
interface ArmDef { group: string; harness: string; tag: 'opus' | 'sol'; arm: string; from: string; layers?: string[]; role: 'primary' | 'secondary' }
const ARMS: ArmDef[] = [
  { group: 'cc', harness: 'claude-code', tag: 'opus', arm: 'full', from: 'full', role: 'primary' },
  { group: 'cc', harness: 'claude-code', tag: 'opus', arm: 'joint', from: 'full', layers: LAYERS.filter((l) => l === 'memory-skills' || l === 'tool-descriptions'), role: 'primary' },
  { group: 'cc', harness: 'claude-code', tag: 'opus', arm: 'minimal', from: 'minimal', role: 'primary' },
  { group: 'oc', harness: 'openclaw', tag: 'opus', arm: 'full', from: 'full', role: 'primary' },
  { group: 'oc', harness: 'openclaw', tag: 'opus', arm: 'minimal', from: 'minimal', role: 'primary' },
  { group: 'cx', harness: 'codex', tag: 'sol', arm: 'full', from: 'full', role: 'primary' },
  { group: 'cx', harness: 'codex', tag: 'sol', arm: 'no-identity', from: 'no-identity', role: 'primary' },
  { group: 'ocs', harness: 'openclaw', tag: 'sol', arm: 'full', from: 'full', role: 'secondary' },
  { group: 'ocs', harness: 'openclaw', tag: 'sol', arm: 'minimal', from: 'minimal', role: 'secondary' },
];
interface PairDef { id: string; group: string; cut: string; role: 'primary' | 'secondary'; spread: string[] }
const PAIRS: PairDef[] = [
  { id: 'P1', group: 'cc', cut: 'joint', role: 'primary', spread: ['no-tool-descriptions', 'no-memory-skills'] },
  { id: 'P2', group: 'cc', cut: 'minimal', role: 'primary', spread: ['minimal'] },
  { id: 'P3', group: 'oc', cut: 'minimal', role: 'primary', spread: ['minimal'] },
  { id: 'P4', group: 'cx', cut: 'no-identity', role: 'primary', spread: ['no-identity'] },
  { id: 'P5', group: 'ocs', cut: 'minimal', role: 'secondary', spread: ['minimal'] },
];
const armOf = (group: string, arm: string) => ARMS.find((a) => a.group === group && a.arm === arm)!;
const v03Id = (a: { harness: string; tag: string }, arm: string) => a.harness + '-' + a.tag + '-' + arm + '-mu-v03-dev';

const paPrereg = json(join(PA, 'prereg.json')) as Prereg;
const paCell = (id: string) => {
  const c = paPrereg.cells.find((x) => x.id === id);
  if (!c?.ablation) throw new Error('no launch 3 cell ' + id + ' with an ablation in ' + PA + '/prereg.json');
  return c;
};
const manifest = json('harnesses/ablation/manifest.json') as { maps: { file: string; harness: string; wire: string; model: string; sha256: string }[] };
for (const [h, v] of Object.entries(LAUNCH3_PINS)) {
  const pin = json(join('harnesses', h, 'pin.json')) as { version: string };
  if (pin.version !== v) throw new Error(h + ' is pinned at ' + pin.version + ' on this tree, not launch 3\'s ' + v + '; the maps would not match');
}
const maps = new Map<string, { path: string; sha256: string; harness: string; wire: string; model: string; layers: string[] }>();
for (const a of ARMS) {
  const src = paCell(v03Id(a, a.from)).ablation!;
  const m = manifest.maps.find((x) => 'harnesses/ablation/' + x.file === src.map);
  if (!m || m.sha256 !== src.map_sha256) throw new Error(src.map + ': launch 3 bound sha256 ' + src.map_sha256 + ', the manifest says ' + (m?.sha256 ?? 'nothing'));
  const layers = mapLayers(src.map, process.cwd(), src.map_sha256);
  const missing = (a.layers ?? []).filter((l) => !layers.includes(l));
  if (missing.length) throw new Error(a.harness + ' ' + a.arm + ': ' + missing.join(', ') + ' not in ' + src.map);
  maps.set(src.map, { path: src.map, sha256: m.sha256, harness: m.harness, wire: m.wire, model: m.model, layers });
}

const cellFor = (a: ArmDef, id: string, tasks: string[], reps: number): Cell => {
  const src = paCell(v03Id(a, a.from));
  return {
    id, harness: src.harness, model: src.model, slice: 'multiuser', split: 'dev', task_set: 'v0.4', tasks, repetitions: reps, ceiling: src.ceiling,
    ...(src.network ? { network: src.network } : {}), ...(src.utility_models ? { utility_models: src.utility_models } : {}),
    ablation: { map: src.ablation!.map, map_sha256: src.ablation!.map_sha256, layers: a.layers ?? src.ablation!.layers },
  };
};
const mainId = (a: ArmDef, fam: string, lvl: string) => a.harness + '-' + a.tag + '-' + a.arm + '-v04-' + fam + '-' + lvl;
const validityId = (a: ArmDef) => a.harness + '-' + a.tag + '-' + a.arm + '-v04-validity';
const familyCells = (a: ArmDef, reps: number) => Object.keys(FAMILIES).flatMap((fam) => LEVELS.map((lvl) => cellFor(a, mainId(a, fam, lvl), tasksOf(fam, lvl), reps)));
const VALIDITY_ARMS = PAIRS.filter((p) => p.role === 'primary').map((p) => armOf(p.group, p.cut));
const mainCells = ARMS.flatMap((a) => familyCells(a, MAIN_REPS));
const probeFull = ['cc', 'oc', 'cx'].map((g) => armOf(g, 'full'));
const probeCells = [...probeFull.flatMap((a) => familyCells(a, PROBE_REPS)), ...VALIDITY_ARMS.map((a) => cellFor(a, validityId(a), VALIDITY_TASKS, PROBE_REPS))];
const armByCell = new Map<string, ArmDef>([...ARMS.flatMap((a) => familyCells(a, 1).map((c) => [c.id, a] as const)), ...VALIDITY_ARMS.map((a) => [validityId(a), a] as const)]);
const cellTurns = (c: Cell) => sum(c.tasks!.map(turnsOf)) * c.repetitions;

// Launch 3 receipts: cost and wall time per turn of every cell an arm is priced from (the joint arm at its full cell, an
// upper bound, since no launch 3 cell removed exactly those two layers), and the pass spreads.
const paTrials = readFileSync(join(PA, 'results/trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as TrialRecord);
const rowsOf = (id: string) => {
  const rows = paTrials.filter((t) => t.cell === id);
  if (rows.length !== 40) throw new Error(id + ': expected 40 launch 3 trials, found ' + rows.length);
  return rows;
};
const turnsRun = (t: TrialRecord) => (t.turns as unknown as { run: number }).run;
const basis = (a: ArmDef) => {
  const id = v03Id(a, a.from);
  const rows = rowsOf(id);
  const turns = sum(rows.map(turnsRun));
  return { cell: id, trials: rows.length, turns, usd_per_turn: sum(rows.map((t) => t.usage?.usd ?? 0)) / turns, wall_s_per_turn: sum(rows.map((t) => t.wall_ms ?? 0)) / 1000 / turns };
};
const bases = new Map(ARMS.map((a) => [a.group + '/' + a.arm, basis(a)]));
const basisOf = (a: ArmDef) => bases.get(a.group + '/' + a.arm)!;
const projection = json(join(PA, 'calibration/projection.json')) as { reservation_opus: number; reservation_sol: number };
const reservationOf = (model: string) => (model.startsWith('openai:') ? projection.reservation_sol : projection.reservation_opus);
const cellUsd = (c: Cell) => cellTurns(c) * basisOf(armByCell.get(c.id)!).usd_per_turn;
const cellHours = (c: Cell) => (cellTurns(c) * basisOf(armByCell.get(c.id)!).wall_s_per_turn) / 3600;
const shardOf = (name: string, cells: Cell[]) => {
  const projected = sum(cells.map(cellUsd));
  const res = Math.max(...cells.map((c) => reservationOf(c.model)));
  return {
    name, cells: cells.map((c) => c.id), trials: sum(cells.map((c) => c.tasks!.length * c.repetitions)), turns: sum(cells.map(cellTurns)),
    projected_usd: round(projected), reservation_usd: res, lease_usd: ceilHalf(projected * LEASE_FACTOR + res), trial_hours_est: round(sum(cells.map(cellHours)), 2),
  };
};

// Probe: one shard per harness, its ten full cells and then its validity cells.
const probeShards = probeFull.map((a) => shardOf('probe-' + a.group, probeCells.filter((c) => armByCell.get(c.id)!.group === a.group)));
const probeCap = sum(probeShards.map((s) => s.lease_usd));
const probeProjected = sum(probeShards.map((s) => s.projected_usd));

// Main: one shard per (harness, arm); decision.json picks one level per family, so a shard holds at most five cells. The
// planning figures put every family at L2, then every family at L3 (the worst case). The binding leases come after the gate.
const mainPlan = ARMS.map((a) => {
  const at = (lvl: string) => shardOf(a.group + '-' + a.arm, Object.keys(FAMILIES).map((fam) => cellFor(a, mainId(a, fam, lvl), tasksOf(fam, lvl), MAIN_REPS)));
  const l2 = at('l2'), l3 = at('l3');
  return {
    name: a.group + '-' + a.arm, role: a.role, pair: PAIRS.filter((p) => p.group === a.group && (p.cut === a.arm || a.arm === 'full')).map((p) => p.id),
    candidate_cells: familyCells(a, MAIN_REPS).map((c) => c.id), smoke: a.role === 'secondary',
    all_l2: { trials: l2.trials, projected_usd: l2.projected_usd, lease_usd: l2.lease_usd, trial_hours_est: l2.trial_hours_est },
    all_l3: { trials: l3.trials, projected_usd: l3.projected_usd, lease_usd: l3.lease_usd, trial_hours_est: l3.trial_hours_est },
  };
});
type Lvl = 'all_l2' | 'all_l3';
type MainShard = (typeof mainPlan)[number];
const leaseSum = (lvl: Lvl, keep: (s: MainShard) => boolean) => sum(mainPlan.filter(keep).map((s) => s[lvl].lease_usd + (s.smoke ? SMOKE_LEASE : 0)));
const projSum = (lvl: Lvl, keep: (s: MainShard) => boolean) => sum(mainPlan.filter(keep).map((s) => s[lvl].projected_usd));
const primary = (s: MainShard) => s.role === 'primary';
const capOrder = (lvl: Lvl) => {
  const prim = leaseSum(lvl, primary);
  const withP5 = leaseSum(lvl, () => true);
  const noP4 = leaseSum(lvl, (s) => primary(s) && !s.name.startsWith('cx-'));
  const outcome = withP5 <= MAIN_BOUND ? 'all four primary pairs and the OpenClaw Sol pair fit'
    : prim <= MAIN_BOUND ? 'the four primary pairs fit; the OpenClaw Sol pair does not run'
    : noP4 <= MAIN_BOUND ? 'the primary pairs do not fit; the Codex identity pair drops and P1 to P3 run'
    : 'P1 to P3 do not fit at 80 trials per cell; no main run, report with the MDD';
  return { primary_leases_usd: round(prim, 2), with_openclaw_sol_usd: round(withP5, 2), without_codex_identity_usd: round(noP4, 2), primary_projected_usd: round(projSum(lvl, primary), 2), outcome };
};
const capL2 = capOrder('all_l2');
const capL3 = capOrder('all_l3');

// R71 money.
const remaining = round(R71.ceiling_usd - R71.spent_usd, 2);
const cap = Math.min(R71.lane_cap_usd, remaining);
const vmHours = (hours: number[]) => sum(hours.map((h) => h + VM_SETUP_HOURS));
const vmProbe = vmHours(probeShards.map((s) => s.trial_hours_est));
const vmMainL2 = vmHours(mainPlan.filter(primary).map((s) => s.all_l2.trial_hours_est));
const vmMainL3 = vmHours(mainPlan.filter(primary).map((s) => s.all_l3.trial_hours_est));
const vmUsd = (h: number) => round(h * 60 * VM_USD_PER_MIN, 2);
const reserve = round(cap - OWN_USE.bound_usd - VM_BOUND - probeCap - MAIN_BOUND, 2);
if (reserve < 0) throw new Error('the bounds pass the $' + cap + ' cap by ' + usd(-reserve));
const budget = {
  eval: 'prompt-archaeology-2026-11 (R71 ceiling $2,000 all-in, counted from ' + R71.since + ')',
  r71: { ceiling_usd: R71.ceiling_usd, spent_usd: R71.spent_usd, remaining_usd: remaining, lane_cap_usd: R71.lane_cap_usd, cap_usd: cap, rule: 'cap = min($500, $2,000 minus the tally); all-in: paid model calls, judges, Ubicloud VMs and the thread and subagents\' own model use; a cap stop is final' },
  items: {
    own_model_use: { ...OWN_USE },
    ubicloud_vms: { expected_usd: round(vmUsd(vmProbe) + vmUsd(vmMainL2), 2), expected_all_l3_usd: round(vmUsd(vmProbe) + vmUsd(vmMainL3), 2), bound_usd: VM_BOUND },
    probe: { projected_usd: round(probeProjected, 2), bound_usd: probeCap, basis: 'the sum of the probe shard leases, the spend cap in prereg-probe.json; no smoke leases' },
    main: { projected_all_l2_usd: capL2.primary_projected_usd, projected_all_l3_usd: capL3.primary_projected_usd, bound_usd: MAIN_BOUND, basis: 'the spend cap in prereg.json: every main shard lease plus any smoke lease, sized after the gate' },
    reserve_usd: reserve,
  },
  total_bound_usd: round(OWN_USE.bound_usd + VM_BOUND + probeCap + MAIN_BOUND + reserve, 2),
  cap_order_planning: { all_l2: capL2, all_l3: capL3, note: 'planning only, from launch 3 costs per turn; the binding check uses the probe\'s measured costs per turn after the gate' },
  vm_hours_est: { probe: round(vmProbe, 1), main_all_l2: round(vmMainL2, 1), main_all_l3: round(vmMainL3, 1) },
  vm_basis: 'launch 3 wall time per turn of the cell each arm is priced from, times the v0.4 turns, plus ' + VM_SETUP_HOURS + ' hour per VM for bootstrap, image builds, the golden check and the clean-arm preflight, at $' + VM_USD_PER_MIN.toFixed(8) + ' a minute (the list rate the earlier run budgeted); primary main shards only',
};

// MDD: the earlier run's paired method (scripts/prompt-archaeology/tables.ts familyPooledMdd: each task at its family's pooled
// pass rate, a paired difference of variance 2p(1-p) per trial, the task-clustered error), with the per-trial spread taken
// from launch 3's full and cut cells of each pair, projected to this design and taken at the Holm-adjusted alpha for 4 pairs.
const v03Tasks = readdirSync(V03_DIR).filter((t) => existsSync(join(V03_DIR, t, 'task.toml'))).sort();
const v03Family = (t: string) => taskFamily(join(V03_DIR, t));
const z = (alpha: number) => normalQuantile(1 - alpha / 2) + normalQuantile(POWER);
const se = (d: number, tasks: number, reps: number) => Math.sqrt((tasks / (tasks - 1)) * (d / (tasks * reps)));
const erf = (x: number) => {
  const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x));
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
};
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const pClear = (d: number, tasks: number, reps: number) => phi(0.1 / se(d, tasks, reps) - normalQuantile(1 - ALPHA / 2));
const HOLM_ALPHA = ALPHA / HOLM_PAIRS;
const DESIGNS = [{ tasks: 20, label: 'five families in' }, { tasks: 12, label: 'three families in, the gate minimum' }];
const scoredRow = (t: TrialRecord) => !['model_error', 'infra_error', 'exam_fault'].includes(t.termination);
const passRow = (t: TrialRecord) => (t.grade === 'pass' && !t.consent_violation ? 1 : 0);
const pairKey = (t: TrialRecord) => t.task + '/' + t.trial_id.split('/').at(-1);
const project = (d: number) => DESIGNS.map((g) => ({
  tasks: g.tasks, reps: MAIN_REPS, trials_per_cell: g.tasks * MAIN_REPS, label: g.label,
  mdd_points_holm: round(100 * z(HOLM_ALPHA) * se(d, g.tasks, MAIN_REPS), 1), mdd_points_alpha05: round(100 * z(ALPHA) * se(d, g.tasks, MAIN_REPS), 1),
  p_pass_lb_above_minus10_true_delta_0: round(pClear(d, g.tasks, MAIN_REPS), 2),
}));
const mddPairs = PAIRS.map((p) => {
  const g = armOf(p.group, 'full');
  const full = rowsOf(v03Id(g, 'full'));
  const cuts = p.spread.map((arm) => rowsOf(v03Id(g, arm)));
  const m = familyPooledMdd(v03Tasks, 2, v03Family, [...full, ...cuts.flat()]);
  const d = sum(v03Tasks.map((t) => { const r = m.family_rates[v03Family(t)]!.rate; return 2 * r * (1 - r); })) / v03Tasks.length;
  if (m.mdd === null || Math.abs(z(ALPHA) * se(d, v03Tasks.length, 2) - m.mdd) > 1e-12) throw new Error(p.id + ': the projection does not reproduce familyPooledMdd at the launch 3 design');
  const byKey = new Map(full.filter(scoredRow).map((t) => [pairKey(t), passRow(t)]));
  const paired = cuts.flat().filter(scoredRow).filter((t) => byKey.has(pairKey(t)));
  const discordant = paired.filter((t) => passRow(t) !== byKey.get(pairKey(t))).length;
  return {
    pair: p.id, role: p.role, harness: g.harness, model: paCell(v03Id(g, 'full')).model, cut: p.cut,
    spread_cells: [v03Id(g, 'full'), ...p.spread.map((arm) => v03Id(g, arm))],
    spread_per_trial: round(d), launch3_mdd_points_n40: round(100 * m.mdd, 1), launch3_discordant: discordant, launch3_paired: paired.length, launch3_discordant_share: round(discordant / paired.length),
    family_rates: Object.fromEntries(Object.entries(m.family_rates).sort().map(([f, x]) => [f, { passes: x.passes, n: x.n, rate: round(x.rate) }])),
    projected: project(d),
  };
});
const BOUND_SPREADS = [{ label: 'every task at 20 or 80 percent (the edge of the gate band)', spread_per_trial: 0.32 }, { label: 'every task at 50 percent (the widest a pass rate gets)', spread_per_trial: 0.5 }];
const mdd = {
  method: "scripts/prompt-archaeology/tables.ts familyPooledMdd, the earlier run's method: each task at its family's pooled pass rate, paired variance 2p(1-p) per trial, the task-clustered error sqrt(g/(g-1) x spread / n); power " + POWER + '; pass-rate points',
  planning_input: "launch 3 of prompt-archaeology-2026-11 (results/trials.jsonl): each pair's full cell pooled with its cut cell (P1: the two single-layer cells, memory-skills and tool-descriptions, since no launch 3 cell removed both), 20 v0.3 tasks x 2 repetitions per cell",
  alpha_holm: HOLM_ALPHA, alpha_holm_basis: 'Holm over the 4 primary pairs: the smallest p is tested at 0.05 / 4, the level a lone significant pair must meet',
  alpha_reference: ALPHA, p_clear_basis: 'chance that the 95 percent pass interval lower bound lies above -10 points when the true delta is 0, normal approximation',
  per_pair: mddPairs,
  bounds: BOUND_SPREADS.map((b) => ({ ...b, projected: project(b.spread_per_trial) })),
  recompute: 'Before the main stage the spread is recomputed from the probe (each family at its chosen level, the pooled full-cell rate of that harness) with the same formula, and written to the run log beside decision.json before any main shard starts.',
};

const QUESTION_MAIN = 'On the v0.4 multi-user dev tasks of the five primary families (corrections, approval relay, expired recall, memory scope, session synthesis), one level per family as the probe gate picks (L2 or L3, 4 tasks each), 4 repetitions, network internal, no gstack and no gbrain: does applying the prompt-archaeology cuts together still leave the pass rate where the full prompt has it, and what do they save in cost per trial? Pairs (cut minus full, paired by task and repetition, an arm pooled over its families): P1 Claude Code 2.1.312 on anthropic:claude-opus-5-5 with memory-skills and tool-descriptions removed together (joint); P2 the same with every removable layer removed (minimal); P3 OpenClaw 2026.10.6 on anthropic:claude-opus-5-5, minimal; P4 Codex 0.165.0 on openai:gpt-6.1-sol at reasoning effort medium, identity removed; P5 OpenClaw on openai:gpt-6.1-sol, minimal (secondary, descriptive, only if it fits the money). The metering proxy removes each layer by its committed map. Holm over P1 to P4. One R48 line per cut by the ordered verdict rule in PREREGISTRATION.md, labelled "on v0.4 multi-user dev tasks, at these pins". Only the cells decision.json names run.';
const QUESTION_PROBE = 'Uncounted headroom probe for prompt-archaeology-joint-2026-11: the full prompt of Claude Code 2.1.312 and OpenClaw 2026.10.6 on anthropic:claude-opus-5-5 and Codex 0.165.0 on openai:gpt-6.1-sol, once on each of the 40 primary-family v0.4 dev tasks at L2 and L3, gives the pass rates the gate in PREREGISTRATION.md reads to pick each family\'s level and each pair; the four primary cut arms run once on 3 fixed L2 tasks for treatment validity only, unscored for the gate. No probe row enters the main comparison.';
const probePrereg = { schema_version: 1, run_id: PROBE_RUN, question: QUESTION_PROBE, tasks: {}, cells: probeShards.flatMap((s) => s.cells).map((id) => probeCells.find((c) => c.id === id)!), wall_clock_s: { multiuser: 1500 }, spend_cap_usd: probeCap, drop_order: [], minimum_v01: [] };
const mainPrereg = {
  schema_version: 1, run_id: MAIN_RUN, question: QUESTION_MAIN, tasks: {}, cells: mainCells, wall_clock_s: { multiuser: 1500 }, spend_cap_usd: MAIN_BOUND,
  drop_order: [...familyCells(armOf('ocs', 'full'), MAIN_REPS), ...familyCells(armOf('ocs', 'minimal'), MAIN_REPS), ...familyCells(armOf('cx', 'full'), MAIN_REPS), ...familyCells(armOf('cx', 'no-identity'), MAIN_REPS)].map((c) => c.id),
  minimum_v01: [],
};
for (const p of [probePrereg, mainPrereg]) if (new Set(p.cells.map((c) => c.id)).size !== p.cells.length) throw new Error(p.run_id + ': duplicate cell id');
if (probePrereg.cells.length !== probeCells.length) throw new Error('every probe cell must sit in exactly one probe shard');

const leasePlan = {
  lease_rule: 'expected spend x ' + LEASE_FACTOR + ', plus one in-flight reservation per shard ($' + projection.reservation_opus + ' Opus, $' + projection.reservation_sol + ' Sol, the largest refused reservations in prompt-archaeology-2026-11 calibration/projection.json; Opus for a shard with any Opus cell), rounded up to $0.50',
  probe: {
    run_id: PROBE_RUN, size: 'standard-16', commit: '<the preregistration merge commit>', prereg: DIR + '/prereg-probe.json',
    options: ['--pre-smoke', 'scripts/prompt-archaeology/pre-smoke.sh', '--no-smoke'],
    expected_basis: 'launch 3 cost per turn of the cell each arm is priced from (the joint arm at its full cell) times the v0.4 turns of each cell',
    cost_per_turn_usd: Object.fromEntries([...bases.entries()].map(([k, b]) => [k, { cell: b.cell, usd_per_turn: round(b.usd_per_turn), wall_s_per_turn: round(b.wall_s_per_turn, 2) }])),
    shards: probeShards,
  },
  main: {
    run_id: MAIN_RUN, size: 'standard-16', commit: '<the preregistration merge commit>', prereg: DIR + '/prereg.json', bound_usd: MAIN_BOUND,
    options: ['--pre-smoke', 'scripts/prompt-archaeology/pre-smoke.sh', '--no-smoke'],
    secondary_options: ['--pre-smoke', 'scripts/prompt-archaeology/pre-smoke.sh', '--smoke-first-cell', '--smoke-lease-usd', String(SMOKE_LEASE)],
    rule: 'Sized after the gate, before any main shard starts. A shard holds the cells decision.json picks for its (harness, arm), in family order cr, ar, er, ms, ss. Expected spend = the probe\'s measured cost per turn of that harness\'s full cell (all its probe trials), times the turns of the picked cells x ' + MAIN_REPS + ' repetitions; a cut arm is priced as its full arm, and the OpenClaw Sol arms, which the probe does not run, at launch 3 cost per turn. Lease = expected x ' + LEASE_FACTOR + ' plus one reservation, rounded up to $0.50. The OpenClaw Sol shards also open a $' + SMOKE_LEASE + ' smoke lease each. Cap order: the OpenClaw Sol pair runs only with --with-secondary and only if every primary lease plus its own leases and smoke leases fit inside $' + MAIN_BOUND + '; if the primary leases alone do not fit, the Codex identity pair (both cx shards) drops first; if P1 to P3 still do not fit at 80 trials per cell, no main run starts and the report goes to the Captain with the MDD. No pair drops below 80 trials per cell and the lease factor never changes. The sized leases go into the run log before the canary starts.',
    canary: 'cc-full', ttl_rule: 'UBI_TTL_HOURS per VM = ceil(the probe\'s mean wall time per trial for that harness x the shard\'s trials / 3600 x 1.5) + 1',
    shards: mainPlan,
  },
};

const mapsBlock = ['| Map | Harness | Wire | Model | Removable layers | sha256 |', '|---|---|---|---|---:|---|',
  ...[...maps.values()].map((m) => '| ' + code(m.path) + ' | ' + m.harness + ' | ' + m.wire + ' | ' + m.model + ' | ' + m.layers.length + ' | ' + code(m.sha256) + ' |')].join('\n');
const armsBlock = ['| Arm | Model | Layers removed | Main cells | Role |', '|---|---|---|---:|---|',
  ...ARMS.map((a) => {
    const c = familyCells(a, MAIN_REPS)[0]!;
    return '| ' + code(a.harness + '-' + a.tag + '-' + a.arm) + ' | ' + code(c.model) + ' | ' + (c.ablation!.layers.join(', ') || 'none (the filter binds the map and removes nothing)') + ' | 10 | ' + a.role + ' |';
  })].join('\n');
const PINNED = ['harnesses/ablation/manifest.json', 'runner/proxy/ablate.ts', 'scripts/ablation-golden.sh', 'scripts/prompt-archaeology/pre-smoke.sh', 'scripts/prompt-archaeology/clean-arm-audit.ts', 'scripts/prompt-archaeology/tables.ts', 'scripts/prompt-archaeology/joint-gate.ts', 'scripts/prompt-archaeology/joint-tables.ts'];
const pinned = PINNED.filter((f) => existsSync(f));
for (const f of PINNED.filter((x) => !pinned.includes(x))) console.error('build-prereg: ' + f + ' is not on this tree yet; rerun this script once it lands so the pins table carries it');
const pinsBlock = ['| File | sha256 at build time |', '|---|---|', ...pinned.map((f) => '| ' + code(f) + ' | ' + code(createHash('sha256').update(readFileSync(f)).digest('hex')) + ' |')].join('\n');
const probeBlock = ['| Shard | Cells | Trials | Turns | Projected | Lease | Trial hours (est.) |', '|---|---|---:|---:|---:|---:|---:|',
  ...probeShards.map((s) => '| ' + code(s.name) + ' | ' + s.cells.length + ' (' + s.cells.filter((c) => !c.endsWith('-validity')).length + ' full, ' + s.cells.filter((c) => c.endsWith('-validity')).length + ' validity) | ' + s.trials + ' | ' + s.turns + ' | ' + usd(s.projected_usd) + ' | ' + usd(s.lease_usd) + ' | ' + s.trial_hours_est.toFixed(1) + ' |'),
  '| **All** | ' + probeCells.length + ' | ' + sum(probeShards.map((s) => s.trials)) + ' | ' + sum(probeShards.map((s) => s.turns)) + ' | ' + usd(probeProjected) + ' | **' + usd(probeCap) + '** | ' + sum(probeShards.map((s) => s.trial_hours_est)).toFixed(1) + ' |'].join('\n');
const mainBlock = ['| Shard | Pairs | Role | All L2: projected / lease | All L3: projected / lease | Trial hours, L2 to L3 (est.) |', '|---|---|---|---:|---:|---:|',
  ...mainPlan.map((s) => '| ' + code(s.name) + ' | ' + s.pair.join(', ') + ' | ' + s.role + ' | ' + usd(s.all_l2.projected_usd) + ' / ' + usd(s.all_l2.lease_usd) + ' | ' + usd(s.all_l3.projected_usd) + ' / ' + usd(s.all_l3.lease_usd) + ' | ' + s.all_l2.trial_hours_est.toFixed(1) + ' to ' + s.all_l3.trial_hours_est.toFixed(1) + ' |'),
  '| **Primary shards** | P1 to P4 | | ' + usd(capL2.primary_projected_usd) + ' / ' + usd(capL2.primary_leases_usd) + ' | ' + usd(capL3.primary_projected_usd) + ' / ' + usd(capL3.primary_leases_usd) + ' | |',
  '', '- **All L2, planning:** ' + capL2.outcome + ' (primary leases ' + usd(capL2.primary_leases_usd) + ', with OpenClaw Sol and its smoke leases ' + usd(capL2.with_openclaw_sol_usd) + ', without Codex identity ' + usd(capL2.without_codex_identity_usd) + ', against $' + MAIN_BOUND + ').',
  '- **All L3, planning:** ' + capL3.outcome + ' (primary leases ' + usd(capL3.primary_leases_usd) + ', with OpenClaw Sol ' + usd(capL3.with_openclaw_sol_usd) + ', without Codex identity ' + usd(capL3.without_codex_identity_usd) + ').'].join('\n');
const it = budget.items;
const budgetBlock = ['| Item | Expected | Bound |', '|---|---:|---:|',
  '| Own model use (prereg PR and /ship, run operations, results PR and /ship, claim check, export rehearsal) | ' + usd(it.own_model_use.expected_usd) + ' | ' + usd(it.own_model_use.bound_usd) + ' |',
  '| Ubicloud VMs (' + budget.vm_hours_est.probe + ' probe VM-hours, ' + budget.vm_hours_est.main_all_l2 + ' to ' + budget.vm_hours_est.main_all_l3 + ' main) | ' + usd(it.ubicloud_vms.expected_usd) + ' to ' + usd(it.ubicloud_vms.expected_all_l3_usd) + ' | ' + usd(it.ubicloud_vms.bound_usd) + ' |',
  '| Probe (' + probeShards.length + ' shard leases, the cap in prereg-probe.json) | ' + usd(it.probe.projected_usd) + ' | ' + usd(it.probe.bound_usd) + ' |',
  '| Main, 7 primary cells x 80 trials (all L2 to all L3), the cap in prereg.json | ' + usd(it.main.projected_all_l2_usd) + ' to ' + usd(it.main.projected_all_l3_usd) + ' | ' + usd(it.main.bound_usd) + ' |',
  '| Reserve | | ' + usd(it.reserve_usd) + ' |',
  '| **Total** | **' + usd(it.own_model_use.expected_usd + it.ubicloud_vms.expected_usd + it.probe.projected_usd + it.main.projected_all_l2_usd) + ' to ' + usd(it.own_model_use.expected_usd + it.ubicloud_vms.expected_all_l3_usd + it.probe.projected_usd + it.main.projected_all_l3_usd) + '** | **' + usd(budget.total_bound_usd) + '** |'].join('\n');
const pairLabel = (p: (typeof mddPairs)[number]) => p.pair + ' ' + p.harness + ' ' + p.cut + (p.role === 'secondary' ? ' (descriptive)' : '');
const mddBlock = ['| Pair | Launch 3 spread per trial | Launch 3 discordant pairs | MDD, 20 tasks x 4, Holm alpha 0.0125 | MDD, 12 tasks x 4, Holm alpha 0.0125 | MDD, 20 tasks x 4, alpha 0.05 | Chance a zero-effect cut clears -10 (20 / 12 tasks) |', '|---|---:|---:|---:|---:|---:|---:|',
  ...mddPairs.map((p) => '| ' + pairLabel(p) + ' | ' + p.spread_per_trial.toFixed(3) + ' | ' + p.launch3_discordant + ' of ' + p.launch3_paired + ' | ' + p.projected[0]!.mdd_points_holm.toFixed(1) + ' | ' + p.projected[1]!.mdd_points_holm.toFixed(1) + ' | ' + p.projected[0]!.mdd_points_alpha05.toFixed(1) + ' | ' + pct(p.projected[0]!.p_pass_lb_above_minus10_true_delta_0) + ' / ' + pct(p.projected[1]!.p_pass_lb_above_minus10_true_delta_0) + ' |'),
  ...mdd.bounds.map((b) => '| Bound: ' + b.label + ' | ' + b.spread_per_trial.toFixed(3) + ' | | ' + b.projected[0]!.mdd_points_holm.toFixed(1) + ' | ' + b.projected[1]!.mdd_points_holm.toFixed(1) + ' | ' + b.projected[0]!.mdd_points_alpha05.toFixed(1) + ' | ' + pct(b.projected[0]!.p_pass_lb_above_minus10_true_delta_0) + ' / ' + pct(b.projected[1]!.p_pass_lb_above_minus10_true_delta_0) + ' |')].join('\n');
const famCell = (r: Record<string, { passes: number; n: number }>, f: string) => (r[f] ? r[f]!.passes + '/' + r[f]!.n : '-');
const fams = [...new Set(mddPairs.flatMap((p) => Object.keys(p.family_rates)))].sort();
const mddMd = [
  '# Minimum detectable differences, prompt-archaeology-joint-2026-11 (planning)', '',
  'Generated by [build-prereg.ts](build-prereg.ts) from launch 3 of prompt-archaeology-2026-11 ([results/trials.jsonl](../2026-11-01-prompt-archaeology/results/trials.jsonl)).', '',
  '- **Method:** ' + mdd.method + '. It is the arithmetic of [the earlier run\'s mdd.md](../2026-11-01-prompt-archaeology/mdd.md), and the build checks that it reproduces ' + code('familyPooledMdd') + ' at that run\'s own design.',
  '- **Planning input:** ' + mdd.planning_input + '. The spread per trial is the mean over tasks of 2p(1-p).',
  '- **Alpha:** ' + mdd.alpha_holm_basis + '. The alpha 0.05 column is the last Holm step, for reference.',
  '- **Design:** 4 repetitions; 20 tasks when all five families are in, 12 when the gate keeps the minimum of three.',
  '- **Chance a zero-effect cut clears -10:** ' + mdd.p_clear_basis + '. That is the chance a truly harmless cut earns the confirmed CUT-CANDIDATE line.',
  '- **Caveat:** v0.3 sat near the ceiling, so its spread is small. The gate keeps only pairs whose full arm is between 20 and 80 percent, which means more spread on v0.4. The two bound rows show what that does.',
  '- **Recompute:** ' + mdd.recompute, '',
  mddBlock, '',
  '## Family pass counts behind each spread (launch 3, full and cut cells pooled)', '',
  '| Family | ' + mddPairs.map((p) => p.pair).join(' | ') + ' |', '|---|' + mddPairs.map(() => '---:|').join(''),
  ...fams.map((f) => '| ' + f + ' | ' + mddPairs.map((p) => famCell(p.family_rates, f)).join(' | ') + ' |'),
  '',
].join('\n');

const outputs: Record<string, string> = {
  [join(DIR, 'prereg-probe.json')]: JSON.stringify(probePrereg, null, 2) + '\n',
  [join(DIR, 'prereg.json')]: JSON.stringify(mainPrereg, null, 2) + '\n',
  [join(DIR, 'lease-plan.json')]: JSON.stringify(leasePlan, null, 2) + '\n',
  [join(DIR, 'budget.json')]: JSON.stringify(budget, null, 2) + '\n',
  [join(DIR, 'mdd.json')]: JSON.stringify(mdd, null, 2) + '\n',
  [join(DIR, 'mdd.md')]: mddMd,
};
const mdPath = join(DIR, 'PREREGISTRATION.md');
let md = readFileSync(mdPath, 'utf8');
for (const [name, body] of Object.entries({ arms: armsBlock, maps: mapsBlock, pins: pinsBlock, probe: probeBlock, main: mainBlock, budget: budgetBlock, mdd: mddBlock })) {
  const open = '<!-- build-prereg:' + name + ' -->\n', close = '\n<!-- /build-prereg:' + name + ' -->';
  const i = md.indexOf(open), j = md.indexOf(close);
  if (i < 0 || j < i) throw new Error('PREREGISTRATION.md has no build-prereg:' + name + ' block');
  md = md.slice(0, i + open.length) + body + md.slice(j);
}
outputs[mdPath] = md;

let stale = 0;
for (const [path, text] of Object.entries(outputs)) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
  if (check) { stale++; console.error('build-prereg: ' + path + ' is stale'); } else writeFileSync(path, text);
}
console.log('build-prereg: probe ' + probeCells.length + ' cells, ' + sum(probeShards.map((s) => s.trials)) + ' trials, cap ' + usd(probeCap) + '; main ' + mainCells.length + ' cells preregistered, bound ' + usd(MAIN_BOUND) + '; reserve ' + usd(reserve) + ' of the ' + usd(cap) + ' cap' + (check ? ', ' + stale + ' stale' : ''));
process.exit(stale ? 1 : 0);
