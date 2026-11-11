#!/usr/bin/env bun
// The gstack arms of the frontier Harbor path (internal-task): spec parsing, the in-container layout, the builder, the lock
// check and the per-cell manifest agents.py installs from.
//
//   bun scripts/frontier-harbor/gstack-arm.ts singles --commit <40 hex> --out <run folder> [--hosts claude,codex,hermes]
//       [--work <dir>] [--all-locks]
//
// gstack-build.ts, beside plan.ts, is vm-run.sh's step before any lease: for every gstack cell of the shard it builds the arm the way a user
// installs gstack (the pinned checkout, bun install --frozen-lockfile, ./setup --host <h> --no-browser, then
// gstack-modules render of the arm's spec) inside a docker builder whose HOME is the task container's, checks the lock
// against the preregistered one, checks that every absolute path the tree names resolves inside what the container will
// hold, and writes <run>/gstack/cells/<cell>.json, the manifest agents.py reads. A lock mismatch exits HE-FRONTIER-009;
// a gstack refusal, a failed builder or an unresolved path exits HE-FRONTIER-008. Both print the message on stderr, and
// nothing else runs. singles renders full, none and every single removal per host at a pin and writes <out>/skills.json
// and the full and none locks under <out>/locks/<host>/ (gstack-singles.ts).
//
// Arms: none (nothing installed), full, diet and minus-<skill>. Specs: none, full, or full,-skill:<dir>,... with the
// removed dirs distinct and sorted. minus-<skill> is exactly full,-skill:<skill>; diet removes at least one skill.
// spec_sha256 is sha256 of the spec text, gstack's own rule (scripts/modules.ts selectModules). gstack writes null for
// full; this file uses the same rule there.
//
// In-container layout (home is the agent's HOME, /root on the pinned tasks):
//   runtime  <home>/.bun/bin/bun (and /usr/local/bin/bun), <home>/.local/share/gstack (the checkout after ./setup),
//            <home>/.gstack (state: telemetry off, update_check false, artifacts_sync_mode off)
//   claude   the render is the skills root, <home>/.claude/skills, router copied to gstack/SKILL.md; Harbor's
//            skills_dir is the same folder, and Harbor copies it to $CLAUDE_CONFIG_DIR/skills
//   codex    the render at <home>/.gstack/arms/codex; skills_dir <home>/.gstack/arms/codex/.agents/skills, which
//            Harbor copies to $HOME/.agents/skills (Harbor's CODEX_HOME is /tmp/codex-home)
//   hermes   the render at <home>/.gstack/arms/hermes; skills_dir <home>/.gstack/arms/hermes-skills, holding the one
//            gstack category, which Harbor copies to /tmp/hermes/skills (HERMES_HOME=/tmp/hermes)
// Every render takes --install-root <home>/.local/share/gstack, so each skill's commands call the checkout.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { GSTACK_HOSTS, lockSkills, skillDir, type GstackHost, type Lock } from './gstack-names.ts';

const REPO = resolve(import.meta.dir, '../..');
const HERE = import.meta.dir;
export const SPEC_CODE = 'HE-FRONTIER-005';
export const LOCK_CODE = 'HE-FRONTIER-009';
export const REFUSAL_CODE = 'HE-FRONTIER-008';
export const HOST_OF: Record<string, GstackHost> = { 'claude-code': 'claude', codex: 'codex', hermes: 'hermes' };
const SKILL = /^[a-z0-9][a-z0-9-]*$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
export const SIDE_EFFECTS = 'Side effects: none (no lease opened, no model call); fix the spec or the pin in a new preregistration or a dated amendment and rerun.';

