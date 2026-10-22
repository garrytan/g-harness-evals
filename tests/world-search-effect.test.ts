// Lane B addition to the world: a search event records the channels its matches came from, so the grader can
// tell a search that surfaced another member's conversation from one that stayed in scope.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { WorldServer } from '../world/services/server.ts';
import { slack, startWorld, tokenOf } from './world-helpers.ts';

let ws: WorldServer;
beforeAll(() => { ws = startWorld('search-effect-test'); });
afterAll(() => ws.stop());

test('search.messages logs the distinct channel ids of its matches', async () => {
  const before = ws.log.events.length;
  const r = await slack(ws, ws.credentials.bot.token, 'search.messages', { query: 'ticket' });
  expect(r.ok).toBe(true);
  const ev = ws.log.events.slice(before).find((e) => e.tool === 'search.messages')!;
  const channels = (ev.effect as { channels: string[]; count: number }).channels;
  expect(channels.length).toBeGreaterThan(1);
  expect(new Set(channels).size).toBe(channels.length);
  for (const m of r.messages.matches) expect(channels).toContain(m.channel.id);
  const dana = await slack(ws, tokenOf(ws, 'dana-okafor'), 'search.messages', { query: 'ticket' });
  const danaEv = ws.log.events.at(-1)!;
  const danaChannels = (danaEv.effect as { channels: string[] }).channels;
  expect(danaChannels.every((id) => ws.service.channel(id)!.members.includes('dana-okafor'))).toBe(true);
  expect(danaChannels.length).toBeLessThan(channels.length);
  expect(dana.ok).toBe(true);
});
