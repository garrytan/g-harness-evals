#!/usr/bin/env bun
// The preregistered readings of harness-zero-h2h-2026-11 that summarize-run.ts and compare-run.ts do not print as the
// preregistration words them, from the committed receipts, keyless:
//
//   bun docs/benchmarks/2026-11-06-harness-zero-h2h/report-extras.ts [--check]
//
// Reads results/trials.jsonl and each shard's ledger beside it; writes results/report-extras.json and results/verdicts.md
// (with --check it writes nothing and exits 1 when either differs from disk). Statistics: runner/stats/paired.ts at the
// preregistration commit (clusteredPairedDelta, holmAdjusted; seed 7, 10,000 draws) and scripts/baseline-endpoints.ts's
// pairEndpoints for cost per trial and per success. Pairs are matched by task and repetition; a pair where either side
// ended model_error, infra_error or exam_fault is excluded on both sides and listed (preregistration, Endpoints).
//
// - Primary (7 pairs, lean minus field on the same model, 5 repetitions): cost per trial (paired USD difference) and per
//   success (ratio lean over field): "Lean cheaper (dev)" when the interval is entirely below 0 (below 1 for the ratio),
//   "Lean dearer (dev)" when entirely above, else "Can't tell (dev)". Pass rate: "No worse than (dev)" when the lower bound
//   is above -10 points, "Worse (dev)" when the upper bound is below -10, else "Can't tell (dev)". Superiority: pass-rate
//   sign-flip p, Holm over the 7, and an interval that excludes 0.
// - gbrain (13-1, 14-1, 15-5, 13-14 over repetitions 1 to 3): pass-rate and cost-per-trial intervals, Holm over the 4.
// - Baselines (lean against conservative, zero-full and zero-min, repetitions 1 to 3): descriptive.
// - Per cell: pass rate, terminations, spend per trial and per success, and pass rate on the 5 items that repeat a
//   first-draw item (si-01, si-03 and the 3 synthesis tasks) against the other 15.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { clusteredPairedDelta, holmAdjusted, seededRandom } from '../../../runner/stats/paired.ts';
import { pairEndpoints } from '../../../scripts/baseline-endpoints.ts';
import type { TrialRecord } from '../../../runner/contracts.ts';

const here = import.meta.dir;
const results = join(here, 'results');
const o = { seed: 7, draws: 10000 };
const kit = { clusteredPairedDelta, seededRandom };
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const rows: TrialRecord[] = readFileSync(join(results, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rep = (t: TrialRecord) => Number(t.trial_id.split('/').pop()!.slice(1));
const pass = (t: TrialRecord) => (t.grade === 'pass' ? 1 : 0);
const byCell = new Map<string, TrialRecord[]>();
for (const t of rows) byCell.set(t.cell, [...(byCell.get(t.cell) ?? []), t]);
const C = {
  zl: 'zero-lean-opus-none-mu-v03-dev2', zc: 'zero-conservative-opus-none-mu-v03-dev2', zf: 'zero-full-opus-none-mu-v03-dev2', zm: 'zero-min-opus-none-mu-v03-dev2',
  cc: 'claude-code-opus-none-mu-v03-dev2', oc: 'openclaw-opus-none-mu-v03-dev2', he: 'hermes-opus-none-mu-v03-dev2', qm: 'qm-pi-opus-none-mu-v03-dev2',
  zls: 'zero-lean-sol-sol-none-mu-v03-dev2', cx: 'codex-sol-none-mu-v03-dev2', ocs: 'openclaw-sol-none-mu-v03-dev2', hes: 'hermes-sol-none-mu-v03-dev2',
  gon: 'zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2', goff: 'zero-lean-opus-gbrain-mu-v03-dev2', gcc: 'claude-code-opus-gbrain-mu-v03-dev2',
};
const r4 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10000) / 10000);
const ci4 = (c: [number, number] | null | undefined) => (c ? [r4(c[0]), r4(c[1])] : null);

