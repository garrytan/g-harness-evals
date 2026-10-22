import { join } from 'node:path';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { loadWorld } from '../world/services/world.ts';
import type { Split } from '../world/types.ts';

export const world = loadWorld(join(import.meta.dir, '..', 'world', 'seed', 'world.json'));

export function startWorld(trialId: string, split: Split = 'dev'): WorldServer {
  return createWorldServer({ world, split, trialId, eventsPath: null });
}

export function tokenOf(ws: WorldServer, member: string): string {
  const a = ws.credentials.actors.find((x) => x.member === member);
  if (!a) throw new Error(`no token for ${member}`);
  return a.token;
}

export async function slack(ws: WorldServer, token: string, method: string, body: Record<string, string> = {}): Promise<Record<string, any>> {
  const res = await fetch(`${ws.url}/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return res.json() as Promise<Record<string, any>>;
}
