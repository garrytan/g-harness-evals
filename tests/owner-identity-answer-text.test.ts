import { describe, expect, test } from 'bun:test';
import { answerText } from '../runner/trial/trial.ts';
import type { TurnWindow } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';

const post = (seq: number, actor: string, text: string, outcome = 'ok') => ({ seq, actor, tool: 'chat.postMessage', kind: 'write', outcome, args: { channel: 'D1', text } }) as unknown as WorldEvent;
const window = (o: Partial<TurnWindow>) => ({ started_seq: 10, ended_seq: 20, reply_text: 'runner reply', ...o }) as TurnWindow;

describe('owner-identity answer text', () => {
  test('a withheld reply is replaced by what the bot posted in the turn', () => {
    const events = [post(9, 'assistant', 'earlier turn'), post(12, 'chloe', 'the question'), post(15, 'assistant', 'You ride a Sorfrapor roadster.'), post(16, 'assistant', 'refused', 'error'), post(21, 'assistant', 'later')];
    expect(answerText(events, 'assistant', window({ reply_withheld: 'bot_posted', reply_text: 'Replied in your DM.' }))).toBe('You ride a Sorfrapor roadster.');
  });
  test('the runner reply counts when it was posted', () => {
    expect(answerText([], 'assistant', window({}))).toBe('runner reply');
  });
  test('no turn, no text', () => {
    expect(answerText([], 'assistant', undefined)).toBeNull();
    expect(answerText([], 'assistant', window({ reply_text: '', reply_withheld: undefined }))).toBeNull();
  });
});
