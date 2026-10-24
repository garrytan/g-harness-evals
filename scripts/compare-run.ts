#!/usr/bin/env bun
// Pairwise harness comparison for one run: task-clustered paired bootstrap on pass (1/0) per (task, repetition),
// sign-flip p-values, Holm correction across the pairs. Items are paired by task and repetition index, so each
// pair compares the same task on the same repetition; clusters are tasks.
//
//   bun scripts/compare-run.ts --results <results/<run-id>> [--regraded] [--families a,b] [--seed 7] [--draws 10000]
//   bun scripts/compare-run.ts --results <run A> --against <run B>   pairs each harness's cell in A with its cell in B
//                                                                     (same tasks and repetition indices), for a model effect
//
//   bun scripts/compare-run.ts --results <run> --pair gbrain       within-run gbrain arm: for each (harness, config, model)
//                                                                     the cell with gbrain against the cell without it
//
// Prints a Markdown table (delta = B minus A in pass-rate points, 95% cluster bootstrap interval, two-sided
// sign-flip p, Holm-adjusted p, clusters, pairs) and writes comparisons.json beside trials.jsonl. Intervals and
// p-values only; whether a difference is reported as a difference is the preregistration's decision sentence.
//
// --pair gbrain pairs trial by trial (same task, repetitions matched by order within the task) over two scopes:
// the primary endpoint (the capable families, scope_isolation, shared_channel, org_security and handoff, or
// --families) and all tasks as a secondary. A cell is the gbrain arm when its manifest entry has a truthy
// `gbrain` field or its id has a "gbrain" segment. A pair whose trial ended as model_error or infra_error on
// either side is excluded with its count published (methodology item 9). Holm runs across the harness pairs of
// one model as one family, each model its own family. The output, comparisons.gbrain.json, carries per pair the
// passed counts, the difference gbrain minus none with its interval, the per-task passes table, the discordant
// counts, the Holm-adjusted p, and cost and latency deltas (median USD and seconds per trial, total input tokens)
// from the trial usage. The minimum detectable difference for this design is scripts/paired-mdd.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, exactMcNemar, holmAdjusted, pairObservations, type Observation } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const results = arg('results');
if (!results || !existsSync(join(results, 'trials.jsonl'))) {
  console.error('usage: bun scripts/compare-run.ts --results <results/<run-id>> [--regraded] [--families a,b] [--seed N] [--draws N] [--against <results>] [--pair gbrain]');
  process.exit(2);
}
const pairMode = arg('pair');
if (pairMode !== undefined && pairMode !== 'gbrain') {
  console.error(`--pair takes "gbrain", not "${pairMode}"`);
  process.exit(2);
}
const seed = Number(arg('seed', '7'));
const draws = Number(arg('draws', '10000'));
const useRegraded = process.argv.includes('--regraded');
const familiesArg = arg('families');
const against = arg('against');
const readRows = (dir: string) => readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const rows = [...readRows(results), ...(against ? readRows(against) : [])];
const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; config?: string; split: 'dev' | 'heldout'; gbrain?: unknown }> };
const regraded = new Map<string, { grade: string; consent_violation: boolean }>();
if (useRegraded) {
  for (const l of readFileSync(join(results, 'trials.regraded.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l) as { trial_id: string; regraded: boolean; regraded_result?: { grade: string; consent_violation: boolean } };
    if (r.regraded && r.regraded_result) regraded.set(r.trial_id, r.regraded_result);
  }
}
const repoRoot = join(import.meta.dir, '..');
const familyOf = new Map<string, string>();
for (const t of rows) {
  if (familyOf.has(t.task)) continue;
  const split = manifest.cells.find((c) => c.id === t.cell)?.split ?? 'dev';
  familyOf.set(t.task, loadTask(join(repoRoot, 'tasks', 'multiuser', split, t.task)).family);
}
const families = familiesArg ? familiesArg.split(',').map((s) => s.trim()) : null;
const pass = (t: TrialRecord) => { const r = regraded.get(t.trial_id); const g = r ?? t; return g.grade === 'pass' && !g.consent_violation ? 1 : 0; };
const rep = (t: TrialRecord) => t.trial_id.split('/').at(-1)!;
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)}`;
const suffix = `${families ? '.' + families.join('-') : ''}${useRegraded ? '.regraded' : ''}.json`;

if (pairMode === 'gbrain') {
  const PRIMARY_FAMILIES = ['scope_isolation', 'shared_channel', 'org_security', 'handoff'];
  const EXCLUDED = new Set(['model_error', 'infra_error']);
  const isGbrainCell = (c: (typeof manifest.cells)[number]) => Boolean(c.gbrain) || /(^|-)gbrain(-|$)/.test(c.id);
  const present = manifest.cells.filter((c) => rows.some((t) => t.cell === c.id));
  const groups = new Map<string, typeof present>();
  for (const c of present) { const k = `${c.harness}|${c.config ?? ''}|${c.model}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const skipped: string[] = [];
  const cellPairs: Array<{ harness: string; config: string | null; model: string; none: string; gbrain: string }> = [];
  for (const [, cs] of groups) {
    const withG = cs.filter(isGbrainCell), without = cs.filter((c) => !isGbrainCell(c));
    const c = cs[0]!;
    if (withG.length !== 1 || without.length !== 1) { skipped.push(`${c.harness}${c.config ? ' ' + c.config : ''} on ${c.model}: ${withG.length} gbrain cell(s), ${without.length} without`); continue; }
    cellPairs.push({ harness: c.harness, config: c.config ?? null, model: c.model, none: without[0]!.id, gbrain: withG[0]!.id });
  }
  if (!cellPairs.length) {
    console.error(`--pair gbrain found no (harness, model) with one gbrain cell and one without${skipped.length ? ': ' + skipped.join('; ') : ''}`);
    process.exit(2);
  }
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
  const repIndex = (t: TrialRecord) => Number(rep(t).replace(/^r/, '')) || 0;
  const byTask = (cell: string, scopeRows: TrialRecord[]) => {
    const m = new Map<string, TrialRecord[]>();
    for (const t of scopeRows.filter((t) => t.cell === cell)) m.set(t.task, [...(m.get(t.task) ?? []), t]);
    for (const ts of m.values()) ts.sort((a, b) => repIndex(a) - repIndex(b));
    return m;
  };
  const scopes = [{ scope: 'primary', families: families ?? PRIMARY_FAMILIES }, { scope: 'all', families: null as string[] | null }];
  const out: Array<Record<string, unknown>> = [];
  const lines: string[] = [`Scope: within-run gbrain arm; grading ${useRegraded ? 'regraded' : 'as recorded'}; seed ${seed}, ${draws} draws.${skipped.length ? ' Not paired: ' + skipped.join('; ') + '.' : ''}`];
  for (const { scope, families: fams } of scopes) {
    const scopeRows = rows.filter((t) => !fams || fams.includes(familyOf.get(t.task)!));
    const stats = cellPairs.map((cp) => {
      const a = byTask(cp.none, scopeRows), b = byTask(cp.gbrain, scopeRows);
      const tasks = [...new Set([...a.keys(), ...b.keys()])].sort();
      const obsA: Observation[] = [], obsB: Observation[] = [];
      const excluded: Array<{ id: string; reason: string }> = [];
      const perTask = tasks.map((task) => {
        const ta = a.get(task) ?? [], tb = b.get(task) ?? [];
        const n = Math.max(ta.length, tb.length);
        for (let i = 0; i < n; i++) {
          const x = ta[i], y = tb[i];
          const id = `${task}/${i + 1}`;
          if (!x || !y) { obsA.push({ id, cluster: task, value: x ? pass(x) : null, eligible: !!x, reason: 'no trial in the none cell' }); obsB.push({ id, cluster: task, value: y ? pass(y) : null, eligible: !!y, reason: 'no trial in the gbrain cell' }); continue; }
          const reason = EXCLUDED.has(x.termination) ? `none ${x.termination}` : EXCLUDED.has(y.termination) ? `gbrain ${y.termination}` : null;
          if (reason) excluded.push({ id, reason });
          obsA.push({ id, cluster: task, value: reason ? null : pass(x), eligible: !reason, reason: reason ?? undefined });
          obsB.push({ id, cluster: task, value: reason ? null : pass(y), eligible: !reason, reason: reason ?? undefined });
        }
        return { task, family: familyOf.get(task)!, none: ta.filter((t) => pass(t) === 1).length, gbrain: tb.filter((t) => pass(t) === 1).length, reps: n };
      });
      const pairing = pairObservations(obsA, obsB);
      const d = clusteredPairedDelta(pairing.pairs, { seed, draws });
      const mc = exactMcNemar(pairing.pairs);
      const usageOf = (cell: string) => scopeRows.filter((t) => t.cell === cell);
      const ua = usageOf(cp.none), ub = usageOf(cp.gbrain);
      const usd = (ts: TrialRecord[]) => med(ts.map((t) => t.usage?.usd).filter((x): x is number => typeof x === 'number'));
      const secs = (ts: TrialRecord[]) => med(ts.map((t) => t.wall_ms / 1000));
      const tokens = (ts: TrialRecord[]) => ts.reduce((s, t) => s + (t.usage?.input_tokens ?? 0), 0);
      const minus = (x: number | null, y: number | null) => (x === null || y === null ? null : x - y);
      return {
        harness: cp.harness, config: cp.config, model: cp.model, cell_none: cp.none, cell_gbrain: cp.gbrain,
        n_trials: { none: ua.length, gbrain: ub.length }, passed: { none: ua.filter((t) => pass(t) === 1).length, gbrain: ub.filter((t) => pass(t) === 1).length },
        delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_clusters: d.n_clusters, n_pairs: d.n_pairs, mean_none: d.mean_a, mean_gbrain: d.mean_b,
        discordant: { gbrain_only_passed: mc.wins, none_only_passed: mc.losses, both_passed: mc.both_pass, both_failed: mc.both_fail },
        excluded, per_task: perTask,
        cost: { usd_median: { none: usd(ua), gbrain: usd(ub), delta: minus(usd(ub), usd(ua)) }, wall_s_median: { none: secs(ua), gbrain: secs(ub), delta: minus(secs(ub), secs(ua)) }, input_tokens_total: { none: tokens(ua), gbrain: tokens(ub), delta: tokens(ub) - tokens(ua) } },
      };
    });
    const holm = new Array<number>(stats.length);
    for (const model of new Set(stats.map((s) => s.model))) {
      const idx = stats.map((s, i) => (s.model === model ? i : -1)).filter((i) => i >= 0);
      const adj = holmAdjusted(idx.map((i) => stats[i]!.p));
      idx.forEach((i, k) => { holm[i] = adj[k]!; });
    }
    out.push({ scope, families: fams, holm_family: 'the harness pairs of one model', comparisons: stats.map((s, i) => ({ ...s, holm_p: holm[i] })) });
    lines.push('', `${scope === 'primary' ? `Primary endpoint, families ${fams!.join(', ')}` : 'All tasks (secondary)'}:`, '',
      '| Harness | Model | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...stats.map((s, i) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | ${s.model} | ${s.passed.none} / ${s.n_trials.none} | ${s.passed.gbrain} / ${s.n_trials.gbrain} | ${pts(s.delta)} [${s.ci95 ? `${pts(s.ci95[0])}, ${pts(s.ci95[1])}` : 'n/a'}] | ${s.p.toFixed(3)} (${s.p_method}) | ${holm[i]!.toFixed(3)} | ${s.n_clusters} | ${s.n_pairs} | ${s.excluded.length} | ${s.cost.usd_median.none?.toFixed(3) ?? 'n/a'}, ${s.cost.usd_median.gbrain?.toFixed(3) ?? 'n/a'} | ${s.cost.wall_s_median.none?.toFixed(0) ?? 'n/a'}, ${s.cost.wall_s_median.gbrain?.toFixed(0) ?? 'n/a'} | ${s.cost.input_tokens_total.none.toLocaleString()}, ${s.cost.input_tokens_total.gbrain.toLocaleString()} |`),
      '', '| Harness | Task | Family | none | gbrain |', '|---|---|---|---|---|',
      ...stats.flatMap((s) => s.per_task.map((t) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | \`${t.task}\` | ${t.family} | ${t.none}/${t.reps} | ${t.gbrain}/${t.reps} |`)));
  }
  console.log(lines.join('\n'));
  writeFileSync(join(results, `comparisons.gbrain${suffix}`), JSON.stringify({ pair: 'gbrain', grading: useRegraded ? 'regraded' : 'as recorded', seed, draws, not_paired: skipped, scopes: out }, null, 1) + '\n');
  process.exit(0);
}

