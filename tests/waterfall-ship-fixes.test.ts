// internal-task /ship review fixes: no dedupe in cost-split, sanitized declared tool names, held-out cells refuse
// log_sections, lineExtrasFor never throws, the smoke check's missing-log and sections_error branches, vm-shard.sh's
// guarded sections step, and the Step 11 voice fixes (partial cache reads, calibration import, built-in tool calls,
// unpairable contrasts).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costSplit, type UsageRow } from '../scripts/anatomy/cost-split.ts';
import { INVALID_TOOL, requestSections } from '../runner/proxy/sections.ts';
import { lineExtrasFor } from '../runner/proxy/metering-proxy.ts';
import { loadPrereg, RunnerError, type Cell, type Prereg } from '../runner/run.ts';
import { sectionsSmokeProblems } from '../runner/trial/proxy.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';
import { responseExtras, UNLISTED_TOOL } from '../runner/proxy/sections.ts';
import { unreadCacheWrites, type SectionRequest } from '../scripts/waterfall/avoidable.ts';
import { calibrationTable, sectionTotals } from '../scripts/waterfall/mine.ts';
import { contentItems } from '../scripts/waterfall/chart.ts';
import { contrast, type ContrastTrial } from '../scripts/waterfall/contrasts.ts';

const tmp = mkdtempSync(join(tmpdir(), 'harn21-fixes-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const row = (o: Partial<UsageRow>): UsageRow => ({ at: '2026-10-25T08:29:24.240Z', key: 'trial-token:r/cell-a/t1/r1', provider: 'anthropic', route: '/v1/messages',
  model: 'claude-opus-5-5', outcome: 'forwarded', status: 200, actual_usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, ...o } as UsageRow);

describe('cost-split dedupe (internal-task ship review)', () => {
  test('both same-millisecond requests count toward the trial, so it reconciles', () => {
    const a = row({ input_tokens: 1000, output_tokens: 10, actual_usd: 0.0042 });
    const b = row({ input_tokens: 2000, output_tokens: 20, actual_usd: 0.0084 });
    const s = costSplit([a, b], [{ trial_id: 'r/cell-a/t1/r1', usage: { usd: 0.0126 } }] as never);
    expect(s.trials_unmatched).toBe(0);
    expect(s.max_trial_usd_difference).toBeLessThanOrEqual(0.000001);
  });
});

describe('declared tool names (internal-task ship review)', () => {
  test('a name outside 1 to 64 word characters, dots or dashes is logged as <invalid>', () => {
    const body = { model: 'm', max_tokens: 1, tools: [{ name: 'list_channels', input_schema: {} }, { name: 'x'.repeat(65), input_schema: {} }, { name: 'has space and text', input_schema: {} }, { type: 'web_search_20250305' }], messages: [{ role: 'user', content: 'hi' }] };
    const s = requestSections(body, Buffer.byteLength(JSON.stringify(body)), 'anthropic', '/v1/messages');
    expect(s.tools_declared.map((t) => t.name)).toEqual(['list_channels', INVALID_TOOL, INVALID_TOOL, 'web_search_20250305']);
  });
});

