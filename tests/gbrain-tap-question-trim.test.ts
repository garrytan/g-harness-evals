// C4 freeze gate 4 deviation (the C4 preregistration): the tap trims a QM provider recall's question to the member's own text
// between our preamble's "Their message:" and "How to work here:" (else its "Current message: " part) and to gbrain's
// 2,000-character limit (trimProviderQuestion, world/services/gbrain-tap.ts), records the lengths on the event, and passes
// every other request through byte-identical. The stub upstream refuses a question over the limit the way
// gbrain a590ad07 does (invalid_params). Keyless, no network.

import { expect, test } from 'bun:test';
import { EventLog } from '../world/services/events.ts';
import { GBRAIN_QUESTION_MAX_CHARS, handleGbrainRequest, type GbrainUpstream } from '../world/services/gbrain-tap.ts';
import type { Member } from '../world/types.ts';

const BOT = 'xoxb-test-bot';
const PROVIDER = 'qm-provider-access-token';
const upstream: GbrainUpstream = { url: 'http://gbrain.invalid', token: 'gbrain_unscoped', provider: { tokens: [PROVIDER], actor: 'assistant', max_chars_arg: 'max_chars' } };
const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const NL = String.fromCharCode(10);
const MESSAGE = 'Remind me: what did I tell you the dock I use for Tamsin Cold Chain pickups is? ';

async function tap(token: string, body: unknown) {
  const raw = JSON.stringify(body);
  let forwarded = '';
  const log = new EventLog('t', null, () => '2026-11-03T09:00:00Z');
  const res = await handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: raw }), {
    upstream, log,
    resolveActor: (req) => (req.headers.get('authorization') === 'Bearer ' + BOT ? ({ id: 'assistant' } as Member) : null),
    fetchImpl: (async (_url: string, init: RequestInit) => {
      forwarded = String(init.body);
      const r = JSON.parse(forwarded) as { id: number; params: { arguments: { question?: string } } };
      const q = r.params.arguments.question ?? '';
      if (q.length > GBRAIN_QUESTION_MAX_CHARS) return Response.json({ jsonrpc: '2.0', id: r.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'invalid_params', message: 'question is ' + q.length + ' characters; the limit is 2000.' }) }] } });
      return Response.json({ jsonrpc: '2.0', id: r.id, result: { content: [{ type: 'text', text: JSON.stringify({ facts: [{ id: 1, fact: 'Dana: my Tamsin dock is Dock 38', source_id: 'private-dana-okafor' }] }) }] } });
    }) as unknown as typeof fetch,
  });
  return { status: res.status, raw, forwarded, event: log.events.find((e) => e.via === 'gbrain')! };
}

test('a 3,038-character composed provider question keeps its current message, fits the limit and is accepted', async () => {
  const history = 'user: ' + 'x'.repeat(1994);
  const message = MESSAGE.repeat(13).slice(0, 1020);
  const question = history + NL + 'Current message: ' + message;
  expect(question.length).toBe(3038);
  const { event, forwarded } = await tap(PROVIDER, call(1, 'recall', { question, acting_user: 'U1', max_chars: 6000 }));
  const sent = (JSON.parse(forwarded) as { params: { arguments: Record<string, unknown> } }).params.arguments;
  expect(sent).toEqual({ question: message, acting_user: 'U1', max_chars: 6000 });
  expect(event).toMatchObject({ caller: 'provider', provider_op: 'recall', outcome: 'ok', question_trim: { original_chars: 3038, trim_only_chars: 1020, member_text_chars: null, sent_chars: 1020, kept: 'current_message' } });
  expect((event.effect as { delivery: { facts: boolean[] } }).delivery.facts).toEqual([true]);
});

test('a composed turn prompt keeps only the member\'s own text between our preamble\'s markers', async () => {
  const member = 'Remind me: what did I tell you the dock I use for Tamsin Cold Chain pickups is? I need it for a handover note.';
  const prompt = 'You are `assistant`, the shared workspace bot. ' + 'p'.repeat(500) + NL + NL + 'Their message:' + NL + NL + member + NL + NL + 'How to work here:' + NL + NL + '1. ' + 'r'.repeat(3000);
  const question = 'user: ' + 'h'.repeat(1994) + NL + 'Current message: ' + prompt.slice(0, 2000);
  expect(question.length).toBe(4018);
  const { event, forwarded } = await tap(PROVIDER, call(9, 'recall', { question, acting_user: 'U1', max_chars: 6000 }));
  expect((JSON.parse(forwarded) as { params: { arguments: Record<string, unknown> } }).params.arguments).toEqual({ question: member, acting_user: 'U1', max_chars: 6000 });
  expect(event).toMatchObject({ outcome: 'ok', question_trim: { original_chars: 4018, trim_only_chars: 2000, member_text_chars: member.length, sent_chars: member.length, kept: 'member_text' } });
});

test('an opening marker with no closing one falls back to the current-message trim', async () => {
  const question = 'Current message: ' + 'Their message:' + NL + 'w'.repeat(2500);
  const { event } = await tap(PROVIDER, call(10, 'recall', { question, max_chars: 6000 }));
  expect(event).toMatchObject({ outcome: 'ok', question_trim: { member_text_chars: null, sent_chars: 2000, kept: 'current_message' } });
});

test('a long current message is cut to 2,000 characters after the label', async () => {
  const question = 'Current message: ' + 'm'.repeat(2000);
  const { event, forwarded } = await tap(PROVIDER, call(2, 'recall', { question, max_chars: 6000 }));
  expect((JSON.parse(forwarded) as { params: { arguments: { question: string } } }).params.arguments.question).toBe('m'.repeat(2000));
  expect(event).toMatchObject({ outcome: 'ok', question_trim: { original_chars: 2017, trim_only_chars: 2000, member_text_chars: null, sent_chars: 2000, kept: 'current_message' } });
});

test('a provider question with no current-message part is capped at its first 2,000 characters', async () => {
  const question = 'q'.repeat(1500) + 'r'.repeat(1500);
  const { event, forwarded } = await tap(PROVIDER, call(3, 'recall', { question, max_chars: 6000 }));
  expect((JSON.parse(forwarded) as { params: { arguments: { question: string } } }).params.arguments.question).toBe(question.slice(0, 2000));
  expect(event).toMatchObject({ outcome: 'ok', question_trim: { original_chars: 3000, trim_only_chars: 2000, member_text_chars: null, sent_chars: 2000, kept: 'head' } });
});

test('model recalls, provider searches and short provider recalls go upstream byte-identical, with no question_trim', async () => {
  const long = 'z'.repeat(2500) + NL + 'Current message: hi';
  const cases: Array<[string, unknown]> = [
    [BOT, call(4, 'recall', { question: long, max_chars: 6000 })],
    [BOT, call(5, 'recall', { question: long })],
    [PROVIDER, call(6, 'recall', { question: long })],
    [PROVIDER, call(7, 'recall', { question: 'Current message: short', max_chars: 6000 })],
    [PROVIDER, call(8, 'search', { query: long, max_chars: 6000 })],
    [BOT, call(11, 'recall', { question: 'Current message: Their message: hi How to work here: ' + 'y'.repeat(2500), max_chars: 6000 })],
  ];
  for (const [token, body] of cases) {
    const { raw, forwarded, event } = await tap(token, body);
    expect(forwarded).toBe(raw);
    expect(event).not.toHaveProperty('question_trim');
  }
  expect((await tap(BOT, cases[0]![1])).event).toMatchObject({ caller: 'model', outcome: 'error' });
});
