import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SimClock } from '../world/services/clock/clock.ts';
import type { WorldServer } from '../world/services/server.ts';
import { slack, startWorld, tokenOf } from './world-helpers.ts';

describe('SimClock', () => {
  test('is frozen at the reference until advanced, independent of wall time', async () => {
    const a = new SimClock({ reference: '2026-10-14T09:00:00-05:00', time_zone: 'America/Chicago', offset_minutes: -300 });
    const b = new SimClock({ reference: '2026-10-14T09:00:00-05:00', time_zone: 'America/Chicago', offset_minutes: -300 });
    await Bun.sleep(30);
    expect(a.nowIso()).toBe('2026-10-14T09:00:00-05:00');
    expect(a.nowMs()).toBe(b.nowMs());
    expect(a.today()).toBe('2026-10-14');
    a.advanceSeconds(90 * 60);
    expect(a.nowIso()).toBe('2026-10-14T10:30:00-05:00');
    expect(b.nowIso()).toBe('2026-10-14T09:00:00-05:00');
    expect(a.state().advanced_seconds).toBe(5400);
  });

  test('advanceTo moves forward only and ts values stay unique and ordered inside one second', () => {
    const c = new SimClock({ reference: '2026-10-14T09:00:00-05:00', time_zone: 'America/Chicago', offset_minutes: -300, ts_counter_start: 100 });
    const t1 = c.nextTs();
    const t2 = c.nextTs();
    expect(t1).toBe('1791986400.000101');
    expect(t2).toBe('1791986400.000102');
    expect(Number(t2)).toBeGreaterThan(Number(t1));
    c.advanceTo('2026-10-14T16:00:00Z');
    expect(c.nowIso()).toBe('2026-10-14T11:00:00-05:00');
    expect(() => c.advanceTo('2026-10-14T09:00:00-05:00')).toThrow('forward');
    expect(() => c.advanceSeconds(-1)).toThrow();
  });
});

describe('clock endpoints', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('clock-test'); });
  afterAll(() => ws.stop());

  test('GET /clock is public, POST /clock/advance needs the admin token and stamps later messages', async () => {
    const before = await (await fetch(`${ws.url}/clock`)).json() as { now: string; advanced_seconds: number };
    expect(before.now).toBe('2026-10-14T09:00:00-05:00');
    const denied = await fetch(`${ws.url}/clock/advance`, { method: 'POST', body: JSON.stringify({ seconds: 60 }) });
    expect(denied.status).toBe(401);
    const asActor = await fetch(`${ws.url}/clock/advance`, { method: 'POST', headers: { authorization: `Bearer ${tokenOf(ws, 'dana-okafor')}` }, body: JSON.stringify({ seconds: 60 }) });
    expect(asActor.status).toBe(401);
    const ok = await (await fetch(`${ws.url}/clock/advance`, {
      method: 'POST', headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ seconds: 2 * 3600 }),
    })).json() as { ok: boolean; now: string };
    expect(ok).toMatchObject({ ok: true, now: '2026-10-14T11:00:00-05:00' });
    const post = await slack(ws, tokenOf(ws, 'dana-okafor'), 'chat.postMessage', { channel: 'north-team', text: 'after lunch' });
    expect(Math.floor(Number(post.ts))).toBe(Math.floor(Date.parse('2026-10-14T11:00:00-05:00') / 1000));
    const clockEvent = ws.log.events.find((e) => e.tool === 'clock.advance')!;
    expect(clockEvent).toMatchObject({ via: 'runner', kind: 'clock', outcome: 'ok', effect: { now: '2026-10-14T11:00:00-05:00' } });
    expect(clockEvent.sim_ts).toBe('2026-10-14T11:00:00-05:00');
  });
});
