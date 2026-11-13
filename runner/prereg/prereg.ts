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
 * In the public history each first-add commit counts as the commit on HEAD's
 * first-parent line that brought it in, so a preregistration and results that one
 * merge brought in together fail. With `--commit-map <tsv> --source <private clone>`
 * (the export passes both), a receipt's attestation, which names a private commit,
 * is checked at its public commit: the commit map's entry when this history holds
 * it, else that of the merge that brought the commit into the source main. The
 * source's committed publication/prereg-exceptions.json may name exceptions to one
 * rule only, same-landing (a result file that reached main in the preregistration's
 * commit), each for one experiment and an exact path set, and only after the check
 * proves the private order the exception states; every use is printed, and an
 * exception no result file used fails. Without --commit-map and --source (the public
 * repository's own CI) the check reads docs/benchmarks/prereg-attestations.json, which
 * the export writes with --write-attestation-map: each private attestation commit and
 * its public commit. Such an attestation is labelled as mapped by the export, and a
 * missing map fails the check rather than skip it.
 *
 * Both modes also run `checkPrivateByHash` (runner/prereg/private-by-hash.ts) over every experiment of the
 * private-by-hash result class: its preregistration pins the private billing outputs and no hash, and its results
 * attestation names the unchanged preregistration and exactly those outputs.
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
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  /**
   * The private-by-hash result class (runner/prereg/private-by-hash.ts): the run's ledger and usage log stay private, its
   * preregistration pins them by name, schema and location only, and results/private-by-hash.json attests their sha256
   * after the run. Absent for a run that publishes its billing artifacts.
   */
  result_class?: 'private-by-hash';
}

/** The public copy's commit map (report/commit-map.tsv from scripts/public-export: each private main commit, then its
 *  public id, "(not published)" or "(pruned)") and the private clone of main it was written from. */