const RAW = new WeakMap<object, { pass: [number, number] | null; usd_per_trial: [number, number] | null; usd_per_success: [number, number] | null }>();

function compare(a: string, b: string, maxRep = 99) {
  const key = (t: TrialRecord) => t.task + '/r' + rep(t);
  const side = (cell: string) => {
    const ts = byCell.get(cell);
    if (!ts) throw new Error('report-extras: no trials for cell ' + cell);
    const m = new Map<string, TrialRecord>();
    for (const t of ts) {
      if (!Number.isInteger(rep(t))) throw new Error('report-extras: no repetition in trial id ' + t.trial_id);
      if (rep(t) > maxRep) continue;
      if (m.has(key(t))) throw new Error('report-extras: duplicate trial ' + cell + ' ' + key(t));
      m.set(key(t), t);
    }
    return m;
  };
  const A = side(a), B = side(b);
  const excluded: Array<{ id: string; reason: string }> = [];
  const pairs: Array<{ id: string; task: string; a: TrialRecord; b: TrialRecord }> = [];
  for (const id of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const ta = A.get(id), tb = B.get(id);
    if (!ta || !tb) { excluded.push({ id, reason: 'missing in ' + (ta ? b : a) }); continue; }
    const bad = [ta, tb].find((t) => EXCLUDED.has(t.termination));
    if (bad) { excluded.push({ id, reason: bad.termination + ' in ' + bad.cell }); continue; }
    pairs.push({ id, task: ta.task, a: ta, b: tb });
  }
  if (pairs.length === 0) throw new Error('report-extras: no pairs for ' + a + ' against ' + b);
  const d = clusteredPairedDelta(pairs.map((p) => ({ id: p.id, cluster: p.task, a: pass(p.a), b: pass(p.b) })), o);
  const e = pairEndpoints(pairs, pass, kit, o);
  const out = {
    a, b, pairs: pairs.length, tasks: d.n_clusters, excluded,
    pass: { a: r4(d.mean_a), b: r4(d.mean_b), delta: r4(d.delta), ci95: ci4(d.ci95), half_width: d.ci95 ? r4((d.ci95[1] - d.ci95[0]) / 2) : null, p: r4(d.p_two_sided), p_method: d.p_method },
    usd_per_trial: e.usd_per_trial && { a: r4(e.usd_per_trial.mean_a), b: r4(e.usd_per_trial.mean_b), delta: r4(e.usd_per_trial.delta), ci95: ci4(e.usd_per_trial.ci95) },
    usd_per_success: { a: r4(e.usd_per_success.a), b: r4(e.usd_per_success.b), ratio: r4(e.usd_per_success.ratio.estimate), ci95: ci4(e.usd_per_success.ratio.ci95), note: e.usd_per_success.ratio.note ?? null },
    cost_excluded: e.cost_excluded, broken: e.tasks.broken, fixed: e.tasks.fixed,
  };
  RAW.set(out, { pass: d.ci95 ?? null, usd_per_trial: e.usd_per_trial?.ci95 ?? null, usd_per_success: e.usd_per_success.ratio.ci95 ?? null });
  return out;
}
const side = (ci: (number | null)[] | null, line: number) => (!ci ? "Can't tell (dev)" : ci[1]! < line ? 'Lean cheaper (dev)' : ci[0]! > line ? 'Lean dearer (dev)' : "Can't tell (dev)");
const ni = (ci: (number | null)[] | null) => (!ci ? "Can't tell (dev)" : ci[0]! > -0.1 ? 'No worse than (dev)' : ci[1]! < -0.1 ? 'Worse (dev)' : "Can't tell (dev)");

