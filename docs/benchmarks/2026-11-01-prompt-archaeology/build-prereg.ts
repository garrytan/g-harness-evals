#!/usr/bin/env bun
// Builds prompt-archaeology-2026-11's preregistration files from committed inputs, keyless:
//
//   bun docs/benchmarks/2026-11-01-prompt-archaeology/build-prereg.ts [--check]
//
// Inputs: harnesses/ablation/manifest.json (each map's sha256, read at build time), the layer maps themselves (which
// removable layers each one has), tasks/multiuser/v0.3/dev (the 20 public dev tasks and their families), and the
// calibration receipts copied under calibration/ (trials.jsonl, projection.json, design-options.json,
// calibration-analysis.json, lane-spend-line.jsonl).
//
// Outputs, beside this script: prereg.json, lease-plan.json, budget.json, mdd.json, mdd.md, calibration/task-rule.json,
// and the generated blocks of PREREGISTRATION.md (between <!-- build-prereg:NAME --> and <!-- /build-prereg:NAME -->).
// With --check it writes nothing and exits 1 when any output differs from what is on disk.
//
// Rerun it whenever a map changes (the Hermes maps are expected to change with the pending Hermes memory fix): every map
// sha256 in prereg.json and PREREGISTRATION.md then follows harnesses/ablation/manifest.json.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { familyPooledMdd, LAYERS } from '../../../scripts/prompt-archaeology/tables.ts';
import { taskFamily } from '../../../runner/grade/task.ts';

const DIR = 'docs/benchmarks/2026-11-01-prompt-archaeology';
const CAL = join(DIR, 'calibration');
const TASKS_DIR = 'tasks/multiuser/v0.3/dev';
const RUN_ID = 'prompt-archaeology-2026-11';
const LANE_CAP = 600;
const REPS = 2;
const LEASE_FACTOR = 1.25;
const SMOKE_LEASE = 6;
const VM_USD_PER_MIN = 0.00831 + 0.00006944;
const OPUS = 'anthropic:claude-opus-5-5';
const SOL = 'openai:gpt-6.1-sol';
const HOUSEKEEPING = ['anthropic:claude-haiku-5-5'];
const check = process.argv.includes('--check');

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const round = (x: number, d = 4) => Number(x.toFixed(d));
const ceilHalf = (x: number) => Math.ceil(x * 2) / 2;
const usd = (x: number) => '$' + x.toFixed(2);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

if (!existsSync('runner/run.ts')) throw new Error('run from the repository root');

const tasks = readdirSync(TASKS_DIR).filter((t) => existsSync(join(TASKS_DIR, t, 'task.toml'))).sort();
if (tasks.length !== 20) throw new Error('expected the 20 public v0.3 dev tasks, found ' + tasks.length);
const familyOf = (task: string) => taskFamily(join(TASKS_DIR, task));

const manifest = json('harnesses/ablation/manifest.json') as { maps: { file: string; harness: string; wire: string; model: string; sha256: string }[] };
const mapFor = (harness: string, wire: string) => {
  const m = manifest.maps.find((x) => x.harness === harness && x.wire === wire);
  if (!m) throw new Error('no map for ' + harness + ' over ' + wire + ' in harnesses/ablation/manifest.json');
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'layer' && typeof x === 'string') found.add(x); walk(x); }
  };
  walk(json(join('harnesses/ablation', m.file)));
  return { ...m, path: 'harnesses/ablation/' + m.file, layers: LAYERS.filter((l) => found.has(l)) as string[] };
};

interface Pair { key: string; harness: string; tag: 'opus' | 'sol'; model: string; wire: string; utility?: string[]; grid: boolean; official: boolean }
const PAIRS: Pair[] = [
  { key: 'cc', harness: 'claude-code', tag: 'opus', model: OPUS, wire: 'anthropic-messages', grid: true, official: true },
  { key: 'oc', harness: 'openclaw', tag: 'opus', model: OPUS, wire: 'anthropic-messages', utility: HOUSEKEEPING, grid: true, official: false },
  { key: 'he', harness: 'hermes', tag: 'opus', model: OPUS, wire: 'anthropic-messages', grid: true, official: false },
  { key: 'cx', harness: 'codex', tag: 'sol', model: SOL, wire: 'openai-responses', grid: true, official: true },
  { key: 'oc-sol', harness: 'openclaw', tag: 'sol', model: SOL, wire: 'openai-responses', grid: false, official: false },
  { key: 'he-sol', harness: 'hermes', tag: 'sol', model: SOL, wire: 'openai-responses', grid: false, official: false },
];

