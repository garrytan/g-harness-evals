import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPackets, type HashedPacket } from '../scripts/failure-mining/packet.ts';
import { buildSdkPackets, type HashedSdkPacket } from '../scripts/failure-mining/sdk-packet.ts';
import { buildWire, createLlm, parseWire, type ModelId, type Transport, type WireRequest } from '../scripts/failure-mining/llm.ts';
import { labelPackets, recordSchema, renderPrefix, resolveGate, validateRecord, BACKOFF_MS, DEFAULT_INSTRUCTIONS, MAX_CONSECUTIVE_TRANSPORT_FAILURES, TOOL } from '../scripts/failure-mining/label.ts';
import { loadCodebook, readLabels } from '../scripts/failure-mining/check-labels.ts';

const ROOT = resolve(import.meta.dir, '..');
const FX = join(ROOT, 'tests/fixtures/failure-mining');
const CODEBOOK = join(FX, 'codebook.json');
const codebook = loadCodebook(CODEBOOK);
const packets = buildPackets(join(FX, 'taxonomy.json'), { results: join(FX, 'mu'), tasksRoot: join(ROOT, 'tasks/multiuser/v0.3') }).packets;
const tmp = mkdtempSync(join(tmpdir(), 'fm-label-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const noWait = async (_ms: number) => {};
const dir = () => { const d = join(tmp, String(++n)); mkdirSync(d, { recursive: true }); return d; };

const req = (model: ModelId, packet = 'PACKET') => ({ model, prefix: 'PREFIX', packet, schema: recordSchema(codebook), tool: TOOL });

/** A record the mechanical checks accept: the packet's first bot tool call and a quote from turn 1. */
function goodRecord(p: HashedPacket) {
  const e = p.events.find((x) => x.bot && !x.reply)!;
  return { trial_id: p.trial_id, root_cause: 'did_not_look', first_wrong_step: { turn: e.turn, seq: e.seq, kind: 'action' }, stage: 'retrieve', brain_role: 'absent', gstack_role: 'absent', evidence_quotes: [p.turns[0]!.text.slice(0, 40)], confidence: 'medium', note: 'It answered without reading the channel.' };
}
const SDK = join(FX, 'sdk');
const sdkPackets = buildSdkPackets({ transcripts: join(SDK, 'transcripts'), results: join(SDK, 'rows'), tasksRoot: join(ROOT, 'tasks/repo/gstack-native-v1'), sources: [{ run: 'gn-follow-2026-11', lease: 'opus-follow', rows: 'gn-follow-2026-11/trials.jsonl' }] }).packets;
/** A record the checks accept for an sdk packet: its first tool step, turn null, and gstack_role matching the packet. */
function goodSdkRecord(p: HashedSdkPacket) {
  const s = p.steps.find((x) => x.kind === 'tool')!;
  return { trial_id: p.trial_id, root_cause: 'did_not_look', first_wrong_step: { turn: null, seq: s.step, kind: 'action' }, stage: 'act', brain_role: 'absent', gstack_role: p.gstack ? 'not_loaded' : 'absent', evidence_quotes: [p.task.prompt!.slice(0, 40)], confidence: 'low', note: 'It missed a bug.' };
}
const packetOf = (w: WireRequest): any => {
  const text = w.provider === 'anthropic' ? (w.body as any).messages[0].content[0].text : w.provider === 'openai' ? (w.body as any).input[1].content[0].text : String((w.body as any).messages[1].content).split('\n\n')[0];
  const id = JSON.parse(text).trial_id as string;
  return [...packets, ...sdkPackets].find((p) => p.trial_id === id)!;
};
const anthropicReply = (input: unknown) => ({ status: 200, json: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'record_label', input }], usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 50 } } });

function fake(answer: (w: WireRequest, p: any, call: number) => { status: number; json: unknown }): Transport & { seen: WireRequest[] } {
  const seen: WireRequest[] = [];
  const t = (async (w: WireRequest) => { seen.push(w); return answer(w, packetOf(w), seen.length); }) as Transport & { seen: WireRequest[] };
  t.seen = seen;
  return t;
}

