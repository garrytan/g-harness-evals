/**
 * The google route's via-OpenRouter mode (internal-task, runner/proxy/gemini-openrouter.ts): Gemini requests translated to
 * OpenRouter's Chat Completions and the answers translated back, streamed or not, with thought signatures carried both
 * ways. Keyless: OpenRouter is scripts/frontier-harbor/fake-upstream.ts on the loopback, which refuses a tool-call turn
 * replayed without its signature, and every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { fromChat, GeminiStream, SignatureStore, toChat } from '../runner/proxy/gemini-openrouter.ts';
import { MeteringProxy, parseProxyArgs, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { GEMINI_PROBE, OPENROUTER_GEMINI_SIGNATURE_ERROR, reply, SAFETY_MARKER, signatureFor } from '../scripts/frontier-harbor/fake-upstream.ts';

type Json = Record<string, any>;
const tmp = mkdtempSync(join(tmpdir(), 'gemini-openrouter-'));
const ENV = { OPENROUTER_API_KEY: 'placeholder-openrouter' };
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const sent: { path: string; body: Json; auth: string | null; goog: string | null }[] = [];
let n = 0;
let served = 'Google';
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  const path = new URL(req.url).pathname;
  const body = await req.json() as Json;
  sent.push({ path, body, auth: req.headers.get('authorization'), goog: req.headers.get('x-goog-api-key') });
  const res = reply(path, body, ++n);
  if (served === 'Google' || !res.ok) return res;
  const text = (await res.text()).replaceAll('"provider":"Google"', '"provider":"' + served + '"');
  return new Response(text, { status: res.status, headers: res.headers });
} });
afterAll(() => { fake.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

function proxy(via = true) {
  const lease = BudgetRun.openLease({ runId: 'via-' + ++n, leaseUsd: 50, ledgerPath: join(tmp, 'lease-' + n + '.sqlite') });
  const usageLog = join(tmp, 'usage-' + n + '.ndjson');
  const p = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + fake.port + '/openrouter' }, policy: { lease, env: ENV, usageLog, maxOutputTokens: 65_536, ...(via ? { googleVia: 'openrouter' as const } : {}) } });
  p.start();
  p.bind('t', 'trial-token:t', TOKEN, ['google:gemini-4-carbon']);
  const call = (method: string, body: unknown, query = '') => fetch('http://127.0.0.1:' + p.port + '/t/google/v1beta/models/gemini-4-carbon:' + method + query,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN }, body: JSON.stringify(body) });
  return { call, usage: () => readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine), stop: () => p.stop() };
}

const TOOLS = [{ functionDeclarations: [{ name: 'run_shell_command', description: 'Run a shell command', parametersJsonSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }] }];
const request = (contents: Json[]) => ({ systemInstruction: { parts: [{ text: 'You are a coding agent.' }] }, contents, tools: TOOLS,
  generationConfig: { temperature: 1, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } } });

/** Gemini events of a streamed answer, merged into one candidate the way Gemini CLI reads them. */
function merged(sseText: string): { parts: Json[]; finishReason?: string; usageMetadata?: Json } {
  const events = sseText.split('\r\n\r\n').filter((e) => e.startsWith('data: ')).map((e) => JSON.parse(e.slice(6)) as Json);
  const out: { parts: Json[]; finishReason?: string; usageMetadata?: Json } = { parts: [] };
  for (const e of events) {
    out.parts.push(...(e.candidates?.[0]?.content?.parts ?? []));
    if (e.candidates?.[0]?.finishReason) out.finishReason = e.candidates[0].finishReason;
    if (e.usageMetadata) out.usageMetadata = e.usageMetadata;
  }
  return out;
}

/** Runs Gemini CLI's loop against the proxy: send, run each call (an echo of its command), send the result back with the
 *  model turn as it came, until a text answer. */
