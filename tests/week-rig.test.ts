// Week events (docs/tasks.md, "Week events"): restart_before, burst and redeliver on [clock] timers tasks. Keyless. The fake
// harness (a host process) shows the turn loop delivers each event and that the harness's state survives the restart. When
// their images are present, a restart lane per pilot harness (claude-code, qm) shows the adapter resumes its session after the
// harness starts again (skipped otherwise, like the image lanes elsewhere). These cases start the metering proxy, so
// scripts/run-tests.sh runs this file in its one-at-a-time proxy phase; the scripted week tasks, which start none, are in
// tests/week-tasks.test.ts.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedeliveryTurnWindow, TimerTurnWindow, TurnRequest, TurnWindow } from '../runner/contracts.ts';
import type { Cell } from '../runner/run.ts';
import { countFiles } from '../runner/trial/trial.ts';
import { stream as anthropicStream } from '../scripts/gsta-135/fake-anthropic.ts';
import { cleanEnv, ROOT, runWeek } from './helpers/week-run.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-week-rig-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const jsonl = <T>(path: string): T[] => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];

describe('week events on the fake harness (host process)', () => {
  test('a timer turn, a burst handed again as a retry, and a restart that keeps the harness state', async () => {
    const taskRoot = join(tmp, 'fake-tasks');
    const taskDir = join(taskRoot, 'multiuser', 'dev', 'fx-04-week-fake');
    mkdirSync(taskDir, { recursive: true });
    const timer = JSON.stringify({ in_minutes: 30, reason: 'check back with Dana' });
    writeFileSync(join(taskDir, 'task.toml'), [
      'id = "fx-04-week-fake"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 20', 'actors = ["dana-okafor", "ilse-varga"]', '', '[clock]', 'timers = true', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', `text = ${JSON.stringify(`Check back with me in 30 minutes.\n[fake:call timer_set ${timer}]`)}`, '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', 'text = "Third message."', 'burst = [{ text = "First message." }, { text = "Second message." }]', 'redeliver = true', 'advance_clock_s = 3600', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', 'text = "Still there?"', 'restart_before = true', '',
      '[predicates]', 'required = []', 'forbidden_effects = []', '',
    ].join('\n'));
    const cell: Cell = { id: 'fake', harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(ROOT, 'harnesses', '_fake', 'adapter.sh') };
    const { records, lines } = await runWeek(tmp, [cell], taskRoot, () => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] }));
    const rec = records[0]!;
    const dir = rec.paths.dir!;
    expect(rec.termination, lines.slice(-15).join('\n')).toBe('completed');
    expect(rec.timer_turns).toEqual({ run: 1, exits: [0] });
    expect(rec.week).toMatchObject({ redeliveries: { run: 1, exits: [0] }, burst_messages: 2, timers_set: 1, memory_files: 0 });
    expect(rec.week!.restarts.map((r) => r.before_turn)).toEqual([3]);

    const turns = jsonl<TurnWindow>(join(dir, 'turns.jsonl'));
    expect(turns.map((t) => [t.turn, t.delivery ?? t.turn])).toEqual([[1, 1], [2, 3], [3, 5]]);
    expect(turns[1]!.burst_ts).toHaveLength(2);
    expect(turns[2]!.restarted_before).toBe(true);
    const burstReq = JSON.parse(readFileSync(join(dir, 'turns', 'turn-0003.request.json'), 'utf8')) as TurnRequest;
    expect(burstReq.burst!.map((b) => b.text)).toEqual(['First message.', 'Second message.']);
    expect(burstReq.prompt).toMatch(/First message\.[\s\S]*Second message\.[\s\S]*Third message\./);
    const again = JSON.parse(readFileSync(join(dir, 'turns', 'turn-0004.request.json'), 'utf8')) as TurnRequest;
    expect(again).toMatchObject({ retry_attempt: 1, ts: burstReq.ts, text: burstReq.text, prompt: burstReq.prompt });
    const redelivered = jsonl<RedeliveryTurnWindow>(join(dir, 'redelivery-turns.jsonl'));
    expect(redelivered).toMatchObject([{ turn: 4, kind: 'redelivery', of_turn: 2, retry_attempt: 1, exit: 0 }]);

    // The restart moved the old ready file aside and the new start wrote its own; the fake's per-session count lives in its
    // state directory, so the turn after the restart is still the fifth of Dana's DM session (two turns, a timer, a retry).
    expect(existsSync(join(dir, 'logs', 'ready.before-restart-1'))).toBe(true);
    expect(existsSync(join(dir, 'logs', 'ready'))).toBe(true);
    expect(turns[2]!.reply_text).toContain('turn 5 of this session');
  }, 120_000);

  test('a timer set while answering a redelivered request fires as a timer turn in that conversation', async () => {
    const taskRoot = join(tmp, 'fake-tasks-retry-timer');
    const taskDir = join(taskRoot, 'multiuser', 'dev', 'fx-05-week-retry-timer');
    mkdirSync(taskDir, { recursive: true });
    const timer = JSON.stringify({ in_minutes: 30, reason: 'check back with Dana' });
    writeFileSync(join(taskDir, 'task.toml'), [
      'id = "fx-05-week-retry-timer"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 20', 'actors = ["dana-okafor", "ilse-varga"]', '', '[clock]', 'timers = true', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', `text = ${JSON.stringify(`Check back with me in 30 minutes.\n[fake:call timer_set ${timer}]`)}`, 'redeliver = true', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', 'text = "Still there?"', 'advance_clock_s = 3600', '',
      '[predicates]', 'required = []', 'forbidden_effects = []', '',
    ].join('\n'));
    const cell: Cell = { id: 'fake', harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(ROOT, 'harnesses', '_fake', 'adapter.sh') };
    const { records, lines } = await runWeek(tmp, [cell], taskRoot, () => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] }));
    const rec = records[0]!;
    expect(rec.termination, rec.error ?? lines.slice(-15).join('\n')).toBe('completed');
    expect(rec.week).toMatchObject({ redeliveries: { run: 1, exits: [0] }, timers_set: 2 });
    expect(rec.timer_turns).toEqual({ run: 2, exits: [0, 0] });
    const fired = jsonl<TimerTurnWindow>(join(rec.paths.dir!, 'timer-turns.jsonl'));
    expect(fired.map((w) => [w.set_in_turn, w.channel_type])).toEqual([[1, 'dm'], [1, 'dm']]);
  }, 120_000);
});

