/**
 * internal-task, the instruction routes of the OpenClaw and Hermes adapters (harnesses/routes/README.md). The cell's config reaches
 * each adapter as HE_HARNESS_CONFIG; route-tool, route-system, route-startup, route-hook and route-skill deliver one instruction
 * text, harnesses/routes/instruction.md, through a different carrier, and unset, empty or "default" must leave the adapter
 * exactly as it was. Keyless and without docker or the images: each adapter runs on this host under a scrubbed environment with
 * the CLI stand-ins in tests/fixtures/openai-branch/stub/ first on PATH (they answer --version, the mcp, plugins and hooks
 * commands and record every invocation in stub-calls.jsonl), and every file the adapter leaves under the trial's workspace,
 * state, logs and turns directories is compared byte for byte (timestamps, the trial root and the adapter's own sha256
 * normalised).
 *
 * 1. Default: for every harness, entry and default spelling, and with HE_GBRAIN_INSTALL=gbrain-docs and gbrain-installer (the
 *    committed installer views of run gbrain-installer-hook-2026-10, per-turn hook included), the tree and every recorded CLI
 *    command line equal what the adapter at BASE (31a109a9c, main when internal-task-a started) leaves, apart from internal-task-b's cell
 *    model in every model-valued config default (sinceBase).
 * 2. Each route writes exactly its intended bytes and nothing else, records them in instruction-route.json and names the route
 *    in ready.
 * 3. Refusals: an unknown config, OpenClaw route-system (no such setting at 2026.10.6), OpenClaw route-hook on the run entry, a
 *    route-hook plugin or shell hook that does not load, a tampered instruction file, an existing destination, and a Hermes
 *    SOUL.md that is not the seed each exit 2 with HE-ADAPTER-007 and no ready file.
 *
 * Files under test: harnesses/openclaw/adapter.sh, harnesses/hermes/adapter.sh, harnesses/routes/instruction.md,
 * harnesses/routes/README.md, harnesses/openclaw/routes/instruction.md, harnesses/hermes/routes/instruction.md,
 * harnesses/openclaw/routes/he-instruction-route/index.js, harnesses/openclaw/routes/he-instruction-route/openclaw.plugin.json,
 * harnesses/openclaw/routes/he-instruction-route/package.json, harnesses/openclaw/Dockerfile, harnesses/hermes/Dockerfile,
 * tests/fixtures/openai-branch/stub/openclaw, tests/fixtures/openai-branch/stub/hermes.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { withCellModelDefaults } from './fixtures/model-defaults.ts';
import { withTextImageMode } from './fixtures/hermes-image-mode.ts';
import { parseTask } from '../runner/grade/task.ts';
import { stream, toolNames } from './fixtures/fake-responses.ts';
import { bundleSha256 } from '../scripts/routes/slot-check.ts';
import { world } from './world-helpers.ts';
import { codelessFiles } from './fixtures/export-codes.ts';

const ROOT = join(import.meta.dir, '..');
const BASE = '31a109a9c';
const STUB_DIR = join(import.meta.dir, 'fixtures', 'openai-branch', 'stub');
const INSTALLER_RESULTS = join(ROOT, 'docs', 'benchmarks', '2026-10-25-gbrain-installer-hook', 'results');
type Harness = 'openclaw' | 'hermes';
type Entry = 'run' | 'serve';
const HARNESSES: Harness[] = ['openclaw', 'hermes'];
const ROUTES = { openclaw: ['route-tool', 'route-startup', 'route-hook', 'route-skill'], hermes: ['route-tool', 'route-system', 'route-startup', 'route-hook', 'route-skill'] } as const;
const INSTRUCTION_FILES = ['harnesses/routes/instruction.md', 'harnesses/openclaw/routes/instruction.md', 'harnesses/hermes/routes/instruction.md'];
const PLUGIN_FILES = ['harnesses/openclaw/routes/he-instruction-route/index.js', 'harnesses/openclaw/routes/he-instruction-route/openclaw.plugin.json', 'harnesses/openclaw/routes/he-instruction-route/package.json'];
const INSTRUCTION = readFileSync(join(ROOT, 'harnesses', 'routes', 'instruction.md'));
const INSTRUCTION_SHA256 = '4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f';
const SKILL_MD = Buffer.concat([Buffer.from('---\nname: brain-first\ndescription: Check GBrain first, before answering any turn.\n---\n\n'), INSTRUCTION, Buffer.from('\n')]);
const SOUL_SEED = readFileSync(join(INSTALLER_RESULTS, 'he-inst.gbrain-install', 'hermes-installer', 'heldout', 'home', 'SOUL.md')).subarray(0, 667);
const NODE = Bun.which('node');
const HAVE_PY = Bun.which('python3') !== null;
/** Hermes route-system parses config.yaml back with PyYAML, which the image's venv python has; the host's python3 may not
 *  (the adapter sets HOME to the state dir, so only a system-wide PyYAML counts). */
const HAVE_YAML = HAVE_PY && spawnSync('python3', ['-s', '-c', 'import yaml'], { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } }).status === 0;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ANTHROPIC_URL = 'http://host.docker.internal:18999/golden/anthropic';
const OPENAI_URL = 'http://host.docker.internal:18999/golden/openai';
const REQUEST = { turn: 1, trial_id: 'routes', prompt: 'Say ok.', actor: { member: 'alice', slack_user_id: 'U0ALICE', name: 'Alice', role: 'engineer', team: null },
  channel: { id: 'D0ALICE', name: 'alice', type: 'dm' }, text: 'Say ok.', ts: '1790000000.000100', thread_ts: null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: 60 };

const tmp = mkdtempSync(join(tmpdir(), 'he-instruction-route-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;

/** harnesses/<h> at BASE, from the committed byte copy in tests/fixtures/adapter-baselines/<BASE> (README.md left out), so the
 *  comparison runs without the private history. Where BASE is reachable, the copy must equal it file for file. */
const BASE_DIR = join(import.meta.dir, 'fixtures', 'adapter-baselines', BASE, 'harnesses');
function baseDir(h: Harness): string {
  return join(BASE_DIR, h);
}

const HAVE_BASE = spawnSync('git', ['cat-file', '-e', BASE + '^{commit}'], { cwd: ROOT }).status === 0;
test.skipIf(!HAVE_BASE)('the adapter baselines in tests/fixtures/adapter-baselines/' + BASE + ' are byte copies of harnesses/ at ' + BASE, () => {
  for (const h of HARNESSES) {
    const want = spawnSync('git', ['ls-tree', '-r', '--name-only', BASE, 'harnesses/' + h], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter((p) => p && !p.endsWith('/README.md'));
    const have: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else have.push(relative(join(BASE_DIR, '..'), p)); } };
    walk(baseDir(h));
    expect(have.sort()).toEqual(want.sort());
    for (const p of want) {
      expect(readFileSync(join(BASE_DIR, '..', p)).equals(spawnSync('git', ['show', BASE + ':' + p], { cwd: ROOT, maxBuffer: 64 << 20 }).stdout)).toBe(true);
      const mode = spawnSync('git', ['ls-tree', BASE, p], { cwd: ROOT, encoding: 'utf8' }).stdout.split(' ')[0];
      expect((statSync(join(BASE_DIR, '..', p)).mode & 0o100) !== 0).toBe(mode === '100755');
    }
  }
});

interface Run { exit: number | null; files: Map<string, Buffer>; ready: Record<string, any> | null; route: Record<string, any> | null; calls: string[][]; root: string; log: string }
interface Opts { harness: Harness; entry: Entry; harnessDir?: string; config?: string; baseUrl?: string; env?: Record<string, string>; seed?: (root: string) => void; pathPrefix?: string; requests?: Array<Record<string, any>> }

/** One adapter run on this host. Serve posts one turn after ready and stops on SIGTERM; run is one turn. */
async function runAdapter(o: Opts): Promise<Run> {
  const root = join(tmp, 'trial-' + ++seq);
  const d = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
  for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
  writeFileSync(join(d.workspace, 'instruction.md'), 'Say ok.\n');
  const harnessDir = o.harnessDir ?? join(ROOT, 'harnesses', o.harness);
  const baseUrl = o.baseUrl ?? ANTHROPIC_URL;
  const version = JSON.parse(readFileSync(join(harnessDir, 'pin.json'), 'utf8')).version as string;
  const env: Record<string, string> = { PATH: [...(o.pathPrefix ? [o.pathPrefix] : []), STUB_DIR, dirname(NODE!), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    ...(o.harness === 'openclaw' ? { OPENCLAW_VERSION: version } : { HERMES_VERSION: version }),
    HE_WORKSPACE_DIR: d.workspace, HE_SESSION_STATE_DIR: d.state, HE_LOG_DIR: d.logs, HE_TURNS_DIR: d.turns,
    HE_MODEL_BASE_URL: baseUrl, HE_MODEL_API_KEY: 'trial-token:routes.0000', HE_MODEL_NAME: 'claude-haiku-5-5', HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'routes',
    HE_TASK_SLICE: o.entry === 'run' ? 'smoke' : 'multiuser', ...(o.entry === 'serve' ? { HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'world-token-routes' } : {}),
    ...(o.config !== undefined ? { HE_HARNESS_CONFIG: o.config } : {}), ...o.env };
  // Hermes's Anthropic copy reads the literal /opt/harness/config/config.yaml; on this host it is placed first, as that copy would.
  if (o.harness === 'hermes' && !/\/openai\/?$/.test(baseUrl) && !existsSync('/opt/harness/config/config.yaml')) {
    mkdirSync(join(d.state, 'hermes'), { recursive: true });
    writeFileSync(join(d.state, 'hermes', 'config.yaml'), readFileSync(join(harnessDir, 'config', 'config.yaml')));
  }
  o.seed?.(root);
  const adapter = join(harnessDir, 'adapter.sh');
  let exit: number | null;
  if (o.entry === 'run') {
    exit = spawnSync('bash', [adapter, 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).status;
  } else {
    const child = spawn('bash', [adapter, 'serve'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    const exited = new Promise<number | null>(res => child.once('exit', code => res(code)));
    const deadline = Date.now() + 60_000;
    const wait = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50); };
    await wait(join(d.logs, 'ready'));
    if (child.exitCode === null) {
      for (const req of o.requests ?? [REQUEST]) {
        const file = 'turn-' + String(req.turn).padStart(4, '0');
        writeFileSync(join(d.turns, file + '.request.json.tmp'), JSON.stringify(req));
        renameSync(join(d.turns, file + '.request.json.tmp'), join(d.turns, file + '.request.json'));
        await wait(join(d.turns, file + '.response.json'));
      }
      child.kill('SIGTERM');
    }
    exit = await Promise.race([exited, Bun.sleep(15_000).then(() => { child.kill('SIGKILL'); return null; })]);
  }
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else files.set(relative(root, p), readFileSync(p)); } };
  walk(root);
  const text = (rel: string) => files.get(rel)?.toString('utf8');
  const calls = (text('logs/stub-calls.jsonl') ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as string[]);
  return { exit, files, ready: text('logs/ready') ? JSON.parse(text('logs/ready')!) : null, route: text('logs/instruction-route.json') ? JSON.parse(text('logs/instruction-route.json')!) : null,
    calls, root, log: (text('logs/adapter.log') ?? '') + (text('logs/stderr.log') ?? '') };
}

/** Every file as text with the trial root, the harness directory, timestamps and adapter sha256 values normalised. logs/stderr.log
 *  loses its turn exit lines and the serve shutdown line: the adapter copies its stderr there through a process-substitution
 *  tee that bash never waits for, so the walk can run before those lines land (flaky under load). adapter.log keeps both. */
function normalised(r: Run, harnessDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, b] of [...r.files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[rel] = b.toString('utf8').replaceAll(r.root, '<root>').replaceAll(harnessDir, '<harness>')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<ts>').replace(/"adapter_sha256":"[0-9a-f]{64}"/g, '"adapter_sha256":"<sha>"');
    if (rel === 'logs/stderr.log') out[rel] = out[rel]!.replace(/^<ts> \S+ (turn \d+: exit \d+|serve: stopped on signal)\n/gm, '');
  }
  return out;
}

