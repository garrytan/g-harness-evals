import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { familyPooledMdd } from './scripts/prompt-archaeology/tables.ts';
import { designMdd } from './scripts/paired-mdd.ts';
import { chatPrice } from './runner/ledger/budget-ledger.ts';
const M = process.argv[2]!; const OUT = process.argv[3]!;
const rows = readFileSync(join(M, 'trials.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const EXCL = new Set(['model_error', 'infra_error', 'exam_fault']);
const scored = (t: any) => !EXCL.has(t.termination);
const pass = (t: any) => (t.grade === 'pass' && !t.consent_violation ? 1 : 0);
const famCache: Record<string, string> = {};
const familyOf = (task: string) => famCache[task] ??= (readFileSync(join('tasks/multiuser/v0.3/dev', task, 'task.toml'), 'utf8').match(/^family\s*=\s*"([^"]+)"/m)![1]!);
const taskOf = (t: any) => t.trial_id.split('/')[2];
for (const t of rows) t.task = taskOf(t);
const pairs = [
  { pair: 'claude-code/opus', full: 'claude-code-opus-full-mu-v03-dev', min: 'claude-code-opus-minimal-mu-v03-dev', grid: 9, model: 'anthropic:claude-opus-5-5' },
  { pair: 'openclaw/opus', full: 'openclaw-opus-full-mu-v03-dev', min: 'openclaw-opus-minimal-mu-v03-dev', grid: 9, model: 'anthropic:claude-opus-5-5' },
  { pair: 'hermes/opus', full: 'hermes-opus-full-mu-v03-dev', min: 'hermes-opus-minimal-mu-v03-dev', grid: 8, model: 'anthropic:claude-opus-5-5' },
  { pair: 'codex/sol', full: 'codex-sol-full-mu-v03-dev', min: 'codex-sol-minimal-mu-v03-dev', grid: 9, model: 'openai:gpt-6.1-sol' },
];
const cell = (id: string) => rows.filter((t) => t.cell === id);
const allTasks = [...new Set(rows.map((t) => t.task))].sort();
// task rule: family pooled pass rate over the four full cells, scored trials
const fullRows = pairs.flatMap((p) => cell(p.full)).filter(scored);
const fam: Record<string, { passes: number; n: number; rate: number; tasks: string[] }> = {};
for (const t of fullRows) { const f = familyOf(t.task); const r = (fam[f] ??= { passes: 0, n: 0, rate: 0, tasks: [] }); r.passes += pass(t); r.n++; r.rate = r.passes / r.n; if (!r.tasks.includes(t.task)) r.tasks.push(t.task); }
for (const f of Object.values(fam)) f.tasks.sort();
const keptFamilies = Object.keys(fam).filter((f) => fam[f]!.rate >= 0.10 && fam[f]!.rate <= 0.90).sort();
const kept = allTasks.filter((t) => keptFamilies.includes(familyOf(t)));
// per pair cost and pass
const cost = (rs: any[]) => rs.reduce((s, t) => s + (t.usage?.usd ?? 0), 0);
const price = (m: string) => chatPrice(m) as any;
const reprice = (rs: any[], m: string) => { const p = price(m); let s = 0; for (const t of rs) { const u = t.usage ?? {}; const cr = u.cached_tokens ?? 0, cw = u.cache_write_tokens ?? 0, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0; const plain = inp - cr - cw; s += (plain * p.input + cr * (p.cache_read ?? p.input) + cw * (p.cache_write ?? p.input) + out * p.output) / 1e6; } return s; };
const per = pairs.map((p) => {
  const f = cell(p.full), mn = cell(p.min);
  const mdd3 = familyPooledMdd(kept, 3, familyOf, f);
  const mdd3all = familyPooledMdd(allTasks, 3, familyOf, f);
  return { pair: p.pair, model: p.model, grid_cells: p.grid,
    full: { trials: f.length, scored: f.filter(scored).length, passes: f.filter(scored).reduce((s, t) => s + pass(t), 0), usd: cost(f), usd_per_trial: cost(f) / f.length, repriced_check_usd: reprice(f, p.model) },
    minimal: { trials: mn.length, scored: mn.filter(scored).length, passes: mn.filter(scored).reduce((s, t) => s + pass(t), 0), usd: cost(mn), usd_per_trial: cost(mn) / mn.length },
    mdd_kept_3reps: mdd3, mdd_all20_3reps: mdd3all };
});
// pooled-over-pairs family-rate MDD (task rule rates), per pair design of kept tasks x 3 reps
const pooledRateMdd = (() => { const z = 1.959963984540054 + 0.8416212335729143; const g = kept.length, r = 3, n = g * r; const v = kept.reduce((s, t) => { const p = fam[familyOf(t)]!.rate; return s + r * 2 * p * (1 - p); }, 0); const se = Math.sqrt((g / (g - 1)) * v) / n; return { mdd: z * se, se }; })();
// Sol cross estimate: openclaw and hermes Opus full-cell token shapes repriced at Sol
const solCross = ['openclaw-opus-full-mu-v03-dev', 'hermes-opus-full-mu-v03-dev'].map((id) => ({ from: id, sol_usd_per_trial: reprice(cell(id), 'openai:gpt-6.1-sol') / cell(id).length, opus_repriced_check: reprice(cell(id), 'anthropic:claude-opus-5-5') / cell(id).length, measured: cost(cell(id)) / cell(id).length }));
const out = { kept_families: keptFamilies, kept_tasks: kept, n_kept: kept.length, family_rates_full_cells: fam, per_pair: per, pooled_rate_mdd_kept_3reps: pooledRateMdd, design_mdd_check_p05: designMdd(0.5, { tasks: kept.length, reps: 3 }), sol_cross_estimate: solCross, prices: { opus: price('anthropic:claude-opus-5-5'), sol: price('openai:gpt-6.1-sol') } };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v)));
