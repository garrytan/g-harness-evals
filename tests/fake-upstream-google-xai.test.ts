import { describe, expect, test } from 'bun:test';
import { GEMINI_SIGNATURE, GEMINI_SIGNATURE_ERROR, reply, SAFETY_MARKER } from '../scripts/frontier-harbor/fake-upstream.ts';
import { safetyStop } from '../runner/proxy/stops.ts';

/** The fake upstream's google and xai routes (internal-task): what the keyless install check and the proxy tests talk to. */
const gemini = (method: string, body: object) => reply('/google/v1beta/models/gemini-4-carbon:' + method, body as Record<string, any>, 1);
const text = (r: Response) => r.text();

describe('fake upstream: Gemini', () => {
  test('a text reply with usageMetadata, streamed as SSE chunks whose last carries the usage', async () => {
    const plain = await gemini('generateContent', { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }).json() as any;
    expect(plain.candidates[0].finishReason).toBe('STOP');
    expect(plain.usageMetadata).toMatchObject({ promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 4 });
    const streamed = gemini('streamGenerateContent', { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    expect(streamed.headers.get('content-type')).toBe('text/event-stream');
    const events = (await text(streamed)).split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
    expect(events.at(-1).usageMetadata.candidatesTokenCount).toBe(5);
  });

  test('a declared function is called once with a thought signature, and a replay that drops the signature gets Gemini\'s 400', async () => {
    const tools = [{ functionDeclarations: [{ name: 'run_shell_command', parameters: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } } }] }];
    const first = await gemini('generateContent', { contents: [{ role: 'user', parts: [{ text: 'go' }] }], tools }).json() as any;
    const part = first.candidates[0].content.parts[0];
    expect(part).toEqual({ functionCall: { name: 'run_shell_command', args: { command: 'true' } }, thoughtSignature: GEMINI_SIGNATURE });
    const turn = (call: object) => ({ tools, contents: [{ role: 'user', parts: [{ text: 'go' }] }, { role: 'model', parts: [call] }, { role: 'user', parts: [{ functionResponse: { name: 'run_shell_command', response: { output: 'ok' } } }] }] });
    const kept = await gemini('generateContent', turn(part)).json() as any;
    expect(kept.candidates[0].content.parts[0].text).toContain('Fake upstream reply');
    const dropped = gemini('generateContent', turn({ functionCall: part.functionCall }));
    expect(dropped.status).toBe(400);
    expect(JSON.stringify(await dropped.json())).toContain(GEMINI_SIGNATURE_ERROR);
  });

  test('the safety marker gets finishReason SAFETY, which the proxy records as a safety stop, streamed or not', async () => {
    const body = { contents: [{ role: 'user', parts: [{ text: 'please ' + SAFETY_MARKER }] }] };
    expect(safetyStop(await gemini('generateContent', body).json())).toEqual({ safety_stop: 'finishReason:SAFETY' });
    expect(safetyStop(await text(gemini('streamGenerateContent', body)))).toEqual({ safety_stop: 'finishReason:SAFETY' });
  });
});

describe('fake upstream: xAI', () => {
  const chat = (extra: object = {}) => ({ model: 'grok-4.7', messages: [{ role: 'user', content: 'hi' }], ...extra });
  test('Chat Completions and Responses answer with xAI usage, reasoning tokens and cost_in_usd_ticks', async () => {
    const c = await reply('/xai/v1/chat/completions', chat(), 1).json() as any;
    expect(c.usage).toMatchObject({ completion_tokens: 5, total_tokens: 19, completion_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 });
    const r = await reply('/xai/v1/responses', { model: 'grok-4.7', input: 'hi', store: false }, 2).json() as any;
    expect(r).toMatchObject({ status: 'completed', store: false, usage: { output_tokens_details: { reasoning_tokens: 4 }, cost_in_usd_ticks: 1000 } });
    const s = await text(reply('/xai/v1/chat/completions', chat({ stream: true }), 3));
    expect(s.trim().endsWith('data: [DONE]')).toBe(true);
    expect(s).toContain('"cost_in_usd_ticks":1000');
  });

  test('the safety marker gets the content-filter stop on both routes, streamed or not', async () => {
    const marked = chat({ messages: [{ role: 'user', content: SAFETY_MARKER }] });
    expect(safetyStop(await reply('/xai/v1/chat/completions', marked, 1).json())).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(safetyStop(await text(reply('/xai/v1/chat/completions', { ...marked, stream: true }, 2)))).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(safetyStop(await reply('/xai/v1/responses', { model: 'grok-4.7', input: SAFETY_MARKER }, 3).json())).toEqual({ safety_stop: 'incomplete_details:content_filter' });
    expect(safetyStop(await text(reply('/xai/v1/responses', { model: 'grok-4.7', input: SAFETY_MARKER, stream: true }, 4)))).toEqual({ safety_stop: 'incomplete_details:content_filter' });
  });
});
