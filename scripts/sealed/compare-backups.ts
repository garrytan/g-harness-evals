#!/usr/bin/env bun
/**
 * Compare two set authors' backups, both encrypted to sealed/recipient.txt, without printing their content
 * (docs/sealed-custody.md, "Re-encrypting for regeneration"). The custodian uses it after an author regenerates: did
 * the new backup change only what it was meant to?
 *
 *   bun scripts/sealed/compare-backups.ts --a <file.tar.age> --a-sha256 <hex> --b <file.tar.age> --b-sha256 <hex>
 *        --tasks <dir in the backup, such as v03/selected/tasks> [--tasks <dir> ...] [--family-field] [--allow-family <family> ...]
 *        [--manifest <file in backup b> --manifest-commit <key>=<commit> ...]
 *        [--slice <file in the backup>] [--corpus <dir in the backup>] [--allow-group <group> ...] [--allow-family-pages] --set <old set>
 *        [--custodian <name>] [--custody <clone>] [--identity <drive copy>] [--recipient sealed/recipient.txt]
 *        [--repo <checkout>] [--remote origin]
 *
 * Both digests are required (64 hex characters, uppercase accepted, not equal to each other) and checked before anything
 * is decrypted; then the private check, both backups' sha256, the set's state on the custody branch (a bundle, no opened
 * run, no "released" line), the identity from custodyIdentity after the escrow check, and both backups decrypted in memory
 * and parsed with backupEntries (rekey.ts openBackups). No plaintext is written to disk.
 *
 * What is compared. Directories are normalized: a directory listed in the tar or implied by a path is a directory.
 *   - Tasks: each immediate subdirectory of each --tasks (repeatable; counted per directory when there are several). Its
 *     digest covers its directories (empty ones too) and its files' relative paths, executable bits and bytes. Its family
 *     is the name before the first "-" ("(none)" when the name has no prefix), or with --family-field the top-level
 *     string "family" in its task.toml ("(none)" when absent, or unreadable in both; "(moved)", never allowed, when the
 *     two backups disagree, or it reads in one and not the other).
 *   - --manifest with --manifest-commit <key>=<commit> (optional): the dotted JSON key in that file of backup b must be
 *     7 to 40 hex characters that abbreviate, as an object id in --repo (never a branch or tag of that name), the same
 *     commit as <commit>. Only the key, the expected commit and match or no match print, never the value.
 *   - --slice (optional): the world slice, record by record per collection (WORLD_COLLECTIONS), keyed by record id, plus
 *     its other top-level keys as one item.
 *   - --corpus (optional): every file under the directory, page by page (bytes and executable bit).
 *   - Every other entry (files directly in --tasks, directories, everything outside): path, kind, executable bit and
 *     bytes, grouped by the first two path segments.
 *
 * What prints: counts only. A family prints when it is 2 to 4 lowercase letters, else as the first 12 hex characters of
 * its sha256; with --family-field, when it is lowercase words joined by "_" and is the family of a task.toml committed
 * under tasks/ at HEAD in --repo or an --allow-family value, else as that digest. The --tasks directories print as given. A group prints segment by segment: a segment prints when it is lowercase words joined by "_" or "-" (or v
 * and digits), contains, case-insensitively, no task id of either backup and no "<family>-" of either backup or
 * --allow-family (with --family-field, also no task.toml family of either backup that prints as a digest), and is a
 * directory wherever it exists in both backups; any other segment prints as the first 12 hex
 * characters of its sha256. No path below the second segment and no content is printed.
 *
 * Exit codes: 1 when a task outside --allow-family differs (changed, added or removed) or a --manifest-commit key does
 * not match; else 3 (needs judgment) when a
 * non-task entry, a slice record or a corpus page differs outside --allow-group (a group named raw or by its printed
 * label; corpus pages named "<allowed family>-..." count as allowed only with --allow-family-pages, since the names are
 * the author's); else 0. A refusal is 2. One "compared"
 * access-log line (run_id "*", the set, the custodian, source_sha256 = a, output_sha256 = b) is pushed before anything is
 * printed; a refused push prints nothing. It is not an opening.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { sha256, WORLD_COLLECTIONS } from '../../runner/heldout/sealed.ts';
import { compareAndPush, CUSTODY_REF } from './custody.ts';
import type { BackupEntry } from './intake.ts';
import { checkSetName, openBackups, parseFlags, readRecipient, refusalLine, refuseSetState, wantDigest, type CustodianOptions } from './rekey.ts';
import { SealRefusal } from './seal.ts';

export interface CompareOptions extends CustodianOptions {
  a: string;
  aSha256: string;
  b: string;
  bSha256: string;
  /** The task directories, relative to the unpacked backup. */
  tasks: string | string[];
  /** A task's family is the "family" key of its task.toml, not its name's prefix. */
  familyField?: boolean;
  /** Families that may print by name with familyField; defaults to publicFamilies(repo). */
  publicFamilies?: string[];
  /** Families whose tasks may differ. */
  allowFamily?: string[];
  /** A JSON file in backup b whose keys --manifest-commit checks. */
  manifest?: string;
  /** "<dotted key>=<commit in repo>". */
  manifestCommit?: string[];
  /** The world slice file, relative to the unpacked backup. */
  slice?: string;
  /** The corpus directory, relative to the unpacked backup. */
  corpus?: string;
  /** Groups (raw first two segments, or their printed label) whose differences need no judgment. */
  allowGroup?: string[];
  /** Differing corpus pages named "<allowed family>-..." need no judgment (opt in; the names are the author's). */
  allowFamilyPages?: boolean;
}

