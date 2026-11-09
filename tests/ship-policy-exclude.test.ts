import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const POLICY = JSON.parse(readFileSync(resolve(import.meta.dir, '..', '.gstack', 'ship-policy.json'), 'utf8')) as { review_exclude_paths: string[] };

/** The files a /ship reader still sees: gstack adds one `:(top,exclude,glob)` pathspec per review_exclude_paths entry. */
function reviewed(paths: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ship-policy-exclude-'));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  for (const p of paths) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), 'x\n'); }
  spawnSync('git', ['add', '--', ...paths], { cwd: dir, env });
  const r = spawnSync('git', ['ls-files', '--', '.', ...POLICY.review_exclude_paths.map((p) => ':(top,exclude,glob)' + p)], { cwd: dir, env, encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout.trim().split('\n').filter(Boolean).sort();
}

// Value: protects=the stage-folder exclusions (main, forced, headroom, calibration, pilot) hide only bulk trial data, so a
// jsonl in any other subfolder of a benchmark (a preregistration or design folder) still reaches /ship's readers;
// fails_when=a pattern is widened to docs/benchmarks/*/*/ or a stage name is dropped; why_new=#333's stage-folder data
// was over the 2 MB review ceiling; seam=a throwaway git repository and git's own glob pathspecs; no_claim=gstack's
// review ceiling or reader selection.
test('stage-folder trial data is left out of review, and a jsonl in a non-stage subfolder is still reviewed', () => {
  const kept = [
    'docs/benchmarks/run-x/prereg/cells.jsonl',
    'docs/benchmarks/run-x/design/notes.ndjson',
    'docs/benchmarks/run-x/main/report.md',
    'docs/benchmarks/run-x/main/analysis/summary.md',
    'docs/benchmarks/run-x/report.md',
  ];
  const dropped = [
    'docs/benchmarks/run-x/main/trials.jsonl',
    'docs/benchmarks/run-x/forced/proxy-usage.ndjson',
    'docs/benchmarks/run-x/headroom/trials/t1/turns.jsonl',
    'docs/benchmarks/run-x/calibration/shards/s1/ledger.sqlite',
    'docs/benchmarks/run-x/pilot/state/brain.sqlite',
    'docs/benchmarks/run-x/results/trials.jsonl',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});
