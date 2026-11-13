/**
 * internal-task, the Particle-1 branch of the OpenClaw, Hermes and QM adapters (plan decisions 5, 6, 12 and 13). Keyless: placeholder
 * keys only, every spawned process gets a scrubbed environment, and the model is a fake Particle endpoint
 * (fixtures/particle/fake-particle.ts) that streams reasoning_content before content and reports usage, as Particle does.
 *
 * Process level (no docker):
 * 1. The fake's stream has Particle's shape, and each pin.json and Particle template says what the adapter hands the harness:
 *    the cell model, reasoning effort medium, an output cap of 128000, the housekeeping model mapped to the cell model, no
 *    Anthropic setting, no key and no fixed base URL.
 * 2. An OpenAI cell is unchanged by the Particle branch: each adapter, run with the stand-ins in fixtures/openai-branch/stub/,
 *    hands its harness the turn arguments, provider environment, serve response and ready file in fixtures/particle/golden/
 *    (written from main at 3a9b403be), and copies the checkout's OpenAI template verbatim. The Anthropic cell's byte identity
 *    is tests/openai-branch.test.ts.
 * 3. A Particle cell hands OpenClaw particle/<model> and its Particle config, and Hermes --provider custom:particle with OPENAI_*
 *    at <base>/v1 and no Anthropic variable.
 * 4. A Particle 400, 402 or 429 (fixtures/particle/stub-refused/, the text each CLI printed for Particle's error body) gets
 *    the exit the same text gets on an OpenAI cell: the adapters add nothing for Particle, and plan decision 12 (a 400 with
 *    code invalid_value or unsupported_parameter is model_error) is the runner's, from the metering proxy's record.
 *
 * Container level (docker and the harness-eval/openclaw:dev and harness-eval/hermes:dev images, skipped otherwise; the
 * checkout's adapter.sh, config/ and pin.json are mounted over /opt/harness). The proxy's Particle route (internal-task PR A) is not
 * on main yet, so each harness talks straight to the fake at <fake>/<slot>/particle, the URL shape runner/trial/proxy.ts
 * baseUrlFor gives a Particle cell; the coordinator's keyless step repeats this through the proxy.
 * 5. Each image completes one run turn and one serve turn: every model request is POST <base>/v1/chat/completions naming
 *    particle-1, the agent turn sends reasoning_effort medium and max_completion_tokens 128000 (at least Particle's own
 *    default of 32000), asks for usage in the stream, and there is no /v1/embeddings request and no Anthropic request.
 * 6. A Particle 400 invalid_value (code in its own field, as Particle sends it) is exit 2 in each image, as on every cell.
 * 7. OpenClaw's memory indexer on the Particle config indexes by keyword, finds a note, and sends no request at all.
 *
 * QM (the Pi engine at b6786d67):
 * 8. prepare.sh prints the Particle overrides only for a /particle URL, and compose.yaml then gives core no model provider, no
 *    Anthropic value and the model custom/particle/<model>; an Anthropic cell's core environment is what it always was.
 * 9. With harness-eval/qm:dev and qm-sandbox:dev built at the pin, one run turn through the compose stack against the fake:
 *    the adapter registers the custom provider, every request is a streamed chat completion naming particle-1 with effort
 *    medium and max_completion_tokens 128000, and an Anthropic trap URL on the fake is never called.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANTHROPIC_CELL, STUB_DIR, TOKEN, capture, captureProcess, dockerEnv, sha256, type Entry, type Harness } from './fixtures/openai-branch/capture.ts';
import { chatStream, type ParticleRequest } from './fixtures/particle/fake-particle.ts';
import { OPENAI_CELL, hostEnv, openaiGoldenPath } from './fixtures/particle/make-golden.ts';

const ROOT = join(import.meta.dir, '..');
const HARNESSES: Harness[] = ['openclaw', 'hermes'];
const harnessDir = (h: Harness) => join(ROOT, 'harnesses', h);
const image = (h: Harness) => `harness-eval/${h}:dev`;
const haveDocker = spawnSync('docker', ['info'], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const haveImage = (h: Harness) => haveDocker && spawnSync('docker', ['image', 'inspect', image(h)], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const gateway = haveDocker ? spawnSync('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8', env: dockerEnv() }).stdout.trim() : '';
const PARTICLE_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/particle', model: 'particle-1' };
const TEMPLATE: Record<Harness, string> = { openclaw: 'config/openclaw.particle.json', hermes: 'config/config.particle.yaml' };
const OUTPUT_CAP = 128000;
const PARTICLE_DEFAULT_CAP = 32000;
const NODE = Bun.which('node');
const HAVE_PY = Bun.which('python3') !== null;
// OpenClaw's config is JSON5: drop comments and trailing commas and quote the keys.
const json5 = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'));

describe('process level', () => {
  test('the Hermes gstack overlay refuses a Particle cell in chat mode (Anthropic config only) and lets an Anthropic cell through', () => {
    const overlay = readFileSync(join(ROOT, 'harnesses/hermes/gstack/adapter.sh'), 'utf8');
    const guard = overlay.split('\n').find(l => l.startsWith('case "${HE_MODEL_BASE_URL%/}" in */particle)'))!;
    expect(guard).toBeDefined();
    expect(overlay.indexOf(guard)).toBeLessThan(overlay.indexOf('export ANTHROPIC_API_KEY='));
    const run = (url: string) => spawnSync('bash', ['-c', 'wrap_fail() { echo "FAIL: $*"; exit 2; }\n' + guard + '\necho through'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HE_MODEL_BASE_URL: url } });
    const particle = run(PARTICLE_CELL.baseUrl);
    expect(particle.status).toBe(2);
    expect(particle.stdout).toContain('chat mode runs the Anthropic config only');
    expect(run(ANTHROPIC_CELL.baseUrl).stdout.trim()).toBe('through');
  });

  test('the fake streams reasoning_content before content, then finish_reason, then usage with reasoning tokens', () => {
    const chunks = chatStream({ stream_options: { include_usage: true } }).split('\n\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6)));
    const kinds = chunks.map(c => c.usage ? 'usage' : c.choices[0].finish_reason ? 'finish' : c.choices[0].delta.reasoning_content ? 'reasoning' : c.choices[0].delta.content ? 'content' : 'role');
    expect(kinds).toEqual(['role', 'reasoning', 'reasoning', 'content', 'finish', 'usage']);
    expect(chunks.at(-1).usage).toMatchObject({ completion_tokens: 25, completion_tokens_details: { reasoning_tokens: 20 } });
    expect(chatStream({ stream_options: { include_usage: true } }).endsWith('data: [DONE]\n\n')).toBe(true);
  });

  test('each pin.json names the Particle template, which sets effort medium and a 128000 output cap and holds no key, no fixed URL and no Anthropic setting', () => {
    for (const h of HARNESSES) {
      const pin = JSON.parse(readFileSync(join(harnessDir(h), 'pin.json'), 'utf8'));
      expect(pin.model.provider).toBe('anthropic');
      expect(pin.model_particle).toMatchObject({ api: h === 'openclaw' ? 'openai-completions' : 'chat_completions', config_path: TEMPLATE[h], reasoning_effort: 'medium', max_output_tokens: OUTPUT_CAP });
      const text = readFileSync(join(harnessDir(h), TEMPLATE[h]), 'utf8');
      expect(text).not.toMatch(/sk-|trial-token|api\.particle\.ai|anthropic|claude|haiku/i);
    }
    expect(JSON.parse(readFileSync(join(ROOT, 'harnesses', 'qm', 'pin.json'), 'utf8')).model_particle).toMatchObject({ reasoning_effort: 'medium', max_output_tokens: OUTPUT_CAP });
    const oc = json5(readFileSync(join(harnessDir('openclaw'), TEMPLATE.openclaw), 'utf8'));
    expect(Object.keys(oc.models.providers)).toEqual(['particle']);
    expect(oc.models.providers.particle).toMatchObject({ baseUrl: '${HE_MODEL_BASE_URL}/v1', apiKey: '${HE_MODEL_API_KEY}', api: 'openai-completions' });
    expect(oc.models.providers.particle.models).toEqual([{ id: '${HE_MODEL_NAME}', name: '${HE_MODEL_NAME}', reasoning: true, input: ['text'], contextWindow: 1048576, maxTokens: OUTPUT_CAP,
      compat: { maxTokensField: 'max_completion_tokens', supportsUsageInStreaming: true } }]);
    expect(oc.agents.defaults).toMatchObject({ model: { primary: 'particle/${HE_MODEL_NAME}' }, utilityModel: 'particle/${HE_MODEL_NAME}', thinkingDefault: 'medium', skipBootstrap: true });
    expect(oc.memory).toEqual({ search: { provider: 'none' } });
    const hm = readFileSync(join(harnessDir('hermes'), TEMPLATE.hermes), 'utf8');
    expect(hm).toContain('model:\n  provider: "custom:particle"\n  default: "particle-1"\n  base_url: "${OPENAI_BASE_URL}"\n');
    expect(hm).toContain('custom_providers:\n  - name: "particle"\n    base_url: "${OPENAI_BASE_URL}"\n    key_env: "OPENAI_API_KEY"\n    extra_body:\n      reasoning_effort: "medium"\n      max_completion_tokens: 128000\n');
    // Everything below the model section is config.openai.yaml's, so the Particle cell differs from the OpenAI cell only in the model.
    const tail = (t: string) => t.slice(t.indexOf('terminal:'));
    expect(tail(hm)).toBe(tail(readFileSync(join(harnessDir('hermes'), 'config/config.openai.yaml'), 'utf8')));
  });
});

