// scripts/receipts-manifest.ts finds a run's record under results/ wherever it sits (results/trials.jsonl, else
// results/merged/trials.jsonl, else the shallowest), hashes every other trials.jsonl of the run directory, and --check fails
// when a registered experiment has committed trials that no row hashes. Before, only results/trials.jsonl got a row, so a
// run whose records sit under results/merged/ (frontier-harness-2026-11) had none and an edit to its trials passed --check.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RUN = 'docs/benchmarks/2026-01-05-merged';
const PROBE = 'docs/benchmarks/2026-01-06-probe-only';
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
const trial = (id: string, cell: string) => JSON.stringify({ trial_id: id, cell, task: 't1', started_at: '2026-01-05T00:00:00Z', ended_at: '2026-01-05T00:01:00Z' }) + '\n';

function repo(experiments: Array<{ id: string; preregistration: string; results: string[] }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-records-'));
  const put = (file: string, body: string) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), body); };
  put('docs/benchmarks/preregistrations.json', JSON.stringify({ schema_version: 1, experiments }));
  put(`${RUN}/PREREGISTRATION.md`, '# prereg\n');
  put(`${RUN}/results/merged/manifest.json`, JSON.stringify({ run_id: 'merged-2026-01' }));
  put(`${RUN}/results/merged/trials.jsonl`, trial('merged-2026-01/a/t1/a1', 'a') + trial('merged-2026-01/b/t1/a1', 'b'));
  put(`${RUN}/results/stage0/a/trials.jsonl`, trial('merged-2026-01/a/t1/a1', 'a'));
  put(`${PROBE}/PREREGISTRATION.md`, '# prereg\n');
  put(`${PROBE}/probe/trials.jsonl`, trial('probe-2026-01/a/t1/r1', 'a'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  g('add', '-A'); g('commit', '-q', '-m', 'fixture');
  return dir;
}
const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts/receipts-manifest.ts'), '--root', dir, ...args], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
const MERGED = { id: 'merged-2026-01', preregistration: `${RUN}/PREREGISTRATION.md`, results: [`${RUN}/results/**`] };

describe('receipts manifest records', () => {
  test('a run whose records sit under results/merged/ gets a row, and an edit to them fails --check', () => {
    const dir = repo([MERGED]);
    expect(cli(dir).status).toBe(0);
    const m = JSON.parse(readFileSync(join(dir, 'docs/receipts-manifest.json'), 'utf8'));
    const row = m.runs.find((r: { directory: string }) => r.directory === RUN);
    expect(row).toMatchObject({ run_id: 'merged-2026-01', trials: 2, cells: { a: 1, b: 1 }, trials_jsonl: `${RUN}/results/merged/trials.jsonl` });
    expect(row.other_trials_jsonl.map((o: { path: string }) => o.path)).toEqual([`${RUN}/results/stage0/a/trials.jsonl`]);
    expect(cli(dir, '--check').status).toBe(0);
    appendFileSync(join(dir, RUN, 'results/merged/trials.jsonl'), trial('merged-2026-01/b/t1/a2', 'b'));
    const edited = cli(dir, '--check');
    expect(edited.status).toBe(1);
    expect(edited.stderr).toContain(`differs from the results tree at ${RUN}`);
  });

  test('a merge split across results/merged/<part>/ directories counts every part, and an edit to any part fails --check', () => {
    const dir = repo([]);
    const SPLIT = 'docs/benchmarks/2026-01-08-split';
    const put = (file: string, body: string) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), body); };
    put(`${SPLIT}/PREREGISTRATION.md`, '# prereg\n');
    put(`${SPLIT}/results/merged/arms/manifest.json`, JSON.stringify({ run_id: 'split-2026-01' }));
    put(`${SPLIT}/results/merged/arms/trials.jsonl`, trial('split-2026-01/c/t1/a1', 'c'));
    put(`${SPLIT}/results/merged/base/manifest.json`, JSON.stringify({ run_id: 'split-2026-01' }));
    put(`${SPLIT}/results/merged/base/trials.jsonl`, trial('split-2026-01/a/t1/a1', 'a') + trial('split-2026-01/b/t1/a1', 'b') + trial('split-2026-01/b/t1/a2', 'b'));
    put(`${SPLIT}/results/main/a/trials.jsonl`, trial('split-2026-01/a/t1/a1', 'a'));
    put('docs/benchmarks/preregistrations.json', JSON.stringify({ schema_version: 1, experiments: [MERGED, { id: 'split-2026-01', preregistration: `${SPLIT}/PREREGISTRATION.md`, results: [`${SPLIT}/results/**`] }] }));
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', 'split fixture'], { cwd: dir, stdio: 'ignore' });
    expect(cli(dir).status).toBe(0);
    const m = JSON.parse(readFileSync(join(dir, 'docs/receipts-manifest.json'), 'utf8'));
    const row = m.runs.find((r: { directory: string }) => r.directory === SPLIT);
    const sha = (f: string) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
    expect(row).toMatchObject({ run_id: 'split-2026-01', trials: 4, cells: { a: 1, b: 2, c: 1 }, trials_jsonl: `${SPLIT}/results/merged/arms/trials.jsonl`, trials_jsonl_sha256: sha(`${SPLIT}/results/merged/arms/trials.jsonl`) });
    expect(row.trials_jsonl_parts).toEqual([{ path: `${SPLIT}/results/merged/base/trials.jsonl`, sha256: sha(`${SPLIT}/results/merged/base/trials.jsonl`) }]);
    expect(row.other_trials_jsonl.map((o: { path: string }) => o.path)).toEqual([`${SPLIT}/results/main/a/trials.jsonl`]);
    expect(m.runs.find((r: { directory: string }) => r.directory === RUN).trials_jsonl_parts).toBeUndefined();
    expect(cli(dir, '--check').status).toBe(0);
    appendFileSync(join(dir, SPLIT, 'results/merged/base/trials.jsonl'), trial('split-2026-01/b/t1/a3', 'b'));
    const edited = cli(dir, '--check');
    expect(edited.status).toBe(1);
    expect(edited.stderr).toContain(`differs from the results tree at ${SPLIT}`);
  });

  test('an edit to a per-stage copy fails --check too', () => {
    const dir = repo([MERGED]);
    expect(cli(dir).status).toBe(0);
    appendFileSync(join(dir, RUN, 'results/stage0/a/trials.jsonl'), trial('merged-2026-01/a/t1/a2', 'a'));
    expect(cli(dir, '--check').status).toBe(1);
  });

  test('a trials.jsonl that holds no trial records gives no row and no run id; it is hashed under not_trial_records', () => {
    const dir = repo([MERGED]);
    const GATE = 'docs/benchmarks/2026-01-07-gate-study';
    const gate = `${GATE}/results/phase3/trials.jsonl`;
    mkdirSync(dirname(join(dir, gate)), { recursive: true });
    writeFileSync(join(dir, gate), JSON.stringify({ trial_id: 'sympy__sympy-1/opus/S/r1', termination: 'infra', verdict: 'stopped' }) + '\n');
    expect(cli(dir).status).toBe(0);
    const m = JSON.parse(readFileSync(join(dir, 'docs/receipts-manifest.json'), 'utf8'));
    expect(m.runs.map((r: { directory: string }) => r.directory)).toEqual([RUN]);
    expect(m.runs.some((r: { run_id: string }) => r.run_id === 'sympy__sympy-1')).toBe(false);
    expect(m.not_trial_records).toEqual([{ path: gate, sha256: createHash('sha256').update(readFileSync(join(dir, gate))).digest('hex'), reason: expect.stringContaining('no record carries a cell or a grade') }]);
    expect(cli(dir, '--check').status).toBe(0);
    appendFileSync(join(dir, gate), JSON.stringify({ trial_id: 'sympy__sympy-2/opus/S/r1' }) + '\n');
    const edited = cli(dir, '--check');
    expect(edited.status).toBe(1);
    expect(edited.stderr).toContain('differs from the results tree at not_trial_records');
  });

  test('--check fails when a registered experiment has committed trials that no row hashes', () => {
    const dir = repo([MERGED, { id: 'probe-2026-01', preregistration: `${PROBE}/PREREGISTRATION.md`, results: [`${PROBE}/probe/**`] }]);
    cli(dir);
    const r = cli(dir, '--check');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`probe-2026-01: ${PROBE}/probe/trials.jsonl has no row in docs/receipts-manifest.json`);
  });
});
