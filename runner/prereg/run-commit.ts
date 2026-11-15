/**
 * Which commit a preregistration's pinned files are checked at.
 *
 * A counted run loads its files from a worktree pinned at one commit, so its pins (a `sha256sum`-format list such as
 * `pins.sha256`) are checked at that commit, not at main's tip: main can change a shared script without breaking the
 * pins of a run that loaded the older copy. The run commit comes from the experiment's registry entry in
 * docs/benchmarks/preregistrations.d/:
 *
 *   "run_commit": { "commit": "<the preregistration's merge commit>",
 *                   "amendments": [{ "date": "YYYY-MM-DD", "commit": "<sha>", "heading": "Amendment 1" }] }
 *
 * `commit` must be the preregistration's merge commit: an ancestor of HEAD that adds the preregistration file against its first
 * parent, so a branch that merged main after the preregistration landed still finds it. Each amendment names the
 * commit its run loads from then on, later than the one before it, and the preregistration at that commit must carry a
 * heading with the amendment's name and date. The latest amendment's commit is the run commit; with no amendment it is
 * `commit`. The pins file in this checkout must equal the run commit's copy, so a re-pin needs an amendment that names
 * a new run commit.
 *
 * Every check fails closed: a shallow clone, a commit this checkout does not hold, or one that is not an ancestor of
 * HEAD throws instead of falling back to the tip (CI checks out with `fetch-depth: 0`). An entry with no `run_commit`
 * keeps the old behaviour: its pins are checked against this checkout's files.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManifestEntry } from './prereg.ts';

export interface PinCheck {
  /** The run commit the pins were read at, or null when the entry has no run_commit and the checkout was read. */
  at: string | null;
  files: number;
  /** One line per pinned path whose content is missing or does not have its pinned sha256. */
  problems: string[];
}

const SHA = /^[0-9a-f]{40}$/;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30 }).trim();
  } catch {
    return null;
  }
}

const isAncestor = (cwd: string, a: string, b: string) => git(cwd, ['merge-base', '--is-ancestor', a, b]) !== null;

/** Each path's content at the commit, in order, through one `git cat-file --batch`; null for a path it holds no file at. */
export function blobsAt(cwd: string, commit: string, paths: string[]): Array<Buffer | null> {
  if (paths.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd, input: paths.map(p => `${commit}:${p}\n`).join(''), maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] });
  let pos = 0;
  return paths.map(() => {
    const eol = out.indexOf(10, pos);
    const header = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(out.subarray(pos, eol).toString());
    pos = eol + 1;
    if (!header) return null;
    const body = out.subarray(pos, pos + Number(header[2]));
    pos += Number(header[2]) + 1;
    return header[1] === 'blob' ? body : null;
  });
}

/** The commit the entry's run loads, or null when the entry has no run_commit. Throws on any field or history problem. */
export function runCommitOf(entry: ManifestEntry, cwd = process.cwd()): string | null {
  const rc = entry.run_commit;
  if (rc === undefined) return null;
  const where = `${entry.id}: run_commit`;
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error(`${where}: this checkout is a shallow clone (or not a git checkout), so the run commit cannot be checked; fetch full history (git fetch --unshallow, or fetch-depth: 0 in CI). The pins are not checked at the tip instead.`);
  }
  const present = (commit: string, field: string) => {
    if (!SHA.test(commit ?? '')) throw new Error(`${where}: ${field} ${commit} is not a full 40-character lowercase hex commit sha`);
    if (git(cwd, ['cat-file', '-e', `${commit}^{commit}`]) === null) throw new Error(`${where}: ${field} ${commit} is not in this checkout; fetch full history (fetch-depth: 0 in CI). The pins are not checked at the tip instead.`);
    if (!isAncestor(cwd, commit, 'HEAD')) throw new Error(`${where}: ${field} ${commit} is not an ancestor of HEAD, so this history does not hold the run`);
  };
  present(rc.commit, 'commit');
  const added = git(cwd, ['diff-tree', '-r', '--no-commit-id', '--name-only', '--diff-filter=A', `${rc.commit}^1`, rc.commit, '--', entry.preregistration]);
  if (added !== entry.preregistration) throw new Error(`${where}: commit ${rc.commit} does not add ${entry.preregistration} against its first parent, so it is not the preregistration's merge commit; a later run commit needs a dated amendment`);
  let at = rc.commit;
  let date = '';
  for (const [i, a] of (rc.amendments ?? []).entries()) {
    const field = `amendments[${i}].commit`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') || a.date < date) throw new Error(`${where}: amendments[${i}].date ${a.date} is not a YYYY-MM-DD date on or after the amendment before it`);
    if (typeof a.heading !== 'string' || !a.heading.trim()) throw new Error(`${where}: amendments[${i}].heading must name the amendment's heading in ${entry.preregistration}`);
    present(a.commit, field);
    if (a.commit === at || !isAncestor(cwd, at, a.commit)) throw new Error(`${where}: ${field} ${a.commit} does not come after the run commit before it (${at})`);
    const text = blobsAt(cwd, a.commit, [entry.preregistration])[0]?.toString('utf8') ?? '';
    if (!text.split('\n').some(line => /^#{1,6} /.test(line) && line.includes(a.heading) && line.includes(a.date))) {
      throw new Error(`${where}: ${entry.preregistration} at ${a.commit} has no heading naming "${a.heading}" and ${a.date}`);
    }
    at = a.commit;
    date = a.date;
  }
  return at;
}

/** Checks every `<sha256>  <path>` line of the pins file at the entry's run commit, or in this checkout without one. */
export function checkPins(entry: ManifestEntry, pinsPath: string, cwd = process.cwd()): PinCheck {
  const at = runCommitOf(entry, cwd);
  const tip = readFileSync(join(cwd, pinsPath));
  const pins = at === null ? tip : blobsAt(cwd, at, [pinsPath])[0];
  if (!pins) throw new Error(`${entry.id}: ${pinsPath} is not a file at the run commit ${at}`);
  if (at !== null && !pins.equals(tip)) {
    throw new Error(`${entry.id}: ${pinsPath} in this checkout differs from its copy at the run commit ${at}; a re-pin needs a dated amendment in run_commit that names the commit the run loads`);
  }
  const lines = pins.toString('utf8').split('\n').filter(Boolean);
  const parsed = lines.map(line => /^([0-9a-f]{64})  (.+)$/.exec(line));
  const bad = lines.filter((_, i) => parsed[i] === null);
  if (bad.length) throw new Error(`${entry.id}: ${pinsPath} has lines that are not "<sha256>  <path>": ${bad.slice(0, 3).join(' | ')}`);
  const paths = parsed.map(m => m![2]!);
  const where = at === null ? 'in this checkout' : `at ${at}`;
  const content = at === null ? paths.map(p => { try { return readFileSync(join(cwd, p)); } catch { return null; } }) : blobsAt(cwd, at, paths);
  const problems = paths.flatMap((p, i) => {
    const blob = content[i];
    if (!blob) return [`${p}: missing ${where}`];
    return createHash('sha256').update(blob).digest('hex') === parsed[i]![1] ? [] : [`${p}: sha256 differs from its pin ${where}`];
  });
  return { at, files: paths.length, problems };
}
