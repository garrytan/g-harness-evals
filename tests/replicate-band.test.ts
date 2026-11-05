// The replication band and its committed coverage evidence (runner/replicate/band.ts,
// scripts/replicate-band-coverage.ts, docs/replicate/band-coverage-m3-heldout-openclaw.json).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cellCounts, replicationBand, type TaskCount } from '../runner/replicate/band.ts';
import { COVERAGE_GATE } from '../scripts/replicate-band-coverage.ts';

const ROOT = resolve(import.meta.dir, '..');
const EVIDENCE = 'docs/replicate/band-coverage-m3-heldout-openclaw.json';

interface Row { reps: number; band: { lo: number; hi: number; of: number; attained: number; draws: number; seed: number }; coverage_posterior: number; gate: number; passes: boolean }

const evidence = JSON.parse(readFileSync(join(ROOT, EVIDENCE), 'utf8')) as { tasks: [string, number, number][]; rows: Row[] };
const tasks: TaskCount[] = evidence.tasks.map(([task, k, n]) => ({ task, k, n }));

describe('replication band evidence', () => {
  test('each committed band is what replicationBand gives on the committed counts', () => {
    for (const row of evidence.rows) {
      const band = replicationBand(tasks, row.reps, { draws: row.band.draws, seed: row.band.seed });
      expect({ lo: band.lo, hi: band.hi, attained: band.attained }).toEqual({ lo: row.band.lo, hi: row.band.hi, attained: row.band.attained });
      expect(row.band.of).toBe(row.reps * tasks.length);
    }
  });

  test('each row applies the coverage gate the script defines', () => {
    for (const row of evidence.rows) {
      expect(row.gate).toBe(COVERAGE_GATE);
      expect(row.passes).toBe(row.coverage_posterior >= COVERAGE_GATE);
    }
  });

  test('model, infra and exam errors are left out of the counts, as the scorer leaves them out', () => {
    const rows = ['pass completed', 'fail completed', 'fail model_error', 'fail infra_error', 'fail exam_fault', 'pass approval_stop'].map((s, i) => {
      const [grade, termination] = s.split(' ');
      return JSON.stringify({ cell: 'c', task: i < 3 ? 'a' : 'b', grade, termination });
    });
    expect(cellCounts(rows.join('\n'), 'c')).toEqual([{ task: 'a', k: 1, n: 2 }, { task: 'b', k: 1, n: 1 }]);
  });

  test('a task passed n of n can still miss, so the band reaches below an all-pass rerun', () => {
    const allPass = tasks.map((t) => ({ ...t, k: t.n }));
    const band = replicationBand(allPass, 1);
    expect(band.hi).toBe(allPass.length);
    expect(band.lo).toBeLessThan(allPass.length);
  });
});
