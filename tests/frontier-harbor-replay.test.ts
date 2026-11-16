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
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
export const REPLAY_MODELS = ['openrouter:google/gemini-4-carbon', 'openrouter:google/gemini-4-hydrogen', 'openrouter:moonshotai/kimi-k3.1-pro', 'openrouter:z-ai/glm-5.3',
  'openrouter:meta/muse-wonder', 'openrouter:deepseek/deepseek-v4.1-flash-1017', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-fable-5-2', 'openai:gpt-6.1-sol', 'xai:grok-4.7'];

type Rendered = { model_name: string; env: Record<string, string>; harbor_kwargs: Record<string, any>; config: any; settings: Record<string, any> };
const render = (harness: string, model: string, url: string, token: string): Rendered => {
  const r = spawnSync('python3', [join(HERE, 'frontier_settings.py'), harness, model, url, token], { env: { PATH }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Rendered;
};

async function run(h: string, bin: string, model: string) {
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
  const proxy = new MeteringProxy({ controlToken: control, upstream: { openrouter: up + '/openrouter', anthropic: up + '/anthropic', openai: up + '/openai', xai: up + '/xai' },
    policy: { lease, env: { OPENROUTER_API_KEY: canary(), ANTHROPIC_API_KEY: canary(), OPENAI_API_KEY: canary(), XAI_API_KEY: canary() }, usageLog: join(dir, 'usage.ndjson'), maxOutputTokens: 128_000, refuseHostedTools: true, captureRoot: join(dir, 'jobs'), allowModels: slotModels } });
  proxy.start();
  const base = 'http://127.0.0.1:' + proxy.port;
  const broker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createBroker({ proxy: base, gateway: base, models: slotModels, log: join(dir, 'binds.jsonl'), controlToken: control, capture: true }) });
  try {
    const trial = 'rp__' + randomBytes(3).toString('hex');
    const slot = await (await fetch('http://127.0.0.1:' + broker.port + '/bind', { method: 'POST', body: JSON.stringify({ trial, cell: h + '-rp', attempt: 1, harness: h, model, models: slotModels }) })).json() as { token: string; base_url: string };
    const r = render(h, model, slot.base_url, slot.token);
    const instruction = 'Run the probe command with your shell tool, then say ok.';
    const env: Record<string, string> = { PATH: [dirname(bin), ...PATH.split(':')].join(':'), HOME: join(dir, 'home'), NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', ...r.env };
    let argv: string[];
    if (h === 'pi') {
      const keyEnv = Object.keys(r.env).find((e) => e.endsWith('_API_KEY'))!;
      const baseUrl = Object.entries(r.env).find(([e]) => e.endsWith('_BASE_URL'))?.[1];
      const models = provider === 'openrouter' || provider === 'particle' || provider === 'xai' ? r.config
        : { providers: { 'harbor-endpoint': { baseUrl, apiKey: '$' + keyEnv, api: r.harbor_kwargs.model_api, models: [{ id: name, reasoning: true, ...r.config }] } } };
      writeFileSync(join(dir, 'pi-agent', 'models.json'), JSON.stringify(models, null, 2) + '\n');
      env.PI_CODING_AGENT_DIR = join(dir, 'pi-agent');
      argv = [bin, '--print', '--mode', 'json', '--session-dir', join(dir, 'sessions'), '--provider', 'harbor-endpoint', '--model', name, '--thinking', r.harbor_kwargs.thinking, '--', instruction];
    } else if (h === 'hermes') {
      writeFileSync(join(dir, 'hermes', 'config.yaml'), JSON.stringify(r.config) + '\n');
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
      argv = [bin, 'agent', '--local', '--json', '--agent', 'main', '--thinking', r.harbor_kwargs.thinking, '--model', provider === 'openrouter' ? 'openrouter-proxy/' + name : r.model_name, '--message', instruction];
    }
    const child = Bun.spawn(argv, { cwd: join(dir, 'ws'), env, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 170_000);
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const exit = await child.exited;
    clearTimeout(timer);
    if (process.env.HE_REPLAY_KEEP) writeFileSync(process.env.HE_REPLAY_KEEP + '-' + h + '-' + name.replace(/\W+/g, '-') + '.json', JSON.stringify({ exit, out: out + err, bodies, requests: fake.requests }, null, 1));
    return { exit, out: out + err, requests: fake.requests, verdict: replayVerdict(fake.requests), record: r.settings.reasoning_replay as Record<string, any> | null,
      effort: r.settings.effort as { requested: string; unsent_default?: string }, bodies: bodies as Array<{ path: string; body: Record<string, any> | null }> };
  } finally {
    broker.stop(true); proxy.stop(); upstream.stop(true);
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
