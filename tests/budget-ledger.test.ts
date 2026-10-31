// The budget ledger renderer (scripts/budget-ledger.ts): the lane lines parsed from docs/ledger/lane-spend.jsonl, the
// runs of the receipts manifest no lane names, the dollar formatting that keeps a line's own decimals, a byte-stable
// render whose totals add only what the lines carry, --check over a temporary root, and the committed page matching
// the committed JSONL.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MANIFEST_FILE, OUTPUT_FILE, PROGRAM_CAP_USD, SOURCE_FILE, parseLanes, renderPage, unlistedRuns, usd } from '../scripts/budget-ledger.ts';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'budget-ledger.ts');

const lanes = [
  { lane: 'a-2026-01', ledger: 'docs/benchmarks/2026-01-02-a/results/ledger.sqlite', committed_usd: 1.5, date: '2026-01-02', trials: 10, requests: 80, note: 'first | lane' },
  { lane: 'scratch', ledger: 'lane machine /tmp (not kept)', committed_usd: 0.0525, date: '2026-01-03' },
];
const runs = [
  { directory: 'docs/benchmarks/2026-01-02-a', run_id: 'a-2026-01', report: 'docs/benchmarks/2026-01-02-a/report.md', trials: 10, ledgers: [{ ledger_committed_usd: 1.5 }] },
  { directory: 'docs/benchmarks/2026-01-04-b', run_id: 'b-2026-01', report: 'docs/benchmarks/2026-01-04-b/report.md', trials: 6, ledgers: [{ ledger_committed_usd: 0.25 }, { ledger_committed_usd: 'not a ledger' }] },
  { directory: 'docs/benchmarks/2026-01-05-c', run_id: 'c-2026-01', report: null, trials: 3, ledgers: [{ ledger_committed_usd: 0.1 }] },
  { directory: 'docs/benchmarks/2026-01-06-d', run_id: null, report: null, trials: 0, ledgers: [] },
];

describe('parseLanes', () => {
  test('reads one lane per line, keeps extra fields and skips blank lines', () => {
    const text = JSON.stringify({ ...lanes[0], extra: 'kept' }) + '\n\n' + JSON.stringify(lanes[1]) + '\n';
    const out = parseLanes(text);
    expect(out).toHaveLength(2);
    expect(out[0].extra).toBe('kept');
    expect(out[1].trials).toBeUndefined();
  });
  test('names the line that is not JSON or lacks a required field', () => {
    expect(() => parseLanes(JSON.stringify(lanes[1]) + '\nnot json\n')).toThrow(`${SOURCE_FILE} line 2: not JSON`);
    expect(() => parseLanes('{"lane":"x","ledger":"y","committed_usd":"1","date":"2026-01-01"}\n')).toThrow('line 1: needs string lane');
  });
});

describe('unlistedRuns', () => {
  test('a run named by lane id or by results directory is listed; the rest sum their readable ledgers', () => {
    const named = [...lanes, { lane: 'other', ledger: 'see docs/benchmarks/2026-01-05-c/results/x.sqlite', committed_usd: 0.1, date: '2026-01-05' }];
    const out = unlistedRuns(runs, named);
    expect(out.map((r) => r.run_id)).toEqual(['b-2026-01']);
    expect(out[0]).toMatchObject({ trials: 6, committed_usd: 0.25, unreadable_ledgers: 1 });
  });

  test('a lane whose ledger names the whole run id lists the run; a longer id that only contains it does not', () => {
    const byId = [...lanes, { lane: 'internal-task', ledger: '~/.capy/work/x/shards/<shard>/ (run b-2026-01)', committed_usd: 0.25, date: '2026-01-05' }];
    expect(unlistedRuns(runs, byId).map((r) => r.run_id)).toEqual(['c-2026-01']);
    const longer = [...lanes, { lane: 'internal-task', ledger: 'run b-2026-01b and xb-2026-01', committed_usd: 0.25, date: '2026-01-05' }];
    expect(unlistedRuns(runs, longer).map((r) => r.run_id)).toEqual(['b-2026-01', 'c-2026-01']);
  });

  test('a run id or directory followed by more run-id characters (".retry", ":smoke", "-hook") names a different run', () => {
    const other = [...lanes, { lane: 'internal-task', ledger: '/scratch/b-2026-01.retry/ledger.sqlite, run b-2026-01:smoke, docs/benchmarks/2026-01-05-c-hook/results', committed_usd: 0.1, date: '2026-01-05' }];
    expect(unlistedRuns(runs, other).map((r) => r.run_id)).toEqual(['b-2026-01', 'c-2026-01']);
    const sentence = [...lanes, { lane: 'internal-task', ledger: 'shard ledgers for run b-2026-01. See docs/benchmarks/2026-01-05-c.', committed_usd: 0.1, date: '2026-01-05' }];
    expect(unlistedRuns(runs, sentence).map((r) => r.run_id)).toEqual([]);
  });
});

describe('usd', () => {
  test('keeps a line\'s decimals, never fewer than two, with thousands separators', () => {
    expect(usd(1.5)).toBe('$1.50');
    expect(usd(0.0525)).toBe('$0.0525');
    expect(usd(1826.256866)).toBe('$1,826.256866');
    expect(usd(0)).toBe('$0.00');
  });
});

describe('renderPage', () => {
  test('is byte-stable, escapes pipes, marks missing counts and adds only what the lines carry', () => {
    const page = renderPage(lanes, unlistedRuns(runs, lanes));
    expect(renderPage(lanes, unlistedRuns(runs, lanes))).toBe(page);
    expect(page).toContain('first \\| lane');
    expect(page).toContain('| not recorded |');
    expect(page).toContain(usd(1.5525));
    expect(page).toContain(`against the $${PROGRAM_CAP_USD.toLocaleString('en-US')} program cap`);
    expect(page).toContain('$1,998.45 of the cap remains');
    expect(page).toContain('b-2026-01');
    expect(page).toContain('c-2026-01');
    expect(page).not.toContain('2026-01-06-d');
    expect(page).toContain('## Changelog');
    expect(page).not.toMatch(/\u2014/);
  });
});

describe('the command', () => {
  test('--check exits 1 when the page differs and 0 once it is rendered', () => {
    const root = mkdtempSync(join(tmpdir(), 'budget-ledger-'));
    mkdirSync(join(root, 'docs', 'ledger'), { recursive: true });
    writeFileSync(join(root, SOURCE_FILE), lanes.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(root, MANIFEST_FILE), JSON.stringify({ runs }));
    const run = (...args: string[]) => spawnSync('bun', [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
    const missing = run('--check');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(`differs from ${SOURCE_FILE}`);
    expect(run().status).toBe(0);
    expect(readFileSync(join(root, OUTPUT_FILE), 'utf8')).toBe(renderPage(lanes, unlistedRuns(runs, lanes)));
    expect(run('--check').status).toBe(0);
  });
  test('the committed page is the render of the committed ledger and manifest', () => {
    const committedLanes = parseLanes(readFileSync(join(ROOT, SOURCE_FILE), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_FILE), 'utf8')) as { runs: Parameters<typeof unlistedRuns>[0] };
    expect(committedLanes.length).toBeGreaterThan(0);
    expect(readFileSync(join(ROOT, OUTPUT_FILE), 'utf8')).toBe(renderPage(committedLanes, unlistedRuns(manifest.runs, committedLanes)));
  });
});