export interface GstackPin { repo: string; commit: string }
export interface CellGstack { arm: string; spec: string; lock: string; spec_sha256: string }
export interface Runtime {
  repo_url: string;
  bun: { version: string; asset: string; sha256: string };
  builder_base: string;
  home: string;
  render: { plan_mode: string; models: Record<GstackHost, string> };
  eval_env: Record<string, string>;
}
export interface Layout {
  home: string; host: GstackHost;
  tree: string; skills_dir: string; harbor_target: string;
  checkout: string; bun: string; state: string;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const specFail = (m: string): never => { throw new RunnerError(SPEC_CODE, m); };

export function loadRuntime(): Runtime {
  return JSON.parse(readFileSync(join(HERE, 'gstack-runtime.json'), 'utf8')) as Runtime;
}

/** The skills a spec removes: [] for full, null for none. Refuses any other shape (HE-FRONTIER-005). */
export function parseSpec(spec: string): string[] | null {
  if (spec === 'none') return null;
  if (spec === 'full') return [];
  const [base, ...edits] = String(spec).split(',');
  if (base !== 'full' || !edits.length) return specFail('gstack spec ' + JSON.stringify(spec) + ' must be none, full or full,-skill:<dir>,...');
  const removed = edits.map((e) => (e.startsWith('-skill:') && SKILL.test(e.slice(7)) ? e.slice(7) : specFail('gstack spec ' + JSON.stringify(spec) + ': ' + JSON.stringify(e) + ' is not -skill:<dir>')));
  if (new Set(removed).size !== removed.length) specFail('gstack spec ' + spec + ' removes a skill twice');
  if (removed.join(',') !== [...removed].sort().join(',')) specFail('gstack spec ' + spec + ': list the removed skills in sorted order (' + [...removed].sort().join(',') + ')');
  return removed;
}

export const specSha256 = (spec: string) => sha256(spec);

/** Refuses an arm id that does not fit its spec. */
export function checkArm(arm: string, spec: string): void {
  const removed = parseSpec(spec);
  const ok = arm === 'none' ? removed === null
    : arm === 'full' ? removed !== null && !removed.length
    : arm === 'diet' ? !!removed?.length
    : arm.startsWith('minus-') ? removed?.length === 1 && removed[0] === arm.slice(6)
    : false;
  if (!ok) specFail('gstack arm ' + JSON.stringify(arm) + ' does not fit spec ' + JSON.stringify(spec) + ' (none: none, full: full, minus-<skill>: full,-skill:<skill>, diet: full minus at least one skill)');
}

export function checkPin(pin: unknown): GstackPin {
  const p = pin as GstackPin | undefined;
  if (!p || p.repo !== 'garrytan/gstack' || !HEX40.test(p.commit ?? '')) return specFail('gstack_pin must be { "repo": "garrytan/gstack", "commit": "<40 hex>" }');
  return p;
}

/** gstack writes spec_sha256 null for full; the arm's hash is then sha256 of the spec, gstack's own rule. */
export const armSha = (lock: Lock) => lock.spec_sha256 ?? specSha256(lock.spec);

/** A cell's gstack block, checked against its harness and its lock file (read from the repository). */
export function checkCellGstack(cellId: string, harness: string, g: CellGstack, pin: GstackPin | undefined): Lock {
  const bad = (m: string): never => specFail('cell ' + cellId + ': gstack ' + m);
  if (!pin) bad('needs the preregistration\'s top-level gstack_pin');
  const host = HOST_OF[harness] ?? bad('arms run on claude-code, codex or hermes cells, not ' + harness);
  if (typeof g?.arm !== 'string' || typeof g.spec !== 'string') bad('needs arm and spec');
  checkArm(g.arm, g.spec);
  if (!HEX64.test(g.spec_sha256 ?? '')) bad('spec_sha256 must be 64 hex');
  if (specSha256(g.spec) !== g.spec_sha256) bad('spec_sha256 ' + g.spec_sha256 + ' is not sha256 of the spec ' + g.spec + ' (' + specSha256(g.spec) + ')');
  if (typeof g.lock !== 'string' || !g.lock.endsWith('locks/' + host + '/' + g.arm + '.lock.json')) bad('lock must be a repo path ending in locks/' + host + '/' + g.arm + '.lock.json');
  const path = resolve(REPO, g.lock);
  if (!existsSync(path)) bad('lock ' + g.lock + ' not found');
  const lock = JSON.parse(readFileSync(path, 'utf8')) as Lock;
  if (lock.spec !== g.spec) bad('lock ' + g.lock + ' is for spec ' + lock.spec + ', not ' + g.spec);
  if (armSha(lock) !== g.spec_sha256) bad('lock ' + g.lock + ' has spec_sha256 ' + armSha(lock) + ', not ' + g.spec_sha256);
  if (lock.host !== host) bad('lock ' + g.lock + ' is a ' + lock.host + ' lock, not ' + host);
  return lock;
}

export function noneLock(host: GstackHost): Lock {
  return { schema_version: 1, loadout: 'none', spec: 'none', spec_sha256: specSha256('none'), host, model: null, install_root: null, plan_mode: false, gstack_version: null, excluded: [], total_bytes: 0, files: [] };
}

export function layout(host: GstackHost, home: string): Layout {
  if (!/^\/[A-Za-z0-9_.@+/-]*$/.test(home) || home.endsWith('/')) specFail('HOME ' + JSON.stringify(home) + ' must be a plain absolute path');
  const base = { home, host, checkout: home + '/.local/share/gstack', bun: home + '/.bun/bin/bun', state: home + '/.gstack' };
  if (host === 'claude') return { ...base, tree: home + '/.claude/skills', skills_dir: home + '/.claude/skills', harbor_target: '$CLAUDE_CONFIG_DIR/skills' };
  if (host === 'codex') return { ...base, tree: home + '/.gstack/arms/codex', skills_dir: home + '/.gstack/arms/codex/.agents/skills', harbor_target: '$HOME/.agents/skills' };
  return { ...base, tree: home + '/.gstack/arms/hermes', skills_dir: home + '/.gstack/arms/hermes-skills', harbor_target: '/tmp/hermes/skills' };
}

/** Every file the published arm holds in the container: the lock's files under the tree, plus the router copy (claude)
 *  and the category copy (hermes) build.sh makes. Absolute container paths with their sha256. */
export function publishedFiles(lock: Lock, l: Layout): Array<{ path: string; sha256: string }> {
  const out = lock.files.map((f) => ({ path: l.tree + '/' + f.path, sha256: f.sha256 }));
  if (l.host === 'claude') {
    const router = lock.files.find((f) => f.path === 'SKILL.md');
    if (router) out.push({ path: l.tree + '/gstack/SKILL.md', sha256: router.sha256 });
  }
  if (l.host === 'hermes') {
    for (const f of lock.files) if (f.path.startsWith('.hermes/skills/')) out.push({ path: l.skills_dir + '/gstack/' + f.path.slice('.hermes/skills/'.length), sha256: f.sha256 });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The SKILL.md paths Harbor's copy must leave in the host's skills folder, relative to harbor_target. */
export function harborSkillFiles(lock: Lock, host: GstackHost): string[] {
  return lockSkills(lock).map((s) => (host === 'hermes' ? 'gstack/' : '') + skillDir(s, host) + '/SKILL.md').sort();
}

/** HE-FRONTIER-009 unless the rendered lock is the preregistered one, field for field and file for file. */
export function checkLock(expected: Lock, actual: Lock, cell: { arm: string; spec: string; spec_sha256: string }): void {
  const head = 'gstack arm ' + cell.arm + ' (spec ' + cell.spec + '): the rendered lock does not match the preregistered lock: expected spec_sha256 ' + cell.spec_sha256 + ', actual ' + armSha(actual);
  const fail = (what: string): never => { throw new RunnerError(LOCK_CODE, head + '; ' + what + '. ' + SIDE_EFFECTS); };
  if (armSha(expected) !== cell.spec_sha256) fail('the preregistered lock itself has spec_sha256 ' + armSha(expected));
  if (armSha(actual) !== cell.spec_sha256) fail('spec ' + JSON.stringify(actual.spec) + ' was rendered');
  const want = new Map(expected.files.map((f) => [f.path, f.sha256]));
  const got = new Map(actual.files.map((f) => [f.path, f.sha256]));
  for (const p of [...new Set([...want.keys(), ...got.keys()])].sort()) {
    if (want.get(p) !== got.get(p)) fail('first differing file ' + p + ': expected ' + (want.get(p) ?? 'absent') + ', actual ' + (got.get(p) ?? 'absent'));
  }
  for (const k of ['host', 'model', 'install_root', 'plan_mode', 'gstack_version'] as const) {
    if (JSON.stringify(expected[k] ?? null) !== JSON.stringify(actual[k] ?? null)) fail('no file differs, but ' + k + ' does: expected ' + JSON.stringify(expected[k] ?? null) + ', actual ' + JSON.stringify(actual[k] ?? null));
  }
}

/** HE-FRONTIER-008 for a gstack refusal: gstack's own code and message, with the arm id. */
export function refusal(arm: string, spec: string, stderr: string, exit: number): RunnerError {
  const line = stderr.split('\n').find((l) => /^[A-Z][A-Z_]+: /.test(l)) ?? stderr.trim().split('\n')[0] ?? '';
  return new RunnerError(REFUSAL_CODE, 'gstack arm ' + arm + ' (spec ' + spec + '): gstack refused the render (exit ' + exit + '): ' + line.trim() + ' ' + SIDE_EFFECTS);
}

/** The gstack refusal code (MODULE_PINNED, MODULE_EXCLUSION_UNSAFE, ...) at the start of gstack's stderr, if any. */
export const refusalCode = (stderr: string) => /^([A-Z][A-Z_]+): /m.exec(stderr)?.[1] ?? null;

// ---- absolute paths ----------------------------------------------------------------------------------------------

const PATH_TOKEN = /(?:~|\$\{?HOME\}?|\$\{?GSTACK_ROOT\}?|\/(?:root|home|tmp)(?=\/))(?:\/[A-Za-z0-9._@+-]+)*\/?/g;

/** Absolute paths a text names inside the gstack install, with ~, $HOME and $GSTACK_ROOT expanded. Only paths under the
 *  tree, the checkout or the Harbor target count; paths gstack creates at run time (state, projects, /tmp) do not. */
export function namedPaths(text: string, l: Layout): string[] {
  const roots = [l.tree, l.checkout, l.skills_dir, ...(l.host === 'codex' ? [l.home + '/.agents/skills'] : []), ...(l.host === 'hermes' ? ['/tmp/hermes/skills'] : [])];
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_TOKEN)) {
    const p = m[0].replace(/^~|^\$\{?HOME\}?/, l.home).replace(/^\$\{?GSTACK_ROOT\}?/, l.checkout).replace(/[.]+$/, '').replace(/\/$/, '');
    if (roots.some((r) => p === r || p.startsWith(r + '/'))) out.add(p);
  }
  return [...out].sort();
}

function exists(p: string): boolean {
  try { lstatSync(p); return true; } catch { return false; }
}

/** Paths a user's install lacks too, so the arms may name them unresolved: each with the reason. */
export const ALLOWED_ABSENT: Array<{ re: RegExp; reason: string }> = [
  { re: /\/\.local\/share\/gstack\/bin\/gstack-cso-launcher(\.exe)?$/, reason: 'setup builds the CSO launcher only when its build prerequisites are present (setup probe_cso_build_prerequisites); /cso falls back without it' },
  { re: /\/\.local\/share\/gstack\/browse-remote\.json$/, reason: 'written at run time by /pair-agent' },
  { re: /\/\.agents\/skills\/gstack\/(\.git|extension|extension\/manifest\.json|document-release\/SKILL\.md)$/, reason: 'not in setup\'s own .agents/skills/gstack sidecar (create_agents_sidecar) either: probes and links a Codex user install also lacks' },
];

/** Paths the files name that resolve to nothing the container will hold, less ALLOWED_ABSENT. view maps a container
 *  path to the host path that will be uploaded there, or null. */
export function unresolvedPaths(files: Array<{ path: string; text: string }>, l: Layout, view: (p: string) => string | null): Array<{ path: string; in: string }> {
  const bad: Array<{ path: string; in: string }> = [];
  for (const f of files) {
    for (const p of namedPaths(f.text, l)) {
      const host = view(p);
      if ((!host || !exists(host)) && !ALLOWED_ABSENT.some((a) => a.re.test(p))) bad.push({ path: p, in: f.path });
    }
  }
  return bad;
}

// ---- the builder ---------------------------------------------------------------------------------------------------

function run(cmd: string[]): { code: number; out: string; err: string } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
  if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST;
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', env });
  return { code: r.exitCode ?? 1, out: r.stdout.toString(), err: r.stderr.toString() };
}

