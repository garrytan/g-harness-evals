// The private admission pack (schema harness-evals-admission-pack/1), pinned by sha256. It carries no plain value:
//   exact      one entry per private value window (name, part, len), with the keyed 16-bit prefilter of the window and
//              sha256(salt || window) to confirm a candidate;
//   patterns   regular expressions whose text would itself name a private thing (class key or private);
//   identities_blocked  sha256(salt || lower-case email) of addresses that may never appear in commit metadata;
//   shingles   salted digests of 8-word shingles of a private reference text: a file sharing threshold or more blocks.
// The prefilter reveals at most 16 bits per window (plan R15). For a window w of length L the rolling hash is
//   h = sum(w[i] * base^(L-1-i)) mod 2^32, and prefilter16 = (imul(h ^ seed, mix) >>> 16) & 0xffff,
// with base, mix and seed read from sha256(salt || "prefilter") as three little-endian uint32 (base and mix forced odd).
// A shingle digest is the first n hex characters of sha256(shingle salt || the k lower-case words joined by spaces),
// n being the length of the pack's digests; words are runs of letters and digits.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { lineAt } from './scan.ts';
import { PsError } from './proc.ts';

export const PACK_SCHEMA = 'harness-evals-admission-pack/1';

export interface Pack {
  schema: string;
  salt: string;
  gate_tree: string;
  exact: { name: string; part: string; len: number; prefilter16: number[]; sha256: string }[];
  patterns: { id: string; class: string; regex: string }[];
  identities_blocked: { sha256: string }[];
  shingles: { salt: string; k: number; threshold: number; digests: string[] };
}
export interface PrefilterKey { base: number; mix: number; seed: number }
export interface LoadedPack {
  sha256: string;
  pack: Pack;
  salt: Buffer;
  key: PrefilterKey;
  byLen: Map<number, { filter: Set<number>; digests: Set<string> }>;
  patterns: { id: string; class: string; re: RegExp }[];
  identities: Set<string>;
  shingle: { salt: Buffer; k: number; threshold: number; hexLen: number; digests: Set<string> };
}
export interface PackHit { code: 'PS-PRIVATE-VALUE' | 'PS-PRIVATE-PATTERN' | 'PS-PRIVATE-SHINGLE'; line: number }

const HEX = /^[0-9a-f]+$/;
const sha = (...parts: (Buffer | string)[]) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };

export function prefilterKey(salt: Buffer): PrefilterKey {
  const k = sha(salt, 'prefilter');
  return { base: (k.readUInt32LE(0) | 1) >>> 0, mix: (k.readUInt32LE(4) | 1) >>> 0, seed: k.readUInt32LE(8) };
}

const finish = (h: number, key: PrefilterKey) => (Math.imul((h ^ key.seed) >>> 0, key.mix) >>> 16) & 0xffff;

export function prefilter16(key: PrefilterKey, window: Uint8Array): number {
  let h = 0;
  for (const b of window) h = (Math.imul(h, key.base) + b) >>> 0;
  return finish(h, key);
}

// Every offset whose window of length len passes the prefilter set: one pass, O(1) per byte.
export function prefilterCandidates(key: PrefilterKey, data: Uint8Array, len: number, filter: Set<number>): number[] {
  const out: number[] = [];
  if (len <= 0 || data.length < len) return out;
  let pow = 1;
  for (let i = 0; i < len; i++) pow = Math.imul(pow, key.base) >>> 0;
  let h = 0;
  for (let i = 0; i < len; i++) h = (Math.imul(h, key.base) + data[i]!) >>> 0;
  for (let i = 0; ; i++) {
    if (filter.has(finish(h, key))) out.push(i);
    if (i + len >= data.length) return out;
    h = (Math.imul(h, key.base) + data[i + len]! - Math.imul(data[i]!, pow)) >>> 0;
  }
}

export function identityDigest(salt: Buffer, email: string): string {
  return sha(salt, email.trim().toLowerCase()).toString('hex');
}

export function shingleDigest(salt: Buffer, words: string[], hexLen: number): string {
  return sha(salt, words.join(' ')).toString('hex').slice(0, hexLen);
}

function invalid(why: string): never {
  throw new PsError('PS-PACK-INVALID', 'private pack: ' + why);
}

export function readPin(pinPath: string): string {
  if (!existsSync(pinPath)) throw new PsError('PS-PACK-MISSING', 'the pack pin file is missing');
  const pin = readFileSync(pinPath, 'utf8').trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{64}$/.test(pin)) throw new PsError('PS-PACK-SHA', 'the pack pin file holds no sha256');
  return pin;
}

