// Collects every sensitivity row of the 2026-11-09 corrections into one JSON file, next to the published figures it
// corrects. It reads the scratch outputs that scripts/corrections/reproduce-2026-11-09.sh writes and the committed
// analyses under docs/benchmarks/. It is keyless and writes only --out.
//
//   bun scripts/corrections/tables-2026-11-09.ts --scratch <dir> --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name: string): string => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`missing ${name}`);
  return args[i + 1];
};
const S = arg('--scratch');
const out = arg('--out');
const ROOT = join(import.meta.dir, '..', '..');
const B = join(ROOT, 'docs/benchmarks');
const MU = '2026-11-04-matrix-mu';
const HZ = '2026-11-06-harness-zero-h2h';
const FR = '2026-11-07-frontier-harness';
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const muRow = (analysis: string, extras: string) => {
  const a = json(analysis);
  const x = json(extras);
  const extra = new Map<string, any>(x.cells.map((c: any) => [c.id, c]));
  return {
    cells: Object.fromEntries(a.cells.map((c: any) => [c.id, {
      passes: c.pass_rate.passes,
      scored: c.pass_rate.scored_trials,
      pass_rate: c.pass_rate.estimate,
      pass_ci95: c.pass_rate.ci95,
      usd_per_pass: c.cost.usd_per_pass,
      recorded_trials_usd_per_pass: extra.get(c.id)?.usd_per_pass ?? null,
      recorded_trials_usd_per_pass_ci95: extra.get(c.id)?.ci95 ?? null,
    }])),
    primary: a.primary.comparisons.map((c: any) => ({ id: c.id, delta: c.delta, ci95: c.ci95, verdict: c.verdict })),
  };
};

const verdictLabels = (md: string) => {
  const labels = new Map<string, string>();
  for (const line of md.split('\n')) {
    const cols = line.split('|').map((s) => s.trim());
    if (cols.length < 8 || !cols[1].startsWith('`')) continue;
    const a = cols[1].match(/`([^`]+)`/)?.[1];
    const b = cols[2].match(/`([^`]+)`/)?.[1];
    if (a && b && /\(dev\)$/.test(cols[7])) labels.set(`${a}|${b}`, cols[7]);
  }
  return labels;
};

const h2hRow = (resultsDir: string) => {
  const x = json(join(resultsDir, 'report-extras.json'));
  const labels = verdictLabels(readFileSync(join(resultsDir, 'verdicts.md'), 'utf8'));
  return {
    primary: x.primary.map((p: any) => ({
      a: p.a, b: p.b, pairs: p.pairs,
      pass_a: p.pass.a, pass_b: p.pass.b, delta: p.pass.delta, ci95: p.pass.ci95,
      label: labels.get(`${p.a}|${p.b}`) ?? null,
      usd_per_success_ratio: p.usd_per_success.ratio, usd_per_success_ratio_ci95: p.usd_per_success.ci95,
    })),
    gbrain: x.gbrain.map((g: any) => ({ a: g.a, b: g.b, pairs: g.pairs, pass_a: g.pass.a, pass_b: g.pass.b, delta: g.pass.delta, ci95: g.pass.ci95 })),
  };
};

const frontierRow = (analysis: string) => {
  const a = json(analysis);
  return Object.fromEntries(a.cells.map((c: any) => [c.id, {
    usd_total: c.cost.usd_total, solves: c.cost.solves, usd_per_solve: c.cost.usd_per_solve, ci95: c.cost.ci95,
  }]));
};

const muRules = ['withhold', 'v031', 'both', 'relay', 'reserved'];
const hzRules = ['withhold', 'v031', 'both', 'relay'];
const hzDir = (n: string) => join(S, `hz-${n}-x`, 'docs/benchmarks', HZ, 'results');
const muExtras = (n: string) => join(S, `mu-${n}-x`, 'docs/benchmarks', MU, 'results/report-extras.json');

const result = {
  generator: 'scripts/corrections/tables-2026-11-09.ts',
  rules: {
    withhold: 'runner-posted closing text withheld from the reply checks (defect 2)',
    v031: 'v0.3 tasks regraded with the v0.3.1 excuse and not_retracted checks (defect 5)',
    both: 'withhold and v031 together',
    relay: 'approval-relay family (ar-*) left out, post-hoc (defect 3)',
    reserved: 'reservation charges left out of cost (defect 4)',
  },
  matrix_mu: {
    published: muRow(join(B, MU, 'results/matrix-analysis.json'), join(B, MU, 'results/report-extras.json')),
    ...Object.fromEntries(muRules.map((n) => [n, muRow(join(S, `mu-${n}-an/matrix-analysis.json`), muExtras(n))])),
    relay_conflict: json(join(S, 'mu-relay/summary.json')).cells,
    time: json(join(S, 'mu-time.json')).cells,
  },
  harness_zero_h2h: {
    published: h2hRow(join(B, HZ, 'results')),
    ...Object.fromEntries(hzRules.map((n) => [n, h2hRow(hzDir(n))])),
    relay_conflict: json(join(S, 'hz-relay/summary.json')).cells,
    time: json(join(S, 'hz-time.json')).cells,
  },
  frontier: {
    main: { published: frontierRow(join(B, FR, 'results/analysis/analysis.json')), reserved: frontierRow(join(S, 'fr-reserved-an/analysis.json')) },
    extension: { published: frontierRow(join(B, FR, 'results/extension/analysis/analysis.json')), reserved: frontierRow(join(S, 'frx-reserved-an/analysis.json')) },
    reservation_charges: { main: json(join(S, 'fr-reserved/summary.json')), extension: json(join(S, 'frx-reserved/summary.json')) },
  },
};
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