const inScope = rows.filter((t) => !families || families.includes(familyOf.get(t.task)!));
const obs = (cell: string): Observation[] => inScope.filter((t) => t.cell === cell).map((t) => ({ id: `${t.task}/${rep(t)}`, cluster: t.task, value: pass(t), eligible: true }));
const cells = [...new Set(inScope.map((t) => t.cell))];
const pairs: Array<{ a: string; b: string }> = [];
if (against) {
  const other = new Set(readRows(against).map((t) => t.cell));
  const harnessOf = (cell: string) => cell.split('-')[0]!;
  for (const a of cells) if (!other.has(a)) for (const b of cells) if (other.has(b) && harnessOf(a) === harnessOf(b)) pairs.push({ a, b });
} else {
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) pairs.push({ a: cells[i]!, b: cells[j]! });
}
const deltas = pairs.map(({ a, b }) => {
  const pairing = pairObservations(obs(a), obs(b));
  const d = clusteredPairedDelta(pairing.pairs, { seed, draws });
  return { a, b, delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_clusters: d.n_clusters, n_pairs: d.n_pairs, mean_a: d.mean_a, mean_b: d.mean_b };
});
const adjusted = holmAdjusted(deltas.map((d) => d.p));
const lines = [
  `Scope: ${families ? `families ${families.join(', ')}` : 'all families'}; grading ${useRegraded ? 'regraded' : 'as recorded'}; seed ${seed}, ${draws} draws.`,
  '',
  '| A | B | Pass A | Pass B | B minus A (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs |',
  '|---|---|---|---|---|---|---|---|---|',
  ...deltas.map((d, i) => `| ${d.a} | ${d.b} | ${(100 * d.mean_a).toFixed(0)}% | ${(100 * d.mean_b).toFixed(0)}% | ${pts(d.delta)} [${d.ci95 ? `${pts(d.ci95[0])}, ${pts(d.ci95[1])}` : 'n/a'}] | ${d.p.toFixed(3)} (${d.p_method}) | ${adjusted[i]!.toFixed(3)} | ${d.n_clusters} | ${d.n_pairs} |`),
];
console.log(lines.join('\n'));
writeFileSync(join(results, `comparisons${against ? '.against-' + (readRows(against)[0]?.trial_id.split('/')[0] ?? 'other') : ''}${suffix}`), JSON.stringify({ scope: families, grading: useRegraded ? 'regraded' : 'as recorded', seed, draws, comparisons: deltas.map((d, i) => ({ ...d, holm_p: adjusted[i] })) }, null, 1) + '\n');
