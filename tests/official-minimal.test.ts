/**
 * internal-task, the official-minimal cells (plan decision 5): the cell's config official-minimal reaches the Claude Code and Codex
 * adapters as HE_HARNESS_CONFIG, and each hands its harness one fixed short text through the harness's own override:
 * Claude Code's --system-prompt and Codex's model_instructions_file. The text is harnesses/ablation/official-minimal.txt, with
 * a byte copy in each harness directory (each image's build context is its own directory) and its sha256 in each pin.json.
 *
 * 1. The text: three byte-identical copies, the sha256 both pin.json files record, two to four plain sentences, and both
 *    Dockerfiles copy ablation/ into the image.
 * 2. Unset, empty and "default": every file the adapter leaves under the trial's workspace, state, logs and turns directories
 *    and every CLI command line equal what the adapter at BASE (a1bc7088c, the head lane B started from) leaves, run and
 *    serve, keyless, with stand-in CLIs on PATH under a scrubbed environment (timestamps, the trial root, the harness
 *    directory and the adapter's own sha256 normalised).
 * 3. official-minimal: Claude Code gets --system-prompt with the text's exact bytes before the session flag on every turn;
 *    Codex's config.toml is the unset one with one line, model_instructions_file = "<harness>/ablation/official-minimal.txt",
 *    before `model =`. Both record the path, sha256 and bytes in ready.official_minimal.
 * 4. Refusals: an unknown config and a text file with another sha256 exit 2 with HE-ADAPTER-007 before any turn.
 * 5. Container level, when docker is available: each image built from the checkout runs one turn against a fake endpoint in
 *    this process, and the request the harness sends carries the text where the override puts it: Claude Code's system blocks,
 *    and Codex's base-instructions message (the first developer message of the input at 0.165.0 on gpt-6 models).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { containerHostAddress } from '../runner/trial/world.ts';
import { stream } from '../scripts/gsta-135/fake-anthropic.ts';
import type { WorldServer } from '../world/services/server.ts';
import { startFakeResponses } from './fixtures/fake-responses.ts';
import { startWorld } from './world-helpers.ts';

const ROOT = join(import.meta.dir, '..');
const BASE = 'a1bc7088c';
type Harness = 'claude-code' | 'codex';
type Entry = 'run' | 'serve';
const HARNESSES: Harness[] = ['claude-code', 'codex'];
const TEXT_FILES = ['harnesses/ablation/official-minimal.txt', 'harnesses/claude-code/ablation/official-minimal.txt', 'harnesses/codex/ablation/official-minimal.txt'];
const TEXT = readFileSync(join(ROOT, TEXT_FILES[0]!));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const NODE = Bun.which('node');
const JQ = Bun.which('jq');
const CLAUDE_STUB = join(ROOT, 'tests', 'fixtures', 'claude-code', 'bin');
const MODEL = { 'claude-code': 'claude-opus-5-5', codex: 'gpt-6.1-sol' } as const;

/** A stand-in for codex 0.165.0: --version, and exec / exec resume printing thread.started, an agent message and
 *  turn.completed. Thread ids count up in a file beside the log, so two runs give the same ids. */
const CODEX_STUB = [
  '#!/usr/bin/env bash',
  'if [ "$1" = --version ]; then echo "codex-cli 0.165.0"; exit 0; fi',
  'echo "$*" >> "$STUB_LOG"',
  'cat > /dev/null',
  'n=$(( $(cat "$STUB_LOG.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_LOG.n"',
  'if [ "$1" = exec ] && [ "$2" = resume ]; then tid=$3; else tid="stub-thread-$n"; fi',
  "echo '{\"type\":\"thread.started\",\"thread_id\":\"'\"$tid\"'\"}'",
  "echo '{\"type\":\"turn.started\"}'",
  "echo '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"stub reply '\"$n\"'\"}}'",
  "echo '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1,\"reasoning_output_tokens\":0}}'",
  '',
].join('\n');

