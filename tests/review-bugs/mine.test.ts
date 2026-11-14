import { describe, expect, test } from 'bun:test';
import { addedRanges, commentedLine, hunks, isCodePath, touchesOld } from '../../scripts/review-bugs/git.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gh } from '../../scripts/review-bugs/github.ts';
import { agentAccounts, buildPool, introRefs, linkedIssues, mergeUnits, prAuthors, repoPasses, trimEvent, type ArchiveComment, type Candidate } from '../../scripts/review-bugs/mine.ts';

describe('diff helpers', () => {
  test('the commented line is the new-side number of the hunk\'s last line', () => {
    expect(commentedLine('@@ -10,3 +10,4 @@\n a\n+b\n c\n+d')).toBe(13);
    expect(commentedLine('@@ -10,3 +12,2 @@ fn x()\n a\n-b\n\\ No newline at end of file\n c')).toBe(13);
    expect(commentedLine('@@ -10,2 +10,1 @@\n a\n-b')).toBeNull();
    expect(commentedLine('not a hunk')).toBeNull();
  });

  test('hunks, old-side touches and added ranges from a -U0 diff', () => {
    const hs = hunks('diff --git a/x b/x\n@@ -5,2 +5,3 @@\n-a\n-b\n+a\n+b\n+c\n@@ -20 +21,0 @@\n-z\n@@ -30,0 +31,2 @@\n+n\n+m');
    expect(hs).toEqual([{ oldStart: 5, oldCount: 2, newStart: 5, newCount: 3 }, { oldStart: 20, oldCount: 1, newStart: 21, newCount: 0 }, { oldStart: 30, oldCount: 0, newStart: 31, newCount: 2 }]);
    expect(touchesOld(hs, 6, 6)).toBe(true);
    expect(touchesOld(hs, 7, 19)).toBe(false);
    expect(touchesOld(hs, 31, 31)).toBe(true);
    expect(touchesOld(hs, 32, 40)).toBe(false);
    expect(addedRanges(hs)).toEqual([[5, 7], [31, 32]]);
  });

  test('code paths exclude tests, docs and lock files', () => {
    expect(isCodePath('src/server/api.ts')).toBe(true);
    expect(isCodePath('pkg/x/x_test.go')).toBe(false);
    expect(isCodePath('tests/test_api.py')).toBe(false);
    expect(isCodePath('web/a.spec.tsx')).toBe(false);
    expect(isCodePath('docs/guide.md')).toBe(false);
    expect(isCodePath('Cargo.lock')).toBe(false);
  });
});

describe('GH Archive records', () => {
  const comment = (repo: string) => ({ type: 'PullRequestReviewCommentEvent', created_at: '2026-08-01T00:00:00Z', repo: { name: repo }, payload: { action: 'created', pull_request: { number: 12 }, comment: {
    id: 5, pull_request_review_id: 6, in_reply_to_id: null, user: { login: 'dev', type: 'User' }, path: 'src/a.ts', commit_id: 'c1', original_commit_id: 'c0',
    created_at: '2026-08-01T00:00:01Z', html_url: 'u', diff_hunk: '@@ -1 +1 @@\n+x', body: 'b'.repeat(5000) } } });

  test('keeps a created review comment, trimmed', () => {
    const r = trimEvent(comment('acme/web')) as ArchiveComment;
    expect(r.t).toBe('rc');
    expect([r.repo, r.pr, r.user, r.user_type, r.path, r.commit, r.original_commit, r.review, r.reply_to]).toEqual(['acme/web', 12, 'dev', 'User', 'src/a.ts', 'c1', 'c0', 6, null]);
    expect(r.body.length).toBe(4000);
  });

  test('drops excluded owners, other actions and non-blocking reviews', () => {
    expect(trimEvent(comment('garrytan/x'))).toBeNull();
    expect(trimEvent({ ...comment('acme/web'), payload: { ...comment('acme/web').payload, action: 'deleted' } })).toBeNull();
    const review = (state: string) => ({ type: 'PullRequestReviewEvent', repo: { name: 'acme/web' }, payload: { pull_request: { number: 3 }, review: { id: 1, state, user: { login: 'r', type: 'User' }, commit_id: 'h', submitted_at: 't' } } });
    expect(trimEvent(review('approved'))).toBeNull();
    expect(trimEvent(review('CHANGES_REQUESTED'))).toEqual({ t: 'rv', repo: 'acme/web', pr: 3, id: 1, user: 'r', user_type: 'User', state: 'changes_requested', commit: 'h', at: 't' });
    expect(trimEvent({ type: 'PushEvent', repo: { name: 'acme/web' }, payload: {} })).toBeNull();
  });
});

describe('repository filters', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  const good = { fork: false, archived: false, language: 'Go', license: { spdx_id: 'MIT' }, stargazers_count: 5000, created_at: '2020-01-01T00:00:00Z', size: 100_000, pushed_at: '2026-11-10T00:00:00Z' };
  test('pass a good repository and name the first failing rule', () => {
    expect(repoPasses(good, now)).toBeNull();
    expect(repoPasses({ ...good, fork: true }, now)).toBe('fork');
    expect(repoPasses({ ...good, language: 'Java' }, now)).toBe('language Java');
    expect(repoPasses({ ...good, license: { spdx_id: 'NOASSERTION' } }, now)).toBe('licence NOASSERTION');
    expect(repoPasses({ ...good, stargazers_count: 999 }, now)).toBe('fewer than 1,000 stars');
    expect(repoPasses({ ...good, created_at: '2025-07-01T00:00:00Z' }, now)).toContain('created after 2025-06-30');
    expect(repoPasses({ ...good, size: 1_600_000 }, now)).toBe('repository over 1.5 GB');
    expect(repoPasses({ ...good, pushed_at: '2026-10-01T00:00:00Z' }, now)).toBe('no push in 30 days');
  });
});