async function loop(p: ReturnType<typeof proxy>, stream: boolean) {
  const contents: Json[] = [{ role: 'user', parts: [{ text: 'Fix the bug.' }] }];
  const turns: Json[][] = [];
  for (let i = 0; i < 5; i++) {
    const res = stream ? await p.call('streamGenerateContent', request(contents), '?alt=sse') : await p.call('generateContent', request(contents));
    expect(res.status).toBe(200);
    const parts = stream ? merged(await res.text()).parts : (await res.json() as Json).candidates[0].content.parts as Json[];
    turns.push(parts);
    const kept = parts.filter((x) => !x.thought);
    contents.push({ role: 'model', parts: kept });
    const calls = kept.filter((x) => x.functionCall);
    if (!calls.length) break;
    contents.push({ role: 'user', parts: calls.map((c) => ({ functionResponse: { id: c.functionCall.id, name: c.functionCall.name, response: { output: 'probe output' } } })) });
  }
  return turns;
}

describe('the translation', () => {
  test('a generateContent body becomes a Chat Completions body: system, roles, text, tools, calls and results, generation settings, thinking', () => {
    const store = new SignatureStore();
    const { chat, includeThoughts, dropped } = toChat({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'calling' }, { functionCall: { id: 'c1', name: 'f', args: { a: 1 } }, thoughtSignature: 'S1' }, { functionCall: { name: 'g', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'f', response: { ok: true } } }, { functionResponse: { name: 'g', response: { ok: 2 } } }] },
      ],
      tools: [{ functionDeclarations: [{ name: 'f', description: 'F', parameters: { type: 'OBJECT', properties: { a: { type: 'INTEGER', nullable: true } }, required: ['a'] } }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['f'] } },
      generationConfig: { temperature: 0.5, topP: 0.9, topK: 40, maxOutputTokens: 100, stopSequences: ['END'], responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' }, thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } },
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
    }, 'gemini-4-carbon', store);
    expect(includeThoughts).toBe(true);
    expect(dropped).toEqual(['safetySettings']);
    expect(chat).toEqual({
      model: 'google/gemini-4-carbon',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'calling', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }, { id: 'call_1_1', type: 'function', function: { name: 'g', arguments: '{}' } }],
          reasoning_details: [{ type: 'reasoning.encrypted', data: 'S1', id: 'c1', format: 'google-gemini-v1', index: 0 }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
        { role: 'tool', tool_call_id: 'call_1_1', content: '{"ok":2}' },
      ],
      tools: [{ type: 'function', function: { name: 'f', description: 'F', parameters: { type: 'object', properties: { a: { type: ['integer', 'null'] } }, required: ['a'] } } }],
      tool_choice: { type: 'function', function: { name: 'f' } },
      temperature: 0.5, top_p: 0.9, top_k: 40, max_tokens: 100, stop: ['END'],
      response_format: { type: 'json_schema', json_schema: { name: 'response', schema: { type: 'object' } } },
      reasoning: { effort: 'high' },
    });
    expect(toChat({ contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 2048 } } }, 'm', store).chat.reasoning).toEqual({ max_tokens: 2048 });
    expect(toChat({ contents: [], toolConfig: { functionCallingConfig: { mode: 'NONE' } } }, 'm', store).chat.tool_choice).toBe('none');
  });

  test('what cannot be carried is refused with HE-PROXY-012', () => {
    const store = new SignatureStore();
    const bad: Json[] = [
      { contents: [], cachedContent: 'cachedContents/1' },
      { contents: [{ role: 'user', parts: [{ fileData: { fileUri: 'files/1', mimeType: 'application/pdf' } }] }] },
      { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: 'AAAA' } }] }] },
      { contents: [], tools: [{ retrieval: {} }] },
      { contents: [], generationConfig: { candidateCount: 2 } },
      { contents: [], generationConfig: { speechConfig: {} } },
      { contents: [{ role: 'user', parts: [{ functionResponse: { name: 'nobody', response: {} } }] }] },
    ];
    for (const b of bad) expect(() => toChat(b, 'm', store)).toThrow(/^HE-PROXY-012 /);
    expect(toChat({ contents: [{ role: 'user', parts: [{ text: 'look' }, { inlineData: { mimeType: 'image/png', data: 'iVBO' } }] }] }, 'm', store).chat.messages[0].content)
      .toEqual([{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }]);
  });

  test('an answer becomes a candidate: thought text, text, each call with the signature keyed to it, finish reason and usage', () => {
    const store = new SignatureStore();
    const sig = { type: 'reasoning.encrypted', data: 'SIG', id: 'call_9', format: 'google-gemini-v1', index: 3, extra: 'kept' };
    const out = fromChat({ id: 'gen-1', choices: [{ finish_reason: 'tool_calls', native_finish_reason: 'STOP', message: { content: 'ok', reasoning: 'why',
      reasoning_details: [sig], tool_calls: [{ id: 'call_9', function: { name: 'f', arguments: '{"x":1}' } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 20 } } }, 'gemini-4-carbon', true, store);
    expect(out).toEqual({ candidates: [{ content: { role: 'model', parts: [{ text: 'why', thought: true }, { text: 'ok' }, { functionCall: { id: 'call_9', name: 'f', args: { x: 1 } }, thoughtSignature: 'SIG' }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 130, thoughtsTokenCount: 20, cachedContentTokenCount: 40 }, modelVersion: 'gemini-4-carbon', responseId: 'gen-1' });
    const back = toChat({ contents: [{ role: 'model', parts: out.candidates[0].content.parts.filter((x: Json) => !x.thought) }] }, 'gemini-4-carbon', store).chat.messages[0];
    expect(back.reasoning_details).toEqual([sig]);
    expect(fromChat({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }, 'm', false, store).candidates[0].finishReason).toBe('SAFETY');
    expect(fromChat({ choices: [{ finish_reason: 'length', native_finish_reason: 'MAX_TOKENS', message: { content: 'x' } }] }, 'm', false, store).candidates[0].finishReason).toBe('MAX_TOKENS');
  });

  test('a stream split at any byte gives the same Gemini events', () => {
    const lines = ['data: {"id":"g","choices":[{"delta":{"content":"he"}}]}', 'data: {"choices":[{"delta":{"content":"llo","tool_calls":[{"index":0,"id":"c","function":{"name":"f","arguments":"{\\"a\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}],"reasoning_details":[{"type":"reasoning.encrypted","data":"S","id":"c","format":"google-gemini-v1"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","native_finish_reason":"STOP"}]}', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}', 'data: [DONE]', ''].join('\n');
    const whole = new GeminiStream('m', false, new SignatureStore());
    const a = whole.push(lines) + whole.end();
    for (const cut of [1, 7, 33, 90, 200]) {
      const s = new GeminiStream('m', false, new SignatureStore());
      let b = '';
      for (let i = 0; i < lines.length; i += cut) b += s.push(lines.slice(i, i + cut));
      expect(b + s.end()).toBe(a);
    }
    const m = merged(a);
    expect(m.parts).toEqual([{ text: 'he' }, { text: 'llo' }, { functionCall: { id: 'c', name: 'f', args: { a: 1 } }, thoughtSignature: 'S' }]);
    expect(m.finishReason).toBe('STOP');
    expect(m.usageMetadata).toEqual({ promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 });
  });

  test('a stream that fails or stops early ends in a Gemini error event, with no half-built calls and no finishReason', () => {
    const start = ['data: {"id":"g","choices":[{"delta":{"content":"he","tool_calls":[{"index":0,"id":"c","function":{"name":"f","arguments":"{\\"a\\""}}]}}]}'];
    const cases: Array<[string[], number]> = [
      [[...start, 'data: {"error":{"code":429,"message":"Rate limited upstream"}}', 'data: [DONE]'], 429],
      [[...start, 'data: {"choices":[{"delta":{},"finish_reason":"error","error":{"code":"server_error","message":"Provider disconnected"}}]}', 'data: [DONE]'], 502],
      [start, 502],
    ];
    for (const [lines, code] of cases) {
      const s = new GeminiStream('m', false, new SignatureStore());
      const events = (s.push(lines.join('\n') + '\n') + s.end()).split('\r\n\r\n').filter(Boolean).map((e) => JSON.parse(e.slice(5)));
      const last = events.at(-1);
      expect(last.error.code).toBe(code);
      expect(typeof last.error.message).toBe('string');
      expect(events.some((e) => e.candidates?.some((c: Json) => c.finishReason || c.content?.parts?.some((p: Json) => p.functionCall)))).toBe(false);
    }
  });
});

describe('the proxy in the via-OpenRouter mode, against the fake OpenRouter', () => {
  for (const stream of [false, true]) {
    test('a three-turn tool loop (' + (stream ? 'streamed' : 'not streamed') + '): each signature comes back to OpenRouter unchanged, and the lines are the cell model metered at the OpenRouter row', async () => {
      const p = proxy();
      const from = sent.length;
      const turns = await loop(p, stream);
      expect(turns.map((t) => t.filter((x) => x.functionCall).map((x) => x.functionCall.args.command))).toEqual([[GEMINI_PROBE(1)], [GEMINI_PROBE(2)], []]);
      for (const t of turns.slice(0, 2)) {
        const call = t.find((x) => x.functionCall)!;
        expect(call.thoughtSignature).toBe(signatureFor(call.functionCall.id));
      }
      expect(turns[2]!.some((x) => typeof x.text === 'string' && x.text.includes('Fake upstream reply'))).toBe(true);
      const upstream = sent.slice(from);
      expect(upstream).toHaveLength(3);
      for (const u of upstream) {
        expect(u.path).toBe('/openrouter/v1/chat/completions');
        expect(u.auth).toBe('Bearer placeholder-openrouter');
        expect(u.goog).toBeNull();
        expect(u.body.provider).toEqual({ only: ['google-vertex/global'], allow_fallbacks: false, max_price: { prompt: 2, completion: 10 } });
        expect(u.body.reasoning).toEqual({ effort: 'high' });
        expect(u.body.max_tokens).toBe(8192);
        expect(u.body.stream === true).toBe(stream);
      }
      const third = upstream[2]!.body.messages.filter((m: Json) => m.role === 'assistant');
      expect(third.map((m: Json) => m.reasoning_details)).toEqual(third.map((m: Json) => [{ type: 'reasoning.encrypted', data: signatureFor(m.tool_calls[0].id), id: m.tool_calls[0].id, format: 'google-gemini-v1', index: 1 }]));
      await Bun.sleep(50);
      const lines = p.usage();
      expect(lines.map((l) => [l.provider, l.model, l.outcome, l.status, l.upstream, l.served_provider, l.thinking_level])).toEqual(Array(3).fill(['google', 'gemini-4-carbon', 'forwarded', 200, 'openrouter', 'Google', 'high']));
      for (const l of lines) expect(l.actual_usd).toBeCloseTo((60 * 2 + 40 * 0.1 + 30 * 10) / 1e6, 12);
      p.stop();
    });
  }

  test("Gemini CLI's housekeeping calls go through the same translation to their pinned endpoints and rows, only for a slot that lists them; the cell model is held to 65,536 output tokens", async () => {
    const lease = BudgetRun.openLease({ runId: 'via-hk-' + ++n, leaseUsd: 50, ledgerPath: join(tmp, 'lease-' + n + '.sqlite') });
    const usageLog = join(tmp, 'usage-' + n + '.ndjson');
    const p = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + fake.port + '/openrouter' }, policy: { lease, env: ENV, usageLog, maxOutputTokens: 128_000, googleVia: 'openrouter' } });
    p.start();
    p.bind('hk', 'trial-token:hk', TOKEN, ['google:gemini-4-carbon', 'google:gemini-3-flash-preview', 'google:gemini-3.1-pro-preview-customtools']);
    p.bind('plain', 'trial-token:plain', TOKEN, ['google:gemini-4-carbon']);
    const call = (slot: string, model: string, body: unknown) => fetch('http://127.0.0.1:' + p.port + '/' + slot + '/google/v1beta/models/' + model + ':generateContent',
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN }, body: JSON.stringify(body) });
    // The loop-detection request Gemini CLI 0.68.0 sends (its shape, seen keyless): a JSON-schema answer, no tools, no output cap.
    const check = { systemInstruction: { parts: [{ text: 'You are a diagnostic agent that determines whether a conversational AI assistant is stuck in an unproductive loop.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Fix the build.' }] }, { role: 'model', parts: [{ text: 'Running the tests.' }] }, { role: 'user', parts: [{ text: 'Recent conversation history above.' }] }],
      generationConfig: { temperature: 0, topP: 1, responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { unproductive_state_confidence: { type: 'number' } }, required: ['unproductive_state_confidence'] } } };
    const from = sent.length;
    served = 'Google';
    const flash = await call('hk', 'gemini-3-flash-preview', check);
    expect(flash.status).toBe(200);
    served = 'Google AI Studio';
    const pro = await call('hk', 'gemini-3.1-pro-preview-customtools', { ...check, generationConfig: { ...check.generationConfig, thinkingConfig: { thinkingLevel: 'HIGH' } } });
    expect(pro.status).toBe(200);
    served = 'Google';
    expect((await call('plain', 'gemini-3-flash-preview', check)).status).toBe(403);
    const cell = await call('hk', 'gemini-4-carbon', { ...request([{ role: 'user', parts: [{ text: 'Run the probe.' }] }]), generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } });
    expect(cell.status).toBe(200);
    const upstream = sent.slice(from).map((s) => s.body);
    expect(upstream.map((b) => [b.model, b.provider.only[0], b.provider.max_price, b.max_completion_tokens])).toEqual([
      ['google/gemini-3-flash-preview', 'google-vertex/global', { prompt: 0.5, completion: 3 }, 65_536],
      ['google/gemini-3.1-pro-preview-customtools', 'google-ai-studio', { prompt: 2, completion: 12 }, 65_536],
      ['google/gemini-4-carbon', 'google-vertex/global', { prompt: 2, completion: 10 }, 65_536],
    ]);
    expect(upstream[0]!.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'response', schema: check.generationConfig.responseJsonSchema } });
    expect(upstream[1]!.reasoning).toEqual({ effort: 'high' });
    await Bun.sleep(50);
    const lines = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
    expect(lines.map((l) => [l.model, l.outcome, l.status, l.served_provider ?? null, l.served_elsewhere ?? false])).toEqual([
      ['gemini-3-flash-preview', 'forwarded', 200, 'Google', false],
      ['gemini-3.1-pro-preview-customtools', 'forwarded', 200, 'Google AI Studio', false],
      ['gemini-3-flash-preview', 'refused', 403, null, false],
      ['gemini-4-carbon', 'forwarded', 200, 'Google', false],
    ]);
    expect(lines[0]!.actual_usd).toBeCloseTo((60 * 0.5 + 40 * 0.05 + 30 * 3) / 1e6, 12);
    expect(lines[1]!.actual_usd).toBeCloseTo((60 * 2 + 40 * 0.2 + 30 * 12) / 1e6, 12);
    p.stop();
  });

  test("the openrouter route refuses Gemini CLI's housekeeping models: only the google route forwards them", async () => {
    const lease = BudgetRun.openLease({ runId: 'or-hk-' + ++n, leaseUsd: 50, ledgerPath: join(tmp, 'lease-' + n + '.sqlite') });
    const p = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + fake.port + '/openrouter' }, policy: { lease, env: ENV, usageLog: join(tmp, 'usage-' + n + '.ndjson'), maxOutputTokens: 65_536 } });
    p.start();
    p.bind('o', 'trial-token:o', TOKEN, ['openrouter:google/gemini-3-flash-preview']);
    const from = sent.length;
    const res = await fetch('http://127.0.0.1:' + p.port + '/o/openrouter/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('HE-PROXY-008');
    expect(sent.length).toBe(from);
    p.stop();
  });

  test('a changed signature reaches OpenRouter as sent, and its 400 comes back as a Gemini error', async () => {
    const p = proxy();
    const contents = [{ role: 'user', parts: [{ text: 'go' }] }, { role: 'model', parts: [{ functionCall: { id: 'tool_x', name: 'run_shell_command', args: { command: 'ls' } }, thoughtSignature: 'bm90LXRoZS1zaWduYXR1cmU=' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'tool_x', name: 'run_shell_command', response: { output: '' } } }] }];
    const res = await p.call('generateContent', request(contents));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 400, message: OPENROUTER_GEMINI_SIGNATURE_ERROR, status: 'INVALID_ARGUMENT' } });
    p.stop();
  });

  test('a safety stop is SAFETY to Gemini CLI and its own field on the line, streamed or not', async () => {
    const p = proxy();
    const ask = request([{ role: 'user', parts: [{ text: SAFETY_MARKER }] }]);
    const plain = await (await p.call('generateContent', ask)).json() as Json;
    expect(plain.candidates[0].finishReason).toBe('SAFETY');
    const streamed = merged(await (await p.call('streamGenerateContent', ask, '?alt=sse')).text());
    expect(streamed.finishReason).toBe('SAFETY');
    await Bun.sleep(50);
    expect(p.usage().map((l) => l.safety_stop)).toEqual(['finish_reason:content_filter', 'finish_reason:content_filter']);
    p.stop();
  });

  test('countTokens is a local estimate, logged at $0 and never forwarded; untranslatable requests are refused before any spend', async () => {
    const p = proxy();
    const from = sent.length;
    const c = await p.call('countTokens', { contents: [{ role: 'user', parts: [{ text: 'x'.repeat(400) }] }] });
    expect(c.status).toBe(200);
    expect(((await c.json()) as Json).totalTokens).toBeGreaterThan(100);
    const r = await p.call('generateContent', { contents: [], cachedContent: 'cachedContents/abc' });
    expect(r.status).toBe(400);
    expect(sent.length).toBe(from);
    const [count, refused] = p.usage();
    expect(count).toMatchObject({ outcome: 'forwarded', local_estimate: true, actual_usd: 0, model: 'gemini-4-carbon' });
    expect(refused).toMatchObject({ outcome: 'refused', status: 400 });
    expect(refused!.reason).toStartWith('HE-PROXY-012 cachedContent');
    p.stop();
  });

  test('an answer from another provider is marked served elsewhere (HE-PROXY-009), as on the OpenRouter route', async () => {
    const p = proxy();
    served = 'Google AI Studio';
    try { await (await p.call('generateContent', request([{ role: 'user', parts: [{ text: 'hi' }] }]))).json(); }
    finally { served = 'Google'; }
    expect(p.usage()[0]).toMatchObject({ served_elsewhere: true, served_provider: 'Google AI Studio' });
    expect(p.usage()[0]!.reason).toContain('HE-PROXY-009');
    p.stop();
  });

  test('without the mode the google route still needs GEMINI_API_KEY and countTokens is not served; --google-via takes only openrouter', async () => {
    const p = proxy(false);
    expect((await p.call('generateContent', request([{ role: 'user', parts: [{ text: 'hi' }] }]))).status).toBe(503);
    expect((await p.call('countTokens', { contents: [] })).status).toBe(403);
    p.stop();
    const base = ['--budget-ledger', 'l', '--lease-usd', '1', '--run-id', 'r'];
    expect(parseProxyArgs([...base, '--google-via', 'openrouter']).googleVia).toBe('openrouter');
    expect(parseProxyArgs(base).googleVia).toBeNull();
    expect(() => parseProxyArgs([...base, '--google-via', 'vertex'])).toThrow('--google-via must be openrouter');
  });
});
