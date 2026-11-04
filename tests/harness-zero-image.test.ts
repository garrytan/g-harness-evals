// Harness Zero's adapter, pin, image, provenance and runner checks, keyless. Process level always: adapter.sh refusals
// and the pin's hashes. Container level whenever docker is reachable: the image is built from the checkout (a build that
// fails is a failure, not a skip), its digest is recorded, preflight's provenance check passes on it and fails on a
// tampered copy, the ready record's candidate hash equals the checkout's, nothing is written outside the mounts, and the
// README's two-command quickstart (serve-smoke --fake-upstream) completes three turns.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateHash, resolveSet } from '../harnesses/harness-zero/zero.ts';
import { checkZeroConfig, loadPrereg, RunnerError, type Prereg } from '../runner/run.ts';
import { adapterProvenance, provenanceFiles } from '../runner/trial/provenance.ts';
import { adapterLog, ROOT, trial, ZERO_DIR } from './fixtures/harness-zero-fakes.ts';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const PIN = JSON.parse(readFileSync(join(ZERO_DIR, 'pin.json'), 'utf8'));
const BUN_DIR = process.execPath.replace(/\/[^/]+$/, '');
const cleanEnv = { PATH: BUN_DIR + ':/usr/local/bin:/usr/bin:/bin', HOME: tmpdir() };
const IMAGE = 'harness-eval/harness-zero:dev';
const docker = (args: string[], timeout = 300_000) => spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv, timeout });
const haveDocker = docker(['info'], 15_000).status === 0;

function adapter(t: ReturnType<typeof trial>, extra: Record<string, string>, entry = 'run', dir = ZERO_DIR) {
  return spawnSync('bash', [join(dir, 'adapter.sh'), entry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    env: { ...cleanEnv, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns, HE_TRIAL_ID: 'zero-adapter',
      HE_MODEL_BASE_URL: 'http://127.0.0.1:1/s/anthropic', HE_MODEL_API_KEY: 'trial-token:zero-adapter.abababababababababababababababab', HE_MODEL_NAME: 'claude-opus-5-5', HE_TIME_BUDGET_S: '5', ...extra } });
}

