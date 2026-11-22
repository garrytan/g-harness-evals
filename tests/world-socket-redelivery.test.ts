import { afterEach, describe, expect, test } from 'bun:test';
import type { WorldServer } from '../world/services/server.ts';
import { slack, startWorld, tokenOf } from './world-helpers.ts';

// The socket redelivers an envelope the bot did not acknowledge, the way Slack's Events API retries, instead of
// sending it once with retry_attempt 0 forever (world/services/slack/socket.ts).

let ws: WorldServer | null = null;
afterEach(() => { ws?.stop(); ws = null; });

async function connect(w: WorldServer, ack: (d: any) => boolean): Promise<{ got: any[]; sock: WebSocket }> {
  const open = await slack(w, w.credentials.bot.app_token, 'apps.connections.open');
  const got: any[] = [];
  const sock = new WebSocket(open.url as string);
  sock.onmessage = (e) => {
    const d = JSON.parse(String(e.data));
    got.push(d);
    if (d.envelope_id && ack(d)) sock.send(JSON.stringify({ envelope_id: d.envelope_id }));
  };
  await new Promise<void>((res, rej) => { sock.onopen = () => res(); sock.onerror = () => rej(new Error('socket failed')); });
  return { got, sock };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await Bun.sleep(10);
}

const admin = async (w: WorldServer, path: string, method = 'GET') =>
  (await fetch(`${w.url}${path}`, { method, headers: { authorization: `Bearer ${w.credentials.admin_token}` } })).json() as Promise<Record<string, any>>;

describe('socket redelivery', () => {
  test('an un-acknowledged envelope comes again with retry_attempt 1, 2 and 3, the same ids, then is dropped', async () => {
    ws = startWorld('sock-retry', 'dev', { socketRetryDelaysMs: [40, 40, 40] });
    const { got, sock } = await connect(ws, () => false);
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'no mention here' });
    const envs = () => got.filter((g) => g.envelope_id);
    await until(() => envs().length >= 4);
    await Bun.sleep(120);
    const all = envs();
    expect(all.map((e) => e.retry_attempt)).toEqual([0, 1, 2, 3]);
    expect(all.map((e) => e.retry_reason)).toEqual(['', 'timeout', 'timeout', 'timeout']);
    expect(new Set(all.map((e) => e.envelope_id)).size).toBe(1);
    expect(new Set(all.map((e) => e.payload.event_id)).size).toBe(1);
    expect(ws.socket.unacked.size).toBe(0);
    expect(await admin(ws, '/admin/socket')).toMatchObject({ unacked: 0, redelivered: 3, dropped: 1 });
    sock.close();
  });

  test('an acknowledged envelope is never sent again, and a late ack stops the retries', async () => {
    ws = startWorld('sock-ack', 'dev', { socketRetryDelaysMs: [40, 40, 40] });
    const { got, sock } = await connect(ws, (d) => d.retry_attempt === 1);
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'once' });
    await until(() => got.filter((g) => g.envelope_id).length >= 2);
    await Bun.sleep(150);
    expect(got.filter((g) => g.envelope_id).map((e) => e.retry_attempt)).toEqual([0, 1]);
    expect(ws.socket.unacked.size).toBe(0);
    sock.close();
  });

  test('an event raised with no client connected is not queued, as before', async () => {
    ws = startWorld('sock-held', 'dev', { socketRetryDelaysMs: [40, 40, 40] });
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'while you were away' });
    expect(ws.socket.unacked.size).toBe(0);
    const { got, sock } = await connect(ws, () => true);
    await Bun.sleep(150);
    expect(got.filter((g) => g.envelope_id)).toEqual([]);
    sock.close();
  });

  test('a retry due after the bot disconnected is dropped, not held', async () => {
    ws = startWorld('sock-gone', 'dev', { socketRetryDelaysMs: [40, 40, 40] });
    const { got, sock } = await connect(ws, () => false);
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'then I left' });
    await until(() => got.some((g) => g.envelope_id));
    sock.close();
    await until(() => ws!.socket.connections === 0);
    await Bun.sleep(100);
    expect(ws.socket.unacked.size).toBe(0);
    expect(ws.socket.dropped).toBe(1);
  });

  test('a retry whose message is in an expired turn window is dropped, not sent', async () => {
    ws = startWorld('sock-expired', 'dev', { socketRetryDelaysMs: [60_000, 60_000, 60_000] });
    const { got, sock } = await connect(ws, () => false);
    const ts = (await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'expiring-secret' })).ts as string;
    await until(() => got.some((g) => g.envelope_id));
    ws.service.expire(2, [{ turn: 1, from_ts: ts, to_ts: null }]);
    expect(await admin(ws, '/admin/socket/redeliver', 'POST')).toEqual({ ok: true, sent: 0 });
    await Bun.sleep(50);
    expect(got.filter((g) => g.envelope_id).map((e) => e.retry_attempt)).toEqual([0]);
    expect(await admin(ws, '/admin/socket')).toMatchObject({ unacked: 0, redelivered: 0, dropped: 1 });
    sock.close();
  });

  test('POST /admin/socket/redeliver sends the next attempt at once', async () => {
    ws = startWorld('sock-force', 'dev', { socketRetryDelaysMs: [60_000, 60_000, 60_000] });
    const { got, sock } = await connect(ws, () => false);
    await slack(ws, tokenOf(ws, 'ilse-varga'), 'chat.postMessage', { channel: 'north-team', text: 'force it' });
    await until(() => got.some((g) => g.envelope_id));
    expect(await admin(ws, '/admin/socket/redeliver', 'POST')).toEqual({ ok: true, sent: 1 });
    await until(() => got.filter((g) => g.envelope_id).length >= 2);
    expect(got.filter((g) => g.envelope_id).map((e) => e.retry_attempt)).toEqual([0, 1]);
    sock.close();
  });
});
