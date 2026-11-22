#!/usr/bin/env bun
// Raw trial-data archives (docs/raw-archive.md): every file a run left behind, stripped of keys, tokens, sealed
// material and personal data, packed as one zstd-compressed tar split into parts, with a manifest that names every
// part's sha256. The manifest's sha256 is the content hash a report links.
//
//   bun scripts/archive/raw.ts pack --run-id <id> --src <dir>[=<name>] ... --out <dir> [--exclude <glob>=<reason>] ... [--expand-archives] [--level <n>] [--part-mb <n>]
//   bun scripts/archive/raw.ts verify --dir <dir> [--sha256 <manifest digest>]
//   bun scripts/archive/raw.ts publish --dir <dir> --repo <owner/name> [--tag <tag>]
//   bun scripts/archive/raw.ts fetch --url <manifest url> --sha256 <digest> --out <dir> [--extract <dir>]
//   bun scripts/archive/raw.ts link [--check]        (writes or checks each report's data-archive block from docs/archive/index.json)
//
// Nothing is printed from a file's contents: hits are named by pattern and path only. Exit 0 on success, 2 on any refusal.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ALLOW, TOKEN_PATTERNS } from '../publish-audit.ts';

export const SCHEMA = 'harness-evals/raw-archive/1';
export const INDEX_SCHEMA = 'harness-evals/archive-index/1';
const ROOT = resolve(import.meta.dir, '..', '..');
const INDEX = join(ROOT, 'docs/archive/index.json');
const MiB = 1024 * 1024;
const IN_MEMORY_MAX = 1024 * MiB;
const COMPRESSED_MAGIC = [[0x1f, 0x8b], [0x28, 0xb5, 0x2f, 0xfd], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], [0x42, 0x5a, 0x68], [0x50, 0x4b, 0x03, 0x04]];

const p = (...parts: string[]) => parts.join('');
/** Patterns beyond publish-audit's: other key and token shapes that can sit in a transcript, a capture or a config. */
export const EXTRA_PATTERNS: Record<string, RegExp> = {
  private_key: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  age_identity: new RegExp(p('AGE-SECRET', '-KEY-1[0-9A-Z]{50,}'), 'g'),
  github_other: new RegExp(p('\\bgh', '[ousr]_[A-Za-z0-9]{36,}'), 'g'),
  huggingface: new RegExp(p('\\bh', 'f_[A-Za-z0-9]{30,}'), 'g'),
  basic_auth: new RegExp(p('\\bBas', 'ic\\s+[A-Za-z0-9+/]{20,}={0,2}'), 'g'),
  key_assignment: /\b[A-Z][A-Z0-9_]*(?:API_KEY|_TOKEN|_SECRET|PASSWORD)\s*[=:]\s*["']?(?!\[REDACTED)[^\s"'$<{]{12,}/g,
  auth_header: /"(?:x-api-key|authorization|api-key|x-goog-api-key|proxy-authorization)"\s*:\s*"(?!\[REDACTED)[^"]{16,}"/gi,
  run_token: new RegExp(p('\\b(?:sk-tri', 'al-[A-Za-z0-9_-]{6,}|trial-tok', 'en:[A-Za-z0-9_-]{6,})'), 'g'),
  personal: /wintermute/gi,
};
const ALL_PATTERNS: [string, RegExp][] = [...Object.entries(TOKEN_PATTERNS), ...Object.entries(EXTRA_PATTERNS)];

/** Paths that never leave the machine, whatever they hold. */
export const DROP_RULES: { name: string; re: RegExp; reason: string }[] = [
  { name: 'sealed', re: /(^|\/)[^/]*(sealed|custody|held-?out)[^/]*(\/|$)/i, reason: 'sealed, custody or held-out task material' },
  { name: 'age', re: /(\.age|\.age-key|identity\.age[^/]*)$/i, reason: 'age identity or ciphertext' },
  { name: 'ssh', re: /(^|\/)\.ssh(\/|$)|(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$|\.pem$|(^|\/)(ubi-state|ubi-runner-state|ubirun-[^/]*)(\/|$)/i, reason: 'SSH key or runner VM access state' },
  { name: 'credentials', re: /(^|\/)(\.env(\.[^/]*)?|\.netrc|\.git-credentials|hosts\.yml|keys\.env|secrets?\.(json|env|ya?ml))$/i, reason: 'credentials file' },
  { name: 'set-r', re: /(^|\/)(set-?r|setR[^/]*)(\/|$)|(^|\/)setR\.jsonl$/i, reason: 'private real-user turns (Set R)' },
  { name: 'sqlite-shm', re: /\.sqlite-shm$/, reason: 'SQLite shared-memory index, rebuilt on open' },
];

const allowed = (hit: string) => ALLOW.some((a) => a.test(hit)) && !/sk-trial-/.test(hit);
const isBinary = (b: Uint8Array) => b.subarray(0, 8192).includes(0);

/** Redact every hit in place of its text (text files) or mask it with X of the same length (binary files, so their
 *  structure survives). Returns the new bytes and the hit counts by pattern. */
export function strip(data: Uint8Array): { out: Uint8Array; hits: Record<string, number> } {
  const binary = isBinary(data);
  let s = Buffer.from(data).toString('latin1');
  const hits: Record<string, number> = {};
  for (let pass = 0; pass < 4; pass++) if (!stripPass()) break;
  return { out: Object.keys(hits).length ? new Uint8Array(Buffer.from(s, 'latin1')) : data, hits };

  // Masking can make a new match (a masked value after "Bearer " reads as a token), so passes repeat until one finds nothing.
  function stripPass(): boolean {
  let found = false;
  for (const [name, re] of ALL_PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    s = s.replace(re, (m) => {
      if (allowed(m)) return m;
      hits[name] = (hits[name] ?? 0) + 1;
      found = true;
      return binary ? 'X'.repeat(m.length) : '[REDACTED:' + name + ']';
    });
  }
  return found;
  }
}

/** Hit counts without changing anything: the scan over a finished archive. */
export function scan(data: Uint8Array): Record<string, number> {
  const s = Buffer.from(data).toString('latin1');
  const hits: Record<string, number> = {};
  for (const [name, re] of ALL_PATTERNS) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) if (!allowed(m[0])) hits[name] = (hits[name] ?? 0) + 1;
  }
  return hits;
}

