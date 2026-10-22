#!/usr/bin/env bun
// Start the world for one trial.
//
//   bun world/services/start.ts --trial t-0001 --split dev [--port 8790] [--host 127.0.0.1] \
//       [--actors dana-okafor,ilse-varga] [--clock 2026-10-14T09:00:00-05:00] [--out results/<run>/trials/t-0001]
//
// Writes <out>/trial.json (tokens and MCP config, evaluator-owned, never shown to the agent) and appends every
// call to <out>/events.jsonl. Stop it with SIGINT or SIGTERM.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Split } from '../types.ts';
import { createWorldServer, mcpConfigFor } from './server.ts';
import { loadWorld } from './world.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

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
});

const repoRoot = resolve(import.meta.dir, '..', '..');
const trial = {
  trial_id: trialId,
  split,
  world_id: world.world_id,
  base_url: ws.url,
  clock: ws.clock.state(),
  events_path: join(out, 'events.jsonl'),
  admin_token: ws.credentials.admin_token,
  slack: {
    api_url: `${ws.url}/api/`,
    bot: { member: ws.credentials.bot.member, user_id: ws.service.bot!.slack_id, token: ws.credentials.bot.token, app_token: ws.credentials.bot.app_token },
    mcp: mcpConfigFor(ws.url, ws.credentials.bot.token, repoRoot),
  },
  actors: ws.credentials.actors.map((a) => ({
    member: a.member,
    slack_user_id: ws.service.requireMember(a.member).slack_id,
    token: a.token,
    mcp: mcpConfigFor(ws.url, a.token, repoRoot),
  })),
};
writeFileSync(join(out, 'trial.json'), JSON.stringify(trial, null, 1) + '\n');
console.log(`world ${trialId} (${split}) listening at ${ws.url}; trial config in ${join(out, 'trial.json')}; events in ${join(out, 'events.jsonl')}`);

const stop = () => { ws.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
