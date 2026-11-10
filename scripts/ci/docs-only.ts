#!/usr/bin/env bun
/**
 * Decides whether a change is docs-only, so CI and the private lane can skip the typecheck and the test suite and run
 * only the docs checks, while every required check still reports.
 *
 *   bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>]   prints docs_only=true or docs_only=false
 *   bun scripts/ci/docs-only.ts --audit [--tree <rev>]                     counts the listed docs that qualify
 *
 * A change is docs-only when every path it adds, edits, deletes or renames (merge base to head with renames split, so
 * both the old and the new name count) is a regular file on DOCS below, and the sha256 of neither its old nor its new
 * content is held by a committed file at --tree (default HEAD) or at the merge base (a pinned page). Anything else, or
 * anything the script cannot decide, prints docs_only=false.
 *
 * DOCS is an explicit list of human-facing pages, not a rule: a page joins it by a reviewed change to this file, which is
 * code and gets the full run. A page stays off it when an agent loads it as instructions (AGENTS.md, CLAUDE.md, SKILL.md,
 * CREW.md, prompts, templates, rubrics), when it is a preregistration, a plan, a result or a receipt, or when a test or a
 * script reads it, other than the docs checks: tests/docs-only.test.ts checks every entry against tests/ and scripts/.
 * The docs checks run for a docs-only change in place of the suite: DOC_TESTS (the tests that read the README or every
 * Markdown page), plus the link check, the hub fragments check and the preregistration order check CI and the lane run
 * anyway. CI and the lane run the base commit's copy of this file, so a change cannot add its own pages to the list, and
 * it imports nothing from the repository.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const DOCS: readonly string[] = [
  'README.md',
  'docs/comparing-runs.md',
  'docs/gbrain-evals-conventions.md',
  'docs/harness-anatomy/claude-code.md',
  'docs/harness-anatomy/codex.md',
  'docs/harness-anatomy/harness-zero.md',
  'docs/harness-anatomy/hermes.md',
  'docs/harness-anatomy/openclaw.md',
  'docs/harness-anatomy/qm.md',
  'docs/private-by-hash.md',
  'docs/publishing-checklist.md',
  'docs/report-standard.md',
  'docs/shared-rig.md',
  'findings/2026-11-01-gbrain-first-no-pass-lift.md',
  'findings/2026-11-01-model-vs-harness.md',
  'findings/2026-11-01-untold-gbrain-unused.md',
  'findings/2026-11-02-opus-gstack-steps-not-followed.md',
];

/** The tests a docs-only change still runs: tests/version.test.ts reads every Markdown page, tests/scoreboard.test.ts and tests/readme-settings.test.ts the README. */
export const DOC_TESTS: readonly string[] = ['tests/version.test.ts', 'tests/scoreboard.test.ts', 'tests/readme-settings.test.ts'];

/** Whether a path is on the list. */
export const listed = (p: string): boolean => DOCS.includes(p);

/** One side of a changed path: its mode and the sha256 of its content (null when it is not a listed regular file). */
export interface Side { path: string; mode: string; sha256: string | null }

/** Null when the change is docs-only, else the first path that disqualifies it and why. */
export function disqualifier(sides: readonly Side[], pinned: ReadonlySet<string>): { path: string; why: string } | null {
  if (!sides.length) return { path: '', why: 'no changed paths' };
  for (const s of sides) {
    if (!listed(s.path)) return { path: s.path, why: 'not on the docs-only list' };
    if (s.mode !== '100644') return { path: s.path, why: 'not a regular file' };
    if (!s.sha256) return { path: s.path, why: 'content unknown' };
    if (pinned.has(s.sha256)) return { path: s.path, why: 'its sha256 is pinned by a committed file' };
  }
  return null;
}

function git(args: string[], input?: string, ok = [0]): Buffer {
  const r = spawnSync('git', args, { input, maxBuffer: 1 << 30 });
  if (r.status === null || !ok.includes(r.status)) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr?.toString().trim().slice(0, 200) ?? ''));
  return r.stdout;
}

