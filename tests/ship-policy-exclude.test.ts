import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const POLICY = JSON.parse(readFileSync(resolve(import.meta.dir, '..', '.gstack', 'ship-policy.json'), 'utf8')) as { review_exclude_paths: string[]; review_content_patterns: string[] };

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

// Value: protects=the nested results exclusions hide trial folders and <shard>.manifest.json files at any depth under a
// results folder, plus four generated file groups in the skill-resolver run only, so report.md, analysis.md, shards.json,
// that run's small trial id lists and other check files, allowlists, notes, trials folders outside results* and every
// other run's checks, summaries and tool output still reach
// /ship's readers; fails_when=a pattern is dropped, widened past its results* anchor, or the run-specific ones are widened
// to every run; why_new=#449's merged results keep 6,936 trial files one level deeper (results/merged/trials/**) than the
// existing results*/trials/** pattern reaches, and with its shard manifests its reader diff measured 44,030,099 bytes
// against gstack's 2,000,000 byte ceiling; seam=a throwaway git repository and git's own glob pathspecs; no_claim=gstack's
// rule that keeps any file named exactly manifest.json in review (with internal-task).
test('nested results trials and shard manifests, and the skill-resolver run\'s generated files, are left out of review; reports, notes and other runs are still reviewed', () => {
  // Stand-in paths only, as above: a real results path named here would keep that file in /ship's review diff.
  const kept = [
    'docs/benchmarks/run-x/report.md',
    'docs/benchmarks/run-x/results/merged/report.md',
    'docs/benchmarks/run-x/results/merged/shards.json',
    'docs/benchmarks/run-x/results/analysis/analysis.md',
    'docs/benchmarks/run-x/results/notes.md',
    'docs/benchmarks/run-x/prereg/trials/stand-in.json',
    'docs/benchmarks/run-x/results/merged/stand-in.shard.json',
    'docs/benchmarks/run-x/results/checks/stand-in.json',
    'docs/benchmarks/run-x/results/merged/summary.md',
    'docs/benchmarks/run-x/results/tools/stand-in.txt',
    'docs/benchmarks/2026-11-08-skill-resolver/report.md',
    'docs/benchmarks/2026-11-08-skill-resolver/results/checks/stand-in.txt',
    'docs/benchmarks/2026-11-08-skill-resolver/results/tools/stand-in.ts',
    'docs/benchmarks/2026-11-08-skill-resolver/results/analysis/analysis.md',
    'docs/benchmarks/2026-11-08-skill-resolver/results/checks/stand-in.json',
    'docs/benchmarks/2026-11-08-skill-resolver/results/tools/stand-in-trials.txt',
    'publication/allowlists.json',
  ];
  const dropped = [
    'docs/benchmarks/run-x/results/merged/trials/t1/trial.json',
    'docs/benchmarks/run-x/results-b/merged/deep/trials/t1/turns.txt',
    'docs/benchmarks/run-x/results/merged/stand-in.manifest.json',
    'docs/benchmarks/run-x/results/shards/s1/stand-in.manifest.json',
    'docs/benchmarks/2026-11-08-skill-resolver/results/analysis/analysis.json',
    'docs/benchmarks/2026-11-08-skill-resolver/results-x/deep/analysis.json',
    'docs/benchmarks/2026-11-08-skill-resolver/results/checks/sett-stand-in.json',
    'docs/benchmarks/2026-11-08-skill-resolver/results/merged/summary.md',
    'docs/benchmarks/2026-11-08-skill-resolver/results/tools/openclaw-phase-b-stand-in.txt',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=a preregistration's pins.sha256 (one hash line per pinned file) is declared content and left out of review,
// so it no longer keeps every pinned task file in /ship's diff by naming its path, while the preregistration, its prereg.json
// and shards.json and any other .sha256 file still reach the readers; fails_when=the pattern is dropped from either list,
// widened past the top of a benchmark folder, or loosened to *.sha256; why_new=#538 pins 2,645 task files and its
// pins.sha256 named them all, so gstack kept them as named by code; seam=a throwaway git repository and git's own glob
// pathspecs; no_claim=gstack's consumer scan or its 2,000-file cap.
test('a preregistration\'s pins.sha256 is declared content and left out of review, and the files beside it are still reviewed', () => {
  const kept = [
    'docs/benchmarks/2026-01-01-stand-in/PREREGISTRATION.md',
    'docs/benchmarks/2026-01-01-stand-in/prereg.json',
    'docs/benchmarks/2026-01-01-stand-in/shards.json',
    'docs/benchmarks/2026-01-01-stand-in/MANIFEST.sha256',
    'docs/benchmarks/2026-01-01-stand-in/preflight/pins.sha256',
  ];
  const dropped = ['docs/benchmarks/2026-01-01-stand-in/pins.sha256'];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
  expect(POLICY.review_content_patterns).toContain('docs/benchmarks/*/pins.sha256');
});

// Value: protects=the gbrain access-leaks exclusion hides only JSON under that run's results/ (its generated
// analysis tables, comparison JSON and leak preflight copies), so the run's top-level JSON, every preflight receipt, its
// report, its Markdown tables and every other run's JSON still reach /ship's readers; fails_when=the pattern is widened
// to other runs, to the run's top level or to preflight/, or matches Markdown; why_new=the results pull request's review diff was 5.6 MB, about 4.7 MB of it these JSON
// files, over the 2 MB review ceiling, and bun run verify rebuilds the published numbers from the committed trial
// records; seam=a throwaway git repository and git's own glob pathspecs; no_claim=the rebuild check itself.
test("the gbrain access-leaks run's results JSON is left out of review, and its preflight receipts, top-level files, Markdown and other runs are still reviewed", () => {
  const run = 'docs/benchmarks/2026-11-09-gbrain-access-leaks';
  const kept = [
    run + '/stand-in.json',
    run + '/report-stand-in.md',
    run + '/results/analysis/stand-in.md',
    run + '/preflight/stand-in/notes.md',
    run + '/preflight/prereg.json',
    run + '/preflight/stand-in/gbrain-check/check.json',
    run + '/preflight/stand-in/leak/stand-in.json',
    run + '/prereg/stand-in.json',
    'docs/benchmarks/2026-11-07-frontier-harness/results/analysis/stand-in.json',
    'docs/benchmarks/2026-11-09-failure-mining/preflight/stand-in/check.json',
  ];
  const dropped = [
    run + '/results/stand-in.json',
    run + '/results/analysis/stand-in.json',
    run + '/results/stand-in.leak-preflight-x.json',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=the *-v2 dev task pattern, which replaces the company-v2 and personal-v2 entries, hides only dev task
// JSON in sets whose name ends in -v2, so a future company-v20 or team-v2-beta set, heldout folders, v0.x sets and v3
// sets stay reviewed, and company-v2-l5 and personal-v2x keep their own exact entries; fails_when=the pattern loses
// its separator after -v2 or its dev/ anchor; why_new=the two entries became one to make room within gstack's 64-pattern
// limit; seam=a throwaway git repository and git's own glob pathspecs; no_claim=which sets exist today.
test('the *-v2 dev task pattern matches only dev task JSON in sets whose name ends in -v2', () => {
  const kept = [
    'tasks/multiuser/company-v20/dev/stand-in/spec.json',
    'tasks/multiuser/team-v2-beta/dev/stand-in/spec.json',
    'tasks/multiuser/v2/dev/stand-in/spec.json',
    'tasks/multiuser/company-v3/dev/stand-in/spec.json',
    'tasks/multiuser/v0.3/dev/stand-in/spec.json',
    'tasks/multiuser/company-v2/heldout/stand-in/spec.json',
    'tasks/multiuser/company-v2-l5/dev/stand-in/task.toml',
  ];
  const dropped = [
    'tasks/multiuser/company-v2/dev/stand-in/spec.json',
    'tasks/multiuser/personal-v2/dev/stand-in/oracle.json',
    'tasks/multiuser/company-v2-l5/dev/stand-in/spec.json',
    'tasks/multiuser/personal-v2x/dev/stand-in/spec.json',
  ];
  expect(reviewed([...kept, ...dropped])).toEqual([...kept].sort());
});

// Value: protects=gstack refuses a review_exclude_paths list longer than 64 patterns, and it reads the list from the base
// branch, so one pattern too many on main stops every pull request's review; fails_when=a pattern is added past 64;
// why_new=one merge took main to 65 patterns and no /ship could run; seam=the policy file itself; no_claim=gstack's own
// limit, which this test copies.
test('review_exclude_paths stays within gstack\'s 64-pattern limit', () => {
  expect(POLICY.review_exclude_paths.length).toBeLessThanOrEqual(64);
});

