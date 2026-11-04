// scripts/anatomy/cost-split.ts (internal-task): cache writes inferred from actual_usd reconcile every request exactly,
// out-of-range inferences are clamped and reported, duplicates and refusals are dropped, and the committed m3 split
// rebuilds from its manifest. internal-task: current records (trial-token meter ids, usage.meter_id) match, and the split refuses
// to publish unless every charged row matches a trial and every trial reconciles.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { costSplit, earlierAttempts, splitRow, type UsageRow } from '../scripts/anatomy/cost-split.ts';

const ROOT = join(import.meta.dir, '..');
const row = (o: Partial<UsageRow>): UsageRow => ({ at: '2026-10-23T00:00:00.000Z', key: 'sk-trial-r/cell-a/t1/r1', provider: 'anthropic', route: '/v1/messages',
  model: 'claude-sonnet-5-5', outcome: 'forwarded', input_tokens: 0, output_tokens: 0, cached_tokens: 0, actual_usd: 0, ...o });

describe('cost split (internal-task)', () => {
  test('a request with 10,000 cache-write tokens is split back into exactly that', () => {
    // Sonnet 5.5: input $2, cache read $0.20, cache write $2.50, output $10 per 1M tokens.
    const usd = (5_000 * 2 + 10_000 * 2.5 + 20_000 * 0.2 + 500 * 10) / 1e6;
    const c = splitRow(row({ input_tokens: 35_000, cached_tokens: 20_000, output_tokens: 500, actual_usd: usd }));
    expect(c.cache_write_tokens).toBe(10_000);
    expect(c.uncached_input_tokens).toBe(5_000);
    expect(c.cache_read_tokens).toBe(20_000);
    expect(Math.abs(c.remainder_usd)).toBeLessThan(1e-9);
    expect(c.clamped_requests).toBe(0);
  });

  test('Haiku 5.5 above 100,000 input tokens uses the long-prompt rates', () => {
    const usd = (110_000 * 0.5 + 100 * 2.5) / 1e6;
    const c = splitRow(row({ model: 'claude-haiku-5-5', input_tokens: 110_000, output_tokens: 100, actual_usd: usd }));
    expect(c.cache_write_tokens).toBe(0);
    expect(Math.abs(c.remainder_usd)).toBeLessThan(1e-9);
  });

  test('an actual_usd the list prices cannot reach is clamped and the remainder is reported', () => {
    const c = splitRow(row({ input_tokens: 1_000, output_tokens: 0, actual_usd: 1 }));
    expect(c.cache_write_tokens).toBe(1_000);
    expect(c.clamped_requests).toBe(1);
    expect(c.remainder_usd).toBeCloseTo(1 - 1_000 * 2.5 / 1e6, 9);
  });

  test('refused rows are dropped and two identical rows are two requests; a trial is reconciled against trials.jsonl', () => {
    const a = row({ input_tokens: 1_000, actual_usd: 0.002 });
    const split = costSplit([a, { ...a }, row({ outcome: 'refused' })], [{ trial_id: 'r/cell-a/t1/r1', usage: { usd: 0.004 } }, { trial_id: 'r/cell-b/t1/r1' }]);
    expect(split.cells['cell-a']!.requests).toBe(2);
    expect(split.trials_checked).toBe(1);
    expect(split.trials_unmatched).toBe(1);
    expect(split.max_trial_usd_difference).toBe(0);
  });

  test('the committed m3 split rebuilds from its manifest', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'cost-split-')), 'split.json');
    const res = spawnSync(process.execPath, ['scripts/anatomy/cost-split.ts', '--manifest', 'docs/harness-anatomy/cost/m3-heldout-2026-10.manifest.json', '--out', out],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dirname(out) } });
    expect(res.status).toBe(0);
    const committed = JSON.parse(readFileSync(join(ROOT, 'docs/harness-anatomy/cost/m3-heldout-2026-10.split.json'), 'utf8'));
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(committed);
    expect(res.stdout).toContain(`${committed.trials_checked} trials reconciled`);
    for (const [cell, c] of Object.entries(committed.cells) as [string, { actual_usd: number }][]) expect(res.stdout).toContain(`${cell}: $${c.actual_usd.toFixed(4)}`);
  });
});

