// Seal the held-out task bodies: write <set>/MANIFEST.json with the sha256 of every file under the set's held-out
// tree (the manifest itself excluded), the world seed manifest hash the tasks were authored against, and the
// generation time. tests/heldout-manifest.test.ts fails when a tree and its manifest disagree, so a change to a
// held-out task is visible in review and in the receipts.
//
// The manifest also carries the set's openings ledger: opening_budget (confirmatory openings allowed),
// alpha_per_opening, status (open, spent, retired), openings[] (one row per registered experiment that runs a held-out
// cell of the set: run_id, status, label, reason, candidate_sha256) and exposures[] (access that is not a run). The
// ledger stores no opening numbers; runner/heldout/openings.ts derives them from preregistration order on main. The
// ledger sits outside the tree digest, so editing it never changes tree_sha256, and resealing carries it through.
//
// A set can be held in sealed custody (docs/sealed-custody.md). Its held-out directory then holds only
// MANIFEST.json with "custody": "sealed" and a "sealed" block of commitments (bundle_sha256, world_slice_sha256,
// heldout_corpus_sha256, task_count, the age recipient and the bundle's path on the custody branch); tree_sha256 is the
// digest the plaintext tree had when scripts/sealed/seal.ts sealed it, and files and tasks stay empty so no task name is
// public. --check verifies a sealed set keyless: the commitments are present and well formed and no plaintext is in the
// tree. Resealing a sealed set goes through scripts/sealed/seal.ts, never this script.
//
// Task sets: v0.1 is tasks/multiuser/heldout (the default); any other set name is tasks/multiuser/<set>/heldout.
//
// A set has a kind, "multiuser" (the default) or "repo". A repo set (repository tasks, docs/tasks.md and the
// gstack-native format) lives under tasks/repo/<set>/, its public dev split in dev/ and its MANIFEST.json in heldout/. A repo
// set's held-out tree exists only inside custody: tasks/repo/<set>/heldout/ holds MANIFEST.json and nothing else, sealed or
// released (release.ts writes a retired repo set's tree to tasks/repo/<set>/released/). Its manifest says "kind": "repo",
// has no world: world_manifest_sha256, world_json_sha256 and the sealed block's world_slice_sha256 and
// heldout_corpus_sha256 are null, so a change to world/seed never touches it. Set names are unique across kinds.
//
// internal-task: a retired set can name the set that replaced it ("replaced_by": "v0.3-gen6"). The live-sharer guard keeps a set
// protected while any set in its replaced_by chain is in sealed custody and not retired as a replaced set, whatever the
// digests, and counts a manifest that does not parse or validate as a live sharer. --check validates replaced_by, refuses a
// sealed set that is retired with no replaced_by, compares every sealed set's status with the base branch (the merge base
// with origin/main, or main; it fails closed when it cannot read it), and checks sealed/backups.json, the sha256 of the
// backup each set was sealed from, which rekey.ts and compare-backups.ts bind a backup to --set by, and which only grows
// against the base.
//
//   bun scripts/seal-heldout.ts [--task-set v0.2]    write that set's manifest
//   bun scripts/seal-heldout.ts --check              check every sealed set, and refuse an unsealed tree; exit 1 on any problem
//   bun scripts/seal-heldout.ts --check --task-set v0.2   check one set

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RunnerError } from '../runner/errors.ts';

const ROOT = join(import.meta.dir, '..');
const WORLD_MANIFEST = join(ROOT, 'world', 'seed', 'MANIFEST.json');
export const DEFAULT_SET = 'v0.1';

export const SET_KINDS = ['multiuser', 'repo'] as const;
export type SetKind = (typeof SET_KINDS)[number];

export interface HeldoutSet {
  name: string;
  /** The repository the set belongs to (its world/seed/MANIFEST.json is the one a multiuser set is checked against). */
  root: string;
  /** multiuser (tasks/multiuser/<set>/heldout) or repo (tasks/repo/<set>/heldout). */
  kind: SetKind;
  /** The held-out directory of the set. */
  dir: string;
  /** <dir>/MANIFEST.json. */
  manifest: string;
  /** Where the plaintext task tree of a set that is not sealed lives in the checkout: dir for a multiuser set,
   *  tasks/repo/<set>/released for a repo set (a repo set's held-out directory never holds anything but MANIFEST.json). */
  tree: string;
}

export const OPENING_STATUSES = ['planned', 'opened', 'withdrawn', 'superseded'] as const;
export const OPENING_LABELS = ['confirmatory', 'dev'] as const;
export const SET_STATUSES = ['open', 'spent', 'retired'] as const;
/** A set name, as seal.ts takes it (never "*"). */
export const SET_NAME = /^[a-z0-9][a-z0-9.-]*$/;

/** One registered experiment that runs a held-out cell of the set. No opening number: runner/heldout/openings.ts derives it. */
export interface OpeningRow {
  run_id: string;
  /** planned (registered, no counted trial yet), opened, withdrawn or superseded (listed, never counted). */
  status: (typeof OPENING_STATUSES)[number];
  label: (typeof OPENING_LABELS)[number];
  /** Required for a dev, withdrawn or superseded row: why this opening is not confirmatory, or why it never opened. */
  reason?: string;
  /** sha256 of the candidate (gbrain commit, preamble, adapter config); null for backfilled rows (openings from before the openings ledger). */
  candidate_sha256: string | null;
}

/** Access to the set that is not a run: committed transcripts, held-out-derived content sent to a system under test. */
export interface Exposure {
  date: string;
  kind: string;
  recipient: string;
  what: string;
  source: string;
}

/** The openings ledger, outside the tree digest. */
export interface OpeningsLedger {
  opening_budget: number;
  alpha_per_opening: number;
  status: (typeof SET_STATUSES)[number];
  openings: OpeningRow[];
  exposures: Exposure[];
}

