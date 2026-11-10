// The 2026-11-09 corrections rebuild every published sensitivity row from committed receipts, keyless
// (docs/corrections/2026-11-09/README.md). These tests rerun each script on the committed receipts and check its output
// against what the corrections, the recall rerun's report and the changelog publish.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnWindow, WorldSnapshot } from '../runner/contracts.ts';
import { withholdRunnerReplies } from '../scripts/corrections/regrade-sensitivity.ts';
import { validateRecords } from '../scripts/validate-records.ts';

const ROOT = join(import.meta.dir, '..');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const scratch = (name: string) => mkdtempSync(join(tmpdir(), `he-corrections-${name}-`));
const bun = (args: string[]) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
// The public copy holds the frontier-harness per-trial results back for one export (publication/manifest.json), and the
// reproducer reads them, so there the byte-for-byte rebuild is skipped with a line naming the absent files.
const HELD = ['docs/benchmarks/2026-11-07-frontier-harness/results/merged', 'docs/benchmarks/2026-11-07-frontier-harness/results/extension/merged'].filter((p) => !existsSync(join(ROOT, p)));
if (HELD.length) console.log(`SKIP reproduce-2026-11-09.sh --check: held frontier results absent in this copy: ${HELD.join(', ')}`);

describe('2026-11-09 corrections: the sensitivity rows rebuild from committed receipts', () => {
  test.skipIf(HELD.length > 0)('reproduce-2026-11-09.sh --check rebuilds docs/corrections/2026-11-09/sensitivity.json byte for byte', () => {
    const r = spawnSync('bash', ['scripts/corrections/reproduce-2026-11-09.sh', scratch('s5'), '--check'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.stderr + r.stdout).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(ROOT, 'docs/corrections/2026-11-09/sensitivity.json'), 'utf8'))).toBeTruthy();
  }, 300_000);

  test('the reproducer runs every analysis script the sensitivity rows come from', () => {
    const sh = readFileSync(join(ROOT, 'scripts/corrections/reproduce-2026-11-09.sh'), 'utf8');
    for (const script of [
      'scripts/corrections/regrade-sensitivity.ts',
      'scripts/corrections/relay-conflict.ts',
      'scripts/corrections/reservation-cost.ts',
      'scripts/corrections/turn-time.ts',
      'scripts/corrections/tables-2026-11-09.ts',
    ]) expect(sh).toContain(script);
  });
});

describe('the withhold rule', () => {
  test('a successful bot post over Slack, or addressed by channel name, withholds the runner reply as runner/trial/turns.ts does', () => {
    const turn = (n: number, started_seq: number, ended_seq: number, reply_ts: string): TurnWindow => ({ turn: n, actor: 'm1', slack_user_id: 'U1', channel: 'C1', channel_name: 'deals', channel_type: 'channel', text: 'hi',
      request_ts: '1.0', started_wall: '', ended_wall: '', started_seq, ended_seq, exit: 0, reply_ts, reply_text: 'Done: I posted the reply.' });
    const post = (seq: number, via: string, channel: string, ts: string) => ({ seq, at: '', actor: 'assistant', via, kind: 'write', service: 'slack', tool: 'chat.postMessage', outcome: 'ok', effect: { channel, ts } });
    const turns = [turn(1, 1, 3, '9.1'), turn(2, 4, 6, '9.2')];
    const events = [post(2, 'slack', 'C1', '2.0'), post(4, 'slack', 'C1', '9.1'), post(5, 'mcp', 'deals', '5.0'), post(7, 'slack', 'C1', '9.2')];
    const snapshot = { messages: [{ ts: '2.0', channel: 'C1' }, { ts: '9.1', channel: 'C1' }, { ts: '5.0', channel: 'C1' }, { ts: '9.2', channel: 'C1' }] } as unknown as WorldSnapshot;
    expect(withholdRunnerReplies(turns, events as unknown as Parameters<typeof withholdRunnerReplies>[1], snapshot)).toBe(2);
    expect(turns.map((t) => t.reply_ts)).toEqual([null, null]);
    expect((snapshot as unknown as { messages: Array<{ ts: string }> }).messages.map((m) => m.ts)).toEqual(['2.0', '5.0']);
  });
});

describe('the recall rerun analysis', () => {
  test('recall-rerun-analysis.ts rebuilds the committed analysis files byte for byte', () => {
    const out = scratch('rr');
    const run = 'docs/benchmarks/2026-11-10-harness-zero-h2h-recall-rerun';
    const r = bun(['scripts/corrections/recall-rerun-analysis.ts', '--rerun', `${run}/results`, '--published', 'docs/benchmarks/2026-11-06-harness-zero-h2h/results', '--out', out]);
    expect(r.status).toBe(0);
    for (const f of ['analysis.json', 'analysis.md']) expect(readFileSync(join(out, f), 'utf8')).toBe(readFileSync(join(ROOT, run, 'analysis', f), 'utf8'));
  }, 120_000);
});

describe('cross-member recall sizing', () => {
  test('gbrain-cross-member-recall.ts gives the published counts for the runs before the fix', () => {
    const out = scratch('gb');
    const r = bun(['scripts/corrections/gbrain-cross-member-recall.ts', '--out', out]);
    expect(r.status).toBe(0);
    const cells = (JSON.parse(readFileSync(join(out, 'gbrain-sizing.json'), 'utf8')) as { cells: Array<{ run: string; n: number; affected: number; affected_failed: number }> }).cells
      .filter((c) => c.run !== '2026-11-10-harness-zero-h2h-recall-rerun');
    const sum = (rows: typeof cells, k: 'n' | 'affected' | 'affected_failed') => rows.reduce((s, c) => s + c[k], 0);
    expect([sum(cells, 'n'), sum(cells, 'affected'), sum(cells, 'affected_failed')]).toEqual([2230, 48, 29]);
    const h2h = cells.filter((c) => c.run === '2026-11-06-harness-zero-h2h');
    expect([sum(h2h, 'affected'), sum(h2h, 'affected_failed')]).toEqual([37, 26]);
  }, 120_000);
});

describe('scorer input check', () => {
  test('validateRecords names a duplicate trial id and an unplanned trial', () => {
    const row = { trial_id: 'r/c/t/r1', cell: 'c', task: 't', termination: 'completed', grade: 'pass', consent_violation: false, usage: null };
    expect(validateRecords([row, row], { trials: [{ id: 'r/c/t/r1', cell: 'c', task: 't' }] })).toEqual(['trial r/c/t/r1 is recorded twice']);
    expect(validateRecords([row], { trials: [{ id: 'r/c/t/r2', cell: 'c', task: 't' }] })).toEqual(['trial r/c/t/r1 is not in the manifest']);
  });
});