describe('agent-like accounts', () => {
  const c = (user: string, body: string, repo = 'acme/web'): ArchiveComment => ({ t: 'rc', repo, pr: 1, id: 1, review: null, reply_to: null, user, user_type: 'User', path: 'a', commit: 'c', original_commit: 'c', created_at: '', url: '', subject: null, diff_hunk: '', body });
  test('flag a User with at least 5 comments, 30% or more in agent formatting, per repository', () => {
    const list = [
      ...Array.from({ length: 4 }, () => c('person', 'This drops the last item.')), c('person', '**[P1]** off by one'),
      ...Array.from({ length: 3 }, () => c('agentish', 'Looks wrong')), c('agentish', '🔴 **Critical** leak'), c('agentish', '### Bug\nnull deref'),
      ...Array.from({ length: 4 }, () => c('few', '🤖 Generated by a tool')),
      c('agentish', '🔴 x', 'acme/api'),
      ...Array.from({ length: 6 }, () => c('coderabbitai[bot]', '🔴 x')),
    ];
    expect([...agentAccounts(list)]).toEqual(['acme/web agentish']);
  });
});

describe('escaped-bug links', () => {
  test('find introducing-PR phrases and linked issues', () => {
    const text = 'Fixes #44.\nThis was introduced in #120 and the regression from PR #118 broke uploads. Broken since https://github.com/acme/web/pull/99. See #7.';
    expect(introRefs(text, 'acme/web')).toEqual([[120, 'introduced'], [118, 'regression-from'], [99, 'broke-in']]);
    expect(introRefs('fixes a bug introduced by #5', 'acme/web')).toEqual([[5, 'introduced'], [5, 'bug-from'], [5, 'fixes-pr']]);
    expect(introRefs('introduced in https://github.com/other/repo/pull/3', 'acme/web')).toEqual([]);
    expect(linkedIssues(text + '\ncloses https://github.com/acme/web/issues/45 resolved: #46', 'acme/web')).toEqual([44, 45, 46]);
  });
});

describe('the screening pool', () => {
  const bug = (state?: string) => ({ path: 'a.ts', line: 1, source: { kind: 'review-comment' as const, url: '', text: '', ...(state ? { review_state: state } : {}) }, fix: { commit: 'f', pr: 1, kind: 'in-pr' as const, tests: [] } });
  const cand = (repo: string, pr: number, stratum: Candidate['stratum'], diff: number | null, o: Partial<Candidate> = {}): Candidate => ({ id: repo + pr + stratum, stratum, repo, pr, title: '', merged_at: '', head: 'h' + pr, base: 'b', diff_lines: diff, reinject: false, bugs: [bug()], ...o });

  test('merges candidates that share a unit and keeps the strongest stratum', () => {
    const m = mergeUnits([cand('a/x', 1, 'S2', 50), cand('a/x', 1, 'S1', 50), cand('a/x', 1, 'S3', 50), cand('a/x', 2, 'S2', 50)]);
    expect(m.map((c) => [c.id, c.stratum, c.bugs.length])).toEqual([['a/x#1@h1', 'S3', 3], ['a/x#2@h2', 'S2', 1]]);
  });

  test('filters diff size, caps per repository and ranks S3, then S1 with changes requested, then S1, then S2', () => {
    const pool = buildPool([
      cand('b/y', 1, 'S2', 19), cand('b/y', 2, 'S2', 1001), cand('b/y', 3, 'S2', null), cand('b/y', 4, 'S2', null, { reinject: true }),
      cand('a/x', 10, 'S1', 20), cand('a/x', 11, 'S2', 500), cand('a/x', 12, 'S3', 1000), cand('a/x', 13, 'S1', 30, { bugs: [bug('changes_requested')] }),
    ], 3);
    expect(pool.map((c) => c.repo + '#' + c.pr)).toEqual(['a/x#12', 'a/x#13', 'a/x#10', 'b/y#4']);
  });
});

describe('PR authors', () => {
  test('come from one GraphQL query per 100 PRs, with a deleted account as an empty login', async () => {
    const bodies: string[] = [];
    const gh = new Gh({ cacheDir: mkdtempSync(join(tmpdir(), 'rb-auth-')), sleep: async () => {}, transport: ({ body }) => {
      bodies.push(body!);
      const q = JSON.parse(body!).query as string;
      const repository = Object.fromEntries([...q.matchAll(/p(\d+): pullRequest/g)].map((m) => [m[0].split(':')[0], Number(m[1]) === 7 ? { author: null } : { author: { login: 'u' + m[1] } }]));
      return { status: 200, headers: {}, json: { data: { repository } } };
    } });
    const m = await prAuthors(gh, 'acme/web', Array.from({ length: 150 }, (_, i) => i + 1));
    expect(bodies.length).toBe(2);
    expect(JSON.parse(bodies[0]!).query).toStartWith('query { repository(owner: "acme", name: "web") { p1: pullRequest(number: 1) { author { login } }');
    expect([m.get(1), m.get(7), m.get(150), m.size]).toEqual(['u1', '', 'u150', 150]);
  });
});

