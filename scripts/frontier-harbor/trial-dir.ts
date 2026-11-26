// A frontier Harbor trial record's Harbor trial directory, for every reader of trial files (verifier output, agent logs,
// the request capture). to-trials.ts convert copies each trial to <results>/<paths.trial_dir>/harbor/. A shard stopped by
// a signal (a timeout) is pulled and its VM destroyed before convert runs, so to-trials.ts recover rebuilds its records
// from the journal with paths {}; their files are still in Harbor's own tree under the shard's results directory,
// <results>/run/jobs/<frontier.harbor_job>/<frontier.harbor_trial>/, which holds the same files as the harbor/ copy. The
// mid-run mirror leaves out run/, so that fallback works from the shard's own results directory (or another root that holds
// run/jobs/, such as a shard results directory passed beside a merged one), never from the mirror.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TrialDirRecord { paths?: { trial_dir?: string }; frontier?: { harbor_job?: string; harbor_trial?: string } }
export interface TrialDir { dir: string | null; from: 'trials' | 'run/jobs' | null; reason?: string }

/** The record's Harbor trial directory: <results>/<paths.trial_dir>/harbor when it exists, else
 *  run/jobs/<harbor_job>/<harbor_trial> under results or one of roots (each also tried as <root>/results), else null with
 *  the reason. */
export function trialDir(r: TrialDirRecord, results: string, roots: string[] = []): TrialDir {
  const copy = r.paths?.trial_dir ? join(results, r.paths.trial_dir, 'harbor') : null;
  if (copy && existsSync(copy)) return { dir: copy, from: 'trials' };
  const job = r.frontier?.harbor_job, trial = r.frontier?.harbor_trial;
  const where = copy ? 'no ' + r.paths!.trial_dir + '/harbor' : 'no paths.trial_dir';
  if (!job || !trial) return { dir: null, from: null, reason: where + ', and the record names no frontier.harbor_job and harbor_trial' };
  const dir = [results, ...roots].flatMap((root) => [join(root, 'run', 'jobs', job, trial), join(root, 'results', 'run', 'jobs', job, trial)]).find((d) => existsSync(d));
  return dir ? { dir, from: 'run/jobs' } : { dir: null, from: null, reason: where + ', and no run/jobs/' + job + '/' + trial + ' in the results directory or a capture root' };
}