describe('cost split on current trial records (internal-task)', () => {
  const id = 'r/cell-a/t1/r1';
  const current = (o: Partial<UsageRow> = {}) => row({ key: `trial-token:${id}`, input_tokens: 1_000, actual_usd: 0.002, ...o });
  const trial = (usd: number | undefined, cell = 'cell-a') => ({ trial_id: id, cell, usage: usd === undefined ? null : { meter_id: `trial-token:${id}`, usd } });

  test('trial-token meter ids match usage.meter_id; the cell comes from the trial record; an uncharged GET /v1/models row is skipped', () => {
    const models = row({ key: `trial-token:${id}`, provider: 'openai', route: '/v1/models', model: null as unknown as string, actual_usd: 0, input_tokens: undefined });
    const split = costSplit([current(), current({ at: '2026-10-23T00:00:01.000Z' }), models], [trial(0.004, 'renamed-cell')]);
    expect(split.refusals).toEqual([]);
    expect(split.cells['renamed-cell']!.requests).toBe(2);
    expect(split.trials_checked).toBe(1);
    expect(split.uncharged_rows_skipped).toBe(1);
    expect(split.charged_rows).toBe(2);
    expect(split.usd_total).toEqual({ usage_rows: 0.004, trials: 0.004 });
  });

  test('rows from an earlier, interrupted attempt (logged before the trial started) are reported apart, not reconciled', () => {
    const resumed = { trial_id: id, cell: 'cell-a', started_at: '2026-10-23T01:00:00.000Z', usage: { meter_id: `trial-token:${id}`, usd: 0.002 } };
    const split = costSplit([current({ at: '2026-10-23T00:30:00.000Z', actual_usd: 0.005 }), current({ at: '2026-10-23T01:00:05.000Z' })], [resumed]);
    expect(split.refusals).toEqual([]);
    expect(split.cells['cell-a']!.requests).toBe(1);
    expect(split.earlier_attempts).toEqual({ rows: 1, usd: 0.005, not_forwarded_rows: 0, by_cell: { 'cell-a': { rows: 1, usd: 0.005 } } });
    const twice = current({ at: '2026-10-23T00:30:00.000Z', actual_usd: 0.005 });
    expect(costSplit([twice, { ...twice }, current({ at: '2026-10-23T01:00:05.000Z' })], [resumed]).earlier_attempts.usd).toBe(0.01);
    expect(costSplit([current({ at: '2026-10-23T00:30:00.000Z', actual_usd: 0.005 }), current({ at: '2026-10-23T01:00:05.000Z' })], [{ ...resumed, started_at: undefined }]).refusals[0]).toContain('do not reconcile');
    const tiny = Array.from({ length: 100 }, (_, i) => current({ at: `2026-10-23T00:30:00.${String(i).padStart(3, '0')}Z`, actual_usd: 0.0000004 }));
    expect(earlierAttempts(tiny, [resumed])).toEqual({ rows: 100, usd: 0.00004, not_forwarded_rows: 0, by_cell: { 'cell-a': { rows: 100, usd: 0.00004 } } });
    expect(() => costSplit([...tiny, current({ at: '2026-10-23T01:00:05.000Z', model: 'mystery-model', actual_usd: 0 })], [resumed])).toThrow();
  });

  test('requests in the same millisecond are all kept, identical ones included (parallel requests, no request id)', () => {
    const one = current({ actual_usd: 0.001, input_tokens: 500 }), two = current({ actual_usd: 0.002 });
    const split = costSplit([one, two, { ...two }], [trial(0.005)]);
    expect(split.refusals).toEqual([]);
    expect(split.cells['cell-a']!.requests).toBe(3);
  });

  test('a refusal names the cells it touches, and a charge the split cannot place shows as that cell\'s unallocated share', () => {
    const other = { trial_id: 'r/cell-b/t1/r1', cell: 'cell-b', usage: { meter_id: 'trial-token:r/cell-b/t1/r1', usd: 0.009 } };
    const split = costSplit([current(), current({ key: 'trial-token:r/cell-b/t1/r1', input_tokens: undefined, output_tokens: undefined, actual_usd: 0.007 })], [trial(0.002), other]);
    expect(split.refused_cells).toEqual(['cell-b']);
    expect(split.unattributed_refusal).toBe(false);
    expect(split.unallocated_share['cell-b']).toBe(1);
    const opposite = costSplit([current({ actual_usd: 0.001 }), current({ actual_usd: 0.0035 })], [trial(0.0045)]);
    expect(opposite.refusals).toEqual([]);
    expect(opposite.cells['cell-a']!.remainder_usd).toBeCloseTo(0, 9);
    expect(opposite.unallocated_share['cell-a']).toBeCloseTo(0.002 / 0.0045, 5);
    expect(split.unallocated_share['cell-a']).toBe(0);
  });

  test('a charged /v1/embeddings row is all uncached input', () => {
    const c = splitRow(current({ provider: 'openai', route: '/v1/embeddings', model: 'text-embedding-3-small', actual_usd: 0.00002 }));
    expect(c.uncached_input_usd).toBe(0.00002);
    expect(c.remainder_usd).toBe(0);
  });

  test('refuses a charged row that matches no trial, a charged row that is not a forwarded request, and a trial whose dollars do not reconcile', () => {
    expect(costSplit([current(), current({ key: 'trial-token:r/cell-z/t9/r1' })], [trial(0.002)]).refusals[0]).toContain('1 charged usage row(s) under 1 meter id(s) match no trial: trial-token:r/cell-z/t9/r1');
    expect(costSplit([current(), current({ outcome: 'failed', at: 'later' })], [trial(0.004)]).refusals.join(' ')).toContain('not forwarded requests (outcome failed)');
    expect(costSplit([current()], [trial(0.003)]).refusals[0]).toContain('1 trial(s) do not reconcile');
    expect(costSplit([], [trial(0.003)]).refusals[0]).toContain('trials.jsonl usd 0.003 with no charged row');
    expect(costSplit([current()], [trial(undefined)]).refusals[0]).toContain('with no usage.usd');
    expect(costSplit([], [trial(undefined)]).refusals).toEqual([]);
  });

  test('the CLI exits 2 and writes nothing when the split does not reconcile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cost-split-refuse-'));
    const usageText = JSON.stringify(current()) + '\n' + JSON.stringify(current({ key: 'trial-token:r/cell-z/t9/r1' })) + '\n';
    const trialsText = JSON.stringify(trial(0.002)) + '\n';
    writeFileSync(join(dir, 'usage.ndjson'), usageText);
    writeFileSync(join(dir, 'trials.jsonl'), trialsText);
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const rel = (f: string) => relative(ROOT, join(dir, f));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 'refuse', usage_logs: [{ path: rel('usage.ndjson'), sha256: sha(usageText) }], trials: { path: rel('trials.jsonl'), sha256: sha(trialsText) } }));
    const out = join(dir, 'split.json');
    const res = spawnSync(process.execPath, ['scripts/anatomy/cost-split.ts', '--manifest', join(dir, 'manifest.json'), '--out', out], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('COST_SPLIT_REFUSED: refuse: 1 charged usage row(s)');
    expect(existsSync(out)).toBe(false);
  });
});