describe('held-out cells (internal-task ship review)', () => {
  test('log_sections on a held-out split is refused with HE-PREREG-007', () => {
    const cell: Cell = { id: 'h', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', slice: 'hello', split: 'heldout', repetitions: 1, ceiling: { input_tokens: 1000, output_tokens: 100 }, log_sections: true };
    const p: Prereg = { schema_version: 1, run_id: 'heldout-sections', question: 'q', tasks: { hello: ['hello'] }, cells: [cell], wall_clock_s: { hello: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    const f = join(tmp, 'prereg.json');
    writeFileSync(f, JSON.stringify(p));
    let code = 'no refusal', message = '';
    try { loadPrereg(f); } catch (e) { code = (e as RunnerError).code; message = (e as Error).message; }
    expect(code).toBe('HE-PREREG-007');
    expect(message).toContain('held-out');
  });
});

describe('lineExtrasFor (internal-task ship review)', () => {
  test('a response whose usage throws yields zero counts and a sections_error, never an exception', () => {
    const bad = { get usage() { throw new Error('boom'); } };
    const body = { model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };
    const sections = requestSections(body, Buffer.byteLength(JSON.stringify(body)), 'anthropic', '/v1/messages');
    const out = lineExtrasFor('anthropic', '/v1/messages', bad, { sections });
    expect(out.cache_write_tokens).toBe(0);
    expect(out.reasoning_tokens).toBe(0);
    expect(String(out.sections_error)).toStartWith('response extras:');
    expect(out.sections).toBeUndefined();
  });
});

describe('the smoke sections check (internal-task ship review)', () => {
  test('an empty usage log fails, and a line carrying sections_error fails with its reason', () => {
    expect(sectionsSmokeProblems([])).toEqual(['no forwarded chat line in the usage log']);
    const line = { at: '', key: 'k', provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', status: 200,
      cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0, sections_error: 'request body: not JSON' } as unknown as UsageLine;
    const problems = sectionsSmokeProblems([line]);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('sections_error (request body: not JSON)');
  });
});

describe('vm-shard.sh sections step (internal-task ship review)', () => {
  // A shard pinned before this change has no check-sections command, so the smoke runs it only when a cell sets log_sections.
  const script = readFileSync(join(import.meta.dir, '..', 'scripts', 'ubicloud', 'vm-shard.sh'), 'utf8');
  const guard = script.match(/python3 -c "(import json,sys; sys\.exit\(0 if any\(c\.get\('log_sections'\)[^"]+)"/)?.[1];
  const wants = (cells: unknown[]) => {
    const f = join(tmp, `manifest-${cells.length}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify({ cells }));
    return spawnSync('python3', ['-c', guard!, f], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } }).status;
  };
  test('check-sections runs only when a smoke cell sets log_sections', () => {
    expect(guard).toBeDefined();
    expect(script).toMatch(/log_sections'\) is True[^\n]*\n\s+bun runner\/run\.ts check-sections/);
    expect(wants([{ id: 'a', log_sections: true }, { id: 'b' }])).toBe(0);
    expect(wants([{ id: 'a' }, { id: 'b', log_sections: false }])).toBe(1);
  });
});

describe('Step 11 voices (internal-task ship review)', () => {
  const sec = (msgs: string[]) => ({ v: 1, body_bytes: 0, system: 0, tools: 0, user_text: 0, tool_result: 0, assistant_text: 0, tool_use: 0, opaque: 0, media: 0, other: 0, message_count: msgs.length,
    tools_declared: [], conv_sha256: 'A', boundary_sha256: msgs.map((_, i) => msgs.slice(0, i + 1).join('|')), tool_results: [] });
  const at = (s: number, msgs: string[], read: number, write: number) => ({ at: s * 1000, turn: 1, usd: 0, cache_read: read, cache_write: write, cache_write_1h: 0, sections: sec(msgs), tools_called: [] }) as unknown as SectionRequest;
  test('a later read that reaches only part of a write leaves the rest unread', () => {
    expect(unreadCacheWrites([at(0, ['u'], 2000, 10000), at(10, ['u', 'a', 'u2'], 2000, 0)])).toEqual({ requests: 1, tokens: 10000 });
    expect(unreadCacheWrites([at(0, ['u'], 2000, 10000), at(10, ['u', 'a', 'u2'], 7000, 0)])).toEqual({ requests: 1, tokens: 5000 });
    expect(unreadCacheWrites([at(0, ['u'], 2000, 10000), at(10, ['u', 'a', 'u2'], 12000, 0)])).toEqual({ requests: 0, tokens: 0 });
  });

  test('a calibrate.ts output calibrates the sections it measured; the rest stay in bytes, listed as uncalibrated', () => {
    const table = calibrationTable({ model: 'claude-opus-5-5', sections: { system: { n: 3, tokens_per_byte: { pooled: 0.25 } }, media: { n: 0, tokens_per_byte: null } } });
    expect(table).toEqual({ 'claude-opus-5-5': { system: 0.25 } });
    const s = { ...sec(['u']), body_bytes: 1100, system: 1000, other: 100 };
    const t = sectionTotals([{ at: 0, turn: 1, provider: 'anthropic', model: 'claude-opus-5-5', bill: {}, sections: s, tools_called: [] }] as never, table)!;
    expect(t.uncalibrated_requests).toBe(0);
    expect(t.tokens!.system).toBe(250);
    expect(t.uncalibrated_bytes!.other).toBe(100);
    expect(contentItems(t).unit).toBe('bytes');
    expect(calibrationTable({ 'claude-opus-5-5': { system: 0.3 } })).toEqual({ 'claude-opus-5-5': { system: 0.3 } });
    const other = sectionTotals([{ at: 0, turn: 1, provider: 'openai', model: 'gpt-6.1-sol', bill: {}, sections: s, tools_called: [] }] as never, table)!;
    expect(other.uncalibrated_requests).toBe(1);
    expect(other.uncalibrated_bytes).toMatchObject({ system: 1000, other: 100 });
  });

  test('a Responses built-in call counts as a call of its declared built-in tool, parsed or streamed', () => {
    const parsed = { output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }, { type: 'function_call', name: 'run_shell' }], usage: {} };
    expect(responseExtras('openai', '/v1/responses', parsed, ['run_shell', 'web_search_preview']).tools_called).toEqual(['web_search_preview', 'run_shell']);
    const sse = `data: ${JSON.stringify({ type: 'response.output_item.added', item: { type: 'web_search_call', id: 'ws_1' } })}\n\n`;
    expect(responseExtras('openai', '/v1/responses', sse, ['web_search']).tools_called).toEqual(['web_search']);
    expect(responseExtras('openai', '/v1/responses', parsed, ['run_shell']).tools_called).toEqual([UNLISTED_TOOL, 'run_shell']);
    expect(responseExtras('openai', '/v1/responses', parsed, ['web_search_docs', 'run_shell', 'web_search_preview_2025_03_11']).tools_called).toEqual(['web_search_preview_2025_03_11', 'run_shell']);
    expect(responseExtras('openai', '/v1/responses', parsed, ['web_search_docs', 'run_shell']).tools_called).toEqual([UNLISTED_TOOL, 'run_shell']);
  });

  test('two same-model cells with no trial in common are reported as not compared instead of stopping the run', () => {
    const one = (cell: string, task: string): ContrastTrial[] => [{ cell, task, rep: 1, usd: 0.01, pass: true }];
    const r = contrast(one('A', 't1'), one('B', 't2'), { a: 1, b: 1 }, { seed: 7, draws: 200 });
    expect(r.status).toBe('not compared (no paired trials)');
    expect(r.trials.paired).toBe(0);
    expect(r.dollars_per_trial).toBeNull();
    expect(r.excluded).toEqual({ tasks_only_in_a: ['t1'], tasks_only_in_b: ['t2'], unpaired_trials: [] });
  });
});
