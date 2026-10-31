#!/usr/bin/env bun
/**
 * Compare two set authors' backups, both encrypted to sealed/recipient.txt, without printing their content
 * (docs/sealed-custody.md, "Re-encrypting for regeneration"). The custodian uses it after an author regenerates: did
 * the new backup change only what it was meant to?
 *
 *   bun scripts/sealed/compare-backups.ts --a <file.tar.age> --a-sha256 <hex> --b <file.tar.age> --b-sha256 <hex>
 *        --tasks <dir in the backup, such as v03/selected/tasks> [--allow-family <prefix> ...]
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
 *   - Tasks: each immediate subdirectory of --tasks. Its digest covers its directories (empty ones too) and its files'
 *     relative paths, executable bits and bytes. Its family is the name before the first "-" ("(none)" when the name
 *     has no prefix).
 *   - --slice (optional): the world slice, record by record per collection (WORLD_COLLECTIONS), keyed by record id, plus
 *     its other top-level keys as one item.
 *   - --corpus (optional): every file under the directory, page by page (bytes and executable bit).
 *   - Every other entry (files directly in --tasks, directories, everything outside): path, kind, executable bit and
 *     bytes, grouped by the first two path segments.
 *
 * What prints: counts only. A family prints when it is 2 to 4 lowercase letters, else as the first 12 hex characters of
 * its sha256. A group prints segment by segment: a segment prints when it is lowercase words joined by "_" or "-" (or v
 * and digits), contains, case-insensitively, no task id of either backup and no "<family>-" of either backup or
 * --allow-family, and is a directory wherever it exists in both backups; any other segment prints as the first 12 hex
 * characters of its sha256. No path below the second segment and no content is printed.
 *
 * Exit codes: 1 when a task outside --allow-family differs (changed, added or removed); else 3 (needs judgment) when a
 * non-task entry, a slice record or a corpus page differs outside --allow-group (a group named raw or by its printed
 * label; corpus pages named "<allowed family>-..." count as allowed only with --allow-family-pages, since the names are
 * the author's); else 0. A refusal is 2. One "compared"
 * access-log line (run_id "*", the set, the custodian, source_sha256 = a, output_sha256 = b) is pushed before anything is
 * printed; a refused push prints nothing. It is not an opening.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize } from 'node:path';
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
  /** The task directory, relative to the unpacked backup. */
  tasks: string;
  /** Families whose tasks may differ. */
  allowFamily?: string[];
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
  families: Array<Counts & { family: string; allowed: boolean }>;
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
  const tasks = relPath('--tasks', o.tasks);
  const slice = o.slice === undefined ? undefined : relPath('--slice', o.slice);
  const corpus = o.corpus === undefined ? undefined : relPath('--corpus', o.corpus);
  for (const [flag, p] of [['--slice', slice], ['--corpus', corpus]] as const) if (p && (p === tasks || under(p, tasks) || under(tasks, p))) fail(`${flag} ${p} overlaps --tasks; nothing was decrypted`);
  const allowed = [...new Set(o.allowFamily ?? [])];
  const badFamily = allowed.filter((p) => !/^[A-Za-z0-9_.]+$/.test(p));
  if (badFamily.length) fail(`--allow-family takes a family prefix, the part of a task directory name before the first "-" (letters, digits, "_" and "."); ${badFamily.length} value(s) are not one; nothing was decrypted`);
  checkSetName(o.set);
  const { clone, plain } = await openBackups(o, [{ flag: '--a', file: o.a, sha256: aSha }, { flag: '--b', file: o.b, sha256: bSha }]);
  const [A, Bk] = plain.map((p) => normalized(p.entries)) as [Map<string, Item>, Map<string, Item>];
  const tA = taskDigests(A, tasks), tB = taskDigests(Bk, tasks);
  if (!tA.size && !tB.size) fail(`--tasks ${tasks} holds no task directory in either backup; nothing was pushed or printed`);
  if (slice && !A.has(slice) && !Bk.has(slice)) fail('--slice is not in either backup; nothing was pushed or printed');
  const isCorpus = (p: string, it: Item) => corpus !== undefined && !it.dir && under(p, corpus);
  if (corpus && ![...A, ...Bk].some(([p, it]) => isCorpus(p, it))) fail('--corpus holds no file in either backup; nothing was pushed or printed');

  const taskIds = new Set([...tA.keys(), ...tB.keys()]);
  const ids = [...taskIds].map((t) => t.toLowerCase());
  const familyDashes = [...new Set([...[...taskIds].map(familyOf).filter((f) => f !== NO_PREFIX), ...allowed])].map((f) => `${f.toLowerCase()}-`);
  const groupOf = (p: string) => p.split('/').slice(0, 2).join('/');
  const isDirEverywhere = (p: string) => (A.has(p) || Bk.has(p)) && A.get(p)?.dir !== false && Bk.get(p)?.dir !== false;
  const plainSegment = (s: string, path: string) => {
    const low = s.toLowerCase();
    return SAFE_SEGMENT.test(s) && !ids.some((t) => low.includes(t)) && !familyDashes.some((f) => low.includes(f)) && isDirEverywhere(path);
  };
  const groupLabel = (g: string) => g.split('/').map((s, i, segs) => (plainSegment(s, segs.slice(0, i + 1).join('/')) ? s : sha256(s).slice(0, 12))).join('/');
  const allowGroup = [...new Set(o.allowGroup ?? [])];
  const groupAllowed = (g: string) => allowGroup.includes(g) || allowGroup.includes(groupLabel(g));
  const namedAllowed = (p: string) => { const base = p.slice(p.lastIndexOf('/') + 1); return allowed.some((f) => base.startsWith(`${f}-`)); };

  const byFamily = tally(tA, tB, (x, y) => x === y, familyOf);
  const families = [...byFamily].sort(([x], [y]) => (x < y ? -1 : 1)).map(([f, c]) => ({ family: familyLabel(f), allowed: allowed.includes(f), ...c }));
  const failing = families.filter((f) => !f.allowed && differs(f)).map((f) => f.family);

  const inTasks = (p: string, it: Item) => p === tasks || under(tasks, p) || (under(p, tasks) && (it.dir || p.slice(tasks.length + 1).includes('/')));
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
  const exitCode: 0 | 1 | 3 = failing.length ? 1 : entriesOutside + recordsOutside + pagesOutside + familyPagesOutside ? 3 : 0;
  const now = o.now ?? (() => new Date().toISOString());
  const pushed = compareAndPush(clone, {
    remote: o.remote ?? 'origin',
    message: () => `compare two backups of ${o.set}`,
    decide: () => {
      refuseSetState(clone, o.set, 'Nothing was pushed or printed');
      return { schema_version: 1, event: 'compared', at: now(), run_id: '*', set: o.set, source_sha256: aSha, output_sha256: bSha, custodian: o.custodian ?? 'scripts/sealed/compare-backups.ts' };
    },
    onFailure: 'both backups were decrypted in memory only and nothing was printed',
  });
  return { families, groups, slice: sliceRows, sliceAllowed, corpus: corpusRow, failing, judgment, allowFamily: allowed.map(familyLabel), allowGroup: [...new Set(allowGroup.map(groupLabel))], allowFamilyPages: o.allowFamilyPages === true, exitCode, commit: pushed.commit };
}