export function dropReason(rel: string): { name: string; reason: string } | null {
  for (const r of DROP_RULES) if (r.re.test(rel)) return r;
  return null;
}

// ---- tar (ustar with PAX path and size records) ----------------------------------------------------------------
const enc = new TextEncoder();
function header(name: string, size: number, mtime: number, type: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (off: number, len: number, v: string) => h.set(enc.encode(v).subarray(0, len), off);
  const oct = (off: number, len: number, n: number) => put(off, len, n.toString(8).padStart(len - 1, '0') + '\0');
  put(0, 100, name);
  oct(100, 8, 0o644); oct(108, 8, 0); oct(116, 8, 0);
  oct(124, 12, size < 8 ** 11 ? size : 0); oct(136, 12, Math.max(0, Math.floor(mtime)));
  put(148, 8, '        '); put(156, 1, type); put(257, 6, 'ustar\0'); put(263, 2, '00');
  let sum = 0; for (const b of h) sum += b;
  put(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}
function paxRecord(key: string, value: string): string {
  const body = ' ' + key + '=' + value + '\n';
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return len + body;
}
const pad = (n: number) => new Uint8Array((512 - (n % 512)) % 512);
export function entryHead(path: string, size: number, mtime: number): Uint8Array[] {
  const ascii = /^[\x20-\x7e]*$/.test(path);
  const out: Uint8Array[] = [];
  if (!ascii || path.length > 99 || size >= 8 ** 11) {
    const rec = enc.encode((path.length > 99 || !ascii ? paxRecord('path', path) : '') + (size >= 8 ** 11 ? paxRecord('size', String(size)) : ''));
    out.push(header('PaxHeader', rec.length, 0, 'x'), rec, pad(rec.length));
  }
  out.push(header(ascii ? path.slice(0, 99) : 'file', size, mtime, '0'));
  return out;
}

/** Read a tar stream entry by entry. Calls onEntry with each regular file's path and bytes. */
export async function readTar(stream: ReadableStream<Uint8Array>, onEntry: (path: string, data: Uint8Array) => void): Promise<number> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  let done = false;
  const need = async (n: number) => {
    while (have < n && !done) { const r = await reader.read(); if (r.done) done = true; else { chunks.push(r.value); have += r.value.length; } }
    return have >= n;
  };
  const take = (n: number) => {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const c = chunks[0]!;
      const k = Math.min(c.length, n - off);
      out.set(c.subarray(0, k), off);
      off += k;
      if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
    }
    have -= n;
    return out;
  };
  const str = (b: Uint8Array) => { const i = b.indexOf(0); return Buffer.from(i >= 0 ? b.subarray(0, i) : b).toString('utf8'); };
  let count = 0;
  let pax: Record<string, string> = {};
  for (;;) {
    if (!(await need(512))) throw new Error('truncated tar: no end block');
    const h = take(512);
    if (h.every((x) => x === 0)) return count;
    const type = String.fromCharCode(h[156]!);
    let size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    if (pax.size) size = Number(pax.size);
    const name = pax.path ?? str(h.subarray(0, 100));
    const total = size + ((512 - (size % 512)) % 512);
    if (!(await need(total))) throw new Error('truncated tar entry ' + name);
    const data = take(total).subarray(0, size);
    if (type === 'x') { pax = {}; for (const line of Buffer.from(data).toString('utf8').split('\n')) { const m = /^\d+ ([^=]+)=(.*)$/.exec(line); if (m) pax[m[1]!] = m[2]!; } continue; }
    pax = {};
    if (type === '0' || type === '\0') { onEntry(name, data); count++; }
  }
}

