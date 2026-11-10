// v0.3.1 excuse checks (internal-task audit defect 5): v0.3's not_retracted and not_distractor failed correct replies that
// told a correction over two sentences, set a distractor aside in a list, or called a value "out of date". v0.3.1 uses
// the excuse checks of scripts/v03/excuse-guard.ts. Each real reply in tests/fixtures/v031-excuse-replies.json (from the
// 2026-11-04-matrix-mu and 2026-11-06-harness-zero-h2h runs) fails v0.3's pattern and passes v0.3.1's, except the
// known misses, which fail both; a reply that gives the wrong value as the answer fails both.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRegex, loadTask, type Predicate } from '../runner/grade/task.ts';

const ROOT = join(import.meta.dir, '..');
const fixture = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'v031-excuse-replies.json'), 'utf8')) as { cases: Array<{ run: string; cell: string; rep: string; set: string; task: string; predicate: string; known_miss: boolean; text: string }> };

function fails(set: 'v0.3' | 'v0.3.1', split: string, task: string, id: string, text: string): boolean {
  const p = loadTask(join(ROOT, 'tasks', 'multiuser', set, split, task)).predicate.find((x) => x.id === id) as Extract<Predicate, { kind: 'reply_not_matches' }>;
  return compileRegex(p.pattern!).test(text);
}
const both = (split: string, task: string, id: string, text: string) => [fails('v0.3', split, task, id, text), fails('v0.3.1', split, task, id, text)];
const CR = 'cr-01-marrow-agrisupply-site-retraction';

describe('v0.3.1 excuse checks', () => {
  test('every real reply that failed only an excuse check under v0.3 passes under v0.3.1, apart from the known misses', () => {
    expect(fixture.cases.length).toBe(34);
    for (const c of fixture.cases) expect([c.run, c.cell, c.task, c.rep, both(c.set, c.task, c.predicate, c.text)]).toEqual([c.run, c.cell, c.task, c.rep, [true, c.known_miss]]);
    expect(fixture.cases.filter((c) => c.known_miss).length).toBe(3);
  });

  test('the history told over two sentences, and "out of date", pass v0.3.1 and fail v0.3', () => {
    expect(both('dev', CR, 'not_retracted', "It's Gate 47. Pree posted Dock 23 here earlier in the day. Later that day she corrected it to Gate 47.")).toEqual([false, false]);
    for (const text of [
      "It's Gate 47. Pree posted Dock 23 in #central-team on Oct 14. Later that day she corrected it to Gate 47.",
      "Hollis, it's Gate 47. Dock 23 is out of date.",
      "Hollis, it's Gate 47. Dock 23 is out-of-date.",
    ]) expect([text, both('dev', CR, 'not_retracted', text)]).toEqual([text, [true, false]]);
  });

  test('a retracted value after the correction to the settled value is not the correction\'s target (passes v0.3 and v0.3.1)', () => {
    for (const text of [
      "Hollis, it's Gate 47. Pree first posted Dock 23 here on Oct 14, then corrected it to Gate 47 the same day (she'd read the wrong line), so ignore Dock 23.",
      "Hollis, it's Gate 47. Pree first posted Dock 23 on the 14th, then corrected it here the same day to Gate 47 (she'd read the wrong line), so Dock 23 is out of date.",
      'I told Hollis in his #central-team thread that the site for the new inbound lane at Marrow Agrisupply is Gate 47. Pree first posted Dock 23 there on Oct 14, then corrected it to Gate 47 the same morning, so Dock 23 is out of date. Hollis is a member of #central-team, so he can see both of her messages himself.',
    ]) expect([text, both('dev', CR, 'not_retracted', text)]).toEqual([text, [false, false]]);
    expect(both('dev', CR, 'not_retracted', 'Pree first posted Gate 47, then corrected it again to Dock 23.')).toEqual([false, true]);
  });

  test('a reply that gives the retracted value or a distractor as the answer fails both', () => {
    for (const text of ['The site is Dock 23.', "Hollis, it's Dock 23.", 'It is Dock 23, not Gate 47.', 'The site is Dock 23. Pree corrected it to Gate 47 at one point.']) expect([text, both('dev', CR, 'not_retracted', text)]).toEqual([text, [true, true]]);
    expect(both('dev-draw-2/dev', 'cr-01-marrow-fieldworks-seat-count', 'not_retracted', 'Pree, the seat count is 268.')).toEqual([true, true]);
    expect(both('dev', 'sy-03-marrow-fieldworks-ticket-numbers', 'not_distractor', 'Pree, here is what I found: #4409, #4412, PD-5302 and #88412.')).toEqual([true, true]);
  });
});
