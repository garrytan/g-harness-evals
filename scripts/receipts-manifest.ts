#!/usr/bin/env bun
// Receipts manifest: one row per counted run under docs/benchmarks/, naming the hashed artifacts a report's numbers
// rest on (CLAUDE.md, evidence rules: every published number has a row in the receipts manifest pointing at a hashed
// artifact).
//
//   bun scripts/receipts-manifest.ts [--check] [--root <repo>] [--out <file>]
//
// Keyless, read-only against the runs, deterministic apart from generated_at. For every docs/benchmarks/*/results/
// trials.jsonl it records: the run id (results/manifest.json run_id, else the prefix of the first trial_id), the report
// path, the preregistration with the commit that added it and every later commit that touched it (the amendments, with
// their committer dates and subjects), the trial count and the count per cell, the sha256 of trials.jsonl, every
// *.sqlite ledger under results/ with its sha256 and the spend it commits, every proxy-usage*.ndjson with its sha256,
// and whether summary.json and taxonomy.json are present.
//
// internal-task: each run also records the window its trials ran in (earliest started_at, latest ended_at) and, for a run
// with held-out cells, its set, opening number, label, status and reason as runner/heldout/openings.ts derives them from
// the set's openings ledger and preregistration order on first-parent history, plus concurrent_with: the other runs
// on the same set with a trial that ran while one of its own trials ran (started_at to ended_at).
//
// Ledger spend follows runner/ledger/budget-ledger.ts: an entry's committed spend is its settled actual_usd, or its
// full reservation while unsettled, so ledger_committed_usd is SUM(COALESCE(actual_usd, reserved_usd)) over the
// entries table, which is what the lease's runs.committed_usd and the program row accumulate. ledger_settled_usd is
// the sum of actual_usd alone and ledger_open_reservations_usd the reservations never settled (a machine restart mid
// request leaves one open; the ledger can only overstate spend). Each lease in the runs table is listed under leases.
// A ledger that cannot be opened or queried records the error string in ledger_committed_usd instead of a number.
// Ledgers are read from an in-memory copy of their bytes, so the receipts tree gains no -shm or -wal files; dollar sums
// are rounded to six decimals so the file is stable across SQLite builds.
//
// --check recomputes the manifest and exits 1 when it differs from the committed file, generated_at excepted, so a
// results tree edited after the manifest was written is caught; exit 2 when the committed file is missing or unreadable.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { deriveSet, registeredHeldout } from '../runner/heldout/openings.ts';
import { heldoutSets } from './seal-heldout.ts';

export const MANIFEST_VERSION = 1;
export const OUTPUT_FILE = 'docs/receipts-manifest.json';
const BENCHMARKS_DIR = 'docs/benchmarks';

export interface Amendment { commit: string; date: string; subject: string }
export interface Lease { run_id: string; budget_usd: number; committed_usd: number; overshoot_usd: number; started_at: string | null; finished_at: string | null }
export interface LedgerRow {
  path: string;
  sha256: string;
  /** SUM(COALESCE(actual_usd, reserved_usd)) over entries, or the error string when the ledger could not be read. */
  ledger_committed_usd: number | string;
  ledger_settled_usd: number | null;
  ledger_open_reservations_usd: number | null;
  requests: number | null;
  leases: Lease[] | null;
}
export interface HashedFile { path: string; sha256: string }
export interface RunRow {
  directory: string;
  run_id: string | null;
  report: string | null;
  preregistration: { path: string | null; first_commit: string | null; amendments: Amendment[] };
  trials: number;
  cells: Record<string, number>;
  trials_jsonl_sha256: string;
  ledgers: LedgerRow[];
  proxy_usage_logs: HashedFile[];
  summary_json: boolean;
  taxonomy: boolean;
  trials_window: { first_started_at: string; last_ended_at: string } | null;
  heldout: HeldoutOpening | null;
}
export interface HeldoutOpening {
  set: string;
  /** Derived by runner/heldout/openings.ts; never stored in the set's ledger. Null for a withdrawn or superseded row. */
  opening: number | null;
  label: string;
  status: string;
  reason: string | null;
  concurrent_with: string[];
}
export interface Manifest { schema_version: number; generated_at: string; generator: string; runs: RunRow[] }

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const round6 = (x: number) => Number(x.toFixed(6));

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** The commit that added the file (the oldest add, if git ever saw it added twice) and every later commit that touched it. */
export function preregistrationHistory(root: string, relPath: string): { first_commit: string | null; amendments: Amendment[] } {
  const added = git(root, ['log', '--diff-filter=A', '--format=%H', '--', relPath]);
  const adds = (added ?? '').split('\n').filter(Boolean);
  const first = adds.length ? adds[adds.length - 1]! : null;
  const log = git(root, ['log', '--format=%H%x1f%cs%x1f%s', '--', relPath]) ?? '';
  const amendments: Amendment[] = [];
  for (const line of log.split('\n')) {
    if (!line) continue;
    const [commit, date, subject] = line.split('\x1f');
    if (!commit || commit === first) continue;
    amendments.push({ commit, date: date ?? '', subject: subject ?? '' });
  }
  return { first_commit: first, amendments };
}

