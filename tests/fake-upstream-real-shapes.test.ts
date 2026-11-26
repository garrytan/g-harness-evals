/**
 * The keyless fake upstream refuses only what a provider documents or was seen to refuse (amendment 4 of
 * frontier-shootout-2026-11). Before it, the fake refused three replay shapes that the real APIs answered with 200 in the
 * as-wired gates at 7c604eb: Carbon in Hermes with every reasoning_details entry dropped (s01), Carbon in OpenClaw with its
 * tool call ids rewritten from call_N to callN (s02), and Muse Wonder in Hermes with every reasoning field dropped (s29).
 * These tests send those shapes and expect 200, and check the documented refusals still stand: DeepSeek's thinking mode
 * without its reasoning_content, a Gemini signature that was changed, and a native Gemini function call with no signature.
 */
import { describe, expect, test } from 'bun:test';
import { OPENROUTER_MODELS } from '../runner/proxy/metering-proxy.ts';
import { DEEPSEEK_REPLAY_ERROR } from './fixtures/openrouter/fake-openrouter.ts';
import { GEMINI_SIGNATURE_ERROR, OPENROUTER_GEMINI_SIGNATURE_ERROR, reply, signatureFor } from '../scripts/frontier-harbor/fake-upstream.ts';

const TOOLS = [{ type: 'function', function: { name: 'terminal', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }];
const pinned = (model: string) => {
  const pin = OPENROUTER_MODELS[model]!;
  return { provider: { only: [pin.only], allow_fallbacks: false }, ...(pin.service_tier ? { service_tier: pin.service_tier } : {}) };
};
const call = (id: string) => ({ id, type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } });
const chat = (model: string, assistant: Record<string, unknown>, toolId: string) => ({
  model, stream: false, tools: TOOLS, ...pinned(model),
  messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: '', ...assistant }, { role: 'tool', tool_call_id: toolId, content: 'a.txt' }],
});
const post = (body: Record<string, unknown>, path = '/openrouter/api/v1/chat/completions') => reply(path, body, 1);
const signature = (id: string, data = signatureFor(id)) => ({ type: 'reasoning.encrypted', format: 'google-gemini-v1', id, data, index: 0 });

describe('replay shapes the real APIs answered with 200 (as-wired gates at 7c604eb)', () => {
  test('s01: Carbon in Hermes, every reasoning_details entry dropped', async () => {
    const res = post(chat('google/gemini-4-carbon', { tool_calls: [call('call_1')] }, 'call_1'));
    expect(res.status).toBe(200);
  });
  test('s02: Carbon in OpenClaw, tool call ids rewritten from call_N to callN with the signature kept', async () => {
    const res = post(chat('google/gemini-4-carbon', { tool_calls: [call('call1')], reasoning_details: [signature('call_1')] }, 'call1'));
    expect(res.status).toBe(200);
  });
  test('s29: Muse Wonder in Hermes, every reasoning field dropped', async () => {
    const res = post(chat('meta/muse-wonder', { tool_calls: [call('call_1')] }, 'call_1'));
    expect(res.status).toBe(200);
  });
  test('Muse Code on the Responses route, a function_call replayed with no reasoning item', async () => {
    const body = { model: 'meta/muse-wonder', stream: false, ...pinned('meta/muse-wonder'), input: [{ role: 'user', content: 'go' },
      { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_1', output: '' }] };
    expect(post(body, '/openrouter/api/v1/responses').status).toBe(200);
  });
});

describe('documented refusals still stand', () => {
  test("DeepSeek's thinking mode refuses a tool-call turn replayed without its reasoning", async () => {
    const res = post(chat('deepseek/deepseek-v4.1-flash-1017', { tool_calls: [call('call_1')] }, 'call_1'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(DEEPSEEK_REPLAY_ERROR);
  });
  test('a Gemini signature that was changed gets the invalid-signature 400', async () => {
    const res = post(chat('google/gemini-4-carbon', { tool_calls: [call('call_1')], reasoning_details: [signature('call_1', 'bm90LXRoZS1zaWduYXR1cmU=')] }, 'call_1'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(OPENROUTER_GEMINI_SIGNATURE_ERROR);
  });
  test('a native Gemini function call replayed with no thoughtSignature gets the 400 Google documents', async () => {
    const body = { contents: [{ role: 'user', parts: [{ text: 'go' }] }, { role: 'model', parts: [{ functionCall: { name: 'terminal', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'terminal', response: { output: '' } } }] }] };
    const res = reply('/google/v1beta/models/gemini-4-carbon:generateContent', body, 1);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(GEMINI_SIGNATURE_ERROR);
  });
});