export function builderTag(pin: GstackPin, rt: Runtime, home: string): string {
  const inputs = [rt.bun, rt.builder_base, rt.repo_url, home, readFileSync(join(HERE, 'gstack-builder/build.sh'), 'utf8'), readFileSync(join(HERE, 'gstack-builder/Dockerfile'), 'utf8')];
  return 'frontier-harbor-gstack-builder:' + pin.commit.slice(0, 12) + '-' + sha256(JSON.stringify(inputs)).slice(0, 12);
}

/** Builds the builder image (once per pin and home) and runs build.sh for one host. Throws HE-FRONTIER-008 on a failure. */
export function buildHost(o: { pin: GstackPin; rt: Runtime; host: GstackHost; home: string; out: string; arms: Array<{ id: string; spec: string; keep: boolean }>; runtime: boolean; log?: string }): void {
  const tag = builderTag(o.pin, o.rt, o.home);
  const log = (s: string) => { if (o.log) { mkdirSync(dirname(o.log), { recursive: true }); writeFileSync(o.log, s, { flag: 'a' }); } };
  if (run(['docker', 'image', 'inspect', tag]).code !== 0) {
    const b = run(['docker', 'build', '-q', '-t', tag, '--build-arg', 'BASE_IMAGE=' + o.rt.builder_base, '--build-arg', 'GSTACK_REPO=' + o.rt.repo_url,
      '--build-arg', 'GSTACK_COMMIT=' + o.pin.commit, '--build-arg', 'BUN_VERSION=' + o.rt.bun.version, '--build-arg', 'BUN_SHA256=' + o.rt.bun.sha256,
      '--build-arg', 'BUILDER_HOME=' + o.home, join(HERE, 'gstack-builder')]);
    log(b.out + b.err);
    if (b.code !== 0) throw new RunnerError(REFUSAL_CODE, 'the gstack builder image for commit ' + o.pin.commit + ' did not build (exit ' + b.code + '): ' + b.err.trim().split('\n').slice(-3).join(' | ') + ' ' + SIDE_EFFECTS);
  }
  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });
  const args = ['--host', o.host, '--model', o.rt.render.models[o.host], '--plan-mode', o.rt.render.plan_mode, '--out', '/out', ...(o.runtime ? ['--runtime'] : []), ...o.arms.flatMap((a) => [a.keep ? '--arm' : '--lock-arm', a.id + '=' + a.spec])];
  const uid = String(process.getuid?.() ?? 0), gid = String(process.getgid?.() ?? 0);
  const r = run(['docker', 'run', '--rm', '-e', 'OUT_UID=' + uid, '-e', 'OUT_GID=' + gid, '-v', resolve(o.out) + ':/out', tag, 'gstack-arm-build', ...args]);
  log(r.out + r.err);
  if (r.code !== 0) throw new RunnerError(REFUSAL_CODE, 'the gstack builder for host ' + o.host + ' failed (exit ' + r.code + '): ' + r.err.trim().split('\n').slice(-3).join(' | ') + ' ' + SIDE_EFFECTS);
}

