// compare-run.ts --baseline's cost, cache and task endpoints and its caching repricing (scripts/baseline-endpoints.ts,
// harness-zero-select-2026-11), keyless, on hand-built trials: every endpoint on the pairs the pass-rate comparison kept
// (model_error, infra_error and exam_fault on either side and missing trials excluded), a trial without usage leaving only
// the cost and cache endpoints, broken and fixed tasks judged on the pairs a task kept, ratio intervals that draw the same
// tasks as clusteredPairedDelta, and repricing from the proxy usage lines with its exclusions, long-prompt tier and gap buckets.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { clusteredPairedDelta, seededRandom } from '../runner/stats/paired.ts';
import { clusteredRatio, repricing } from '../scripts/baseline-endpoints.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'baseline-endpoints-fixture-2026-11';
const OPUS = 'anthropic:claude-opus-5-5', SOL = 'openai:gpt-6.1-sol';
const TASKS = ['ar-01-thornbury-rate-hollis', 'cn-01-tamsin-cold-chain-site', 'cr-01-marrow-agrisupply-site-retraction', 'si-01-marrow-agrisupply-site'];
const kit = { clusteredPairedDelta, seededRandom };
const SCRUBBED = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const run = (args: string[]) => spawnSync('bun', [join(ROOT, 'scripts/compare-run.ts'), ...args], { cwd: ROOT, encoding: 'utf8', env: SCRUBBED });
const close = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(1e-9);

