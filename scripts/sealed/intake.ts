/**
 * Intake of a set author's encrypted backup for scripts/sealed/seal.ts --from-backup (docs/sealed-custody.md, "Sealing
 * from an author's encrypted backup"). The backup is a tar (optionally gzipped) of the author's working tree, encrypted to
 * sealed/recipient.txt. seal.ts decrypts it in-process, parses all of it with backupEntries and writes only the entries
 * under the named paths with writeBackup into a fresh 0700 directory under INTAKE_ROOT (~/.capy/work/custody/intake, beside the default custody clone and outside every checkout),
 * seals the named inputs from there, and removes the directory on every exit. A directory a SIGKILL or a machine stop left
 * behind is stale: the next seal.ts run and cleanup.ts remove it (sweepStaleIntake).
 *
 * backupEntries reads ustar, GNU (long names, type L) and pax (path and size records) archives. It refuses an absolute
 * path, a ".." segment, a control character, a duplicate, a symbolic or hard link, a device, a fifo, a sparse (GNU type
 * S or pax GNU.sparse records) or multi-volume entry, a bad checksum and a truncated archive. writeBackup writes regular files (0600, 0700 with an executable bit) and directories
 * (0700) only, each file created exclusively, after checking with lstat that no component under the intake directory is a
 * link, so nothing is followed. Errors name the entry by number and the sha256 of its path, never the path or its content.
 */
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { RunnerError } from '../../runner/errors.ts';
import { sha256 } from '../../runner/heldout/sealed.ts';
import { DEFAULT_CUSTODY_CLONE, insideGitTree } from './custody.ts';

export const INTAKE_ROOT = join(dirname(DEFAULT_CUSTODY_CLONE), 'intake');
const INTAKE_NAME = /^intake-(\d+)-(\d+)-[0-9a-f]{8}$/;
const BLOCK = 512;
const dec = new TextDecoder();
const REFUSED_TYPES: Record<string, string> = { '1': 'a hard link', '2': 'a symbolic link', K: 'a long link name', '3': 'a character device', '4': 'a block device', '6': 'a fifo', S: 'a sparse file', M: 'a multi-volume part', V: 'a volume label' };

const refuse = (msg: string): never => { throw new RunnerError('HE-SEALED-006', msg); };
const field = (h: Uint8Array, at: number, len: number) => { const s = dec.decode(h.subarray(at, at + len)); const nul = s.indexOf('\0'); return nul >= 0 ? s.slice(0, nul) : s; };
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** A process's start time in clock ticks since boot, from /proc/<pid>/stat; undefined where /proc cannot say. Unlike a
 *  wall-clock time it does not move when the clock is stepped. */
function startTicks(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    return Number.isSafeInteger(ticks) && ticks > 0 ? ticks : undefined;
  } catch { return undefined; }
}

/** The records of a pax extended header: "<len> <key>=<value>\n" each. */
function paxRecords(data: Uint8Array, which: string): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length && data[at] !== 0) {
    const sp = data.indexOf(0x20, at);
    const len = sp > at ? Number.parseInt(dec.decode(data.subarray(at, sp)), 10) : NaN;
    if (!Number.isInteger(len) || len <= sp - at || at + len > data.length) refuse(`backup tar: ${which} has a malformed pax header`);
    const rec = dec.decode(data.subarray(sp + 1, at + len - 1));
    const eq = rec.indexOf('=');
    if (eq <= 0) refuse(`backup tar: ${which} has a malformed pax record`);
    out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

/** A backup entry's path made relative and checked: leading "./" and a trailing "/" dropped; refused when absolute, with an
 *  empty, "." or ".." segment, or holding a control character or a backslash. */
function entryPath(raw: string, which: string): string {
  if (raw.startsWith('/')) refuse(`backup tar: ${which} has an absolute path; a backup is unpacked under its intake directory only`);
  let p = raw;
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+$/, '');
  if (!p || /[\x00-\x1f\x7f\\]/.test(p) || p.split('/').some((s) => s === '' || s === '.' || s === '..')) refuse(`backup tar: ${which} has a path with "..", an empty or "." segment, a backslash or a control character; a backup is unpacked under its intake directory only`);
  return p;
}

export interface BackupEntry { path: string; dir: boolean; data: Uint8Array; exec?: boolean }

/** The directories and regular files of a backup tar; gzip is detected by its magic. See the module comment for what is
 *  refused. */
