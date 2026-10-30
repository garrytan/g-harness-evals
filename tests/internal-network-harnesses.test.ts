// internal-task: every pilot harness serves on the internal network (docs/adapters.md, "Network"). For each of claude-code, codex,
// openclaw and hermes, with docker and the harness-eval/<name>:dev image (skipped otherwise, like the other container tests):
// the run's internal network from runner/trial/docker.ts, the real metering proxy in lease mode and an in-process world both on
// its gateway, the harness container started with the runner's own docker run arguments (dockerRunArgs), and a fake model
// endpoint upstream of the proxy (scripts/gsta-135/fake-anthropic.ts for Claude Code's Anthropic cell, tests/fixtures/
// fake-responses.ts for the three gpt-6-luna cells: Codex and its same-model controls OpenClaw and Hermes, the same model on
// the same network). One serve turn must
// complete through the proxy on the cell model with a world-MCP post_message landing in the world, and a direct connection
// from inside the harness container to an outside host must fail while the proxy stays reachable. Keyless: the proxy gets
// placeholder upstream keys, every spawned process a scrubbed environment.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse } from '../runner/contracts.ts';
import { type InternalNetwork, dockerRunArgs, ensureInternalNetwork, removeInternalNetwork } from '../runner/trial/docker.ts';
import { makeTrialDirs } from '../runner/trial/harness.ts';
import { trialKey, trialToken } from '../runner/trial/proxy.ts';
import { createWorldServer } from '../world/services/server.ts';
import { stream as anthropicStream } from '../scripts/gsta-135/fake-anthropic.ts';
import { startFakeResponses, type FakeResponses } from './fixtures/fake-responses.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const cleanEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv, timeout });
const haveDocker = docker(['info'], 15_000).status === 0;
const image = (h: string) => `harness-eval/${h}:dev`;
const haveImage = (h: string) => haveDocker && docker(['image', 'inspect', image(h)]).status === 0;

type Pilot = 'claude-code' | 'codex' | 'openclaw' | 'hermes';
const PILOTS: Pilot[] = ['claude-code', 'codex', 'openclaw', 'hermes'];
const CELLS: Record<Pilot, { provider: 'anthropic' | 'openai'; model: string }> = {
  'claude-code': { provider: 'anthropic', model: 'claude-haiku-5-5' },
  codex: { provider: 'openai', model: 'gpt-6-luna' },
  openclaw: { provider: 'openai', model: 'gpt-6-luna' },
  hermes: { provider: 'openai', model: 'gpt-6-luna' },
};
// Hermes probes the proxy host for a local model server's metadata routes; the proxy refuses them with no model at $0
// (harnesses/hermes/pin.json rig_limitation). Nothing else may be refused.
const HERMES_PROBES = new Set(['/api/v1/models', '/api/tags', '/v1/props', '/props', '/version', '/models', '/api/show']);
const POST_TEXT = (h: string) => `internal network post from ${h}`;

/** A fake Anthropic Messages endpoint: a request whose newest user text carries [net:post <channel>] gets a tool_use of the
 *  world's post_message, every other request (and the one after the tool result) a text answer. */
function fakeAnthropic() {
  let n = 0;
  return Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const body = await req.json().catch(() => ({})) as { model?: string; messages?: Array<{ role: string; content: unknown }> };
    const messages = body.messages ?? [];
    const tail = JSON.stringify(messages.slice(messages.map((m) => m.role).lastIndexOf('assistant') + 1));
    n++;
    const post = tail.match(/\[net:post (\S+?)\]/);
    const content: Array<Record<string, unknown>> = !tail.includes('tool_result') && post
      ? [{ type: 'tool_use', id: 'toolu_net_' + n, name: 'mcp__world__post_message', input: { channel: post[1], text: POST_TEXT('claude-code') } }]
      : [{ type: 'text', text: 'posted' }];
    const stop = content[0]!.type === 'tool_use' ? 'tool_use' : 'end_turn';
    const msg = { id: 'msg_net_' + n, type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    return new Response(anthropicStream(msg, content, stop), { headers: { 'content-type': 'text/event-stream' } });
  } });
}

async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pred()) return; await Bun.sleep(100); }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

