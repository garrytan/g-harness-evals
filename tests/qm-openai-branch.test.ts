/**
 * QM on GPT-6.1 Sol, keyless. QM's own route for an OpenAI model is its built-in openai provider: MODEL_PROVIDER openai,
 * OPENAI_BASE_URL and OPENAI_API_KEY (src/model/provider-endpoints.ts, src/deployment/secret-schema.ts at the pin), and Pi then
 * calls the Responses API (pi-ai openai-responses) for the cell model and for QM's openai housekeeping model, gpt-5.6-luna. The
 * runner merges harnesses/qm/compose.openai.yaml over compose.yaml for an openai cell, which sets those three; prepare.sh and
 * adapter.sh add nothing, so unlike the Particle branch no request body holds the token. pin.json model_openai records it.
 *
 * 1. pin.json declares the OpenAI transport: Responses, effort medium, output cap 128000 (the OpenClaw Sol cells' cap and the
 *    Particle branch's), housekeeping on gpt-5.6-luna as shipped.
 * 2. prepare.sh prints the same lines for a Sol URL as for an Opus URL, and adapter.sh run on a Sol cell (stand-ins for curl and
 *    qm-api.mjs) posts the turn and registers no custom provider, with no token in a log or a temp file.
 * 3. The stacks of an Opus, a Particle and a Sol cell (prepare.sh lines, compose files loaded, core and task environments, from
 *    "docker compose config") equal fixtures/qm-openai/golden/stack-environments.json, written from main at 2a47028c6b and
 *    rewritten for the QM 7689355c (now 77024e79) re-pin, which adds only the private-network origin variables (make-golden.ts).
 * 4. With harness-eval/qm:dev and qm-sandbox:dev built at the pin, one run turn through compose.yaml and compose.openai.yaml
 *    against a fake Responses endpoint (fixtures/openai-branch/fake-openai.ts): every request is a streamed POST /v1/responses
 *    with the dummy token, the agent turn names gpt-6.1-sol with effort medium and max_output_tokens 128000, side calls name
 *    gpt-5.6-luna, and core never names an Anthropic model.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FakeRequest } from './fixtures/openai-branch/fake-openai.ts';
import { QM_CELLS, QM_GOLDEN, TOKEN, qmPrepare, qmStack, type QmCell } from './fixtures/qm-openai/make-golden.ts';

const ROOT = join(import.meta.dir, '..');
const QM_DIR = join(ROOT, 'harnesses', 'qm');
const PIN = JSON.parse(readFileSync(join(QM_DIR, 'pin.json'), 'utf8'));
const OUTPUT_CAP = 128000;
const NODE = Bun.which('node');
const dockerEnv = () => ({ PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' });
const haveDocker = spawnSync('docker', ['info'], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const haveCompose = spawnSync('docker', ['compose', 'version'], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const haveQmImages = haveDocker && ['harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev'].every(i => spawnSync('docker', ['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', i], { encoding: 'utf8', env: dockerEnv() }).stdout.trim() === PIN.commit);
const gateway = haveDocker ? spawnSync('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8', env: dockerEnv() }).stdout.trim() : '';

describe('QM OpenAI branch: the declaration and the adapter', () => {
  test('pin.json model_openai: QM\'s own openai provider on the Responses API, effort medium, output cap 128000, housekeeping on gpt-5.6-luna', () => {
    expect(PIN.model_openai).toMatchObject({ api: 'openai-responses', route: 'POST <HE_MODEL_BASE_URL>/v1/responses, streamed', config_path: 'compose.openai.yaml', reasoning_effort: 'medium', max_output_tokens: OUTPUT_CAP });
    expect(PIN.model_openai.max_output_tokens).toBe(PIN.model_particle.max_output_tokens);
    expect(PIN.model_openai.auxiliary_models).toStartWith('gpt-5.6-luna, harness housekeeping, shipped default');
    expect(JSON.stringify(PIN.model_openai)).not.toMatch(/sk-|trial-token:/);
  });

  test('prepare.sh prints the same lines for a Sol URL as for an Opus URL, so the Particle overrides never reach a Sol cell', () => {
    const sol = qmPrepare(QM_DIR, QM_CELLS.sol.baseUrl, 'gpt-6.1-sol');
    const opus = qmPrepare(QM_DIR, QM_CELLS.opus.baseUrl, 'claude-opus-5-5');
    expect(sol.status, sol.stderr).toBe(0);
    expect(Object.keys(sol.vars)).toEqual(Object.keys(opus.vars));
    expect(Object.keys(sol.vars).filter(k => /^QM_(PI_MODEL|MODEL_PROVIDER|ANTHROPIC_)/.test(k))).toEqual([]);
  });

  test.skipIf(!NODE)('adapter.sh run on a Sol cell posts the turn and registers no custom provider; no log and no temp file holds the token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-openai-adapter-'));
    for (const d of ['workspace', 'state', 'logs', 'bin', 'tmp']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
    writeFileSync(join(dir, 'bin', 'curl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    // The qm-api.mjs stand-in records each call's subcommand and path argument, then answers a turn with ok.
    writeFileSync(join(dir, 'bin', 'node'), `#!/usr/bin/env bash\nif [ "\${1:-}" = /opt/harness/qm-api.mjs ]; then echo "\$2 \$5" >> ${join(dir, 'calls.txt')}; echo '{"http":200,"body":{"status":"ok","reply":"ok"}}'; exit 0; fi\nexec ${NODE} "\$@"\n`, { mode: 0o755 });
    const logs = join(dir, 'logs');
    const r = spawnSync('bash', [join(QM_DIR, 'adapter.sh'), 'run'], { encoding: 'utf8', timeout: 30_000, env: {
      PATH: `${join(dir, 'bin')}:/usr/local/bin:/usr/bin:/bin`, HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'), HE_LOG_DIR: logs,
      HE_MODEL_BASE_URL: QM_CELLS.sol.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: 'gpt-6.1-sol', HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'sol',
      QM_CORE_URL: 'http://127.0.0.1:9', QM_SIGNING_SECRET: 'test-signing', TMPDIR: join(dir, 'tmp') } });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'calls.txt'), 'utf8').trim().split('\n').map(l => l.split(' ')[0])).toEqual(['turn']);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    expect(readdirSync(logs).filter(n => n.startsWith('qm-custom-provider'))).toEqual([]);
    for (const name of readdirSync(logs)) expect({ name, token: readFileSync(join(logs, name), 'utf8').includes(TOKEN) }).toEqual({ name, token: false });
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!haveCompose)('QM OpenAI branch: the stack each cell model gets (docker compose config, no daemon)', () => {
  const golden = JSON.parse(readFileSync(QM_GOLDEN, 'utf8')) as Record<QmCell, unknown>;
  for (const cell of ['opus', 'particle', 'sol'] as QmCell[]) {
    test(`${cell}: prepare.sh lines, compose files and the core and task environments equal main's`, () => {
      expect(JSON.stringify(qmStack(QM_DIR, cell), null, 1)).toBe(JSON.stringify(golden[cell], null, 1));
    });
  }

  test('sol: core gets the proxy route plus /v1, the dummy token, MODEL_PROVIDER openai, the cell model and no Anthropic value', () => {
    const { files, core, task } = qmStack(QM_DIR, 'sol');
    expect(files).toEqual(['compose.yaml', 'compose.openai.yaml']);
    expect(core).toMatchObject({ OPENAI_BASE_URL: `${QM_CELLS.sol.baseUrl}/v1`, OPENAI_API_KEY: TOKEN, MODEL_PROVIDER: 'openai', PI_MODEL: 'gpt-6.1-sol', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '' });
    expect(Object.keys(task).filter(k => /^(OPENAI|ANTHROPIC)_/.test(k))).toEqual([]);
  });
});

// QM sandbox names derive from the scope (the actor U1), so a QM trial already running on this daemon would share this test's
// sandbox; the test then skips rather than touch it.
const qmSandboxes = (): string[] => haveDocker ? spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', 'label=qm.sandbox=1', '--filter', 'label=qm.org=harness-eval'], { encoding: 'utf8', env: dockerEnv() }).stdout.split('\n').filter(Boolean) : [];
const qmBusy = qmSandboxes().length > 0;

describe.skipIf(!haveQmImages || !haveCompose || qmBusy)(`QM OpenAI branch: one run turn on GPT-6.1 Sol against a fake Responses endpoint (images at the pin)${qmBusy ? ` [skipped: QM sandboxes already on this daemon: ${qmSandboxes().join(', ')}]` : ''}`, () => {
  test('exit 0; every request a streamed POST /v1/responses with the dummy token; the agent turn on gpt-6.1-sol at effort medium and max_output_tokens 128000; side calls on gpt-5.6-luna; no Anthropic model', async () => {
    const before = qmSandboxes();
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-openai-run-'));
    for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
    const log = join(dir, 'fake.ndjson');
    const fake = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', 'openai-branch', 'fake-openai.ts'), '--host', gateway, '--port', '0', '--log', log, '--expect-key', TOKEN],
      { env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'ignore' });
    const project = `he-qm-openai-${process.pid}`;
    // The checkout's adapter replaces the image's in the task container, as the other container tests mount theirs.
    const override = join(dir, 'compose.adapter.yaml');
    writeFileSync(override, `services:\n  task:\n    volumes:\n      - ${join(QM_DIR, 'adapter.sh')}:/opt/harness/adapter.sh:ro\n`);
    const compose = ['compose', '-f', join(QM_DIR, 'compose.yaml'), '-f', join(QM_DIR, 'compose.openai.yaml'), '-f', override, '-p', project];
    const dirs = { HE_WORKSPACE: join(dir, 'workspace'), HE_STATE: join(dir, 'state'), HE_LOGS: join(dir, 'logs'), HE_TURNS: join(dir, 'turns') };
    try {
      const port = await firstMatch(fake.stdout as ReadableStream<Uint8Array>, /listening (\d+)/);
      // The fake serves /v1/responses at its root, so the base URL carries no /<slot>/openai prefix; prepare.sh and adapter.sh
      // treat it as any non-Particle URL, and compose.openai.yaml is loaded by name as the runner loads it for an openai cell.
      const env: Record<string, string> = { ...dockerEnv(), ...dirs, HE_MODEL_BASE_URL: `http://host.docker.internal:${port}`, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: 'gpt-6.1-sol',
        HE_TIME_BUDGET_S: '180', HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'qm-sol', QM_IMAGE: 'harness-eval/qm:dev', HE_UID: String(process.getuid!()), HE_GID: String(process.getgid!()), COMPOSE_PROJECT_NAME: project };
      const prep = spawnSync('bash', [join(QM_DIR, 'prepare.sh'), dir], { encoding: 'utf8', env });
      expect(prep.status, prep.stderr).toBe(0);
      for (const line of prep.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1); }
      const up = spawnSync('docker', [...compose, 'up', '--abort-on-container-exit', '--exit-code-from', 'task', '--no-color'], { encoding: 'utf8', env, timeout: 420_000 });
      const coreLog = spawnSync('docker', [...compose, 'logs', '--no-color', 'core'], { encoding: 'utf8', env }).stdout;
      const requests = readLines<FakeRequest>(log);
      const adapterLog = readFileSync(join(dir, 'logs', 'adapter.log'), 'utf8');
      expect(up.status, adapterLog + coreLog.slice(-3000)).toBe(0);
      expect(adapterLog).not.toContain('custom provider');
      expect(JSON.parse(readFileSync(join(dir, 'logs', 'qm-turn.json'), 'utf8')).body).toMatchObject({ status: 'ok', reply: 'ok' });
      for (const name of readdirSync(join(dir, 'logs'))) if (statSync(join(dir, 'logs', name)).isFile()) expect({ name, token: readFileSync(join(dir, 'logs', name), 'utf8').includes(TOKEN) }).toEqual({ name, token: false });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every(r => r.method === 'POST' && r.path === '/v1/responses' && r.stream && r.credential === 'expected')).toBe(true);
      const turns = requests.filter(r => r.tools > 0);
      expect(turns.map(r => [r.model, (r.reasoning as { effort?: string } | null)?.effort, r.max_output_tokens])).toEqual([['gpt-6.1-sol', 'medium', OUTPUT_CAP]]);
      expect(requests.filter(r => r.tools === 0).every(r => r.model === 'gpt-5.6-luna')).toBe(true);
      expect(coreLog).not.toMatch(/claude/i);
    } finally {
      fake.kill();
      spawnSync('docker', [...compose, 'down', '-v', '--remove-orphans'], { env: { ...dockerEnv(), ...dirs }, stdio: 'ignore', timeout: 120_000 });
      // As capture.sh does after a trial: each sandbox core started, with its home volume and network. Only sandboxes that were
      // not there before this test are touched.
      for (const name of qmSandboxes().filter(n => !before.includes(n))) {
        spawnSync('docker', ['rm', '-f', name], { env: dockerEnv(), stdio: 'ignore' });
        spawnSync('docker', ['volume', 'rm', '-f', `qm-home-${name.replace(/^qm-sbx-/, '')}`], { env: dockerEnv(), stdio: 'ignore' });
        spawnSync('docker', ['network', 'rm', `qm-net-${name.replace(/^qm-sbx-/, '')}`], { env: dockerEnv(), stdio: 'ignore' });
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 480_000);
});

async function firstMatch(stream: ReadableStream<Uint8Array>, re: RegExp): Promise<number> {
  const reader = stream.getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('the process exited before it printed ' + re + ': ' + text);
    text += new TextDecoder().decode(value);
    const m = text.match(re);
    if (m) { reader.releaseLock(); return Number(m[1]); }
  }
}

function readLines<T>(path: string): T[] {
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T); } catch { return []; }
}
