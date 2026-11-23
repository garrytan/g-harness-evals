#!/usr/bin/env bun
/**
 * Picks the test files a pull request can affect, from the runtime test map the nightly test-map workflow publishes on
 * the orphan branch ci-test-map (scripts/ci/test-map/, .github/workflows/test-map.yml).
 *
 *   bun scripts/ci/select-tests.ts --base <rev> --head <rev> (--map-rev <rev> | --map-file <path>) [--now <iso>] [--profile export]
 *
 * Prints "all", or the selected test files one per line, and says why on stderr. It prints "all" when the map is missing,
 * unreadable or not schema 1, more than 3 days old, or traced at a commit that is not an ancestor of --base; when a
 * changed path is a FULL_RUN path, in the pull request or in what the base changed after the traced commit; with --profile
 * export (the public-export job's run on the export tree), when the pull request changes an export input (EXPORT_FULL_RUN:
 * what decides which files the export publishes, how it rewrites them and the files it writes itself); when a file the
 * pull request changes, of any kind, is one the map does not tie to a test (no test read it, it is under no test's tree,
 * and it adds or removes no entry in a directory a test listed), other than a test file; when the selection comes out
 * empty; or when anything else goes wrong.
 * Otherwise it selects, for the change from the merge base of --base and --head to --head (renames split into a delete
 * and an add):
 *   - every test whose map holds a changed path (paths: opened, stat-ed, probed, executed or read through git) or a
 *     directory above it among its trees (a docker build context or bind mount, or a git pathspec it read whole);
 *   - every test that listed a directory whose entries the change alters: a file added or deleted directly in it, or a
 *     subdirectory the change creates or removes (a modified file changes no directory listing);
 *   - every changed test file still present at --head, every ALWAYS test (whole-tree git readers), every test the map
 *     does not list, and every test whose map entry does not hold its own file (a trace that never saw the test open it
 *     says nothing about its reads);
 *   - the same for what the base changed after the traced commit, so a test whose reads changed with the base is picked by
 *     the files it read when traced (those changes alone never force a full run, since the base's own full run passed);
 *   - the image builders (BUILDERS, run-tests.sh's phase 1) a selected test needs: every builder when a selected test
 *     mentions docker (its old trace may not name an image a new case runs), else each builder that shares a tree with it
 *     (the map gives a test that runs an image the build context of that image), so a docker test never skips for want
 *     of its image.
 * CI passes the pull request's merge commit as --head, so the list names files in the tree the tests run in.
 * CI runs the base commit's copy of this file with no bunfig.toml, tsconfig.json or .env from the head, so a pull request
 * cannot change its own selection, and it imports nothing from the repository. Selection is safe only because
 * ubicloud/checks runs the full suite before every merge.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const FULL_RUN_FILES: readonly string[] = ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'scripts/run-tests.sh'];
export const FULL_RUN_DIRS: readonly string[] = ['.github/', 'tests/setup/', 'scripts/ci/'];
export const EXPORT_FULL_RUN: readonly string[] = ['publication/', 'scripts/public-export/', 'scripts/public-safety/', 'scripts/prereg-ledger.ts', 'runner/prereg/', 'docs/benchmarks/'];
export const MAX_AGE_HOURS = 72;
export const BUILDERS: readonly string[] = ['tests/adapter-conformance.test.ts', 'tests/claude-code-adapter.test.ts', 'tests/codex-adapter.test.ts'];
export const TEST_FILE = /^tests\/.*[._](test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export interface TestDeps { paths: string[]; dirs: string[]; trees: string[] }
export interface TestMap { schema: 1; sha: string; generated_at: string; tests: Record<string, TestDeps>; always: Record<string, string[]>; weights_ms?: Record<string, number> }
export interface Change { status: 'A' | 'D' | 'M'; path: string; drift?: boolean }
export type Verdict = { all: true; why: string } | { all: false; files: string[]; why: string };

/** The map's own shape, or the reason it is unusable. */
export function parseMap(bytes: Uint8Array): TestMap | string {
  let m: TestMap;
  try {
    m = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(bytes))));
  } catch (e) {
    return 'the map is unreadable (' + (e as Error).message.slice(0, 80) + ')';
  }
  if (!m || m.schema !== 1) return 'the map is not schema 1';
  if (typeof m.sha !== 'string' || !/^[0-9a-f]{40}$/.test(m.sha)) return 'the map names no traced commit';
  if (typeof m.generated_at !== 'string' || Number.isNaN(Date.parse(m.generated_at))) return 'the map has no generated_at time';
  if (!m.tests || typeof m.tests !== 'object' || !m.always || typeof m.always !== 'object') return 'the map has no tests or always table';
  for (const [t, d] of Object.entries(m.tests)) {
    if (!d || !Array.isArray(d.paths) || !Array.isArray(d.dirs) || !Array.isArray(d.trees)) return 'the map entry for ' + t + ' is malformed';
  }
  return m;
}

