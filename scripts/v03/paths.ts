// Where the v0.3 tools may write held-out material (internal-task): never inside the checkout, where one `git add -A` would
// publish it.

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..');

/** True when the path, with symlinks followed through its nearest existing ancestor, is inside this checkout or any git work tree. */
export function insideCheckout(path: string): boolean {
  let near = resolve(path);
  while (!existsSync(near) && dirname(near) !== near) near = dirname(near);
  const real = realpathSync(near);
  const root = realpathSync(REPO_ROOT);
  if (real === root || real.startsWith(root + sep)) return true;
  return spawnSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { stdio: 'ignore' }).status === 0;
}

/** The commitment printed or stored for a private seed: domain-separated, so it is never a key the generators use. */
export const SEED_COMMITMENT_LABEL = 'v03-seed-commitment\0';
