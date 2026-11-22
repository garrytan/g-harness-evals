// Agent-set timers on the simulation clock (TODOS eng-r2-native-5 and eng-r2-outside-4). No harness's own scheduler follows
// the frozen clock, so a task with [clock] timers gets world-side timers (timer_set, timer_list, timer_cancel) and the runner
// delivers each due timer as a turn of its own before it moves the clock past it: with the clock at the due time, in the
// session of the turn that set it, acknowledged by the adapter's response, fired once however often the clock ticks, kept
// outside the harness so a timer whose turn never answered stays pending for a restarted harness. A world or task without
// [clock] timers is unchanged: same tools, same turn numbering, same records.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TimerTurnWindow, TurnRequest } from '../runner/contracts.ts';
import { evaluatePredicate, loadWorldData } from '../runner/grade/predicates.ts';
import { loadTask as loadGradeTask, parseTask } from '../runner/grade/task.ts';
import { responseFile, writeAtomic, type Harness } from '../runner/trial/harness.ts';
import { loadTask } from '../runner/trial/task.ts';
import { runTurns } from '../runner/trial/turns.ts';
import { TrialWorld } from '../runner/trial/world.ts';
import { TIMER_TOOLS, WORLD_MCP_TOOLS } from '../world/world-mcp/tools.ts';
import { startWorld } from './world-helpers.ts';

const FX = resolve(import.meta.dir, 'fixtures', 'tasks', 'multiuser', 'dev');
const TIMER_FX = resolve(import.meta.dir, 'fixtures', 'timer-tasks');
const TASK = join(TIMER_FX, 'fx-01-timers');

async function mcpTools(url: string, token: string): Promise<{ names: string[]; client: Client }> {
  const client = new Client({ name: 'timers-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return { names: (await client.listTools()).tools.map((t) => t.name).sort(), client };
}

describe('world timers', () => {
  test('without timers the world-MCP surface is exactly as before; with timers it adds the three timer tools', async () => {
    const plain = startWorld('timers-off');
    const on = startWorld('timers-on', 'dev', { timers: true });
    try {
      const off = await mcpTools(plain.url, plain.credentials.bot.token);
      expect(off.names).toEqual([...WORLD_MCP_TOOLS].sort());
      expect(plain.service.snapshot().timers).toBeUndefined();
      const res = await fetch(`${plain.url}/admin/timers`, { headers: { authorization: `Bearer ${plain.credentials.admin_token}` } });
      expect(res.status).toBe(404);
      const with_ = await mcpTools(on.url, on.credentials.bot.token);
      expect(with_.names).toEqual([...WORLD_MCP_TOOLS, ...TIMER_TOOLS].sort());
      await off.client.close();
      await with_.client.close();
    } finally { plain.stop(); on.stop(); }
  });

  test('timer_set checks its arguments; list and cancel see only the caller\'s own timers', async () => {
    const ws = startWorld('timers-args', 'dev', { timers: true });
    try {
      const bot = ws.service.bot!;
      const dana = ws.service.requireMember('dana-okafor');
      const now = ws.clock.nowMs();
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: 'x' })).toThrow('exactly one of at or in_minutes');
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: 'x', in_minutes: 5, at: ws.clock.nowIso() })).toThrow('exactly one');
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: ' ', in_minutes: 5 })).toThrow('reason is required');
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: 'x', at: ws.clock.nowIso() })).toThrow('due after the current simulation time');
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: 'x', at: 'tuesday' })).toThrow('ISO-8601');
      expect(() => ws.service.setTimer(bot, 'mcp', { reason: 'x', at: new Date(now + 3_600_000).toISOString().slice(0, 19) })).toThrow('ISO-8601');
      const t = ws.service.setTimer(bot, 'mcp', { reason: 'check back with Dana', in_minutes: 30, note: 'Harbourline' });
      expect(t).toMatchObject({ status: 'pending', set_by: bot.id, note: 'Harbourline', due_ms: now + 30 * 60_000 });
      const other = ws.service.setTimer(dana, 'mcp', { reason: 'mine', in_minutes: 10 });
      expect(ws.service.listTimers(bot, 'mcp').map((x) => x.id)).toEqual([t.id]);
      expect(() => ws.service.cancelTimer(bot, 'mcp', { id: other.id })).toThrow('no such timer of yours');
      expect(ws.service.cancelTimer(bot, 'mcp', { id: t.id }).status).toBe('cancelled');
      expect(() => ws.service.cancelTimer(bot, 'mcp', { id: t.id })).toThrow('already cancelled');
      expect(ws.service.fireTimer(other.id, 1)?.fired).toBe(true);
      expect(ws.service.fireTimer(other.id, 2)?.fired).toBe(false);
      const tools = ws.log.events.filter((e) => e.tool.startsWith('timer')).map((e) => `${e.tool}:${e.outcome}`);
      expect(tools).toEqual(['timer_set:denied', 'timer_set:denied', 'timer_set:denied', 'timer_set:denied', 'timer_set:denied', 'timer_set:denied', 'timer_set:ok', 'timer_set:ok', 'timer_list:ok', 'timer_cancel:denied', 'timer_cancel:ok', 'timer_cancel:denied', 'timer.fire:ok']);
      expect((ws.service.snapshot().timers as Array<{ status: string }>).map((x) => x.status)).toEqual(['cancelled', 'fired']);
    } finally { ws.stop(); }
  });
});

