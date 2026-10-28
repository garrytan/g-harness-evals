// scripts/memory-fix-mechanism.ts, keyless: the cr-05 ordering rule, which calls count as reads and the cn-05 asker rule on
// hand-built events, the Markdown formatter, and every number of the two tables gbrain-memory-fix-2026-10b's preregistration
// quotes from gbrain-memory-2026-10's committed live cells.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { CN05, CR05, markdown, mechanism, trialCounts, type CellRow, type Ev } from '../scripts/memory-fix-mechanism.ts';

const ROOT = join(import.meta.dir, '..');
const channels = new Map([['coastal-team', 'CTEAM'], ['coastal-random', 'CRANDOM']]);
let seq = 0;
const post = (channel: string, ts: string, author: string, source: string, text: string, fact: number): Ev[] => [
  { seq: ++seq, actor: author, via: 'slack', tool: 'chat.postMessage', args: { channel, text }, outcome: 'ok', effect: { channel, ts } },
  { seq: ++seq, actor: null, via: 'runner', tool: 'gbrain.ingest', args: { channel, ts, author, source }, outcome: 'ok', effect: { fact_id: String(fact), source } },
];
const read = (grant: string, query: string, facts: number[], tool = 'gbrain.search', via = 'gbrain'): Ev =>
  ({ seq: ++seq, actor: 'assistant', via, tool, args: { query }, outcome: 'ok', grant, effect: { facts: facts.map((id) => ({ id })) } });
const scenario = (): Ev[] => [
  ...post('CTEAM', '1.1', 'sofia-marchetti', 'team-coastal-members', 'Pellow renewed at 52 seats.', 1),
  ...post('CRANDOM', '1.2', 'sofia-marchetti', 'team-coastal-members', 'Correction: Pellow is 46 seats.', 2),
  ...post('DGBRAIN0001', '1.3', 'bettina-kroll', 'private-bettina-kroll', 'Write my dates as 3-Nov-2025.', 3),
  ...post('CTEAM', '1.4', 'bettina-kroll', 'team-coastal-members', 'I like dates as 3-Nov-2025 too.', 4),
  ...post('DGBRAIN0002', '1.5', 'kwame-adjei', 'private-kwame-adjei', 'Thanks for the Pellow update.', 5),
];
const counts = (...reads: Ev[]) => trialCounts([...scenario(), ...reads], channels);

describe('trialCounts', () => {
  test('the correction listed first, or without the retracted post, counts as ahead', () => {
    expect(counts(read('kwame-adjei', 'Pellow seats', [2, 1]))).toMatchObject({ read: true, any_fact: true, correction: true, correction_ahead: true });
    expect(counts(read('kwame-adjei', 'Pellow seats', [2])).correction_ahead).toBe(true);
  });
  test('the correction after the retracted post is returned but not ahead; the retracted post alone is neither', () => {
    expect(counts(read('kwame-adjei', 'Pellow seats', [1, 2]))).toMatchObject({ correction: true, correction_ahead: false });
    expect(counts(read('kwame-adjei', 'Pellow seats', [1]))).toMatchObject({ any_fact: true, correction: false, correction_ahead: false });
    expect(counts(read('kwame-adjei', 'Pellow seats', []))).toMatchObject({ read: true, any_fact: false, correction: false, queries: ['Pellow seats'] });
  });
  test('query and recall count as reads; other gbrain tools and calls not through gbrain do not', () => {
    expect(counts(read('kwame-adjei', 'q', [2], 'gbrain.query')).correction_ahead).toBe(true);
    expect(counts(read('kwame-adjei', 'r', [2], 'gbrain.recall')).correction_ahead).toBe(true);
    expect(counts(read('kwame-adjei', 'p', [2], 'gbrain.get_page'))).toMatchObject({ read: false, correction: false });
    expect(counts(read('kwame-adjei', 's', [2], 'gbrain.search', 'world'))).toMatchObject({ read: false, correction: false });
  });
  test("the DM preference counts only when the read's grant wrote it in their own DM and it is a date preference", () => {
    expect(counts(read('bettina-kroll', 'dates', [3])).asker_preference).toBe(true);
    expect(counts(read('kwame-adjei', 'dates', [3])).asker_preference).toBe(false);
    expect(counts(read('bettina-kroll', 'dates', [4])).asker_preference).toBe(false);
    expect(counts(read('kwame-adjei', 'dates', [5])).asker_preference).toBe(false);
  });
});

test('markdown keeps a multiline or piped query on one table row', () => {
  const row: CellRow = { cell: 'c', model: 'm', task: CR05, trials: 1, passes: 0, with_read: 1, any_fact: 0, correction: 0, correction_ahead: 0, asker_preference: 0, queries: ['Pellow\nseats | renewal'] };
  const line = markdown([row]).split('\n').find((l) => l.startsWith('| c |'))!;
  expect(line).toBe('| c | 0 of 1 | 1 of 1 | 0 of 1 | 0 of 1 | 0 of 1 | Pellow seats / renewal |');
});

describe('gbrain-memory-2026-10 live cells', () => {
  const rows = mechanism(join(ROOT, 'docs/benchmarks/2026-10-26-gbrain-memory/results'), join(ROOT, 'world/seed/world.json'));
  const table = (task: string, keys: Array<keyof CellRow>) => rows.filter((r) => r.task === task).map((r) => [r.cell.replace('-gbrain-told-live-mu-memory', ''), r.trials, ...keys.map((k) => r[k])]);
  test('cr-05: passes, reads, any saved fact, the correction, the correction ahead', () => {
    expect(table(CR05, ['passes', 'with_read', 'any_fact', 'correction', 'correction_ahead'])).toEqual([
      ['hermes-sonnet', 5, 0, 5, 0, 0, 0], ['openclaw-sonnet', 5, 0, 3, 0, 0, 0], ['qm-pi-sonnet', 5, 0, 5, 0, 0, 0],
      ['hermes-haiku', 5, 0, 5, 1, 0, 0], ['openclaw-haiku', 5, 2, 5, 2, 1, 1], ['qm-pi-haiku', 5, 0, 4, 2, 0, 0],
    ]);
  });
  test("cn-05: passes, reads, any saved fact, the asker's DM preference", () => {
    expect(table(CN05, ['passes', 'with_read', 'any_fact', 'asker_preference'])).toEqual([
      ['hermes-sonnet', 5, 4, 5, 5, 0], ['openclaw-sonnet', 5, 0, 5, 5, 0], ['qm-pi-sonnet', 5, 0, 5, 5, 0],
      ['hermes-haiku', 5, 1, 5, 5, 0], ['openclaw-haiku', 5, 0, 5, 5, 1], ['qm-pi-haiku', 5, 0, 5, 5, 0],
    ]);
  });
});