/** Committed, settled and open spend of one lease ledger, or the error that stopped the read. The file's bytes are read
 *  into memory and the header's journal flags (bytes 18 and 19) set to rollback mode before deserializing, because a
 *  committed ledger still marked WAL would otherwise make every read-only open drop -shm and -wal files into the receipts
 *  tree; nothing on disk is touched. */
export function readLedger(path: string, bytes: Buffer = readFileSync(path)): Omit<LedgerRow, 'path' | 'sha256'> {
  let db: Database | null = null;
  try {
    const copy = Buffer.from(bytes);
    if (copy.length >= 20) { copy[18] = 1; copy[19] = 1; }
    db = Database.deserialize(copy, { readonly: true });
    const agg = db.query(`SELECT COALESCE(SUM(COALESCE(actual_usd, reserved_usd)), 0) AS committed_usd, COALESCE(SUM(actual_usd), 0) AS settled_usd,
      COALESCE(SUM(CASE WHEN actual_usd IS NULL THEN reserved_usd ELSE 0 END), 0) AS open_usd, COUNT(*) AS requests FROM entries`).get() as
      { committed_usd: number; settled_usd: number; open_usd: number; requests: number };
    const leases = (db.query('SELECT run_id, budget_usd, committed_usd, overshoot_usd, started_at, finished_at FROM runs ORDER BY run_id').all() as Lease[])
      .map((r) => ({ ...r, committed_usd: round6(r.committed_usd), overshoot_usd: round6(r.overshoot_usd) }));
    return { ledger_committed_usd: round6(agg.committed_usd), ledger_settled_usd: round6(agg.settled_usd), ledger_open_reservations_usd: round6(agg.open_usd), requests: agg.requests, leases };
  } catch (e) {
    return { ledger_committed_usd: e instanceof Error ? e.message : String(e), ledger_settled_usd: null, ledger_open_reservations_usd: null, requests: null, leases: null };
  } finally {
    db?.close();
  }
}

/** The files under dir that the repository would hold: tracked and untracked-but-not-ignored, as git sees them, so a
 * working checkout with harness state left under an ignored results/trials/<trial>/state/ gives the same manifest as a
 * clean clone. Without git (or outside a repository) every regular file is listed. Symlinks are skipped either way. */
function walk(root: string, dir: string): string[] {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', relative(root, dir)]);
  const regular = (full: string) => { try { const st = lstatSync(full); return !st.isSymbolicLink() && st.isFile(); } catch { return false; } };
  if (listed !== null) return listed.split('\0').filter(Boolean).map((p) => join(root, p)).filter(regular).sort();
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(root, full));
    else out.push(full);
  }
  return out;
}

export function buildRun(root: string, directory: string): RunRow {
  const dir = join(root, directory);
  const results = join(dir, 'results');
  const trialsPath = join(results, 'trials.jsonl');
  const trialsBytes = readFileSync(trialsPath);
  const cells: Record<string, number> = {};
  let trials = 0;
  let firstTrialId: string | null = null;
  let firstStarted: string | null = null, lastEnded: string | null = null;
  for (const line of trialsBytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line) as { trial_id?: string; cell?: string; started_at?: string; ended_at?: string };
    trials++;
    firstTrialId ??= t.trial_id ?? null;
    if (t.started_at && (!firstStarted || t.started_at < firstStarted)) firstStarted = t.started_at;
    if (t.ended_at && (!lastEnded || t.ended_at > lastEnded)) lastEnded = t.ended_at;
    const cell = t.cell ?? 'unknown';
    cells[cell] = (cells[cell] ?? 0) + 1;
  }
  const sortedCells = Object.fromEntries(Object.keys(cells).sort().map((k) => [k, cells[k]!]));

  let runId: string | null = null;
  const manifestPath = join(results, 'manifest.json');
  if (existsSync(manifestPath)) {
    try { runId = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { run_id?: string }).run_id ?? null; } catch { runId = null; }
  }
  runId ??= firstTrialId ? firstTrialId.split('/')[0]! : null;

  const files = walk(root, results);
  const rel = (p: string) => relative(root, p).split('\\').join('/');
  const ledgers = files.filter((f) => f.endsWith('.sqlite')).map((f) => { const bytes = readFileSync(f); return { path: rel(f), sha256: sha256(bytes), ...readLedger(f, bytes) }; });
  const proxyLogs = files.filter((f) => /(^|[./-])proxy-usage([.-][^/]*)?\.ndjson$/.test(f.slice(f.lastIndexOf('/') + 1))).map((f) => ({ path: rel(f), sha256: sha256(readFileSync(f)) }));

  const prereg = join(dir, 'PREREGISTRATION.md');
  const report = join(dir, 'report.md');
  return {
    directory,
    run_id: runId,
    report: existsSync(report) ? rel(report) : null,
    preregistration: existsSync(prereg) ? { path: rel(prereg), ...preregistrationHistory(root, rel(prereg)) } : { path: null, first_commit: null, amendments: [] },
    trials,
    cells: sortedCells,
    trials_jsonl_sha256: sha256(trialsBytes),
    ledgers,
    proxy_usage_logs: proxyLogs,
    summary_json: existsSync(join(results, 'summary.json')),
    taxonomy: existsSync(join(results, 'taxonomy.json')),
    trials_window: firstStarted && lastEnded ? { first_started_at: firstStarted, last_ended_at: lastEnded } : null,
    heldout: null,
  };
}