describe.skipIf(!NODE || !HAVE_PY)('adapters at process level (stub CLIs, no image)', () => {
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(`${h} ${entry} on an OpenAI cell: turn arguments and environment, response and ready equal main's; the config is the OpenAI template verbatim`, async () => {
        const golden = JSON.parse(readFileSync(openaiGoldenPath(h, entry), 'utf8'));
        const c = await captureProcess({ harness: h, entry, harnessDir: harnessDir(h), ...OPENAI_CELL, env: hostEnv(harnessDir(h), h, NODE!) });
        expect(c.exit, c.logs).toBe(0);
        expect(JSON.stringify(c.turns, null, 1)).toBe(JSON.stringify(golden.turns, null, 1));
        expect(JSON.stringify(c.response)).toBe(JSON.stringify(golden.response));
        expect(JSON.stringify(c.ready)).toBe(JSON.stringify(golden.ready));
        // Hermes's serve entry appends the world server under mcp_servers to its copy; everything before it is the template.
        const template = readFileSync(join(harnessDir(h), h === 'openclaw' ? 'config/openclaw.openai.json' : 'config/config.openai.yaml'), 'utf8');
        if (h === 'hermes' && entry === 'serve') expect(c.config.startsWith(template + '\nmcp_servers:\n')).toBe(true);
        else expect(c.config).toBe(template);
        if (entry === 'serve') expect(c.adapter_sha256).toBe(sha256(join(harnessDir(h), 'adapter.sh')));
        rmSync(c.dir, { recursive: true, force: true });
      }, 60_000);

      test(`${h} ${entry} on a Particle cell: the Particle provider, model and template, and no Anthropic variable`, async () => {
        const c = await captureProcess({ harness: h, entry, harnessDir: harnessDir(h), ...PARTICLE_CELL, env: hostEnv(harnessDir(h), h, NODE!) });
        expect(c.exit, c.logs).toBe(0);
        expect(c.turns).toHaveLength(1);
        const { argv, env } = c.turns[0];
        if (h === 'openclaw') {
          expect(argv[argv.indexOf('--model') + 1]).toBe('particle/particle-1');
          expect(Object.keys(env).filter(k => /^(ANTHROPIC|OPENAI)_/.test(k))).toEqual([]);
        } else {
          expect(argv[argv.indexOf('--provider') + 1]).toBe('custom:particle');
          expect(argv[argv.indexOf('--model') + 1]).toBe('particle-1');
          expect(env).toEqual({ HERMES_HOME: '/harness-state/hermes', HOME: '/harness-state', OPENAI_API_KEY: TOKEN, OPENAI_BASE_URL: PARTICLE_CELL.baseUrl + '/v1' });
        }
        expect(c.config.startsWith(readFileSync(join(harnessDir(h), TEMPLATE[h]), 'utf8'))).toBe(true);
        expect(c.config).not.toContain(TOKEN);
        if (entry === 'serve') expect(c.response).toEqual({ turn: 1, exit: 0, reply_text: 'ok' });
        rmSync(c.dir, { recursive: true, force: true });
      }, 60_000);
    }

    test(`${h}: a Particle 400, 402 or 429 classifies as the same status does on an OpenAI cell (400 harness error; the runner applies plan decision 12)`, () => {
      // Exits as main's patterns give them for what the CLI printed in the image (the stand-ins replay it). OpenClaw's pattern
      // does not match its own 402 line (status=402, "billing error"), so a 402 is exit 2 there, on every cell, as before.
      const want: Record<string, number> = h === 'openclaw' ? { 400: 2, 402: 2, 429: 3 } : { 400: 2, 402: 3, 429: 3 };
      for (const status of ['400', '402', '429']) {
        const exits: Record<string, number | null> = {};
        for (const [name, cell] of Object.entries({ openai: OPENAI_CELL, particle: PARTICLE_CELL })) {
          const dir = mkdtempSync(join(tmpdir(), 'he-particle-refused-'));
          for (const d of ['workspace', 'state', 'logs']) mkdirSync(join(dir, d));
          writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
          writeFileSync(join(dir, 'state', 'stub-refused-status'), status);
          const env: Record<string, string> = { ...hostEnv(harnessDir(h), h, NODE!), HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'), HE_LOG_DIR: join(dir, 'logs'),
            HE_MODEL_BASE_URL: cell.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: cell.model, HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'refused' };
          env.PATH = [join(import.meta.dir, 'fixtures', 'particle', 'stub-refused'), STUB_DIR, env.PATH].join(':');
          exits[name] = spawnSync('bash', [join(harnessDir(h), 'adapter.sh'), 'run'], { env, stdio: 'ignore', timeout: 60_000 }).status;
          rmSync(dir, { recursive: true, force: true });
        }
        expect({ status, ...exits } as Record<string, unknown>).toEqual({ status, openai: want[status], particle: want[status] });
      }
    }, 60_000);
  }

  test('hermes: a Particle 402 or 429 is still exit 3 when the copies into stdout.log and stderr.log lag behind the CLI', () => {
    // fixtures/particle/slow-tee/ delays every tee write by 200 ms, so a model-error check that read the tee'd copies would
    // run before the HTTP line landed and give exit 2, as a loaded CI runner sometimes did.
    for (const status of ['402', '429']) {
      const dir = mkdtempSync(join(tmpdir(), 'he-particle-slow-tee-'));
      for (const d of ['workspace', 'state', 'logs']) mkdirSync(join(dir, d));
      writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
      writeFileSync(join(dir, 'state', 'stub-refused-status'), status);
      const env: Record<string, string> = { ...hostEnv(harnessDir('hermes'), 'hermes', NODE!), HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'), HE_LOG_DIR: join(dir, 'logs'),
        HE_MODEL_BASE_URL: PARTICLE_CELL.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: PARTICLE_CELL.model, HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'slow-tee' };
      env.PATH = [join(import.meta.dir, 'fixtures', 'particle', 'slow-tee'), join(import.meta.dir, 'fixtures', 'particle', 'stub-refused'), STUB_DIR, env.PATH].join(':');
      const exit = spawnSync('bash', [join(harnessDir('hermes'), 'adapter.sh'), 'run'], { env, stdio: 'ignore', timeout: 60_000 }).status;
      rmSync(dir, { recursive: true, force: true });
      expect({ status, exit }).toEqual({ status, exit: 3 });
    }
  }, 60_000);
});

