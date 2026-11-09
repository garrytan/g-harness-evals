// The receipts manifest generator (scripts/receipts-manifest.ts) over a temporary repository: run id, cells, hashes,
// the preregistration's first commit and amendments, a lease ledger's requests and leases (and no spend), the error
// string for a file that is not a ledger, ledgerSpend's query, a private-by-hash run's attested artifacts, and --check's
// comparison that ignores generated_at.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { REPORT_ELSEWHERE, buildManifest, compareManifests, ledgerSpend, readLedger, renderManifest } from '../scripts/receipts-manifest.ts';

const RUN = 'docs/benchmarks/2026-01-02-unit';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, RUN, 'results', 'nested'), { recursive: true });
  return dir;
}

function commit(dir: string, file: string, body: string, message: string): string {
  writeFileSync(join(dir, file), body);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

/** A lease ledger in the shape runner/ledger/budget-ledger.ts writes: one settled entry and one reservation left open. */
function ledger(path: string): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE runs (run_id TEXT PRIMARY KEY, runner TEXT NOT NULL, budget_usd REAL NOT NULL, estimate_usd REAL, started_at TEXT NOT NULL, finished_at TEXT,
      committed_usd REAL NOT NULL DEFAULT 0, overshoot_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, description TEXT NOT NULL,
      reserved_usd REAL NOT NULL, actual_usd REAL, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      created_at TEXT NOT NULL, settled_at TEXT, participant TEXT, legacy INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE program (id INTEGER PRIMARY KEY CHECK (id = 1), committed_usd REAL NOT NULL, overshoot_usd REAL NOT NULL);
    INSERT INTO runs VALUES ('unit-2026-01', 'runner', 2.0, NULL, '2026-01-02T00:00:00Z', NULL, 0.75, 0);
    INSERT INTO entries (id, run_id, description, reserved_usd, actual_usd, status, created_at, settled_at) VALUES
      ('a', 'unit-2026-01', 'req 1', 1.0, 0.5, 'reconciled', '2026-01-02T00:00:01Z', '2026-01-02T00:00:02Z'),
      ('b', 'unit-2026-01', 'req 2', 0.25, NULL, 'reserved', '2026-01-02T00:00:03Z', NULL);
    INSERT INTO program VALUES (1, 0.75, 0);`);
  db.close();
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const trial = (cell: string, n: number) => JSON.stringify({ trial_id: `unit-2026-01/${cell}/task-01/r${n}`, cell, grade: 'pass' });

function populate(dir: string): { first: string; amendment: string; trials: string } {
  const first = commit(dir, `${RUN}/PREREGISTRATION.md`, '# prereg\n', 'Preregister unit-2026-01');
  const amendment = commit(dir, `${RUN}/PREREGISTRATION.md`, '# prereg\n\nAmendment 1.\n', 'Amendment 1 to unit-2026-01');
  writeFileSync(join(dir, RUN, 'report.md'), '# report\n');
  const trials = [trial('a-cell', 1), trial('a-cell', 2), trial('b-cell', 1)].join('\n') + '\n';
  writeFileSync(join(dir, RUN, 'results', 'trials.jsonl'), trials);
  writeFileSync(join(dir, RUN, 'results', 'summary.json'), '{}');
  writeFileSync(join(dir, RUN, 'results', 'proxy-usage.ndjson'), '{"at":"2026-01-02T00:00:01Z"}\n');
  writeFileSync(join(dir, RUN, 'results', 'nested', 'x.proxy-usage.ndjson'), '');
  writeFileSync(join(dir, RUN, 'results', 'broken.sqlite'), 'not a database\n');
  ledger(join(dir, RUN, 'results', 'ledger.sqlite'));
  mkdirSync(join(dir, 'docs/benchmarks/2026-01-01-no-results'), { recursive: true });
  writeFileSync(join(dir, 'docs/benchmarks/2026-01-01-no-results/PREREGISTRATION.md'), '# only a prereg\n');
  return { first, amendment, trials };
}

describe('receipts manifest', () => {
  test('one row per run with results, with run id, cells, hashes, prereg history, and ledger requests and leases without spend', () => {
    const dir = repo();
    const { first, amendment, trials } = populate(dir);
    const m = buildManifest(dir, '2026-01-03T00:00:00.000Z');
    expect(m.generated_at).toBe('2026-01-03T00:00:00.000Z');
    expect(m.runs.map((r) => r.directory)).toEqual([RUN]);
    const run = m.runs[0]!;
    expect(run.run_id).toBe('unit-2026-01');
    expect(run.report).toBe(`${RUN}/report.md`);
    expect(run.uncounted).toBeNull();
    expect(run.trials).toBe(3);
    expect(run.cells).toEqual({ 'a-cell': 2, 'b-cell': 1 });
    expect(run.trials_jsonl_sha256).toBe(sha(trials));
    expect(run.summary_json).toBe(true);
    expect(run.taxonomy).toBe(false);
    expect(run.preregistration).toEqual({ path: `${RUN}/PREREGISTRATION.md`, first_commit: first, amendments: [{ commit: amendment, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), subject: 'Amendment 1 to unit-2026-01' }] });
    expect(run.proxy_usage_logs.map((p) => p.path)).toEqual([`${RUN}/results/nested/x.proxy-usage.ndjson`, `${RUN}/results/proxy-usage.ndjson`]);
    expect(run.proxy_usage_logs[1]!.sha256).toBe(sha('{"at":"2026-01-02T00:00:01Z"}\n'));
    expect(run.ledgers.map((l) => l.path)).toEqual([`${RUN}/results/broken.sqlite`, `${RUN}/results/ledger.sqlite`]);
    const [broken, good] = run.ledgers;
    expect(typeof broken!.read_error).toBe('string');
    expect(broken!.leases).toBeNull();
    expect(broken!.sha256).toBe(sha('not a database\n'));
    expect(good!.read_error).toBeNull();
    expect(good!.requests).toBe(2);
    expect(good!.leases).toEqual([{ run_id: 'unit-2026-01', started_at: '2026-01-02T00:00:00Z', finished_at: null }]);
    expect(run.result_class).toBeUndefined();
    expect(renderManifest(m)).not.toMatch(/_usd"/);
  });

  test('ledgerSpend is the one spend query: committed, settled and open spend and each lease, and it throws on a file that is not a ledger', () => {
    const dir = repo();
    populate(dir);
    expect(ledgerSpend(readFileSync(join(dir, RUN, 'results', 'ledger.sqlite')))).toEqual({ committed_usd: 0.75, settled_usd: 0.5, open_reservations_usd: 0.25, leases: [{ run_id: 'unit-2026-01', budget_usd: 2, committed_usd: 0.75, overshoot_usd: 0 }] });
    expect(() => ledgerSpend(readFileSync(join(dir, RUN, 'results', 'broken.sqlite')))).toThrow();
  });

  test('a private-by-hash run lists the artifacts its results attestation names, and its row has no ledger or usage log', () => {
    const dir = repo();
    populate(dir);
    for (const f of ['ledger.sqlite', 'broken.sqlite', 'proxy-usage.ndjson', 'nested/x.proxy-usage.ndjson']) execFileSync('rm', [join(dir, RUN, 'results', f)]);
    const artifacts = [
      { name: 'ledger', schema: 'ledger-sqlite/1', location: 'private/spend/runs/unit-2026-01/ledger.sqlite', sha256: sha('synthetic ledger'), rows: 2 },
      { name: 'usage', schema: 'proxy-usage-ndjson/1', location: 'private/spend/runs/unit-2026-01/proxy-usage.ndjson', sha256: sha('synthetic usage'), rows: 1 },
    ];
    writeFileSync(join(dir, RUN, 'results', 'private-by-hash.json'), JSON.stringify({ schema: 'harness-evals-private-by-hash-attestation/1', run_id: 'unit-2026-01', artifacts }));
    const run = buildManifest(dir).runs[0]!;
    expect(run.result_class).toBe('private-by-hash');
    expect(run.private_artifacts).toEqual(artifacts.map(({ rows: _r, ...a }) => a));
    expect([run.ledgers, run.proxy_usage_logs]).toEqual([[], []]);
  });

  test('a run with results/UNCOUNTED.md is marked uncounted, and a report-less run takes the report REPORT_ELSEWHERE names', () => {
    const dir = repo();
    populate(dir);
    writeFileSync(join(dir, RUN, 'results', 'UNCOUNTED.md'), '# uncounted\n');
    const covered = 'docs/benchmarks/2026-11-02-v04-cal-r2', cover = 'docs/benchmarks/2026-11-02-v04-cal-r1/report.md';
    expect(REPORT_ELSEWHERE[covered]).toBe(cover);
    mkdirSync(join(dir, covered, 'results'), { recursive: true });
    writeFileSync(join(dir, covered, 'results', 'trials.jsonl'), trial('a-cell', 1) + '\n');
    const row = () => buildManifest(dir).runs.find((r) => r.directory === covered)!;
    expect(row().report).toBeNull();
    mkdirSync(join(dir, 'docs/benchmarks/2026-11-02-v04-cal-r1'), { recursive: true });
    writeFileSync(join(dir, cover), '# report\n');
    expect(row().report).toBe(cover);
    expect(row().uncounted).toBeNull();
    expect(buildManifest(dir).runs.find((r) => r.directory === RUN)!.uncounted).toBe(`${RUN}/results/UNCOUNTED.md`);
  });

  test('the run id comes from results/manifest.json when present, else from the trial_id prefix', () => {
    const dir = repo();
    populate(dir);
    expect(buildManifest(dir).runs[0]!.run_id).toBe('unit-2026-01');
    writeFileSync(join(dir, RUN, 'results', 'manifest.json'), JSON.stringify({ run_id: 'from-manifest' }));
    expect(buildManifest(dir).runs[0]!.run_id).toBe('from-manifest');
  });

  test('reading a ledger leaves no -shm or -wal file beside it', () => {
    const dir = repo();
    const path = join(dir, 'wal.sqlite');
    const db = new Database(path);
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE entries (reserved_usd REAL, actual_usd REAL); CREATE TABLE runs (run_id TEXT, budget_usd REAL, committed_usd REAL, overshoot_usd REAL, started_at TEXT, finished_at TEXT); INSERT INTO entries VALUES (1.5, NULL);');
    db.close();
    const bytes = readFileSync(path);
    expect([bytes[18], bytes[19]]).toEqual([2, 2]);
    execFileSync('rm', ['-f', path + '-shm', path + '-wal']);
    expect(readLedger(path).requests).toBe(1);
    expect(ledgerSpend(readFileSync(path)).committed_usd).toBe(1.5);
    expect(() => readFileSync(path + '-shm')).toThrow();
    expect(() => readFileSync(path + '-wal')).toThrow();
  });

  test('the committed manifest is compared without generated_at and a changed receipt is named', () => {
    const dir = repo();
    populate(dir);
    const a = buildManifest(dir, '2026-01-03T00:00:00.000Z');
    writeFileSync(join(dir, 'docs/receipts-manifest.json'), renderManifest(a));
    const reread = JSON.parse(readFileSync(join(dir, 'docs/receipts-manifest.json'), 'utf8'));
    expect(compareManifests(reread, buildManifest(dir, '2026-01-04T00:00:00.000Z'))).toEqual({ same: true, where: null });
    writeFileSync(join(dir, RUN, 'results', 'trials.jsonl'), trial('a-cell', 1) + '\n');
    expect(compareManifests(reread, buildManifest(dir))).toEqual({ same: false, where: RUN });
  });

  test('ignored harness state under results/ (a sqlite store, a dangling symlink) does not change the manifest', () => {
    const dir = repo();
    populate(dir);
    const before = buildManifest(dir, '2026-01-04T00:00:00.000Z');
    const state = join(dir, RUN, 'results', 'trials', 'cell', 'task', 'r1', 'state');
    mkdirSync(join(state, '.local', 'bin'), { recursive: true });
    writeFileSync(join(dir, RUN, 'results', '.gitignore'), 'trials/*/*/*/state/\n');
    ledger(join(state, 'openclaw-agent.sqlite'));
    symlinkSync('/nonexistent/node', join(state, '.local', 'bin', 'node'));
    expect(compareManifests(before, buildManifest(dir, '2026-01-04T00:00:00.000Z'))).toEqual({ same: true, where: null });
    writeFileSync(join(dir, RUN, 'results', 'extra.sqlite'), 'not a database\n');
    expect(compareManifests(before, buildManifest(dir, '2026-01-04T00:00:00.000Z')).same).toBe(false);
  });

  test('the CLI --check exits 1 on a stale manifest and 0 on a fresh one', () => {
    const dir = repo();
    populate(dir);
    const script = join(import.meta.dir, '..', 'scripts', 'receipts-manifest.ts');
    const run = (...args: string[]) => Bun.spawnSync(['bun', script, '--root', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
    expect(run('--check').exitCode).toBe(2);
    expect(run().exitCode).toBe(0);
    expect(run('--check').exitCode).toBe(0);
    writeFileSync(join(dir, RUN, 'results', 'summary.json'), '{"changed":true}');
    expect(run('--check').exitCode).toBe(0);
    writeFileSync(join(dir, RUN, 'results', 'ledger.sqlite'), 'overwritten');
    const stale = run('--check');
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr.toString()).toContain(RUN);
  });
});
