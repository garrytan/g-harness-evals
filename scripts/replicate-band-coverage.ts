#!/usr/bin/env bun
// The replication band's coverage check (docs/replicate.md, internal-task round-2 item 1), committed as evidence.
//
//   bun scripts/replicate-band-coverage.ts --results docs/benchmarks/<run>/results --cell <id> [--reps 1,5] [--rounds 4000] [--draws 4000] [--out <file>]
//
// For each repetition count: the band on the cell's published per-task counts, its attained coverage, and how often
// it holds a simulated rerun when nothing changed, with true task rates drawn from Beta(k + 1/2, n - k + 1/2) and, beside
// it, with the published rates themselves. The gate is coverage of at least 0.93 under the posterior truth; a
// repetition count that misses it gets no band, only the difference interval. Keyless; seeded (20261101).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bandCoverage, cellCounts, replicationBand } from '../runner/replicate/band.ts';

export const COVERAGE_GATE = 0.93;

if (import.meta.main) {
  const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const results = flag('results'); const cell = flag('cell');
  if (!results || !cell) { console.error('usage: bun scripts/replicate-band-coverage.ts --results <dir> --cell <id> [--reps 1,5] [--rounds n] [--draws n] [--out file]'); process.exit(2); }
  const tasks = cellCounts(readFileSync(join(results, 'trials.jsonl'), 'utf8'), cell);
  const rounds = Number(flag('rounds') ?? 4000); const draws = Number(flag('draws') ?? 4000);
  const rows = (flag('reps') ?? '1,5').split(',').map(Number).map((reps) => {
    const band = replicationBand(tasks, reps);
    const posterior = bandCoverage(tasks, reps, { rounds, draws, truth: 'posterior' });
    const published = bandCoverage(tasks, reps, { rounds, draws, truth: 'published' });
    return { reps, band: { lo: band.lo, hi: band.hi, of: reps * tasks.length, attained: band.attained, draws: band.draws, seed: band.seed }, coverage_posterior: posterior.coverage, coverage_published: published.coverage, gate: COVERAGE_GATE, passes: posterior.coverage >= COVERAGE_GATE };
  });
  const out = { schema_version: 1, results, cell, tasks: tasks.map((t) => [t.task, t.k, t.n]), rounds, draws, seed: 20261101, method: 'Jeffreys posterior Beta(k+1/2, n-k+1/2) per task, central 95% of predictive total passes, endpoints inclusive', rows };
  const text = JSON.stringify(out, null, 2) + '\n';
  if (flag('out')) writeFileSync(flag('out')!, text);
  process.stdout.write(text);
}