describe.skipIf(!PILOTS.some(haveImage))('every pilot harness serves on the internal network', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-net-harness-'));
  const control = 'control-' + process.pid;
  const usageLog = join(tmp, 'usage.ndjson');
  let network: InternalNetwork;
  let fakeA: ReturnType<typeof Bun.serve>;
  let fakeR: FakeResponses;
  let proxy: { proc: ReturnType<typeof Bun.spawn>; port: number } | null = null;

  beforeAll(async () => {
    network = await ensureInternalNetwork(`he-net-harness-smoke-${process.pid}`);
    fakeA = fakeAnthropic();
    fakeR = startFakeResponses({ log: join(tmp, 'fake-responses.ndjson') });
    let stderr = '';
    for (let attempt = 0; attempt < 3 && !proxy; attempt++) {
      const probe = Bun.serve({ port: 0, hostname: network.gateway, fetch: () => new Response() });
      const port = probe.port as number;
      probe.stop(true);
      const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', `${network.gateway}:${port}`, '--budget-ledger', join(tmp, 'ledger.sqlite'),
        '--lease-usd', '5', '--run-id', 'net-harness-smoke', '--new-run', '--max-output-tokens', '128000', '--allow-models', 'anthropic:claude-haiku-5-5,openai:gpt-6-luna',
        '--upstream', `anthropic=http://127.0.0.1:${fakeA.port}`, '--upstream', `openai=http://127.0.0.1:${fakeR.port}`, '--usage-log', usageLog, '--control-token', control],
        { cwd: ROOT, env: { ...cleanEnv, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, stdout: 'pipe', stderr: 'pipe' });
      for (let i = 0; i < 100 && !proxy; i++) {
        if (proc.exitCode !== null) break;
        try { await fetch(`http://${network.gateway}:${port}/__proxy/status`); proxy = { proc, port }; } catch { await Bun.sleep(50); }
      }
      if (!proxy) { proc.kill('SIGKILL'); await proc.exited; stderr = await new Response(proc.stderr as ReadableStream).text(); }
    }
    if (!proxy) throw new Error('the metering proxy did not start: ' + stderr);
  }, 120_000);

  afterAll(async () => {
    proxy?.proc.kill('SIGTERM');
    await proxy?.proc.exited;
    fakeA?.stop(true);
    fakeR?.stop();
    if (network) await removeInternalNetwork(network.name);
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const h of PILOTS) {
    test.skipIf(!haveImage(h))(`${h}: a serve turn completes through the proxy on the cell model, the world-MCP post lands, and a direct connection out fails`, async () => {
      const cell = CELLS[h];
      const slot = `net-${h}-${process.pid}`;
      const token = trialToken(slot);
      const bound = await fetch(`http://${network.gateway}:${proxy!.port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control },
        body: JSON.stringify({ slot, key: trialKey(slot), token, models: [`${cell.provider}:${cell.model}`] }) });
      expect(bound.status).toBe(200);
      const ws = createWorldServer({ world, split: 'dev', trialId: slot, eventsPath: null, hostname: network.gateway, port: 0 });
      const channel = ws.service.channelsFor(ws.service.bot!, 'mcp').find((c) => c.kind !== 'dm')!;
      const dirs = makeTrialDirs(join(tmp, h));
      writeFileSync(join(dirs.workspace, 'instruction.md'), '');
      const name = `he-net-${h}-${process.pid}`;
      docker(['rm', '-f', name]);
      const env: Record<string, string> = {
        HE_MODEL_BASE_URL: `http://host.docker.internal:${proxy!.port}/${slot}/${cell.provider}`, HE_MODEL_API_KEY: token, HE_MODEL_NAME: cell.model,
        HE_TIME_BUDGET_S: '120', HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_TURNS_DIR: '/he-turns', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: slot,
        HE_WORLD_MCP_URL: `http://host.docker.internal:${new URL(ws.url).port}/mcp`, HE_WORLD_MCP_TOKEN: ws.credentials.bot.token,
      };
      const args = dockerRunArgs({ harness: h, image: image(h), trialSlug: slot, dirs, env, network }, name);
      const at = args.indexOf('--network');
      expect(args.slice(at, at + 4)).toEqual(['--network', network.name, '--add-host', `host.docker.internal:${network.gateway}`]);
      const logs = () => ['adapter.log', 'stderr.log'].map((f) => existsSync(join(dirs.logs, f)) ? readFileSync(join(dirs.logs, f), 'utf8').slice(-3000) : '').join('\n');
      try {
        const started = docker(args.slice(1));
        expect(started.status, started.stderr).toBe(0);
        await waitFor(() => existsSync(join(dirs.logs, 'ready')) || docker(['inspect', '-f', '{{.State.Running}}', name]).stdout.trim() !== 'true', 240_000, `${h} ready`);
        expect(existsSync(join(dirs.logs, 'ready')), logs()).toBe(true);

        // From inside the harness container: the proxy answers, an outside address and an outside name do not.
        const reach = docker(['exec', name, 'bash', '-c', `for t in host.docker.internal/${proxy!.port} 1.1.1.1/443 chatgpt.com/443; do if timeout 6 bash -c "exec 3<>/dev/tcp/$t" 2>/dev/null; then echo "$t connected"; else echo "$t failed"; fi; done`]);
        expect(reach.stdout.trim().split('\n'), reach.stderr).toEqual([`host.docker.internal/${proxy!.port} connected`, '1.1.1.1/443 failed', 'chatgpt.com/443 failed']);

        // How each harness calls a world tool on its gpt-6-luna cell: Codex by name from inside its code-mode exec; OpenClaw and
        // Hermes defer MCP tools behind tool_search and call them through tool_call (OpenClaw {id, args} with the tool_search name
        // world__post_message, Hermes {name, arguments} with mcp__world__post_message).
        const postArgs = { channel: channel.id, text: POST_TEXT(h) };
        const call = { 'claude-code': null, codex: { call: 'mcp__world__post_message', arguments: postArgs },
          openclaw: { call: 'tool_call', arguments: { id: 'world__post_message', args: postArgs } }, hermes: { call: 'tool_call', arguments: { name: 'mcp__world__post_message', arguments: postArgs } } }[h];
        if (call) fakeR.setScript([call, { text: 'posted' }]);
        const before = ws.log.events.length;
        const req: TurnRequest = {
          turn: 1, trial_id: slot, prompt: `Dana asks you to post a note in #${channel.name}. [net:post ${channel.id}]`,
          actor: { member: 'dana-okafor', slack_user_id: 'U0DANA', name: 'Dana Okafor', role: 'Account Manager', team: 'team-north' },
          channel: { id: channel.id, name: channel.name, type: 'channel' }, text: 'post a note', ts: '1791986400.000001', thread_ts: null, sim_now: '2026-10-14T09:00:00-05:00', time_budget_s: 120,
        };
        writeFileSync(join(dirs.turns, 'turn-0001.request.json.tmp'), JSON.stringify(req));
        renameSync(join(dirs.turns, 'turn-0001.request.json.tmp'), join(dirs.turns, 'turn-0001.request.json'));
        const respPath = join(dirs.turns, 'turn-0001.response.json');
        await waitFor(() => existsSync(respPath), 240_000, `${h} turn 1`);
        const res = JSON.parse(readFileSync(respPath, 'utf8')) as TurnResponse;
        expect(res.exit, `${res.detail}\n${logs()}`).toBe(0);
        const posted = ws.log.events.slice(before).filter((e) => e.tool === 'chat.postMessage');
        expect(posted.map((e) => [e.actor, e.via, e.outcome, (e.args as { text: string }).text])).toEqual([['assistant', 'mcp', 'ok', POST_TEXT(h)]]);

        const usage = readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { key: string; route: string; model: string | null; outcome: string });
        const mine = usage.filter((u) => u.key === trialKey(slot));
        const forwarded = mine.filter((u) => u.outcome === 'forwarded');
        expect(forwarded.length).toBeGreaterThanOrEqual(2);
        expect(forwarded.filter((u) => u.model !== null).every((u) => u.model === cell.model)).toBe(true);
        const refused = mine.filter((u) => u.outcome === 'refused');
        if (h === 'hermes') expect(refused.every((u) => u.model === null && HERMES_PROBES.has(u.route))).toBe(true);
        else expect(refused).toEqual([]);
        expect(usage.filter((u) => u.key === `slot:${slot}`)).toEqual([]);
      } finally {
        docker(['rm', '-f', name]);
        ws.stop();
      }
    }, 600_000);
  }
});
