import { describe, expect, test } from 'bun:test';
import { effortCounts, effortFields } from '../runner/proxy/effort.ts';
import { safetyStop } from '../runner/proxy/stops.ts';

describe('Gemini effort fields (internal-task)', () => {
  test('thinkingLevel is recorded lower-case as thinking_level, in either spelling, and thinkingBudget as thinking_budget_tokens', () => {
    expect(effortFields({ generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } } })).toEqual({ thinking_level: 'high' });
    for (const level of ['low', 'medium', 'high', 'minimal']) expect(effortFields({ generationConfig: { thinkingConfig: { thinkingLevel: level.toUpperCase() } } })).toEqual({ thinking_level: level });
    expect(effortFields({ generation_config: { thinking_config: { thinking_level: 'low' } } })).toEqual({ thinking_level: 'low' });
    expect(effortFields({ generationConfig: { thinkingConfig: { thinkingBudget: 8192 } } })).toEqual({ thinking_budget_tokens: 8192 });
    expect(effortFields({ generationConfig: { maxOutputTokens: 100 } })).toEqual({});
  });

  test('an unknown level or a budget that is not a whole number of tokens is named by its path and never logged', () => {
    expect(effortFields({ generationConfig: { thinkingConfig: { thinkingLevel: 'secret-marker' } } })).toEqual({ unrecognized_effort_fields: ['generationConfig.thinkingConfig.thinkingLevel'] });
    expect(effortFields({ generationConfig: { thinkingConfig: { thinkingBudget: -1 } } })).toEqual({ unrecognized_effort_fields: ['generationConfig.thinkingConfig.thinkingBudget'] });
    expect(effortFields({ generation_config: { thinking_config: { thinking_level: 7 } } })).toEqual({ unrecognized_effort_fields: ['generation_config.thinking_config.thinking_level'] });
  });

  test('effortCounts keys a Gemini call by its thinking level', () => {
    const line = { outcome: 'forwarded' as const, route: '/v1beta/models/gemini-4-carbon:streamGenerateContent', thinking_level: 'high' };
    expect(effortCounts([line, line, { ...line, thinking_level: undefined }])).toEqual({ 'thinking_level=high': 2, none: 1 });
  });
});

describe('safety-filter stops (internal-task, R95)', () => {
  test('Gemini: a safety finish on a candidate, or a blocked prompt, in a body, a JSON array or an SSE stream', () => {
    for (const finish of ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION']) expect(safetyStop({ candidates: [{ finishReason: finish }] })).toEqual({ safety_stop: `finishReason:${finish}` });
    expect(safetyStop({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).toEqual({ safety_stop: 'blockReason:PROHIBITED_CONTENT' });
    expect(safetyStop([{ candidates: [{ finishReason: 'STOP' }] }, { candidates: [{ finishReason: 'SAFETY' }] }])).toEqual({ safety_stop: 'finishReason:SAFETY' });
    expect(safetyStop('data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\ndata: {"candidates":[{"finishReason":"SAFETY"}],"usageMetadata":{}}\n\n')).toEqual({ safety_stop: 'finishReason:SAFETY' });
    expect(safetyStop({ candidates: [{ finishReason: 'STOP' }] })).toEqual({});
    expect(safetyStop({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toEqual({});
    expect(safetyStop({ promptFeedback: { blockReason: 'some free text' } })).toEqual({});
  });

  test('Chat Completions (xAI, OpenRouter, OpenAI): content_filter finish, or a refusal, whose text is never kept', () => {
    expect(safetyStop({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] })).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(safetyStop({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help with that.' } }] })).toEqual({ safety_stop: 'refusal' });
    expect(safetyStop('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n')).toEqual({ safety_stop: 'finish_reason:content_filter' });
    expect(JSON.stringify(safetyStop({ choices: [{ message: { refusal: 'private words' } }] }))).not.toContain('private');
    expect(safetyStop({ choices: [{ finish_reason: 'stop', message: { content: 'ok', refusal: null } }] })).toEqual({});
  });

  test('Responses (OpenAI, xAI) and Anthropic Messages', () => {
    expect(safetyStop({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] })).toEqual({ safety_stop: 'incomplete_details:content_filter' });
    expect(safetyStop({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })).toEqual({ safety_stop: 'refusal' });
    expect(safetyStop('event: response.refusal.delta\ndata: {"type":"response.refusal.delta","delta":"no"}\n\n')).toEqual({ safety_stop: 'refusal' });
    expect(safetyStop({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })).toEqual({});
    expect(safetyStop({ type: 'message', stop_reason: 'refusal', content: [] })).toEqual({ safety_stop: 'stop_reason:refusal' });
    expect(safetyStop('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":3}}\n\n')).toEqual({ safety_stop: 'stop_reason:refusal' });
    expect(safetyStop({ type: 'message', stop_reason: 'end_turn' })).toEqual({});
    expect(safetyStop(null)).toEqual({});
    expect(safetyStop('not json')).toEqual({});
  });
});