const ancestors = (p: string): string[] => {
  const parts = p.split('/');
  return ['.', ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))];
};

/**
 * The selection for one change set against one map. headTests is every test file at the head; newDirs the directories
 * the change creates or removes; extraFull more paths (a trailing / for a directory) that force a full run when the pull
 * request itself changes them.
 */
export function select(map: TestMap, changes: readonly Change[], headTests: ReadonlySet<string>, newDirs: ReadonlySet<string>, extraFull: readonly string[] = []): Verdict {
  const exact = new Map<string, Set<string>>(), dirs = new Map<string, Set<string>>(), trees = new Map<string, Set<string>>();
  const add = (idx: Map<string, Set<string>>, k: string, t: string) => { let s = idx.get(k); if (!s) idx.set(k, (s = new Set())); s.add(t); };
  const sel = new Set(Object.keys(map.always));
  for (const [t, d] of Object.entries(map.tests)) {
    if (!d.paths.includes(t)) sel.add(t);
    for (const p of d.paths) add(exact, p, t);
    for (const p of d.dirs) add(dirs, p, t);
    for (const p of d.trees) add(trees, p, t);
  }
  for (const t of headTests) if (!(t in map.tests) && !(t in map.always)) sel.add(t);
  for (const { status, path, drift } of changes) {
    const by = drift ? ' (the base changed it after the traced commit)' : '';
    if (FULL_RUN_FILES.includes(path)) return { all: true, why: 'full run: ' + path + ' changed' + by };
    const dir = FULL_RUN_DIRS.find((d) => path.startsWith(d));
    if (dir) return { all: true, why: 'full run: ' + path + ' is under ' + dir + by };
    const extra = drift ? undefined : extraFull.find((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
    if (extra) return { all: true, why: 'full run: ' + path + ' changed, and ' + extra + ' is an export input' };
    const hit = new Set(exact.get(path) ?? []);
    const anc = ancestors(path);
    for (const a of [...anc, path]) for (const t of trees.get(a) ?? []) hit.add(t);
    if (status !== 'M') {
      for (const t of dirs.get(anc[anc.length - 1]!) ?? []) hit.add(t);
      for (let i = 0; i < anc.length - 1; i++) if (newDirs.has(anc[i + 1]!)) for (const t of dirs.get(anc[i]!) ?? []) hit.add(t);
    }
    const isTest = TEST_FILE.test(path);
    if (isTest && status !== 'D' && headTests.has(path)) sel.add(path);
    if (hit.size === 0 && !drift && !(isTest && headTests.has(path)) && !(isTest && status === 'D')) {
      return { all: true, why: 'full run: ' + path + ' is a file no test in the map reads' };
    }
    for (const t of hit) sel.add(t);
  }
  const files = [...sel].filter((t) => headTests.has(t)).sort();
  if (!files.length) return { all: true, why: 'full run: the selection is empty' };
  const drifted = changes.filter((c) => c.drift).length;
  return { all: false, files, why: files.length + ' of ' + headTests.size + ' test files selected for ' + (changes.length - drifted) + ' changed path(s)' + (drifted ? ' and ' + drifted + ' path(s) the base changed after the traced commit' : '') };
}

/** files plus the builders they need; dockerTests are the selected files whose source mentions docker. */
export function addBuilders(map: TestMap, files: readonly string[], headTests: ReadonlySet<string>, dockerTests: ReadonlySet<string>): string[] {
  const out = new Set(files);
  for (const t of files) {
    if (BUILDERS.includes(t)) continue;
    const trees = map.tests[t]?.trees ?? [];
    const named = BUILDERS.filter((b) => (map.tests[b]?.trees ?? []).some((x) => trees.includes(x)));
    for (const b of dockerTests.has(t) ? BUILDERS : named) out.add(b);
  }
  return [...out].filter((t) => headTests.has(t)).sort();
}

function git(args: string[], input?: string, ok = [0]): { status: number; out: Buffer } {
  const r = spawnSync('git', args, { input, maxBuffer: 1 << 30 });
  if (r.status === null || !ok.includes(r.status)) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr?.toString().trim().slice(0, 200) ?? ''));
  return { status: r.status, out: r.stdout };
}