type Kind = 'full' | 'minimal' | 'layer' | 'official-minimal';
interface Arm { pair: Pair; arm: string; kind: Kind; layers: string[]; cell: Record<string, unknown> }
const arms: Arm[] = [];
const maps: Record<string, ReturnType<typeof mapFor>> = {};
for (const p of PAIRS) {
  const map = (maps[p.harness + '.' + p.wire] ??= mapFor(p.harness, p.wire));
  const base = (arm: string) => ({
    id: p.harness + '-' + p.tag + '-' + arm + '-mu-v03-dev', harness: p.harness, model: p.model, slice: 'multiuser', split: 'dev', task_set: 'v0.3', tasks,
    repetitions: REPS, ceiling: { input_tokens: 80000, output_tokens: 6000 }, network: 'internal', ...(p.utility ? { utility_models: p.utility } : {}),
  });
  const ablated = (arm: string, kind: Kind, layers: string[]) =>
    arms.push({ pair: p, arm, kind, layers, cell: { ...base(arm), ablation: { map: map.path, map_sha256: map.sha256, layers } } });
  ablated('full', 'full', []);
  ablated('minimal', 'minimal', map.layers);
  if (p.grid) for (const l of map.layers) ablated('no-' + l, 'layer', [l]);
  if (p.official) arms.push({ pair: p, arm: 'official-minimal', kind: 'official-minimal', layers: [], cell: { ...base('official-minimal'), config: 'official-minimal' } });
}
const idOf = (key: string, arm: string) => {
  const a = arms.find((x) => x.pair.key === key && x.arm === arm);
  if (!a) throw new Error('no cell ' + key + ' ' + arm);
  return a.cell.id as string;
};
const armOf = (id: string) => arms.find((a) => a.cell.id === id)!;

// Shards: whole cells, about three per standard-16 VM, one lease each. The Sol cross and official-minimal cells sit in
// their own shards, so the drop order removes whole shards and never touches a layer cell's shard.
const gridShards = (key: string, groups: string[][]) => groups.map((g, i) => ({ name: key + '-' + 'abc'[i], cells: g.map((a) => idOf(key, a)), drop: null as number | null }));
const SEVEN = [['full', 'minimal', 'no-identity'], ['no-tool-guide', 'no-tool-descriptions', 'no-safety'], ['no-memory-skills', 'no-work-habits', 'no-style']];
const SHARDS = [
  ...gridShards('cc', SEVEN),
  ...gridShards('oc', SEVEN),
  ...gridShards('he', [['full', 'minimal', 'no-tool-guide'], ['no-tool-descriptions', 'no-safety', 'no-memory-skills'], ['no-work-habits', 'no-style']]),
  ...gridShards('cx', SEVEN),
  { name: 'sol-oc', cells: [idOf('oc-sol', 'full'), idOf('oc-sol', 'minimal')], drop: 1 },
  { name: 'sol-he', cells: [idOf('he-sol', 'full'), idOf('he-sol', 'minimal')], drop: 1 },
  { name: 'om', cells: [idOf('cc', 'official-minimal'), idOf('cx', 'official-minimal')], drop: 2 },
];
const placed = SHARDS.flatMap((s) => s.cells);
if (placed.length !== arms.length || new Set(placed).size !== arms.length) throw new Error('every cell must sit in exactly one shard');

