/**
 * The OpenRouter branch of the OpenClaw and Hermes adapters: DeepSeek V4.1 Flash 1017 on the proxy's OpenRouter route.
 * Keyless: placeholder keys only, every spawned process gets an environment built from scratch, and the model is
 * tests/fixtures/openrouter/fake-openrouter.ts, which refuses a tool-call turn replayed without its reasoning, as DeepSeek
 * thinking mode does.
 *
 * 1. Each pin.json declares model_openrouter, and each template holds the cell model, effort high, an output cap of 128000,
 *    no key, no fixed URL and no Anthropic setting. QM declares none (its multi-user worktree has no OpenRouter branch).
 * 2. With the stand-in CLIs in fixtures/openai-branch/stub/, a /openrouter URL hands OpenClaw openrouter-proxy/<model> and its
 *    template, and Hermes --provider custom:openrouter-proxy with OPENAI_* at <base>/v1 and no Anthropic variable.
 * 3. The real harnesses, when HE_TEST_OPENCLAW_BIN (openclaw 2026.10.6) or HE_TEST_HERMES_BIN (hermes at the pinned commit)
 *    names one, run one turn on the template against the fake: the tool-call turn comes back with its reasoning, effort high
 *    and the 128000 cap are sent, and no other model route is called. Skipped otherwise; no image is needed.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { captureProcess, TOKEN, type Entry, type Harness } from './fixtures/openai-branch/capture.ts';
import { hostEnv } from './fixtures/particle/make-golden.ts';
import { DEEPSEEK_REPLAY_ERROR, startFakeOpenRouter, type FakeOpenRouterRequest } from './fixtures/openrouter/fake-openrouter.ts';

const ROOT = join(import.meta.dir, '..');
const HARNESSES: Harness[] = ['openclaw', 'hermes'];
const MODEL = 'deepseek/deepseek-v4.1-flash-1017';
const harnessDir = (h: Harness) => join(ROOT, 'harnesses', h);
const TEMPLATE: Record<Harness, string> = { openclaw: 'config/openclaw.openrouter.json', hermes: 'config/config.openrouter.yaml' };
const OPENROUTER_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/openrouter', model: MODEL };
const OUTPUT_CAP = 128000;
const NODE = Bun.which('node');
const HAVE_PY = Bun.which('python3') !== null;
const tmp = mkdtempSync(join(tmpdir(), 'openrouter-branch-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const json5 = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'));
const pin = (h: string) => JSON.parse(readFileSync(join(ROOT, 'harnesses', h, 'pin.json'), 'utf8'));

describe('pins and templates', () => {
  test('OpenClaw and Hermes declare model_openrouter with effort high and the 128000 cap; QM does not', () => {
    for (const h of HARNESSES) {
      expect(pin(h).model_openrouter).toMatchObject({ api: h === 'openclaw' ? 'openai-completions' : 'chat_completions', config_path: TEMPLATE[h], reasoning_effort: 'high', max_output_tokens: OUTPUT_CAP,
        provider: h === 'openclaw' ? 'openrouter-proxy' : 'custom:openrouter-proxy' });
      expect(Object.keys(pin(h)).indexOf('model_openrouter')).toBe(Object.keys(pin(h)).indexOf('model_particle') + 1);
      const text = readFileSync(join(harnessDir(h), TEMPLATE[h]), 'utf8');
      expect(text).not.toMatch(/sk-|trial-token|https?:\/\/|anthropic|claude|haiku|OPENROUTER_API_KEY/i);
      for (const line of text.split('\n').filter(l => /^\s*(base_url|baseUrl):/.test(l))) expect(line).toContain('${');
    }
    expect(pin('qm').model_openrouter).toBeUndefined();
  });

  test('the OpenClaw template is the generic Chat Completions provider with OpenRouter reasoning, effort high and the cell model for housekeeping', () => {
    const oc = json5(readFileSync(join(harnessDir('openclaw'), TEMPLATE.openclaw), 'utf8'));
    expect(Object.keys(oc.models.providers)).toEqual(['openrouter-proxy']);
    expect(oc.models.providers['openrouter-proxy']).toMatchObject({ baseUrl: '${HE_MODEL_BASE_URL}/v1', apiKey: '${HE_MODEL_API_KEY}', api: 'openai-completions' });
    expect(oc.models.providers['openrouter-proxy'].models).toEqual([{ id: '${HE_MODEL_NAME}', name: '${HE_MODEL_NAME}', reasoning: true, input: ['text'], contextWindow: 1048576, maxTokens: OUTPUT_CAP,
      compat: { maxTokensField: 'max_completion_tokens', supportsUsageInStreaming: true, thinkingFormat: 'openrouter' } }]);
    expect(oc.agents.defaults).toMatchObject({ model: { primary: 'openrouter-proxy/${HE_MODEL_NAME}' }, utilityModel: 'openrouter-proxy/${HE_MODEL_NAME}', thinkingDefault: 'high', skipBootstrap: true });
    expect(oc.memory).toEqual({ search: { provider: 'none' } });
  });

  test('the Hermes template names the custom provider with effort high twice over and the cap', () => {
    const hm = readFileSync(join(harnessDir('hermes'), TEMPLATE.hermes), 'utf8');
    expect(hm).toContain('model:\n  provider: "custom:openrouter-proxy"\n  default: "' + MODEL + '"\n  base_url: "${OPENAI_BASE_URL}"\n');
    expect(hm).toContain('custom_providers:\n  - name: "openrouter-proxy"\n    base_url: "${OPENAI_BASE_URL}"\n    key_env: "OPENAI_API_KEY"\n    extra_body:\n      reasoning:\n        effort: "high"\n      max_completion_tokens: 128000\n');
    expect(hm).toContain('\nagent:\n  reasoning_effort: "high"\n');
  });

  test.skipIf(!existsSync(join(ROOT, 'publication/manifest.json')))('the Hermes template is config.openai.yaml below the model section (private repository only: the public export scrubs work-lane codes in this template but keeps the pinned config.openai.yaml byte-identical)', () => {
    const hm = readFileSync(join(harnessDir('hermes'), TEMPLATE.hermes), 'utf8');
    const tail = (t: string) => t.slice(t.indexOf('terminal:'));
    expect(tail(hm)).toBe(tail(readFileSync(join(harnessDir('hermes'), 'config/config.openai.yaml'), 'utf8')));
  });

  test('the Hermes gstack overlay refuses an OpenRouter cell in chat mode, as it does a Particle cell', () => {
    const overlay = readFileSync(join(ROOT, 'harnesses/hermes/gstack/adapter.sh'), 'utf8');
    const guard = overlay.split('\n').find(l => l.startsWith('case "${HE_MODEL_BASE_URL%/}" in */openrouter)'))!;
    expect(guard).toBeDefined();
    expect(overlay.indexOf(guard)).toBeLessThan(overlay.indexOf('export ANTHROPIC_API_KEY='));
    const run = (url: string) => spawnSync('bash', ['-c', 'wrap_fail() { echo "FAIL: $*"; exit 2; }\n' + guard + '\necho through'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HE_MODEL_BASE_URL: url } });
    const refused = run(OPENROUTER_CELL.baseUrl);
    expect(refused.status).toBe(2);
    expect(refused.stdout).toContain('an OpenRouter cell needs the oneshot image');
    expect(run('http://host.docker.internal:18999/golden/anthropic').stdout.trim()).toBe('through');
  });

  test('the fake refuses a tool-call turn replayed without reasoning, with the error DeepSeek returns', async () => {
    const log = join(tmp, 'refusal.ndjson');
    const fake = startFakeOpenRouter({ host: '127.0.0.1', port: 0, log, expectKey: 'placeholder' });
    try {
      const call = { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'read', arguments: '{}' } }] };
      const send = (assistant: Record<string, unknown>) => fetch('http://127.0.0.1:' + fake.port + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer placeholder', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }, assistant, { role: 'tool', tool_call_id: 'c', content: 'x' }] }) });
      const bare = await send(call);
      expect(bare.status).toBe(400);
      expect(JSON.stringify(await bare.json())).toContain(DEEPSEEK_REPLAY_ERROR);
      for (const field of ['reasoning', 'reasoning_content']) expect((await send({ ...call, [field]: 'thought' })).status).toBe(200);
    } finally { fake.stop(true); }
  });
});

