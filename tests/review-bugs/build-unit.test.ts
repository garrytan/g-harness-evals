import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnitRepo, canaryScript, firstBodies, fixMentions, leakCanary, scrubBody, STATE_EXCLUDE, UnitError } from '../../scripts/review-bugs/build-unit.ts';
import { Gh } from '../../scripts/review-bugs/github.ts';
import { GIT_ENV } from '../../scripts/review-bugs/git.ts';
import { makeRepo } from './fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'rb-unit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const fx = makeRepo(join(tmp, 'fx'));
const unit = { id: 'acme/web#7@' + fx.head.slice(0, 12), repo: 'acme/web', pr: 7, head: fx.head, base: fx.base };
const forbidden = { commits: [fx.fix], prs: [9] };
const g = (dir: string, ...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: GIT_ENV });

describe('unit repositories', () => {
  const repo = buildUnitRepo({ unit, source: fx.dir, dest: join(tmp, 'u1'), baseBranch: 'main' });

  test('hold the head and its ancestry only, on the rig contract refs', () => {
    expect(repo.merge_base).toBe(fx.base);
    expect(g(repo.dir, 'rev-parse', 'HEAD').stdout.trim()).toBe(fx.head);
    expect(g(repo.dir, 'symbolic-ref', 'HEAD').stdout.trim()).toBe('refs/heads/pr-7');
    expect(g(repo.dir, 'rev-parse', 'origin/main').stdout.trim()).toBe(fx.base);
    expect(g(repo.dir, 'symbolic-ref', 'refs/remotes/origin/HEAD').stdout.trim()).toBe('refs/remotes/origin/main');
    expect(g(repo.dir, 'cat-file', '-e', fx.fix + '^{commit}').status).not.toBe(0);
    expect(g(repo.dir, 'cat-file', '-e', fx.later + '^{commit}').status).not.toBe(0);
    expect(g(repo.dir, 'tag', '-l').stdout.trim()).toBe('');
    expect(g(repo.dir, 'remote').stdout.trim()).toBe('');
    expect(existsSync(join(repo.dir, '.git', 'logs'))).toBe(false);
    expect(require('node:fs').readFileSync(join(repo.dir, '.git', 'info', 'exclude'), 'utf8')).toContain(STATE_EXCLUDE);
  });

  test('pass the leak canary', () => {
    expect(leakCanary(repo.dir, repo, forbidden, '# Add last()\n\nAdds a helper.\n')).toEqual([]);
  });

  test('the canary catches a fetched fix, a tag and a body that names the fix', () => {
    const r2 = buildUnitRepo({ unit, source: fx.dir, dest: join(tmp, 'u2'), baseBranch: 'main' });
    g(r2.dir, '-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', fx.dir, fx.fix);
    g(r2.dir, 'tag', 'leak', fx.head);
    const p = leakCanary(r2.dir, r2, forbidden, 'See #9 for the follow-up.');
    expect(p.some((x) => x.includes('tags present'))).toBe(true);
    expect(p.some((x) => x.includes('fix commit ' + fx.fix.slice(0, 12) + ' is present'))).toBe(true);
    expect(p.some((x) => x.includes('pr.md mentions the fix: #9'))).toBe(true);
  });

  test('refuse a shallow source and an existing destination', () => {
    expect(() => buildUnitRepo({ unit, source: fx.dir, dest: join(tmp, 'u1'), baseBranch: 'main' })).toThrow(UnitError);
    const shallow = join(tmp, 'shallow');
    spawnSync('git', ['clone', '-q', '--depth', '1', 'file://' + fx.dir, shallow], { env: GIT_ENV });
    expect(() => buildUnitRepo({ unit, source: shallow, dest: join(tmp, 'u3'), baseBranch: 'main' })).toThrow(/shallow/);
  });
});

describe('PR bodies', () => {
  test('scrubbing drops every line that names the fix PR or commit', () => {
    const body = 'Adds last().\nFollow-up in #9.\nSee https://github.com/acme/web/pull/9\nCommit ' + fx.fix.slice(0, 8) + ' fixes it.\nKeeps #90 and #8.';
    const s = scrubBody(body, forbidden);
    expect(s.removed).toBe(3);
    expect(s.text).toBe('Adds last().\nKeeps #90 and #8.');
    expect(fixMentions(s.text, forbidden)).toEqual([]);
  });

  test('the first revision comes from the oldest edit, an unedited body is its own first revision', async () => {
    const seen: string[] = [];
    const gh = new Gh({ cacheDir: join(tmp, 'gh'), sleep: async () => {}, transport: ({ body }) => {
      seen.push(body!);
      return { status: 200, headers: {}, json: { data: {
        p0: { pullRequest: { title: 'Add last()', body: 'now', userContentEdits: { totalCount: 2, nodes: [{ editedAt: '2026-08-02T00:00:00Z', diff: 'second' }, { editedAt: '2026-08-01T00:00:00Z', diff: 'first' }] } } },
        p1: { pullRequest: { title: 'Other', body: 'plain', userContentEdits: { totalCount: 0, nodes: [] } } },
        p2: { pullRequest: null },
      } } };
    } });
    const m = await firstBodies(gh, [{ repo: 'acme/web', pr: 7 }, { repo: 'acme/web', pr: 8 }, { repo: 'acme/web', pr: 99 }]);
    expect(seen.length).toBe(1);
    expect(m.get('acme/web#7')).toEqual({ title: 'Add last()', body: 'first', source: 'first-revision', edits: 2 });
    expect(m.get('acme/web#8')!.source).toBe('unedited');
    expect(m.get('acme/web#99')!.source).toBe('unavailable');
  });

  test('the network canary fails closed and prints one comparable line', () => {
    const s = canaryScript('acme/web');
    expect(s).toContain('git ls-remote https://github.com/acme/web.git');
    expect(s).toContain('echo "leak-canary git=$r1 gh=$r2 https=$r3"');
    expect(s).toContain('*open*) exit 1');
  });
});
