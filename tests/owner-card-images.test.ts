// internal-task: in the OpenClaw and Hermes images, keyless, the owner card lands where each harness reads it. The image runs the
// checkout's adapter (adapter.sh, config/, routes/ and pin.json mounted over /opt/harness) on the serve entry against a fake
// Anthropic endpoint on the docker bridge gateway, for one member turn, with the set's real owner card
// (tasks/multiuser/owner-identity/world/owner-card.md) as HE_OWNER_CARD_B64 and again with none (arm B). The first request that
// offers tools must hold every card line in its system prompt with the card, and none without it. Skipped without docker or
// the images (docker build -t harness-eval/<harness>:dev harnesses/<harness>). QM runs one run-entry turn through its compose
// stack the same way, with the card in the task container's environment.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cardLinesIn, ownerCardCheck } from '../runner/trial/owner-card.ts';

const ROOT = join(import.meta.dir, '..');
const CARD = readFileSync(join(ROOT, 'tasks', 'multiuser', 'owner-identity', 'world', 'owner-card.md'));
const tmp = mkdtempSync(join(tmpdir(), 'he-owner-card-images-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const dockerEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore', env: dockerEnv }).status === 0;
const haveImage = (h: string) => haveDocker && spawnSync('docker', ['image', 'inspect', 'harness-eval/' + h + ':dev'], { stdio: 'ignore', env: dockerEnv }).status === 0;
const REQUEST = { turn: 1, trial_id: 'owner-card', prompt: 'Say ok.', actor: { member: 'alice', slack_user_id: 'U0ALICE', name: 'Alice', role: 'engineer', team: null },
  channel: { id: 'D0ALICE', name: 'alice', type: 'dm' }, text: 'Say ok.', ts: '1790000000.000100', thread_ts: null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: 60 };

/** Async docker: the fake endpoint serves from this event loop, so a blocking spawn would starve it. */
async function docker(args: string[], timeoutMs = 120_000): Promise<number | null> {
  const proc = Bun.spawn(['docker', ...args], { stdout: 'ignore', stderr: 'ignore', env: dockerEnv });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const status = await proc.exited;
  clearTimeout(timer);
  return status;
}

