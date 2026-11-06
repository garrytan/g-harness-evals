// scripts/waterfall/chart.ts (internal-task): waterfall bars conserve the total, titles label secondary models, and the four
// chart kinds render to a fixed snapshot.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { billingItems, cellCharts, contentItems, title, waterfall, type CellData } from '../scripts/waterfall/chart.ts';
import { loadShards, mine } from '../scripts/waterfall/mine.ts';
import { emptyBill } from '../scripts/waterfall/types.ts';

const ROOT = join(import.meta.dir, '..');
const bill = () => {
  const b = emptyBill();
  Object.assign(b, { requests: 12, actual_usd: 0.4321 });
  Object.assign(b.usd, { uncached_input: 0.0011, cache_read: 0.1, cache_write_5m: 0.15, cache_write_1h: 0.03, output: 0.1, embedding: 0.000001, failed: 0.05, unknown: 0.000999, remainder: 0 });
  return b;
};
const FIXTURE: CellData = {
  cell: 'claude-code-opus-none', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', trials: 3, bill: bill(),
  sections: { requests: 12, body_bytes: 1000, bytes: { system: 300, tools: 250, user_text: 100, tool_result: 200, assistant_text: 50, tool_use: 40, opaque: 20, media: 0, other: 40 } },
  turns_by_index: [{ turn: 1, trials: 3, mean_input_tokens_per_request: 18000, mean_last_request_input_tokens: 19500 }, { turn: 2, trials: 2, mean_input_tokens_per_request: 22000, mean_last_request_input_tokens: 26000 }],
  avoidable: {
    unread_cache_writes: { label: 'Cache writes never read', unit: 'tokens', per_trial_mean: 1200, ci95: [800, 1700] },
    resent_tool_results: { label: 'Tool results sent again', unit: 'bytes', per_trial_mean: 5400, ci95: null },
    side_calls: { label: 'Side calls', unit: 'USD', per_trial_mean: 0.004, ci95: [0.001, 0.009] },
  },
};

describe('waterfall charts (internal-task)', () => {
  test('billing bars sum to the cell total within 1e-9 and each bar starts where the previous ended', () => {
    const FIX = 'tests/fixtures/waterfall';
    const sha = (p: string) => createHash('sha256').update(readFileSync(join(ROOT, p), 'utf8')).digest('hex');
    const shard = (cell: string, log: string) => ({ run: 'host-harness-pilot-2026-10', cell, usage_log: `${FIX}/${log}`, sha256: sha(`${FIX}/${log}`), trials_jsonl: `${FIX}/trials.jsonl`, trials_dir: `${FIX}/trials` });
    const mined = mine(loadShards([shard('claude-code-haiku-none-mu-v03-dev', 'cc-none.proxy-usage.ndjson'), shard('hermes-luna-none-mu-v03-dev', 'he-luna.proxy-usage.ndjson')]), { sections: false, seed: 7, draws: 200 }) as unknown as { cells: CellData[] };
    expect(mined.cells.length).toBe(2);
    for (const c of [FIXTURE, ...mined.cells]) {
      const { bars, total } = waterfall(billingItems(c.bill));
      expect(Math.abs(total - c.bill.actual_usd)).toBeLessThan(1e-9);
      bars.slice(1).forEach((b, i) => expect(b.start).toBeCloseTo(bars[i]!.start + bars[i]!.value, 12));
    }
    expect(waterfall(contentItems(FIXTURE.sections!).items).total).toBe(1000);
  });

  test('titles name harness and model and label every model outside the headline set', () => {
    expect(title(FIXTURE, 'billing by class')).toBe('claude-code, claude-opus-5-5: billing by class');
    expect(title({ harness: 'hermes', model: 'openai:gpt-6-luna' }, 'billing by class')).toBe('hermes, gpt-6-luna (secondary model, no headline): billing by class');
    expect(title({ harness: 'codex', model: 'openai:gpt-6.1-sol' }, 'x')).toBe('codex, gpt-6.1-sol: x');
  });

  test('the four chart kinds render to the stored snapshot', () => {
    const charts = cellCharts(FIXTURE, ['billing', 'content', 'growth', 'avoidable']);
    expect(Object.keys(charts)).toEqual(['billing', 'content', 'growth', 'avoidable']);
    expect(charts).toMatchSnapshot();
  });
});
