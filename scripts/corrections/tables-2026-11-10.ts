// Collects every number of the 2026-11-10 corrections (docs/corrections/2026-11-10/README.md) into one JSON file, next
// to the published figures it corrects. It reads the scratch outputs that scripts/corrections/reproduce-2026-11-10.sh
// writes and the committed frontier-harness analyses. It is keyless and writes only --out.
//
//   bun scripts/corrections/tables-2026-11-10.ts --scratch <dir> --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Cell = { id: string; model: string; verdict: string; pass_rate: { estimate: number; ci95: [number, number]; tasks: number; scored_trials: number; passes: number };
  cost: { usd_total: number; usd_per_solve: number; ci95: [number, number] } };
type Pair = { id: string; cell: string; delta: number; ci95: [number, number]; tasks_paired: number; holm_p: number; holm_p_noninferiority: number;
  cost_per_solve_ratio: { ratio: number; ci95: [number, number] } };
type Analysis = { cells: Cell[]; pairs: Pair[] };

const args = process.argv.slice(2);
const arg = (name: string): string => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error('missing ' + name);
  return args[i + 1]!;
};
const S = arg('--scratch');
const out = arg('--out');
const FR = join(import.meta.dir, '..', '..', 'docs/benchmarks/2026-11-07-frontier-harness/results');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const analysis = (p: string): Analysis => json(join(p, 'analysis.json'));

const cellRow = (c: Cell) => ({ verdict: c.verdict, pass_rate: c.pass_rate.estimate, pass_ci95: c.pass_rate.ci95, tasks: c.pass_rate.tasks,
  scored_trials: c.pass_rate.scored_trials, passes: c.pass_rate.passes, usd_per_solve: c.cost.usd_per_solve, usd_per_solve_ci95: c.cost.ci95 });
const pairRow = (p: Pair) => ({ delta: p.delta, ci95: p.ci95, tasks_paired: p.tasks_paired, holm_p: p.holm_p, holm_p_noninferiority: p.holm_p_noninferiority,
  cost_ratio: p.cost_per_solve_ratio.ratio, cost_ratio_ci95: p.cost_per_solve_ratio.ci95 });

/** The README's rule: within a model, rows sorted by cost per solve, and a row shares the rank of the row above when its
 *  cost range overlaps the range of any row already holding that rank. */
const readmeRanks = (a: Analysis) => {
  const ranks: { [cell: string]: number } = {};
  for (const model of [...new Set(a.cells.map((c) => c.model))]) {
    const rows = a.cells.filter((c) => c.model === model).sort((x, y) => x.cost.usd_per_solve - y.cost.usd_per_solve);
    rows.forEach((c, i) => {
      const prev = i ? ranks[rows[i - 1]!.id]! : 0;
      const shares = rows.slice(0, i).some((o) => ranks[o.id] === prev && o.cost.ci95[0] <= c.cost.ci95[1] && c.cost.ci95[0] <= o.cost.ci95[1]);
      ranks[c.id] = i && shares ? prev : i + 1;
    });
  }
  return ranks;
};

/** Every cell and pair whose numbers differ from the base, and every verdict and README rank that flips. */
const changes = (base: Analysis, a: Analysis) => {
  const cells: { [id: string]: object } = {};
  for (const c of a.cells) {
    const old = cellRow(base.cells.find((o) => o.id === c.id)!), now = cellRow(c);
    if (JSON.stringify(old) !== JSON.stringify(now)) cells[c.id] = { published: old, now };
  }
  const pairs: { [id: string]: object } = {};
  for (const p of a.pairs) {
    const old = pairRow(base.pairs.find((o) => o.id === p.id)!), now = pairRow(p);
    if (JSON.stringify(old) !== JSON.stringify(now)) pairs[p.id] = { published: old, now };
  }
  const was = readmeRanks(base), is = readmeRanks(a);
  return {
    cells, pairs,
    verdict_flips: a.cells.filter((c) => c.verdict !== base.cells.find((o) => o.id === c.id)!.verdict).map((c) => c.id),
    readme_rank_flips: Object.keys(is).filter((id) => is[id] !== was[id]),
  };
};

const shares = (cells: { [cell: string]: { cut_usd: number } }, ...dirs: string[]) => {
  const total = new Map(dirs.flatMap((d) => analysis(d).cells.map((c) => [c.id, c.cost.usd_total] as const)));
  return Object.fromEntries(Object.entries(cells).map(([id, c]) => [id, { ...c, cut_share_of_published_cell_usd: total.get(id) ? Math.round((c.cut_usd / total.get(id)!) * 1e6) / 1e6 : null }]));
};

const published = analysis(join(FR, 'analysis'));
const main = json(join(S, 'cut/cuts.json')), ext = json(join(S, 'cut-ext/cuts.json'));
type Cut = { trial_id: string; at: string; rules: string[]; streamed: boolean; duration_s: number; resend_gap_s: number | null; usd: number; field: string; termination: string; grade: string | null };

const result = {
  note: 'Keyless rebuild of every number in docs/corrections/2026-11-10/README.md. "published" is the committed frontier-harness analysis; "now" is the same analyze.ts run (seed 7, 10,000 draws) on a corrected copy of the merged trials.',
  readme_rank_rule: 'within a model, rows sorted by cost per solve; a row shares the rank of the row above when its 95% cost range overlaps that of a row holding that rank',
  harbor_cut: {
    proxy_logs: main.proxy_logs,
    ledger_unmatched_requests: main.ledger_unmatched_requests,
    cells: { ...shares(main.cells, join(FR, 'analysis'), join(FR, 'analysis-kept')), ...shares(ext.cells, join(FR, 'extension/analysis')) },
    cuts: (main.cuts as Cut[]).concat(ext.cuts as Cut[]).map((c) => ({ trial_id: c.trial_id, at: c.at, rules: c.rules, streamed: c.streamed, duration_s: c.duration_s,
      resend_gap_s: c.resend_gap_s, usd: c.usd, field: c.field, termination: c.termination, grade: c.grade })),
    cut_removed: changes(published, analysis(join(S, 'cut-an'))),
    cut_and_reservation_removed: changes(published, analysis(join(S, 'both-an'))),
    all_spend_cut_removed: changes(analysis(join(FR, 'sensitivity-cost-with-replaced-runs')), analysis(join(S, 'cut-an-allspend'))),
    post_hoc_drop_cut_trials_that_failed: changes(published, analysis(join(S, 'drop-failed-an'))),
    post_hoc_drop_all_cut_trials: changes(published, analysis(join(S, 'drop-all-an'))),
  },
  pi_pytorch_model_recovery: {
    trials_rescored: json(join(S, 'pi-fail/subset.json')).by_cell,
    as_fail: changes(published, analysis(join(S, 'pi-fail-an'))),
  },
  readme_ranks: { published: readmeRanks(published), cut_removed: readmeRanks(analysis(join(S, 'cut-an'))), pi_as_fail: readmeRanks(analysis(join(S, 'pi-fail-an'))) },
};
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