// ---- pack -------------------------------------------------------------------------------------------------------
interface Agg { count: number; bytes: number; examples: string[] }
const bump = (m: Record<string, Agg>, k: string, bytes: number, ex: string) => { const a = (m[k] ??= { count: 0, bytes: 0, examples: [] }); a.count++; a.bytes += bytes; if (a.examples.length < 5) a.examples.push(ex); };
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

function walk(dir: string, base: string, out: { abs: string; rel: string; kind: 'file' | 'link' | 'other' }[]) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = lstatSync(abs);
    if (st.isDirectory()) walk(abs, rel, out);
    else out.push({ abs, rel, kind: st.isFile() ? 'file' : st.isSymbolicLink() ? 'link' : 'other' });
  }
}

function globRe(glob: string): RegExp {
  const s = glob.replace(/[.+^$|()[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp('^' + s + '(/.*)?$');
}

export interface PackOptions { runId: string; sources: { path: string; as: string }[]; out: string; excludes: { glob: string; reason: string }[]; expandArchives: boolean; level: number; partBytes: number; note?: string }

export async function pack(o: PackOptions) {
  mkdirSync(o.out, { recursive: true });
  const prefix = join(o.out, o.runId + '.raw.tar.zst');
  for (const f of readdirSync(o.out)) if (f.startsWith(basename(prefix))) rmSync(join(o.out, f));
  const proc = Bun.spawn(['sh', '-c', 'zstd -T0 -' + o.level + ' -q -c | split -b ' + o.partBytes + ' -d -a 3 - "$0".part-', prefix], { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  const sink = proc.stdin;
  let pending = 0;
  const write = async (b: Uint8Array) => { if (!b.length) return; sink.write(b); pending += b.length; if (pending > 8 * MiB) { await sink.flush(); pending = 0; } };
  const excluded: Record<string, Agg> = {};
  const redactions: Record<string, { files: number; hits: number }> = {};
  const stripLog: string[] = [];
  const files: string[] = [];
  const emailDomains: Record<string, number> = {};
  const userEx = o.excludes.map((e) => ({ ...e, re: globRe(e.glob) }));
  let bytesIn = 0;
  let bytesOut = 0;
  const tmpRoots: string[] = [];

  const addBytes = async (rel: string, data: Uint8Array, mtime: number) => {
    const { out, hits } = strip(data);
    if (Object.keys(hits).length) {
      for (const [k, n] of Object.entries(hits)) { const r = (redactions[k] ??= { files: 0, hits: 0 }); r.files++; r.hits += n; }
      stripLog.push(JSON.stringify({ path: rel, action: isBinary(data) ? 'masked' : 'redacted', hits }));
    }
    if (!isBinary(out)) for (const m of Buffer.from(out.subarray(0, 4 * MiB)).toString('latin1').matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) { const d = m[1]!.toLowerCase(); emailDomains[d] = (emailDomains[d] ?? 0) + 1; }
    for (const part of entryHead(rel, out.length, mtime)) await write(part);
    await write(out); await write(pad(out.length));
    files.push(JSON.stringify({ path: rel, bytes: out.length, sha256: sha(out) }));
    bytesOut += out.length;
  };

  const addLarge = async (abs: string, rel: string, size: number, mtime: number) => {
    const fd = openSync(abs, 'r');
    const chunk = 64 * MiB, overlap = 16 * 1024;
    const buf = new Uint8Array(chunk + overlap);
    let hit = false;
    for (let off = 0; off < size && !hit; off += chunk) {
      const n = readSync(fd, buf, 0, Math.min(chunk + overlap, size - off), off);
      if (Object.keys(scan(buf.subarray(0, n))).length) hit = true;
    }
    if (hit) { closeSync(fd); bump(excluded, 'secret-in-large-file', size, rel); return; }
    for (const part of entryHead(rel, size, mtime)) await write(part);
    const h = createHash('sha256');
    for (let off = 0; off < size; off += chunk) { const n = readSync(fd, buf, 0, Math.min(chunk, size - off), off); const piece = buf.slice(0, n); h.update(piece); await write(piece); }
    closeSync(fd);
    await write(pad(size));
    files.push(JSON.stringify({ path: rel, bytes: size, sha256: h.digest('hex') }));
    bytesOut += size;
  };

  const addTree = async (dir: string, base: string): Promise<void> => {
    const list: { abs: string; rel: string; kind: 'file' | 'link' | 'other' }[] = [];
    walk(dir, base, list);
    for (const f of list) {
      const size = f.kind === 'file' ? statSync(f.abs).size : 0;
      bytesIn += size;
      if (Object.keys(scan(enc.encode(f.rel))).length) { bump(excluded, 'secret-in-path', size, '[path withheld]'); continue; }
      if (f.kind !== 'file') { bump(excluded, f.kind === 'link' ? 'symlink' : 'special-file', 0, f.rel); continue; }
      const st = statSync(f.abs);
      const drop = dropReason(f.rel);
      if (drop) { bump(excluded, drop.name, st.size, f.rel); continue; }
      const ux = userEx.find((e) => e.re.test(f.rel.split('/').slice(1).join('/')) || e.re.test(f.rel));
      if (ux) { bump(excluded, 'excluded:' + ux.glob, st.size, f.rel); continue; }
      const lower = f.rel.toLowerCase();
      const tarKind = /\.(tar\.zst|tar\.gz|tgz|tar)$/.exec(lower)?.[1];
      if (tarKind) {
        if (!o.expandArchives) { bump(excluded, 'unexpanded-archive', st.size, f.rel); continue; }
        const tmp = mkdtempSync(join(o.out, '.expand-')); tmpRoots.push(tmp);
        const flag = tarKind === 'tar.zst' ? ['--zstd'] : tarKind === 'tar' ? [] : ['-z'];
        const x = Bun.spawnSync(['tar', '-x', ...flag, '--no-same-owner', '--no-same-permissions', '-f', f.abs, '-C', tmp], { stdout: 'pipe', stderr: 'pipe' });
        if (x.exitCode !== 0) { bump(excluded, 'unreadable-archive', st.size, f.rel); rmSync(tmp, { recursive: true, force: true }); continue; }
        await addTree(tmp, f.rel + '.d');
        rmSync(tmp, { recursive: true, force: true });
        continue;
      }
      if (/\.(zst|gz|bz2|xz|zip|7z)$/.test(lower)) {
        if (st.size > IN_MEMORY_MAX || !/\.(zst|gz)$/.test(lower)) { bump(excluded, 'compressed-unscannable', st.size, f.rel); continue; }
        const raw = readFileSync(f.abs);
        let data: Uint8Array | null = null;
        try {
          if (lower.endsWith('.gz')) data = new Uint8Array(gunzipSync(raw, { maxOutputLength: IN_MEMORY_MAX }));
          else { const z = Bun.spawnSync(['zstd', '-dc', '--', f.abs], { stdout: 'pipe', stderr: 'pipe', maxBuffer: IN_MEMORY_MAX } as never); data = z.success ? new Uint8Array(z.stdout) : null; }
        } catch { data = null; }
        if (!data) { bump(excluded, 'compressed-unscannable', st.size, f.rel); continue; }
        if (COMPRESSED_MAGIC.some((m) => m.every((b, i) => data![i] === b))) { bump(excluded, 'compressed-nested', st.size, f.rel); continue; }
        if (data.length > 262 && Buffer.from(data.subarray(257, 262)).toString('latin1') === 'ustar') {
          if (!o.expandArchives) { bump(excluded, 'unexpanded-archive', st.size, f.rel); continue; }
          const tmp = mkdtempSync(join(o.out, '.expand-')); tmpRoots.push(tmp);
          const x = Bun.spawnSync(['tar', '-x', '--no-same-owner', '--no-same-permissions', '-f', '-', '-C', tmp], { stdin: data, stdout: 'pipe', stderr: 'pipe' });
          if (x.exitCode !== 0) { bump(excluded, 'unreadable-archive', st.size, f.rel); rmSync(tmp, { recursive: true, force: true }); continue; }
          await addTree(tmp, f.rel + '.d');
          rmSync(tmp, { recursive: true, force: true });
          continue;
        }
        await addBytes(f.rel.replace(/\.(zst|gz)$/i, ''), data, st.mtimeMs / 1000);
        continue;
      }
      if (st.size > IN_MEMORY_MAX) await addLarge(f.abs, f.rel, st.size, st.mtimeMs / 1000);
      else await addBytes(f.rel, new Uint8Array(readFileSync(f.abs)), st.mtimeMs / 1000);
    }
  };

  for (const s of o.sources) await addTree(resolve(s.path), s.as);
  const sorted = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 60));
  const filesBlob = enc.encode(files.join('\n') + '\n');
  const logBlob = enc.encode(stripLog.join('\n') + (stripLog.length ? '\n' : ''));
  for (const [name, blob] of [['_archive/files.jsonl', filesBlob], ['_archive/strip-log.jsonl', logBlob]] as const) {
    for (const part of entryHead(name, blob.length, 0)) await write(part);
    await write(blob); await write(pad(blob.length));
  }
  await write(new Uint8Array(1024));
  await sink.flush(); sink.end();
  const code = await proc.exited;
  for (const t of tmpRoots) rmSync(t, { recursive: true, force: true });
  if (code !== 0) throw new Error('zstd or split failed with exit ' + code);
  const parts = readdirSync(o.out).filter((f) => f.startsWith(basename(prefix) + '.part-')).sort().map((name) => {
    const h = createHash('sha256'); const fd = openSync(join(o.out, name), 'r'); const b = new Uint8Array(64 * MiB); let n: number; let size = 0;
    while ((n = readSync(fd, b, 0, b.length, null)) > 0) { h.update(b.subarray(0, n)); size += n; }
    closeSync(fd);
    return { name, bytes: size, sha256: h.digest('hex') };
  });
  writeFileSync(join(o.out, o.runId + '.files.jsonl.gz'), gzipSync(filesBlob, { level: 9 }));
  writeFileSync(join(o.out, o.runId + '.strip-log.jsonl.gz'), gzipSync(logBlob, { level: 9 }));
  const manifest = {
    schema: SCHEMA, run_id: o.runId, note: o.note ?? null,
    sources: o.sources.map((s) => ({ name: s.as })),
    tool: { script: 'scripts/archive/raw.ts', patterns: ALL_PATTERNS.map(([n]) => n), drop_rules: DROP_RULES.map((r) => ({ name: r.name, reason: r.reason })) },
    totals: { files: files.length, bytes_in: bytesIn, bytes_packed: bytesOut, bytes_compressed: parts.reduce((a, x) => a + x.bytes, 0) },
    parts,
    files_list: { name: o.runId + '.files.jsonl.gz', sha256: sha(readFileSync(join(o.out, o.runId + '.files.jsonl.gz'))), inside: '_archive/files.jsonl' },
    strip_log: { name: o.runId + '.strip-log.jsonl.gz', sha256: sha(readFileSync(join(o.out, o.runId + '.strip-log.jsonl.gz'))), inside: '_archive/strip-log.jsonl', files_changed: stripLog.length },
    redactions, excluded: Object.fromEntries(Object.entries(excluded).map(([k, a]) => [k, { ...a, reason: DROP_RULES.find((r) => r.name === k)?.reason ?? (o.excludes.find((e) => 'excluded:' + e.glob === k)?.reason ?? k) }])),
    user_excludes: o.excludes, review: { email_domains: sorted(emailDomains) },
    how_to_read: 'cat the parts in order | zstd -dc | tar -x; check each part against its sha256 first (docs/raw-archive.md)',
  };
  const mpath = join(o.out, o.runId + '.manifest.json');
  writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest: mpath, sha256: sha(readFileSync(mpath)), parts: parts.length, files: files.length, redacted_files: stripLog.length };
}

// ---- verify: the scan over the finished archive ----------------------------------------------------------------
export async function verifyDir(dir: string, runId?: string, digest?: string) {
  const man = readdirSync(dir).find((f) => f.endsWith('.manifest.json') && (!runId || f === runId + '.manifest.json'));
  if (!man) throw new Error('no manifest in ' + dir);
  const mbytes = readFileSync(join(dir, man));
  if (digest && sha(mbytes) !== digest) throw new Error('manifest sha256 does not match the linked digest');
  const m = JSON.parse(mbytes.toString('utf8'));
  if (m.schema !== SCHEMA) throw new Error('unknown schema ' + m.schema);
  for (const part of m.parts) {
    const h = createHash('sha256'); const fd = openSync(join(dir, part.name), 'r'); const b = new Uint8Array(64 * MiB); let n: number; let size = 0;
    while ((n = readSync(fd, b, 0, b.length, null)) > 0) { h.update(b.subarray(0, n)); size += n; }
    closeSync(fd);
    if (size !== part.bytes || h.digest('hex') !== part.sha256) throw new Error('part ' + part.name + ' does not match the manifest');
  }
  const cat = Bun.spawn(['sh', '-c', 'cat "$@" | zstd -dc', 'sh', ...m.parts.map((x: { name: string }) => join(dir, x.name))], { stdout: 'pipe', stderr: 'inherit' });
  const seen = new Map<string, string>();
  const leaks: Record<string, number> = {};
  const leakPaths: string[] = [];
  let listed: string | null = null;
  const n = await readTar(cat.stdout, (path, data) => {
    if (path === '_archive/files.jsonl') { listed = Buffer.from(data).toString('utf8'); return; }
    if (path.startsWith('_archive/')) return;
    seen.set(path, sha(data));
    const inPath = Object.keys(scan(enc.encode(path)));
    const shown = inPath.length ? '[path withheld]' : path;
    if (inPath.length) { leaks['secret-in-path'] = (leaks['secret-in-path'] ?? 0) + 1; if (leakPaths.length < 20) leakPaths.push(shown + ' (' + inPath.join(',') + ')'); }
    const hits = scan(data);
    if (Object.keys(hits).length) { for (const [k, v] of Object.entries(hits)) leaks[k] = (leaks[k] ?? 0) + v; if (leakPaths.length < 20) leakPaths.push(shown + ' (' + Object.keys(hits).join(',') + ')'); }
    if (dropReason(path)) { leaks['drop-rule-path'] = (leaks['drop-rule-path'] ?? 0) + 1; if (leakPaths.length < 20) leakPaths.push(shown); }
  });
  if ((await cat.exited) !== 0) throw new Error('zstd could not read the parts');
  let mismatched = 0;
  const list = (listed ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { path: string; sha256: string });
  for (const f of list) if (seen.get(f.path) !== f.sha256) mismatched++;
  if (list.length !== seen.size) mismatched += Math.abs(list.length - seen.size);
  const ok = !Object.keys(leaks).length && !mismatched && seen.size === m.totals.files;
  return { ok, manifest_sha256: sha(mbytes), entries: n - 2, files: seen.size, mismatched, leaks, leak_paths: leakPaths };
}

// ---- publish and fetch (GitHub release assets through gh) -----------------------------------------------------------
function gh(args: string[]) {
  const r = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error('gh ' + args.slice(0, 3).join(' ') + ' failed: ' + r.stderr.toString().trim().split('\n').pop());
  return r.stdout.toString();
}
export function publish(dir: string, repo: string, tag?: string) {
  const man = readdirSync(dir).find((f) => f.endsWith('.manifest.json'))!;
  const m = JSON.parse(readFileSync(join(dir, man), 'utf8'));
  const t = tag ?? 'raw-' + m.run_id;
  const assets = [man, m.files_list.name, m.strip_log.name, ...m.parts.map((x: { name: string }) => x.name)];
  const exists = Bun.spawnSync(['gh', 'release', 'view', t, '-R', repo, '--json', 'tagName'], { stdout: 'pipe', stderr: 'pipe' }).exitCode === 0;
  if (!exists) gh(['release', 'create', t, '--target', 'main', '-R', repo, '--title', m.run_id + ' raw trial data', '--notes', 'Stripped raw trial data for ' + m.run_id + '. Manifest sha256 ' + sha(readFileSync(join(dir, man))) + '. Format: docs/raw-archive.md.']);
  for (const a of assets) gh(['release', 'upload', t, '-R', repo, '--clobber', join(dir, a)]);
  const view = JSON.parse(gh(['release', 'view', t, '-R', repo, '--json', 'assets']));
  const want = new Map<string, string>(assets.map((a) => [a, sha(readFileSync(join(dir, a)))]));
  const bad = [...want].filter(([name, digest]) => !view.assets.some((x: { name: string; digest?: string }) => x.name === name && x.digest === 'sha256:' + digest));
  if (bad.length) throw new Error('uploaded assets do not match: ' + bad.map((b) => b[0]).join(', '));
  return { repo, tag: t, manifest_url: 'https://github.com/' + repo + '/releases/download/' + t + '/' + man, manifest_sha256: want.get(man), assets: assets.length, bytes: m.totals.bytes_compressed };
}
export function fetchArchive(url: string, digest: string, out: string) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+\.manifest\.json)$/.exec(url);
  if (!m) throw new Error('not a release manifest URL: ' + url);
  mkdirSync(out, { recursive: true });
  const get = (name: string) => { const r = Bun.spawnSync(['gh', 'release', 'download', m[2]!, '-R', m[1]!, '-p', name, '-D', out, '--clobber'], { stdout: 'pipe', stderr: 'pipe' }); if (r.exitCode !== 0) { const c = Bun.spawnSync(['curl', '-sSfL', '-o', join(out, name), url.replace(/[^/]+$/, name)]); if (c.exitCode !== 0) throw new Error('could not download ' + name); } };
  get(m[3]!);
  if (sha(readFileSync(join(out, m[3]!))) !== digest) throw new Error('manifest sha256 does not match');
  const man = JSON.parse(readFileSync(join(out, m[3]!), 'utf8'));
  for (const part of man.parts) get(part.name);
  return out;
}