describe('harness-zero pin and adapter, process level', () => {
  test('pin.json carries the checkout hashes of zero.ts and adapter.sh, the Bun version and the base image the Dockerfile pins', () => {
    expect(PIN.integrity.zero_ts_sha256).toBe(sha(join(ZERO_DIR, 'zero.ts')));
    expect(PIN.integrity.adapter_sh_sha256).toBe(sha(join(ZERO_DIR, 'adapter.sh')));
    const dockerfile = readFileSync(join(ZERO_DIR, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('ARG BUN_IMAGE=' + PIN.base_image.ref + '@' + PIN.base_image.digest + '\n');
    expect(dockerfile).toContain('test "$(bun --version)" = "' + PIN.bun_version + '"');
    expect(Bun.version).toBe(PIN.bun_version);
    expect(PIN).toMatchObject({ name: 'harness-zero', topology: 'in-container', state_paths: ['/harness-state/zero', '/harness-state/tmp'] });
    expect(candidateHash(resolveSet('zero-min')).inputs).toMatchObject({ adapter_sh: PIN.integrity.adapter_sh_sha256, dockerfile: sha(join(ZERO_DIR, 'Dockerfile')), base_image_digest: PIN.base_image.digest, bun_version: PIN.bun_version });
  });

  test('the candidate hash changes with adapter.sh, the Dockerfile, the base image digest and the Bun version (R5, the 1b inputs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-zero-hash-'));
    cpSync(ZERO_DIR, dir, { recursive: true });
    const hash = () => candidateHash(resolveSet('zero-full'), dir).candidate_sha256;
    expect(hash()).toBe(candidateHash(resolveSet('zero-full')).candidate_sha256);
    const pin = (over: Record<string, unknown>) => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...PIN, ...over }));
    const changes: Array<[string, () => void]> = [
      ['adapter.sh', () => writeFileSync(join(dir, 'adapter.sh'), readFileSync(join(ZERO_DIR, 'adapter.sh'), 'utf8') + '\n')],
      ['Dockerfile', () => writeFileSync(join(dir, 'Dockerfile'), readFileSync(join(ZERO_DIR, 'Dockerfile'), 'utf8') + '\n')],
      ['base image digest', () => pin({ base_image: { ...PIN.base_image, digest: 'sha256:' + '0'.repeat(64) } })],
      ['Bun version', () => pin({ bun_version: '1.4.5' })],
    ];
    for (const [what, change] of changes) {
      const before = hash();
      change();
      expect(hash(), what).not.toBe(before);
    }
  });

  test('refusals before any model call: unknown entry, a missing variable (never printed), per-turn sessions, the install ladder, another Bun', () => {
    let t = trial();
    let r = adapter(t, {}, 'watch');
    expect(r.status).toBe(2);
    expect(adapterLog(t)).toContain("unknown entry point: watch; 'run' and 'serve' are implemented");
    t = trial();
    r = adapter(t, { HE_MODEL_NAME: '' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE-ZERO-008 HE_MODEL_NAME is not set');
    expect(r.stderr + r.stdout + adapterLog(t)).not.toContain('abababababababababababababababab');
    t = trial();
    expect(adapter(t, { HE_SESSION_SCOPE: 'turn' }).status).toBe(2);
    expect(adapterLog(t)).toContain('HE_SESSION_SCOPE=turn is not supported');
    t = trial();
    expect(adapter(t, { HE_GBRAIN_INSTALL: 'gbrain-docs', HE_GBRAIN_SPLIT: 'dev' }).status).toBe(2);
    expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-install.json'), 'utf8'))).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: 'harness-zero', install: 'gbrain-docs', split: 'dev' });
    const copy = mkdtempSync(join(tmpdir(), 'he-zero-pin-'));
    cpSync(ZERO_DIR, copy, { recursive: true });
    writeFileSync(join(copy, 'pin.json'), JSON.stringify({ ...PIN, bun_version: '0.0.1' }));
    t = trial();
    expect(adapter(t, {}, 'run', copy).status).toBe(2);
    expect(adapterLog(t)).toContain("HE-ZERO-008 bun " + Bun.version + " is not pin.json's 0.0.1");
  });

  test('the adapter hands zero.ts its sha256, HOME and TMPDIR under the state dir, and execs it (a model error on a closed port is exit 3)', () => {
    const t = trial();
    const r = adapter(t, { HE_HARNESS_CONFIG: 'zero-min' });
    expect(r.status, r.stderr).toBe(3);
    expect(adapterLog(t)).toContain('harness-zero adapter ' + sha(join(ZERO_DIR, 'adapter.sh')) + ' bun ' + Bun.version + ' entry=run config=zero-min');
    expect(adapterLog(t)).toContain('exit 3: HE-ZERO-007 model request failed');
    expect(existsSync(join(t.state, 'zero'))).toBe(true);
    expect(existsSync(join(t.state, 'tmp'))).toBe(true);
  }, 60_000);
});

