// merge-shards.ts --skipped-by-rule (harness-zero-select-2026-11's conditional no-eh-sol cell, R3-3): a planned cell that the
// preregistration's own conditional rule did not run merges with no trial, with or without --partial, and shards.json records
// it with its reason; an unnamed missing cell, a named cell with records, an unknown cell, a cell named twice, or one also
// --vm-lost is refused.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MergeError, planMerge } from '../scripts/merge-shards.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'skipped-by-rule-fixture-2026-11';
const SCRUBBED = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const ids = (cell: string) => ['t1', 't2'].flatMap((task) => [1, 2].map((r) => `${RUN}/${cell}/${task}/r${r}`));
const row = (id: string) => ({ trial_id: id, cell: id.split('/')[1], task: id.split('/')[2], termination: 'completed', grade: 'pass', cap_stop: false, usage: null, started_at: '' });

/** Three planned cells: zf-sol and zm-sol ran on shards a and b; no-eh-sol has no shard. */
function shards(): { root: string; dirs: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'he-skipped-by-rule-'));
  const manifest = { run_id: RUN, created_at: '2026-11-06T00:00:00.000Z', trials: ['zf-sol', 'zm-sol', 'no-eh-sol'].flatMap((cell) => ids(cell).map((id) => ({ id, cell }))) };
  const dirs: Record<string, string> = {};
  for (const [name, cell] of [['a', 'zf-sol'], ['b', 'zm-sol']] as const) {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(d, 'trials.jsonl'), ids(cell).map((id) => JSON.stringify(row(id))).join('\n') + '\n');
    dirs[name] = d;
  }
  return { root, dirs };
}
const input = (dirs: Record<string, string>) => Object.entries(dirs).map(([name, dir]) => ({ name, dir }));
const reason = "the preregistration's conditional rule did not run this cell";

describe('merge-shards --skipped-by-rule', () => {
  test('a named cell with no trial merges, is neither missing nor unstarted, and is recorded with its reason', () => {
    const { root, dirs } = shards();
    const plan = planMerge(join(root, 'out'), input(dirs), { skippedByRule: [{ cell: 'no-eh-sol', reason: 'Opus did not keep effort-high' }] });
    expect(plan.rows.length).toBe(8);
    expect(plan.unstarted).toEqual([]);
    expect(plan.shardsFile.skipped_by_rule).toEqual([{ cell: 'no-eh-sol', reason: 'Opus did not keep effort-high', planned_trials: 4 }]);
    const partial = planMerge(join(root, 'out-partial'), input(dirs), { partial: true, skippedByRule: [{ cell: 'no-eh-sol', reason }] });
    expect(partial.unstarted).toEqual([]);
    expect(partial.capStops).toEqual([]);
  });

  test('without the flag the missing cell still refuses, and so do a named cell with records, an unknown cell, a cell named twice and one also lost', () => {
    const { root, dirs } = shards();
    const out = join(root, 'out');
    expect(() => planMerge(out, input(dirs))).toThrow('4 manifest trial(s) in no shard');
    expect(() => planMerge(out, input(dirs), { partial: true })).toThrow('no-eh-sol (no recorded trial)');
    expect(() => planMerge(out, input({ a: dirs.a! }), { skippedByRule: [{ cell: 'no-eh-sol', reason }] })).toThrow('4 manifest trial(s) in no shard');
    expect(() => planMerge(out, input(dirs), { skippedByRule: [{ cell: 'zm-sol', reason }] })).toThrow('--skipped-by-rule cell(s) zm-sol have recorded trials');
    expect(() => planMerge(out, input(dirs), { skippedByRule: [{ cell: 'qm-sol', reason }] })).toThrow('not in the manifest: qm-sol');
    expect(() => planMerge(out, input(dirs), { skippedByRule: [{ cell: 'no-eh-sol', reason }, { cell: 'no-eh-sol', reason }] })).toThrow('names cell(s) twice: no-eh-sol');
    expect(() => planMerge(out, input(dirs), { partial: true, vmLost: ['no-eh-sol'], skippedByRule: [{ cell: 'no-eh-sol', reason }] })).toThrow(MergeError);
  });

  test('the CLI writes skipped_by_rule into shards.json and refuses a flag with no cell', () => {
    const { root, dirs } = shards();
    const merge = (out: string, extra: string[]) => spawnSync(process.execPath, ['scripts/merge-shards.ts', '--out', join(root, out), '--shard', `a=${dirs.a}`, '--shard', `b=${dirs.b}`, ...extra], { cwd: ROOT, encoding: 'utf8', env: SCRUBBED });
    const ok = merge('merged', ['--skipped-by-rule', 'no-eh-sol']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('Skipped by rule: no-eh-sol (4 planned trials, none run)');
    expect(JSON.parse(readFileSync(join(root, 'merged', 'shards.json'), 'utf8')).skipped_by_rule).toEqual([{ cell: 'no-eh-sol', reason, planned_trials: 4 }]);
    expect(existsSync(join(root, 'merged', 'unstarted.json'))).toBe(false);
    const bad = merge('bad', ['--skipped-by-rule', '=why']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('--skipped-by-rule takes <cell>[=<reason>]');
    const refused = merge('refused', []);
    expect(refused.status).toBe(2);
    expect(existsSync(join(root, 'refused', 'trials.jsonl'))).toBe(false);
  });
});
