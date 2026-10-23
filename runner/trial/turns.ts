// The turn loop: for each turn in task.toml, move the clock if asked, post the actor's message into the world
// through the Slack mock with that actor's token, hand the harness a TurnRequest, wait for its TurnResponse,
// post the reply as the bot, and record a TurnWindow with the event seqs that bracket the harness's work.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnRequest, TurnResponse, TurnWindow } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { HarnessGone, type Harness, awaitResponse, writeRequest } from './harness.ts';
import { composePrompt, type TaskSpec } from './task.ts';
import type { TrialWorld } from './world.ts';

export interface TurnLoopOptions {
  task: TaskSpec;
  preamble: string;
  world: TrialWorld;
  harness: Harness;
  turnsDir: string;
  trialId: string;
  /** Real seconds past time_budget_s before the harness is killed for the turn (methodology item 7 says 60). */
  graceS: number;
  log: (line: string) => void;
}

export interface TurnLoopResult {
  windows: TurnWindow[];
  /** Why the loop ended before the last turn, if it did. */
  ended_early: 'timeout' | 'harness_gone' | 'exam_fault' | null;
  error?: string;
}

const VALID_EXITS = new Set([0, 2, 3, 124]);

export async function runTurns(o: TurnLoopOptions): Promise<TurnLoopResult> {
  const windows: TurnWindow[] = [];
  const turnsLog = join(o.turnsDir, '..', 'turns.jsonl');
  const record = (w: TurnWindow) => { windows.push(w); appendFileSync(turnsLog, JSON.stringify(w) + '\n'); };
  const bot = o.world.botMember;

  for (let i = 0; i < o.task.turns.length; i++) {
    const turn = o.task.turns[i]!;
    const n = i + 1;
    if (turn.advance_clock_s) { const now = await o.world.advanceClock(Number(turn.advance_clock_s)); o.log(`turn ${n}: clock advanced ${turn.advance_clock_s} s to ${now}`); }

    const actor = o.world.actor(turn.actor);
    let channelId: string;
    let channelName: string;
    let channelType: 'dm' | 'channel';
    if (turn.channel === 'dm') {
      const opened = await o.world.slack(actor.token, 'conversations.open', { users: o.world.botUserId });
      if (!opened.ok) return exam(windows, `turn ${n}: conversations.open for ${turn.actor} with the bot failed: ${opened.error}`);
      const c = opened.channel as { id: string; name?: string };
      channelId = c.id; channelName = c.name ?? `dm:${turn.actor}`; channelType = 'dm';
    } else {
      const c = o.world.channelByName(turn.channel);
      if (!c) return exam(windows, `turn ${n}: channel ${turn.channel} does not exist in the ${o.world.split} split`);
      channelId = c.id; channelName = c.name; channelType = 'channel';
    }
    const posted = await o.world.slack(actor.token, 'chat.postMessage', { channel: channelId, text: turn.text });
    if (!posted.ok) return exam(windows, `turn ${n}: posting ${turn.actor}'s message to ${channelName} failed: ${posted.error}`);
    const ts = String(posted.ts);
    const simNow = o.world.simNow();
    const req: TurnRequest = {
      turn: n,
      trial_id: o.trialId,
      prompt: composePrompt(o.preamble, {
        requester_name: actor.member.name, requester_handle: actor.member.handle, requester_role: actor.member.role, requester_team: actor.member.team ?? 'no team',
        channel_name: channelType === 'dm' ? `a direct message (channel id ${channelId})` : `#${channelName}`, channel_type: channelType, sim_now: simNow, message: turn.text, bot_name: bot.handle,
        request_ts: ts,
      }),
      actor: { member: actor.member.id, slack_user_id: actor.slack_user_id, name: actor.member.name, role: actor.member.role, team: actor.member.team },
      channel: { id: channelId, name: channelName, type: channelType },
      text: turn.text,
      ts,
      thread_ts: null,
      sim_now: simNow,
      time_budget_s: o.task.time_budget_s,
    };
    const started_seq = o.world.lastSeq;
    const started_wall = new Date().toISOString();
    writeRequest(o.turnsDir, req);
    o.harness.notify?.(req);
    o.log(`turn ${n}: ${turn.actor} in ${channelType === 'dm' ? 'DM' : '#' + channelName} (ts ${ts}); waiting up to ${o.task.time_budget_s + o.graceS} s`);

    let response: TurnResponse | null;
    let gone: HarnessGone | null = null;
    try { response = await awaitResponse(o.turnsDir, n, (o.task.time_budget_s + o.graceS) * 1000, o.harness); }
    catch (e) { if (!(e instanceof HarnessGone)) throw e; gone = e; response = null; }
    const ended_seq = o.world.lastSeq;
    const ended_wall = new Date().toISOString();

    const base = { turn: n, actor: actor.member.id, slack_user_id: actor.slack_user_id, channel: channelId, channel_name: channelName, channel_type: channelType, text: turn.text, request_ts: ts, started_wall, ended_wall, started_seq, ended_seq };
    if (gone) {
      o.log(`turn ${n}: ${gone.message}`);
      record({ ...base, exit: gone.exit === 3 ? 3 : 2, reply_ts: null, reply_text: null });
      return { windows, ended_early: 'harness_gone', error: gone.message };
    }
    if (!response) {
      o.log(`turn ${n}: HE-ADAPTER-003 no response after ${o.task.time_budget_s + o.graceS} s; killing the harness, exit 124`);
      await o.harness.kill();
      record({ ...base, exit: 124, reply_ts: null, reply_text: null });
      return { windows, ended_early: 'timeout' };
    }
    let exit = Number(response.exit) as TurnWindow['exit'];
    if (!VALID_EXITS.has(exit)) { o.log(`turn ${n}: response exit ${String(response.exit)} is not 0, 2, 3 or 124; recorded as 2`); exit = 2; }
    let reply_ts: string | null = null;
    const reply_text = typeof response.reply_text === 'string' && response.reply_text.trim() ? response.reply_text : null;
    if (reply_text) {
      const r = await o.world.slack(o.world.botToken, 'chat.postMessage', { channel: channelId, text: reply_text });
      if (r.ok) reply_ts = String(r.ts);
      else o.log(`turn ${n}: the world refused the bot reply: ${r.error}`);
    }
    record({ ...base, exit, reply_ts, reply_text });
    o.log(`turn ${n}: exit ${exit}${reply_ts ? `, reply ts ${reply_ts}` : ', no reply'}${response.detail ? ` (${response.detail})` : ''}`);
    if (turn.wait_s) await Bun.sleep(Number(turn.wait_s) * 1000);
  }
  return { windows, ended_early: null };
}

function exam(windows: TurnWindow[], message: string): TurnLoopResult {
  return { windows, ended_early: 'exam_fault', error: new RunnerError('HE-WORLD-001', message).message };
}