describe('countFiles (the record\'s week.memory_files)', () => {
  test('counts files under a directory, and reads 0 for a missing path or a memory path that is a file, without throwing', () => {
    const root = join(tmp, 'count-files');
    mkdirSync(join(root, 'dir', 'notes'), { recursive: true });
    writeFileSync(join(root, 'dir', 'a.md'), 'a');
    writeFileSync(join(root, 'dir', 'notes', 'b.md'), 'b');
    writeFileSync(join(root, 'memory'), 'an agent wrote a file where the memory directory goes');
    expect(countFiles(join(root, 'dir'))).toBe(2);
    expect(countFiles(join(root, 'missing'))).toBe(0);
    expect(countFiles(join(root, 'memory'))).toBe(0);
  });
});

/** A fake Anthropic endpoint for the restart lane: an agent request (it declares tools) whose newest user text asks for the
 *  word answers with the marker only when the marker is in the conversation it was sent, so the reply shows whether the
 *  harness resumed its session after the restart. */
function fakeRecall(seen: boolean[]) {
  let n = 0;
  return Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const body = await req.json().catch(() => ({})) as { model?: string; stream?: boolean; tools?: unknown[]; messages?: Array<{ role: string; content: unknown }> };
    const messages = body.messages ?? [];
    const tail = JSON.stringify(messages.slice(messages.map((m) => m.role).lastIndexOf('assistant') + 1));
    const earlier = JSON.stringify(messages).replace(tail, '');
    n++;
    let text = 'Noted.';
    if (Array.isArray(body.tools) && body.tools.length && tail.includes('What was the word')) {
      const resumed = earlier.includes('RS-MARK-7731');
      seen.push(resumed);
      text = resumed ? 'The word was RS-MARK-7731.' : 'I do not know which word.';
    }
    const content = [{ type: 'text', text }];
    const msg = { id: 'msg_rs_' + n, type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    return new Response(anthropicStream(msg, content, 'end_turn'), { headers: { 'content-type': 'text/event-stream' } });
  } });
}