describe.skipIf(!haveImage('openclaw') && !haveImage('hermes'))('one turn per entry on Particle-1 against the fake endpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'he-particle-fake-'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const fakes: Array<ReturnType<typeof Bun.spawn>> = [];
  // The fake runs as its own process: capture() blocks this one while the container runs.
  async function startFake(name: string, fail?: string): Promise<{ port: number; log: string }> {
    const log = join(dir, name + '.ndjson');
    const fake = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', 'particle', 'fake-particle.ts'), '--host', gateway, '--port', '0', '--log', log, '--expect-key', TOKEN, ...(fail ? ['--fail', fail] : [])],
      { env, stdout: 'pipe', stderr: 'ignore' });
    fakes.push(fake);
    return { port: await firstMatch(fake.stdout as ReadableStream<Uint8Array>, /listening (\d+)/), log };
  }
  let ok = { port: 0, log: '' };
  let refusing = { port: 0, log: '' };
  beforeAll(async () => { ok = await startFake('ok'); refusing = await startFake('refusing', '400:invalid_value'); });
  afterAll(() => { for (const f of fakes) f.kill(); rmSync(dir, { recursive: true, force: true }); });

  const baseUrl = (port: number, slot: string) => `http://host.docker.internal:${port}/${slot}/particle`;
  // Hermes classes the endpoint host as a local model server and probes it for metadata (pin.json model_openai.rig_limitation):
  // GET reads and POST /api/show, none of which names a model.
  const isProbe = (r: ParticleRequest) => r.method === 'GET' || r.path.endsWith('/api/show');

  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test.skipIf(!haveImage(h))(`${h} ${entry}: exit 0; every model request is a chat completion naming particle-1; the agent turn sends effort medium and max_completion_tokens ${OUTPUT_CAP}; no embeddings, no Anthropic request`, async () => {
        const slot = `particle-${h}-${entry}-${process.pid}`;
        const before = readLines<ParticleRequest>(ok.log).length;
        const c = await capture({ harness: h, entry, harnessDir: harnessDir(h), image: image(h), baseUrl: baseUrl(ok.port, slot), model: 'particle-1', name: `he-${slot}`, stub: false, budgetS: 120 });
        const requests = readLines<ParticleRequest>(ok.log).slice(before);
        rmSync(c.dir, { recursive: true, force: true });
        expect(c.exit, c.logs).toBe(0);
        if (entry === 'serve') expect(c.response).toEqual({ turn: 1, exit: 0, reply_text: 'ok' });
        expect(requests.every(r => r.path.startsWith(`/${slot}/particle/`))).toBe(true);
        expect(requests.filter(r => /embeddings/.test(r.path))).toEqual([]);
        expect(requests.filter(r => /\/v1\/messages|anthropic/i.test(r.path))).toEqual([]);
        if (h === 'openclaw') expect(requests.filter(isProbe)).toEqual([]);
        const calls = requests.filter(r => !isProbe(r));
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every(r => r.method === 'POST' && r.path === `/${slot}/particle/v1/chat/completions` && r.model === 'particle-1' && r.credential === 'expected')).toBe(true);
        const agent = calls.filter(r => r.tools > 0);
        expect(agent).toHaveLength(1);
        expect(agent[0]).toMatchObject({ stream: true, include_usage: true, reasoning_effort: 'medium', max_completion_tokens: OUTPUT_CAP, max_tokens: null });
        expect(agent[0].max_completion_tokens!).toBeGreaterThanOrEqual(PARTICLE_DEFAULT_CAP);
        // Hermes's one-shot title call (run entry only) goes to the cell model with reasoning_effort none, no tools and no cap, as
        // Hermes ships it (pin.json model_particle.auxiliary_models); OpenClaw makes no side call.
        const side = calls.filter(r => r.tools === 0);
        if (h === 'openclaw' || entry === 'serve') expect(side).toEqual([]);
        else expect(side.map(r => [r.reasoning_effort, r.max_completion_tokens, r.max_tokens])).toEqual([['none', null, null]]);
      }, 300_000);
    }

    test.skipIf(!haveImage(h))(`${h}: a Particle 400 invalid_value is exit 2 (harness error), as on every cell; plan decision 12 is the runner's`, async () => {
      const slot = `particle-refused-${h}-${process.pid}`;
      const c = await capture({ harness: h, entry: 'run', harnessDir: harnessDir(h), image: image(h), baseUrl: baseUrl(refusing.port, slot), model: 'particle-1', name: `he-${slot}`, stub: false, budgetS: 120 });
      const requests = readLines<ParticleRequest>(refusing.log).filter(r => r.path.startsWith(`/${slot}/`) && !isProbe(r));
      rmSync(c.dir, { recursive: true, force: true });
      expect(c.exit, c.logs).toBe(2);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every(r => r.model === 'particle-1')).toBe(true);
    }, 300_000);
  }

  test.skipIf(!haveImage('openclaw'))('openclaw: the memory indexer on the Particle config indexes by keyword, memory search finds the note, and no request is sent', () => {
    const slot = `particle-memory-${process.pid}`;
    const work = mkdtempSync(join(dir, 'memory-'));
    mkdirSync(join(work, 'workspace', 'memory'), { recursive: true });
    mkdirSync(join(work, 'state', 'openclaw'), { recursive: true });
    writeFileSync(join(work, 'workspace', 'MEMORY.md'), '# Notes\nTobias quotes parcel rates in GBP.\n');
    writeFileSync(join(work, 'workspace', 'memory', '2026-10-30.md'), 'Met June on Tuesday about the renewal date.\n');
    writeFileSync(join(work, 'state', 'openclaw', 'openclaw.json'), readFileSync(join(harnessDir('openclaw'), TEMPLATE.openclaw)));
    const before = readLines<ParticleRequest>(ok.log).length;
    const openclaw = (...args: string[]) => {
      try {
        return spawnSync('docker', ['run', '--rm', '--name', `he-${slot}`, '--user', `${process.getuid!()}:${process.getgid!()}`, '--add-host', 'host.docker.internal:host-gateway',
          '-v', `${join(work, 'workspace')}:/workspace`, '-v', `${join(work, 'state')}:/harness-state`,
          '-e', `HE_MODEL_BASE_URL=${baseUrl(ok.port, slot)}`, '-e', `HE_MODEL_API_KEY=${TOKEN}`, '-e', 'HE_MODEL_NAME=particle-1',
          '--entrypoint', 'openclaw', image('openclaw'), ...args], { encoding: 'utf8', env: dockerEnv(), timeout: 180_000 });
      } finally {
        spawnSync('docker', ['rm', '-f', `he-${slot}`], { env: dockerEnv(), stdio: 'ignore' });
      }
    };
    const status = openclaw('models', 'status', '--json');
    const index = openclaw('memory', 'index', '--force', '--agent', 'main');
    const search = openclaw('memory', 'search', 'Tobias parcel', '--agent', 'main');
    const requests = readLines<ParticleRequest>(ok.log).slice(before);
    rmSync(work, { recursive: true, force: true });
    expect(requests).toEqual([]);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout).utilityModel).toEqual({ ref: 'particle/particle-1', source: 'config' });
    expect(index.status, index.stdout + index.stderr).toBe(0);
    expect(index.stdout).toContain('2 files indexed');
    expect(search.status, search.stdout + search.stderr).toBe(0);
    expect(search.stdout).toMatch(/MEMORY\.md:\d+-\d+/);
  }, 300_000);
});

