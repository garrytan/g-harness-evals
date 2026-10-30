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
// gbrain-memory-2026-10 (the preregistration's Endpoints item 1, added for its results pull request): each entry of the arm's
// `excluded` array carries id, task, side (none, gbrain or both), reason and gbrain_calls (the gbrain trial's gbrain.events.calls
// for that pair, null when it is missing or has no gbrain block), printed as an "Excluded pairs" table under each scope's per-task table; a missing
// repetition on one side is listed the same way instead of stopping the pairing. The primary scope also carries one preregistered
// sensitivity row per (harness, config, model), `sensitivity.faults_as_failures`: the same estimate with the gbrain cell's
// ingestion faults (termination exam_fault with error HE-GBRAIN-011, which only the live arm can produce) counted as live
// failures (pass 0) instead of excluded, the none side at its real value, with the number of pairs it re-included and its own
// Holm family across the harness pairs of one model; with no faulted pair it equals the main estimate and says so. It is an
// extra row under the main row in the Markdown table and a key beside the main estimate in the JSON; every other key is unchanged.
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

// internal-task phase 3: a run planned with a sealed root (manifest.json has a "sealed" block) reads its sealed cells' task
// families from <sealed-root>/tasks, so it is compared inside custody with --sealed-root <dir> (docs/sealed-custody.md);
// without it the run is refused with HE-SEALED-001. Every other run is unchanged. trials.jsonl (of --results and --against)
// and manifest.json are read before the sealed guard is up, so a line that is not JSON is HE-RUN-007 naming the file, the
// line and the parser's error class, never the parser's message (which quotes the line). With --against both manifests are
// read before any trial row: a sealed run against an unsealed one, either way round, is HE-SEALED-001, and two sealed runs
// of different openings are HE-SEALED-003, so a sealed --against never reaches the public task lookup.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TURN_HOOK_APPLIED, type GbrainCellConfig, type TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, exactMcNemar, holmAdjusted, nonInferiorityP, pairObservations, type Observation, type PairedDelta } from '../runner/stats/paired.ts';
import { sealedGuard } from '../runner/heldout/guard.ts';
import { openingDiff, readJsonFile, readJsonLines, type OpeningReceipt } from '../runner/heldout/sealed.ts';
import { RunnerError } from '../runner/errors.ts';
import { taskFamily } from '../runner/grade/task.ts';
import { isSealedCell, resolveGbrain, taskDirFor } from '../runner/run.ts';
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
const parsed = <T>(read: () => T): T => { try { return read(); } catch (e) { if (!(e instanceof RunnerError)) throw e; console.error(e.message); process.exit(2); } };
const readRows = (dir: string) => parsed(() => readJsonLines<TrialRecord>(join(dir, 'trials.jsonl')));
type RunManifest = { cells: Array<{ id: string; harness: string; model: string; config?: string; split: 'dev' | 'heldout'; task_set?: string; gbrain?: GbrainCellConfig; preamble?: string }>; sealed?: { set: string; receipt: OpeningReceipt } };
const manifest = parsed(() => readJsonFile<RunManifest>(join(results, 'manifest.json')));
if (against && !existsSync(join(against, 'manifest.json'))) { console.error(`--against ${against} has no manifest.json; compare-run reads both runs' manifests to check how each was planned`); process.exit(2); }
const againstManifest = against ? parsed(() => readJsonFile<RunManifest>(join(against, 'manifest.json'))) : undefined;
if (against && !manifest.sealed !== !againstManifest!.sealed) { console.error(`HE-SEALED-001 ${manifest.sealed ? results : against} was planned with a sealed root and ${manifest.sealed ? against : results} without one; --results and --against are two runs planned the same way, and a sealed --against is compared only with its own opening inside custody (docs/sealed-custody.md)`); process.exit(2); }
if (manifest.sealed && againstManifest?.sealed) {
  const differs = manifest.sealed.set !== againstManifest.sealed.set ? ['set'] : openingDiff(manifest.sealed.receipt, againstManifest.sealed.receipt);
  if (differs.length) { console.error(`HE-SEALED-003 --against ${against} was planned with another opening than --results ${results} (it differs in ${differs.join(', ')}); a sealed run is compared only with its own opening`); process.exit(2); }
}
const rows = [...readRows(results), ...(against ? readRows(against) : [])];
const sealedRoot = arg('sealed-root');
if (manifest.sealed && !sealedRoot) { console.error(`HE-SEALED-001 ${results} was planned with a sealed root (set ${manifest.sealed.set}); compare it inside custody with --sealed-root <the opened root> (docs/sealed-custody.md)`); process.exit(2); }
if (manifest.sealed && sealedRoot) {
  const g = sealedGuard({ root: sealedRoot, set: manifest.sealed.set, repoRoot: process.cwd(), preregJson: (manifest.sealed as { receipt?: { prereg_json?: string } }).receipt?.prereg_json, logFile: join(results, 'compare-run.sealed.log'), allow: [], label: 'scripts/compare-run.ts' });
  g.say(`compare-run: sealed run (set ${manifest.sealed.set}); the comparisons file is written beside trials.jsonl and the console tables go to ${g.logFile} (custody only)`);
}
// internal-task phase 3: a sealed opening's noninferiority claims enter its Holm family with a one-sided p against their margin.
// --margin <cell a>,<cell b>,<margin>,<higher|lower>[,<endpoint>] (repeatable; the margin a fraction, 0.05 is five points)
// adds noninferiority {margin, direction, p} to the comparison of a against b (b minus a), p from nonInferiorityP over the
// same cluster bootstrap as the interval. scripts/sealed/export.ts passes one per noninferiority claim.
const margins = process.argv.flatMap((x, i) => (x === '--margin' ? [process.argv[i + 1] ?? ''] : [])).map((s) => {
  const [a, b, m, direction, endpoint] = s.split(',');
  if (!a || !b || !(Number(m) >= 0) || (direction !== 'higher' && direction !== 'lower')) { console.error(`--margin takes <cell a>,<cell b>,<margin >= 0>,<higher|lower>[,<endpoint>], not "${s}"`); process.exit(2); }
  return { a, b, margin: Number(m), direction: direction as 'higher' | 'lower', endpoint };
});
const noninferiority = (a: string, b: string, d: PairedDelta | null | undefined, endpoint?: string) => {
  const spec = margins.find((x) => x.a === a && x.b === b && (!x.endpoint || x.endpoint === endpoint));
  return spec && d ? { noninferiority: { margin: spec.margin, direction: spec.direction, p: nonInferiorityP(d, spec.margin, spec.direction) } } : {};
};
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
  familyOf.set(t.task, taskFamily(taskDirFor(cell, t.task, isSealedCell(cell, manifest.sealed?.set) ? join(sealedRoot!, 'tasks') : join(repoRoot, 'tasks'))));
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
            n_clusters: d?.n_clusters ?? 0, n_pairs: d?.n_pairs ?? 0, mean_base: d?.mean_a ?? null, mean_rung: d?.mean_b ?? null, ...noninferiority(cp.base_cell, cp.cell, d, endpoint),
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
  /** gbrain-memory-2026-10 (Endpoints item 1): an excluded pair carries its task, the side that dropped it (none, gbrain, or both),
   *  the reason and the gbrain cell's call count for that pair (the gbrain trial's gbrain.events.calls, null when that trial
   *  is missing or has no gbrain block; the none cell never calls gbrain). A missing repetition on one side is listed the same
   *  way, so a partial cell pairs instead of raising PairingError. */
  type ExcludedPair = { id: string; task: string; side: 'none' | 'gbrain' | 'both'; reason: string; gbrain_calls: number | null };
  /** The live arm's ingestion fault: HE-GBRAIN-011 ends a trial as exam_fault and occurs in the gbrain cell only. */
  const isIngestFault = (t: TrialRecord) => t.termination === 'exam_fault' && /\bHE-GBRAIN-011\b/.test(t.error ?? '');
  const callsOf = (t: TrialRecord | undefined) => (t?.gbrain ? t.gbrain.events.calls : null);
  /** Pairs the two cells trial by trial and runs the estimator. With faultsAsFailures (the preregistered sensitivity row), a
   *  gbrain-cell trial that ended as an ingestion fault counts as a live failure (pass 0) and its pair stays in whenever the
   *  none side is scored; every other exclusion is unchanged. */
  const estimate = (cp: (typeof cellPairs)[number], scopeRows: TrialRecord[], faultsAsFailures: boolean) => {
    const a = byTask(cp.none, scopeRows), b = byTask(cp.gbrain, scopeRows);
    const tasks = [...new Set([...a.keys(), ...b.keys()])].sort();
    const obsA: Observation[] = [], obsB: Observation[] = [];
    const excluded: ExcludedPair[] = [];
    let faulted = 0;
    const perTask = tasks.map((task) => {
      const ta = a.get(task) ?? [], tb = b.get(task) ?? [];
      const n = Math.max(ta.length, tb.length);
      for (let i = 0; i < n; i++) {
        const x = ta[i], y = tb[i];
        const id = `${task}/${i + 1}`;
        const noneWhy = !x ? 'no trial in the none cell' : EXCLUDED.has(x.termination) ? `none ${x.termination}` : null;
        const faultKept = faultsAsFailures && !noneWhy && !!y && isIngestFault(y);
        const gbrainWhy = !y ? 'no trial in the gbrain cell' : faultKept ? null : EXCLUDED.has(y.termination) ? `gbrain ${y.termination}` : null;
        if (faultKept) faulted += 1;
        const reason = [noneWhy, gbrainWhy].filter((r): r is string => !!r).join('; ') || null;
        if (reason) excluded.push({ id, task, side: noneWhy && gbrainWhy ? 'both' : noneWhy ? 'none' : 'gbrain', reason, gbrain_calls: callsOf(y) });
        obsA.push({ id, cluster: task, value: reason ? null : pass(x!), eligible: !reason, reason: reason ?? undefined });
        obsB.push({ id, cluster: task, value: reason ? null : faultKept ? 0 : pass(y!), eligible: !reason, reason: reason ?? undefined });
      }
      return { task, family: familyOf.get(task)!, none: ta.filter((t) => pass(t) === 1).length, gbrain: tb.filter((t) => pass(t) === 1).length, reps: n };
    });
    const pairing = pairObservations(obsA, obsB);
    const d = clusteredPairedDelta(pairing.pairs, { seed, draws });
    const mc = exactMcNemar(pairing.pairs);
    return {
      delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_clusters: d.n_clusters, n_pairs: d.n_pairs, mean_none: d.mean_a, mean_gbrain: d.mean_b, ...noninferiority(cp.none, cp.gbrain, d),
      discordant: { gbrain_only_passed: mc.wins, none_only_passed: mc.losses, both_passed: mc.both_pass, both_failed: mc.both_fail },
      excluded, per_task: perTask, faulted,
    };
  };
  const out: Array<Record<string, unknown>> = [];
  const lines: string[] = [`Scope: within-run gbrain arm; grading ${useRegraded ? 'regraded' : 'as recorded'}; seed ${seed}, ${draws} draws.${skipped.length ? ' Not paired: ' + skipped.join('; ') + '.' : ''}`];
  for (const { scope, families: fams } of scopes) {
    const scopeRows = rows.filter((t) => !fams || fams.includes(familyOf.get(t.task)!));
    const stats = cellPairs.map((cp) => {
      const { faulted: _main, ...main } = estimate(cp, scopeRows, false);
      const usageOf = (cell: string) => scopeRows.filter((t) => t.cell === cell);
      const ua = usageOf(cp.none), ub = usageOf(cp.gbrain);
      const usd = (ts: TrialRecord[]) => med(ts.map((t) => t.usage?.usd).filter((x): x is number => typeof x === 'number'));
      const secs = (ts: TrialRecord[]) => med(ts.map((t) => t.wall_ms / 1000));
      const tokens = (ts: TrialRecord[]) => ts.reduce((s, t) => s + (t.usage?.input_tokens ?? 0), 0);
      const minus = (x: number | null, y: number | null) => (x === null || y === null ? null : x - y);
      const passed = { none: ua.filter((t) => pass(t) === 1).length, gbrain: ub.filter((t) => pass(t) === 1).length };
      // The preregistered sensitivity row, primary scope only: the same estimate with the live arm's HE-GBRAIN-011 faults
      // counted as live failures instead of excluded. With no faulted pair it is the main estimate and says so.
      const sens = scope === 'primary' ? estimate(cp, scopeRows, true) : null;
      const sensitivity = sens ? { faults_as_failures: {
        label: 'HE-GBRAIN-011 faults in the gbrain cell counted as live failures (pass 0), the none side at its real value',
        passed, delta: sens.delta, ci95: sens.ci95, p: sens.p, p_method: sens.p_method, n_clusters: sens.n_clusters, n_pairs: sens.n_pairs, mean_none: sens.mean_none, mean_gbrain: sens.mean_gbrain,
        discordant: sens.discordant, holm_p: null as number | null, holm_family: 'the sensitivity rows of the harness pairs of one model', excluded: sens.excluded.length,
        faulted_pairs: sens.faulted, equals_main: sens.faulted === 0, note: sens.faulted === 0 ? 'no faulted pair: equals the main estimate' : `${sens.faulted} faulted pair(s) re-included as live failures`,
      } } : null;
      return {
        harness: cp.harness, config: cp.config, model: cp.model, cell_none: cp.none, cell_gbrain: cp.gbrain,
        n_trials: { none: ua.length, gbrain: ub.length }, passed,
        ...main,
        cost: { usd_median: { none: usd(ua), gbrain: usd(ub), delta: minus(usd(ub), usd(ua)) }, wall_s_median: { none: secs(ua), gbrain: secs(ub), delta: minus(secs(ub), secs(ua)) }, input_tokens_total: { none: tokens(ua), gbrain: tokens(ub), delta: tokens(ub) - tokens(ua) } },
        ...(sensitivity ? { sensitivity } : {}),
      };
    });
    const holm = new Array<number>(stats.length);
    for (const model of new Set(stats.map((s) => s.model))) {
      const idx = stats.map((s, i) => (s.model === model ? i : -1)).filter((i) => i >= 0);
      const adj = holmAdjusted(idx.map((i) => stats[i]!.p));
      idx.forEach((i, k) => { holm[i] = adj[k]!; });
      const sensAdj = holmAdjusted(idx.map((i) => stats[i]!.sensitivity?.faults_as_failures.p ?? 1));
      idx.forEach((i, k) => { const s = stats[i]!.sensitivity; if (s) s.faults_as_failures.holm_p = sensAdj[k]!; });
    }
    out.push({ scope, families: fams, holm_family: 'the harness pairs of one model', comparisons: stats.map((s, i) => ({ ...s, holm_p: holm[i] })) });
    const ci = (c: [number, number] | null) => (c ? `[${pts(c[0])}, ${pts(c[1])}]` : '[n/a]');
    const sensRow = (s: (typeof stats)[number]) => {
      const f = s.sensitivity?.faults_as_failures;
      if (!f) return [];
      return [`| ${s.harness}${s.config ? ' ' + s.config : ''} (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; ${f.faulted_pairs} pair(s) re-included${f.equals_main ? ', equals the main estimate' : ''}) | ${s.model} | \`${s.cell_gbrain}\` | ${f.passed.none} / ${s.n_trials.none} | ${f.passed.gbrain} / ${s.n_trials.gbrain} | ${pts(f.delta)} ${ci(f.ci95)} | ${f.p.toFixed(3)} (${f.p_method}) | ${f.holm_p === null ? 'n/a' : f.holm_p.toFixed(3)} | ${f.n_clusters} | ${f.n_pairs} | ${f.excluded} | as above | as above | as above |`];
    };
    const excludedRows = stats.flatMap((s) => s.excluded.map((x) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | ${s.model} | \`${s.cell_gbrain}\` | ${x.id} | \`${x.task}\` | ${x.side} | ${x.reason} | ${x.gbrain_calls === null ? 'no gbrain block' : x.gbrain_calls} |`));
    lines.push('', `${scope === 'primary' ? `Primary endpoint, families ${fams!.join(', ')}` : 'All tasks (secondary)'}:`, '',
      '| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...stats.flatMap((s, i) => [`| ${s.harness}${s.config ? ' ' + s.config : ''} | ${s.model} | \`${s.cell_gbrain}\` | ${s.passed.none} / ${s.n_trials.none} | ${s.passed.gbrain} / ${s.n_trials.gbrain} | ${pts(s.delta)} ${ci(s.ci95)} | ${s.p.toFixed(3)} (${s.p_method}) | ${holm[i]!.toFixed(3)} | ${s.n_clusters} | ${s.n_pairs} | ${s.excluded.length} | ${s.cost.usd_median.none?.toFixed(3) ?? 'n/a'}, ${s.cost.usd_median.gbrain?.toFixed(3) ?? 'n/a'} | ${s.cost.wall_s_median.none?.toFixed(0) ?? 'n/a'}, ${s.cost.wall_s_median.gbrain?.toFixed(0) ?? 'n/a'} | ${s.cost.input_tokens_total.none.toLocaleString()}, ${s.cost.input_tokens_total.gbrain.toLocaleString()} |`, ...sensRow(s)]),
      '', '| Harness | gbrain cell | Task | Family | none | gbrain |', '|---|---|---|---|---|---|',
      ...stats.flatMap((s) => s.per_task.map((t) => `| ${s.harness}${s.config ? ' ' + s.config : ''} | \`${s.cell_gbrain}\` | \`${t.task}\` | ${t.family} | ${t.none}/${t.reps} | ${t.gbrain}/${t.reps} |`)),
      '', ...(excludedRows.length ? ['Excluded pairs (task, the side that dropped the pair, the reason, and the gbrain cell\'s call count for the pair):', '',
        '| Harness | Model | gbrain cell | Pair | Task | Side | Reason | gbrain calls (gbrain cell) |', '|---|---|---|---|---|---|---|---|', ...excludedRows] : ['Excluded pairs: none.']));
  }
  console.log(lines.join('\n'));
  writeFileSync(join(results, `comparisons.gbrain${suffix}`), JSON.stringify({ pair: 'gbrain', grading: useRegraded ? 'regraded' : 'as recorded', seed, draws, not_paired: skipped, scopes: out }, null, 1) + '\n');
  process.exit(0);
}

const inScope = rows.filter((t) => !families || families.includes(familyOf.get(t.task)!));
const obs = (cell: string): Observation[] => inScope.filter((t) => t.cell === cell).map((t) => ({ id: `${t.task}/${rep(t)}`, cluster: t.task, value: pass(t), eligible: true }));
// Cells in the manifest's (the preregistration's) order, then any other cell in the order its trials appear: each pair is
// (a, b) with a before b, so a sealed claim can name any two cells of a run as where {a, b} (internal-task; scripts/sealed/export.ts).
const cellOrder = new Map(manifest.cells.map((c, i) => [c.id, i]));
const cells = [...new Set(inScope.map((t) => t.cell))].sort((x, y) => (cellOrder.get(x) ?? Number.MAX_SAFE_INTEGER) - (cellOrder.get(y) ?? Number.MAX_SAFE_INTEGER));
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
  return { a, b, delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, n_clusters: d.n_clusters, n_pairs: d.n_pairs, mean_a: d.mean_a, mean_b: d.mean_b, ...noninferiority(a, b, d) };
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
