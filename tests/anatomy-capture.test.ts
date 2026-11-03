import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { SCENARIOS } from '../scripts/anatomy/capture.ts';
import { HASHES_ONLY_MARKER, loadReceipt, pack, unpack } from '../scripts/anatomy/store.ts';
import { validateScript } from '../scripts/gsta-135/fake-anthropic.ts';

const fixture = (name: string) => gunzipSync(readFileSync(join(import.meta.dir, 'fixtures/anatomy', name))).toString('utf8');

describe('anatomy receipt store (internal-task)', () => {
  test('pack then unpack gives back every request unchanged, and repeated pieces are stored once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-store-'));
    try {
      const rows = fixture('hermes-chat-probe.ndjson.gz').trim().split('\n').map((l) => JSON.parse(l));
      const first = rows.find((r) => r.body?.tools)!;
      const second = { ...first, at: 'later', body: { ...first.body, messages: [...first.body.messages, { role: 'assistant', content: 'ok' }] } };
      const log = [...rows, second].map((r) => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(join(dir, 'log.ndjson'), log);
      const r = pack(join(dir, 'log.ndjson'), join(dir, 'store'));
      expect(r.requests).toBe(rows.length + 1);
      const back = unpack(join(dir, 'store')).trim().split('\n').map((l) => JSON.parse(l));
      expect(back).toEqual(log.trim().split('\n').map((l) => JSON.parse(l)));
      expect(r.blobs_bytes).toBeLessThan(r.raw_bytes / 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('pack refuses a log whose blobs pass the byte cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-store-'));
    try {
      writeFileSync(join(dir, 'log.ndjson'), fixture('openclaw-2026.10.6-spike.ndjson.gz'));
      expect(() => pack(join(dir, 'log.ndjson'), join(dir, 'store'), 1000)).toThrow(/max-bytes/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('anatomy receipts in hashes-only mode (blobs/ left out of a public export)', () => {
  const RECEIPTS = join(import.meta.dir, '..', 'docs', 'harness-anatomy', 'receipts');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  /** Checks a receipts copy in full mode, then deletes its blobs/ (refused until HASHES_ONLY declares it) and checks it
   *  again from the recorded hashes alone. */
  const checkBothModes = (store: string) => {
    const full = loadReceipt(store);
    expect(full.mode).toBe('full');
    if (full.mode === 'full') expect(sha(full.log)).toBe(full.log_sha256);
    const kept = readdirSync(join(store, 'blobs'));
    rmSync(join(store, 'blobs'), { recursive: true });
    expect(() => loadReceipt(store)).toThrow(/blobs\/ is missing and no HASHES_ONLY file/);
    writeFileSync(join(store, HASHES_ONLY_MARKER), '');
    const hashes = loadReceipt(store);
    expect(hashes).toEqual({ dir: store, mode: 'hashes-only', log_sha256: full.log_sha256, requests: full.requests, blob_ids: full.blob_ids });
    expect(hashes.blob_ids).toEqual(kept.map((b) => b.replace(/\.json\.gz$/, '')).sort());
  };

  test('a packed log verifies in full mode, and from its recorded sha256s once its blobs folder is deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-hashes-'));
    try {
      const log = fixture('hermes-chat-probe.ndjson.gz');
      writeFileSync(join(dir, 'log.ndjson'), log);
      const store = join(dir, 'store');
      pack(join(dir, 'log.ndjson'), store);
      writeFileSync(join(store, 'capture.json'), JSON.stringify({ files: { 'fake.ndjson': sha(unpack(store)) } }));
      checkBothModes(store);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a published receipts folder copied to a temp dir verifies the same way with its blobs folder deleted', () => {
    const id = readdirSync(RECEIPTS).sort().find((d) => existsSync(join(RECEIPTS, d, 'blobs')) && existsSync(join(RECEIPTS, d, 'requests.ndjson')));
    if (!id) return;
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-hashes-'));
    try {
      cpSync(join(RECEIPTS, id), join(dir, id), { recursive: true });
      checkBothModes(join(dir, id));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a missing blob, a bad blob reference, a wrong recorded hash or no recorded hash fails closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-hashes-'));
    try {
      writeFileSync(join(dir, 'log.ndjson'), fixture('hermes-chat-probe.ndjson.gz'));
      const store = join(dir, 'store');
      pack(join(dir, 'log.ndjson'), store);
      const good = sha(unpack(store));
      writeFileSync(join(store, 'capture.json'), JSON.stringify({ files: { 'fake.ndjson': 'f'.repeat(64) } }));
      expect(() => loadReceipt(store)).toThrow(/does not match/);
      writeFileSync(join(store, 'capture.json'), JSON.stringify({ files: {} }));
      expect(() => loadReceipt(store)).toThrow(/records no sha256/);
      writeFileSync(join(store, 'capture.json'), JSON.stringify({ files: { 'fake.ndjson': good } }));
      rmSync(join(store, 'blobs', readdirSync(join(store, 'blobs'))[0]!));
      expect(() => loadReceipt(store)).toThrow(/ENOENT|no such file/);
      rmSync(join(store, 'blobs'), { recursive: true });
      writeFileSync(join(store, HASHES_ONLY_MARKER), '');
      const requests = readFileSync(join(store, 'requests.ndjson'), 'utf8');
      writeFileSync(join(store, 'requests.ndjson'), requests.replace(/"refs":\{"([a-z]+)":(\[)?"[0-9a-f]{64}"/, '"refs":{"$1":$2"not-a-hash"'));
      expect(() => loadReceipt(store)).toThrow(/sha256 id/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('anatomy capture scenarios (internal-task)', () => {
  test('every scenario is a script the fake accepts, for every harness', () => {
    for (const [name, make] of Object.entries(SCENARIOS)) for (const h of ['openclaw', 'hermes', 'qm']) expect(() => validateScript(make(h)), `${name}/${h}`).not.toThrow();
  });
});
