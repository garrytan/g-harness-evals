// The turn loop: for each turn in task.toml, move the clock if asked, post the actor's message into the world
// through the Slack mock with that actor's token, hand the harness a TurnRequest, wait for its TurnResponse,
// post the reply as the bot, and record a TurnWindow with the event seqs that bracket the harness's work. A turn on which the
// bot already posted in the turn's channel (any thread) during the window gets no runner post: its reply_text is a wrap-up for
// whoever launched the harness, kept in the record with reply_withheld = 'bot_posted' and never graded (internal-task).
// internal-task (H10): every TurnWindow also carries the turn's thread_ts and session_key (`<channel id>`, or
// `<channel id>:<thread_ts>` for a turn that opened a thread), the session definition of harnesses/routes/README.md.
// [clock] timers (TODOS eng-r2-native-5, eng-r2-outside-4): before moving the clock, the runner delivers every agent-set timer
// due on the way as a turn of its own, with the clock at the timer's due time, in the session of the turn that set it, with no
// member message. The adapter's answer with exit 0 is the acknowledgement: only then is the timer marked fired, so a repeated
// tick never fires it twice and a timer whose turn failed or never answered stays pending. Timer turns go to timer-turns.jsonl, never turns.jsonl,
// and a reply of exactly NOTHING_TO_SAY is not posted (reply_withheld 'no_reply'). Without [clock] timers nothing here changes.
// Week events (docs/tasks.md "Week events", [clock] timers tasks only): restart_before stops the harness and starts it again on
// the same workspace and state before the turn; burst posts more messages in the turn's conversation just before its own, all
// answered in the one turn; redeliver hands the same request again after the answer, with retry_attempt 1, and writes that
// window to redelivery-turns.jsonl.

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expiryWindows, type RedeliveryTurnWindow, type TimerTurnWindow, type TurnRequest, type TurnResponse, type TurnWindow } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { HarnessGone, type Harness, awaitResponse, writeRequest } from './harness.ts';
import { composePrompt, TIMER_PROMPT_PATH, type TaskSpec } from './task.ts';
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
  /** Called with the turn number and its exit as soon as the adapter's response for it arrives, before the next turn's request is written. */
  onAnswered?: (turn: number, exit: TurnWindow['exit']) => void;
  /** internal-task: called with the turn number once its window is recorded, on every path that records one. */
  afterTurn?: (turn: number) => void;
  /** Week events: how long a restart_before restart gives the old harness to stop and the new one to be ready. */
  restart?: { graceMs: number; readyTimeoutMs: number };
}

export interface TurnLoopResult {
  windows: TurnWindow[];
  /** [clock] timers tasks only; empty otherwise. */
  timer_windows: TimerTurnWindow[];
  /** Why the loop ended before the last turn, if it did. */
  ended_early: 'timeout' | 'harness_gone' | 'exam_fault' | null;
  error?: string;
  /** Who a failed restart is charged to (it records no turn): a docker CLI failure is infra, the harness's own exit 3 is model, anything else is harness. */
  restart_failure?: 'harness' | 'model' | 'infra';
  /** Week events; empty or 0 on any other task. */
  redelivery_windows: RedeliveryTurnWindow[];
  restarts: Array<{ before_turn: number; wall_ms: number }>;
  burst_messages: number;
}

type WeekCounts = Pick<TurnLoopResult, 'redelivery_windows' | 'restarts' | 'burst_messages'>;
type LoopEnd = Omit<TurnLoopResult, keyof WeekCounts>;

const VALID_EXITS = new Set([0, 2, 3, 124]);
/** Most timer turns one clock move may deliver; past it the rest stay pending and the move completes. */
export const MAX_TIMER_TURNS_PER_ADVANCE = 20;
export const NOTHING_TO_SAY = 'NOTHING_TO_SAY';

export async function runTurns(o: TurnLoopOptions): Promise<TurnLoopResult> {
  const week: WeekCounts = { redelivery_windows: [], restarts: [], burst_messages: 0 };
  return { ...await turnLoop(o, week), ...week };
}

