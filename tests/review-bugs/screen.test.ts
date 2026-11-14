import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Llm, StructuredRequest } from '../../scripts/failure-mining/llm.ts';
import type { Candidate } from '../../scripts/review-bugs/mine.ts';
import { fullRepos, keptUnits, packet, screenBug, screenOrder, sharedRuns, validScreen, type ScreenLine, type ScreenRecord } from '../../scripts/review-bugs/screen.ts';
import { makeRepo } from './fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'rb-screen-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const fx = makeRepo(join(tmp, 'fx'));

const sourceText = 'The slice end here is one short, so last() hands back every element except the final one in the array.';
const cand: Candidate = {
  id: 'acme/web#7@' + fx.head, stratum: 'S1', repo: 'acme/web', pr: 7, title: 'Add last()', merged_at: '2026-08-01T00:00:00Z', head: fx.head, base: fx.base, diff_lines: 30, reinject: false,
  bugs: [{ path: 'src/page.ts', line: 20, source: { kind: 'review-comment', url: 'u', reviewer: 'human', text: sourceText }, fix: { commit: fx.fix, pr: 7, kind: 'in-pr', tests: ['tests/page.test.ts'] } }],
};
const rec = (o: Partial<ScreenRecord> = {}): ScreenRecord => ({ real_defect: true, present_at_head: true, blocking: true, category: 'logic', file: 'src/page.ts', line: 20, description: 'last() drops the final element because the slice stops one index early.', why_blocking: 'Callers get the wrong items.', confidence: 'high', ...o });

/** A fake model layer: answers by model and tool, and records every request. */
function fakeLlm(answer: (req: StructuredRequest) => unknown): { llm: Llm; reqs: StructuredRequest[] } {
  const reqs: StructuredRequest[] = [];
  const llm = {
    structured: async (req: StructuredRequest) => { reqs.push(req); return { value: answer(req), via: 'tool', cached: false, usage: null }; },
    stats: () => ({}) as never, close: async () => ({}) as never,
  } as unknown as Llm;
  return { llm, reqs };
}

describe('screening helpers', () => {
  test('sharedRuns finds 8-word runs the two texts share, ignoring case and punctuation', () => {
    expect(sharedRuns('a b c d e f g h', 'A, b. c d e f g h i')).toEqual(['a b c d e f g h']);
    expect(sharedRuns('a b c d e f g', 'a b c d e f g')).toEqual([]);
    expect(sharedRuns(sourceText, 'last() drops the final element of the input.')).toEqual([]);
  });

  test('validScreen wants every verdict field and a real description', () => {
    expect(validScreen(rec())).toBe(true);
    expect(validScreen({ ...rec(), line: 2.5 })).toBe(false);
    expect(validScreen({ ...rec(), description: 'short' })).toBe(false);
    expect(validScreen({ ...rec(), blocking: 'yes' })).toBe(false);
    expect(validScreen(null)).toBe(false);
  });

  test('the packet shows the unit diff, the file at the head and the fix diff', () => {
    const p = JSON.parse(packet(cand, cand.bugs[0]!, fx.dir));
    expect(p.file).toBe('src/page.ts');
    expect(p.unit_files_changed).toEqual(['src/page.ts']);
    expect(p.file_at_unit_head).toContain('   20  export const last = (xs: number[]) => xs.slice(0, xs.length - 1);');
    expect(p.fix_diff).toContain('+export const last = (xs: number[]) => xs.slice(0, xs.length);');
    expect(p.source.kind).toBe('review comment by a person');
  });
});

