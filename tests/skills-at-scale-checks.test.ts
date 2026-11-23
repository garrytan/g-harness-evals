import { describe, expect, test } from 'bun:test';
import { blockIds, blocks, judgeTrigger, pinsCarried, triggerText } from '../scripts/skills-at-scale/checks.ts';

const block = (...ids: string[]) => '<relevant_skills>\nSkills that may fit this request.\n' + ids.map((i) => '- id: "' + i + '" name: "' + i + '" summary: "x"').join('\n') + '\n</relevant_skills>';
const req = (...turns: string[]) => ({ messages: turns.map((t) => ({ role: 'user', content: [{ type: 'text', text: t }] })) });

describe('the two-turn trigger check', () => {
  test('passes when turn 2 carries a new block naming B', () => {
    const r = judgeTrigger(req('do A', block('a', 'x')), req('do A', block('a', 'x'), 'do B', block('b', 'y')), 'a', 'b');
    expect(r).toMatchObject({ ok: true, turn1_ids: ['a', 'x'], turn2_new_ids: ['b', 'y'] });
  });
  test('fails a lane that ranks the previous message (internal-task\'s shape)', () => {
    const r = judgeTrigger(req('do A', block('a')), req('do A', block('a'), 'do B', block('a2', 'a3')), 'a', 'b');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('turn 2 carries no new block naming b');
  });
  test('fails when no block arrives at all, and when a request is missing', () => {
    expect(judgeTrigger(req('do A'), req('do A', 'do B'), 'a', 'b').problems).toHaveLength(2);
    expect(judgeTrigger(null, null, 'a', 'b').problems.join(' ')).toContain('no agent request found for turn 1');
  });
  test('blocks are read in request order, and ids from their lines', () => {
    expect(blocks({ system: 'x', messages: [block('a'), 'y ' + block('b') + ' ' + block('c')] }).map(blockIds)).toEqual([['a'], ['b'], ['c']]);
    expect(triggerText({ name: 'api-zone-email', tool_word: 'pekmute' })).toBe('Please use the pekmute tool to sort out the api zone email work for me today.');
  });
});

describe('the pins check', () => {
  test('counts only ids inside a <pinned_skills> block, not ids that appear anywhere else in the request', () => {
    const body = { system: 'Skills: a, b, c\n<pinned_skills>\nAlways-available skills.\n- id: "a" when: "x"\n- id: "b"\n</pinned_skills>', messages: [block('c')] };
    expect(pinsCarried(body, ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(pinsCarried({ system: 'a b c' }, ['a', 'b', 'c'])).toEqual([]);
    expect(pinsCarried({ system: '<pinned_skills>\n- id: "ab" when: "use a"\n</pinned_skills>' }, ['a', 'ab'])).toEqual(['ab']);
  });
});