async function turnLoop(o: TurnLoopOptions, week: WeekCounts): Promise<LoopEnd> {
  const windows: TurnWindow[] = [];
  const timerWindows: TimerTurnWindow[] = [];
  const turnsLog = join(o.turnsDir, '..', 'turns.jsonl');
  const record = (w: TurnWindow) => { windows.push(w); appendFileSync(turnsLog, JSON.stringify(w) + '\n'); o.afterTurn?.(w.turn); };
  const bot = o.world.botMember;
  const timers = !!o.task.clock?.timers;
  const timerPrompt = timers ? readFileSync(TIMER_PROMPT_PATH, 'utf8') : '';
  let delivery = 0;
  const done = (ended_early: TurnLoopResult['ended_early'], error?: string): LoopEnd => ({ windows, timer_windows: timerWindows, ended_early, ...(error ? { error } : {}) });

  // Move the clock forward by `seconds`, delivering each timer due on the way first. Returns a result only when a timer turn
  // ended the trial early.
  const advance = async (seconds: number, afterTurn: number, phase?: 'end'): Promise<LoopEnd | null> => {
    const target = new Date(Date.parse(o.world.simNow()) + seconds * 1000).toISOString();
    const tried = new Set<string>();
    for (let fired = 0; fired < MAX_TIMER_TURNS_PER_ADVANCE; fired++) {
      const t = (await o.world.dueTimers(target)).find((x) => !tried.has(x.id));
      if (!t) break;
      tried.add(t.id);
      if (Date.parse(t.due) > Date.parse(o.world.simNow())) await o.world.advanceClockTo(t.due);
      const ended = await deliverTimer(t, afterTurn, phase);
      if (ended) return ended;
    }
    const left = (await o.world.dueTimers(target)).length;
    if (left) o.log(`clock move after turn ${afterTurn}: ${left} due timer(s) left pending (a failed timer turn, or past ${MAX_TIMER_TURNS_PER_ADVANCE} timer turns); the next clock move delivers them again`);
    const now = await o.world.advanceClockTo(target);
    o.log(`${phase === 'end' ? 'after the last turn' : `turn ${afterTurn + 1}`}: clock advanced ${seconds} s to ${now}`);
    return null;
  };

  const deliverTimer = async (t: Awaited<ReturnType<TrialWorld['dueTimers']>>[number], afterTurn: number, phase?: 'end'): Promise<LoopEnd | null> => {
    const setEvent = o.world.events.find((e) => e.tool === 'timer_set' && e.effect?.timer === t.id);
    const origin = setEvent ? [...windows, ...timerWindows, ...week.redelivery_windows].find((w) => setEvent.seq > w.started_seq && setEvent.seq <= w.ended_seq) : undefined;
    if (!origin) return done('exam_fault', new RunnerError('HE-WORLD-001', `timer ${t.id} was set outside every turn window; the runner cannot tell which conversation it belongs to`).message);
    const fromTimer = 'kind' in origin && origin.kind === 'timer';
    const setInTurn = 'of_turn' in origin ? origin.of_turn : fromTimer ? null : origin.turn;
    delivery += 1;
    const d = delivery;
    const actor = o.world.actor(origin.actor);
    const simNow = o.world.simNow();
    const values: Record<string, string> = {
      timer_reason: t.reason, timer_note: t.note ?? '(none)', timer_set_at: t.set_at, timer_due: t.due, sim_now: simNow, requester_name: actor.member.name,
      channel_name: origin.channel_type === 'dm' ? `a direct message (channel id ${origin.channel})` : `#${origin.channel_name}`, channel_type: origin.channel_type,
    };
    const text = `[timer ${t.id}] ${t.reason}`;
    const req: TurnRequest = {
      turn: d, trial_id: o.trialId,
      prompt: timerPrompt.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name] ?? ''),
      actor: { member: actor.member.id, slack_user_id: actor.slack_user_id, name: actor.member.name, role: actor.member.role, team: actor.member.team },
      channel: { id: origin.channel, name: origin.channel_name, type: origin.channel_type },
      text, ts: origin.request_ts, thread_ts: origin.thread_ts ?? null, sim_now: simNow, time_budget_s: o.task.time_budget_s,
      kind: 'timer', timer: { id: t.id, due: t.due, reason: t.reason, note: t.note, set_at: t.set_at },
    };
    if (o.world.gbrainScoped) await o.world.setGbrainRequester(actor.member.id, origin.channel);
    const started_seq = o.world.lastSeq;
    const started_wall = new Date().toISOString();
    writeRequest(o.turnsDir, req);
    o.harness.notify?.(req);
    o.log(`timer turn ${d}: ${t.id} due ${t.due}, in the session of ${fromTimer ? 'timer turn' : 'turn'} ${setInTurn ?? origin.turn}; waiting up to ${o.task.time_budget_s + o.graceS} s`);
    let response: TurnResponse | null;
    let gone: HarnessGone | null = null;
    try { response = await awaitResponse(o.turnsDir, d, (o.task.time_budget_s + o.graceS) * 1000, o.harness); }
    catch (e) { if (!(e instanceof HarnessGone)) throw e; gone = e; response = null; }
    const base = {
      turn: d, kind: 'timer' as const, timer_id: t.id, due: t.due, set_in_turn: setInTurn, after_turn: afterTurn, ...(phase ? { phase } : {}),
      actor: actor.member.id, slack_user_id: actor.slack_user_id, channel: origin.channel, channel_name: origin.channel_name, channel_type: origin.channel_type, text, request_ts: origin.request_ts,
      started_wall, ended_wall: new Date().toISOString(), started_seq, ended_seq: o.world.lastSeq, thread_ts: origin.thread_ts ?? null, session_key: origin.session_key ?? origin.channel,
    };
    const recordTimer = (w: TimerTurnWindow) => { timerWindows.push(w); appendFileSync(join(o.turnsDir, '..', 'timer-turns.jsonl'), JSON.stringify(w) + '\n'); };
    if (gone) { o.log(`timer turn ${d}: ${gone.message}`); recordTimer({ ...base, exit: gone.exit === 3 ? 3 : 2, reply_ts: null, reply_text: null }); return done('harness_gone', gone.message); }
    if (!response) {
      o.log(`timer turn ${d}: HE-ADAPTER-003 no response after ${o.task.time_budget_s + o.graceS} s; killing the harness, exit 124`);
      await o.harness.kill();
      recordTimer({ ...base, exit: 124, reply_ts: null, reply_text: null });
      return done('timeout');
    }
    let exit = Number(response.exit) as TurnWindow['exit'];
    if (!VALID_EXITS.has(exit)) exit = 2;
    const fired = exit === 0 && await o.world.fireTimer(t.id, d);
    o.onAnswered?.(d, exit);
    const posted = await postReply(response, origin.channel, origin.channel_name, origin.thread_ts ?? null, started_seq, base.ended_seq, d);
    recordTimer({ ...base, exit, ...posted });
    o.log(`timer turn ${d}: exit ${exit}, ${fired ? 'timer marked fired' : exit === 0 ? 'timer was no longer pending' : 'timer left pending'}${posted.reply_ts ? `, reply ts ${posted.reply_ts}` : posted.reply_withheld ? `, reply withheld (${posted.reply_withheld})` : ', no reply'}`);
    if (o.world.gbrainLive) {
      const f = await o.world.flushGbrainIngest();
      if (f.failed.length) return ingestFault(o, windows, timerWindows, d, f.failed);
    }
    return null;
  };

  // Post the harness's reply as the bot unless it already posted in the conversation during the window, or (timers tasks) it said NOTHING_TO_SAY.
  const postReply = async (response: TurnResponse, channelId: string, channelName: string, threadTs: string | null, startedSeq: number, endedSeq: number, n: number): Promise<{ reply_ts: string | null; reply_text: string | null; reply_withheld?: 'bot_posted' | 'no_reply' }> => {
    const reply_text = typeof response.reply_text === 'string' && response.reply_text.trim() ? response.reply_text : null;
    const botPosted = o.world.events.some((e) => e.seq > startedSeq && e.seq <= endedSeq && e.actor === bot.id && e.tool === 'chat.postMessage' && e.kind === 'write' && e.outcome === 'ok'
      && (e.effect?.channel === channelId || e.effect?.channel === channelName));
    const withheld = reply_text !== null && botPosted ? 'bot_posted' as const : timers && reply_text?.trim() === NOTHING_TO_SAY ? 'no_reply' as const : null;
    let reply_ts: string | null = null;
    if (reply_text && !withheld) {
      const r = await o.world.slack(o.world.botToken, 'chat.postMessage', { channel: channelId, text: reply_text, ...(threadTs ? { thread_ts: threadTs } : {}) });
      if (r.ok) reply_ts = String(r.ts);
      else o.log(`turn ${n}: the world refused the bot reply: ${r.error}`);
    }
    return { reply_ts, reply_text, ...(withheld ? { reply_withheld: withheld } : {}) };
  };

  // Week events: hand the same request again, the way Slack retries an event it thinks went unanswered.
  const redeliver = async (first: TurnRequest, n: number): Promise<LoopEnd | null> => {
    const req: TurnRequest = { ...first, turn: (delivery += 1), retry_attempt: 1 };
    const d = req.turn;
    const started_seq = o.world.lastSeq;
    const started_wall = new Date().toISOString();
    writeRequest(o.turnsDir, req);
    o.harness.notify?.(req);
    o.log(`turn ${n}: handed again as request ${d} (retry_attempt 1); waiting up to ${o.task.time_budget_s + o.graceS} s`);
    let response: TurnResponse | null;
    let gone: HarnessGone | null = null;
    try { response = await awaitResponse(o.turnsDir, d, (o.task.time_budget_s + o.graceS) * 1000, o.harness); }
    catch (e) { if (!(e instanceof HarnessGone)) throw e; gone = e; response = null; }
    const threadTs = first.thread_ts;
    const base = {
      turn: d, kind: 'redelivery' as const, of_turn: n, retry_attempt: 1, actor: first.actor.member, slack_user_id: first.actor.slack_user_id,
      channel: first.channel.id, channel_name: first.channel.name, channel_type: first.channel.type, text: first.text, request_ts: first.ts,
      started_wall, ended_wall: new Date().toISOString(), started_seq, ended_seq: o.world.lastSeq, thread_ts: threadTs, session_key: threadTs ? `${first.channel.id}:${threadTs}` : first.channel.id,
    };
    const recordAgain = (w: RedeliveryTurnWindow) => { week.redelivery_windows.push(w); appendFileSync(join(o.turnsDir, '..', 'redelivery-turns.jsonl'), JSON.stringify(w) + '\n'); };
    if (gone) { o.log(`request ${d}: ${gone.message}`); recordAgain({ ...base, exit: gone.exit === 3 ? 3 : 2, reply_ts: null, reply_text: null }); return done('harness_gone', gone.message); }
    if (!response) {
      o.log(`request ${d}: HE-ADAPTER-003 no response after ${o.task.time_budget_s + o.graceS} s; killing the harness, exit 124`);
      await o.harness.kill();
      recordAgain({ ...base, exit: 124, reply_ts: null, reply_text: null });
      return done('timeout');
    }
    let exit = Number(response.exit) as TurnWindow['exit'];
    if (!VALID_EXITS.has(exit)) exit = 2;
    o.onAnswered?.(d, exit);
    const posted = await postReply(response, first.channel.id, first.channel.name, threadTs, started_seq, base.ended_seq, d);
    recordAgain({ ...base, exit, ...posted });
    o.log(`request ${d}: exit ${exit}${posted.reply_ts ? `, reply ts ${posted.reply_ts}` : posted.reply_withheld ? `, reply withheld (${posted.reply_withheld})` : ', no reply'}`);
    if (o.world.gbrainLive) {
      const f = await o.world.flushGbrainIngest();
      if (f.failed.length) return ingestFault(o, windows, timerWindows, d, f.failed);
    }
    return null;
  };

  for (let i = 0; i < o.task.turns.length; i++) {
    const turn = o.task.turns[i]!;
    const n = i + 1;
    if (turn.advance_clock_s && timers) { const ended = await advance(Number(turn.advance_clock_s), i); if (ended) return ended; }
    else if (turn.advance_clock_s) { const now = await o.world.advanceClock(Number(turn.advance_clock_s)); o.log(`turn ${n}: clock advanced ${turn.advance_clock_s} s to ${now}`); }
    if (turn.expire_turns?.length) {
      const inTimerTurn = (seq: number) => timerWindows.some((w) => seq > w.started_seq && seq <= w.ended_seq);
      const keep = [...new Set([
        ...o.world.events.filter((e) => inTimerTurn(e.seq) && typeof (e.effect as { ts?: unknown } | null)?.ts === 'string').map((e) => (e.effect as { ts: string }).ts),
        ...timerWindows.flatMap((w) => (w.reply_ts ? [w.reply_ts] : [])),
      ])];
      const held = await o.world.expire(n, expiryWindows(turn.expire_turns, windows.map((w) => w.request_ts)), keep);
      o.log(`turn ${n}: expired the windows of turn(s) ${turn.expire_turns.join(', ')} (${held} of ${turn.expire_turns.length} held messages)`);
    }
    if (turn.restart_before) {
      if (!o.harness.restart || !o.restart) return exam(windows, timerWindows, `turn ${n} restarts the harness, and this ${o.harness.kind} harness cannot be restarted here`);
      const t0 = Date.now();
      try { await o.harness.restart(o.restart.graceMs, o.restart.readyTimeoutMs); }
      catch (e) { if (!(e instanceof HarnessGone)) throw e; o.log(`turn ${n}: the restart failed: ${e.message}`); return { ...done('harness_gone', e.message), restart_failure: e.fromDocker ? 'infra' : e.exit === 3 ? 'model' : 'harness' }; }
      week.restarts.push({ before_turn: n, wall_ms: Date.now() - t0 });
      o.log(`turn ${n}: harness restarted on the same workspace and state (${Date.now() - t0} ms)`);
    }

    const actor = o.world.actor(turn.actor);
    let channelId: string;
    let channelName: string;
    let channelType: 'dm' | 'channel';
    if (turn.channel === 'dm') {
      const opened = await o.world.slack(actor.token, 'conversations.open', { users: o.world.botUserId });
      if (!opened.ok) return exam(windows, timerWindows, `turn ${n}: conversations.open for ${turn.actor} with the bot failed: ${opened.error}`);
      const c = opened.channel as { id: string; name?: string };
      channelId = c.id; channelName = c.name ?? `dm:${turn.actor}`; channelType = 'dm';
    } else {
      const c = o.world.channelByName(turn.channel);
      if (!c) return exam(windows, timerWindows, `turn ${n}: channel ${turn.channel} does not exist in the ${o.world.split} split`);
      channelId = c.id; channelName = c.name; channelType = 'channel';
    }
    const burst: NonNullable<TurnRequest['burst']> = [];
    for (const b of turn.burst ?? []) {
      const who = o.world.actor(b.actor ?? turn.actor);
      const p = await o.world.slack(who.token, 'chat.postMessage', { channel: channelId, text: b.text });
      if (!p.ok) return exam(windows, timerWindows, `turn ${n}: posting ${who.member.id}'s burst message to ${channelName} failed: ${p.error}`);
      burst.push({ actor: who.member.id, ts: String(p.ts), text: b.text });
    }
    week.burst_messages += burst.length;
    const posted = await o.world.slack(actor.token, 'chat.postMessage', { channel: channelId, text: turn.text });
    if (!posted.ok) return exam(windows, timerWindows, `turn ${n}: posting ${turn.actor}'s message to ${channelName} failed: ${posted.error}`);
    const ts = String(posted.ts);
    const threadTs = turn.thread === 'new' ? ts : null;
    const simNow = o.world.simNow();
    const req: TurnRequest = {
      turn: (delivery += 1),
      trial_id: o.trialId,
      prompt: composePrompt(o.preamble, {
        requester_name: actor.member.name, requester_handle: actor.member.handle, requester_role: actor.member.role, requester_team: actor.member.team ?? 'no team',
        channel_name: channelType === 'dm' ? `a direct message (channel id ${channelId})` : `#${channelName}`, channel_type: channelType, sim_now: simNow, bot_name: bot.handle,
        message: burst.length ? [...burst.map((b) => `${o.world.actor(b.actor).member.name} (ts ${b.ts}): ${b.text}`), `${actor.member.name} (ts ${ts}): ${turn.text}`].join('\n\n') : turn.text,
        request_ts: ts,
      }),
      actor: { member: actor.member.id, slack_user_id: actor.slack_user_id, name: actor.member.name, role: actor.member.role, team: actor.member.team },
      channel: { id: channelId, name: channelName, type: channelType },
      text: turn.text,
      ts,
      thread_ts: threadTs,
      sim_now: simNow,
      time_budget_s: o.task.time_budget_s,
      ...(burst.length ? { burst } : {}),
    };
    // Under member scope the brain answers this turn as the requester; the setting persists through wait_s
    // until the next turn's bracket, and the trial clears it after the last turn.
    if (o.world.gbrainScoped) await o.world.setGbrainRequester(actor.member.id, channelId);
    // Under live ingestion the actor's message (and everything posted before it) is in the brain before the harness
    // gets the turn; a write the brain refused ends the trial as an exam fault, never a silent gap.
    if (o.world.gbrainLive) {
      const f = await o.world.flushGbrainIngest();
      if (f.failed.length) return ingestFault(o, windows, timerWindows, n, f.failed);
      o.log(`turn ${n}: brain current (${ingestLine(f)} so far)`);
    }
    const started_seq = o.world.lastSeq;
    const started_wall = new Date().toISOString();
    writeRequest(o.turnsDir, req);
    o.harness.notify?.(req);
    o.log(`turn ${n}: ${turn.actor} in ${channelType === 'dm' ? 'DM' : '#' + channelName} (ts ${ts}${threadTs ? ', new thread' : ''}); waiting up to ${o.task.time_budget_s + o.graceS} s`);

    let response: TurnResponse | null;
    let gone: HarnessGone | null = null;
    try { response = await awaitResponse(o.turnsDir, req.turn, (o.task.time_budget_s + o.graceS) * 1000, o.harness); }
    catch (e) { if (!(e instanceof HarnessGone)) throw e; gone = e; response = null; }
    const ended_seq = o.world.lastSeq;
    const ended_wall = new Date().toISOString();

    const base = { turn: n, actor: actor.member.id, slack_user_id: actor.slack_user_id, channel: channelId, channel_name: channelName, channel_type: channelType, text: turn.text, request_ts: ts, started_wall, ended_wall, started_seq, ended_seq,
      thread_ts: threadTs, session_key: threadTs ? `${channelId}:${threadTs}` : channelId, ...(req.turn !== n ? { delivery: req.turn } : {}),
      ...(burst.length ? { burst_ts: burst.map((b) => b.ts) } : {}), ...(turn.restart_before ? { restarted_before: true as const } : {}) };
    if (gone) {
      o.log(`turn ${n}: ${gone.message}`);
      record({ ...base, exit: gone.exit === 3 ? 3 : 2, reply_ts: null, reply_text: null });
      return done('harness_gone', gone.message);
    }
    if (!response) {
      o.log(`turn ${n}: HE-ADAPTER-003 no response after ${o.task.time_budget_s + o.graceS} s; killing the harness, exit 124`);
      await o.harness.kill();
      record({ ...base, exit: 124, reply_ts: null, reply_text: null });
      return done('timeout');
    }
    let exit = Number(response.exit) as TurnWindow['exit'];
    if (!VALID_EXITS.has(exit)) { o.log(`turn ${n}: response exit ${String(response.exit)} is not 0, 2, 3 or 124; recorded as 2`); exit = 2; }
    o.onAnswered?.(req.turn, exit);
    const { reply_ts, reply_text, reply_withheld } = await postReply(response, channelId, channelName, threadTs, started_seq, ended_seq, n);
    record({ ...base, exit, reply_ts, reply_text, ...(reply_withheld ? { reply_withheld } : {}) });
    o.log(`turn ${n}: exit ${exit}${reply_ts ? `, reply ts ${reply_ts}` : reply_withheld === 'bot_posted' ? ', reply withheld: the bot posted in the conversation during the turn' : reply_withheld === 'no_reply' ? ', reply withheld: NOTHING_TO_SAY' : ', no reply'}${response.detail ? ` (${response.detail})` : ''}`);
    // The reply and every post the harness made during the turn are in the brain before the next turn (or the fence).
    if (o.world.gbrainLive) {
      const f = await o.world.flushGbrainIngest();
      if (f.failed.length) return ingestFault(o, windows, timerWindows, n, f.failed);
    }
    if (turn.redeliver) { const ended = await redeliver(req, n); if (ended) return ended; }
    if (turn.wait_s) await Bun.sleep(Number(turn.wait_s) * 1000);
  }
  if (timers && o.task.clock?.end_advance_s) { const ended = await advance(o.task.clock.end_advance_s, o.task.turns.length, 'end'); if (ended) return ended; }
  return done(null);
}

