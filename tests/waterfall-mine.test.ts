// scripts/waterfall/mine.ts (internal-task): billing classes reconcile to the receipts, requests join their user turn or
// the out_of_turn bucket, contract sections aggregate in bytes (tokens only with a calibration table), and a receipt
// that does not reconcile fails the run.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { UsageRow } from '../scripts/anatomy/cost-split.ts';
import { loadShards, mine, type LoadedShard, type Shard, type TrialRow, type Turn } from '../scripts/waterfall/mine.ts';
import { BILLING_CLASSES, type Bill, type SectionsV1 } from '../scripts/waterfall/types.ts';

const ROOT = join(import.meta.dir, '..');
const FIX = 'tests/fixtures/waterfall';
const RUN = 'host-harness-pilot-2026-10';
const sha = (p: string) => createHash('sha256').update(readFileSync(join(ROOT, p), 'utf8')).digest('hex');
const shard = (cell: string, log: string): Shard => ({ run: RUN, cell, usage_log: `${FIX}/${log}`, sha256: sha(`${FIX}/${log}`), trials_jsonl: `${FIX}/trials.jsonl`, trials_dir: `${FIX}/trials` });
const FIXTURE: Shard[] = [shard('claude-code-haiku-none-mu-v03-dev', 'cc-none.proxy-usage.ndjson'), shard('hermes-luna-none-mu-v03-dev', 'he-luna.proxy-usage.ndjson')];
const OPTS = { sections: false, seed: 7, draws: 1000 };
const classSum = (b: Bill) => BILLING_CLASSES.reduce((s, k) => s + b.usd[k], 0);

