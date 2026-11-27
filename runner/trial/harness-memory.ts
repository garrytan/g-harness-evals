// internal-task: Hermes and OpenClaw each keep one native memory that every member's conversation reads and writes, so a value one
// member told the bot can reach another member's reply without gbrain. The runner copies those memory files into the trial
// directory before the first turn and after each turn, so the grader can tell a leak from the harness's own memory from one
// through gbrain (runner/grade/predicates.ts, replyLeaks). The copy is taken on the host: docker mode bind-mounts
// <trial>/state at /harness-state and <trial>/workspace at /workspace (docker.ts), and process mode runs on the same
// directories, so no docker cp and no adapter change is needed.
//
//   Hermes (harnesses/hermes/adapter.sh): HERMES_HOME=$HE_SESSION_STATE_DIR/hermes; its memory tool keeps MEMORY.md and USER.md
//   in $HERMES_HOME/memories (tools/memory_tool.py at f97608f1), so <trial>/state/hermes/memories/.
//   OpenClaw (harnesses/openclaw/config/openclaw*.json): agents.defaults.workspace is /workspace; its memory files are MEMORY.md
//   and memory/*.md in the workspace (the files its memory indexer reads, harnesses/openclaw/README.md), so <trial>/workspace/.
//
// Each snapshot copies the Markdown files under those paths to <trial>/harness-memory/after-turn-<n>/<state|workspace>/<path>
// and appends one line to <trial>/harness-memory/snapshots.jsonl: after_turn and each file's path, bytes and sha256. A snapshot
// that finds no file still writes its line, so an empty memory is recorded, not assumed. Other harnesses get no snapshot.
// Each snapshot is bounded (Amendment 1, 2026-11-22; HARNESS_MEMORY_LIMITS): the walk stops at a depth and a file count, a
// file over the per-file size or past the snapshot's total is listed as skipped with its reason instead of copied, and the
// line says truncated when the walk stopped early, so a large or hostile memory tree cannot stall the runner or fill its disk.
// The walk also stops after a number of directory entries, and the line names every cap that stopped it (truncated_by: depth,
// entries, files). The walk goes by file descriptor: it opens the mount once, opens each name relative to its parent's open
// descriptor with O_NOFOLLOW (through /proc/self/fd, Linux's stand-in for openat, since Node has none), lists a directory
// through its own descriptor, and reads each file from the descriptor it opened while its parent was held open. A directory
// swapped for a symlink mid-walk therefore never moves the walk: the open descriptors still name the directories it walked,
// and a symlink met at any step is skipped, so the copy cannot read outside the mount. A file opens without blocking, so a
// FIFO swapped in for one is listed as not_a_file instead of stalling the snapshot. The walk needs Linux's /proc; a host
// without it takes no snapshot.

import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import type { HarnessMemorySnapshot } from '../contracts.ts';
import type { TrialDirs } from './harness.ts';

export const HARNESS_MEMORY_PATHS: Readonly<Record<string, ReadonlyArray<{ dir: 'state' | 'workspace'; path: string }>>> = {
  hermes: [{ dir: 'state', path: 'hermes/memories' }],
  openclaw: [{ dir: 'workspace', path: 'MEMORY.md' }, { dir: 'workspace', path: 'memory' }],
};

export const HARNESS_MEMORY_DIR = 'harness-memory';

/** The bounds on one snapshot: directory depth below a listed path, directory entries visited, Markdown files listed, bytes per
 *  file and bytes copied. */
export const HARNESS_MEMORY_LIMITS = { depth: 8, entries: 10_000, files: 200, fileBytes: 1 << 20, totalBytes: 16 << 20 };

type Cap = 'depth' | 'entries' | 'files';
type Entry = { path: string; bytes: number; sha256: string } | { path: string; unreadable: string };
type Walk = { files: Entry[]; entries: number; copied: number; capped: Set<Cap>; dest: string; beforeOpen?: (rel: string) => void };

