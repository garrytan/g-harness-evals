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
//   bun scripts/compare-run.ts --results <run> --pair gbrain [--design ladder]
//                                                                     the install ladder (internal-task): each rung against its
//                                                                     ladder neighbour on three endpoints, see below
//
// Prints a Markdown table (delta = B minus A in pass-rate points, 95% cluster bootstrap interval, two-sided
// sign-flip p, Holm-adjusted p, clusters, pairs) and writes comparisons.json beside trials.jsonl. Intervals and
// p-values only; whether a difference is reported as a difference is the preregistration's decision sentence.
//
// --pair gbrain pairs trial by trial (same task, repetitions matched by order within the task) over two scopes:
// the primary endpoint (the capable families, scope_isolation, shared_channel, org_security and handoff, or
// --families) and all tasks as a secondary. A cell is the gbrain arm when its manifest entry has a truthy
// `gbrain` field or its id has a "gbrain" segment; every gbrain cell of a (harness, config, model) is paired against
// its one cell without gbrain, so an arm that differs in configuration (another preamble) is its own pair. A pair whose trial ended as model_error or infra_error on
// either side is excluded with its count published (methodology item 9). Holm runs across the harness pairs of
// one model as one family, each model its own family. The output, comparisons.gbrain.json, carries per pair the
// passed counts, the difference gbrain minus none with its interval, the per-task passes table, the discordant
// counts, the Holm-adjusted p, and cost and latency deltas (median USD and seconds per trial, total input tokens)
// from the trial usage. The minimum detectable difference for this design is scripts/paired-mdd.ts.
//
// The install ladder (internal-task, docs/gbrain-arm.md "The install ladder") is the other --pair gbrain design. Each cell's rung
// is read from its resolved gbrain configuration and preamble (scripts/gbrain-ladder.ts; no gbrain is none, a preamble
// other than the default makes a told rung), and each rung is paired against its ladder neighbour within (harness, config,
// model): mcp against none, told and docs against mcp, installer, verbs-told, semantic-told and told-company against told,
// docs-semantic against docs, told-scoped against told-company (gbrain#7481). A rung whose base cell is absent, two cells on one rung, or a cell on no rung is a refusal (exit 2) naming the
// cells. Three endpoints, each 1 or 0 per trial: pass (grade pass and no consent violation), gbrain use (at least one
// gbrain tools/call in the record's gbrain.events.calls) and a cross-scope read via gbrain (the no_cross_scope_reads
// evidence names a gbrain read); the same trial-by-trial pairing and task-clustered estimator as the arm, trials that
// ended as model_error, infra_error or exam_fault excluded on both sides with their count published. Holm runs per
// endpoint over the comparisons of one harness on one model: six for pass; five for use and cross-scope, where mcp
// against none is degenerate (the none cell is 0 by construction) and is reported as the mcp cell's rate with its
// task-clustered interval and no test. The none table is descriptive: every rung against its none cell, intervals and no
// test. Cost per trial, wall per turn and the harness's own input tokens are paired differences (rung minus base, mean
// over pairs) with task-clustered intervals over all tasks, each row labelled with the shards the two cells ran on
// (shards.json beside trials.jsonl, written by scripts/merge-shards.ts: "same machine" or "different machines"), because wall time
// on two machines is confounded with the machine. The design is chosen from the manifest: any verbs, gbrain-docs,
// gbrain-installer or embedded cell makes it the ladder, otherwise the arm; --design arm|ladder overrides. comparisons.gbrain.json carries
// design, rungs, the per-scope endpoints, the cost rows and the none table.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TURN_HOOK_APPLIED, type GbrainCellConfig, type TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, exactMcNemar, holmAdjusted, pairObservations, type Observation } from '../runner/stats/paired.ts';
import { loadTask } from '../runner/grade/task.ts';
import { resolveGbrain, taskDirFor } from '../runner/run.ts';
import { ENDPOINTS, ENDPOINT_LABEL, endpointValue, ladderPairs, readShards, shardsLabel, type Endpoint } from './gbrain-ladder.ts';

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
const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; config?: string; split: 'dev' | 'heldout'; task_set?: string; gbrain?: GbrainCellConfig; preamble?: string }> };
const regraded = new Map<string, { grade: string; consent_violation: boolean; predicates?: TrialRecord['predicates'] }>();
if (useRegraded) {
  for (const l of readFileSync(join(results, 'trials.regraded.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l) as { trial_id: string; regraded: boolean; regraded_result?: { grade: string; consent_violation: boolean }; predicates?: TrialRecord['predicates'] };
    if (r.regraded && r.regraded_result) regraded.set(r.trial_id, { ...r.regraded_result, predicates: r.predicates });
  }
}
const repoRoot = join(import.meta.dir, '..');
const familyOf = new Map<string, string>();
for (const t of rows) {
  if (familyOf.has(t.task)) continue;
  const cell = manifest.cells.find((c) => c.id === t.cell) ?? { split: 'dev' as const };
  familyOf.set(t.task, loadTask(taskDirFor(cell, t.task, join(repoRoot, 'tasks'))).family);
}
const families = familiesArg ? familiesArg.split(',').map((s) => s.trim()) : null;
const pass = (t: TrialRecord) => { const r = regraded.get(t.trial_id); const g = r ?? t; return g.grade === 'pass' && !g.consent_violation ? 1 : 0; };
const rep = (t: TrialRecord) => t.trial_id.split('/').at(-1)!;
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)}`;
const suffix = `${families ? '.' + families.join('-') : ''}${useRegraded ? '.regraded' : ''}.json`;

if (pairMode === 'gbrain') {
  const PRIMARY_FAMILIES = ['scope_isolation', 'shared_channel', 'org_security', 'handoff'];
  const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
  const isGbrainCell = (c: (typeof manifest.cells)[number]) => Boolean(c.gbrain) || /(^|-)gbrain(-|$)/.test(c.id);
  const present = manifest.cells.filter((c) => rows.some((t) => t.cell === c.id));
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
  const repIndex = (t: TrialRecord) => Number(rep(t).replace(/^r/, '')) || 0;
  const byTask = (cell: string, scopeRows: TrialRecord[]) => {
    const m = new Map<string, TrialRecord[]>();
    for (const t of scopeRows.filter((t) => t.cell === cell)) m.set(t.task, [...(m.get(t.task) ?? []), t]);
    for (const ts of m.values()) ts.sort((a, b) => repIndex(a) - repIndex(b));
    return m;
  };
  const scopes = [{ scope: 'primary', families: families ?? PRIMARY_FAMILIES }, { scope: 'all', families: null as string[] | null }];
  const designArg = arg('design');
  if (designArg !== undefined && designArg !== 'arm' && designArg !== 'ladder') { console.error(`--design takes "arm" or "ladder", not "${designArg}"`); process.exit(2); }
  const ladderShaped = present.some((c) => c.gbrain?.surface && (resolveGbrain(c.gbrain).surface === 'verbs' || resolveGbrain(c.gbrain).install === 'gbrain-docs' || resolveGbrain(c.gbrain).install === 'gbrain-installer' || resolveGbrain(c.gbrain).embeddings !== 'off'));
  const design = designArg ?? (ladderShaped ? 'ladder' : 'arm');

  const installerPresent = present.filter((c) => c.gbrain && resolveGbrain(c.gbrain).install === 'gbrain-installer').map((c) => c.id);
  if (design === 'arm' && installerPresent.length) { console.error(`--pair gbrain (arm): installer cells ${installerPresent.join(', ')} need the ladder design, whose pairing leaves a trial whose installer did not take out of the pairs; drop --design arm`); process.exit(2); }
  if (design === 'ladder') {
    const shards = readShards(results);
    const ladder = ladderPairs(present);
    if (ladder.problems.length || !ladder.pairs.length) {
      console.error(`--pair gbrain (ladder): ${[...ladder.problems, ...(ladder.pairs.length ? [] : ['no neighbour pair found']), ...ladder.unpaired].join('; ')}`);
      process.exit(2);
    }
    const viewOf = (t: TrialRecord) => { const r = regraded.get(t.trial_id); return { grade: r?.grade ?? t.grade, consent_violation: r?.consent_violation ?? t.consent_violation, predicates: r?.predicates ?? t.predicates }; };
    /** gbrain-installer-hook-2026-10's preregistration: a trial of an installer cell whose installer did not take (no install
     *  record, or a per-turn hook the harness did not report loaded or healthy; the adapter refuses that with HE-ADAPTER-006 before
     *  ready, so the trial is also harness_error) leaves the paired endpoints with its reason, as a model or infra error does. */
    const installerCells = new Set(present.filter((c) => c.gbrain && resolveGbrain(c.gbrain).install === 'gbrain-installer').map((c) => c.id));
    const notApplied = (t: TrialRecord): string | null => {
      if (!installerCells.has(t.cell)) return null;
      const b = t.gbrain?.install_bundle;
      if (!b) return 'installer not applied (no install record)';
      if (b.turn_hook && !TURN_HOOK_APPLIED.includes(b.turn_hook.status)) return `installer hook ${b.turn_hook.status}`;
      return null;
    };
    const scored = (t: TrialRecord) => !EXCLUDED.has(t.termination) && !notApplied(t);
    const why = (t: TrialRecord) => notApplied(t) ?? t.termination;
    /** Trial-by-trial pairing of two cells (same task, repetitions by order) over any per-trial value; a pair with a
     *  model, infra or exam error, an installer that did not take, a missing trial or a missing value on either side is excluded
     *  with its reason. */
    const paired = (base: string, rung: string, scopeRows: TrialRecord[], value: (t: TrialRecord) => number | null) => {
      const a = byTask(base, scopeRows), b = byTask(rung, scopeRows);
      const tasks = [...new Set([...a.keys(), ...b.keys()])].sort();
      const obsA: Observation[] = [], obsB: Observation[] = [];
      const excluded: Array<{ id: string; reason: string }> = [];
      const perTask = tasks.map((task) => {
        const ta = a.get(task) ?? [], tb = b.get(task) ?? [];
        const n = Math.max(ta.length, tb.length);
        for (let i = 0; i < n; i++) {
          const x = ta[i], y = tb[i];
          const id = `${task}/${i + 1}`;
          const vx = x && scored(x) ? value(x) : null, vy = y && scored(y) ? value(y) : null;
          const reason = !x ? 'no trial in the base cell' : !y ? 'no trial in the rung cell' : !scored(x) ? `base ${why(x)}` : !scored(y) ? `rung ${why(y)}` : vx === null ? 'no value in the base cell' : vy === null ? 'no value in the rung cell' : null;
          if (reason) excluded.push({ id, reason });
          obsA.push({ id, cluster: task, value: reason ? null : vx, eligible: !reason, reason: reason ?? undefined });
          obsB.push({ id, cluster: task, value: reason ? null : vy, eligible: !reason, reason: reason ?? undefined });
        }
        const positive = (ts: TrialRecord[]) => ts.filter((t) => scored(t) && value(t) === 1).length;
        return { task, family: familyOf.get(task)!, base: positive(ta), rung: positive(tb), scored: { base: ta.filter(scored).length, rung: tb.filter(scored).length } };
      });
      const pairs = pairObservations(obsA, obsB).pairs;
      if (!pairs.length) return { d: null, mc: null, excluded, perTask };
      const binary = pairs.every((p) => (p.a === 0 || p.a === 1) && (p.b === 0 || p.b === 1));
      return { d: clusteredPairedDelta(pairs, { seed, draws }), mc: binary ? exactMcNemar(pairs) : null, excluded, perTask };
    };
    const ci = (c: [number, number] | null, f: (x: number) => string) => (c ? `[${f(c[0])}, ${f(c[1])}]` : '[n/a]');
    const lines: string[] = [`Scope: the install ladder (internal-task), each rung against its ladder neighbour within harness and model; grading ${useRegraded ? 'regraded' : 'as recorded'}; seed ${seed}, ${draws} draws; shards ${shards ? 'from shards.json' : 'unknown (no shards.json)'}.${ladder.unpaired.length ? ' Not paired: ' + ladder.unpaired.join('; ') + '.' : ''}`, '',
      '| Cell | Harness | Model | Rung | Configuration | Shard |', '|---|---|---|---|---|---|',
      ...ladder.rungs.map((r) => `| \`${r.cell}\` | ${r.harness}${r.config ? ' ' + r.config : ''} | ${r.model} | ${r.rung} | ${r.configuration} | ${shards?.cells[r.cell] ?? 'unknown'} |`)];
    const out: Array<Record<string, unknown>> = [];
    for (const { scope, families: fams } of scopes) {
      const scopeRows = rows.filter((t) => !fams || fams.includes(familyOf.get(t.task)!));
      const endpoints: Record<string, unknown> = {};
      lines.push('', `${scope === 'primary' ? `Primary families ${fams!.join(', ')}` : 'All tasks (secondary)'}:`);
      for (const endpoint of ENDPOINTS) {
        const value = (t: TrialRecord) => endpointValue(endpoint, t, viewOf(t));
        const stats = ladder.pairs.map((cp) => {
          const { d, mc, excluded, perTask } = paired(cp.base_cell, cp.cell, scopeRows, value);
          const tested = !(endpoint !== 'pass' && cp.base_rung === 'none');
          const cellRows = (cell: string) => scopeRows.filter((t) => t.cell === cell && scored(t));
          return {
            ...cp, endpoint, tested, test_note: tested ? null : 'the none cell is 0 by construction: the mcp cell\'s rate with its task-clustered interval, no test',
            scored: { base: cellRows(cp.base_cell).length, rung: cellRows(cp.cell).length }, positive: { base: cellRows(cp.base_cell).filter((t) => value(t) === 1).length, rung: cellRows(cp.cell).filter((t) => value(t) === 1).length },
            delta: d?.delta ?? null, ci95: d?.ci95 ?? null, p: tested ? d?.p_two_sided ?? null : null, p_method: tested ? d?.p_method ?? null : null, holm_p: null as number | null, holm_family_size: 0,
            n_clusters: d?.n_clusters ?? 0, n_pairs: d?.n_pairs ?? 0, mean_base: d?.mean_a ?? null, mean_rung: d?.mean_b ?? null,
            discordant: mc ? { rung_only: mc.wins, base_only: mc.losses, both: mc.both_pass, neither: mc.both_fail } : null, excluded, per_task: perTask,
          };
        });
        for (const key of new Set(stats.map((s) => `${s.harness}|${s.config ?? ''}|${s.model}`))) {
          const idx = stats.map((s, i) => (`${s.harness}|${s.config ?? ''}|${s.model}` === key && s.tested && s.p !== null ? i : -1)).filter((i) => i >= 0);
          const adj = holmAdjusted(idx.map((i) => stats[i]!.p!));
          idx.forEach((i, k) => { stats[i]!.holm_p = adj[k]!; stats[i]!.holm_family_size = idx.length; });
        }
        endpoints[endpoint] = { label: ENDPOINT_LABEL[endpoint], holm_family: 'the tested comparisons of one harness on one model', comparisons: stats };
        lines.push('', `Endpoint: ${ENDPOINT_LABEL[endpoint]}`, '',
          '| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |',
          '|---|---|---|---|---|---|---|---|---|---|---|',
          ...stats.map((s) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | ${s.model} | ${s.rung} vs ${s.base_rung} | ${s.positive.base} / ${s.scored.base} | ${s.positive.rung} / ${s.scored.rung} | ${s.delta === null ? 'n/a' : pts(s.delta)} ${ci(s.ci95, pts)} | ${s.tested ? (s.p === null ? 'n/a' : `${s.p.toFixed(3)} (${s.p_method})`) : 'no test (none is 0 by construction)'} | ${s.holm_p === null ? 'n/a' : `${s.holm_p.toFixed(3)} (${s.holm_family_size})`} | ${s.n_clusters} | ${s.n_pairs} | ${s.excluded.length} |`));
      }
      out.push({ scope, families: fams, endpoints });
    }
    // Cost, wall per turn and the harness's own input tokens: paired differences over all tasks, with the machine label.
    const metrics = [
      { key: 'usd_per_trial', label: 'USD per trial', value: (t: TrialRecord) => (typeof t.usage?.usd === 'number' ? t.usage.usd : null), fmt: (x: number) => x.toFixed(4) },
      { key: 'wall_s_per_turn', label: 'Wall s per turn', value: (t: TrialRecord) => t.wall_ms / 1000 / Math.max(1, t.turns?.run ?? 1), fmt: (x: number) => x.toFixed(1) },
      { key: 'harness_input_tokens', label: 'Harness input tokens per trial', value: (t: TrialRecord) => (typeof t.usage?.input_tokens === 'number' ? t.usage.input_tokens : null), fmt: (x: number) => Math.round(x).toLocaleString() },
    ] as const;
    const costRows = ladder.pairs.map((cp) => {
      const row: Record<string, unknown> = { ...cp, machines: shardsLabel(shards, cp.base_cell, cp.cell), shards: { base: shards?.cells[cp.base_cell] ?? null, rung: shards?.cells[cp.cell] ?? null } };
      for (const m of metrics) {
        const { d, excluded } = paired(cp.base_cell, cp.cell, rows, m.value);
        const cellValues = (cell: string) => rows.filter((t) => t.cell === cell && scored(t)).map(m.value).filter((x): x is number => x !== null);
        row[m.key] = { median: { base: med(cellValues(cp.base_cell)), rung: med(cellValues(cp.cell)) }, delta: d?.delta ?? null, ci95: d?.ci95 ?? null, n_pairs: d?.n_pairs ?? 0, n_clusters: d?.n_clusters ?? 0, excluded: excluded.length };
      }
      return row;
    });
    const show = (m: (typeof metrics)[number], v: { median: { base: number | null; rung: number | null }; delta: number | null; ci95: [number, number] | null }) => `${v.median.base === null ? 'n/a' : m.fmt(v.median.base)}, ${v.median.rung === null ? 'n/a' : m.fmt(v.median.rung)}; ${v.delta === null ? 'n/a' : (v.delta >= 0 ? '+' : '') + m.fmt(v.delta)} ${ci(v.ci95, (x) => (x >= 0 ? '+' : '') + m.fmt(x))}`;
    lines.push('', 'Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.', '',
      '| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |', '|---|---|---|---|---|---|---|---|',
      ...costRows.map((r) => `| ${r.harness}${r.config ? ' ' + r.config : ''} | ${r.model} | ${r.rung} vs ${r.base_rung} | ${show(metrics[0], r.usd_per_trial as never)} | ${show(metrics[1], r.wall_s_per_turn as never)} | ${show(metrics[2], r.harness_input_tokens as never)} | ${(r.usd_per_trial as { n_pairs: number }).n_pairs} | ${r.machines} |`));
    // The none table: every rung against the none cell of its harness and model, descriptive, over all tasks.
    const noneOf = new Map<string, string>();
    for (const r of ladder.rungs) if (r.rung === 'none') noneOf.set(`${r.harness}|${r.config ?? ''}|${r.model}`, r.cell);
    const noneTable = ladder.rungs.filter((r) => r.rung !== 'none').map((r) => {
      const none = noneOf.get(`${r.harness}|${r.config ?? ''}|${r.model}`) ?? null;
      const row: Record<string, unknown> = { cell: r.cell, harness: r.harness, config: r.config, model: r.model, rung: r.rung, none_cell: none };
      for (const endpoint of ENDPOINTS) {
        if (!none) { row[endpoint] = null; continue; }
        const value = (t: TrialRecord) => endpointValue(endpoint, t, viewOf(t));
        const { d, excluded } = paired(none, r.cell, rows, value);
        const cellRows = (cell: string) => rows.filter((t) => t.cell === cell && scored(t));
        row[endpoint] = { positive: { none: cellRows(none).filter((t) => value(t) === 1).length, rung: cellRows(r.cell).filter((t) => value(t) === 1).length }, scored: { none: cellRows(none).length, rung: cellRows(r.cell).length }, delta: d?.delta ?? null, ci95: d?.ci95 ?? null, n_pairs: d?.n_pairs ?? 0, n_clusters: d?.n_clusters ?? 0, excluded: excluded.length };
      }
      return row;
    });
    const ep = (v: { positive: { none: number; rung: number }; scored: { none: number; rung: number }; delta: number | null; ci95: [number, number] | null } | null) => (v ? `${v.positive.none} / ${v.scored.none}, ${v.positive.rung} / ${v.scored.rung}; ${v.delta === null ? 'n/a' : pts(v.delta)} ${ci(v.ci95, pts)}` : 'no none cell');
    lines.push('', 'Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].', '',
      '| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |', '|---|---|---|---|---|---|---|---|',
      ...noneTable.map((r) => `| ${r.harness}${r.config ? ' ' + r.config : ''} | ${r.model} | ${r.rung} | \`${r.cell}\` | ${r.none_cell ? `\`${r.none_cell}\`` : 'none'} | ${ep(r.pass as never)} | ${ep(r.use as never)} | ${ep(r.cross_scope as never)} |`));
    console.log(lines.join('\n'));
    writeFileSync(join(results, `comparisons.gbrain${suffix}`), JSON.stringify({ pair: 'gbrain', design: 'ladder', grading: useRegraded ? 'regraded' : 'as recorded', seed, draws, shards, exclusions: [...EXCLUDED, ...(installerCells.size ? ['installer_not_applied'] : [])], not_paired: ladder.unpaired, rungs: ladder.rungs, pairs: ladder.pairs, scopes: out, cost: costRows, none_table: noneTable }, null, 1) + '\n');
    process.exit(0);
  }

  const groups = new Map<string, typeof present>();
  for (const c of present) { const k = `${c.harness}|${c.config ?? ''}|${c.model}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const skipped: string[] = [];
  const cellPairs: Array<{ harness: string; config: string | null; model: string; none: string; gbrain: string }> = [];
  for (const [, cs] of groups) {
    const withG = cs.filter(isGbrainCell), without = cs.filter((c) => !isGbrainCell(c));
    const c = cs[0]!;
    if (withG.length < 1 || without.length !== 1) { skipped.push(`${c.harness}${c.config ? ' ' + c.config : ''} on ${c.model}: ${withG.length} gbrain cell(s), ${without.length} without`); continue; }
    for (const g of withG) cellPairs.push({ harness: c.harness, config: c.config ?? null, model: c.model, none: without[0]!.id, gbrain: g.id });
  }
  if (!cellPairs.length) {
    console.error(`--pair gbrain found no (harness, model) with a gbrain cell and exactly one without${skipped.length ? ': ' + skipped.join('; ') : ''}`);
    process.exit(2);
  }
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
      '| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...stats.map((s, i) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | ${s.model} | \`${s.cell_gbrain}\` | ${s.passed.none} / ${s.n_trials.none} | ${s.passed.gbrain} / ${s.n_trials.gbrain} | ${pts(s.delta)} [${s.ci95 ? `${pts(s.ci95[0])}, ${pts(s.ci95[1])}` : 'n/a'}] | ${s.p.toFixed(3)} (${s.p_method}) | ${holm[i]!.toFixed(3)} | ${s.n_clusters} | ${s.n_pairs} | ${s.excluded.length} | ${s.cost.usd_median.none?.toFixed(3) ?? 'n/a'}, ${s.cost.usd_median.gbrain?.toFixed(3) ?? 'n/a'} | ${s.cost.wall_s_median.none?.toFixed(0) ?? 'n/a'}, ${s.cost.wall_s_median.gbrain?.toFixed(0) ?? 'n/a'} | ${s.cost.input_tokens_total.none.toLocaleString()}, ${s.cost.input_tokens_total.gbrain.toLocaleString()} |`),
      '', '| Harness | gbrain cell | Task | Family | none | gbrain |', '|---|---|---|---|---|---|',
      ...stats.flatMap((s) => s.per_task.map((t) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | \`${s.cell_gbrain}\` | \`${t.task}\` | ${t.family} | ${t.none}/${t.reps} | ${t.gbrain}/${t.reps} |`)));
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
