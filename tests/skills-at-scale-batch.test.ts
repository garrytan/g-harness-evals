// Keyless test of scripts/skills-at-scale/batch.ts, the batch lane for the set L labeller and graders: the journal's crash
// states (prepared released, sending adopted or unknown and never resubmitted), refusal of a result the intent never sent,
// a request that fails twice is not sent again, a refused reservation sends nothing, and the provider request shapes
// (Anthropic Message Batches, OpenAI Batch with an uploaded file) against a fake fetch (internal-task).

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, createLlm, type CompleteRequest, type Transport } from '../scripts/v03/llm.ts';
import { anthropicBatches, batchRound, MAX_FAILURES, openaiBatches, type BatchApi, type BatchItem, type BatchStatus, type Intent } from '../scripts/skills-at-scale/batch.ts';

const REQ: CompleteRequest = { model: 'anthropic:claude-opus-5-5', system: 's', prompt: 'grade this', maxTokens: 50 };
const OAI: CompleteRequest = { model: 'openai:gpt-6-astra', system: 's', prompt: 'grade that', maxTokens: 50 };

function fake(o: { ok?: boolean; extra?: string; listed?: BatchStatus[] } = {}) {
  const made: Array<{ items: BatchItem[]; metadata: Record<string, string> }> = [];
  const api: BatchApi = {
    async create(items, metadata) { made.push({ items, metadata }); return { id: 'b' + made.length, ended: false, status: 'in_progress', created_at_ms: 0, total: items.length, metadata, raw: {} }; },
    async get(id) { return { id, ended: true, status: 'ended', created_at_ms: 0, total: 1, metadata: null, raw: {} }; },
    async list() { return o.listed ?? []; },
    async results() {
      const items = made.at(-1)?.items ?? [];
      return [...items.map((i) => ({ custom_id: i.custom_id, ok: o.ok ?? true, text: o.ok === false ? null : 'yes', usage: o.ok === false ? null : { input_tokens: 100, output_tokens: 10 }, error: o.ok === false ? 'errored' : null })),
        ...(o.extra ? [{ custom_id: o.extra, ok: true, text: 'x', usage: null, error: null }] : [])];
    },
  };
  return { api, made };
}
const lease = () => { const log: Array<[string, number]> = []; return { log, lease: { reserve: (usd: number) => { log.push(['reserve', usd]); return 'r' + log.length; }, settle: (_: string, c: { usd: number } | null) => { log.push(['settle', c?.usd ?? -1]); } } }; };
const ask = (req: CompleteRequest, cacheDir: string) => async (t: Transport) => (await createLlm({ cacheDir, transport: t })).complete(req).catch((e) => e.code as string);
const intent = (fields: Partial<Intent>): Intent => ({ intent_id: 'i1', provider: 'anthropic', model: REQ.model, custom_ids: [cacheKey(REQ)], models: { [cacheKey(REQ)]: REQ.model }, state: 'sending', batch_id: null,
  reservation_id: 'r0', reserved_usd: 0.01, created_at: 1000, sending_at: 1000, settled_usd: null, failed: [], note: null, ...fields });
const journal = (dir: string, intents: Intent[], failures: Record<string, number> = {}) => writeFileSync(join(dir, 'batches.json'), JSON.stringify({ schema: 'he-skills-at-scale-batch/1', intents, failures }));

