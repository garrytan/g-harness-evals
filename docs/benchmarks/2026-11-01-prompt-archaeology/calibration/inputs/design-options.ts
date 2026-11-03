import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { familyPooledMdd } from './scripts/prompt-archaeology/tables.ts';
import { designMdd } from './scripts/paired-mdd.ts';
import { chatPrice } from './runner/ledger/budget-ledger.ts';
import { normalQuantile } from './runner/stats/paired.ts';
const M = process.argv[2]!; const OUT = process.argv[3]!;
const rows = readFileSync(join(M, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const EXCL = new Set(['model_error', 'infra_error', 'exam_fault']);
const scored = (t: any) => !EXCL.has(t.termination);
const pass = (t: any) => (t.grade === 'pass' && !t.consent_violation ? 1 : 0);
const fc: Record<string, string> = {};
const familyOf = (task: string) => fc[task] ??= readFileSync(join('tasks/multiuser/v0.3/dev', task, 'task.toml'), 'utf8').match(/^family\s*=\s*"([^"]+)"/m)![1]!;
for (const t of rows) t.task = t.trial_id.split('/')[2];
const Phi = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pairs = [
  { pair: 'claude-code/opus', full: 'claude-code-opus-full-mu-v03-dev', min: 'claude-code-opus-minimal-mu-v03-dev', grid: 9, model: 'anthropic:claude-opus-5-5', res: 2.9214 },
  { pair: 'openclaw/opus', full: 'openclaw-opus-full-mu-v03-dev', min: 'openclaw-opus-minimal-mu-v03-dev', grid: 9, model: 'anthropic:claude-opus-5-5', res: 2.9214 },
  { pair: 'hermes/opus', full: 'hermes-opus-full-mu-v03-dev', min: 'hermes-opus-minimal-mu-v03-dev', grid: 8, model: 'anthropic:claude-opus-5-5', res: 2.9214 },
  { pair: 'codex/sol', full: 'codex-sol-full-mu-v03-dev', min: 'codex-sol-minimal-mu-v03-dev', grid: 9, model: 'openai:gpt-6.1-sol', res: 1.4546 },
];
const cell = (id: string) => rows.filter((t) => t.cell === id);
const allTasks = [...new Set(rows.map((t) => t.task))].sort();
const fam: Record<string, { passes: number; n: number; rate: number }> = {};
for (const p of pairs) for (const t of cell(p.full).filter(scored)) { const r = (fam[familyOf(t.task)] ??= { passes: 0, n: 0, rate: 0 }); r.passes += pass(t); r.n++; r.rate = r.passes / r.n; }
const kept = allTasks.filter((t) => { const r = fam[familyOf(t)]!.rate; return r >= 0.1 && r <= 0.9; });
const priceOf = (m: string) => chatPrice(m) as any;
const reprice = (rs: any[], m: string) => { const p = priceOf(m); let s = 0; for (const t of rs) { const u = t.usage ?? {}; const cr = u.cached_tokens ?? 0, cw = u.cache_write_tokens ?? 0, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0; s += ((inp - cr - cw) * p.input + cr * (p.cache_read ?? p.input) + cw * (p.cache_write ?? p.input) + out * p.output) / 1e6; } return s; };
const usd = (t: any) => t.usage?.usd ?? 0;
const z = normalQuantile(0.975), zp = normalQuantile(0.8);
const designs = [ { id: 'a', label: '9 kept tasks x 3 reps', tasks: kept, reps: 3 }, { id: 'b', label: 'all 20 tasks x 2 reps', tasks: allTasks, reps: 2 }, { id: 'c', label: 'all 20 tasks x 3 reps', tasks: allTasks, reps: 3 }, { id: 'd', label: '9 kept tasks x 5 reps', tasks: kept, reps: 5 } ];
const remaining = 467.61, smokes = 8.37, jsmokes = 1.69;
const codexFull = cell('codex-sol-full-mu-v03-dev'); const codexRatio = codexFull.reduce((s, t) => s + usd(t), 0) / reprice(codexFull, 'openai:gpt-6.1-sol');
const out: any[] = [];
for (const d of designs) {
  const inSet = (t: any) => d.tasks.includes(t.task);
  const g = d.tasks.length, T = g * d.reps;
  const per = pairs.map((p) => {
    const f = cell(p.full).filter(inSet), mn = cell(p.min).filter(inSet);
    const cpt = f.reduce((s, t) => s + usd(t), 0) / f.length;
    const mdd = familyPooledMdd(d.tasks, d.reps, familyOf, cell(p.full));
    // pass condition: CI lower bound > -10 with true delta 0, half-width h = z*se
    const se = mdd.se_null ?? 0; const h = z * se;
    const pPass = se > 0 ? 1 - Phi((h - 0.10) / se) : 1;
    // cost: paired per-task diffs minimal - full over tasks with both sides scored or not (cost counts every trial)
    const byTask = new Map<string, any>(); for (const t of f) byTask.set(t.task, t);
    const diffs = mn.filter((t) => byTask.has(t.task) && t.termination !== 'model_error').map((t) => usd(t) - usd(byTask.get(t.task)));
    const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length; const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1));
    const seIndep = Math.sqrt(g / (g - 1)) * sd / Math.sqrt(T), seClust = Math.sqrt(g / (g - 1)) * sd / Math.sqrt(g);
    const pc = (delta: number, s: number) => Phi((-delta - z * s) / s);
    const pCostMin = [pc(mean, seClust), pc(mean, seIndep)], pCostLayer = [pc(mean / 7, seClust), pc(mean / 7, seIndep)];
    return { pair: p.pair, cost_per_trial: cpt, mdd_points: mdd.mdd === null ? null : 100 * mdd.mdd, se_null_points: 100 * se, pass_halfwidth_points: 100 * h, p_pass_lb_above_minus10: pPass,
      cost_delta_min_per_trial: mean, cost_sd: sd, p_cost_excludes0_minimal_effect: pCostMin, p_cost_excludes0_one_seventh: pCostLayer,
      p_cut_minimal_effect: pCostMin.map((x) => x * pPass), p_cut_one_seventh: pCostLayer.map((x) => x * pPass), grid: p.grid, res: p.res };
  });
  const zz = z + zp; const vPooled = d.tasks.reduce((s, t) => { const p = fam[familyOf(t)]!.rate; return s + d.reps * 2 * p * (1 - p); }, 0); const sePooled = Math.sqrt((g / (g - 1)) * vPooled) / T;
  const pooled = { mdd_points: 100 * zz * sePooled, se_null_points: 100 * sePooled, pass_halfwidth_points: 100 * z * sePooled, p_pass_lb_above_minus10: 1 - Phi((z * sePooled - 0.10) / sePooled) };
  const P = Object.fromEntries(per.map((x) => [x.pair, x]));
  const solCpt = (id: string) => { const f = cell(id).filter(inSet); return reprice(f, 'openai:gpt-6.1-sol') / f.length * codexRatio; };
  const grid = per.reduce((s, x) => s + x.grid * T * x.cost_per_trial, 0);
  const solx = 2 * T * (solCpt('openclaw-opus-full-mu-v03-dev') + solCpt('hermes-opus-full-mu-v03-dev'));
  const offmin = T * (P['claude-code/opus'].cost_per_trial + P['codex/sol'].cost_per_trial);
  const resvFull = 4 * (3 * 2.9214 + 1.4546); // 16 shards
  const resvGrid = 3 * 2.9214 + 3 * 2.9214 + 3 * 2.9214 + 3 * 1.4546; // grid only: 9,9,8,9 cells -> 3 shards each
  const main = grid + solx + offmin; const mainLease = main * 1.25 + resvFull;
  const gridLease = grid * 1.25 + resvGrid;
  const joint = per.reduce((s, x) => s + 2 * T * x.cost_per_trial, 0); const jointLease = joint * 1.25 + 3 * 2.9214 + 1.4546;
  const smokesGrid = per.reduce((s, x) => s + x.grid * x.cost_per_trial, 0);
  const totFull = mainLease + smokes + jointLease + jsmokes; const totGrid = gridLease + smokesGrid + jointLease + jsmokes;
  out.push({ design: d.id, label: d.label, tasks: g, reps: d.reps, trials_per_cell: T, per_pair: per, pooled,
    spend: { grid, sol_cross: solx, official_minimal: offmin, main_full: main, main_full_lease: mainLease, main_grid_only: grid, main_grid_only_lease: gridLease, jointcut: joint, jointcut_lease: jointLease,
      total_leases_plus_smokes_full: totFull, headroom_full: remaining - totFull, total_leases_plus_smokes_grid_only: totGrid, headroom_grid_only: remaining - totGrid, smokes_full: smokes, smokes_grid_only: smokesGrid, jointcut_smokes: jsmokes } });
}
writeFileSync(OUT, JSON.stringify({ kept_tasks: kept, remaining_cap: remaining, codex_long_context_correction: codexRatio, design_mdd_check: { a: designMdd(0.5, { tasks: 9, reps: 3 }), c: designMdd(0.5, { tasks: 20, reps: 3 }) }, designs: out }, null, 1));
const r2 = (x: number) => Math.round(x * 100) / 100;
for (const o of out) console.log(o.design, o.label, 'pooledMDD', r2(o.pooled.mdd_points), 'pooled hw', r2(o.pooled.pass_halfwidth_points), 'pPass', r2(o.pooled.p_pass_lb_above_minus10), JSON.stringify(o.per_pair.map((x: any) => [x.pair, r2(x.mdd_points), r2(x.pass_halfwidth_points), r2(x.p_pass_lb_above_minus10), x.p_cost_excludes0_minimal_effect.map(r2), x.p_cost_excludes0_one_seventh.map(r2), r2(x.cost_per_trial)])), JSON.stringify(Object.fromEntries(Object.entries(o.spend).map(([k, v]: any) => [k, r2(v)]))));
