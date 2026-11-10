// The 2026-11-10 corrections rebuild every number from committed receipts, keyless (docs/corrections/2026-11-10/README.md).
// These tests rerun the reproducer on the committed receipts, check the cut rule on a small made-up run, and check that the
// published prose quotes sensitivity.json.
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCuts, scan, type TrialRow } from '../scripts/corrections/harbor-cut.ts';

const ROOT = join(import.meta.dir, '..');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const scratch = (name: string) => mkdtempSync(join(tmpdir(), `he-corrections-${name}-`));
// The byte-for-byte rebuild needs the frontier-harness per-trial results and scripts/frontier-harbor/subset.ts. The public
// copy keeps subset.ts private (publication/manifest.json: it imports to-trials.ts, which reaches the Lane B bridge), so
// where either is absent the rebuild is skipped with a line naming what is missing.
const HELD = ['docs/benchmarks/2026-11-07-frontier-harness/results/merged', 'docs/benchmarks/2026-11-07-frontier-harness/results/extension/merged', 'scripts/frontier-harbor/subset.ts'].filter((p) => !existsSync(join(ROOT, p)));
if (HELD.length) console.log(`SKIP reproduce-2026-11-10.sh --check: absent in this copy: ${HELD.join(', ')}`);

describe('2026-11-10 corrections: every number rebuilds from committed receipts', () => {
  test.skipIf(HELD.length > 0)('reproduce-2026-11-10.sh --check rebuilds docs/corrections/2026-11-10/sensitivity.json byte for byte', () => {
    const r = spawnSync('bash', ['scripts/corrections/reproduce-2026-11-10.sh', scratch('s10'), '--check'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.stderr + r.stdout).toBe('');
    expect(r.status).toBe(0);
  }, 300_000);

  test('the reproducer runs every script the numbers come from', () => {
    const sh = readFileSync(join(ROOT, 'scripts/corrections/reproduce-2026-11-10.sh'), 'utf8');
    for (const script of ['scripts/corrections/harbor-cut.ts', 'scripts/corrections/reservation-cost.ts', 'scripts/frontier-harbor/subset.ts', 'scripts/frontier-harbor/analyze.ts', 'scripts/corrections/tables-2026-11-10.ts']) expect(sh).toContain(script);
  });
});

describe('the published prose quotes sensitivity.json', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'docs/corrections/2026-11-10/sensitivity.json'), 'utf8'));
  const md = readFileSync(join(ROOT, 'docs/corrections/2026-11-10/README.md'), 'utf8');
  const usd = (x: number) => '$' + x.toFixed(4);
  const range = (v: number, ci: number[], f: (x: number) => string) => `${f(v)} [${f(ci[0]!)}, ${f(ci[1]!)}]`;
  const ratio = (x: number) => x.toFixed(2) + 'x';

  test('the 15 s cut: one cell, its cost per solved task and its ratio against Codex', () => {
    const cut = s.harbor_cut;
    const cutCells = Object.entries(cut.cells as Record<string, { cut_requests: number; resends: number; trials_with_cut: number; cut_share_of_published_cell_usd: number }>).filter(([, c]) => c.cut_requests);
    expect(cutCells.map(([id]) => id)).toEqual(['sol-hermes']);
    expect(Object.keys(cut.cells)).toHaveLength(20);
    const [, h] = cutCells[0]!;
    expect([h.cut_requests, h.resends, h.trials_with_cut, (100 * h.cut_share_of_published_cell_usd).toFixed(2)]).toEqual([39, 7, 11, '1.78']);
    const c = cut.cut_removed.cells['sol-hermes'];
    expect(md).toContain(`| ${range(c.published.usd_per_solve, c.published.usd_per_solve_ci95, usd)} | ${range(c.now.usd_per_solve, c.now.usd_per_solve_ci95, usd)} |`);
    const p = cut.cut_removed.pairs['sol-hermes vs sol-codex'];
    expect(md).toContain(`| ${range(p.published.cost_ratio, p.published.cost_ratio_ci95, ratio)} | ${range(p.now.cost_ratio, p.now.cost_ratio_ci95, ratio)} |`);
    const lb = cut.lower_bound_resent_cuts_removed.cells['sol-hermes'];
    expect(md).toContain(`only the 7 resent charges removed), Hermes Agent is ${range(lb.now.usd_per_solve, lb.now.usd_per_solve_ci95, usd)}`);
    for (const k of ['cut_removed', 'lower_bound_resent_cuts_removed', 'cut_and_reservation_removed', 'all_spend_cut_removed', 'post_hoc_drop_cut_trials_that_failed', 'post_hoc_drop_all_cut_trials']) {
      expect(cut[k].verdict_flips).toEqual([]);
      expect(cut[k].readme_rank_flips).toEqual([]);
    }
  });

  test('Pi scored as fails on pytorch-model-recovery: pass rates, Holm p and verdicts', () => {
    const pi = s.pi_pytorch_model_recovery.as_fail;
    expect(pi.verdict_flips).toEqual([]);
    expect(pi.readme_rank_flips).toEqual([]);
    const pct = (x: number) => (100 * x).toFixed(1) + '%';
    for (const id of ['opus-pi', 'sol-pi']) {
      const c = pi.cells[id];
      expect(md).toContain(`| ${range(c.published.pass_rate, c.published.pass_ci95, pct)}, 102 on 51 | ${range(c.now.pass_rate, c.now.pass_ci95, pct)}, 104 on 52 |`);
    }
    expect(pi.pairs['opus-pi vs opus-cc'].now.holm_p_noninferiority.toFixed(3)).toBe('0.043');
    expect(pi.pairs['sol-pi vs sol-codex'].now.holm_p_noninferiority.toFixed(3)).toBe('0.031');
  });
});