function trial(cell: string, model: string, task: string, rep: number, pass: boolean, usage: { usd: number; input: number; cached: number } | null): TrialRecord {
  const id = RUN + '/' + cell + '/' + task + '/r' + rep;
  return {
    trial_id: id, cell, task, harness: 'harness-zero', harness_mode: 'docker', model, script: null,
    termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [],
    cap_stop: false, turns: { planned: 3, run: 3, exits: [0, 0, 0] },
    usage: usage && { meter_id: 'sk-trial-' + id, requests: 2, refused: 0, failed: 0, usd: usage.usd, input_tokens: usage.input, output_tokens: 100, cached_tokens: usage.cached, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: 60_000, started_at: '', ended_at: '', paths: {},
  };
}

/** Opus at 5 repetitions over four tasks: zf-a (baseline) passes 5, 3, 1, 0 and no-x passes 2, 3, 4, 0, so on the kept pairs task 1
 *  is broken and task 3 fixed. no-x has a model_error (task 2 r1) and an exam_fault (task 4 r5), zf-a an infra_error (task 3 r2) and
 *  no trial for task 1 r5, and no-x's task 4 r1 has no usage. zf-a costs $0.20 a trial with 800 of 1,000 input tokens cached, no-x
 *  $0.10 with 200 cached. Sol at 3 repetitions over two tasks: zf-sol passes 2, 1 and zm-sol 1, 2 (task 1 broken, task 2 fixed at
 *  2 of 3 against 1 of 3), both at $0.05 and 300,000 input tokens, half cached in zf-sol.
 *  With lines, each scored zf-a trial has two proxy lines (one 400 s after the first for task 4 r3) except task 2 r2, which is
 *  missing its second line, and each zf-sol trial has one line above the 272,000-token long-prompt tier. */
function fixture(withLines: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'he-baseline-endpoints-'));
  const cells = [
    { id: 'zf-a', model: OPUS, reps: 5, tasks: TASKS, passes: [5, 3, 1, 0], usage: { usd: 0.2, input: 1000, cached: 800 } },
    { id: 'no-x', model: OPUS, reps: 5, tasks: TASKS, passes: [2, 3, 4, 0], usage: { usd: 0.1, input: 1000, cached: 200 } },
    { id: 'zf-sol', model: SOL, reps: 3, tasks: TASKS.slice(0, 2), passes: [2, 1], usage: { usd: 0.05, input: 300_000, cached: 150_000 } },
    { id: 'zm-sol', model: SOL, reps: 3, tasks: TASKS.slice(0, 2), passes: [1, 2], usage: { usd: 0.05, input: 300_000, cached: 0 } },
  ];
  let rows: TrialRecord[] = [];
  for (const c of cells) c.tasks.forEach((task, ti) => { for (let r = 1; r <= c.reps; r++) rows.push(trial(c.id, c.model, task, r, r <= c.passes[ti]!, c.usage)); });
  const find = (cell: string, ti: number, r: number) => rows.find((t) => t.cell === cell && t.task === TASKS[ti] && t.trial_id.endsWith('/r' + r))!;
  Object.assign(find('no-x', 1, 1), { termination: 'model_error', grade: 'n/a' });
  Object.assign(find('no-x', 3, 5), { termination: 'exam_fault', grade: 'n/a' });
  Object.assign(find('zf-a', 2, 2), { termination: 'infra_error', grade: 'n/a' });
  find('no-x', 3, 1).usage = null;
  rows = rows.filter((t) => t !== find('zf-a', 0, 5));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, cells: cells.map((c) => ({ id: c.id, harness: 'harness-zero', model: c.model, slice: 'multiuser', split: 'dev', task_set: 'v0.3', repetitions: c.reps })) }));
  writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
  if (!withLines) return dir;
  const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 12, 0, 0) + s * 1000).toISOString();
  const lines: object[] = [];
  for (const t of rows.filter((t) => t.cell === 'zf-a' && t.termination === 'completed')) {
    const key = t.usage!.meter_id;
    lines.push({ at: at(0), key, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', status: 200, actual_usd: 0.00184, input_tokens: 400, output_tokens: 50, cached_tokens: 200 });
    lines.push({ at: at(0), key, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'refused', reason: 'test', status: 403 });
    if (t === find('zf-a', 1, 2)) continue;
    lines.push({ at: at(t === find('zf-a', 3, 3) ? 400 : 30), key, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', status: 200, actual_usd: 0.00112, input_tokens: 600, output_tokens: 50, cached_tokens: 600 });
  }
  writeFileSync(join(dir, 'zf-a-opus.proxy-usage.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const sol = rows.filter((t) => t.cell === 'zf-sol').map((t) => ({ at: at(0), key: t.usage!.meter_id, provider: 'openai', route: '/v1/responses', model: 'gpt-6.1-sol', outcome: 'forwarded', status: 200, actual_usd: 0.5, input_tokens: 300_000, output_tokens: 100, cached_tokens: 150_000 }));
  writeFileSync(join(dir, 'zf-sol.proxy-usage.ndjson'), sol.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return dir;
}

describe('clusteredRatio', () => {
  test('draws the same tasks as clusteredPairedDelta: a mean-difference statistic gives the same interval', () => {
    const pairs = TASKS.flatMap((task, ti) => [0, 1, 2].map((r) => ({ id: task + '/' + r, cluster: task, a: (ti + r) % 2, b: (ti * r) % 3 === 0 ? 1 : 0 })));
    const d = clusteredPairedDelta(pairs, { seed: 7, draws: 2000 });
    const r = clusteredRatio(pairs.map((p) => ({ cluster: p.cluster, x: [p.a, p.b, 1] })), (s) => (s[1]! - s[0]!) / s[2]!, kit, { seed: 7, draws: 2000 });
    close(r.estimate!, d.delta);
    close(r.ci95![0], d.ci95![0]);
    close(r.ci95![1], d.ci95![1]);
    expect(r.n_clusters).toBe(4);
  });

  test('a draw with a zero denominator leaves no interval and is counted; one cluster gives no interval', () => {
    const items = [{ cluster: 't1', x: [1, 1] }, { cluster: 't2', x: [1, 0] }];
    const r = clusteredRatio(items, (s) => (s[1] === 0 ? NaN : s[0]! / s[1]!), kit, { seed: 7, draws: 1000 });
    expect(r.estimate).toBe(2);
    expect(r.ci95).toBeNull();
    expect(r.undefined_draws).toBeGreaterThan(0);
    expect(r.note).toContain('undefined ratio');
    const one = clusteredRatio([{ cluster: 't1', x: [2, 1] }], (s) => s[0]! / s[1]!, kit, { seed: 7, draws: 1000 });
    expect(one.estimate).toBe(2);
    expect(one.ci95).toBeNull();
  });
});

describe('compare-run --baseline endpoints', () => {
  test('cost, cost-per-success, cached share and broken or fixed tasks on the kept pairs', () => {
    const dir = fixture(true);
    const r = run(['--results', dir, '--baseline', 'zf-a,zf-sol', '--draws', '1000']);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.json'), 'utf8'));
    const by = Object.fromEntries(out.comparisons.map((c: { a: string; b: string }) => [c.b + ' vs ' + c.a, c]));
    const c = by['no-x vs zf-a'];
    expect(c.n_pairs).toBe(16);
    expect(c.excluded.map((x: { reason: string }) => x.reason).sort()).toEqual(['missing in zf-a', 'no-x exam_fault', 'no-x model_error', 'zf-a infra_error']);
    const e = c.endpoints;
    close(e.pass_half_width, (c.ci95[1] - c.ci95[0]) / 2);
    expect(e.cost_pairs).toBe(15);
    expect(e.cost_excluded).toEqual([{ id: TASKS[3] + '/r1', reason: 'no usage in no-x' }]);
    close(e.usd_per_trial.delta, -0.1);
    close(e.usd_per_trial.ci95[0], -0.1);
    expect(e.usd_per_trial.n_pairs).toBe(15);
    close(e.usd_per_trial_ratio.estimate, 0.5);
    close(e.usd_per_trial_ratio.ci95[1], 0.5);
    expect(e.usd_per_success.passes).toEqual({ a: 7, b: 7 });
    close(e.usd_per_success.a, 3 / 7);
    close(e.usd_per_success.b, 1.5 / 7);
    close(e.usd_per_success.ratio.estimate, 0.5);
    close(e.cached_share.a, 0.8);
    close(e.cached_share.b, 0.2);
    close(e.cached_share.difference.estimate, -0.6);
    close(e.cached_share.difference.ci95[0], -0.6);
    expect(e.tasks.broken).toEqual([TASKS[0]]);
    expect(e.tasks.fixed).toEqual([TASKS[2]]);
    expect(e.tasks.per_task.map((t: { pairs: number; passes_a: number; passes_b: number }) => [t.pairs, t.passes_a, t.passes_b])).toEqual([[4, 4, 2], [4, 2, 2], [4, 1, 3], [4, 0, 0]]);
    const s = by['zm-sol vs zf-sol'].endpoints;
    close(s.cached_share.difference.estimate, -0.5);
    expect(s.tasks.broken).toEqual([TASKS[0]]);
    expect(s.tasks.fixed).toEqual([TASKS[1]]);
    expect(r.stdout).toContain('Cost, cache and tasks on the same pairs');
    expect(r.stdout).toContain('Caching repricing per baseline cell');
  });

  test('repricing prices every input token at the input rate, excludes faulted and mismatched trials, and splits the cache share by gap', () => {
    const dir = fixture(true);
    expect(run(['--results', dir, '--baseline', 'zf-a,zf-sol', '--draws', '1000']).status).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.json'), 'utf8'));
    const a = out.repricing['zf-a'];
    expect(a.usage_files).toEqual(['zf-a-opus.proxy-usage.ndjson', 'zf-sol.proxy-usage.ndjson']);
    expect(a.trials).toBe(17);
    expect(a.excluded.map((x: { id: string; reason: string }) => x.id.split('/').slice(-2).join('/') + ' ' + x.reason.split(' ')[0])).toEqual([TASKS[1] + '/r2 its', TASKS[2] + '/r2 infra_error']);
    close(a.repriced_usd, 17 * ((400 * 4 + 50 * 20) + (600 * 4 + 50 * 20)) / 1e6);
    close(a.actual_usd, 17 * (0.00184 + 0.00112));
    close(a.ratio.estimate, 0.006 / 0.00296);
    expect(a.cache_by_gap.map((g: { requests: number; cached_share: number | null }) => [g.requests, g.cached_share])).toEqual([[17, 0.5], [16, 1], [1, 1]]);
    const sol = out.repricing['zf-sol'];
    expect(sol.trials).toBe(6);
    close(sol.repriced_usd, 6 * (300_000 * 4 + 100 * 15) / 1e6);
  });

  test('repricing adds a line charged its reservation to both sides, and excludes an unpriced model or no actual_usd', () => {
    const usage = { usd: 0.01, input: 10, cached: 0 };
    const trials = [1, 2, 3].map((r) => ({ ...trial('zf-a', OPUS, TASKS[r - 1]!, r, true, usage), usage: { ...trial('zf-a', OPUS, TASKS[0]!, r, true, usage).usage!, output_tokens: 1 } }));
    const line = (t: TrialRecord, extra: Partial<UsageLine>): UsageLine => ({ at: '2026-11-06T12:00:00.000Z', key: t.usage!.meter_id, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', actual_usd: 0.001, input_tokens: 10, output_tokens: 1, cached_tokens: 0, ...extra });
    const noUsage = { input_tokens: undefined, output_tokens: undefined, cached_tokens: undefined, charged_reservation: true, actual_usd: 0.4 };
    const lines = [
      line(trials[0]!, {}), line(trials[0]!, { ...noUsage, status: 429 }), line(trials[0]!, { ...noUsage, outcome: 'failed', actual_usd: 0.5 }),
      line(trials[1]!, { model: 'no-such-model' }), line(trials[2]!, {}), line(trials[2]!, { outcome: 'failed', actual_usd: undefined, input_tokens: undefined, output_tokens: undefined, cached_tokens: undefined }),
    ];
    const r = repricing('zf-a', trials, new Set(['model_error']), { files: ['proxy-usage.ndjson'], lines }, kit, { seed: 7, draws: 1000 });
    expect(r.excluded.map((x) => x.reason)).toEqual(['no price for anthropic:no-such-model', 'a forwarded or failed line has no actual_usd']);
    expect(r.trials).toBe(1);
    expect(r.charged_reservation).toEqual({ lines: 2, usd: 0.9 });
    close(r.actual_usd!, 0.001 + 0.9);
    close(r.repriced_usd!, (10 * 4 + 1 * 20) / 1e6 + 0.9);
    expect(r.cache_by_gap[0]!.requests + r.cache_by_gap[1]!.requests).toBe(2);
  });

  test('without proxy usage files repricing says so, and without --baseline neither key appears', () => {
    const dir = fixture(false);
    expect(run(['--results', dir, '--baseline', 'zf-a,zf-sol', '--draws', '1000']).status).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.json'), 'utf8'));
    expect(out.repricing['zf-a'].ratio).toBeNull();
    expect(out.repricing['zf-a'].note).toContain('no proxy-usage');
    const sol = mkdtempSync(join(tmpdir(), 'he-baseline-endpoints-default-'));
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    writeFileSync(join(sol, 'manifest.json'), JSON.stringify({ ...m, cells: m.cells.filter((c: { id: string }) => c.id.endsWith('-sol')) }));
    writeFileSync(join(sol, 'trials.jsonl'), readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter((l) => /"cell":"(zf-sol|zm-sol)"/.test(l)).concat('').join('\n'));
    expect(run(['--results', sol, '--draws', '1000']).status).toBe(0);
    const d = JSON.parse(readFileSync(join(sol, 'comparisons.json'), 'utf8'));
    expect(d.repricing).toBeUndefined();
    expect(d.comparisons[0].endpoints).toBeUndefined();
  });
});