describe('waterfall miner on host-harness-pilot receipts (internal-task)', () => {
  test('every trial reconciles to its trials.jsonl usd and the billing classes sum to the receipt dollars', () => {
    const r = mine(loadShards(FIXTURE), OPTS);
    expect(r.ok).toBe(true);
    expect(r.reconciliation).toMatchObject({ trials_checked: 2, trials_unmatched: 0, unattributed_lines: 0, free_lines_skipped: 5 });
    expect(r.reconciliation.max_trial_usd_difference).toBeLessThanOrEqual(0.000001);
    for (const t of r.trials) {
      expect(Math.abs(classSum(t.bill) - t.receipt_usd!)).toBeLessThan(1e-9);
      expect(t.bill.inferred_requests).toBe(t.bill.requests);
      const turns = t.turns.reduce((s, u) => s + u.bill.actual_usd, 0) + t.out_of_turn.actual_usd;
      expect(Math.abs(turns - t.bill.actual_usd)).toBeLessThan(1e-12);
    }
    expect(r.cells.map((c) => [c.cell, c.trials, c.passes, c.headline, c.bill.requests])).toEqual([
      ['claude-code-haiku-none-mu-v03-dev', 1, 1, false, 5], ['hermes-luna-none-mu-v03-dev', 1, 1, false, 6]]);
  });

  test('a request outside every turn window goes to out_of_turn; a mismatched receipt or an unmatched trial fails', () => {
    const [cc] = loadShards(FIXTURE);
    const rows = cc!.rows.map((l, i) => (i === 0 ? { ...l, at: '2026-10-30T16:56:31.900Z' } : l));
    const r = mine([{ ...cc!, rows }], OPTS);
    expect(r.cells[0]!.out_of_turn.requests).toBe(1);
    expect(r.ok).toBe(true);
    const off = mine([{ ...cc!, trials: cc!.trials.map((t) => ({ ...t, usage: { usd: (t.usage?.usd ?? 0) + 0.00001 } })) }], OPTS);
    expect(off.ok).toBe(false);
    const empty = mine([{ ...cc!, rows: [] }], OPTS);
    expect(empty.ok).toBe(false);
    expect(empty.unmatched).toEqual([`${RUN}/claude-code-haiku-none-mu-v03-dev/cn-01-tamsin-cold-chain-site/r1`]);
    const free = mine([{ ...cc!, rows: [], trials: cc!.trials.map((t) => ({ ...t, usage: { usd: 0 } })) }], OPTS);
    expect(free.ok).toBe(true);
  });

  test('contract sections aggregate in bytes, tokens only through a calibration table; an invalid partition is skipped', () => {
    const trial: TrialRow = { trial_id: 'r/c/t1/r1', cell: 'c', task: 't1', harness: 'h', model: 'anthropic:claude-opus-5-5', grade: 'pass', consent_violation: false, usage: { usd: 0 } };
    const turns: Turn[] = [{ turn: 1, started_wall: '2026-11-01T00:00:00.000Z', ended_wall: '2026-11-01T00:01:00.000Z' }, { turn: 2, started_wall: '2026-11-01T00:02:00.000Z', ended_wall: '2026-11-01T00:03:00.000Z' }];
    const sec = (n: number, tools: number): SectionsV1 => ({ v: 1, body_bytes: 1000 * n + tools + 10, system: 500, tools, user_text: 1000 * n - 500, tool_result: 0, assistant_text: 0, tool_use: 0, opaque: 0, media: 0, other: 10,
      message_count: n, tools_declared: [{ name: 'Read', bytes: tools }], conv_sha256: 'conv', boundary_sha256: Array.from({ length: n }, (_, i) => `b${i}`), tool_results: [] });
    const line = (at: string, n: number, usd: number, extra: Partial<UsageRow & { sections: unknown }>) => ({ at, key: 'trial-token:r/c/t1/r1', provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5',
      outcome: 'forwarded', actual_usd: usd, input_tokens: 1000 * n, cached_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0, ...extra });
    const usd = (n: number) => 1000 * n * 4 / 1e6;
    const rows = [line('2026-11-01T00:00:10.000Z', 1, usd(1), { sections: sec(1, 200), tools_called: [] } as never), line('2026-11-01T00:02:10.000Z', 3, usd(3), { sections: sec(3, 200), tools_called: ['Read'] } as never),
      line('2026-11-01T00:02:20.000Z', 3, usd(3), { sections: { ...sec(3, 200), other: 11 } } as never)];
    trial.usage = { usd: usd(1) + 2 * usd(3) };
    const loaded: LoadedShard = { shard: { run: 'r', cell: 'c', usage_log: '', sha256: '', trials_jsonl: '', trials_dir: '' }, rows: rows as UsageRow[], trials: [trial], turns: () => turns };
    const bytesOnly = mine([loaded], { sections: true, seed: 7, draws: 1000 });
    expect(bytesOnly.ok).toBe(true);
    expect(bytesOnly.reconciliation.sections_invalid).toBe(1);
    expect(bytesOnly.trials[0]!.bill.measured_requests).toBe(3);
    const c = bytesOnly.cells[0]!;
    expect(c.headline).toBe(true);
    expect(c.sections).toMatchObject({ requests: 2, body_bytes: 1210 + 3210, bytes: { system: 1000, tools: 400, user_text: 500 + 2500, other: 20 } });
    expect(c.sections!.tokens).toBeUndefined();
    expect(c.turns_by_index.map((u) => u.mean_body_bytes_per_request)).toEqual([1210, 3210]);
    expect(c.avoidable!.unused_tool_schemas!.total).toBe(0);
    const calibrated = mine([loaded], { sections: true, seed: 7, draws: 1000, calibration: { 'anthropic:claude-opus-5-5': { system: 0.25, tools: 0.5, user_text: 0.25, tool_result: 0.3, assistant_text: 0.25, tool_use: 0.4, opaque: 0, media: 0, other: 0.5 } } });
    expect(calibrated.cells[0]!.sections!.tokens).toMatchObject({ system: 250, tools: 200, user_text: 750, other: 10 });
    expect(calibrated.cells[0]!.sections!.uncalibrated_requests).toBe(0);
  });

  test('one usage log shared by two cells of a shard: each entry reconciles its own cell and skips the other cell\'s lines', () => {
    const trial = (cell: string, usd: number): TrialRow => ({ trial_id: `r/${cell}/t1/r1`, cell, task: 't1', harness: 'h', model: 'anthropic:claude-opus-5-5', grade: 'pass', consent_violation: false, usage: { usd } });
    const line = (cell: string, usd: number) => ({ at: '2026-11-01T00:00:10.000Z', key: `trial-token:r/${cell}/t1/r1`, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5',
      outcome: 'forwarded', actual_usd: usd, input_tokens: usd * 1e6 / 4, cached_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0 });
    const rows = [line('a', 0.012), line('b', 0.03)] as UsageRow[];
    const trials = [trial('a', 0.012), trial('b', 0.03)];
    const turns: Turn[] = [{ turn: 1, started_wall: '2026-11-01T00:00:00.000Z', ended_wall: '2026-11-01T00:01:00.000Z' }];
    const entry = (cell: string): LoadedShard => ({ shard: { run: 'r', cell, usage_log: '', sha256: '', trials_jsonl: '', trials_dir: '' }, rows, trials, turns: () => turns });
    const r = mine([entry('a'), entry('b')], OPTS);
    expect(r.ok).toBe(true);
    expect(r.reconciliation).toMatchObject({ trials_checked: 2, unattributed_lines: 0, unattributed_usd: 0, other_cell_lines: 2, earlier_attempt_lines: 0 });
    const parallel = mine([{ ...entry('a'), rows: [...rows, rows[0]!], trials: [trial('a', 0.024), trial('b', 0.03)] }], OPTS);
    expect(parallel.ok).toBe(true);
    expect(parallel.cells[0]!.bill.requests).toBe(2);
    const stray = mine([{ ...entry('a'), rows: [...rows, { ...line('a', 0.001), key: 'trial-token:r/z/t1/r1' } as UsageRow] }], OPTS);
    expect(stray.ok).toBe(false);
    expect(stray.reconciliation.unattributed_lines).toBe(1);
  });

  test('a line logged before its trial started is an earlier attempt, kept out of the trial; context growth counts chat requests only', () => {
    const trial: TrialRow = { trial_id: 'r/a/t1/r1', cell: 'a', task: 't1', harness: 'h', model: 'anthropic:claude-opus-5-5', grade: 'pass', started_at: '2026-11-01T00:00:05.000Z', usage: { usd: 0.008 } };
    const chat = (at: string, usd: number) => ({ at, key: 'trial-token:r/a/t1/r1', provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5',
      outcome: 'forwarded', actual_usd: usd, input_tokens: usd * 1e6 / 4, cached_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0 });
    const embed = { at: '2026-11-01T00:00:20.000Z', key: 'trial-token:r/a/t1/r1', provider: 'openai', route: '/v1/embeddings', model: 'text-embedding-3-small', outcome: 'forwarded', actual_usd: 0.00002, input_tokens: 1000 };
    const turns: Turn[] = [{ turn: 1, started_wall: '2026-11-01T00:00:00.000Z', ended_wall: '2026-11-01T00:01:00.000Z' }];
    const shard = (rows: unknown[], usd: number): LoadedShard => ({ shard: { run: 'r', cell: 'a', usage_log: '', sha256: '', trials_jsonl: '', trials_dir: '' }, rows: rows as UsageRow[], trials: [{ ...trial, usage: { usd } }], turns: () => turns });
    const resumed = mine([shard([chat('2026-11-01T00:00:01.000Z', 0.004), chat('2026-11-01T00:00:10.000Z', 0.008)], 0.008)], OPTS);
    expect(resumed.ok).toBe(true);
    expect(resumed.reconciliation).toMatchObject({ earlier_attempt_lines: 1, earlier_attempt_usd: 0.004, max_trial_usd_difference: 0 });
    const growth = mine([shard([chat('2026-11-01T00:00:10.000Z', 0.008), embed], 0.00802)], OPTS);
    expect(growth.ok).toBe(true);
    const turn = growth.trials[0]!.turns[0]!;
    expect([turn.chat_requests, turn.mean_input_tokens_per_request, turn.last_request_input_tokens]).toEqual([1, 2000, 2000]);
    expect(growth.cells[0]!.turns_by_index[0]!.mean_input_tokens_per_request).toBe(2000);
  });

  test('the CLI writes one JSON file and exits 1 when a receipt does not reconcile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'waterfall-mine-'));
    const run = (manifest: Shard[]) => {
      writeFileSync(join(dir, 'm.json'), JSON.stringify(manifest));
      return spawnSync(process.execPath, ['scripts/waterfall/mine.ts', '--manifest', join(dir, 'm.json'), '--out', join(dir, 'out.json')], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: ROOT } });
    };
    const ok = run(FIXTURE);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('2 reconciled');
    expect(JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')).trials).toHaveLength(2);
    const trials = readFileSync(join(ROOT, FIXTURE[0]!.trials_jsonl), 'utf8').replace('"usd":0.002551565', '"usd":0.0026');
    writeFileSync(join(dir, 'trials.jsonl'), trials);
    const bad = run(FIXTURE.map((s) => ({ ...s, trials_jsonl: relative(ROOT, join(dir, 'trials.jsonl')) })));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('WATERFALL_MINE: FAIL');
  });

  test('the appendix manifest names the nine host-pilot shards and every hash matches its file', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/token-waterfall/data/appendix-manifest.json'), 'utf8')) as Shard[];
    expect(manifest).toHaveLength(9);
    for (const s of manifest) {
      expect(sha(s.usage_log)).toBe(s.sha256);
      if (s.trials_sha256) expect(sha(s.trials_jsonl)).toBe(s.trials_sha256);
    }
  });
});
