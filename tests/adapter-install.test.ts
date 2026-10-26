// internal-task, the install ladder's adapter step (docs/adapters.md, "gbrain's documented install"): under
// HE_GBRAIN_INSTALL=gbrain-docs the OpenClaw and Hermes adapters verify the mounted install bundle view against its
// manifest and copy it to the documented destinations before ready; a tampered view is HE-ADAPTER-006, exit 2 and no
// ready. The second block covers HE_GBRAIN_INSTALL=gbrain-installer (internal-task) the same way, plus the proof that each
// harness puts the installed block into its first model request. Keyless: the harness runs in serve mode against a model URL and a world URL nothing listens on, and no turn is
// posted. Needs docker and the harness-eval/gbrain:dev, harness-eval/openclaw:dev and harness-eval/hermes:dev images
// built from this checkout; skips without them.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportInstallView, gbrainImagePresent, type InstallViewManifest } from '../runner/trial/gbrain.ts';
import type { InstallerRecord } from '../gbrain/build-install.ts';

const ROOT = resolve(import.meta.dir, '..');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const imagePresent = (image: string) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const HARNESSES = ['openclaw', 'hermes'] as const;
/** The adapter under test per harness, named by repository path so the file maps to this test. */
const ADAPTER_SCRIPT: Record<(typeof HARNESSES)[number], string> = { openclaw: 'harnesses/openclaw/adapter.sh', hermes: 'harnesses/hermes/adapter.sh' };
const haveImages = haveDocker && gbrainImagePresent() && HARNESSES.every((h) => imagePresent(`harness-eval/${h}:dev`));
/** gbrain's documented OpenClaw scaffold at the image's gbrain version: the five core skills in 30 files from 0.60.456.0 (gbrain#7508), 64 skills in 127 files before. */
const openclawDocsFiles = (image: string) => {
  const v = (JSON.parse(spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', image, '/opt/sidecar/image.json'], { encoding: 'utf8' }).stdout) as { gbrain_version?: string }).gbrain_version ?? '0';
  const n = v.split('.').map(Number);
  return (n[0]! > 0 || n[1]! > 60 || (n[1] === 60 && n[2]! >= 456)) ? 30 : 127;
};


const tmp = mkdtempSync(join(tmpdir(), 'he-adapter-install-'));
const containers: string[] = [];
afterAll(() => {
  for (const name of containers) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  rmSync(tmp, { recursive: true, force: true });
});

interface Trial { workspace: string; state: string; logs: string; turns: string }
function trialDirs(name: string): Trial {
  const t = { workspace: join(tmp, name, 'workspace'), state: join(tmp, name, 'state'), logs: join(tmp, name, 'logs'), turns: join(tmp, name, 'turns') };
  for (const d of Object.values(t)) mkdirSync(d, { recursive: true });
  return t;
}

/** `docker run -d ... serve` the way runner/trial/docker.ts starts a gbrain-docs trial: four mounts, the view read-only at
 *  /he-gbrain-install, the serve environment with the three install variables. */
function startServe(harness: string, name: string, t: Trial, viewDir: string, install: 'gbrain-docs' | 'gbrain-installer' = 'gbrain-docs', modelUrl = 'http://127.0.0.1:9/anthropic'): string {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  containers.push(name);
  const env = {
    HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_TRIAL_ID: name, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '30',
    HE_MODEL_BASE_URL: modelUrl, HE_MODEL_API_KEY: 'sk-trial-test', HE_MODEL_NAME: 'claude-haiku-5-5',
    HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'he-install-test-token',
    HE_GBRAIN_INSTALL: install, HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_INSTALL_DIR: '/he-gbrain-install',
  };
  const args = ['run', '-d', '--name', name, '--user', `${process.getuid!()}:${process.getgid!()}`, '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${t.workspace}:/workspace`, '-v', `${t.state}:/harness-state`, '-v', `${t.logs}:/he-logs`, '-v', `${t.turns}:/he-turns`, '-v', `${viewDir}:/he-gbrain-install:ro`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  const r = spawnSync('docker', [...args, `harness-eval/${harness}:dev`, 'serve'], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return name;
}

const status = (name: string) => spawnSync('docker', ['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name], { encoding: 'utf8' }).stdout.trim().split(' ');

/** Wait for ready or for the container to exit; null when ready arrived with the container running, else the exit code. */
async function waitReadyOrExit(name: string, logs: string, ms: number): Promise<number | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(join(logs, 'ready'))) return null;
    const [state, code] = status(name);
    if (state !== 'running' && state !== 'created') return Number(code);
    await Bun.sleep(250);
  }
  throw new Error(`${name}: neither ready nor exited within ${ms} ms; adapter.log:\n${existsSync(join(logs, 'adapter.log')) ? readFileSync(join(logs, 'adapter.log'), 'utf8') : '(none)'}`);
}

function stop(name: string): void {
  spawnSync('docker', ['stop', '-t', '5', name], { stdio: 'ignore' });
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}

/** Where the adapter puts a view file: workspace/x lands at /workspace/x, Hermes's .hermes.md at /workspace/.hermes.md. */
const destination = (workspace: string, path: string) => path === '.hermes.md' ? join(workspace, '.hermes.md') : join(workspace, path.replace(/^workspace\//, ''));

interface InstallRecord { status: string; code: string | null; harness: string; split: string; dir: string; view_digest: string | null; files: number; destinations: string[]; copied: string[]; error: string | null }
interface Ready { harness: string; adapter_sha256: string; gbrain_install?: { status: string; install: string; files: number; view_digest: string; destinations: string } }

describe.skipIf(!haveImages)("the OpenClaw and Hermes adapters apply gbrain's documented install from the mounted view", () => {
  const views: Partial<Record<(typeof HARNESSES)[number], InstallViewManifest>> = {};
  const viewDir = (h: string) => join(tmp, 'views', h, 'dev');

  test('the dev views export from the gbrain image and verify', async () => {
    for (const h of HARNESSES) views[h] = await exportInstallView('harness-eval/gbrain:dev', h, 'dev', viewDir(h));
    expect(views.openclaw!.files.length).toBe(openclawDocsFiles('harness-eval/gbrain:dev'));
    expect(views.hermes!.files.length).toBe(128);
    expect(views.hermes!.files.some((f) => f.path === '.hermes.md')).toBe(true);
  }, 120_000);

  for (const h of HARNESSES) {
    test(`${h}: every view file lands at its documented destination with its digest, gbrain-install.json says ok, ready carries adapter_sha256 and the install`, async () => {
      const view = views[h]!;
      const t = trialDirs(`${h}-ok`);
      const name = startServe(h, `he-install-${h}-ok`, t, viewDir(h));
      try {
        expect(await waitReadyOrExit(name, t.logs, 150_000)).toBeNull();
        const log = readFileSync(join(t.logs, 'adapter.log'), 'utf8');
        expect(log).toContain(`gbrain-docs install: ok ${view.files.length} ${view.view_digest}`);
        // The install runs before the harness is prepared: its log line precedes the world-MCP wiring and ready.
        expect(log.indexOf('gbrain-docs install: ok')).toBeLessThan(log.indexOf('serve: ready'));

        const landed = view.files.map((f) => destination(t.workspace, f.path));
        for (const [i, f] of view.files.entries()) {
          expect(existsSync(landed[i]!), `${f.path} missing at ${landed[i]}`).toBe(true);
          expect(sha256(landed[i]!), f.path).toBe(f.sha256);
        }
        expect(existsSync(join(t.workspace, 'skills', 'brain-ops', 'SKILL.md'))).toBe(true);
        if (h === 'hermes') expect(readFileSync(join(t.workspace, '.hermes.md'), 'utf8')).toContain(`(brain://${view.context!.kept_slugs[0]!})`);
        else expect(existsSync(join(t.workspace, '.hermes.md'))).toBe(false);

        const rec = JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')) as InstallRecord;
        expect(rec).toMatchObject({ status: 'ok', code: null, harness: h, split: 'dev', dir: '/he-gbrain-install', view_digest: view.view_digest, files: view.files.length, error: null });
        expect(rec.destinations).toEqual(h === 'hermes' ? ['/workspace/.hermes.md', '/workspace/skills'] : ['/workspace/skills']);
        expect(rec.copied.length).toBe(view.files.length);
        expect(new Set(rec.copied.map((p) => p.replace(/^\/workspace/, t.workspace)))).toEqual(new Set(landed));

        const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')) as Ready;
        expect(ready.harness).toBe(h);
        expect(ready.adapter_sha256).toBe(sha256(join(ROOT, ADAPTER_SCRIPT[h])));
        expect(ready.gbrain_install).toEqual({ status: 'ok', install: 'gbrain-docs', files: view.files.length, view_digest: view.view_digest, destinations: rec.destinations.join(',') });

        // The view mount stayed as exported and the install record holds no token.
        expect(existsSync(join(viewDir(h), '.he-write-probe'))).toBe(false);
        expect(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')).not.toContain('he-install-test-token');
      } finally {
        stop(name);
      }
    }, 240_000);

    test(`${h}: a view with one changed byte is HE-ADAPTER-006, exit 2, nothing copied and no ready`, async () => {
      const view = views[h]!;
      const bad = join(tmp, 'views', h, 'tampered');
      cpSync(viewDir(h), bad, { recursive: true });
      appendFileSync(join(bad, 'workspace', 'skills', 'brain-ops', 'SKILL.md'), 'x');
      const t = trialDirs(`${h}-bad`);
      const name = startServe(h, `he-install-${h}-bad`, t, bad);
      try {
        expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
        expect(existsSync(join(t.logs, 'ready'))).toBe(false);
        expect(existsSync(join(t.workspace, 'skills'))).toBe(false);
        expect(existsSync(join(t.workspace, '.hermes.md'))).toBe(false);
        const log = readFileSync(join(t.logs, 'adapter.log'), 'utf8');
        expect(log).toContain('HE-ADAPTER-006 the install bundle could not be applied: digest mismatch for workspace/skills/brain-ops/SKILL.md');
        const rec = JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')) as InstallRecord;
        expect(rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: h, split: 'dev', view_digest: view.view_digest, files: 0, destinations: [], copied: [] });
        expect(rec.error).toContain('digest mismatch');
      } finally {
        stop(name);
      }
    }, 180_000);
  }

  test('OpenClaw lists the landed skills from /workspace/skills as workspace skills, keylessly', async () => {
    // pin.json gbrain_install: `openclaw skills list --json` reads agents.defaults.workspace (/workspace) and reports every
    // scaffolded skill with source openclaw-workspace, model-visible; no model call is made.
    const t = trialDirs('openclaw-list');
    const name = startServe('openclaw', 'he-install-openclaw-list', t, viewDir('openclaw'));
    try {
      expect(await waitReadyOrExit(name, t.logs, 150_000)).toBeNull();
      const r = spawnSync('docker', ['exec', '-e', 'HOME=/harness-state', '-e', 'OPENCLAW_STATE_DIR=/harness-state/openclaw', '-e', 'OPENCLAW_CONFIG_PATH=/harness-state/openclaw/openclaw.json',
        '-e', 'HE_MODEL_BASE_URL=http://127.0.0.1:9/anthropic', '-e', 'HE_MODEL_API_KEY=sk-trial-test', name, 'openclaw', 'skills', 'list', '--json'], { encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      const listed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { workspaceDir: string; skills: Array<{ name: string; source: string; eligible: boolean; modelVisible: boolean }> };
      expect(listed.workspaceDir).toBe('/workspace');
      const fromWorkspace = listed.skills.filter((s) => s.source === 'openclaw-workspace');
      expect(fromWorkspace.length).toBe(views.openclaw!.skills);
      expect(fromWorkspace.find((s) => s.name === 'brain-ops')).toMatchObject({ eligible: true, modelVisible: true });
    } finally {
      stop(name);
    }
  }, 240_000);

  test('Hermes loads /workspace/.hermes.md as project context from the cwd and reads no skills from /workspace/skills, keylessly', async () => {
    // pin.json gbrain_install: agent/prompt_builder.py build_context_files_prompt and agent/skill_utils.py get_all_skills_dirs,
    // called in the image against the installed workspace; no model call is made.
    const t = trialDirs('hermes-load');
    const name = startServe('hermes', 'he-install-hermes-load', t, viewDir('hermes'));
    try {
      expect(await waitReadyOrExit(name, t.logs, 150_000)).toBeNull();
      const r = spawnSync('docker', ['exec', '-w', '/workspace', '-e', 'HOME=/harness-state', '-e', 'HERMES_HOME=/harness-state/hermes', name, 'python3', '-c', [
        'import json',
        'from agent.prompt_builder import build_context_files_prompt',
        'from agent.skill_utils import get_all_skills_dirs, get_project_skills_dirs',
        'print(json.dumps({"context": build_context_files_prompt(cwd="/workspace", skip_soul=True), "skills_dirs": [str(d) for d in get_all_skills_dirs()], "project_skills_dirs": [str(d) for d in get_project_skills_dirs()]}))',
      ].join('\n')], { encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { context: string; skills_dirs: string[]; project_skills_dirs: string[] };
      expect(out.context).toContain('# Project Context');
      expect(out.context).toContain('## .hermes.md');
      for (const slug of views.hermes!.context!.kept_slugs) expect(out.context).toContain(`(brain://${slug})`);
      expect(out.skills_dirs).toEqual(['/harness-state/hermes/skills']);
      expect(out.project_skills_dirs).toEqual([]);
    } finally {
      stop(name);
    }
  }, 240_000);
});

// internal-task (gbrain#7489): under HE_GBRAIN_INSTALL=gbrain-installer the adapters apply what `gbrain setup <harness> --instructions-only`
// wrote, OpenClaw's /workspace/AGENTS.md and Hermes's $HERMES_HOME/SOUL.md, and each harness carries the block into the system
// prompt of its first model request, proved against a fake Anthropic endpoint on this host that records the request (no key, no
// real model). The gbrain image is HE_GBRAIN_INSTALLER_IMAGE or harness-eval/gbrain:dev; skips when its bundle records the
// installer unavailable (every gbrain before #7489).
const INSTALLER_IMAGE = process.env.HE_GBRAIN_INSTALLER_IMAGE ?? 'harness-eval/gbrain:dev';
function installerAvailable(image: string): Record<string, string | null> | null {
  if (!haveDocker || !imagePresent(image)) return null;
  const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', image, '/install/manifest.json'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const m = JSON.parse(r.stdout) as { harnesses: Record<string, { installer?: { unavailable?: string } }> };
  return Object.fromEntries(HARNESSES.map((h) => [h, m.harnesses[h]?.installer ? (m.harnesses[h]!.installer!.unavailable ?? null) : 'no installer section in the bundle manifest']));
}
const installerState = haveImages ? installerAvailable(INSTALLER_IMAGE) : null;
const haveInstaller = installerState !== null && HARNESSES.every((h) => installerState[h] === null);
if (haveImages && !haveInstaller) console.log(`adapter-install: the installer tests skip, ${INSTALLER_IMAGE} has no installer bundle: ${JSON.stringify(installerState)}`);

/** A fake Anthropic messages endpoint: records every request body and answers one short assistant turn, streamed or not. */
function fakeAnthropic(): { port: number; requests: Array<Record<string, unknown>>; stop: () => void } {
  const requests: Array<Record<string, unknown>> = [];
  const server = Bun.serve({ port: 0, hostname: '0.0.0.0', async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }), { status: 404 });
    const body = await req.json() as Record<string, unknown>;
    requests.push(body);
    const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    const events: Array<[string, unknown]> = [
      ['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port!, requests, stop: () => server.stop(true) };
}

/** docker exec without blocking this process: the fake endpoint above serves from this event loop, so spawnSync would starve it. */
async function execInContainer(args: string[], timeoutMs: number): Promise<{ status: number | null; stderr: string }> {
  const proc = Bun.spawn(['docker', 'exec', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [status, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
  clearTimeout(timer);
  return { status, stderr };
}

/** The first request to /v1/messages; the harnesses probe /v1/models first and Hermes follows the turn with a short titling call. */
const firstTurn = (requests: Array<Record<string, unknown>>) => requests.find((r) => Array.isArray(r.messages));

/** Every text of a request's system prompt (a string or an array of text blocks) joined. */
const systemText = (body: Record<string, unknown>): string => typeof body.system === 'string' ? body.system : Array.isArray(body.system) ? (body.system as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n') : '';

describe.skipIf(!haveInstaller)("the OpenClaw and Hermes adapters apply gbrain's installer (gbrain setup <harness> --instructions-only) from the mounted view", () => {
  const views: Partial<Record<(typeof HARNESSES)[number], InstallViewManifest>> = {};
  const viewDir = (h: string) => join(tmp, 'installer-views', h, 'dev');
  const landing = (t: Trial, h: string) => h === 'hermes' ? join(t.state, 'hermes', 'SOUL.md') : join(t.workspace, 'AGENTS.md');

  /** The per-turn hook record when the bundle's gbrain wrote one (gbrain#7489 at 10949a15 and later); null for the block-only head. */
  const hookOf = (h: string) => { const rec = views[h as (typeof HARNESSES)[number]]!.installer as InstallerRecord; return rec.turn_hook ?? null; };
  const instructionFile = (h: string) => h === 'hermes' ? 'home/SOUL.md' : 'workspace/AGENTS.md';
  const hookFiles = (h: string) => h === 'hermes' ? ['home/config.yaml', 'home/shell-hooks-allowlist.json'] : ['state/gbrain/gbrain-turn-rule/index.js', 'state/gbrain/gbrain-turn-rule/openclaw.plugin.json', 'state/gbrain/gbrain-turn-rule/package.json'];
  const destinations = (h: string) => h === 'hermes'
    ? ['/harness-state/hermes/SOUL.md', ...(hookOf(h) ? ['/harness-state/hermes/config.yaml', '/harness-state/hermes/shell-hooks-allowlist.json'] : [])].sort()
    : ['/workspace/AGENTS.md', ...(hookOf(h) ? ['/harness-state/openclaw/gbrain'] : [])].sort();

  test(`the installer views export from ${INSTALLER_IMAGE} and verify: the instruction file with the brain-first block, the per-turn hook files when the gbrain commit writes them, Hermes's seeded SOUL.md first`, async () => {
    for (const h of HARNESSES) views[h] = await exportInstallView(INSTALLER_IMAGE, h, 'dev', viewDir(h), 'gbrain-installer');
    for (const h of HARNESSES) {
      expect(views[h]!.install).toBe('gbrain-installer');
      const rec = views[h]!.installer as InstallerRecord;
      expect('files' in rec).toBe(true);
      const hook = hookOf(h);
      expect(views[h]!.files.map((f) => f.path).sort()).toEqual([instructionFile(h), ...(hook ? hookFiles(h) : [])].sort());
      expect(readFileSync(join(viewDir(h), instructionFile(h)), 'utf8')).toContain('<!-- gbrain:brain-first:begin -->');
      if (hook) {
        // gbrain#7489 at 10949a15: the hook files are setup's own, the rule text is recorded, and OpenClaw's three install commands are printed.
        expect(hook.files.map((f) => f.replace(`${h}/installer/`, '')).sort()).toEqual(hookFiles(h));
        expect(hook.rule).toContain('check GBrain first');
        if (h === 'openclaw') {
          expect(hook.action).toBe('print');
          expect(hook.commands).toEqual(['openclaw plugins install --link <out>/openclaw/installer/state/gbrain/gbrain-turn-rule --force --accept-capabilities', 'openclaw plugins enable gbrain-turn-rule', 'openclaw config set plugins.entries.gbrain-turn-rule.hooks.allowConversationAccess true']);
          expect(readFileSync(join(viewDir(h), 'state/gbrain/gbrain-turn-rule/index.js'), 'utf8')).toContain("api.on('before_prompt_build'");
        } else {
          expect(hook.action).toBe('write');
          const config = readFileSync(join(viewDir(h), 'home/config.yaml'), 'utf8');
          expect(config).toContain('# gbrain:turn-rule:begin');
          expect(config).toContain('pre_llm_call:');
          expect(config).toContain(`/bin/echo '`);
          const allow = JSON.parse(readFileSync(join(viewDir(h), 'home/shell-hooks-allowlist.json'), 'utf8')) as { approvals: Array<{ event: string; command: string }> };
          expect(allow.approvals).toHaveLength(1);
          expect(allow.approvals[0]!.event).toBe('pre_llm_call');
          expect(config).toContain(JSON.stringify(allow.approvals[0]!.command));
        }
      }
    }
    const hermes = views.hermes!.installer as { seed: { sha256: string; bytes: number; hermes_commit: string | null } };
    const pin = JSON.parse(readFileSync(join(ROOT, 'harnesses', 'hermes', 'pin.json'), 'utf8')) as { commit: string; soul_md: { sha256: string; bytes: number } };
    expect(hermes.seed).toMatchObject({ sha256: pin.soul_md.sha256, bytes: pin.soul_md.bytes, hermes_commit: pin.commit });
    const soul = readFileSync(join(viewDir('hermes'), 'home', 'SOUL.md'));
    expect(createHash('sha256').update(soul.subarray(0, pin.soul_md.bytes)).digest('hex')).toBe(pin.soul_md.sha256);
  }, 120_000);

  for (const h of HARNESSES) {
    test(`${h}: the installer files land at their destinations with their digests, gbrain-install.json and ready name the install kind, the per-turn hook (when the bundle has one) is loaded by the harness's own account, and the block is in the first model request's system prompt with the rule beside the turn`, async () => {
      const view = views[h]!;
      const hook = hookOf(h);
      const t = trialDirs(`${h}-installer-ok`);
      const fake = fakeAnthropic();
      const name = startServe(h, `he-install-${h}-installer-ok`, t, viewDir(h), 'gbrain-installer', `http://host.docker.internal:${fake.port}/anthropic`);
      try {
        expect(await waitReadyOrExit(name, t.logs, 150_000)).toBeNull();
        const log = readFileSync(join(t.logs, 'adapter.log'), 'utf8');
        expect(log).toContain(`gbrain-installer install: ok ${view.files.length} ${view.view_digest} ${destinations(h).join(',')} ${hook ? 'hook' : 'nohook'}`);
        expect(existsSync(landing(t, h))).toBe(true);
        expect(sha256(landing(t, h))).toBe(view.files.find((f) => f.path === instructionFile(h))!.sha256);
        const rec = JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')) as InstallRecord & { install: string; replaced_seed?: { path: string; sha256: string } | null; merged_hooks?: { path: string; block_sha256: string; bytes: number }; turn_hook?: { status: string; detail: string; plugin_dir?: string; commands?: string[]; doctor_exit?: number } };
        expect(rec).toMatchObject({ status: 'ok', code: null, harness: h, split: 'dev', install: 'gbrain-installer', view_digest: view.view_digest, files: view.files.length, destinations: destinations(h) });
        // Hermes seeded its default SOUL.md when the adapter ran it; the installer replaced exactly that file (its sha256 is the bundle's seed).
        if (h === 'hermes') expect(rec.replaced_seed).toEqual({ path: '/harness-state/hermes/SOUL.md', sha256: (views.hermes!.installer as { seed: { sha256: string } }).seed.sha256 });
        else expect(rec.replaced_seed ?? null).toBeNull();
        if (hook) {
          // gbrain#7489 at 10949a15: the harness's own account of the hook is the per-trial receipt (plugins inspect --runtime, hooks doctor).
          expect(rec.turn_hook).toMatchObject({ status: 'ok' });
          if (h === 'openclaw') {
            expect(rec.turn_hook!.plugin_dir).toBe('/harness-state/openclaw/gbrain/gbrain-turn-rule');
            expect(rec.turn_hook!.commands).toEqual(['openclaw plugins install --link /harness-state/openclaw/gbrain/gbrain-turn-rule --force --accept-capabilities', 'openclaw plugins enable gbrain-turn-rule', 'openclaw config set plugins.entries.gbrain-turn-rule.hooks.allowConversationAccess true']);
            for (const f of hookFiles(h)) expect(sha256(join(t.state, 'openclaw', 'gbrain', 'gbrain-turn-rule', f.split('/').pop()!))).toBe(view.files.find((v) => v.path === f)!.sha256);
            const inspect = JSON.parse(readFileSync(join(t.logs, 'gbrain-hook.openclaw.json'), 'utf8')) as { plugin: { status: string; enabled: boolean; source: string }; shape: string; typedHooks: Array<{ name: string }> };
            expect(inspect.plugin).toMatchObject({ status: 'loaded', enabled: true, source: '/harness-state/openclaw/gbrain/gbrain-turn-rule/index.js' });
            expect(inspect.shape).toBe('hook-only');
            expect(inspect.typedHooks.map((x) => x.name)).toEqual(['before_prompt_build']);
          } else {
            expect(rec.turn_hook!.doctor_exit).toBe(0);
            expect(rec.merged_hooks).toMatchObject({ path: '/harness-state/hermes/config.yaml' });
            const config = readFileSync(join(t.state, 'hermes', 'config.yaml'), 'utf8');
            expect(config).toContain('# gbrain:turn-rule:begin');
            expect(config.match(/^hooks:/gm)).toHaveLength(1);
            expect(config).toContain('mcp_servers:');
            expect(sha256(join(t.state, 'hermes', 'shell-hooks-allowlist.json'))).toBe(view.files.find((v) => v.path === 'home/shell-hooks-allowlist.json')!.sha256);
            const doctor = readFileSync(join(t.logs, 'gbrain-hook.hermes.log'), 'utf8');
            expect(doctor).toContain('[pre_llm_call]');
            expect(doctor).toContain('All shell hooks look healthy');
          }
        } else expect(rec.turn_hook).toBeUndefined();
        const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')) as Ready & { gbrain_install?: { install: string } };
        expect(ready.adapter_sha256).toBe(sha256(join(ROOT, ADAPTER_SCRIPT[h])));
        expect(ready.gbrain_install).toEqual({ status: 'ok', install: 'gbrain-installer', files: view.files.length, view_digest: view.view_digest, destinations: rec.destinations.join(','), ...(hook ? { turn_hook: h === 'openclaw' ? 'loaded' : 'healthy' } : {}) });

        // One turn against the fake endpoint, the way the adapter runs one (pin.json turn_command), with no key: the system prompt holds the block.
        writeFileSync(join(t.workspace, 'probe.md'), 'Say ok.\n');
        const exec = h === 'openclaw'
          ? await execInContainer(['-e', 'HOME=/harness-state', '-e', 'OPENCLAW_STATE_DIR=/harness-state/openclaw', '-e', 'OPENCLAW_CONFIG_PATH=/harness-state/openclaw/openclaw.json',
            '-e', `HE_MODEL_BASE_URL=http://host.docker.internal:${fake.port}/anthropic`, '-e', 'HE_MODEL_API_KEY=sk-trial-test', name,
            'openclaw', 'agent', 'exec', '--message-file', '/workspace/probe.md', '--cwd', '/workspace', '--config', '/harness-state/openclaw/openclaw.json', '--state-dir', '/harness-state/openclaw/exec', '--model', 'anthropic/claude-haiku-5-5', '--json'], 180_000)
          : await execInContainer(['-w', '/workspace', '-e', 'HOME=/harness-state', '-e', 'HERMES_HOME=/harness-state/hermes', '-e', `ANTHROPIC_BASE_URL=http://host.docker.internal:${fake.port}/anthropic`, '-e', 'ANTHROPIC_API_KEY=sk-trial-test', name,
            'hermes', 'chat', '--query-file', '/workspace/probe.md', '--oneshot', '--provider', 'anthropic', '--model', 'claude-haiku-5-5'], 180_000);
        const turn = firstTurn(fake.requests);
        expect(turn, `no model turn reached the fake endpoint (${fake.requests.length} other requests); exit ${exec.status}\n${exec.stderr.slice(-1500)}`).toBeDefined();
        const system = systemText(turn!);
        expect(system).toContain('<!-- gbrain:brain-first:begin -->');
        expect(system).toContain('## Memory: check GBrain first');
        if (h === 'hermes') expect(system).toContain('You are Hermes Agent, built by Nous Research.');
        if (hook) {
          // The per-turn rule reaches the model beside the user turn (OpenClaw prependContext, Hermes's hook context), not only the system prompt.
          const messages = JSON.stringify((turn as { messages: unknown[] }).messages);
          expect(messages, `the per-turn rule is not in the first request's messages; system prompt ${system.length} chars, messages ${messages.slice(0, 600)}`).toContain(hook.rule!.slice(0, 60));
        }
        expect(JSON.stringify(fake.requests)).not.toContain('he-install-test-token');
      } finally {
        fake.stop();
        stop(name);
      }
    }, 300_000);

    test(`${h}: a docs view mounted under HE_GBRAIN_INSTALL=gbrain-installer is HE-ADAPTER-006, exit 2, nothing copied and no ready`, async () => {
      const docs = join(tmp, 'installer-views', h, 'docs');
      await exportInstallView('harness-eval/gbrain:dev', h, 'dev', docs);
      const t = trialDirs(`${h}-installer-kind`);
      const name = startServe(h, `he-install-${h}-installer-kind`, t, docs, 'gbrain-installer');
      try {
        expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
        expect(existsSync(join(t.logs, 'ready'))).toBe(false);
        // Nothing landed: OpenClaw's workspace has no AGENTS.md; Hermes's SOUL.md is still the default it seeded itself (no block).
        if (h === 'hermes') expect(readFileSync(landing(t, h), 'utf8')).not.toContain('<!-- gbrain:brain-first:begin -->');
        else expect(existsSync(landing(t, h))).toBe(false);
        expect(existsSync(join(t.workspace, 'skills'))).toBe(false);
        expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain("HE-ADAPTER-006 the install bundle could not be applied: the view is for install 'gbrain-docs', this cell's gbrain.install is gbrain-installer");
      } finally {
        stop(name);
      }
    }, 180_000);
  }
});

// gbrain#7489 at 10949a15: the per-turn hook is applied only the way gbrain documents it. Hermes's installer appends its marked
// hooks block to a config.yaml without one and edits nothing else, so a config.yaml that already has a hooks: section is refused
// before anything is appended; OpenClaw's adapter runs the three documented commands and nothing else, so a bundle whose installer
// printed another set is refused before any openclaw command runs. Both are HE-ADAPTER-006 and exit 2 before ready.
const haveHook = haveInstaller && (() => {
  const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', INSTALLER_IMAGE, '/install/manifest.json'], { encoding: 'utf8' });
  const m = JSON.parse(r.stdout) as { harnesses: Record<string, { installer?: { turn_hook?: unknown } }> };
  return HARNESSES.every((h) => !!m.harnesses[h]?.installer?.turn_hook);
})();
if (haveInstaller && !haveHook) console.log(`adapter-install: the per-turn hook refusal tests skip, ${INSTALLER_IMAGE}'s installer bundle records no turn_hook (the block-only head)`);

describe.skipIf(!haveHook)('the adapters refuse a per-turn hook they cannot apply as gbrain documents it', () => {
  test('Hermes: a config.yaml that already has a hooks: section is HE-ADAPTER-006, exit 2, the file untouched, no hooks doctor and no ready', async () => {
    const view = join(tmp, 'installer-views', 'hermes', 'hooked-config');
    const manifest = await exportInstallView(INSTALLER_IMAGE, 'hermes', 'dev', view, 'gbrain-installer');
    expect(manifest.files.some((f) => f.path === 'home/config.yaml')).toBe(true);
    const t = trialDirs('hermes-installer-hooks');
    // The adapter copies its own config.yaml into HERMES_HOME only when none is there: this one stands in for a home whose owner had already configured a hook.
    const seeded = readFileSync(join(ROOT, 'harnesses', 'hermes', 'config', 'config.yaml'), 'utf8') + '\nhooks:\n  pre_llm_call:\n    - command: "/bin/echo \'{}\'"\n      timeout: 5\n';
    mkdirSync(join(t.state, 'hermes'), { recursive: true });
    writeFileSync(join(t.state, 'hermes', 'config.yaml'), seeded);
    const name = startServe('hermes', 'he-install-hermes-installer-hooks', t, view, 'gbrain-installer');
    try {
      expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(readFileSync(join(t.state, 'hermes', 'config.yaml'), 'utf8')).toBe(seeded);
      expect(existsSync(join(t.logs, 'gbrain-hook.hermes.log'))).toBe(false);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain("HE-ADAPTER-006 the install bundle could not be applied: /harness-state/hermes/config.yaml already has a hooks: section, which gbrain's installer does not edit");
      const rec = JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')) as InstallRecord & { install: string; merged_hooks?: unknown; turn_hook?: unknown };
      expect(rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'hermes', split: 'dev', install: 'gbrain-installer', view_digest: manifest.view_digest });
      expect(rec.merged_hooks).toBeUndefined();
      expect(rec.turn_hook).toBeUndefined();
    } finally {
      stop(name);
    }
  }, 180_000);

  test('Hermes: a view that carries the hooks block while the manifest records no turn_hook is HE-ADAPTER-006, exit 2, no hooks doctor and no ready', async () => {
    const view = join(tmp, 'installer-views', 'hermes', 'no-hook-record');
    const manifest = await exportInstallView(INSTALLER_IMAGE, 'hermes', 'dev', view, 'gbrain-installer');
    const { turn_hook: _dropped, ...rec } = manifest.installer as InstallerRecord;
    writeFileSync(join(view, 'manifest.json'), JSON.stringify({ ...manifest, installer: rec }, null, 1) + '\n');
    const t = trialDirs('hermes-installer-no-hook-record');
    const name = startServe('hermes', 'he-install-hermes-installer-no-hook-record', t, view, 'gbrain-installer');
    try {
      expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(existsSync(join(t.logs, 'gbrain-hook.hermes.log'))).toBe(false);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain("HE-ADAPTER-006 the install bundle could not be applied: the view carries a hooks block but the manifest's installer records no turn_hook");
      expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'hermes', install: 'gbrain-installer' });
    } finally {
      stop(name);
    }
  }, 180_000);

  test('OpenClaw: a view that carries the plugin files while the manifest records no turn_hook is HE-ADAPTER-006, exit 2, no openclaw command run and no ready', async () => {
    const view = join(tmp, 'installer-views', 'openclaw', 'no-hook-record');
    const manifest = await exportInstallView(INSTALLER_IMAGE, 'openclaw', 'dev', view, 'gbrain-installer');
    const { turn_hook: _dropped, ...rec } = manifest.installer as InstallerRecord;
    writeFileSync(join(view, 'manifest.json'), JSON.stringify({ ...manifest, installer: rec }, null, 1) + '\n');
    const t = trialDirs('openclaw-installer-no-hook-record');
    const name = startServe('openclaw', 'he-install-openclaw-installer-no-hook-record', t, view, 'gbrain-installer');
    try {
      expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      expect(existsSync(join(t.logs, 'gbrain-hook.openclaw.json'))).toBe(false);
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain("HE-ADAPTER-006 the install bundle could not be applied: the view carries 3 per-turn plugin files but the manifest's installer records no turn_hook");
      expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'openclaw', install: 'gbrain-installer' });
    } finally {
      stop(name);
    }
  }, 180_000);

  test('OpenClaw: a bundle whose installer printed other than the three documented commands is HE-ADAPTER-006, exit 2, no openclaw command run and no ready', async () => {
    const view = join(tmp, 'installer-views', 'openclaw', 'other-commands');
    const manifest = await exportInstallView(INSTALLER_IMAGE, 'openclaw', 'dev', view, 'gbrain-installer');
    const rec = manifest.installer as InstallerRecord;
    expect(rec.turn_hook!.commands).toHaveLength(3);
    // The installer record is outside the view digest (the files alone are under it), so the tamper is exactly one more printed command.
    const tampered = { ...manifest, installer: { ...rec, turn_hook: { ...rec.turn_hook!, commands: [...rec.turn_hook!.commands!, 'openclaw config set plugins.entries.gbrain-turn-rule.enabled true'] } } };
    writeFileSync(join(view, 'manifest.json'), JSON.stringify(tampered, null, 1) + '\n');
    const t = trialDirs('openclaw-installer-commands');
    const name = startServe('openclaw', 'he-install-openclaw-installer-commands', t, view, 'gbrain-installer');
    try {
      expect(await waitReadyOrExit(name, t.logs, 120_000)).toBe(2);
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      // No openclaw plugins or config command ran: no hook receipt, and OpenClaw's config names no plugin.
      expect(existsSync(join(t.logs, 'gbrain-hook.openclaw.log'))).toBe(false);
      expect(existsSync(join(t.logs, 'gbrain-hook.openclaw.json'))).toBe(false);
      expect(readFileSync(join(t.state, 'openclaw', 'openclaw.json'), 'utf8')).not.toContain('gbrain-turn-rule');
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain("HE-ADAPTER-006 the install bundle could not be applied: the installer's turn_hook.commands are not the documented three: ['openclaw plugins install --link <dir> --force --accept-capabilities', 'openclaw plugins enable gbrain-turn-rule', 'openclaw config set plugins.entries.gbrain-turn-rule.hooks.allowConversationAccess true', 'openclaw config set plugins.entries.gbrain-turn-rule.enabled true']");
      const r = JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8')) as InstallRecord & { install: string; turn_hook?: unknown };
      expect(r).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'openclaw', split: 'dev', install: 'gbrain-installer', view_digest: manifest.view_digest });
      expect(r.turn_hook).toBeUndefined();
    } finally {
      stop(name);
    }
  }, 180_000);
});