/** The verdict for --base and --head with the map's bytes (null when the map could not be read at all). */
export function decide(bytes: Uint8Array | null, base: string, head: string, now: Date, extraFull: readonly string[] = []): Verdict {
  if (!bytes) return { all: true, why: 'full run: no test map (the ci-test-map branch is missing or could not be read)' };
  const map = parseMap(bytes);
  if (typeof map === 'string') return { all: true, why: 'full run: ' + map };
  const ageH = (now.getTime() - Date.parse(map.generated_at)) / 3_600_000;
  if (ageH > MAX_AGE_HOURS) return { all: true, why: 'full run: the map is ' + Math.round(ageH) + ' hours old (limit ' + MAX_AGE_HOURS + ')' };
  if (ageH < -1) return { all: true, why: 'full run: the map is dated in the future' };
  const anc = git(['merge-base', '--is-ancestor', map.sha, base], undefined, [0, 1, 128]).status;
  if (anc !== 0) return { all: true, why: 'full run: the map traced ' + map.sha.slice(0, 12) + ', which is not an ancestor of the base ' + base.slice(0, 12) };
  const mb = git(['merge-base', base, head]).out.toString().trim();
  const changes: Change[] = [];
  const probe = new Map<string, string>();
  for (const [from, to, drift] of [[mb, head, false], [map.sha, base, true]] as const) {
    const tok = git(['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', from, to]).out.toString().split('\0');
    for (let i = 0; i + 1 < tok.length; i += 2) {
      const s = tok[i]!.charAt(0);
      const c: Change = { status: s === 'A' ? 'A' : s === 'D' ? 'D' : 'M', path: tok[i + 1]!, ...(drift ? { drift } : {}) };
      changes.push(c);
      if (c.status !== 'M') for (const d of ancestors(c.path).slice(1)) probe.set((c.status === 'A' ? from : to) + ':' + d, d);
    }
  }
  const headTests = new Set(git(['ls-tree', '-r', '-z', '--name-only', head, '--', 'tests']).out.toString().split('\0').filter((p) => TEST_FILE.test(p)));
  const newDirs = new Set<string>();
  if (probe.size) {
    const keys = [...probe.keys()];
    const lines = git(['cat-file', '--batch-check'], keys.join('\n') + '\n').out.toString().split('\n');
    keys.forEach((k, i) => { if (lines[i]?.endsWith(' missing')) newDirs.add(probe.get(k)!); });
  }
  const v = select(map, changes, headTests, newDirs, extraFull);
  if (v.all) return v;
  const picked = v.files;
  const users = picked.filter((t) => !BUILDERS.includes(t));
  const docker = new Set(users.length ? git(['grep', '-l', '-F', 'docker', head, '--', ...users], undefined, [0, 1]).out.toString().split('\n').filter(Boolean).map((l) => l.slice(head.length + 1)) : []);
  const files = addBuilders(map, picked, headTests, docker);
  const builders = files.length - picked.length;
  return { all: false, files, why: v.why + (builders ? ', plus ' + builders + ' image builder(s)' : '') };
}

function main(argv: string[]): number {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const base = arg('--base'), head = arg('--head'), rev = arg('--map-rev'), file = arg('--map-file'), profile = arg('--profile');
  if (!base || !head || (!rev && !file) || (profile !== undefined && profile !== 'export')) { console.error('usage: bun scripts/ci/select-tests.ts --base <rev> --head <rev> (--map-rev <rev> | --map-file <path>) [--now <iso>] [--profile export]'); return 2; }
  const now = arg('--now') ? new Date(arg('--now')!) : new Date();
  let v: Verdict;
  try {
    let bytes: Uint8Array | null = null;
    if (file) bytes = existsSync(file) ? readFileSync(file) : null;
    else {
      const r = spawnSync('git', ['show', rev + ':test-map.json.gz'], { maxBuffer: 1 << 30 });
      bytes = r.status === 0 ? r.stdout : null;
    }
    v = decide(bytes, base, head, now, profile === 'export' ? EXPORT_FULL_RUN : []);
  } catch (e) {
    v = { all: true, why: 'full run: ' + (e as Error).message };
  }
  console.log(v.all ? 'all' : v.files.join('\n'));
  console.error(v.why);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
