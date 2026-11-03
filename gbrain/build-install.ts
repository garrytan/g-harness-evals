#!/usr/bin/env bun
// Build the install bundle for the gbrain install ladder (internal-task; docs/gbrain-arm.md, "The install ladder"): what
// gbrain's own documentation tells a user to run for each harness at the pinned commit, run once at image build
// time with the gbrain CLI, so a gbrain-docs cell applies the same bytes in every trial. Runs inside the image
// build (gbrain/Dockerfile, the install stage) and by hand:
//
//   bun gbrain/build-install.ts --out /install --gbrain "bun /opt/gbrain/src/cli.ts" --brains /brains --brain-home /brain --commit <sha> \
//     [--hermes-soul <SOUL.md>] [--gbrain-bin <compiled gbrain>] [--claude-settings <settings.json>] [--harness-state /harness-state]
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
//   openclaw/installer/workspace/AGENTS.md   gbrain setup openclaw --workspace <out>/openclaw/installer/workspace --instructions-only
//                                    (internal-task, gbrain#7489: the brain-first instruction block gbrain's installer writes into the
//                                    harness's own instruction file; the adapter copies workspace/ into /workspace)
//   openclaw/installer/state/gbrain/gbrain-turn-rule/{package.json,openclaw.plugin.json,index.js}
//                                    (gbrain#7489 at 10949a15: the hook-only OpenClaw plugin whose before_prompt_build handler returns
//                                    the brain-first rule as prependContext; setup writes it under OPENCLAW_STATE_DIR, which build-install
//                                    points at <out>/openclaw/installer/state, and with no openclaw on PATH prints the three install
//                                    commands, kept in the record as turn_hook.commands for the adapter to run)
//   hermes/installer/home/config.yaml and hermes/installer/home/shell-hooks-allowlist.json
//                                    (gbrain#7489 at 10949a15: a marked hooks.pre_llm_call entry whose command echoes the rule as
//                                    {"context": ...}, and Hermes's own allowlist approving that exact command)
//   hermes/installer/home/SOUL.md    HERMES_HOME=<out>/hermes/installer/home gbrain setup hermes --instructions-only, the home
//                                    seeded first with Hermes's own SOUL.md at the pinned Hermes commit (--hermes-soul): gbrain
//                                    appends the block to an existing SOUL.md and writes nothing into an empty HERMES_HOME, so the
//                                    seed stands in for "ran Hermes once"; the adapter copies home/SOUL.md to $HERMES_HOME/SOUL.md
//   claude-code/installer/home/...   HOME=<state> CLAUDE_CONFIG_DIR=<state>/claude gbrain setup claude-code --instructions-only
//                                    --gbrain-bin <state>/.local/bin/gbrain (gbrain#7989): claude/CLAUDE.md (the block),
//                                    claude/settings.json (the UserPromptSubmit turn-rule hook, written into Claude Code's settings
//                                    seeded first with the adapter's own harnesses/claude-code/config/settings.json, --claude-settings),
//                                    .gbrain/agent-instructions.json (the ledger the hook reads the rule from), .local/bin/gbrain
//                                    (gbrain's own bun run build of the same checkout, --gbrain-bin, which the hook command runs) and,
//                                    from gbrain#8424 (2c469d1b), .gbrain/hook-launcher/gbrain-hook (the launcher the hook command runs
//                                    gbrain through, kept as a hook file, mode 0755).
//                                    <state> is the harness's state dir in its container (/harness-state; --harness-state), so the
//                                    hook command and every path in these files are the trial's own and the adapter copies them as is
//   codex/installer/home/...         HOME=<state> CODEX_HOME=<state>/codex gbrain setup codex --instructions-only --gbrain-bin ...:
//                                    codex/AGENTS.md, codex/hooks.json (the UserPromptSubmit group), codex/config.toml (the
//                                    [hooks.state."<state>/codex/hooks.json:user_prompt_submit:0:0"] trust table, which the adapter
//                                    appends to the config.toml it writes), the ledger and the binary
//   manifest.json                    every file with its sha256 and size, the commands as run, and for each .hermes.md
//                                    the page slugs it kept (compile-context renders slug, title and an excerpt per page);
//                                    harnesses.<h>.installer records the installer command, its files and the block version, or
//                                    {unavailable: <reason>} when the gbrain commit has no setup target for the harness
//
// No key is in the environment: scaffold copies files from the gbrain checkout, compile-context reads the brain, each
// split's brain copied to /brain in turn (the path it was built at; gbrain records absolute paths, so a copy anywhere else
// opens an empty database and compiles an empty context).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { keylessEnv } from './build-brain.ts';

