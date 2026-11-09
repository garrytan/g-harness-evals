#!/usr/bin/env bun
/**
 * Decides whether a change is docs-only, so public CI can skip its heavy test steps (typecheck and `bun test tests/`)
 * while every required job still reports success.
 *
 *   bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>]   prints docs_only=true or docs_only=false
 *   bun scripts/ci/docs-only.ts --audit [--tree <rev>]                     counts the Markdown files that would qualify
 *
 * The rule is an allowlist. A change is docs-only only when every path it adds, edits, deletes or renames (merge base
 * to head with renames split, so both the old and the new name count) is a regular file on this list of human-facing
 * docs:
 *   - README.md;
 *   - a Markdown file at any depth under docs/, except anything under docs/benchmarks/ or docs/scoreboard/, any
 *     PREREGISTRATION*.md, any AMENDMENTS.md, and any file whose sha256 (old or new content) a committed file at
 *     --tree or at the merge base holds;
 *   - findings/<name>.md;
 * and no file under tests/ or scripts/ at --tree (default HEAD) names it. A file names a path when its text holds, as
 * a whole word, the path's basename or any of its directory names; when it holds a glob that matches the path or its
 * basename (so `git ls-files '*.md'` names every Markdown file); or when it holds `.md` or `md` as a word. Words are
 * runs of letters, digits, `_`, `.` and `-`, also tried with leading and trailing dots stripped. This file is the
 * one exception: it names the list, it reads nothing. changelog.d/ and todos.d/ are never docs-only. Anything else,
 * or anything the script cannot decide, prints docs_only=false. CI runs the base commit's copy of this file, so it
 * imports nothing from the repository.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const READER_ROOTS = ['tests/', 'scripts/'];
export const SELF = 'scripts/ci/docs-only.ts';
const EXCLUDED = ['docs/benchmarks/', 'docs/scoreboard/'];
const WORD = /^[A-Za-z0-9_.-]+$/;

/** Whether a path is on the list of human-facing docs, before the reader and pin checks. */
export function listed(p: string): boolean {
  const base = posix.basename(p);
  if (/^PREREGISTRATION.*\.md$/.test(base) || base === 'AMENDMENTS.md') return false;
  if (p === 'README.md' || /^findings\/[^/]+\.md$/.test(p)) return true;
  return p.startsWith('docs/') && p.endsWith('.md') && !EXCLUDED.some((e) => p.startsWith(e));
}

export interface Reader { path: string; text: string }

