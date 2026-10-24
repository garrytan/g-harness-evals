#!/usr/bin/env bun
// Build the install bundle for the gbrain install ladder (internal-task; docs/gbrain-arm.md, "The install ladder"): what
// gbrain's own documentation tells a user to run for each harness at the pinned commit, run once at image build
// time with the gbrain CLI, so a gbrain-docs cell applies the same bytes in every trial. Runs inside the image
// build (gbrain/Dockerfile, the install stage) and by hand:
//
//   bun gbrain/build-install.ts --out /install --gbrain "bun /opt/gbrain/src/cli.ts" --brains /brains --brain-home /brain --commit <sha>
//
// Layout of <out>:
//   openclaw/workspace/skills/...    gbrain skillpack scaffold --harness openclaw --workspace <out>/openclaw/workspace
//                                    (INSTALL_FOR_AGENTS.md step 5 for OpenClaw; the adapter copies workspace/ into
//                                    /workspace, OpenClaw's configured workspace)
//   hermes/workspace/skills/...      gbrain skillpack scaffold --all --workspace <out>/hermes/workspace
//                                    (INSTALL_FOR_AGENTS.md step 5, "cd <workspace> && gbrain skillpack scaffold --all";
//                                    the cd form does not resolve an empty directory, so the workspace is explicit)
//   hermes/<split>/.hermes.md        gbrain compile-context --target hermes --include-core --out <that file>, against
//                                    the split's bot-visible brain (docs/mcp/HERMES.md: the always-loaded core memory
//                                    Hermes's prompt builder reads from the cwd)
//   manifest.json                    every file with its sha256 and size, the commands as run, and for each .hermes.md
//                                    the page slugs it kept (compile-context renders slug, title and an excerpt per page)
//
// No key is in the environment: scaffold copies files from the gbrain checkout, compile-context reads the brain, each
// split's brain copied to /brain in turn (the path it was built at; gbrain records absolute paths, so a copy anywhere else
// opens an empty database and compiles an empty context).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { keylessEnv } from './build-brain.ts';

export type InstallHarness = 'openclaw' | 'hermes';
export const INSTALL_HARNESSES: InstallHarness[] = ['openclaw', 'hermes'];
export const SPLITS = ['dev', 'heldout'] as const;

export interface InstallFile {
  /** Path under <out>, for example openclaw/workspace/skills/brain-ops/SKILL.md. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface InstallManifest {
  schema_version: 1;
  gbrain_commit: string;
  gbrain_version: string | null;
  built_with: 'gbrain/build-install.ts';
  /** The commands as run, one per harness and per context file, in order. */
  commands: Array<{ harness: InstallHarness; split?: 'dev' | 'heldout'; argv: string[]; summary?: Record<string, unknown> }>;
  harnesses: Record<InstallHarness, {
    /** Workspace-relative artifacts the adapter copies into /workspace (today only skills/). */
    workspace_entries: string[];
    skills: number;
    files: number;
    /** Hermes only: one compiled context file per split. */
    context?: Record<'dev' | 'heldout', { path: string; bytes: number; tokens: number | null; kept_slugs: string[] }>;
  }>;
  files: InstallFile[];
  /** sha256 over "<path> <sha256>\n" for every file in byte order of path: one digest for the whole bundle (export-install.sh computes the same for a view). */
  digest: string;
}

function sha256(buf: Buffer | string): string { return createHash('sha256').update(buf).digest('hex'); }

/** Every regular file under dir, as paths relative to root, sorted. */
export function listFiles(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, p));
    else if (entry.isFile()) out.push(relative(root, p));
  }
  return out.sort();
}

export function fileEntries(root: string, paths: string[]): InstallFile[] {
  return paths.map((path) => { const body = readFileSync(join(root, path)); return { path, sha256: sha256(body), bytes: body.length }; });
}

export function bundleDigest(files: InstallFile[]): string {
  return sha256([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => `${f.path} ${f.sha256}\n`).join(''));
}

