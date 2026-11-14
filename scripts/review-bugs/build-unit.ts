#!/usr/bin/env bun
// Leak-proof unit repositories for the real-bug review eval (plan internal-task, "What the reviewer sees"; build step 1).
//
//   bun scripts/review-bugs/build-unit.ts --suite <suite.json> --units-dir <dir> --source <owner/repo>=<full clone>...
//       [--only <unit id>] [--keep]
//
// A unit repository follows the gstack-evals review rig's contract (gstack-evals src/trial/review/README.md, "Unit
// repositories", and unit.ts), so that rig's review-units command, given the same suite and a full clone per repository
// (--source), builds the same repository: git init on branch pr-<pr>, a fetch of the head commit and its ancestry only
// (no tags, no remote config, no FETCH_HEAD), the base branch and refs/remotes/origin/<base> at the merge-base of head
// and the unit's base, refs/remotes/origin/HEAD pointing at it, the reflog expired, gc --prune=now, and .gstack-home/ in
// .git/info/exclude. Nothing after the head is reachable or present: the fix commit, later PR commits and the base
// branch's later history are not fetched.
//
// Beside the repository (outside it, so the history check is unchanged) the unit gets:
// - pr.md: the PR title and the first revision of its body, from GitHub's edit history (GraphQL userContentEdits, one
//   query per batch of up to 20 units, never per page), with every line that mentions the later fix removed (its PR
//   number or URL, or its commit sha). A body never edited is its own first revision.
// - unit.json: the shas, the merge-base, the head's ancestry digest, the unit diff's sha256, the instruction-file digests
//   (the rig's units.json fields), the body's provenance and the leak canary's result.
// - leak-canary.sh: the network half of the canary, for each arm's sandbox to run before a session: git ls-remote, gh
//   and an HTTPS fetch of GitHub must all fail, and it prints one line naming how each failed, so arms can be compared.
//
// leakCanary(dir, unit) is the keyless half: the rig's history check, plus that no fix commit is present in the object
// store and that pr.md names no fix. A unit that fails is refused (E_UNIT_LEAK) and listed.

import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Gh } from './github.ts';
import { git } from './git.ts';

export const STATE_EXCLUDE = '.gstack-home/';
const DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index'];
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const lastLine = (text: string) => text.trim().split('\n').slice(-1)[0] ?? '';

export interface UnitRef { id: string; repo: string; pr: number; head: string; base: string }
export interface Forbidden { commits: string[]; prs: number[] }

export interface UnitRepo {
  unit: string; dir: string; head: string; base: string; merge_base: string; head_branch: string; base_branch: string;
  ancestry: { count: number; sha256: string }; diff_sha256: string; instructions: Record<string, string>;
}

export class UnitError extends Error {
  constructor(readonly code: 'E_UNIT_REPO' | 'E_UNIT_LEAK', readonly problems: string[]) { super(code + ': ' + problems.join('; ')); }
}

/** The rig's instruction digests: CLAUDE.md and AGENTS.md at any depth, and every file under .gstack/. */
export function instructionDigests(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of git(dir, ['ls-files', '-z']).out.split('\0').filter(Boolean).sort()) {
    const name = path.split('/').pop();
    if (name !== 'CLAUDE.md' && name !== 'AGENTS.md' && !path.startsWith('.gstack/')) continue;
    const file = join(dir, path);
    if (!lstatSync(file, { throwIfNoEntry: false })) continue;
    out[path] = lstatSync(file).isSymbolicLink() ? sha256('symlink:' + readlinkSync(file)) : sha256(readFileSync(file));
  }
  return out;
}

