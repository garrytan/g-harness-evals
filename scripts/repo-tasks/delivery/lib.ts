// Shared helpers for the gstack-delivery-v1 build: a seeded generator, a deterministic tar writer and reader, and git
// run with no user or system configuration.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

export const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

/** A deterministic generator: a sha256 chain over the seed. */
export class Rng {
  private state: Buffer;
  private pool: number[] = [];
  constructor(seed: string) { this.state = createHash('sha256').update(seed).digest(); }
  next(): number {
    if (!this.pool.length) {
      this.state = createHash('sha256').update(this.state).digest();
      for (let i = 0; i < 32; i += 4) this.pool.push(this.state.readUInt32BE(i));
    }
    return this.pool.shift()!;
  }
  int(n: number): number { return this.next() % n; }
  hex(n: number): string { let s = ''; while (s.length < n) s += this.next().toString(16).padStart(8, '0'); return s.slice(0, n); }
  shuffle<T>(xs: T[]): T[] {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export interface Entry { data: Buffer; mode: number }
export type Tree = Map<string, Entry>;

// 2025-10-01 12:00 UTC, the mtime of every tar entry (as in gstack-native-v1).
const MTIME = 1759320000;

function octal(n: number, len: number): string { return n.toString(8).padStart(len - 1, '0') + '\0'; }

function header(path: string, size: number, mode: number, type: '0' | '5'): Buffer {
  const h = Buffer.alloc(512);
  let name = path, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const parts = path.replace(/\/$/, '').split('/');
    const slash = path.endsWith('/') ? '/' : '';
    let i = 1;
    for (; i < parts.length; i++) {
      prefix = parts.slice(0, i).join('/'); name = parts.slice(i).join('/') + slash;
      if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) break;
    }
    if (i === parts.length) throw new Error('path too long for ustar: ' + path);
  }
  h.write(name, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100); h.write(octal(0, 8), 108); h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124); h.write(octal(MTIME, 12), 136);
  h.write('        ', 148); h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** A ustar archive with sorted entries, every parent directory listed, root owner and a fixed mtime. */
export function writeTar(tree: Tree, root = '.'): Buffer {
  const dirs = new Set<string>();
  for (const p of tree.keys()) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const names = [...new Set([...dirs, ...tree.keys()])].sort();
  const out: Buffer[] = [];
  if (root) out.push(header(root + '/', 0, 0o755, '5'));
  for (const n of names) {
    const full = (root ? root + '/' : '') + n;
    if (dirs.has(n)) { out.push(header(full + '/', 0, 0o755, '5')); continue; }
    const e = tree.get(n)!;
    out.push(header(full, e.data.length, e.mode, '0'), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) out.push(Buffer.alloc(pad));
  }
  out.push(Buffer.alloc(1024));
  let buf = Buffer.concat(out);
  const rec = 10240;
  if (buf.length % rec) buf = Buffer.concat([buf, Buffer.alloc(rec - (buf.length % rec))]);
  return buf;
}

/** Reads archives written by writeTar (regular files and directories only). */
export function readTar(buf: Buffer, root = '.'): Tree {
  const tree: Tree = new Map();
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, l: number) => h.subarray(a, a + l).toString('utf8').replace(/\0[\s\S]*$/, '');
    const name = str(0, 100), prefix = str(345, 155);
    let path = prefix ? prefix + '/' + name : name;
    const size = parseInt(str(124, 12).trim() || '0', 8), mode = parseInt(str(100, 8).trim(), 8), type = str(156, 1) || '0';
    off += 512;
    if (type === '5') continue;
    if (type !== '0') throw new Error('unsupported tar entry type ' + type + ' at ' + path);
    if (root) path = path.slice(root.length + 1);
    tree.set(path, { data: Buffer.from(buf.subarray(off, off + size)), mode });
    off += Math.ceil(size / 512) * 512;
  }
  return tree;
}

// HOME is the parent of the working directory, so nothing a git wrapper writes under HOME lands in the tree.
const GIT_ENV = (home: string) => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });

export function git(cwd: string, args: string[], extra: Record<string, string> = {}, allowFail = false): string {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'gc.auto=0', '-c', 'index.version=2', '-c', 'core.compression=9', '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false', ...args], { cwd, env: { ...GIT_ENV(dirname(cwd)), ...extra }, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr?.toString() ?? ''));
  return r.stdout?.toString() ?? '';
}

/** Identity and date for one commit: day n after 2026-09-01, at noon UTC. */
export function commitEnv(day: number, name = 'Maintainer', email = 'maintainer@example.com'): Record<string, string> {
  const d = new Date(Date.UTC(2026, 8, 1 + day, 12, 0, 0)).toISOString().replace('.000Z', '+00:00');
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: d, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: d };
}

/** Rewrites a version 2 git index with zeroed stat fields (times, device, inode, owner) and a fresh checksum. */
export function normalizeIndex(buf: Buffer): Buffer {
  const b = Buffer.from(buf);
  if (b.toString('latin1', 0, 4) !== 'DIRC' || b.readUInt32BE(4) !== 2) throw new Error('expected a version 2 index');
  const n = b.readUInt32BE(8);
  let off = 12;
  for (let i = 0; i < n; i++) {
    for (const f of [0, 4, 8, 12, 16, 20, 28, 32]) b.writeUInt32BE(0, off + f);
    const flags = b.readUInt16BE(off + 60);
    if (flags & 0x4000) throw new Error('extended index flags are not supported');
    off += Math.floor((62 + (flags & 0xfff) + 8) / 8) * 8;
  }
  const body = b.subarray(0, b.length - 20);
  return Buffer.concat([body, createHash('sha1').update(body).digest()]);
}