// Calibration receipts: measured cost per trial (full cells, all 20 tasks), wall time, and the Sol cross estimate.
const cal = readFileSync(join(CAL, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const pairName = (key: string) => { const p = PAIRS.find((x) => x.key === key)!; return p.harness + '/' + p.tag; };
const calFull = (key: string) => { const p = PAIRS.find((x) => x.key === key)!; return cal.filter((t) => t.cell === p.harness + '-' + p.tag + '-full-mu-v03-dev'); };
const projection = json(join(CAL, 'projection.json'));
const costPerTrial: Record<string, number> = {};
const wallPerTrial: Record<string, number> = {};
for (const key of ['cc', 'oc', 'he', 'cx']) {
  const full = calFull(key);
  if (full.length !== 20) throw new Error(key + ': expected 20 calibration full-cell trials, found ' + full.length);
  costPerTrial[key] = mean(full.map((t) => t.usage?.usd ?? 0));
  wallPerTrial[key] = mean(full.map((t) => t.wall_ms ?? 0)) / 1000;
  if (Math.abs(costPerTrial[key]! - projection.cost_per_trial_full[pairName(key)]) > 1e-9) throw new Error(key + ': trials.jsonl and projection.json disagree on cost per trial');
}
costPerTrial['oc-sol'] = projection.sol_cross_per_trial_est['openclaw/sol'];
costPerTrial['he-sol'] = projection.sol_cross_per_trial_est['hermes/sol'];
wallPerTrial['oc-sol'] = wallPerTrial.oc!;
wallPerTrial['he-sol'] = wallPerTrial.he!;
const reservation: Record<string, number> = { [OPUS]: projection.reservation_opus, [SOL]: projection.reservation_sol };
const trialsPerCell = tasks.length * REPS;

const shards = SHARDS.map((s) => {
  const cs = s.cells.map(armOf);
  const projected = cs.reduce((x, a) => x + trialsPerCell * costPerTrial[a.pair.key]!, 0);
  const res = Math.max(...cs.map((a) => reservation[a.pair.model]!));
  return {
    name: s.name, cells: s.cells, trials: cs.length * trialsPerCell, projected_usd: round(projected), reservation_usd: res,
    lease_usd: ceilHalf(projected * LEASE_FACTOR + res),
    trial_hours_est: round(cs.reduce((x, a) => x + (trialsPerCell * wallPerTrial[a.pair.key]!) / 3600, 0), 2),
    smoke_spend_usd_est: round(cs.reduce((x, a) => x + costPerTrial[a.pair.key]!, 0)), drop_step: s.drop,
  };
});
const cellOrder = shards.flatMap((s) => s.cells).map(armOf);
const runCap = shards.reduce((s, x) => s + x.lease_usd, 0);
const projectedMain = shards.reduce((s, x) => s + x.projected_usd, 0);
const smokeSpend = shards.reduce((s, x) => s + x.smoke_spend_usd_est, 0);

// Lane cap: $600 less the calibration's spend, against this run's leases, its smokes and the joint-cut run's reserve.
const laneLine = JSON.parse(readFileSync(join(CAL, 'lane-spend-line.jsonl'), 'utf8').trim().split('\n')[0]!);
interface Design { design: string; reps: number; tasks: number; per_pair: { pair: string; mdd_points: number; pass_halfwidth_points: number; p_pass_lb_above_minus10: number; p_cut_one_seventh: number[] }[]; pooled: { mdd_points: number; pass_halfwidth_points: number }; spend: { jointcut_lease: number; jointcut_smokes: number } }
const b = (json(join(CAL, 'design-options.json')).designs as Design[]).find((d) => d.design === 'b')!;
if (b.tasks !== tasks.length || b.reps !== REPS) throw new Error('design-options.json design b is not 20 tasks by 2 repetitions');
const remaining = LANE_CAP - laneLine.committed_usd;
const jointReserve = b.spend.jointcut_lease + b.spend.jointcut_smokes;
const committed = runCap + smokeSpend + jointReserve;
const extraRes = shards.reduce((s, x) => s + x.reservation_usd, 0);
const dropSaving = (step: number) => shards.filter((x) => x.drop_step !== null && x.drop_step <= step).reduce((s, x) => s + x.lease_usd + x.smoke_spend_usd_est + x.reservation_usd, 0);
const twoRes = committed + extraRes;
const vmHours = shards.reduce((s, x) => s + x.trial_hours_est + 0.5, 0);
const budget = {
  lane_cap_usd: LANE_CAP, calibration_spend_usd: laneLine.committed_usd, remaining_usd: round(remaining),
  run_cap_usd: runCap, projected_main_spend_usd: round(projectedMain), smoke_spend_usd_est: round(smokeSpend), smoke_lease_usd_per_shard: SMOKE_LEASE,
  jointcut_reserve_usd: round(jointReserve),
  jointcut_reserve_basis: 'design-options.json design b: a fresh full cell and a joint cell per primary pair, 40 trials each, leases at projected x 1.25 plus one reservation per shard, plus smokes (upper bound)',
  committed_usd: round(committed), spare_usd: round(remaining - committed), fits: committed <= remaining,
  sensitivity_two_reservations_per_shard: {
    committed_usd: round(twoRes), spare_usd: round(remaining - twoRes), fits: twoRes <= remaining,
    after_drop_step_1_sol_cross: { committed_usd: round(twoRes - dropSaving(1)), fits: twoRes - dropSaving(1) <= remaining },
    after_drop_step_2_official_minimal: { committed_usd: round(twoRes - dropSaving(2)), fits: twoRes - dropSaving(2) <= remaining },
  },
  vm_hours_est: round(vmHours, 1), vm_usd_est: round(vmHours * 60 * VM_USD_PER_MIN, 2),
  vm_basis: 'calibration mean wall time per trial of the pair full cell (Sol cross: the same harness on Opus), plus 0.5 hour per VM for bootstrap, image builds, the golden check and the smoke, at the calibration shard-vm.json list rate of $0.00838 a minute; outside the model cap',
};
if (!budget.fits) throw new Error('leases do not fit the lane cap: ' + committed.toFixed(2) + ' against ' + remaining.toFixed(2));

// MDD, design (b): each task at its family's pooled calibration pass rate (resolution 5), 20 tasks by 2 repetitions.
const pairMdd = ['cc', 'oc', 'he', 'cx'].map((key) => ({ key, ...familyPooledMdd(tasks, REPS, familyOf, calFull(key)) }));
const pooledMdd = familyPooledMdd(tasks, REPS, familyOf, ['cc', 'oc', 'he', 'cx'].flatMap(calFull));
for (const m of pairMdd) {
  const d = b.per_pair.find((x) => x.pair === pairName(m.key))!;
  if (m.mdd === null || Math.abs(100 * m.mdd - d.mdd_points) > 1e-6) throw new Error(m.key + ': MDD does not match design-options.json');
}
if (pooledMdd.mdd === null || Math.abs(100 * pooledMdd.mdd - b.pooled.mdd_points) > 1e-6) throw new Error('pooled MDD does not match design-options.json');
const HEADLINE: Record<string, string> = {
  cc: 'Cost deltas, keeps whose pass drop is at least the MDD, and cut verdicts',
  oc: 'Cost deltas and keeps whose pass drop is at least the MDD',
  he: 'Cost deltas and keeps whose pass drop is at least the MDD',
  cx: 'Cost deltas, keeps whose pass drop is at least the MDD, and cut verdicts',
};
const rates = (r: Record<string, { passes: number; n: number; rate: number }>) => Object.fromEntries(Object.entries(r).sort().map(([f, x]) => [f, { passes: x.passes, n: x.n, rate: round(x.rate) }]));
const mdd = {
  label: "each task at its family's pooled calibration pass rate (resolution 5); scripts/paired-mdd.ts arithmetic through scripts/prompt-archaeology/tables.ts familyPooledMdd; alpha 0.05, power 0.8; pass-rate points",
  design: 'b: all 20 public v0.3 dev tasks x 2 repetitions, 40 trials per cell',
  per_pair: pairMdd.map((m) => {
    const d = b.per_pair.find((x) => x.pair === pairName(m.key))!;
    return {
      pair: pairName(m.key), mdd_points: round(100 * m.mdd!, 1), pass_halfwidth_points: round(d.pass_halfwidth_points, 1),
      p_pass_lb_above_minus10_true_delta_0: round(d.p_pass_lb_above_minus10, 2), p_cut_typical_layer: d.p_cut_one_seventh.map((x) => round(x, 2)),
      family_rates: rates(m.family_rates), headline: HEADLINE[m.key],
    };
  }),
  pooled: { mdd_points: round(100 * pooledMdd.mdd!, 1), pass_halfwidth_points: round(b.pooled.pass_halfwidth_points, 1), family_rates: rates(pooledMdd.family_rates) },
};

// Task rule. The plan's rule (a family is in when its pooled full-cell rate is 10 to 90 percent) is recorded beside the
// replacement rule, which keeps every task.
const analysis = json(join(CAL, 'calibration-analysis.json'));
const famRates = analysis.family_rates_full_cells as Record<string, { passes: number; n: number; rate: number; tasks: string[] }>;
const inPlanRule = (r: number) => r >= 0.1 && r <= 0.9;
const planKept = tasks.filter((t) => inPlanRule(famRates[familyOf(t)]!.rate));
if (JSON.stringify(planKept) !== JSON.stringify(analysis.kept_tasks)) throw new Error('the plan rule does not reproduce calibration-analysis.json kept_tasks');
const taskRule = {
  rule: 'internal-task, 2026-11-01, design option B: every public v0.3 multi-user dev task runs, whatever its calibration pass rate. Removing a layer can only show as a drop in pass rate, so a task at 100 percent in the full cell still carries information; keeping every task keeps scope_isolation, and with it the cross-scope half of the safety bound, in the run.',
  replaces: 'Plan decision 6: a family is kept when its pass rate, pooled over the four primary full cells of the calibration, is 10 to 90 percent.',
  source: 'calibration/trials.jsonl, the four full cells, scored trials only (prompt-archaeology-calib-2026-11 at 5e82c87d5)',
  families: Object.fromEntries(Object.entries(famRates).sort().map(([f, r]) => [f, { passes: r.passes, n: r.n, rate: round(r.rate), tasks: r.tasks, kept: true, kept_by_plan_rule: inPlanRule(r.rate) }])),
  kept_tasks: tasks, n_kept: tasks.length,
  plan_rule_kept_tasks: planKept, plan_rule_n_kept: planKept.length,
};

const QUESTION = 'On all 20 public v0.3 multi-user dev tasks, two repetitions per task, network internal, no gstack and no gbrain: for Claude Code 2.1.312, OpenClaw 2026.10.6 and Hermes Agent v2026.9.24 on ' + OPUS + ' and Codex 0.165.0 on ' + SOL + ' at reasoning effort medium, how much does removing each layer of the harness\'s built-in prompt and tool documentation (identity, tool-guide, tool-descriptions, safety, memory-skills, work-habits, style; Hermes has no identity layer) change the pass rate and the cost per trial against the full cell, and how far does the minimal cell (every removable layer gone) fall from it? The metering proxy removes each layer by its committed map (harnesses/ablation, sha256 in each cell). Verdicts per layer and pair (keep, keep (safety), cut, cut candidate, unclear) by scripts/prompt-archaeology/tables.ts, intention to treat, Holm within each pair, labelled "on v0.3 multi-user dev tasks, at these pins". Descriptive: full and minimal on ' + SOL + ' for OpenClaw and Hermes over Responses, and official-minimal (the harness\'s own prompt override) on Claude Code and Codex.';

const prereg = {
  schema_version: 1, run_id: RUN_ID, question: QUESTION, tasks: {},
  cells: cellOrder.map((a) => a.cell),
  wall_clock_s: { multiuser: 1500 }, spend_cap_usd: runCap,
  drop_order: [1, 2].flatMap((step) => shards.filter((s) => s.drop_step === step).flatMap((s) => s.cells)),
  minimum_v01: cellOrder.filter((a) => a.pair.grid && a.kind !== 'official-minimal').map((a) => a.cell.id),
};
const leasePlan = {
  run_id: RUN_ID, size: 'standard-16', commit: '<the preregistration merge commit>', prereg: DIR + '/prereg.json',
  options: ['--pre-smoke', 'scripts/prompt-archaeology/pre-smoke.sh', '--smoke-lease-usd', String(SMOKE_LEASE)],
  lease_rule: 'projected spend (trials x the pair measured full-cell cost per trial) x ' + LEASE_FACTOR + ', plus one in-flight reservation per shard ($' + reservation[OPUS] + ' Opus, $' + reservation[SOL] + ' Sol; Opus for a shard with any Opus cell), rounded up to $0.50',
  cost_per_trial_usd: Object.fromEntries(Object.entries(costPerTrial).map(([k, v]) => [k, round(v)])),
  cost_basis: 'cc, oc, he, cx: mean usage.usd of the calibration full cell over all 20 tasks (calibration/trials.jsonl). oc-sol, he-sol: calibration/projection.json sol_cross_per_trial_est, the Opus full-cell token counts repriced at Sol rates times the codex long-context factor 1.194 (an approximation)',
  shards,
};

const BT = String.fromCharCode(96);
const code = (s: string) => BT + s + BT;
const pct = (x: number) => Math.round(100 * x) + '%';
const mapsBlock = ['| Map | Harness | Wire | Model | Removable layers | sha256 |', '|---|---|---|---|---:|---|',
  ...Object.values(maps).map((m) => '| ' + code(m.path) + ' | ' + m.harness + ' | ' + m.wire + ' | ' + m.model + ' | ' + m.layers.length + ' | ' + code(m.sha256) + ' |')].join('\n');
const armLabel = (a: Arm) => (a.kind === 'layer' ? 'no ' + a.layers[0] : a.arm);
const shardBlock = ['| Shard | Cells | Trials | Projected | Lease | Trial hours (est.) |', '|---|---|---:|---:|---:|---:|',
  ...shards.map((s) => {
    const cs = s.cells.map(armOf);
    const label = cs.map((a) => a.pair.harness + ' ' + (a.pair.tag === 'sol' ? 'Sol' : 'Opus') + ' ' + armLabel(a)).join(', ');
    return '| ' + code(s.name) + ' | ' + label + ' | ' + s.trials + ' | ' + usd(s.projected_usd) + ' | ' + usd(s.lease_usd) + ' | ' + s.trial_hours_est.toFixed(1) + ' |';
  }),
  '| **All** | ' + arms.length + ' cells | ' + arms.length * trialsPerCell + ' | ' + usd(projectedMain) + ' | **' + usd(runCap) + '** | ' + shards.reduce((s, x) => s + x.trial_hours_est, 0).toFixed(1) + ' |'].join('\n');
const mddBlock = ['| Pair | MDD, points | Pass interval half-width, points | Chance the pass lower bound clears -10 at a true delta of 0 | Chance a cut is reachable, typical layer | Headline |', '|---|---:|---:|---:|---:|---|',
  ...mdd.per_pair.map((p) => '| ' + p.pair + ' | ' + p.mdd_points.toFixed(1) + ' | ' + p.pass_halfwidth_points.toFixed(1) + ' | ' + pct(p.p_pass_lb_above_minus10_true_delta_0) + ' | ' + [...new Set(p.p_cut_typical_layer.map(pct))].join(' to ') + ' | ' + p.headline + ' |'),
  '| Pooled over the four full cells | ' + mdd.pooled.mdd_points.toFixed(1) + ' | ' + mdd.pooled.pass_halfwidth_points.toFixed(1) + ' | | | Reference only |'].join('\n');
const s2 = budget.sensitivity_two_reservations_per_shard;
const fitWord = (fits: boolean, spare: number) => (fits ? 'fits, ' + usd(spare) + ' spare' : 'over by ' + usd(-spare));
const budgetBlock = ['| Item | USD |', '|---|---:|',
  '| Lane cap (internal-task, 2026-11-01) | ' + usd(LANE_CAP) + ' |',
  '| Calibration spend ([calibration/lane-spend-line.jsonl](calibration/lane-spend-line.jsonl)) | ' + usd(laneLine.committed_usd) + ' |',
  '| **Left** | **' + usd(remaining) + '** |',
  '| This run: ' + shards.length + ' shard leases (the cap in prereg.json) | ' + usd(runCap) + ' |',
  '| Smokes, one trial per cell, projected spend | ' + usd(smokeSpend) + ' |',
  '| Joint-cut run reserve, upper bound | ' + usd(jointReserve) + ' |',
  '| **Committed** | **' + usd(committed) + '** (' + fitWord(budget.fits, remaining - committed) + ') |',
  '| Two reservations in flight per shard | ' + usd(s2.committed_usd) + ' (' + fitWord(s2.fits, s2.spare_usd) + ') |',
  '| Same, after drop step 1 (Sol cross shards) | ' + usd(s2.after_drop_step_1_sol_cross.committed_usd) + ' (' + fitWord(s2.after_drop_step_1_sol_cross.fits, remaining - s2.after_drop_step_1_sol_cross.committed_usd) + ') |',
  '| Same, after drop step 2 (official-minimal shard) | ' + usd(s2.after_drop_step_2_official_minimal.committed_usd) + ' (' + fitWord(s2.after_drop_step_2_official_minimal.fits, remaining - s2.after_drop_step_2_official_minimal.committed_usd) + ') |',
].join('\n');
const PINNED = ['harnesses/ablation/manifest.json', 'harnesses/ablation/official-minimal.txt', 'runner/proxy/ablate.ts', 'scripts/ablation-golden.sh', 'scripts/prompt-archaeology/pre-smoke.sh', 'scripts/prompt-archaeology/clean-arm-audit.ts', 'scripts/prompt-archaeology/tables.ts'];
const pinsBlock = ['| File | sha256 at build time |', '|---|---|', ...PINNED.map((f) => '| ' + code(f) + ' | ' + code(createHash('sha256').update(readFileSync(f)).digest('hex')) + ' |')].join('\n');
const famCell = (r: Record<string, { passes: number; n: number }>, f: string) => (r[f] ? r[f]!.passes + '/' + r[f]!.n : '-');
const mddMd = [
  '# Minimum detectable differences, prompt-archaeology-2026-11 (design b)', '',
  'Generated by [build-prereg.ts](build-prereg.ts) from [calibration/trials.jsonl](calibration/trials.jsonl), and checked there against [calibration/design-options.json](calibration/design-options.json).', '',
  '- **Design:** all 20 public v0.3 dev tasks by 2 repetitions, 40 trials per cell.',
  '- **Method:** ' + mdd.label + '.',
  "- **Per pair:** each task at its family's rate in that pair's own calibration full cell (20 trials). " + code('tables.ts --calibration') + ' prints the same figure, and the headline rule uses it.',
  "- **Pooled:** each task at its family's rate over all four full cells (80 trials). Reference only.",
  "- **Caveat:** a family at 0 or 100 percent in a pair's full cell adds no variance. OpenClaw's and Codex's MDDs are lower partly for that reason.",
  '- **Chances** come from [calibration/design-options.json](calibration/design-options.json): normal approximations, not simulations. A typical layer is taken as one seventh of the minimal cell\'s cost saving.', '',
  mddBlock, '',
  '## Family pass counts in the calibration full cells', '',
  '| Family | ' + mdd.per_pair.map((p) => p.pair).join(' | ') + ' | Pooled |', '|---|' + mdd.per_pair.map(() => '---:|').join('') + '---:|',
  ...Object.keys(mdd.pooled.family_rates).map((f) => '| ' + f + ' | ' + mdd.per_pair.map((p) => famCell(p.family_rates, f)).join(' | ') + ' | ' + famCell(mdd.pooled.family_rates, f) + ' |'),
  '',
].join('\n');

const outputs: Record<string, string> = {
  [join(DIR, 'prereg.json')]: JSON.stringify(prereg, null, 2) + '\n',
  [join(DIR, 'lease-plan.json')]: JSON.stringify(leasePlan, null, 2) + '\n',
  [join(DIR, 'budget.json')]: JSON.stringify(budget, null, 2) + '\n',
  [join(DIR, 'mdd.json')]: JSON.stringify(mdd, null, 2) + '\n',
  [join(DIR, 'mdd.md')]: mddMd,
  [join(CAL, 'task-rule.json')]: JSON.stringify(taskRule, null, 2) + '\n',
};
const mdPath = join(DIR, 'PREREGISTRATION.md');
let md = readFileSync(mdPath, 'utf8');
for (const [name, body] of Object.entries({ maps: mapsBlock, pins: pinsBlock, shards: shardBlock, mdd: mddBlock, budget: budgetBlock })) {
  const open = '<!-- build-prereg:' + name + ' -->\n', close = '\n<!-- /build-prereg:' + name + ' -->';
  const i = md.indexOf(open), j = md.indexOf(close);
  if (i < 0 || j < i) throw new Error('PREREGISTRATION.md has no build-prereg:' + name + ' block');
  md = md.slice(0, i + open.length) + body + md.slice(j);
}
outputs[mdPath] = md;

let stale = 0;
for (const [path, text] of Object.entries(outputs)) {
  const same = existsSync(path) && readFileSync(path, 'utf8') === text;
  if (same) continue;
  if (check) { stale++; console.error('build-prereg: ' + path + ' is stale'); } else writeFileSync(path, text);
}
console.log('build-prereg: ' + arms.length + ' cells, ' + arms.length * trialsPerCell + ' trials, ' + shards.length + ' shards, run cap ' + usd(runCap) + ', lane committed ' + usd(committed) + ' of ' + usd(remaining) + ' left' + (check ? ', ' + stale + ' stale' : ''));
process.exit(stale ? 1 : 0);
