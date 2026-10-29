import { describe, expect, test } from 'bun:test';
import { MAX_REPLACEMENTS, MIN_TASKS, QUOTAS, select, type Candidate } from '../scripts/v03/select.ts';
import type { FamilyV03 } from '../scripts/v03/types.ts';

// scripts/v03/select.ts: lowest-numbered passing candidates per family, every pass-over logged with its code.

const extra: Record<FamilyV03, number> = { scope_isolation: 2, shared_channel: 1, synthesis: 2, continuity: 1, corrections: 1, approval_relay: 1 };
function pool(bad: Record<string, string[]> = {}): Candidate[] {
  const out: Candidate[] = [];
  let n = 0;
  for (const f of Object.keys(QUOTAS) as FamilyV03[]) for (let i = 0; i < QUOTAS[f] + extra[f]; i++) { n += 1; const id = 'hx-' + String(n).padStart(2, '0') + '-aaaaaa'; out.push({ id, family: f, n, codes: bad[id] ?? [] }); }
  return out;
}

describe('v0.3 selection', () => {
  test('48 clean candidates keep the first per family up to quota; the rest are surplus', () => {
    const s = select(pool());
    expect(s.kept.length).toBe(40);
    expect(s.replacements).toBe(0);
    expect(s.excluded.map((e) => e.code)).toEqual(Array(8).fill('SURPLUS'));
    expect(s.kept.filter((k) => k.family === 'scope_isolation').map((k) => k.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('a flagged candidate is passed over for the next one in its family and logged with its codes', () => {
    const s = select(pool({ 'hx-02-aaaaaa': ['ORACLE_FAILS'], 'hx-10-aaaaaa': ['AMBIGUOUS_ASK', 'PATTERN_ACCEPTS_WRONG'] }));
    expect(s.kept.length).toBe(40);
    expect(s.replacements).toBe(2);
    expect(s.excluded).toContainEqual({ id: 'hx-02-aaaaaa', family: 'scope_isolation', code: 'ORACLE_FAILS' });
    expect(s.excluded).toContainEqual({ id: 'hx-10-aaaaaa', family: 'shared_channel', code: 'AMBIGUOUS_ASK,PATTERN_ACCEPTS_WRONG' });
    expect(s.kept.filter((k) => k.family === 'scope_isolation').map((k) => k.n)).toEqual([1, 3, 4, 5, 6, 7, 8]);
  });

  test('a family short of passing candidates is reported as a shortfall, never filled from another family', () => {
    const bad: Record<string, string[]> = {};
    for (const c of pool().filter((c) => c.family === 'shared_channel').slice(0, 3)) bad[c.id] = ['ORACLE_FAILS'];
    const s = select(pool(bad));
    expect(s.shortfall).toEqual({ shared_channel: 2 });
    expect(s.kept.length).toBe(38);
    expect(MAX_REPLACEMENTS).toBe(8);
    expect(s.stop).toBeNull();
  });

  test('fewer than MIN_TASKS kept, or more than MAX_REPLACEMENTS passed over, stops the selection', () => {
    const below: Record<string, string[]> = {};
    for (const c of pool().filter((c) => c.family === 'continuity' || c.family === 'corrections')) below[c.id] = ['ORACLE_FAILS'];
    const s = select(pool(below));
    expect(s.kept.length).toBeLessThan(MIN_TASKS);
    expect(s.stop).toBe('SELECT-BELOW-MIN');
    const many: Record<string, string[]> = {};
    for (const f of Object.keys(QUOTAS) as FamilyV03[]) for (const c of pool().filter((c) => c.family === f).slice(0, 2)) many[c.id] = ['AMBIGUOUS_ASK'];
    const t = select(pool(many));
    expect(t.kept.length).toBeGreaterThanOrEqual(MIN_TASKS);
    expect(t.replacements).toBe(12);
    expect(t.stop).toBe('SELECT-TOO-MANY-REPLACEMENTS');
  });
});
