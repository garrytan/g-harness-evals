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

// Value: protects=the corpus and layer1 exclusions hide only experiment input data (jsonl, and json under layer1), so a
// script or markdown file in those folders still reaches /ship's readers, and `**/` also matches a file directly in the
// folder; fails_when=a pattern is widened to corpus/** or layer1/**, or the data extensions are dropped;
// why_new=internal-task's preregistration commits a 15 MB corpus manifest and 29 MB of layer-1 labels, over the 2 MB review
// ceiling; seam=a throwaway git repository and git's own glob pathspecs; no_claim=the prereg's own hash and row-count check.
test('corpus and layer1 data files are left out of review, and their scripts and notes are still reviewed', () => {
  const kept = [
    'docs/benchmarks/x/corpus/build.ts',
    'docs/benchmarks/x/corpus/README.md',
    'docs/benchmarks/x/layer1/notes.md',
  ];
  // Stand-in paths only: gstack keeps an excluded file in review when a reviewed code file names its full path
  // (named-by-code), so a real experiment's data path written here would put that file back in /ship's review diff.
  const dropped = [
    'docs/benchmarks/x/corpus/manifest.jsonl',
    'docs/benchmarks/x/layer1/run/results/taxonomy.json',
    'docs/benchmarks/x/layer1/run/labels.jsonl',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=the analysis.json exclusion hides only the Fable 5.2 run's analysis.json files under its results folders,
// at any depth, so the analysis.md beside each one, differently named analysis files and every other run's analysis.json
// (frontier-harness, failure-mining) still reach /ship's readers; fails_when=the pattern is dropped, widened to other runs
// or to *analysis.json, or loses its results* anchor; why_new=#365's ten generated analysis.json files put its review diff
// at about 9.0 MB, over the 2 MB review ceiling, and a regeneration test there checks them byte for byte;
// seam=a throwaway git repository and git's own glob pathspecs; no_claim=the regeneration check itself.
test("the Fable 5.2 run's analysis.json files are left out of review, and other runs and other analysis files are still reviewed", () => {
  // Stand-in paths only, as above: a real results path named here would keep that file in /ship's review diff.
  const kept = [
    'docs/benchmarks/2026-11-09-fable-5-2-coding/results/stand-in/analysis.md',
    'docs/benchmarks/2026-11-09-fable-5-2-coding/results/stand-in/c4-analysis.json',
    'docs/benchmarks/2026-11-09-fable-5-2-coding/prereg/analysis.json',
    'docs/benchmarks/2026-11-07-frontier-harness/results/stand-in/analysis.json',
    'docs/benchmarks/2026-11-07-frontier-harness/results/stand-in/analysis.md',
    'docs/benchmarks/2026-11-09-failure-mining/results/stand-in/analysis.json',
  ];
  const dropped = [
    'docs/benchmarks/2026-11-09-fable-5-2-coding/results/stand-in/analysis.json',
    'docs/benchmarks/2026-11-09-fable-5-2-coding/results-x/deep/stand-in/analysis.json',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=the company-v2 and personal-v2 exclusions hide only the JSON files under each set's dev/ folder (task
// specs, oracles and mutations, at any depth), so each task's task.toml, the set's README.md, dev.seed and clusters.json,
// and JSON in any other set or folder still reach /ship's readers; fails_when=a pattern is dropped, widened to the whole
// set or to tasks/multiuser/**, or loses its dev/ anchor; why_new=#378's two generated task sets put its review diff over
// the 2 MB review ceiling, and 3,850,576 bytes of it are these 1,695 JSON files; seam=a throwaway git repository and git's own glob
// pathspecs; no_claim=the task generator's own --check.
test('company-v2 and personal-v2 dev task JSON is left out of review, and task.toml files, set-level files and other sets are still reviewed', () => {
  // Stand-in paths only, as above: a real task path named here would keep that file in /ship's review diff.
  const kept = [
    'tasks/multiuser/company-v2/dev/stand-in/task.toml',
    'tasks/multiuser/company-v2/README.md',
    'tasks/multiuser/company-v2/dev.seed',
    'tasks/multiuser/company-v2/clusters.json',
    'tasks/multiuser/personal-v2/dev/stand-in/task.toml',
    'tasks/multiuser/personal-v2/clusters.json',
    'tasks/multiuser/company-v2/heldout/stand-in/spec.json',
    'tasks/multiuser/company-v3/dev/stand-in/spec.json',
  ];
  const dropped = [
    'tasks/multiuser/company-v2/dev/stand-in/spec.json',
    'tasks/multiuser/company-v2/dev/stand-in/mutations/not_bait.json',
    'tasks/multiuser/personal-v2/dev/stand-in/oracle.json',
    'tasks/multiuser/personal-v2/dev/stand-in/mutations/item_x.json',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=the analysis.json exclusion for the Claude Code 2.1.322 rerun hides only that run's analysis.json files
// under its results folders, at any depth, so the analysis.md beside each one, its other analysis files and every other
// run's analysis.json still reach /ship's readers; fails_when=the pattern is dropped, widened to other runs or to
// *analysis.json, or loses its results* anchor; why_new=the rerun's seven generated analysis.json files put its review diff
// at about 7.3 MB, over the 2 MB review ceiling, and bun run verify rebuilds them from the committed trial records and
// compares them value by value; seam=a throwaway git repository and git's own glob pathspecs; no_claim=the rebuild check itself.
test("the Claude Code 2.1.322 rerun's analysis.json files are left out of review, and other runs and other analysis files are still reviewed", () => {
  // Stand-in paths only, as above: a real results path named here would keep that file in /ship's review diff.
  const kept = [
    'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results/stand-in/analysis.md',
    'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results/stand-in/drift.json',
    'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/prereg/analysis.json',
    'docs/benchmarks/2026-11-07-frontier-harness/results/stand-in/analysis.json',
    'docs/benchmarks/2026-11-09-failure-mining/results/stand-in/analysis.json',
  ];
  const dropped = [
    'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results/stand-in/analysis.json',
    'docs/benchmarks/2026-11-12-fable-5-2-coding-cc322/results-x/deep/stand-in/analysis.json',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});
