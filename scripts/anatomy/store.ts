#!/usr/bin/env bun
// Content-addressed receipts for an anatomy capture.
//
// Each request body a harness sends repeats the system prompt, the tool list and
// the whole conversation so far, so raw logs grow with the square of the turn
// count. This stores every distinct piece once: the system prompt, the tools
// array and each message are written as gzipped JSON blobs named by the sha256
// of their canonical JSON, and each request becomes a short line of references.
// unpack() rebuilds the original log byte for byte (same key order, same JSON).
//
// A public export may leave out a harness's blobs/ (its raw prompt text) and write a
// HASHES_ONLY file in its place. loadReceipt() then checks the receipts from their
// recorded sha256s alone: the log's sha256 in capture.json and the blob ids in
// requests.ndjson. A blobs/ folder missing with no HASHES_ONLY file fails.
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

export type Receipt = { dir: string; log_sha256: string; requests: number; blob_ids: string[] } & ({ mode: 'full'; log: string } | { mode: 'hashes-only' });

/** The file a public export writes in a receipts directory whose blobs/ it leaves out. */
export const HASHES_ONLY_MARKER = 'HASHES_ONLY';

/** True when a receipts directory has no blobs/ folder and declares that with HASHES_ONLY, so only its hashes can be checked. */
export const isHashesOnly = (dir: string): boolean => !existsSync(join(dir, 'blobs')) && existsSync(join(dir, HASHES_ONLY_MARKER));

/** A receipts directory checked against capture.json's sha256 of fake.ndjson. With blobs/ present the log is rebuilt and must
 *  hash to it. With blobs/ absent and HASHES_ONLY present the check is hashes-only: capture.json must record a sha256 for fake.ndjson, and every line
 *  of requests.ndjson must parse and reference blobs by sha256 id. A blobs/ folder missing some blob still throws. */
export function loadReceipt(dir: string): Receipt {
  const recorded = (JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8')) as { files?: Record<string, unknown> }).files?.['fake.ndjson'];
  if (typeof recorded !== 'string' || !/^[0-9a-f]{64}$/.test(recorded)) throw new Error(`${dir}: capture.json records no sha256 for fake.ndjson`);
  const lines = readFileSync(join(dir, 'requests.ndjson'), 'utf8').split('\n').filter((l) => l.trim());
  const ids = new Set<string>();
  for (const line of lines) {
    const refs = (JSON.parse(line) as { refs?: Record<string, unknown> }).refs ?? {};
    for (const ref of Object.values(refs)) for (const id of Array.isArray(ref) ? ref : [ref]) {
      if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) throw new Error(`${dir}: requests.ndjson references a blob by something other than a sha256 id`);
      ids.add(id);
    }
  }
  const base = { dir, log_sha256: recorded, requests: lines.length, blob_ids: [...ids].sort() };
  if (isHashesOnly(dir)) return { ...base, mode: 'hashes-only' };
  if (!existsSync(join(dir, 'blobs'))) throw new Error(`${dir}: blobs/ is missing and no ${HASHES_ONLY_MARKER} file declares a hashes-only export`);
  const log = unpack(dir);
  if (sha(log) !== recorded) throw new Error(`${dir}: the rebuilt log does not match the sha256 capture.json records for fake.ndjson`);
  return { ...base, mode: 'full', log };
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