/** The CLI's report: counts, family and group labels, collection names. */
export function reportLines(r: CompareResult): string[] {
  const counts = (c: Counts) => `same ${c.same}, changed ${c.changed}, added ${c.added}, removed ${c.removed}`;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const covered = [
    `every task directory under --tasks (identical outside --allow-family: ${list(r.allowFamily)})`,
    `every other entry by path, kind, executable bit and bytes (identical outside --allow-group: ${list(r.allowGroup)})`,
    r.slice ? `every --slice record by collection and id${r.sliceAllowed ? ' (its group is allowed)' : ''}` : 'no world slice record by record (no --slice)',
    r.corpus ? `every --corpus page (${r.corpus.allowed ? 'its group is allowed' : `${r.corpus.allowedNamed} differing page(s) named for an allowed family, ${r.allowFamilyPages ? 'allowed by --allow-family-pages' : 'not allowed without --allow-family-pages'}`})` : 'no corpus page by page (no --corpus)',
  ].join('; ');
  return [
    ...r.families.map((f) => `COMPARE: family ${f.family}${f.allowed ? ' (allowed to differ)' : ''}: ${counts(f)} task(s)`),
    ...r.groups.map((g) => `COMPARE: non-task ${g.group}${g.allowed ? ' (allowed to differ)' : ''}: ${counts(g)} entr(ies)${differs(g) ? `; ${g.allowedNamed} of the differing entries are named for an allowed family` : ''}`),
    ...(r.slice ?? []).map((s) => `COMPARE: slice ${s.collection}: ${counts(s)} record(s)`),
    ...(r.corpus ? [`COMPARE: corpus: ${counts(r.corpus)} page(s); of the differing pages ${r.corpus.allowedNamed} are named for an allowed family and ${r.corpus.otherNamed} are not`] : []),
    r.exitCode === 1
      ? `COMPARE: fail: tasks differ in famil${r.failing.length === 1 ? 'y' : 'ies'} outside --allow-family: ${r.failing.join(', ')}`
      : r.exitCode === 3
        ? `COMPARE: needs judgment: every task outside --allow-family is identical, but ${r.judgment.entries} non-task entr(ies), ${r.judgment.records} slice record(s), ${r.judgment.pages} corpus page(s) not named for an allowed family and ${r.judgment.familyPages} named for one (allowed only with --allow-family-pages) differ outside --allow-group; checked ${covered}`
        : `COMPARE: pass: checked ${covered}`,
    `COMPARE: "compared" access-log line pushed to ${CUSTODY_REF} in ${r.commit}`,
  ];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const usage = 'usage: bun scripts/sealed/compare-backups.ts --a <file.tar.age> --a-sha256 <hex> --b <file.tar.age> --b-sha256 <hex> --tasks <dir in the backup> [--allow-family <prefix> ...] [--slice <file in the backup>] [--corpus <dir in the backup>] [--allow-group <group> ...] [--allow-family-pages] --set <old set> [--custodian <name>] [--custody <clone>] [--identity <drive copy>] [--recipient sealed/recipient.txt] [--repo <checkout>] [--remote origin]';
  const usageError = (msg: string): never => { console.error(`HE-RUN-002 ${msg}; ${usage}`); process.exit(2); };
  const { flag, all } = parseFlags(argv, ['a', 'a-sha256', 'b', 'b-sha256', 'tasks', 'allow-family', 'slice', 'corpus', 'allow-group', 'set', 'custodian', 'custody', 'identity', 'recipient', 'repo', 'remote'], ['allow-family', 'allow-group'], usage, ['allow-family-pages']);
  for (const k of ['a-sha256', 'b-sha256']) {
    if (!flag(k)) usageError(`--${k} <hex> is required, the sha256 of the backup file; nothing was decrypted`);
    if (!/^[0-9a-fA-F]{64}$/.test(flag(k)!)) usageError(`--${k} must be 64 hex characters; nothing was decrypted`);
  }
  const need = ['a', 'b', 'tasks', 'set'].filter((k) => !flag(k));
  if (need.length) usageError(`missing --${need.join(', --')}`);
  const repo = flag('repo') ?? join(import.meta.dir, '..', '..');
  try {
    const r = await compareBackups({ repo, set: flag('set')!, a: flag('a')!, aSha256: flag('a-sha256')!, b: flag('b')!, bSha256: flag('b-sha256')!, tasks: flag('tasks')!, allowFamily: all('allow-family'), slice: flag('slice'), corpus: flag('corpus'), allowGroup: all('allow-group'), allowFamilyPages: flag('allow-family-pages') === 'true', recipient: readRecipient(flag('recipient') ?? join(repo, 'sealed', 'recipient.txt')), custodian: flag('custodian'), custody: flag('custody'), identityPath: flag('identity'), remote: flag('remote') });
    for (const l of reportLines(r)) console.log(l);
    process.exit(r.exitCode);
  } catch (e) {
    console.error(refusalLine(e, 'compare'));
    process.exit(2);
  }
}
