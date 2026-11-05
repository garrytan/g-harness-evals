// Harness Zero serve, keyless, at the process level: the file queue, the ready record, MCP over JSON and SSE with
// sessions, initialize instructions, an expired session and a lost write, sessions per conversation and per thread,
// scoped notes, the output cap, prompt caching after a tool_search load, the turn budget, SIGTERM, telemetry, and that no
// credential lands in any file.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateHash, resolveSet } from '../harnesses/harness-zero/zero.ts';
import { adapterLog, files, spawnServe, startFakeMcp, startFakeModel, startProxy, trial, turn, turnLines, UPSTREAM_KEY, waitFor, zeroEnv, type FakeModel } from './fixtures/harness-zero-fakes.ts';

const WORLD_TOKEN = 'world-bot-token-serve-0000000001';
const GBRAIN_TOKEN = 'gbrain-bot-token-serve-000000002';
const MODEL = 'claude-opus-5-5';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sys = (s: { body: any }) => s.body.system[0].text as string;

async function serving(set: string, o: { fake?: FakeModel; baseUrl?: string; token?: string; sse?: boolean; hold?: boolean; extra?: Record<string, string> } = {}) {
  const t = trial('');
  const fake = o.fake ?? startFakeModel(MODEL);
  const world = startFakeMcp({ token: WORLD_TOKEN, sessions: true, instructions: 'World instructions: post in threads.', sse: o.sse, hold: o.hold });
  const gbrain = startFakeMcp({ token: GBRAIN_TOKEN, sessions: true, sse: true, instructions: 'Brain instructions.' });
  const env = zeroEnv(t, { baseUrl: o.baseUrl ?? fake.url + '/slot/anthropic', token: o.token ?? 'trial-token:zero-serve.00000000000000000000000000000000', name: MODEL },
    { HE_HARNESS_CONFIG: set, HE_WORLD_MCP_URL: world.url, HE_WORLD_MCP_TOKEN: WORLD_TOKEN, HE_GBRAIN_MCP_URL: gbrain.url, HE_GBRAIN_MCP_TOKEN: GBRAIN_TOKEN, ...o.extra });
  const proc = spawnServe(env);
  await waitFor(() => existsSync(join(t.logs, 'ready')) || proc.exitCode !== null, 15_000, 'ready');
  const stop = async () => { proc.kill('SIGTERM'); const code = await proc.exited; fake.stop(); world.stop(); gbrain.stop(); return code; };
  return { t, fake, world, gbrain, proc, env, stop };
}