async function serveOneTurn(h: 'openclaw' | 'hermes', card: Buffer | null) {
  const gateway = spawnSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8', env: dockerEnv }).stdout.trim();
  const requests: Array<Record<string, any>> = [];
  const server = Bun.serve({ port: 0, hostname: gateway, async fetch(req) {
    if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/v1/messages')) return new Response('{}', { status: 404 });
    const body = await req.json() as Record<string, any>;
    requests.push(body);
    const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    const events: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]];
    return new Response(events.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const name = 'he-owner-card-' + h + '-' + (card ? 'card' : 'none') + '-' + process.pid;
  const root = join(tmp, name);
  const d = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
  for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
  const hd = join(ROOT, 'harnesses', h);
  const env: Record<string, string> = { HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_TRIAL_ID: name, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '90',
    HE_MODEL_BASE_URL: 'http://host.docker.internal:' + server.port + '/anthropic', HE_MODEL_API_KEY: 'trial-token:dummy', HE_MODEL_NAME: 'claude-opus-5-5',
    HE_WORLD_MCP_URL: 'http://127.0.0.1:9/mcp', HE_WORLD_MCP_TOKEN: 'world-token-dummy', ...(card ? { HE_OWNER_CARD_B64: card.toString('base64') } : {}) };
  const args = ['run', '-d', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
    '-v', d.workspace + ':/workspace', '-v', d.state + ':/harness-state', '-v', d.logs + ':/he-logs', '-v', d.turns + ':/he-turns',
    '-v', join(hd, 'adapter.sh') + ':/opt/harness/adapter.sh:ro', '-v', join(hd, 'config') + ':/opt/harness/config:ro', '-v', join(hd, 'routes') + ':/opt/harness/routes:ro', '-v', join(hd, 'pin.json') + ':/opt/harness/pin.json:ro'];
  for (const [k, v] of Object.entries(env)) args.push('-e', k + '=' + v);
  await docker(['rm', '-f', name]);
  try {
    expect(await docker([...args, 'harness-eval/' + h + ':dev', 'serve'])).toBe(0);
    const deadline = Date.now() + 240_000;
    while (!existsSync(join(d.logs, 'ready')) && Date.now() < deadline) await Bun.sleep(250);
    expect(existsSync(join(d.logs, 'ready'))).toBe(true);
    writeFileSync(join(d.turns, 'turn-0001.request.json.tmp'), JSON.stringify(REQUEST));
    renameSync(join(d.turns, 'turn-0001.request.json.tmp'), join(d.turns, 'turn-0001.request.json'));
    while (!existsSync(join(d.turns, 'turn-0001.response.json')) && Date.now() < deadline) await Bun.sleep(250);
    expect(JSON.parse(readFileSync(join(d.turns, 'turn-0001.response.json'), 'utf8')).exit).toBe(0);
  } finally {
    await docker(['rm', '-f', name]);
    server.stop(true);
  }
  return { requests, ready: JSON.parse(readFileSync(join(d.logs, 'ready'), 'utf8')), state: d.state, workspace: d.workspace };
}

const systemText = (b: Record<string, any>) => (typeof b.system === 'string' ? b.system : (b.system as any[]).map((x) => x.text ?? '').join('\n'));

describe('the owner card in the images (docker; skipped without the images)', () => {
  test.skipIf(!haveImage('openclaw'))('openclaw: the card is in the system prompt\'s Project Context as /workspace/AGENTS.md, and absent without it', async () => {
    const withCard = await serveOneTurn('openclaw', CARD);
    const first = withCard.requests.find((b) => Array.isArray(b.tools) && b.tools.length)!;
    expect(systemText(first)).toContain('## /workspace/AGENTS.md\n' + CARD.toString('utf8'));
    expect(ownerCardCheck({ card: CARD, expected: true, ready: withCard.ready, requests: withCard.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'present', ok: true });
    const none = await serveOneTurn('openclaw', null);
    expect(existsSync(join(none.workspace, 'AGENTS.md'))).toBe(false);
    expect(ownerCardCheck({ card: CARD, expected: false, ready: none.ready, requests: none.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'absent', ok: true });
  }, 600_000);

  test.skipIf(!haveImage('hermes'))('hermes: the card is the USER PROFILE block of the system prompt, under the raised limit, and absent without it', async () => {
    const withCard = await serveOneTurn('hermes', CARD);
    const first = withCard.requests.find((b) => Array.isArray(b.tools) && b.tools.length)!;
    const system = systemText(first);
    const entry = CARD.toString('utf8').trim();
    const limit = 1375 + entry.length + 3;
    expect(withCard.ready.owner_card).toMatchObject({ setting: 'user profile (memories/USER.md)', user_char_limit: limit });
    expect(system).toMatch(new RegExp('USER PROFILE \\(who the user is\\) \\[[^\\]]*' + limit.toLocaleString('en-US') + '[^\\]]*\\]'));
    expect(system).toContain(entry);
    const lines = CARD.toString('utf8').split('\n').filter((l) => l.trim()).length;
    expect(cardLinesIn(CARD.toString('utf8'), first)).toEqual({ lines, found: lines });
    expect(ownerCardCheck({ card: CARD, expected: true, ready: withCard.ready, requests: withCard.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'present', ok: true });
    const none = await serveOneTurn('hermes', null);
    const noneFirst = none.requests.find((b) => Array.isArray(b.tools) && b.tools.length)!;
    expect(systemText(noneFirst)).not.toContain('USER PROFILE');
    expect(ownerCardCheck({ card: CARD, expected: false, ready: none.ready, requests: none.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'absent', ok: true });
  }, 600_000);
});

// ---- QM: the org SOUL in the compose stack ---------------------------------------------------------------------------------

const QM_DIR = join(ROOT, 'harnesses', 'qm');
const QM_PIN = JSON.parse(readFileSync(join(QM_DIR, 'pin.json'), 'utf8')).commit as string;
const haveCompose = haveDocker && spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', env: dockerEnv }).status === 0;
const haveQmImages = haveDocker && ['harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev'].every((i) => spawnSync('docker', ['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', i], { encoding: 'utf8', env: dockerEnv }).stdout.trim() === QM_PIN);
const qmSandboxes = (): string[] => haveDocker ? spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', 'label=qm.sandbox=1', '--filter', 'label=qm.org=harness-eval'], { encoding: 'utf8', env: dockerEnv }).stdout.split('\n').filter(Boolean) : [];
const qmBusy = qmSandboxes().length > 0;

/** One QM run turn through compose.yaml with the checkout's adapter, against a fake Anthropic endpoint; the card, when given,
 *  reaches the task container through the override, as the runner's compose.serve.yaml carries the trial environment. */
async function qmRunTurn(card: Buffer | null) {
  const gateway = spawnSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8', env: dockerEnv }).stdout.trim();
  const requests: Array<Record<string, any>> = [];
  const server = Bun.serve({ port: 0, hostname: gateway, idleTimeout: 0, async fetch(req) {
    if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/v1/messages')) return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'no route' } }, { status: 404 });
    const body = await req.json() as Record<string, any>;
    requests.push(body);
    const msg = { id: 'msg_fake_' + requests.length, type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    const events: Array<[string, unknown]> = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]];
    return new Response(events.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const before = qmSandboxes();
  const dir = mkdtempSync(join(tmp, 'qm-'));
  for (const d of ['workspace', 'state', 'logs', 'turns']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'workspace', 'instruction.md'), 'Say ok.\n');
  const project = 'he-qm-owner-card-' + process.pid + (card ? '-card' : '-none');
  const override = join(dir, 'compose.adapter.yaml');
  writeFileSync(override, 'services:\n  task:\n    volumes:\n      - ' + join(QM_DIR, 'adapter.sh') + ':/opt/harness/adapter.sh:ro\n' + (card ? '    environment:\n      HE_OWNER_CARD_B64: ' + JSON.stringify(card.toString('base64')) + '\n' : ''));
  const compose = ['compose', '-f', join(QM_DIR, 'compose.yaml'), '-f', override, '-p', project];
  const dirs = { HE_WORKSPACE: join(dir, 'workspace'), HE_STATE: join(dir, 'state'), HE_LOGS: join(dir, 'logs'), HE_TURNS: join(dir, 'turns') };
  const env: Record<string, string> = { ...dockerEnv, ...dirs, HE_MODEL_BASE_URL: 'http://host.docker.internal:' + server.port + '/anthropic', HE_MODEL_API_KEY: 'trial-token:dummy', HE_MODEL_NAME: 'claude-opus-5-5',
    HE_TIME_BUDGET_S: '180', HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'qm-owner-card', QM_IMAGE: 'harness-eval/qm:dev', HE_UID: String(process.getuid!()), HE_GID: String(process.getgid!()), COMPOSE_PROJECT_NAME: project };
  try {
    const prep = spawnSync('bash', [join(QM_DIR, 'prepare.sh'), dir], { encoding: 'utf8', env });
    expect(prep.status).toBe(0);
    for (const line of prep.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1); }
    const up = Bun.spawn(['docker', ...compose, 'up', '--abort-on-container-exit', '--exit-code-from', 'task', '--no-color'], { env, stdout: 'ignore', stderr: 'ignore' });
    const timer = setTimeout(() => up.kill(), 420_000);
    const status = await up.exited;
    clearTimeout(timer);
    return { status, requests, logs: dirs.HE_LOGS };
  } finally {
    server.stop(true);
    spawnSync('docker', [...compose, 'down', '-v', '--remove-orphans'], { env: { ...dockerEnv, ...dirs }, stdio: 'ignore', timeout: 120_000 });
    for (const name of qmSandboxes().filter((n) => !before.includes(n))) {
      spawnSync('docker', ['rm', '-f', name], { env: dockerEnv, stdio: 'ignore' });
      spawnSync('docker', ['volume', 'rm', '-f', 'qm-home-' + name.replace(/^qm-sbx-/, '')], { env: dockerEnv, stdio: 'ignore' });
      spawnSync('docker', ['network', 'rm', 'qm-net-' + name.replace(/^qm-sbx-/, '')], { env: dockerEnv, stdio: 'ignore' });
    }
  }
}

describe.skipIf(!haveQmImages || !haveCompose || qmBusy)('the owner card in QM (compose stack, images at the pin; skipped without them or with QM sandboxes on this daemon)', () => {
  test('qm: the card is in the agent turn\'s system prompt under ## Organization instructions, and absent without it', async () => {
    const withCard = await qmRunTurn(CARD);
    expect(withCard.status).toBe(0);
    const rec = JSON.parse(readFileSync(join(withCard.logs, 'owner-card.json'), 'utf8'));
    expect(rec).toMatchObject({ status: 'ok', file: 'qm:org:harness-eval/soul', existed: true, soul_before: { version: 1 }, soul_after: { version: 2 } });
    const first = withCard.requests.find((b) => b.model === 'claude-opus-5-5' && Array.isArray(b.tools) && b.tools.length)!;
    expect(systemText(first)).toMatch(/## Organization instructions\n[^]*Facts they state about themselves belong on their page/);
    expect(ownerCardCheck({ card: CARD, expected: true, ready: { owner_card: { file: rec.file, card_sha256: rec.card_sha256 } }, requests: withCard.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'present', ok: true });
    const none = await qmRunTurn(null);
    expect(none.status).toBe(0);
    expect(existsSync(join(none.logs, 'owner-card.json'))).toBe(false);
    expect(ownerCardCheck({ card: CARD, expected: false, ready: null, requests: none.requests, cellModel: 'anthropic:claude-opus-5-5' })).toMatchObject({ first_request: 'absent', ok: true });
  }, 900_000);
});
