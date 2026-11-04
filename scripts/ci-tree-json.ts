// Writes the tree.json that gstack's CI carry reads (gstack docs/pregate.md#ci-carry; the "ci/checks" run profile in
// .gstack/pregate.json): this run, its attempt and event, the commit it tested and that commit's tree, and every test file
// bun ran with the test count, taken from bun's JUnit report. A pull_request run tests GitHub's merge commit, so `sha` is
// that commit and `head_sha` the pull request's head (PR_HEAD_SHA); a push run names the pushed commit for both.
// `skipped_files` lists the files with any skipped test on the runner, which the carry does not count as covered.
// Usage: bun scripts/ci-tree-json.ts --junit <bun junit.xml> --out <tree.json>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The test files a bun JUnit report names (a testsuite per file, nested ones per describe block), the tests that ran (the
 * report's total less the skipped and todo ones), and the files with at least one skipped or todo test (skipped_files:
 * gstack's carry runs those whole on the /ship machine instead of counting them as covered, so a test CI skipped for
 * want of an image, a drive path or an installed gstack still runs where it can). A file's own testsuite comes before its
 * nested ones, so its counts are the first ones seen for that file.
 */
export function testedFiles(junit: string): { files: string[]; tests: number; skipped_files: string[] } {
  const files = new Set<string>();
  const skipped = new Set<string>();
  const num = (tag: string, attr: string) => Number(new RegExp(`\\b${attr}="(\\d+)"`).exec(tag)?.[1] ?? 0);
  for (const [tag] of junit.matchAll(/<testsuite\b[^>]*>/g)) {
    const raw = /\bfile="([^"]*)"/.exec(tag)?.[1];
    if (!raw) continue;
    const file = unescape(raw).replace(/^(\.\/)+/, '');
    if (files.has(file)) continue;
    files.add(file);
    if (num(tag, 'skipped') > 0) skipped.add(file);
  }
  const root = /<testsuites\b[^>]*>/.exec(junit)?.[0] ?? '';
  const tests = num(root, 'tests') - num(root, 'skipped');
  return { files: [...files].sort(), tests, skipped_files: [...skipped].sort() };
}

function git(...args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const junitPath = arg('--junit');
  const out = arg('--out');
  const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} is not set`); return v; };
  if (!junitPath || !out) { console.error('usage: bun scripts/ci-tree-json.ts --junit <bun junit.xml> --out <tree.json>'); process.exit(2); }
  try {
    const sha = env('GITHUB_SHA');
    const head = git('rev-parse', 'HEAD');
    if (head !== sha) throw new Error(`HEAD is ${head}, not GITHUB_SHA ${sha}: tree.json must describe the commit this run tested`);
    const { files, tests, skipped_files } = testedFiles(readFileSync(junitPath, 'utf8'));
    if (!files.length || tests === 0) throw new Error(`${junitPath} names no test file or no test`);
    const record = {
      run_id: Number(env('GITHUB_RUN_ID')),
      run_attempt: Number(env('GITHUB_RUN_ATTEMPT')),
      event: env('GITHUB_EVENT_NAME'),
      sha,
      head_sha: process.env.PR_HEAD_SHA || sha,
      tree: git('rev-parse', 'HEAD^{tree}'),
      files,
      tests,
      skipped_files,
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
    console.log(`ci-tree-json: ${files.length} file(s), ${skipped_files.length} with skipped tests, ${tests} test(s), tree ${record.tree} -> ${out}`);
  } catch (e) {
    console.error(`ci-tree-json: ${(e as Error).message}`);
    process.exit(1);
  }
}