// ---- index and report links ---------------------------------------------------------------------------------------
export interface RawRef { visibility: 'private' | 'public'; manifest_url: string; manifest_sha256: string; bytes: number; files: number; parts: number; why_private?: string; covers?: string }
export interface IndexEntry {
  status: 'archived' | 'partial' | 'not-archived';
  reason?: string;
  raw?: RawRef[];
  bundle?: { url: string; sha256: string; bytes: number } | null;
}
/** other: private archives of working files that belong to no run folder (drive clean-ups), keyed by archive id. */
export interface ArchiveIndex { schema: string; runs: Record<string, IndexEntry>; other?: Record<string, RawRef> }
export const START = '<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->';
export const END = '<!-- data-archive:end -->';
const gb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(1) + ' MB');

export function block(run: string, e: IndexEntry): string {
  const lines = [START, '## Data archive', ''];
  for (const r of e.raw ?? []) lines.push('- **Raw trial data (' + r.visibility + '):** [' + basename(r.manifest_url) + '](' + r.manifest_url + '), sha256 \`' + r.manifest_sha256 + '\`. ' + r.files.toLocaleString('en-US') + ' files, ' + gb(r.bytes) + ' compressed in ' + r.parts + ' part' + (r.parts === 1 ? '' : 's') + (r.covers ? ', covering ' + r.covers : '') + '. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed.' + (r.why_private ? ' Private because ' + r.why_private + '.' : ''));
  if (e.bundle) lines.push('- **Trial bundle (public):** [' + basename(e.bundle.url) + '](' + e.bundle.url + '), sha256 \`' + e.bundle.sha256 + '\`. Check it with \`bun scripts/bundle.ts verify <file> --sha256 <digest>\` ([trial-bundle.md](../../trial-bundle.md)).');
  if (e.status !== 'archived' && e.reason) lines.push('- **Not archived' + (e.status === 'partial' ? ' in full' : '') + ':** ' + e.reason);
  lines.push('- Format and how to check a download: [raw-archive.md](../../raw-archive.md).', '', END);
  return lines.join('\n');
}
/** The data-archive block lives in the run folder's reproduce.md, never in report.md: most reports are hash-pinned by
 *  their preregistration, and a sibling page can change after the results merge without touching a pin. */
