// The Claude Code reference shingles, shared by the private admission pack builder (private/admission/build-pack.ts)
// and the public export's reference-overlap gate (scripts/public-export/gates.ts). The reference text is every string
// leaf of 40 or more characters in the system-role JSON blobs of the Claude Code anatomy captures, plus the preset
// system prompt file. Both stay private: the export leaves them out, so this module holds only their paths and the
// tokenizer, never reference text. A shingle is 8 consecutive lower-case words (runs of letters and digits, as in
// lib/pack.ts), and a file sharing SHINGLE_THRESHOLD or more distinct reference shingles is a near-copy. Reference
// shingles that files of other harness captures, world/, harnesses/ or tasks/ also hold are dropped first (dropCommon),
// so common phrases never block.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PsError, runSync } from './proc.ts';
import { catBlobs, expand } from './scan.ts';

export const SHINGLE_K = 8;
export const SHINGLE_THRESHOLD = 20;
export const MIN_LEAF = 40;
export const CAPTURE_PREFIX = 'docs/harness-anatomy/receipts/';
export const CLAUDE_CAPTURE = /^anatomy-capture-claude-code-/;
export const PRESET_PROMPT = 'docs/benchmarks/2026-11-01-opus-gstack-follow/results/gn-follow-preset-2026-11/dry-run/preset-system-prompt.txt';
export const COMMON_ROOTS = ['world/', 'harnesses/', 'tasks/'];

const WORD = /[\p{L}\p{N}]+/gu;

export const words = (text: string) => (text.match(WORD) ?? []).map((w) => w.toLowerCase());

export function shingles(text: string, into: Set<string>): void {
  const w = words(text);
  for (let i = 0; i + SHINGLE_K <= w.length; i++) into.add(w.slice(i, i + SHINGLE_K).join(' '));
}

// A reference string is read in both forms a leak could take: as decoded text, and as it sits inside raw JSON.
export function referenceShingles(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) { shingles(t, out); shingles(JSON.stringify(t).slice(1, -1), out); }
  return out;
}

export function stringLeaves(v: unknown, out: string[]): void {
  if (typeof v === 'string') { if (v.length >= MIN_LEAF) out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) stringLeaves(x, out); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) stringLeaves(x, out);
}

