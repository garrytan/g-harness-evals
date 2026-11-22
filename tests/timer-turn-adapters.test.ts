// Timer turns, per adapter (harnesses/clock-capabilities.json, docs/adapters.md "Timer turns"). Every adapter the runner may
// hand a timer turn gets the same case through the real runner (runner/trial/run.ts executeRun) and the real metering proxy
// with placeholder keys: one scripted DM turn in which the model sets a 30-minute timer through the world-MCP timer_set
// tool, then [clock] end_advance_s moves the clock an hour, and the runner delivers the timer as a turn of its own. The
// adapter must answer that turn in the session of the turn that set the timer, which each fake model checks by finding the
// first turn's marker in the conversation it is sent, and the reply NOTHING_TO_SAY must leave the conversation untouched.
// The fake harness runs as a host process, always. claude-code, codex, openclaw, hermes and harness-zero run in their
// harness-eval/<name>:dev images on the run's internal network when docker and the image are there (harness-zero builds its
// image from the checkout), and are skipped otherwise, like tests/internal-network-harnesses.test.ts. QM runs as its compose
// stack (Postgres, core, task) on the default bridge, since the runner keeps compose stacks off the internal network
// (HE-NET-001), when harness-eval/qm:dev and qm-sandbox:dev carry pin.json's commit; its fake model calls timer_set through
// QM's mcp_call. Cursor, dsh and pi are not certified for timer turns, and the runner refuses a [clock] timers task on them
// (HE-PREREG-009).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GradeResult, TimerTurnWindow, TrialRecord } from '../runner/contracts.ts';
import { buildManifest, loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { executeRun } from '../runner/trial/run.ts';
import { timerTurnsCertified } from '../runner/trial/task.ts';
import { stream as anthropicStream } from '../scripts/gsta-135/fake-anthropic.ts';
import { startFakeResponses, type FakeResponses, type Turn } from './fixtures/fake-responses.ts';

const ROOT = resolve(import.meta.dir, '..');
const cleanEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const PROXY_ENV = { ...cleanEnv, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };
const docker = (args: string[], timeout = 120_000) => spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv, timeout });
const haveDocker = docker(['info'], 15_000).status === 0;
const haveImage = (h: string) => haveDocker && docker(['image', 'inspect', `harness-eval/${h}:dev`]).status === 0;
const REMINDER = 'A reminder you set';
const mark = (h: string) => `TT-MARK-${h}`;

