// Dollars the metering proxy charged at a full reservation because a request carried no usage (a provider error event
// inside an HTTP 200 stream, a stream cut short, a failed upstream) stay in the ledger but are not cost: the trial
// usage summaries (scripts/frontier-harbor/to-trials.ts usageOf for Harbor runs, runner/trial/proxy.ts summarizeUsage for
// runner trials) report them as usage.usd_reserved, and cost per solve (scripts/frontier-harbor/analyze.ts) and USD per
// pass (scripts/matrix-analysis.ts) leave them out and print them beside. A record without usd_reserved, as every record
// committed before the split carries, is analysed exactly as before.
import { describe, expect, test } from 'bun:test';
import type { TrialRecord, TrialUsage } from '../runner/contracts.ts';
import { summarizeUsage } from '../runner/trial/proxy.ts';
import { analyzeFrontier, renderMarkdown, type FrontierSpec } from '../scripts/frontier-harbor/analyze.ts';
import type { UsageRow } from '../scripts/anatomy/cost-split.ts';
import { analyzeMatrix, renderMarkdown as renderMatrix, type MatrixSpec } from '../scripts/matrix-analysis.ts';

// The trial usage a Harbor record carries (scripts/frontier-harbor/to-trials.ts usageOf, private, tested in
// tests/frontier-harbor.test.ts): every charged dollar in usd, the reservation charges in usd_reserved.
type UsageLine = UsageRow & { status?: number; reason?: string };
const linesFor = (lines: UsageLine[], id: string) => lines.filter((l) => l.key === id);
function usageOf(lines: UsageLine[], meterId: string): TrialUsage {
  const usd = (ls: UsageLine[]) => ls.reduce((a, l) => a + (l.actual_usd ?? 0), 0);
  const reserved = lines.filter((l) => l.charged_reservation);
  return {
    meter_id: meterId, requests: lines.length, refused: 0, failed: 0, usd: usd(lines), input_tokens: 0, output_tokens: 0, cached_tokens: 0,
    unpriced: reserved.length, usd_reserved: usd(reserved), by_model: { 'openai:gpt-6.1-sol': { usd: usd(lines), requests: lines.length } },
    upstream: { statuses: { '200': lines.length }, failed: 0, unparseable: 0 },
  };
}

const RUN = 'reserved-test';
const AT = '2026-11-09T00:00:00.000Z';
const priced = (key: string, usd: number): UsageLine => ({ at: AT, key, provider: 'openai', route: '/v1/responses', model: 'gpt-6.1-sol', outcome: 'forwarded', status: 200, actual_usd: usd, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, charged_reservation: false });
// The proxy's line for an error event inside a 200 stream: no usage, so it settles at the reservation (request bytes plus 128,000 output tokens).
const reservation = (key: string, usd: number): UsageLine => ({ at: AT, key, provider: 'openai', route: '/v1/responses', model: 'gpt-6.1-sol', outcome: 'forwarded', status: 200, actual_usd: usd, charged_reservation: true, reason: 'the stream carried no usage' });

const LINES: UsageLine[] = [
  priced(`${RUN}/sol-cc/t1/a1`, 0.1), reservation(`${RUN}/sol-cc/t1/a1`, 1.43),
  priced(`${RUN}/sol-cc/t2/a1`, 0.3),
  priced(`${RUN}/sol-oc/t1/a1`, 0.2), priced(`${RUN}/sol-oc/t2/a1`, 0.2),
];

