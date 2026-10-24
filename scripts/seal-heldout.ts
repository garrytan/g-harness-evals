// Seal the held-out task bodies: write <set>/MANIFEST.json with the sha256 of every file under the set's held-out
// tree (the manifest itself excluded), the world seed manifest hash the tasks were authored against, and the
// generation time. tests/heldout-manifest.test.ts fails when a tree and its manifest disagree, so a change to a
// held-out task is visible in review and in the receipts.
//
// Task sets: v0.1 is tasks/multiuser/heldout (the default); any other set name is tasks/multiuser/<set>/heldout.
//
//   bun scripts/seal-heldout.ts [--task-set v0.2]    write that set's manifest
//   bun scripts/seal-heldout.ts --check              check every sealed set, and refuse an unsealed tree; exit 1 on any problem
//   bun scripts/seal-heldout.ts --check --task-set v0.2   check one set

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const MULTIUSER = join(ROOT, 'tasks', 'multiuser');
const WORLD_MANIFEST = join(ROOT, 'world', 'seed', 'MANIFEST.json');
export const DEFAULT_SET = 'v0.1';

export interface HeldoutSet {
  name: string;
  /** The held-out directory of the set. */
  dir: string;
  /** <dir>/MANIFEST.json. */
  manifest: string;
}

export interface HeldoutManifest {
  schema_version: 1;
  generated_at: string;
  world_manifest_sha256: string;
  world_json_sha256: string;
  tasks: string[];
  files: Record<string, string>;
  tree_sha256: string;
}

/** The held-out directory and manifest path of a task set. */
export function heldoutSet(name = DEFAULT_SET): HeldoutSet {
  const dir = name === DEFAULT_SET ? join(MULTIUSER, 'heldout') : join(MULTIUSER, name, 'heldout');
  return { name, dir, manifest: join(dir, 'MANIFEST.json') };
}

/** Every task set with a held-out tree: v0.1 and each tasks/multiuser/<set>/heldout that exists. */
export function heldoutSets(): HeldoutSet[] {
  const named = readdirSync(MULTIUSER, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !['dev', 'heldout', '_shared'].includes(d.name) && existsSync(join(MULTIUSER, d.name, 'heldout')))
    .map((d) => d.name).sort();
  return [heldoutSet(DEFAULT_SET), ...named.map((n) => heldoutSet(n))];
}

export const HELDOUT_DIR = heldoutSet().dir;
export const MANIFEST_PATH = heldoutSet().manifest;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (statSync(p).isFile()) out.push(p);
  }
  return out;
}

/** The task directories under a held-out tree (those with a task.toml). */
export function heldoutTasks(set: HeldoutSet = heldoutSet()): string[] {
  if (!existsSync(set.dir)) return [];
  return readdirSync(set.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(set.dir, d.name, 'task.toml'))).map((d) => d.name).sort();
}

/** The manifest the current tree would produce; `generated_at` is taken from `previous` when the content is unchanged. */
export function buildManifest(previous?: HeldoutManifest, set: HeldoutSet = heldoutSet()): HeldoutManifest {
  const files: Record<string, string> = {};
  for (const p of existsSync(set.dir) ? walk(set.dir) : []) {
    if (p === set.manifest) continue;
    files[relative(set.dir, p)] = sha256(readFileSync(p));
  }
  const worldManifest = readFileSync(WORLD_MANIFEST, 'utf8');
  const worldJsonSha = (JSON.parse(worldManifest) as { world_json_sha256?: string }).world_json_sha256 ?? '';
  const tree = sha256(Object.entries(files).map(([k, v]) => `${v}  ${k}`).join('\n'));
  const tasks = [...new Set(Object.keys(files).map((f) => f.split('/')[0]!))].filter((d) => files[`${d}/task.toml`]);
  const unchanged = previous && previous.tree_sha256 === tree && previous.world_manifest_sha256 === sha256(worldManifest);
  return {
    schema_version: 1,
    generated_at: unchanged ? previous.generated_at : new Date().toISOString(),
    world_manifest_sha256: sha256(worldManifest),
    world_json_sha256: worldJsonSha,
    tasks,
    files,
    tree_sha256: tree,
  };
}

export function readManifest(set: HeldoutSet = heldoutSet()): HeldoutManifest | undefined {
  try {
    return JSON.parse(readFileSync(set.manifest, 'utf8')) as HeldoutManifest;
  } catch {
    return undefined;
  }
}

/** Differences between the committed manifest and the tree, empty when sealed. A tree that holds tasks but no
 *  manifest is unsealed and is a problem; a set with no held-out tree at all is not. */
export function manifestProblems(set: HeldoutSet = heldoutSet()): string[] {
  const committed = readManifest(set);
  const rel = relative(ROOT, set.manifest);
  if (!committed) {
    const n = heldoutTasks(set).length;
    return n ? [`unsealed: ${relative(ROOT, set.dir)} (${n} tasks) has no MANIFEST.json; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`] : [`${rel} is missing; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`];
  }
  const current = buildManifest(committed, set);
  const problems: string[] = [];
  for (const [f, h] of Object.entries(current.files)) {
    if (!committed.files[f]) problems.push(`${f}: not in the manifest`);
    else if (committed.files[f] !== h) problems.push(`${f}: sha256 changed`);
  }
  for (const f of Object.keys(committed.files)) if (!current.files[f]) problems.push(`${f}: in the manifest but not in the tree`);
  if (committed.world_manifest_sha256 !== current.world_manifest_sha256) problems.push('world/seed/MANIFEST.json changed since sealing');
  if (committed.tree_sha256 !== current.tree_sha256) problems.push('tree_sha256 differs');
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--task-set');
  const setName = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !setName) { console.error('HE-TASK-SEAL: --task-set wants a set name, for example --task-set v0.2'); process.exit(1); }
  const known = heldoutSets();
  if (setName && !known.some((s) => s.name === setName)) {
    console.error(`HE-TASK-SEAL: unknown task set "${setName}"; looked for ${relative(ROOT, heldoutSet(setName).dir)}/; known sets: ${known.map((s) => s.name).join(', ')} (v0.1 is tasks/multiuser/heldout)`);
    process.exit(1);
  }
  const sets = setName ? [heldoutSet(setName)] : known;
  if (argv.includes('--check')) {
    let failed = false;
    for (const set of sets) {
      const problems = manifestProblems(set);
      if (problems.length) {
        failed = true;
        console.error(`HE-TASK-SEAL: held-out manifest for set ${set.name} does not match the tree:\n  ` + problems.join('\n  '));
        continue;
      }
      const m = readManifest(set)!;
      console.log(`held-out manifest matches (set ${set.name}): ${Object.keys(m.files).length} files, ${m.tasks.length} tasks`);
    }
    if (failed) process.exit(1);
  } else {
    const set = sets[0]!;
    const manifest = buildManifest(readManifest(set), set);
    writeFileSync(set.manifest, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`sealed ${manifest.tasks.length} held-out tasks (set ${set.name}), ${Object.keys(manifest.files).length} files, tree ${manifest.tree_sha256.slice(0, 12)}`);
  }
}