describe('timer turns', () => {
  // A scripted harness: turn 1 (Dana's DM) sets a 30-minute timer and a 90-minute one; the 30-minute timer's turn sets a
  // 10-minute follow-up (due before the clock move ends, so it fires in the same move) and answers NOTHING_TO_SAY; the follow-up
  // posts in the DM; the 90-minute timer fires at the end, after the last scripted turn, through end_advance_s.
  async function run(opts: { failTimer?: boolean; expireFirst?: boolean } = {}) {
    const tmp = mkdtempSync(join(tmpdir(), 'he-timers-'));
    const turnsDir = join(tmp, 'turns');
    mkdirSync(turnsDir);
    const loaded = loadTask(TASK);
    const task = { ...loaded, ...(opts.failTimer ? { time_budget_s: 1 } : {}), ...(opts.expireFirst ? { turns: loaded.turns.map((t, i) => (i === 2 ? { ...t, expire_turns: [1] } : t)) } : {}) };
    const tw = new TrialWorld({ trialId: 'timers', split: 'dev', actors: task.actors, outDir: tmp, reachableFromContainers: false, timers: true });
    const svc = tw.server.service;
    const bot = svc.bot!;
    const requests: TurnRequest[] = [];
    const answer = async (req: TurnRequest) => {
      requests.push(req);
      let reply = 'Will do.';
      if (req.kind === 'timer' && opts.failTimer) return;
      if (req.turn === 1) { svc.setTimer(bot, 'mcp', { reason: 'check back with Dana about Harbourline', in_minutes: 30 }); svc.setTimer(bot, 'mcp', { reason: 'weekly wrap-up', in_minutes: 90 }); }
      if (req.kind === 'timer' && req.timer!.reason.startsWith('check back')) { svc.setTimer(bot, 'mcp', { reason: 'second nudge', in_minutes: 10 }); reply = 'NOTHING_TO_SAY'; }
      if (req.kind === 'timer' && req.timer!.reason === 'second nudge') reply = 'Dana, any news on Harbourline?';
      if (req.kind === 'timer' && req.timer!.reason === 'weekly wrap-up') reply = 'NOTHING_TO_SAY';
      writeAtomic(join(turnsDir, responseFile(req.turn)), JSON.stringify({ turn: req.turn, exit: 0, reply_text: reply, started_at: 'x', ended_at: 'y' }));
    };
    const harness: Harness = { kind: 'process', waitReady: async () => undefined, exited: async () => null, notify: (req) => { void answer(req); }, stop: async () => undefined, kill: async () => undefined };
    const lines: string[] = [];
    const res = await runTurns({ task, preamble: '{{message}}', world: tw, harness, turnsDir, trialId: 'timers', graceS: 0, log: (l) => lines.push(l) });
    return { tmp, tw, res, requests, lines, turnsDir, start: Date.parse(tw.server.clock.state().reference) };
  }

  test('each due timer is a turn of its own, at its due time, in the session that set it, fired once, NOTHING_TO_SAY not posted', async () => {
    const { tmp, tw, res, requests, lines, turnsDir, start } = await run();
    try {
      expect(res.ended_early).toBeNull();
      expect(requests.map((r) => r.kind === 'timer' ? `T:${r.timer!.reason}` : `S:${r.actor.member}`)).toEqual([
        'S:dana-okafor', 'T:check back with Dana about Harbourline', 'T:second nudge', 'S:ilse-varga', 'S:dana-okafor', 'T:weekly wrap-up',
      ]);
      expect(requests.map((r) => r.turn)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(readFileSync(join(turnsDir, 'turn-0002.request.json'), 'utf8')).toContain('"kind": "timer"');
      const dm = requests[0]!.channel.id;
      for (const r of requests.filter((x) => x.kind === 'timer')) {
        expect(r.channel.id).toBe(dm);
        expect(r.actor.member).toBe('dana-okafor');
        expect(r.ts).toBe(requests[0]!.ts);
        expect(r.prompt).toContain(r.timer!.reason);
        expect(r.prompt).toContain('NOTHING_TO_SAY');
        expect(r.prompt).not.toContain('{{');
      }
      expect(Date.parse(requests[1]!.sim_now)).toBe(start + 30 * 60_000);
      expect(Date.parse(requests[2]!.sim_now)).toBe(start + 40 * 60_000);
      expect(Date.parse(requests[3]!.sim_now)).toBe(start + 3600_000);
      expect(Date.parse(requests[5]!.sim_now)).toBe(start + 90 * 60_000);
      expect(Date.parse(tw.simNow())).toBe(start + 3600_000 + 600_000 + 7200_000);
      expect(res.windows.map((w) => [w.turn, w.delivery])).toEqual([[1, undefined], [2, 4], [3, 5]]);
      const tt = res.timer_windows;
      expect(tt.map((w) => [w.turn, w.after_turn, w.set_in_turn, w.reply_withheld ?? null, w.phase ?? null])).toEqual([
        [2, 1, 1, 'no_reply', null], [3, 1, null, null, null], [6, 3, 1, 'no_reply', 'end'],
      ]);
      expect(tt[1]!.reply_ts).not.toBeNull();
      const onDisk = (f: string) => readFileSync(join(tmp, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as TimerTurnWindow);
      expect(onDisk('turns.jsonl').map((w) => w.turn)).toEqual([1, 2, 3]);
      expect(onDisk('timer-turns.jsonl').map((w) => w.timer_id)).toEqual(tt.map((w) => w.timer_id));
      await tw.fence();
      const snap = await tw.snapshot();
      expect(snap.timers!.map((t) => [t.status, t.fired_turn])).toEqual([['fired', 2], ['fired', 6], ['fired', 3]]);
      expect(tw.events.filter((e) => e.tool === 'timer.fire').length).toBe(3);
      const botTexts = snap.messages.filter((m) => m.author === tw.botMember.id).map((m) => m.text);
      expect(botTexts).toEqual(['Will do.', 'Dana, any news on Harbourline?', 'Will do.', 'Will do.']);
      expect(lines.some((l) => l.startsWith('timer turn 2: exit 0, timer marked fired, reply withheld (no_reply)'))).toBe(true);
    } finally { tw.stop(); rmSync(tmp, { recursive: true, force: true }); }
  });

  test('a timer whose turn never answered stays pending, so a restarted harness gets it on the next clock move', async () => {
    const { tmp, tw, res } = await run({ failTimer: true });
    try {
      expect(res.ended_early).toBe('timeout');
      expect(res.timer_windows).toHaveLength(1);
      expect(res.timer_windows[0]!.exit).toBe(124);
      const pending = await tw.dueTimers(new Date(Date.parse(tw.simNow()) + 3600_000).toISOString());
      expect(pending.map((t) => t.reason)).toEqual(['check back with Dana about Harbourline', 'weekly wrap-up']);
      expect(tw.events.some((e) => e.tool === 'timer.fire')).toBe(false);
    } finally { tw.stop(); rmSync(tmp, { recursive: true, force: true }); }
  });

  test("expire_turns in a timers task hides a scripted turn's messages but never what the agent posted in a timer turn", async () => {
    const { tmp, tw, res, requests, lines } = await run({ expireFirst: true });
    try {
      expect(res.ended_early).toBeNull();
      const dm = requests[0]!.channel.id;
      const history = await tw.slack(tw.actor('dana-okafor').token, 'conversations.history', { channel: dm, limit: '100' });
      const texts = (history.messages as Array<{ text: string }>).map((m) => m.text);
      expect(texts).toContain('Dana, any news on Harbourline?');
      expect(texts).not.toContain(requests[0]!.text);
      expect(texts.filter((t) => t === 'Will do.').length).toBe(1);
      const exp = tw.events.find((e) => e.tool === 'admin.expire')!;
      const nudge = (await tw.snapshot()).messages.find((m) => m.text === 'Dana, any news on Harbourline?')!;
      expect((exp.args as { keep_ts?: string[] }).keep_ts).toContain(nudge.ts);
      expect(lines.some((l) => l.startsWith('turn 3: expired the windows of turn(s) 1'))).toBe(true);
    } finally { tw.stop(); rmSync(tmp, { recursive: true, force: true }); }
  });

  describe('fact_readable_at_ask honours keep_ts and its needed selector', () => {
    // fact[0] is the timer-turn nudge (kept through the turn-1 expiry), fact[1] is Dana's turn-1 ask (expired), fact[2] is
    // Ilse's turn-2 post (never expired). All three are asked at turn 3, after the expiry.
    const gradeTask = parseTask(readFileSync(join(TASK, 'task.toml'), 'utf8')
      .replace('advance_clock_s = 600', 'advance_clock_s = 600\nexpire_turns = [1]')
      .replace('forbidden_effects = []', 'forbidden_effects = []\nsecondary = ["all_readable", "nudge_readable", "ask_readable", "qfl_readable"]') + `
[[predicate]]
id = "all_readable"
kind = "fact_readable_at_ask"

[[predicate]]
id = "nudge_readable"
kind = "fact_readable_at_ask"
needed = [0]

[[predicate]]
id = "ask_readable"
kind = "fact_readable_at_ask"
needed = [1]

[[predicate]]
id = "qfl_readable"
kind = "fact_readable_at_ask"
needed = [2]

[[mechanism.needed]]
turn = 1
pattern = "(?i)any news on Harbourline"
consumer_turn = 3

[[mechanism.needed]]
turn = 1
pattern = "(?i)check back with me in 30 minutes"
consumer_turn = 3

[[mechanism.needed]]
turn = 2
pattern = "(?i)QFL thread"
consumer_turn = 3
`);
    async function grade() {
      const { tmp, tw, res } = await run({ expireFirst: true });
      try {
        await tw.fence();
        const ctx = { task: gradeTask, world: loadWorldData(tw.worldPath, 'dev'), bot: tw.botMember.id, evidence: { trial_id: 'timers', task_dir: TASK, split: 'dev' as const, world_path: tw.worldPath, bot_member: tw.botMember.id, snapshot: await tw.snapshot(), events: tw.events, turns: res.windows, timer_turns: res.timer_windows } };
        const by = async (id: string) => evaluatePredicate(ctx, gradeTask.predicate.find((p) => p.id === id)!);
        const nudgeTs = ctx.evidence.snapshot.messages.find((m) => m.text === 'Dana, any news on Harbourline?')!.ts;
        return { nudgeTs, all: await by('all_readable'), nudge: await by('nudge_readable'), ask: await by('ask_readable'), qfl: await by('qfl_readable') };
      } finally { tw.stop(); rmSync(tmp, { recursive: true, force: true }); }
    }

    test('a timer-turn post carrying the fact makes the partner fire', async () => {
      const { nudgeTs, nudge } = await grade();
      expect(nudge.passed).toBe(false);
      expect(nudge.evidence).toContain(`fact[0] readable at turn 3 in message ts=${nudgeTs}`);
    });

    test('the same fact in an expired scripted turn does not', async () => {
      const { ask } = await grade();
      expect(ask.passed).toBe(true);
      expect(ask.evidence).toStartWith('1 needed fact(s) not readable');
    });

    test('a needed selector reports only its own fact', async () => {
      const { all, nudge, qfl } = await grade();
      expect(all.passed).toBe(false);
      expect(all.evidence).toContain('fact[0] readable');
      expect(all.evidence).toContain('fact[2] readable');
      expect(all.evidence).not.toContain('fact[1]');
      expect(nudge.evidence).not.toContain('fact[2]');
      expect(qfl.passed).toBe(false);
      expect(qfl.evidence).toContain('fact[2] readable');
      expect(qfl.evidence).not.toContain('fact[0]');
      expect(() => parseTask(readFileSync(join(TASK, 'task.toml'), 'utf8').replace('forbidden_effects = []', 'forbidden_effects = []\nsecondary = ["x"]') + '\n[[predicate]]\nid = "x"\nkind = "fact_readable_at_ask"\nneeded = [1]\n\n[[mechanism.needed]]\nturn = 1\npattern = "x"\nconsumer_turn = 3\n')).toThrow('needed = 1 but [[mechanism.needed]] has 1 fact(s)');
    });
  });

  test('both task loaders accept [clock] timers, also beside expire_turns, and refuse timers = false', () => {
    expect(loadTask(TASK).clock).toEqual({ timers: true, end_advance_s: 7200 });
    expect(loadGradeTask(TASK).clock).toEqual({ timers: true, end_advance_s: 7200 });
    const tmp = mkdtempSync(join(tmpdir(), 'he-timers-task-'));
    try {
      const base = readFileSync(join(TASK, 'task.toml'), 'utf8');
      const bad = (name: string, text: string) => { const d = join(tmp, name); mkdirSync(d); writeFileSync(join(d, 'task.toml'), text); return d; };
      const off = bad('off', base.replace('timers = true', 'timers = false'));
      expect(() => loadTask(off)).toThrow('clock.timers');
      expect(() => loadGradeTask(off)).toThrow();
      const exp = join(tmp, 'exp', 'fx-01-timers');
      mkdirSync(exp, { recursive: true });
      writeFileSync(join(exp, 'task.toml'), base.replace('advance_clock_s = 600', 'advance_clock_s = 600\nexpire_turns = [1]'));
      expect(loadTask(exp).turns.some((t) => t.expire_turns?.[0] === 1)).toBe(true);
      expect(loadGradeTask(exp).turns.some((t) => t.expire_turns?.[0] === 1)).toBe(true);
      expect(existsSync(join(FX, 'fx-leak', 'task.toml'))).toBe(true);
      expect(loadTask(join(FX, 'fx-leak')).clock).toBeUndefined();
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
