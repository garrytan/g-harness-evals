/**
 * Sealed custody (internal-task phase 3, docs/sealed-custody.md): the pieces the custodian's scripts (scripts/sealed/) and the
 * runner share.
 *
 * - A bundle is a reproducible tar (regular files only, sorted, mtime 0, owner 0, mode 0644) of a held-out task tree
 *   (tasks/multiuser/<set>/heldout/...), the set's world slice (world/slice.json, in world.json format: the held-out
 *   records the tasks were written against, alone or inside a whole world.json) and the corpus pages its held-out brains are built from (corpus/heldout/<slug>.md), encrypted with
 *   age (the pinned age-encryption package, typage) to the committed recipient. Unpacking refuses absolute paths, ".."
 *   segments, links, devices and duplicate entries.
 * - A sealed root is what scripts/sealed/open.ts writes outside every git checkout: the decrypted bundle plus
 *   world/world.json, the public world with its held-out records replaced by the slice (mergeWorld), and
 *   opening-receipt.json, which binds the root to one run (run id, preregistration digest, candidate hash) and to the
 *   public commitments in the set's MANIFEST.json.
 * - verifySealedRoot and receiptProblems are what runner/run.ts plan, preflight and run check before they read a sealed
 *   task or world record.
 *
 * - The bundle also holds opaque-salt, a random value written at sealing: a task's opaque id is T- and the first ten hex
 *   characters of sha256(salt, newline, task id) (opaqueId). Under a sealed root every terminal line names tasks by
 *   opaque id only (runner/heldout/guard.ts); the salt is released with the set, so the ids map back to tasks then.
 *
 * - A sealed run's gbrain image is tagged harness-eval/gbrain:sealed-<run_id> (sealedImageTag) and must carry the
 *   receipt's world and corpus digests (sealedImageProblem); a run with no sealed root refuses an image built from one
 *   (publicImageProblem), so a public run's transcripts never hold sealed brains.
 * - readJsonLines and readJsonFile parse a results file with an error that names the file, the line and the parser's
 *   error class only (HE-RUN-007): a parser's message quotes the bad input, which in raw sealed results is sealed content.
 *
 * - internal-task: a repo set (tasks/repo/<set>/, runner and scripts/seal-heldout.ts SetKind) has no world: its bundle holds the
 *   task tree at tasks/repo/<set>/heldout/, the opaque salt, an optional generator/ directory and the extras, and no world
 *   slice or corpus pages. Its root has no world/, its receipt says kind "repo" and records the world and corpus digests as
 *   null, and verifySealedRoot checks the tree, the generator and the extras only.
 *
 * Nothing here reads an environment variable; the age identity is passed in by the caller and never printed. Error
 * messages name bundle entries by position and path digest, never by path, since a path holds a task id.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Decrypter, Encrypter } from 'age-encryption';
import { RunnerError } from '../errors.ts';
import { treeFiles, type HeldoutManifest, type SetKind } from '../../scripts/seal-heldout.ts';
import type { World } from '../../world/types.ts';

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export const OPAQUE_SALT_FILE = 'opaque-salt';
export const opaqueId = (salt: string, task: string): string => `T-${sha256(`${salt}\n${task}`).slice(0, 10)}`;

// ---- tar -----------------------------------------------------------------------------------------------------------

/** exec: the file carries an executable bit (internal-task: a repo task's verify.sh, solve.sh and build scripts); packed as mode
 *  0755, else 0644. */
export interface TarEntry { path: string; data: Uint8Array; exec?: boolean }