describe.skipIf(!NODE || !HAVE_PY)('adapters at process level (stub CLIs, no image)', () => {
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(`${h} ${entry} on an OpenRouter cell: the openrouter-proxy provider, model and template, and no Anthropic variable`, async () => {
        const c = await captureProcess({ harness: h, entry, harnessDir: harnessDir(h), ...OPENROUTER_CELL, env: hostEnv(harnessDir(h), h, NODE!) });
        expect(c.exit, c.logs).toBe(0);
        expect(c.turns).toHaveLength(1);
        const { argv, env } = c.turns[0];
        if (h === 'openclaw') {
          expect(argv[argv.indexOf('--model') + 1]).toBe('openrouter-proxy/' + MODEL);
          expect(Object.keys(env).filter(k => /^(ANTHROPIC|OPENAI|OPENROUTER)_/.test(k))).toEqual([]);
        } else {
          expect(argv[argv.indexOf('--provider') + 1]).toBe('custom:openrouter-proxy');
          expect(argv[argv.indexOf('--model') + 1]).toBe(MODEL);
          expect(env).toEqual({ HERMES_HOME: '/harness-state/hermes', HOME: '/harness-state', OPENAI_API_KEY: TOKEN, OPENAI_BASE_URL: OPENROUTER_CELL.baseUrl + '/v1' });
        }
        expect(c.config.startsWith(readFileSync(join(harnessDir(h), TEMPLATE[h]), 'utf8'))).toBe(true);
        expect(c.config).not.toContain(TOKEN);
        // DeepSeek has no medium effort; where this harness's other cells send medium (run and the multi-user serve), this sends high.
        expect(c.config).toContain(h === 'openclaw' ? 'thinkingDefault: "high"' : 'agent:\n  reasoning_effort: "high"');
        if (entry === 'serve') expect(c.response).toEqual({ turn: 1, exit: 0, reply_text: 'ok' });
        rmSync(c.dir, { recursive: true, force: true });
      }, 60_000);
    }
  }
});