/** internal-task's intended changes since BASE: the cell model, claude-haiku-5-5 in every run here, in the answering model's
 *  defaults of the config the adapter leaves (tests/fixtures/model-defaults.ts), and Hermes's agent.image_input_mode text
 *  (tests/fixtures/hermes-image-mode.ts). Applied to BASE's files before comparing. */
const MODEL = 'claude-haiku-5-5';
function sinceBase(h: Harness, files: Record<string, string>): Record<string, string> {
  const key = h === 'openclaw' ? 'state/openclaw/openclaw.json' : 'state/hermes/config.yaml';
  if (files[key] === undefined) return files;
  const config = withCellModelDefaults(h, files[key]!, MODEL);
  return { ...files, [key]: h === 'hermes' ? withTextImageMode(config) : config };
}

const seedSoul = (root: string) => { mkdirSync(join(root, 'state', 'hermes'), { recursive: true }); writeFileSync(join(root, 'state', 'hermes', 'SOUL.md'), SOUL_SEED); };

/** A gbrain-docs view built on the fly: one workspace file (and .hermes.md for Hermes), a manifest with its view_digest. */
function docsView(h: Harness): string {
  const view = join(tmp, 'docs-view-' + h + '-' + ++seq);
  const entries: Array<[string, string]> = [['workspace/skills/brain-ops/SKILL.md', '---\nname: brain-ops\ndescription: test skill\n---\nbody\n'], ...(h === 'hermes' ? [['.hermes.md', '# context\n'] as [string, string]] : [])];
  const files = entries.map(([p, body]) => { mkdirSync(dirname(join(view, p)), { recursive: true }); writeFileSync(join(view, p), body); return { path: p, sha256: sha(body), bytes: body.length, source_path: h + '/docs/' + p }; });
  const lines = [...files].sort((a, b) => a.source_path.localeCompare(b.source_path)).map(f => f.source_path + ' ' + f.sha256 + '\n').join('');
  writeFileSync(join(view, 'manifest.json'), JSON.stringify({ harness: h, split: 'dev', install: 'gbrain-docs', view_digest: sha(lines), files }));
  return view;
}
const installerView = (h: Harness) => join(INSTALLER_RESULTS, h === 'openclaw' ? 'oc-inst.gbrain-install/openclaw-installer/heldout' : 'he-inst.gbrain-install/hermes-installer/heldout');

describe('the instruction file and the image layout', () => {
  test('harnesses/routes/instruction.md and its two image copies are byte-identical, carry the cited sha256 and are gbrain\'s per-turn rule byte for byte (rendered at 32366ac2, the same bytes in the committed 10949a15 installer views)', () => {
    for (const p of INSTRUCTION_FILES) expect(sha(readFileSync(join(ROOT, p)))).toBe(INSTRUCTION_SHA256);
    for (const h of HARNESSES) {
      const manifest = JSON.parse(readFileSync(join(installerView(h), 'manifest.json'), 'utf8'));
      expect(manifest.gbrain_commit).toBe('10949a15110fcd42eb0fed447d7f22e57c7206d5');
      expect(Buffer.from(manifest.installer.turn_hook.rule)).toEqual(INSTRUCTION);
    }
    const plugin = readFileSync(join(installerView('openclaw'), 'state/gbrain/gbrain-turn-rule/index.js'), 'utf8');
    expect(JSON.parse(/const RULE = (".*");/.exec(plugin)![1]!)).toBe(INSTRUCTION.toString('utf8'));
    const readme = readFileSync(join(ROOT, 'harnesses', 'routes', 'README.md'), 'utf8');
    for (const s of [INSTRUCTION_SHA256, '32366ac26a2b8874b67702249f9274b06e8756c1', '10949a15110fcd42eb0fed447d7f22e57c7206d5', 'src/core/setup/brain-first.ts']) expect(readme).toContain(s);
  });

  test('both adapters check the instruction against the same sha256, and both Dockerfiles copy routes/ to /opt/harness/routes', () => {
    for (const h of HARNESSES) {
      expect(readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8')).toContain('EXPECTED_SHA256 = "' + INSTRUCTION_SHA256 + '"');
      expect(readFileSync(join(ROOT, 'harnesses', h, 'Dockerfile'), 'utf8')).toContain('\nCOPY routes/ /opt/harness/routes/\n');
    }
  });

  test('the hook-route plugin template: each placeholder once, the id in all three files, before_prompt_build returning prependContext only on emit=1', () => {
    const [index, manifest, pkg] = PLUGIN_FILES.map(p => readFileSync(join(ROOT, p), 'utf8'));
    expect(index!.split('"__HE_INSTRUCTION__"').length).toBe(2);
    expect(index!.split('"__HE_EMIT_FLAG__"').length).toBe(2);
    expect(index).toContain("api.on('before_prompt_build', () => (emit() ? { prependContext: TEXT } : undefined))");
    expect(index).toContain("readFileSync(FLAG, 'utf8').trim() === 'emit=1'");
    expect(JSON.parse(manifest!).id).toBe('he-instruction-route');
    expect(JSON.parse(pkg!)).toMatchObject({ name: 'he-instruction-route', type: 'module', openclaw: { extensions: ['./index.js'] } });
  });

  test('the skill description fits Hermes\'s 57 visible characters', () => {
    expect('Check GBrain first, before answering any turn.'.length).toBeLessThanOrEqual(57);
  });
});

describe.skipIf(!NODE || !HAVE_PY)('default config: byte-identical to the adapter at ' + BASE, () => {
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(h + ' ' + entry + ': unset, empty and "default" leave every file and every CLI command line as ' + BASE + ' does', async () => {
        const base = await runAdapter({ harness: h, entry, harnessDir: baseDir(h) });
        expect(base.exit, base.log).toBe(0);
        const want = codelessFiles(sinceBase(h, normalised(base, baseDir(h))));
        for (const config of [undefined, '', 'default']) {
          const r = await runAdapter({ harness: h, entry, config });
          expect(r.exit, r.log).toBe(0);
          expect(codelessFiles(normalised(r, join(ROOT, 'harnesses', h)))).toEqual(want);
          expect(r.route).toBeNull();
          if (entry === 'serve') expect(r.files.get('logs/adapter.log')!.toString()).toContain('serve: stopped on signal');
          expect(want['logs/stub-calls.jsonl']).toContain('"' + (h === 'openclaw' ? 'agent' : 'chat') + '"');
        }
      }, 120_000);
    }
    test(h + ' serve with HE_GBRAIN_INSTALL=gbrain-docs: unchanged from ' + BASE, async () => {
      const view = docsView(h);
      const env = { HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_INSTALL_DIR: view };
      const base = await runAdapter({ harness: h, entry: 'serve', harnessDir: baseDir(h), env });
      expect(base.exit, base.log).toBe(0);
      expect(base.ready!.gbrain_install.status).toBe('ok');
      const r = await runAdapter({ harness: h, entry: 'serve', env });
      expect(r.exit, r.log).toBe(0);
      expect(codelessFiles(normalised(r, join(ROOT, 'harnesses', h)))).toEqual(codelessFiles(sinceBase(h, normalised(base, baseDir(h)))));
    }, 120_000);
    test(h + ' serve with HE_GBRAIN_INSTALL=gbrain-installer (the committed hook view): unchanged from ' + BASE, async () => {
      const env = { HE_GBRAIN_INSTALL: 'gbrain-installer', HE_GBRAIN_SPLIT: 'heldout', HE_GBRAIN_INSTALL_DIR: installerView(h) };
      const seed = h === 'hermes' ? seedSoul : undefined;
      const base = await runAdapter({ harness: h, entry: 'serve', harnessDir: baseDir(h), env, seed });
      expect(base.exit, base.log).toBe(0);
      expect(base.ready!.gbrain_install.turn_hook).toBe(h === 'openclaw' ? 'loaded' : 'healthy');
      const r = await runAdapter({ harness: h, entry: 'serve', env, seed });
      expect(r.exit, r.log).toBe(0);
      expect(codelessFiles(normalised(r, join(ROOT, 'harnesses', h)))).toEqual(codelessFiles(sinceBase(h, normalised(base, baseDir(h)))));
    }, 120_000);
  }
});