const tmp = mkdtempSync(join(tmpdir(), 'he-official-minimal-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;
const codexBin = join(tmp, 'codex-bin');
mkdirSync(codexBin);
writeFileSync(join(codexBin, 'codex'), CODEX_STUB);
chmodSync(join(codexBin, 'codex'), 0o755);

/** harnesses/<h> at BASE, extracted once per harness. */
const baseDirs: Partial<Record<Harness, string>> = {};
function baseDir(h: Harness): string {
  if (baseDirs[h]) return baseDirs[h]!;
  const out = join(tmp, 'base-' + h);
  mkdirSync(out, { recursive: true });
  const archive = spawnSync('git', ['archive', BASE, 'harnesses/' + h], { cwd: ROOT, maxBuffer: 64 << 20 });
  if (archive.status !== 0) throw new Error('git archive ' + BASE + ' failed (CI checks out with fetch-depth 0): ' + archive.stderr);
  const untar = spawnSync('tar', ['-x', '-C', out], { input: archive.stdout });
  if (untar.status !== 0) throw new Error('tar failed: ' + untar.stderr);
  return (baseDirs[h] = join(out, 'harnesses', h));
}

const REQUEST = { turn: 1, trial_id: 'om', prompt: 'Say ok.', actor: { member: 'dana-okafor', slack_user_id: 'U0DANA', name: 'Dana Okafor', role: 'Account Manager', team: 'team-north' },
  channel: { id: 'D0DANA', name: 'dana-okafor', type: 'dm' }, text: 'Say ok.', ts: '1790000000.000100', thread_ts: null, sim_now: '2026-10-29T09:00:00-07:00', time_budget_s: 30 };

interface Run { exit: number | null; files: Map<string, Buffer>; ready: Record<string, any> | null; calls: string[]; root: string; log: string }

/** One adapter run on this host under a scrubbed environment. Serve posts two turns of one conversation after ready and stops on
 *  SIGTERM; run is one turn. The stand-in's call log sits outside the trial root; its pid and session id fields are dropped. */
async function runAdapter(h: Harness, entry: Entry, o: { harnessDir?: string; config?: string; world?: WorldServer } = {}): Promise<Run> {
  const root = join(tmp, 'trial-' + ++seq);
  const d = { workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
  for (const p of Object.values(d)) mkdirSync(p, { recursive: true });
  writeFileSync(join(d.workspace, 'instruction.md'), 'Say ok.\n');
  const stubLog = join(tmp, 'stub-' + seq + '.log');
  const harnessDir = o.harnessDir ?? join(ROOT, 'harnesses', h);
  const env: Record<string, string> = {
    PATH: [h === 'codex' ? codexBin : CLAUDE_STUB, dirname(NODE!), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    HE_WORKSPACE_DIR: d.workspace, HE_SESSION_STATE_DIR: d.state, HE_LOG_DIR: d.logs, HE_TURNS_DIR: d.turns,
    HE_MODEL_BASE_URL: 'http://127.0.0.1:9/om/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'trial-token:om.0000', HE_MODEL_NAME: MODEL[h],
    HE_TIME_BUDGET_S: '30', HE_TRIAL_ID: 'om', HE_TASK_SLICE: entry === 'run' ? 'smoke' : 'multiuser', STUB_LOG: stubLog,
    ...(o.world ? { HE_WORLD_MCP_URL: o.world.url + '/mcp', HE_WORLD_MCP_TOKEN: o.world.credentials.bot.token } : {}),
    ...(o.config !== undefined ? { HE_HARNESS_CONFIG: o.config } : {}),
  };
  const adapter = join(harnessDir, 'adapter.sh');
  let exit: number | null;
  if (entry === 'run') {
    exit = spawnSync('bash', [adapter, 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).status;
  } else {
    const child = spawn('bash', [adapter, 'serve'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
    const deadline = Date.now() + 30_000;
    const wait = async (p: string) => { while (!existsSync(p) && child.exitCode === null && Date.now() < deadline) await Bun.sleep(50); };
    await wait(join(d.logs, 'ready'));
    for (const turn of [1, 2]) {
      if (child.exitCode !== null) break;
      const name = 'turn-' + String(turn).padStart(4, '0');
      writeFileSync(join(d.turns, name + '.request.json.tmp'), JSON.stringify({ ...REQUEST, turn }));
      renameSync(join(d.turns, name + '.request.json.tmp'), join(d.turns, name + '.request.json'));
      await wait(join(d.turns, name + '.response.json'));
    }
    if (child.exitCode === null) child.kill('SIGTERM');
    exit = await Promise.race([exited, Bun.sleep(15_000).then(() => { child.kill('SIGKILL'); return null; })]);
  }
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else files.set(relative(root, p), readFileSync(p)); } };
  walk(root);
  const lines = existsSync(stubLog) ? readFileSync(stubLog, 'utf8').split('\n').filter(Boolean) : [];
  const calls = h === 'codex' ? lines : lines.map((l) => { const { pid: _pid, sid: _sid, ...rest } = JSON.parse(l) as Record<string, unknown>; return JSON.stringify(rest); });
  const text = (rel: string) => files.get(rel)?.toString('utf8');
  return { exit, files, ready: text('logs/ready') ? JSON.parse(text('logs/ready')!) : null, calls, root, log: text('logs/adapter.log') ?? '' };
}

/** Every file as text with the trial root, the harness directory, timestamps and the adapter's sha256 normalised. stdout.log and
 *  stderr.log are left out: the adapter copies its output there through process-substitution tees that bash never waits for,
 *  so a walk can run before their last lines land (flaky under load); adapter.log carries every log line and is compared.
 *  Claude Code names its project directory after the workspace path with every other character turned into a dash. */
function normalised(r: Run, harnessDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const encoded = r.root.replace(/[^a-zA-Z0-9]/g, '-');
  for (const [rel, b] of [...r.files.entries()].sort(([a], [z]) => a.localeCompare(z))) {
    if (rel === 'logs/stdout.log' || rel === 'logs/stderr.log') continue;
    out[rel.replaceAll(encoded, '<root>')] = b.toString('utf8').replaceAll(r.root, '<root>').replaceAll(harnessDir, '<harness>')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<ts>').replace(/"adapter_sha256":"[0-9a-f]{64}"/g, '"adapter_sha256":"<sha>"');
  }
  out['<stub calls>'] = r.calls.join('\n').replaceAll(r.root, '<root>').replaceAll(harnessDir, '<harness>');
  return out;
}

describe('the official-minimal text and the image layout', () => {
  test('three byte-identical copies, the sha256 both pin.json files record, two to four plain sentences with no trailing newline', () => {
    for (const p of TEXT_FILES) expect(readFileSync(join(ROOT, p))).toEqual(TEXT);
    for (const h of HARNESSES) {
      const pin = JSON.parse(readFileSync(join(ROOT, 'harnesses', h, 'pin.json'), 'utf8'));
      expect(pin.official_minimal).toMatchObject({ sha256: sha(TEXT), bytes: TEXT.length });
    }
    const s = TEXT.toString('utf8');
    expect(s.endsWith('\n')).toBe(false);
    expect(s).not.toMatch(/[\u2014\u2013]/);
    const sentences = s.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
  });

  test('both Dockerfiles copy ablation/ to /opt/harness/ablation', () => {
    for (const h of HARNESSES) expect(readFileSync(join(ROOT, 'harnesses', h, 'Dockerfile'), 'utf8')).toContain('\nCOPY ablation/ /opt/harness/ablation/\n');
  });
});

describe.skipIf(!NODE || !JQ)('unset config: byte-identical to the adapter at ' + BASE, () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('om-serve'); });
  afterAll(() => ws.stop());
  for (const h of HARNESSES) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      test(h + ' ' + entry + ': unset, empty and "default" leave every file and every CLI command line as ' + BASE + ' does', async () => {
        const world = entry === 'serve' ? ws : undefined;
        const base = await runAdapter(h, entry, { harnessDir: baseDir(h), world });
        expect(base.exit, base.log).toBe(0);
        const want = normalised(base, baseDir(h));
        expect(want['<stub calls>']!.length).toBeGreaterThan(0);
        for (const config of [undefined, '', 'default']) {
          const r = await runAdapter(h, entry, { config, world });
          expect(r.exit, r.log).toBe(0);
          expect(normalised(r, join(ROOT, 'harnesses', h))).toEqual(want);
          expect(r.ready?.official_minimal).toBeUndefined();
        }
      }, 120_000);
    }
  }
});

