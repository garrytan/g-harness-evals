#!/usr/bin/env bun
// Mining for the real-bug review eval's bug set (plan internal-task, "Bug set (the suite)", build step 1).
//
//   bun scripts/review-bugs/mine.ts archive  --work <dir> [--from 2026-07-01] [--to 2026-11-13] [--jobs 6]
//   bun scripts/review-bugs/mine.ts repos    --work <dir> [--want 60]
//   bun scripts/review-bugs/mine.ts prs      --work <dir>
//   bun scripts/review-bugs/mine.ts clone    --work <dir>
//   bun scripts/review-bugs/mine.ts pairs    --work <dir>          S1 and S2 comment-then-fix pairs
//   bun scripts/review-bugs/mine.ts escaped  --work <dir>          S3 fix-to-introducer links
//   bun scripts/review-bugs/mine.ts decoys   --work <dir> [--want 40]
//   bun scripts/review-bugs/mine.ts pool     --work <dir> [--per-repo 14]
//
// Sources. GitHub answers this machine's repository API calls for outside repositories as anonymous (60 an hour; see
// github.ts), so review comments come from GH Archive (data.gharchive.org, every public PullRequestReviewCommentEvent
// it recorded: path, the commented diff hunk, the commit the comment was made on, the author and author type), PR
// metadata (title, body, author, merge time) from the search API, and commits, diffs and blame from git clones made
// without blobs (blobs are fetched when a diff needs them). Each stage writes its output under <work> and records what
// it finished in <work>/cursor.json, so a rerun resumes where the last one stopped.
//
// Stages:
// - archive: streams each hour of GH Archive from --from to --to, keeping review comments (top-level ones and replies)
//   and changes-requested reviews, trimmed, into <work>/archive/<hour>.jsonl.gz. An hour whose file exists is skipped.
// - repos: counts review comments per repository, drops excluded owners, asks search for each repository's licence,
//   language, stars, age, fork and archive state, and keeps up to --want repositories that pass the filters (OSI
//   licence; TypeScript, Python, Go or Rust; pushed in the last 30 days; at least 1,000 stars; created by 2025-06-30, so
//   an established project; not a fork; under 1.5 GB), ranked by twice the human review comments plus the tool ones, at
//   most 40% in one language. Test-suite and gstack checks happen at clone.
// - prs: every PR merged on or after 2026-07-01 in each kept repository, read from the default branch's merge and
//   squash commits (number, title, merge time), with the body and author from search for the PRs whose text uses the
//   introducing words (INTRO_WORDS), split by month (and halved again) so no query passes search's 1,000-result limit,
//   plus issues that mention a regression. Search shares a 30-a-minute quota, so asking it for every merged PR took
//   hours per large repository; pairs looks up the authors it needs with batched GraphQL. Runs after clone. Writes
//   <work>/prs/<owner>__<repo>.json.
// - clone: a blobless clone of each kept repository; drops a repository with a .gstack directory, gstack named in an
//   agent file (AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .cursor/rules, .github/copilot-instructions.md, .claude/),
//   or fewer than 20 test files at its default branch.
// - pairs: S1 (a human reviewer other than the PR's author) and S2 (a model review tool, never a gstack-family one):
//   a top-level comment on a line of the PR's new side, followed before merge by a commit that changes the lines it
//   names, on a unit diff of 20 to 1,000 changed lines. Accounts of type User that post like a review agent (see
//   agentAccounts) are dropped, since they are neither a person nor a named tool. Half of --per-repo goes to each of
//   S1 and S2, so tool comments, which score higher, do not crowd out people's. The unit head is the commit before
//   that fix. When the commented commit is no longer on the PR branch (a
//   force push) but still exists, the unit head is that commit and the fix point is the PR's final head. When it is gone,
//   the candidate is marked for reinjection.
// - escaped: S3: a merged fix PR whose body or commit message points at an earlier PR that introduced the bug (or links
//   an issue that does), where the fix touches files the earlier PR changed. The unit is the introducing PR at its own
//   head (refs/pull/<n>/head) against its own base (the merge-base of that head and the base branch before it merged).
// - decoys: merged PRs (merged by 2026-08-14, so 90 days have passed) whose added lines are all still blamed to them 90
//   days after merge, so no later commit, fix or otherwise, touched them.
// - pool: the candidate pool for screening: at most --per-repo candidates per repository, S3 first, then S1, then S2,
//   diff 20 to 1,000 changed lines. Writes <work>/candidates.jsonl.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Gh } from './github.ts';
import { addedRanges, commentedLine, git, gitAsync, hunks, isCodePath, TEST_PATH, touchesOld } from './git.ts';

export const WINDOW_START = '2026-07-01';
export const EXCLUDED_OWNERS = ['garrytan', 'yc-software'];
export const LANGUAGES = ['TypeScript', 'Python', 'Go', 'Rust'];
/** SPDX ids of OSI-approved licences GitHub detects. */
export const OSI = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'EPL-2.0', 'Unlicense', '0BSD', 'BSL-1.0', 'Zlib', 'EUPL-1.2', 'MIT-0', 'PostgreSQL', 'NCSA', 'UPL-1.0', 'Artistic-2.0'];
export const MIN_LINES = 20;
export const MAX_LINES = 1000;
export const MAX_UNITS_PER_REPO = 4;

/**
 * Model review tools S2 accepts, by bot login, with the model family each one runs on as its vendor states it. A
 * gstack-family tool is never listed. "mixed" means the vendor routes between labs or does not name one.
 */
