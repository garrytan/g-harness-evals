// The evaluator-owned event log: one JSON line per call, appended and never rewritten.
// Graders read this file; the agent never sees it.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type EventKind = 'read' | 'write' | 'deny' | 'approval' | 'clock' | 'admin';

export interface WorldEvent {
  seq: number;
  trial_id: string;
  wall_ts: string;
  sim_ts: string;
  actor: string | null;
  /** gbrain arm lane D addition: via "gbrain" marks a gbrain MCP request relayed by the world's /gbrain tap. */
  via: 'slack' | 'mcp' | 'admin' | 'runner' | 'gbrain';
  tool: string;
  kind: EventKind;
  args_digest: string;
  args: unknown;
  outcome: 'ok' | 'denied' | 'error';
  error?: string;
  effect?: Record<string, unknown>;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class EventLog {
  private seq = 0;
  readonly events: WorldEvent[] = [];

  constructor(readonly trialId: string, readonly path: string | null, private readonly simNow: () => string) {
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, '');
    }
  }

  append(e: Omit<WorldEvent, 'seq' | 'trial_id' | 'wall_ts' | 'sim_ts' | 'args_digest'>): WorldEvent {
    this.seq += 1;
    const event: WorldEvent = {
      seq: this.seq,
      trial_id: this.trialId,
      wall_ts: new Date().toISOString(),
      sim_ts: this.simNow(),
      args_digest: digest(e.args),
      ...e,
    };
    this.events.push(event);
    if (this.path) appendFileSync(this.path, JSON.stringify(event) + '\n');
    return event;
  }
}