export type ArmResult = { lock: Lock } | { refusal: string; exit: number };
export function readArm(out: string, id: string, spec: string, host: GstackHost): ArmResult {
  if (spec === 'none') return { lock: noneLock(host) };
  const dir = join(out, 'arms', id);
  if (existsSync(join(dir, 'exit'))) return { refusal: readFileSync(join(dir, 'refusal.txt'), 'utf8'), exit: Number(readFileSync(join(dir, 'exit'), 'utf8')) };
  return { lock: JSON.parse(readFileSync(join(dir, 'loadout.lock.json'), 'utf8')) as Lock };
}

export function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full, base);
    return e.isFile() ? [relative(base, full)] : [];
  }).sort();
}

/** The paths a built arm's tree names that its upload will not provide. */
export function treeUnresolved(out: string, id: string, l: Layout): Array<{ path: string; in: string }> {
  const tree = join(out, 'arms', id, 'tree');
  const files = walk(tree).filter((f) => f.endsWith('.md')).map((f) => ({ path: '/' + f, text: readFileSync(join(tree, f), 'utf8') }));
  const roots = [tree, join(out, 'runtime')];
  const view = (p: string) => {
    if (l.host === 'codex' && p.startsWith(l.home + '/.agents/skills')) p = l.skills_dir + p.slice((l.home + '/.agents/skills').length);
    if (l.host === 'hermes' && p.startsWith('/tmp/hermes/skills')) p = l.skills_dir + p.slice('/tmp/hermes/skills'.length);
    return inBundle(p, roots);
  };
  return unresolvedPaths(files, l, view);
}