/** One turn of the real harness on its OpenRouter template against the fake, with no key in its environment and every
 *  non-loopback request sent to a dead proxy, so nothing leaves the machine. */
async function realTurn(h: Harness, bin: string): Promise<{ exit: number | null; chats: FakeOpenRouterRequest[]; others: FakeOpenRouterRequest[]; out: string }> {
  const dir = mkdtempSync(join(tmp, h + '-'));
  for (const d of ['ws', 'state/exec', 'home/hermes']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'ws', 'instruction.md'), 'Use a tool once, then say ok.\n');
  const log = join(dir, 'fake.ndjson');
  const fake = startFakeOpenRouter({ host: '127.0.0.1', port: 0, log, expectKey: 'placeholder-openrouter' });
  const base = 'http://127.0.0.1:' + fake.port + '/o/openrouter';
  const env: Record<string, string> = { PATH: [dirname(bin), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), HOME: join(dir, 'home'), NODE_USE_ENV_PROXY: '1',
    HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' };
  let args: string[];
  if (h === 'openclaw') {
    copyFileSync(join(harnessDir(h), TEMPLATE[h]), join(dir, 'state', 'openclaw.json'));
    Object.assign(env, { HE_MODEL_BASE_URL: base, HE_MODEL_API_KEY: 'placeholder-openrouter', HE_MODEL_NAME: MODEL, OPENCLAW_STATE_DIR: join(dir, 'state'), OPENCLAW_CONFIG_PATH: join(dir, 'state', 'openclaw.json') });
    args = ['agent', 'exec', '--message-file', join(dir, 'ws', 'instruction.md'), '--cwd', join(dir, 'ws'), '--config', join(dir, 'state', 'openclaw.json'), '--state-dir', join(dir, 'state', 'exec'), '--model', 'openrouter-proxy/' + MODEL, '--json'];
  } else {
    copyFileSync(join(harnessDir(h), TEMPLATE[h]), join(dir, 'home', 'hermes', 'config.yaml'));
    Object.assign(env, { HERMES_HOME: join(dir, 'home', 'hermes'), OPENAI_API_KEY: 'placeholder-openrouter', OPENAI_BASE_URL: base + '/v1' });
    args = ['chat', '--query-file', join(dir, 'ws', 'instruction.md'), '--oneshot', '--provider', 'custom:openrouter-proxy', '--model', MODEL];
  }
  const child = Bun.spawn([bin, ...args], { cwd: join(dir, 'ws'), env, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 150_000);
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const exit = await child.exited;
  clearTimeout(timer);
  fake.stop(true);
  const seen = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as FakeOpenRouterRequest);
  return { exit, chats: seen.filter(r => r.method === 'POST' && r.path.endsWith('/v1/chat/completions')), others: seen.filter(r => r.method === 'POST' && !r.path.endsWith('/v1/chat/completions')), out: out + err };
}

const REAL: Record<Harness, string | undefined> = { openclaw: process.env.HE_TEST_OPENCLAW_BIN, hermes: process.env.HE_TEST_HERMES_BIN };
describe('the real harness on its OpenRouter template (keyless, against the fake)', () => {
  for (const h of HARNESSES) {
    test.skipIf(!REAL[h])(`${h} passes the tool-call turn's reasoning back, sends effort high and the 128000 cap, and calls nothing else`, async () => {
      const r = await realTurn(h, REAL[h]!);
      expect(r.exit, r.out.slice(-2000)).toBe(0);
      expect(r.others).toEqual([]);
      const agent = r.chats.filter(c => c.tools > 0);
      expect(agent.length).toBeGreaterThanOrEqual(2);
      for (const c of agent) {
        expect(c).toMatchObject({ model: MODEL, stream: true, include_usage: true, max_completion_tokens: OUTPUT_CAP, reasoning: { effort: 'high' }, credential: 'expected', provider: null });
        if (h === 'hermes') expect(c.reasoning_effort).toBe('high');
      }
      const replayed = agent[1].assistants.find(a => a.tool_calls > 0)!;
      expect(replayed).toBeDefined();
      expect(h === 'openclaw' ? replayed.reasoning : replayed.reasoning_content).toBe(true);
      expect(r.chats.every(c => c.model === MODEL && c.credential === 'expected')).toBe(true);
    }, 180_000);
  }
});