/** The workspace and state files a route run has that the default run does not, or with other bytes. state/he-route/ is the
 *  adapter's per-turn session count and emit flag (internal-task), checked on its own in routed(). */
function changed(route: Run, def: Run): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  const counted = (rel: string) => /^(workspace|state)\//.test(rel) && !rel.startsWith('state/he-route/');
  for (const [rel, b] of route.files) if (counted(rel) && !(def.files.get(rel)?.equals(b))) out[rel] = b;
  for (const rel of def.files.keys()) if (counted(rel) && !route.files.has(rel)) out[rel] = Buffer.from('<deleted>');
  return out;
}
const HOOK_ROUTES = ['route-hook', 'route-once', 'route-placebo'];

describe.skipIf(!NODE || !HAVE_PY)('each route writes exactly its bytes', () => {
  const defaults = new Map<string, Run>();
  const defaultRun = async (h: Harness, baseUrl = ANTHROPIC_URL) => {
    const key = h + baseUrl;
    if (!defaults.has(key)) defaults.set(key, await runAdapter({ harness: h, entry: 'serve', baseUrl, seed: h === 'hermes' ? seedSoul : undefined }));
    return defaults.get(key)!;
  };
  const routed = async (h: Harness, route: string, baseUrl = ANTHROPIC_URL) => {
    const r = await runAdapter({ harness: h, entry: 'serve', config: route, baseUrl, seed: h === 'hermes' ? seedSoul : undefined });
    expect(r.exit, r.log).toBe(0);
    expect(r.ready!.instruction_route).toMatchObject({ route, instruction_sha256: INSTRUCTION_SHA256 });
    expect(r.route).toMatchObject({ status: 'ok', code: null, harness: h, route, instruction: { sha256: INSTRUCTION_SHA256, bytes: INSTRUCTION.length } });
    // config.yaml is recorded as the route left it; serve appends the world-MCP block to it afterwards.
    for (const f of r.route!.files) if (!f.path.endsWith('/config.yaml')) expect(sha(readFileSync(f.path))).toBe(f.sha256);
    expect(r.ready!.instruction_route.files).toBe(r.route!.files.length);
    const { instruction_route: _, ...rest } = r.ready!;
    const { ...def } = (await defaultRun(h, baseUrl)).ready!;
    expect({ ...rest, ready_at: 0 }).toEqual({ ...def, ready_at: 0 });
    // internal-task: the one serve turn is session dm:alice's first; its RouteTurnStatus and, on a hook route, the emit flag.
    const emitted = HOOK_ROUTES.includes(route) ? true : null;
    expect(JSON.parse(r.files.get('logs/turns/turn-0001.route.json')!.toString())).toEqual({ config: route, driver: 'cli', route, session_key: 'D0ALICE', session_turn: 1, emitted });
    expect(JSON.parse(r.files.get('state/he-route/sessions.json')!.toString())).toEqual({ 'dm:alice': 1 });
    expect(r.files.get('state/he-route/emit')?.toString()).toBe(emitted ? 'emit=1' : undefined);
    if (h === 'hermes') {
      expect(r.ready!.instruction_route).toMatchObject({ approvals: 'deny', tirith: 'absent' });
      expect(JSON.parse(r.files.get('logs/hermes-security.json')!.toString())).toMatchObject({ approvals: { mode: 'smart', single_query_mode: 'deny' }, tirith: { present: false, pin_version: '0.4.2' } });
      expect(JSON.parse(r.files.get('logs/turns/turn-0001.security.json')!.toString())).toEqual({ turn: 1, tool_results: 0, approval_cards: 0, blocked: [], gbrain_blocked: 0 });
    }
    return { r, diff: changed(r, await defaultRun(h, baseUrl)) };
  };

  for (const h of HARNESSES) {
    test(h + ' route-tool: nothing in the workspace or state changes', async () => {
      const { r, diff } = await routed(h, 'route-tool');
      expect(diff).toEqual({});
      expect(r.route!.files).toEqual([]);
    }, 60_000);
    test(h + ' route-skill: one SKILL.md with the fixed description and the instruction as its body', async () => {
      const { diff } = await routed(h, 'route-skill');
      const path = h === 'openclaw' ? 'workspace/skills/brain-first/SKILL.md' : 'state/hermes/skills/brain-first/SKILL.md';
      expect(Object.keys(diff)).toEqual([path]);
      expect(diff[path]).toEqual(SKILL_MD);
    }, 60_000);
  }

  test('openclaw route-startup: /workspace/AGENTS.md is the instruction bytes alone', async () => {
    const { diff } = await routed('openclaw', 'route-startup');
    expect(Object.keys(diff)).toEqual(['workspace/AGENTS.md']);
    expect(diff['workspace/AGENTS.md']).toEqual(INSTRUCTION);
  }, 60_000);

  test('openclaw route-hook: the three plugin files, RULE equal to the instruction, the three documented commands and the runtime inspect', async () => {
    const { r, diff } = await routed('openclaw', 'route-hook');
    const dir = 'state/openclaw/he-instruction-route/';
    expect(Object.keys(diff).sort()).toEqual([dir + 'index.js', dir + 'openclaw.plugin.json', dir + 'package.json']);
    expect(JSON.parse(/const TEXT = (".*");/.exec(diff[dir + 'index.js']!.toString())![1]!)).toBe(INSTRUCTION.toString());
    expect(JSON.parse(/const FLAG = (".*");/.exec(diff[dir + 'index.js']!.toString())![1]!)).toBe(join(r.root, 'state', 'he-route', 'emit'));
    expect(diff[dir + 'package.json']).toEqual(readFileSync(join(ROOT, PLUGIN_FILES[2]!)));
    const plugin = join(r.root, dir.slice(0, -1));
    expect(r.calls.filter(c => c[0] === 'plugins' || c[0] === 'config')).toEqual([
      ['plugins', 'install', '--link', plugin, '--force', '--accept-capabilities'], ['plugins', 'enable', 'he-instruction-route'],
      ['config', 'set', 'plugins.entries.he-instruction-route.hooks.allowConversationAccess', 'true'], ['plugins', 'inspect', 'he-instruction-route', '--runtime', '--json']]);
    expect(r.route!.hook).toMatchObject({ status: 'loaded', plugin_dir: plugin });
    expect(r.ready!.instruction_route.hook).toBe('loaded');
  }, 60_000);

  for (const [label, url] of [['anthropic', ANTHROPIC_URL], ['openai', OPENAI_URL]] as const) {
    test.skipIf(!HAVE_YAML)('hermes route-system (' + label + ' config, skipped where the host python3 has no PyYAML to parse it back): agent.system_prompt is the instruction as a JSON string, nothing else in config.yaml moves', async () => {
      const { r, diff } = await routed('hermes', 'route-system', url);
      expect(Object.keys(diff)).toEqual(['state/hermes/config.yaml']);
      const template = withCellModelDefaults('hermes', readFileSync(join(ROOT, 'harnesses', 'hermes', 'config', label === 'openai' ? 'config.openai.yaml' : 'config.yaml'), 'utf8'), MODEL);
      const def = (await defaultRun('hermes', url)).files.get('state/hermes/config.yaml')!.toString();
      expect(def.startsWith(template)).toBe(true);
      const line = '  system_prompt: ' + JSON.stringify(INSTRUCTION.toString()) + '\n';
      const hasAgent = template.includes('\nagent:\n');
      const want = hasAgent
        ? def.replace('\nagent:\n', '\nagent:\n' + line)
        : template + '\nagent:\n' + line + def.slice(template.length);
      expect(diff['state/hermes/config.yaml']!.toString()).toBe(want);
      expect(r.route!.files[0]).toMatchObject({ added_bytes: Buffer.byteLength(hasAgent ? line : '\nagent:\n' + line) });
    }, 60_000);
  }

  test('hermes route-startup: SOUL.md is the seed, a blank line, the instruction and a newline', async () => {
    const { r, diff } = await routed('hermes', 'route-startup');
    expect(Object.keys(diff)).toEqual(['state/hermes/SOUL.md']);
    expect(diff['state/hermes/SOUL.md']).toEqual(Buffer.concat([SOUL_SEED, Buffer.from('\n\n'), INSTRUCTION, Buffer.from('\n')]));
    expect(r.route!.replaced_seed.sha256).toBe(sha(SOUL_SEED));
  }, 60_000);

  test('hermes route-hook: the marked pre_llm_call block, the allowlist approving exactly its command, hooks doctor run', async () => {
    const { r, diff } = await routed('hermes', 'route-hook');
    expect(Object.keys(diff).sort()).toEqual(['state/hermes/config.yaml', 'state/hermes/shell-hooks-allowlist.json']);
    const routes = join(ROOT, 'harnesses', 'hermes', 'routes');
    const command = ['/bin/sh', join(routes, 'he-route-hook.sh'), join(r.root, 'state', 'he-route', 'emit'), join(routes, 'instruction.md')].join(' ');
    const block = '\n# he:instruction-route:begin\nhooks:\n  pre_llm_call:\n    - command: ' + JSON.stringify(command) + '\n      timeout: 10\n# he:instruction-route:end\n';
    const def = (await defaultRun('hermes')).files.get('state/hermes/config.yaml')!.toString();
    const template = withCellModelDefaults('hermes', readFileSync(join(ROOT, 'harnesses', 'hermes', 'config', 'config.yaml'), 'utf8'), MODEL);
    expect(diff['state/hermes/config.yaml']!.toString()).toBe(template + block + def.slice(template.length));
    const allow = JSON.parse(diff['state/hermes/shell-hooks-allowlist.json']!.toString());
    expect(allow.approvals).toHaveLength(1);
    expect(allow.approvals[0]).toMatchObject({ event: 'pre_llm_call', command, script_mtime_at_approval: null });
    expect(r.calls).toContainEqual(['hooks', 'doctor']);
    expect(r.files.get('logs/instruction-route.hermes.log')!.toString()).toContain('produced valid JSON on synthetic payload');
    expect(r.ready!.instruction_route.hook).toBe('healthy');
  }, 60_000);
});

