// The world for one trial, started in-process from world/services/server.ts. The runner talks to it the way
// an actor or the admin would, over HTTP, so every actor message, clock advance and fence lands in the
// evaluator-owned event log the same way a harness's calls do.

import { join } from 'node:path';
import type { WorldEvent } from '../../world/services/events.ts';
import { createWorldServer, type WorldServer } from '../../world/services/server.ts';
import { writeTrialConfig, type TrialConfig } from '../../world/services/start.ts';
import { loadWorld } from '../../world/services/world.ts';
import type { Member, Split, World } from '../../world/types.ts';
import type { WorldSnapshot } from '../contracts.ts';
import { RunnerError } from '../errors.ts';

export const DEFAULT_WORLD_PATH = join('world', 'seed', 'world.json');
/** The name a container resolves to the host (docker run --add-host host.docker.internal:host-gateway). */
export const CONTAINER_HOST = 'host.docker.internal';

let cached: { path: string; world: World } | null = null;
export function worldAt(path: string): World {
  if (!cached || cached.path !== path) cached = { path, world: loadWorld(path) };
  return cached.world;
}

export interface TrialWorldOptions {
  trialId: string;
  split: Split;
  actors: string[];
  outDir: string;
  worldPath?: string;
  /** true: bind every interface and hand containers host.docker.internal; false: loopback only. */
  reachableFromContainers: boolean;
  clockReference?: string;
}

export interface SlackReply { ok: boolean; error?: string; [k: string]: unknown }

export class TrialWorld {
  readonly server: WorldServer;
  readonly config: TrialConfig;
  readonly world: World;
  readonly split: Split;
  readonly worldPath: string;

  constructor(opts: TrialWorldOptions) {
    this.worldPath = opts.worldPath ?? DEFAULT_WORLD_PATH;
    this.world = worldAt(this.worldPath);
    this.split = opts.split;
    this.server = createWorldServer({
      world: this.world, split: opts.split, trialId: opts.trialId, actors: opts.actors,
      hostname: opts.reachableFromContainers ? '0.0.0.0' : '127.0.0.1', port: 0,
      eventsPath: join(opts.outDir, 'events.jsonl'),
      ...(opts.clockReference ? { clockReference: opts.clockReference } : {}),
    });
    const port = new URL(this.server.url).port;
    const baseUrl = opts.reachableFromContainers ? `http://${CONTAINER_HOST}:${port}` : `http://127.0.0.1:${port}`;
    this.config = writeTrialConfig(this.server, { split: opts.split, world: this.world, out: opts.outDir, baseUrl });
  }

  /** The address this process reaches the world at (always loopback-capable). */
  get localUrl(): string { return `http://127.0.0.1:${new URL(this.server.url).port}`; }
  /** The address written into trial.json and handed to the harness. */
  get harnessUrl(): string { return this.config.base_url; }
  get botToken(): string { return this.config.slack.bot.token; }
  get botUserId(): string { return this.config.slack.bot.user_id; }
  get botMember(): Member { return this.server.service.bot!; }
  get events(): WorldEvent[] { return this.server.log.events; }
  get lastSeq(): number { return this.server.log.events.length; }
  simNow(): string { return this.server.clock.nowIso(); }

  actor(member: string): { member: Member; token: string; slack_user_id: string } {
    const a = this.config.actors.find((x) => x.member === member);
    if (!a) throw new RunnerError('HE-TASK-004', `actor ${member} has no token in this trial's world; fix: list every turn actor in task.toml actors and check the member exists in the ${this.split} split`);
    return { member: this.server.service.requireMember(member), token: a.token, slack_user_id: a.slack_user_id };
  }

  channelByName(name: string) { return this.server.service.channel(name); }

  async slack(token: string, method: string, body: Record<string, string>): Promise<SlackReply> {
    const res = await fetch(`${this.localUrl}/api/${method}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
    });
    return res.json() as Promise<SlackReply>;
  }

  private async admin(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.localUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.config.admin_token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  }

  async advanceClock(seconds: number): Promise<string> {
    const res = await this.admin('/clock/advance', { method: 'POST', body: JSON.stringify({ seconds }) });
    const body = await res.json() as { ok: boolean; now?: string; error?: string };
    if (!body.ok) throw new RunnerError('HE-WORLD-001', `the world refused a clock advance of ${seconds} s: ${body.error}`);
    return body.now!;
  }

  /** internal-task: the tap presents the requesting member's gbrain token under member scope; internal-task: or its source_ids under scope "sources". */
  get gbrainScoped(): boolean { const g = this.server.gbrain(); return !!(g?.tokens || g?.grants); }

  async setGbrainRequester(member: string | null): Promise<void> {
    const res = await this.admin('/admin/gbrain/requester', { method: 'POST', body: JSON.stringify({ member }) });
    const body = await res.json() as { ok: boolean; error?: string };
    if (!body.ok) throw new RunnerError('HE-WORLD-001', `the world refused gbrain requester ${member}: ${body.error}`);
  }

  async fence(): Promise<void> {
    const res = await this.admin('/admin/fence', { method: 'POST', body: '{}' });
    if (!res.ok) throw new RunnerError('HE-WORLD-001', `fence failed: HTTP ${res.status}`);
  }

  async snapshot(): Promise<WorldSnapshot> {
    const res = await this.admin('/admin/snapshot');
    if (!res.ok) throw new RunnerError('HE-WORLD-001', `snapshot failed: HTTP ${res.status}`);
    return res.json() as Promise<WorldSnapshot>;
  }

  stop(): void { this.server.stop(); }
}
