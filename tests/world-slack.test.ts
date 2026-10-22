import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { WorldServer } from '../world/services/server.ts';
import { slack, startWorld, tokenOf } from './world-helpers.ts';

let ws: WorldServer;
beforeAll(() => { ws = startWorld('slack-test'); });
afterAll(() => ws.stop());

describe('Slack mock', () => {
  test('auth.test names the token holder and rejects unknown tokens', async () => {
    const me = await slack(ws, tokenOf(ws, 'dana-okafor'), 'auth.test');
    expect(me.ok).toBe(true);
    expect(me.user).toBe('dana.okafor');
    expect((await slack(ws, 'xoxp-nope', 'auth.test')).error).toBe('invalid_auth');
    const noToken = await (await fetch(`${ws.url}/api/auth.test`, { method: 'POST' })).json() as { error: string };
    expect(noToken.error).toBe('not_authed');
  });

  test('users.list has the 14 employees plus the assistant bot', async () => {
    const r = await slack(ws, tokenOf(ws, 'dana-okafor'), 'users.list');
    expect(r.members.filter((m: any) => m.world.kind === 'employee')).toHaveLength(14);
    expect(r.members.some((m: any) => m.is_bot && m.name === 'assistant')).toBe(true);
  });

  test('a member cannot list or read a channel they are not in', async () => {
    const hollis = tokenOf(ws, 'hollis-mbeki');
    const list = await slack(ws, hollis, 'conversations.list', { types: 'public_channel,private_channel' });
    const names = list.channels.map((c: any) => c.name);
    expect(names).toContain('central-team');
    expect(names).not.toContain('north-team');
    const before = ws.log.events.length;
    const hist = await slack(ws, hollis, 'conversations.history', { channel: 'north-team' });
    expect(hist).toEqual({ ok: false, error: 'not_in_channel' });
    const denied = ws.log.events[before]!;
    expect(denied).toMatchObject({ actor: 'hollis-mbeki', tool: 'conversations.history', kind: 'deny', outcome: 'denied', error: 'not_in_channel', via: 'slack' });
    expect((await slack(ws, hollis, 'conversations.history', { channel: 'no-such-channel' })).error).toBe('channel_not_found');
    expect((await slack(ws, hollis, 'conversations.members', { channel: 'north-team' })).error).toBe('not_in_channel');
  });

  test('a post appears in history, carries a clock ts, and lands in the event log', async () => {
    const dana = tokenOf(ws, 'dana-okafor');
    const before = ws.log.events.length;
    const post = await slack(ws, dana, 'chat.postMessage', { channel: '#north-team', text: 'seat count is 185, confirmed' });
    expect(post.ok).toBe(true);
    expect(post.ts.startsWith(String(Math.floor(ws.clock.nowMs() / 1000)))).toBe(true);
    const hist = await slack(ws, dana, 'conversations.history', { channel: 'north-team', limit: '1' });
    expect(hist.messages[0].text).toBe('seat count is 185, confirmed');
    expect(hist.messages[0].ts).toBe(post.ts);
    const ev = ws.log.events.slice(before).find((e) => e.tool === 'chat.postMessage')!;
    expect(ev).toMatchObject({ actor: 'dana-okafor', kind: 'write', outcome: 'ok', via: 'slack', effect: { ts: post.ts } });
    expect(ev.args_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((ev.args as { text: string }).text).toBe('seat count is 185, confirmed');
    const ilse = await slack(ws, tokenOf(ws, 'ilse-varga'), 'conversations.history', { channel: 'north-team', limit: '1' });
    expect(ilse.messages[0].ts).toBe(post.ts);
  });

  test('history pages newest first and threads come back through conversations.replies', async () => {
    const dana = tokenOf(ws, 'dana-okafor');
    const page1 = await slack(ws, dana, 'conversations.history', { channel: 'north-team', limit: '3' });
    expect(page1.messages).toHaveLength(3);
    expect(Number(page1.messages[0].ts)).toBeGreaterThan(Number(page1.messages[1].ts));
    expect(page1.has_more).toBe(true);
    const page2 = await slack(ws, dana, 'conversations.history', { channel: 'north-team', limit: '3', cursor: page1.response_metadata.next_cursor });
    expect(page2.messages[0].ts).not.toBe(page1.messages[0].ts);
    const root = page1.messages[0].ts as string;
    const reply = await slack(ws, dana, 'chat.postMessage', { channel: 'north-team', text: 'threaded reply', thread_ts: root });
    expect(reply.ok).toBe(true);
    const thread = await slack(ws, dana, 'conversations.replies', { channel: 'north-team', ts: root });
    expect(thread.messages.map((m: any) => m.ts)).toEqual([root, reply.ts]);
    const top = await slack(ws, dana, 'conversations.history', { channel: 'north-team', limit: '1' });
    expect(top.messages[0].ts).toBe(root);
  });

  test('a DM is visible to its two members and to nobody else', async () => {
    const dana = tokenOf(ws, 'dana-okafor');
    const marcus = tokenOf(ws, 'marcus-lindqvist');
    const hollis = tokenOf(ws, 'hollis-mbeki');
    const opened = await slack(ws, dana, 'conversations.open', { users: 'marcus.lindqvist' });
    expect(opened.ok).toBe(true);
    expect(opened.channel.is_im).toBe(true);
    const dm = opened.channel.id as string;
    await slack(ws, dana, 'chat.postMessage', { channel: dm, text: 'private to marcus' });
    const mine = await slack(ws, marcus, 'conversations.history', { channel: dm });
    expect(mine.messages[0].text).toBe('private to marcus');
    expect((await slack(ws, hollis, 'conversations.history', { channel: dm })).error).toBe('not_in_channel');
    const hollisList = await slack(ws, hollis, 'conversations.list', { types: 'im' });
    expect(hollisList.channels.map((c: any) => c.id)).not.toContain(dm);
    const again = await slack(ws, marcus, 'conversations.open', { users: 'dana.okafor' });
    expect(again.channel.id).toBe(dm);
    expect((await slack(ws, hollis, 'chat.postMessage', { channel: dm, text: 'intruder' })).error).toBe('not_in_channel');
  });

  test('the socket stream delivers message events to the connected bot and app_mention on a mention', async () => {
    expect((await slack(ws, 'xapp-wrong', 'apps.connections.open')).error).toBe('invalid_auth');
    const open = await slack(ws, ws.credentials.bot.app_token, 'apps.connections.open');
    expect(open.ok).toBe(true);
    const got: any[] = [];
    const sock = new WebSocket(open.url as string);
    await new Promise<void>((res, rej) => { sock.onopen = () => res(); sock.onerror = () => rej(new Error('socket failed')); });
    sock.onmessage = (e) => {
      const d = JSON.parse(String(e.data));
      got.push(d);
      if (d.envelope_id) sock.send(JSON.stringify({ envelope_id: d.envelope_id }));
    };
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'hey @assistant, summarize the QFL thread' });
    const deadline = Date.now() + 2000;
    while (got.length < 3 && Date.now() < deadline) await Bun.sleep(20);
    expect(got[0].type).toBe('hello');
    const types = got.slice(1).map((g) => g.payload.event.type).sort();
    expect(types).toEqual(['app_mention', 'message']);
    expect(got[1].payload.event.channel).toBe(ws.service.channel('north-team')!.id);
    expect(got[1].payload.event.user).toBe(ws.service.member('ilse-varga')!.slack_id);
    await Bun.sleep(50);
    expect(ws.socket.unacked.size).toBe(0);
    sock.close();
  });

  test('the bot can post with its own token and the post is attributed to it', async () => {
    const r = await slack(ws, ws.credentials.bot.token, 'chat.postMessage', { channel: 'north-team', text: 'bot reply' });
    expect(r.ok).toBe(true);
    expect(r.message.bot_id).toBe('B0WORLDBOT');
    const ev = ws.log.events.at(-1)!;
    expect(ev).toMatchObject({ actor: 'assistant', tool: 'chat.postMessage', outcome: 'ok' });
  });

  test('heldout channels are absent from a dev world', () => {
    expect(ws.service.channel('coastal-team')).toBeUndefined();
    expect(ws.service.channel('north-team')).toBeDefined();
  });
});
