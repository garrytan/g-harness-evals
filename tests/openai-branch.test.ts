/**
 * internal-task, the OpenAI branch of the OpenClaw and Hermes adapters (plan decisions 1 and 2). Keyless: placeholder keys only,
 * every spawned process gets a scrubbed environment, and the model is a fake OpenAI endpoint behind the real metering proxy.
 *
 * Process level: the fake's Responses stream meters through the proxy's own usage parser, and each pin.json names the
 * config template the adapter copies on an OpenAI cell. And the byte-identity check below without docker or the images:
 * each adapter runs on this host on an Anthropic cell with the stand-ins in fixtures/openai-branch/stub/ (captureProcess),
 * and the config file it leaves, the turn arguments, the provider environment, the serve response and the ready file must
 * equal the goldens. OpenClaw's serve config is OpenClaw's own rewrite in `openclaw mcp set`, which no stand-in can
 * reproduce, so there the adapter's two inputs are compared instead: the template copy (the run golden's config) and the
 * server definition it hands `mcp set` (the golden serve config's mcp.servers.world).
 *
 * Container level (docker and the harness-eval/openclaw:dev and harness-eval/hermes:dev images, skipped otherwise; the
 * checkout's adapter.sh, config/ and pin.json are mounted over /opt/harness, so the image only supplies the pinned CLI):
 * 1. An Anthropic cell is byte-identical to c1c7ed1b3 (fixtures/openai-branch/golden/, written by make-golden.ts): the
 *    harness's config file as the adapter leaves it, the turn arguments and provider environment, the serve response and
 *    the ready file. The differences are adapter_sha256, which is the checkout's adapter file, and the intended changes
 *    `intended` lists (Hermes's lazy installs off; internal-task: the cell model as the answering model's default, and Hermes's
 *    agent.image_input_mode text).
 * 2. An OpenAI cell hands OpenClaw openai/<model> and its OpenAI config, and Hermes --provider openai-api with OPENAI_*.
 * 3. Each image on an OpenAI cell through the real proxy in lease mode (--allow-models openai:gpt-6-luna,
 *    --max-output-tokens 128000 as every shard runs it, --upstream openai=<fake>, a slot bound with a per-trial token)
 *    completes one turn: every request that names a model names gpt-6-luna, none of them is refused, the fake sees only the
 *    proxy's placeholder key, reasoning effort is medium, OpenClaw states its catalog cap of 128000; and a model the
 *    allowlist refuses maps to exit 3.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sseUsage } from '../runner/proxy/metering-proxy.ts';
import { ANTHROPIC_CELL, TOKEN, capture, captureProcess, dockerEnv, goldenOf, goldenPath, sha256, type Entry, type Harness } from './fixtures/openai-branch/capture.ts';
import { responseStream, type FakeRequest } from './fixtures/openai-branch/fake-openai.ts';
import { withCellModelDefaults } from './fixtures/model-defaults.ts';
import { withTextImageMode } from './fixtures/hermes-image-mode.ts';

const ROOT = join(import.meta.dir, '..');
const HARNESSES: Harness[] = ['openclaw', 'hermes'];
const harnessDir = (h: Harness) => join(ROOT, 'harnesses', h);
const image = (h: Harness) => `harness-eval/${h}:dev`;
const haveDocker = spawnSync('docker', ['info'], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const haveImage = (h: Harness) => haveDocker && spawnSync('docker', ['image', 'inspect', image(h)], { env: dockerEnv(), stdio: 'ignore' }).status === 0;
const gateway = haveDocker ? spawnSync('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8', env: dockerEnv() }).stdout.trim() : '';
const OPENAI_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/openai', model: 'gpt-6-luna' };
// The one intended change to an Anthropic cell since c1c7ed1b3 (internal-task smoke): Hermes's config turns off lazy installs.
const HERMES_NO_LAZY = '\n# No lazy pip installs at turn time (Bedrock\'s boto3, edge-tts): the trial\n# network has no package index, and no task uses those features (internal-task).\nsecurity:\n  allow_lazy_installs: false\n';
// internal-task: the answering model's defaults name the cell model (here ANTHROPIC_CELL.model); OpenClaw's housekeeping model stays its
// shipped default (internal-task, 2026-11-01). tests/fixtures/model-defaults.ts.
const intended = (h: Harness, config: string): string => {
  const c = withCellModelDefaults(h, config, ANTHROPIC_CELL.model);
  if (h !== 'hermes') return c;
  expect(c).toContain('check_for_updates: false\n');
  return withTextImageMode(c.replace('check_for_updates: false\n', 'check_for_updates: false\n' + HERMES_NO_LAZY));
};
const PROBE_ROUTES = new Set(['/api/v1/models', '/api/tags', '/v1/props', '/props', '/version', '/models', '/api/show']);

describe('process level', () => {
  test('the fake Responses stream carries usage the proxy meters', () => {
    expect(sseUsage(responseStream('gpt-6-luna'))).toMatchObject({ input_tokens: 12, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 } });
  });

  test('each pin.json names the OpenAI config template, which holds no key and no fixed base URL', () => {
    const want: Record<Harness, { file: string; provider: string; api: string }> = {
      openclaw: { file: 'config/openclaw.openai.json', provider: 'openai', api: 'openai-responses' },
      hermes: { file: 'config/config.openai.yaml', provider: 'openai-api', api: 'codex_responses' },
    };
    for (const h of HARNESSES) {
      const pin = JSON.parse(readFileSync(join(harnessDir(h), 'pin.json'), 'utf8'));
      expect(pin.model.provider).toBe('anthropic');
      expect(pin.model_openai).toMatchObject({ provider: want[h].provider, api: want[h].api, config_path: want[h].file, reasoning_effort: 'medium' });
      const text = readFileSync(join(harnessDir(h), want[h].file), 'utf8');
      expect(text).not.toMatch(/sk-|trial-token|api\.openai\.com/);
      expect(text).toContain(want[h].provider === 'openai' ? '"openai-responses"' : '"openai-api"');
    }
  });
});

const NODE = Bun.which('node');
const HAVE_PY = Bun.which('python3') !== null;

describe.skipIf(!NODE || !HAVE_PY)('an Anthropic cell is unchanged from c1c7ed1b3 apart from Hermes turning off lazy installs and the cell model as the answering-model default, process level (stub CLIs, no image)', () => {
  // What the image supplies besides the CLI: node and python3 on PATH, and its OPENCLAW_VERSION or HERMES_VERSION (the pin's version).
  const hostEnv = (h: Harness): Record<string, string> => {
    const version = JSON.parse(readFileSync(join(harnessDir(h), 'pin.json'), 'utf8')).version as string;
    return { PATH: [dirname(NODE!), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), ...(h === 'openclaw' ? { OPENCLAW_VERSION: version } : { HERMES_VERSION: version }) };
  };
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(`${h} ${entry}: config, turn arguments and environment, response and ready equal the goldens; only adapter_sha256 differs`, async () => {
        const golden = JSON.parse(readFileSync(goldenPath(h, entry), 'utf8'));
        const c = await captureProcess({ harness: h, entry, harnessDir: harnessDir(h), ...ANTHROPIC_CELL, env: hostEnv(h) });
        expect(c.exit, c.logs).toBe(0);
        expect(c.turns).toHaveLength(1);
        expect(JSON.stringify(c.turns, null, 1)).toBe(JSON.stringify(golden.turns, null, 1));
        expect(JSON.stringify(c.response)).toBe(JSON.stringify(golden.response));
        expect(JSON.stringify(c.ready)).toBe(JSON.stringify(golden.ready));
        if (h === 'openclaw' && entry === 'serve') {
          expect(c.config).toBe(intended('openclaw', JSON.parse(readFileSync(goldenPath('openclaw', 'run'), 'utf8')).config));
          expect(c.mcp).toEqual([{ name: 'world', definition: JSON.parse(golden.config).mcp.servers.world }]);
        } else {
          expect(c.config).toBe(intended(h, golden.config));
        }
        const sha = sha256(join(harnessDir(h), 'adapter.sh'));
        expect(sha).not.toBe(golden.adapter_sha256);
        if (entry === 'serve') expect(c.adapter_sha256).toBe(sha);
        rmSync(c.dir, { recursive: true, force: true });
      }, 60_000);
    }
  }
});

describe('an Anthropic cell is unchanged from c1c7ed1b3 apart from Hermes turning off lazy installs and the cell model as the answering-model default', () => {
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test.skipIf(!haveImage(h))(`${h} ${entry}: config, turn arguments and environment, response and ready are byte-identical; only adapter_sha256 differs`, async () => {
        const golden = JSON.parse(readFileSync(goldenPath(h, entry), 'utf8'));
        const c = await capture({ harness: h, entry, harnessDir: harnessDir(h), image: image(h), ...ANTHROPIC_CELL, name: `he-oai-golden-${h}-${entry}-${process.pid}` });
        expect(c.exit).toBe(0);
        const { adapter_sha256: goldenSha, ...rest } = golden;
        expect(JSON.stringify(goldenOf(c), null, 1)).toBe(JSON.stringify({ ...rest, config: intended(h, rest.config) }, null, 1));
        const sha = sha256(join(harnessDir(h), 'adapter.sh'));
        expect(sha).not.toBe(goldenSha);
        if (entry === 'serve') expect(c.adapter_sha256).toBe(sha);
        rmSync(c.dir, { recursive: true, force: true });
      }, 240_000);
    }
  }
});

describe('an OpenAI cell gets the OpenAI provider', () => {
  test.skipIf(!haveImage('openclaw'))('openclaw run and serve: --model openai/<model> and the OpenAI config with its env references unresolved', async () => {
    for (const entry of ['run', 'serve'] as Entry[]) {
      const c = await capture({ harness: 'openclaw', entry, harnessDir: harnessDir('openclaw'), image: image('openclaw'), ...OPENAI_CELL, name: `he-oai-cell-openclaw-${entry}-${process.pid}` });
      expect(c.exit).toBe(0);
      expect(c.turns).toHaveLength(1);
      const argv = c.turns[0].argv;
      expect(argv[argv.indexOf('--model') + 1]).toBe('openai/gpt-6-luna');
      expect(Object.keys(c.turns[0].env).filter(k => /^(ANTHROPIC|OPENAI)_/.test(k))).toEqual([]);
      const cfg = JSON.parse(c.config.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'));
      expect(cfg.models.providers.openai).toMatchObject({ baseUrl: '${HE_MODEL_BASE_URL}/v1', apiKey: '${HE_MODEL_API_KEY}', api: 'openai-responses' });
      expect(cfg.models.providers.anthropic).toBeUndefined();
      expect(cfg.agents.defaults).toMatchObject({ model: { primary: 'openai/${HE_MODEL_NAME}' }, utilityModel: 'openai/${HE_MODEL_NAME}', thinkingDefault: 'medium' });
      expect(cfg.memory).toEqual({ search: { provider: 'none' } });
      expect(c.config).not.toContain(TOKEN);
      if (entry === 'serve') expect(c.response).toEqual({ turn: 1, exit: 0, reply_text: 'ok' });
      rmSync(c.dir, { recursive: true, force: true });
    }
  }, 300_000);

  test.skipIf(!haveImage('hermes'))('hermes run and serve: --provider openai-api, OPENAI_BASE_URL at /v1, no Anthropic variables, the OpenAI config', async () => {
    for (const entry of ['run', 'serve'] as Entry[]) {
      const c = await capture({ harness: 'hermes', entry, harnessDir: harnessDir('hermes'), image: image('hermes'), ...OPENAI_CELL, name: `he-oai-cell-hermes-${entry}-${process.pid}` });
      expect(c.exit).toBe(0);
      expect(c.turns).toHaveLength(1);
      const argv = c.turns[0].argv;
      expect(argv[argv.indexOf('--provider') + 1]).toBe('openai-api');
      expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-6-luna');
      expect(c.turns[0].env).toEqual({ HERMES_HOME: '/harness-state/hermes', HOME: '/harness-state', OPENAI_API_KEY: TOKEN, OPENAI_BASE_URL: OPENAI_CELL.baseUrl + '/v1' });
      expect(c.config.startsWith(readFileSync(join(harnessDir('hermes'), 'config', 'config.openai.yaml'), 'utf8'))).toBe(true);
      if (entry === 'serve') expect(c.response).toEqual({ turn: 1, exit: 0, reply_text: 'ok' });
      rmSync(c.dir, { recursive: true, force: true });
    }
  }, 300_000);
});

describe.skipIf(!haveImage('openclaw') && !haveImage('hermes'))('one turn on gpt-6-luna through the real metering proxy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'he-openai-proxy-'));
  const fakeLog = join(dir, 'fake.ndjson'), usageLog = join(dir, 'usage.ndjson'), control = 'control-' + process.pid;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  let fake: ReturnType<typeof Bun.spawn>;
  let proxy: ReturnType<typeof Bun.spawn>;
  let port = 0;
  // Both run as their own processes: capture() blocks this one while the container runs.
  beforeAll(async () => {
    fake = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', 'openai-branch', 'fake-openai.ts'), '--host', '127.0.0.1', '--port', '0', '--log', fakeLog, '--expect-key', 'placeholder-openai'],
      { env, stdout: 'pipe', stderr: 'ignore' });
    const fakePort = await firstMatch(fake.stdout as ReadableStream<Uint8Array>, /listening (\d+)/);
    proxy = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', `${gateway}:0`, '--budget-ledger', join(dir, 'ledger.sqlite'), '--lease-usd', '1', '--run-id', 'openai-branch',
      '--new-run', '--max-output-tokens', '128000', '--allow-models', 'openai:gpt-6-luna', '--upstream', `openai=http://127.0.0.1:${fakePort}`, '--usage-log', usageLog, '--control-token', control],
      { cwd: ROOT, env: { ...env, OPENAI_API_KEY: 'placeholder-openai' }, stdout: 'ignore', stderr: 'pipe' });
    port = await firstMatch(proxy.stderr as ReadableStream<Uint8Array>, / on [0-9.]+:(\d+);/);
  });
  afterAll(() => { proxy?.kill(); fake?.kill(); rmSync(dir, { recursive: true, force: true }); });

  async function turn(h: Harness, model: string) {
    const slot = `oai-${h}-${model}-${process.pid}`.replace(/[^A-Za-z0-9-]/g, '-');
    const token = `trial-token:${slot}.${'0123456789abcdef'.repeat(2)}`;
    const bound = await fetch(`http://${gateway}:${port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: 'trial-token:' + slot, token }) });
    expect(bound.status).toBe(200);
    const fakeBefore = readLines<FakeRequest>(fakeLog).length;
    const c = await capture({ harness: h, entry: 'run', harnessDir: harnessDir(h), image: image(h), baseUrl: `http://host.docker.internal:${port}/${slot}/openai`, model, name: `he-${slot}`, stub: false, token, budgetS: 120 });
    const usage = readLines<{ key: string; route: string; model: string | null; outcome: string }>(usageLog).filter(l => l.key === 'trial-token:' + slot);
    rmSync(c.dir, { recursive: true, force: true });
    return { c, usage, requests: readLines<FakeRequest>(fakeLog).slice(fakeBefore) };
  }

  for (const h of HARNESSES) {
    test.skipIf(!haveImage(h))(`${h}: exit 0, every model request names gpt-6-luna on /v1/responses, none refused, effort medium, only the proxy's key upstream`, async () => {
      const { c, usage, requests } = await turn(h, 'gpt-6-luna');
      expect(c.exit).toBe(0);
      const named = usage.filter(l => l.model !== null);
      expect(named.length).toBeGreaterThan(0);
      expect(named.every(l => l.model === 'gpt-6-luna' && l.route === '/v1/responses' && l.outcome === 'forwarded')).toBe(true);
      const refused = usage.filter(l => l.outcome === 'refused');
      // Hermes classes the proxy host as a local server and probes it for a model server's metadata routes; the proxy refuses
      // them with no model at $0, as on an Anthropic cell. OpenClaw sends nothing else.
      if (h === 'openclaw') expect(refused).toEqual([]);
      else expect(refused.every(l => l.model === null && PROBE_ROUTES.has(l.route))).toBe(true);
      const turns = requests.filter(r => r.method === 'POST');
      expect(turns.length).toBe(named.length);
      expect(turns.every(r => r.path === '/v1/responses' && r.model === 'gpt-6-luna')).toBe(true);
      expect(requests.every(r => r.credential === 'expected')).toBe(true);
      expect(turns.filter(r => r.tools > 0).map(r => (r.reasoning as { effort?: string } | null)?.effort)).toEqual(['medium']);
      // OpenClaw states its catalog's output cap for gpt-6-luna, 128000, now that the OpenAI template no longer overrides it
      // (pin.json model_openai.max_output_tokens: against a proxy cap of 100000 every request was refused for stating 128000).
      if (h === 'openclaw') expect(turns.map(r => r.max_output_tokens)).toEqual(turns.map(() => 128000));
    }, 240_000);

    if (h === 'openclaw') {
      // host-harness-pilot-2026-10: OpenClaw's memory indexer embedded MEMORY.md and memory/*.md with the openai provider, found
      // the cell's key and sent POST /v1/embeddings for text-embedding-3-small, which the allowlist refused (11 model_error
      // trials). The OpenAI template now selects keyword-only memory search, which an Anthropic cell falls back to on its own.
      test.skipIf(!haveImage(h))('openclaw: the memory indexer on an OpenAI cell indexes keyword-only, memory search still finds a note, and no /v1/embeddings request is sent', async () => {
        const cell = await capture({ harness: h, entry: 'run', harnessDir: harnessDir(h), image: image(h), ...OPENAI_CELL, name: `he-oai-memory-config-${process.pid}` });
        expect(cell.exit).toBe(0);
        rmSync(cell.dir, { recursive: true, force: true });
        const slot = `oai-memory-${process.pid}`;
        const token = `trial-token:${slot}.${'0123456789abcdef'.repeat(2)}`;
        const bound = await fetch(`http://${gateway}:${port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: 'trial-token:' + slot, token }) });
        expect(bound.status).toBe(200);
        const work = mkdtempSync(join(dir, 'memory-'));
        mkdirSync(join(work, 'workspace', 'memory'), { recursive: true });
        mkdirSync(join(work, 'state', 'openclaw'), { recursive: true });
        writeFileSync(join(work, 'workspace', 'MEMORY.md'), '# Notes\nTobias quotes parcel rates in GBP.\n');
        writeFileSync(join(work, 'workspace', 'memory', '2026-10-30.md'), 'Met June on Tuesday about the renewal date.\n');
        writeFileSync(join(work, 'state', 'openclaw', 'openclaw.json'), cell.config);
        const fakeBefore = readLines<FakeRequest>(fakeLog).length;
        const openclaw = (...args: string[]) => {
          try {
            return spawnSync('docker', ['run', '--rm', '--name', `he-${slot}`, '--user', `${process.getuid!()}:${process.getgid!()}`, '--add-host', 'host.docker.internal:host-gateway',
              '-v', `${join(work, 'workspace')}:/workspace`, '-v', `${join(work, 'state')}:/harness-state`,
              '-e', `HE_MODEL_BASE_URL=http://host.docker.internal:${port}/${slot}/openai`, '-e', `HE_MODEL_API_KEY=${token}`, '-e', 'HE_MODEL_NAME=gpt-6-luna',
              '--entrypoint', 'openclaw', image(h), ...args], { encoding: 'utf8', env: dockerEnv(), timeout: 180_000 });
          } finally {
            spawnSync('docker', ['rm', '-f', `he-${slot}`], { env: dockerEnv(), stdio: 'ignore' });
          }
        };
        const index = openclaw('memory', 'index', '--force', '--agent', 'main');
        const search = openclaw('memory', 'search', 'Tobias parcel', '--agent', 'main');
        const usage = readLines<{ key: string; route: string }>(usageLog).filter(l => l.key === 'trial-token:' + slot || l.key === 'slot:' + slot);
        const requests = readLines<FakeRequest>(fakeLog).slice(fakeBefore);
        rmSync(work, { recursive: true, force: true });
        expect(usage.map(l => l.route)).toEqual([]);
        expect(requests).toEqual([]);
        expect(index.status, index.stdout + index.stderr).toBe(0);
        expect(index.stdout).toContain('2 files indexed');
        expect(search.status, search.stdout + search.stderr).toBe(0);
        expect(search.stdout).toMatch(/MEMORY\.md:\d+-\d+/);
      }, 300_000);
    }

    test.skipIf(!haveImage(h))(`${h}: a model off the allowlist is refused by the proxy and maps to exit 3`, async () => {
      const { c, usage, requests } = await turn(h, 'gpt-6.1-sol');
      expect(c.exit).toBe(3);
      expect(usage.some(l => l.model === 'gpt-6.1-sol' && l.outcome === 'refused')).toBe(true);
      expect(requests.filter(r => r.method === 'POST')).toEqual([]);
    }, 300_000);
  }
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
