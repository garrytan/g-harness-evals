// scripts/ci/docs-only.ts decides whether a change skips the typecheck and the test suite and runs only the docs checks.
// The rule is an explicit list of human-facing pages (DOCS) plus the pin check. These tests pin the list against the real
// tree (every page is there, none is pinned, none is agent-loaded, a preregistration or a result, and no test or script
// outside the docs checks reads one), the --audit count on the real tree against a floor, the docs checks CI and the lane
// run, and the CLI on a scratch repository, including deletions, renames and pins. Keyless; every spawned process gets
// PATH, HOME and TMPDIR only.
//
// Value: protects=a docs-only change skips the suite only when every path is a listed human-facing page that no skipped
// test reads, so main cannot go red on a change that ran no tests; fails_when=a listed page is missing, pinned,
// agent-loaded, a preregistration or a result, a test or script outside the docs checks reads one, the docs checks CI or
// the lane runs drift from DOC_TESTS, or --audit falls to 0 (the old word match qualified 0 of 1,481 at 847f77a); why_new=the
// word-match classifier could never fire; seam=git on the checkout and on a scratch repository; no_claim=which pages a
// person would call human-facing.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { disqualifier, DOC_TESTS, DOCS, listed, pinnedAt, sha256 } from '../scripts/ci/docs-only.ts';

const ROOT = resolve(import.meta.dir, '..');
const LANE = join(ROOT, 'scripts', 'ubicloud', 'pr-check.sh');
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() };
const cli = (cwd: string, ...args: string[]) => spawnSync('bun', [join(ROOT, 'scripts', 'ci', 'docs-only.ts'), ...args], { cwd, encoding: 'utf8', env });
const gitIn = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

// The files the docs checks run or read, which may read a listed page: DOC_TESTS, the scripts they run, the link and hub
// fragments checks, and this classifier with its test.
const DOCS_CHECKS = [...DOC_TESTS, 'scripts/scoreboard/', 'scripts/check-links.py', 'scripts/check-links-allow.txt', 'scripts/fold-hub-fragments.ts', 'scripts/ci/docs-only.ts', 'tests/docs-only.test.ts'];
const inDocsChecks = (f: string) => DOCS_CHECKS.some((d) => (d.endsWith('/') ? f.startsWith(d) : f === d));
// Files that name every Markdown page by a '*.md' glob but run outside the suite a docs-only change skips, each with why.
const GLOB_OUTSIDE_SUITE: Record<string, string> = {
  'scripts/public-safety/classes.json': 'path classes for the public-safety workflow, which runs on every pull request whatever docs-only says',
  'scripts/public-safety/rules.json': 'rules for the same public-safety workflow',
  'scripts/publish-audit.ts': 'run by scripts/bundle.ts and scripts/replicate.ts at publish time, never by the suite on this tree',
  'tests/sealed-custody.test.ts': 'the glob is a fake gbrain import counting pages in its own scratch directory',
  'tests/skill-resolver-set-t.test.ts': 'the glob is an exists check counting pages in its own scratch task directory',
};
// Captured harness request JSON under tests/fixtures/ (tests/fixtures/**/*-request.json): byte copies of a harness's own
// tool descriptions, whose '*.md' globs name files inside the trial, not pages of this repository. Other fixtures keep the rule.
const CAPTURED_REQUEST = /^tests\/fixtures\/.+-request\.json$/;

// The ways a test or script names a page it reads: a nested page by its path, its quoted basename or "/<basename>"
// (join(DIR, 'x.md') was the read the first classifier missed); the top-level README by a join of the repository root with
// 'README.md' or a read of 'README.md' from the root (other directories have README.md files of their own); and every
// Markdown page by a quoted '*.md' glob.
function readsOf(path: string, text: string, f = ''): boolean {
  if (!(f in GLOB_OUTSIDE_SUITE) && !CAPTURED_REQUEST.test(f) && /['"\x60][^'"\x60\s]*\*\.md['"\x60]/.test(text)) return true;
  if (path.includes('/')) {
    const b = posix.basename(path);
    return [path, "'" + b + "'", '"' + b + '"', '\x60' + b + '\x60', '/' + b].some((n) => text.includes(n));
  }
  const q = "['\"\x60]" + path.replace(/\./g, '\\.') + "['\"\x60]";
  return new RegExp("(?:\\b(?:ROOT|root|REPO|repo_root|repoRoot|REPO_ROOT)\\s*,\\s*|import\\.meta\\.dir\\s*,\\s*['\"]\\.\\.['\"]\\s*,\\s*|readFileSync\\(\\s*|open\\(\\s*)" + q).test(text);
}