/** Builds the unit repository at dest from a full local clone, the same way the rig's buildUnitRepo does. */
export function buildUnitRepo(o: { unit: UnitRef; source: string; dest: string; baseBranch: string }): UnitRepo {
  const { unit, baseBranch } = o;
  const fail = (why: string): never => { throw new UnitError('E_UNIT_REPO', [unit.id + ': ' + why]); };
  const need = (dir: string, args: readonly string[], what: string): string => {
    const r = git(dir, args);
    if (r.code !== 0) fail(what + ': ' + lastLine(r.err));
    return r.out.trim();
  };
  if (!existsSync(o.source)) fail('no source clone at ' + o.source);
  if (need(o.source, ['rev-parse', '--is-shallow-repository'], 'the source is not a git repository') === 'true') fail('the source clone is shallow');
  const head = need(o.source, ['rev-parse', '--verify', '--quiet', unit.head + '^{commit}'], 'the source clone has no commit ' + unit.head);
  const base = need(o.source, ['rev-parse', '--verify', '--quiet', unit.base + '^{commit}'], 'the source clone has no base commit ' + unit.base);
  const mergeBase = need(o.source, ['merge-base', head, base], 'head and base share no merge-base');
  const ancestry = need(o.source, ['rev-list', head], 'git rev-list').split('\n').filter(Boolean).sort();
  const diff = git(o.source, [...DIFF, mergeBase, head]);
  if (diff.code !== 0) fail('git diff in the source: ' + lastLine(diff.err));
  if (existsSync(o.dest)) fail(o.dest + ' already exists');
  mkdirSync(o.dest, { recursive: true });
  const headBranch = 'pr-' + unit.pr;
  const steps: Array<[string[], string]> = [
    [['init', '-q', '-b', headBranch], 'git init'],
    [['-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', resolve(o.source), head], 'fetch the head commit'],
    [['update-ref', 'refs/heads/' + headBranch, head], 'write the head branch'],
    [['update-ref', 'refs/heads/' + baseBranch, mergeBase], 'write the base branch'],
    [['update-ref', 'refs/remotes/origin/' + baseBranch, mergeBase], 'write origin/' + baseBranch],
    [['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/' + baseBranch], 'write origin/HEAD'],
    [['reset', '-q', '--hard', head], 'check out the head'],
    [['reflog', 'expire', '--expire=now', '--all'], 'expire the reflog'],
  ];
  for (const [args, what] of steps) need(o.dest, args, what);
  for (const leftover of ['logs', 'FETCH_HEAD', 'ORIG_HEAD']) rmSync(join(o.dest, '.git', leftover), { recursive: true, force: true });
  need(o.dest, ['gc', '-q', '--prune=now'], 'git gc');
  rmSync(join(o.dest, '.git', 'logs'), { recursive: true, force: true });
  appendFileSync(join(o.dest, '.git', 'info', 'exclude'), '\n' + STATE_EXCLUDE + '\n');
  return { unit: unit.id, dir: o.dest, head, base, merge_base: mergeBase, head_branch: headBranch, base_branch: baseBranch, ancestry: { count: ancestry.length, sha256: sha256(ancestry.join('\n')) }, diff_sha256: sha256(diff.out), instructions: instructionDigests(o.dest) };
}

