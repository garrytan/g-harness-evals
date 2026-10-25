// internal-task (docs/qm-findings.md F5): the directory body the QM adapter pushes before the first turn, built from
// the world's Slack API with the bot token: every channel the bot is in (all non-DM channels), each roster keyed
// by Slack ids, every channel named as a complete roster, no members block.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { WorldServer } from '../world/services/server.ts';
import { startWorld } from './world-helpers.ts';

const SCRIPT = join(resolve(import.meta.dir, '..'), 'harnesses/qm/qm-directory.mjs');

let ws: WorldServer;
beforeAll(() => { ws = startWorld('qm-directory-test'); });
afterAll(() => ws.stop());

// The world server answers on this process's event loop, so the script runs asynchronously.
async function run(token: string): Promise<{ status: number | null; stdout: string }> {
  const proc = Bun.spawn(['node', SCRIPT, `${ws.url}/api/`, token], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  return { status: await proc.exited, stdout };
}

describe('qm-directory.mjs', () => {
  test('lists the bot\'s channels with their rosters as Slack ids and names every channel as a complete roster', async () => {
    const out = await run(ws.credentials.bot.token);
    expect(out.status).toBe(0);
    const body = JSON.parse(out.stdout) as { channels: Array<{ channelId: string; name: string; isPrivate: boolean }>; channelMembers: Array<{ channelId: string; principalId: string }>; channelRosterIds: string[]; channelsSyncedAt: number };
    expect(body.channels.map((c) => c.channelId).sort()).toEqual(ws.service.channels.filter((c) => c.kind !== 'dm').map((c) => c.id).sort());
    expect(body.channelRosterIds.sort()).toEqual(body.channels.map((c) => c.channelId).sort());
    const north = ws.service.channels.find((c) => c.name === 'north-team')!;
    const northRoster = body.channelMembers.filter((m) => m.channelId === north.id).map((m) => m.principalId);
    expect(northRoster).toContain(ws.service.requireMember('dana-okafor').slack_id);
    expect(northRoster).toContain(ws.service.bot!.slack_id);
    expect(northRoster).toHaveLength(north.members.length);
    expect(northRoster).not.toContain(ws.service.requireMember('hollis-mbeki').slack_id);
    expect('members' in body).toBe(false);
    expect(body.channelsSyncedAt).toBeGreaterThan(0);
  });

  test('exits 2 when the world refuses the token', async () => {
    expect((await run('xoxb-nope')).status).toBe(2);
  });
});
