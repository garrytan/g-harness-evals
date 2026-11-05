// internal-task: plan --replication-of (runner/heldout/replication.ts). On the repository: m3-heldout-2026-10 replicates one
// cell at one repetition from its registered prereg.json without touching tasks/ or the openings ledger, the rule's verdict
// on every set, the flag refusals, and that preflight takes the manifest without a held-out check. On synthetic
// repositories: a sealed set, a set sharing a live sealed digest, an open set, a set whose tree is not plaintext, a prereg
// that differs from the committed one, and an unknown run. Every spawned process gets PATH and HOME only.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planReplication, replicationSetProblem } from '../runner/heldout/replication.ts';
import { buildManifest as buildHeldoutManifest, heldoutSet } from '../scripts/seal-heldout.ts';

const ROOT = join(import.meta.dir, '..');
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const runner = (...args: string[]) => spawnSync('bun', ['runner/run.ts', ...args], { cwd: ROOT, encoding: 'utf8', env: ENV, timeout: 120_000 });
const M3 = ['--replication-of', 'm3-heldout-2026-10', '--cells', 'openclaw-sonnet-mu-heldout', '--reps', '1', '--run-id', 'replicate-test-2026-11'];
const M3_PREREG = 'docs/benchmarks/2026-10-24-m3-heldout/prereg.json';

describe('the repository', () => {
  test('m3-heldout-2026-10 plans one cell at one repetition under the new run id, and tasks/ and the ledger stay unchanged', () => {
    const tasksBefore = execFileSync('git', ['status', '--porcelain', '--', 'tasks/'], { cwd: ROOT, encoding: 'utf8', env: ENV });
    const ledgerBefore = sha(readFileSync(join(ROOT, 'tasks/multiuser/heldout/MANIFEST.json')));
    const out = mkdtempSync(join(tmpdir(), 'replication-plan-'));
    try {
      const r = runner('plan', ...M3, '--out', out);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('REPLICATION: run replicate-test-2026-11 replicates m3-heldout-2026-10 (docs/benchmarks/2026-10-24-m3-heldout/prereg.json, sha256 484ffc9212e8): cells openclaw-sonnet-mu-heldout at 1 repetition; held-out set v0.1 (spent, plaintext); no opening is counted and no ledger row is written');
      expect(r.stdout).not.toContain('HELDOUT:');
      const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
      expect(m.run_id).toBe('replicate-test-2026-11');
      expect(m.replication_of).toEqual({ run_id: 'm3-heldout-2026-10', prereg_path: M3_PREREG, prereg_sha256: sha(readFileSync(join(ROOT, M3_PREREG))), cells: ['openclaw-sonnet-mu-heldout'], reps: 1 });
      expect(m.cells.map((c: { id: string; repetitions: number }) => [c.id, c.repetitions])).toEqual([['openclaw-sonnet-mu-heldout', 1]]);
      expect(m.trials.length).toBe(20);
      expect(m.trials.every((t: { id: string; cell: string; repetition: number }) => t.id.startsWith('replicate-test-2026-11/openclaw-sonnet-mu-heldout/') && t.cell === 'openclaw-sonnet-mu-heldout' && t.repetition === 1)).toBe(true);
      expect(m.sealed).toBeUndefined();

      const pre = runner('preflight', '--manifest', join(out, 'manifest.json'));
      expect(`${pre.stdout}${pre.stderr}`).not.toMatch(/HE-(HELDOUT|REPL|SEALED)-/);
      expect(pre.stdout).toContain('WARN: HE-PROXY-001 ANTHROPIC_API_KEY is not set in this shell');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    expect(execFileSync('git', ['status', '--porcelain', '--', 'tasks/'], { cwd: ROOT, encoding: 'utf8', env: ENV })).toBe(tasksBefore);
    expect(tasksBefore).toBe('');
    expect(sha(readFileSync(join(ROOT, 'tasks/multiuser/heldout/MANIFEST.json')))).toBe(ledgerBefore);
  });

  test('dry-run prints the same plan and writes nothing', () => {
    const r = runner('dry-run', ...M3);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('RUN: replicate-test-2026-11 trials=20 cells=1');
    expect(r.stdout).not.toContain('MANIFEST:');
  });

  test('the rule on every set: v0.1 and v0.2 are spent and plaintext; v0.3 (retired, unreleased) and v0.3-gen6 are sealed', () => {
    expect(replicationSetProblem('v0.1', ROOT)).toBeNull();
    expect(replicationSetProblem('v0.2', ROOT)).toBeNull();
    expect(replicationSetProblem('v0.3', ROOT)?.reason).toMatch(/^is in sealed custody \(retired but not released\)/);
    expect(replicationSetProblem('v0.3-gen6', ROOT)?.reason).toMatch(/^is in sealed custody, so/);
  });

  test('flag refusals', () => {
    const both = runner('dry-run', '--prereg', M3_PREREG, ...M3);
    expect(both.status).toBe(2);
    expect(both.stderr).toMatch(/^HE-REPL-001 --prereg and --replication-of were both given; .* fix: drop --prereg/);
    const stray = runner('dry-run', '--prereg', M3_PREREG, '--cells', 'openclaw-sonnet-mu-heldout');
    expect(stray.status).toBe(2);
    expect(stray.stderr).toMatch(/^HE-REPL-001 --cells belongs to --replication-of; .* fix: /);
    const bare = runner('dry-run', '--replication-of', '--cells', 'openclaw-sonnet-mu-heldout');
    expect(bare.stderr).toMatch(/^HE-REPL-001 --replication-of needs the run id/);
    const load = (p: string) => { const raw = readFileSync(p, 'utf8'); return { prereg: JSON.parse(raw), sha256: sha(raw) }; };
    const plan = (o: { of?: string; cells?: string; reps?: string; runId?: string }) => () => planReplication({ root: ROOT, of: 'm3-heldout-2026-10', cells: 'openclaw-sonnet-mu-heldout', reps: '1', runId: 'replicate-test-2026-11', load, ...o });
    expect(plan({ reps: '0' })).toThrow(/^HE-REPL-001 --reps must be a positive whole number .*fix:/);
    expect(plan({ reps: '1.5' })).toThrow(/^HE-REPL-001 --reps/);
    expect(plan({ reps: undefined })).toThrow(/^HE-REPL-001 --reps/);
    expect(plan({ cells: '' })).toThrow(/^HE-REPL-001 --replication-of m3-heldout-2026-10 needs --cells/);
    expect(plan({ cells: 'nope' })).toThrow(/^HE-REPL-001 --cells names nope, not a cell of run m3-heldout-2026-10; fix: name cells of its preregistration: openclaw-sonnet-mu-heldout, /);
    expect(plan({ runId: 'm3-heldout-2026-10' })).toThrow(/^HE-REPL-001 --run-id m3-heldout-2026-10 is the run it replicates; fix:/);
    expect(plan({ runId: 'gbrain-arm-2026-10' })).toThrow(/^HE-REPL-001 --run-id gbrain-arm-2026-10 is a registered experiment/);
    expect(plan({ runId: 'Bad_Id' })).toThrow(/^HE-REPL-001 --run-id must be lowercase/);
    expect(plan({ runId: undefined })).toThrow(/^HE-REPL-001 --run-id must be lowercase/);
    expect(plan({ of: 'no-such-run-2026-10' })).toThrow(/^HE-REPL-002 run no-such-run-2026-10 is not a registered experiment with held-out cells .*fix:/);
    expect(plan({ of: 'm2-pilot-2026-10' })).toThrow(/^HE-REPL-002 run m2-pilot-2026-10 is not a registered experiment with held-out cells/);
  });
});

// A synthetic repository: a registry with one held-out experiment (past-2026, cells a and b on set v9), set v9's
// held-out tree and MANIFEST.json, and a world seed manifest the plaintext check reads.
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(dir: string, file: string, body: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), body);
}

