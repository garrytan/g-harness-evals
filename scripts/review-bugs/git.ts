// Git helpers the review-bugs scripts share. Every git call runs with an empty configuration (no system or global
// config, so no credential helper and no proxy header), no terminal prompt and a fixed locale, so a clone of a public
// repository is anonymous and the same on every machine.

import { spawn, spawnSync } from 'node:child_process';

export const GIT_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false',
};

export interface GitResult { code: number; out: string; err: string }

export function git(dir: string, args: readonly string[], input?: string): GitResult {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV, input, maxBuffer: 1024 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? r.error?.message ?? '' };
}

export function gitAsync(dir: string, args: readonly string[], timeoutMs = 600_000): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', dir, ...args], { env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') }); });
  });
}

/** The new-side line number of the last line of a review comment's diff hunk (the commented line), or null for a removed line. */
export function commentedLine(diffHunk: string): number | null {
  const lines = diffHunk.split('\n');
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[0] ?? '');
  if (!m) return null;
  let n = Number(m[1]) - 1;
  let last: string | null = null;
  for (const l of lines.slice(1)) {
    if (l.startsWith('\\')) continue;
    if (l.startsWith('-')) { last = l; continue; }
    n += 1;
    last = l;
  }
  if (last === null || last.startsWith('-')) return null;
  return n;
}

export interface Hunk { oldStart: number; oldCount: number; newStart: number; newCount: number }

/** Hunks of a unified diff with zero context (git diff -U0), for one file. */
export function hunks(diff: string): Hunk[] {
  const out: Hunk[] = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({ oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]) });
  }
  return out;
}

/** Whether any hunk changes an old-side line in [from, to]. A pure insertion after line a touches a and a + 1. */
export function touchesOld(hs: readonly Hunk[], from: number, to: number): boolean {
  return hs.some((h) => {
    const a = h.oldStart;
    const b = h.oldCount === 0 ? h.oldStart + 1 : h.oldStart + h.oldCount - 1;
    return a <= to && b >= from;
  });
}

/** New-side line ranges a diff adds or changes. */
export function addedRanges(hs: readonly Hunk[]): Array<[number, number]> {
  return hs.filter((h) => h.newCount > 0).map((h) => [h.newStart, h.newStart + h.newCount - 1] as [number, number]);
}

/** Test files, by path, in the languages the suite covers. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|testing|testdata|e2e)\/|_test\.(go|py|rs)$|(^|\/)test_[^/]+\.py$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)conftest\.py$/;
/** Files that are not code a reviewer's blocking bug can sit in. */
export const NOT_CODE = /\.(md|mdx|rst|txt|adoc|png|jpe?g|gif|svg|ico|lock|snap)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|uv\.lock|poetry\.lock|CHANGELOG[^/]*|LICENSE[^/]*)$/i;
export const isCodePath = (p: string) => !NOT_CODE.test(p) && !TEST_PATH.test(p);