describe('skills-at-scale batch lane', () => {
  test('a request is collected, submitted once, answered into the cache and settled at half its usage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b-')), cache = join(dir, 'cache');
    const a = fake(), o = fake(), l = lease();
    const r1 = await batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: o.api }, work: ask(REQ, cache) });
    expect(r1.result).toBe('E_BATCH_PENDING');
    expect(r1.done).toBe(false);
    expect(a.made[0]!.items.map((i) => i.custom_id)).toEqual([cacheKey(REQ)]);
    const r2 = await batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: o.api }, work: ask(REQ, cache) });
    expect(r2.result).toBe('yes');
    expect(r2.done).toBe(true);
    expect(a.made.length).toBe(1);
    expect(JSON.parse(readFileSync(join(cache, cacheKey(REQ) + '.json'), 'utf8'))).toEqual({ model: REQ.model, text: 'yes' });
    const settled = l.log.find((x) => x[0] === 'settle')![1];
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(l.log[0]![1]);
  });

  test('crash states: prepared is released; sending with none matching is unknown and never resubmitted; one match is adopted, and a result it lacks is sent once more', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b-')), cache = join(dir, 'cache');
    journal(dir, [intent({ intent_id: 'i0', state: 'prepared' }), intent({ intent_id: 'i1' })]);
    const a = fake(), o = fake(), l = lease();
    const r = await batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: o.api }, work: ask(REQ, cache) });
    const j = JSON.parse(readFileSync(join(dir, 'batches.json'), 'utf8')) as { intents: Intent[] };
    expect(j.intents.map((i) => i.state)).toEqual(['abandoned', 'unknown']);
    expect(l.log).toEqual([['settle', 0]]);
    expect(a.made.length).toBe(0);
    expect(r.unknown).toEqual(['i1']);
    expect(r.done).toBe(false);

    const dir2 = mkdtempSync(join(tmpdir(), 'b-'));
    journal(dir2, [intent({ provider: 'openai', model: OAI.model, custom_ids: [cacheKey(OAI)], models: { [cacheKey(OAI)]: OAI.model } })]);
    const listed = [{ id: 'bx', ended: false, status: 'in_progress', created_at_ms: 1000, total: 1, metadata: { intent_id: 'i1' }, raw: {} }];
    const o2 = fake({ listed });
    const r2 = await batchRound({ dir: dir2, cacheDir: join(dir2, 'cache'), lease: () => l.lease, apis: { anthropic: a.api, openai: o2.api }, work: ask(OAI, join(dir2, 'cache')) });
    const j2 = JSON.parse(readFileSync(join(dir2, 'batches.json'), 'utf8')) as { intents: Intent[] };
    expect(j2.intents[0]).toMatchObject({ state: 'settled', batch_id: 'bx', failed: [cacheKey(OAI)] });
    expect(o2.made.length).toBe(1);
    expect(r2.waiting.map((i) => i.state)).toEqual(['submitted']);
  });

  test('a result for a custom id the intent never sent is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b-')), cache = join(dir, 'cache');
    const a = fake({ extra: 'f'.repeat(64) }), l = lease();
    await batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: fake().api }, work: ask(REQ, cache) });
    await expect(batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: fake().api }, work: ask(REQ, cache) })).rejects.toThrow('E_BATCH_UNKNOWN_ID');
  });

  test('a request that fails in two batches is not sent again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b-')), cache = join(dir, 'cache');
    const a = fake({ ok: false }), l = lease();
    const go = () => batchRound({ dir, cacheDir: cache, lease: () => l.lease, apis: { anthropic: a.api, openai: fake().api }, work: ask(REQ, cache) });
    await go(); await go();
    const r = await go();
    expect(MAX_FAILURES).toBe(2);
    expect(a.made.length).toBe(2);
    expect(r.result).toBe('E_BATCH_FAILED');
    expect(r.failed).toEqual([cacheKey(REQ)]);
    expect(r.done).toBe(true);
  });

  test('a refused reservation sends nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'b-')), cache = join(dir, 'cache');
    const a = fake();
    const refusing = { reserve: () => { throw new Error('over budget'); }, settle: () => {} };
    await expect(batchRound({ dir, cacheDir: cache, lease: () => refusing, apis: { anthropic: a.api, openai: fake().api }, work: ask(REQ, cache) })).rejects.toThrow('over budget');
    expect(a.made.length).toBe(0);
    expect((JSON.parse(readFileSync(join(dir, 'batches.json'), 'utf8')) as { intents: Intent[] }).intents[0]!.state).toBe('abandoned');
  });

  test('provider shapes: Anthropic posts params by custom id; OpenAI uploads a file and creates a chat-completions batch', async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchA = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      if (url.endsWith('/results')) return new Response(JSON.stringify({ custom_id: 'c1', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 1 } } } }) + '\n' + JSON.stringify({ custom_id: 'c2', result: { type: 'errored', error: {} } }) + '\n');
      return Response.json({ id: 'msgbatch_1', processing_status: url.endsWith('msgbatch_1') ? 'ended' : 'in_progress', created_at: '2026-11-19T00:00:00Z', request_counts: { processing: 2 } });
    };
    const a = anthropicBatches({ fetch: fetchA });
    const made = await a.create([{ custom_id: 'c1', body: { model: 'claude-opus-5-5' } }], {});
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages/batches');
    expect(seen[0]!.body).toEqual({ requests: [{ custom_id: 'c1', params: { model: 'claude-opus-5-5' } }] });
    expect(made.ended).toBe(false);
    expect((await a.get('msgbatch_1')).ended).toBe(true);
    expect(await a.results(made)).toEqual([{ custom_id: 'c1', ok: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 1 }, error: null }, { custom_id: 'c2', ok: false, text: null, usage: null, error: 'errored' }]);

    const urls: string[] = [];
    const fetchO = async (url: string, init?: RequestInit) => {
      urls.push((init?.method ?? 'GET') + ' ' + url);
      if (url.endsWith('/files')) return Response.json({ id: 'file-1' });
      if (url.endsWith('/content')) return new Response(JSON.stringify({ custom_id: 'c1', response: { status_code: 200, body: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } } }) + '\n');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body) { expect(body).toMatchObject({ input_file_id: 'file-1', endpoint: '/v1/chat/completions', completion_window: '24h', metadata: { intent_id: 'i9' } }); }
      return Response.json({ id: 'batch_1', status: 'completed', created_at: 1, request_counts: { total: 1 }, metadata: { intent_id: 'i9' }, output_file_id: 'out-1' });
    };
    const o = openaiBatches({ fetch: fetchO });
    const b = await o.create([{ custom_id: 'c1', body: { model: 'gpt-6-astra' } }], { intent_id: 'i9' });
    expect(urls).toEqual(['POST https://api.openai.com/v1/files', 'POST https://api.openai.com/v1/batches']);
    expect(b.ended).toBe(true);
    expect(await o.results(b)).toEqual([{ custom_id: 'c1', ok: true, text: 'ok', usage: { prompt_tokens: 5, completion_tokens: 1 }, error: null }]);
  });
});
