#!/usr/bin/env bun
// Start the world for one trial.
//
//   bun world/services/start.ts --trial t-0001 --split dev [--port 8790] [--host 127.0.0.1] \
//       [--actors dana-okafor,ilse-varga] [--clock 2026-10-14T09:00:00-05:00] [--out results/<run>/trials/t-0001] \
//       [--gbrain-url http://127.0.0.1:3131 --gbrain-token-file <trial dir>/gbrain/token]
//
// --gbrain-url and --gbrain-token-file enable POST /gbrain, the tap that relays a harness's gbrain MCP calls to
// the sidecar and records them (docs/gbrain-arm.md).
//
// Writes <out>/trial.json (tokens and MCP config, evaluator-owned, never shown to the agent) and appends every
// call to <out>/events.jsonl. Stop it with SIGINT or SIGTERM. The runner starts the same server in-process
// (runner/trial/world.ts) and calls writeTrialConfig for the same trial.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Split, World } from '../types.ts';
import { createWorldServer, mcpConfigFor, type WorldServer } from './server.ts';
import { loadWorld } from './world.ts';

export interface TrialConfig {
  trial_id: string;
  split: Split;
  world_id: string;
  base_url: string;
  clock: ReturnType<WorldServer['clock']['state']>;
  events_path: string;
  admin_token: string;
  slack: {
    api_url: string;
    bot: { member: string; user_id: string; token: string; app_token: string };
    mcp: ReturnType<typeof mcpConfigFor>;
  };
  actors: Array<{ member: string; slack_user_id: string; token: string; mcp: ReturnType<typeof mcpConfigFor> }>;
}

/** The evaluator-owned trial.json: tokens and MCP config for one running world. `baseUrl` defaults to the
 *  address the server bound; pass the address a container reaches it at when that differs. */
export function trialConfig(ws: WorldServer, opts: { split: Split; world: World; out: string; baseUrl?: string; repoRoot?: string }): TrialConfig {
  const baseUrl = opts.baseUrl ?? ws.url;
  const repoRoot = opts.repoRoot ?? resolve(import.meta.dir, '..', '..');
  return {
    trial_id: ws.log.trialId,
    split: opts.split,
    world_id: opts.world.world_id,
    base_url: baseUrl,
    clock: ws.clock.state(),
    events_path: join(opts.out, 'events.jsonl'),
    admin_token: ws.credentials.admin_token,
    slack: {
      api_url: `${baseUrl}/api/`,
      bot: { member: ws.credentials.bot.member, user_id: ws.service.bot!.slack_id, token: ws.credentials.bot.token, app_token: ws.credentials.bot.app_token },
      mcp: mcpConfigFor(baseUrl, ws.credentials.bot.token, repoRoot),
    },
    actors: ws.credentials.actors.map((a) => ({
      member: a.member,
      slack_user_id: ws.service.requireMember(a.member).slack_id,
      token: a.token,
      mcp: mcpConfigFor(baseUrl, a.token, repoRoot),
    })),
  };
}

export function writeTrialConfig(ws: WorldServer, opts: { split: Split; world: World; out: string; baseUrl?: string; repoRoot?: string }): TrialConfig {
  const trial = trialConfig(ws, opts);
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, 'trial.json'), JSON.stringify(trial, null, 1) + '\n');
  return trial;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const trialId = arg('trial');
  const split = (arg('split', 'dev') as Split);
  if (!trialId || !['dev', 'heldout', 'both'].includes(split)) {
    console.error('usage: bun world/services/start.ts --trial <id> --split dev|heldout|both [--port N] [--host H] [--actors a,b] [--clock ISO] [--out DIR]');
    process.exit(2);
  }
  const out = resolve(arg('out', join('results', 'local', 'trials', trialId))!);
  mkdirSync(out, { recursive: true });
  const world = loadWorld(arg('world', join(import.meta.dir, '..', 'seed', 'world.json'))!);
  const actorsArg = arg('actors');

  const ws = createWorldServer({
    world,
    split,
    trialId,
    port: Number(arg('port', '8790')),
    hostname: arg('host', '127.0.0.1'),
    eventsPath: join(out, 'events.jsonl'),
    ...(actorsArg ? { actors: actorsArg.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(arg('clock') ? { clockReference: arg('clock')! } : {}),
    ...(arg('gbrain-url') && arg('gbrain-token-file') ? { gbrain: { url: arg('gbrain-url')!.replace(/\/+$/, ''), token: readFileSync(arg('gbrain-token-file')!, 'utf8').trim() } } : {}),
  });

  writeTrialConfig(ws, { split, world, out });
  console.log(`world ${trialId} (${split}) listening at ${ws.url}; trial config in ${join(out, 'trial.json')}; events in ${join(out, 'events.jsonl')}${ws.gbrain() ? `; gbrain tap at ${ws.url}/gbrain -> ${ws.gbrain()!.url}/mcp` : ''}`);

  const stop = () => { ws.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