/** The public commitments of a sealed set (scripts/sealed/seal.ts writes them; scripts/sealed/open.ts and runner/run.ts check them). */
export interface SealedCommitments {
  /** sha256 of the age ciphertext of the bundle (a reproducible tar of the task tree, the world slice and its corpus pages). */
  bundle_sha256: string;
  /** sha256 of the bundle's world/slice.json: the set's held-out world records; null for a repo set. */
  world_slice_sha256: string | null;
  /** Digest of the bundle's corpus/ pages, as runner/heldout/sealed.ts corpusDigest computes it (the gbrain image checks the same); null for a repo set. */
  heldout_corpus_sha256: string | null;
  /** A repo set has no world slice and no corpus pages: world_slice_sha256 and heldout_corpus_sha256 are null, and this says why. */
  null_digests?: string;
  /** A repo set's generator/ directory in the bundle (seal.ts --generator), digested as corpusDigest does; null when it has none. */
  generator_sha256?: string | null;
  task_count: number;
  /** The public age recipient (age1...) the bundle is encrypted to (sealed/recipient.txt when sealed). */
  recipient: string;
  /** The private repository and the ref (refs/heads/custody) holding the ciphertext, the escrow and the access log, and the bundle's path there. */
  custody_repo: string;
  custody_ref: string;
  bundle: string;
  sealed_at: string;
  /** Extra files the bundle carries under extras/ (seal.ts --include), each bundle path to the sha256 of its bytes. */
  extras?: Record<string, string>;
}

export interface HeldoutManifest extends Partial<OpeningsLedger> {
  schema_version: 1;
  /** Absent or "multiuser" for a multi-user set; "repo" for a repository task set under tasks/repo/. */
  kind?: SetKind;
  /** Absent for a plaintext set; "sealed" when the set is held in sealed custody. */
  custody?: 'sealed';
  sealed?: SealedCommitments;
  /** On a retired set: the set that replaced it (a reseal such as v0.3-gen6 for v0.3). */
  replaced_by?: string;
  generated_at: string;
  /** The world the set was written against; null for a repo set, which has no world. */
  world_manifest_sha256: string | null;
  world_json_sha256: string | null;
  tasks: string[];
  files: Record<string, string>;
  tree_sha256: string;
}

const LEDGER_KEYS = ['opening_budget', 'alpha_per_opening', 'status', 'openings', 'exposures'] as const;

/** The held-out directory and manifest path of a task set, under the repository at root. Without kind, a set named by a
 *  directory tasks/repo/<name>/ is a repo set and every other set is a multiuser set (set names are unique across kinds). */
export function heldoutSet(name = DEFAULT_SET, root = ROOT, kind?: SetKind): HeldoutSet {
  const k: SetKind = kind ?? (name !== DEFAULT_SET && existsSync(join(root, 'tasks', 'repo', name)) ? 'repo' : 'multiuser');
  if (k === 'repo') {
    const dir = join(root, 'tasks', 'repo', name, 'heldout');
    return { name, root, kind: k, dir, manifest: join(dir, 'MANIFEST.json'), tree: join(root, 'tasks', 'repo', name, 'released') };
  }
  const multiuser = join(root, 'tasks', 'multiuser');
  const dir = name === DEFAULT_SET ? join(multiuser, 'heldout') : join(multiuser, name, 'heldout');
  return { name, root, kind: k, dir, manifest: join(dir, 'MANIFEST.json'), tree: dir };
}

/** Every task set with a held-out tree: v0.1, each tasks/multiuser/<set>/heldout and each tasks/repo/<set>/heldout that
 *  exists. A name used by both kinds is listed once per kind, so --check reports it (setNameProblems). */
export function heldoutSets(root = ROOT): HeldoutSet[] {
  const named = (base: string, skip: string[]) => (existsSync(base) ? readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !skip.includes(d.name) && existsSync(join(base, d.name, 'heldout'))).map((d) => d.name).sort() : []);
  const multiuser = join(root, 'tasks', 'multiuser');
  const mu = existsSync(multiuser) ? [heldoutSet(DEFAULT_SET, root, 'multiuser'), ...named(multiuser, ['dev', 'heldout', '_shared']).map((n) => heldoutSet(n, root, 'multiuser'))] : [];
  return [...mu, ...named(join(root, 'tasks', 'repo'), []).map((n) => heldoutSet(n, root, 'repo'))];
}

/** Set names used by more than one kind under root (tasks/multiuser/<set> and tasks/repo/<set>): set names are unique
 *  across kinds, since every custody path, ledger row and preregistration names a set by name alone. */
export function setNameProblems(root = ROOT): string[] {
  const dirs = (base: string, skip: string[]) => (existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip.includes(d.name)).map((d) => d.name) : []);
  const repo = new Set(dirs(join(root, 'tasks', 'repo'), []));
  return [...new Set([DEFAULT_SET, ...dirs(join(root, 'tasks', 'multiuser'), ['dev', 'heldout', '_shared'])])].filter((n) => repo.has(n)).sort()
    .map((n) => `set name ${n} is used by tasks/multiuser/ and tasks/repo/; set names are unique across kinds, so rename one`);
}

/** sha256 of nothing: the corpus digest of a set sealed without corpus pages, which two unrelated sets can share. */
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

/** A held-out MANIFEST.json that exists but does not parse, or parses to something the custody guards cannot read
 *  (manifestReadProblem). Every guard counts its set as live, so a broken manifest never hides a sealed set. */
export interface UnreadableManifest { unreadable: string }
export type ManifestEntry = HeldoutManifest | UnreadableManifest;
export const isUnreadable = (m: ManifestEntry | undefined): m is UnreadableManifest => typeof (m as UnreadableManifest | undefined)?.unreadable === 'string';

/** Why parsed manifest JSON is not readable by the custody guards (not an object, a custody other than "sealed", no sealed
 *  block, a sealed block without custody "sealed", a sealed or released digest that is not a sha256, a multiuser set in sealed custody without both a world slice and
 *  a corpus digest, an unknown status, a replaced_by that is not a set name), or undefined. Every other check of the manifest is seal-heldout.ts --check's. */