describe('the docs-only list', () => {
  test('only the listed pages are docs; nearby pages, fragments, preregistrations and agent files are not', () => {
    for (const p of DOCS) expect(listed(p)).toBe(true);
    for (const p of ['docs/methods.md', 'docs/methodology.md', 'docs/corrections.md', 'docs/README.md', 'findings/README.md', 'docs/benchmarks/run/report.md', 'docs/scoreboard.md', 'docs/plans/x/PREREGISTRATION.md', 'docs/loops/TEMPLATE.md', 'changelog.d/item.md', 'todos.d/item.md', 'AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md', 'TODOS.md', 'docs/comparing-runs.txt', './README.md', 'docs/harness-anatomy/README.md']) expect(listed(p)).toBe(false);
  });

  test('no listed page is agent-loaded, a preregistration, a plan, a loop, a result or a receipt (R81)', () => {
    for (const p of DOCS) {
      expect([p, /(^|\/)(AGENTS|CLAUDE|SKILL|CREW|TEMPLATE|PREREGISTRATION[^/]*|AMENDMENTS)\.md$/.test(p)]).toEqual([p, false]);
      expect([p, /^docs\/(benchmarks|scoreboard|plans|loops)\/|(^|\/)(receipts|results|evidence|prompts?)\//.test(p)]).toEqual([p, false]);
      expect([p, p.endsWith('.md')]).toEqual([p, true]);
    }
  });

  test('every listed page is a regular file on the real tree that no committed file pins', () => {
    const tree = new Map(gitIn(ROOT, 'ls-tree', '-r', '-z', '--full-tree', 'HEAD').split('\0').filter(Boolean).map((e) => [e.slice(e.indexOf('\t') + 1), e.split(' ')[0]]));
    for (const p of DOCS) expect([p, tree.get(p)]).toEqual([p, '100644']);
    const hashes = DOCS.map((p) => sha256(readFileSync(join(ROOT, p))));
    expect([...pinnedAt(['HEAD'], hashes)]).toEqual([]);
  }, 60_000);

  test('no test or script outside the docs checks reads a listed page', () => {
    const files = gitIn(ROOT, 'ls-files', '-z', '--', 'tests', 'scripts').split('\0').filter((f) => f && !inDocsChecks(f));
    const texts = files.map((f) => ({ f, text: readFileSync(join(ROOT, f), 'latin1') }));
    const readers = DOCS.flatMap((p) => texts.filter(({ f, text }) => readsOf(p, text, f)).map(({ f }) => p + ' <- ' + f));
    expect(readers).toEqual([]);
    const inside = readFileSync(join(ROOT, 'tests', 'scoreboard.test.ts'), 'utf8');
    expect(readsOf('README.md', inside)).toBe(true);
    expect(readsOf('README.md', "readFileSync(join(ROUTES, 'README.md'))")).toBe(false);
    for (const g of Object.keys(GLOB_OUTSIDE_SUITE)) expect([g, readsOf('docs/comparing-runs.md', readFileSync(join(ROOT, g), 'latin1'))]).toEqual([g, true]);
    expect(readsOf('docs/comparing-runs.md', "const pages = glob('docs/**/*.md');", 'scripts/frontier-harbor/x.ts')).toBe(true);
    expect(readsOf('docs/comparing-runs.md', '"path": "`.claude/agents/*.md`"', 'tests/fixtures/frontier-harbor-gstack/claude-full-first-request.json')).toBe(false);
    expect(readsOf('docs/comparing-runs.md', '"path": "`.claude/agents/*.md`"', 'tests/fixtures/frontier-harbor-gstack/subsets.json')).toBe(true);
    expect(readsOf('docs/harness-anatomy/qm.md', "readFileSync(join(ANATOMY, 'qm.md'))")).toBe(true);
    expect(readsOf('docs/harness-anatomy/qm.md', "spawnSync('git', ['ls-files', '*.md'])")).toBe(true);
  }, 60_000);

  test('--audit on the real tree counts every listed page as qualifying, above a floor', () => {
    const r = cli(ROOT, '--audit');
    const m = r.stdout.match(/^(\d+) of (\d+) Markdown files at HEAD qualify for the docs-only path \((\d+) of the (\d+) listed docs present before the pin check\)\n$/);
    expect(m).not.toBeNull();
    const [qualify, markdown, present, total] = m!.slice(1).map(Number);
    expect(qualify).toBeGreaterThanOrEqual(15);
    expect([qualify, present, total]).toEqual([DOCS.length, DOCS.length, DOCS.length]);
    expect(markdown).toBeGreaterThan(qualify!);
  }, 60_000);

  test('CI and the private lane run exactly DOC_TESTS for a docs-only change', () => {
    const line = 'bun test ' + DOC_TESTS.join(' ');
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain("if: steps.docs.outputs.docs_only == 'true'\n        run: " + line + '\n');
    expect(ci).not.toContain("if: github.repository == 'garrytan/g-harness-evals'\n        env:\n          BASE");
    expect(readFileSync(join(ROOT, 'scripts', 'ubicloud', 'checks.sh'), 'utf8')).toContain('if [ "${HE_DOCS_ONLY:-}" = true ]; then\n  step docs-tests ' + line + '\n');
  });

  test.skipIf(!existsSync(LANE))('pr-check.sh passes the base commit\'s verdict to checks.sh (private repository only: publication/manifest.json keeps pr-check.sh out of the public copy)', () => {
    const lane = readFileSync(LANE, 'utf8');
    expect(lane).toContain('git -C "$src" show "$base:scripts/ci/docs-only.ts" > "$scratch/docs-only/docs-only.ts"');
    expect(lane).toContain('[ "$docs_only" = docs_only=true ] || docs_only=docs_only=false');
    expect(lane).toContain('--env "HE_DOCS_ONLY=${docs_only#docs_only=}"');
  });
});

describe('docs-only verdicts', () => {
  test('a pinned page, a symlink, an unlisted path and an empty change disqualify', () => {
    const side = (path: string, mode = '100644') => ({ path, mode, sha256: sha256(path) });
    expect(disqualifier([side('docs/comparing-runs.md')], new Set())).toBeNull();
    expect(disqualifier([side('docs/comparing-runs.md')], new Set([sha256('docs/comparing-runs.md')]))).toEqual({ path: 'docs/comparing-runs.md', why: 'its sha256 is pinned by a committed file' });
    expect(disqualifier([side('README.md', '120000')], new Set())?.why).toBe('not a regular file');
    expect(disqualifier([side('README.md'), side('docs/methods.md')], new Set())).toEqual({ path: 'docs/methods.md', why: 'not on the docs-only list' });
    expect(disqualifier([{ path: 'README.md', mode: '100644', sha256: null }], new Set())?.why).toBe('content unknown');
    expect(disqualifier([], new Set())).toEqual({ path: '', why: 'no changed paths' });
  });
});

describe('docs-only CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-only-'));
  scratch.push(dir);
  const git = (...args: string[]) => gitIn(dir, ...args).trim();
  const write = (p: string, text: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
  const commit = (msg: string) => { git('add', '-A'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const branch = (name: string, from: string, edit: () => void) => { git('checkout', '-q', '-b', name, from); edit(); const h = commit(name); git('checkout', '-q', 'main'); return h; };
  git('init', '-q', '-b', 'main');
  write('README.md', '# readme\n');
  write('docs/comparing-runs.md', '# comparing runs\n');
  write('docs/shared-rig.md', '# pinned\n');
  write('docs/methods.md', '# methods\n');
  write('receipts/pins.json', JSON.stringify({ pinned: sha256('# pinned\n') }) + '\n');
  const base = commit('base');
  const edited = branch('edit', base, () => { write('README.md', '# readme, edited\n'); write('docs/comparing-runs.md', '# comparing runs, edited\n'); });
  const deleted = branch('delete', base, () => { git('rm', '-q', 'docs/comparing-runs.md'); });
  const renamed = branch('rename', base, () => { git('mv', 'docs/comparing-runs.md', 'docs/comparing-runs-2.md'); });
  const unlisted = branch('unlisted', base, () => write('docs/methods.md', '# methods, edited\n'));
  const pinned = branch('pinned', base, () => write('docs/shared-rig.md', '# pinned, edited\n'));
  const fragment = branch('fragment', base, () => { write('README.md', '# readme, edited\n'); write('changelog.d/x.md', '- a fragment\n'); });
  const linked = branch('symlink', base, () => { rmSync(join(dir, 'docs/comparing-runs.md')); symlinkSync('../README.md', join(dir, 'docs/comparing-runs.md')); });

  test('prints docs_only=true for listed pages edited or deleted, and names the docs checks', () => {
    for (const head of [edited, deleted]) {
      const r = cli(dir, '--base', base, '--head', head, '--tree', head);
      expect(r.stdout).toBe('docs_only=true\n');
      expect(r.stderr).toContain('the docs checks run: ' + DOC_TESTS.join(' '));
    }
  });

  test('prints docs_only=false for a rename off the list, an unlisted page, a pinned page, a fragment beside a page and a symlink', () => {
    const cases: [string, string][] = [[renamed, 'docs/comparing-runs-2.md: not on the docs-only list'], [unlisted, 'docs/methods.md: not on the docs-only list'], [pinned, 'docs/shared-rig.md: its sha256 is pinned by a committed file'], [fragment, 'changelog.d/x.md: not on the docs-only list'], [linked, 'docs/comparing-runs.md: not a regular file']];
    for (const [head, why] of cases) {
      const r = cli(dir, '--base', base, '--head', head, '--tree', head);
      expect(r.stdout).toBe('docs_only=false\n');
      expect(r.stderr).toContain(why);
    }
  });

  test('fails closed on a revision it cannot resolve, and exits 2 without arguments', () => {
    expect(cli(dir, '--base', 'no-such-rev', '--head', edited).stdout).toBe('docs_only=false\n');
    expect(cli(dir).status).toBe(2);
  });

  test('--audit counts the listed pages that qualify', () => {
    expect(cli(dir, '--audit', '--tree', base).stdout).toBe('2 of 4 Markdown files at ' + base + ' qualify for the docs-only path (3 of the ' + DOCS.length + ' listed docs present before the pin check)\n');
  });
});

describe.skipIf(!existsSync(LANE))('the private lane verdict', () => {
  test('pr-check.sh asks the base commit\'s copy, so a head that rewrites the classifier still gets the full run', () => {
    const lines = readFileSync(LANE, 'utf8').split('\n');
    const start = lines.findIndex((l) => l.startsWith("# The base commit's copy of scripts/ci/docs-only.ts decides"));
    const end = lines.findIndex((l, i) => i > start && l.startsWith('[ "$docs_only" = docs_only=true ]'));
    expect([start > 0, end > start]).toEqual([true, true]);
    const repo = mkdtempSync(join(tmpdir(), 'docs-only-lane-'));
    scratch.push(repo);
    const git = (...args: string[]) => gitIn(repo, ...args).trim();
    const commit = (msg: string) => { git('add', '-A'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main');
    mkdirSync(join(repo, 'scripts', 'ci'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'ci', 'docs-only.ts'), readFileSync(join(ROOT, 'scripts', 'ci', 'docs-only.ts')));
    writeFileSync(join(repo, 'README.md'), '# readme\n');
    const base = commit('base');
    writeFileSync(join(repo, 'README.md'), '# readme, edited\n');
    const docs = commit('docs');
    git('checkout', '-q', base);
    writeFileSync(join(repo, 'scripts', 'ci', 'docs-only.ts'), "console.log('docs_only=true');\n");
    const lying = commit('lying classifier');
    const verdict = (sha: string, b = base) => {
      const s = mkdtempSync(join(tmpdir(), 'docs-only-lane-scratch-'));
      scratch.push(s);
      const script = ['set -euo pipefail', 'src=$1; base=$2; sha=$3; scratch=$4', ...lines.slice(start, end + 1), 'echo "$docs_only"'].join('\n');
      const r = spawnSync('bash', ['-c', script, 'lane', repo, b, sha, s], { encoding: 'utf8', env });
      expect(r.status).toBe(0);
      return r.stdout.trim();
    };
    expect(verdict(docs)).toBe('docs_only=true');
    expect(verdict(lying)).toBe('docs_only=false');
    expect(verdict(docs, '0000000000000000000000000000000000000000')).toBe('docs_only=false');
  }, 60_000);
});
