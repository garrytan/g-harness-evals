// An in-process player for oracle and mutation scripts: starts a world, posts each actor's message through the
// Slack mock, plays the script's world-MCP calls as the bot, posts the reply as the bot, records the turn windows
// from the event log, fences, snapshots and returns TrialEvidence. It is the fast keyless path the task matrix
// uses; runner/run.ts drives real harnesses through the same shapes.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { join, resolve } from 'node:path';
import type { Script, ScriptedTurn, TrialEvidence, TurnWindow, WorldSnapshot } from '../contracts.ts';
import { createWorldServer, type WorldServer } from '../../world/services/server.ts';
import { loadWorld } from '../../world/services/world.ts';
import type { World } from '../../world/types.ts';
import type { Task } from './task.ts';

export const DEFAULT_WORLD_PATH = join(import.meta.dir, '..', '..', 'world', 'seed', 'world.json');

export interface PlayOptions {
  /** The loaded seed; defaults to world/seed/world.json. */
  world?: World;
  worldPath?: string;
  /** Honour each turn's wait_s in real seconds. The matrix test leaves it off. */
  honorWaits?: boolean;
  trialId?: string;
}

export class PlayError extends Error {}

/** Placeholders a script may use in call arguments and replies: {{request_ts}} (this turn's actor message ts,
 *  TurnRequest.ts) and {{channel}} (this turn's channel id, TurnRequest.channel.id). The scripted executor in
 *  runner/scripted must apply the same substitution so the org_security oracles name the originating thread. */
export function substitute<T>(value: T, vars: { request_ts: string; channel: string }): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{request_ts\}\}/g, vars.request_ts).replace(/\{\{channel\}\}/g, vars.channel) as T;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, vars)])) as T;
  return value;
}

async function slackCall(ws: WorldServer, token: string, method: string, body: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(`${ws.url}/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Record<string, any>;
  if (!json.ok) throw new PlayError(`Slack ${method} failed: ${json.error}`);
  return json;
}

async function admin(ws: WorldServer, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${ws.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new PlayError(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function tokenOf(ws: WorldServer, member: string): string {
  const a = ws.credentials.actors.find((x) => x.member === member);
  if (!a) throw new PlayError(`no token for actor ${member}`);
  return a.token;
}

/** Validate the script against the task before playing: one entry per turn, in order. */
export function checkScript(task: Task, script: Script): void {
  if (script.task !== task.id) throw new PlayError(`script "${script.id}" is for task "${script.task}", not "${task.id}"`);
  if (script.turns.length !== task.turns.length) throw new PlayError(`script "${script.id}" has ${script.turns.length} turn(s), the task has ${task.turns.length}`);
  script.turns.forEach((t, i) => {
    if (t.turn !== i + 1) throw new PlayError(`script "${script.id}": turns[${i}].turn is ${t.turn}, expected ${i + 1}`);
  });
}

export async function playScript(taskDir: string, task: Task, script: Script, opts: PlayOptions = {}): Promise<TrialEvidence> {
  checkScript(task, script);
  const worldPath = opts.worldPath ?? DEFAULT_WORLD_PATH;
  const world = opts.world ?? loadWorld(worldPath);
  const trialId = opts.trialId ?? `t-${task.id}-${script.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  const ws = createWorldServer({ world, split: task.split, trialId, actors: task.actors, eventsPath: null });
  const bot = ws.service.bot!;
  const client = new Client({ name: 'scripted-harness', version: '0' });
  const turns: TurnWindow[] = [];
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${ws.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${ws.credentials.bot.token}` } } }));
    for (let i = 0; i < task.turns.length; i += 1) {
      const turn = task.turns[i]!;
      const scripted: ScriptedTurn = script.turns[i]!;
      const n = i + 1;
      const actor = ws.service.requireMember(turn.actor);
      const actorToken = tokenOf(ws, turn.actor);
      if (turn.advance_clock_s) await admin(ws, '/clock/advance', { method: 'POST', body: JSON.stringify({ seconds: turn.advance_clock_s }) });
      let channelId: string;
      if (turn.channel === 'dm') {
        const opened = await slackCall(ws, actorToken, 'conversations.open', { users: bot.slack_id });
        channelId = opened.channel.id as string;
      } else {
        const ch = ws.service.channel(turn.channel);
        if (!ch) throw new PlayError(`${task.id} turn ${n}: channel "${turn.channel}" does not exist in split ${task.split}`);
        if (!ws.service.isMember(actor, ch)) throw new PlayError(`${task.id} turn ${n}: ${turn.actor} is not a member of #${turn.channel}`);
        channelId = ch.id;
      }
      const channel = ws.service.requireChannel(channelId);
      const posted = await slackCall(ws, actorToken, 'chat.postMessage', { channel: channelId, text: turn.text });
      const requestTs = posted.ts as string;
      const startedWall = new Date().toISOString();
      const startedSeq = ws.log.events.at(-1)?.seq ?? 0;
      const vars = { request_ts: requestTs, channel: channelId };
      let exit: TurnWindow['exit'] = 0;
      let replyText: string | null = null;
      if (scripted.exit) {
        exit = scripted.exit;
      } else {
        for (const call of scripted.calls) {
          await client.callTool({ name: call.tool, arguments: substitute(call.args, vars) });
        }
        replyText = scripted.reply === null ? null : substitute(scripted.reply, vars);
      }
      const endedSeq = ws.log.events.at(-1)?.seq ?? 0;
      let replyTs: string | null = null;
      if (replyText !== null && replyText.trim()) {
        const r = await slackCall(ws, ws.credentials.bot.token, 'chat.postMessage', { channel: channelId, text: replyText });
        replyTs = r.ts as string;
      }
      turns.push({
        turn: n,
        actor: actor.id,
        slack_user_id: actor.slack_id,
        channel: channelId,
        channel_name: channel.name,
        channel_type: channel.kind === 'dm' ? 'dm' : 'channel',
        text: turn.text,
        request_ts: requestTs,
        started_wall: startedWall,
        ended_wall: new Date().toISOString(),
        started_seq: startedSeq,
        ended_seq: endedSeq,
        exit,
        reply_ts: replyTs,
        reply_text: replyText,
      });
      if (opts.honorWaits && turn.wait_s) await Bun.sleep(turn.wait_s * 1000);
    }
    await admin(ws, '/admin/fence', { method: 'POST' });
    const snapshot = (await admin(ws, '/admin/snapshot')) as WorldSnapshot;
    return {
      trial_id: trialId,
      task_dir: resolve(taskDir),
      split: task.split,
      world_path: worldPath,
      bot_member: bot.id,
      snapshot,
      events: structuredClone(ws.log.events),
      turns,
    };
  } finally {
    await client.close().catch(() => undefined);
    ws.stop();
  }
}