/** The SKILL.md files under the arm's published skills folder, following links into the uploads, that are not in
 *  expected (paths relative to the folder): Claude Code reads <name>/SKILL.md one level down; Codex and Hermes list a
 *  SKILL.md at any depth. Node modules and git metadata are not searched. */
export function straySkillFiles(out: string, id: string, l: Layout, expected: string[]): string[] {
  const roots = [join(out, 'arms', id, 'tree'), join(out, 'runtime')];
  const found: string[] = [];
  const visit = (rel: string, depth: number) => {
    const at = inBundle(l.skills_dir + (rel ? '/' + rel : ''), roots);
    if (!at || depth > 12) return;
    for (const name of readdirSync(at)) {
      if (name === 'node_modules' || name === '.git') continue;
      const child = rel ? rel + '/' + name : name;
      const real = inBundle(l.skills_dir + '/' + child, roots);
      if (!real) continue;
      let st;
      try { st = statSync(real); } catch { continue; }
      if (st.isDirectory()) { if (l.host !== 'claude' || depth === 0) visit(child, depth + 1); }
      else if (name === 'SKILL.md' && (l.host !== 'claude' || depth === 1)) found.push(child);
    }
  };
  visit('', 0);
  const want = new Set(expected);
  return found.filter((f) => !want.has(f)).sort();
}