describe.skipIf(!NODE || !HAVE_PY)('refusals: HE-ADAPTER-007, exit 2, no ready', () => {
  const refused = (r: Run, text: string) => {
    expect(r.exit, r.log).toBe(2);
    expect(r.ready).toBeNull();
    expect(r.log).toContain('HE-ADAPTER-007');
    expect(r.log).toContain(text);
  };
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(h + ' ' + entry + ': an unknown config is refused before any state is written', async () => {
        for (const config of ['route-bogus', 'pi']) {
          const r = await runAdapter({ harness: h, entry, config });
          refused(r, 'HE_HARNESS_CONFIG=' + config + ' is not a');
          expect([...r.files.keys()].filter(k => k.startsWith('state/') && !(h === 'hermes' && k === 'state/hermes/config.yaml'))).toEqual([]);
          expect(r.calls).toEqual([]);
        }
      }, 60_000);
    }
    test(h + ': a tampered instruction file is refused', async () => {
      const dir = join(tmp, 'tampered-' + h);
      cpSync(join(ROOT, 'harnesses', h), dir, { recursive: true });
      writeFileSync(join(dir, 'routes', 'instruction.md'), Buffer.concat([INSTRUCTION, Buffer.from(' ')]));
      const r = await runAdapter({ harness: h, entry: 'serve', harnessDir: dir, config: 'route-skill' });
      refused(r, 'not the committed ' + INSTRUCTION_SHA256);
      expect(r.route).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007', files: [] });
    }, 60_000);
    test(h + ': an existing destination is refused and left untouched', async () => {
      const path = h === 'openclaw' ? 'workspace/skills/brain-first/SKILL.md' : 'state/hermes/skills/brain-first/SKILL.md';
      const r = await runAdapter({ harness: h, entry: 'serve', config: 'route-skill', seed: root => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), 'mine\n'); } });
      refused(r, 'the destination exists and the route does not overwrite it');
      expect(r.files.get(path)!.toString()).toBe('mine\n');
    }, 60_000);
  }
  test('openclaw route-system: no setting at 2026.10.6, refused', async () => {
    refused(await runAdapter({ harness: 'openclaw', entry: 'serve', config: 'route-system' }), 'OpenClaw 2026.10.6 has no config setting that adds text to the system prompt');
  }, 60_000);
  test('openclaw route-hook, route-startup and route-skill on the run entry: refused before anything is written', async () => {
    for (const config of ['route-hook', 'route-startup', 'route-skill']) {
      const r = await runAdapter({ harness: 'openclaw', entry: 'run', config });
      refused(r, 'serve entry only');
      expect([...r.files.keys()].filter(k => !k.startsWith('logs/') && k !== 'workspace/instruction.md')).toEqual([]);
    }
  }, 60_000);
  test('hermes route-system: a python3 without PyYAML cannot parse the result back, refused', async () => {
    const shim = join(tmp, 'no-yaml-bin');
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, 'python3'), '#!/bin/sh\nexec /usr/bin/python3 -S "$@"\n', { mode: 0o755 });
    const r = await runAdapter({ harness: 'hermes', entry: 'serve', config: 'route-system', pathPrefix: shim });
    refused(r, 'python3 has no yaml module');
    expect(r.route).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
  }, 60_000);
  test('openclaw route-hook: a plugin that does not report loaded fails closed', async () => {
    const r = await runAdapter({ harness: 'openclaw', entry: 'serve', config: 'route-hook', env: { HE_STUB_PLUGIN_STATUS: 'error' } });
    refused(r, 'the route-hook plugin is not loaded');
    expect(r.route).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007', hook: { status: 'error' } });
  }, 60_000);
  test('hermes route-hook: a shell hook hermes hooks doctor does not call healthy fails closed', async () => {
    const r = await runAdapter({ harness: 'hermes', entry: 'serve', config: 'route-hook', env: { HE_STUB_HOOKS_DOCTOR: 'broken' } });
    refused(r, 'the route-hook shell hook is not healthy');
    expect(r.route).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007', hook: { status: 'error', doctor_exit: 1 } });
  }, 60_000);
  test('hermes route-hook on a config that already has hooks (the gbrain installer hook) is refused', async () => {
    const r = await runAdapter({ harness: 'hermes', entry: 'serve', config: 'route-hook', seed: seedSoul,
      env: { HE_GBRAIN_INSTALL: 'gbrain-installer', HE_GBRAIN_SPLIT: 'heldout', HE_GBRAIN_INSTALL_DIR: installerView('hermes') } });
    refused(r, 'already has a hooks: section');
  }, 60_000);
  test('hermes route-startup: a missing SOUL.md or one that is not the seed is refused', async () => {
    refused(await runAdapter({ harness: 'hermes', entry: 'serve', config: 'route-startup' }), 'Hermes seeded no SOUL.md');
    const r = await runAdapter({ harness: 'hermes', entry: 'serve', config: 'route-startup', seed: root => { seedSoul(root); writeFileSync(join(root, 'state', 'hermes', 'SOUL.md'), 'edited\n'); } });
    refused(r, 'is not the default SOUL.md Hermes seeds');
    expect(r.files.get('state/hermes/SOUL.md')!.toString()).toBe('edited\n');
  }, 60_000);
});

describe.skipIf(!NODE || !HAVE_PY)('hermes model.default (internal-task)', () => {
  test('a config.yaml that is not a template keeps its model.default', async () => {
    const own = 'model:\n  default: "other-model"\n  provider: "anthropic"\napprovals:\n  mode: "manual"\n';
    const r = await runAdapter({ harness: 'hermes', entry: 'serve', seed: root => { seedSoul(root); writeFileSync(join(root, 'state', 'hermes', 'config.yaml'), own); } });
    expect(r.exit).toBe(0);
    const config = r.files.get('state/hermes/config.yaml')!.toString();
    expect(config).toContain('  default: "other-model"\n');
    expect(config).not.toContain('claude-haiku-5-5');
  }, 60_000);
});