// ---- QM (Pi engine at b6786d67) ------------------------------------------------------------------------------------------
// QM can serve a Particle cell (plan decision 13's condition, checked keylessly): Pi's custom providers speak OpenAI Chat
// Completions at any base URL (protocol openai -> pi-ai openai-completions, src/model/custom-providers.ts), and with no Anthropic
// key the auxiliary model is the cell model (auxiliaryModelFor, src/model/pi-models.ts) and the Anthropic-only ack call is
// skipped (pickAckEmoji, src/agent/agent-run.ts). prepare.sh, compose.yaml and adapter.sh wire it; an Anthropic cell's stack
// is unchanged.
const QM_DIR = join(ROOT, 'harnesses', 'qm');
const QM_PIN: string = JSON.parse(readFileSync(join(QM_DIR, 'pin.json'), 'utf8')).commit;
const haveSocket = spawnSync('test', ['-S', '/var/run/docker.sock']).status === 0;
const haveCompose = haveDocker && spawnSync('docker', ['compose', 'version'], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const haveQmImages = haveDocker && ['harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev'].every(i => spawnSync('docker', ['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', i], { encoding: 'utf8', env: dockerEnv() }).stdout.trim() === QM_PIN);
const QM_OVERRIDES = ['QM_PI_MODEL', 'QM_MODEL_PROVIDER', 'QM_ANTHROPIC_API_KEY', 'QM_ANTHROPIC_BASE_URL'];

function qmPrepare(baseUrl: string, model: string): { status: number | null; vars: Record<string, string> } {
  // A stand-in docker answers prepare.sh's image check with the pinned commit, so no daemon or image is needed.
  const bin = mkdtempSync(join(tmpdir(), 'he-particle-qm-docker-'));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho ${QM_PIN}\n`, { mode: 0o755 });
  const r = spawnSync('bash', [join(QM_DIR, 'prepare.sh'), mkdtempSync(join(tmpdir(), 'he-particle-qm-out-'))], { encoding: 'utf8',
    env: { PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`, HOME: tmpdir(), HE_MODEL_BASE_URL: baseUrl, HE_MODEL_NAME: model, QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector' } });
  const vars: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1); }
  return { status: r.status, vars };
}