export const REVIEW_TOOLS: Readonly<Record<string, { tool: string; family: string; basis: string }>> = {
  'coderabbitai[bot]': { tool: 'CodeRabbit', family: 'mixed', basis: 'vendor docs name models from several labs' },
  'Copilot': { tool: 'GitHub Copilot code review', family: 'openai', basis: 'GitHub docs: Copilot code review runs on a GPT model by default' },
  'copilot-pull-request-reviewer[bot]': { tool: 'GitHub Copilot code review', family: 'openai', basis: 'GitHub docs: Copilot code review runs on a GPT model by default' },
  'chatgpt-codex-connector[bot]': { tool: 'Codex code review', family: 'openai', basis: 'OpenAI product' },
  'gemini-code-assist[bot]': { tool: 'Gemini Code Assist', family: 'google', basis: 'Google product' },
  'claude[bot]': { tool: 'Claude Code review action', family: 'anthropic', basis: 'Anthropic product' },
  'greptile-apps[bot]': { tool: 'Greptile', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'cursor[bot]': { tool: 'Cursor Bugbot', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'cubic-dev-ai[bot]': { tool: 'cubic', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'devin-ai-integration[bot]': { tool: 'Devin review', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'sourcery-ai[bot]': { tool: 'Sourcery', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'qodo-code-review[bot]': { tool: 'Qodo', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'qodo-merge-pro[bot]': { tool: 'Qodo', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'macroscopeapp[bot]': { tool: 'Macroscope', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'ellipsis-dev[bot]': { tool: 'Ellipsis', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'graphite-app[bot]': { tool: 'Graphite Diamond', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'codeant-ai[bot]': { tool: 'CodeAnt', family: 'mixed', basis: 'vendor does not commit to one lab' },
  'kilo-code-bot[bot]': { tool: 'Kilo Code review', family: 'mixed', basis: 'vendor does not commit to one lab' },
};
/** Bots that are not model reviewers (CI, scanners, dependency tools); their comments are neither S1 nor S2. */
export const isBotLogin = (login: string, type: string) => type === 'Bot' || login.endsWith('[bot]') || login === 'Copilot';
export const GSTACK_FAMILY = /gstack|capy-ai|capy\[bot\]/i;

// ---------------------------------------------------------------------------------------------------------------- work

export interface Cursor { [stage: string]: string[] }
export function readCursor(work: string): Cursor {
  const f = join(work, 'cursor.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
export function markDone(work: string, stage: string, key: string): void {
  const c = readCursor(work);
  c[stage] = [...new Set([...(c[stage] ?? []), key])].sort();
  atomicWrite(join(work, 'cursor.json'), JSON.stringify(c, null, 1) + '\n');
}
export function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
const slug = (repo: string) => repo.replace('/', '__');
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
export const readJsonl = <T>(f: string): T[] => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);

// ------------------------------------------------------------------------------------------------------------- archive

export interface ArchiveComment {
  t: 'rc'; repo: string; pr: number; id: number; review: number | null; reply_to: number | null; user: string; user_type: string;
  path: string; commit: string; original_commit: string; created_at: string; url: string; subject: string | null; diff_hunk: string; body: string;
}
export interface ArchiveReview { t: 'rv'; repo: string; pr: number; id: number; user: string; user_type: string; state: string; commit: string; at: string }

/** The trimmed record GH Archive's event becomes, or null for events mining does not use. */
export function trimEvent(e: any): ArchiveComment | ArchiveReview | null {
  const repo = String(e?.repo?.name ?? '');
  if (!repo.includes('/') || EXCLUDED_OWNERS.includes(repo.split('/')[0]!.toLowerCase())) return null;
  const pr = Number(e?.payload?.pull_request?.number ?? NaN);
  if (!Number.isSafeInteger(pr)) return null;
  if (e.type === 'PullRequestReviewCommentEvent' && e.payload?.action === 'created') {
    const c = e.payload.comment ?? {};
    if (typeof c.path !== 'string' || typeof c.original_commit_id !== 'string' || typeof c.diff_hunk !== 'string') return null;
    return {
      t: 'rc', repo, pr, id: Number(c.id), review: c.pull_request_review_id ?? null, reply_to: c.in_reply_to_id ?? null,
      user: String(c.user?.login ?? ''), user_type: String(c.user?.type ?? ''), path: c.path, commit: String(c.commit_id ?? ''),
      original_commit: c.original_commit_id, created_at: String(c.created_at ?? e.created_at ?? ''), url: String(c.html_url ?? ''),
      subject: c.subject_type ?? null, diff_hunk: c.diff_hunk.slice(-4000), body: String(c.body ?? '').slice(0, 4000),
    };
  }
  if (e.type === 'PullRequestReviewEvent') {
    const r = e.payload?.review ?? {};
    const state = String(r.state ?? '').toLowerCase();
    if (state !== 'changes_requested') return null;
    return { t: 'rv', repo, pr, id: Number(r.id), user: String(r.user?.login ?? ''), user_type: String(r.user?.type ?? ''), state, commit: String(r.commit_id ?? ''), at: String(r.submitted_at ?? e.created_at ?? '') };
  }
  return null;
}

export function hoursBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T23:00:00Z'); t += 3_600_000) {
    const d = new Date(t);
    out.push(d.toISOString().slice(0, 10) + '-' + d.getUTCHours());
  }
  return out;
}

async function archiveHour(work: string, hour: string): Promise<{ hour: string; kept: number; ok: boolean }> {
  const out = join(work, 'archive', hour + '.jsonl.gz');
  if (existsSync(out)) return { hour, kept: -1, ok: true };
  const url = 'https://data.gharchive.org/' + hour + '.json.gz';
  for (let attempt = 0; attempt < 4; attempt++) {
    const child = spawn('bash', ['-c', 'set -o pipefail; curl -sfL --retry 4 --retry-delay 5 "$1" | gzip -dc', 'archive', url], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] });
    const kept: string[] = [];
    let buf = '';
    const dec = new TextDecoder();
    const take = (line: string) => {
      if (!line.includes('PullRequestReview')) return;
      try {
        const rec = trimEvent(JSON.parse(line));
        if (rec) kept.push(JSON.stringify(rec));
      } catch { /* a line cut by the archive itself */ }
    };
    for await (const chunk of child.stdout!) {
      buf += dec.decode(chunk as Buffer, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    if (buf) take(buf);
    const code: number = await new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : child.on('exit', (c) => r(c ?? 1))));
    if (code === 0) {
      atomicWrite(out, gzipSync(kept.join('\n') + (kept.length ? '\n' : '')));
      return { hour, kept: kept.length, ok: true };
    }
    await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
  }
  return { hour, kept: 0, ok: false };
}

/** Each archived record pick maps to a value; the archive is read one hour at a time, so only picked values stay in memory. */
export function readArchive<T>(work: string, pick: (r: ArchiveComment | ArchiveReview) => T | null): T[] {
  const dir = join(work, 'archive');
  const out: T[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl.gz')).sort()) {
    for (const l of gunzipSync(readFileSync(join(dir, f))).toString('utf8').split('\n')) {
      if (!l) continue;
      const v = pick(JSON.parse(l) as ArchiveComment | ArchiveReview);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

async function stageArchive(work: string, from: string, to: string, jobs: number): Promise<void> {
  mkdirSync(join(work, 'archive'), { recursive: true });
  const hours = hoursBetween(from, to);
  let next = 0, done = 0, failed = 0, kept = 0;
  const worker = async () => {
    while (next < hours.length) {
      const h = hours[next++]!;
      const r = await archiveHour(work, h);
      done += 1;
      if (!r.ok) failed += 1;
      if (r.kept > 0) kept += r.kept;
      if (done % 50 === 0 || !r.ok) process.stderr.write('archive: ' + done + '/' + hours.length + ' hours, ' + kept + ' records kept this run, ' + failed + ' failed' + (r.ok ? '' : ' (' + h + ')') + '\n');
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  process.stderr.write('archive: done, ' + hours.length + ' hours, ' + failed + ' failed\n');
  if (failed) process.exitCode = 1;
}

// --------------------------------------------------------------------------------------------------------------- repos

export interface RepoInfo {
  repo: string; language: string; license: string; stars: number; default_branch: string; pushed_at: string;
  comments: { human: number; tool: number; prs: number };
}

export function tally(records: ReadonlyArray<ArchiveComment | ArchiveReview>): Map<string, RepoInfo['comments']> {
  const m = new Map<string, { human: number; tool: number; prs: Set<number> }>();
  for (const r of records) {
    if (r.t !== 'rc' || r.reply_to !== null) continue;
    const e = m.get(r.repo) ?? { human: 0, tool: 0, prs: new Set<number>() };
    if (REVIEW_TOOLS[r.user]) e.tool += 1;
    else if (!isBotLogin(r.user, r.user_type)) e.human += 1;
    else continue;
    e.prs.add(r.pr);
    m.set(r.repo, e);
  }
  return new Map([...m].map(([k, v]) => [k, { human: v.human, tool: v.tool, prs: v.prs.size }]));
}

/** Whether a search repository item passes the repository filters. */
export function repoPasses(item: any, nowMs: number): string | null {
  if (item.fork) return 'fork';
  if (item.archived) return 'archived';
  if (!LANGUAGES.includes(item.language)) return 'language ' + item.language;
  if (!OSI.includes(item.license?.spdx_id)) return 'licence ' + (item.license?.spdx_id ?? 'none');
  if ((item.stargazers_count ?? 0) < 1000) return 'fewer than 1,000 stars';
  if (!(Date.parse(item.created_at) <= Date.parse('2025-06-30T23:59:59Z'))) return 'created after 2025-06-30, so less than a year of history before the window';
  if ((item.size ?? 0) > 1_500_000) return 'repository over 1.5 GB';
  if (nowMs - Date.parse(item.pushed_at) > 30 * 86_400_000) return 'no push in 30 days';
  return null;
}

async function stageRepos(work: string, gh: Gh, want: number): Promise<void> {
  const counts = tally(readArchive(work, (r) => (r.t === 'rc' && r.reply_to === null && (!!REVIEW_TOOLS[r.user] || !isBotLogin(r.user, r.user_type)) ? { ...r, body: '', diff_hunk: '' } : null)));
  const ranked = [...counts].filter(([, c]) => c.prs >= 12).sort((a, b) => (2 * b[1].human + b[1].tool) - (2 * a[1].human + a[1].tool));
  const kept: RepoInfo[] = [];
  const dropped: Array<{ repo: string; why: string }> = [];
  const byLang = new Map<string, number>();
  for (let i = 0; i < ranked.length && kept.length < want; i += 8) {
    const batch = ranked.slice(i, i + 8);
    const res = (await gh.get('search/repositories?per_page=100&q=' + encodeURIComponent(batch.map(([r]) => 'repo:' + r).join(' ')))) as any;
    const items = new Map<string, any>((res?.items ?? []).map((it: any) => [String(it.full_name).toLowerCase(), it]));
    for (const [repo, c] of batch) {
      const it = items.get(repo.toLowerCase());
      const why = it ? repoPasses(it, Date.now()) : 'not found by search';
      if (why) { dropped.push({ repo, why }); continue; }
      if ((byLang.get(it.language) ?? 0) >= Math.ceil(want * 0.4)) { dropped.push({ repo, why: 'language quota' }); continue; }
      if (kept.length >= want) break;
      byLang.set(it.language, (byLang.get(it.language) ?? 0) + 1);
      kept.push({ repo: it.full_name, language: it.language, license: it.license.spdx_id, stars: it.stargazers_count, default_branch: it.default_branch, pushed_at: it.pushed_at, comments: c });
    }
  }
  atomicWrite(join(work, 'repos.json'), JSON.stringify({ kept, dropped }, null, 1) + '\n');
  process.stderr.write('repos: kept ' + kept.length + ', dropped ' + dropped.length + ' (' + [...byLang].map(([l, n]) => l + ' ' + n).join(', ') + ')\n');
}

/** Repositories that passed the clone checks and whose PRs are fetched; stages after prs run on these, so they can run while prs is still going. */
export const keptRepos = (work: string): RepoInfo[] => {
  const all = readJson<{ kept: RepoInfo[] }>(join(work, 'repos.json')).kept;
  const f = join(work, 'clone-checks.json');
  if (!existsSync(f)) return [];
  const checks = readJson<Record<string, { ok: boolean }>>(f);
  return all.filter((r) => checks[r.repo]?.ok && existsSync(join(work, 'prs', slug(r.repo) + '.json')));
};

// ----------------------------------------------------------------------------------------------------------------- prs

export interface PrMeta { number: number; title: string; body: string; author: string; merged_at: string; created_at: string; url: string }

function monthRanges(from: string, to: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let t = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (t <= end) {
    const next = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
    const last = new Date(Math.min(next.getTime() - 86_400_000, end.getTime()));
    out.push([t.toISOString().slice(0, 10), last.toISOString().slice(0, 10)]);
    t = next;
  }
  return out;
}

async function searchAll(gh: Gh, q: string): Promise<any[]> {
  const items: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = (await gh.get('search/issues?per_page=100&page=' + page + '&q=' + encodeURIComponent(q))) as any;
    const got = res?.items ?? [];
    items.push(...got);
    if (got.length < 100) break;
  }
  return items;
}

/** Words a fix PR uses when it names the PR that introduced its bug; the search for PR bodies asks only for these. */
export const INTRO_WORDS = 'introduced OR regression OR regressed OR broke OR "caused by"';

async function mergedPrs(gh: Gh, repo: string, from: string, to: string, words: string): Promise<any[]> {
  const q = 'repo:' + repo + ' is:pr is:merged merged:' + from + '..' + to + ' ' + words;
  const first = (await gh.get('search/issues?per_page=100&page=1&q=' + encodeURIComponent(q))) as any;
  if ((first?.total_count ?? 0) <= 1000 || from === to) return searchAll(gh, q);
  const mid = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10);
  const after = new Date(Date.parse(mid) + 86_400_000).toISOString().slice(0, 10);
  return [...(await mergedPrs(gh, repo, from, mid, words)), ...(await mergedPrs(gh, repo, after, to, words))];
}

/** Merged PRs from the default branch's history: number, title and merge time from each merge or squash commit. */
export function gitPrs(dir: string, repo: string): PrMeta[] {
  return [...mainCommits(dir)].filter(([, m]) => Date.parse(m.date) >= Date.parse(WINDOW_START + 'T00:00:00Z')).map(([n, m]) => ({
    number: n, title: m.subject.replace(/\s*\(#\d+\)\s*$/, '').replace(/^Merge pull request #\d+ from \S+\s*/, ''), body: '', author: '',
    merged_at: new Date(m.date).toISOString().replace('.000Z', 'Z'), created_at: '', url: 'https://github.com/' + repo + '/pull/' + n,
  }));
}

/** PR authors by number, from GraphQL in batches of 100 PRs per query; a deleted account comes back as ''. */
export async function prAuthors(gh: Gh, repo: string, prs: readonly number[]): Promise<Map<number, string>> {
  const [owner, name] = repo.split('/');
  const out = new Map<number, string>();
  for (let i = 0; i < prs.length; i += 100) {
    const batch = prs.slice(i, i + 100);
    const q = 'query { repository(owner: ' + JSON.stringify(owner) + ', name: ' + JSON.stringify(name) + ') { ' + batch.map((n) => 'p' + n + ': pullRequest(number: ' + n + ') { author { login } }').join(' ') + ' } }';
    const res = (await gh.graphql(q)) as any;
    for (const n of batch) out.set(n, String(res?.data?.repository?.['p' + n]?.author?.login ?? ''));
  }
  return out;
}

const toMeta = (it: any): PrMeta => ({ number: it.number, title: String(it.title ?? ''), body: String(it.body ?? ''), author: String(it.user?.login ?? ''), merged_at: String(it.pull_request?.merged_at ?? ''), created_at: String(it.created_at ?? ''), url: String(it.html_url ?? '') });

async function stagePrs(work: string, gh: Gh, to: string): Promise<void> {
  mkdirSync(join(work, 'prs'), { recursive: true });
  for (const r of readJson<{ kept: RepoInfo[] }>(join(work, 'repos.json')).kept) {
    if (readCursor(work).prs?.includes(r.repo)) continue;
    const byNum = new Map(gitPrs(cloneDir(work, r.repo), r.repo).map((p) => [p.number, p]));
    for (const [a, b] of monthRanges(WINDOW_START, to)) for (const p of (await mergedPrs(gh, r.repo, a, b, INTRO_WORDS)).map(toMeta)) byNum.set(p.number, p);
    const prs = [...byNum.values()];
    const issues = (await searchAll(gh, 'repo:' + r.repo + ' is:issue created:>=' + WINDOW_START + ' regression OR introduced OR broke OR "caused by"')).map(toMeta);
    atomicWrite(join(work, 'prs', slug(r.repo) + '.json'), JSON.stringify({ source: 'git history plus bodies from search for PRs that use the introducing words', prs, issues }) + '\n');
    markDone(work, 'prs', r.repo);
    process.stderr.write('prs: ' + r.repo + ' ' + prs.length + ' merged PRs, ' + issues.length + ' issues (' + gh.requests + ' requests)\n');
  }
}

export const readPrs = (work: string, repo: string): { prs: PrMeta[]; issues: PrMeta[] } => readJson(join(work, 'prs', slug(repo) + '.json'));

// --------------------------------------------------------------------------------------------------------------- clone

export const cloneDir = (work: string, repo: string) => join(work, 'clones', slug(repo));
const AGENT_FILE = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|copilot-instructions\.md)$|(^|\/)\.cursor\/rules\/|(^|\/)\.claude\//;

/** Why a repository's tree at ref fails the clone checks, or null when it passes. */
export function treeProblem(dir: string, ref: string): string | null {
  const ls = git(dir, ['ls-tree', '-r', '--name-only', ref]);
  if (ls.code !== 0) return 'git ls-tree failed';
  const paths = ls.out.split('\n').filter(Boolean);
  if (paths.some((p) => p === '.gstack' || p.startsWith('.gstack/'))) return 'has a .gstack directory';
  for (const p of paths.filter((x) => AGENT_FILE.test(x))) {
    const blob = git(dir, ['cat-file', '-p', ref + ':' + p]);
    if (/gstack/i.test(blob.out)) return 'names gstack in ' + p;
  }
  const tests = paths.filter((p) => TEST_PATH.test(p)).length;
  if (tests < 20) return 'only ' + tests + ' test files';
  return null;
}

async function stageClone(work: string): Promise<void> {
  const checksFile = join(work, 'clone-checks.json');
  const checks: Record<string, { ok: boolean; why: string | null }> = existsSync(checksFile) ? readJson(checksFile) : {};
  mkdirSync(join(work, 'clones'), { recursive: true });
  for (const r of readJson<{ kept: RepoInfo[] }>(join(work, 'repos.json')).kept) {
    if (checks[r.repo]) continue;
    const dir = cloneDir(work, r.repo);
    if (!existsSync(join(dir, '.git')) && !existsSync(join(dir, 'HEAD'))) {
      const c = await gitAsync(join(work, 'clones'), ['clone', '-q', '--filter=blob:none', '--no-checkout', 'https://github.com/' + r.repo + '.git', slug(r.repo)], 3_600_000);
      if (c.code !== 0) { checks[r.repo] = { ok: false, why: 'clone failed: ' + c.err.trim().split('\n').pop() }; atomicWrite(checksFile, JSON.stringify(checks, null, 1)); continue; }
    }
    const why = treeProblem(dir, 'origin/HEAD');
    checks[r.repo] = { ok: why === null, why };
    atomicWrite(checksFile, JSON.stringify(checks, null, 1) + '\n');
    process.stderr.write('clone: ' + r.repo + ' ' + (why ?? 'ok') + '\n');
  }
}

// ----------------------------------------------------------------------------------------------------------- git: PRs

export interface MainCommit { sha: string; parents: string[]; subject: string; date: string }

/** The default branch's first-parent commits since the window opened, by the PR number their subject names. */
export function mainCommits(dir: string): Map<number, MainCommit> {
  const r = git(dir, ['log', '--first-parent', 'origin/HEAD', '--since=2026-06-15', '--format=%H%x1f%P%x1f%cI%x1f%s']);
  const m = new Map<number, MainCommit>();
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [sha, parents, date, subject] = line.split('\x1f') as [string, string, string, string];
    const n = /\(#(\d+)\)\s*$/.exec(subject)?.[1] ?? /^Merge pull request #(\d+)\b/.exec(subject)?.[1] ?? /^(?:Auto|Rollup) merge of (?:[\w.-]+\/[\w.-]+)?#(\d+)\b/.exec(subject)?.[1];
    if (n && !m.has(Number(n))) m.set(Number(n), { sha, parents: parents.split(' ').filter(Boolean), subject, date });
  }
  return m;
}

/** Fetches refs/pull/<n>/head into refs/pr/<n> for each PR not fetched yet, in batches. */
export async function fetchPrHeads(dir: string, prs: readonly number[]): Promise<void> {
  const need = prs.filter((n) => git(dir, ['rev-parse', '--verify', '--quiet', 'refs/pr/' + n]).code !== 0);
  for (let i = 0; i < need.length; i += 40) {
    const specs = need.slice(i, i + 40).map((n) => '+refs/pull/' + n + '/head:refs/pr/' + n);
    const r = await gitAsync(dir, ['fetch', '-q', '--no-tags', 'origin', ...specs], 1_800_000);
    if (r.code !== 0) for (const s of specs) await gitAsync(dir, ['fetch', '-q', '--no-tags', 'origin', s]);
  }
}

export const resolveSha = (dir: string, ref: string): string | null => {
  const r = git(dir, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  return r.code === 0 ? r.out.trim() : null;
};

/** Makes sure a commit is present, fetching it by sha when it is not on any ref. */
export async function ensureCommit(dir: string, sha: string): Promise<boolean> {
  if (resolveSha(dir, sha)) return true;
  await gitAsync(dir, ['fetch', '-q', '--no-tags', 'origin', sha]);
  return resolveSha(dir, sha) !== null;
}

/** The base branch's commit the PR left from: the merge commit's first parent, else the merge-base with the default branch. */
export function baseBefore(dir: string, head: string, main: MainCommit | undefined): string | null {
  if (main?.parents[0]) return main.parents[0];
  const r = git(dir, ['merge-base', head, 'origin/HEAD']);
  return r.code === 0 ? r.out.trim() : null;
}

export function changedLines(dir: string, from: string, to: string): number | null {
  const r = git(dir, ['diff', '--shortstat', from, to]);
  if (r.code !== 0) return null;
  const ins = Number(/(\d+) insertion/.exec(r.out)?.[1] ?? 0);
  const del = Number(/(\d+) deletion/.exec(r.out)?.[1] ?? 0);
  return ins + del;
}

// --------------------------------------------------------------------------------------------------------------- pairs

export interface Bug {
  /** Where the screen will look first; the screen restates it at the unit head. */
  path: string; line: number | null;
  /** S1 and S2: the review comment (kept only in the work directory, never in the suite). S3: the fix PR's reference. */
  source: { kind: 'review-comment' | 'fix-pr'; url: string; comment_id?: number; reviewer?: 'human' | 'tool'; tool?: string; tool_family?: string; review_state?: string; text: string };
  fix: { commit: string; pr: number; kind: 'in-pr' | 'force-push' | 'later-pr'; tests: string[] };
}

export interface Candidate {
  id: string; stratum: 'S1' | 'S2' | 'S3' | 'N'; repo: string; pr: number; title: string; merged_at: string;
  head: string | null; base: string | null; diff_lines: number | null; reinject: boolean; bugs: Bug[];
  /** S3: the fix PR and how it points at this PR. */
  link?: { fix_pr: number; via: string };
  decoy_audit?: string;
}

const DEFECT = /\b(bug|crash|panic|wrong|incorrect|broken|breaks?|leak|race|deadlock|null|undefined|nil|overflow|off[- ]by[- ]one|fails?|failing|error|exception|security|inject|vulnerab|data loss|lose|lost|never|always|missing|forgot|regress|infinite|hang|unsafe|unsound|stale|mismatch|should be|won't work|doesn't work|will not|not work|potential issue|critical|high)\b/i;
const NIT = /^\s*(\*\*)?(nit|nitpick|typo|minor|style|optional|naming)\b|\bnit:|🧹|Nitpick|Refactor suggestion|!\[low\]|\bP3\b|\bP4\b/i;

/** Formatting that review agents use and people rarely do: severity tags, round ids, emoji markers, headings, tool names. */
export const AGENT_MARK = /\*\*\[?(critical|high|medium|low|major|minor|blocker|p[0-4])\]?\*\*|\[(p[0-4]|critical|high|medium|blocker)\]|\bR\d+-\d+\b|📍|🔴|🟠|🟡|🟢|⚠️|🤖|✅|❌|🛠|💡|generated (by|with)|claude code|\bcodex\b|^#{1,4} \S/im;

/**
 * Accounts of type User whose comments read as a review agent's: at least 5 top-level comments in the repository, 30% or
 * more with agent formatting. Their comments are neither S1 (not a person) nor S2 (no named tool, so neither its model
 * family nor that it is not gstack-family can be known), so mining drops them.
 */
export function agentAccounts(comments: readonly ArchiveComment[]): Set<string> {
  const n = new Map<string, [number, number]>();
  for (const c of comments) {
    if (REVIEW_TOOLS[c.user] || isBotLogin(c.user, c.user_type)) continue;
    const e = n.get(c.repo + ' ' + c.user) ?? [0, 0];
    e[0] += 1;
    if (AGENT_MARK.test(c.body)) e[1] += 1;
    n.set(c.repo + ' ' + c.user, e);
  }
  return new Set([...n].filter(([, [all, marked]]) => all >= 5 && marked / all >= 0.3).map(([k]) => k));
}

export function commentScore(c: ArchiveComment, changesRequested: boolean): number {
  let s = 0;
  if (changesRequested) s += 3;
  if (DEFECT.test(c.body)) s += 2;
  if (/!\[(critical|high)\]|Potential issue|\bP[01]\b|### Bug|logic:/i.test(c.body)) s += 3;
  if (NIT.test(c.body)) s -= 5;
  return s;
}

async function pairsForRepo(work: string, gh: Gh, repo: string, comments: ArchiveComment[], reviews: ArchiveReview[], perRepo: number): Promise<Candidate[]> {
  const dir = cloneDir(work, repo);
  const prs = new Map(readPrs(work, repo).prs.map((p) => [p.number, p]));
  const main = mainCommits(dir);
  const cr = new Set(reviews.filter((r) => r.repo === repo).map((r) => r.id));
  const mine = comments.filter((c) => c.repo === repo);
  const agents = agentAccounts(mine);
  const ranked = mine
    .filter((c) => c.reply_to === null && c.subject !== 'file' && prs.has(c.pr) && isCodePath(c.path))
    .filter((c) => !GSTACK_FAMILY.test(c.user) && !GSTACK_FAMILY.test(c.body))
    .filter((c) => REVIEW_TOOLS[c.user] || (!isBotLogin(c.user, c.user_type) && !agents.has(repo + ' ' + c.user) && !(AGENT_MARK.test(c.body) && c.body.length > 400)))
    .map((c) => ({ c, score: commentScore(c, c.review !== null && cr.has(c.review)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.id - b.c.id)
    .slice(0, 600);
  const unknown = [...new Set(ranked.map((x) => x.c.pr).filter((n) => !prs.get(n)!.author))];
  const authors = await prAuthors(gh, repo, unknown);
  const scored = ranked.filter((x) => x.c.user !== (prs.get(x.c.pr)!.author || authors.get(x.c.pr)));
  await fetchPrHeads(dir, [...new Set(scored.slice(0, 400).map((x) => x.c.pr))]);
  const out: Candidate[] = [];
  const quota = Math.ceil(perRepo / 2);
  const full = (s: 'S1' | 'S2') => out.filter((o) => o.stratum === s).length >= quota;
  for (const { c } of scored.slice(0, 400)) {
    if (full('S1') && full('S2')) break;
    if (full(REVIEW_TOOLS[c.user] ? 'S2' : 'S1')) continue;
    const pr = prs.get(c.pr)!;
    const final = resolveSha(dir, 'refs/pr/' + c.pr);
    const line = commentedLine(c.diff_hunk);
    if (!final || line === null) continue;
    const base = baseBefore(dir, final, main.get(c.pr));
    if (!base) continue;
    const touches = (from: string, to: string) => touchesOld(hunks(git(dir, ['diff', '-U0', '--no-ext-diff', from, to, '--', c.path]).out), line - 2, line + 2);
    const tool = REVIEW_TOOLS[c.user];
    const source: Bug['source'] = { kind: 'review-comment', url: c.url, comment_id: c.id, reviewer: tool ? 'tool' : 'human', ...(tool ? { tool: tool.tool, tool_family: tool.family } : {}), review_state: c.review !== null && cr.has(c.review) ? 'changes_requested' : 'unknown', text: c.body };
    let head: string | null = null, fix: string | null = null, kind: Bug['fix']['kind'] = 'in-pr', reinject = false;
    const seq = git(dir, ['rev-list', '--reverse', '--topo-order', final, '^' + base]).out.split('\n').filter(Boolean);
    const at = seq.indexOf(c.original_commit);
    if (at >= 0) {
      if (at === seq.length - 1 || !touches(c.original_commit, final)) continue;
      let lo = at + 1, hi = seq.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (touches(c.original_commit, seq[mid]!)) hi = mid; else lo = mid + 1; }
      head = seq[lo - 1]!; fix = seq[lo]!;
    } else if (await ensureCommit(dir, c.original_commit)) {
      if (!touches(c.original_commit, final)) continue;
      head = c.original_commit; fix = final; kind = 'force-push';
    } else {
      fix = final; kind = 'force-push'; reinject = true;
    }
    const mb = head ? git(dir, ['merge-base', head, base]).out.trim() || null : null;
    const lines = head && mb ? changedLines(dir, mb, head) : null;
    if (!reinject && (lines === null || lines < MIN_LINES || lines > MAX_LINES)) continue;
    const tests = head ? git(dir, ['diff', '--name-only', head, fix]).out.split('\n').filter((p) => p && TEST_PATH.test(p)) : [];
    const id = repo + '#' + c.pr + '@' + (head ?? 'gone').slice(0, 12) + ':' + c.id;
    out.push({ id, stratum: tool ? 'S2' : 'S1', repo, pr: c.pr, title: pr.title, merged_at: pr.merged_at, head, base: mb, diff_lines: lines, reinject, bugs: [{ path: c.path, line, source, fix: { commit: fix, pr: c.pr, kind, tests } }] });
  }
  return out;
}

async function stagePairs(work: string, gh: Gh, perRepo: number, jobs: number): Promise<void> {
  const wanted = new Set(keptRepos(work).map((r) => r.repo));
  const records = readArchive(work, (r) => (wanted.has(r.repo) && (r.t === 'rv' || r.reply_to === null) ? r : null));
  const comments = records.filter((r): r is ArchiveComment => r.t === 'rc');
  const reviews = records.filter((r): r is ArchiveReview => r.t === 'rv');
  mkdirSync(join(work, 'pairs'), { recursive: true });
  const repos = keptRepos(work).filter((r) => !readCursor(work).pairs?.includes(r.repo));
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < repos.length) {
      const r = repos[next++]!;
      const got = await pairsForRepo(work, gh, r.repo, comments, reviews, perRepo);
      atomicWrite(join(work, 'pairs', slug(r.repo) + '.jsonl'), got.map((c) => JSON.stringify(c)).join('\n') + (got.length ? '\n' : ''));
      markDone(work, 'pairs', r.repo);
      process.stderr.write('pairs: ' + r.repo + ' ' + got.length + ' (' + got.filter((c) => c.stratum === 'S1').length + ' S1, ' + got.filter((c) => c.stratum === 'S2').length + ' S2)\n');
    }
  }));
}

// ------------------------------------------------------------------------------------------------------------- escaped

/** Introducing-PR references in a fix's text: [pr number, the phrase kind]. */
export function introRefs(text: string, repo: string): Array<[number, string]> {
  const ref = '(?:#|https?://github\\.com/' + repo.replace(/[.]/g, '\\.') + '/pull/)(\\d+)';
  const pr = '(?:pr\\s*|pull request\\s*|in\\s+|by\\s+)?';
  const patterns: Array<[string, RegExp]> = [
    ['introduced', new RegExp('\\b(?:introduced|caused|regressed)\\s+(?:in|by|with|via)\\s+' + pr + ref, 'gi')],
    ['regression-from', new RegExp('\\bregression\\s+(?:from|in|since|of|caused by|introduced (?:in|by))\\s+' + pr + ref, 'gi')],
    ['broke-in', new RegExp('\\b(?:broke|broken|breakage)\\s+(?:in|by|since|with|from)\\s+' + pr + ref, 'gi')],
    ['bug-from', new RegExp('\\b(?:bug|issue|problem|crash|panic)\\s+(?:introduced|added|from)\\s+(?:in|by)?\\s*' + pr + ref, 'gi')],
    ['fixes-pr', new RegExp('\\bfix(?:es|ed)?\\s+(?:a\\s+|the\\s+)?(?:bug|regression|issue|problem)\\s+(?:in|from|introduced in|introduced by|caused by)\\s+' + pr + ref, 'gi')],
  ];
  const out: Array<[number, string]> = [];
  for (const [kind, re] of patterns) for (const m of text.matchAll(re)) out.push([Number(m[1]), kind]);
  return out;
}

export function linkedIssues(text: string, repo: string): number[] {
  const re = new RegExp('\\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\\s*:?\\s+(?:#|https?://github\\.com/' + repo.replace(/[.]/g, '\\.') + '/issues/)(\\d+)', 'gi');
  return [...text.matchAll(re)].map((m) => Number(m[1]));
}

async function escapedForRepo(work: string, repo: string, perRepo: number): Promise<Candidate[]> {
  const dir = cloneDir(work, repo);
  const { prs, issues } = readPrs(work, repo);
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const issueRefs = new Map(issues.map((i) => [i.number, introRefs(i.title + '\n' + i.body, repo)]));
  const main = mainCommits(dir);
  const links: Array<{ fix: PrMeta; intro: number; via: string }> = [];
  for (const fix of prs) {
    const text = fix.title + '\n' + fix.body + '\n' + (main.get(fix.number) ? git(dir, ['log', '-1', '--format=%B', main.get(fix.number)!.sha]).out : '');
    for (const [n, kind] of introRefs(text, repo)) links.push({ fix, intro: n, via: 'fix PR text: ' + kind });
    for (const i of linkedIssues(text, repo)) for (const [n, kind] of issueRefs.get(i) ?? []) links.push({ fix, intro: n, via: 'linked issue #' + i + ': ' + kind });
  }
  const seen = new Set<number>();
  const usable = links.filter((l) => l.intro !== l.fix.number && byNum.has(l.intro) && byNum.get(l.intro)!.merged_at < l.fix.merged_at && main.has(l.fix.number) && !seen.has(l.intro) && (seen.add(l.intro), true));
  await fetchPrHeads(dir, usable.map((l) => l.intro));
  const out: Candidate[] = [];
  for (const l of usable) {
    if (out.length >= perRepo) break;
    const intro = byNum.get(l.intro)!;
    const head = resolveSha(dir, 'refs/pr/' + l.intro);
    const fixMain = main.get(l.fix.number)!;
    if (!head || !fixMain.parents[0]) continue;
    const base = baseBefore(dir, head, main.get(l.intro));
    const mb = base ? git(dir, ['merge-base', head, base]).out.trim() : '';
    if (!mb) continue;
    const introFiles = new Set(git(dir, ['diff', '--name-only', mb, head]).out.split('\n').filter((p) => p && isCodePath(p)));
    const fixFiles = git(dir, ['diff', '--name-only', fixMain.parents[0], fixMain.sha]).out.split('\n').filter(Boolean);
    const overlap = fixFiles.filter((p) => introFiles.has(p));
    const tests = fixFiles.filter((p) => TEST_PATH.test(p));
    if (!overlap.length || (!tests.length && !l.via.startsWith('linked issue'))) continue;
    const firstHunk = hunks(git(dir, ['diff', '-U0', fixMain.parents[0], fixMain.sha, '--', overlap[0]!]).out)[0];
    out.push({
      id: repo + '#' + l.intro + '@' + head.slice(0, 12) + ':fix' + l.fix.number, stratum: 'S3', repo, pr: l.intro, title: intro.title, merged_at: intro.merged_at,
      head, base: mb, diff_lines: changedLines(dir, mb, head), reinject: false, link: { fix_pr: l.fix.number, via: l.via },
      bugs: [{ path: overlap[0]!, line: firstHunk ? firstHunk.oldStart : null, source: { kind: 'fix-pr', url: l.fix.url, text: l.fix.title + '\n\n' + l.fix.body.slice(0, 4000) }, fix: { commit: fixMain.sha, pr: l.fix.number, kind: 'later-pr', tests } }],
    });
  }
  return out;
}

async function stageEscaped(work: string, perRepo: number, jobs: number): Promise<void> {
  mkdirSync(join(work, 'escaped'), { recursive: true });
  const repos = keptRepos(work).filter((r) => !readCursor(work).escaped?.includes(r.repo));
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < repos.length) {
      const r = repos[next++]!;
      const got = await escapedForRepo(work, r.repo, perRepo);
      atomicWrite(join(work, 'escaped', slug(r.repo) + '.jsonl'), got.map((c) => JSON.stringify(c)).join('\n') + (got.length ? '\n' : ''));
      markDone(work, 'escaped', r.repo);
      process.stderr.write('escaped: ' + r.repo + ' ' + got.length + '\n');
    }
  }));
}

// -------------------------------------------------------------------------------------------------------------- decoys

/** The default branch's last commit at or before a time. */
const branchAt = (dir: string, iso: string) => git(dir, ['rev-list', '-1', '--first-parent', '--before=' + iso, 'origin/HEAD']).out.trim() || null;

async function decoysForRepo(work: string, repo: string, known: Set<number>, want: number): Promise<Candidate[]> {
  const dir = cloneDir(work, repo);
  const main = mainCommits(dir);
  const pool = readPrs(work, repo).prs.filter((p) => p.merged_at && p.merged_at <= '2026-08-14T23:59:59Z' && !known.has(p.number) && main.has(p.number) && !/\b(fix|revert|bump|deps?|release|chore)\b/i.test(p.title));
  pool.sort((a, b) => a.number - b.number);
  await fetchPrHeads(dir, pool.slice(0, 30).map((p) => p.number));
  const out: Candidate[] = [];
  for (const p of pool.slice(0, 30)) {
    if (out.length >= want) break;
    const m = main.get(p.number)!;
    const head = resolveSha(dir, 'refs/pr/' + p.number);
    if (!head || !m.parents[0]) continue;
    const mb = git(dir, ['merge-base', head, m.parents[0]]).out.trim();
    const lines = mb ? changedLines(dir, mb, head) : null;
    if (lines === null || lines < MIN_LINES || lines > MAX_LINES) continue;
    const t90 = branchAt(dir, new Date(Date.parse(p.merged_at) + 90 * 86_400_000).toISOString());
    if (!t90) continue;
    const files = git(dir, ['diff', '--name-only', m.parents[0], m.sha]).out.split('\n').filter((f) => f && isCodePath(f));
    if (!files.length) continue;
    const clean = files.every((f) => {
      const added = addedRanges(hunks(git(dir, ['diff', '-U0', m.parents[0]!, m.sha, '--', f]).out));
      const later = hunks(git(dir, ['diff', '-U0', m.sha, t90, '--', f]).out);
      return added.every(([a, b]) => !touchesOld(later, a, b));
    });
    if (!clean) continue;
    out.push({ id: repo + '#' + p.number + '@' + head.slice(0, 12) + ':decoy', stratum: 'N', repo, pr: p.number, title: p.title, merged_at: p.merged_at, head, base: mb, diff_lines: lines, reinject: false, bugs: [], decoy_audit: 'No commit on the default branch changed any code line the PR added, from its merge to ' + t90.slice(0, 12) + ' (90 days later); checked with git diff -U0 per file.' });
  }
  return out;
}

async function stageDecoys(work: string, want: number): Promise<void> {
  const known = new Map<string, Set<number>>();
  for (const sub of ['pairs', 'escaped']) for (const f of existsSync(join(work, sub)) ? readdirSync(join(work, sub)) : []) for (const c of readJsonl<Candidate>(join(work, sub, f))) {
    const s = known.get(c.repo) ?? new Set<number>();
    s.add(c.pr);
    if (c.link) s.add(c.link.fix_pr);
    known.set(c.repo, s);
  }
  const out: Candidate[] = [];
  for (const r of keptRepos(work)) {
    if (out.length >= want) break;
    out.push(...(await decoysForRepo(work, r.repo, known.get(r.repo) ?? new Set(), 2)));
    process.stderr.write('decoys: ' + r.repo + ', ' + out.length + ' so far\n');
  }
  atomicWrite(join(work, 'decoys.jsonl'), out.map((c) => JSON.stringify(c)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------------------------------------------- pool

/** Merges candidates that share a unit (repo, PR, head) into one, with every bug. */
export function mergeUnits(cands: readonly Candidate[]): Candidate[] {
  const m = new Map<string, Candidate>();
  for (const c of cands) {
    const key = c.repo + '#' + c.pr + '@' + (c.head ?? c.id);
    const e = m.get(key);
    if (!e) { m.set(key, { ...c, id: key, bugs: [...c.bugs] }); continue; }
    e.bugs.push(...c.bugs);
    if (c.stratum === 'S3' || (c.stratum === 'S1' && e.stratum === 'S2')) e.stratum = c.stratum;
  }
  return [...m.values()];
}

/** S3 first, then S1 (changes-requested reviews first), then S2, following the target mix of 40% S1, 20% S2, 40% S3. */
export const poolRank = (c: Candidate): number => (c.stratum === 'S3' ? 0 : c.stratum === 'S1' ? (c.bugs.some((b) => b.source.review_state === 'changes_requested') ? 1 : 2) : 3);

/** The screening pool: units whose diff is 20 to 1,000 changed lines, at most perRepo per repository, S3 first. */
export function buildPool(cands: readonly Candidate[], perRepo: number): Candidate[] {
  const units = mergeUnits(cands).filter((c) => c.reinject || (c.diff_lines !== null && c.diff_lines >= MIN_LINES && c.diff_lines <= MAX_LINES));
  const byRepo = new Map<string, Candidate[]>();
  for (const u of units) byRepo.set(u.repo, [...(byRepo.get(u.repo) ?? []), u]);
  const out: Candidate[] = [];
  for (const [, list] of [...byRepo].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(...list.sort((a, b) => poolRank(a) - poolRank(b) || a.pr - b.pr).slice(0, perRepo));
  return out;
}

function stagePool(work: string, perRepo: number): void {
  const all: Candidate[] = [];
  for (const sub of ['pairs', 'escaped']) for (const f of readdirSync(join(work, sub))) all.push(...readJsonl<Candidate>(join(work, sub, f)));
  const pool = buildPool(all, perRepo);
  atomicWrite(join(work, 'candidates.jsonl'), pool.map((c) => JSON.stringify(c)).join('\n') + '\n');
  const n = (s: string) => pool.filter((c) => c.stratum === s).length;
  process.stderr.write('pool: ' + pool.length + ' units (' + n('S1') + ' S1, ' + n('S2') + ' S2, ' + n('S3') + ' S3), ' + pool.reduce((a, c) => a + c.bugs.length, 0) + ' bugs, ' + pool.filter((c) => c.reinject).length + ' need reinjection, from ' + all.length + ' raw candidates\n');
}

// ----------------------------------------------------------------------------------------------------------------- cli

function flagsOf(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) m.set(argv[i]!, argv[i + 1] ?? '');
  return m;
}

if (import.meta.main) {
  const [stage, ...rest] = process.argv.slice(2);
  const f = flagsOf(rest);
  const work = resolve(f.get('--work') ?? join(process.env.HOME ?? '.', '.capy/work/review-bugs'));
  mkdirSync(work, { recursive: true });
  const gh = () => new Gh({ cacheDir: join(work, 'gh-cache') });
  const jobs = Number(f.get('--jobs') ?? 6);
  if (stage === 'archive') await stageArchive(work, f.get('--from') ?? WINDOW_START, f.get('--to') ?? '2026-11-13', jobs);
  else if (stage === 'repos') await stageRepos(work, gh(), Number(f.get('--want') ?? 70));
  else if (stage === 'prs') await stagePrs(work, gh(), f.get('--to') ?? '2026-11-13');
  else if (stage === 'clone') await stageClone(work);
  else if (stage === 'pairs') await stagePairs(work, gh(), Number(f.get('--per-repo') ?? 30), jobs);
  else if (stage === 'escaped') await stageEscaped(work, Number(f.get('--per-repo') ?? 20), jobs);
  else if (stage === 'decoys') await stageDecoys(work, Number(f.get('--want') ?? 40));
  else if (stage === 'pool') stagePool(work, Number(f.get('--per-repo') ?? 14));
  else { process.stderr.write('usage: see the header of scripts/review-bugs/mine.ts\n'); process.exit(2); }
}
