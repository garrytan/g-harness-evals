import { describe, expect, test } from 'bun:test';
import { drawUnits, stratumOf } from '../../scripts/review-bugs/pilot-draw.ts';

const units = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: 'a/s1#' + i, group: 'S1' })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: 'a/s2#' + i, group: i % 2 ? 'S2-mixed' : 'S2-openai' })),
  { id: 'a/s3#0', group: 'S3' },
  { id: 'a/h#0', group: 'H-stacks-r1' },
  { id: 'a/n#0', group: 'N' },
];

describe('pilot draw', () => {
  test('every S2 group is one stratum, and H and N are left out', () => {
    expect(stratumOf('S2-google')).toBe('S2');
    expect(stratumOf('H-206')).toBeNull();
    expect(stratumOf('N')).toBeNull();
  });
  test('takes n per stratum, the same for the same seed, and a different set for another seed', () => {
    const a = drawUnits(units, 2665, { S1: 2, S2: 4, S3: 1 });
    expect(a.S1!.length).toBe(2);
    expect(a.S2!.length).toBe(4);
    expect(a.S3).toEqual(['a/s3#0']);
    expect(drawUnits([...units].reverse(), 2665, { S1: 2, S2: 4, S3: 1 })).toEqual(a);
    expect(drawUnits(units, 1, { S2: 4 }).S2).not.toEqual(a.S2);
  });
  test('refuses a stratum smaller than its take', () => {
    expect(() => drawUnits(units, 2665, { S3: 2 })).toThrow('fewer than 2');
  });
});