describe('harness-zero in the runner', () => {
  const cell = { id: 'zero', harness: 'harness-zero', model: 'anthropic:claude-opus-5-5', slice: 'multiuser' as const, split: 'dev' as const, repetitions: 1, network: 'internal' as const, ceiling: { input_tokens: 1000, output_tokens: 100 } };
  const prereg = (c: Record<string, unknown>): string => {
    const p: Prereg = { schema_version: 1, run_id: 'zero-test', question: 'q', tasks: {}, cells: [c as unknown as Prereg['cells'][number]], wall_clock_s: { multiuser: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    const file = join(mkdtempSync(join(tmpdir(), 'he-zero-prereg-')), 'prereg.json');
    writeFileSync(file, JSON.stringify(p));
    return file;
  };
  const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return (e as RunnerError).code + ' ' + (e as Error).message; } };
  test('plan and dry-run (loadPrereg) refuse an unknown set and a cell off the internal network; known sets pass, zero-full-minus-layers among them, and the preflight check accepts it too', () => {
    expect(code(() => loadPrereg(prereg({ ...cell, config: 'zero-fast' })))).toStartWith('HE-ZERO-001 HE-ZERO-001 cell zero: config "zero-fast" is not a Harness Zero set; fix: use one of zero-min, zero-full, zero-full-minus-layers, zero-full-no-caching');
    expect(code(() => loadPrereg(prereg({ ...cell, network: undefined })))).toStartWith('HE-NET-001');
    for (const config of [undefined, 'zero-min', 'zero-full', 'zero-full-minus-layers', 'zero-full-no-effort-high', 'zero-lean']) expect(code(() => loadPrereg(prereg({ ...cell, config })))).toBe('ok');
    expect(code(() => checkZeroConfig({ id: 'x', harness: 'openclaw', config: 'route-tool' }))).toBe('ok');
    expect(code(() => checkZeroConfig({ id: 'x', harness: 'harness-zero', config: 'zero-full-minus-layers' }))).toBe('ok');
    expect(code(() => checkZeroConfig({ id: 'x', harness: 'harness-zero', config: 'zero-full-no-layers' }))).toStartWith('HE-ZERO-001');
  });
  test('provenance covers zero.ts, pin.json, the Dockerfile and every config file for harness-zero, and nothing extra for other harnesses', () => {
    expect(provenanceFiles('harness-zero', ROOT)).toEqual(['zero.ts', 'pin.json', 'Dockerfile', 'config/candidates.json', 'config/features.json', 'config/prompts/identity.md', 'config/prompts/planning.md',
      'config/prompts/safety.md', 'config/prompts/scope.md', 'config/prompts/style.md', 'config/prompts/tool-use.md']);
    expect(provenanceFiles('claude-code', ROOT)).toEqual([]);
  });
});