export type InstallHarness = 'openclaw' | 'hermes';
export const INSTALL_HARNESSES: InstallHarness[] = ['openclaw', 'hermes'];
/** Harnesses with an installer view: the two with gbrain-docs views, and Claude Code and Codex, whose only view is gbrain setup's
 *  per-turn install (gbrain#7989); gbrain documents no skillpack or context install for them. */
export type InstallerHarness = InstallHarness | 'claude-code' | 'codex';
export const INSTALLER_HARNESSES: InstallerHarness[] = [...INSTALL_HARNESSES, 'claude-code', 'codex'];
/** Where the Claude Code and Codex adapters keep harness state, HOME included: setup runs with these paths at build. */
export const HARNESS_STATE_DIR = '/harness-state';
/** The compiled gbrain the Claude Code and Codex turn hook runs, under HOME. */
export const HOOK_GBRAIN_BIN = '.local/bin/gbrain';
/** The launcher the turn hook starts gbrain through from gbrain#8424 (v0.60.547.0), under HOME: a sh script that moves into its own
 *  directory, refuses when anything else is there, and execs gbrain, so Bun never reads the session directory's bunfig.toml or .env.
 *  Setup writes it only at those commits; older ones (a590ad07) write none and their hook runs gbrain directly. */
export const HOOK_LAUNCHER = '.gbrain/hook-launcher/gbrain-hook';
/** An absolute hook launcher path inside a command, as gbrain writes it (hook-launcher.ts isHookLauncherPath). */
const LAUNCHER_PATH = /\/[^\s"'\\]*\/hook-launcher\/gbrain-hook(?![^\s"'\\])/g;
export const SPLITS = ['dev', 'heldout'] as const;

export interface InstallFile {
  /** Path under <out>, for example openclaw/workspace/skills/brain-ops/SKILL.md. */
  path: string;
  sha256: string;
  bytes: number;
}

/** The brain-first block gbrain's installer writes, as the bundle records it (internal-task). */
export interface InstallerRecord {
  /** The command as run, paths under <out> written as <out>/... */
  argv: string[];
  /** Bundle paths the command wrote or changed (openclaw/installer/workspace/AGENTS.md, hermes/installer/home/SOUL.md, and the per-turn
   *  hook files at gbrain#7489's hook head: openclaw/installer/state/gbrain/gbrain-turn-rule/*, hermes/installer/home/config.yaml and
   *  hermes/installer/home/shell-hooks-allowlist.json). */
  files: string[];
  /** The marker's version, "v1" from "<!-- gbrain brain-first v1: ... -->". */
  block_version: string | null;
  /** The per-turn hook setup wrote (gbrain#7489 at 10949a15), from its --json turn_hook: the files among `files` that are the hook
   *  (not instruction files), setup's action and detail, and for OpenClaw the openclaw commands setup printed because no openclaw was
   *  on PATH at build, which the adapter runs in the trial. Absent when setup wrote no hook (the block-only head 99294fe4). */
  turn_hook?: { files: string[]; action: string; detail: string; commands?: string[]; rule?: string | null };
  /** Hermes: the SOUL.md the home was seeded with before the command, Hermes's own default identity at the pinned commit. Claude
   *  Code: the settings.json its adapter writes, seeded before the command so setup merged its hook into it. */
  seed?: { source: string; hermes_commit?: string | null; sha256: string; bytes: number };
  /** Claude Code and Codex: the HOME setup ran in, the harness's state dir in its container; the adapter refuses another. */
  state_root?: string;
  /** Claude Code and Codex: the absolute gbrain the hook command runs, a file of the view under home/. */
  gbrain_bin?: string;
}

export const INSTALLER_BLOCK_BEGIN = '<!-- gbrain:brain-first:begin -->';
/** The lock file Hermes's flock leaves beside its allowlist when gbrain setup hermes takes it (gbrain#7989); never bundled. */
export const HERMES_ALLOWLIST_LOCK = 'home/shell-hooks-allowlist.json.lock';

export interface InstallManifest {
  schema_version: 1;
  gbrain_commit: string;
  gbrain_version: string | null;
  built_with: 'gbrain/build-install.ts';
  /** The commands as run, one per harness and per context file, in order. */
  commands: Array<{ harness: InstallerHarness; split?: 'dev' | 'heldout'; install?: 'gbrain-installer'; argv: string[]; summary?: Record<string, unknown> }>;
  harnesses: Partial<Record<'claude-code' | 'codex', { installer?: InstallerRecord | { unavailable: string } }>> & Record<InstallHarness, {
    /** Workspace-relative artifacts the adapter copies into /workspace (today only skills/). */
    workspace_entries: string[];
    skills: number;
    files: number;
    /** Hermes only: one compiled context file per split. */
    context?: Record<'dev' | 'heldout', { path: string; bytes: number; tokens: number | null; kept_slugs: string[] }>;
    /** The gbrain-installer rung's files, or why this gbrain commit has none for the harness (absent in bundles built before it). */
    installer?: InstallerRecord | { unavailable: string };
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
  /** Hermes's own SOUL.md at the pinned Hermes commit (harnesses/hermes/pin.json), the seed for the hermes installer; without it
   *  the hermes installer is recorded unavailable. */
  hermesSoul?: string;
  hermesCommit?: string;
  /** gbrain compiled from the same checkout (bun run build), copied to <harnessState>/.local/bin/gbrain for the Claude Code and Codex
   *  turn hook; without it those installers are recorded unavailable. */
  gbrainBin?: string;
  /** harnesses/claude-code/config/settings.json, the seed of Claude Code's settings; without it that installer is unavailable. */
  claudeSettings?: string;
  /** The harness state dir setup runs in for Claude Code and Codex (default /harness-state); it must be absent or empty. */
  harnessState?: string;
  log?: (line: string) => void;
}

/** The rule text inside the Hermes hook command `/bin/echo '{"context": <rule>}'` (gbrain writes a quote in the rule as \u0027); null
 *  when the command has another shape. */
export function hermesHookRule(command: string): string | null {
  const m = /^\/bin\/echo '(.*)'$/s.exec(command);
  if (!m) return null;
  try { const v = JSON.parse(m[1]!.replace(/\\u0027/g, "'")) as { context?: unknown }; return typeof v.context === 'string' ? v.context : null; } catch { return null; }
}

/** The installer section: `gbrain setup <harness> --instructions-only` per harness into its own directory under <out>, the
 *  files it wrote or changed recorded with the block version; a commit without the setup target (every gbrain before #7489)
 *  records {unavailable} with gbrain's own words, and a cell on the installer rung then fails preflight (HE-GBRAIN-006). */
export function buildInstaller(o: BuildInstallOptions, out: string, harness: InstallerHarness, log: (line: string) => void): { record: InstallerRecord | { unavailable: string }; command?: InstallManifest['commands'][number] } {
  if (harness === 'claude-code' || harness === 'codex') return buildStateInstaller(o, out, harness, log);
  const root = join(out, harness, 'installer');
  rmSync(root, { recursive: true, force: true });
  const env = keylessEnv(join(o.scratch, `installer-home-${harness}`));
  mkdirSync(env.HOME!, { recursive: true });
  let args: string[];
  let seed: InstallerRecord['seed'];
  if (harness === 'openclaw') {
    mkdirSync(join(root, 'workspace'), { recursive: true });
    mkdirSync(join(root, 'state'), { recursive: true });
    env.OPENCLAW_STATE_DIR = join(root, 'state');
    args = ['setup', 'openclaw', '--workspace', join(root, 'workspace'), '--instructions-only', '--json'];
  } else {
    if (!o.hermesSoul || !existsSync(o.hermesSoul)) return { record: { unavailable: 'no Hermes SOUL.md seed (--hermes-soul); gbrain setup hermes writes nothing into an empty HERMES_HOME' } };
    const home = join(root, 'home');
    mkdirSync(home, { recursive: true });
    const soul = readFileSync(o.hermesSoul);
    if (!soul.length) return { record: { unavailable: `the Hermes SOUL.md seed at ${o.hermesSoul} is empty` } };
    writeFileSync(join(home, 'SOUL.md'), soul);
    seed = { source: o.hermesSoul, hermes_commit: o.hermesCommit ?? null, sha256: sha256(soul), bytes: soul.length };
    env.HERMES_HOME = home;
    args = ['setup', 'hermes', '--instructions-only', '--json'];
  }
  const before = new Map(listFiles(root).map((f) => [f, sha256(readFileSync(join(root, f)))]));
  const r = spawnSync(o.gbrain[0]!, [...o.gbrain.slice(1), ...args], { env, cwd: env.HOME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const said = (r.stderr + r.stdout).trim().split('\n').filter(Boolean);
  if (r.status !== 0) {
    rmSync(root, { recursive: true, force: true });
    return { record: { unavailable: `gbrain setup ${harness} --instructions-only exited ${r.status}: ${(said.find((l) => /error|refus|unknown/i.test(l)) ?? said[0])?.trim().slice(0, 300) ?? 'no output'}` } };
  }
  // gbrain#7989 takes Hermes's own flock while it writes the allowlist, which leaves home/shell-hooks-allowlist.json.lock beside it
  // (Hermes keeps the file and gbrain correctly does not unlink it). The lock is Hermes's runtime state, not an install file, so it
  // is dropped here when present: no bundle manifest or view lists it, and the Hermes adapter, which refuses any view path without
  // a documented destination, never sees it. Commits before #7989 write no lock, and nothing changes for them.
  if (harness === 'hermes' && existsSync(join(root, HERMES_ALLOWLIST_LOCK))) {
    rmSync(join(root, HERMES_ALLOWLIST_LOCK));
    log(`hermes: dropped Hermes's allowlist lock ${HERMES_ALLOWLIST_LOCK} from the installer bundle (runtime state, not an install file)`);
  }
  const changed = listFiles(root).filter((f) => before.get(f) !== sha256(readFileSync(join(root, f))));
  if (!changed.length) {
    rmSync(root, { recursive: true, force: true });
    return { record: { unavailable: `gbrain setup ${harness} --instructions-only exited 0 and wrote nothing: ${said.find((l) => /skip|nothing|unchanged/i.test(l))?.trim().slice(0, 300) ?? said.at(-1)?.trim().slice(0, 300) ?? 'no output'}` } };
  }
  // The per-turn hook (gbrain#7489 at 10949a15): setup's --json names it under turn_hook; its files are the OpenClaw plugin under
  // state/ and the Hermes config.yaml and allowlist under home/. Instruction files (AGENTS.md, SOUL.md) must carry the block; hook
  // files carry the rule text instead and are checked against setup's own account of them.
  const doc = (() => { const line = r.stdout.split('\n').find((l) => l.trim().startsWith('{')); try { return line ? JSON.parse(r.stdout.slice(r.stdout.indexOf(line))) as { turn_hook?: { action?: string; path?: string; detail?: string; commands?: string[]; snippet?: string } } : {}; } catch { return {}; } })();
  const isHook = (f: string) => harness === 'openclaw' ? f.startsWith('state/') : f === 'home/config.yaml' || f === 'home/shell-hooks-allowlist.json';
  const hookFiles = changed.filter(isHook);
  const instructionFiles = changed.filter((f) => !isHook(f));
  if (!instructionFiles.length) throw new Error(`gbrain setup ${harness} --instructions-only wrote only hook files (${changed.join(', ')}) and no instruction file`);
  const bodies = instructionFiles.map((f) => readFileSync(join(root, f), 'utf8'));
  const without = instructionFiles.filter((_, i) => !bodies[i]!.includes(INSTALLER_BLOCK_BEGIN));
  if (without.length) throw new Error(`gbrain setup ${harness} --instructions-only changed ${without.join(', ')} without writing the brain-first block (${INSTALLER_BLOCK_BEGIN})`);
  if (hookFiles.length && !doc.turn_hook) throw new Error(`gbrain setup ${harness} --instructions-only wrote hook files (${hookFiles.join(', ')}) but its --json has no turn_hook`);
  if (doc.turn_hook && ['write', 'print'].includes(doc.turn_hook.action ?? '') && !hookFiles.length) throw new Error(`gbrain setup ${harness} --instructions-only reports turn_hook ${doc.turn_hook.action} but wrote no hook file under ${root}`);
  if (doc.turn_hook && harness === 'openclaw' && !(doc.turn_hook.commands?.length)) throw new Error(`gbrain setup openclaw --instructions-only wrote the turn plugin but printed no install commands (turn_hook.commands); the adapter needs them`);
  const expectedHook = harness === 'openclaw' ? ['state/gbrain/gbrain-turn-rule/index.js', 'state/gbrain/gbrain-turn-rule/openclaw.plugin.json', 'state/gbrain/gbrain-turn-rule/package.json'] : ['home/config.yaml', 'home/shell-hooks-allowlist.json'];
  if (hookFiles.length && [...hookFiles].sort().join(',') !== expectedHook.join(',')) throw new Error(`gbrain setup ${harness} --instructions-only wrote hook files ${hookFiles.sort().join(', ')}; this bundle expects ${expectedHook.join(', ')}`);
  const rule = !hookFiles.length ? undefined : harness === 'openclaw'
    ? JSON.parse(/const RULE = (".*");/.exec(readFileSync(join(root, 'state/gbrain/gbrain-turn-rule/index.js'), 'utf8'))?.[1] ?? '""') as string
    : hermesHookRule(JSON.parse(/command: (".*")/.exec(readFileSync(join(root, 'home/config.yaml'), 'utf8'))?.[1] ?? '""') as string);
  const unOut = (s: string) => s.split(`${out}/`).join('<out>/');
  const version = bodies.map((b) => /<!-- gbrain brain-first (v[0-9]+):/.exec(b)?.[1]).find((v): v is string => !!v) ?? null;
  const files = changed.map((f) => `${harness}/installer/${f}`);
  const relArgs = args.map((a) => (a.startsWith(out) ? `<out>${a.slice(out.length)}` : a));
  const turn_hook = doc.turn_hook && hookFiles.length ? { files: hookFiles.map((f) => `${harness}/installer/${f}`), action: doc.turn_hook.action ?? 'unknown', detail: unOut(doc.turn_hook.detail ?? ''), ...(doc.turn_hook.commands ? { commands: doc.turn_hook.commands.map(unOut) } : {}), ...(rule ? { rule } : {}) } : undefined;
  log(`${harness}: gbrain setup ${harness} --instructions-only wrote ${files.join(', ')} (block ${version ?? 'version unknown'}${turn_hook ? `, per-turn hook ${turn_hook.action}: ${turn_hook.detail}` : ', no per-turn hook'})${seed ? `, home seeded with Hermes SOUL.md ${seed.sha256.slice(0, 12)} (${seed.bytes} bytes)` : ''}`);
  return { record: { argv: ['gbrain', ...relArgs], files, block_version: version, ...(turn_hook ? { turn_hook } : {}), ...(seed ? { seed } : {}) }, command: { harness, install: 'gbrain-installer', argv: ['gbrain', ...relArgs] } };
}

/** What gbrain setup <harness> --instructions-only writes for Claude Code and Codex (gbrain#7989), relative to HOME: the instruction
 *  file with the block, the turn-rule hook files, and the variables naming the harness's config dir under HOME. Beside them setup
 *  records the block in the ledger the hook reads its rule from (BRAIN_FIRST_LEDGER). */
const STATE_INSTALL: Record<'claude-code' | 'codex', { instructions: string; hook: string[]; env: (state: string) => Record<string, string> }> = {
  'claude-code': { instructions: 'claude/CLAUDE.md', hook: ['claude/settings.json'], env: (state) => ({ CLAUDE_CONFIG_DIR: join(state, 'claude') }) },
  codex: { instructions: 'codex/AGENTS.md', hook: ['codex/config.toml', 'codex/hooks.json'], env: (state) => ({ CODEX_HOME: join(state, 'codex') }) },
};
export const BRAIN_FIRST_LEDGER = '.gbrain/agent-instructions.json';
/** The line gbrain's hook appends on every run (its own check at setup included); runtime state, never bundled. */
export const HOOK_HEARTBEAT = '.gbrain/integrations/hooks/heartbeat.jsonl';
/** The lock gbrain setup holds while it updates its instruction ledgers (gbrain#8491, issue #8484); runtime state, never bundled. */
export const GBRAIN_LEDGER_LOCK = '.gbrain/agent-instructions.lock';

/** The command of the turn-rule hook setup wrote: Claude Code's marked UserPromptSubmit entry, Codex's UserPromptSubmit group whose
 *  command carries the turn-rule lane. */
export function turnRuleCommand(harness: 'claude-code' | 'codex', home: string): string | null {
  const file = join(home, harness === 'claude-code' ? 'claude/settings.json' : 'codex/hooks.json');
  if (!existsSync(file)) return null;
  const groups = (JSON.parse(readFileSync(file, 'utf8')) as { hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string; _gbrain?: string }> }> } }).hooks?.UserPromptSubmit ?? [];
  const entries = groups.flatMap((g) => g.hooks ?? []);
  const ours = entries.filter((e) => typeof e.command === 'string' && (harness === 'claude-code' ? e._gbrain === 'turn-rule-v1' : e.command.includes('GBRAIN_HOOK_LANE=turn-rule')));
  return ours.length === 1 ? ours[0]!.command! : null;
}

/** The Claude Code and Codex installer: gbrain setup <harness> --instructions-only run the way the harness's user would run it in the
 *  harness container (HOME the harness state dir, the config dir under it, gbrain at HOME/.local/bin/gbrain running its own setup), because the hook
 *  command, the ledger and Codex's trust key all name absolute paths and the adapter copies them unchanged. Setup checks the hook
 *  itself (it runs the command and expects the rule back) and exits non-zero when it does not load, which is recorded unavailable
 *  with gbrain's words. The files setup wrote, Claude Code's merged settings.json and the binary are copied under
 *  <out>/<harness>/installer/home/, the hook's output is kept as the rule, and the state dir is removed. */
function buildStateInstaller(o: BuildInstallOptions, out: string, harness: 'claude-code' | 'codex', log: (line: string) => void): { record: InstallerRecord | { unavailable: string }; command?: InstallManifest['commands'][number] } {
  const root = join(out, harness, 'installer');
  rmSync(root, { recursive: true, force: true });
  if (!o.gbrainBin || !existsSync(o.gbrainBin)) return { record: { unavailable: `no compiled gbrain (--gbrain-bin); the ${harness} turn hook runs gbrain inside the harness container` } };
  if (harness === 'claude-code' && (!o.claudeSettings || !existsSync(o.claudeSettings))) return { record: { unavailable: 'no Claude Code settings seed (--claude-settings): the settings.json the adapter writes, which setup merges its hook into' } };
  const state = resolve(o.harnessState ?? HARNESS_STATE_DIR);
  if (existsSync(state) && readdirSync(state).length) throw new Error(`the harness state dir ${state} is not empty; gbrain setup ${harness} must run in a fresh one`);
  const spec = STATE_INSTALL[harness];
  const bin = join(state, HOOK_GBRAIN_BIN);
  try {
    mkdirSync(dirname(bin), { recursive: true });
    copyFileSync(o.gbrainBin, bin);
    chmodSync(bin, 0o755);
    mkdirSync(dirname(join(state, spec.instructions)), { recursive: true });
    let seed: InstallerRecord['seed'];
    if (harness === 'claude-code') {
      const body = readFileSync(o.claudeSettings!);
      writeFileSync(join(state, 'claude/settings.json'), body);
      seed = { source: o.claudeSettings!, sha256: sha256(body), bytes: body.length };
    }
    // keylessEnv names GBRAIN_HOME for the brain builds; a user's install sets none, so the hook command carries none and gbrain's home is HOME/.gbrain.
    const { GBRAIN_HOME: _home, ...base } = keylessEnv(state);
    const env = { ...base, ...spec.env(state) };
    const args = ['setup', harness, '--instructions-only', '--gbrain-bin', bin, '--json'];
    const before = new Map(listFiles(state).map((f) => [f, sha256(readFileSync(join(state, f)))]));
    // The installed gbrain runs its own setup, as `gbrain setup` from the user's PATH would (bun run from source would also leave its
    // transpiler cache under HOME).
    const r = spawnSync(bin, args, { env, cwd: state, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
    let doc: { instructions?: { action?: string }; turn_hook?: { action?: string; detail?: string }; turn_hook_check?: { ok?: boolean; message?: string }; error?: { message?: string } } = {};
    try { doc = JSON.parse(r.stdout.trim()) as typeof doc; } catch { /* no JSON document: the exit status and the output speak */ }
    const said = (r.stderr + r.stdout).trim().split('\n').filter(Boolean);
    if (r.status !== 0) return { record: { unavailable: `gbrain setup ${harness} --instructions-only ${r.status === null ? `was stopped (${r.signal ?? 'no exit'}, 300 s timeout)` : `exited ${r.status}`}: ${(doc.turn_hook_check?.ok === false ? doc.turn_hook_check.message : doc.error?.message ?? said.find((l) => /error|refus|unknown|not active/i.test(l)) ?? said[0])?.trim().slice(0, 300) ?? 'no output'}` } };
    rmSync(join(state, HOOK_HEARTBEAT), { force: true });
    // From gbrain#8491 setup holds a flock on HOME/.gbrain/agent-instructions.lock while it updates its instruction ledgers, and leaves
    // the file (gbrain correctly does not unlink a lock file another install may be waiting on). Like Hermes's allowlist lock
    // (gbrain#7989), it is runtime state, not an install file, so it is dropped here when present. Earlier commits write no lock.
    if (existsSync(join(state, GBRAIN_LEDGER_LOCK))) {
      rmSync(join(state, GBRAIN_LEDGER_LOCK));
      log(`${harness}: dropped gbrain's instruction-ledger lock ${GBRAIN_LEDGER_LOCK} from the installer view (runtime state, not an install file)`);
    }
    const changed = listFiles(state).filter((f) => before.get(f) !== sha256(readFileSync(join(state, f))));
    if (!changed.length) return { record: { unavailable: `gbrain setup ${harness} --instructions-only exited 0 and wrote nothing: ${said.at(-1)?.trim().slice(0, 300) ?? 'no output'}` } };
    if (doc.turn_hook && doc.turn_hook.action !== 'write') throw new Error(`gbrain setup ${harness} --instructions-only reports turn_hook ${doc.turn_hook.action}: ${doc.turn_hook.detail ?? ''}; with an absolute --gbrain-bin it writes the hook`);
    // A hook file that existed before (Claude Code's seeded settings.json) is backed up beside itself as <file>.bak before setup rewrites it.
    // From gbrain#8424 setup also writes the hook launcher, which the hook command runs (checked below).
    const launcherWritten = changed.includes(HOOK_LAUNCHER);
    const expected = [BRAIN_FIRST_LEDGER, spec.instructions, ...(doc.turn_hook ? [...spec.hook, ...spec.hook.filter((f) => before.has(f)).map((f) => `${f}.bak`), ...(launcherWritten ? [HOOK_LAUNCHER] : [])] : [])].sort();
    if (changed.join(',') !== expected.join(',')) throw new Error(`gbrain setup ${harness} --instructions-only wrote ${changed.join(', ')}; this bundle expects ${expected.join(', ')}`);
    const block = readFileSync(join(state, spec.instructions), 'utf8');
    if (!block.includes(INSTALLER_BLOCK_BEGIN)) throw new Error(`gbrain setup ${harness} --instructions-only wrote ${spec.instructions} without the brain-first block (${INSTALLER_BLOCK_BEGIN})`);
    let rule: string | null = null;
    if (doc.turn_hook) {
      // The rule as the hook prints it on a turn, run the way setup's own check runs it (from HOME, an empty prompt).
      const command = turnRuleCommand(harness, state);
      if (!command) throw new Error(`gbrain setup ${harness} --instructions-only reports a turn hook but ${spec.hook.join(', ')} holds no single turn-rule entry`);
      // Every command in the files setup wrote that starts gbrain through a launcher (the turn-rule hook from gbrain#8424; from gbrain#8437
      // also any other hook lane or stdio MCP entry setup writes there) must name this one, and a launcher setup wrote must be named.
      const named = [...new Set(spec.hook.flatMap((f) => readFileSync(join(state, f), 'utf8').match(LAUNCHER_PATH) ?? []))];
      if ((named.length > 0) !== launcherWritten || named.some((l) => l !== join(state, HOOK_LAUNCHER))) throw new Error(`${spec.hook.join(', ')} ${named.length ? `start gbrain through ${named.join(', ')}` : 'start gbrain through no hook launcher'}, and setup ${launcherWritten ? 'wrote' : 'did not write'} ${join(state, HOOK_LAUNCHER)}; the view keeps the launcher only where the commands it carries run it`);
      const h = spawnSync('sh', ['-c', command], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '', session_id: 'he-build-install' }), env: { PATH: env.PATH!, HOME: state, ...spec.env(state) }, cwd: state, encoding: 'utf8', timeout: 60_000 });
      try { rule = (JSON.parse(h.stdout.trim()) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? null; } catch { rule = null; }
      if (h.status !== 0 || !rule) throw new Error(`the ${harness} turn-rule hook ${command} exited ${h.status} without the rule: ${(h.stdout + h.stderr).trim().slice(0, 300)}`);
      rmSync(join(state, HOOK_HEARTBEAT), { force: true });
    }
    const kept = [...changed, HOOK_GBRAIN_BIN].sort();
    // The other harness's view may already hold the same 207 MB gbrain: link it rather than keep a second copy in the image.
    const sibling = join(out, harness === 'codex' ? 'claude-code' : 'codex', 'installer', 'home', HOOK_GBRAIN_BIN);
    for (const f of kept) {
      const dest = join(root, 'home', f);
      mkdirSync(dirname(dest), { recursive: true });
      if (f === HOOK_GBRAIN_BIN && existsSync(sibling) && sha256(readFileSync(sibling)) === sha256(readFileSync(join(state, f)))) linkSync(sibling, dest);
      else copyFileSync(join(state, f), dest);
    }
    chmodSync(join(root, 'home', HOOK_GBRAIN_BIN), 0o755);
    if (launcherWritten) chmodSync(join(root, 'home', HOOK_LAUNCHER), 0o755);
    const files = kept.map((f) => `${harness}/installer/home/${f}`);
    const version = /<!-- gbrain brain-first (v[0-9]+):/.exec(block)?.[1] ?? null;
    const turn_hook = doc.turn_hook ? { files: [...spec.hook, ...(launcherWritten ? [HOOK_LAUNCHER] : [])].sort().map((f) => `${harness}/installer/home/${f}`), action: doc.turn_hook.action!, detail: doc.turn_hook.detail ?? '', rule } : undefined;
    log(`${harness}: gbrain setup ${harness} --instructions-only in ${state} wrote ${changed.join(', ')} (block ${version ?? 'version unknown'}${turn_hook ? `, per-turn hook ${turn_hook.action}: ${turn_hook.detail}` : ', no per-turn hook'}); the bundle keeps them and ${HOOK_GBRAIN_BIN}`);
    return { record: { argv: ['gbrain', ...args], files, block_version: version, ...(turn_hook ? { turn_hook } : {}), ...(seed ? { seed } : {}), state_root: state, gbrain_bin: bin }, command: { harness, install: 'gbrain-installer', argv: ['gbrain', ...args] } };
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
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

  for (const harness of INSTALLER_HARNESSES) {
    const built = buildInstaller(o, out, harness, log);
    if (harness === 'claude-code' || harness === 'codex') harnesses[harness] = { installer: built.record };
    else harnesses[harness].installer = built.record;
    if (built.command) commands.push(built.command);
    else log(`${harness}: installer unavailable at this gbrain commit: ${(built.record as { unavailable: string }).unavailable}`);
  }

  const files = fileEntries(out, listFiles(out));
  const version = run([...o.gbrain, '--version'], scaffoldEnv, 'gbrain --version').stdout.trim().match(/\d+\.\d+\.\d+(\.\d+)?/)?.[0] ?? null;
  const manifest: InstallManifest = { schema_version: 1, gbrain_commit: o.commit, gbrain_version: version, built_with: 'gbrain/build-install.ts', commands, harnesses, files, digest: bundleDigest(files) };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  rmSync(o.scratch, { recursive: true, force: true });
  return manifest;
}

/** The files of one harness and split view of the bundle: for gbrain-docs the harness's workspace and, for Hermes, that split's
 *  .hermes.md; for gbrain-installer everything under <harness>/installer/ (the same bytes for both splits). */
export function viewFiles(manifest: InstallManifest, harness: InstallerHarness, split: 'dev' | 'heldout', install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs'): InstallFile[] {
  if (install === 'gbrain-installer') return manifest.files.filter((f) => f.path.startsWith(`${harness}/installer/`));
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
      hermesSoul: arg('hermes-soul'),
      hermesCommit: arg('hermes-commit'),
      gbrainBin: arg('gbrain-bin'),
      claudeSettings: arg('claude-settings'),
      harnessState: arg('harness-state'),
    });
    console.log(JSON.stringify({ files: m.files.length, digest: m.digest, installer: Object.fromEntries(INSTALLER_HARNESSES.map((h) => { const i = m.harnesses[h]?.installer; return [h, i && 'files' in i ? { ...i, files: i.files.length } : 'unavailable']; })), openclaw: { skills: m.harnesses.openclaw.skills, files: m.harnesses.openclaw.files }, hermes: { skills: m.harnesses.hermes.skills, files: m.harnesses.hermes.files, context: Object.fromEntries(Object.entries(m.harnesses.hermes.context!).map(([s, c]) => [s, { bytes: c.bytes, kept: c.kept_slugs.length, tokens: c.tokens }])) }, gbrain_version: m.gbrain_version }));
  } catch (e) {
    console.error(`build-install failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