export interface Publication {
  map: Map<string, string>;
  source: string;
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

/** For a commit HEAD reaches: the oldest commit on HEAD's first-parent line that has it as an ancestor, which is the
 *  commit itself when it is on that line and otherwise the merge that brought it in. Judged by the commit graph
 *  (rev-list --ancestry-path), never by dates; null when HEAD does not reach the commit. */
export function firstParentLanding(repo: string): (commit: string) => string | null {
  const parents = new Map<string, string[]>();
  for (const row of git(repo, ['rev-list', '--parents', 'HEAD']).split('\n').filter(Boolean)) {
    const [commit, ...ps] = row.split(' ');
    parents.set(commit!, ps);
  }
  const landing = new Map<string, string>();
  for (const f of git(repo, ['rev-list', '--first-parent', '--reverse', 'HEAD']).split('\n').filter(Boolean)) {
    const stack = [f];
    while (stack.length) {
      const c = stack.pop()!;
      if (landing.has(c)) continue;
      landing.set(c, f);
      stack.push(...(parents.get(c) ?? []));
    }
  }
  return commit => landing.get(commit) ?? landing.get(tryGit(repo, ['rev-parse', '--verify', '-q', `${commit}^{commit}`]) ?? '') ?? null;
}

const HEX40 = /^[0-9a-f]{40}$/;

/** The public commit of a private commit an attestation names: its own commit-map entry when this history holds that
 *  commit, else the entry of its first-parent landing in the source main. Fails closed, with the reason, when the source
 *  main does not reach the commit or the landing is not published in this history. Without a publication, a commit
 *  counts only when this history holds it. */
const heldIn = (cwd: string) => {
  const seen = new Map<string, boolean>();
  return (c: string | undefined): boolean => {
    if (!c || !HEX40.test(c)) return false;
    if (!seen.has(c)) seen.set(c, tryGit(cwd, ['merge-base', '--is-ancestor', c, 'HEAD']) !== null);
    return seen.get(c)!;
  };
};
const mapState = (to: string | undefined) => (!to ? 'not in the commit map' : HEX40.test(to) ? `mapped to ${to.slice(0, 12)}, which this history does not hold` : to);

/** Where a path reached main: the commit that added it, the first-parent commit that brought that add into main, and
 *  the public commit it is judged at. */
export interface Placement { added: string; merge: string; commit: string }

/** With a publication, the placement of a path from the --source private history: each commit there that adds it,
 *  taken at its first-parent landing (the earliest landing on the first-parent line when several commits add it), at
 *  that landing's public commit. Never the path's first appearance in this public history, which an export hold can move
 *  later. Fails closed when the source never adds the path or its landing is not published here. */
export function sourcePlacement(cwd: string, pub: Publication): (path: string) => Placement | { problem: string } {
  const held = heldIn(cwd);
  const landing = firstParentLanding(pub.source);
  const order = new Map(git(pub.source, ['rev-list', '--first-parent', '--reverse', 'HEAD']).split('\n').filter(Boolean).map((c, i) => [c, i] as const));
  const adds = new Map<string, string[]>();
  for (const chunk of (tryGit(pub.source, ['log', '--diff-filter=A', '--no-renames', '--format=%x00%H', '--name-only', 'HEAD']) ?? '').split('\0')) {
    const [commit, ...paths] = chunk.split('\n').filter(Boolean);
    if (commit) for (const path of paths) (adds.get(path) ?? adds.set(path, []).get(path)!).push(commit);
  }
  return path => {
    const found = (adds.get(path) ?? []).map(added => ({ added, merge: landing(added) })).filter((x): x is { added: string; merge: string } => !!x.merge).sort((a, b) => order.get(a.merge)! - order.get(b.merge)!)[0];
    if (!found) return { problem: `no commit on the source main adds ${path}` };
    const to = pub.map.get(found.merge);
    if (!held(to)) return { problem: `${path} was added in ${found.added.slice(0, 12)}, and ${found.merge.slice(0, 12)}, the first-parent commit that brought it into the source main, is ${mapState(to)}` };
    return { ...found, commit: to! };
  };
}

export function publicCommit(cwd: string, pub?: Publication, attestations?: AttestationMap): (commit: string) => { commit: string; mapped?: true } | { problem: string } {
  const held = heldIn(cwd);
  if (!pub && attestations) {
    return commit => {
      if (held(commit)) return { commit };
      const to = Object.hasOwn(attestations.attestations, commit) ? attestations.attestations[commit] : undefined;
      if (held(to)) return { commit: to!, mapped: true };
      return { problem: `${commit.slice(0, 12)} is not in this history, and ${ATTESTATION_MAP_PATH} ${to ? `maps it to ${to.slice(0, 12)}, which this history does not hold` : 'does not map it'}` };
    };
  }
  if (!pub) return commit => (held(commit) ? { commit } : { problem: `${commit.slice(0, 12)} is not in this history; give --commit-map and --source to map it through the export's commit map` });
  const landing = firstParentLanding(pub.source);
  return commit => {
    const own = pub.map.get(commit);
    if (held(own)) return { commit: own! };
    const merge = landing(commit);
    if (!merge) return { problem: `${commit.slice(0, 12)} is not published, and no commit on the source main's first-parent line has it as an ancestor` };
    const to = pub.map.get(merge);
    if (held(to)) return { commit: to! };
    return { problem: `${commit.slice(0, 12)} is not published, and ${merge.slice(0, 12)}, the first-parent commit that brought it into the source main, is ${mapState(to)}` };
  };
}

export function readCommitMap(path: string): Map<string, string> {
  return new Map(readFileSync(path, 'utf8').split('\n').slice(1).filter(Boolean).map(line => line.split('\t') as [string, string]));
}

export const ATTESTATION_MAP_PATH = 'docs/benchmarks/prereg-attestations.json';
export const MAPPED = 'attestation mapped by the public export, which checked its private ancestry';

/** The public export's map from each private commit a published attestation names, when the public history does not
 *  hold it, to the public commit publicCommit gives it through the commit map. The export writes it into its last commit
 *  after the check with the commit map and the private clone, so the public repository runs --public without either. */
export interface AttestationMap {
  schema_version: 1;
  note: string;
  label: typeof MAPPED;
  attestations: Record<string, string>;
  /** Each same-landing exception the export's check applies (EXCEPTIONS_PATH), at the public commit of its merge. Only
   *  the experiment and the paths: the reason and the approval stay in the private record. The export's check fails an
   *  exception that excuses nothing; this one may go unused, because the public history can place a held file later. */
  exceptions: MappedException[];
}

export interface MappedException { experiment: string; paths: string[]; public_merge: string }

/** The attestation map for this history: each private commit a result file's attestation names that this history does
 *  not hold, at its public commit. A commit that cannot be mapped is left out; the check with the publication reports it. */
export function buildAttestationMap(entries: ManifestEntry[], cwd: string, pub: Publication): AttestationMap {
  const held = heldIn(cwd);
  const named = publicCommit(cwd, pub);
  const found = new Map<string, string>();
  for (const entry of entries) {
    for (const glob of entry.results) {
      for (const file of trackedFiles(cwd, glob)) {
        const commit = attestationIn(cwd, file)?.preregistration_commit;
        if (!commit || !HEX40.test(commit) || found.has(commit) || held(commit)) continue;
        const to = named(commit);
        if ('commit' in to) found.set(commit, to.commit);
      }
    }
  }
  return {
    schema_version: 1,
    note: `Written by scripts/public-export into its last commit. Each key is a private commit that a published receipt's preregistration attestation names and this history does not hold; each value is the public commit it is checked at: the commit map's entry, or that of the merge that brought it into the private main. runner/prereg/prereg.ts --public reads it when it has no commit map and private clone, and checks that the public commit contains the preregistration. That the private commit contains it was checked at export.`,
    label: MAPPED,
    attestations: Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b))),
    exceptions: readExceptions(pub.source).exceptions.flatMap(e => (held(pub.map.get(e.merge)) ? [{ experiment: e.experiment, paths: e.paths, public_merge: pub.map.get(e.merge)! }] : [])),
  };
}

