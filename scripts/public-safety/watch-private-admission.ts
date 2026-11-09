#!/usr/bin/env bun
/**
 * The private-admission watcher. The private lane posts a `private-admission` commit status on each public pull request
 * head; when it is down, the status would stay pending (or never appear) and the pull request could not merge without
 * anyone being told why. Every 10 minutes the public workflow .github/workflows/private-admission-watch.yml runs this
 * script, which posts state `error` with a PS-PRIV-UNAVAILABLE description on every open pull request head that has no
 * final private-admission status (success, failure or error) and whose newest pending status, or failing that its head
 * push, is older than 30 minutes. A later run of the private lane replaces the error with its own verdict.
 *
 *   GITHUB_TOKEN=<token> bun scripts/public-safety/watch-private-admission.ts --repo <owner/name> [--dry-run]
 *
 * GitHub records no push time for a pull request head, so the head push time is the later of the head commit's
 * committer date and the pull request's creation. Exit 0 when every head was checked, 2 on a usage error, 3 when a
 * GitHub call failed. The token is read from the environment and never printed.
 */

export const CONTEXT = 'private-admission';
export const STALE_MS = 30 * 60_000;
export const MAX_DESCRIPTION = 140;

export type State = 'pending' | 'success' | 'failure' | 'error';
export interface OpenPull { number: number; head: string; createdAt: string }
export interface Status { context: string; state: State; createdAt: string }
export interface GitHub {
  openPulls(): Promise<OpenPull[]>;
  statuses(sha: string): Promise<Status[]>;
  committedAt(sha: string): Promise<string>;
  postStatus(sha: string, status: { state: 'error'; context: string; description: string }): Promise<void>;
}
export interface Verdict { number: number; head: string; action: 'posted' | 'final' | 'waiting'; since?: string }

/** The error description, at most 140 characters: the head sha is shortened (never below 7 characters) before anything is cut. */
export function description(pr: number, sha: string): string {
  const text = (s: string) => 'PS-PRIV-UNAVAILABLE: private lane unavailable; internal-task re-runs: bun private/admission/lane.ts --pr ' + pr + ' --head ' + s;
  const room = MAX_DESCRIPTION - text('').length;
  return text(sha.slice(0, Math.max(room, 7))).slice(0, MAX_DESCRIPTION);
}

/** One open pull request: post the error, or say why not. */
export async function check(gh: GitHub, pull: OpenPull, now: number, dryRun: boolean): Promise<Verdict> {
  const ours = (await gh.statuses(pull.head)).filter((s) => s.context === CONTEXT).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = ours[0];
  if (newest && newest.state !== 'pending') return { number: pull.number, head: pull.head, action: 'final' };
  const since = newest ? newest.createdAt : [await gh.committedAt(pull.head), pull.createdAt].sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
  if (!(now - Date.parse(since) >= STALE_MS)) return { number: pull.number, head: pull.head, action: 'waiting', since };
  if (!dryRun) await gh.postStatus(pull.head, { state: 'error', context: CONTEXT, description: description(pull.number, pull.head) });
  return { number: pull.number, head: pull.head, action: 'posted', since };
}

export async function watch(gh: GitHub, now: number, dryRun = false): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (const pull of await gh.openPulls()) out.push(await check(gh, pull, now, dryRun));
  return out;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** The REST client the workflow uses: open pulls, the combined status (newest per context), the head commit, and a new status. */
export function restClient(repo: string, token: string, api = 'https://api.github.com', fetcher: Fetch = fetch as unknown as Fetch): GitHub {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetcher(api + '/repos/' + repo + path, {
      method,
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'harness-evals-private-admission-watch' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(method + ' ' + path + ' answered HTTP ' + r.status);
    return r.json();
  };
  return {
    async openPulls() {
      const out: OpenPull[] = [];
      for (let page = 1; ; page++) {
        const batch = await call('GET', '/pulls?state=open&per_page=100&page=' + page);
        out.push(...batch.map((p: any) => ({ number: p.number, head: p.head.sha, createdAt: p.created_at })));
        if (batch.length < 100) return out;
      }
    },
    async statuses(sha) {
      const out: Status[] = [];
      for (let page = 1; ; page++) {
        const combined = await call('GET', '/commits/' + sha + '/status?per_page=100&page=' + page);
        out.push(...combined.statuses.map((s: any) => ({ context: s.context, state: s.state, createdAt: s.created_at })));
        if (combined.statuses.length < 100) return out;
      }
    },
    async committedAt(sha) {
      return (await call('GET', '/commits/' + sha)).commit.committer.date;
    },
    async postStatus(sha, status) {
      await call('POST', '/statuses/' + sha, status);
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf('--repo');
  const repo = i >= 0 ? argv[i + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('usage: GITHUB_TOKEN=<token> bun scripts/public-safety/watch-private-admission.ts --repo <owner/name> [--dry-run]'); return 2; }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error('watch-private-admission: GITHUB_TOKEN is not set'); return 2; }
  try {
    const verdicts = await watch(restClient(repo, token, process.env.GITHUB_API_URL || undefined), Date.now(), argv.includes('--dry-run'));
    for (const v of verdicts) console.log('#' + v.number + ' ' + v.head.slice(0, 12) + ' ' + v.action + (v.since ? ' (since ' + v.since + ')' : ''));
    console.log(verdicts.filter((v) => v.action === 'posted').length + ' of ' + verdicts.length + ' open pull request heads marked ' + CONTEXT + '=error');
    return 0;
  } catch (e) {
    console.error('watch-private-admission: ' + (e as Error).message);
    return 3;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