function gitRepo(pushed: boolean): string {
  const d = mkdtempSync(join(tmp, 'repo-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: d, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(d, 'docs'));
  writeFileSync(join(d, 'docs/fm-prereg.md'), 'rule');
  g('add', '.');
  g('commit', '-q', '-m', 'prereg');
  if (pushed) {
    const remote = mkdtempSync(join(tmp, 'remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    g('remote', 'add', 'origin', remote);
    g('push', '-q', 'origin', 'main');
    g('fetch', '-q', 'origin');
  }
  return d;
}

describe('llm.ts wire settings', () => {
  test('Opus 5.5: Messages API, no temperature or thinking, effort low, tool_choice auto, one strict tool, 8000 tokens, cached prefix', () => {
    const w = buildWire(req('anthropic:claude-opus-5-5'));
    const b = w.body as any;
    expect([w.provider, w.path]).toEqual(['anthropic', '/v1/messages']);
    expect(b.model).toBe('claude-opus-5-5');
    expect(b.temperature).toBeUndefined();
    expect(b.thinking).toBeUndefined();
    expect(b.top_p).toBeUndefined();
    expect(b.output_config).toEqual({ effort: 'low' });
    expect(b.tool_choice).toEqual({ type: 'auto' });
    expect(b.tools).toHaveLength(1);
    expect(b.tools[0]).toMatchObject({ name: 'record_label', strict: true, input_schema: recordSchema(codebook) });
    expect(b.max_tokens).toBe(8000);
    expect(b.system).toEqual([{ type: 'text', text: 'PREFIX', cache_control: { type: 'ephemeral' } }]);
    expect(b.messages[0].content.map((c: any) => c.text)).toEqual(['PACKET', 'Call record_label exactly once with the one record for this packet.']);
  });

  test('GPT-6 Astra and GPT-6.1 Sol: Responses API, strict json_schema, explicit cache breakpoint on the prefix with a prompt_cache_key', () => {
    for (const m of ['openai:gpt-6-astra', 'openai:gpt-6.1-sol'] as const) {
      const w = buildWire(req(m));
      const b = w.body as any;
      expect([w.provider, w.path]).toEqual(['openai', '/v1/responses']);
      expect(b.model).toBe(m.split(':')[1]);
      expect(b.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
      expect(b.prompt_cache_key).toMatch(/^failure-mining-[0-9a-f]{24}$/);
      expect(b.input[0]).toEqual({ role: 'developer', content: [{ type: 'input_text', text: 'PREFIX', prompt_cache_breakpoint: { mode: 'explicit' } }] });
      expect(b.input[1].content[0].text).toBe('PACKET');
      expect(b.input[1].content.some((c: any) => c.prompt_cache_breakpoint)).toBe(false);
      expect(b.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'record_label' });
      expect(b.max_output_tokens).toBe(8000);
      expect(b.temperature).toBeUndefined();
    }
    expect((buildWire(req('openai:gpt-6.1-sol', 'A')).body as any).prompt_cache_key).toBe((buildWire(req('openai:gpt-6.1-sol', 'B')).body as any).prompt_cache_key);
  });

  test('Particle-1: chat completions with one function tool', () => {
    const w = buildWire(req('particle:particle-1'));
    const b = w.body as any;
    expect([w.provider, w.path]).toEqual(['particle', '/v1/chat/completions']);
    expect(b.model).toBe('particle-1');
    expect(b.messages[0]).toEqual({ role: 'system', content: 'PREFIX' });
    expect(b.tools[0].function.name).toBe('record_label');
    expect(b.max_completion_tokens).toBe(8000);
  });

  test('parses the record and usage from each provider, and nothing from a reply without one', () => {
    expect(parseWire('anthropic', 'record_label', anthropicReply({ a: 1 }).json)).toEqual({ value: { a: 1 }, via: 'tool', usage: { input_tokens: 100, cached_input_tokens: 900, cache_write_tokens: 0, output_tokens: 50 } });
    expect(parseWire('anthropic', 'record_label', { content: [{ type: 'text', text: '{"a":1}' }] }).value).toBeNull();
    expect(parseWire('openai', 'record_label', { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":2}' }] }], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 8 }, output_tokens: 3 } })).toEqual({ value: { a: 2 }, via: 'json_schema', usage: { input_tokens: 10, cached_input_tokens: 8, cache_write_tokens: 0, output_tokens: 3 } });
    expect(parseWire('particle', 'record_label', { choices: [{ message: { tool_calls: [{ function: { name: 'record_label', arguments: '{"a":3}' } }] } }] }).value).toEqual({ a: 3 });
    expect(parseWire('particle', 'record_label', { choices: [{ message: { content: '```json\n{"a":4}\n```' } }] })).toMatchObject({ value: { a: 4 }, via: 'content_json' });
    expect(parseWire('particle', 'record_label', { choices: [{ message: { content: 'no idea' } }] }).value).toBeNull();
  });

  test('caches records on disk by (model, prefix, packet, schema); a hit makes no call; a reply without a record is not cached', async () => {
    let calls = 0;
    const t: Transport = async () => { calls++; return calls === 1 ? { status: 200, json: { content: [] } } : anthropicReply({ a: 1 }); };
    const llm = await createLlm({ cacheDir: join(dir(), 'cache'), transport: t });
    expect((await llm.structured(req('anthropic:claude-opus-5-5'))).value).toBeNull();
    expect(await llm.structured(req('anthropic:claude-opus-5-5'))).toMatchObject({ value: { a: 1 }, cached: false });
    expect(await llm.structured(req('anthropic:claude-opus-5-5'))).toMatchObject({ value: { a: 1 }, cached: true });
    await llm.structured(req('anthropic:claude-opus-5-5', 'OTHER'));
    expect(calls).toBe(3);
    expect(llm.stats()).toMatchObject({ calls: 3, cache_hits: 1, no_record: 1, cached_input_tokens: 1800 });
    expect(await llm.close()).toMatchObject({ usd: 0 });
  });

  test('a 402 is a budget stop and any other status an HTTP error code; a model off the list is refused', async () => {
    const llm = await createLlm({ cacheDir: join(dir(), 'cache'), transport: async (w) => ({ status: (w.body as any).messages?.[0]?.content?.[0]?.text === 'A' ? 402 : 500, json: null }) });
    await expect(llm.structured(req('anthropic:claude-opus-5-5', 'A'))).rejects.toThrow('E_BUDGET');
    await expect(llm.structured(req('anthropic:claude-opus-5-5', 'B'))).rejects.toThrow('E_HTTP_500');
    await expect(llm.structured({ ...req('anthropic:claude-opus-5-5'), model: 'anthropic:claude-haiku-5-5' as ModelId })).rejects.toThrow('E_MODEL_NOT_ALLOWED');
  });

  test('without an injected transport or a proxy there is nothing to send through', async () => {
    const llm = await createLlm({ cacheDir: join(dir(), 'cache') });
    await expect(llm.structured(req('anthropic:claude-opus-5-5'))).rejects.toThrow('E_NO_TRANSPORT');
  });
});

describe('label.ts', () => {
  test('the prefix renders every codebook class and the schema enumerates their ids plus other', () => {
    const prefix = renderPrefix(DEFAULT_INSTRUCTIONS, codebook);
    for (const c of codebook.classes) expect(prefix).toContain('### ' + c.id + ': ' + c.name);
    expect(prefix).not.toContain('\u2014');
    expect((recordSchema(codebook) as any).properties.root_cause.enum).toEqual(['did_not_look', 'found_and_ignored', 'policy_misread', 'other']);
  });

  test('validateRecord names every problem', () => {
    const p = packets[0]!;
    expect(validateRecord(goodRecord(p), codebook, p.trial_id).problems).toEqual([]);
    const bad = { ...goodRecord(p), trial_id: 'x', root_cause: 'nope', stage: 'think', evidence_quotes: ['a', 'b', 'c', 'd'], extra: 1 };
    const { record, problems } = validateRecord(bad, codebook, p.trial_id);
    expect(record).toBeNull();
    expect(problems).toEqual(expect.arrayContaining(['unexpected field extra', "trial_id must be the packet's trial_id", 'root_cause must be a codebook id or "other"', 'evidence_quotes must be 1 to 3 non-empty strings']));
    expect(problems.some((x) => x.startsWith('stage must be'))).toBe(true);
  });

  test('labels every packet, writes labels.jsonl, and a rerun asks for nothing', async () => {
    const d = dir();
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    const o = { packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5' as const, out: join(d, 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t };
    const s = await labelPackets(o);
    expect(s).toMatchObject({ packets: 3, skipped: 0, asked: 3, ok: 3, failed: 0, verified: 3, stopped: null });
    const lines = readFileSync(o.out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.trial_id).sort()).toEqual(packets.map((p) => p.trial_id).sort());
    expect(lines[0]).toMatchObject({ status: 'ok', model: 'anthropic:claude-opus-5-5', attempts: 1, check: { verified: true, reasons: [] } });
    expect(lines[0].packet_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(d, 'attestation.json'))).toBe(false);
    const again = await labelPackets(o);
    expect(again).toMatchObject({ skipped: 3, asked: 0 });
    expect(t.seen.length).toBe(3);
  });

  test('every call shares the same prefix block', async () => {
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t });
    expect(new Set(t.seen.map((w) => JSON.stringify((w.body as any).system))).size).toBe(1);
  });

  test('a reply without a valid record is asked again once with the problems named, then recorded as failed', async () => {
    const d = dir();
    const p0 = packets[0]!.trial_id, p1 = packets[1]!.trial_id;
    const t = fake((w, p) => {
      if (p.trial_id === p0) return { status: 200, json: { content: [{ type: 'text', text: 'thinking' }] } };
      const retry = (w.body as any).messages[0].content.length === 3;
      return anthropicReply(p.trial_id === p1 && !retry ? { ...goodRecord(p), stage: 'guess' } : goodRecord(p));
    });
    const s = await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(d, 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t, concurrency: 1 });
    expect(s).toMatchObject({ asked: 3, ok: 2, failed: 1 });
    const { lines } = readLabels(join(d, 'labels.jsonl'));
    expect(lines.get(p0)).toMatchObject({ status: 'failed', attempts: 2, problems: ['the reply carried no record'], check: null });
    expect(lines.get(p1)).toMatchObject({ status: 'ok', attempts: 2 });
    const retryText = t.seen.filter((w) => packetOf(w).trial_id === p1).map((w) => (w.body as any).messages[0].content[1].text)[1];
    expect(retryText).toContain('stage must be one of');
  });

  test('a record that fails the mechanical checks is asked again once; the second record is kept with its check result', async () => {
    const d = dir();
    const t = fake((w, p) => {
      const retry = (w.body as any).messages[0].content.length === 3;
      return anthropicReply(retry ? goodRecord(p) : { ...goodRecord(p), evidence_quotes: ['words the packet never had'] });
    });
    const s = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(d, 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t });
    expect(s).toMatchObject({ ok: 1, verified: 1 });
    expect((t.seen[1]!.body as any).messages[0].content[1].text).toContain('quote not found verbatim');
    const t2 = fake((_w, p) => anthropicReply({ ...goodRecord(p), evidence_quotes: ['words the packet never had'] }));
    const s2 = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t2 });
    expect(s2).toMatchObject({ ok: 1, verified: 0 });
    expect(t2.seen.length).toBe(2);
  });

  test('--retry-failed asks again only for failed trials; a line a crash cut short is ignored', async () => {
    const d = dir();
    const out = join(d, 'labels.jsonl');
    const failing = fake(() => ({ status: 500, json: null }));
    const s = await labelPackets({ packets: packets.slice(0, 2), codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: failing, sleep: noWait });
    expect(s).toMatchObject({ failed: 2 });
    expect(readLabels(out).lines.get(packets[0]!.trial_id)).toMatchObject({ status: 'failed', problems: ['request failed: E_HTTP_500 after 5 retries'] });
    appendFileSync(out, '{"trial_id":"' + packets[2]!.trial_id + '","status":"o');
    const ok = fake((_w, p) => anthropicReply(goodRecord(p)));
    const s2 = await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: ok, retryFailed: true });
    expect(s2).toMatchObject({ skipped: 0, asked: 3, ok: 3, malformed_lines: 1 });
    const s3 = await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: ok, retryFailed: true });
    expect(s3).toMatchObject({ skipped: 3, asked: 0 });
    expect([...readLabels(out).lines.values()].every((l) => l.status === 'ok')).toBe(true);
  });

  test('--retry-failed asks the model again instead of replaying a cached failure', async () => {
    const d = dir();
    const out = join(d, 'labels.jsonl');
    const bad = fake((_w, p) => anthropicReply({ ...goodRecord(p), stage: 'guess' }));
    const o = { packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5' as const, out, runId: 'fm-test', leaseUsd: 1 };
    expect(await labelPackets({ ...o, transport: bad })).toMatchObject({ failed: 1 });
    expect(bad.seen.length).toBe(2);
    expect(readdirSync(join(d, 'cache')).filter((f) => f.endsWith('.json')).length).toBe(2);
    expect(readdirSync(join(d, 'cache')).some((f) => f.endsWith('.tmp'))).toBe(false);
    const good = fake((_w, p) => anthropicReply(goodRecord(p)));
    const s = await labelPackets({ ...o, transport: good, retryFailed: true });
    expect(s).toMatchObject({ asked: 1, ok: 1, stats: { calls: 1, cache_hits: 0 } });
    expect(good.seen.length).toBe(1);
    expect(readLabels(out).lines.get(packets[0]!.trial_id)!.status).toBe('ok');
  });

  test('a rerun refuses a labels file holding another model, codebook or prefix', async () => {
    const d = dir();
    const out = join(d, 'labels.jsonl');
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: t });
    await expect(labelPackets({ packets, codebookPath: CODEBOOK, model: 'openai:gpt-6-astra', out, runId: 'fm-test', leaseUsd: 1, transport: t })).rejects.toThrow(/from a different labeller .*model anthropic:claude-opus-5-5, not openai:gpt-6-astra/);
    await expect(labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: t, instructions: 'Other instructions.' })).rejects.toThrow(/prefix_sha256/);
    expect(t.seen.length).toBe(1);
  });

  test('429 and 5xx back off 2, 4, 8, 16 and 32 seconds; another 4xx is recorded failed without a retry', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    let n = 0;
    const flaky = fake((_w, p) => (++n <= 2 ? { status: n === 1 ? 429 : 503, json: null } : anthropicReply(goodRecord(p))));
    const s = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: flaky, sleep });
    expect(s).toMatchObject({ ok: 1, failed: 0 });
    expect(waits).toEqual([2_000, 4_000]);
    waits.length = 0;
    const down = fake(() => ({ status: 502, json: null }));
    await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: down, sleep });
    expect(waits).toEqual([...BACKOFF_MS]);
    expect(down.seen.length).toBe(6);
    waits.length = 0;
    const out = join(dir(), 'labels.jsonl');
    const rejected = fake(() => ({ status: 400, json: null }));
    const r = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: rejected, sleep });
    expect(r).toMatchObject({ failed: 1, stopped: null });
    expect(rejected.seen.length).toBe(1);
    expect(waits).toEqual([]);
    expect(readLabels(out).lines.get(packets[0]!.trial_id)).toMatchObject({ status: 'failed', attempts: 1, problems: ['request failed: E_HTTP_400 (not transient, not retried)'] });
  });

  test('10 transport failures in a row stop the run and write nothing for the item that tripped it', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...packets[0]!, trial_id: `${packets[0]!.trial_id}-copy${i}` }));
    const out = join(dir(), 'labels.jsonl');
    const rejected = fake(() => ({ status: 404, json: null }));
    const s = await labelPackets({ packets: many, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: rejected, sleep: noWait, concurrency: 1 });
    expect(s).toMatchObject({ stopped: 'transport', asked: MAX_CONSECUTIVE_TRANSPORT_FAILURES - 1, failed: MAX_CONSECUTIVE_TRANSPORT_FAILURES - 1 });
    expect(rejected.seen.length).toBe(MAX_CONSECUTIVE_TRANSPORT_FAILURES);
    expect(readLabels(out).lines.size).toBe(MAX_CONSECUTIVE_TRANSPORT_FAILURES - 1);
  });

  test('a spent lease stops the run, writes nothing for the item in flight, and a rerun picks up the rest', async () => {
    const d = dir();
    const out = join(d, 'labels.jsonl');
    const t = fake((_w, p, call) => (call >= 2 ? { status: 402, json: null } : anthropicReply(goodRecord(p))));
    const s = await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: t, concurrency: 1 });
    expect(s).toMatchObject({ stopped: 'budget', asked: 1, ok: 1 });
    expect(readLabels(out).lines.size).toBe(1);
    const s2 = await labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out, runId: 'fm-test', leaseUsd: 1, transport: fake((_w, p) => anthropicReply(goodRecord(p))) });
    expect(s2).toMatchObject({ skipped: 1, asked: 2, ok: 2, stopped: null });
  });

  test('labels sdk packets; a gstack packet labelled gstack_role absent is asked again with the failed check named', async () => {
    expect(sdkPackets.map((p) => p.gstack !== null)).toEqual([true, false]);
    const t = fake((w, p) => {
      const retry = (w.body as any).messages[0].content.length === 3;
      return anthropicReply(retry ? goodSdkRecord(p) : { ...goodSdkRecord(p), gstack_role: 'absent' });
    });
    const s = await labelPackets({ packets: sdkPackets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t, concurrency: 1 });
    expect(s).toMatchObject({ ok: 2, verified: 2 });
    expect(t.seen.length).toBe(3);
    expect((t.seen[1]!.body as any).messages[0].content[1].text).toContain('gstack_role is absent but the packet shows gstack');
  });

  test('Particle records that arrive as JSON content are accepted and validated', async () => {
    const t = fake((_w, p) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(goodRecord(p)) } }] } }));
    const s = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'particle:particle-1', out: join(dir(), 'labels.jsonl'), runId: 'fm-test', leaseUsd: 1, transport: t });
    expect(s).toMatchObject({ ok: 1, verified: 1 });
  });
});