describe.skipIf(!NODE || !JQ)('official-minimal', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('om-set'); });
  afterAll(() => ws.stop());
  const harnessDir = (h: Harness) => join(ROOT, 'harnesses', h);
  const textPath = (h: Harness) => join(harnessDir(h), 'ablation', 'official-minimal.txt');

  test('claude-code serve: --system-prompt with the exact text before the session flag on every turn, every other argument as unset, recorded in ready', async () => {
    const plain = await runAdapter('claude-code', 'serve', { world: ws });
    const r = await runAdapter('claude-code', 'serve', { config: 'official-minimal', world: ws });
    expect(r.exit, r.log).toBe(0);
    const calls = r.calls.map((l) => JSON.parse(l) as { args: string[] });
    const plainCalls = plain.calls.map((l) => JSON.parse(l) as { args: string[] });
    expect(calls).toHaveLength(2);
    expect(plainCalls).toHaveLength(2);
    calls.forEach((c, i) => {
      const at = c.args.indexOf('--system-prompt');
      expect(at).toBe(c.args.length - 4);
      expect(Buffer.from(c.args[at + 1]!)).toEqual(TEXT);
      expect([...c.args.slice(0, at), ...c.args.slice(at + 2)]).toEqual(plainCalls[i]!.args.map((a) => a.replaceAll(plain.root, r.root)));
    });
    expect(r.ready!.official_minimal).toEqual({ path: textPath('claude-code'), sha256: sha(TEXT), bytes: TEXT.length });
    expect(r.log).toContain('HE_HARNESS_CONFIG=official-minimal: --system-prompt from ' + textPath('claude-code') + ' (sha256 ' + sha(TEXT) + ')');
  }, 60_000);

  test('claude-code run: --system-prompt with the exact text on the one turn', async () => {
    const r = await runAdapter('claude-code', 'run', { config: 'official-minimal' });
    expect(r.exit, r.log).toBe(0);
    const [call] = r.calls.map((l) => JSON.parse(l) as { args: string[] });
    expect(Buffer.from(call!.args[call!.args.indexOf('--system-prompt') + 1]!)).toEqual(TEXT);
  }, 60_000);

  for (const entry of ['run', 'serve'] as Entry[]) {
    test('codex ' + entry + ': config.toml is the unset one with model_instructions_file before the first key, the command lines unchanged, recorded in ready on serve', async () => {
      const world = entry === 'serve' ? ws : undefined;
      const plain = await runAdapter('codex', entry, { world });
      const r = await runAdapter('codex', entry, { config: 'official-minimal', world });
      expect(r.exit, r.log).toBe(0);
      const plainToml = plain.files.get('state/codex/config.toml')!.toString('utf8').replaceAll(plain.root, r.root);
      const toml = r.files.get('state/codex/config.toml')!.toString('utf8');
      expect(toml).toBe(plainToml.replace('\nmodel = ', '\nmodel_instructions_file = ' + JSON.stringify(textPath('codex')) + '\nmodel = '));
      expect(toml.split('\n').filter((l) => l.startsWith('model_instructions_file'))).toHaveLength(1);
      expect(toml.indexOf('model_instructions_file')).toBeLessThan(toml.indexOf('\n['));
      expect(r.calls.map((l) => l.replaceAll(r.root, '<root>'))).toEqual(plain.calls.map((l) => l.replaceAll(plain.root, '<root>')));
      if (entry === 'serve') expect(r.ready!.official_minimal).toEqual({ path: textPath('codex'), sha256: sha(TEXT), bytes: TEXT.length });
      expect(r.log).toContain('HE_HARNESS_CONFIG=official-minimal: model_instructions_file = ' + textPath('codex') + ' (sha256 ' + sha(TEXT) + ')');
    }, 60_000);
  }

  for (const h of HARNESSES) {
    test(h + ': an unknown config and a changed text file are HE-ADAPTER-007, exit 2 before any turn', async () => {
      const unknown = await runAdapter(h, 'run', { config: 'official-minimum' });
      expect(unknown.exit).toBe(2);
      expect(unknown.log).toContain('HE-ADAPTER-007 HE_HARNESS_CONFIG=official-minimum is not a ' + h + ' config (default, official-minimal)');
      expect(unknown.calls).toEqual([]);
      const copy = join(tmp, 'tampered-' + h + '-' + ++seq);
      cpSync(harnessDir(h), copy, { recursive: true });
      writeFileSync(join(copy, 'ablation', 'official-minimal.txt'), TEXT.toString('utf8') + ' Also be brief.');
      const tampered = await runAdapter(h, 'run', { config: 'official-minimal', harnessDir: copy });
      expect(tampered.exit).toBe(2);
      expect(tampered.log).toContain('HE-ADAPTER-007 HE_HARNESS_CONFIG=official-minimal: ' + join(copy, 'ablation', 'official-minimal.txt') + ' has sha256');
      expect(tampered.calls).toEqual([]);
      expect(tampered.ready).toBeNull();
    }, 60_000);
  }
});

