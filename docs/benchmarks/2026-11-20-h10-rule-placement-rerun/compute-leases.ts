#!/usr/bin/env bun
// Keyless: the paid budget, arm budgets, pilot caps and leases of the rule-placement re-run, from what the published
// H10 run (h10-instruction-placement-2026-11) and QM's last Sol run on the same tasks (qm-c4-told-live-2026-11) spent.
// gpt-6.2-sol has the same ledger prices as gpt-6.1-sol (runner/ledger/budget-ledger.ts), so their measured spend is
// the expected spend here, with no price factor.
//
//   bun docs/benchmarks/2026-11-20-h10-rule-placement-rerun/compute-leases.ts > docs/benchmarks/2026-11-20-h10-rule-placement-rerun/leases.txt
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const H10 = join(ROOT, 'docs/benchmarks/2026-11-07-h10-instruction-placement/results');
const QM = join(ROOT, 'docs/benchmarks/2026-11-03-qm-c4-told-live/results');

interface Line { key?: string; actual_usd?: number; reserved_usd?: number }
function usage(file: string, match: (cell: string) => boolean) {
  const cells = new Map<string, number>();
  const trials = new Map<string, number>();
  let rmax = 0;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    const l = JSON.parse(raw) as Line;
    const p = (l.key ?? '').split('/');
    if (p.length < 4 || !match(p[1]!)) continue;
    cells.set(p[1]!, (cells.get(p[1]!) ?? 0) + (l.actual_usd ?? 0));
    trials.set(l.key!, (trials.get(l.key!) ?? 0) + (l.actual_usd ?? 0));
    rmax = Math.max(rmax, l.reserved_usd ?? 0);
  }
  return { cells, maxTrial: Math.max(...trials.values()), trials: trials.size, rmax };
}

const up = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;
const usd = (x: number) => '$' + x.toFixed(2);

// No-gbrain cells: priced as the arm's route-tool cell (the same harness and model with gbrain's tools and no rule), the
// closest measured cell.
const arms = [
  { arm: 'Claude Code cli (Opus 5.5)', shard: 'cc-cli', file: join(H10, 'cc-cli.proxy-usage.ndjson'), match: (c: string) => true, k: 1, extra: ['claude-code-opus-gbrain-route-tool-mu-v03-dev'], cells: 6 },
  { arm: 'Claude Code Agent SDK (Opus 5.5)', shard: 'cc-sdk', file: join(H10, 'cc-sdk.proxy-usage.ndjson'), match: (c: string) => true, k: 1, extra: [], cells: 5 },
  { arm: 'Codex (Sol 6.2)', shard: 'cx', file: join(H10, 'cx.proxy-usage.ndjson'), match: (c: string) => true, k: 2, extra: ['codex-sol-gbrain-route-tool-mu-v03-dev'], cells: 9 },
  { arm: 'Hermes (Sol 6.2)', shard: 'he', file: join(H10, 'he.proxy-usage.ndjson'), match: (c: string) => true, k: 1, extra: ['hermes-sol-gbrain-route-tool-mu-v03-dev'], cells: 8 },
  { arm: 'OpenClaw (Sol 6.2)', shard: 'oc', file: join(H10, 'oc.proxy-usage.ndjson'), match: (c: string) => true, k: 2, extra: ['openclaw-sol-gbrain-route-tool-mu-v03-dev'], cells: 6 },
  { arm: 'QM (Sol 6.2)', shard: 'qm', file: join(QM, 'qm-sol.proxy-usage.ndjson'), match: (c: string) => c.startsWith('qm-pi-sol-'), k: 1, extra: [] as string[], cells: 2 },
];

const rows = arms.map((a) => {
  const u = usage(a.file, a.match);
  let expected: number;
  if (a.shard === 'qm') {
    const per = (id: string) => (u.cells.get(id) ?? 0) / 4; // four repetitions of the ten tasks there, one here
    expected = per('qm-pi-sol-none-mu-v03-dev') + per('qm-pi-sol-gbrain-route-tool-mu-v03-dev');
  } else {
    expected = [...u.cells.values()].reduce((s, v) => s + v, 0) + a.extra.reduce((s, id) => s + (u.cells.get(id) ?? 0), 0);
  }
  const pilotCeiling = a.cells * u.maxTrial;
  const pilotLease = up(pilotCeiling + a.k * u.rmax, 0.01);
  const smokeLease = pilotLease;
  const countedLease = up(1.5 * expected, 1);
  const armBudget = up(Math.max(pilotLease + smokeLease + countedLease, 10 * pilotLease), 5);
  return { ...a, expected, maxTrial: u.maxTrial, rmax: u.rmax, pilotLease, smokeLease, countedLease, armBudget };
});

console.log('| Arm | Cells | Trials | Expected spend | Largest trial | Rmax | k | Pilot cap (lease) | Smoke lease | Counted lease | Arm budget |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log('| ' + [r.arm, r.cells, r.cells * 10, usd(r.expected), usd(r.maxTrial), usd(r.rmax), r.k, usd(r.pilotLease), usd(r.smokeLease), usd(r.countedLease), usd(r.armBudget)].join(' | ') + ' |');
const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
console.log('| **Sum** | ' + [sum((r) => r.cells), sum((r) => r.cells * 10), usd(sum((r) => r.expected)), '', '', '', usd(sum((r) => r.pilotLease)), usd(sum((r) => r.smokeLease)), usd(sum((r) => r.countedLease)), usd(sum((r) => r.armBudget))].join(' | ') + ' |');
console.log('');
console.log('Arm budgets (sum): ' + usd(sum((r) => r.armBudget)) + '; the paid budget is $320, the other $10 held back for one repeated pilot trial');
console.log('All leases (pilot + smoke + counted): ' + usd(sum((r) => r.pilotLease + r.smokeLease + r.countedLease)));
for (const r of rows) if (r.pilotLease > r.armBudget / 10 + 1e-9) { console.error(r.arm + ': pilot cap above a tenth of the arm budget'); process.exit(1); }
