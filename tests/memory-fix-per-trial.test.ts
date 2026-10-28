// scripts/memory-fix-per-trial.ts, keyless: the per-trial rows sum to the cell counts of scripts/memory-fix-mechanism.ts, and on the
// memory run's committed live cells one cr-05 pass came with the correction ahead and one without; on gbrain-memory-fix-2026-10b's
// live cells all 19 cr-05 passes came with it.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mechanism } from '../scripts/memory-fix-mechanism.ts';
import { markdown, perTrial } from '../scripts/memory-fix-per-trial.ts';

const ROOT = join(import.meta.dir, '..');
const RESULTS = join(ROOT, 'docs/benchmarks/2026-10-26-gbrain-memory/results');
const WORLD = join(ROOT, 'world/seed/world.json');

const sumsToMechanism = (results: string, rows: ReturnType<typeof perTrial>) => {
  for (const cell of mechanism(results, WORLD)) {
    const sel = rows.filter((r) => r.cell === cell.cell && r.task === cell.task);
    expect([sel.length, sel.filter((r) => r.grade === 'pass').length, sel.filter((r) => r.read).length, sel.filter((r) => r.correction).length, sel.filter((r) => r.correction_ahead).length, sel.filter((r) => r.asker_preference).length])
      .toEqual([cell.trials, cell.passes, cell.with_read, cell.correction, cell.correction_ahead, cell.asker_preference]);
  }
};

describe('perTrial on gbrain-memory-2026-10', () => {
  const rows = perTrial(RESULTS, WORLD);
  test('one row per live cr-05 and cn-05 trial, summing to the mechanism counts', () => {
    expect(rows.length).toBe(60);
    sumsToMechanism(RESULTS, rows);
  });
  test('the pass and hit tallies in the Markdown, memory run', () => {
    const md = markdown(rows);
    expect(md).toContain('Passes with the correction ahead of the 52-seat post returned: 1; passes without it: 1; fails with it: 0; fails without it: 28.');
    expect(md).toContain("Passes with the asker's DM preference returned: 0; passes without it: 5; fails with it: 1; fails without it: 24.");
  });
});

describe('perTrial on gbrain-memory-fix-2026-10b', () => {
  const FIX = join(ROOT, 'docs/benchmarks/2026-10-28-gbrain-memory-fix-b/results');
  const rows = perTrial(FIX, WORLD);
  test('one row per live cr-05 and cn-05 trial, summing to the mechanism counts', () => {
    expect(rows.length).toBe(60);
    sumsToMechanism(FIX, rows);
  });
  test("the report's tallies: 19 cr-05 passes with the correction ahead, none without it", () => {
    const md = markdown(rows);
    expect(md).toContain('Passes with the correction ahead of the 52-seat post returned: 19; passes without it: 0; fails with it: 5; fails without it: 6.');
    expect(md).toContain("Passes with the asker's DM preference returned: 0; passes without it: 5; fails with it: 2; fails without it: 23.");
  });
});
