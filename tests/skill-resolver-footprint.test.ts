// internal-task context footprint (scripts/skill-resolver/footprint.ts): the transcript built from set P dev rows (never set R), the
// session task, finding each turn's agent request in a captured log, the token counts and the added figure, the first turn with
// budget_exhausted, and the QM row marked not applicable. Keyless: no model call, no Docker daemon.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTask } from '../runner/trial/task.ts';
import { ACTOR, QM_NOT_APPLICABLE, SET_R_SHA256, addedAt, buildTranscript, countLocal, countedBody, firstExhausted, renderTable, turnRequests, writeSessionTask, type LogRow } from '../scripts/skill-resolver/footprint.ts';

const ROOT = join(import.meta.dir, '..');
const scratch = () => mkdtempSync(join(tmpdir(), 'footprint-'));
const devSet = (n: number, extra: object[] = []) => {
  const f = join(scratch(), 'setp-dev.jsonl');
  writeFileSync(f, [...Array.from({ length: n }, (_, i) => ({ id: 'p-d-' + String(i).padStart(3, '0'), request: 'Request number ' + i + ' about deploying the billing service', half: 'dev' })), ...extra].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
};

describe('the transcript', () => {
  test('50 set P dev rows in the seeded order, the same on every build', () => {
    const f = devSet(60);
    const a = buildTranscript(f), b = buildTranscript(f);
    expect(a).toEqual(b);
    expect(a.map((t) => t.turn)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(a.map((t) => t.id)).size).toBe(50);
    expect(a.map((t) => t.id)).not.toEqual([...a.map((t) => t.id)].sort());
  });

  test('a row repeating an earlier text is skipped, so every turn text is distinct', () => {
    const t = buildTranscript(devSet(60, Array.from({ length: 20 }, (_, i) => ({ id: 'p-d-dup-' + i, request: 'Request number 3 about deploying the billing service', half: 'dev' }))));
    expect(new Set(t.map((x) => x.text)).size).toBe(50);
    expect(t.filter((x) => x.text === 'Request number 3 about deploying the billing service')).toHaveLength(1);
  });

  test('set R is refused: its hash is the one SETS.md records, and a row with prev_user_text or a test row is refused', () => {
    expect(readFileSync(join(ROOT, 'docs', 'benchmarks', '2026-11-08-skill-resolver', 'SETS.md'), 'utf8')).toContain('| setR.jsonl (300 turns) | ' + SET_R_SHA256 + ' |');
    expect(() => buildTranscript(devSet(60, [{ id: 'r-1', text: 'hello there', prev_user_text: 'earlier', half: 'dev' }]))).toThrow(/prev_user_text, set R's shape/);
    expect(() => buildTranscript(devSet(60, [{ id: 'p-t-1', request: 'held out request', half: 'test' }]))).toThrow(/is not a dev row/);
    expect(() => buildTranscript(devSet(10))).toThrow(/has 10 dev rows with distinct texts; the transcript needs 50/);
  });

  test('the session task is one DM per turn from the same member, so every turn lands in one session', () => {
    const turns = buildTranscript(devSet(60));
    const dir = join(scratch(), 'footprint-50');
    writeSessionTask(turns, dir);
    const t = loadTask(dir);
    expect(t.turns).toHaveLength(50);
    expect(t.turns.every((x, i) => x.actor === ACTOR && x.channel === 'dm' && x.text === turns[i]!.text)).toBe(true);
    expect(t.predicates.required).toEqual([]);
  });
});

describe('measuring the captured requests', () => {
  const user = (text: string) => ({ role: 'user', content: 'A member is writing to you now.\n\nTheir message:\n\n' + text + '\n\nHow to work here: look, book, ok.' });
  const agent = (msgs: object[], block = '') => ({ method: 'POST', path: '/v1/messages', body: { model: 'claude-opus-5-5', system: [{ type: 'text', text: 'You are the bot.' + block }], tools: [{ name: 'Skill', input_schema: {} }], messages: msgs } });
  const title = (text: string) => ({ method: 'POST', path: '/v1/messages', body: { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'Title this: ' + text }] } });
  const texts = ['Please roll out the billing service to staging and check the health endpoint.', 'ok', 'Write the release notes for 2.3 from the changelog.'];
  const reply = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };
  const log = (block = ''): LogRow[] => [
    { method: 'GET', path: '/v1/models' }, title(texts[0]!), agent([user(texts[0]!)], block),
    agent([user(texts[0]!), reply, user(texts[1]!)], block + block), title(texts[2]!),
    agent([user(texts[0]!), reply, user(texts[1]!), reply, user(texts[2]!)], block + block + block),
  ];

  test("each turn's agent request is the largest one carrying its text and not the next turn's; a short text is found only as the member's message", () => {
    expect(turnRequests(log(), texts)).toEqual([2, 3, 5]);
    expect(turnRequests(log(), [...texts, 'a turn the harness never got'])).toEqual([2, 3, 5, null]);
  });

  test('added = resolver-on minus native at turns 1, 10 and 50, null where a turn is missing; counting reads only what the provider counts', () => {
    const block = '\n\nSkills that may fit this request: deploy-staging, release-notes';
    const n = log(), r = log(block);
    const count = (rows: LogRow[]) => turnRequests(rows, texts).map((i) => (i === null ? null : countLocal(rows[i]!.body!)));
    const native = { requests: turnRequests(n, texts), tokens: count(n) }, resolverOn = { requests: turnRequests(r, texts), tokens: count(r) };
    const at = addedAt(native, resolverOn, [1, 2, 3, 50]);
    expect(at['1']!.added).toBeGreaterThan(0);
    expect(at['3']!.added).toBeGreaterThan(at['1']!.added!);
    expect(at['50']).toEqual({ native: null, resolver_on: null, added: null });
    expect(Object.keys(countedBody({ model: 'm', system: 's', tools: [], messages: [{ role: 'user', content: 'x', id: 'dropped' }], max_tokens: 9, stream: true }))).toEqual(['model', 'system', 'tools', 'messages']);
    expect(countedBody({ model: 'gpt', instructions: 'i', input: [], tools: [], stream: true })).toEqual({ instructions: 'i', input: [], tools: [] });
  });

  test('the first turn with budget_exhausted, or null when the budget held', () => {
    expect(firstExhausted([{ budget_exhausted: false }, { budget_exhausted: false }, { budget_exhausted: true }, { budget_exhausted: true }])).toBe(3);
    expect(firstExhausted([{ budget_exhausted: false }, { budget_exhausted: null }])).toBeNull();
  });

  test('the table marks QM turns 10 and 50 not applicable, with the reason in footprint.md', () => {
    const table = renderTable([
      { harness: 'claude-code', model: 'anthropic:claude-opus-5-5', entry: 'serve', method: 'count_tokens', turns: { '1': { added: 120 }, '10': { added: 1097 }, '50': { added: 2100 } }, budget_exhausted_first_turn: 21, status_lines: { resolver_on: 50 } },
      { harness: 'qm', model: 'anthropic:claude-opus-5-5', entry: 'run', method: 'count_tokens', turns: { '1': { added: 130 }, '10': { not_applicable: QM_NOT_APPLICABLE }, '50': { not_applicable: QM_NOT_APPLICABLE } }, budget_exhausted_first_turn: null },
    ]);
    expect(table).toContain('| claude-code | anthropic:claude-opus-5-5 | serve | count_tokens | 120 | 1097 | 2100 | 21 |');
    expect(table).toContain('| qm | anthropic:claude-opus-5-5 | run | count_tokens | 130 | n/a | n/a | n/a |');
  });
});