export function backupEntries(input: Uint8Array): BackupEntry[] {
  const buf = input[0] === 0x1f && input[1] === 0x8b ? new Uint8Array(gunzipSync(input)) : input;
  const out: BackupEntry[] = [];
  const seen = new Set<string>();
  let longName: string | undefined;
  let pax: Record<string, string> = {};
  let at = 0, n = 0;
  for (;;) {
    if (at + BLOCK > buf.length) refuse('backup tar: truncated archive (no end marker)');
    const h = buf.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) return out;
    n++;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (Number.parseInt(field(h, 148, 8).trim(), 8) !== sum) refuse(`backup tar: header ${n} has a bad checksum`);
    if (h[124]! & 0x80) refuse(`backup tar: header ${n} has a base-256 size, which this reader does not take`);
    const type = String.fromCharCode(h[156]!);
    const meta = type === 'x' || type === 'g' || type === 'L';
    const size = Number(!meta && pax.size !== undefined ? pax.size : Number.parseInt(field(h, 124, 12).trim() || '0', 8));
    if (!Number.isSafeInteger(size) || size < 0) refuse(`backup tar: header ${n} has a bad size`);
    const start = at + BLOCK;
    if (start + size > buf.length) refuse(`backup tar: header ${n} is truncated`);
    const data = buf.subarray(start, start + size);
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'L') { longName = field(data, 0, data.length); continue; }
    if (type === 'x') { Object.assign(pax, paxRecords(data, `header ${n}`)); continue; }
    if (type === 'g') continue;
    const posix = dec.decode(h.subarray(257, 263)) === 'ustar\0';
    const name = field(h, 0, 100), prefix = posix ? field(h, 345, 155) : '';
    const raw = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    const exec = (Number.parseInt(pax.mode ?? (field(h, 100, 8).trim() || '0'), 8) & 0o111) !== 0;
    const sparse = Object.keys(pax).some((k) => k.startsWith('GNU.sparse.'));
    longName = undefined;
    pax = {};
    const which = `entry ${n} (path sha256 ${sha256(raw).slice(0, 12)})`;
    if (sparse) refuse(`backup tar: ${which} is a sparse file (pax GNU.sparse records); an intake unpacks regular files and directories only`);
    if (type === '5' && /^(\.\/)*\.\/?$/.test(raw)) continue;
    if (!['0', '\0', '7', '5'].includes(type)) refuse(`backup tar: ${which} is ${REFUSED_TYPES[type] ?? `of type ${JSON.stringify(type)}`}; an intake unpacks regular files and directories only and follows no link`);
    const path = entryPath(raw, which);
    if (seen.has(path)) refuse(`backup tar: ${which} appears twice`);
    seen.add(path);
    out.push(type === '5' ? { path, dir: true, data: new Uint8Array() } : { path, dir: false, data: data.slice(), ...(exec ? { exec } : {}) });
  }
}

/** Write backup entries under dir, an existing empty directory: every component under dir is checked with lstat to be a
 *  real directory, directories are made 0700 and files created exclusively 0600 (0700 when the entry has an executable bit). Returns the number of files written. */
export function writeBackup(dir: string, entries: BackupEntry[]): number {
  const ensureDir = (d: string): void => {
    const rel = relative(dir, d);
    if (rel === '') return;
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) refuse('backup tar: an entry resolves outside the intake directory');
    ensureDir(dirname(d));
    const st = lstatSync(d, { throwIfNoEntry: false });
    if (!st) mkdirSync(d, { mode: 0o700 });
    else if (!st.isDirectory()) refuse(`backup tar: a path component (path sha256 ${sha256(rel).slice(0, 12)}) is a file where a directory is needed`);
  };
  let files = 0;
  for (const e of entries) {
    const p = join(dir, e.path);
    if (e.dir) { ensureDir(p); continue; }
    ensureDir(dirname(p));
    if (lstatSync(p, { throwIfNoEntry: false })) refuse(`backup tar: an entry (path sha256 ${sha256(e.path).slice(0, 12)}) is a file where a directory was written`);
    const fd = openSync(p, 'wx', e.exec ? 0o700 : 0o600);
    try {
      for (let at = 0; at < e.data.length;) {
        const n = writeSync(fd, e.data, at);
        if (n <= 0) refuse(`backup tar: an entry (path sha256 ${sha256(e.path).slice(0, 12)}) could not be written in full`);
        at += n;
      }
    } finally { closeSync(fd); }
    files++;
  }
  return files;
}

/** A fresh 0700 intake directory under root (default INTAKE_ROOT), named for this process and its start ticks; refused
 *  inside a git work tree, under the Capy drive, or when root is a symbolic link. */
export function makeIntakeDir(root = INTAKE_ROOT): string {
  if (insideGitTree(root)) refuse(`the intake directory ${root} is inside a git work tree; an author's backup is unpacked outside every checkout`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) refuse(`the intake directory ${root} is a symbolic link; an author's backup is unpacked only into a real directory`);
  const real = realpathSync(root), drive = join(homedir(), '.capy', 'drive');
  if (real === drive || real.startsWith(drive + '/')) refuse(`the intake directory ${root} is under the Capy drive (${drive}); an author's backup is never unpacked there`);
  chmodSync(root, 0o700);
  const dir = join(root, `intake-${process.pid}-${startTicks(process.pid) ?? 0}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
}

/** Remove an intake directory and confirm it is gone. */
export function removeIntakeDir(dir: string): boolean {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* checked below */ }
  return !existsSync(dir);
}

/** Remove the intake directories under root (default INTAKE_ROOT) whose process no longer runs, as a SIGKILL or a machine
 *  stop leaves them. A directory's name holds the pid and that process's start ticks; a running process with that pid and
 *  other start ticks is a reused pid, so the directory is stale. seal.ts sweeps before it makes its own directory, so
 *  a directory named for this process is stale too. Returns what was removed, what could not be, and what a live process
 *  still holds. */
export function sweepStaleIntake(root = INTAKE_ROOT): { removed: string[]; failed: string[]; kept: string[] } {
  const removed: string[] = [], failed: string[] = [], kept: string[] = [];
  if (!existsSync(root)) return { removed, failed, kept };
  for (const name of readdirSync(root).sort()) {
    const m = INTAKE_NAME.exec(name);
    const p = join(root, name);
    if (!m) continue;
    const pid = Number(m[1]);
    const recorded = Number(m[2]), ticks = startTicks(pid);
    if (pid !== process.pid && running(pid) && (recorded === 0 || ticks === undefined || ticks === recorded)) { kept.push(p); continue; }
    (removeIntakeDir(p) ? removed : failed).push(p);
  }
  return { removed, failed, kept };
}