export function readAttestationMap(path: string): AttestationMap {
  const map = JSON.parse(readFileSync(path, 'utf8')) as AttestationMap;
  const pairs = Object.entries(map?.attestations ?? {});
  const exceptionsOk = Array.isArray(map?.exceptions) && map.exceptions.every(e => typeof e?.experiment === 'string' && Array.isArray(e.paths) && e.paths.every(p => typeof p === 'string') && HEX40.test(String(e.public_merge)));
  if (map?.schema_version !== 1 || map.label !== MAPPED || typeof map.attestations !== 'object' || !pairs.every(([a, b]) => HEX40.test(a) && HEX40.test(String(b))) || !exceptionsOk) throw new Error(`${path} is not an attestation map (schema_version 1, the label, full commit ids and an exceptions list)`);
  return map;
}

export const EXCEPTIONS_PATH = 'publication/prereg-exceptions.json';

/** A reviewed exception to the public order check, from EXCEPTIONS_PATH as committed at the --source clone's HEAD. It
 *  waives one rule, same-landing: a result file of `experiment`, matching one of `paths`, that reached main in the same
 *  commit as the preregistration. It holds only when the source proves the private order it states: the preregistration
 *  was first added in `preregistration_commit`, which is a strict ancestor of `results_commit` and of each waived file's
 *  first add, all of which reached the source main in `merge`, whose public commit is where they all landed. */
export interface OrderException {
  id: string;
  experiment: string;
  run?: string;
  paths: string[];
  waives: 'same-landing';
  preregistration_commit: string;
  results_commit: string;
  merge: string;
  reason: string;
  approved: string;
}

export function readExceptions(source: string): { exceptions: OrderException[]; problems: string[] } {
  const text = tryGit(source, ['show', `HEAD:${EXCEPTIONS_PATH}`]);
  if (text === null) return { exceptions: [], problems: [] };
  let list: OrderException[];
  try {
    list = (JSON.parse(text) as { exceptions: OrderException[] }).exceptions;
  } catch {
    return { exceptions: [], problems: [`${EXCEPTIONS_PATH} is not JSON`] };
  }
  if (!Array.isArray(list)) return { exceptions: [], problems: [`${EXCEPTIONS_PATH} has no exceptions list`] };
  const text1 = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const problems = list.flatMap((e, i) => {
    const missing = [
      !text1(e?.id) && 'an id',
      list.findIndex(x => x?.id === e?.id) !== i && 'an id no other entry uses',
      !text1(e?.experiment) && 'an experiment',
      !(Array.isArray(e?.paths) && e.paths.length > 0 && e.paths.every(text1)) && 'paths',
      e?.waives !== 'same-landing' && 'waives: "same-landing", the one rule an exception can waive',
      ...(['preregistration_commit', 'results_commit', 'merge'] as const).map(k => !HEX40.test(String(e?.[k])) && `a full ${k}`),
      !text1(e?.reason) && 'a reason',
      !text1(e?.approved) && 'an approval',
    ].filter(Boolean);
    return missing.length ? [`${EXCEPTIONS_PATH}: ${text1(e?.id) ? e.id : `entry ${i + 1}`} needs ${missing.join(', ')}`] : [];
  });
  return problems.length ? { exceptions: [], problems } : { exceptions: list, problems: [] };
}

/** The same-landing exceptions, checked against the source: `excuse` returns null when no exception names the experiment
 *  and file, the reason when one does but its private order does not hold, and the exception when it does. `uses` keeps
 *  every file each exception excused. */