/** The host path a container path will have after the uploads (roots, each mounted at /), following symlinks whose
 *  targets are container paths; null when nothing provides it. */
export function inBundle(p: string, roots: string[], depth = 0): string | null {
  if (depth > 16) return null;
  const parts = p.split('/').filter(Boolean);
  for (const root of roots) {
    let at = root;
    for (let i = 0; i < parts.length; i++) {
      at = at + '/' + parts[i];
      let st;
      try { st = lstatSync(at); } catch { at = ''; break; }
      if (st.isSymbolicLink()) {
        const target = readlinkSync(at);
        const rest = parts.slice(i + 1).join('/');
        const next = target.startsWith('/') ? target : '/' + parts.slice(0, i).join('/') + '/' + target;
        return inBundle(next + (rest ? '/' + rest : ''), roots, depth + 1);
      }
    }
    if (at) return at;
  }
  return null;
}

/** The manifest agents.py installs a cell's arm from. */
export interface Manifest {
  schema: 'frontier-harbor-gstack-arm/1';
  cell: string; arm: string; spec: string; spec_sha256: string; lock: string; host: GstackHost;
  gstack_commit: string; gstack_version: string | null; bun_version: string | null;
  home: string; layout: Layout | null;
  uploads: Array<{ src: string; dst: string }>;
  files: Array<{ path: string; sha256: string }>;
  harbor_skill_files: string[];
  expected_skills: string[];
  unlisted: string[];
  expected_listed: string[];
  eval_env: Record<string, string>;
  absent: string[];
}

/** The paths the none arm's container must not have (CREW.md "Clean no-gstack and no-brain arms"). A trailing * matches
 *  any name with that prefix: Codex installs gstack's skills as ~/.agents/skills/gstack-<dir>, Hermes as gstack-<dir>. */
export const ABSENT = (home: string) => [home + '/.claude/skills/gstack', home + '/.local/share/gstack', home + '/.gstack', home + '/.agents/skills/gstack*', home + '/.hermes/skills/gstack*', '/tmp/hermes/skills/gstack*'];

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const need = (n: string) => flag(n) ?? specFail(cmd + ' needs ' + n);
  try {
    if (cmd === 'singles') {
      const { singles } = await import('./gstack-singles.ts');
      singles({ commit: need('--commit'), out: resolve(need('--out')), hosts: (flag('--hosts') ?? GSTACK_HOSTS.join(',')).split(',') as GstackHost[], work: flag('--work'), allLocks: argv.includes('--all-locks') });
    } else specFail('usage: gstack-arm.ts singles (see the header); the build step is gstack-build.ts');
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(e.exit); }
    throw e;
  }
}
