// internal-task, the install ladder's adapter step (docs/adapters.md, "gbrain's documented install"): under
// HE_GBRAIN_INSTALL=gbrain-docs the OpenClaw and Hermes adapters verify the mounted install bundle view against its
// manifest and copy it to the documented destinations before ready; a tampered view is HE-ADAPTER-006, exit 2 and no
// ready. Keyless: the harness runs in serve mode against a model URL and a world URL nothing listens on, and no turn is
// posted. Needs docker and the harness-eval/gbrain:dev, harness-eval/openclaw:dev and harness-eval/hermes:dev images
// built from this checkout; skips without them.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportInstallView, gbrainImagePresent, type InstallViewManifest } from '../runner/trial/gbrain.ts';

const ROOT = resolve(import.meta.dir, '..');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const imagePresent = (image: string) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const HARNESSES = ['openclaw', 'hermes'] as const;
const haveImages = haveDocker && gbrainImagePresent() && HARNESSES.every((h) => imagePresent(`harness-eval/${h}:dev`));

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
function startServe(harness: string, name: string, t: Trial, viewDir: string): string {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  containers.push(name);
  const env = {
    HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_TRIAL_ID: name, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '30',
    HE_MODEL_BASE_URL: 'http://127.0.0.1:9/anthropic', HE_MODEL_API_KEY: 'sk-trial-test', HE_MODEL_NAME: 'claude-haiku-5-5',
    HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'he-install-test-token',
    HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_INSTALL_DIR: '/he-gbrain-install',
  };
  const args = ['run', '-d', '--name', name, '--user', `${process.getuid!()}:${process.getgid!()}`,
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
interface Ready { harness: string; adapter_sha256: string; gbrain_install?: { status: string; files: number; view_digest: string; destinations: string } }

describe.skipIf(!haveImages)("the OpenClaw and Hermes adapters apply gbrain's documented install from the mounted view", () => {
  const views: Partial<Record<(typeof HARNESSES)[number], InstallViewManifest>> = {};
  const viewDir = (h: string) => join(tmp, 'views', h, 'dev');

  test('the dev views export from the gbrain image and verify', async () => {
    for (const h of HARNESSES) views[h] = await exportInstallView('harness-eval/gbrain:dev', h, 'dev', viewDir(h));
    expect(views.openclaw!.files.length).toBe(127);
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
        expect(ready.adapter_sha256).toBe(sha256(join(ROOT, 'harnesses', h, 'adapter.sh')));
        expect(ready.gbrain_install).toEqual({ status: 'ok', files: view.files.length, view_digest: view.view_digest, destinations: rec.destinations.join(',') });

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