export function reproduceFile(root: string, run: string): { path: string; fresh: string } {
  const dir = join(root, 'docs/benchmarks', run);
  const report = ['report.md', 'README.md', 'PREREGISTRATION.md'].find((f) => existsSync(join(dir, f)));
  return { path: join(dir, 'reproduce.md'), fresh: '# Reproduce and inspect: ' + run + '\n\n' + (report ? 'The [report](' + report + ') stays as published; the data behind it is linked here.\n' : 'The data behind this run is linked here.\n') };
}
export function applyBlock(text: string, b: string): string {
  const s = text.indexOf(START), e = text.indexOf(END);
  if (s >= 0 && e > s) return text.slice(0, s) + b + text.slice(e + END.length);
  const d = text.search(/^## Disclosures?\b/m);
  if (d >= 0) return text.slice(0, d) + b + '\n\n' + text.slice(d);
  return text.replace(/\s*$/, '\n\n') + b + '\n';
}
export function readIndex(path = INDEX): ArchiveIndex { return JSON.parse(readFileSync(path, 'utf8')); }
const REPORTS = 'docs/scoreboard/reports.json';
function reportsRows(root: string): { folder: string; reproduce?: string }[] { return JSON.parse(readFileSync(join(root, REPORTS), 'utf8')).reports; }

/** Problems with the index and the report links. A run folder whose results/ holds trials.jsonl needs an entry. */
export function checkIndex(root = ROOT): string[] {
  const problems: string[] = [];
  const idx = readIndex(join(root, 'docs/archive/index.json'));
  if (idx.schema !== INDEX_SCHEMA) problems.push('docs/archive/index.json: schema must be ' + INDEX_SCHEMA);
  const bench = join(root, 'docs/benchmarks');
  const hasResults = (dir: string): boolean => { if (!existsSync(dir)) return false; for (const f of readdirSync(dir)) { const a = join(dir, f); const st = lstatSync(a); if (st.isDirectory() ? hasResults(a) : f === 'trials.jsonl') return true; } return false; };
  for (const run of readdirSync(bench).filter((d) => /^\d{4}-\d{2}/.test(d) && lstatSync(join(bench, d)).isDirectory())) {
    if (!hasResults(join(bench, run, 'results'))) continue;
    if (!idx.runs[run]) problems.push(run + ': has results but no entry in docs/archive/index.json; archive its raw data (docs/raw-archive.md) or add a not-archived entry with the reason');
  }
  const releaseUrl = /^https:\/\/github\.com\/garrytan\/g?-?harness-evals\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
  for (const [id, r] of Object.entries(idx.other ?? {})) {
    if (!releaseUrl.test(r.manifest_url) || basename(r.manifest_url) !== id + '.manifest.json') problems.push('other ' + id + ': manifest URL is not this archive\'s manifest in a release of this repository');
    if (!/^[0-9a-f]{64}$/.test(r.manifest_sha256 ?? '')) problems.push('other ' + id + ': sha256 must be 64 hex characters');
    if (!(r.covers && r.covers.length >= 20)) problems.push('other ' + id + ': needs a covers note of at least 20 characters');
  }
  for (const [run, e] of Object.entries(idx.runs)) {
    if (!['archived', 'partial', 'not-archived'].includes(e.status)) problems.push(run + ': unknown status ' + e.status);
    if (e.status !== 'archived' && !(e.reason && e.reason.length >= 20)) problems.push(run + ': a ' + e.status + ' entry needs a reason of at least 20 characters');
    if (e.status !== 'not-archived' && !e.raw?.length && !e.bundle) problems.push(run + ': ' + e.status + ' entry names no archive');
    for (const [what, url, digest] of [...(e.raw ?? []).map((r) => ['raw', r.manifest_url, r.manifest_sha256] as const), ['bundle', e.bundle?.url, e.bundle?.sha256] as const]) {
      if (url === undefined) continue;
      if (!releaseUrl.test(url)) problems.push(run + ': ' + what + ' URL is not a release asset of this repository');
      if (!/^[0-9a-f]{64}$/.test(digest ?? '')) problems.push(run + ': ' + what + ' sha256 must be 64 hex characters');
    }
    if (!existsSync(join(bench, run))) continue;
    const rep = reproduceFile(root, run).path;
    if (!existsSync(rep) || !readFileSync(rep, 'utf8').includes(block(run, e))) problems.push(relative(root, rep) + ': data-archive block is missing or stale; run bun scripts/archive/raw.ts link');
    const row = reportsRows(root).find((r) => r.folder === run);
    if (row && row.reproduce !== 'reproduce.md') problems.push('docs/scoreboard/reports.json: ' + run + ' needs "reproduce": "reproduce.md" so the index links its data; run bun scripts/archive/raw.ts link');
  }
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const all = (n: string) => argv.flatMap((a, i) => (a === '--' + n ? [argv[i + 1]!] : []));
  const one = (n: string) => all(n)[0];
  try {
    if (cmd === 'pack') {
      const runId = one('run-id'), out = one('out');
      if (!runId || !out || !all('src').length) throw new Error('pack needs --run-id, --out and at least one --src');
      const sources = all('src').map((s) => { const i = s.lastIndexOf('='); return i > 0 ? { path: s.slice(0, i), as: s.slice(i + 1) } : { path: s, as: basename(resolve(s)) }; });
      const excludes = all('exclude').map((s) => { const i = s.indexOf('='); if (i < 0) throw new Error('--exclude needs <glob>=<reason>'); return { glob: s.slice(0, i), reason: s.slice(i + 1) }; });
      const r = await pack({ runId, sources, out, excludes, expandArchives: argv.includes('--expand-archives'), level: Number(one('level') ?? 12), partBytes: Number(one('part-mb') ?? 1900) * MiB, note: one('note') });
      console.log('PACK: ' + JSON.stringify(r));
    } else if (cmd === 'verify') {
      const r = await verifyDir(one('dir')!, one('run-id'), one('sha256'));
      console.log('VERIFY: ' + JSON.stringify(r));
      process.exit(r.ok ? 0 : 2);
    } else if (cmd === 'publish') {
      console.log('PUBLISH: ' + JSON.stringify(publish(one('dir')!, one('repo') ?? 'garrytan/harness-evals', one('tag'))));
    } else if (cmd === 'fetch') {
      const out = fetchArchive(one('url')!, one('sha256')!, one('out')!);
      const r = await verifyDir(out, undefined, one('sha256'));
      console.log('FETCH: ' + JSON.stringify(r));
      if (r.ok && one('extract')) { mkdirSync(one('extract')!, { recursive: true }); const parts = readdirSync(out).filter((f) => /\.part-\d+$/.test(f)).sort().map((f) => join(out, f)); const x = Bun.spawnSync(['sh', '-c', 'cat "$@" | zstd -dc | tar -x -C "$0"', one('extract')!, ...parts]); if (x.exitCode !== 0) throw new Error('extract failed'); }
      process.exit(r.ok ? 0 : 2);
    } else if (cmd === 'link') {
      const idx = readIndex();
      let changed = 0;
      const reports = JSON.parse(readFileSync(join(ROOT, REPORTS), 'utf8'));
      let rowsChanged = 0;
      for (const [run, e] of Object.entries(idx.runs)) {
        if (!existsSync(join(ROOT, 'docs/benchmarks', run))) continue;
        const { path: rep, fresh } = reproduceFile(ROOT, run);
        const text = existsSync(rep) ? readFileSync(rep, 'utf8') : fresh;
        const next = applyBlock(text, block(run, e));
        if (next !== text || !existsSync(rep)) { changed++; if (!argv.includes('--check')) writeFileSync(rep, next); }
        const row = reports.reports.find((r: { folder: string }) => r.folder === run);
        if (row && row.reproduce !== 'reproduce.md') { row.reproduce = 'reproduce.md'; rowsChanged++; }
      }
      if (rowsChanged && !argv.includes('--check')) writeFileSync(join(ROOT, REPORTS), JSON.stringify(reports, null, 2) + '\n');
      const problems = argv.includes('--check') ? checkIndex() : [];
      console.log('LINK: ' + (argv.includes('--check') ? (problems.length ? 'stale' : 'ok') : 'wrote') + ' reports_changed=' + changed);
      for (const pr of problems) console.error('HE-ARCHIVE-001 ' + pr);
      process.exit(problems.length ? 2 : 0);
    } else {
      console.error('usage: bun scripts/archive/raw.ts pack|verify|publish|fetch|link (docs/raw-archive.md)');
      process.exit(2);
    }
  } catch (e) {
    console.error('HE-ARCHIVE-002 ' + (e as Error).message);
    process.exit(2);
  }
}
