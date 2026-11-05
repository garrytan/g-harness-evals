/**
 * Preregistration discipline for paid and gating runs.
 *
 * Two checks, used together:
 *
 * - `attestPreregistration` runs inside a runner before its first paid or
 *   gating request. It refuses unless the preregistration file is committed,
 *   unchanged in the worktree and contained in a commit on `origin`, and it
 *   returns an attestation the runner writes into its receipt.
 * - `checkOrder` runs in CI over `docs/benchmarks/preregistrations.json`. For
 *   every listed experiment, the commit that first added the preregistration
 *   must be a strict ancestor of the commit that first added each result file,
 *   and any attestation a receipt carries must name a commit at or after the
 *   preregistration's. An experiment that declares `preregistered_on_main: false`
 *   with a `reason` (its preregistration commit preceded the trials on a branch
 *   that was squash-merged together with the results) has its order problems
 *   printed as warnings, not failures; the declaration is the published deviation.
 *
 * Commit order alone can't prove a preregistration was written first; the
 * runtime attestation against `origin` is what does. CI needs full history
 * (`fetch-depth: 0`). The first-add commit of every path comes from one pass over
 * history, so the check takes seconds on main's ~155,000 result files (one
 * `git log` per file took over an hour and printed nothing until the end).
 *
 * `--public` is the check for the public repository, whose history before the
 * cutover was rebuilt from private squash merges. Experiments in the ledger
 * (docs/benchmarks/prereg-ledger.json, written by scripts/prereg-ledger.ts) whose
 * preregistration merged at or before the ledger's cutover pass when the file
 * hashes and the history date match the ledger; they are labelled "ordering
 * attested privately, not publicly verifiable". Every other experiment needs strict
 * ancestry in the public history, and a declared deviation does not excuse it. The
 * ledger is written once: a history where more than one commit changed it fails.
 *
 * The CLI also runs `checkOpenings` (runner/heldout/openings.ts) over the
 * held-out openings ledgers: every registered experiment with a held-out cell has
 * exactly one ledger row, every row names such an experiment, rows follow
 * preregistration order on first-parent history, and confirmatory openings stay
 * within each set's budget. CI runs it on every pull request and on every push to
 * main, so the counts come from main's own history after each merge.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Attestation {
  preregistration: string;
  preregistration_commit: string;
  runner_commit: string;
  worktree_clean_for_preregistration: true;
  on_origin: true;
  attested_at: string;
}

export interface ManifestEntry {
  id: string;
  preregistration: string;
  results: string[];
  /**
   * A declared deviation: the preregistration commit preceded the trials on its branch, but the branch was
   * squash-merged with its results, so main's history cannot show the order. Only with a non-empty `reason`
   * naming the branch commit and the cause does the checker print the order problems of this experiment as
   * warnings instead of failures; the attestation checks still fail as usual.
   */
  preregistered_on_main?: false;
  reason?: string;
  /**
   * The statistics kit a dated amendment chose for this experiment, instead of `runner/stats/` at the preregistration
   * commit (runner/stats/kit.ts): the kit commit, and the amendment's file and date.
   */
  stats_kit?: { commit: string; amendment: string };
}