describe('label.ts preregistration gate', () => {
  test('a paid run with neither --preregistration nor the smoke allowance refuses to start', () => {
    expect(() => resolveGate({ runId: 'fm', leaseUsd: 10 })).toThrow(/needs --preregistration/);
    expect(resolveGate({ runId: 'fm', leaseUsd: 10, transport: async () => ({ status: 200, json: null }) })).toBeNull();
    expect(() => resolveGate({ runId: 'fm', leaseUsd: 10, preregistration: 'x', allowUnregisteredSmoke: true })).toThrow(/not both/);
  });

  test('the smoke allowance holds only for a -smoke run id under a lease of at most $3, and writes an uncounted marker', async () => {
    expect(() => resolveGate({ runId: 'fm-run', leaseUsd: 1, allowUnregisteredSmoke: true })).toThrow(/ending in -smoke/);
    expect(() => resolveGate({ runId: 'fm-smoke', leaseUsd: 3.01, allowUnregisteredSmoke: true })).toThrow(/at most 3/);
    const d = dir();
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    await expect(labelPackets({ packets, codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(d, 'labels.jsonl'), runId: 'fm-run', leaseUsd: 1, transport: t, allowUnregisteredSmoke: true })).rejects.toThrow(/ending in -smoke/);
    expect(t.seen.length).toBe(0);
    const s = await labelPackets({ packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5', out: join(d, 'labels.jsonl'), runId: 'fm-smoke', leaseUsd: 3, transport: t, allowUnregisteredSmoke: true });
    expect(s.ok).toBe(1);
    expect(JSON.parse(readFileSync(join(d, 'attestation.json'), 'utf8'))).toMatchObject({ uncounted: true, run_id: 'fm-smoke', lease_usd: 3 });
  });

  test('--preregistration attests before the first request and writes attestation.json beside labels.jsonl', async () => {
    const repo = gitRepo(true);
    const d = dir();
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    const o = { packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5' as const, out: join(d, 'labels.jsonl'), runId: 'fm-run', leaseUsd: 50, transport: t, preregistration: 'docs/fm-prereg.md', cwd: repo };
    expect((await labelPackets(o)).ok).toBe(1);
    const a = JSON.parse(readFileSync(join(d, 'attestation.json'), 'utf8'));
    expect(a).toMatchObject({ preregistration: 'docs/fm-prereg.md', on_origin: true, worktree_clean_for_preregistration: true });
    expect(a.preregistration_commit).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
    await expect(labelPackets({ ...o, packets, allowUnregisteredSmoke: true, preregistration: undefined, runId: 'fm-smoke', leaseUsd: 1 })).rejects.toThrow(/registered run; label into a new folder/);
  });

  test('a preregistration that is not on origin stops the run before any request, and a fully cached run needs no attestation', async () => {
    const repo = gitRepo(false);
    const d = dir();
    const t = fake((_w, p) => anthropicReply(goodRecord(p)));
    const o = { packets: [packets[0]!], codebookPath: CODEBOOK, model: 'anthropic:claude-opus-5-5' as const, out: join(d, 'labels.jsonl'), runId: 'fm-run', leaseUsd: 50, transport: t, preregistration: 'docs/fm-prereg.md', cwd: repo };
    await expect(labelPackets(o)).rejects.toThrow(/not on origin/);
    expect(t.seen.length).toBe(0);
    expect(existsSync(join(d, 'labels.jsonl'))).toBe(false);
    const warm = dir();
    await labelPackets({ ...o, out: join(warm, 'labels.jsonl'), preregistration: undefined, cacheDir: join(warm, 'cache') });
    const cold = dir();
    const s = await labelPackets({ ...o, out: join(cold, 'labels.jsonl'), cacheDir: join(warm, 'cache') });
    expect(s).toMatchObject({ ok: 1, stats: { calls: 0, cache_hits: 1 } });
    expect(existsSync(join(cold, 'attestation.json'))).toBe(false);
    expect(readdirSync(join(warm, 'cache')).length).toBe(1);
  });
});
