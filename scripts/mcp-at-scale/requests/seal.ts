#!/usr/bin/env bun
// Splits a request set into a public half and a sealed half (internal-task plan, "Requests and tasks": half of set R sealed
// until the gbrain build and harness pins freeze). It follows the repository's convention for request sets (internal-task's
// set L, #449's set P): scripts/sealed/seal.ts seals task trees with a world slice or repository tasks, not request sets,
// so the sealed half is held by digest. Its plaintext goes to a directory outside the checkout and outside any git work
// tree; the checkout gets only <out>/set-<x>-sealed.json, the per-row sha256 and the tree digest seal-heldout.ts records
// for a held-out tree (treeFiles). No custody file, branch or manifest under sealed/ or tasks/*/heldout is touched.
//
//   bun scripts/mcp-at-scale/requests/seal.ts --set R --file <set-r.jsonl> --out <dir> --sealed-dir <dir outside the checkout>
//
// Halves follow clusters, so the halves share no cluster: a set R tool request takes its target core tool's half (the 30
// core tools in a seeded hash order, alternating, so 15 and 15), a no-tool request its own; a set T task its own; a set G
// request its target gbrain tool's half within its half_kind. The order is sha256(SEED, cluster).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { treeFiles } from '../../seal-heldout.ts';
import { readJsonl, type Item, type SetName } from './sets.ts';

export const SEED = 'harn-108-mcp-at-scale-halves-v1';
const ROOT = resolve(import.meta.dir, '..', '..', '..');
const sha = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** The cluster an item's half follows, and the group inside which clusters alternate. */
export function clusterOf(it: Item): { group: string; cluster: string } {
  if (it.set === 'R') return it.kind === 'tool' && it.target ? { group: 'R-tool', cluster: it.target.server + '/' + it.target.tool } : { group: 'R-none', cluster: it.id };
  if (it.set === 'T') return { group: 'T', cluster: it.id };
  return { group: 'G-' + it.half_kind, cluster: it.target.tool };
}

/** Each item's half: clusters of a group in sha256(SEED, cluster) order, alternating public and sealed. */
export function halves(items: Item[]): Map<string, 'public' | 'sealed'> {
  const byGroup = new Map<string, Set<string>>();
  for (const it of items) { const c = clusterOf(it); (byGroup.get(c.group) ?? byGroup.set(c.group, new Set()).get(c.group)!).add(c.cluster); }
  const half = new Map<string, 'public' | 'sealed'>();
  for (const [group, clusters] of byGroup) [...clusters].sort((a, b) => sha(SEED, a).localeCompare(sha(SEED, b))).forEach((c, i) => half.set(group + '\u0000' + c, i % 2 ? 'sealed' : 'public'));
  return new Map(items.map((it) => { const c = clusterOf(it); return [it.id, half.get(c.group + '\u0000' + c.cluster)!]; }));
}

/** Refuses a sealed directory inside the checkout or any git work tree, or one holding other files. */
export function sealedDirProblem(dir: string, file: string): string | null {
  const abs = resolve(dir);
  if (abs === ROOT || abs.startsWith(ROOT + sep)) return 'the sealed directory ' + abs + ' is inside the checkout; sealed plaintext is kept outside it';
  let ancestor = abs;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const git = spawnSync('git', ['-C', realpathSync(ancestor), 'rev-parse', '--absolute-git-dir'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_DISCOVERY_ACROSS_FILESYSTEM: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (git.status === 0) return 'the sealed directory ' + abs + ' is inside a git work tree or repository';
  if (!(git.status === 128 && git.stderr.startsWith('fatal: not a git repository '))) {
    return 'cannot verify that the sealed directory ' + abs + ' is outside a git work tree';
  }
  if (existsSync(abs)) {
    const other = readdirSync(abs).filter((f) => f !== file);
    if (other.length) return 'the sealed directory holds other files (' + other.slice(0, 3).join(', ') + '); use a directory for this sealed half alone';
  }
  return null;
}

export function sealSet(o: { set: SetName; items: Item[]; out: string; sealedDir: string }) {
  const name = 'set-' + o.set.toLowerCase();
  const sealedDir = resolve(o.sealedDir), sealedFile = name + '-sealed.jsonl';
  const problem = sealedDirProblem(sealedDir, sealedFile);
  if (problem) throw new Error('HE-MCP-020 ' + problem);
  const half = halves(o.items);
  const rows = o.items.map((it) => ({ ...it, half: half.get(it.id)! }) as Item);
  const pub = rows.filter((r) => r.half === 'public'), sealed = rows.filter((r) => r.half === 'sealed');
  mkdirSync(sealedDir, { recursive: true, mode: 0o700 });
  const lines = (xs: Item[]) => xs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const pending = mkdtempSync(join(sealedDir, '.pending-'));
  try {
    const pendingFile = join(pending, sealedFile);
    writeFileSync(pendingFile, lines(sealed), { mode: 0o600 });
    renameSync(pendingFile, join(sealedDir, sealedFile));
  } finally { rmSync(pending, { recursive: true, force: true }); }
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, name + '-public.jsonl'), lines(pub));
  const record = { schema: 'he-mcp-at-scale-sealed-half/1', set: o.set, seed: SEED, file: sealedFile, rows: sealed.length, public_rows: pub.length,
    ids: sealed.map((r) => r.id), row_sha256: Object.fromEntries(sealed.map((r) => [r.id, sha(JSON.stringify(r))])), ...treeFiles(sealedDir),
    custody: 'held by digest outside the checkout until the gbrain build and harness pins freeze (plan, "Requests and tasks"); scripts/sealed/seal.ts does not take request sets' };
  writeFileSync(join(o.out, name + '-sealed.json'), JSON.stringify(record, null, 1) + '\n');
  return record;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const set = flag('--set') as SetName | undefined, file = flag('--file'), out = flag('--out'), sealedDir = flag('--sealed-dir');
  if (!set || !['R', 'T', 'G'].includes(set) || !file || !out || !sealedDir) {
    console.error('usage: seal.ts --set R|T|G --file <set.jsonl> --out <dir> --sealed-dir <dir outside the checkout>');
    process.exit(2);
  }
  try {
    const r = sealSet({ set, items: readJsonl<Item>(file), out, sealedDir });
    console.log('sealed set ' + set + ': ' + r.rows + ' sealed, ' + r.public_rows + ' public, tree_sha256 ' + r.tree_sha256);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