const V9 = 'tasks/multiuser/v9/heldout/MANIFEST.json';
const PREREG = 'docs/benchmarks/past/prereg.json';
const SLICE = 'a'.repeat(64);

function repo(manifest: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'replication-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'world/seed/MANIFEST.json', '{"world_json_sha256": "w"}\n');
  write(dir, 'tasks/multiuser/v9/heldout/ho-01-one/task.toml', 'id = "ho-01-one"\n');
  write(dir, 'docs/benchmarks/past/PREREGISTRATION.md', '# past\n');
  write(dir, PREREG, JSON.stringify({ schema_version: 1, run_id: 'past-2026', cells: ['a', 'b'].map((id) => ({ id, split: 'heldout', task_set: 'v9', slice: 'multiuser', repetitions: 5 })) }, null, 2) + '\n');
  write(dir, 'docs/benchmarks/preregistrations.json', JSON.stringify({ schema_version: 1, experiments: [{ id: 'past-2026', preregistration: 'docs/benchmarks/past/PREREGISTRATION.md', results: [] }] }));
  write(dir, V9, JSON.stringify({ ...buildHeldoutManifest(undefined, heldoutSet('v9', dir, 'multiuser')), opening_budget: 1, alpha_per_opening: 0.05, status: 'spent', openings: [{ run_id: 'past-2026', status: 'opened', label: 'confirmatory', candidate_sha256: null }], exposures: [], ...manifest }, null, 2) + '\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const load = (p: string) => { const raw = readFileSync(p, 'utf8'); return { prereg: JSON.parse(raw) as { run_id: string; cells: Array<{ id: string; split: string; repetitions: number; task_set?: string }> }, sha256: sha(raw) }; };
const replicate = (dir: string, extra: Partial<Parameters<typeof planReplication>[0]> = {}) => planReplication({ root: dir, of: 'past-2026', cells: 'a', reps: '2', runId: 'again-2026', load, ...extra });

describe('synthetic repositories', () => {
  test('a spent plaintext set plans the named cell only, at --reps, and changes no file', () => {
    const dir = repo();
    const r = replicate(dir);
    expect(r.prereg.run_id).toBe('again-2026');
    expect(r.prereg.cells.map((c) => [c.id, c.repetitions])).toEqual([['a', 2]]);
    expect(r.replication_of).toEqual({ run_id: 'past-2026', prereg_path: PREREG, prereg_sha256: sha(readFileSync(join(dir, PREREG))), cells: ['a'], reps: 2 });
    expect(r.lines[0]).toContain('held-out set v9 (spent, plaintext)');
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  test('HE-REPL-003: a sealed set, retired and unreleased or open, is refused', () => {
    const sealed = { custody: 'sealed', tasks: [], files: {}, sealed: { world_slice_sha256: SLICE, heldout_corpus_sha256: 'b'.repeat(64) } };
    const retired = repo({ ...sealed, status: 'retired' });
    rmSync(join(retired, 'tasks/multiuser/v9/heldout/ho-01-one'), { recursive: true });
    expect(() => replicate(retired)).toThrow(/^HE-REPL-003 replication of past-2026: set v9 is in sealed custody \(retired but not released\), .*; fix: replicate it once the set is retired and released/);
    expect(() => replicate(repo({ ...sealed, status: 'open' }))).toThrow(/^HE-REPL-003 replication of past-2026: set v9 is in sealed custody, /);
  });

  test('HE-REPL-003: a released set whose world slice a live sealed set shares is refused until that set retires', () => {
    const dir = repo({ status: 'retired', released: { world_slice_sha256: SLICE, heldout_corpus_sha256: 'c'.repeat(64) } });
    const successor = (status: string) => write(dir, 'tasks/multiuser/v10/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: SLICE, heldout_corpus_sha256: 'd'.repeat(64) }, status }));
    successor('open');
    expect(() => replicate(dir)).toThrow(/^HE-REPL-003 replication of past-2026: set v9 shares its world slice or corpus with v10, still in sealed custody and not retired, .*; fix: replicate it after v10 is retired$/);
    successor('retired');
    expect(replicate(dir).lines[0]).toContain('held-out set v9 (retired, plaintext)');
  });

  test('HE-REPL-003: an open set, and a set whose tree is not plaintext, are refused', () => {
    expect(() => replicate(repo({ status: 'open' }))).toThrow(/^HE-REPL-003 replication of past-2026: set v9 has openings ledger status open; .*fix: preregister an opening/);
    const missing = repo({ status: 'retired' });
    rmSync(join(missing, 'tasks/multiuser/v9/heldout/ho-01-one'), { recursive: true });
    expect(() => replicate(missing)).toThrow(/^HE-REPL-003 replication of past-2026: set v9 is not plaintext in the tree \(\d+ difference\(s\) from MANIFEST.json under tasks\/multiuser\/v9\/heldout, first: ho-01-one\/task.toml: in the manifest but not in the tree\); .*fix: release the set/);
    const empty = repo({ status: 'retired', tasks: [], files: {}, tree_sha256: sha('') });
    rmSync(join(empty, 'tasks/multiuser/v9/heldout/ho-01-one'), { recursive: true });
    expect(() => replicate(empty)).toThrow(/^HE-REPL-003 .*set v9 is not plaintext in the tree \(MANIFEST.json lists no tasks\)/);
  });

  test('HE-REPL-002: a prereg.json that differs from the committed one, an uncommitted one, or one that changes while planning', () => {
    const dir = repo();
    write(dir, PREREG, readFileSync(join(dir, PREREG), 'utf8').replace('"repetitions": 5', '"repetitions": 6'));
    expect(() => replicate(dir)).toThrow(/^HE-REPL-002 run past-2026: docs\/benchmarks\/past\/prereg.json in the working tree \(sha256 [0-9a-f]{12}\) is not the one committed at HEAD .*fix: restore it/);
    git(dir, 'rm', '-q', '--cached', PREREG);
    git(dir, 'commit', '-q', '-m', 'untrack');
    expect(() => replicate(dir)).toThrow(/^HE-REPL-002 run past-2026: docs\/benchmarks\/past\/prereg.json is not committed at HEAD .*fix:/);
    const other = repo();
    expect(() => replicate(other, { load: (p) => ({ ...load(p), sha256: 'f'.repeat(64) }) })).toThrow(/^HE-REPL-002 run past-2026: .* the registration has [0-9a-f]{12} \(the file changed while planning\); fix:/);
    expect(() => replicate(other, { of: 'nobody-2026' })).toThrow(/^HE-REPL-002 run nobody-2026 is not a registered experiment/);
  });
});