const at = (fd: number, name: string) => `/proc/self/fd/${fd}/${name}`;
const openDir = (fd: number, name: string) => openSync(at(fd, name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

/** Reads the regular file name in the directory open at dirFd, opened without following a symlink and without blocking on a
 *  FIFO, checking on its own descriptor that it is a regular file within the size caps. Throws with a code the snapshot records. */
function readAt(dirFd: number, name: string, room: number): Buffer {
  const fd = openSync(at(dirFd, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    const fail = (code: string) => Object.assign(new Error(code), { code });
    if (!st.isFile()) throw fail('not_a_file');
    if (st.size > HARNESS_MEMORY_LIMITS.fileBytes) throw fail('over_file_cap');
    if (st.size > room) throw fail('over_snapshot_cap');
    const body = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) { const n = readSync(fd, body, got, st.size - got, got); if (n === 0) break; got += n; }
    return body.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

/** Copies the Markdown files under name in the directory open at dirFd, depth first in name order, stopping at the file cap,
 *  once the walk has visited the entry cap, or below the depth cap; each cap that cut the walk short is added to capped. */
function walkAt(dirFd: number, name: string, rel: string, walk: Walk, depth = 0): void {
  if (walk.capped.has('files')) return;
  if (walk.entries >= HARNESS_MEMORY_LIMITS.entries) { walk.capped.add('entries'); return; }
  walk.entries++;
  try {
    const st = lstatSync(at(dirFd, name), { throwIfNoEntry: false });
    if (!st) return;
    if (st.isFile()) {
      if (!name.endsWith('.md')) return;
      if (walk.files.length >= HARNESS_MEMORY_LIMITS.files) { walk.capped.add('files'); return; }
      try {
        walk.beforeOpen?.(rel);
        const body = readAt(dirFd, name, HARNESS_MEMORY_LIMITS.totalBytes - walk.copied);
        walk.copied += body.length;
        const dest = join(walk.dest, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, body);
        walk.files.push({ path: rel, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
      } catch (err) {
        walk.files.push({ path: rel, unreadable: (err as NodeJS.ErrnoException).code ?? 'error' });
      }
      return;
    }
    if (!st.isDirectory()) return;
    walk.beforeOpen?.(rel);
    const fd = openDir(dirFd, name);
    try {
      const names = readdirSync(`/proc/self/fd/${fd}`).sort();
      if (depth >= HARNESS_MEMORY_LIMITS.depth) { if (names.length) walk.capped.add('depth'); return; }
      for (const n of names) walkAt(fd, n, join(rel, n), walk, depth + 1);
    } finally {
      closeSync(fd);
    }
  } catch {
    // An unreadable entry, or a symlink met where a directory was, is left out; the harness may be rewriting it.
  }
}

/** Copies the harness's memory files as they are now; null for a harness with no native memory listed above. It never throws: the
 *  harness keeps writing these files during the trial, so a file it renames, deletes or locks mid-copy is listed as unreadable
 *  with its error code, a symlink anywhere on a path is skipped, and a snapshot that cannot be written at all is lost (the
 *  grader then reads the leak's origin from the snapshots that were written). A host without /proc/self/fd, which the walk
 *  needs, takes no snapshot, so its memory reads as not recorded rather than empty. beforeOpen runs just before each name
 *  on a walked path is opened, so a test can swap the tree mid-walk. */
export function snapshotHarnessMemory(harness: string, dirs: TrialDirs, afterTurn: number, beforeOpen?: (rel: string) => void): { files: number } | null {
  const paths = HARNESS_MEMORY_PATHS[harness];
  if (!paths || !existsSync('/proc/self/fd')) return null;
  const out = join(dirs.root, HARNESS_MEMORY_DIR);
  const walk: Walk = { files: [], entries: 0, copied: 0, capped: new Set<Cap>(), dest: join(out, `after-turn-${afterTurn}`), beforeOpen };
  try {
    for (const p of paths) {
      walk.entries = 0;
      const parts = p.path.split('/');
      const fds: number[] = [];
      try {
        fds.push(openSync(dirs[p.dir], constants.O_RDONLY | constants.O_DIRECTORY));
        for (const [i, part] of parts.slice(0, -1).entries()) {
          beforeOpen?.(join(p.dir, ...parts.slice(0, i + 1)));
          fds.push(openDir(fds.at(-1)!, part));
        }
        walkAt(fds.at(-1)!, parts.at(-1)!, join(p.dir, p.path), walk);
      } catch {
        // A mount or a directory on the listed path that is missing, or a symlink, holds no memory to copy.
      } finally {
        for (const fd of fds) closeSync(fd);
      }
    }
    mkdirSync(out, { recursive: true });
    appendFileSync(join(out, 'snapshots.jsonl'), JSON.stringify({ after_turn: afterTurn, files: walk.files, ...(walk.capped.size ? { truncated: true, truncated_by: [...walk.capped].sort() } : {}) }) + '\n');
  } catch {
    // The trial's own record matters more than this diagnostic copy.
  }
  return { files: walk.files.filter((f) => 'bytes' in f).length };
}

/** The snapshots a trial directory holds, with each file's text (plain or gzipped, as publishing may leave it); undefined when
 *  the trial has none (another harness, or a trial recorded before the runner took them). */
export function loadHarnessMemory(trialDir: string): HarnessMemorySnapshot[] | undefined {
  const dir = join(trialDir, HARNESS_MEMORY_DIR);
  const index = [join(dir, 'snapshots.jsonl'), join(dir, 'snapshots.jsonl.gz')].find(existsSync);
  if (!index) return undefined;
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : gunzipSync(readFileSync(p + '.gz')).toString('utf8'));
  const lines = (index.endsWith('.gz') ? gunzipSync(readFileSync(index)).toString('utf8') : readFileSync(index, 'utf8')).split('\n').filter(Boolean);
  return lines.map((l) => {
    const s = JSON.parse(l) as { after_turn: number; files: Array<{ path: string; unreadable?: string }> };
    return { after_turn: s.after_turn, files: s.files.filter((f) => f.unreadable === undefined).map((f) => ({ path: f.path, text: read(join(dir, `after-turn-${s.after_turn}`, f.path)) })) };
  });
}