/** A relative path a bundle may hold: forward slashes, no leading slash, no empty, "." or ".." segment, printable ASCII. */
export function safeRelPath(p: string): boolean {
  if (!p || p.length > 255 || p.startsWith('/') || p.includes('\\') || !/^[\x20-\x7e]+$/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder();

const octal = (n: number, width: number): string => n.toString(8).padStart(width - 1, '0') + '\0';

function header(path: string, size: number, exec = false): Uint8Array {
  const h = new Uint8Array(BLOCK);
  let name = path, prefix = '';
  if (path.length > 100) {
    const cut = path.lastIndexOf('/', 155);
    if (cut <= 0 || path.length - cut - 1 > 100) throw new Error(`tar: path too long for ustar: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  const put = (s: string, at: number) => h.set(enc.encode(s), at);
  put(name, 0);
  put(octal(exec ? 0o755 : 0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(0, 12), 136);
  put('        ', 148);
  put('0', 156);
  put('ustar\0', 257);
  put('00', 263);
  put(prefix, 345);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** A reproducible ustar archive of the entries, sorted by path. */
export function packTar(entries: TarEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  for (const e of sorted) {
    if (!safeRelPath(e.path)) throw new Error(`tar: unsafe path ${JSON.stringify(e.path)}`);
    if (seen.has(e.path)) throw new Error(`tar: duplicate path ${e.path}`);
    seen.add(e.path);
    parts.push(header(e.path, e.data.length, e.exec === true), e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const field = (h: Uint8Array, at: number, len: number) => { const s = dec.decode(h.subarray(at, at + len)); const nul = s.indexOf('\0'); return nul >= 0 ? s.slice(0, nul) : s; };

/** The regular files of a ustar archive. Refuses an unsafe path, a link, device or other non-regular entry, a duplicate,
 *  a bad header checksum and a truncated archive; directory entries are skipped. */
export function unpackTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  const seen = new Set<string>();
  let at = 0;
  while (true) {
    if (at + BLOCK > buf.length) throw new Error('tar: truncated archive (no end marker)');
    const h = buf.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) return out;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (parseInt(field(h, 148, 8).trim(), 8) !== sum) throw new Error('tar: header checksum mismatch');
    const prefix = field(h, 345, 155);
    const name = field(h, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(h[156]!);
    const size = parseInt(field(h, 124, 12).trim() || '0', 8);
    const which = `entry ${out.length + 1} (path sha256 ${sha256(path).slice(0, 12)})`;
    if (!Number.isFinite(size) || size < 0) throw new Error(`tar: bad size for ${which}`);
    at += BLOCK;
    if (type === '5') { at += Math.ceil(size / BLOCK) * BLOCK; continue; }
    if (type !== '0' && type !== '\0') throw new Error(`tar: ${which} is not a regular file (type ${JSON.stringify(type)}); a bundle holds regular files only`);
    if (!safeRelPath(path)) throw new Error(`tar: unsafe path in ${which}`);
    if (seen.has(path)) throw new Error(`tar: duplicate entry, ${which}`);
    seen.add(path);
    if (at + size > buf.length) throw new Error(`tar: truncated entry, ${which}`);
    const exec = (parseInt(field(h, 100, 8).trim() || '0', 8) & 0o111) !== 0;
    out.push({ path, data: buf.slice(at, at + size), ...(exec ? { exec } : {}) });
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
}

// ---- age -----------------------------------------------------------------------------------------------------------

export async function encryptTo(recipient: string, data: Uint8Array): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(recipient.trim());
  return e.encrypt(data);
}

/** Decrypt with an age identity (AGE-SECRET-KEY-1...). The error names the failure, never the identity. */
export async function decryptWith(identity: string, data: Uint8Array): Promise<Uint8Array> {
  const d = new Decrypter();
  try {
    d.addIdentity(identity.trim());
  } catch {
    throw new Error('the age identity is malformed (expected one AGE-SECRET-KEY-1... line)');
  }
  try {
    return await d.decrypt(data);
  } catch (e) {
    throw new Error(`the bundle did not decrypt: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'} (a wrong identity, or a corrupt or truncated bundle)`);
  }
}

// ---- digests -------------------------------------------------------------------------------------------------------

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * The digest of a corpus overlay directory: sha256 over "<sha256>  <relative path>\n" per file, paths in byte order.
 * It equals `cd <dir> && find . -type f -printf '%P\n' | LC_ALL=C sort | xargs -r -d '\n' sha256sum | sha256sum`, which is
 * what gbrain/Dockerfile and scripts/build-gbrain-image.sh compute, so the image can check its corpus input.
 */
export function corpusDigest(dir: string): string {
  const rels = listFiles(dir).map((p) => relative(dir, p)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return sha256(rels.map((r) => `${sha256(readFileSync(join(dir, r)))}  ${r}\n`).join(''));
}

// ---- the world slice -----------------------------------------------------------------------------------------------

export const WORLD_COLLECTIONS = ['teams', 'members', 'accounts', 'channels', 'messages', 'files', 'calendar', 'mail'] as const;
type Collection = (typeof WORLD_COLLECTIONS)[number];
/** The top-level keys of world.json that are not collections; a slice that carries them carries the public values. */
export const WORLD_META = ['world_id', 'today', 'time_zone', 'source'] as const;
type Meta = (typeof WORLD_META)[number];
type Row = { id: string; split: string };
/**
 * A sealed set's world slice, in world.json format (internal-task writes v0.3's held-out world that way, and gbrain/Dockerfile
 * builds every brain from a world.json through build-brain.ts and gbrain import). The held-out records of each collection
 * (split "heldout") are the slice. The file may be a whole world.json: its other records and its world_id, today,
 * time_zone and source must then be exactly the public world's, and they are not taken from it. A file holding only
 * some collections of held-out records is the same thing, smaller.
 */
export type WorldSlice = Partial<Record<Collection, Row[]>> & Partial<Record<Meta, unknown>>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Shape problems of a slice against the public world: only world.json's keys; meta equal to the public world's; held-out
 *  records with unique ids, none shared with a public record outside the held-out split; every other record exactly the
 *  public record of that id. */
export function sliceProblems(slice: WorldSlice, pub: World): string[] {
  const problems: string[] = [];
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return ['slice: must be a world.json-shaped object'];
  const known = [...WORLD_COLLECTIONS, ...WORLD_META] as readonly string[];
  for (const k of Object.keys(slice)) if (!known.includes(k)) problems.push(`slice: unknown key ${k} (world.json has ${known.join(', ')})`);
  const p = pub as unknown as Record<string, unknown>;
  for (const k of WORLD_META) if (k in slice && !same(slice[k], p[k])) problems.push(`slice: ${k} differs from the public world's; a slice is written against the public world`);
  for (const c of WORLD_COLLECTIONS) {
    const rows = slice[c] ?? [];
    if (!Array.isArray(rows)) { problems.push(`slice: ${c} must be a list`); continue; }
    const publicRows = new Map((pub[c] as Row[]).map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const r of rows) {
      if (typeof r?.id !== 'string' || !r.id) { problems.push(`slice: a ${c} record has no id`); continue; }
      if (seen.has(r.id)) problems.push(`slice: ${c} ${r.id} appears twice`);
      seen.add(r.id);
      const twin = publicRows.get(r.id);
      if (r.split === 'heldout') { if (twin && twin.split !== 'heldout') problems.push(`slice: ${c} ${r.id} collides with a public ${c} record outside the held-out split`); }
      else if (!twin || !same(r, twin)) problems.push(`slice: ${c} ${r.id} has split ${JSON.stringify(r.split)} and is not the public world's record; a slice adds held-out records only`);
    }
  }
  return problems;
}

/** The held-out records of a slice, by collection. */
export function sliceRecords(slice: WorldSlice): Record<Collection, Row[]> {
  return Object.fromEntries(WORLD_COLLECTIONS.map((c) => [c, (slice[c] ?? []).filter((r) => r.split === 'heldout')])) as Record<Collection, Row[]>;
}

/** The public world with every held-out record replaced by the slice's held-out records ("dev" and "both" records, and the
 *  world's meta, unchanged). */
export function mergeWorld(pub: World, slice: WorldSlice): World {
  const merged = { ...pub } as unknown as Record<string, unknown>;
  const held = sliceRecords(slice);
  for (const c of WORLD_COLLECTIONS) merged[c] = [...(pub[c] as Row[]).filter((r) => r.split !== 'heldout'), ...held[c]];
  return merged as unknown as World;
}



export const renderWorld = (w: World): string => JSON.stringify(w, null, 1) + '\n';

// ---- the sealed root and the opening receipt -----------------------------------------------------------------------

export const RECEIPT_FILE = 'opening-receipt.json';

export interface OpeningReceipt {
  schema_version: 1;
  tool: 'scripts/sealed/open.ts';
  run_id: string;
  set: string;
  label: 'confirmatory' | 'dev';
  reason: string | null;
  candidate_sha256: string;
  /** The preregistration's prereg.json, relative to the repository root, and the sha256 of its bytes. */
  prereg_json: string;
  prereg_sha256: string;
  /** The public ref and commit open.ts checked the ledger at (origin/main) and the sha256 of the set's MANIFEST.json there. */
  public_ref: string;
  public_commit: string;
  public_manifest_sha256: string;
  /** "repo" for a repo set; absent for a multiuser set (every receipt written before internal-task). */
  kind?: 'repo';
  bundle_sha256: string;
  tree_sha256: string;
  /** null for a repo set, which has no world slice and no corpus pages. */
  world_slice_sha256: string | null;
  heldout_corpus_sha256: string | null;
  /** sha256 of the public world/seed/world.json the slice was merged into, and of the merged world/world.json; null for a repo set. */
  public_world_sha256: string | null;
  world_sha256: string | null;
  /** A repo set's generator/ digest (sealed.generator_sha256), null when its bundle has none; absent for a multiuser set. */
  generator_sha256?: string | null;
  task_count: number;
  /** sealed.extras of the set (seal.ts --include), when it has any: bundle path to sha256. */
  extras?: Record<string, string>;
  /** The access-log line that first admitted this opening, the custody ref and its commit holding the latest line for this run, and whether this receipt came from a resume. */
  access: { event_sha256: string; custody_ref: string; custody_commit: string; opened_at: string; resumed: boolean };
  written_at: string;
}

/** The receipt fields that identify one opening. A resume of the same run id rewrites the others (written_at, the public
 *  commit and manifest it checked the ledger at, the custody commit, resumed), so preflight, run and export compare these. */
export const OPENING_BINDING = ['run_id', 'set', 'kind', 'label', 'candidate_sha256', 'prereg_json', 'prereg_sha256', 'bundle_sha256', 'tree_sha256', 'world_slice_sha256', 'heldout_corpus_sha256', 'public_world_sha256', 'world_sha256', 'generator_sha256', 'task_count'] as const;

/** The binding fields on which two receipts differ (empty when both describe the same opening). */
export function openingDiff(a: OpeningReceipt, b: OpeningReceipt): string[] {
  const diff: string[] = OPENING_BINDING.filter((k) => a[k] !== b[k]);
  if (a.access?.event_sha256 !== b.access?.event_sha256) diff.push('access.event_sha256');
  return diff;
}

/** The paths of an opened root. kind is "repo" for a repo set (tasks/repo/<set>/heldout, generator/, no world or corpus);
 *  without it, a root holding tasks/repo/<set>/ is taken as a repo set's root. */
export interface SealedPaths { kind: SetKind; tasks: string; slice: string; world: string; corpus: string; extras: string; generator: string; receipt: string }

export function sealedPaths(root: string, set: string, kind?: SetKind): SealedPaths {
  const k: SetKind = kind ?? (existsSync(join(root, 'tasks', 'repo', set)) ? 'repo' : 'multiuser');
  return { kind: k, tasks: join(root, 'tasks', k, set, 'heldout'), slice: join(root, 'world', 'slice.json'), world: join(root, 'world', 'world.json'), corpus: join(root, 'corpus'), extras: join(root, 'extras'), generator: join(root, 'generator'), receipt: join(root, RECEIPT_FILE) };
}

/** The kind of the set a receipt opened: "repo" when it says so, else "multiuser". */
export const receiptKind = (r: Pick<OpeningReceipt, 'kind'>): SetKind => (r.kind === 'repo' ? 'repo' : 'multiuser');

/** The first problem with a decrypted bundle's entries for a set, or null: an entry outside the set's task tree, the opaque
 *  salt, the extras the manifest lists (sealed.extras, own keys only) and, for a multiuser set, world/slice.json and
 *  corpus/heldout/, for a repo set, generator/; or extras/ files that differ from sealed.extras (one missing, or another
 *  sha256). Names no entry path. */
export function bundleEntryProblem(entries: TarEntry[], set: string, extras: Record<string, string> = {}, kind: SetKind = 'multiuser'): string | null {
  const tasks = `tasks/${kind}/${set}/heldout/`;
  const listed = (p: string) => p.startsWith('extras/') && Object.hasOwn(extras, p);
  const own = (p: string) => (kind === 'repo' ? p.startsWith('generator/') : p === 'world/slice.json' || p.startsWith('corpus/heldout/'));
  const stray = entries.find((e) => !(e.path.startsWith(tasks) || e.path === OPAQUE_SALT_FILE || own(e.path) || listed(e.path)));
  if (stray) return `the bundle holds an entry (path sha256 ${sha256(stray.path).slice(0, 12)}) outside the task tree of set ${set}, ${OPAQUE_SALT_FILE}, ${kind === 'repo' ? 'generator/' : 'world/slice.json, corpus/heldout/'} and the manifest's extras`;
  const present = entries.filter((e) => listed(e.path));
  if (present.length !== Object.keys(extras).length || present.some((e) => sha256(e.data) !== extras[e.path])) return `the bundle's extras (${present.length} listed file(s) present) do not match sealed.extras in the public manifest (${Object.keys(extras).length})`;
  return null;
}

/** Digest problems of a sealed root against its receipt and the public world in the checkout at repoRoot: the task tree,
 *  the slice, the corpus pages and the merged world must be exactly what the receipt names. */
export function verifySealedRoot(root: string, receipt: OpeningReceipt, repoRoot: string): string[] {
  const kind = receiptKind(receipt);
  const p = sealedPaths(root, receipt.set, kind);
  if (!existsSync(p.tasks) || !statSync(p.tasks).isDirectory()) return [`sealed root ${root} has no task tree for set ${receipt.set} (${relative(root, p.tasks)})`];
  const problems: string[] = [];
  const check = (what: string, got: string | null, want: string | null) => { if (got !== want) problems.push(`${what} is ${String(got).slice(0, 12)}, the opening receipt says ${String(want).slice(0, 12)}`); };
  const extrasProblem = () => {
    const extras = receipt.extras ?? {};
    const present = existsSync(p.extras) ? readdirSync(p.extras, { recursive: true, withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => relative(root, join(e.parentPath, e.name))).sort() : [];
    if (present.join('\n') !== Object.keys(extras).sort().join('\n') || present.some((k) => sha256(readFileSync(join(root, k))) !== extras[k])) problems.push(`sealed root ${root} has extras/ files (${present.length}) that do not match the opening receipt (${Object.keys(extras).length})`);
  };
  if (kind === 'repo') {
    check('the sealed task tree digest', treeFiles(p.tasks).tree_sha256, receipt.tree_sha256);
    check('the generator/ digest', existsSync(p.generator) ? corpusDigest(p.generator) : null, receipt.generator_sha256 ?? null);
    for (const d of [p.slice, p.world, p.corpus]) if (existsSync(d)) problems.push(`sealed root ${root} holds ${relative(root, d)}; a repo set has no world slice, world or corpus pages`);
    extrasProblem();
    return problems;
  }
  for (const f of [p.slice, p.world]) if (!existsSync(f)) problems.push(`sealed root ${root} has no ${relative(root, f)}`);
  if (problems.length) return problems;
  check('the sealed task tree digest', treeFiles(p.tasks).tree_sha256, receipt.tree_sha256);
  check('world/slice.json', sha256(readFileSync(p.slice)), receipt.world_slice_sha256);
  check('the corpus pages digest', corpusDigest(p.corpus), receipt.heldout_corpus_sha256);
  check('world/world.json', sha256(readFileSync(p.world)), receipt.world_sha256);
  extrasProblem();
  const pubWorld = join(repoRoot, 'world', 'seed', 'world.json');
  if (existsSync(pubWorld)) {
    const pub = readFileSync(pubWorld);
    check("the checkout's world/seed/world.json", sha256(pub), receipt.public_world_sha256);
    if (!problems.length) check('the public world merged with the slice', sha256(renderWorld(mergeWorld(JSON.parse(pub.toString('utf8')) as World, JSON.parse(readFileSync(p.slice, 'utf8')) as WorldSlice))), receipt.world_sha256);
  }
  return problems;
}

/** Problems of a receipt against the run it is used for and the set's public commitments. */
export function receiptProblems(receipt: OpeningReceipt, want: { run_id: string; prereg_sha256: string; set: string; candidate_sha256?: string; label?: string }, manifest: HeldoutManifest | undefined): string[] {
  if (receipt?.schema_version !== 1 || receipt.tool !== 'scripts/sealed/open.ts') return ['the opening receipt is not one scripts/sealed/open.ts wrote (schema_version 1)'];
  const problems: string[] = [];
  const eq = (what: string, got: unknown, exp: unknown) => { if (got !== exp) problems.push(`${what}: the opening receipt says ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); };
  eq('run_id', receipt.run_id, want.run_id);
  eq('set', receipt.set, want.set);
  eq('prereg_sha256 (the preregistration changed since the opening)', receipt.prereg_sha256, want.prereg_sha256);
  if (want.candidate_sha256 !== undefined) eq('candidate_sha256', receipt.candidate_sha256, want.candidate_sha256);
  if (want.label !== undefined) eq('label', receipt.label, want.label);
  const s = manifest?.sealed;
  if (manifest?.custody !== 'sealed' || !s) problems.push(`set ${want.set} is not sealed in the checkout's MANIFEST.json`);
  else {
    eq('bundle_sha256', receipt.bundle_sha256, s.bundle_sha256);
    eq('tree_sha256', receipt.tree_sha256, manifest.tree_sha256);
    eq('world_slice_sha256', receipt.world_slice_sha256, s.world_slice_sha256);
    eq('heldout_corpus_sha256', receipt.heldout_corpus_sha256, s.heldout_corpus_sha256);
    eq('kind', receiptKind(receipt), manifest.kind === 'repo' ? 'repo' : 'multiuser');
    if (manifest.kind === 'repo') eq('generator_sha256', receipt.generator_sha256 ?? null, s.generator_sha256 ?? null);
    const canon = (x?: Record<string, string>) => JSON.stringify(Object.entries(x ?? {}).sort());
    eq('extras', canon(receipt.extras), canon(s.extras));
  }
  return problems;
}

/** The string values a JSON document holds under an "id" or "task_id" key (any case, taskId too): sealed identifiers
 *  that can be shorter than the generic string thresholds, so the redactor and the export leak scan add them at three. */
/** A quoted source literal with its common escapes decoded (a backslash before a line break, \\, \", \', \n, \r, \t,
 *  \a, \b, \f, \v, octal \N to \NNN, \xHH, \uHHHH, \u{H...}, \UHHHHHHHH), so a generator value written with escapes is sealed text in the
 *  form a program prints it (internal-task). Other escapes stay as written. Nothing is executed. */
export function decodeEscapes(s: string): string {
  const cp = (n: number) => (n <= 0x10ffff ? String.fromCodePoint(n) : null);
  return s.replace(/\\(?:(\r?\n)|([0-7]{1,3})|x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([\\"'nrtabfv]))/g, (m, nl, o, x, ub, u, U, c) => {
    if (nl) return '';
    if (c) return ({ n: '\n', r: '\r', t: '\t', a: '\x07', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[c] ?? c;
    if (o) return cp(parseInt(o, 8)) ?? m;
    return cp(parseInt(x ?? ub ?? u ?? U, 16)) ?? m;
  });
}

/** The quoted literals of a source file ("""...""", "...", '...', `...`; an escaped line break stays inside its literal),
 *  each as written and with decodeEscapes applied: the generator values the output guard and the export leak scan seal. */
export function quotedLiterals(text: string): string[] {
  return [...text.matchAll(/"""([\s\S]*?)"""|"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|`([^`]*)`/g)].flatMap((m) => { const s = m[1] ?? m[2] ?? m[3] ?? m[4] ?? ''; return [s, decodeEscapes(s)]; });
}

export function idValues(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) idValues(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (typeof x === 'string' && /^(id|task_?id)$/i.test(k)) out.push(x); else idValues(x, out); }
  return out;
}

export function readReceipt(path: string): OpeningReceipt {
  return JSON.parse(readFileSync(path, 'utf8')) as OpeningReceipt;
}

/** The tag scripts/build-gbrain-image.sh --sealed-root gives a sealed build, and a sealed run's gbrain image when --gbrain-image is not given. */
export const sealedImageTag = (receipt: Pick<OpeningReceipt, 'run_id'>): string => `harness-eval/gbrain:sealed-${receipt.run_id}`;

/** gbrain/Dockerfile records its world and corpus inputs in /opt/sidecar/image.json; a sealed run's gbrain cells need both to be the receipt's.
 *  An image labelled sealed whose image.json gives neither digest (gbrainImageInputs answers sealed true with null digests) is named as such. */
export function sealedImageProblem(image: string, inputs: { world_sha256?: string | null; heldout_corpus_sha256?: string | null; sealed?: boolean } | null, receipt: OpeningReceipt): string | null {
  const fix = `fix: scripts/build-gbrain-image.sh --sealed-root <the sealed root> on this machine, which tags ${sealedImageTag(receipt)}, then run without --gbrain-image (or pass --gbrain-image ${sealedImageTag(receipt)})`;
  if (!inputs) return `gbrain image ${image} has no readable /opt/sidecar/image.json; a sealed run's gbrain cells need an image built from the sealed root. ${fix}`;
  if (inputs.sealed === true && inputs.world_sha256 == null && inputs.heldout_corpus_sha256 == null) return `gbrain image ${image} carries the harness-eval.sealed=true label but no readable /opt/sidecar/image.json digests (the file is missing, is not JSON or records neither the world nor the corpus), so it cannot be checked against the opening receipt. ${fix}`;
  if (inputs.world_sha256 === receipt.world_sha256 && inputs.heldout_corpus_sha256 === receipt.heldout_corpus_sha256) return null;
  return `gbrain image ${image} was built from world ${String(inputs.world_sha256 ?? 'unrecorded').slice(0, 12)} and held-out corpus ${String(inputs.heldout_corpus_sha256 ?? 'public').slice(0, 12)}, the opening receipt names world ${String(receipt.world_sha256).slice(0, 12)} and corpus ${String(receipt.heldout_corpus_sha256).slice(0, 12)}, so its held-out brains would not hold the sealed slice. ${fix}`;
}

/** A run with no sealed root and gbrain cells: the HE-SEALED-005 message body when the image was built from a sealed root
 *  (image.json says sealed true, or records a held-out corpus digest; gbrainImageInputs falls back to the image's
 *  harness-eval.sealed label when image.json has no sealed field, or cannot be read), else null. An image with no readable
 *  image.json and no harness-eval.sealed=true label is left to preflight's commit check. */
export function publicImageProblem(image: string, inputs: { heldout_corpus_sha256?: string | null; sealed?: boolean } | null): string | null {
  if (!inputs || (inputs.sealed !== true && inputs.heldout_corpus_sha256 == null)) return null;
  return `gbrain image ${image} was built from a sealed root (${inputs.sealed === true ? 'image.json says sealed' : `image.json records held-out corpus ${String(inputs.heldout_corpus_sha256).slice(0, 12)}`}) and this run has no sealed root, so its trials would read sealed brains and its transcripts and receipts would publish them. fix: pass --gbrain-image with a public build (scripts/build-gbrain-image.sh tags harness-eval/gbrain:dev), or run the sealed run with --sealed-root and --opening-receipt`;
}

const withheld = (file: string, where: string, e: unknown) => new RunnerError('HE-RUN-007', `${file}${where} is not JSON (${e instanceof Error ? e.name : 'error'}); the parser's message is withheld, since it quotes the input`);

/** The JSON value of each non-empty line of a results file (trials.jsonl and the like); a bad line is HE-RUN-007 naming the file and line number only. */
export function readJsonLines<T>(file: string): T[] {
  return readFileSync(file, 'utf8').split('\n').flatMap((l, i) => {
    if (!l) return [];
    try { return [JSON.parse(l) as T]; } catch (e) { throw withheld(file, ` line ${i + 1}`, e); }
  });
}

/** The JSON value of a results file (manifest.json and the like); a parse error is HE-RUN-007 naming the file only. */
export function readJsonFile<T>(file: string): T {
  const text = readFileSync(file, 'utf8');
  try { return JSON.parse(text) as T; } catch (e) { throw withheld(file, '', e); }
}
