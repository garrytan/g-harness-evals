/**
 * Which statistics kit analyses a run.
 *
 * A run is analysed with `runner/stats/` as it stood at its preregistration commit: the last commit that touched
 * `runner/stats/` at or before the commit that first added the run's preregistration file. A dated amendment can name
 * another kit commit in the run's registry entry (`stats_kit: { commit, amendment }` in
 * docs/benchmarks/preregistrations.d/), and that commit is used instead. A results directory that no registry entry
 * covers, by the manifest's run_id or by its results globs (a scratch run, a test fixture), is analysed with this
 * checkout's kit, and the choice says so.
 *
 * When the chosen kit's tree differs from this checkout's, `loadPairedKit` extracts that commit's `runner/stats/` with
 * `git archive` into a fresh temporary directory on every call, imports `paired.ts` from there, so the old code runs as it was, and removes the directory after the import.
 * A registered run needs full git history (a shallow clone is refused), and an amendment's `stats_kit.commit` must be a
 * full 40-character sha.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadManifest } from '../prereg/prereg.ts';

export interface StatsKit {
  /** The commit whose runner/stats/ analysed the run; null when git cannot name one. */
  commit: string | null;
  source: 'preregistration' | 'amendment' | 'checkout';
  experiment?: string;
  preregistration?: string;
  preregistration_commit?: string;
  amendment?: string;
  /** Only for source checkout: why no preregistration chose the kit, and whether runner/stats/ has uncommitted changes. */
  reason?: string;
  dirty?: boolean;
}

const git = (cwd: string, args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};

function checkoutKit(root: string, reason: string): StatsKit {
  const status = git(root, ['status', '--porcelain', '--', 'runner/stats']);
  return { commit: git(root, ['log', '-1', '--format=%H', '--', 'runner/stats']) || null, source: 'checkout', reason, dirty: status !== '' };
}

/** The run's registry entry is the one whose id is the manifest's run_id, else the one whose results globs cover the directory. */
export function statsKitFor(resultsDir: string, repoRoot: string, runId?: string): StatsKit {
  const root = realpathSync(repoRoot);
  const rel = relative(root, realpathSync(resultsDir));
  const probe = join(rel, 'trials.jsonl');
  const entries = loadManifest(root);
  const entry = entries.find(e => runId !== undefined && e.id === runId)
    ?? (rel.startsWith('..') ? undefined : entries.find(e => e.results.some(glob => new Bun.Glob(glob).match(probe))));
  if (!entry) return checkoutKit(root, `no entry in docs/benchmarks/preregistrations*.json is run ${runId ?? '(no run_id)'} or covers ${rel}`);
  if (entry.stats_kit) {
    if (!/^[0-9a-f]{40}$/.test(entry.stats_kit.commit)) throw new Error(`${entry.id}: stats_kit.commit ${entry.stats_kit.commit} is not a full 40-character lowercase hex commit sha`);
    const commit = git(root, ['rev-parse', '--verify', `${entry.stats_kit.commit}^{commit}`]);
    if (!commit) throw new Error(`${entry.id}: stats_kit.commit ${entry.stats_kit.commit} is not a commit in this repository`);
    return { commit, source: 'amendment', experiment: entry.id, preregistration: entry.preregistration, amendment: entry.stats_kit.amendment };
  }
  if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') throw new Error(`${entry.id}: this is a shallow clone, so the commit that added ${entry.preregistration} cannot be found; fetch full history (git fetch --unshallow) before analysing this run`);
  const added = git(root, ['log', '--diff-filter=A', '--format=%H', '--', entry.preregistration])?.split('\n').filter(Boolean).at(-1);
  if (!added) return checkoutKit(root, `${entry.id}: ${entry.preregistration} has no commit in this history`);
  const commit = git(root, ['log', '-1', '--format=%H', added, '--', 'runner/stats']);
  if (!commit) throw new Error(`${entry.id}: no commit at or before ${added} touched runner/stats`);
  return { commit, source: 'preregistration', experiment: entry.id, preregistration: entry.preregistration, preregistration_commit: added };
}

export async function loadPairedKit(kit: StatsKit, repoRoot: string): Promise<typeof import('./paired.ts')> {
  const sameTree = kit.source === 'checkout'
    || (git(repoRoot, ['rev-parse', `${kit.commit}:runner/stats`]) === git(repoRoot, ['rev-parse', 'HEAD:runner/stats'])
      && git(repoRoot, ['status', '--porcelain', '--', 'runner/stats']) === '');
  if (sameTree) return import('./paired.ts');
  const dir = mkdtempSync(join(tmpdir(), 'harness-evals-stats-kit-'));
  const tar = execFileSync('git', ['archive', '--format=tar', kit.commit!, 'runner/stats'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  try {
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    return await import(join(dir, 'runner/stats/paired.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