describe.skipIf(!haveDocker)('harness-zero image, container level', () => {
  test('builds from the checkout; its digest is recorded; preflight provenance passes, and fails on a tampered prompt file', async () => {
    const build = docker(['build', '-q', '-t', IMAGE, ZERO_DIR], 900_000);
    expect(build.status, build.stderr).toBe(0);
    const id = docker(['image', 'inspect', '-f', '{{.Id}}', IMAGE]).stdout.trim();
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
    console.log('harness-zero image ' + IMAGE + ' ' + id + ' (base ' + PIN.base_image.ref + '@' + PIN.base_image.digest + ')');
    const labels = JSON.parse(docker(['inspect', '-f', '{{json .Config.Labels}}', IMAGE]).stdout);
    expect(labels).toMatchObject({ 'harness-eval.harness': 'harness-zero', 'harness-eval.topology': 'in-container' });
    const p = await adapterProvenance('harness-zero', IMAGE, ROOT);
    expect(p.checkout_sha256).toBe(sha(join(ZERO_DIR, 'adapter.sh')));
    expect(Object.keys(p.files ?? {})).toEqual(provenanceFiles('harness-zero', ROOT).sort());
    const dir = mkdtempSync(join(tmpdir(), 'he-zero-tamper-'));
    writeFileSync(join(dir, 'Dockerfile'), 'FROM ' + IMAGE + '\nUSER root\nRUN chmod u+w /opt/harness/config/prompts/style.md && echo changed >> /opt/harness/config/prompts/style.md\n');
    const tag = 'harness-eval/harness-zero:tampered-' + process.pid;
    expect(docker(['build', '-q', '-t', tag, dir]).status).toBe(0);
    try {
      let msg = '';
      try { await adapterProvenance('harness-zero', tag, ROOT); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/^HE-ADAPTER-005 harness image .* carries config\/prompts\/style\.md [0-9a-f]{12} but harnesses\/harness-zero\/config\/prompts\/style\.md is [0-9a-f]{12}/);
    } finally { docker(['rmi', '-f', tag]); }
  }, 900_000);

  test('serve in a container: the ready candidate hash is the checkout\'s, /opt/harness is read-only, nothing is written outside the mounts', async () => {
    expect(docker(['image', 'inspect', IMAGE]).status, 'the image must exist after the build test').toBe(0);
    const t = trial('');
    const name = 'he-zero-ro-' + process.pid;
    docker(['rm', '-f', name]);
    const run = docker(['run', '-d', '-i', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--network', 'none',
      '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs', '-v', t.turns + ':/he-turns',
      '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_TURNS_DIR=/he-turns', '-e', 'HE_TRIAL_ID=zero-ro', '-e', 'HE_MODEL_BASE_URL=http://127.0.0.1:1/s/anthropic', '-e', 'HE_MODEL_API_KEY=trial-token:zero-ro.0',
      '-e', 'HE_MODEL_NAME=claude-opus-5-5', '-e', 'HE_WORLD_MCP_URL=http://127.0.0.1:1/mcp', '-e', 'HE_WORLD_MCP_TOKEN=x', IMAGE, 'serve']);
    expect(run.status, run.stderr).toBe(0);
    try {
      const until = Date.now() + 60_000;
      while (docker(['inspect', '-f', '{{.State.Running}}', name]).stdout.trim() === 'true' && Date.now() < until) await Bun.sleep(200);
      expect(docker(['inspect', '-f', '{{.State.ExitCode}}', name]).stdout.trim()).toBe('2');
      expect(adapterLog(t)).toContain('HE-ZERO-005 MCP server world could not be initialized');
      expect(existsSync(join(t.logs, 'ready'))).toBe(false);
      const look = docker(['run', '--rm', '--user', '1234:1234', '--entrypoint', 'bash', IMAGE, '-c', 'touch /opt/harness/x 2>/dev/null && echo writable || echo read-only; bun -e "const z = await import(\'/opt/harness/zero.ts\'); console.log(z.candidateHash(z.resolveSet(\'zero-full\')).candidate_sha256)"']);
      expect(look.stdout.trim().split('\n')).toEqual(['read-only', candidateHash(resolveSet('zero-full')).candidate_sha256]);
      const diff = docker(['diff', name]).stdout.split('\n').filter((l) => l.trim() && !['A /he-logs', 'A /he-turns'].includes(l));
      expect(diff).toEqual([]);
    } finally { docker(['rm', '-f', name]); }
  }, 120_000);

  test('the README quickstart: serve-smoke --fake-upstream completes three turns with a world-MCP call and the DM session carried', () => {
    expect(docker(['image', 'inspect', IMAGE]).status, 'the image must exist after the build test').toBe(0);
    const out = join(mkdtempSync(join(tmpdir(), 'he-zero-smoke-')), 'smoke');
    const port = String(8800 + (process.pid % 90));
    const r = spawnSync(process.execPath, ['harnesses/serve-smoke.ts', '--harness', 'harness-zero', '--trial-id', 'zero-smoke-test', '--fake-upstream', '--port', port, '--budget', '60', '--out', out],
      { cwd: ROOT, encoding: 'utf8', env: cleanEnv, timeout: 300_000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const smoke = JSON.parse(readFileSync(join(out, 'smoke.json'), 'utf8'));
    expect(smoke.responses.map((x: { exit: number }) => x.exit)).toEqual([0, 0, 0]);
    expect(smoke.world_mcp_events.map((e: { tool: string }) => e.tool)).toContain('conversations.list');
    expect(smoke.fake_upstream).toEqual({ requests: 4, paths: ['/zero-smoke-test/anthropic/v1/messages'] });
    expect(smoke.container_exit).toBe(0);
    const turns = readFileSync(join(out, 'logs/adapter.log'), 'utf8').split('\n').filter((l) => l.includes('ZERO_TURN')).map((l) => JSON.parse(l.slice(l.indexOf('ZERO_TURN ') + 10)));
    expect(turns.map((x) => x.new_session)).toEqual([true, true, false]);
  }, 300_000);
});