describe.skipIf(!NODE || !HAVE_PY)('H10 (internal-task): route-once, route-placebo, route-told and the slot routes on the host', () => {
  const PLACEBO_SHA256 = 'b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34';
  const placebo = readFileSync(join(ROOT, 'harnesses', 'routes', 'placebo.md'));
  const seed = (h: Harness) => (h === 'hermes' ? seedSoul : undefined);
  const refused = (r: Run, text: string) => {
    expect(r.exit, r.log).toBe(2);
    expect(r.ready).toBeNull();
    expect(r.log).toContain('HE-ADAPTER-007');
    expect(r.log).toContain(text);
  };

  test('the placebo copies in both build contexts are byte copies of harnesses/routes/placebo.md, and both adapters pin its sha256', () => {
    expect(sha(placebo)).toBe(PLACEBO_SHA256);
    for (const h of HARNESSES) {
      expect(readFileSync(join(ROOT, 'harnesses', h, 'routes', 'placebo.md'))).toEqual(placebo);
      expect(readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8')).toContain('PLACEBO_SHA256 = "' + PLACEBO_SHA256 + '"');
    }
  });

  test('hermes he-route-hook.sh keeps no state: {"context": <bytes>} on emit=1, nothing on emit=0 or with no flag', () => {
    const dir = mkdtempSync(join(tmp, 'hook-script-'));
    const flag = join(dir, 'emit');
    const run = () => spawnSync('/bin/sh', [join(ROOT, 'harnesses', 'hermes', 'routes', 'he-route-hook.sh'), flag, join(ROOT, 'harnesses', 'hermes', 'routes', 'placebo.md')],
      { input: '{"hook_event_name":"pre_llm_call"}', encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    expect(run().stdout).toBe('');
    writeFileSync(flag, 'emit=1');
    expect(JSON.parse(run().stdout)).toEqual({ context: placebo.toString('utf8') });
    writeFileSync(flag, 'emit=0');
    const r = run();
    expect([r.status, r.stdout]).toEqual([0, '']);
  });

  test('hermes run entry: each hook route fires its bytes on the single-shot turn (#271 review, blocker 4)', async () => {
    for (const config of ['route-hook', 'route-once', 'route-placebo']) {
      const r = await runAdapter({ harness: 'hermes', entry: 'run', config, seed: seed('hermes') });
      expect(r.exit, r.log).toBe(0);
      const bytes = config === 'route-placebo' ? placebo : INSTRUCTION;
      expect(JSON.parse(r.files.get('logs/stub-emit.jsonl')?.toString() ?? 'null')).toEqual({ emit: 'emit=1', context_sha256: [sha(bytes)] });
    }
  }, 120_000);

  for (const h of HARNESSES) {
    test(h + ' route-once and route-placebo: the route-hook carrier with the emit flag; placebo carries placebo.md', async () => {
      for (const config of ['route-once', 'route-placebo']) {
        const r = await runAdapter({ harness: h, entry: 'serve', config, seed: seed(h) });
        expect(r.exit, r.log).toBe(0);
        expect(r.ready!.instruction_route).toMatchObject({ route: config, instruction_sha256: INSTRUCTION_SHA256, hook: h === 'openclaw' ? 'loaded' : 'healthy' });
        expect(r.route!.hook).toMatchObject({ emit_flag: join(r.root, 'state', 'he-route', 'emit'), emits: config === 'route-once' ? 'the first member turn of each session' : 'every member turn, the placebo bytes' });
        expect(JSON.parse(r.files.get('logs/turns/turn-0001.route.json')!.toString())).toEqual({ config, driver: 'cli', route: config, session_key: 'D0ALICE', session_turn: 1, emitted: true });
        const bytes = config === 'route-placebo' ? placebo : INSTRUCTION;
        if (config === 'route-placebo') expect(r.route!.placebo).toMatchObject({ sha256: PLACEBO_SHA256, bytes: 289 });
        if (h === 'openclaw') {
          const index = r.files.get('state/openclaw/he-instruction-route/index.js')!.toString();
          expect(JSON.parse(/const TEXT = (".*");/.exec(index)![1]!)).toBe(bytes.toString());
        } else {
          const block = r.files.get('state/hermes/config.yaml')!.toString();
          expect(block).toContain(JSON.stringify(['/bin/sh', join(ROOT, 'harnesses', 'hermes', 'routes', 'he-route-hook.sh'), join(r.root, 'state', 'he-route', 'emit'), join(ROOT, 'harnesses', 'hermes', 'routes', config === 'route-placebo' ? 'placebo.md' : 'instruction.md')].join(' ')));
        }
        // The stub ran the installed hook on the turn: the flag said emit=1 and the hook returned the route's bytes.
        expect(JSON.parse(r.files.get('logs/stub-emit.jsonl')!.toString())).toEqual({ emit: 'emit=1', context_sha256: [sha(bytes)] });
      }
    }, 120_000);

    test(h + ' route-told: the route-skill skill, nothing else; the told sentence is the preamble\'s, not the adapter\'s', async () => {
      const r = await runAdapter({ harness: h, entry: 'serve', config: 'route-told', seed: seed(h) });
      expect(r.exit, r.log).toBe(0);
      const path = h === 'openclaw' ? 'workspace/skills/brain-first/SKILL.md' : 'state/hermes/skills/brain-first/SKILL.md';
      expect(r.files.get(path)).toEqual(SKILL_MD);
      expect(r.route!.files.map((f: any) => f.path)).toEqual([join(r.root, path)]);
      expect(r.route!.told).toContain("the cell's preamble file");
      expect(JSON.parse(r.files.get('logs/turns/turn-0001.route.json')!.toString())).toMatchObject({ route: 'route-told', emitted: null });
    }, 60_000);

    test(h + ': the emit flag over cn-02, cr-01 and cn-03 for route-hook and route-once, turn by turn, matches each task\'s own sessions', async () => {
      for (const task of GOLDEN_TASKS) {
        const reqs = goldenRequests(task);
        const n = sessionTurns(reqs);
        for (const config of ['route-hook', 'route-once']) {
          const r = await runAdapter({ harness: h, entry: 'serve', config, seed: seed(h), requests: reqs });
          expect(r.exit, r.log).toBe(0);
          const status = reqs.map((q) => JSON.parse(r.files.get('logs/turns/turn-000' + q.turn + '.route.json')!.toString()));
          expect(status.map((s) => [s.session_key, s.session_turn])).toEqual(reqs.map((q, i) => [q.channel.id + (q.thread_ts ? ':' + q.thread_ts : ''), n[i]]));
          const want = n.map((k) => config === 'route-hook' || k === 1);
          expect(status.map((s) => s.emitted)).toEqual(want);
          const fired = r.files.get('logs/stub-emit.jsonl')!.toString().trim().split('\n').map((l) => JSON.parse(l));
          expect(fired).toEqual(want.map((e) => ({ emit: e ? 'emit=1' : 'emit=0', context_sha256: [e ? INSTRUCTION_SHA256 : null] })));
        }
      }
    }, 300_000);

    test(h + ': a driver prefix and a tampered placebo are refused', async () => {
      refused(await runAdapter({ harness: h, entry: 'serve', config: 'sdk-preset+route-hook' }), 'only claude-code takes a driver prefix');
      const dir = join(tmp, 'tampered-placebo-' + h);
      cpSync(join(ROOT, 'harnesses', h), dir, { recursive: true });
      writeFileSync(join(dir, 'routes', 'placebo.md'), Buffer.concat([placebo, Buffer.from(' ')]));
      const r = await runAdapter({ harness: h, entry: 'serve', harnessDir: dir, config: 'route-placebo', seed: seed(h) });
      refused(r, 'not the committed ' + PLACEBO_SHA256);
      expect(r.route).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007', files: [] });
    }, 60_000);
  }

  test('openclaw: route-once, route-placebo, route-told and the slot routes are refused on the run entry', async () => {
    for (const config of ['route-once', 'route-placebo', 'route-told', 'route-slot-skill@geva-fixture']) {
      const r = await runAdapter({ harness: 'openclaw', entry: 'run', config });
      refused(r, 'serve entry only');
      expect([...r.files.keys()].filter((k) => !k.startsWith('logs/') && k !== 'workspace/instruction.md')).toEqual([]);
    }
  }, 60_000);

  for (const h of HARNESSES) describe(h + ' slot routes', () => {
    const skills = h === 'openclaw' ? 'workspace/skills/' : 'state/hermes/skills/';
    /** The harness directory with a slot bundle byte-copied under routes/slots/<id>/, as H10 PR 6 does for Claude Code. */
    function withSlot(edit?: (bundle: string) => void): string {
      const dir = mkdtempSync(join(tmp, h + '-slot-'));
      cpSync(join(ROOT, 'harnesses', h), dir, { recursive: true });
      const bundle = join(dir, 'routes', 'slots', 'geva-fixture');
      mkdirSync(join(bundle, 'skill', 'brain-first', 'references'), { recursive: true });
      writeFileSync(join(bundle, 'skill', 'brain-first', 'SKILL.md'), SKILL_MD);
      writeFileSync(join(bundle, 'skill', 'brain-first', 'references', 'notes.md'), 'Reference notes.\n');
      writeFileSync(join(bundle, 'slot.json'), JSON.stringify({ slot_id: 'geva-fixture', owner: 'internal-task', skill_name: 'brain-first', description: 'Check GBrain first, before answering any turn.', told_sentence: 'Use the brain-first skill.', bundle_sha256: bundleSha256(bundle), source: 'garrytan/gstack-evals@0000000', notes: '' }));
      edit?.(bundle);
      return dir;
    }
    test('route-slot-skill and route-slot-told copy skill/<name>/ to the harness skill directory after the bundle_sha256 re-check', async () => {
      for (const config of ['route-slot-skill@geva-fixture', 'route-slot-told@geva-fixture']) {
        const dir = withSlot();
        const r = await runAdapter({ harness: h, entry: 'serve', harnessDir: dir, config, seed: seed(h) });
        expect(r.exit, r.log).toBe(0);
        expect(r.files.get(skills + 'brain-first/SKILL.md')).toEqual(SKILL_MD);
        expect(r.files.get(skills + 'brain-first/references/notes.md')!.toString()).toBe('Reference notes.\n');
        expect(r.route!.slot).toMatchObject({ slot_id: 'geva-fixture', skill_name: 'brain-first', bundle_sha256: bundleSha256(join(dir, 'routes', 'slots', 'geva-fixture')) });
        expect(r.ready!.instruction_route.route).toBe(config);
        expect(JSON.parse(r.files.get('logs/turns/turn-0001.route.json')!.toString())).toMatchObject({ config, route: config.split('@')[0], emitted: null });
      }
    }, 60_000);
    test('a missing bundle, a bundle whose files do not match bundle_sha256 and a malformed slot id are refused', async () => {
      refused(await runAdapter({ harness: h, entry: 'serve', config: 'route-slot-skill@geva-fixture', seed: seed(h) }), 'no readable slot bundle geva-fixture');
      const dir = withSlot((b) => writeFileSync(join(b, 'skill', 'brain-first', 'references', 'notes.md'), 'changed\n'));
      const r = await runAdapter({ harness: h, entry: 'serve', harnessDir: dir, config: 'route-slot-skill@geva-fixture', seed: seed(h) });
      refused(r, 'not slot.json');
      expect(r.files.has(skills + 'brain-first/SKILL.md')).toBe(false);
      refused(await runAdapter({ harness: h, entry: 'serve', config: 'route-slot-told@Bad_Id' }), 'needs @<slot_id>');
    }, 60_000);
  });
});

/** Async docker: the fake endpoint below serves from this event loop, so spawnSync would starve it. */
async function docker(args: string[], timeoutMs = 120_000): Promise<{ status: number | null; stdout: string }> {
  const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [status, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { status, stdout };
}
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const haveImage = (h: Harness) => haveDocker && spawnSync('docker', ['image', 'inspect', 'harness-eval/' + h + ':dev'], { stdio: 'ignore' }).status === 0;
const escapeRe = (s: string) => s.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');

/** The surface table of harnesses/routes/README.md, as a test. Per route, in the image (the checkout's adapter, config/,
 *  routes/ and pin.json mounted over /opt/harness) against a keyless fake Anthropic endpoint on the docker bridge gateway: two
 *  member turns in the same DM (one session key), where the fake answers the first tools-bearing request of turn 1 with one
 *  call of the harness's shell tool, so turn 1 makes a follow-up request carrying the tool result. Every model request that
 *  carries tools is counted: copies of the instruction in the system prompt and in the messages, and which message holds each. */
interface Seen { turn: number; system: number; messages: number[]; tool_result: boolean }
const SURFACE_COUNTS: Record<Harness, Record<string, Seen[]>> = { openclaw: {}, hermes: {} };
describe('where each route puts the instruction, over two turns and a tool-call follow-up (docker, the harness images; skipped without them)', () => {
  const run = async (h: Harness, config: string | undefined): Promise<Array<{ turn: number; body: Record<string, any> }>> => {
    const gatewayIp = spawnSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' }).stdout.trim();
    const requests: Array<{ turn: number; body: Record<string, any> }> = [];
    let turn = 0, toolCalled = false;
    const server = Bun.serve({ port: 0, hostname: gatewayIp, async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return new Response('{}', { status: 404 });
      const body = await req.json() as Record<string, any>;
      requests.push({ turn, body });
      const names: string[] = Array.isArray(body.tools) ? body.tools.map((t: any) => String(t?.name ?? '')) : [];
      const shell = ['exec', 'terminal', 'bash', 'shell'].find(n => names.includes(n));
      let content: Array<Record<string, unknown>> = [{ type: 'text', text: 'ok' }], stop = 'end_turn';
      if (shell && turn === 1 && !toolCalled) { toolCalled = true; content = [{ type: 'tool_use', id: 'toolu_route_1', name: shell, input: { command: 'echo route-probe' } }]; stop = 'tool_use'; }
      const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      if (!body.stream) return Response.json(msg);
      const events: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null } }]];
      content.forEach((b, index) => {
        if (b.type === 'tool_use') {
          events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
          events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }]);
        } else {
          events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
          events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } }]);
        }
        events.push(['content_block_stop', { type: 'content_block_stop', index }]);
      });
      events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]);
      return new Response(events.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const root = join(tmp, 'surface-' + h + '-' + (config ?? 'default'));
    const d = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
    for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
    const hd = join(ROOT, 'harnesses', h);
    const name = 'he-route-surface-' + h + '-' + (config ?? 'default') + '-' + process.pid;
    const env: Record<string, string> = { HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_TRIAL_ID: name, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '90',
      HE_MODEL_BASE_URL: 'http://host.docker.internal:' + server.port + '/anthropic', HE_MODEL_API_KEY: 'trial-token:dummy', HE_MODEL_NAME: 'claude-haiku-5-5',
      HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'world-token-dummy', ...(config ? { HE_HARNESS_CONFIG: config } : {}) };
    const args = ['run', '-d', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
      '-v', d.workspace + ':/workspace', '-v', d.state + ':/harness-state', '-v', d.logs + ':/he-logs', '-v', d.turns + ':/he-turns',
      '-v', join(hd, 'adapter.sh') + ':/opt/harness/adapter.sh:ro', '-v', join(hd, 'config') + ':/opt/harness/config:ro', '-v', join(hd, 'routes') + ':/opt/harness/routes:ro', '-v', join(hd, 'pin.json') + ':/opt/harness/pin.json:ro'];
    for (const [k, v] of Object.entries(env)) args.push('-e', k + '=' + v);
    await docker(['rm', '-f', name]);
    try {
      expect((await docker([...args, 'harness-eval/' + h + ':dev', 'serve'])).status).toBe(0);
      const deadline = Date.now() + 240_000;
      while (!existsSync(join(d.logs, 'ready')) && Date.now() < deadline) await Bun.sleep(250);
      expect(existsSync(join(d.logs, 'ready'))).toBe(true);
      for (const [n, prompt] of [[1, REQUEST.prompt], [2, 'Say ok again.']] as const) {
        turn = n;
        const file = 'turn-000' + n;
        writeFileSync(join(d.turns, file + '.request.json.tmp'), JSON.stringify({ ...REQUEST, turn: n, prompt, text: prompt, ts: '179000000' + n + '.000100' }));
        renameSync(join(d.turns, file + '.request.json.tmp'), join(d.turns, file + '.request.json'));
        while (!existsSync(join(d.turns, file + '.response.json')) && Date.now() < deadline) await Bun.sleep(250);
        expect(JSON.parse(readFileSync(join(d.turns, file + '.response.json'), 'utf8')).exit).toBe(0);
      }
      expect(toolCalled).toBe(true);
    } finally {
      await docker(['rm', '-f', name]);
      server.stop(true);
    }
    return requests.filter(r => Array.isArray(r.body.tools) && r.body.tools.length > 0);
  };
  const texts = (c: unknown): string[] => (typeof c === 'string' ? [c] : Array.isArray(c) ? c.map(b => (b && typeof b === 'object' && typeof (b as any).text === 'string' ? (b as any).text : '')) : []);
  const ins = INSTRUCTION.toString('utf8');
  const copies = (v: unknown) => JSON.stringify(v ?? '').split(JSON.stringify(ins).slice(1, -1)).length - 1;
  const seen = (r: { turn: number; body: Record<string, any> }): Seen => ({ turn: r.turn, system: copies(r.body.system), messages: (r.body.messages as any[]).map(m => copies(m.content)),
    tool_result: (r.body.messages as any[]).some(m => Array.isArray(m.content) && m.content.some((b: any) => b?.type === 'tool_result')) });
  const prompt = REQUEST.prompt;
  const where: Record<Harness, Record<string, (b: Record<string, any>) => void>> = {
    openclaw: {
      'route-startup': b => { expect(texts(b.system)[0]).toContain('# Project Context\n'); expect(texts(b.system)[0]).toContain('\n## /workspace/AGENTS.md\n' + ins + '\n## '); },
      'route-hook': b => expect(texts(b.messages[0].content)[0]).toMatch(new RegExp('^\\[[^\\]]+\\] ' + escapeRe(ins) + '\n\n' + escapeRe(prompt))),
      'route-skill': b => expect(texts(b.system)[0]).toContain('<name>brain-first</name>\n    <description>Check GBrain first, before answering any turn.</description>\n    <location>/workspace/skills/brain-first/SKILL.md</location>'),
    },
    hermes: {
      'route-system': b => expect(texts(b.system).at(-1)!.endsWith('\n\n' + ins)).toBe(true),
      'route-startup': b => expect(texts(b.system)[0]!.startsWith(SOUL_SEED.toString('utf8') + '\n\n' + ins + '\n\n')).toBe(true),
      'route-hook': b => expect(texts(b.messages[0].content).at(-1)!.endsWith(prompt + '\n\n' + ins)).toBe(true),
      'route-skill': b => expect(texts(b.system).join('\n')).toContain('\n    - brain-first: Check GBrain first, before answering any turn.\n'),
    },
  };
  for (const h of HARNESSES) {
    test.skipIf(!haveImage(h))(h + ': per route, the first request places the instruction as the table says; turn 2 and the tool-call follow-up are counted', async () => {
      for (const config of [undefined, ...ROUTES[h]]) {
        const reqs = await run(h, config);
        expect(reqs.length).toBeGreaterThanOrEqual(3);
        const first = reqs.find(r => r.turn === 1)!;
        where[h][config ?? '']?.(first.body);
        const counts = reqs.map(seen);
        SURFACE_COUNTS[h][config ?? 'default'] = counts;
        const total = (s: Seen) => s.system + s.messages.reduce((a, b) => a + b, 0);
        expect(counts.some(s => s.turn === 1 && s.tool_result)).toBe(true);
        expect(counts.some(s => s.turn === 2)).toBe(true);
        if (config === undefined || config === 'route-tool' || config === 'route-skill') expect(counts.every(s => total(s) === 0)).toBe(true);
        if (config === 'route-system' || config === 'route-startup') expect(counts.every(s => s.system === 1 && s.messages.every(m => m === 0))).toBe(true);
        if (config === 'route-hook') expect(counts.every(s => s.system === 0 && total(s) === s.turn)).toBe(true);
      }
      console.log('SURFACE_COUNTS ' + h + ' ' + JSON.stringify(SURFACE_COUNTS[h]));
    }, 1_800_000);
  }
});