type Lane = 'claude-code' | 'codex' | 'openclaw' | 'hermes' | 'harness-zero' | 'qm';
const LANES: Record<Lane, { model: string; config?: string; network?: 'internal'; utility_models?: string[] }> = {
  'claude-code': { model: 'anthropic:claude-opus-5-5', network: 'internal' },
  // QM's session-title and other side calls name its shipped Anthropic housekeeping model (harness housekeeping, shipped default).
  qm: { model: 'anthropic:claude-opus-5-5', config: 'pi', utility_models: ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-5-5'] },
  'harness-zero': { model: 'anthropic:claude-opus-5-5', config: 'zero-min', network: 'internal' },
  codex: { model: 'openai:gpt-6-luna', network: 'internal' },
  openclaw: { model: 'openai:gpt-6-luna', network: 'internal' },
  hermes: { model: 'openai:gpt-6-luna', network: 'internal' },
};
const QM_PIN: string = JSON.parse(readFileSync(join(ROOT, 'harnesses', 'qm', 'pin.json'), 'utf8')).commit;
const qmImagesAtPin = () => haveDocker && ['harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev'].every((i) => docker(['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', i]).stdout.trim() === QM_PIN);
const laneOn = (h: Lane) => h === 'harness-zero' ? haveDocker : h === 'qm' ? qmImagesAtPin() : haveImage(h);
const timerArgs = (h: string) => ({ in_minutes: 30, reason: `check back with Dana ${mark(h)}` });

const tmp = mkdtempSync(join(tmpdir(), 'he-timer-adapters-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const stubGrade = (): GradeResult => ({ grade: 'pass', predicates: [{ id: 'stub', kind: 'required', passed: true, evidence: 'stub grader' }], consent_violation: false, approval_stop: false, effects: [] });

/** One run of one cell on a one-turn task with [clock] timers; returns the trial record and its trial directory. */
async function runLane(cell: Cell, text: string, opts: { harnessMode: 'process' | 'docker'; proxyUpstream?: Record<string, string> }) {
  const runId = `tt-${cell.id}-${process.pid}`;
  const dir = join(tmp, runId);
  const tasks = join(dir, 'tasks');
  const taskDir = join(tasks, 'multiuser', 'dev', 'fx-02-timer-turn');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'task.toml'), `id = "fx-02-timer-turn"\nslice = "multiuser"\nsplit = "dev"\ntime_budget_s = 180\nactors = ["dana-okafor"]\n\n[clock]\ntimers = true\nend_advance_s = 3600\n\n[[turns]]\nactor = "dana-okafor"\nchannel = "dm"\ntext = ${JSON.stringify(text)}\n\n[predicates]\nrequired = []\nforbidden_effects = []\n`);
  const prereg: Prereg = { schema_version: 1, run_id: runId, question: 'timer-turn conformance', tasks: {}, cells: [cell], wall_clock_s: { multiuser: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg));
  const { prereg: p, sha256 } = loadPrereg(join(dir, 'prereg.json'));
  const manifest = buildManifest(p, sha256, '2026-11-21T00:00:00Z', { tasksRoot: tasks });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const lines: string[] = [];
  const result = await executeRun(manifest, manifestPath, { harnessMode: opts.harnessMode, grade: stubGrade, proxyEnv: PROXY_ENV, leaseUsd: 5, newLease: true, maxOutputTokens: 128000,
    turnGraceS: 30, stopGraceS: 10, readyTimeoutS: 240, repoRoot: ROOT, log: (l) => lines.push(l), ...(opts.proxyUpstream ? { proxyUpstream: opts.proxyUpstream } : {}) });
  const rec = result.records[0] as TrialRecord;
  const trialDir = rec.paths.dir!;
  const timerTurns = existsSync(join(trialDir, 'timer-turns.jsonl')) ? readFileSync(join(trialDir, 'timer-turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as TimerTurnWindow) : [];
  const events = readFileSync(join(trialDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { actor: string | null; via: string; tool: string; outcome: string });
  const logs = () => ['adapter.log', 'stderr.log', 'docker.log'].map((f) => existsSync(join(trialDir, 'logs', f)) ? readFileSync(join(trialDir, 'logs', f), 'utf8').slice(-2000) : '').join('\n') + lines.slice(-20).join('\n');
  return { rec, timerTurns, events, logs };
}

describe('timer turns on the fake harness (host process)', () => {
  test('the timer turn reaches the session that set it, and runs as that session\'s second turn', async () => {
    const cell: Cell = { id: 'fake', harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(ROOT, 'harnesses', '_fake', 'adapter.sh') };
    const { rec, timerTurns, events, logs } = await runLane(cell, `Please check back with me in 30 minutes.\n[fake:call timer_set ${JSON.stringify(timerArgs('fake'))}]`, { harnessMode: 'process' });
    expect(rec.termination, logs()).toBe('completed');
    expect(rec.timer_turns).toEqual({ run: 1, exits: [0] });
    expect(events.filter((e) => e.tool === 'timer_set').map((e) => [e.actor, e.via, e.outcome])).toEqual([['assistant', 'mcp', 'ok']]);
    expect(events.filter((e) => e.tool === 'timer.fire')).toHaveLength(1);
    const [t] = timerTurns;
    expect(t).toMatchObject({ turn: 2, kind: 'timer', set_in_turn: 1, after_turn: 1, phase: 'end', exit: 0 });
    expect(t!.reply_text).toContain('turn 2 of this session');
    expect(t!.reply_text).toContain(`session dm:dana-okafor`);
    expect(t!.reply_ts).not.toBeNull();
  }, 120_000);
});

/** A fake Anthropic Messages endpoint for the timer case: the first turn's agent request (it declares tools and carries the
 *  marker in its newest user text, with no tool result yet) gets a timer_set tool_use; a request carrying the timer prompt
 *  records whether the marker is in the conversation it was sent and gets NOTHING_TO_SAY; everything else gets "Will do.". */
function fakeAnthropic(seen: Array<{ marker: string; inHistory: boolean }>) {
  let n = 0;
  return Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const body = await req.json().catch(() => ({})) as { model?: string; stream?: boolean; tools?: Array<{ name?: string }>; messages?: Array<{ role: string; content: unknown }> };
    const messages = body.messages ?? [];
    const all = JSON.stringify(messages);
    const tail = JSON.stringify(messages.slice(messages.map((m) => m.role).lastIndexOf('assistant') + 1));
    const agent = Array.isArray(body.tools) && body.tools.length > 0;
    n++;
    const m = tail.match(/TT-MARK-[a-z-]+/);
    let content: Array<Record<string, unknown>> = [{ type: 'text', text: 'Will do.' }];
    if (agent && tail.includes(REMINDER)) {
      const marker = tail.match(/check back with Dana (TT-MARK-[a-z-]+)/)?.[1] ?? '';
      seen.push({ marker, inHistory: all.replace(tail, '').includes(`[tt:set ${marker}]`) });
      content = [{ type: 'text', text: 'NOTHING_TO_SAY' }];
    } else if (agent && m && tail.includes('[tt:set') && !tail.includes('tool_result')) {
      const names = body.tools!.map((t) => t.name ?? '');
      const args = timerArgs(m[0].slice('TT-MARK-'.length));
      // QM lists MCP servers in a ## Connectors note ("- world [<server id>] (...)") and runs their tools through mcp_call.
      const server = JSON.stringify(body).match(/- world \[([^\]]+)\]/)?.[1];
      content = names.includes('mcp_call') && server
        ? [{ type: 'tool_use', id: 'toolu_tt_' + n, name: 'mcp_call', input: { server, tool: 'timer_set', args } }]
        : [{ type: 'tool_use', id: 'toolu_tt_' + n, name: names.find((x) => x.endsWith('timer_set')) ?? 'mcp__world__timer_set', input: args }];
    }
    const stop = content[0]!.type === 'tool_use' ? 'tool_use' : 'end_turn';
    const msg = { id: 'msg_tt_' + n, type: 'message', role: 'assistant', model: String(body.model ?? ''), content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    return new Response(anthropicStream(msg, content, stop), { headers: { 'content-type': 'text/event-stream' } });
  } });
}

describe.skipIf(!(Object.keys(LANES) as Lane[]).some(laneOn))('timer turns on each harness image', () => {
  const seenA: Array<{ marker: string; inHistory: boolean }> = [];
  const seenR: Array<{ marker: string; inHistory: boolean }> = [];
  let fakeA: ReturnType<typeof Bun.serve>;
  let fakeR: FakeResponses;
  beforeAll(() => {
    fakeA = fakeAnthropic(seenA);
    fakeR = startFakeResponses({ log: join(tmp, 'fake-responses.ndjson'), onBody: (body) => {
      const text = JSON.stringify(body);
      if (!text.includes(REMINDER) || !Array.isArray(body.tools) && !text.includes('additional_tools')) return;
      const marker = text.match(/check back with Dana (TT-MARK-[a-z-]+)/)?.[1] ?? '';
      seenR.push({ marker, inHistory: text.includes(`[tt:set ${marker}]`) });
      fakeR.setScript([{ text: 'NOTHING_TO_SAY' }], true);
    } });
  });
  afterAll(() => { fakeA?.stop(true); fakeR?.stop(); });

  for (const h of Object.keys(LANES) as Lane[]) {
    test.skipIf(!laneOn(h))(`${h}: sets the timer through the world MCP and answers its timer turn in the same session`, async () => {
      if (h === 'harness-zero') {
        const build = docker(['build', '-q', '-t', `harness-eval/${h}:dev`, join(ROOT, 'harnesses/harness-zero')], 900_000);
        expect(build.status, build.stderr).toBe(0);
      }
      const lane = LANES[h];
      const args = timerArgs(h);
      const calls: Record<Lane, Turn | null> = {
        'claude-code': null, 'harness-zero': null, qm: null,
        codex: { call: 'mcp__world__timer_set', arguments: args },
        openclaw: { call: 'tool_call', arguments: { id: 'world__timer_set', args } },
        hermes: { call: 'tool_call', arguments: { name: 'mcp__world__timer_set', arguments: args } },
      };
      // The first turn plays the call and then answers "Will do." however many requests the harness sends; the request that
      // carries the timer prompt switches the script to NOTHING_TO_SAY (onBody above runs before the answer).
      if (calls[h]) fakeR.setScript([calls[h]!, ...Array.from({ length: 8 }, () => ({ text: 'Will do.' }))]);
      const cell: Cell = { id: h, harness: h, model: lane.model, slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 200_000, output_tokens: 20_000 }, ...(lane.network ? { network: lane.network } : {}), ...(lane.config ? { config: lane.config } : {}), ...(lane.utility_models ? { utility_models: lane.utility_models } : {}) };
      const seen = lane.model.startsWith('openai:') ? seenR : seenA;
      const before = seen.length;
      const { rec, timerTurns, events, logs } = await runLane(cell, `Please check back with me in 30 minutes. [tt:set ${mark(h)}]`, { harnessMode: 'docker', proxyUpstream: { anthropic: `http://127.0.0.1:${fakeA.port}`, openai: `http://127.0.0.1:${fakeR.port}` } });
      expect(rec.termination, logs()).toBe('completed');
      expect(events.filter((e) => e.tool === 'timer_set').map((e) => [e.actor, e.via, e.outcome]), logs()).toEqual([['assistant', 'mcp', 'ok']]);
      expect(rec.timer_turns, logs()).toEqual({ run: 1, exits: [0] });
      expect(timerTurns[0]).toMatchObject({ kind: 'timer', set_in_turn: 1, reply_withheld: 'no_reply', reply_ts: null });
      const mine = seen.slice(before).filter((s) => s.marker === mark(h));
      expect(mine.length, logs()).toBeGreaterThanOrEqual(1);
      expect(mine.every((s) => s.inHistory), JSON.stringify(mine)).toBe(true);
    }, 900_000);
  }
});
describe('harnesses/clock-capabilities.json', () => {
  test('certifies exactly the fake harness and the lanes this file drives, and lists every adapter', () => {
    const caps = JSON.parse(readFileSync(join(ROOT, 'harnesses/clock-capabilities.json'), 'utf8')) as { harnesses: Record<string, { timer_turns: string }> };
    const certified = Object.keys(caps.harnesses).filter((h) => caps.harnesses[h]!.timer_turns === 'certified').sort();
    expect(certified).toEqual(['_fake', ...Object.keys(LANES)].sort());
    const adapters = ['_fake', 'claude-code', 'codex', 'cursor', 'dsh', 'harness-zero', 'hermes', 'openclaw', 'pi', 'qm'];
    for (const h of adapters) expect(existsSync(join(ROOT, 'harnesses', h, 'adapter.sh'))).toBe(true);
    expect(Object.keys(caps.harnesses).sort()).toEqual(adapters);
    for (const h of adapters) expect(timerTurnsCertified(h)).toBe(certified.includes(h));
    expect(timerTurnsCertified('no-such-harness')).toBe(false);
  });
});
