// Gemini 4 Carbon through scripts/v03/llm.ts (internal-task, set L's writer): the real client and the real metering proxy, with the
// proxy's google upstream pointed at a fake Gemini API on the loopback. Keyless: GEMINI_API_KEY is a placeholder set in this
// process for the proxy child only. Checks the request shape (model id, endpoint path, body), that the client sends no key and
// the proxy adds it, that the call is metered on the usage log, and that the placeholder key is written nowhere.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLlm, requestBody, usageLogSpend } from '../scripts/v03/llm.ts';

const tmp = mkdtempSync(join(tmpdir(), 'v03-llm-carbon-'));
const KEY = 'placeholder-gemini-' + crypto.randomUUID();
const seen: { path: string; search: string; key: string | null; auth: string | null; body: any }[] = [];
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  const url = new URL(req.url);
  seen.push({ path: url.pathname, search: url.search, key: req.headers.get('x-goog-api-key'), auth: req.headers.get('authorization'), body: await req.json() });
  return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'thinking about it', thought: true }, { text: 'Can you sort out the zone email for me?' }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, thoughtsTokenCount: 4, totalTokenCount: 56 }, modelVersion: 'gemini-4-carbon' });
} });
afterAll(() => { fake.stop(true); rmSync(tmp, { recursive: true, force: true }); });

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]);

describe('Gemini 4 Carbon in the v0.3 model client', () => {
  test('the request body is a Gemini API generateContent call for gemini-4-carbon', () => {
    const r = requestBody({ model: 'google:gemini-4-carbon', system: 'You write requests.', prompt: 'Write one.', maxTokens: 300 });
    expect(r.provider).toBe('google');
    expect(r.path).toBe('/v1beta/models/gemini-4-carbon:generateContent');
    expect(r.body).toEqual({ systemInstruction: { parts: [{ text: 'You write requests.' }] }, contents: [{ role: 'user', parts: [{ text: 'Write one.' }] }], generationConfig: { maxOutputTokens: 300 } });
  });

  test('a Carbon call goes through the metering proxy, which adds the key, meters it and logs no key', async () => {
    process.env.GEMINI_API_KEY = KEY;
    const dir = join(tmp, 'proxy'), cacheDir = join(tmp, 'cache');
    const llm = await createLlm({ cacheDir, proxy: { dir, leaseUsd: 1, runId: 'v03-llm-carbon-test', upstream: { google: 'http://127.0.0.1:' + fake.port } } });
    const text = await llm.complete({ model: 'google:gemini-4-carbon', system: 'You write requests.', prompt: 'Write one request.', maxTokens: 512 });
    const again = await llm.complete({ model: 'google:gemini-4-carbon', system: 'You write requests.', prompt: 'Write one request.', maxTokens: 512 });
    const stats = await llm.close();
    delete process.env.GEMINI_API_KEY;
    expect(text).toBe('Can you sort out the zone email for me?');
    expect(again).toBe(text);
    expect(stats.calls).toBe(1);
    expect(stats.cache_hits).toBe(1);
    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.path).toBe('/v1beta/models/gemini-4-carbon:generateContent');
    expect(s.search).toBe('');
    expect(s.key).toBe(KEY);
    expect(s.auth).toBeNull();
    expect(s.body.contents).toEqual([{ role: 'user', parts: [{ text: 'Write one request.' }] }]);
    expect(s.body.systemInstruction).toEqual({ parts: [{ text: 'You write requests.' }] });
    expect(s.body.generationConfig.maxOutputTokens).toBe(512);
    const usage = readFileSync(join(dir, 'usage.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: 'google', model: 'gemini-4-carbon', outcome: 'forwarded', input_tokens: 40 });
    const spend = usageLogSpend(join(dir, 'usage.ndjson'));
    expect(spend.forwarded).toBe(1);
    expect(spend.usd).toBeGreaterThan(0);
    expect(stats.usd).toBeGreaterThan(0);
    for (const f of [...files(dir), ...files(cacheDir)]) expect(readFileSync(f).includes(KEY)).toBe(false);
  }, 60_000);
});