/** A function from a path to the first reader that names it, or null when none does. */
export function namer(readers: readonly Reader[]): (path: string) => string | null {
  const scanned = readers.filter((r) => r.path !== SELF).map((r) => {
    const words = new Set<string>();
    for (const w of r.text.split(/[^A-Za-z0-9_.-]+/)) if (w) { words.add(w); words.add(w.replace(/^\.+|\.+$/g, '')); }
    const globs: InstanceType<typeof Bun.Glob>[] = [];
    let badGlob = false;
    for (const t of r.text.split(/[^A-Za-z0-9_.\-/*?{}[\],!]+/)) {
      if (!/[*?]/.test(t) || !/[^*?/.]/.test(t)) continue;
      try { globs.push(new Bun.Glob(t.replace(/^\.\//, ''))); } catch { badGlob = true; }
    }
    return { path: r.path, text: r.text, words, globs, everyMd: badGlob || words.has('.md') || words.has('md') };
  });
  return (path) => {
    const base = posix.basename(path);
    const names = [base, ...posix.dirname(path).split('/').filter((d) => d !== '.')];
    for (const r of scanned) {
      if (r.everyMd && path.endsWith('.md')) return r.path;
      if (names.some((n) => (WORD.test(n) ? r.words.has(n) : r.text.includes(n)))) return r.path;
      if (r.globs.some((g) => g.match(path) || g.match(base))) return r.path;
    }
    return null;
  };
}

/** One side of a changed path: its mode and the sha256 of its content (null when it is not a listed regular file). */
export interface Side { path: string; mode: string; sha256: string | null }

/** Null when the change is docs-only, else the first path that disqualifies it and why. */
export function disqualifier(sides: readonly Side[], names: (path: string) => string | null, pinned: ReadonlySet<string>): { path: string; why: string } | null {
  if (!sides.length) return { path: '', why: 'no changed paths' };
  for (const s of sides) {
    if (!listed(s.path)) return { path: s.path, why: 'not on the docs-only list' };
    if (s.mode !== '100644') return { path: s.path, why: 'not a regular file' };
    if (!s.sha256) return { path: s.path, why: 'content unknown' };
    if (pinned.has(s.sha256)) return { path: s.path, why: 'its sha256 is pinned by a committed file' };
    const by = names(s.path);
    if (by) return { path: s.path, why: 'named by ' + by };
  }
  return null;
}

function git(args: string[], input?: string, ok = [0]): Buffer {
  const r = spawnSync('git', args, { input, maxBuffer: 1 << 30 });
  if (r.status === null || !ok.includes(r.status)) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr?.toString().trim().slice(0, 200) ?? ''));
  return r.stdout;
}

/** The contents of blobs by object id, in order. */
function blobs(ids: string[]): Buffer[] {
  if (!ids.length) return [];
  const out = git(['cat-file', '--batch'], ids.join('\n') + '\n');
  const bodies: Buffer[] = [];
  let off = 0;
  for (const id of ids) {
    const nl = out.indexOf(10, off);
    const [got, type, size] = out.subarray(off, nl).toString().split(' ');
    if (got !== id || type !== 'blob' || !Number.isFinite(Number(size))) throw new Error('cat-file: ' + id + ' is not a blob');
    bodies.push(out.subarray(nl + 1, nl + 1 + Number(size)));
    off = nl + 1 + Number(size) + 1;
  }
  return bodies;
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function lsTree(rev: string, roots: string[] = []): { path: string; mode: string; type: string; id: string }[] {
  return git(['ls-tree', '-r', '-z', '--full-tree', rev, '--', ...roots]).toString().split('\0').filter(Boolean).map((e) => {
    const tab = e.indexOf('\t');
    const [mode, type, id] = e.slice(0, tab).split(' ');
    return { path: e.slice(tab + 1), mode: mode!, type: type!, id: id! };
  });
}

/** Every file under tests/ and scripts/ at a revision, as text. */
export function readersAt(rev: string): Reader[] {
  const files = lsTree(rev, READER_ROOTS).filter((f) => f.type === 'blob');
  const bodies = blobs(files.map((f) => f.id));
  return files.map((f, i) => ({ path: f.path, text: bodies[i]!.toString('latin1') }));
}

/** Which of the given sha256 values any committed file at the revisions holds, in either case. */
export function pinnedAt(revs: string[], hashes: string[]): Set<string> {
  const found = new Set<string>();
  const want = [...new Set(hashes)];
  if (!want.length) return found;
  for (const rev of revs) {
    const out = git(['grep', '-a', '-h', '-o', '-i', '-F', '--no-color', '-f', '/dev/stdin', rev], want.join('\n') + '\n', [0, 1]).toString();
    for (const m of out.match(/[0-9a-fA-F]{64}/g) ?? []) found.add(m.toLowerCase());
  }
  return found;
}

function audit(rev: string): string {
  const md = lsTree(rev).filter((e) => e.path.endsWith('.md'));
  const candidates = md.filter((e) => listed(e.path) && e.mode === '100644');
  const hashes = blobs(candidates.map((c) => c.id)).map(sha256);
  const pins = pinnedAt([rev], hashes);
  const names = namer(readersAt(rev));
  const qualify = candidates.filter((c, i) => !disqualifier([{ path: c.path, mode: c.mode, sha256: hashes[i]! }], names, pins)).length;
  return qualify + ' of ' + md.length + ' Markdown files at ' + rev + ' qualify for the docs-only path (' + candidates.length + ' on the docs-only list before the reader and pin checks)';
}

function main(argv: string[]): number {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const tree = arg('--tree') ?? 'HEAD';
  if (argv.includes('--audit')) { console.log(audit(tree)); return 0; }
  const base = arg('--base'), head = arg('--head');
  if (!base || !head) { console.error('usage: bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>] | --audit [--tree <rev>]'); return 2; }
  try {
    const mb = git(['merge-base', base, head]).toString().trim();
    const tok = git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', mb, head]).toString().split('\0');
    const sides: { path: string; mode: string; id: string }[] = [];
    for (let i = 0; i < tok.length; i++) {
      if (!tok[i]!.startsWith(':')) continue;
      const [oldMode, newMode, oldId, newId] = tok[i]!.slice(1).split(' ');
      const path = tok[++i]!;
      if (oldMode !== '000000') sides.push({ path, mode: oldMode!, id: oldId! });
      if (newMode !== '000000') sides.push({ path, mode: newMode!, id: newId! });
    }
    const files = sides.filter((s) => listed(s.path) && s.mode === '100644');
    const bodies = blobs(files.map((f) => f.id));
    const hashes = new Map(files.map((s, i) => [s, sha256(bodies[i]!)]));
    const bad = disqualifier(sides.map((s) => ({ path: s.path, mode: s.mode, sha256: hashes.get(s) ?? null })), namer(readersAt(tree)), pinnedAt([tree, mb], [...hashes.values()]));
    console.log('docs_only=' + (bad ? 'false' : 'true'));
    console.error(bad ? 'full run: ' + (bad.path || '(empty diff)') + ': ' + bad.why : 'docs-only: ' + new Set(sides.map((s) => s.path)).size + ' listed doc(s) that no test or script names');
  } catch (e) {
    console.log('docs_only=false');
    console.error('full run: ' + (e as Error).message);
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
