/**
 * The metering proxy's forbidden-marker tripwire (runner/proxy/sanitize.ts findLeaks) reads a request body as sent and again with
 * every \u escape decoded, the way the canary scan does (carriesCanary), so a marker a harness writes as \u escapes in a JSON body is
 * refused like a plain one. Keyless: the upstream is a fake and every key a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy } from '../runner/proxy/metering-proxy.ts';
import { findLeaks } from '../runner/proxy/sanitize.ts';

const tmp = mkdtempSync(join(tmpdir(), 'proxy-tripwire-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const FAKE_ENV = { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' };
const MARKER = 'conv-26:q007';

/** A JSON string literal whose every character is a \u escape, so the marker never appears in the raw text. */
const escaped = (s: string) => `"${[...s].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`;

describe('the forbidden-marker tripwire decodes \\u escapes', () => {
  test('findLeaks finds a marker written as \\u escapes, once or inside a double-encoded string, and nothing in ordinary text', () => {
    const once = `{"messages":[{"role":"user","content":${escaped(`metadata ${MARKER}`)}}]}`;
    expect(once).not.toContain(MARKER);
    expect(findLeaks(once, [MARKER])).toEqual([MARKER]);
    const twice = JSON.stringify({ messages: [{ role: 'tool', content: JSON.stringify(`{"body":${escaped(MARKER)}}`) }] });
    expect(twice).not.toContain(MARKER);
    expect(findLeaks(twice, [MARKER])).toEqual([MARKER]);
    expect(findLeaks(JSON.stringify({ messages: [{ role: 'user', content: 'hello there' }] }), [MARKER])).toEqual([]);
  });

  test('a body with a megabyte of backslashes is scanned in linear time', () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: '\\'.repeat(1_000_000) + 'x' }] });
    const t0 = performance.now();
    expect(findLeaks(body, [MARKER])).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });

  test('the proxy refuses a request whose body carries the marker only as \\u escapes, and forwards nothing', async () => {
    const lease = BudgetRun.openLease({ runId: 'tripwire-escape', leaseUsd: 1, ledgerPath: join(tmp, 'ledger.sqlite') });
    const seen: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => { seen.push(String(url)); return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 } }); }) as unknown as typeof fetch;
    const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: FAKE_ENV, usageLog: join(tmp, 'usage.ndjson'), forbiddenMarkers: [MARKER] } });
    proxy.start();
    proxy.bind('c', 'slot:c');
    try {
      const body = `{"model":"gpt-4.1-mini","max_completion_tokens":100,"messages":[{"role":"user","content":${escaped(`metadata ${MARKER}`)}}]}`;
      expect(body).not.toContain(MARKER);
      const res = await fetch(`http://127.0.0.1:${proxy.port}/c/openai/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain(MARKER);
      expect(proxy.counts.tripwires).toBe(1);
      expect(seen).toHaveLength(0);
    } finally { proxy.stop(); }
  });
});
