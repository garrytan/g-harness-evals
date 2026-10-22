// Seal the held-out task bodies: write tasks/multiuser/heldout/MANIFEST.json with the sha256 of every file under
// tasks/multiuser/heldout (the manifest itself excluded), the world seed manifest hash the tasks were authored
// against, and the generation time. tests/heldout-manifest.test.ts fails when the tree and the manifest disagree,
// so a change to a held-out task is visible in review and in the receipts.
//
//   bun scripts/seal-heldout.ts            write the manifest
//   bun scripts/seal-heldout.ts --check    exit 1 if the manifest does not match the tree

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
export const HELDOUT_DIR = join(ROOT, 'tasks', 'multiuser', 'heldout');
export const MANIFEST_PATH = join(HELDOUT_DIR, 'MANIFEST.json');
const WORLD_MANIFEST = join(ROOT, 'world', 'seed', 'MANIFEST.json');

export interface HeldoutManifest {
  schema_version: 1;
  generated_at: string;
  world_manifest_sha256: string;
  world_json_sha256: string;
  tasks: string[];
  files: Record<string, string>;
  tree_sha256: string;
}

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

/** The manifest the current tree would produce; `generated_at` is taken from `previous` when the content is unchanged. */
export function buildManifest(previous?: HeldoutManifest): HeldoutManifest {
  const files: Record<string, string> = {};
  for (const p of walk(HELDOUT_DIR)) {
    if (p === MANIFEST_PATH) continue;
    files[relative(HELDOUT_DIR, p)] = sha256(readFileSync(p));
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

export function readManifest(): HeldoutManifest | undefined {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as HeldoutManifest;
  } catch {
    return undefined;
  }
}

/** Differences between the committed manifest and the tree, empty when sealed. */
export function manifestProblems(): string[] {
  const committed = readManifest();
  if (!committed) return ['tasks/multiuser/heldout/MANIFEST.json is missing; run bun scripts/seal-heldout.ts'];
  const current = buildManifest(committed);
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
  if (process.argv.includes('--check')) {
    const problems = manifestProblems();
    if (problems.length) {
      console.error('HE-TASK-SEAL: held-out manifest does not match the tree:\n  ' + problems.join('\n  '));
      process.exit(1);
    }
    console.log(`held-out manifest matches: ${Object.keys(readManifest()!.files).length} files, ${readManifest()!.tasks.length} tasks`);
  } else {
    const manifest = buildManifest(readManifest());
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`sealed ${manifest.tasks.length} held-out tasks, ${Object.keys(manifest.files).length} files, tree ${manifest.tree_sha256.slice(0, 12)}`);
  }
}