function exam(windows: TurnWindow[], timerWindows: TimerTurnWindow[], message: string): LoopEnd {
  return { windows, timer_windows: timerWindows, ended_early: 'exam_fault', error: new RunnerError('HE-WORLD-001', message).message };
}

type IngestFailure = { channel: string; ts: string; source: string; error?: string };

/** A message the brain did not take ends the trial as HE-GBRAIN-011; the first three failures name the conversation,
 *  the source and the brain's answer. `where` is the turn, or `after the last turn` for the drain after the fence. */
function ingestFaultMessage(where: string, failed: IngestFailure[]): string {
  return new RunnerError('HE-GBRAIN-011', `${where}: ${failed.length} message(s) were not written into the brain (${failed.slice(0, 3).map((x) => x.channel ? `${x.channel}/${x.ts} -> ${x.source}: ${x.error ?? 'error'}` : x.error ?? 'error').join('; ')})`).message;
}

function ingestFault(o: TurnLoopOptions, windows: TurnWindow[], timerWindows: TimerTurnWindow[], turn: number, failed: IngestFailure[]): LoopEnd {
  const error = ingestFaultMessage(`turn ${turn}`, failed);
  o.log(error);
  return { windows, timer_windows: timerWindows, ended_early: 'exam_fault', error };
}

const ingestLine = (f: { written: number; skipped: number }) => `${f.written} message(s) ingested${f.skipped ? `, ${f.skipped} skipped: no source or token` : ''}`;

/** After the fence (which refuses every post) the ingest queue is final; drain it so no write is cut off by the sidecar
 *  stop, then close the queue so nothing lands after the snapshot. A failure on a trial that completed its turns is the exam
 *  fault; a trial that ended early keeps its termination, and the failures stay in the events and the record's counts. Null
 *  when nothing changes. */
export async function flushIngestAfterFence(world: TrialWorld, endedEarly: string | null, log: (line: string) => void): Promise<{ ended_early: 'exam_fault'; error: string } | null> {
  if (!world.gbrainLive) return null;
  const f = await world.flushGbrainIngest();
  world.closeGbrainIngest();
  if (f.failed.length && !endedEarly) {
    const error = ingestFaultMessage('after the last turn', f.failed);
    log(error);
    return { ended_early: 'exam_fault', error };
  }
  log(`brain current after the fence (${ingestLine(f)}${f.failed.length ? `, ${f.failed.length} failed on a trial that ended early (${endedEarly})` : ''})`);
  return null;
}