export interface Counts { same: number; changed: number; added: number; removed: number }
export interface CompareResult {
  /** Per family, and per --tasks directory (tasks) when there are several. */
  families: Array<Counts & { tasks?: string; family: string; allowed: boolean }>;
  tasks: string[];
  familyField: boolean;
  /** Per --manifest-commit key; null without --manifest. */
  manifest: Array<{ key: string; commit: string; match: boolean }> | null;
  groups: Array<Counts & { group: string; allowed: boolean; allowedNamed: number }>;
  /** Per collection, and "(other keys)"; null without --slice. */
  slice: Array<Counts & { collection: string }> | null;
  sliceAllowed: boolean;
  corpus: (Counts & { allowedNamed: number; otherNamed: number; allowed: boolean }) | null;
  /** Family labels outside --allow-family with a changed, added or removed task. */
  failing: string[];
  /** Differences outside --allow-group and the allowed family names. */
  judgment: { entries: number; records: number; pages: number; familyPages: number };
  allowFamily: string[];
  allowGroup: string[];
  allowFamilyPages: boolean;
  exitCode: 0 | 1 | 3;
  commit: string;
}

const NO_PREFIX = '(none)';
const MOVED = '(moved)';
const UNREADABLE = '(unreadable)';
const FIELD_FAMILY = /^[a-z]+(_[a-z]+)*$/;
const HEX_COMMIT = /^[0-9a-f]{7,40}$/i;
/** A path segment that may print: lowercase words joined by "_" or "-", or v and digits; no other digits, no uppercase. */
const SAFE_SEGMENT = /^(v\d+|[a-z]+([_-][a-z]+)*)$/;
const fail = (msg: string): never => { throw new SealRefusal(msg); };
const differs = (c: Counts) => c.changed + c.added + c.removed;
export const familyOf = (task: string) => { const i = task.indexOf('-'); return i > 0 ? task.slice(0, i) : NO_PREFIX; };
export const familyLabel = (family: string) => (family === NO_PREFIX || /^[a-z]{2,4}$/.test(family) ? family : sha256(family).slice(0, 12));
const relPath = (flag: string, p: string | undefined) => {
  const n = normalize(p ?? '').replace(/\/+$/, '');
  if (!p || isAbsolute(p) || n === '.' || n === '..' || n.startsWith('../')) fail(`${flag} ${p} must be a path under the unpacked backup (relative, not leaving it); nothing was decrypted`);
  return n;
};
const under = (path: string, dir: string) => path.startsWith(`${dir}/`);
const tomlFamily = (data: Uint8Array) => {
  try { const f = (Bun.TOML.parse(new TextDecoder().decode(data)) as { family?: unknown }).family; return typeof f === 'string' && f ? f : NO_PREFIX; } catch { return UNREADABLE; }
};
const revParse = (repo: string, rev: string) => {
  if (!/^[A-Za-z0-9._/~^]+$/.test(rev)) return null;
  try { return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};

/** An object id that hex alone abbreviates in repo (never a branch or tag of that name), or null. */
const objectId = (repo: string, hex: string) => {
  try { const ids = execFileSync('git', ['rev-parse', `--disambiguate=${hex}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); return ids.length === 1 ? ids[0]! : null; } catch { return null; }
};

/** The "family" of every task.toml committed under tasks/ at HEAD in repo (not the index or the work tree): the families a --family-field label may print by name. */
export function publicFamilies(repo: string): string[] {
  const out = new Set<string>();
  try {
    const blobs = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', '--', 'tasks'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter((e) => e.endsWith('/task.toml') && e.split(' ')[1] === 'blob').map((e) => e.split('\t')[0]!.split(' ')[2]!);
    const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input: blobs.join('\n'), stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
    for (let i = 0; i < batch.length;) {
      const nl = batch.indexOf(10, i);
      const size = Number(batch.subarray(i, nl).toString().split(' ')[2]);
      out.add(tomlFamily(batch.subarray(nl + 1, nl + 1 + size)));
      i = nl + 2 + size;
    }
  } catch { fail('--family-field reads the task.toml families committed at HEAD in --repo, and --repo is not a git checkout with a HEAD; nothing was decrypted'); }
  out.delete(NO_PREFIX);
  out.delete(UNREADABLE);
  return [...out].sort();
}

interface Item { dir: boolean; exec: boolean; data: Uint8Array }
/** Every entry of a backup by path, with the directories its paths imply. */
function normalized(entries: BackupEntry[]): Map<string, Item> {
  const out = new Map<string, Item>();
  const none = new Uint8Array();
  for (const e of entries) {
    const segs = e.path.split('/');
    for (let i = 1; i < segs.length; i++) { const d = segs.slice(0, i).join('/'); if (!out.has(d)) out.set(d, { dir: true, exec: false, data: none }); }
    out.set(e.path, e.dir ? { dir: true, exec: false, data: none } : { dir: false, exec: e.exec === true, data: e.data });
  }
  return out;
}
const sameItem = (x: Item, y: Item) => x.dir === y.dir && (x.dir || (x.exec === y.exec && x.data.length === y.data.length && Buffer.from(x.data).equals(Buffer.from(y.data))));

function taskDigests(items: Map<string, Item>, tasks: string): Map<string, string> {
  const files = new Map<string, Array<[string, Item]>>();
  for (const [p, it] of items) {
    if (!under(p, tasks)) continue;
    const rel = p.slice(tasks.length + 1);
    const slash = rel.indexOf('/');
    if (slash < 0) { if (it.dir && !files.has(rel)) files.set(rel, []); continue; }
    const task = rel.slice(0, slash);
    if (!files.has(task)) files.set(task, []);
    files.get(task)!.push([rel.slice(slash + 1), it]);
  }
  const out = new Map<string, string>();
  for (const [task, list] of files) {
    const h = createHash('sha256');
    for (const [p, it] of list.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      h.update(it.dir ? `d\0${p}\0` : `f\0${p}\0${it.exec ? 1 : 0}\0${it.data.length}\0`);
      if (!it.dir) h.update(it.data);
    }
    out.set(task, h.digest('hex'));
  }
  return out;
}

function tally<V>(a: Map<string, V>, b: Map<string, V>, same: (x: V, y: V) => boolean, key: (k: string) => string, onDiff: (k: string, group: string) => void = () => {}): Map<string, Counts> {
  const out = new Map<string, Counts>();
  const count = (k: string, what: keyof Counts) => { const g = key(k); if (!out.has(g)) out.set(g, { same: 0, changed: 0, added: 0, removed: 0 }); out.get(g)![what]++; if (what !== 'same') onDiff(k, g); };
  for (const [k, v] of a) count(k, !b.has(k) ? 'removed' : same(v, b.get(k)!) ? 'same' : 'changed');
  for (const k of b.keys()) if (!a.has(k)) count(k, 'added');
  return out;
}

/** The slice's records by "<collection>/<id>" (canonical JSON), and its other top-level keys as one item. */
function sliceRecords(item: Item | undefined, which: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!item) return out;
  if (item.dir) fail(`--slice is a directory in backup ${which}; it names the world slice file. Nothing was pushed or printed`);
  let doc: unknown;
  try { doc = JSON.parse(new TextDecoder().decode(item.data)); } catch { fail(`--slice is not JSON in backup ${which}; nothing was pushed or printed`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail(`--slice is not a JSON object in backup ${which}; nothing was pushed or printed`);
  const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
  const rest: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (!(WORLD_COLLECTIONS as readonly string[]).includes(k)) { rest[k] = v; continue; }
    if (!Array.isArray(v)) fail(`--slice: ${k} is not a list in backup ${which}; nothing was pushed or printed`);
    for (const r of v as unknown[]) {
      const id = (r as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !id) fail(`--slice: a ${k} record has no string id in backup ${which}; nothing was pushed or printed`);
      if (out.has(`${k}/${id}`)) fail(`--slice: two ${k} records share an id in backup ${which}; nothing was pushed or printed`);
      out.set(`${k}/${id}`, canonical(r));
    }
  }
  if (Object.keys(rest).length) out.set('(other keys)/', canonical(rest));
  return out;
}

export async function compareBackups(o: CompareOptions): Promise<CompareResult> {
  const aSha = wantDigest('--a-sha256', o.aSha256);
  const bSha = wantDigest('--b-sha256', o.bSha256);
  if (aSha === bSha) fail('--a-sha256 and --b-sha256 are the same digest; compare two different backups. Nothing was decrypted');
  const taskDirs = [...new Set((Array.isArray(o.tasks) ? o.tasks : [o.tasks]).map((t) => relPath('--tasks', t)))];
  if (!taskDirs.length) fail('--tasks names no task directory; nothing was decrypted');
  for (const x of taskDirs) for (const y of taskDirs) if (under(x, y)) fail(`--tasks ${x} is inside --tasks ${y}; nothing was decrypted`);
  const slice = o.slice === undefined ? undefined : relPath('--slice', o.slice);
  const corpus = o.corpus === undefined ? undefined : relPath('--corpus', o.corpus);
  const manifest = o.manifest === undefined ? undefined : relPath('--manifest', o.manifest);
  for (const [flag, p] of [['--slice', slice], ['--corpus', corpus]] as const) if (p && taskDirs.some((tasks) => p === tasks || under(p, tasks) || under(tasks, p))) fail(`${flag} ${p} overlaps --tasks; nothing was decrypted`);
  const allowed = [...new Set(o.allowFamily ?? [])];
  const badFamily = allowed.filter((p) => !/^[A-Za-z0-9_.]+$/.test(p));
  if (badFamily.length) fail(`--allow-family takes a family prefix, the part of a task directory name before the first "-", or with --family-field the family key of a task.toml (letters, digits, "_" and "."); ${badFamily.length} value(s) are not one; nothing was decrypted`);
  const manifestKeys = (o.manifestCommit ?? []).map((kv) => {
    const i = kv.indexOf('=');
    const key = kv.slice(0, i);
    if (i <= 0 || !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(key)) fail('--manifest-commit takes <key>=<commit>: a dotted JSON key and a commit in --repo; nothing was decrypted');
    return { key, commit: revParse(resolve(o.repo), kv.slice(i + 1)) ?? fail(`--manifest-commit ${key} names no commit in --repo; nothing was decrypted`) };
  });
  if (manifestKeys.length && !manifest) fail('--manifest-commit needs --manifest; nothing was decrypted');
  if (manifest && !manifestKeys.length) fail('--manifest needs at least one --manifest-commit; nothing was decrypted');
  const pub = new Set(o.familyField ? (o.publicFamilies ?? publicFamilies(resolve(o.repo))) : []);
  const label = (f: string) => (!o.familyField ? familyLabel(f) : f === NO_PREFIX || f === MOVED || (FIELD_FAMILY.test(f) && (pub.has(f) || allowed.includes(f))) ? f : sha256(f).slice(0, 12));
  checkSetName(o.set);
  const { clone, plain } = await openBackups(o, [{ flag: '--a', file: o.a, sha256: aSha }, { flag: '--b', file: o.b, sha256: bSha }]);
  const [A, Bk] = plain.map((p) => normalized(p.entries)) as [Map<string, Item>, Map<string, Item>];
  const digests = taskDirs.map((tasks) => {
    const d = [taskDigests(A, tasks), taskDigests(Bk, tasks)] as const;
    if (!d[0].size && !d[1].size) fail(`--tasks ${tasks} holds no task directory in either backup; nothing was pushed or printed`);
    return d;
  });
  if (slice && !A.has(slice) && !Bk.has(slice)) fail('--slice is not in either backup; nothing was pushed or printed');
  const isCorpus = (p: string, it: Item) => corpus !== undefined && !it.dir && under(p, corpus);
  if (corpus && ![...A, ...Bk].some(([p, it]) => isCorpus(p, it))) fail('--corpus holds no file in either backup; nothing was pushed or printed');
  let manifestRows: CompareResult['manifest'] = null;
  if (manifest) {
    const it = Bk.get(manifest);
    if (!it || it.dir) fail('--manifest is not a file in backup b; nothing was pushed or printed');
    let doc: unknown;
    try { doc = JSON.parse(new TextDecoder().decode(it!.data)); } catch { fail('--manifest is not JSON in backup b; nothing was pushed or printed'); }
    manifestRows = manifestKeys.map(({ key, commit }) => {
      const v = key.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>)[k] : undefined), doc);
      return { key, commit, match: typeof v === 'string' && HEX_COMMIT.test(v) && objectId(resolve(o.repo), v.toLowerCase()) === commit };
    });
  }

  const taskIds = new Set(digests.flatMap(([a, b]) => [...a.keys(), ...b.keys()]));
  const ids = [...taskIds].map((t) => t.toLowerCase());
  const familyDashes = [...new Set([...[...taskIds].map(familyOf).filter((f) => f !== NO_PREFIX), ...allowed])].map((f) => `${f.toLowerCase()}-`);
  const fieldOf = (m: Map<string, Item>, tasks: string, t: string) => { const it = m.get(`${tasks}/${t}/task.toml`); return it && !it.dir ? tomlFamily(it.data) : NO_PREFIX; };
  const hiddenFamilies = o.familyField ? [...new Set(taskDirs.flatMap((tasks, i) => digests[i]!.flatMap((d, k) => [...d.keys()].map((t) => fieldOf(k ? Bk : A, tasks, t)))))].filter((f) => f !== UNREADABLE && label(f) !== f).map((f) => f.toLowerCase().replaceAll('-', '_')) : [];
  const groupOf = (p: string) => p.split('/').slice(0, 2).join('/');
  const isDirEverywhere = (p: string) => (A.has(p) || Bk.has(p)) && A.get(p)?.dir !== false && Bk.get(p)?.dir !== false;
  const plainSegment = (s: string, path: string) => {
    const low = s.toLowerCase();
    return SAFE_SEGMENT.test(s) && !ids.some((t) => low.includes(t)) && !familyDashes.some((f) => low.includes(f)) && !hiddenFamilies.some((f) => low.replaceAll('-', '_').includes(f)) && isDirEverywhere(path);
  };
  const groupLabel = (g: string) => g.split('/').map((s, i, segs) => (plainSegment(s, segs.slice(0, i + 1).join('/')) ? s : sha256(s).slice(0, 12))).join('/');
  const allowGroup = [...new Set(o.allowGroup ?? [])];
  const groupAllowed = (g: string) => allowGroup.includes(g) || allowGroup.includes(groupLabel(g));
  const namedAllowed = (p: string) => { const base = p.slice(p.lastIndexOf('/') + 1); return allowed.some((f) => base.startsWith(`${f}-`)); };

  const families = taskDirs.flatMap((tasks, i) => {
    const [tA, tB] = digests[i]!;
    const famOf = (t: string) => {
      if (!o.familyField) return familyOf(t);
      const fa = tA.has(t) ? fieldOf(A, tasks, t) : undefined, fb = tB.has(t) ? fieldOf(Bk, tasks, t) : undefined;
      if (fa !== undefined && fb !== undefined && fa !== fb) return MOVED;
      const f = (fa ?? fb)!;
      return f === UNREADABLE ? NO_PREFIX : f;
    };
    const byFamily = tally(tA, tB, (x, y) => x === y, famOf);
    return [...byFamily].sort(([x], [y]) => (x < y ? -1 : 1)).map(([f, c]) => ({ ...(taskDirs.length > 1 ? { tasks: groupLabel(tasks) } : {}), family: label(f), allowed: allowed.includes(f), ...c }));
  });
  const failing = [...new Set(families.filter((f) => !f.allowed && differs(f)).map((f) => f.family))];
  const mismatched = (manifestRows ?? []).filter((m) => !m.match).map((m) => m.key);

  const inTasks = (p: string, it: Item) => taskDirs.some((tasks) => p === tasks || under(tasks, p) || (under(p, tasks) && (it.dir || p.slice(tasks.length + 1).includes('/'))));
  const isOther = (p: string, it: Item) => !inTasks(p, it) && p !== slice && !isCorpus(p, it);
  const other = (m: Map<string, Item>) => new Map([...m].filter(([p, it]) => isOther(p, it)));
  const named = new Map<string, number>();
  const byGroup = tally(other(A), other(Bk), sameItem, groupOf, (p, g) => { if (namedAllowed(p)) named.set(g, (named.get(g) ?? 0) + 1); });
  const groupRows = [...byGroup].map(([g, c]) => ({ group: groupLabel(g), allowed: groupAllowed(g), allowedNamed: named.get(g) ?? 0, ...c, raw: g }));
  const groups = groupRows.sort((x, y) => (x.group < y.group ? -1 : 1)).map(({ raw: _raw, ...r }) => r);
  const entriesOutside = groupRows.filter((g) => !g.allowed).reduce((n, g) => n + differs(g), 0);

  let sliceRows: CompareResult['slice'] = null;
  const sliceAllowed = slice !== undefined && groupAllowed(groupOf(slice));
  let recordsOutside = 0;
  if (slice) {
    const per = tally(sliceRecords(A.get(slice), 'a'), sliceRecords(Bk.get(slice), 'b'), (x, y) => x === y, (k) => k.slice(0, k.indexOf('/')));
    sliceRows = [...per].sort(([x], [y]) => (x < y ? -1 : 1)).map(([collection, c]) => ({ collection, ...c }));
    if (!sliceAllowed) recordsOutside = sliceRows.reduce((n, r) => n + differs(r), 0);
  }

  let corpusRow: CompareResult['corpus'] = null;
  let pagesOutside = 0, familyPagesOutside = 0;
  if (corpus) {
    const pages = (m: Map<string, Item>) => new Map([...m].filter(([p, it]) => isCorpus(p, it)));
    let allowedNamed = 0, otherNamed = 0;
    const c = tally(pages(A), pages(Bk), sameItem, () => 'corpus', (p) => { if (namedAllowed(p)) allowedNamed++; else otherNamed++; }).get('corpus')!;
    const all = groupAllowed(groupOf(corpus));
    corpusRow = { ...c, allowedNamed, otherNamed, allowed: all };
    if (!all) { pagesOutside = otherNamed; familyPagesOutside = o.allowFamilyPages ? 0 : allowedNamed; }
  }

  const judgment = { entries: entriesOutside, records: recordsOutside, pages: pagesOutside, familyPages: familyPagesOutside };
  const exitCode: 0 | 1 | 3 = failing.length || mismatched.length ? 1 : entriesOutside + recordsOutside + pagesOutside + familyPagesOutside ? 3 : 0;
  const now = o.now ?? (() => new Date().toISOString());
  const pushed = compareAndPush(clone, {
    remote: o.remote ?? 'origin',
    message: () => `compare two backups of ${o.set}`,
    decide: () => {
      refuseSetState(clone, o.set, 'Nothing was pushed or printed', resolve(o.repo), o.remote ?? 'origin');
      return { schema_version: 1, event: 'compared', at: now(), run_id: '*', set: o.set, source_sha256: aSha, output_sha256: bSha, custodian: o.custodian ?? 'scripts/sealed/compare-backups.ts' };
    },
    onFailure: 'both backups were decrypted in memory only and nothing was printed',
  });
  return { families, tasks: taskDirs.map(groupLabel), familyField: o.familyField === true, manifest: manifestRows, groups, slice: sliceRows, sliceAllowed, corpus: corpusRow, failing, judgment, allowFamily: allowed.map(label), allowGroup: [...new Set(allowGroup.map(groupLabel))], allowFamilyPages: o.allowFamilyPages === true, exitCode, commit: pushed.commit };
}

/** The CLI's report: counts, family and group labels, collection names. */
export function reportLines(r: CompareResult): string[] {
  const counts = (c: Counts) => `same ${c.same}, changed ${c.changed}, added ${c.added}, removed ${c.removed}`;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const covered = [
    `every task directory under --tasks${r.tasks.length > 1 ? ` ${r.tasks.join(', ')}` : ''}${r.familyField ? ' by family field' : ''} (identical outside --allow-family: ${list(r.allowFamily)})`,
    `every other entry by path, kind, executable bit and bytes (identical outside --allow-group: ${list(r.allowGroup)})`,
    r.slice ? `every --slice record by collection and id${r.sliceAllowed ? ' (its group is allowed)' : ''}` : 'no world slice record by record (no --slice)',
    r.corpus ? `every --corpus page (${r.corpus.allowed ? 'its group is allowed' : `${r.corpus.allowedNamed} differing page(s) named for an allowed family, ${r.allowFamilyPages ? 'allowed by --allow-family-pages' : 'not allowed without --allow-family-pages'}`})` : 'no corpus page by page (no --corpus)',
    ...(r.manifest ? [`--manifest key(s) ${r.manifest.map((m) => m.key).join(', ')} against the expected commit(s)`] : []),
  ].join('; ');
  const mismatched = (r.manifest ?? []).filter((m) => !m.match).map((m) => m.key);
  const failure = [
    ...(r.failing.length ? [`tasks differ in famil${r.failing.length === 1 ? 'y' : 'ies'} outside --allow-family: ${r.failing.join(', ')}`] : []),
    ...(mismatched.length ? [`manifest key(s) do not name the expected commit: ${mismatched.join(', ')}`] : []),
  ].join('; ');
  return [
    ...r.families.map((f) => `COMPARE: family ${f.family}${f.tasks ? ` in ${f.tasks}` : ''}${f.allowed ? ' (allowed to differ)' : ''}: ${counts(f)} task(s)`),
    ...r.groups.map((g) => `COMPARE: non-task ${g.group}${g.allowed ? ' (allowed to differ)' : ''}: ${counts(g)} entr(ies)${differs(g) ? `; ${g.allowedNamed} of the differing entries are named for an allowed family` : ''}`),
    ...(r.slice ?? []).map((s) => `COMPARE: slice ${s.collection}: ${counts(s)} record(s)`),
    ...(r.manifest ?? []).map((m) => `COMPARE: manifest key ${m.key} names commit ${m.commit}: ${m.match ? 'match' : 'no match'}`),
    ...(r.corpus ? [`COMPARE: corpus: ${counts(r.corpus)} page(s); of the differing pages ${r.corpus.allowedNamed} are named for an allowed family and ${r.corpus.otherNamed} are not`] : []),
    r.exitCode === 1
      ? `COMPARE: fail: ${failure}`
      : r.exitCode === 3
        ? `COMPARE: needs judgment: every task outside --allow-family is identical, but ${r.judgment.entries} non-task entr(ies), ${r.judgment.records} slice record(s), ${r.judgment.pages} corpus page(s) not named for an allowed family and ${r.judgment.familyPages} named for one (allowed only with --allow-family-pages) differ outside --allow-group; checked ${covered}`
        : `COMPARE: pass: checked ${covered}`,
    `COMPARE: "compared" access-log line pushed to ${CUSTODY_REF} in ${r.commit}`,
  ];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const usage = 'usage: bun scripts/sealed/compare-backups.ts --a <file.tar.age> --a-sha256 <hex> --b <file.tar.age> --b-sha256 <hex> --tasks <dir in the backup> [--tasks <dir> ...] [--family-field] [--allow-family <family> ...] [--manifest <file in backup b> --manifest-commit <key>=<commit> ...] [--slice <file in the backup>] [--corpus <dir in the backup>] [--allow-group <group> ...] [--allow-family-pages] --set <old set> [--custodian <name>] [--custody <clone>] [--identity <drive copy>] [--recipient sealed/recipient.txt] [--repo <checkout>] [--remote origin]';
  const usageError = (msg: string): never => { console.error(`HE-RUN-002 ${msg}; ${usage}`); process.exit(2); };
  const { flag, all } = parseFlags(argv, ['a', 'a-sha256', 'b', 'b-sha256', 'tasks', 'allow-family', 'manifest', 'manifest-commit', 'slice', 'corpus', 'allow-group', 'set', 'custodian', 'custody', 'identity', 'recipient', 'repo', 'remote'], ['tasks', 'allow-family', 'manifest-commit', 'allow-group'], usage, ['allow-family-pages', 'family-field']);
  for (const k of ['a-sha256', 'b-sha256']) {
    if (!flag(k)) usageError(`--${k} <hex> is required, the sha256 of the backup file; nothing was decrypted`);
    if (!/^[0-9a-fA-F]{64}$/.test(flag(k)!)) usageError(`--${k} must be 64 hex characters; nothing was decrypted`);
  }
  const need = ['a', 'b', 'tasks', 'set'].filter((k) => !flag(k));
  if (need.length) usageError(`missing --${need.join(', --')}`);
  const repo = flag('repo') ?? join(import.meta.dir, '..', '..');
  try {
    const r = await compareBackups({ repo, set: flag('set')!, a: flag('a')!, aSha256: flag('a-sha256')!, b: flag('b')!, bSha256: flag('b-sha256')!, tasks: all('tasks'), familyField: flag('family-field') === 'true', allowFamily: all('allow-family'), manifest: flag('manifest'), manifestCommit: all('manifest-commit'), slice: flag('slice'), corpus: flag('corpus'), allowGroup: all('allow-group'), allowFamilyPages: flag('allow-family-pages') === 'true', recipient: readRecipient(flag('recipient') ?? join(repo, 'sealed', 'recipient.txt')), custodian: flag('custodian'), custody: flag('custody'), identityPath: flag('identity'), remote: flag('remote') });
    for (const l of reportLines(r)) console.log(l);
    process.exit(r.exitCode);
  } catch (e) {
    console.error(refusalLine(e, 'compare'));
    process.exit(2);
  }
}
