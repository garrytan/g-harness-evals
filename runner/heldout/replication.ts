/**
 * Replication of a past held-out run (internal-task): plan chosen cells of a registered experiment again, under a new run id,
 * without opening a held-out set.
 *
 *   bun runner/run.ts plan|dry-run --replication-of <run id> --cells <id,id> --reps <n> --run-id <new id> [--out <dir>]
 *
 * The plan starts from the run's registered prereg.json (registeredHeldout, docs/benchmarks/preregistrations.json and
 * .d/), whose bytes must be the ones committed at HEAD. It keeps only the named cells, sets their repetitions to --reps
 * and the run id to --run-id, and the manifest records replication_of. A replication is no opening: it writes no ledger
 * row and changes nothing under tasks/, so it is accepted only on a set whose content is already public. Every held-out set
 * the kept cells run must be out of sealed custody, spent or retired in its openings ledger, plaintext in the tree (its
 * MANIFEST.json lists tasks and matches the tree, which a released set does and a retired but unreleased one cannot), and
 * share no world slice or corpus digest with a set still in sealed custody and not retired (liveSharers). Refusals are
 * HE-REPL-001 to 003 (docs/errors.md). checkPlan, and every run that is not a replication, is unchanged.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { RunnerError } from '../errors.ts';
import { loadManifest as loadRegistry } from '../prereg/prereg.ts';
import { cellProblem, heldoutSetsOf, registeredHeldout } from './openings.ts';
import { heldoutSet, isSealed, liveSharers, manifestProblems, openingsLedger, readManifest } from '../../scripts/seal-heldout.ts';

/** A run id: lowercase letters and digits in words joined by single dashes, the shape every registered experiment id has. */
export const RUN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ReplicationOf {
  run_id: string;
  prereg_path: string;
  prereg_sha256: string;
  cells: string[];
  reps: number;
}

