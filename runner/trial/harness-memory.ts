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

import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, relative, sep } from 'node:path';
import type { HarnessMemorySnapshot } from '../contracts.ts';
import type { TrialDirs } from './harness.ts';

export const HARNESS_MEMORY_PATHS: Readonly<Record<string, ReadonlyArray<{ dir: 'state' | 'workspace'; path: string }>>> = {
  hermes: [{ dir: 'state', path: 'hermes/memories' }],
  openclaw: [{ dir: 'workspace', path: 'MEMORY.md' }, { dir: 'workspace', path: 'memory' }],
};

export const HARNESS_MEMORY_DIR = 'harness-memory';

/** The bounds on one snapshot: directory depth below a listed path, Markdown files listed, bytes per file and bytes copied. */
export const HARNESS_MEMORY_LIMITS = { depth: 8, files: 200, fileBytes: 1 << 20, totalBytes: 16 << 20 };

/** The Markdown files under path, depth first in name order, stopping once found holds more than the file cap. */
function markdownFiles(root: string, path: string, found: string[], depth = 0): void {
  if (found.length > HARNESS_MEMORY_LIMITS.files || depth > HARNESS_MEMORY_LIMITS.depth) return;
  try {
    if (!existsSync(path)) return;
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return;
    const real = realpathSync(path);
    if (real !== root && !real.startsWith(root + sep)) return;
    if (st.isFile()) { if (path.endsWith('.md')) found.push(path); return; }
    if (!st.isDirectory()) return;
    for (const name of readdirSync(path).sort()) markdownFiles(root, join(path, name), found, depth + 1);
  } catch {
    // An unreadable entry is left out; the harness may be rewriting it.
  }
}

/** Reads a file opened without following a final symlink, checking on the open descriptor that it is a regular file within
 *  the size cap (so a file swapped after the walk is checked as opened); throws with a code the snapshot records. */
function readNoFollow(file: string, room: number): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
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

/** Copies the harness's memory files as they are now; null for a harness with no native memory listed above. It never throws: the
 *  harness keeps writing these files during the trial, so a file it renames, deletes or locks mid-copy is listed as unreadable
 *  with its error code, a path that leaves the trial directory is skipped, and a snapshot that cannot be written at all is lost
 *  (the grader then reads the leak's origin from the snapshots that were written). */
export function snapshotHarnessMemory(harness: string, dirs: TrialDirs, afterTurn: number): { files: number } | null {
  const paths = HARNESS_MEMORY_PATHS[harness];
  if (!paths) return null;
  const out = join(dirs.root, HARNESS_MEMORY_DIR);
  const files: Array<{ path: string; bytes: number; sha256: string } | { path: string; unreadable: string }> = [];
  let copied = 0;
  let truncated = false;
  try {
    for (const p of paths) {
      let root: string;
      try {
        root = realpathSync(dirs[p.dir]);
      } catch {
        continue;
      }
      const found: string[] = [];
      markdownFiles(root, join(dirs[p.dir], p.path), found);
      const room = HARNESS_MEMORY_LIMITS.files - files.length;
      if (found.length > room) truncated = true;
      for (const file of found.slice(0, Math.max(0, room))) {
        const rel = join(p.dir, relative(dirs[p.dir], file));
        try {
          const body = readNoFollow(file, HARNESS_MEMORY_LIMITS.totalBytes - copied);
          copied += body.length;
          const dest = join(out, `after-turn-${afterTurn}`, rel);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, body);
          files.push({ path: rel, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
        } catch (err) {
          files.push({ path: rel, unreadable: (err as NodeJS.ErrnoException).code ?? 'error' });
        }
      }
    }
    mkdirSync(out, { recursive: true });
    appendFileSync(join(out, 'snapshots.jsonl'), JSON.stringify({ after_turn: afterTurn, files, ...(truncated ? { truncated: true } : {}) }) + '\n');
  } catch {
    // The trial's own record matters more than this diagnostic copy.
  }
  return { files: files.filter((f) => 'bytes' in f).length };
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
