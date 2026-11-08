// internal-task pilot amendment: QM after #2964 and #2971 (2026-11-03) answers its admin session route with items instead of
// entries. s1-count.ts entryFromItem is QM b6786d67's own read-side converter, so the S1 and S1 edition counters keep
// reading the entry shape they were written for. Keyless.
//
// Value: protects=a newer QM's stored skill read and its answer reach toolCalls as the same call b6786d67 stored, with
// the cut output's blob, and a page that says it has more items is refused rather than counted short; fails_when=the
// counters see no tool calls on QM main (every open, read and first step counts false), a blob is lost, or a partial
// transcript is counted; seam=sessionEvidence's HTTP body; no_claim=a live QM (the dry-run receipt at 90e4ced7 covers it).
import { describe, expect, test } from 'bun:test';
import { entryFromItem, toolCalls } from '../harnesses/qm/gstack/s1-count.ts';
import { sessionEvidence } from '../harnesses/qm/gstack/s1-probe.ts';

const call = { kind: 'ToolCall', sessionId: 's', seq: 3, createdAt: 1, turnId: null, callId: 'c1', tool: 'skills', step: 0, body: { action: 'read', name: 'gstack-review', wire: { argumentsJson: '{"action":"read","name":"gstack-review"}', message: { role: 'assistant' } } } };
const result = { kind: 'ToolResult', sessionId: 's', seq: 4, createdAt: 2, callId: 'c1', tool: 'skills', text: 'body', isError: false, blobSha: 'abc', body: { action: 'read', name: 'gstack-review', found: true, bytes: 4, output: { chars: 4 } } };

describe('entryFromItem (QM b6786d67 src/sessions/items.ts)', () => {
  test('a tool call and its answer come back as tool_call and tool_result entries with the columns in the payload', () => {
    const c = entryFromItem(call);
    expect(c).toEqual({ seq: 3, type: 'tool_call', payload: { action: 'read', name: 'gstack-review', wire: { argumentsJson: '{"action":"read","name":"gstack-review"}', message: { role: 'assistant' } }, callId: 'c1', tool: 'skills', step: { role: 'assistant', index: 0 } } });
    const r = entryFromItem(result);
    expect(r.type).toBe('tool_result');
    expect(r.payload).toMatchObject({ result: 'body', callId: 'c1', tool: 'skills', isError: false, found: true, output: { chars: 4, blob: 'abc' } });
  });

  test('messages, replies and approvals map to the entry types the counters read', () => {
    expect(entryFromItem({ kind: 'UserMessage', seq: 0, text: 'hi', body: {} })).toEqual({ seq: 0, type: 'user', payload: { text: 'hi' } });
    expect(entryFromItem({ kind: 'AgentMessage', seq: 5, text: 'done', variant: 'narration', body: {} }).type).toBe('text');
    expect(entryFromItem({ kind: 'Elicitation', seq: 6, elicitId: 'r1', body: {} })).toEqual({ seq: 6, type: 'approval_request', payload: { requestId: 'r1' } });
    expect(entryFromItem({ kind: 'Error', seq: 7, text: 'boom', errorCode: 'turn_failure', body: {} })).toEqual({ seq: 7, type: 'system', payload: { message: 'boom', kind: 'turn_failure' } });
  });

  test('sessionEvidence reads items, pairs the call with its answer, and refuses a page with more to come', () => {
    const got = sessionEvidence({ http: 200, body: { session: {}, items: [call, result], hasMore: false } });
    expect('entries' in got).toBe(true);
    const calls = toolCalls((got as { entries: Parameters<typeof toolCalls>[0] }).entries);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ seq: 3, callId: 'c1', tool: 'skills', resultSeq: 4 });
    expect(calls[0]!.result).toMatchObject({ found: true, result: 'body' });
    expect('error' in sessionEvidence({ http: 200, body: { items: [call], hasMore: true } })).toBe(true);
    expect(sessionEvidence({ http: 200, body: { entries: [{ seq: 1, type: 'user', payload: { text: 'x' } }] } })).toEqual({ entries: [{ seq: 1, type: 'user', payload: { text: 'x' } }] });
  });

  test('an item whose seq is missing or not a number is refused, not counted as NaN', () => {
    for (const seq of [undefined, null, 'x', '', true]) expect(() => entryFromItem({ kind: 'UserMessage', seq, text: 'hi', body: {} })).toThrow('seq');
    expect(entryFromItem({ kind: 'UserMessage', seq: '4', text: 'hi', body: {} }).seq).toBe(4);
    const bad = sessionEvidence({ http: 200, body: { items: [call, { ...result, seq: undefined }], hasMore: false } });
    expect('error' in bad && bad.error).toContain('seq');
  });
});
