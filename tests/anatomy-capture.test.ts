import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { SCENARIOS } from '../scripts/anatomy/capture.ts';
import { pack, unpack } from '../scripts/anatomy/store.ts';
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

describe('anatomy capture scenarios (internal-task)', () => {
  test('every scenario is a script the fake accepts, for every harness', () => {
    for (const [name, make] of Object.entries(SCENARIOS)) for (const h of ['openclaw', 'hermes', 'qm']) expect(() => validateScript(make(h)), `${name}/${h}`).not.toThrow();
  });
});
