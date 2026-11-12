#!/usr/bin/env bun
// Private-text leak scan for the skill-resolver eval (internal-task). Set R (Garry's own Wintermute DMs) must never reach a
// commit, a results directory, a trial, a proxy log or the public branch. This scan reads set R from its private path at
// run time, builds the sha256 of every message and the set of 8-word shingles of every message and previous message, and
// walks the given paths: a file that contains a message sha256 or the exact text of a message of 40 characters or more,
// or that shares at least --min-shingles 8-word shingles with any one message, is a leak. It prints only counts, paths
// and message ids, never text or shingles, and exits 1 on any leak (2 on usage).
//
//   bun scripts/skill-resolver/leak-scan.ts --set <setR.jsonl> [--min-shingles 2] <path>...
//
// Messages shorter than 8 words have no shingle and are caught only by exact text (40+ characters) or sha256.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const words = (s: string) => s.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export function shingles(s: string, k = 8): string[] {
  const w = words(s); const out: string[] = [];
  for (let i = 0; i + k <= w.length; i++) out.push(w.slice(i, i + k).join(' '));
  return out;
}

export interface Hit { path: string; id: string; kind: 'sha256' | 'text' | 'shingles'; count: number }

export function scan(rows: { id: string; text: string; prev_user_text?: string | null }[], files: { path: string; body: string }[], minShingles = 2): Hit[] {
  const owner = new Map<string, Set<string>>();
  const exact: { id: string; text: string; sha: string }[] = [];
  for (const r of rows) {
    for (const t of [r.text, r.prev_user_text ?? '']) {
      if (!t) continue;
      exact.push({ id: r.id, text: t.trim(), sha: createHash('sha256').update(t).digest('hex') });
      for (const s of shingles(t)) { if (!owner.has(s)) owner.set(s, new Set()); owner.get(s)!.add(r.id); }
    }
  }
  const hits: Hit[] = [];
  for (const f of files) {
    const low = f.body.toLowerCase();
    for (const e of exact) {
      if (low.includes(e.sha)) hits.push({ path: f.path, id: e.id, kind: 'sha256', count: 1 });
      else if (e.text.length >= 40 && f.body.includes(e.text)) hits.push({ path: f.path, id: e.id, kind: 'text', count: 1 });
    }
    const per = new Map<string, number>();
    for (const s of new Set(shingles(f.body))) for (const id of owner.get(s) ?? []) per.set(id, (per.get(id) ?? 0) + 1);
    for (const [id, n] of per) if (n >= minShingles) hits.push({ path: f.path, id, kind: 'shingles', count: n });
  }
  return hits;
}

function* walk(p: string): Generator<string> {
  const st = statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const q = join(p, e.name);
    if (e.isDirectory()) yield* walk(q); else if (e.isFile()) yield q;
  }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--set'); const set = i >= 0 ? a[i + 1] : undefined;
  const j = a.indexOf('--min-shingles'); const min = j >= 0 ? Number(a[j + 1]) : 2;
  const paths = a.filter((x, k) => !x.startsWith('--') && a[k - 1] !== '--set' && a[k - 1] !== '--min-shingles');
  if (!set || !paths.length || !(min >= 1)) { console.error('usage: leak-scan.ts --set <setR.jsonl> [--min-shingles 2] <path>...'); process.exit(2); }
  const rows = readFileSync(set, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const files: { path: string; body: string }[] = [];
  for (const p of paths) for (const f of walk(p)) { if (statSync(f).size <= 64 * 1024 * 1024) files.push({ path: f, body: readFileSync(f, 'utf8') }); }
  const hits = scan(rows, files, min);
  for (const h of hits) console.log('LEAK ' + h.kind + ' id=' + h.id + ' count=' + h.count + ' ' + h.path);
  console.log((hits.length ? 'LEAKS ' : 'LEAK_SCAN_OK ') + 'files=' + files.length + ' messages=' + rows.length + ' hits=' + hits.length);
  process.exit(hits.length ? 1 : 0);
}
