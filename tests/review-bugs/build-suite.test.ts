import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rankUnits, type RankItem } from '../../scripts/review-bugs/build-suite.ts';

const items = (stratum: RankItem['stratum'], n: number, repos: number, repro = false): RankItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: stratum + '-' + i, repo: stratum.toLowerCase() + '/r' + (i % repos), stratum, repro }));
const mix = (xs: RankItem[]) => ({ S1: xs.filter((x) => x.stratum === 'S1').length, S2: xs.filter((x) => x.stratum === 'S2').length, S3: xs.filter((x) => x.stratum === 'S3').length });

describe('unit ranking', () => {
  test('every prefix of ten keeps the 40/20/40 mix while all strata last', () => {
    const r = rankUnits([...items('S1', 40, 10), ...items('S2', 40, 10), ...items('S3', 40, 10)], 2665, 4);
    expect(r.length).toBe(120);
    expect(mix(r.slice(0, 10))).toEqual({ S1: 4, S2: 2, S3: 4 });
    expect(mix(r.slice(0, 50))).toEqual({ S1: 20, S2: 10, S3: 20 });
  });

  test('caps each repository, counting units already placed', () => {
    const r = rankUnits(items('S1', 12, 2), 1, 4, new Map([['s1/r0', 3]]));
    expect(r.length).toBe(5);
    expect(r.filter((x) => x.repo === 's1/r0').length).toBe(1);
  });

  test('falls back to the remaining strata in proportion when one runs out, repro-confirmed units first', () => {
    const r = rankUnits([...items('S1', 30, 30), ...items('S2', 30, 30), ...items('S3', 2, 2, true)], 7, 4);
    expect(r.slice(0, 2).every((x) => x.stratum === 'S1' || x.stratum === 'S3')).toBe(true);
    expect(mix(r.slice(0, 32))).toEqual({ S1: 20, S2: 10, S3: 2 });
    const withRepro = rankUnits([...items('S1', 5, 5), { id: 'late', repo: 'z/z', stratum: 'S1', repro: true }], 3, 4);
    expect(withRepro[0]!.id).toBe('late');
  });

  test('is deterministic for a seed', () => {
    const all = [...items('S1', 20, 7), ...items('S2', 20, 7), ...items('S3', 20, 7)];
    expect(rankUnits(all, 2665, 4).map((x) => x.id)).toEqual(rankUnits([...all].reverse(), 2665, 4).map((x) => x.id));
  });
});

describe('home-206.json', () => {
  test('names each #206 unit by full head and fix shas, with a file, line and finding per bug', () => {
    const h = JSON.parse(readFileSync(join(import.meta.dir, '../..', 'scripts/review-bugs/home-206.json'), 'utf8'));
    expect([h.repo, h.pr, h.base_branch]).toEqual(['garrytan/harness-evals', 206, 'main']);
    expect(h.units.length).toBeGreaterThan(0);
    for (const u of h.units) {
      expect([u.head, u.fix].every((s: string) => /^[0-9a-f]{40}$/.test(s))).toBe(true);
      expect(u.bugs.length).toBeGreaterThan(0);
      for (const b of u.bugs) expect([typeof b.file, typeof b.line, typeof b.finding, typeof b.by, typeof b.summary]).toEqual(['string', 'number', 'string', 'string', 'string']);
    }
  });
});