export function parsePack(raw: Buffer, sha256: string): LoadedPack {
  let pack: Pack;
  try { pack = JSON.parse(raw.toString('utf8')) as Pack; } catch { invalid('not JSON'); }
  if (pack.schema !== PACK_SCHEMA) invalid('schema is not ' + PACK_SCHEMA);
  if (typeof pack.salt !== 'string' || !HEX.test(pack.salt) || pack.salt.length < 32 || pack.salt.length % 2) invalid('salt must be at least 16 bytes of hex');
  if (typeof pack.gate_tree !== 'string' || !/^[0-9a-f]{40}$/.test(pack.gate_tree)) invalid('gate_tree must be a git tree id');
  if (!Array.isArray(pack.exact) || !Array.isArray(pack.patterns) || !Array.isArray(pack.identities_blocked) || typeof pack.shingles !== 'object' || pack.shingles === null) invalid('exact, patterns, identities_blocked and shingles are required');
  const salt = Buffer.from(pack.salt, 'hex');
  const byLen = new Map<number, { filter: Set<number>; digests: Set<string> }>();
  for (const e of pack.exact) {
    if (!Number.isInteger(e.len) || e.len < 8 || e.len > 4096) invalid('an exact entry has a length outside 8 to 4096');
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) invalid('an exact entry has no sha256');
    if (!Array.isArray(e.prefilter16) || !e.prefilter16.length || e.prefilter16.some((p) => !Number.isInteger(p) || p < 0 || p > 0xffff)) invalid('a prefilter value is wider than 16 bits');
    const slot = byLen.get(e.len) ?? { filter: new Set<number>(), digests: new Set<string>() };
    for (const p of e.prefilter16) slot.filter.add(p);
    slot.digests.add(e.sha256);
    byLen.set(e.len, slot);
  }
  const patterns = pack.patterns.map((p) => {
    if (typeof p.id !== 'string' || !['key', 'private'].includes(p.class) || typeof p.regex !== 'string') invalid('a pattern needs an id, a class (key or private) and a regex');
    const ci = p.regex.startsWith('(?i)');
    try { return { id: p.id, class: p.class, re: new RegExp(ci ? p.regex.slice(4) : p.regex, ci ? 'iu' : 'u') }; } catch { invalid('a pattern does not compile'); }
  });
  for (const i of pack.identities_blocked) if (!/^[0-9a-f]{64}$/.test(i?.sha256 ?? '')) invalid('an identity entry has no sha256');
  const s = pack.shingles;
  if (typeof s.salt !== 'string' || !HEX.test(s.salt) || s.salt.length % 2 || s.k !== 8 || !Number.isInteger(s.threshold) || s.threshold < 1 || !Array.isArray(s.digests)) invalid('shingles need a hex salt, k 8, a threshold and digests');
  const hexLen = s.digests[0]?.length ?? 64;
  if (hexLen < 16 || hexLen > 64 || s.digests.some((d) => typeof d !== 'string' || d.length !== hexLen || !HEX.test(d))) invalid('shingle digests must be hex of one length between 16 and 64');
  return {
    sha256, pack, salt, key: prefilterKey(salt), byLen, patterns,
    identities: new Set(pack.identities_blocked.map((i) => i.sha256)),
    shingle: { salt: Buffer.from(s.salt, 'hex'), k: s.k, threshold: s.threshold, hexLen, digests: new Set(s.digests) },
  };
}

// Read the pack and check it against its pin before parsing anything in it.
export function loadPack(path: string, pinPath: string): LoadedPack {
  if (!existsSync(path)) throw new PsError('PS-PACK-MISSING', 'the private pack is missing');
  const pin = readPin(pinPath);
  const raw = readFileSync(path);
  const got = createHash('sha256').update(raw).digest('hex');
  if (got !== pin) throw new PsError('PS-PACK-SHA', 'the private pack sha256 ' + got.slice(0, 12) + ' does not match its pin ' + pin.slice(0, 12));
  return parsePack(raw, got);
}

export function exactHit(lp: LoadedPack, data: Buffer): number {
  let first = -1;
  for (const [len, slot] of lp.byLen) {
    for (const at of prefilterCandidates(lp.key, data, len, slot.filter)) {
      if (first >= 0 && at >= first) break;
      if (slot.digests.has(sha(lp.salt, data.subarray(at, at + len)).toString('hex'))) { first = at; break; }
    }
  }
  return first;
}

export function shingleHit(lp: LoadedPack, text: string): number {
  const { k, threshold, hexLen, digests, salt } = lp.shingle;
  if (!digests.size) return -1;
  const words: string[] = [];
  const offsets: number[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) { words.push(m[0].toLowerCase()); offsets.push(m.index!); }
  const shared = new Set<string>();
  let first = -1;
  for (let i = 0; i + k <= words.length; i++) {
    const d = shingleDigest(salt, words.slice(i, i + k), hexLen);
    if (!digests.has(d)) continue;
    if (first < 0) first = offsets[i]!;
    shared.add(d);
    if (shared.size >= threshold) return first;
  }
  return -1;
}

// One pass of the pack over a leaf, a path name, a message or a PR text: which private codes hit, at which line.
export function packHits(lp: LoadedPack, data: Buffer, shingles: boolean): PackHit[] {
  const hits: PackHit[] = [];
  const at = exactHit(lp, data);
  if (at >= 0) hits.push({ code: 'PS-PRIVATE-VALUE', line: lineAt(data, at) });
  const text = data.toString('utf8');
  for (const p of lp.patterns) {
    const m = p.re.exec(text);
    if (m) { hits.push({ code: 'PS-PRIVATE-PATTERN', line: lineAt(data, Buffer.byteLength(text.slice(0, m.index))) }); break; }
  }
  if (shingles) {
    const s = shingleHit(lp, text);
    if (s >= 0) hits.push({ code: 'PS-PRIVATE-SHINGLE', line: lineAt(data, Buffer.byteLength(text.slice(0, s))) });
  }
  return hits;
}