export interface OrderProblem {
  id: string;
  file: string;
  problem: string;
  /** Set when the experiment declares `preregistered_on_main: false` with a reason: printed, not counted. */
  warning?: true;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function attestPreregistration(path: string, cwd = process.cwd(), now = new Date()): Attestation {
  if (!existsSync(join(cwd, path))) throw new Error(`preregistration ${path} does not exist; write and commit it before running`);
  if (git(cwd, ['status', '--porcelain', '--', path]) !== '') {
    throw new Error(`preregistration ${path} has uncommitted changes; commit and push it before running`);
  }
  const commit = tryGit(cwd, ['log', '-n', '1', '--format=%H', '--', path]);
  if (!commit) throw new Error(`preregistration ${path} is not committed; commit and push it before running`);
  const remotes = git(cwd, ['branch', '-r', '--contains', commit]);
  if (!remotes.split('\n').some(line => line.trim().startsWith('origin/'))) {
    throw new Error(`preregistration commit ${commit.slice(0, 12)} is not on origin; run \`git push\` before running`);
  }
  return {
    preregistration: path,
    preregistration_commit: commit,
    runner_commit: git(cwd, ['rev-parse', 'HEAD']),
    worktree_clean_for_preregistration: true,
    on_origin: true,
    attested_at: now.toISOString(),
  };
}

/** The commit that first added each path in HEAD's history (the oldest add, as `git log --diff-filter=A -- <path>` would
 *  list last), from one `git log` over the whole history. */
export function firstAddCommits(cwd: string): Map<string, string> {
  const adds = new Map<string, string>();
  const out = tryGit(cwd, ['log', '--diff-filter=A', '--no-renames', '--format=%x00%H', '--name-only']) ?? '';
  for (const chunk of out.split('\0')) {
    const [commit, ...paths] = chunk.split('\n').filter(Boolean);
    if (commit) for (const path of paths) adds.set(path, commit);
  }
  return adds;
}

function ancestry(cwd: string): (older: string, newer: string) => boolean {
  const seen = new Map<string, boolean>();
  return (older, newer) => {
    if (older === newer) return false;
    const key = `${older} ${newer}`;
    if (!seen.has(key)) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd, stdio: 'ignore' });
        seen.set(key, true);
      } catch {
        seen.set(key, false);
      }
    }
    return seen.get(key)!;
  };
}

function trackedFiles(cwd: string, glob: string): string[] {
  const out = tryGit(cwd, ['ls-files', '--', glob]);
  return out ? out.split('\n').filter(Boolean) : [];
}

function attestationIn(cwd: string, file: string): Attestation | null {
  if (!file.endsWith('.json')) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, file), 'utf8')) as { preregistration_attestation?: Attestation };
    return parsed.preregistration_attestation ?? null;
  } catch {
    return null;
  }
}

const isShallow = (cwd: string) => tryGit(cwd, ['rev-parse', '--is-shallow-repository']) === 'true';
const SHALLOW: OrderProblem = { id: '*', file: '*', problem: 'shallow clone: run with full history (actions/checkout fetch-depth: 0)' };

export function checkOrder(entries: ManifestEntry[], cwd = process.cwd()): OrderProblem[] {
  if (isShallow(cwd)) return [SHALLOW];
  return orderProblems(entries, cwd, firstAddCommits(cwd));
}

function orderProblems(entries: ManifestEntry[], cwd: string, adds: Map<string, string>): OrderProblem[] {
  const isStrictAncestor = ancestry(cwd);
  const problems: OrderProblem[] = [];
  for (const entry of entries) {
    const preCommit = adds.get(entry.preregistration);
    if (!preCommit) {
      problems.push({ id: entry.id, file: entry.preregistration, problem: 'preregistration is not committed' });
      continue;
    }
    const declared = entry.preregistered_on_main === false && typeof entry.reason === 'string' && entry.reason.trim() !== '';
    for (const glob of entry.results) {
      for (const file of trackedFiles(cwd, glob)) {
        const resultCommit = adds.get(file);
        if (!resultCommit) continue;
        if (!isStrictAncestor(preCommit, resultCommit)) {
          const problem = `added in ${resultCommit.slice(0, 12)}, not after the preregistration commit ${preCommit.slice(0, 12)}`;
          problems.push(declared ? { id: entry.id, file, problem: `${problem} (declared: ${entry.reason!.trim()})`, warning: true } : { id: entry.id, file, problem });
        }
        const attestation = attestationIn(cwd, file);
        if (attestation) {
          if (attestation.preregistration !== entry.preregistration) {
            problems.push({ id: entry.id, file, problem: `attests ${attestation.preregistration}, expected ${entry.preregistration}` });
          } else if (preCommit !== attestation.preregistration_commit && !isStrictAncestor(preCommit, attestation.preregistration_commit)) {
            problems.push({ id: entry.id, file, problem: `attestation names ${attestation.preregistration_commit.slice(0, 12)}, which does not contain the preregistration` });
          }
        }
      }
    }
  }
  return problems;
}

export const LEDGER_PATH = 'docs/benchmarks/prereg-ledger.json';
export const ATTESTED = 'ordering attested privately, not publicly verifiable';