export function manifestReadProblem(m: unknown): string | undefined {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'it is not a JSON object';
  const x = m as Record<string, unknown>;
  if (x.custody !== undefined && x.custody !== 'sealed') return 'custody is not "sealed" or absent';
  if (x.custody === 'sealed' && x.sealed === undefined) return 'custody is "sealed" but it has no sealed block';
  if (x.custody !== 'sealed' && x.sealed !== undefined) return 'it has a sealed block but custody is not "sealed"; a released set keeps its commitments under released';
  for (const k of ['sealed', 'released'] as const) {
    const b = x[k];
    if (b === undefined) continue;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return `${k} is not an object`;
    for (const d of ['bundle_sha256', 'world_slice_sha256', 'heldout_corpus_sha256']) {
      const v = (b as Record<string, unknown>)[d];
      if (v !== undefined && v !== null && !(typeof v === 'string' && HEX64.test(v))) return `${k}.${d} is not a sha256`;
    }
  }
  if (x.custody === 'sealed' && x.kind !== 'repo' && !['world_slice_sha256', 'heldout_corpus_sha256'].every((d) => typeof (x.sealed as Record<string, unknown>)[d] === 'string')) return 'sealed lacks world_slice_sha256 or heldout_corpus_sha256; a multiuser set in sealed custody commits to both its world slice and its corpus';
  if (x.status !== undefined && !(SET_STATUSES as readonly unknown[]).includes(x.status)) return `status is not one of ${SET_STATUSES.join(', ')}`;
  if (x.replaced_by !== undefined && !(typeof x.replaced_by === 'string' && SET_NAME.test(x.replaced_by))) return 'replaced_by is not a set name';
  return undefined;
}

/** A manifest's text as the custody guards read it; null text (a file that could not be read) is unreadable too. */
export function parseManifest(text: string | null): ManifestEntry {
  if (text === null) return { unreadable: 'it could not be read' };
  let m: unknown;
  try { m = JSON.parse(text); } catch { return { unreadable: 'it is not JSON' }; }
  const problem = manifestReadProblem(m);
  return problem ? { unreadable: problem } : (m as HeldoutManifest);
}

/** The set's manifest as the custody guards read it: undefined when there is no MANIFEST.json. */
export function manifestEntry(set: HeldoutSet): ManifestEntry | undefined {
  if (!existsSync(set.manifest)) return undefined;
  try { return parseManifest(readFileSync(set.manifest, 'utf8')); } catch { return { unreadable: 'it could not be read' }; }
}

/** Every held-out set under root that has a MANIFEST.json, by name, readable or not. */
export function manifestEntries(root = ROOT): Map<string, ManifestEntry> {
  return new Map(heldoutSets(root).flatMap((s): [string, ManifestEntry][] => { const m = manifestEntry(s); return m ? [[s.name, m]] : []; }));
}

/** The set a repository path names when it is a held-out MANIFEST.json (tasks/multiuser/heldout/ is v0.1), else undefined. */
export function manifestSetName(path: string): string | undefined {
  const m = /^tasks\/(?:multiuser\/(?:([^/]+)\/)?|repo\/([^/]+)\/)heldout\/MANIFEST\.json$/.exec(path);
  if (!m || ['dev', 'heldout', '_shared'].includes(m[1] ?? '')) return undefined;
  return m[1] ?? m[2] ?? DEFAULT_SET;
}

/** Whether a set in sealed custody stops protecting what it shares: only when it is retired as a replaced set, naming its
 *  successor in replaced_by (a released set has left sealed custody). */
const retiredAsReplaced = (m: HeldoutManifest) => m.status === 'retired' && typeof m.replaced_by === 'string';

/**
 * The other sets that keep set name from an opening or a release, each as its name, or as its name and the reason in
 * parentheses when it does not share a digest; callers name the set by the label's first word.
 *  - A set in sealed custody, not retired, whose world slice or corpus digest equals one of name's (sealed or released),
 *    the digest of nothing aside: a reseal such as v0.3-gen6 shares its slice, corpus and unchanged tasks with the retired
 *    set it replaces.
 *  - A set in name's replaced_by chain that is in sealed custody and not retired as a replaced set, whatever its digests:
 *    a later reseal can change the slice and keep the task bodies. A chain that names a set with no manifest, or loops,
 *    counts too.
 *  - Any other set whose MANIFEST.json does not parse or validate (fail closed).
 */
export function liveSharersAmong(name: string, manifests: Map<string, ManifestEntry>): string[] {
  const digests = (m: ManifestEntry | undefined) => {
    if (!m || isUnreadable(m)) return [];
    const s = (m.sealed ?? (m as { released?: SealedCommitments }).released) as Partial<SealedCommitments> | undefined;
    return [s?.world_slice_sha256, s?.heldout_corpus_sha256].filter((d): d is string => typeof d === 'string' && d.length > 0 && d !== EMPTY_SHA256);
  };
  const mine = new Set(digests(manifests.get(name)));
  const out = new Map<string, string>();
  for (const [n, m] of manifests) {
    if (n === name) continue;
    if (isUnreadable(m)) out.set(n, `${n} (its MANIFEST.json does not parse or validate: ${m.unreadable}; it counts as live until it does)`);
    else if (m.custody === 'sealed' && m.status !== 'retired' && digests(m).some((d) => mine.has(d))) out.set(n, n);
  }
  const own = manifests.get(name);
  if (isUnreadable(own)) out.set(name, `${name} (its own MANIFEST.json does not parse or validate: ${own.unreadable}; it counts as live until it does)`);
  const seen = new Set([name]);
  for (let n = own && !isUnreadable(own) ? own.replaced_by : undefined; n !== undefined;) {
    if (seen.has(n)) { if (!out.has(n)) out.set(n, `${n} (${name}'s replaced_by chain loops)`); break; }
    seen.add(n);
    const m = manifests.get(n);
    if (!m) { out.set(n, `${n} (${name}'s replaced_by chain names it, and it has no manifest)`); break; }
    if (isUnreadable(m)) break;
    if (m.custody === 'sealed' && !retiredAsReplaced(m) && !out.has(n)) out.set(n, `${n} (${name}'s replaced_by chain names it)`);
    n = m.replaced_by;
  }
  return [...out.values()].sort();
}

/** Whether a liveSharersAmong list for set counts set itself because its own manifest does not parse or validate. */
export const ownUnreadable = (set: string, live: string[]): boolean => live.some((l) => l.startsWith(`${set} (its own MANIFEST.json`));