/** The contents of blobs by object id, in order. */
function blobs(ids: string[]): Buffer[] {
  if (!ids.length) return [];
  const out = git(['cat-file', '--batch'], ids.join('\n') + '\n');
  const bodies: Buffer[] = [];
  let off = 0;
  for (const id of ids) {
    const nl = out.indexOf(10, off);
    const [got, type, size] = out.subarray(off, nl).toString().split(' ');
    if (got !== id || type !== 'blob' || !Number.isFinite(Number(size))) throw new Error('cat-file: ' + id + ' is not a blob');
    bodies.push(out.subarray(nl + 1, nl + 1 + Number(size)));
    off = nl + 1 + Number(size) + 1;
  }
  return bodies;
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function lsTree(rev: string): { path: string; mode: string; type: string; id: string }[] {
  return git(['ls-tree', '-r', '-z', '--full-tree', rev]).toString().split('\0').filter(Boolean).map((e) => {
    const tab = e.indexOf('\t');
    const [mode, type, id] = e.slice(0, tab).split(' ');
    return { path: e.slice(tab + 1), mode: mode!, type: type!, id: id! };
  });
}

/** Which of the given sha256 values any committed file at the revisions holds, in either case. */
export function pinnedAt(revs: string[], hashes: string[]): Set<string> {
  const found = new Set<string>();
  const want = [...new Set(hashes)];
  if (!want.length) return found;
  for (const rev of revs) {
    const out = git(['grep', '-a', '-h', '-o', '-i', '-F', '--no-color', '-f', '/dev/stdin', rev], want.join('\n') + '\n', [0, 1]).toString();
    for (const m of out.match(/[0-9a-fA-F]{64}/g) ?? []) found.add(m.toLowerCase());
  }
  return found;
}

/** How many listed docs at the revision would qualify on their own, out of its Markdown files. */
export function audit(rev: string): { qualify: number; listed: number; markdown: number } {
  const md = lsTree(rev).filter((e) => e.path.endsWith('.md'));
  const candidates = md.filter((e) => listed(e.path) && e.mode === '100644');
  const hashes = blobs(candidates.map((c) => c.id)).map(sha256);
  const pins = pinnedAt([rev], hashes);
  const qualify = candidates.filter((c, i) => !disqualifier([{ path: c.path, mode: c.mode, sha256: hashes[i]! }], pins)).length;
  return { qualify, listed: candidates.length, markdown: md.length };
}

function main(argv: string[]): number {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const tree = arg('--tree') ?? 'HEAD';
  if (argv.includes('--audit')) {
    const a = audit(tree);
    console.log(a.qualify + ' of ' + a.markdown + ' Markdown files at ' + tree + ' qualify for the docs-only path (' + a.listed + ' of the ' + DOCS.length + ' listed docs present before the pin check)');
    return 0;
  }
  const base = arg('--base'), head = arg('--head');
  if (!base || !head) { console.error('usage: bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>] | --audit [--tree <rev>]'); return 2; }
  try {
    const mb = git(['merge-base', base, head]).toString().trim();
    const tok = git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', mb, head]).toString().split('\0');
    const sides: { path: string; mode: string; id: string }[] = [];
    for (let i = 0; i < tok.length; i++) {
      if (!tok[i]!.startsWith(':')) continue;
      const [oldMode, newMode, oldId, newId] = tok[i]!.slice(1).split(' ');
      const path = tok[++i]!;
      if (oldMode !== '000000') sides.push({ path, mode: oldMode!, id: oldId! });
      if (newMode !== '000000') sides.push({ path, mode: newMode!, id: newId! });
    }
    const files = sides.filter((s) => listed(s.path) && s.mode === '100644');
    const bodies = blobs(files.map((f) => f.id));
    const hashes = new Map(files.map((s, i) => [s, sha256(bodies[i]!)]));
    const bad = disqualifier(sides.map((s) => ({ path: s.path, mode: s.mode, sha256: hashes.get(s) ?? null })), pinnedAt([tree, mb], [...hashes.values()]));
    console.log('docs_only=' + (bad ? 'false' : 'true'));
    console.error(bad ? 'full run: ' + (bad.path || '(empty diff)') + ': ' + bad.why : 'docs-only: ' + new Set(sides.map((s) => s.path)).size + ' listed doc(s); the docs checks run: ' + DOC_TESTS.join(' '));
  } catch (e) {
    console.log('docs_only=false');
    console.error('full run: ' + (e as Error).message);
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