describe.skipIf(!haveSocket)('QM: prepare.sh and compose.yaml on a Particle cell', () => {
  test('prepare.sh prints the Particle overrides for a /particle URL and none for an Anthropic or OpenAI URL', () => {
    const particle = qmPrepare(PARTICLE_CELL.baseUrl, 'particle-1');
    expect(particle.status).toBe(0);
    expect(Object.fromEntries(QM_OVERRIDES.map(k => [k, particle.vars[k]]))).toEqual({ QM_PI_MODEL: 'custom/particle/particle-1', QM_MODEL_PROVIDER: '', QM_ANTHROPIC_API_KEY: '', QM_ANTHROPIC_BASE_URL: '' });
    for (const cell of [ANTHROPIC_CELL, OPENAI_CELL]) {
      const other = qmPrepare(cell.baseUrl, cell.model);
      expect(other.status).toBe(0);
      expect(Object.keys(other.vars).filter(k => QM_OVERRIDES.includes(k))).toEqual([]);
    }
  });

  test.skipIf(!haveCompose)('compose.yaml gives core the Anthropic values on an Anthropic cell and no provider, no Anthropic value and the custom model on a Particle cell', () => {
    const core = (cell: { baseUrl: string; model: string }) => {
      const prep = qmPrepare(cell.baseUrl, cell.model).vars;
      const r = spawnSync('docker', ['compose', '-f', join(QM_DIR, 'compose.yaml'), 'config', '--format', 'json'], { encoding: 'utf8',
        env: { ...dockerEnv(), ...prep, HE_STATE: '/tmp/s', HE_LOGS: '/tmp/l', HE_TURNS: '/tmp/t', HE_WORKSPACE: '/tmp/w', HE_MODEL_BASE_URL: cell.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: cell.model } });
      expect(r.status, r.stderr).toBe(0);
      const e = JSON.parse(r.stdout).services.core.environment;
      return { MODEL_PROVIDER: e.MODEL_PROVIDER, ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL: e.ANTHROPIC_BASE_URL, PI_MODEL: e.PI_MODEL };
    };
    expect(core(ANTHROPIC_CELL)).toEqual({ MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: TOKEN, ANTHROPIC_BASE_URL: ANTHROPIC_CELL.baseUrl, PI_MODEL: ANTHROPIC_CELL.model });
    expect(core(PARTICLE_CELL)).toEqual({ MODEL_PROVIDER: '', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', PI_MODEL: 'custom/particle/particle-1' });
  });
});

describe.skipIf(!NODE)('QM: a failed custom-provider registration (process level, stand-ins for curl and qm-api.mjs)', () => {
  test('a non-2xx PUT exits 2 before the first turn, removes the request file that holds the token, and logs no token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-register-'));
    for (const d of ['workspace', 'state', 'logs', 'bin']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
    writeFileSync(join(dir, 'bin', 'curl'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    // The qm-api.mjs stand-in records where the request body is and its mode, then answers the PUT with a 500.
    writeFileSync(join(dir, 'bin', 'node'), `#!/usr/bin/env bash\nif [ "\${1:-}" = /opt/harness/qm-api.mjs ]; then stat -c '%a %n' "\${7}" > ${join(dir, 'request-file.txt')}; echo '{"http":500,"body":{"error":"internal"}}'; exit 2; fi\nexec ${NODE} "$@"\n`, { mode: 0o755 });
    mkdirSync(join(dir, 'tmp'));
    const logs = join(dir, 'logs');
    const r = spawnSync('bash', [join(QM_DIR, 'adapter.sh'), 'run'], { encoding: 'utf8', timeout: 30_000, env: {
      PATH: `${join(dir, 'bin')}:/usr/local/bin:/usr/bin:/bin`, HE_WORKSPACE_DIR: join(dir, 'workspace'), HE_SESSION_STATE_DIR: join(dir, 'state'), HE_LOG_DIR: logs,
      HE_MODEL_BASE_URL: PARTICLE_CELL.baseUrl, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: 'particle-1', HE_TIME_BUDGET_S: '60', HE_TRIAL_ID: 'register',
      QM_CORE_URL: 'http://127.0.0.1:9', QM_SIGNING_SECRET: 'test-signing', TMPDIR: join(dir, 'tmp') } });
    expect(r.status, r.stderr).toBe(2);
    const [mode, requestFile] = readFileSync(join(dir, 'request-file.txt'), 'utf8').trim().split(' ');
    expect(mode).toBe('600');
    expect(requestFile.startsWith(join(dir, 'tmp') + '/')).toBe(true);
    expect(spawnSync('test', ['-e', requestFile]).status).toBe(1);
    expect(readFileSync(join(logs, 'adapter.log'), 'utf8')).toContain('custom provider registration failed: {"http":500');
    for (const name of ['adapter.log', 'stdout.log', 'stderr.log', 'qm-custom-provider-register.json']) expect(readFileSync(join(logs, name), 'utf8')).not.toContain(TOKEN);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    expect(spawnSync('test', ['-e', join(logs, 'qm-run-job.json')]).status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

// QM sandbox names derive from the scope (the actor U1), so a QM trial already running on this daemon would share this test's
// sandbox; the test then skips rather than touch it.
const qmSandboxes = (): string[] => haveDocker ? spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', 'label=qm.sandbox=1', '--filter', 'label=qm.org=harness-eval'], { encoding: 'utf8', env: dockerEnv() }).stdout.split('\n').filter(Boolean) : [];
const qmBusy = qmSandboxes().length > 0;

describe.skipIf(!haveQmImages || !haveCompose || qmBusy)(`QM: one run turn on Particle-1 against the fake endpoint (harness-eval/qm:dev and qm-sandbox:dev at the pin)${qmBusy ? ` [skipped: QM sandboxes already on this daemon: ${qmSandboxes().join(', ')}]` : ''}`, () => {
  test('exit 0, the custom provider registered, every request a streamed chat completion naming particle-1 with effort medium and max_completion_tokens 128000, no Anthropic call and no embeddings', async () => {
    const qmBefore = qmSandboxes();
    const dir = mkdtempSync(join(tmpdir(), 'he-particle-qm-'));
    for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
    const log = join(dir, 'fake.ndjson');
    const fake = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', 'particle', 'fake-particle.ts'), '--host', gateway, '--port', '0', '--log', log, '--expect-key', TOKEN],
      { env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'ignore' });
    const project = `he-particle-qm-${process.pid}`;
    // The checkout's adapter replaces the image's in the task container, as the other container tests mount theirs.
    const override = join(dir, 'compose.adapter.yaml');
    writeFileSync(override, `services:\n  task:\n    volumes:\n      - ${join(QM_DIR, 'adapter.sh')}:/opt/harness/adapter.sh:ro\n`);
    const compose = ['compose', '-f', join(QM_DIR, 'compose.yaml'), '-f', override, '-p', project];
    try {
      const port = await firstMatch(fake.stdout as ReadableStream<Uint8Array>, /listening (\d+)/);
      const env: Record<string, string> = { ...dockerEnv(), HE_WORKSPACE: join(dir, 'workspace'), HE_STATE: join(dir, 'state'), HE_LOGS: join(dir, 'logs'), HE_TURNS: join(dir, 'turns'),
        HE_MODEL_BASE_URL: `http://host.docker.internal:${port}/qm-${process.pid}/particle`, HE_MODEL_API_KEY: TOKEN, HE_MODEL_NAME: 'particle-1', HE_TIME_BUDGET_S: '180',
        HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'qm-particle', QM_IMAGE: 'harness-eval/qm:dev', HE_UID: String(process.getuid!()), HE_GID: String(process.getgid!()), COMPOSE_PROJECT_NAME: project };
      const prep = spawnSync('bash', [join(QM_DIR, 'prepare.sh'), dir], { encoding: 'utf8', env });
      expect(prep.status, prep.stderr).toBe(0);
      for (const line of prep.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1); }
      // A trap: core's Anthropic base URL points at the fake, so an Anthropic call would show up in its log even without a key.
      env.QM_ANTHROPIC_BASE_URL = `http://host.docker.internal:${port}/anthropic-trap`;
      const up = spawnSync('docker', [...compose, 'up', '--abort-on-container-exit', '--exit-code-from', 'task', '--no-color'], { encoding: 'utf8', env, timeout: 420_000 });
      const coreLog = spawnSync('docker', [...compose, 'logs', '--no-color', 'core'], { encoding: 'utf8', env }).stdout;
      const requests = readLines<ParticleRequest>(log);
      const adapterLog = readFileSync(join(dir, 'logs', 'adapter.log'), 'utf8');
      expect(up.status, adapterLog + coreLog.slice(-3000)).toBe(0);
      expect(adapterLog).toContain('custom provider particle registered for custom/particle/particle-1');
      expect(JSON.parse(readFileSync(join(dir, 'logs', 'qm-turn.json'), 'utf8')).body).toMatchObject({ status: 'ok', reply: 'ok' });
      const registered = readFileSync(join(dir, 'logs', 'qm-custom-provider-register.json'), 'utf8');
      expect(JSON.parse(registered).body.status).toMatchObject({ id: 'particle', protocol: 'openai', hasKey: true, models: [{ id: 'particle-1', reasoning: true, maxTokens: OUTPUT_CAP }] });
      expect(registered).not.toContain(TOKEN);
      for (const name of readdirSync(join(dir, 'logs'))) if (statSync(join(dir, 'logs', name)).isFile()) expect({ name, token: readFileSync(join(dir, 'logs', name), 'utf8').includes(TOKEN) }).toEqual({ name, token: false });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.filter(r => !r.path.startsWith(`/qm-${process.pid}/particle/`))).toEqual([]);
      expect(requests.every(r => r.method === 'POST' && r.path.endsWith('/particle/v1/chat/completions') && r.model === 'particle-1' && r.credential === 'expected')).toBe(true);
      expect(requests.every(r => r.stream && r.include_usage && r.reasoning_effort === 'medium' && r.max_completion_tokens === OUTPUT_CAP && r.max_tokens === null)).toBe(true);
      expect(requests.filter(r => r.tools > 0)).toHaveLength(1);
      expect(coreLog).not.toMatch(/claude|anthropic-trap/i);
    } finally {
      fake.kill();
      spawnSync('docker', [...compose, 'down', '-v', '--remove-orphans'], { env: { ...dockerEnv(), HE_STATE: join(dir, 'state'), HE_LOGS: join(dir, 'logs'), HE_TURNS: join(dir, 'turns'), HE_WORKSPACE: join(dir, 'workspace') }, stdio: 'ignore', timeout: 120_000 });
      // As capture.sh does after a trial: each sandbox core started, with its home volume and network (QM creates them outside
      // compose, and reuses a volume by scope name). Only sandboxes that were not there before this test are touched.
      for (const name of qmSandboxes().filter(n => !qmBefore.includes(n))) {
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