const primaryPairs: Array<[string, string]> = [[C.cc, C.zl], [C.oc, C.zl], [C.he, C.zl], [C.qm, C.zl], [C.cx, C.zls], [C.ocs, C.zls], [C.hes, C.zls]];
const primary = primaryPairs.map(([field, lean]) => compare(field, lean));
const holm7 = holmAdjusted(primary.map((p) => p.pass.p ?? 1));
const primaryOut = primary.map((p, i) => {
  const raw = RAW.get(p)!;
  return {
    ...p, network_held_fixed: p.a !== C.qm,
    verdicts: {
      cost_per_trial: side(raw.usd_per_trial, 0), cost_per_success: side(raw.usd_per_success, 1), pass_non_inferiority: ni(raw.pass),
      superiority: { holm_p: r4(holm7[i]!), sentence: holm7[i]! < 0.05 && raw.pass && (raw.pass[0] > 0 || raw.pass[1] < 0) ? (p.pass.delta! > 0 ? 'Lean higher pass rate (dev)' : 'Lean lower pass rate (dev)') : 'No superiority claim (dev)' },
    },
  };
});
const gbPairs: Array<[string, string, string]> = [['13-1', C.zl, C.gon], ['14-1', C.zl, C.goff], ['15-5', C.cc, C.gcc], ['13-14', C.goff, C.gon]];
const gb = gbPairs.map(([label, a, b]) => ({ label, ...compare(a, b, 3) }));
const holm4 = holmAdjusted(gb.map((g) => g.pass.p ?? 1));
const gbOut = gb.map((g, i) => ({ ...g, holm_p: r4(holm4[i]!) }));
const baselines = [C.zc, C.zf, C.zm].map((c) => compare(c, C.zl, 3));

const repeated = (task: string) => /^(si-01|si-03|sy-)/.test(task);
const cells = Object.fromEntries([...byCell.entries()].sort().map(([cell, ts]) => {
  const usd = ts.reduce((s, t) => s + (t.usage?.usd ?? 0), 0), passes = ts.reduce((s, t) => s + pass(t), 0);
  const terms: Record<string, number> = {};
  for (const t of ts) terms[t.termination] = (terms[t.termination] ?? 0) + 1;
  const sub = (f: (t: TrialRecord) => boolean) => { const x = ts.filter(f); return { trials: x.length, pass_rate: r4(x.reduce((s, t) => s + pass(t), 0) / x.length) }; };
  return [cell, { trials: ts.length, tasks: new Set(ts.map((t) => t.task)).size, pass_rate: r4(passes / ts.length), terminations: terms, usd: r4(usd), usd_per_trial: r4(usd / ts.length), usd_per_success: passes ? r4(usd / passes) : null, repeated_items: sub((t) => repeated(t.task)), other_items: sub((t) => !repeated(t.task)), harness_error_trials: ts.filter((t) => t.termination === 'harness_error').map((t) => t.trial_id) }];
}));

const ledgers = readdirSync(results).filter((f) => /\.ledger\.sqlite$/.test(f) && !f.includes('.smoke.')).sort();
const spend = Object.fromEntries(ledgers.map((f) => {
  const s = JSON.parse(execFileSync('bun', [join(here, '../../../runner/proxy/metering-proxy.ts'), 'summary', '--budget-ledger', join(results, f), '--run-id', 'harness-zero-h2h-2026-11'], { encoding: 'utf8' }).trim().split('\n').pop()!);
  return [f.replace('.ledger.sqlite', ''), { lease_usd: s.lease_usd, committed_usd: r4(s.committed_usd), overshoot_usd: r4(s.overshoot_usd), requests: s.requests }];
}));
const committed = Object.values(spend).reduce((s, x: any) => s + x.committed_usd, 0);

