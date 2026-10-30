// internal-task capture-only mode, keyless and without docker: the run subcommand's capture flags and their refusal for a
// run id that is not a capture run's, the proxy's capture environment (only PATH, HOME and dummy provider keys, whatever
// the parent environment holds), the proxy forwarding to a fake upstream with the dummy key, and docker run's --dns.
// Every key-named value here is a placeholder; no real key is read, printed or sent.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RunnerError } from '../runner/errors.ts';
import { CAPTURE_DUMMY_KEYS, captureDnsGapLine, captureLine, captureProxyEnv, captureSummary, parseCaptureOptions, type CaptureConfig } from '../runner/trial/capture.ts';
import { dockerRunArgs } from '../runner/trial/docker.ts';
import { proxyProcessEnv, RunProxy } from '../runner/trial/proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-capture-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const FAKE = 'http://127.0.0.1:9911';
const refusal = (f: () => unknown): RunnerError => {
  try { f(); } catch (e) { if (e instanceof RunnerError) return e; throw e; }
  throw new Error('expected a RunnerError');
};

describe('capture flags', () => {
  test('no capture flag means no capture mode', () => {
    expect(parseCaptureOptions({ runId: 'm3-heldout', upstream: [] })).toBeNull();
  });

  test('a run id that is not a capture run is refused with HE-RUN-002 and a fix line', () => {
    for (const o of [{ upstream: [`anthropic=${FAKE}`] }, { upstream: [], dns: '172.17.0.1' }]) {
      const e = refusal(() => parseCaptureOptions({ runId: 'v02-heldout-2026-10', ...o }));
      expect(e.code).toBe('HE-RUN-002');
      expect(e.message).toContain('"anatomy-capture-"');
      expect(e.message).toContain('fix: ');
    }
  });

  test('a capture run parses repeatable upstreams and the DNS address', () => {
    const c = parseCaptureOptions({ runId: 'anatomy-capture-openclaw', upstream: [`anthropic=${FAKE}/`, 'openai=http://127.0.0.1:9912'], dns: '172.17.0.1', providers: ['anthropic', 'openai'] });
    expect(c).toEqual({ upstream: { anthropic: FAKE, openai: 'http://127.0.0.1:9912' }, dns: '172.17.0.1' });
    expect(captureLine(c!)).toBe(`CAPTURE: upstream anthropic=${FAKE} openai=http://127.0.0.1:9912 dns=172.17.0.1 keys=dummy`);
    const one = parseCaptureOptions({ runId: 'anatomy-capture-x', upstream: [`anthropic=${FAKE}`] })!;
    expect(captureLine(one)).toBe(`CAPTURE: upstream anthropic=${FAKE} openai=none dns=none keys=dummy`);
    expect(captureSummary(one)).toEqual({ upstream: { anthropic: FAKE, openai: null }, dns: null, keys: 'dummy' });
  });

  test('bad values are refused', () => {
    const run = 'anatomy-capture-x';
    const cases: Array<[Parameters<typeof parseCaptureOptions>[0], string]> = [
      [{ runId: run, upstream: [`voyage=${FAKE}`] }, 'anthropic=<url> or openai=<url>'],
      [{ runId: run, upstream: ['anthropic'] }, 'http or https URL'],
      [{ runId: run, upstream: ['anthropic=ftp://x'] }, 'http or https URL'],
      [{ runId: run, upstream: [`anthropic=${FAKE}`, `anthropic=${FAKE}`] }, 'twice'],
      [{ runId: run, upstream: [], dns: '172.17.0.1' }, 'at least one --capture-upstream'],
      [{ runId: run, upstream: [`anthropic=${FAKE}`], dns: 'sink.local' }, 'IP address'],
      [{ runId: run, upstream: [`anthropic=${FAKE}`], dns: '' }, 'IP address'],
      [{ runId: run, upstream: [`anthropic=${FAKE}`], providers: ['anthropic', 'openai'] }, 'no --capture-upstream'],
    ];
    for (const [o, words] of cases) {
      const e = refusal(() => parseCaptureOptions(o));
      expect(e.code).toBe('HE-RUN-002');
      expect(e.message).toContain(words);
      expect(e.message).toContain('fix: ');
    }
  });
});

describe('the run subcommand', () => {
  // A scrubbed environment for the runner process: PATH and HOME only, so no key reaches it.
  const scrubbed = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmp };
  const runCli = (runId: string, args: string[]) => {
    const dir = mkdtempSync(join(tmp, 'run-'));
    const manifest = join(dir, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ run_id: runId, cells: [], trials: [] }));
    const r = Bun.spawnSync([process.execPath, join(ROOT, 'runner', 'run.ts'), 'run', '--manifest', manifest, ...args], { cwd: ROOT, env: scrubbed, stdout: 'pipe', stderr: 'pipe' });
    return { dir, code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };

  test('refuses capture flags for a counted run id before anything starts', () => {
    const r = runCli('m3-heldout', ['--capture-upstream', `anthropic=${FAKE}`]);
    expect(r.code).not.toBe(0);
    expect(r.stderr.trim()).toStartWith('HE-RUN-002 ');
    expect(r.stderr).toContain('fix: ');
    expect(r.stdout).not.toContain('CAPTURE:');
  });

  test('a capture run prints the CAPTURE line and records it in run-summary.json', () => {
    const r = runCli('anatomy-capture-cli', ['--capture-upstream', `anthropic=${FAKE}`, '--capture-dns', '172.17.0.1']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`CAPTURE: upstream anthropic=${FAKE} openai=none dns=172.17.0.1 keys=dummy`);
    const summary = JSON.parse(readFileSync(join(r.dir, 'run-summary.json'), 'utf8'));
    expect(summary.capture).toEqual({ upstream: { anthropic: FAKE, openai: null }, dns: '172.17.0.1', keys: 'dummy' });
  });

  test('a run with no capture flag writes no capture object', () => {
    const r = runCli('m3-plain', []);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('CAPTURE:');
    expect(JSON.parse(readFileSync(join(r.dir, 'run-summary.json'), 'utf8')).capture).toBeUndefined();
  });
});

