// internal-task: the gbrain install trial's cell fields and their checks. Kept apart from runner/trial/install.ts so runner/run.ts
// can import the checks without loading the trial driver.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RunnerError } from '../errors.ts';

export const INSTALL_SLICE = 'gbrain-install';
/** The one task id of an install cell: the task is tasks/gbrain-install/, the same for every trial. */
export const INSTALL_TASK = 'gbrain-install';
/** The harnesses with an install mode in their adapter (docs/adapters.md, "Install mode"). */
export const INSTALL_HARNESSES: readonly string[] = ['claude-code', 'codex', 'openclaw', 'hermes'];
/** The cell keys an install cell may carry. Anything else (gbrain, config, ablation, tasks, preamble, ...) would put our own
 *  wiring next to the install the agent is asked to do, so it is refused. */
const INSTALL_CELL_KEYS = new Set(['id', 'harness', 'model', 'slice', 'split', 'repetitions', 'ceiling', 'harness_mode', 'adapter', 'network', 'utility_models', 'install']);

export interface InstallCellConfig {
  /** bare: the first message is exactly the task's bare prompt ("install gbrain"). paste: the README's agent paste prompt, from paste_file. */
  arm: 'bare' | 'paste';
  /** paste arm: the prompt file, a path from the repository root, and its sha256. */
  paste_file?: string;
  paste_sha256?: string;
  /** The gbrain commit the stable channel must serve while the cell runs (the peeled commit of refs/tags/stable). */
  stable_commit: string;
  /** Seed of the per-trial nonce (tasks/gbrain-install/nonce.ts). */
  seed: string;
}

interface InstallCellFields { id: string; harness: string; slice: string; harness_mode?: string; network?: string; install?: unknown }

/** HE-PREREG-007 for a malformed install cell; HE-NET-001 for its network. A cell of another slice may not carry install. */
export function checkInstallCell(c: InstallCellFields, repoRoot = '.'): void {
  const bad = (msg: string) => new RunnerError('HE-PREREG-007', `cell ${c.id}: ${msg}`);
  if (c.slice !== INSTALL_SLICE) {
    if (c.install !== undefined) throw bad(`install belongs to ${INSTALL_SLICE} cells only (slice ${c.slice})`);
    if (c.network === 'install') throw new RunnerError('HE-NET-001', `cell ${c.id}: network "install" (open egress through the run's egress proxy) is for ${INSTALL_SLICE} cells only. fix: use "internal" or drop network`);
    return;
  }
  const extra = Object.keys(c).filter((k) => !INSTALL_CELL_KEYS.has(k));
  if (extra.length) throw bad(`an ${INSTALL_SLICE} cell cannot carry ${extra.join(', ')}; the agent installs gbrain itself and the harness starts from its fresh setup. allowed: ${[...INSTALL_CELL_KEYS].join(', ')}`);
  if (!INSTALL_HARNESSES.includes(c.harness)) throw bad(`harness ${c.harness} has no install mode; ${INSTALL_SLICE} runs on ${INSTALL_HARNESSES.join(', ')}`);
  if (c.harness_mode === 'scripted') throw bad(`an ${INSTALL_SLICE} cell needs a harness; harness_mode "scripted" runs none`);
  const docker = c.harness_mode === undefined || c.harness_mode === 'docker';
  if (docker && c.network !== 'install') throw new RunnerError('HE-NET-001', `cell ${c.id}: an ${INSTALL_SLICE} cell in docker mode needs network "install" (the agent downloads gbrain through the run's egress proxy, which blocks direct provider hosts and gbrain.io). fix: add "network": "install" to the cell`);
  if (!docker && c.network !== undefined) throw new RunnerError('HE-NET-001', `cell ${c.id}: network "${c.network}" needs a harness container; harness_mode "${c.harness_mode}" runs none. fix: drop network`);
  const i = c.install as Partial<InstallCellConfig> | undefined;
  if (!i || typeof i !== 'object' || Array.isArray(i)) throw bad(`an ${INSTALL_SLICE} cell needs install: {arm, stable_commit, seed[, paste_file, paste_sha256]}`);
  const unknown = Object.keys(i).filter((k) => !['arm', 'paste_file', 'paste_sha256', 'stable_commit', 'seed'].includes(k));
  if (unknown.length) throw bad(`install has unknown key(s) ${unknown.join(', ')}`);
  if (i.arm !== 'bare' && i.arm !== 'paste') throw bad(`install.arm must be "bare" or "paste" (got ${JSON.stringify(i.arm)})`);
  if (typeof i.stable_commit !== 'string' || !/^[0-9a-f]{40}$/.test(i.stable_commit)) throw bad(`install.stable_commit must be the full 40-character gbrain commit stable serves (got ${JSON.stringify(i.stable_commit)})`);
  if (typeof i.seed !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(i.seed)) throw bad(`install.seed must be a short name such as "wave1" (got ${JSON.stringify(i.seed)})`);
  if (i.arm === 'bare') {
    if (i.paste_file !== undefined || i.paste_sha256 !== undefined) throw bad('install.paste_file and paste_sha256 belong to the paste arm only');
    return;
  }
  if (typeof i.paste_file !== 'string' || !existsSync(resolve(repoRoot, i.paste_file))) throw bad(`install.paste_file must name a committed prompt file such as tasks/gbrain-install/arms/paste-<version>.md (got ${JSON.stringify(i.paste_file)})`);
  const sha = createHash('sha256').update(readFileSync(resolve(repoRoot, i.paste_file))).digest('hex');
  if (i.paste_sha256 !== sha) throw bad(`install.paste_sha256 ${JSON.stringify(i.paste_sha256)} does not match ${i.paste_file} (sha256 ${sha}); the paste prompt changed after the preregistration named it`);
}