const DOCKER_ENV: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) };
const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: DOCKER_ENV, timeout });
const haveDocker = docker(['version', '--format', '{{.Server.Version}}'], 15_000).status === 0;

/** One run-entry turn of the image built from the checkout against a fake endpoint on the docker bridge gateway, with
 *  HE_HARNESS_CONFIG set or not. Returns the JSON bodies of the model requests the fake received. The container runs as an
 *  async child, so the fake in this process keeps answering while it waits. */
async function containerTurn(h: Harness, config: string | undefined): Promise<Array<Record<string, any>>> {
  const gw = containerHostAddress();
  const bodies: Array<Record<string, any>> = [];
  const responses = h === 'codex' ? startFakeResponses({}) : null;
  const fake = Bun.serve({ port: 0, hostname: gw, async fetch(req) {
    const url = new URL(req.url);
    const raw = await req.text();
    const body = JSON.parse(raw || '{}') as Record<string, any>;
    if (h === 'codex') {
      if (url.pathname.endsWith('/v1/responses')) bodies.push(body);
      return fetch('http://127.0.0.1:' + responses!.port + url.pathname.replace(/^\/om\/openai/, ''), { method: req.method, headers: req.headers, body: raw || undefined });
    }
    if (url.pathname.endsWith('/v1/messages')) bodies.push(body);
    const content = [{ type: 'text', text: 'ok' }];
    const msg = { id: 'msg_om_' + bodies.length, type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    return new Response(stream(msg, content, 'end_turn'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const dir = mkdtempSync(join(tmp, 'docker-' + h + '-'));
  const t = { workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs') };
  for (const p of Object.values(t)) mkdirSync(p);
  writeFileSync(join(t.workspace, 'instruction.md'), 'Say ok.\n');
  const name = 'he-official-minimal-' + h + '-' + process.pid + '-' + ++seq;
  try {
    const env: Record<string, string> = {
      HE_MODEL_BASE_URL: 'http://host.docker.internal:' + fake.port + '/om/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'trial-token:om.0000', HE_MODEL_NAME: MODEL[h],
      HE_TIME_BUDGET_S: '60', HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_TASK_SLICE: 'smoke', HE_TRIAL_ID: 'om-docker',
      ...(config !== undefined ? { HE_HARNESS_CONFIG: config } : {}),
    };
    const child = Bun.spawn(['docker', 'run', '--rm', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--add-host', 'host.docker.internal:host-gateway',
      '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', k + '=' + v]), 'harness-eval/' + h + ':dev', 'run'], { env: DOCKER_ENV, stdout: 'pipe', stderr: 'pipe' });
    const code = await Promise.race([child.exited, Bun.sleep(180_000).then(() => { child.kill('SIGKILL'); return null; })]);
    expect(code, existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : await new Response(child.stderr).text()).toBe(0);
    return bodies;
  } finally {
    docker(['rm', '-f', name]);
    fake.stop(true);
    responses?.stop();
  }
}

describe.skipIf(!haveDocker)('container level: the text reaches the request where the override puts it', () => {
  beforeAll(() => {
    for (const h of HARNESSES) {
      const build = docker(['build', '-q', '-t', 'harness-eval/' + h + ':dev', join(ROOT, 'harnesses', h)], 1_200_000);
      expect(build.status, build.stderr).toBe(0);
    }
  }, 2_400_000);

  test('claude-code: with official-minimal the third system block is the text in place of the default prompt; the billing header, the SDK identity line and the system-role message stay', async () => {
    // At 2.1.312 the system blocks are the billing header, the SDK identity line and
    // the prompt; --system-prompt replaces only the last. The system-role message (environment, skills, agents) is not touched.
    const systemText = (b: Record<string, any>) => (b.system as Array<{ text: string }>).map((x) => x.text);
    const systemRole = (b: Record<string, any>) => JSON.stringify((b.messages as Array<{ role: string }>).filter((m) => m.role === 'system'));
    const plain = await containerTurn('claude-code', undefined);
    const set = await containerTurn('claude-code', 'official-minimal');
    expect(plain.length).toBeGreaterThan(0);
    expect(set.length).toBeGreaterThan(0);
    const [want] = plain.map(systemText);
    expect(want).toHaveLength(3);
    expect(want![2]!.length).toBeGreaterThan(TEXT.length * 4);
    for (const b of set) expect(systemText(b)).toEqual([want![0]!, want![1]!, TEXT.toString('utf8')]);
    for (const b of set) expect(systemRole(b)).toBe(systemRole(plain[0]!));
  }, 600_000);

  test('codex: with official-minimal the base-instructions message is the text, and unset it is Codex\'s own', async () => {
    // At 0.165.0 on gpt-6 models the request has no instructions field: the base instructions are the first developer message
    // of the input, after the additional_tools item and before the skills and multi-agent messages.
    const base = (b: Record<string, any>) => {
      expect(b.instructions).toBeUndefined();
      const m = (b.input as Array<Record<string, any>>).find((i) => i.type === 'message' && i.role === 'developer')!;
      return (m.content as Array<{ text: string }>).map((c) => c.text).join('');
    };
    const plain = await containerTurn('codex', undefined);
    const set = await containerTurn('codex', 'official-minimal');
    expect(plain.length).toBeGreaterThan(0);
    expect(set.length).toBeGreaterThan(0);
    for (const b of set) expect(base(b)).toBe(TEXT.toString('utf8'));
    for (const b of set) expect(JSON.stringify(b)).not.toContain('You are Codex');
    for (const b of plain) expect(base(b)).toStartWith('You are Codex');
    for (const b of plain) expect(JSON.stringify(b)).not.toContain(TEXT.toString('utf8'));
  }, 600_000);
});