describe('the capture proxy environment', () => {
  const capture: CaptureConfig = { upstream: { anthropic: FAKE }, dns: null };
  const parent = { PATH: '/placeholder/bin', HOME: '/placeholder/home', ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai', VOYAGE_API_KEY: 'placeholder-voyage', OTHER: 'x' };
  const expected = { PATH: '/placeholder/bin', HOME: '/placeholder/home', ...CAPTURE_DUMMY_KEYS };

  test('holds only PATH, HOME and the dummy keys, whatever the parent environment holds', () => {
    expect(captureProxyEnv(parent)).toEqual(expected);
    expect(proxyProcessEnv({ capture, env: parent })).toEqual(expected);
    expect(proxyProcessEnv({ capture }, parent)).toEqual(expected);
    expect(CAPTURE_DUMMY_KEYS).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-capture-dummy', OPENAI_API_KEY: 'sk-capture-dummy' });
  });

  test('ignores key values set in process.env', () => {
    const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
    process.env.ANTHROPIC_API_KEY = 'placeholder-process-anthropic';
    process.env.OPENAI_API_KEY = 'placeholder-process-openai';
    try {
      const env = proxyProcessEnv({ capture });
      expect(Object.keys(env).every((k) => ['ANTHROPIC_API_KEY', 'HOME', 'OPENAI_API_KEY', 'PATH'].includes(k))).toBe(true);
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-capture-dummy');
      expect(env.OPENAI_API_KEY).toBe('sk-capture-dummy');
    } finally {
      if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.o;
    }
  });

  test('without capture the given environment passes through unchanged', () => {
    expect(proxyProcessEnv({ env: parent })).toBe(parent);
  });

  test('the proxy forwards to the fake upstream with the dummy key, never the parent environment\'s', async () => {
    const seen: Array<{ path: string; key: string | null }> = [];
    const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (req) => {
      seen.push({ path: new URL(req.url).pathname, key: req.headers.get('x-api-key') });
      return Response.json({ id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } });
    } });
    const dir = mkdtempSync(join(tmp, 'proxy-'));
    let proxy: RunProxy | undefined;
    try {
      proxy = await RunProxy.start({ runId: 'anatomy-capture-proxy-test', runDir: dir, ledgerPath: join(dir, 'ledger.sqlite'), leaseUsd: 1, allowModels: ['anthropic:claude-sonnet-5-5'], reachableFromContainers: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-parent-anthropic', OPENAI_API_KEY: 'placeholder-parent-openai' },
        capture: { upstream: { anthropic: `http://127.0.0.1:${fake.port}` }, dns: null }, startTimeoutMs: 10_000 });
      await proxy.bind('trial', 'trial-token:capture', 'placeholder-trial-token');
      const res = await fetch(`${proxy.baseUrlFor('trial', 'anthropic', false)}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'placeholder-trial-token' },
        body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }) });
      expect(res.status).toBe(200);
      await proxy.finalize('trial-token:capture');
      expect(seen).toEqual([{ path: '/v1/messages', key: 'sk-ant-capture-dummy' }]);
    } finally {
      await proxy?.stop();
      fake.stop(true);
    }
  }, 20_000);
});

describe('docker run --dns', () => {
  const dirs = { root: '/t', workspace: '/t/workspace', state: '/t/state', logs: '/t/logs', turns: '/t/turns' };
  const base = { harness: 'openclaw', image: 'harness-eval/openclaw:dev', trialSlug: 'x', dirs, env: { HE_MODEL_NAME: 'claude-sonnet-5-5' } };

  test('is added only when set, before the image', () => {
    const plain = dockerRunArgs(base, 'he-x');
    expect(plain).not.toContain('--dns');
    const withDns = dockerRunArgs({ ...base, dns: '172.17.0.1' }, 'he-x');
    const at = withDns.indexOf('--dns');
    expect(withDns[at + 1]).toBe('172.17.0.1');
    expect(at).toBeLessThan(withDns.indexOf('harness-eval/openclaw:dev'));
    expect(withDns.filter((a) => a !== '--dns' && a !== '172.17.0.1')).toEqual(plain);
    expect(withDns.slice(-2)).toEqual(['harness-eval/openclaw:dev', 'serve']);
  });

  test('compose and process harnesses get one CAPTURE line saying egress is not observed', () => {
    const c: CaptureConfig = { upstream: { anthropic: FAKE }, dns: '172.17.0.1' };
    expect(captureDnsGapLine(c, ['openclaw', 'qm', 'qm'], 'docker', ROOT)).toBe('CAPTURE: dns 172.17.0.1 is not applied to compose harnesses (qm); egress is not observed for compose harnesses');
    expect(captureDnsGapLine(c, ['openclaw', 'hermes'], 'docker', ROOT)).toBeNull();
    expect(captureDnsGapLine(c, ['_fixture'], 'process', ROOT)).toContain('process-mode harnesses (_fixture)');
    expect(captureDnsGapLine({ ...c, dns: null }, ['qm'], 'docker', ROOT)).toBeNull();
  });
});