interface ReplicablePrereg {
  run_id: string;
  cells: Array<{ id: string; split: string; repetitions: number; task_set?: string; slice?: string; tasks?: string[]; preamble?: string }>;
  tasks?: Record<string, string[]>;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Why a held-out set cannot be run again without an opening, with the fix; null when it can. */
export function replicationSetProblem(name: string, root: string): { reason: string; fix: string } | null {
  const set = heldoutSet(name, root);
  const m = readManifest(set);
  if (!m) return { reason: `has no readable MANIFEST.json at ${relative(root, set.manifest)}`, fix: 'name cells of a set with a held-out manifest' };
  if (isSealed(m)) return { reason: `is in sealed custody${m.status === 'retired' ? ' (retired but not released)' : ''}, so its tasks exist only in the encrypted bundle and running them would be an opening`, fix: 'replicate it once the set is retired and released (scripts/sealed/release.ts), or preregister an opening with its own ledger row' };
  const status = openingsLedger(m)?.status;
  if (status !== 'spent' && status !== 'retired') return { reason: `has openings ledger status ${status ?? 'none (no openings ledger)'}; only a spent or retired set is run again without an opening`, fix: 'preregister an opening with its own ledger row, or wait until the set is spent or retired' };
  const problems = manifestProblems(set);
  if (!m.tasks?.length || problems.length) return { reason: `is not plaintext in the tree (${problems.length ? `${problems.length} difference(s) from MANIFEST.json under ${relative(root, set.tree)}, first: ${problems[0]}` : 'MANIFEST.json lists no tasks'}); a retired set is public only once released`, fix: 'release the set (scripts/sealed/release.ts) and commit its plaintext tree, or restore the tree to match MANIFEST.json' };
  const live = liveSharers(name, root);
  if (live.length) return { reason: `shares its world slice or corpus with ${live.join(', ')}, still in sealed custody and not retired, so running it would expose that set`, fix: `replicate it after ${live.join(', ')} is retired` };
  return null;
}

/**
 * The replication plan: the registered preregistration of run `of` (loaded with `load`, run.ts loadPrereg), cut to the
 * named cells at `reps` repetitions under run id `runId`, with the replication_of block and the line plan prints. Throws
 * HE-REPL-001 (bad flag values), HE-REPL-002 (unknown run, registered prereg missing, changed or uncommitted) and
 * HE-REPL-003 (a held-out set the kept cells run is not eligible); HE-HELDOUT-001 for an unsafe cell, as checkPlan does.
 */
export function planReplication<P extends ReplicablePrereg>(o: { root: string; of: string; cells?: string; reps?: string; runId?: string; load: (path: string) => { prereg: P; sha256: string } }): { prereg: P; sha256: string; replication_of: ReplicationOf; lines: string[] } {
  const cells = (o.cells ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!cells.length) throw new RunnerError('HE-REPL-001', `--replication-of ${o.of} needs --cells <id,id>, the cells to run again; fix: bun runner/run.ts plan|dry-run --replication-of <run id> --cells <id,id> --reps <n> --run-id <new id> [--out <dir>]`);
  if (new Set(cells).size !== cells.length) throw new RunnerError('HE-REPL-001', `--cells names a cell twice (${cells.join(',')}); fix: name each cell once`);
  if (!o.reps || !/^[1-9][0-9]*$/.test(o.reps)) throw new RunnerError('HE-REPL-001', `--reps must be a positive whole number (got ${JSON.stringify(o.reps ?? null)}); fix: pass --reps <n>, such as --reps 1`);
  if (!o.runId || !RUN_ID.test(o.runId)) throw new RunnerError('HE-REPL-001', `--run-id must be lowercase letters and digits in words joined by single dashes, such as replicate-m3-2026-11 (got ${JSON.stringify(o.runId ?? null)}); fix: pass a new run id of that shape`);
  if (o.runId === o.of) throw new RunnerError('HE-REPL-001', `--run-id ${o.runId} is the run it replicates; fix: give the replication a new run id`);
  if (loadRegistry(o.root).some((e) => e.id === o.runId)) throw new RunnerError('HE-REPL-001', `--run-id ${o.runId} is a registered experiment (docs/benchmarks/preregistrations.json or preregistrations.d/); fix: give the replication a run id no experiment uses`);

  const reg = registeredHeldout(o.root).find((r) => r.id === o.of);
  if (!reg) throw new RunnerError('HE-REPL-002', `run ${o.of} is not a registered experiment with held-out cells (docs/benchmarks/preregistrations.json or preregistrations.d/); fix: name the run id of a registered held-out run`);
  let committed: string;
  try {
    committed = execFileSync('git', ['show', `HEAD:${reg.prereg_json}`], { cwd: o.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    throw new RunnerError('HE-REPL-002', `run ${o.of}: ${reg.prereg_json} is not committed at HEAD in ${o.root}; a replication plans from the registered, committed preregistration. fix: run from a checkout where it is committed`);
  }
  if (sha256(committed) !== reg.sha256) throw new RunnerError('HE-REPL-002', `run ${o.of}: ${reg.prereg_json} in the working tree (sha256 ${reg.sha256.slice(0, 12)}) is not the one committed at HEAD (sha256 ${sha256(committed).slice(0, 12)}); a replication plans from the registered preregistration. fix: restore it (git checkout -- ${reg.prereg_json})`);
  const { prereg: original, sha256: digest } = o.load(join(o.root, reg.prereg_json));
  if (digest !== reg.sha256) throw new RunnerError('HE-REPL-002', `run ${o.of}: ${reg.prereg_json} has sha256 ${digest.slice(0, 12)}, the registration has ${reg.sha256.slice(0, 12)} (the file changed while planning); fix: restore it and plan again`);

  const unknown = cells.filter((id) => !original.cells.some((c) => c.id === id));
  if (unknown.length) throw new RunnerError('HE-REPL-001', `--cells names ${unknown.join(', ')}, not a cell of run ${o.of}; fix: name cells of its preregistration: ${original.cells.map((c) => c.id).join(', ')}`);
  const reps = Number(o.reps);
  const prereg = { ...original, run_id: o.runId, cells: original.cells.filter((c) => cells.includes(c.id)).map((c) => ({ ...c, repetitions: reps })) };
  const unsafe = cellProblem(prereg);
  if (unsafe) throw new RunnerError('HE-HELDOUT-001', unsafe);

  const sets = heldoutSetsOf(prereg);
  for (const name of sets) {
    const p = replicationSetProblem(name, o.root);
    if (p) throw new RunnerError('HE-REPL-003', `replication of ${o.of}: set ${name} ${p.reason}; fix: ${p.fix}`);
  }
  const setText = sets.length ? `held-out ${sets.map((s) => `set ${s} (${openingsLedger(readManifest(heldoutSet(s, o.root)))!.status}, plaintext)`).join(', ')}` : 'no held-out cell';
  return {
    prereg,
    sha256: reg.sha256,
    replication_of: { run_id: o.of, prereg_path: reg.prereg_json, prereg_sha256: reg.sha256, cells, reps },
    lines: [`REPLICATION: run ${o.runId} replicates ${o.of} (${reg.prereg_json}, sha256 ${reg.sha256.slice(0, 12)}): cells ${cells.join(', ')} at ${reps} repetition${reps > 1 ? 's' : ''}; ${setText}; no opening is counted and no ledger row is written`],
  };
}