function exceptionCheck(pub: Publication, exceptions: OrderException[]) {
  const landing = firstParentLanding(pub.source);
  const isStrictAncestor = ancestry(pub.source);
  const uses = new Map<string, string[]>(exceptions.map(e => [e.id, []]));
  const proven = new Map<string, { problem: string | null; adds: Map<string, string> }>();
  const prove = (e: OrderException, preregistration: string) => {
    if (!proven.has(e.id)) {
      const short = (c: string | null | undefined) => (c ? c.slice(0, 12) : 'no commit');
      const why: string[] = [];
      const added = (tryGit(pub.source, ['log', '--diff-filter=A', '--no-renames', '--format=%H', '--', preregistration]) ?? '').split('\n').filter(Boolean).pop();
      if (added !== e.preregistration_commit) why.push(`the source first adds ${preregistration} in ${short(added)}, not ${short(e.preregistration_commit)}`);
      if (!isStrictAncestor(e.preregistration_commit, e.results_commit)) why.push(`${short(e.preregistration_commit)} is not a strict ancestor of ${short(e.results_commit)} in the source`);
      for (const c of [e.preregistration_commit, e.results_commit]) if (landing(c) !== e.merge) why.push(`${short(c)} reached the source main in ${short(landing(c))}, not ${short(e.merge)}`);
      const adds = new Map<string, string>();
      const log = tryGit(pub.source, ['log', '--diff-filter=A', '--no-renames', '--format=%x00%H', '--name-only', '--', ...e.paths.map(p => `:(glob)${p}`)]) ?? '';
      for (const chunk of log.split('\0')) {
        const [commit, ...paths] = chunk.split('\n').filter(Boolean);
        if (commit) for (const path of paths) adds.set(path, commit);
      }
      proven.set(e.id, { problem: why.length ? why.join('; ') : null, adds });
    }
    return proven.get(e.id)!;
  };
  const excuse = (entry: ManifestEntry, file: string, landedAt: string): { exception: OrderException } | { problem: string } | null => {
    const e = exceptions.find(x => x.experiment === entry.id && x.paths.some(p => new Bun.Glob(p).match(file)));
    if (!e) return null;
    const { problem, adds } = prove(e, entry.preregistration);
    const add = adds.get(file);
    const why = [
      problem,
      !add ? 'the source has no commit that adds this file' : !isStrictAncestor(e.preregistration_commit, add) ? `its first add ${add.slice(0, 12)} in the source is not after ${e.preregistration_commit.slice(0, 12)}` : landing(add) !== e.merge ? `its first add ${add.slice(0, 12)} did not reach the source main in ${e.merge.slice(0, 12)}` : null,
      pub.map.get(e.merge) !== landedAt ? `${e.merge.slice(0, 12)} is published as ${pub.map.get(e.merge)?.slice(0, 12) ?? 'nothing'}, not as ${landedAt.slice(0, 12)}, where this file landed` : null,
    ].filter(Boolean);
    if (why.length) return { problem: `exception ${e.id} does not hold: ${why.join('; ')}` };
    uses.get(e.id)!.push(file);
    return { exception: e };
  };
  return { excuse, uses };
}

/** How the public check reads commits: each path at its placement (from the source when there is a publication, else
 *  its first add in this history at its first-parent landing here), each attestation commit at its public commit;
 *  `excuse` applies the same-landing exceptions. */
interface PublicView {
  landing: (commit: string) => string | null;
  placed?: (path: string) => Placement | { problem: string };
  named: (commit: string) => { commit: string } | { problem: string };
  excuse?: (entry: ManifestEntry, file: string, landedAt: string) => { exception: OrderException | MappedException } | { problem: string } | null;
  /** With a publication, strict ancestry in the --source clone: an attestation's private commit must contain the
   *  preregistration's private first add there, because commits on one branch share a public landing. */
  inSource?: (older: string, newer: string) => boolean;
}

const isShallow = (cwd: string) => tryGit(cwd, ['rev-parse', '--is-shallow-repository']) === 'true';
const SHALLOW: OrderProblem = { id: '*', file: '*', problem: 'shallow clone: run with full history (actions/checkout fetch-depth: 0)' };

export function checkOrder(entries: ManifestEntry[], cwd = process.cwd()): OrderProblem[] {
  if (isShallow(cwd)) return [SHALLOW];
  return orderProblems(entries, cwd, firstAddCommits(cwd));
}

