// scripts/anatomy/cost-split.ts (internal-task): cache writes inferred from actual_usd reconcile every request exactly,
// out-of-range inferences are clamped and reported, duplicates and refusals are dropped, and the committed m3 split
// rebuilds from its manifest.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costSplit, dedupe, splitRow, type UsageRow } from '../scripts/anatomy/cost-split.ts';

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

  test('refused rows and duplicates (same key, time and route) are dropped; a trial is reconciled against trials.jsonl', () => {
    const a = row({ input_tokens: 1_000, actual_usd: 0.002 });
    expect(dedupe([a, { ...a }, row({ outcome: 'refused' })])).toEqual({ rows: [a], duplicates: 1 });
    const split = costSplit([a, { ...a }], [{ trial_id: 'r/cell-a/t1/r1', usage: { usd: 0.002 } }, { trial_id: 'r/cell-b/t1/r1' }]);
    expect(split.cells['cell-a']!.requests).toBe(1);
    expect(split.trials_checked).toBe(1);
    expect(split.trials_unmatched).toBe(1);
    expect(split.max_trial_usd_difference).toBe(0);
  });

  test('the committed m3 split rebuilds from its manifest', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'cost-split-')), 'split.json');
    const res = spawnSync(process.execPath, ['scripts/anatomy/cost-split.ts', '--manifest', 'docs/harness-anatomy/cost/m3-heldout-2026-10.manifest.json', '--out', out],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: ROOT } });
    expect(res.status).toBe(0);
    const committed = JSON.parse(readFileSync(join(ROOT, 'docs/harness-anatomy/cost/m3-heldout-2026-10.split.json'), 'utf8'));
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(committed);
    expect(res.stdout).toContain(`${committed.trials_checked} trials reconciled`);
    for (const [cell, c] of Object.entries(committed.cells) as [string, { actual_usd: number }][]) expect(res.stdout).toContain(`${cell}: $${c.actual_usd.toFixed(4)}`);
  });
});