/** The keyless leak canary: every way the repository at dir differs from the unit repository built, or holds the fix. */
export function leakCanary(dir: string, repo: UnitRepo, forbidden: Forbidden, prText: string | null): string[] {
  const problems: string[] = [];
  const out = (args: readonly string[]): string | null => {
    const r = git(dir, args);
    if (r.code !== 0) { problems.push('git ' + args.join(' ') + ' failed: ' + lastLine(r.err)); return null; }
    return r.out.trim();
  };
  const lines = (t: string | null) => (t ?? '').split('\n').filter(Boolean);
  const all = lines(out(['rev-list', '--all'])).sort();
  const ancestry = lines(out(['rev-list', repo.head])).sort();
  if (all.join('\n') !== ancestry.join('\n')) problems.push('git rev-list --all holds ' + all.length + ' commits, not the head\'s ancestry of ' + ancestry.length);
  if (all.length !== repo.ancestry.count || sha256(all.join('\n')) !== repo.ancestry.sha256) problems.push('the commits differ from the head\'s ancestry in the source (' + repo.ancestry.count + ' commits)');
  const tags = lines(out(['tag', '-l']));
  if (tags.length) problems.push('tags present: ' + tags.join(', '));
  const remotes = lines(out(['remote']));
  if (remotes.length) problems.push('remotes configured: ' + remotes.join(', '));
  for (const leftover of ['logs', 'FETCH_HEAD', 'ORIG_HEAD']) if (existsSync(join(dir, '.git', leftover))) problems.push('.git/' + leftover + ' is present');
  const unreachable = lines(out(['fsck', '--unreachable', '--no-reflogs', '--no-progress'])).filter((l) => l.startsWith('unreachable'));
  if (unreachable.length) problems.push(unreachable.length + ' unreachable objects');
  const expected = ['refs/heads/' + repo.base_branch + ' ' + repo.merge_base, 'refs/heads/' + repo.head_branch + ' ' + repo.head, 'refs/remotes/origin/' + repo.base_branch + ' ' + repo.merge_base, 'refs/remotes/origin/HEAD ' + repo.merge_base].sort();
  const refs = lines(out(['for-each-ref', '--format=%(refname) %(objectname)'])).sort();
  if (refs.join('\n') !== expected.join('\n')) problems.push('refs are ' + JSON.stringify(refs) + ', not ' + JSON.stringify(expected));
  if (out(['symbolic-ref', 'HEAD']) !== 'refs/heads/' + repo.head_branch) problems.push('HEAD is not the head branch ' + repo.head_branch);
  if (out(['rev-parse', 'HEAD']) !== repo.head) problems.push('HEAD is not the head commit');
  for (const name of ['origin/' + repo.base_branch, repo.base_branch, 'origin/HEAD']) {
    const mb = out(['merge-base', 'HEAD', name]);
    if (mb !== repo.merge_base) problems.push('git merge-base HEAD ' + name + ' is ' + mb + ', not ' + repo.merge_base);
  }
  const diff = git(dir, [...DIFF, repo.base_branch + '...HEAD']);
  if (diff.code !== 0 || sha256(diff.out) !== repo.diff_sha256) problems.push('git diff ' + repo.base_branch + '...HEAD is not the unit\'s diff');
  const status = out(['status', '--porcelain']);
  if (status) problems.push('the working tree is not clean');
  for (const c of forbidden.commits) if (git(dir, ['cat-file', '-e', c + '^{commit}']).code === 0) problems.push('the fix commit ' + c.slice(0, 12) + ' is present');
  if (prText !== null) for (const m of fixMentions(prText, forbidden)) problems.push('pr.md mentions the fix: ' + m);
  return problems;
}

/** Each mention of a fix in text: its PR number or URL, or a commit sha prefix of 7 or more characters. */
export function fixMentions(text: string, f: Forbidden): string[] {
  const out: string[] = [];
  for (const n of f.prs) if (new RegExp('(#|/pull/|/issues/)' + n + '\\b').test(text)) out.push('#' + n);
  for (const c of f.commits) for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (c.startsWith(m[0])) out.push(m[0]);
  return out;
}

/** The body with every line that mentions a fix removed, and how many lines went. */
export function scrubBody(body: string, f: Forbidden): { text: string; removed: number } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((l) => fixMentions(l, f).length === 0);
  return { text: kept.join('\n'), removed: lines.length - kept.length };
}

export interface FirstBody { title: string; body: string; source: 'first-revision' | 'unedited' | 'unavailable'; edits: number }

/** The first revision of each PR's body, by "<repo>#<pr>", from one GraphQL query per batch of up to 20 PRs. */
export async function firstBodies(gh: Gh, prs: ReadonlyArray<{ repo: string; pr: number }>): Promise<Map<string, FirstBody>> {
  const out = new Map<string, FirstBody>();
  for (let i = 0; i < prs.length; i += 20) {
    const batch = prs.slice(i, i + 20);
    const q = 'query { ' + batch.map((p, j) => {
      const [owner, name] = p.repo.split('/');
      return 'p' + j + ': repository(owner: ' + JSON.stringify(owner) + ', name: ' + JSON.stringify(name) + ') { pullRequest(number: ' + p.pr + ') { title body createdAt userContentEdits(first: 100) { totalCount nodes { editedAt diff } } } }';
    }).join(' ') + ' }';
    const res = (await gh.graphql(q)) as any;
    batch.forEach((p, j) => {
      const node = res?.data?.['p' + j]?.pullRequest;
      const key = p.repo + '#' + p.pr;
      if (!node) { out.set(key, { title: '', body: '', source: 'unavailable', edits: 0 }); return; }
      const edits = (node.userContentEdits?.nodes ?? []).filter((e: any) => typeof e?.diff === 'string');
      if (!node.userContentEdits?.totalCount) { out.set(key, { title: node.title, body: node.body ?? '', source: 'unedited', edits: 0 }); return; }
      const total = node.userContentEdits.totalCount as number;
      if (edits.length < total) { out.set(key, { title: node.title, body: '', source: 'unavailable', edits: total }); return; }
      const first = [...edits].sort((a: any, b: any) => (a.editedAt < b.editedAt ? -1 : 1))[0];
      out.set(key, { title: node.title, body: first.diff, source: 'first-revision', edits: total });
    });
  }
  return out;
}

