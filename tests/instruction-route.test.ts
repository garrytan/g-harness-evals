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
 *    command line equal what the adapter at BASE (31a109a9c, main when internal-task started) leaves, apart from internal-task's cell
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

/** harnesses/<h> at BASE, extracted once per harness. */
const baseDirs: Partial<Record<Harness, string>> = {};
function baseDir(h: Harness): string {
  if (baseDirs[h]) return baseDirs[h]!;
  const out = join(tmp, 'base-' + h);
  mkdirSync(out, { recursive: true });
  const archive = spawnSync('git', ['archive', BASE, 'harnesses/' + h], { cwd: ROOT, maxBuffer: 64 << 20 });
  if (archive.status !== 0) throw new Error('git archive ' + BASE + ' failed (CI checks out with fetch-depth 0): ' + archive.stderr);
  const untar = spawnSync('tar', ['-x', '-C', out], { input: archive.stdout });
  if (untar.status !== 0) throw new Error('tar failed: ' + untar.stderr);
  return (baseDirs[h] = join(out, 'harnesses', h));
}

interface Run { exit: number | null; files: Map<string, Buffer>; ready: Record<string, any> | null; route: Record<string, any> | null; calls: string[][]; root: string; log: string }
interface Opts { harness: Harness; entry: Entry; harnessDir?: string; config?: string; baseUrl?: string; env?: Record<string, string>; seed?: (root: string) => void; pathPrefix?: string }

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
    const deadline = Date.now() + 30_000;
    const wait = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50); };
    await wait(join(d.logs, 'ready'));
    if (child.exitCode === null) {
      writeFileSync(join(d.turns, 'turn-0001.request.json.tmp'), JSON.stringify(REQUEST));
      renameSync(join(d.turns, 'turn-0001.request.json.tmp'), join(d.turns, 'turn-0001.request.json'));
      await wait(join(d.turns, 'turn-0001.response.json'));
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

  test('the route-hook plugin template: one placeholder, the id in all three files, before_prompt_build returning prependContext', () => {
    const [index, manifest, pkg] = PLUGIN_FILES.map(p => readFileSync(join(ROOT, p), 'utf8'));
    expect(index!.split('"__HE_INSTRUCTION__"').length).toBe(2);
    expect(index).toContain("api.on('before_prompt_build', () => ({ prependContext: RULE }))");
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
        const want = sinceBase(h, normalised(base, baseDir(h)));
        for (const config of [undefined, '', 'default']) {
          const r = await runAdapter({ harness: h, entry, config });
          expect(r.exit, r.log).toBe(0);
          expect(normalised(r, join(ROOT, 'harnesses', h))).toEqual(want);
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
      expect(normalised(r, join(ROOT, 'harnesses', h))).toEqual(sinceBase(h, normalised(base, baseDir(h))));
    }, 120_000);
    test(h + ' serve with HE_GBRAIN_INSTALL=gbrain-installer (the committed hook view): unchanged from ' + BASE, async () => {
      const env = { HE_GBRAIN_INSTALL: 'gbrain-installer', HE_GBRAIN_SPLIT: 'heldout', HE_GBRAIN_INSTALL_DIR: installerView(h) };
      const seed = h === 'hermes' ? seedSoul : undefined;
      const base = await runAdapter({ harness: h, entry: 'serve', harnessDir: baseDir(h), env, seed });
      expect(base.exit, base.log).toBe(0);
      expect(base.ready!.gbrain_install.turn_hook).toBe(h === 'openclaw' ? 'loaded' : 'healthy');
      const r = await runAdapter({ harness: h, entry: 'serve', env, seed });
      expect(r.exit, r.log).toBe(0);
      expect(normalised(r, join(ROOT, 'harnesses', h))).toEqual(sinceBase(h, normalised(base, baseDir(h))));
    }, 120_000);
  }
});

/** The workspace and state files a route run has that the default run does not, or with other bytes. */
function changed(route: Run, def: Run): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [rel, b] of route.files) if (/^(workspace|state)\//.test(rel) && !(def.files.get(rel)?.equals(b))) out[rel] = b;
  for (const rel of def.files.keys()) if (/^(workspace|state)\//.test(rel) && !route.files.has(rel)) out[rel] = Buffer.from('<deleted>');
  return out;
}

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
    expect(JSON.parse(/const RULE = (".*");/.exec(diff[dir + 'index.js']!.toString())![1]!)).toBe(INSTRUCTION.toString());
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
    const command = "/bin/echo '" + JSON.stringify({ context: INSTRUCTION.toString() }) + "'";
    const block = '\n# he:instruction-route:begin\nhooks:\n  pre_llm_call:\n    - command: ' + JSON.stringify(command) + '\n      timeout: 10\n# he:instruction-route:end\n';
    const def = (await defaultRun('hermes')).files.get('state/hermes/config.yaml')!.toString();
    const template = withCellModelDefaults('hermes', readFileSync(join(ROOT, 'harnesses', 'hermes', 'config', 'config.yaml'), 'utf8'), MODEL);
    expect(diff['state/hermes/config.yaml']!.toString()).toBe(template + block + def.slice(template.length));
    const allow = JSON.parse(diff['state/hermes/shell-hooks-allowlist.json']!.toString());
    expect(allow.approvals).toHaveLength(1);
    expect(allow.approvals[0]).toMatchObject({ event: 'pre_llm_call', command, script_mtime_at_approval: null });
    expect(JSON.parse(command.slice("/bin/echo '".length, -1)).context).toBe(INSTRUCTION.toString());
    expect(r.calls).toContainEqual(['hooks', 'doctor']);
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