/** A run's trial intervals (started_at to ended_at), merged where they overlap, sorted by start. */
function trialIntervals(root: string, directory: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const line of readFileSync(join(root, directory, 'results', 'trials.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line) as { started_at?: string; ended_at?: string };
    if (t.started_at && t.ended_at) spans.push([Date.parse(t.started_at), Date.parse(t.ended_at)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) { if (s[1] > last[1]) last[1] = s[1]; } else merged.push([s[0], s[1]]);
  }
  return merged;
}

function overlaps(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i]![0] < b[j]![1] && b[j]![0] < a[i]![1]) return true;
    if (a[i]![1] < b[j]![1]) i++; else j++;
  }
  return false;
}

/** Fill each run's held-out opening from the derived ledgers, and the runs on the same set whose trials overlapped in time. */
function attachOpenings(root: string, runs: RunRow[]): void {
  const registered = registeredHeldout(root);
  for (const set of heldoutSets(root)) {
    const derived = deriveSet(root, set.name, registered);
    if (!derived) continue;
    for (const o of derived.openings) {
      const run = runs.find((r) => r.run_id === o.run_id);
      if (run) run.heldout = { set: set.name, opening: o.number, label: o.label, status: o.status, reason: o.reason, concurrent_with: [] };
    }
  }
  const intervals = new Map(runs.filter((r) => r.heldout).map((r) => [r, trialIntervals(root, r.directory)]));
  for (const [run, mine] of intervals) {
    run.heldout!.concurrent_with = [...intervals].filter(([o, theirs]) => o !== run && o.heldout!.set === run.heldout!.set && overlaps(mine, theirs)).map(([o]) => o.run_id!).sort();
  }
}

export function buildManifest(root: string, generatedAt: string = new Date().toISOString()): Manifest {
  const base = join(root, BENCHMARKS_DIR);
  const runs: RunRow[] = [];
  for (const name of readdirSync(base).sort()) {
    const directory = `${BENCHMARKS_DIR}/${name}`;
    if (!existsSync(join(base, name, 'results', 'trials.jsonl'))) continue;
    runs.push(buildRun(root, directory));
  }
  attachOpenings(root, runs);
  return { schema_version: MANIFEST_VERSION, generated_at: generatedAt, generator: 'scripts/receipts-manifest.ts', runs };
}

export const renderManifest = (m: Manifest) => JSON.stringify(m, null, 2) + '\n';

/** Equal apart from generated_at; the first differing run directory (or the top level) when not. */
export function compareManifests(a: Manifest, b: Manifest): { same: boolean; where: string | null } {
  const strip = ({ generated_at: _, ...rest }: Manifest) => rest;
  if (JSON.stringify(strip(a)) === JSON.stringify(strip(b))) return { same: true, where: null };
  const dirs = new Set([...a.runs.map((r) => r.directory), ...b.runs.map((r) => r.directory)]);
  for (const d of [...dirs].sort()) {
    const x = a.runs.find((r) => r.directory === d), y = b.runs.find((r) => r.directory === d);
    if (JSON.stringify(x) !== JSON.stringify(y)) return { same: false, where: d };
  }
  return { same: false, where: 'top level' };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(flag('root') ?? resolve(import.meta.dir, '..'));
  const out = resolve(root, flag('out') ?? OUTPUT_FILE);
  const fresh = buildManifest(root);
  if (argv.includes('--check')) {
    if (!existsSync(out)) { console.error(`receipts-manifest: ${relative(root, out)} is missing; run bun scripts/receipts-manifest.ts`); process.exit(2); }
    let committed: Manifest;
    try { committed = JSON.parse(readFileSync(out, 'utf8')) as Manifest; } catch (e) { console.error(`receipts-manifest: cannot read ${relative(root, out)}: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); }
    const { same, where } = compareManifests(committed, fresh);
    if (!same) { console.error(`receipts-manifest: ${relative(root, out)} differs from the results tree at ${where}; run bun scripts/receipts-manifest.ts and commit the result`); process.exit(1); }
    console.log(`receipts-manifest: ${relative(root, out)} matches ${fresh.runs.length} run(s)`);
  } else {
    writeFileSync(out, renderManifest(fresh));
    console.log(`receipts-manifest: wrote ${relative(root, out)} (${fresh.runs.length} runs, ${fresh.runs.reduce((n, r) => n + r.ledgers.length, 0)} ledgers)`);
  }
}
