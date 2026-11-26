/**
 * Reasoning replay through the metering proxy, keyless (internal-task round 3): for each model the lineup runs on Pi, Hermes or
 * OpenClaw, the real harness binary runs one task turn on the config frontier_settings.py renders for it, through broker.ts
 * and the metering proxy, against tests/fixtures/frontier-harbor/replay-upstream.ts. The fake answers with two shell tool
 * calls and then text, each call carrying reasoning in its provider's shape, and records what the harness sends back on
 * every replayed tool-call turn: which reasoning fields, the text, and every signature or encrypted blob byte for byte.
 * Each run's verdict is checked against the reasoning_replay record frontier_settings.py renders for that cell, so the
 * records say what the binaries do. On Grok 4.7 (xAI's Responses API) it also checks that every agent request asks for the
 * encrypted reasoning, chains on no stored response (previous_response_id), sends none of the fields xAI refuses for
 * reasoning models (stop, presence_penalty, frequency_penalty) and asks for effort high, or sends no effort where the
 * record declares xAI's default (high) applies. Runs only when HE_TEST_PI_BIN, HE_TEST_HERMES_BIN or HE_TEST_OPENCLAW_BIN names the
 * pinned binary; HE_REPLAY_OUT names a file for one JSON line per run. Every key is a random canary, and every spawned
 * process gets an environment built from scratch.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, OPENROUTER_MODELS } from '../runner/proxy/metering-proxy.ts';
import { createBroker } from '../scripts/frontier-harbor/broker.ts';
import { replayUpstream, replayVerdict } from './fixtures/frontier-harbor/replay-upstream.ts';

const ROOT = resolve(import.meta.dir, '..');
const HERE = join(ROOT, 'scripts/frontier-harbor');
const tmp = mkdtempSync(join(tmpdir(), 'frontier-replay-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
let n = 0;
const fresh = (name: string) => { const d = join(tmp, name + '-' + ++n); mkdirSync(d, { recursive: true }); return d; };
const PATH = process.env.PATH ?? '/usr/bin:/bin';
const REAL: Record<string, string | undefined> = { pi: process.env.HE_TEST_PI_BIN, hermes: process.env.HE_TEST_HERMES_BIN, openclaw: process.env.HE_TEST_OPENCLAW_BIN };
const OUT = process.env.HE_REPLAY_OUT;
export const REPLAY_MODELS = ['google:gemini-4-carbon', 'google:gemini-4-hydrogen', 'openrouter:moonshotai/kimi-k3.1-pro', 'openrouter:z-ai/glm-5.3',
  'openrouter:meta/muse-wonder', 'openrouter:deepseek/deepseek-v4.1-flash-1017', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-fable-5-2', 'openai:gpt-6.1-sol', 'xai:grok-4.7'];

type Rendered = { model_name: string; env: Record<string, string>; harbor_kwargs: Record<string, any>; config: any; settings: Record<string, any> };
const render = (harness: string, model: string, url: string, token: string): Rendered => {
  const r = spawnSync('python3', [join(HERE, 'frontier_settings.py'), harness, model, url, token], { env: { PATH }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Rendered;
};

async function run(h: string, bin: string, model: string, opts: { streaming?: boolean; tap?: boolean } = {}) {
  const streaming = opts.streaming ?? true;
  const [provider, name] = [model.slice(0, model.indexOf(':')), model.slice(model.indexOf(':') + 1)];
  const dir = fresh(h + '-' + name.replace(/\W+/g, '-'));
  for (const d of ['ws', 'home', 'pi-agent', 'sessions', 'hermes', 'jobs']) mkdirSync(join(dir, d), { recursive: true });
  const fake = replayUpstream((m) => OPENROUTER_MODELS[m]?.served ?? 'unknown');
  let k = 0;
  const bodies: unknown[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = req.method === 'POST' ? await req.text() : '';
    bodies.push({ path: new URL(req.url).pathname, body: body ? JSON.parse(body) : null });
    return fake.reply(new URL(req.url).pathname, body ? JSON.parse(body) : {}, ++k);
  } });
  const canary = () => 'fake-key-canary-' + randomBytes(16).toString('hex');
  const control = randomBytes(16).toString('hex');
  const slotModels = render(h, model, 'http://127.0.0.1:1/t/' + provider, 'trial-token:t.' + 'c'.repeat(32)).settings.endpoint.slot_models as string[];
  const lease = BudgetRun.openLease({ runId: 'replay-' + n + ':s1', leaseUsd: 20, ledgerPath: join(dir, 'ledger.sqlite') });
  const up = 'http://127.0.0.1:' + upstream.port;
  const proxy = new MeteringProxy({ controlToken: control, upstream: { openrouter: up + '/openrouter', anthropic: up + '/anthropic', openai: up + '/openai', xai: up + '/xai', google: up + '/google' },
    policy: { lease, env: { OPENROUTER_API_KEY: canary(), ANTHROPIC_API_KEY: canary(), OPENAI_API_KEY: canary(), XAI_API_KEY: canary(), GEMINI_API_KEY: canary() }, usageLog: join(dir, 'usage.ndjson'), maxOutputTokens: 128_000, refuseHostedTools: true, captureRoot: join(dir, 'jobs'), allowModels: slotModels } });
  proxy.start();
  const base = 'http://127.0.0.1:' + proxy.port;
  const broker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createBroker({ proxy: base, gateway: base, models: slotModels, log: join(dir, 'binds.jsonl'), controlToken: control, capture: true }) });
  const sent: Array<{ path: string; body: Record<string, any> | null }> = [];
  const tap = opts.tap ? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const u = new URL(req.url);
    const text = req.method === 'POST' ? await req.text() : undefined;
    if (text) sent.push({ path: u.pathname, body: JSON.parse(text) });
    const headers = new Headers(req.headers);
    headers.delete('host');
    const res = await fetch(base + u.pathname + u.search, { method: req.method, headers, body: text });
    const back = new Headers(res.headers);
    back.delete('content-encoding');
    back.delete('content-length');
    return new Response(res.body, { status: res.status, headers: back });
  } }) : null;
  try {
    const trial = 'rp__' + randomBytes(3).toString('hex');
    const slot = await (await fetch('http://127.0.0.1:' + broker.port + '/bind', { method: 'POST', body: JSON.stringify({ trial, cell: h + '-rp', attempt: 1, harness: h, model, models: slotModels }) })).json() as { token: string; base_url: string };
    const r = render(h, model, tap ? slot.base_url.replace(base, 'http://127.0.0.1:' + tap.port) : slot.base_url, slot.token);
    const instruction = 'Run the probe command with your shell tool, then say ok.';
    const env: Record<string, string> = { PATH: [dirname(bin), ...PATH.split(':')].join(':'), HOME: join(dir, 'home'), NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', ...r.env };
    let argv: string[];
    if (h === 'pi') {
      const keyEnv = Object.keys(r.env).find((e) => e.endsWith('_API_KEY'))!;
      const baseUrl = Object.entries(r.env).find(([e]) => e.endsWith('_BASE_URL'))?.[1];
      const models = provider === 'openrouter' || provider === 'particle' || provider === 'google' || provider === 'xai' ? r.config
        : { providers: { 'harbor-endpoint': { baseUrl, apiKey: '$' + keyEnv, api: r.harbor_kwargs.model_api, models: [{ id: name, reasoning: true, ...r.config }] } } };
      writeFileSync(join(dir, 'pi-agent', 'models.json'), JSON.stringify(models, null, 2) + '\n');
      env.PI_CODING_AGENT_DIR = join(dir, 'pi-agent');
      argv = [bin, '--print', '--mode', 'json', '--session-dir', join(dir, 'sessions'), '--provider', 'harbor-endpoint', '--model', name, '--thinking', r.harbor_kwargs.thinking, '--', instruction];
    } else if (h === 'hermes') {
      writeFileSync(join(dir, 'hermes', 'config.yaml'), JSON.stringify(streaming ? r.config : { ...r.config, model: { ...r.config.model, streaming: false } }) + '\n');
      for (const f of (r as Rendered & { files?: Array<{ path: string; content: string }> }).files ?? []) {
        mkdirSync(dirname(join(dir, 'hermes', f.path)), { recursive: true });
        writeFileSync(join(dir, 'hermes', f.path), f.content);
      }
      Object.assign(env, { HERMES_HOME: join(dir, 'hermes'), TERMINAL_ENV: 'local' });
      argv = [bin, '--yolo', 'chat', '-q', instruction, '-Q', '--model', name, '--provider', r.config.model.provider];
    } else {
      const setup = spawnSync(bin, ['setup', '--baseline', '--workspace', '.'], { cwd: join(dir, 'ws'), env, encoding: 'utf8', timeout: 120_000 });
      if (setup.status !== 0) throw new Error(setup.stdout + setup.stderr);
      const overlay = r.config;
      const deny = overlay.tools.deny as string[];
      const cfg = { agents: { defaults: { workspace: '.', ...overlay.agents.defaults } }, gateway: { mode: 'local' }, models: overlay.models, memory: overlay.memory, tools: { ...overlay.tools, deny: ['message', ...deny, 'group:web'].filter((d, i, a) => a.indexOf(d) === i) } };
      mkdirSync(join(dir, 'home', '.openclaw'), { recursive: true });
      writeFileSync(join(dir, 'home', '.openclaw', 'openclaw.json'), JSON.stringify(cfg, null, 2) + '\n');
      argv = [bin, 'agent', '--local', '--json', '--agent', 'main', '--thinking', r.harbor_kwargs.thinking, '--model', r.model_name, '--message', instruction];
    }
    const child = Bun.spawn(argv, { cwd: join(dir, 'ws'), env, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 170_000);
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const exit = await child.exited;
    clearTimeout(timer);
    if (process.env.HE_REPLAY_KEEP) writeFileSync(process.env.HE_REPLAY_KEEP + '-' + h + '-' + name.replace(/\W+/g, '-') + '.json', JSON.stringify({ exit, out: out + err, bodies, requests: fake.requests }, null, 1));
    return { exit, out: out + err, requests: fake.requests, verdict: replayVerdict(fake.requests), record: r.settings.reasoning_replay as Record<string, any> | null,
      effort: r.settings.effort as { requested: string; unsent_default?: string }, bodies: bodies as Array<{ path: string; body: Record<string, any> | null }>,
      sent, cap: (r.settings.max_output_tokens as { value: number }).value, usage: readFileSync(join(dir, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) };
  } finally {
    tap?.stop(true); broker.stop(true); proxy.stop(); upstream.stop(true);
  }
}

describe('reasoning replay of the real harness binaries through the metering proxy (keyless)', () => {
  for (const h of ['pi', 'hermes', 'openclaw']) {
    for (const model of REPLAY_MODELS) {
      test.skipIf(!REAL[h])(h + ' on ' + model + ': the replayed tool-call turns match its reasoning_replay record', async () => {
        const r = await run(h, REAL[h]!, model);
        const row = { harness: h, model, exit: r.exit, ...r.verdict, record: r.record ? { field: r.record.field, verdict: r.record.verdict ?? null } : null };
        if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
        console.log('replay ' + JSON.stringify(row));
        expect(r.verdict.replayed_turns, r.out.slice(-3000)).toBeGreaterThanOrEqual(1);
        expect(r.record).not.toBeNull();
        expect(r.record!.verdict).toBe(r.verdict.verdict);
        expect(r.record!.checked).not.toStartWith('not yet');
        if (!model.startsWith('xai:')) return;
        const agent = r.bodies.filter((b) => b.path.endsWith('/v1/responses') && Array.isArray(b.body?.tools) && b.body!.tools.length > 0).map((b) => b.body!);
        expect(r.bodies.every((b) => b.path.endsWith('/xai/v1/responses'))).toBe(true);
        expect(agent.length).toBeGreaterThanOrEqual(3);
        expect(r.verdict.chained).toBe(false);
        expect(r.verdict.fields).toEqual(['reasoning item with encrypted_content']);
        for (const b of agent) {
          expect(b.previous_response_id ?? null).toBeNull();
          expect(b.include).toContain('reasoning.encrypted_content');
          expect(['stop', 'presence_penalty', 'frequency_penalty'].filter((k) => k in b)).toEqual([]);
          expect(b.reasoning?.effort ?? (r.effort.unsent_default === r.effort.requested ? r.effort.requested : null)).toBe('high');
        }
      }, 200_000);
    }
  }
});

// Amendment 1 of frontier-shootout-2026-11 (A1): Hermes v0.23.1's built-in openrouter provider sends no effort and no cap
// behind the proxy, so the pinned he-openrouter-effort plugin adds both. A tap between Hermes and the proxy records each
// request as Hermes sent it, before the proxy fills any cap of its own.
export const EFFORT_MODELS = ['openrouter:meta/muse-wonder', 'openrouter:deepseek/deepseek-v4.1-flash-1017', 'openrouter:moonshotai/kimi-k3.1-pro'];

describe('Hermes on OpenRouter with the he-openrouter-effort plugin (keyless)', () => {
  for (const model of EFFORT_MODELS) {
    for (const streaming of [true, false]) {
      test.skipIf(!REAL.hermes)('hermes on ' + model + (streaming ? ', streamed' : ', not streamed') + ': every agent request reaches the proxy with reasoning {effort: high} and the cell\'s cap, and the reasoning replays', async () => {
        const r = await run('hermes', REAL.hermes!, model, { streaming, tap: true });
        const chat = r.sent.filter((b) => b.path.endsWith('/v1/chat/completions'));
        const agent = chat.filter((b) => Array.isArray(b.body?.tools) && b.body!.tools.length > 0).map((b) => b.body!);
        const row = { check: 'effort', harness: 'hermes', model, streaming, exit: r.exit, chat_requests: chat.length, agent_requests: agent.length,
          reasoning: [...new Set(agent.map((b) => JSON.stringify(b.reasoning ?? null)))], max_completion_tokens: [...new Set(agent.map((b) => b.max_completion_tokens ?? null))],
          stream: [...new Set(agent.map((b) => b.stream === true))], ...r.verdict };
        if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
        console.log('effort ' + JSON.stringify(row));
        expect(r.exit, r.out.slice(-3000)).toBe(0);
        expect(agent.length).toBeGreaterThanOrEqual(3);
        for (const b of agent) {
          expect(b.reasoning).toEqual({ effort: 'high' });
          expect(b.max_completion_tokens).toBe(r.cap);
          expect('reasoning_effort' in b).toBe(false);
          expect(b.stream === true).toBe(streaming);
        }
        expect(r.verdict.verdict).toBe('replays');
        expect(r.verdict.carried).toBe(r.verdict.replayed_turns);
      }, 200_000);
    }
  }
});

// Amendment 2 of frontier-shootout-2026-11: Gemini 4 Carbon and Hydrogen in Hermes, OpenClaw and Pi go to Google's Gemini API on
// the proxy's google route, each through the harness's own Gemini provider. A tap between the harness and the proxy records
// each request as the harness sent it; the fake upstream records it as Google would get it, after the proxy's output cap. Every
// agent request (one that declares tools) must reach Google with thinkingLevel HIGH (in any case: Hermes writes high, as Google's
// REST examples do) and maxOutputTokens at the cell's recorded cap (Hermes's own 65,535, one under the row's 65,536), every
// thought signature must come back byte for byte on its own call, and every forwarded line must carry the finish reason.
export const GEMINI_DIRECT = ['google:gemini-4-carbon', 'google:gemini-4-hydrogen'];

describe('Gemini 4 on the google route in Hermes, OpenClaw and Pi (keyless)', () => {
  for (const h of ['hermes', 'openclaw', 'pi']) {
    for (const model of GEMINI_DIRECT) {
      for (const streaming of h === 'hermes' ? [true, false] : [true]) {
        test.skipIf(!REAL[h])(h + ' on ' + model + (h === 'hermes' ? (streaming ? ', streamed' : ', not streamed') : '') + ': thinkingLevel HIGH, the cell\'s cap, and every signature back byte for byte', async () => {
          const r = await run(h, REAL[h]!, model, { streaming, tap: true });
          const google = (b: { path: string; body: Record<string, any> | null }) => /:(generateContent|streamGenerateContent)$/.test(b.path);
          const declares = (b: Record<string, any> | null) => (Array.isArray(b?.tools) ? b!.tools : []).some((t: any) => (t?.functionDeclarations ?? []).length > 0);
          const sent = r.sent.filter(google).filter((b) => declares(b.body));
          const upstream = r.bodies.filter(google).filter((b) => declares(b.body));
          const level = (b: Record<string, any>) => b.generationConfig?.thinkingConfig?.thinkingLevel ?? null;
          const cap = (b: Record<string, any>) => b.generationConfig?.maxOutputTokens ?? null;
          const row = { check: 'gemini-direct', harness: h, model, streaming, exit: r.exit, paths: [...new Set(r.sent.map((b) => b.path.replace(/\/[^/]*__[^/]*\//, '/<slot>/')))],
            agent_requests: upstream.length, sent_level: [...new Set(sent.map((b) => level(b.body!)))], sent_cap: [...new Set(sent.map((b) => cap(b.body!)))],
            upstream_level: [...new Set(upstream.map((b) => level(b.body!)))], upstream_cap: [...new Set(upstream.map((b) => cap(b.body!)))],
            finish: [...new Set(r.usage.filter((l) => l.outcome === 'forwarded').map((l) => l.finish_reason ?? null))], ...r.verdict };
          if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
          console.log('gemini ' + JSON.stringify(row));
          expect(r.exit, r.out.slice(-3000)).toBe(0);
          expect(r.bodies.every((b) => b.path.startsWith('/google/v1beta/models/' + model.slice('google:'.length) + ':'))).toBe(true);
          expect(upstream.length).toBeGreaterThanOrEqual(3);
          for (const b of upstream) {
            expect(String(level(b.body!)).toUpperCase()).toBe('HIGH');
            expect(cap(b.body!)).toBe(r.cap);
          }
          expect(r.verdict.verdict).toBe('replays');
          expect(r.verdict.replayed_turns).toBeGreaterThanOrEqual(2);
          expect(r.verdict.opaque_sent).toBe(r.verdict.replayed_turns);
          expect(r.verdict.opaque_exact).toBe(r.verdict.opaque_sent);
          expect(r.record!.verdict).toBe('replays');
          expect(r.usage.filter((l) => l.outcome === 'forwarded').every((l) => l.provider === 'google' && l.status === 200 && l.finish_reason === 'STOP' && l.thinking_level === 'high')).toBe(true);
        }, 200_000);
      }
    }
  }
});