const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv, timeout });
const haveDocker = docker(['info'], 15_000).status === 0;
const QM_PIN: string = JSON.parse(readFileSync(join(ROOT, 'harnesses', 'qm', 'pin.json'), 'utf8')).commit;
const label = (image: string) => docker(['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', image]).stdout.trim();
/** The two harnesses the always-on pilot runs. QM's compose stack stays on the default bridge (HE-NET-001) and lists its
 *  shipped housekeeping model (harness housekeeping, shipped default). */
const RESTART_LANES: Record<string, { on: boolean; cell: Partial<Cell> }> = {
  'claude-code': { on: haveDocker && docker(['image', 'inspect', 'harness-eval/claude-code:dev']).status === 0, cell: { network: 'internal' } },
  qm: { on: haveDocker && ['harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev'].every((i) => label(i) === QM_PIN), cell: { config: 'pi', utility_models: ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-5-5'] } },
};

describe.skipIf(!Object.values(RESTART_LANES).some((l) => l.on))('a restart on each pilot harness image', () => {
  for (const [h, lane] of Object.entries(RESTART_LANES)) {
    test.skipIf(!lane.on)(`${h}: the harness starts again, and the turn after it still runs in the session that heard the marker`, async () => {
      const seen: boolean[] = [];
      const fake = fakeRecall(seen);
      try {
        const taskRoot = join(tmp, `restart-tasks-${h}`);
        const taskDir = join(taskRoot, 'multiuser', 'dev', 'fx-05-restart');
        mkdirSync(taskDir, { recursive: true });
        writeFileSync(join(taskDir, 'task.toml'), [
          'id = "fx-05-restart"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 180', 'actors = ["dana-okafor"]', '', '[clock]', 'timers = true', '',
          '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', 'text = "Please remember the word RS-MARK-7731."', '',
          '[[turns]]', 'actor = "dana-okafor"', 'channel = "dm"', 'text = "What was the word I gave you?"', 'restart_before = true', '',
          '[predicates]', 'required = []', 'forbidden_effects = []', '',
        ].join('\n'));
        const cell: Cell = { id: h, harness: h, model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 200_000, output_tokens: 20_000 }, ...lane.cell };
        const { records, lines } = await runWeek(tmp, [cell], taskRoot, () => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] }),
          { harnessMode: 'docker', leaseUsd: 5, maxOutputTokens: 128000, readyTimeoutS: 300, turnGraceS: 30, stopGraceS: 10, proxyUpstream: { anthropic: `http://127.0.0.1:${fake.port}` } });
        const rec = records[0]!;
        const dir = rec.paths.dir!;
        expect(rec.termination, lines.slice(-20).join('\n')).toBe('completed');
        expect(rec.week!.restarts.map((r) => r.before_turn)).toEqual([2]);
        expect(existsSync(join(dir, 'logs', 'docker.before-restart-1.log'))).toBe(true);
        const turns = jsonl<TurnWindow>(join(dir, 'turns.jsonl'));
        expect(seen, lines.slice(-20).join('\n')).toEqual([true]);
        expect(turns[1]!.reply_text).toContain('RS-MARK-7731');
      } finally { fake.stop(true); }
    }, 900_000);
  }
});