describe('harness-zero serve', () => {
  test('ready record, MCP over JSON and SSE with sessions and paging, per-conversation and per-thread sessions, hashed file names, no credential in any file', async () => {
    const fake = startFakeModel(MODEL);
    const root = trial('');
    const proxy = await startProxy(root.dir, fake.url, ['anthropic:' + MODEL]);
    const { baseUrl, token } = await proxy.bind('zero-serve-main', 'anthropic', ['anthropic:' + MODEL]);
    const s = await serving('zero-full', { fake, baseUrl, token, extra: { HE_TRIAL_ID: 'zero-serve-main' } });
    try {
      const ready = JSON.parse(readFileSync(join(s.t.logs, 'ready'), 'utf8'));
      expect(ready).toMatchObject({ harness: 'harness-zero', trial: 'zero-serve-main', config: 'zero-full', candidate_sha256: candidateHash(resolveSet('zero-full')).candidate_sha256,
        wire: 'anthropic', model: MODEL, mcp_servers: 'world gbrain', adapter_sha256: null });
      expect(ready.features).toEqual(resolveSet('zero-full').features);
      expect(ready.knobs).toEqual(resolveSet('zero-full').knobs);
      expect(ready.candidate_inputs).toEqual(candidateHash(resolveSet('zero-full')).inputs);
      for (const m of [s.world, s.gbrain]) expect(m.state.methods.slice(0, 4)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);

      fake.script.push({ calls: [{ name: 'call_tool', args: { name: 'mcp__world__read_notes', arguments: {} } }] }, { text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' });
      expect(await turn(s.t, { prompt: 'First from Dana.' })).toMatchObject({ exit: 0, reply_text: 'one' });
      expect(s.world.calls.at(-1)).toMatchObject({ tool: 'read_notes', session: 'sess-1' });
      const first = fake.seen.filter((x) => x.wire === 'anthropic')[0]!;
      expect(sys(first)).toContain('World instructions: post in threads.');
      expect(sys(first)).toContain('Brain instructions.');
      expect(first.body.tools.map((x: any) => x.name)).toEqual(['tool_search', 'call_tool', 'save_note']);
      expect(await turn(s.t, { prompt: 'In the channel.', channel: { id: 'C1', type: 'channel' }, member: 'ben-ito' })).toMatchObject({ exit: 0, reply_text: 'two' });
      expect(await turn(s.t, { prompt: 'Dana again.' })).toMatchObject({ exit: 0, reply_text: 'three' });
      const third = fake.seen.at(-1)!;
      expect(JSON.stringify(third.body.messages)).toContain('First from Dana.');
      expect(JSON.stringify(third.body.messages)).not.toContain('In the channel.');
      expect(await turn(s.t, { prompt: 'Dana in a new thread.', thread_ts: '1700000000.000100' })).toMatchObject({ exit: 0, reply_text: 'four' });
      expect(fake.seen.at(-1)!.body.messages).toHaveLength(1);
      const keys = ['dm:dana-okafor', 'channel:C1', 'dm:dana-okafor:t1700000000.000100'];
      expect(readdirSync(join(s.t.state, 'zero/sessions')).sort()).toEqual(keys.map((k) => sha(k) + '.json').sort());
      expect(turnLines(s.t).map((l) => l.new_session)).toEqual([true, true, false, true]);
      expect(readdirSync(s.t.turns).filter((f) => f.endsWith('.tmp'))).toEqual([]);
      expect(await s.stop()).toBe(0);
      for (const f of files(s.t.dir)) for (const secret of [token, WORLD_TOKEN, GBRAIN_TOKEN, UPSTREAM_KEY]) expect(f.text.includes(secret), f.path).toBe(false);
    } finally { await s.stop(); await proxy.stop(); }
  }, 60_000);

  test('scoped notes: saved in a DM, shown at the start of a new thread session there, never in another scope', async () => {
    const s = await serving('zero-full');
    try {
      s.fake.script.push({ calls: [{ name: 'save_note', args: { text: 'Dana prefers Tuesday reviews' } }] }, { text: 'saved' }, { text: 'a' }, { text: 'b' }, { text: 'c' });
      expect(await turn(s.t, { prompt: 'Remember I like Tuesdays.' })).toMatchObject({ exit: 0, reply_text: 'saved' });
      await turn(s.t, { prompt: 'New thread.', thread_ts: '17.1' });
      const inThread = s.fake.seen.at(-1)!;
      await turn(s.t, { prompt: 'Channel.', channel: { id: 'C9', type: 'channel' } });
      const inChannel = s.fake.seen.at(-1)!;
      await turn(s.t, { prompt: 'Ben here.', member: 'ben-ito' });
      const inBen = s.fake.seen.at(-1)!;
      expect(sys(inThread)).toContain('Notes you saved earlier in this conversation:\n- Dana prefers Tuesday reviews');
      expect(sys(inChannel)).not.toContain('Tuesday');
      expect(sys(inBen)).not.toContain('Tuesday');
      expect(turnLines(s.t).map((l) => [l.notes_written, l.notes_shown])).toEqual([[1, 0], [0, 1], [0, 0], [0, 0]]);
      expect(readdirSync(join(s.t.state, 'zero/notes'))).toEqual([sha('dm:dana-okafor') + '.json']);
    } finally { await s.stop(); }
  }, 30_000);

  test('caching with tool-search: a tool load keeps the cached prefix, so the next request reads it; without caching nothing is read', async () => {
    for (const [set, cached] of [['zero-full', true], ['zero-full-no-caching', false]] as const) {
      const s = await serving(set);
      try {
        s.fake.script.push({ calls: [{ name: 'tool_search', args: { query: 'post message' } }] }, { calls: [{ name: 'call_tool', args: { name: 'mcp__world__post_message', arguments: { channel: 'C1', text: 'hi' } } }] }, { text: 'posted' });
        expect(await turn(s.t, { prompt: 'Post hi to C1.' })).toMatchObject({ exit: 0, reply_text: 'posted' });
        const [r1, r2, r3] = s.fake.seen.filter((x) => x.wire === 'anthropic');
        expect(JSON.stringify(r2!.body.tools)).toBe(JSON.stringify(r1!.body.tools));
        expect(JSON.stringify(r2!.body.messages)).toContain('mcp__world__post_message');
        if (cached) {
          expect(r1!.cacheRead).toBe(0);
          expect(r2!.cacheRead).toBeGreaterThan(JSON.stringify(r1!.body.system).length);
          expect(r3!.cacheRead).toBeGreaterThan(r2!.cacheRead);
        } else expect([r1!.cacheRead, r2!.cacheRead, r3!.cacheRead]).toEqual([0, 0, 0]);
        expect(s.world.calls.map((c) => c.tool)).toEqual(['post_message']);
      } finally { await s.stop(); }
    }
  }, 30_000);

  test('output-cap cuts a long tool result with a marker; without it the result goes whole', async () => {
    for (const [set, max] of [['zero-full-no-tool-search', 9000], ['zero-min', 25000]] as const) {
      const s = await serving(set);
      try {
        s.fake.script.push({ calls: [{ name: 'mcp__world__big_dump' }] }, { text: 'ok' });
        await turn(s.t, { prompt: 'Dump it.' });
        const result = JSON.stringify(s.fake.seen.at(-1)!.body.messages.at(-1).content[0].content);
        expect(result.length).toBeLessThan(max);
        expect(result.includes('[harness-zero output-cap: cut 12000 of 20000 bytes]')).toBe(set !== 'zero-min');
      } finally { await s.stop(); }
    }
  }, 30_000);

  test('an expired MCP session: re-initialized once, a read sent again, a write not; a lost write is an unknown outcome and never replayed', async () => {
    const s = await serving('zero-min', { sse: true });
    try {
      s.fake.script.push({ calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'read' });
      s.world.state.expireNext = true;
      expect(await turn(s.t, { prompt: 'Read.' })).toMatchObject({ exit: 0 });
      expect(s.world.state.initialized).toBe(2);
      expect(s.world.calls.map((c) => [c.tool, c.session])).toEqual([['read_notes', 'sess-2']]);
      expect(turnLines(s.t).at(-1).tool_calls).toEqual([{ tool: 'mcp__world__read_notes', status: 'ok' }]);

      s.fake.script.push({ calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'x' } }] }, { text: 'tried' });
      s.world.state.expireNext = true;
      expect(await turn(s.t, { prompt: 'Post.' })).toMatchObject({ exit: 0 });
      expect(s.world.calls.filter((c) => c.tool === 'post_message')).toEqual([]);
      expect(JSON.stringify(s.fake.seen.at(-1)!.body.messages.at(-1))).toContain('so it did not run');

      s.fake.script.push({ calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'once' } }] }, { text: 'unknown' });
      s.world.state.loseNextWrite = true;
      expect(await turn(s.t, { prompt: 'Post once.' })).toMatchObject({ exit: 0, reply_text: 'unknown' });
      expect(s.world.calls.filter((c) => c.tool === 'post_message').map((c) => [c.args.text, c.answered])).toEqual([['once', false]]);
      const told = s.fake.seen.at(-1)!.body.messages.at(-1).content[0];
      expect(told).toMatchObject({ is_error: true });
      expect(told.content).toContain('The outcome is unknown');
      expect(turnLines(s.t).at(-1).tool_outcomes).toEqual({ ok: 0, error: 0, unknown: 1 });

      s.fake.script.push({ calls: [{ name: 'mcp__world__post_message', args: { channel: 'nope', text: 'rejected' } }] }, { text: 'rejected' });
      s.world.state.rpcErrorNext = true;
      expect(await turn(s.t, { prompt: 'Post to a bad channel.' })).toMatchObject({ exit: 0, reply_text: 'rejected' });
      expect(s.world.calls.filter((c) => c.args?.text === 'rejected')).toHaveLength(1);
      const refused = s.fake.seen.at(-1)!.body.messages.at(-1).content[0];
      expect(refused).toMatchObject({ is_error: true });
      expect(refused.content).toContain('error -32602: bad channel');
      expect(refused.content).not.toContain('The outcome is unknown');
      expect(turnLines(s.t).at(-1).tool_outcomes).toEqual({ ok: 0, error: 1, unknown: 0 });

      s.fake.script.splice(0, s.fake.script.length, { calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'kept' } }] }, { hang: true });
      expect(await turn(s.t, { prompt: 'Post, then stall.', budget: 2 })).toMatchObject({ exit: 124, reply_text: null });
      s.fake.script.splice(0, s.fake.script.length, { text: 'already posted' });
      expect(await turn(s.t, { prompt: 'Did it post?' })).toMatchObject({ exit: 0, reply_text: 'already posted' });
      expect(s.fake.seen.at(-1)!.violation).toBeUndefined();
      expect(JSON.stringify(s.fake.seen.at(-1)!.body.messages)).toContain('posted: kept');

      s.fake.script.splice(0, s.fake.script.length, { calls: [{ name: 'mcp__world__read_notes' }] });
      s.world.state.expireNext = true;
      s.world.state.failInit = true;
      expect(await turn(s.t, { prompt: 'Read again.' })).toMatchObject({ exit: 2, reply_text: null, detail: expect.stringContaining('HE-ZERO-005 MCP server world session expired and re-initialize failed') });

      s.fake.script.splice(0, s.fake.script.length, { calls: [{ name: 'mcp__world__read_notes' }] });
      expect(await turn(s.t, { prompt: 'Still down?' })).toMatchObject({ exit: 2, reply_text: null, detail: expect.stringContaining('HE-ZERO-005 MCP server world is still down after a failed re-initialize') });
      s.world.state.failInit = false;
      const before = s.world.calls.length;
      s.fake.script.splice(0, s.fake.script.length, { calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'back' });
      expect(await turn(s.t, { prompt: 'Back up?' })).toMatchObject({ exit: 0, reply_text: 'back' });
      expect(s.world.calls.slice(before).map((c) => c.tool)).toEqual(['read_notes']);
      expect(turnLines(s.t).at(-1).tool_outcomes).toEqual({ ok: 1, error: 0, unknown: 0 });
    } finally { await s.stop(); }
  }, 30_000);

  test('a hanging tool stops at the per-call limit inside the turn budget; a re-initialize reloads the tool list; a malformed request file is exit 2 and serving goes on', async () => {
    const s = await serving('zero-min');
    try {
      s.world.state.hang = 'read_notes';
      s.fake.script.push({ calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'gave up' });
      const began = Date.now();
      expect(await turn(s.t, { prompt: 'Read.', budget: 4 })).toMatchObject({ exit: 0, reply_text: 'gave up' });
      expect(Date.now() - began).toBeLessThan(4_000);
      expect(JSON.stringify(s.fake.seen.at(-1)!.body.messages.at(-1))).toContain('did not answer before the per-call time limit, so it was stopped and not sent again');
      expect(s.world.calls.filter((c) => c.tool === 'read_notes')).toHaveLength(1);
      expect(turnLines(s.t).at(-1).tool_outcomes).toEqual({ ok: 0, error: 1, unknown: 0 });

      s.world.state.hang = 'post_message';
      s.fake.script.push({ calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'slow' } }] }, { text: 'unsure' });
      expect(await turn(s.t, { prompt: 'Post.', budget: 4 })).toMatchObject({ exit: 0, reply_text: 'unsure' });
      expect(JSON.stringify(s.fake.seen.at(-1)!.body.messages.at(-1))).toContain('The outcome is unknown');
      expect(s.world.calls.filter((c) => c.tool === 'post_message')).toHaveLength(1);
      expect(turnLines(s.t).at(-1).tool_outcomes).toEqual({ ok: 0, error: 0, unknown: 1 });
      s.world.state.hang = null;

      const names = (i: number) => s.fake.seen.at(i)!.body.tools.map((x: { name: string }) => x.name);
      s.world.state.addTool = true;
      s.world.state.expireNext = true;
      s.fake.script.push({ calls: [{ name: 'mcp__world__read_notes' }] }, { calls: [{ name: 'mcp__world__new_tool' }] }, { text: 'new' });
      expect(await turn(s.t, { prompt: 'Restart.' })).toMatchObject({ exit: 0, reply_text: 'new' });
      expect(names(-3)).not.toContain('mcp__world__new_tool');
      expect(names(-2)).toContain('mcp__world__new_tool');
      expect(s.world.calls.at(-1)!.tool).toBe('new_tool');
      expect(adapterLog(s.t)).toContain('re-initialized with 5 tools');

      const put = (name: string, body: string) => { writeFileSync(join(s.t.turns, name + '.tmp'), body); renameSync(join(s.t.turns, name + '.tmp'), join(s.t.turns, name)); };
      const answer = async (name: string) => { await waitFor(() => existsSync(join(s.t.turns, name)), 10_000, name); return JSON.parse(readFileSync(join(s.t.turns, name), 'utf8')); };
      put('turn-0900.request.json', '{"turn": 900, "prompt"');
      expect(await answer('turn-0900.response.json')).toMatchObject({ turn: 900, exit: 2, reply_text: null, detail: expect.stringContaining('HE-ZERO-009 turn-0900.request.json is not JSON') });
      put('turn-0901.request.json', JSON.stringify({ turn: 901, prompt: 'Hi.', channel: { id: 'D1', type: 'dm' } }));
      expect(await answer('turn-0901.response.json')).toMatchObject({ turn: 901, exit: 2, reply_text: null, detail: expect.stringContaining('HE-ZERO-009 turn-0901.request.json has no actor.member') });
      for (const [n, body, why] of [
        [903, 'null', 'is not a JSON object'],
        [904, JSON.stringify({ turn: 0, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' } }), 'has no turn number'],
        [905, JSON.stringify({ turn: 905, actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' } }), 'has no prompt'],
        [906, JSON.stringify({ turn: 906, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'C1', type: 'group' } }), 'has no channel id and type'],
        [907, JSON.stringify({ turn: 907, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' }, time_budget_s: 'soon' }), 'has no positive time_budget_s'],
        [908, JSON.stringify({ turn: 908, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' }, time_budget_s: -5 }), 'has no positive time_budget_s'],
        [909, JSON.stringify({ turn: 909, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' }, time_budget_s: 0 }), 'has no positive time_budget_s'],
        [910, JSON.stringify({ turn: 910, prompt: 'Hi.', actor: { member: 'a' }, channel: { id: 'D1', type: 'dm' }, time_budget_s: { toString: 0, valueOf: 0 } }), 'has no positive time_budget_s'],
      ] as const) {
        put(`turn-0${n}.request.json`, body);
        expect(await answer(`turn-0${n}.response.json`)).toMatchObject({ turn: n, exit: 2, reply_text: null, detail: expect.stringContaining(`HE-ZERO-009 turn-0${n}.request.json ${why}`) });
      }
      s.fake.script.push({ text: 'still serving' });
      expect(await turn(s.t, { prompt: 'Hi.', turn: 902 })).toMatchObject({ exit: 0, reply_text: 'still serving' });
      expect(s.proc.exitCode).toBeNull();
    } finally { await s.stop(); }
  }, 40_000);

  test('a failed turn keeps the calls that ran, closing an unfinished batch as unknown; a request the provider rejected is not kept, the calls before it are', async () => {
    const s = await serving('zero-min');
    try {
      s.fake.script.push({ calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'partial' } }, { name: 'mcp__world__read_notes' }] });
      const post = s.world.calls.length;
      s.world.state.failInit = true;
      s.world.state.expireAfter = 'post_message';
      const r = await turn(s.t, { prompt: 'Post, then read.' });
      expect(r).toMatchObject({ exit: 2, reply_text: null, detail: expect.stringContaining('HE-ZERO-005') });
      expect(s.world.calls.slice(post).map((c) => c.tool)).toEqual(['post_message']);
      s.world.state.failInit = false;
      s.world.state.expireNext = false;
      s.fake.script.splice(0, s.fake.script.length, { text: 'it posted' });
      expect(await turn(s.t, { prompt: 'Did it post?' })).toMatchObject({ exit: 0, reply_text: 'it posted' });
      expect(s.fake.seen.at(-1)!.violation).toBeUndefined();
      const sent = JSON.stringify(s.fake.seen.at(-1)!.body.messages);
      expect(sent).toContain('posted: partial');
      expect(sent).toContain('The turn ended before this call finished');

      s.fake.script.splice(0, s.fake.script.length, { calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'before the 400' } }] }, { status: 400 });
      expect(await turn(s.t, { prompt: 'Post, then get rejected.' })).toMatchObject({ exit: 2, detail: expect.stringContaining('HE-ZERO-004') });
      s.fake.script.splice(0, s.fake.script.length, { text: 'fresh' });
      expect(await turn(s.t, { prompt: 'After the rejection.' })).toMatchObject({ exit: 0, reply_text: 'fresh' });
      expect(s.fake.seen.at(-1)!.violation).toBeUndefined();
      const after = JSON.stringify(s.fake.seen.at(-1)!.body.messages);
      expect(after).toContain('Post, then get rejected.');
      expect(after).toContain('before the 400');
      expect(after).toContain('so this result was dropped from the history');
      expect(after).not.toContain('posted: before the 400');
      expect(s.world.calls.filter((c) => c.args?.text === 'before the 400')).toHaveLength(1);
    } finally { await s.stop(); }
  }, 30_000);

  test('call_tool arguments sent as a JSON string are parsed; arguments that are not an object are refused and not run', async () => {
    const s = await serving('zero-full');
    try {
      s.fake.script.push({ calls: [{ name: 'call_tool', args: { name: 'mcp__world__post_message', arguments: JSON.stringify({ channel: 'C1', text: 'from a string' }) } }] },
        { calls: [{ name: 'call_tool', args: { name: 'mcp__world__post_message', arguments: ['C1', 'from an array'] } }] }, { text: 'done' });
      expect(await turn(s.t, { prompt: 'Post twice.' })).toMatchObject({ exit: 0, reply_text: 'done' });
      expect(s.world.calls.filter((c) => c.tool === 'post_message').map((c) => c.args)).toEqual([{ channel: 'C1', text: 'from a string' }]);
      expect(JSON.stringify(s.fake.seen.at(-1)!.body.messages)).toContain("Not run: call_tool's arguments for mcp__world__post_message: the arguments are not a JSON object");
    } finally { await s.stop(); }
  }, 30_000);

  test('an SSE answer on a stream the server keeps open is read at its event, not at the end of the body', async () => {
    const s = await serving('zero-min', { sse: true, hold: true });
    try {
      s.fake.script.push({ calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'read' });
      const began = Date.now();
      expect(await turn(s.t, { prompt: 'Read.', budget: 20 })).toMatchObject({ exit: 0, reply_text: 'read' });
      expect(Date.now() - began).toBeLessThan(10_000);
      expect(turnLines(s.t).at(-1).tool_calls).toEqual([{ tool: 'mcp__world__read_notes', status: 'ok' }]);
    } finally { await s.stop(); }
  }, 30_000);

  test('a turn an earlier serve process started and never answered is answered exit 2 by the next one, never run again', async () => {
    const s = await serving('zero-min');
    try {
      s.fake.script.push({ hang: true });
      const pending = turn(s.t, { prompt: 'Hang.', turn: 900 });
      await waitFor(() => s.fake.seen.length > 0, 10_000, 'the model request');
      s.proc.kill('SIGKILL');
      await s.proc.exited;
      const again = spawnServe(s.env);
      try {
        expect(await pending).toMatchObject({ exit: 2, reply_text: null, detail: expect.stringContaining('already started by an earlier serve process') });
        expect(s.fake.seen).toHaveLength(1);
      } finally { again.kill('SIGTERM'); await again.exited; }
    } finally { await s.stop(); }
  }, 30_000);

  test('turn budget: a hanging upstream is 124 and serving goes on; retry-after is honored; SIGTERM idle and during a turn exit 0', async () => {
    const s = await serving('zero-min');
    try {
      s.fake.script.push({ hang: true }, { status: 529, headers: { 'retry-after': '1' } }, { text: 'after a second' });
      const began = Date.now();
      expect(await turn(s.t, { prompt: 'Hang.', budget: 2 })).toMatchObject({ exit: 124, reply_text: null, detail: 'wall clock exceeded (2s)' });
      expect(Date.now() - began).toBeLessThan(5_000);
      const r = Date.now();
      expect(await turn(s.t, { prompt: 'Next.' })).toMatchObject({ exit: 0, reply_text: 'after a second' });
      expect(Date.now() - r).toBeGreaterThanOrEqual(1_000);
      s.fake.script.push({ hang: true });
      const name = 'turn-0999';
      const pending = turn(s.t, { prompt: 'Hang until stopped.', budget: 60, turn: 999 });
      await waitFor(() => adapterLog(s.t).includes('turn 999: session'), 10_000, 'turn 999 to start');
      await Bun.sleep(200);
      const stopped = Date.now();
      s.proc.kill('SIGTERM');
      expect(await s.proc.exited).toBe(0);
      expect(Date.now() - stopped).toBeLessThan(3_000);
      expect(await pending).toMatchObject({ exit: 2, reply_text: null, detail: 'stopped by SIGTERM during the turn' });
      expect(existsSync(join(s.t.turns, name + '.response.json'))).toBe(true);
    } finally { await s.stop(); }
    const idle = await serving('zero-min');
    const began = Date.now();
    expect(await idle.stop()).toBe(0);
    expect(Date.now() - began).toBeLessThan(2_000);
  }, 30_000);
});