/** One experiment whose preregistration merged to the private main at or before the ledger's cutover. */
export interface LedgerEntry {
  id: string;
  preregistration: string;
  /** The private main commit that first added the preregistration, and that commit's committer date (UTC). */
  prereg_commit: string;
  prereg_merged_at: string;
  /** The pull request number in that commit's subject, or null. */
  pr_number: number | null;
  prereg_sha256: string;
  /** sha256 of the result manifest (see resultManifest) and the number of files it lists. */
  result_manifest_sha256: string;
  result_files: number;
  /** The experiment's declared deviation, copied from the manifest, when it has one. */
  declared_deviation?: string;
}

export interface Ledger {
  schema_version: 1;
  note: string;
  label: typeof ATTESTED;
  cutover: string;
  experiments: LedgerEntry[];
}

export interface PublicResult {
  id: string;
  status: 'attested' | 'strict' | 'failed';
  problems: string[];
  /** An attested experiment's declared deviation, from the ledger. */
  deviation?: string;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const commitDate = (cwd: string, commit: string) => new Date(git(cwd, ['show', '-s', '--format=%cI', commit])).toISOString();

/** The files the ledger hashed: the tree of the commit that last changed the ledger file, or the worktree while the ledger
 *  is uncommitted or modified (and when writing it). File content comes from the worktree unless the file changed after
 *  that commit; then it comes from the commit. */
interface Snapshot { rev: string | null; changed: Set<string>; contains: (commit: string) => boolean }

const WORKTREE: Snapshot = { rev: null, changed: new Set(), contains: () => true };

function ledgerSnapshot(cwd: string, ledgerPath: string): Snapshot {
  if (git(cwd, ['status', '--porcelain', '--', ledgerPath]) !== '') return WORKTREE;
  const rev = tryGit(cwd, ['log', '-1', '--format=%H', '--', ledgerPath]);
  if (!rev) return WORKTREE;
  const changed = new Set((tryGit(cwd, ['diff', '--name-only', '--no-renames', rev]) ?? '').split('\n').filter(Boolean));
  const isStrictAncestor = ancestry(cwd);
  return { rev, changed, contains: commit => commit === rev || isStrictAncestor(commit, rev) };
}

/** Commits that wrote the ledger file: every non-merge commit that changed it, and every merge whose copy differs from
 *  each parent's (a merge that edits it while resolving). */
function ledgerWrites(cwd: string, ledgerPath: string): number {
  const blob = (rev: string) => tryGit(cwd, ['rev-parse', `${rev}:${ledgerPath}`]);
  return git(cwd, ['log', '--full-history', '--format=%H %P', '--', ledgerPath]).split('\n').filter(Boolean).filter(row => {
    const [commit, ...parents] = row.split(' ');
    return parents.length < 2 || parents.every(p => blob(p) !== blob(commit!));
  }).length;
}

function contentAt(cwd: string, at: Snapshot, path: string): Buffer {
  return at.rev && at.changed.has(path) ? execFileSync('git', ['show', `${at.rev}:${path}`], { cwd, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(join(cwd, path));
}

/** The experiment's result manifest: one `<sha256>  <path>` line (sha256sum's format) per tracked file its results globs
 *  match that the snapshot contains, sorted by path, with the content it had there. */
function resultManifest(entry: ManifestEntry, cwd: string, adds: Map<string, string>, at: Snapshot): { text: string; files: number } {
  const files = [...new Set(entry.results.flatMap(glob => trackedFiles(cwd, glob)))].filter(file => adds.has(file) && at.contains(adds.get(file)!)).sort();
  return { text: files.map(file => `${sha256(contentAt(cwd, at, file))}  ${file}\n`).join(''), files: files.length };
}

/** The ledger, from the worktree: every experiment in the manifest, each of whose preregistration must have been first
 *  added in a commit dated at or before `cutover`, so no experiment merged privately is left to strict ancestry over the
 *  rebuilt history. Write it from a full clone of the private main with every scrub committed, just before the export. */
export function buildLedger(entries: ManifestEntry[], cutover: string, cwd = process.cwd()): Ledger {
  if (Number.isNaN(Date.parse(cutover))) throw new Error(`cutover ${cutover} is not an ISO-8601 instant`);
  if (isShallow(cwd)) throw new Error(SHALLOW.problem);
  const adds = firstAddCommits(cwd);
  const experiments: LedgerEntry[] = [];
  for (const entry of entries) {
    const commit = adds.get(entry.preregistration);
    if (!commit) throw new Error(`${entry.id}: preregistration ${entry.preregistration} is not committed`);
    const merged = commitDate(cwd, commit);
    if (Date.parse(merged) > Date.parse(cutover)) throw new Error(`${entry.id}: preregistration merged ${merged}, after the cutover ${new Date(cutover).toISOString()}; write the ledger with a later --cutover`);
    const pr = git(cwd, ['show', '-s', '--format=%s', commit]).match(/\(#(\d+)\)\s*$/);
    const results = resultManifest(entry, cwd, adds, WORKTREE);
    experiments.push({
      id: entry.id,
      preregistration: entry.preregistration,
      prereg_commit: commit,
      prereg_merged_at: merged,
      pr_number: pr ? Number(pr[1]) : null,
      prereg_sha256: sha256(readFileSync(join(cwd, entry.preregistration))),
      result_manifest_sha256: sha256(results.text),
      result_files: results.files,
      ...(entry.preregistered_on_main === false && entry.reason?.trim() ? { declared_deviation: entry.reason.trim() } : {}),
    });
  }
  return {
    schema_version: 1,
    note: 'Preregistration evidence for the public repository. Each entry was merged to the private main at or before the cutover. Its commit, date and PR number are the private record. The two sha256 values tie it to the preregistration and the result files in the commit that wrote this ledger. runner/prereg/prereg.ts --public checks these entries, and requires strict ancestry for every other experiment and for result files added after that commit. Regenerate with bun scripts/prereg-ledger.ts.',
    label: ATTESTED,
    cutover: new Date(cutover).toISOString(),
    experiments,
  };
}

/** The public chronology check. A ledger experiment dated at or before the cutover passes (attested) when its
 *  preregistration's first-add commit is in this history with the ledger's date, and its preregistration and result files
 *  hash as the ledger says in the commit that wrote the ledger; result files added after that commit need strict ancestry.
 *  Every other experiment needs strict ancestry (strict), whatever deviation it declares. Every experiment fails when more
 *  than one commit wrote the ledger file (ledgerWrites), since a rewritten ledger could move the cutover or add an entry.
 *  A result file no commit adds (a merge brought it in) fails its experiment, since its order can't be checked. */
export function checkPublic(entries: ManifestEntry[], ledger: Ledger, cwd = process.cwd(), ledgerPath = LEDGER_PATH): PublicResult[] {
  if (isShallow(cwd)) return [{ id: '*', status: 'failed', problems: [SHALLOW.problem] }];
  if (Number.isNaN(Date.parse(ledger.cutover))) return [{ id: '*', status: 'failed', problems: [`ledger cutover ${ledger.cutover} is not an ISO-8601 instant`] }];
  const adds = firstAddCommits(cwd);
  const at = ledgerSnapshot(cwd, ledgerPath);
  const writes = at.rev ? ledgerWrites(cwd, ledgerPath) : 0;
  if (writes > 1) return [{ id: '*', status: 'failed', problems: [`${ledgerPath} was changed in ${writes} commits; the ledger is written once and never edited`] }];
  const byId = new Map(ledger.experiments.map(e => [e.id, e]));
  const out: PublicResult[] = ledger.experiments.filter(l => !entries.some(e => e.id === l.id)).map(l => ({ id: l.id, status: 'failed' as const, problems: ['the ledger names an experiment the manifest does not list'] }));
  for (const entry of entries) {
    const l = byId.get(entry.id);
    const add = adds.get(entry.preregistration);
    const unadded = [...new Set(entry.results.flatMap(glob => trackedFiles(cwd, glob)))].filter(file => !adds.has(file)).map(file => `${file}: no commit in this history adds it (a merge brought it in), so its order can't be checked`);
    if (l && Date.parse(l.prereg_merged_at) <= Date.parse(ledger.cutover)) {
      const problems: string[] = [...unadded];
      if (l.preregistration !== entry.preregistration) problems.push(`the ledger names ${l.preregistration}, the manifest ${entry.preregistration}`);
      if (!add || !at.contains(add)) problems.push('the preregistration is not in this history');
      else {
        if (Date.parse(commitDate(cwd, add)) !== Date.parse(l.prereg_merged_at)) problems.push(`the commit that added the preregistration is dated ${commitDate(cwd, add)}, the ledger says ${l.prereg_merged_at}`);
        if (sha256(contentAt(cwd, at, entry.preregistration)) !== l.prereg_sha256) problems.push('ledger hash mismatch: the preregistration differs from the ledger');
        if (sha256(resultManifest(entry, cwd, adds, at).text) !== l.result_manifest_sha256) problems.push('ledger hash mismatch: the result files differ from the ledger');
        const later = entry.results.flatMap(glob => trackedFiles(cwd, glob)).filter(file => adds.has(file) && !at.contains(adds.get(file)!));
        if (later.length) problems.push(...orderProblems([{ id: entry.id, preregistration: entry.preregistration, results: later }], cwd, adds).map(p => `${p.file}: ${p.problem}`));
      }
      out.push({ id: entry.id, status: problems.length ? 'failed' : 'attested', problems, ...(l.declared_deviation ? { deviation: l.declared_deviation } : {}) });
      continue;
    }
    const problems = [...unadded, ...orderProblems([{ id: entry.id, preregistration: entry.preregistration, results: entry.results }], cwd, adds).map(p => `${p.file}: ${p.problem}`)];
    if (l) problems.unshift(`the ledger entry is dated after the cutover (${l.prereg_merged_at} > ${ledger.cutover}), so strict ancestry applies`);
    out.push({ id: entry.id, status: problems.length ? 'failed' : 'strict', problems });
  }
  return out;
}

export function readLedger(path: string): Ledger {
  return JSON.parse(readFileSync(path, 'utf8')) as Ledger;
}

/** The main manifest plus one file per experiment group in `preregistrations.d/`, so parallel branches don't collide. */
export function loadManifest(root = process.cwd()): ManifestEntry[] {
  const read = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { experiments: ManifestEntry[] }).experiments;
  const main = join(root, 'docs/benchmarks/preregistrations.json');
  const dir = join(root, 'docs/benchmarks/preregistrations.d');
  const extra = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => read(join(dir, f))) : [];
  return [...read(main), ...extra];
}

function publicMain(entries: ManifestEntry[], ledgerPath: string): number {
  const results = checkPublic(entries, readLedger(ledgerPath), process.cwd(), ledgerPath);
  for (const r of results) {
    if (r.status === 'attested') console.log(`prereg-public: ${r.id}: ${ATTESTED}${r.deviation ? `; declared deviation: ${r.deviation}` : ''}`);
    else if (r.status === 'strict') console.log(`prereg-public: ${r.id}: strict ancestry`);
    else for (const p of r.problems) console.error(`prereg-public: ${r.id}: ${p}`);
  }
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`prereg-public: ${entries.length} experiments, ${results.filter(r => r.status === 'attested').length} attested, ${results.filter(r => r.status === 'strict').length} strict, ${failed} failed`);
  return failed;
}

if (import.meta.main) {
  const entries = loadManifest();
  if (process.argv.includes('--public')) {
    const at = process.argv.indexOf('--ledger');
    const failed = publicMain(entries, at >= 0 ? process.argv[at + 1]! : LEDGER_PATH);
    const { checkOpenings } = await import('../heldout/openings.ts');
    const openings = checkOpenings(process.cwd());
    for (const p of openings) console.error(`heldout-openings: ${p}`);
    console.log(`heldout-openings: ${openings.length} problems`);
    process.exit(failed === 0 && openings.length === 0 ? 0 : 1);
  }
  const all = checkOrder(entries);
  const problems = all.filter(p => !p.warning);
  const warnings = all.filter(p => p.warning);
  for (const p of problems) console.error(`prereg-order: ${p.id}: ${p.file}: ${p.problem}`);
  for (const w of warnings) console.error(`prereg-order: warning: ${w.id}: ${w.file}: ${w.problem}`);
  console.log(`prereg-order: ${entries.length} experiments checked, ${problems.length} problems, ${warnings.length} warnings`);
  const { checkOpenings } = await import('../heldout/openings.ts');
  const openings = checkOpenings(process.cwd());
  for (const p of openings) console.error(`heldout-openings: ${p}`);
  console.log(`heldout-openings: ${openings.length} problems`);
  process.exit(problems.length === 0 && openings.length === 0 ? 0 : 1);
}