describe('the 15 s cut rule', () => {
  test('a slow non-streamed call and a slow call resent 15 s later are cut; a fast reply and a resend 20 s later are not', () => {
    const dir = scratch('cut');
    const shard = join(dir, 'merged', 'shards', 'c', 'main');
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(dir, 'merged', 'trials.jsonl'), JSON.stringify({ trial_id: 'run/c/t/a1', cell: 'c', task: 't', frontier: { harbor_trial: 'k1' } }) + '\n');
    const at = (s: number) => new Date(Date.UTC(2026, 10, 8, 0, 0, s)).toISOString();
    const line = (s: number, streamed: boolean, input: number, usd: number) => ({ at: at(s), key: 'k1', model: 'm', route: '/v1/chat/completions', outcome: 'forwarded', status: 200, streamed, input_tokens: input, actual_usd: usd });
    const lines = [line(0, false, 100, 0.01), line(30, true, 200, 0.02), line(45, true, 200, 0.03), line(70, true, 300, 0.04), line(90, true, 300, 0.05), line(120, false, 400, 0.06)];
    writeFileSync(join(shard, 'proxy-usage.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const db = new Database(join(shard, 'ledger.sqlite'));
    db.run('create table entries (seq integer primary key autoincrement, description text, created_at text, settled_at text, actual_usd real)');
    for (const [start, secs, usd] of [[0, 20, 0.01], [30, 18, 0.02], [45, 5, 0.03], [70, 25, 0.04], [90, 5, 0.05], [120, 4, 0.06]] as const)
      db.run('insert into entries (description, created_at, settled_at, actual_usd) values (?, ?, ?, ?)', ['m chat [k1]', at(start), at(start + secs), usd]);
    db.close();
    const s = scan(dir);
    expect(s.unmatched).toBe(0);
    expect(s.cuts.map((c) => [c.at, c.rules, c.resend_gap_s])).toEqual([[at(0), ['nonstream_over_15s'], null], [at(30), ['resend_15s'], 15]]);
  });

  test('a proxy log with no ledger beside it stops the scan instead of reporting 0 unmatched', () => {
    const dir = scratch('noledger');
    const shard = join(dir, 'merged', 'shards', 'c', 'main');
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(shard, 'proxy-usage.ndjson'), JSON.stringify({ at: new Date(0).toISOString(), key: 'k1', model: 'm', outcome: 'forwarded', status: 200, streamed: false, actual_usd: 0.01 }) + '\n');
    expect(() => scan(dir)).toThrow('ledger.sqlite is missing');
  });

  test('a ledger missing one paid request makes the CLI exit non-zero and write no corrected trials', () => {
    const dir = scratch('partial');
    const shard = join(dir, 'merged', 'shards', 'c', 'main');
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(dir, 'merged', 'trials.jsonl'), JSON.stringify({ trial_id: 'run/c/t/a1', cell: 'c', task: 't', model: 'm', termination: 'ok', usage: { usd: 0.03 }, frontier: { harbor_trial: 'k1' } }) + '\n');
    const at = (s: number) => new Date(Date.UTC(2026, 10, 8, 0, 0, s)).toISOString();
    const lines = [0, 30].map((s, i) => ({ at: at(s), key: 'k1', model: 'm', route: '/v1/chat/completions', outcome: 'forwarded', status: 200, streamed: false, input_tokens: 100 + i, actual_usd: 0.01 + 0.01 * i }));
    writeFileSync(join(shard, 'proxy-usage.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const db = new Database(join(shard, 'ledger.sqlite'));
    db.run('create table entries (seq integer primary key autoincrement, description text, created_at text, settled_at text, actual_usd real)');
    db.run('insert into entries (description, created_at, settled_at, actual_usd) values (?, ?, ?, ?)', ['m chat [k1]', at(0), at(20), 0.01]);
    db.close();
    const out = join(dir, 'out');
    const r = spawnSync('bun', [join(ROOT, 'scripts/corrections/harbor-cut.ts'), '--results', dir, '--merged', join(dir, 'merged'), '--out', out], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('1 paid request');
    expect(existsSync(join(out, 'trials.jsonl'))).toBe(false);
  });

  test('a cut comes off the spend field of the run it was in: the counted run, a replaced run or a lease-stopped first run', () => {
    const rec = (id: string, frontier: TrialRow['frontier']): TrialRow => ({ trial_id: id, cell: 'c', task: 't', model: 'm', termination: 'ok', usage: { usd: 1, by_model: { m: { usd: 1 } } }, frontier });
    const counted = rec('a', { harbor_trial: 'k1' });
    const replaced = rec('b', { harbor_trial: 'k3', replaced_usd: 0.5 });
    const stopped = rec('c', { harbor_trial: 'k5', first_run_usd: 0.25 });
    const byId = new Map([counted, replaced, stopped].map((t) => [t.trial_id, t]));
    applyCuts([{ key: 'k1', trial_id: 'a', usd: 0.1 }, { key: 'k1', trial_id: 'a', usd: 0.05 }, { key: 'k2', trial_id: 'b', usd: 0.2 }, { key: 'k4', trial_id: 'c', usd: 0.05 }], byId);
    expect([counted.usage!.usd, counted.usage!.by_model!.m!.usd].map((x) => x.toFixed(2))).toEqual(['0.85', '0.85']);
    expect([replaced.usage!.usd, replaced.frontier!.replaced_usd!.toFixed(2)]).toEqual([1, '0.30']);
    expect([stopped.usage!.usd, stopped.frontier!.first_run_usd!.toFixed(2)]).toEqual([1, '0.20']);
    expect(() => applyCuts([{ key: 'k9', trial_id: 'a', usd: 0.1 }], byId)).toThrow('a: cut in run k9, which this record neither carries nor replaced');
  });
});
