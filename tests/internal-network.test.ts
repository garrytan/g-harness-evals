// internal-task: the internal network option (docs/adapters.md, "Network"). Keyless: the preregistration field, the docker run
// arguments and listen hosts of a default cell (unchanged) and of an internal one, and the refusals executeRun makes before
// any docker call. With a docker daemon: the network's shape, reuse and removal, and one trial through executeRun whose
// harness and gbrain sidecar are a probe image: it reaches the proxy, the world and the gbrain tap through
// host.docker.internal, its direct connections out fail, and the network is gone after the run. No model call is made;
// the proxy gets placeholder keys and every spawned process a scrubbed environment.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GradeResult, TrialEvidence } from '../runner/contracts.ts';
import { buildManifest, loadPrereg, renderPlan, type Cell, type Manifest, type Prereg } from '../runner/run.ts';
import { dockerRunArgs, ensureInternalNetwork, internalNetworkName, removeInternalNetwork } from '../runner/trial/docker.ts';
import { makeTrialDirs } from '../runner/trial/harness.ts';
import { executeRun } from '../runner/trial/run.ts';
import type { WorldEvent } from '../world/services/events.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURE_TASKS = join(ROOT, 'tests', 'fixtures', 'tasks');
const tmp = mkdtempSync(join(tmpdir(), 'he-internal-net-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cleanEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmp };
const proxyEnv = { ...cleanEnv, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };
const grade = (_e: TrialEvidence): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });

const cell = (over: Partial<Cell> = {}): Cell => ({
  id: 'net-internal', harness: '_fake', model: 'anthropic:claude-haiku-5-5', slice: 'multiuser', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, tasks: ['fx-leak'], network: 'internal', ...over,
});
const prereg = (cells: unknown[], runId: string): Prereg => ({ schema_version: 1, run_id: runId, question: 'internal network fixture', tasks: {}, cells: cells as Cell[], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] });
function writePrereg(cells: unknown[], runId: string): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify(prereg(cells, runId)));
  return file;
}
function manifestFor(cells: Cell[], runId: string, tasksRoot = FIXTURE_TASKS): { manifest: Manifest; path: string } {
  const { prereg: p, sha256 } = loadPrereg(writePrereg(cells, runId));
  const manifest = buildManifest(p, sha256, '2026-10-29T00:00:00Z', { tasksRoot });
  const path = join(tmp, runId, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return { manifest, path };
}

describe('the network cell field', () => {
  test('network "internal" is accepted and shown on the plan line; a cell without it plans as before', () => {
    const { manifest } = manifestFor([cell(), cell({ id: 'net-default', network: undefined })], 'net-plan');
    expect(manifest.cells[0]!.network).toBe('internal');
    expect(manifest.cells[1]!.network).toBeUndefined();
    const plan = renderPlan(manifest).split('\n');
    expect(plan.find((l) => l.startsWith('CELL: net-internal '))).toContain(' network=internal ');
    expect(plan.find((l) => l.startsWith('CELL: net-default '))).not.toContain('network');
  });

  test('any other value is HE-PREREG-007', () => {
    for (const [i, v] of ['bridge', 'host', 'Internal', 'internal ', '', true, null, 1].entries()) {
      expect(() => loadPrereg(writePrereg([{ ...cell(), network: v }], `net-bad-${i}`))).toThrow(/^HE-PREREG-007 cell net-internal: network must be "internal" or absent/);
    }
  });

  test('a cell that cannot run on it is HE-NET-001: process or scripted mode, a single-shot slice, a compose harness', () => {
    expect(() => loadPrereg(writePrereg([cell({ harness_mode: 'process' })], 'net-process'))).toThrow(/^HE-NET-001 .*harness_mode "process"/);
    expect(() => loadPrereg(writePrereg([cell({ harness: 'scripted', model: 'none', harness_mode: 'scripted', script: 'oracle' })], 'net-scripted'))).toThrow(/^HE-NET-001 .*harness_mode "scripted"/);
    expect(() => loadPrereg(writePrereg([cell({ slice: 'hello', tasks: ['hello'] })], 'net-hello'))).toThrow(/^HE-NET-001 .*slice hello/);
    expect(existsSync(join(ROOT, 'harnesses', 'qm', 'compose.yaml'))).toBe(true);
    expect(() => loadPrereg(writePrereg([cell({ harness: 'qm' })], 'net-qm'))).toThrow(/^HE-NET-001 .*compose stack/);
  });

  test('a codex cell without network "internal" is HE-NET-001; with it, it plans', () => {
    const codex = { harness: 'codex', model: 'openai:gpt-6.1-sol' };
    expect(() => loadPrereg(writePrereg([cell({ ...codex, network: undefined })], 'net-codex-bridge'))).toThrow(/^HE-NET-001 cell net-internal: harness codex needs network "internal"/);
    const { manifest } = manifestFor([cell(codex)], 'net-codex-internal');
    expect(manifest.cells[0]).toMatchObject({ harness: 'codex', network: 'internal' });
  });
});

describe('a default cell is unchanged', () => {
  const dirs = makeTrialDirs(join(tmp, 'args'));
  const base = { harness: '_fake', image: 'harness-eval/fake:dev', trialSlug: 'r-c-t-r1', dirs, env: { HE_TRIAL_ID: 'r/c/t/r1', HE_MODEL_NAME: 'claude-haiku-5-5' }, readOnlyMounts: { [join(tmp, 'view')]: '/he-gbrain-install' } };
  const user = `${process.getuid!()}:${process.getgid!()}`;
  const today = ['docker', 'run', '-d', '--name', 'he-r-c-t-r1', '--user', user, '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${dirs.workspace}:/workspace`, '-v', `${dirs.state}:/harness-state`, '-v', `${dirs.logs}:/he-logs`, '-v', `${dirs.turns}:/he-turns`,
    '-v', `${join(tmp, 'view')}:/he-gbrain-install:ro`, '-e', 'HE_TRIAL_ID=r/c/t/r1', '-e', 'HE_MODEL_NAME=claude-haiku-5-5', 'harness-eval/fake:dev', 'serve'];

  test('docker run arguments: the default bridge and host-gateway without a network; only those two values change with one', () => {
    expect(dockerRunArgs(base, 'he-r-c-t-r1')).toEqual(today);
    const internal = dockerRunArgs({ ...base, network: { name: 'he-net-r', gateway: '172.18.0.1' } }, 'he-r-c-t-r1');
    expect(internal).toHaveLength(today.length);
    expect(internal.flatMap((a, i) => (a === today[i] ? [] : [[i, today[i], a]]))).toEqual([[8, 'bridge', 'he-net-r'], [10, 'host.docker.internal:host-gateway', 'host.docker.internal:172.18.0.1']]);
    expect(internalNetworkName('host-harness-pilot-2026-10')).toBe('he-net-host-harness-pilot-2026-10');
    expect(internalNetworkName('Run.With/Odd_Chars')).toBe('he-net-run-with-odd-chars');
  });

  // 127.0.0.2 stands in for the bridge gateway and 127.0.0.3 for an internal network's gateway (both loopback on Linux).
  const run = (code: string) => Bun.spawnSync([process.execPath, '-e', code], { cwd: ROOT, env: { ...cleanEnv, HE_CONTAINER_HOST_IP: '127.0.0.2' }, stdout: 'pipe', stderr: 'pipe' });

  test('listen hosts: the bridge gateway without a gateway address, the given gateway with one, the loopback when no container needs a route', () => {
    const r = run("import { listenHost } from './runner/trial/world.ts'; console.log(listenHost(false), listenHost(true), listenHost(true, '127.0.0.3'), listenHost(false, '127.0.0.3'));");
    expect(r.stderr.toString()).toBe('');
    expect(r.stdout.toString().trim()).toBe('127.0.0.1 127.0.0.2 127.0.0.3 127.0.0.1');
  });

  test('the world and the run proxy bind the bridge gateway by default and the internal gateway when given it; containers get host.docker.internal either way', () => {
    const r = run(`
      import { mkdtempSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { TrialWorld } from './runner/trial/world.ts';
      import { RunProxy } from './runner/trial/proxy.ts';
      const dir = mkdtempSync(join(tmpdir(), 'net-bind-'));
      const out = {};
      try {
        for (const [k, gw] of [['default', undefined], ['internal', '127.0.0.3']]) {
          const world = new TrialWorld({ trialId: 'bind-' + k, split: 'dev', actors: ['dana-okafor'], outDir: join(dir, k), reachableFromContainers: true, ...(gw ? { gatewayAddress: gw } : {}) });
          await world.advanceClock(1);
          const proxy = await RunProxy.start({ runId: 'bind-' + k, runDir: join(dir, k), ledgerPath: join(dir, k, 'ledger.sqlite'), leaseUsd: 1, allowModels: [], reachableFromContainers: true, ...(gw ? { gatewayAddress: gw } : {}), startTimeoutMs: 5000 });
          out[k] = { world: world.localUrl, harness: world.harnessUrl, proxy: proxy.host, container: proxy.baseUrlFor('s', 'anthropic') };
          world.stop(); await proxy.stop();
        }
        console.log(JSON.stringify(out));
      } finally { rmSync(dir, { recursive: true, force: true }); }
    `);
    expect(r.stderr.toString()).toBe('');
    const out = JSON.parse(r.stdout.toString()) as Record<string, { world: string; harness: string; proxy: string; container: string }>;
    expect(new URL(out.default!.world).hostname).toBe('127.0.0.2');
    expect(out.default!.proxy).toBe('127.0.0.2');
    expect(new URL(out.internal!.world).hostname).toBe('127.0.0.3');
    expect(out.internal!.proxy).toBe('127.0.0.3');
    for (const k of ['default', 'internal']) {
      expect(new URL(out[k]!.harness).hostname).toBe('host.docker.internal');
      expect(new URL(out[k]!.container).hostname).toBe('host.docker.internal');
    }
  }, 30_000);
});

describe('executeRun refuses an invocation the internal network cannot serve, before any docker call', () => {
  const opts = { preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade, repoRoot: ROOT, proxyEnv };

  test('process mode', async () => {
    const { manifest, path } = manifestFor([cell()], 'net-run-process');
    await expect(executeRun(manifest, path, { ...opts, harnessMode: 'process' })).rejects.toThrow(/^HE-NET-001 cells net-internal .*process mode/);
  });

  test('internal and default-bridge harness cells in one invocation', async () => {
    const { manifest, path } = manifestFor([cell(), cell({ id: 'net-default', network: undefined })], 'net-run-mixed');
    await expect(executeRun(manifest, path, { ...opts, harnessMode: 'docker' })).rejects.toThrow(/^HE-NET-001 cells net-internal .*cells net-default run on the default bridge/);
  });

  test('a compose harness in a hand-edited manifest', async () => {
    const { manifest, path } = manifestFor([cell()], 'net-run-compose');
    manifest.cells[0]!.harness = 'qm';
    await expect(executeRun(manifest, path, { ...opts, harnessMode: 'docker' })).rejects.toThrow(/^HE-NET-001 cells net-internal .*compose stack/);
  });

  test('the refusals create no network', () => {
    const ls = spawnSync('docker', ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8', env: cleanEnv });
    if (ls.status === 0) expect(ls.stdout).not.toContain('he-net-net-run-');
  });
});

const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore', env: cleanEnv }).status === 0;
const haveBase = haveDocker && (spawnSync('docker', ['image', 'inspect', 'debian:bookworm-slim'], { stdio: 'ignore', env: cleanEnv }).status === 0
  || spawnSync('docker', ['pull', '-q', 'debian:bookworm-slim'], { stdio: 'ignore', env: cleanEnv }).status === 0);
const PROBE_IMAGE = 'harness-eval/net-probe:test';

// The probe is the harness (argument serve) and the gbrain sidecar (no argument) in one image: this machine's bun on
// debian. As the harness it records what it can reach into /he-logs/probe.json, writes ready and answers every turn.
const PROBE = [
  "import { connect } from 'node:net';",
  "import { lookup } from 'node:dns/promises';",
  "import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';",
  "process.on('SIGTERM', () => process.exit(0));",
  "const env = process.env;",
  "if (process.argv[2] !== 'serve') {",
  "  const token = 'probe-sidecar-token';",
  "  Bun.serve({ port: 3131, async fetch(req) {",
  "    const path = new URL(req.url).pathname;",
  "    if (path === '/health') return Response.json({ version: 'probe' });",
  "    if (path !== '/mcp' || req.method !== 'POST') return new Response('no', { status: 404 });",
  "    if (req.headers.get('authorization') !== 'Bearer ' + token) return new Response('unauthorized', { status: 401 });",
  "    const body = await req.json();",
  "    return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'probe_tool', inputSchema: { type: 'object' } }] } });",
  "  } });",
  "  writeFileSync(env.HE_GBRAIN_OUT + '/token', token);",
  "} else {",
  "  const reach = async (url, init = {}) => { try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) }); return { status: r.status, body: (await r.text()).slice(0, 4000) }; } catch (e) { return { status: 0, error: String(e && e.message || e) }; } };",
  "  const rpc = (url, token) => reach(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });",
  "  const tcp = (host, port) => new Promise((done) => { const s = connect({ host, port, timeout: 4000 }); s.on('connect', () => { s.destroy(); done('connected'); }); s.on('timeout', () => { s.destroy(); done('timeout'); }); s.on('error', (e) => done('error ' + e.code)); });",
  "  const out = {",
  "    hosts: [env.HE_MODEL_BASE_URL, env.HE_WORLD_MCP_URL, env.HE_GBRAIN_MCP_URL].map((u) => new URL(u).hostname),",
  "    proxy: await reach(new URL(env.HE_MODEL_BASE_URL).origin + '/__proxy/status'),",
  "    world: await rpc(env.HE_WORLD_MCP_URL, env.HE_WORLD_MCP_TOKEN),",
  "    gbrain: await rpc(env.HE_GBRAIN_MCP_URL, env.HE_GBRAIN_MCP_TOKEN),",
  "    ip: await tcp('1.1.1.1', 443),",
  "    host: await tcp('chatgpt.com', 443),",
  "    dns: await lookup('chatgpt.com').then((a) => 'resolved ' + a.address, (e) => 'error ' + e.code),",
  "  };",
  "  writeFileSync('/he-logs/probe.json', JSON.stringify(out));",
  "  writeFileSync('/he-logs/ready', JSON.stringify({ harness: 'net-probe', trial: env.HE_TRIAL_ID, ready_at: new Date().toISOString() }) + '\\n');",
  "  setInterval(() => {",
  "    for (const f of readdirSync('/he-turns').filter((f) => f.endsWith('.request.json')).sort()) {",
  "      const res = '/he-turns/' + f.replace('.request.json', '.response.json');",
  "      if (existsSync(res)) continue;",
  "      const req = JSON.parse(readFileSync('/he-turns/' + f, 'utf8'));",
  "      const now = new Date().toISOString();",
  "      writeFileSync(res + '.tmp', JSON.stringify({ turn: req.turn, exit: 0, reply_text: 'probe reply', started_at: now, ended_at: now }));",
  "      renameSync(res + '.tmp', res);",
  "    }",
  "  }, 250);",
  "}",
].join('\n');

function buildProbe(): void {
  const ctx = join(tmp, 'probe-image');
  mkdirSync(ctx, { recursive: true });
  copyFileSync(process.execPath, join(ctx, 'bun'));
  writeFileSync(join(ctx, 'probe.js'), PROBE);
  writeFileSync(join(ctx, 'Dockerfile'), 'FROM debian:bookworm-slim\nCOPY bun /usr/local/bin/bun\nCOPY probe.js /opt/probe/probe.js\nENTRYPOINT ["/usr/local/bin/bun", "/opt/probe/probe.js"]\n');
  const b = spawnSync('docker', ['build', '-q', '-t', PROBE_IMAGE, ctx], { encoding: 'utf8', env: cleanEnv });
  expect(b.status, b.stderr).toBe(0);
}

const docker = (args: string[]) => spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv });

describe.skipIf(!haveBase)('the internal network with a docker daemon', () => {
  test('built internal with inter-container traffic off, reused while it stands, refused when a plain network has its name, removed after', async () => {
    buildProbe();
    const name = `he-net-test-${process.pid}`;
    docker(['network', 'rm', name]);
    try {
      const net = await ensureInternalNetwork(name);
      const shape = docker(['network', 'inspect', name, '--format', '{{.Internal}} {{index .Options "com.docker.network.bridge.enable_icc"}} {{(index .IPAM.Config 0).Gateway}}']).stdout.trim();
      expect(shape).toBe(`true false ${net.gateway}`);
      expect(await ensureInternalNetwork(name)).toEqual(net);
      const server = `he-net-test-srv-${process.pid}`;
      docker(['rm', '-f', server]);
      try {
        expect(docker(['run', '-d', '--name', server, '--network', name, '--entrypoint', '/usr/local/bin/bun', PROBE_IMAGE, '-e', "process.on('SIGTERM', () => process.exit(0)); Bun.serve({ port: 8080, fetch: () => new Response('reached') });"]).status).toBe(0);
        const ip = docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${name}").IPAddress}}`, server]).stdout.trim();
        let fromHost = '';
        for (let i = 0; i < 40 && fromHost !== 'reached'; i++) { fromHost = await fetch(`http://${ip}:8080/`).then((r) => r.text(), () => ''); if (fromHost !== 'reached') await Bun.sleep(250); }
        expect(fromHost).toBe('reached');
        const peer = docker(['run', '--rm', '--network', name, '--entrypoint', '/usr/local/bin/bun', PROBE_IMAGE, '-e', `fetch('http://${ip}:8080/', { signal: AbortSignal.timeout(3000) }).then(() => console.log('reached'), () => console.log('blocked'))`]);
        expect(peer.stdout.trim()).toBe('blocked');
      } finally { docker(['rm', '-f', server]); }
      expect(await removeInternalNetwork(name)).toBe(true);
      expect(docker(['network', 'inspect', name]).status).not.toBe(0);
      expect(docker(['network', 'create', name]).status).toBe(0);
      await expect(ensureInternalNetwork(name)).rejects.toThrow(/^HE-NET-001 docker network he-net-test-\d+ exists but is not internal/);
    } finally { docker(['network', 'rm', name]); }
  }, 300_000);

  test('one trial through executeRun: the harness reaches the proxy, the world and the gbrain tap as host.docker.internal, nothing outside, and the network is removed', async () => {
    if (docker(['image', 'inspect', PROBE_IMAGE]).status !== 0) buildProbe();
    const tasksRoot = join(tmp, 'tasks');
    const taskDir = join(tasksRoot, 'multiuser', 'dev', 'net-probe');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'task.toml'), [
      'id = "net-probe"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 30', 'actors = ["dana-okafor"]', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "north-team"', 'text = "Which room?"', '',
      '[predicates]', 'required = []', 'forbidden_effects = []', '',
    ].join('\n'));
    const runId = `net-e2e-${process.pid}`;
    const { manifest, path } = manifestFor([cell({ id: 'net-e2e', tasks: ['net-probe'], gbrain: { surface: 'starter' } })], runId, tasksRoot);
    const result = await executeRun(manifest, path, {
      harnessMode: 'docker', image: PROBE_IMAGE, gbrainImage: PROBE_IMAGE, preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade, repoRoot: ROOT,
      turnGraceS: 5, stopGraceS: 5, readyTimeoutS: 90, proxyEnv,
    });
    const rec = result.records[0]!;
    const runLog = readFileSync(join(tmp, runId, 'run.log'), 'utf8');
    expect(rec.termination, `${rec.error}\n${runLog}`).toBe('completed');
    expect(rec.turns.exits).toEqual([0]);

    const net = internalNetworkName(runId);
    const gateway = runLog.match(new RegExp(`internal network ${net} \\(gateway (\\d+\\.\\d+\\.\\d+\\.\\d+)\\)`))?.[1];
    expect(gateway).toBeDefined();
    expect(gateway).not.toBe(docker(['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}']).stdout.trim());
    expect(runLog).toContain(`world for ${rec.trial_id} at http://${gateway}:`);
    const sidecarAt = runLog.match(/gbrain sidecar \S+ .* healthy at http:\/\/(\d+\.\d+\.\d+\.\d+):3131/)?.[1];
    expect(sidecarAt).toBeDefined();
    expect(sidecarAt!.split('.').slice(0, 2)).toEqual(gateway!.split('.').slice(0, 2));
    expect(runLog).toContain(`internal network ${net} removed`);

    const probe = JSON.parse(readFileSync(join(rec.paths.logs!, 'probe.json'), 'utf8')) as Record<string, any>;
    expect(probe.hosts).toEqual(['host.docker.internal', 'host.docker.internal', 'host.docker.internal']);
    expect(probe.proxy.status).toBe(200);
    expect(probe.world.status).toBe(200);
    expect(probe.world.body).toContain('"tools"');
    expect(probe.gbrain.status).toBe(200);
    expect(probe.gbrain.body).toContain('probe_tool');
    expect(probe.ip).toMatch(/^error /);
    expect(probe.host).toMatch(/^error /);
    expect(probe.dns).toMatch(/^error /);
    const events = readFileSync(rec.paths.events!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent);
    expect(events.filter((e) => e.via === 'gbrain').map((e) => e.tool)).toContain('gbrain.tools/list');

    expect(docker(['network', 'ls', '--format', '{{.Name}}']).stdout.split('\n')).not.toContain(net);
    expect(docker(['ps', '-a', '--format', '{{.Names}}']).stdout).not.toContain(runId);
  }, 300_000);
});