/** The page slugs a compiled context file kept: compile-context writes one "## <title> (brain://<split>/<slug>)" heading per page. */
export function keptSlugs(hermesMd: string): string[] {
  return [...hermesMd.matchAll(/^## .*\(brain:\/\/([^)\s]+)\)\s*$/gm)].map((m) => m[1]!);
}

/** The token count compile-context printed: "compile-context: wrote N entries (T tokens, budget B)". */
export function compiledTokens(stderr: string): number | null {
  const m = /wrote \d+ entries \((\d+) tokens/.exec(stderr);
  return m ? Number(m[1]) : null;
}

/** Count skills: directories directly under skills/ that hold a SKILL.md. */
export function countSkills(root: string, workspace: string): number {
  const skills = join(root, workspace, 'skills');
  if (!existsSync(skills)) return 0;
  return readdirSync(skills, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(skills, d.name, 'SKILL.md'))).length;
}

function run(cmd: string[], env: Record<string, string>, label: string, cwd?: string): { stdout: string; stderr: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { env, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${label} exited ${r.status}\n${(r.stderr + r.stdout).split('\n').slice(-20).join('\n')}`);
  return { stdout: r.stdout, stderr: r.stderr };
}

export interface BuildInstallOptions {
  out: string;
  /** The gbrain command, split on spaces. */
  gbrain: string[];
  /** Directory holding <split>/.gbrain for the bot-visible brains (the image's /brains). */
  brains: string;
  commit: string;
  /** Scratch HOME for the scaffold calls. */
  scratch: string;
  /** Where each split's brain is copied for compile-context: the path the brain was built at (gbrain records absolute paths
   *  inside a brain, so a copy anywhere else opens an empty database), /brain in the image. */
  brainHome: string;
  log?: (line: string) => void;
}

export function buildInstall(o: BuildInstallOptions): InstallManifest {
  const log = o.log ?? ((l) => console.error(l));
  const out = resolve(o.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  rmSync(o.scratch, { recursive: true, force: true });
  mkdirSync(o.scratch, { recursive: true });
  const commands: InstallManifest['commands'] = [];
  const harnesses = {} as InstallManifest['harnesses'];

  const scaffoldEnv = keylessEnv(join(o.scratch, 'home'));
  mkdirSync(scaffoldEnv.HOME!, { recursive: true });
  const scaffolds: Array<{ harness: InstallHarness; args: string[] }> = [
    { harness: 'openclaw', args: ['skillpack', 'scaffold', '--harness', 'openclaw', '--workspace', join(out, 'openclaw', 'workspace'), '--json'] },
    { harness: 'hermes', args: ['skillpack', 'scaffold', '--all', '--workspace', join(out, 'hermes', 'workspace'), '--json'] },
  ];
  for (const s of scaffolds) {
    mkdirSync(join(out, s.harness, 'workspace'), { recursive: true });
    const r = run([...o.gbrain, ...s.args], scaffoldEnv, `gbrain ${s.args.slice(0, 2).join(' ')} (${s.harness})`, scaffoldEnv.HOME);
    const line = r.stdout.trim().startsWith('{') ? r.stdout.trim() : r.stdout.split('\n').find((l) => l.trim().startsWith('{'));
    const envelope = line ? (JSON.parse(line) as { ok?: boolean; summary?: Record<string, unknown> }) : {};
    if (envelope.ok !== true) throw new Error(`gbrain skillpack scaffold for ${s.harness} did not answer ok: ${r.stdout.slice(0, 400)}`);
    const written = Number(envelope.summary?.wroteNew ?? 0);
    if (written === 0) throw new Error(`gbrain skillpack scaffold for ${s.harness} wrote no files`);
    const relArgs = s.args.map((a) => (a.startsWith(out) ? `<out>${a.slice(out.length)}` : a));
    commands.push({ harness: s.harness, argv: ['gbrain', ...relArgs], summary: envelope.summary });
    const entries = readdirSync(join(out, s.harness, 'workspace')).sort();
    harnesses[s.harness] = { workspace_entries: entries, skills: countSkills(out, join(s.harness, 'workspace')), files: listFiles(join(out, s.harness, 'workspace')).length };
    log(`${s.harness}: scaffold wrote ${written} files, ${harnesses[s.harness].skills} skills under ${s.harness}/workspace/{${entries.join(',')}}`);
  }

  const context = {} as NonNullable<InstallManifest['harnesses']['hermes']['context']>;
  for (const split of SPLITS) {
    const src = join(o.brains, split);
    if (!existsSync(join(src, '.gbrain'))) throw new Error(`no bot-visible brain at ${src}; build the brains first`);
    const home = resolve(o.brainHome);
    mkdirSync(home, { recursive: true });
    rmSync(join(home, '.gbrain'), { recursive: true, force: true });
    run(['cp', '-a', join(src, '.gbrain'), join(home, '.gbrain')], scaffoldEnv, 'cp brain');
    rmSync(join(home, '.gbrain', 'persistence', 'locks'), { recursive: true, force: true });
    const dest = join(out, 'hermes', split, '.hermes.md');
    mkdirSync(join(out, 'hermes', split), { recursive: true });
    const env = keylessEnv(home);
    const args = ['compile-context', '--target', 'hermes', '--include-core', '--out', dest];
    const r = run([...o.gbrain, ...args], env, `gbrain compile-context (${split})`, home);
    if (!existsSync(dest) || statSync(dest).size === 0) throw new Error(`gbrain compile-context wrote no file at ${dest}`);
    const body = readFileSync(dest, 'utf8');
    const kept = keptSlugs(body);
    if (kept.length === 0) throw new Error(`${dest} names no page (no "## ... (brain://...)" heading); compile-context output changed shape`);
    context[split] = { path: relative(out, dest), bytes: Buffer.byteLength(body), tokens: compiledTokens(r.stderr + r.stdout), kept_slugs: kept };
    commands.push({ harness: 'hermes', split, argv: ['gbrain', ...args.map((a) => (a.startsWith(out) ? `<out>${a.slice(out.length)}` : a))] });
    log(`hermes/${split}/.hermes.md: ${context[split].bytes} bytes, ${kept.length} pages kept${context[split].tokens !== null ? `, ${context[split].tokens} tokens` : ''}`);
    rmSync(join(home, '.gbrain'), { recursive: true, force: true });
  }
  harnesses.hermes.context = context;

  const files = fileEntries(out, listFiles(out));
  const version = run([...o.gbrain, '--version'], scaffoldEnv, 'gbrain --version').stdout.trim().match(/\d+\.\d+\.\d+(\.\d+)?/)?.[0] ?? null;
  const manifest: InstallManifest = { schema_version: 1, gbrain_commit: o.commit, gbrain_version: version, built_with: 'gbrain/build-install.ts', commands, harnesses, files, digest: bundleDigest(files) };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  rmSync(o.scratch, { recursive: true, force: true });
  return manifest;
}

/** The files of one harness and split view of the bundle: the harness's workspace and, for Hermes, that split's .hermes.md. */
export function viewFiles(manifest: InstallManifest, harness: InstallHarness, split: 'dev' | 'heldout'): InstallFile[] {
  return manifest.files.filter((f) => f.path.startsWith(`${harness}/workspace/`) || (harness === 'hermes' && f.path === `hermes/${split}/.hermes.md`));
}

/** Check a directory against the files a manifest lists: every file present with the listed sha256, nothing listed missing. */
export function verifyFiles(root: string, files: InstallFile[]): { ok: boolean; missing: string[]; changed: string[] } {
  const missing: string[] = [];
  const changed: string[] = [];
  for (const f of files) {
    const p = join(root, f.path);
    if (!existsSync(p)) { missing.push(f.path); continue; }
    if (sha256(readFileSync(p)) !== f.sha256) changed.push(f.path);
  }
  return { ok: !missing.length && !changed.length, missing, changed };
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const pin = JSON.parse(readFileSync(join(import.meta.dir, 'pin.json'), 'utf8')) as { gbrain: { commit: string } };
  try {
    const m = buildInstall({
      out: arg('out', '/install')!,
      gbrain: (arg('gbrain', 'gbrain')!).split(' ').filter(Boolean),
      brains: arg('brains', '/brains')!,
      commit: arg('commit', pin.gbrain.commit)!,
      scratch: arg('scratch', '/tmp/install-scratch')!,
      brainHome: arg('brain-home', '/brain')!,
    });
    console.log(JSON.stringify({ files: m.files.length, digest: m.digest, openclaw: { skills: m.harnesses.openclaw.skills, files: m.harnesses.openclaw.files }, hermes: { skills: m.harnesses.hermes.skills, files: m.harnesses.hermes.files, context: Object.fromEntries(Object.entries(m.harnesses.hermes.context!).map(([s, c]) => [s, { bytes: c.bytes, kept: c.kept_slugs.length, tokens: c.tokens }])) }, gbrain_version: m.gbrain_version }));
  } catch (e) {
    console.error(`build-install failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