function orderProblems(entries: ManifestEntry[], cwd: string, adds: Map<string, string>, view?: PublicView, only?: Set<string>): OrderProblem[] {
  const isStrictAncestor = ancestry(cwd);
  const place = (path: string, commit: string): Placement | { problem: string } => {
    if (view?.placed) return view.placed(path);
    const merge = view?.landing(commit) ?? commit;
    return { added: commit, merge, commit: merge };
  };
  const describe = (p: Placement) => `${p.added.slice(0, 12)}${p.merge !== p.added ? ` (brought into main by ${p.merge.slice(0, 12)})` : ''}${p.commit !== p.merge ? `, published as ${p.commit.slice(0, 12)}` : ''}`;
  const problems: OrderProblem[] = [];
  for (const entry of entries) {
    const preCommit = adds.get(entry.preregistration);
    if (!preCommit) {
      problems.push({ id: entry.id, file: entry.preregistration, problem: 'preregistration is not committed' });
      continue;
    }
    const pre = place(entry.preregistration, preCommit);
    if ('problem' in pre) {
      problems.push({ id: entry.id, file: entry.preregistration, problem: pre.problem });
      continue;
    }
    const declared = entry.preregistered_on_main === false && typeof entry.reason === 'string' && entry.reason.trim() !== '';
    for (const glob of entry.results) {
      for (const file of trackedFiles(cwd, glob)) {
        if (only && !only.has(file)) continue;
        const resultCommit = adds.get(file);
        if (!resultCommit) continue;
        const res = place(file, resultCommit);
        if ('problem' in res) problems.push({ id: entry.id, file, problem: res.problem });
        else if (!isStrictAncestor(pre.commit, res.commit)) {
          const excused = pre.commit === res.commit ? (view?.excuse?.(entry, file, res.commit) ?? null) : null;
          const problem = `added in ${describe(res)}, not after the preregistration commit ${describe(pre)}${excused && 'problem' in excused ? `; ${excused.problem}` : ''}`;
          if (!excused || 'problem' in excused) problems.push(declared ? { id: entry.id, file, problem: `${problem} (declared: ${entry.reason!.trim()})`, warning: true } : { id: entry.id, file, problem });
        }
        const attestation = attestationIn(cwd, file);
        if (attestation) {
          if (attestation.preregistration !== entry.preregistration) {
            problems.push({ id: entry.id, file, problem: `attests ${attestation.preregistration}, expected ${entry.preregistration}` });
          } else {
            const named = view ? view.named(attestation.preregistration_commit) : { commit: attestation.preregistration_commit };
            const published = 'commit' in named && named.commit !== attestation.preregistration_commit ? `, published as ${named.commit.slice(0, 12)}` : '';
            if ('problem' in named) problems.push({ id: entry.id, file, problem: `attestation: ${named.problem}` });
            else if (view?.inSource && attestation.preregistration_commit !== pre.added && !view.inSource(pre.added, attestation.preregistration_commit)) {
              problems.push({ id: entry.id, file, problem: `attestation names ${attestation.preregistration_commit.slice(0, 12)}, which does not contain the preregistration (first added in ${pre.added.slice(0, 12)} in the source)` });
            } else if ((view?.placed ? pre.commit : preCommit) !== named.commit && !isStrictAncestor(view?.placed ? pre.commit : preCommit, named.commit)) {
              problems.push({ id: entry.id, file, problem: `attestation names ${attestation.preregistration_commit.slice(0, 12)}${published}, which does not contain the preregistration` });
            }
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
  /** Each same-landing exception this experiment used, with the files it excused. */
  exceptions?: { exception: OrderException; files: string[] }[];
  /** The private attestation commits read through the attestation map. */
  mapped?: string[];
  /** Each same-landing exception from the attestation map this experiment used, with the files it excused. */
  mappedExceptions?: { exception: MappedException; files: string[] }[];
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

/** Each path's content in the snapshot, in order. A file that changed after the snapshot's commit is read from that commit
 *  through one `git cat-file --batch` per 500 files: one `git show` per file took 13 minutes on an experiment with 10,388
 *  result files. A path the commit does not hold as a file throws, as `git show` did. */
function contentsAt(cwd: string, at: Snapshot, paths: string[]): Buffer[] {
  const fromRev = at.rev ? paths.filter(p => at.changed.has(p)) : [];
  const blobs = new Map<string, Buffer>();
  for (let i = 0; i < fromRev.length; i += 500) {
    const chunk = fromRev.slice(i, i + 500);
    const out = execFileSync('git', ['cat-file', '--batch'], { cwd, input: chunk.map(p => `${at.rev}:${p}\n`).join(''), maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] });
    let pos = 0;
    for (const path of chunk) {
      const eol = out.indexOf(10, pos);
      const size = /^[0-9a-f]{40,64} blob (\d+)$/.exec(out.subarray(pos, eol).toString())?.[1];
      if (size === undefined) throw new Error(`${path} is not a file in ${at.rev!.slice(0, 12)}`);
      blobs.set(path, out.subarray(eol + 1, eol + 1 + Number(size)));
      pos = eol + 1 + Number(size) + 1;
    }
  }
  return paths.map(p => blobs.get(p) ?? readFileSync(join(cwd, p)));
}

/** The experiment's result manifest: one `<sha256>  <path>` line (sha256sum's format) per tracked file its results globs
 *  match that the snapshot contains, sorted by path, with the content it had there. */
function resultManifest(entry: ManifestEntry, cwd: string, adds: Map<string, string>, at: Snapshot): { text: string; files: number } {
  const files = [...new Set(entry.results.flatMap(glob => trackedFiles(cwd, glob)))].filter(file => adds.has(file) && at.contains(adds.get(file)!)).sort();
  const content = contentsAt(cwd, at, files);
  return { text: files.map((file, i) => `${sha256(content[i]!)}  ${file}\n`).join(''), files: files.length };
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
 *  A result file no commit adds (a merge brought it in) fails its experiment, since its order can't be checked.
 *  Strict ancestry is judged between first-parent landings (firstParentLanding), so the preregistration must have
 *  reached main in a commit strictly before the one that brought in the result; the same commit fails. An attestation's
 *  private commit is checked at its public commit (publicCommit, through the publication's commit map). */
export function checkPublic(entries: ManifestEntry[], ledger: Ledger, cwd = process.cwd(), ledgerPath = LEDGER_PATH, publication?: Publication, attestations?: AttestationMap): PublicResult[] {
  if (isShallow(cwd)) return [{ id: '*', status: 'failed', problems: [SHALLOW.problem] }];
  if (Number.isNaN(Date.parse(ledger.cutover))) return [{ id: '*', status: 'failed', problems: [`ledger cutover ${ledger.cutover} is not an ISO-8601 instant`] }];
  const adds = firstAddCommits(cwd);
  const at = ledgerSnapshot(cwd, ledgerPath);
  const writes = at.rev ? ledgerWrites(cwd, ledgerPath) : 0;
  if (writes > 1) return [{ id: '*', status: 'failed', problems: [`${ledgerPath} was changed in ${writes} commits; the ledger is written once and never edited`] }];
  const read = publication ? readExceptions(publication.source) : { exceptions: [], problems: [] };
  if (read.problems.length) return [{ id: '*', status: 'failed', problems: read.problems }];
  const exceptions = publication && read.exceptions.length ? exceptionCheck(publication, read.exceptions) : null;
  const carried = !publication ? (attestations?.exceptions ?? []) : [];
  const carriedUses = carried.map(() => [] as string[]);
  const excuseCarried = (entry: ManifestEntry, file: string, landedAt: string): { exception: MappedException } | { problem: string } | null => {
    const i = carried.findIndex(x => x.experiment === entry.id && x.paths.some(p => new Bun.Glob(p).match(file)));
    if (i < 0) return null;
    if (carried[i]!.public_merge !== landedAt) return { problem: `${ATTESTATION_MAP_PATH} records the exception at ${carried[i]!.public_merge.slice(0, 12)}, not at ${landedAt.slice(0, 12)}, where this file landed` };
    carriedUses[i]!.push(file);
    return { exception: carried[i]! };
  };
  const named = publicCommit(cwd, publication, attestations);
  let mapped = new Set<string>();
  const view: PublicView = { landing: firstParentLanding(cwd), placed: publication ? sourcePlacement(cwd, publication) : undefined, named: commit => { const to = named(commit); if ('mapped' in to) mapped.add(commit); return to; }, excuse: exceptions?.excuse ?? (carried.length ? excuseCarried : undefined), inSource: publication ? ancestry(publication.source) : undefined };
  const mappedOf = () => (mapped.size ? { mapped: [...mapped].sort() } : {});
  const byId = new Map(ledger.experiments.map(e => [e.id, e]));
  const out: PublicResult[] = ledger.experiments.filter(l => !entries.some(e => e.id === l.id)).map(l => ({ id: l.id, status: 'failed' as const, problems: ['the ledger names an experiment the manifest does not list'] }));
  for (const entry of entries) {
    mapped = new Set();
    const l = byId.get(entry.id);
    const add = adds.get(entry.preregistration);
    const unadded = [...new Set(entry.results.flatMap(glob => trackedFiles(cwd, glob)))].filter(file => !adds.has(file)).map(file => `${file}: no commit in this history adds it (a merge brought it in), so its order can't be checked`);
    if (l && Date.parse(l.prereg_merged_at) <= Date.parse(ledger.cutover)) {
      const problems: string[] = [...unadded];
      if (l.preregistration !== entry.preregistration) problems.push(`the ledger names ${l.preregistration}, the manifest ${entry.preregistration}`);
      if (!add || !at.contains(add)) problems.push('the preregistration is not in this history');
      else {
        if (Date.parse(commitDate(cwd, add)) !== Date.parse(l.prereg_merged_at)) problems.push(`the commit that added the preregistration is dated ${commitDate(cwd, add)}, the ledger says ${l.prereg_merged_at}`);
        if (sha256(contentsAt(cwd, at, [entry.preregistration])[0]!) !== l.prereg_sha256) problems.push('ledger hash mismatch: the preregistration differs from the ledger');
        if (sha256(resultManifest(entry, cwd, adds, at).text) !== l.result_manifest_sha256) problems.push('ledger hash mismatch: the result files differ from the ledger');
        const later = entry.results.flatMap(glob => trackedFiles(cwd, glob)).filter(file => adds.has(file) && !at.contains(adds.get(file)!));
        if (later.length) problems.push(...orderProblems([{ id: entry.id, preregistration: entry.preregistration, results: entry.results }], cwd, adds, view, new Set(later)).map(p => `${p.file}: ${p.problem}`));
      }
      out.push({ id: entry.id, status: problems.length ? 'failed' : 'attested', problems, ...(l.declared_deviation ? { deviation: l.declared_deviation } : {}), ...mappedOf() });
      continue;
    }
    const problems = [...unadded, ...orderProblems([{ id: entry.id, preregistration: entry.preregistration, results: entry.results }], cwd, adds, view).map(p => `${p.file}: ${p.problem}`)];
    if (l) problems.unshift(`the ledger entry is dated after the cutover (${l.prereg_merged_at} > ${ledger.cutover}), so strict ancestry applies`);
    out.push({ id: entry.id, status: problems.length ? 'failed' : 'strict', problems, ...mappedOf() });
  }
  for (const e of read.exceptions) {
    const files = exceptions!.uses.get(e.id)!;
    const result = out.find(r => r.id === e.experiment);
    if (!files.length || !result) {
      out.push({ id: e.experiment, status: 'failed', problems: [`exception ${e.id} in ${EXCEPTIONS_PATH} excused no result file; remove it`] });
      continue;
    }
    result.exceptions = [...(result.exceptions ?? []), { exception: e, files }];
  }
  carried.forEach((e, i) => {
    const result = out.find(r => r.id === e.experiment);
    if (carriedUses[i]!.length && result) result.mappedExceptions = [...(result.mappedExceptions ?? []), { exception: e, files: carriedUses[i]! }];
  });
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

function publicMain(entries: ManifestEntry[], ledgerPath: string, publication?: Publication, attestations?: AttestationMap): number {
  const results = checkPublic(entries, readLedger(ledgerPath), process.cwd(), ledgerPath, publication, attestations);
  for (const r of results) {
    const mapped = r.mapped ? `; ${r.mapped.length} attestation commit(s) read through ${ATTESTATION_MAP_PATH} (${MAPPED})` : '';
    if (r.status === 'attested') console.log(`prereg-public: ${r.id}: ${ATTESTED}${r.deviation ? `; declared deviation: ${r.deviation}` : ''}${mapped}`);
    else if (r.status === 'strict') console.log(`prereg-public: ${r.id}: strict ancestry${mapped}`);
    else for (const p of r.problems) console.error(`prereg-public: ${r.id}: ${p}`);
  }
  const used = results.flatMap(r => (r.exceptions ?? []).map(u => ({ id: r.id, ...u })));
  for (const u of used) {
    const e = u.exception;
    console.log(`prereg-public: exception ${e.id}: ${u.id}: ${u.files.length} result file(s) under ${e.paths.join(', ')} reached main in the preregistration's commit (${e.merge.slice(0, 12)}); same-landing waived after the source showed ${e.preregistration_commit.slice(0, 12)} adds the preregistration and is a strict ancestor of ${e.results_commit.slice(0, 12)} and of each file's first add. Reason: ${e.reason}`);
  }
  const carried = results.flatMap(r => (r.mappedExceptions ?? []).map(u => ({ id: r.id, ...u })));
  for (const u of carried) console.log(`prereg-public: exception at ${u.exception.public_merge.slice(0, 12)}: ${u.id}: ${u.files.length} result file(s) under ${u.exception.paths.join(', ')} reached main in the preregistration's commit; same-landing waived by an exception from ${ATTESTATION_MAP_PATH}, whose private order the export checked`);
  const failed = results.filter(r => r.status === 'failed').length;
  const usedCount = used.length + carried.length;
  console.log(`prereg-public: ${entries.length} experiments, ${results.filter(r => r.status === 'attested').length} attested, ${results.filter(r => r.status === 'strict').length} strict, ${failed} failed${usedCount ? `, ${usedCount} exception(s) used` : ''}`);
  return failed;
}

async function privateByHashMain(entries: ManifestEntry[]): Promise<number> {
  const registered = entries.filter(e => e.result_class === 'private-by-hash').length;
  const problems = registered ? (await import('./private-by-hash.ts')).checkPrivateByHash(entries) : [];
  for (const p of problems) console.error(`prereg-private-by-hash: ${p.id}: ${p.problem}`);
  console.log(`prereg-private-by-hash: ${registered} experiments, ${problems.length} problems`);
  return problems.length;
}

if (import.meta.main) {
  const entries = loadManifest();
  if (process.argv.includes('--public')) {
    const flag = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
    const [commitMap, source] = [flag('--commit-map'), flag('--source')];
    const writeMap = flag('--write-attestation-map');
    if (!commitMap !== !source || (writeMap && !commitMap)) {
      console.error('usage: bun runner/prereg/prereg.ts --public [--ledger <path>] [--commit-map <commit-map.tsv> --source <private clone of main> [--write-attestation-map <out>] | --attestation-map <path> [--base <commit>]] (--commit-map and --source go together; without them the check reads the attestation map, ' + ATTESTATION_MAP_PATH + ' by default, and --base fails a change that edits it)');
      process.exit(64);
    }
    const publication = commitMap && source ? { map: readCommitMap(commitMap), source } : undefined;
    if (writeMap) {
      const map = buildAttestationMap(entries, process.cwd(), publication!);
      writeFileSync(writeMap, JSON.stringify(map, null, 2) + '\n');
      console.log(`prereg-public: wrote ${writeMap} with ${Object.keys(map.attestations).length} attestation commit(s)`);
      process.exit(0);
    }
    const mapPath = flag('--attestation-map') ?? ATTESTATION_MAP_PATH;
    let attestations: AttestationMap | undefined;
    if (!publication) {
      if (!existsSync(mapPath)) {
        console.error(`prereg-public: ${mapPath} is missing. Without --commit-map and --source the check reads the attestation map the public export writes; it fails rather than skip the receipts' attestations.`);
        process.exit(1);
      }
      const base = flag('--base');
      if (base && tryGit(process.cwd(), ['diff', '--quiet', base, 'HEAD', '--', mapPath]) === null) {
        console.error(`prereg-public: ${mapPath} differs from ${base}, or ${base} is not in this history. Only the public export writes the attestation map, so a pull request may not change it.`);
        process.exit(1);
      }
      try {
        attestations = readAttestationMap(mapPath);
      } catch (e) {
        console.error(`prereg-public: ${(e as Error).message}`);
        process.exit(1);
      }
    }
    const failed = publicMain(entries, flag('--ledger') ?? LEDGER_PATH, publication, attestations);
    const privateByHash = await privateByHashMain(entries);
    const { checkOpenings } = await import('../heldout/openings.ts');
    const openings = checkOpenings(process.cwd());
    for (const p of openings) console.error(`heldout-openings: ${p}`);
    console.log(`heldout-openings: ${openings.length} problems`);
    process.exit(failed === 0 && privateByHash === 0 && openings.length === 0 ? 0 : 1);
  }
  const all = checkOrder(entries);
  const problems = all.filter(p => !p.warning);
  const warnings = all.filter(p => p.warning);
  for (const p of problems) console.error(`prereg-order: ${p.id}: ${p.file}: ${p.problem}`);
  for (const w of warnings) console.error(`prereg-order: warning: ${w.id}: ${w.file}: ${w.problem}`);
  console.log(`prereg-order: ${entries.length} experiments checked, ${problems.length} problems, ${warnings.length} warnings`);
  const privateByHash = await privateByHashMain(entries);
  const { checkOpenings } = await import('../heldout/openings.ts');
  const openings = checkOpenings(process.cwd());
  for (const p of openings) console.error(`heldout-openings: ${p}`);
  console.log(`heldout-openings: ${openings.length} problems`);
  process.exit(problems.length === 0 && privateByHash === 0 && openings.length === 0 ? 0 : 1);
}