/** The set a refusal names to use instead: the first live sharer that shares a digest (its label is its set name) or that a
 *  replaced_by chain names, or undefined when none is. A set with no manifest, a chain that loops and a manifest that does
 *  not parse or validate are never a target. */
export const liveTarget = (live: string[]): string | undefined => live.map((l) => /^([a-z0-9][a-z0-9.-]*)(?: \([a-z0-9][a-z0-9.-]*'s replaced_by chain names it\))?$/.exec(l)?.[1]).find((t) => t !== undefined);

export function liveSharers(name: string, root = ROOT): string[] {
  return liveSharersAmong(name, manifestEntries(root));
}

/**
 * --check across sets, on one tree: replaced_by names another set with a manifest, never loops, and sits only on a retired
 * set; and a set in sealed custody that is retired names its successor in replaced_by (release.ts turns a released set into
 * a plaintext manifest with a released block, so a sealed set reaches retired no other way).
 */
export function replacementProblems(manifests: Map<string, ManifestEntry>): string[] {
  const problems: string[] = [];
  const next = (n: string) => { const m = manifests.get(n); return m && !isUnreadable(m) ? m.replaced_by : undefined; };
  for (const [n, m] of manifests) {
    if (isUnreadable(m)) continue;
    if (m.custody === 'sealed' && m.status === 'retired' && m.replaced_by === undefined) problems.push(`set ${n} is in sealed custody and retired with no replaced_by; a sealed set retires only through scripts/sealed/release.ts, which writes a released block, or as a replaced set that names its successor in replaced_by`);
    if (m.replaced_by === undefined) continue;
    if (m.status !== 'retired') problems.push(`set ${n}: replaced_by sits only on a retired set (status is ${m.status ?? 'absent'})`);
    if (!manifests.has(m.replaced_by)) { problems.push(`set ${n}: replaced_by names ${m.replaced_by}, which has no held-out manifest`); continue; }
    const path = [n];
    for (let x = next(n); x !== undefined && manifests.has(x); x = next(x)) {
      if (x === n) { problems.push(`set ${n}: the replaced_by chain loops (${[...path, n].join(' -> ')})`); break; }
      if (path.includes(x)) break;
      path.push(x);
    }
  }
  return problems;
}

const STATUS_STEPS: Record<string, string[]> = { open: ['open', 'spent', 'retired'], spent: ['spent', 'retired'], retired: ['retired'] };

/**
 * --check against the base branch, for every set the base holds in sealed custody: its status goes open -> spent -> retired
 * or open -> retired and never leaves spent or retired; it leaves sealed custody only with the released block release.ts
 * writes (released bundle, world slice and corpus digests equal to the base's sealed ones, and the base's tree_sha256, so
 * the plaintext tree --check compares is the one sealed); while it stays in sealed custody its sealed bundle, world slice
 * and corpus digests and its tree_sha256 never change; replaced_by never changes once set, and is set only to a set that is
 * in sealed custody and not retired on the base and in the head (a live reseal already on the base); its manifest stays. A
 * base manifest that does not parse or validate fails closed.
 */
export function statusTransitionProblems(base: Map<string, ManifestEntry>, head: Map<string, ManifestEntry>): string[] {
  const problems: string[] = [];
  for (const [n, b] of base) {
    if (isUnreadable(b)) { problems.push(`set ${n}: its MANIFEST.json on the base does not parse or validate (${b.unreadable}), so the status check cannot compare it and fails closed`); continue; }
    if (b.custody !== 'sealed') continue;
    const h = head.get(n);
    if (!h) { problems.push(`set ${n}: its MANIFEST.json is gone; a sealed set's manifest stays`); continue; }
    if (isUnreadable(h)) { problems.push(`set ${n}: its MANIFEST.json does not parse or validate (${h.unreadable}), so the status check cannot compare it and fails closed`); continue; }
    if (b.status !== undefined && !STATUS_STEPS[b.status]!.includes(h.status as string)) problems.push(`set ${n}: status went ${b.status} -> ${h.status ?? 'absent'}; a sealed set goes open -> spent -> retired or open -> retired and never leaves spent or retired`);
    const rel = (h as { released?: Partial<SealedCommitments> }).released;
    const changed = h.custody !== 'sealed' ? [] : [...(['bundle_sha256', 'world_slice_sha256', 'heldout_corpus_sha256'] as const).filter((k) => (h.sealed?.[k] ?? null) !== (b.sealed?.[k] ?? null)).map((k) => `sealed.${k}`), ...(h.tree_sha256 !== b.tree_sha256 ? ['tree_sha256'] : [])];
    if (changed.length) problems.push(`set ${n}: its sealed commitments (${changed.join(', ')}) changed while it stays in sealed custody; they never change once sealed`);
    if (h.custody !== 'sealed' && !(rel && (['bundle_sha256', 'world_slice_sha256', 'heldout_corpus_sha256'] as const).every((k) => (rel[k] ?? null) === (b.sealed?.[k] ?? null)) && h.tree_sha256 === b.tree_sha256)) problems.push(`set ${n} left sealed custody without the released block scripts/sealed/release.ts writes (released bundle, world slice and corpus digests equal to the base's sealed ones, and the base's tree_sha256)`);
    if (b.replaced_by !== undefined && h.replaced_by !== b.replaced_by) problems.push(`set ${n}: replaced_by changed from ${b.replaced_by} to ${h.replaced_by ?? 'absent'}; it never changes once set`);
    if (b.replaced_by === undefined && h.replaced_by !== undefined) {
      const live = (t: ManifestEntry | undefined) => !!t && !isUnreadable(t) && t.custody === 'sealed' && t.status !== 'retired';
      if (!live(head.get(h.replaced_by))) problems.push(`set ${n}: replaced_by newly names ${h.replaced_by}, which is not in sealed custody or is retired; a set is retired as replaced only by a live reseal`);
      else if (!live(base.get(h.replaced_by))) problems.push(`set ${n}: replaced_by newly names ${h.replaced_by}, which the base does not hold in sealed custody and not retired; a set is retired as replaced only by a live reseal that is already on the base`);
    }
  }
  return problems;
}

/** The held-out manifests at the merge base of HEAD with origin/main (or main), as runner/heldout/openings.ts finds the
 *  base, and the text of sealed/backups.json there (null when the base has none); throws when git cannot name or read it. */
export function baseManifests(root = ROOT): { manifests: Map<string, ManifestEntry>; backups: string | null } {
  const g = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const mainRef = ['refs/remotes/origin/main', 'refs/heads/main'].find((r) => { try { g(['rev-parse', '--verify', '--quiet', r]); return true; } catch { return false; } });
  if (!mainRef) throw new Error('no origin/main or main');
  const base = g(['merge-base', 'HEAD', mainRef]).trim();
  const out = new Map<string, ManifestEntry>();
  for (const p of g(['ls-tree', '-r', '--name-only', base, '--', 'tasks']).split('\n')) {
    const name = manifestSetName(p);
    if (name) out.set(name, parseManifest(g(['show', `${base}:${p}`])));
  }
  return { manifests: out, backups: g(['ls-tree', '--name-only', base, '--', BACKUPS_FILE]).trim() ? g(['show', `${base}:${BACKUPS_FILE}`]) : null };
}

/** sealed/backups.json is append-only: every entry of the base's file (base null: no file, nothing to compare) is still in
 *  the head's file (head null: no file) with the same set, sha256 and what. A base file that does not parse fails closed. */
export function backupsAppendProblems(base: string | null, head: string | null): string[] {
  if (base === null) return [];
  const list = (text: string) => { try { const d = JSON.parse(text); return Array.isArray(d?.backups) ? (d.backups as Array<Partial<BackupCommitment> | null>) : undefined; } catch { return undefined; } };
  const was = list(base);
  if (!was) return [`${BACKUPS_FILE} on the base does not parse as a list of backups, so the append-only check cannot compare it and fails closed`];
  const now = head === null ? [] : list(head);
  if (!now) return [`${BACKUPS_FILE} does not parse as a list of backups, so the append-only check cannot compare it with the base and fails closed`];
  return was.filter((b) => !now.some((h) => h?.set === b?.set && h?.sha256 === b?.sha256 && h?.what === b?.what))
    .map((b) => `${BACKUPS_FILE}: the base's entry for set ${b?.set ?? 'absent'} (sha256 ${String(b?.sha256 ?? 'absent').slice(0, 12)}) is gone or changed; the file is append-only, so every entry stays as it was`);
}

/** replacementProblems on the work tree, and statusTransitionProblems and backupsAppendProblems against the base branch; a
 *  base that cannot be read is a problem (fail closed). */
export function governanceProblems(root = ROOT): string[] {
  const head = manifestEntries(root);
  let base: ReturnType<typeof baseManifests>;
  try { base = baseManifests(root); } catch { return [...replacementProblems(head), "the status check could not read the base branch's manifests (no origin/main or main, or no merge base with HEAD); it fails closed. Fetch main (git fetch origin main) and run it again"]; }
  const backups = join(root, BACKUPS_FILE);
  return [...replacementProblems(head), ...statusTransitionProblems(base.manifests, head), ...backupsAppendProblems(base.backups, existsSync(backups) ? readFileSync(backups, 'utf8') : null)];
}

/** The public record of which backup each set was sealed from (seal.ts --from-backup appends to it). */
export const BACKUPS_FILE = 'sealed/backups.json';
export interface BackupCommitment { set: string; sha256: string; what: string }

/** Problems of sealed/backups.json's text (null: no file, which records nothing), against the sets that have a manifest:
 *  schema_version 1, a list of { set, sha256, what } naming such a set, 64 lowercase hex characters, a reason, and each
 *  backup recorded once. */
export function backupsProblems(text: string | null, sets: Set<string>): string[] {
  if (text === null) return [];
  let doc: { schema_version?: unknown; backups?: unknown };
  try { doc = JSON.parse(text); } catch { return [`${BACKUPS_FILE} does not parse as JSON`]; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${BACKUPS_FILE} is not a JSON object`];
  const problems: string[] = [];
  if (doc.schema_version !== 1) problems.push(`${BACKUPS_FILE}: schema_version is not 1`);
  if (!Array.isArray(doc.backups)) return [...problems, `${BACKUPS_FILE}: backups is not a list`];
  const seen = new Set<string>();
  for (const [i, b] of (doc.backups as Array<Partial<BackupCommitment> | null>).entries()) {
    const at = `${BACKUPS_FILE}: backups[${i}]`;
    if (!(typeof b?.set === 'string' && sets.has(b.set))) problems.push(`${at}: set ${JSON.stringify(b?.set)} names no held-out set with a manifest`);
    if (!(typeof b?.sha256 === 'string' && HEX64.test(b.sha256))) problems.push(`${at}: sha256 is not 64 lowercase hex characters`);
    else if (seen.has(b.sha256)) problems.push(`${at}: sha256 ${b.sha256.slice(0, 12)} is recorded twice; a backup belongs to one set`);
    else seen.add(b.sha256);
    if (!(typeof b?.what === 'string' && b.what.trim())) problems.push(`${at}: what is missing (say which backup it is and how the set was sealed from it)`);
  }
  return problems;
}

/** The commitments in sealed/backups.json's text on main (none when there is no file); refused (HE-SEALED-006) when it does
 *  not parse, is not well formed or records one sha256 more than once, since a backup is bound to a set by it. */
export function recordedBackups(text: string | null): BackupCommitment[] {
  if (text === null) return [];
  let doc: { backups?: unknown };
  try { doc = JSON.parse(text); } catch { throw new RunnerError('HE-SEALED-006', `${BACKUPS_FILE} on main does not parse as JSON; nothing binds a backup to a set until it does. Nothing was decrypted`); }
  const list = Array.isArray(doc?.backups) ? (doc.backups as Array<Partial<BackupCommitment> | null>) : null;
  if (!list || !list.every((b) => typeof b?.set === 'string' && typeof b.sha256 === 'string' && HEX64.test(b.sha256))) throw new RunnerError('HE-SEALED-006', `${BACKUPS_FILE} on main is not a list of { set, sha256, what }; nothing binds a backup to a set until it is. Nothing was decrypted`);
  const twice = list.map((b) => b!.sha256!).find((s, i, all) => all.indexOf(s) !== i);
  if (twice) throw new RunnerError('HE-SEALED-006', `${BACKUPS_FILE} on main records sha256 ${twice.slice(0, 12)} more than once; a backup belongs to one set, so nothing binds it until it is recorded once. Nothing was decrypted`);
  return list as BackupCommitment[];
}

/** The openings ledger of a manifest, or undefined when the set has none yet. */
export function openingsLedger(m: HeldoutManifest | undefined): OpeningsLedger | undefined {
  if (!m || m.opening_budget === undefined) return undefined;
  return { opening_budget: m.opening_budget, alpha_per_opening: m.alpha_per_opening!, status: m.status!, openings: m.openings ?? [], exposures: m.exposures ?? [] };
}

/** Shape problems of a manifest's openings ledger, empty when it has none or it is well formed. */
export function ledgerProblems(m: HeldoutManifest): string[] {
  const present = LEDGER_KEYS.filter((k) => m[k] !== undefined);
  if (!present.length) return [];
  const problems: string[] = [];
  for (const k of LEDGER_KEYS) if (m[k] === undefined) problems.push(`openings ledger: ${k} is missing (a ledger has all of ${LEDGER_KEYS.join(', ')})`);
  if (m.opening_budget !== undefined && !(Number.isInteger(m.opening_budget) && m.opening_budget >= 0)) problems.push(`openings ledger: opening_budget must be a whole number >= 0 (got ${JSON.stringify(m.opening_budget)})`);
  if (m.alpha_per_opening !== undefined && !(typeof m.alpha_per_opening === 'number' && m.alpha_per_opening > 0 && m.alpha_per_opening < 1)) problems.push(`openings ledger: alpha_per_opening must be between 0 and 1 (got ${JSON.stringify(m.alpha_per_opening)})`);
  if (m.status !== undefined && !(SET_STATUSES as readonly string[]).includes(m.status)) problems.push(`openings ledger: status must be one of ${SET_STATUSES.join(', ')} (got ${JSON.stringify(m.status)})`);
  const seen = new Set<string>();
  for (const [i, row] of (Array.isArray(m.openings) ? m.openings : []).entries()) {
    const at = `openings[${i}] (${row?.run_id ?? 'no run_id'})`;
    if (typeof row?.run_id !== 'string' || !row.run_id) { problems.push(`openings ledger: ${at}: run_id is missing`); continue; }
    if (seen.has(row.run_id)) problems.push(`openings ledger: ${at}: run_id appears twice`);
    seen.add(row.run_id);
    if (!(OPENING_STATUSES as readonly string[]).includes(row.status)) problems.push(`openings ledger: ${at}: status must be one of ${OPENING_STATUSES.join(', ')} (got ${JSON.stringify(row.status)})`);
    if (!(OPENING_LABELS as readonly string[]).includes(row.label)) problems.push(`openings ledger: ${at}: label must be one of ${OPENING_LABELS.join(', ')} (got ${JSON.stringify(row.label)})`);
    const needsReason = row.label === 'dev' || row.status === 'withdrawn' || row.status === 'superseded';
    if (needsReason && !(typeof row.reason === 'string' && row.reason.trim())) problems.push(`openings ledger: ${at}: a ${row.label === 'dev' ? 'dev' : row.status} row needs a reason`);
    if (row.candidate_sha256 !== null && !(typeof row.candidate_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.candidate_sha256))) problems.push(`openings ledger: ${at}: candidate_sha256 must be 64 hex characters or null (got ${JSON.stringify(row.candidate_sha256)})`);
  }
  if (m.openings !== undefined && !Array.isArray(m.openings)) problems.push('openings ledger: openings must be a list');
  for (const [i, e] of (Array.isArray(m.exposures) ? m.exposures : []).entries()) {
    for (const k of ['date', 'kind', 'recipient', 'what', 'source'] as const) if (!(typeof e?.[k] === 'string' && e[k].trim())) problems.push(`openings ledger: exposures[${i}]: ${k} is missing`);
    if (typeof e?.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`openings ledger: exposures[${i}]: date must be YYYY-MM-DD (got ${e.date})`);
  }
  if (m.exposures !== undefined && !Array.isArray(m.exposures)) problems.push('openings ledger: exposures must be a list');
  return problems;
}

export const HELDOUT_DIR = heldoutSet().dir;
export const MANIFEST_PATH = heldoutSet().manifest;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (statSync(p).isFile()) out.push(p);
  }
  return out;
}

/** The task directories under a held-out tree (those with a task.toml). */
export function heldoutTasks(set: HeldoutSet = heldoutSet()): string[] {
  if (!existsSync(set.tree)) return [];
  return readdirSync(set.tree, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(set.tree, d.name, 'task.toml'))).map((d) => d.name).sort();
}

/** sha256 of every file under dir (relative path to digest, in walk order), and the tree digest over them: the digest a
 *  held-out MANIFEST.json records as tree_sha256. `skip` leaves one absolute path out (the manifest itself). */
export function treeFiles(dir: string, skip?: string): { files: Record<string, string>; tree_sha256: string } {
  const files: Record<string, string> = {};
  for (const p of existsSync(dir) ? walk(dir) : []) {
    if (p === skip) continue;
    files[relative(dir, p)] = sha256(readFileSync(p));
  }
  return { files, tree_sha256: sha256(Object.entries(files).map(([k, v]) => `${v}  ${k}`).join('\n')) };
}

export const isSealed = (m: HeldoutManifest | undefined): boolean => m?.custody === 'sealed';

/** The world manifest of the set's repository, which a multiuser set records; a repo set never reads it. */
const worldManifestOf = (set: HeldoutSet): string => (set.root ? join(set.root, 'world', 'seed', 'MANIFEST.json') : WORLD_MANIFEST);

/** Problems of a sealed set's manifest and tree, keyless: the commitments are present and well formed, the public manifest
 *  names no file or task, and the held-out directory holds nothing but MANIFEST.json. */
export function sealedProblems(m: HeldoutManifest, set: HeldoutSet): string[] {
  const problems: string[] = [];
  const hex = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const s = m.sealed;
  if (!s || typeof s !== 'object') return ['custody is "sealed" but the manifest has no "sealed" block of commitments (scripts/sealed/seal.ts writes it)'];
  if (set.kind === 'repo') {
    if (!hex(s.bundle_sha256)) problems.push(`sealed.bundle_sha256 must be 64 hex characters (got ${JSON.stringify(s.bundle_sha256)})`);
    for (const k of ['world_slice_sha256', 'heldout_corpus_sha256'] as const) if (s[k] !== null) problems.push(`sealed.${k} must be null for a repo set, which has no world slice and no corpus pages (got ${JSON.stringify(s[k])})`);
    if (!(typeof s.null_digests === 'string' && s.null_digests.trim())) problems.push('sealed.null_digests must say why a repo set records world_slice_sha256 and heldout_corpus_sha256 as null (scripts/sealed/seal.ts writes it)');
    if (s.generator_sha256 !== null && !hex(s.generator_sha256)) problems.push(`sealed.generator_sha256 must be 64 hex characters, or null when the bundle has no generator/ (got ${JSON.stringify(s.generator_sha256)})`);
    if (m.world_manifest_sha256 !== null || m.world_json_sha256 !== null) problems.push('world_manifest_sha256 and world_json_sha256 must be null for a repo set, which has no world');
    const released = existsSync(set.tree) ? walk(set.tree) : [];
    if (released.length) problems.push(`released files of a sealed set: ${released.length} file(s) under ${relative(ROOT, set.tree)}; a sealed repo set's tasks live only in the encrypted bundle until release`);
  } else for (const k of ['bundle_sha256', 'world_slice_sha256', 'heldout_corpus_sha256'] as const) if (!hex(s[k])) problems.push(`sealed.${k} must be 64 hex characters (got ${JSON.stringify(s[k])})`);
  if (!hex(m.tree_sha256)) problems.push(`tree_sha256 must be the 64-hex digest of the plaintext tree at sealing (got ${JSON.stringify(m.tree_sha256)})`);
  if (!(Number.isInteger(s.task_count) && s.task_count > 0)) problems.push(`sealed.task_count must be a whole number above 0 (got ${JSON.stringify(s.task_count)})`);
  if (!(typeof s.recipient === 'string' && /^age1[0-9a-z]+$/.test(s.recipient))) problems.push('sealed.recipient must be a public age recipient (age1...)');
  if (!(typeof s.custody_repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s.custody_repo))) problems.push(`sealed.custody_repo must be owner/repo (got ${JSON.stringify(s.custody_repo)})`);
  if (s.custody_ref !== 'refs/heads/custody') problems.push(`sealed.custody_ref must be refs/heads/custody, the custody branch, never the public main (got ${JSON.stringify(s.custody_ref)})`);
  if (!(typeof s.bundle === 'string' && s.bundle.endsWith('.age') && !s.bundle.startsWith('/') && !s.bundle.split('/').includes('..'))) problems.push(`sealed.bundle must be a relative path ending in .age on the custody branch (got ${JSON.stringify(s.bundle)})`);
  if (s.extras !== undefined && !(s.extras && typeof s.extras === 'object' && !Array.isArray(s.extras) && Object.entries(s.extras).every(([p, h]) => /^extras\/[\x20-\x7e]+$/.test(p) && !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') && hex(h)))) problems.push('sealed.extras must map bundle paths under extras/ to 64-hex sha256 digests');
  if (Object.keys(m.files ?? {}).length || (m.tasks ?? []).length) problems.push('a sealed manifest lists no files and no tasks (files {} and tasks []); the names are part of the sealed bundle');
  const plaintext = (existsSync(set.dir) ? walk(set.dir) : []).filter((p) => p !== set.manifest);
  if (plaintext.length) problems.push(`plaintext in a sealed set: ${plaintext.length} file(s) beside MANIFEST.json under ${relative(ROOT, set.dir)}; a sealed set's tasks live only in the encrypted bundle`);
  return problems;
}

/** The manifest the current tree would produce; `generated_at` is taken from `previous` when the content is unchanged. */
export function buildManifest(previous?: HeldoutManifest, set: HeldoutSet = heldoutSet()): HeldoutManifest {
  const { files, tree_sha256: tree } = treeFiles(set.tree, set.manifest);
  const repo = set.kind === 'repo';
  const worldManifest = repo ? null : readFileSync(worldManifestOf(set), 'utf8');
  const worldManifestSha = worldManifest === null ? null : sha256(worldManifest);
  const worldJsonSha = worldManifest === null ? null : (JSON.parse(worldManifest) as { world_json_sha256?: string }).world_json_sha256 ?? '';
  const tasks = [...new Set(Object.keys(files).map((f) => f.split('/')[0]!))].filter((d) => files[`${d}/task.toml`]);
  const unchanged = previous && previous.tree_sha256 === tree && previous.world_manifest_sha256 === worldManifestSha;
  const ledger = Object.fromEntries(LEDGER_KEYS.filter((k) => previous?.[k] !== undefined).map((k) => [k, previous![k]]));
  return {
    schema_version: 1,
    ...(repo ? { kind: 'repo' as const } : {}),
    generated_at: unchanged ? previous.generated_at : new Date().toISOString(),
    world_manifest_sha256: worldManifestSha,
    world_json_sha256: worldJsonSha,
    tasks,
    files,
    tree_sha256: tree,
    ...ledger,
  };
}

export function readManifest(set: HeldoutSet = heldoutSet()): HeldoutManifest | undefined {
  try {
    return JSON.parse(readFileSync(set.manifest, 'utf8')) as HeldoutManifest;
  } catch {
    return undefined;
  }
}

/** Differences between the committed manifest and the tree, empty when sealed. A tree that holds tasks but no
 *  manifest is unsealed and is a problem; a set with no held-out tree at all is not. */
export function manifestProblems(set: HeldoutSet = heldoutSet()): string[] {
  const committed = readManifest(set);
  const rel = relative(ROOT, set.manifest);
  const stray = set.kind === 'repo' ? (existsSync(set.dir) ? walk(set.dir) : []).filter((p) => p !== set.manifest) : [];
  const strayProblem = `plaintext in a repo set's held-out directory: ${stray.length} file(s) beside MANIFEST.json under ${relative(ROOT, set.dir)}; a repo set's held-out tree exists only inside custody (scripts/sealed/seal.ts --kind repo), and a released one lives in ${relative(ROOT, set.tree)}`;
  if (!committed && existsSync(set.manifest)) {
    const entry = manifestEntry(set);
    return [`${relative(set.root, set.manifest)} does not parse or validate: ${isUnreadable(entry) ? entry.unreadable : 'it is not JSON'}`];
  }
  if (!committed) {
    if (set.kind === 'repo') return [...(stray.length ? [strayProblem] : []), `${rel} is missing; a repo set's manifest is written by scripts/sealed/seal.ts --kind repo`];
    const n = heldoutTasks(set).length;
    return n ? [`unsealed: ${relative(ROOT, set.dir)} (${n} tasks) has no MANIFEST.json; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`] : [`${rel} is missing; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`];
  }
  if (committed.custody !== undefined && committed.custody !== 'sealed') return [`custody must be "sealed" or absent (got ${JSON.stringify(committed.custody)})`];
  const readProblem = manifestReadProblem(committed);
  if (readProblem) return [`${relative(set.root, set.manifest)} does not parse or validate: ${readProblem}`];
  const kind = committed.kind ?? 'multiuser';
  if (kind !== set.kind) return [`kind is ${JSON.stringify(committed.kind ?? null)}, but the manifest sits under tasks/${set.kind}/; a ${set.kind} set's manifest says ${set.kind === 'repo' ? '"kind": "repo"' : 'no kind, or "kind": "multiuser"'}`];
  if (isSealed(committed)) {
    const problems = sealedProblems(committed, set);
    if (set.kind === 'multiuser' && committed.world_manifest_sha256 !== sha256(readFileSync(worldManifestOf(set), 'utf8'))) problems.push('world/seed/MANIFEST.json changed since sealing (the sealed slice is merged into the public world when a set is opened)');
    return [...problems, ...ledgerProblems(committed)];
  }
  const current = buildManifest(committed, set);
  const problems: string[] = stray.length ? [strayProblem] : [];
  for (const [f, h] of Object.entries(current.files)) {
    if (!committed.files[f]) problems.push(`${f}: not in the manifest`);
    else if (committed.files[f] !== h) problems.push(`${f}: sha256 changed`);
  }
  for (const f of Object.keys(committed.files)) if (!current.files[f]) problems.push(`${f}: in the manifest but not in the tree`);
  if (committed.world_manifest_sha256 !== current.world_manifest_sha256) problems.push(set.kind === 'repo' ? 'world_manifest_sha256 must be null for a repo set, which has no world' : 'world/seed/MANIFEST.json changed since sealing');
  if (committed.tree_sha256 !== current.tree_sha256) problems.push('tree_sha256 differs');
  problems.push(...ledgerProblems(committed));
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--task-set');
  const setName = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !setName) { console.error('HE-TASK-SEAL: --task-set wants a set name, for example --task-set v0.2'); process.exit(1); }
  const known = heldoutSets();
  if (setName && !known.some((s) => s.name === setName)) {
    console.error(`HE-TASK-SEAL: unknown task set "${setName}"; looked for ${relative(ROOT, heldoutSet(setName).dir)}/; known sets: ${known.map((s) => s.name).join(', ')} (v0.1 is tasks/multiuser/heldout)`);
    process.exit(1);
  }
  const sets = setName ? known.filter((s) => s.name === setName) : known;
  if (argv.includes('--check')) {
    let failed = false;
    for (const p of setNameProblems()) { failed = true; console.error(`HE-TASK-SEAL: ${p}`); }
    const backups = join(ROOT, BACKUPS_FILE);
    for (const p of [...governanceProblems(), ...backupsProblems(existsSync(backups) ? readFileSync(backups, 'utf8') : null, new Set(manifestEntries().keys()))]) { failed = true; console.error(`HE-TASK-SEAL: ${p}`); }
    for (const set of sets) {
      const problems = manifestProblems(set);
      if (problems.length) {
        failed = true;
        console.error(`HE-TASK-SEAL: held-out manifest for set ${set.name} does not match the tree:\n  ` + problems.join('\n  '));
        continue;
      }
      const m = readManifest(set)!;
      const ledger = openingsLedger(m);
      const ledgerText = ledger ? `; openings ledger: status ${ledger.status}, budget ${ledger.opening_budget}, ${ledger.openings.length} rows, ${ledger.exposures.length} exposures` : '';
      if (isSealed(m)) console.log(`sealed set matches (set ${set.name}): commitments present (${m.sealed!.task_count} tasks, bundle ${m.sealed!.bundle_sha256.slice(0, 12)}, tree ${m.tree_sha256.slice(0, 12)}), no plaintext in the tree${ledgerText}`);
      else console.log(`held-out manifest matches (set ${set.name}): ${Object.keys(m.files).length} files, ${m.tasks.length} tasks${ledgerText}`);
    }
    if (failed) process.exit(1);
  } else {
    const set = sets[0]!;
    if (set.kind === 'repo') { console.error(`HE-TASK-SEAL: set ${set.name} is a repo set; its manifest is written by scripts/sealed/seal.ts --kind repo and, at release, by scripts/sealed/release.ts (docs/sealed-custody.md)`); process.exit(1); }
    if (isSealed(readManifest(set))) { console.error(`HE-TASK-SEAL: set ${set.name} is in sealed custody; its manifest is written by scripts/sealed/seal.ts from the plaintext outside the checkout (docs/sealed-custody.md)`); process.exit(1); }
    const manifest = buildManifest(readManifest(set), set);
    writeFileSync(set.manifest, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`sealed ${manifest.tasks.length} held-out tasks (set ${set.name}), ${Object.keys(manifest.files).length} files, tree ${manifest.tree_sha256.slice(0, 12)}`);
  }
}
