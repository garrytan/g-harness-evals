import { describe, expect, test } from 'bun:test';
import { scan, shingles } from '../scripts/skill-resolver/leak-scan.ts';

const rows = [
  { id: 'r1', text: 'please draft the quarterly note for the partners about the new fund terms today', prev_user_text: null },
  { id: 'r2', text: 'ok', prev_user_text: 'can you check the calendar for next tuesday afternoon with the whole team' },
];

describe('skill-resolver leak scan', () => {
  test('shingles are 8-word windows', () => {
    expect(shingles('a b c d e f g h i')).toEqual(['a b c d e f g h', 'b c d e f g h i']);
    expect(shingles('too short')).toEqual([]);
  });
  test('finds exact text, shingle overlap and message hashes, and passes clean files', () => {
    const sha = new Bun.CryptoHasher('sha256').update(rows[0]!.text).digest('hex');
    const hits = scan(rows, [
      { path: 'clean.json', body: '{"skill":"gstack-ship","rank":1}' },
      { path: 'quoted.txt', body: 'x ' + rows[0]!.text + ' y' },
      { path: 'partial.txt', body: 'Draft the quarterly note for the partners about the new fund terms, thanks' },
      { path: 'prev.txt', body: 'Check the calendar for next Tuesday afternoon with the whole team please' },
      { path: 'hash.txt', body: 'sha ' + sha },
    ]);
    const by = (p: string) => hits.filter((h) => h.path === p).map((h) => h.kind + ':' + h.id);
    expect(by('clean.json')).toEqual([]);
    expect(by('quoted.txt')).toContain('text:r1');
    expect(by('partial.txt')).toContain('shingles:r1');
    expect(by('prev.txt')).toContain('shingles:r2');
    expect(by('hash.txt')).toContain('sha256:r1');
  });
});