describe('screenBug', () => {
  test('keeps a bug both judges call blocking and picks a description in its own words', async () => {
    const { llm, reqs } = fakeLlm((req) => {
      if (req.tool.name === 'record_second_read') return { fix_addresses_it: true, accurate: true, corrected_description: null, note: '' };
      return req.model === 'anthropic:claude-opus-5-5' ? rec({ description: sourceText }) : rec();
    });
    const line = await screenBug(llm, cand, 0, fx.dir, true, () => {});
    expect(line.kept).toBe(true);
    expect(line.final!.description).toBe(rec().description);
    expect(reqs.map((r) => r.model).sort()).toEqual(['anthropic:claude-opus-5-5', 'openai:gpt-6-astra', 'openai:gpt-6-astra']);
    expect(JSON.parse(reqs.find((r) => r.tool.name === 'record_second_read')!.packet).fix_diff).toContain('xs.slice(0, xs.length);');
  });

  test('drops a bug one judge does not call blocking, or the second read says the fix misses', async () => {
    const one = fakeLlm((req) => (req.model === 'openai:gpt-6-astra' ? rec({ blocking: false }) : rec()));
    expect((await screenBug(one.llm, cand, 0, fx.dir, true, () => {})).dropped).toBe('not blocking for both judges');
    expect(one.reqs.length).toBe(2);
    const miss = fakeLlm((req) => (req.tool.name === 'record_second_read' ? { fix_addresses_it: false, accurate: true, corrected_description: null, note: '' } : rec()));
    expect((await screenBug(miss.llm, cand, 0, fx.dir, true, () => {})).dropped).toBe('the second read found the fix does not address the description');
    const copied = fakeLlm((req) => (req.tool.name === 'record_second_read' ? { fix_addresses_it: true, accurate: true, corrected_description: null, note: '' } : rec({ description: sourceText })));
    expect((await screenBug(copied.llm, cand, 0, fx.dir, true, () => {})).dropped).toBe('no description free of the source text');
  });

  test('retries once with feedback when a reply carries no valid record', async () => {
    let bad = 1;
    const { llm, reqs } = fakeLlm((req) => (req.model === 'openai:gpt-6-astra' && bad-- > 0 ? { real_defect: true } : rec()));
    const line = await screenBug(llm, cand, 0, fx.dir, false, () => {});
    expect(line.kept).toBe(true);
    expect(reqs.filter((r) => r.model === 'openai:gpt-6-astra').length).toBe(2);
    expect(reqs.some((r) => r.feedback?.startsWith('Your previous reply did not carry one valid record'))).toBe(true);
  });
});

describe('screening order and stop count', () => {
  const unit = (repo: string, i: number, stratum: Candidate['stratum']): Candidate => ({ ...cand, id: repo + '#' + i, repo, pr: i, stratum });
  const units = [...Array.from({ length: 6 }, (_, i) => unit('a/a', i, 'S2')), ...Array.from({ length: 3 }, (_, i) => unit('b/b', 10 + i, 'S1')), unit('c/c', 20, 'S3'), unit('c/c', 21, 'N')];

  test('takes each repository\'s first four in the suite order before any fifth, and skips decoys', () => {
    const order = screenOrder(units, 2665);
    expect(order.length).toBe(10);
    expect(order.slice(0, 8).filter((c) => c.repo === 'a/a').length).toBe(4);
    expect(order.slice(8).map((c) => c.repo)).toEqual(['a/a', 'a/a']);
    expect(order[0]!.stratum === 'S1' || order[0]!.stratum === 'S3').toBe(true);
  });

  test('counts kept units once each and at most four per repository', () => {
    const line = (u: string, bug: number, kept: boolean) => ({ unit: u, bug, kept }) as ScreenLine;
    const lines = [...Array.from({ length: 6 }, (_, i) => line('a/a#' + i, 0, true)), line('b/b#10', 0, true), line('b/b#10', 1, true), line('b/b#11', 0, false)];
    expect(keptUnits(lines, units)).toBe(5);
  });

  test('marks a repository full once it has four kept units, so its other units are not screened', () => {
    const line = (u: string, kept: boolean) => ({ unit: u, bug: 0, kept }) as ScreenLine;
    expect([...fullRepos([0, 1, 2].map((i) => line('a/a#' + i, true)), units)]).toEqual([]);
    expect([...fullRepos([0, 1, 2, 3].map((i) => line('a/a#' + i, true)).concat(line('b/b#10', true)), units)]).toEqual(['a/a']);
  });
});