// ---- H10 (internal-task) golden captures: the hook routes, the emit flag and history carry on gpt-6.1-sol ----------------------------

/** cn-02 (a DM resume), cr-01 (three turns in one channel) and cn-03 (four session firsts, the last a new thread), the three session
 *  patterns of harnesses/routes/README.md "Golden captures", as TurnRequests built from each task.toml the way runner/trial/turns.ts
 *  builds them: a DM is the member's own DM channel, a channel turn its seed channel id, thread = "new" a new thread rooted at the
 *  turn's own ts. The prompt is the turn's text alone (the preamble does not move where the route's bytes land). */
const GOLDEN_TASKS = ['cn-02-tansleigh-packaging-deadline', 'cr-01-marrow-agrisupply-site-retraction', 'cn-03-marrow-agrisupply-site'] as const;
const GOLDEN_MODEL = 'gpt-6.1-sol';
const PLACEBO = readFileSync(join(ROOT, 'harnesses', 'routes', 'placebo.md'));
function goldenRequests(task: string): Array<Record<string, any>> {
  const t = parseTask(readFileSync(join(ROOT, 'tasks', 'multiuser', 'v0.3', 'dev', task, 'task.toml'), 'utf8'), task);
  return t.turns.map((turn, i) => {
    const m = world.members.find((x) => x.id === turn.actor)!;
    const ts = '1790000' + String(100 + i) + '.000100';
    const channel = turn.channel === 'dm' ? { id: 'D' + m.slack_id.slice(1), name: 'dm:' + m.id, type: 'dm' } : { id: world.channels.find((c) => c.name === turn.channel)!.id, name: turn.channel, type: 'channel' };
    return { turn: i + 1, trial_id: 'golden-' + task, prompt: turn.text, actor: { member: m.id, slack_user_id: m.slack_id, name: m.name, role: m.role, team: m.team }, channel, text: turn.text, ts,
      thread_ts: turn.thread === 'new' ? ts : null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: 90 };
  });
}
/** The session each turn opens or continues, and its 1-based place in it, from the task's own turn order (the scorer's definition). */
function sessionTurns(reqs: Array<Record<string, any>>): number[] {
  const seen = new Map<string, number>();
  return reqs.map((r) => { const k = r.channel.id + (r.thread_ts ? ':' + r.thread_ts : ''); seen.set(k, (seen.get(k) ?? 0) + 1); return seen.get(k)!; });
}

