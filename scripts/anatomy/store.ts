#!/usr/bin/env bun
// Content-addressed receipts for an anatomy capture (internal-task).
//
// Each request body a harness sends repeats the system prompt, the tool list and
// the whole conversation so far, so raw logs grow with the square of the turn
// count. This stores every distinct piece once: the system prompt, the tools
// array and each message are written as gzipped JSON blobs named by the sha256
// of their canonical JSON, and each request becomes a short line of references.
// unpack() rebuilds the original log byte for byte (same key order, same JSON).
//
//   bun scripts/anatomy/store.ts pack   --log <fake.ndjson> --dir <receipts dir> [--max-bytes 20000000]
//   bun scripts/anatomy/store.ts unpack --dir <receipts dir> --out <fake.ndjson>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

type Row = Record<string, unknown> & { body?: Record<string, unknown> };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function putBlob(dir: string, value: unknown, budget: { bytes: number; max: number }): string {
  const text = JSON.stringify(value);
  const id = sha(text);
  const path = join(dir, 'blobs', `${id}.json.gz`);
  if (!existsSync(path)) {
    const gz = gzipSync(text, { level: 9 });
    budget.bytes += gz.length;
    if (budget.bytes > budget.max) throw new Error(`receipts exceed --max-bytes ${budget.max}; capture fewer requests`);
    writeFileSync(path, gz);
  }
  return id;
}

const getBlob = (dir: string, id: string): unknown => JSON.parse(gunzipSync(readFileSync(join(dir, 'blobs', `${id}.json.gz`))).toString('utf8'));

export function pack(log: string, dir: string, maxBytes = 20_000_000): { requests: number; blobs_bytes: number; raw_bytes: number } {
  mkdirSync(join(dir, 'blobs'), { recursive: true });
  const budget = { bytes: 0, max: maxBytes };
  const raw = readFileSync(log, 'utf8');
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Row;
    if (!row.body || typeof row.body !== 'object') { lines.push(JSON.stringify({ row })); continue; }
    const body: Record<string, unknown> = {};
    const refs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.body)) {
      if (k === 'messages' || k === 'input') refs[k] = Array.isArray(v) ? v.map((m) => putBlob(dir, m, budget)) : putBlob(dir, v, budget);
      else if (k === 'system' || k === 'tools' || k === 'instructions') refs[k] = putBlob(dir, v, budget);
      else body[k] = v;
    }
    lines.push(JSON.stringify({ row: { ...row, body: undefined }, body, refs, order: Object.keys(row.body), row_order: Object.keys(row) }));
  }
  writeFileSync(join(dir, 'requests.ndjson'), lines.join('\n') + '\n');
  return { requests: lines.length, blobs_bytes: budget.bytes, raw_bytes: Buffer.byteLength(raw) };
}

export function unpack(dir: string): string {
  const out: string[] = [];
  for (const line of readFileSync(join(dir, 'requests.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { row: Row; body?: Record<string, unknown>; refs?: Record<string, unknown>; order?: string[]; row_order?: string[] };
    if (!r.refs) { out.push(JSON.stringify(r.row)); continue; }
    const body: Record<string, unknown> = {};
    for (const k of r.order!) {
      if (k in r.refs) {
        const ref = r.refs[k];
        body[k] = Array.isArray(ref) ? ref.map((id) => getBlob(dir, id as string)) : getBlob(dir, ref as string);
      } else body[k] = r.body![k];
    }
    const row: Row = {};
    for (const k of r.row_order ?? [...Object.keys(r.row), 'body']) row[k] = k === 'body' ? body : r.row[k];
    out.push(JSON.stringify(row));
  }
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const [cmd] = process.argv.slice(2);
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (cmd === 'pack' && arg('log') && arg('dir')) {
    const r = pack(arg('log')!, arg('dir')!, Number(arg('max-bytes') ?? 20_000_000));
    console.log(`STORE: ${r.requests} requests, raw ${r.raw_bytes} bytes, blobs ${r.blobs_bytes} bytes gzipped`);
  } else if (cmd === 'unpack' && arg('dir') && arg('out')) {
    writeFileSync(arg('out')!, unpack(arg('dir')!));
  } else {
    console.error('usage: store.ts pack --log <ndjson> --dir <dir> | unpack --dir <dir> --out <ndjson>');
    process.exit(64);
  }
}