export const prMarkdown = (title: string, body: string) => '# ' + title.trim() + '\n\n' + body.trim() + '\n';

/** The network half of the canary, written beside each unit for the arm sandboxes to run. */
export function canaryScript(repo: string): string {
  return [
    '#!/bin/sh',
    '# Leak canary, network half: every way out to GitHub must fail. Prints one line; compare it across arms.',
    'r1=fail; git ls-remote https://github.com/' + repo + '.git HEAD >/dev/null 2>&1 && r1=open',
    'r2=fail; if command -v gh >/dev/null 2>&1; then gh api repos/' + repo + ' >/dev/null 2>&1 && r2=open; else r2=absent; fi',
    'r3=fail; if command -v curl >/dev/null 2>&1; then curl -fsS -m 10 https://api.github.com/repos/' + repo + ' >/dev/null 2>&1 && r3=open; else r3=absent; fi',
    'echo "leak-canary git=$r1 gh=$r2 https=$r3"',
    'case "$r1$r2$r3" in *open*) exit 1;; esac',
    '',
  ].join('\n');
}

interface SuiteUnit extends UnitRef { forbidden?: Forbidden; base_branch?: string }

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? null : null; };
  const all = (k: string) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]!] : []));
  const suitePath = val('--suite'), unitsDir = val('--units-dir');
  if (!suitePath || !unitsDir) { process.stderr.write('usage: see the header of scripts/review-bugs/build-unit.ts\n'); process.exit(2); }
  const sources = new Map(all('--source').map((s) => s.split('=') as [string, string]));
  const suite = JSON.parse(readFileSync(suitePath, 'utf8')) as { units: SuiteUnit[]; unit_extras?: Record<string, { forbidden: Forbidden; base_branch: string }> };
  const units = suite.units.filter((u) => sources.has(u.repo) && (!val('--only') || u.id === val('--only')));
  const gh = new Gh({ cacheDir: join(resolve(unitsDir), '.gh-cache') });
  const bodies = await firstBodies(gh, units.map((u) => ({ repo: u.repo, pr: u.pr })));
  const refused: string[] = [];
  for (const u of units) {
    const extra = suite.unit_extras?.[u.id] ?? { forbidden: { commits: [], prs: [] }, base_branch: 'main' };
    const dest = join(resolve(unitsDir), u.id.replace(/[/#@]/g, '_'));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    try {
      const repo = buildUnitRepo({ unit: u, source: sources.get(u.repo)!, dest: join(dest, 'repo'), baseBranch: extra.base_branch });
      const fb = bodies.get(u.repo + '#' + u.pr)!;
      const scrubbed = scrubBody(fb.body, extra.forbidden);
      const md = prMarkdown(fb.title, scrubbed.text);
      writeFileSync(join(dest, 'pr.md'), md);
      writeFileSync(join(dest, 'leak-canary.sh'), canaryScript(u.repo));
      chmodSync(join(dest, 'leak-canary.sh'), 0o755);
      const problems = leakCanary(repo.dir, repo, extra.forbidden, md);
      writeFileSync(join(dest, 'unit.json'), JSON.stringify({ ...repo, dir: undefined, pr_body: { source: fb.source, edits: fb.edits, removed_lines: scrubbed.removed, sha256: sha256(md) }, canary: { problems } }, null, 1) + '\n');
      if (problems.length) refused.push(u.id + ': ' + problems.join('; '));
      process.stderr.write('unit: ' + u.id + (problems.length ? ' REFUSED (E_UNIT_LEAK)' : ' ok') + '\n');
      if (!argv.includes('--keep')) rmSync(join(dest, 'repo'), { recursive: true, force: true });
    } catch (e) {
      refused.push(u.id + ': ' + (e as Error).message);
      process.stderr.write('unit: ' + u.id + ' ' + (e as Error).message + '\n');
    }
  }
  if (refused.length) { process.stderr.write(refused.length + ' units refused\n'); process.exit(1); }
}