export function jsonLeaves(text: string): string[] {
  const out: string[] = [];
  const parse = (s: string) => { try { stringLeaves(JSON.parse(s), out); return true; } catch { return false; } };
  if (!parse(text)) for (const line of text.split('\n')) if (/^\s*[[{]/.test(line)) parse(line);
  return out;
}

// System-role JSON: a message object with role "system", or an API system parameter (an array of text blocks).
export function isSystemRole(j: unknown): boolean {
  if (Array.isArray(j)) return j.length > 0 && j.every((b) => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string');
  return !!j && typeof j === 'object' && (j as { role?: unknown }).role === 'system';
}

// A file the reference is read from: a file directly inside blobs/ of a Claude Code capture, or the preset prompt.
export function isReferencePath(path: string): boolean {
  if (path === PRESET_PROMPT) return true;
  if (!path.startsWith(CAPTURE_PREFIX)) return false;
  const parts = path.slice(CAPTURE_PREFIX.length).split('/');
  return parts.length === 3 && CLAUDE_CAPTURE.test(parts[0]!) && parts[1] === 'blobs' && parts[2] !== '';
}

export interface ReferenceFile { path: string; data: Buffer }

// The reference files of a checkout on disk: capture blobs first, sorted, then the preset prompt.
export function referenceFiles(root: string): ReferenceFile[] {
  const files: ReferenceFile[] = [];
  const receipts = join(root, CAPTURE_PREFIX);
  for (const dir of existsSync(receipts) ? readdirSync(receipts).filter((d) => CLAUDE_CAPTURE.test(d)).sort() : []) {
    const blobDir = join(receipts, dir, 'blobs');
    if (!existsSync(blobDir)) continue;
    for (const f of readdirSync(blobDir).sort()) {
      const p = join(blobDir, f);
      if (statSync(p).isFile()) files.push({ path: CAPTURE_PREFIX + dir + '/blobs/' + f, data: readFileSync(p) });
    }
  }
  const preset = join(root, PRESET_PROMPT);
  if (existsSync(preset)) files.push({ path: PRESET_PROMPT, data: readFileSync(preset) });
  return files;
}

export interface GitCtx { gitDir: string; env: Record<string, string> }

function git(g: GitCtx, args: string[], op: string): string {
  const r = runSync(['git', '--git-dir=' + g.gitDir, ...args], { op, timeoutMs: 300_000, env: g.env });
  if (r.status !== 0) throw new PsError('PS-USAGE', op + ' failed');
  return r.stdout.toString('utf8');
}

// Every blob of a commit or tree but symlinks, as [oid, path].
function treeBlobs(g: GitCtx, rev: string): [string, string][] {
  const out: [string, string][] = [];
  for (const l of git(g, ['ls-tree', '-r', '-z', '--full-tree', rev], 'git ls-tree').split('\0')) {
    const tab = l.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = l.slice(0, tab).split(' ');
    if (type === 'blob' && mode !== '120000') out.push([oid!, l.slice(tab + 1)]);
  }
  return out;
}

// The reference files of one commit, read from git: the same files referenceFiles reads from a checkout of it.
export async function referenceFilesAt(g: GitCtx, rev: string): Promise<ReferenceFile[]> {
  const rank = (p: string) => (p === PRESET_PROMPT ? '\uffff' : p);
  const want = treeBlobs(g, rev).filter(([, path]) => isReferencePath(path)).sort((a, b) => (rank(a[1]) < rank(b[1]) ? -1 : 1));
  const data = new Map<string, Buffer>();
  for await (const b of catBlobs(g.gitDir, [...new Set(want.map(([oid]) => oid))], g.env, 30 * 60_000)) data.set(b.oid, b.data);
  return want.map(([oid, path]) => ({ path, data: data.get(oid)! }));
}

export function referenceTexts(files: ReferenceFile[]): { texts: string[]; blobs: number } {
  const texts: string[] = [];
  let blobs = 0;
  for (const f of files) {
    if (f.path === PRESET_PROMPT) { texts.push(f.data.toString('utf8')); blobs++; continue; }
    let j: unknown;
    try { j = JSON.parse((f.path.endsWith('.gz') ? gunzipSync(f.data) : f.data).toString('utf8')); } catch { continue; }
    if (!isSystemRole(j)) continue;
    blobs++;
    stringLeaves(j, texts);
  }
  return { texts, blobs };
}

export function isCommonPath(path: string): boolean {
  if (COMMON_ROOTS.some((r) => path.startsWith(r))) return true;
  if (!path.startsWith(CAPTURE_PREFIX)) return false;
  const dir = path.slice(CAPTURE_PREFIX.length).split('/')[0]!;
  return dir.startsWith('anatomy-capture-') && !CLAUDE_CAPTURE.test(dir);
}

// Drop every reference shingle that a file of another harness capture, world/, harnesses/ or tasks/ also holds at rev
// (a commit or a tree), read as raw text and, for JSON, as decoded string leaves.
export async function dropCommon(g: GitCtx, rev: string, ref: Set<string>): Promise<{ files: number; dropped: number }> {
  const oids = new Set(treeBlobs(g, rev).filter(([, path]) => isCommonPath(path)).map(([oid]) => oid));
  const before = ref.size;
  const seen = new Set<string>();
  const drop = (text: string) => { seen.clear(); shingles(text, seen); for (const s of seen) ref.delete(s); };
  for await (const { data } of catBlobs(g.gitDir, [...oids], g.env, 30 * 60_000)) {
    for (const leaf of expand(data).leaves) {
      if (leaf.format !== 'text') continue;
      const text = leaf.data.toString('utf8');
      drop(text);
      for (const s of jsonLeaves(text)) drop(s);
    }
  }
  return { files: oids.size, dropped: before - ref.size };
}

// The text with each JSON escape (\n, \", \\, \uXXXX and the rest) read as the character it stands for, a space for
// the whitespace and punctuation ones, padded to the escape's own length so an offset into it is an offset into the text.
// A JSON copy whose line breaks differ from the reference's then still shares its words.
export function jsonUnescaped(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (m, e: string) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ' ').padEnd(m.length, ' '));
}

export interface Reference { shingles: Set<string>; vocab: Set<string> }

export function reference(shingleSet: Set<string>): Reference {
  const vocab = new Set<string>();
  for (const s of shingleSet) for (const w of s.split(' ')) vocab.add(w);
  return { shingles: shingleSet, vocab };
}

// Adds every reference shingle a text holds to shared, and returns the character offset of the first one this text added
// (-1 if none), so a file read in several leaves counts its distinct shared shingles once. Only a window of 8 reference
// words can match, so no other window is joined.
export function overlap(text: string, ref: Reference, shared: Set<string>): number {
  const ring: string[] = new Array(SHINGLE_K).fill('');
  const at: number[] = new Array(SHINGLE_K).fill(0);
  let first = -1, run = 0, n = 0;
  for (const m of text.matchAll(WORD)) {
    const w = m[0].toLowerCase();
    ring[n % SHINGLE_K] = w;
    at[n % SHINGLE_K] = m.index!;
    n++;
    run = ref.vocab.has(w) ? run + 1 : 0;
    if (run < SHINGLE_K) continue;
    let s = ring[n % SHINGLE_K]!;
    for (let i = 1; i < SHINGLE_K; i++) s += ' ' + ring[(n + i) % SHINGLE_K];
    if (!ref.shingles.has(s) || shared.has(s)) continue;
    if (first < 0) first = at[n % SHINGLE_K]!;
    shared.add(s);
  }
  return first;
}