const extras = { run_id: 'harness-zero-h2h-2026-11', seed: o.seed, draws: o.draws, trials: rows.length, primary: primaryOut, primary_holm_over: 7, gbrain: gbOut, gbrain_holm_over: 4, baselines, cells, spend: { shards: spend, committed_usd: r4(committed), cap_usd: 364.84 } };
const pct = (x: number | null) => (x === null ? '-' : (x * 100).toFixed(1));
const ciPts = (c: (number | null)[] | null) => (c ? '[' + pct(c[0]!) + ', ' + pct(c[1]!) + ']' : '-');
const usdS = (x: number | null) => (x === null ? '-' : x.toFixed(4));
const ciUsd = (c: (number | null)[] | null) => (c ? '[' + usdS(c[0]!) + ', ' + usdS(c[1]!) + ']' : '-');
const md = ['# harness-zero-h2h-2026-11 verdicts (written by report-extras.ts)', '',
  '## Primary: lean minus field, same model, 5 repetitions (dev, same item pool)', '',
  '| Field cell | Lean cell | Pairs | Pass field | Pass lean | Pass delta, points [95% CI] | Non-inferiority | USD/trial delta [95% CI] | Cost per trial | USD/success ratio [95% CI] | Cost per success | Holm p (7) | Superiority |', '|---|---|---:|---:|---:|---|---|---|---|---|---|---:|---|',
  ...primaryOut.map((p) => `| \`${p.a}\`${p.network_held_fixed ? '' : ' (network not held fixed)'} | \`${p.b}\` | ${p.pairs} | ${pct(p.pass.a)}% | ${pct(p.pass.b)}% | ${pct(p.pass.delta)} ${ciPts(p.pass.ci95)} | ${p.verdicts.pass_non_inferiority} | ${usdS(p.usd_per_trial?.delta ?? null)} ${ciUsd(p.usd_per_trial?.ci95 ?? null)} | ${p.verdicts.cost_per_trial} | ${p.usd_per_success.ratio?.toFixed(3) ?? '-'} ${p.usd_per_success.ci95 ? '[' + p.usd_per_success.ci95.map((x) => x!.toFixed(3)).join(', ') + ']' : '-'} | ${p.verdicts.cost_per_success} | ${p.verdicts.superiority.holm_p} | ${p.verdicts.superiority.sentence} |`),
  '', '## gbrain, repetitions 1 to 3 (B minus A)', '',
  '| Reading | A | B | Pairs | Pass A | Pass B | Pass delta, points [95% CI] | p | Holm p (4) | USD/trial delta [95% CI] |', '|---|---|---|---:|---:|---:|---|---:|---:|---|',
  ...gbOut.map((g) => `| ${g.label} | \`${g.a}\` | \`${g.b}\` | ${g.pairs} | ${pct(g.pass.a)}% | ${pct(g.pass.b)}% | ${pct(g.pass.delta)} ${ciPts(g.pass.ci95)} | ${g.pass.p} | ${g.holm_p} | ${usdS(g.usd_per_trial?.delta ?? null)} ${ciUsd(g.usd_per_trial?.ci95 ?? null)} |`),
  '', '## Baselines, repetitions 1 to 3 (lean minus baseline, descriptive)', '',
  '| Baseline | Pairs | Pass baseline | Pass lean | Pass delta, points [95% CI] | USD/trial delta [95% CI] |', '|---|---:|---:|---:|---|---|',
  ...baselines.map((b) => `| \`${b.a}\` | ${b.pairs} | ${pct(b.pass.a)}% | ${pct(b.pass.b)}% | ${pct(b.pass.delta)} ${ciPts(b.pass.ci95)} | ${usdS(b.usd_per_trial?.delta ?? null)} ${ciUsd(b.usd_per_trial?.ci95 ?? null)} |`),
  ''].join('\n');
const outJson = JSON.stringify(extras, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const same = (f: string, s: string) => existsSync(join(results, f)) && readFileSync(join(results, f), 'utf8') === s;
  const ok = same('report-extras.json', outJson) && same('verdicts.md', md);
  console.log(ok ? 'report-extras: up to date' : 'report-extras: stale');
  process.exit(ok ? 0 : 1);
}
writeFileSync(join(results, 'report-extras.json'), outJson);
writeFileSync(join(results, 'verdicts.md'), md);
console.log(md);