function record(cell: string, task: string, usage: TrialUsage): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/a1`, cell, task, harness: cell.split('-')[1]!, harness_mode: 'docker', model: 'openai:gpt-6.1-sol', script: null,
    termination: 'completed', grade: 'pass', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false,
    turns: { planned: 1, run: 1, exits: [0] }, usage, wall_ms: 1000, started_at: AT, ended_at: AT, paths: {},
  };
}
const records = (usage: (id: string) => TrialUsage) => ['sol-cc', 'sol-oc'].flatMap((cell) => ['t1', 't2'].map((task) => record(cell, task, usage(`${RUN}/${cell}/${task}/a1`))));
const fromLines = records((id) => usageOf(linesFor(LINES, id), id));
const withoutField = fromLines.map((t) => { const { usd_reserved: _, ...usage } = t.usage!; return { ...t, usage }; });

const frontierSpec: FrontierSpec = {
  run_id: RUN, seed: 7, draws: 2000, min_paired_tasks: 2,
  models: [{ id: 'sol', label: 'Sol', home: 'sol-cc' }],
  cells: [{ id: 'sol-cc', model: 'sol', harness: 'cc', attempts: 1 }, { id: 'sol-oc', model: 'sol', harness: 'oc', attempts: 1 }],
};
const manifest = { run_id: RUN, cells: [{ id: 'sol-cc' }, { id: 'sol-oc' }], trials: fromLines.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })) };
const matrixSpec: MatrixSpec = { run_id: RUN, seed: 7, draws: 2000, primary_family_size: 1, cells: [{ id: 'sol-cc' }, { id: 'sol-oc' }], primary: [{ id: 'p1', a: 'sol-cc', b: 'sol-oc' }] };

describe('reservation charges are reported apart from cost', () => {
  test('summarizeUsage reports the reservation charge of a runner trial', () => {
    const key = `trial-token:${RUN}/sol-cc/t1/a1`;
    const lines = [{ ...priced(key, 0.1) }, { ...reservation(key, 1.43) }];
    const { usage } = summarizeUsage(key, { usd: 1.53, requests: 2, unpriced: 1, byModel: {} }, lines as Parameters<typeof summarizeUsage>[2]);
    expect(usage.usd).toBe(1.53);
    expect(usage.usd_reserved).toBeCloseTo(1.43, 9);
  });

  test('cost per solve, its interval and the cost ratio leave the reservation charge out and report it beside', () => {
    const a = analyzeFrontier({ records: fromLines, manifest: null }, frontierSpec);
    const cc = a.cells.find((c) => c.id === 'sol-cc')!;
    expect(cc.cost).toMatchObject({ usd_total: 0.4, usd_reserved: 1.43, solves: 2, usd_per_solve: 0.2 });
    expect(cc.cost.ci95![1]).toBeLessThanOrEqual(0.3);
    expect(a.pairs[0]!.cost_per_solve_ratio.ratio).toBe(1);
    expect(a.method.cost).toContain('usd_reserved');
    expect(renderMarkdown(a)).toContain('$1.4300 charged at reservation left out');
  });

  test('USD per pass leaves the reservation charge out; USD total keeps it', () => {
    const a = analyzeMatrix({ manifest, records: fromLines, eventsOf: () => null, usageRows: null }, matrixSpec);
    const cc = a.cells.find((c) => c.id === 'sol-cc')!;
    expect(cc.cost.usd_total).toBeCloseTo(1.83, 6);
    expect(cc.cost).toMatchObject({ usd_reserved: 1.43, passes: 2, usd_per_pass: 0.2 });
    expect(renderMatrix(a)).toContain('charged at reservation');
  });

  test('USD per pass also leaves out a reservation charge logged after the trial record closed', () => {
    const late = { ...LINES[1]!, key: `${RUN}/sol-cc/t2/a1`, actual_usd: 1.44 };
    const a = analyzeMatrix({ manifest, records: fromLines, eventsOf: () => null, usageRows: [...LINES, late] as unknown as UsageRow[] }, matrixSpec);
    const cc = a.cells.find((c) => c.id === 'sol-cc')!;
    expect(cc.cost.usd_rows_beyond_records).toBeCloseTo(1.44, 6);
    expect(cc.cost.usd_total).toBeCloseTo(3.27, 6);
    expect(cc.cost).toMatchObject({ usd_reserved: 2.87, passes: 2, usd_per_pass: 0.2 });
  });

  test('a reservation only the record holds and one only the usage log holds both leave USD per pass, each counted once', () => {
    const late = { ...LINES[1]!, key: `${RUN}/sol-cc/t2/a1`, actual_usd: 1.44 };
    const partial = [...LINES.filter((l) => !l.charged_reservation), late] as unknown as UsageRow[];
    const cc = analyzeMatrix({ manifest, records: fromLines, eventsOf: () => null, usageRows: partial }, matrixSpec).cells.find((c) => c.id === 'sol-cc')!;
    expect(cc.cost.usd_total).toBeCloseTo(3.27, 6);
    expect(cc.cost).toMatchObject({ usd_reserved: 2.87, passes: 2, usd_per_pass: 0.2 });
  });

  test('a record without usd_reserved is analysed as before: every charged dollar is cost, and no new key appears', () => {
    const f = analyzeFrontier({ records: withoutField, manifest: null }, frontierSpec).cells.find((c) => c.id === 'sol-cc')!;
    expect(f.cost).toMatchObject({ usd_total: 1.83, solves: 2, usd_per_solve: 0.915 });
    expect(f.cost).not.toHaveProperty('usd_reserved');
    const m = analyzeMatrix({ manifest, records: withoutField, eventsOf: () => null, usageRows: null }, matrixSpec).cells.find((c) => c.id === 'sol-cc')!;
    expect(m.cost.usd_per_pass).toBe(0.915);
    expect(m.cost).not.toHaveProperty('usd_reserved');
  });
});