/** A fake MCP server for both world (/world) and gbrain (/gbrain): tools search and get_page; every tools/call is counted by path. */
function fakeMcp(host: string): { port: number; calls: Record<string, number>; stop: () => void } {
  const calls: Record<string, number> = {};
  const server = Bun.serve({ port: 0, hostname: host, idleTimeout: 0, async fetch(req) {
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const path = new URL(req.url).pathname;
    const body = await req.json() as { id?: number; method?: string; params?: { protocolVersion?: string } };
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'tools/call') calls[path] = (calls[path] ?? 0) + 1;
    const result = body.method === 'initialize' ? { protocolVersion: body.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' + path.replace('/', '-'), version: '0' } }
      : body.method === 'tools/list' ? { tools: ['search', 'get_page'].map((name) => ({ name, description: name + ' the brain', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } })) }
      : body.method === 'tools/call' ? { content: [{ type: 'text', text: 'No pages matched.' }] } : {};
    return new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, calls, stop: () => server.stop(true) };
}

interface GoldenRequest { turn: number; body: Record<string, any> }
/** A fake OpenAI Responses endpoint on the bridge gateway. The first request of turn 1 that offers tools gets one gbrain search (the
 *  tool directly, or the harness's tool_call bridge: on this provider both OpenClaw and Hermes defer MCP tools behind tool_search),
 *  so turn 1 has a tool-call follow-up; every other request gets "ok". */
function fakeGoldenModel(host: string): { port: number; requests: GoldenRequest[]; setTurn: (n: number) => void; stop: () => void } {
  const requests: GoldenRequest[] = [];
  let turn = 0, called = false;
  const server = Bun.serve({ port: 0, hostname: host, idleTimeout: 0, async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/responses')) return Response.json({ error: { type: 'invalid_request_error', message: 'no route ' + url.pathname } }, { status: 404 });
    const body = await req.json() as Record<string, any>;
    requests.push({ turn, body });
    const names = toolNames(body);
    let output: Array<Record<string, unknown>> = [{ type: 'message', id: 'msg_golden_' + requests.length, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }];
    const direct = names.find((n) => n.includes('gbrain') && n.endsWith('search'));
    if (names.length && turn === 1 && !called && (direct || names.includes('tool_call'))) {
      called = true;
      // OpenClaw's tool_call takes {id, args} and names MCP tools <server>__<tool>; Hermes's takes {calls: [{name, arguments}]} and
      // names them mcp__<server>__<tool>.
      const bridge = (body.tools as any[]).find((t) => t?.name === 'tool_call');
      const query = { query: 'Marrow Agrisupply' };
      const [name, args] = direct ? [direct, query] : bridge?.parameters?.properties?.id ? ['tool_call', { id: 'gbrain__search', args: query }] : ['tool_call', { calls: [{ name: 'mcp__gbrain__search', arguments: query }] }];
      output = [{ type: 'function_call', id: 'fc_golden_' + requests.length, call_id: 'call_golden_' + requests.length, name, arguments: JSON.stringify(args), status: 'completed' }];
    }
    return new Response(stream('resp_golden_' + requests.length, String(body.model ?? ''), output), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, requests, setTurn: (n) => { turn = n; if (n === 1) called = false; }, stop: () => server.stop(true) };
}

/** Copies of needle in one Responses request, by where they sit: system (instructions, system and developer items), user messages
 *  (all of them, and current: the ones holding this turn's prompt; the rest are history), and tool results (function_call_output).
 *  OpenClaw adds a runtime-context user message after the turn's own, so the turn's message is found by its text, not its place. */
interface Where { system: number; user: number; current: number; tool_result: number }
function where(body: Record<string, any>, needle: string, prompt: string): Where {
  const count = (s: unknown) => (typeof s === 'string' ? s.split(needle).length - 1 : 0);
  const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n') : '');
  const out: Where = { system: count(body.instructions), user: 0, current: 0, tool_result: 0 };
  for (const item of Array.isArray(body.input) ? body.input : typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : []) {
    if (item?.type === 'function_call_output') out.tool_result += count(typeof item.output === 'string' ? item.output : JSON.stringify(item.output));
    else if (item?.role === 'system' || item?.role === 'developer') out.system += count(text(item.content));
    else if (item?.role === 'user') { const t = text(item.content); out.user += count(t); if (t.includes(prompt)) out.current += count(t); }
  }
  return out;
}

const GOLDEN_ARMS: Record<Harness, string[]> = { openclaw: ['route-tool', 'route-hook', 'route-once', 'route-placebo', 'route-startup', 'route-skill'], hermes: ['route-tool', 'route-hook', 'route-once', 'route-placebo', 'route-system', 'route-startup', 'route-skill'] };
/** What the goldens saw, printed per harness for harnesses/routes/README.md. */
const GOLDEN_SEEN: Record<string, unknown> = {};

describe('H10 golden captures on ' + GOLDEN_MODEL + ': cn-02, cr-01 and cn-03 with a gbrain tool-call follow-up (docker, the harness images; skipped without them)', () => {
  async function trial(h: Harness, config: string, task: string) {
    const gateway = spawnSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' }).stdout.trim();
    const model = fakeGoldenModel(gateway);
    const mcp = fakeMcp(gateway);
    const reqs = goldenRequests(task);
    const root = mkdtempSync(join(tmp, 'golden-' + h + '-' + config + '-'));
    const d = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
    for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
    const hd = join(ROOT, 'harnesses', h);
    const name = 'he-golden-' + h + '-' + config + '-' + task.slice(0, 5) + '-' + process.pid;
    const env: Record<string, string> = { HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_TRIAL_ID: name, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '90', HE_HARNESS_CONFIG: config,
      HE_MODEL_BASE_URL: 'http://host.docker.internal:' + model.port + '/golden/openai', HE_MODEL_API_KEY: 'trial-token:golden.dummy', HE_MODEL_NAME: GOLDEN_MODEL,
      HE_WORLD_MCP_URL: 'http://host.docker.internal:' + mcp.port + '/world', HE_WORLD_MCP_TOKEN: 'world-token-golden',
      HE_GBRAIN_MCP_URL: 'http://host.docker.internal:' + mcp.port + '/gbrain', HE_GBRAIN_MCP_TOKEN: 'world-token-golden' };
    const args = ['run', '-d', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
      '-v', d.workspace + ':/workspace', '-v', d.state + ':/harness-state', '-v', d.logs + ':/he-logs', '-v', d.turns + ':/he-turns',
      '-v', join(hd, 'adapter.sh') + ':/opt/harness/adapter.sh:ro', '-v', join(hd, 'config') + ':/opt/harness/config:ro', '-v', join(hd, 'routes') + ':/opt/harness/routes:ro', '-v', join(hd, 'pin.json') + ':/opt/harness/pin.json:ro'];
    for (const [k, v] of Object.entries(env)) args.push('-e', k + '=' + v);
    await docker(['rm', '-f', name]);
    const log = () => (existsSync(join(d.logs, 'adapter.log')) ? readFileSync(join(d.logs, 'adapter.log'), 'utf8').slice(-3000) : '(no adapter.log)');
    try {
      expect((await docker([...args, 'harness-eval/' + h + ':dev', 'serve'])).status).toBe(0);
      const deadline = Date.now() + 300_000;
      while (!existsSync(join(d.logs, 'ready')) && Date.now() < deadline) await Bun.sleep(250);
      expect(existsSync(join(d.logs, 'ready')), log()).toBe(true);
      for (const r of reqs) {
        model.setTurn(r.turn);
        const file = 'turn-000' + r.turn;
        writeFileSync(join(d.turns, file + '.request.json.tmp'), JSON.stringify(r));
        renameSync(join(d.turns, file + '.request.json.tmp'), join(d.turns, file + '.request.json'));
        while (!existsSync(join(d.turns, file + '.response.json')) && Date.now() < deadline) await Bun.sleep(250);
        expect(JSON.parse(readFileSync(join(d.turns, file + '.response.json'), 'utf8')).exit, log()).toBe(0);
      }
      model.setTurn(0);
    } finally {
      await docker(['rm', '-f', name]);
      model.stop();
      mcp.stop();
    }
    const read = (p: string) => JSON.parse(readFileSync(join(d.logs, p), 'utf8'));
    return { reqs, requests: model.requests, gbrainCalls: mcp.calls['/gbrain'] ?? 0, ready: read('ready'), status: reqs.map((r) => read('turns/turn-000' + r.turn + '.route.json')),
      security: h === 'hermes' ? { trial: read('hermes-security.json'), turns: reqs.map((r) => read('turns/turn-000' + r.turn + '.security.json')) } : null };
  }

  for (const h of HARNESSES) {
    for (const config of GOLDEN_ARMS[h]) {
      test.skipIf(!haveImage(h))(h + ' ' + config + ': emitted per turn, copies by location on every request, history carry, the follow-up adds none', async () => {
        const hook = HOOK_ROUTES.includes(config);
        const needle = (config === 'route-placebo' ? PLACEBO : INSTRUCTION).toString('utf8');
        const seen: Record<string, unknown> = {};
        for (const task of GOLDEN_TASKS) {
          const t = await trial(h, config, task);
          const n = sessionTurns(t.reqs);
          expect(t.ready.instruction_route).toMatchObject({ route: config, instruction_sha256: INSTRUCTION_SHA256 });
          // The adapter's per-turn status agrees with the task's own session structure.
          expect(t.status.map((s) => [s.session_key, s.session_turn])).toEqual(t.reqs.map((r, i) => [r.channel.id + (r.thread_ts ? ':' + r.thread_ts : ''), n[i]]));
          expect(t.status.map((s) => s.emitted)).toEqual(n.map((k) => (!hook ? null : config === 'route-once' ? k === 1 : true)));
          // The agent requests (the ones that offer tools); housekeeping calls are listed apart.
          const agent = t.requests.filter((r) => toolNames(r.body).length > 0 && r.turn > 0);
          const rows = agent.map((r) => { const prompt = t.reqs[r.turn - 1]!.prompt as string; return { turn: r.turn, session_turn: n[r.turn - 1]!, rule: where(r.body, INSTRUCTION.toString('utf8'), prompt), placebo: where(r.body, PLACEBO.toString('utf8'), prompt), follow_up: where(r.body, 'No pages matched.', prompt).tool_result > 0 }; });
          expect(new Set(rows.map((r) => r.turn))).toEqual(new Set(t.reqs.map((r) => r.turn)));
          expect(rows.some((r) => r.turn === 1 && r.follow_up), 'turn 1 has a tool-call follow-up carrying the gbrain result').toBe(true);
          expect(t.gbrainCalls).toBeGreaterThanOrEqual(1);
          for (const r of agent) expect(r.body.model).toBe(GOLDEN_MODEL);
          for (const row of rows) {
            const w = config === 'route-placebo' ? row.placebo : row.rule;
            expect(w.tool_result).toBe(0);
            if (config === 'route-placebo') expect(row.rule.system + row.rule.user + row.rule.tool_result).toBe(0);
            if (config === 'route-hook' || config === 'route-placebo') { expect(w.system).toBe(0); expect([w.user, w.current]).toEqual([row.session_turn, 1]); }
            else if (config === 'route-once') { expect(w.system).toBe(0); expect([w.user, w.current]).toEqual([1, row.session_turn === 1 ? 1 : 0]); }
            else { expect(w.user).toBe(0); expect(w.system).toBe(config === 'route-system' || config === 'route-startup' ? 1 : 0); }
          }
          if (t.security) {
            expect(t.security.trial.tirith).toMatchObject({ present: true, version: 'tirith 0.4.2', matches_pin: true, offline: '1' });
            expect(t.security.trial.approvals).toMatchObject({ mode: 'smart', single_query_mode: 'deny' });
            expect(t.ready.instruction_route).toMatchObject({ approvals: 'deny', tirith: '0.4.2' });
            expect(t.security.turns[0]).toMatchObject({ approval_cards: 0, blocked: [], gbrain_blocked: 0 });
            expect(t.security.turns[0].tool_results).toBeGreaterThanOrEqual(1);
          }
          const housekeeping = t.requests.filter((r) => toolNames(r.body).length === 0);
          const sent = agent[0]!.body;
          seen[task] = { requests: rows.map((r) => { const w = config === 'route-placebo' ? r.placebo : r.rule; return [r.turn, r.session_turn, w.system, w.current, w.user - w.current, r.follow_up ? 1 : 0]; }),
            emitted: t.status.map((s) => s.emitted), housekeeping: { requests: housekeeping.length, copies: housekeeping.reduce((a, r) => { const w = where(r.body, needle, ''); return a + w.system + w.user; }, 0) },
            sent: { model: sent.model, reasoning: sent.reasoning ?? null, max_output_tokens: sent.max_output_tokens ?? null } };
        }
        GOLDEN_SEEN[h + ' ' + config] = seen;
        console.log('GOLDEN ' + h + ' ' + config + ' ' + JSON.stringify(seen));
      }, 1_800_000);
    }
  }
});
