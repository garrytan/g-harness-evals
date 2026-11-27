// internal-task: the owner card check the pilot reads (card present in arms N and G's first request, absent in arm B) and QM's
// sender signal, both from runner/trial/owner-card.ts, on synthetic request bodies and job files.

import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cardLinesIn, firstAgentLoopRequest, ownerCardCheck, qmSenderSignal } from '../runner/trial/owner-card.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-owner-card-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const CARD = Buffer.from('# Owner: Avery Quill\n\n- Email: avery@example.test\n- Slack: @avery\n\nThis is the person you work for.\n');
const SHA = createHash('sha256').update(CARD).digest('hex');
const MODEL = 'anthropic:claude-opus-5-5';
const housekeeping = { model: 'claude-haiku-5-5', system: 'Write a session title.', messages: [{ role: 'user', content: 'hi' }] };
const agent = (system: string) => ({ model: 'claude-opus-5-5', system: [{ type: 'text', text: system }], tools: [{ name: 'exec' }], messages: [{ role: 'user', content: 'Import these into my brain.' }] });
const READY = { harness: 'openclaw', owner_card: { file: '/workspace/AGENTS.md', card_sha256: SHA, appended_to_existing: false } };

test('the first agent-loop request is the first on the cell model offering tools; housekeeping on another model never counts', () => {
  const noTools = { model: 'claude-opus-5-5', messages: [] };
  expect(firstAgentLoopRequest([housekeeping, noTools, agent('a'), agent('b')], MODEL)).toEqual(agent('a'));
  expect(firstAgentLoopRequest([housekeeping, noTools], MODEL)).toEqual(noTools);
  expect(firstAgentLoopRequest([housekeeping], MODEL)).toBeNull();
});

test('card lines match through JSON escapes and collapsed whitespace', () => {
  expect(cardLinesIn(CARD.toString(), agent('# Project Context\n## /workspace/AGENTS.md\n# Owner:  Avery Quill\n\n- Email: avery@example.test\n- Slack: @avery\nThis is the person   you work for.'))).toEqual({ lines: 4, found: 4 });
  expect(cardLinesIn(CARD.toString(), agent('- Slack: @avery'))).toEqual({ lines: 4, found: 1 });
});

test('arm N or G: ok when ready names the same card and the first request holds every line', () => {
  const r = ownerCardCheck({ card: CARD, expected: true, ready: READY, requests: [housekeeping, agent('Context\n' + CARD.toString())], cellModel: MODEL });
  expect(r).toEqual({ expected: true, card_sha256: SHA, ready: { file: '/workspace/AGENTS.md', card_sha256: SHA }, first_request: 'present', lines: 4, lines_found: 4, ok: true });
});

test('arm N or G fails: the card only partly there, missing from ready, another card in ready, or no request', () => {
  expect(ownerCardCheck({ card: CARD, expected: true, ready: READY, requests: [agent('- Slack: @avery')], cellModel: MODEL })).toMatchObject({ first_request: 'partial', ok: false });
  expect(ownerCardCheck({ card: CARD, expected: true, ready: { harness: 'qm' }, requests: [agent(CARD.toString())], cellModel: MODEL })).toMatchObject({ ready: null, first_request: 'present', ok: false });
  expect(ownerCardCheck({ card: CARD, expected: true, ready: { owner_card: { ...READY.owner_card, card_sha256: 'f'.repeat(64) } }, requests: [agent(CARD.toString())], cellModel: MODEL }).ok).toBe(false);
  expect(ownerCardCheck({ card: CARD, expected: true, ready: READY, requests: [housekeeping], cellModel: MODEL })).toMatchObject({ first_request: 'no_request', ok: false });
});

test('arm B: ok when ready names no card and the first request holds none of its lines; any of them there is not ok', () => {
  expect(ownerCardCheck({ card: CARD, expected: false, ready: { harness: 'hermes' }, requests: [agent('You are Hermes.')], cellModel: MODEL })).toMatchObject({ expected: false, ready: null, first_request: 'absent', ok: true });
  expect(ownerCardCheck({ card: CARD, expected: false, ready: { harness: 'hermes' }, requests: [agent('- Email: avery@example.test')], cellModel: MODEL })).toMatchObject({ first_request: 'partial', ok: false });
  expect(ownerCardCheck({ card: CARD, expected: false, ready: READY, requests: [agent('nothing')], cellModel: MODEL }).ok).toBe(false);
});

test('a Responses request (Codex puts AGENTS.md in a user input item) is read the same way', () => {
  const body = { model: 'gpt-6.1-sol', instructions: 'You are Codex.', tools: [{ type: 'function', name: 'shell' }], input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /workspace\n\n<INSTRUCTIONS>\n' + CARD.toString() + '</INSTRUCTIONS>' }] }] };
  expect(ownerCardCheck({ card: CARD, expected: true, ready: READY, requests: [body], cellModel: 'openai:gpt-6.1-sol' })).toMatchObject({ first_request: 'present', ok: true });
});

test("QM's sender signal: actor.externalId and displayName per turn from the adapter's job files, in turn order", () => {
  const logs = join(tmp, 'qm-logs');
  mkdirSync(join(logs, 'turns'), { recursive: true });
  writeFileSync(join(logs, 'turns', 'turn-0002.job.json'), JSON.stringify({ actor: { externalId: 'U0B2', displayName: 'Bruno Versby' }, conversation: { kind: 'channel', threadRef: 'channel:C1' } }));
  writeFileSync(join(logs, 'turns', 'turn-0001.job.json'), JSON.stringify({ actor: { externalId: 'U0A1' }, conversation: { kind: 'dm', threadRef: 'dm:avery' } }));
  writeFileSync(join(logs, 'turns', 'turn-0001.qm.json'), '{}');
  expect(qmSenderSignal(logs)).toEqual({ field: 'actor.externalId', turns: [{ turn: 1, external_id: 'U0A1', display_name: null }, { turn: 2, external_id: 'U0B2', display_name: 'Bruno Versby' }] });
  expect(qmSenderSignal(join(tmp, 'nowhere'))).toBeNull();
});
