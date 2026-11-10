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
  via: 'slack' | 'mcp' | 'admin' | 'runner' | 'gbrain' | 'oauth';
  tool: string;
  kind: EventKind;
  args_digest: string;
  args: unknown;
  outcome: 'ok' | 'denied' | 'error';
  error?: string;
  effect?: Record<string, unknown>;
  /** internal-task (company brain) addition, gbrain events only: whose gbrain token the tap presented upstream: "bot" (the
   *  trial's unscoped token), a member id (that member's granted token) or "public-only" (member scope before the first turn). */
  grant?: string;
  /** internal-task addition, gbrain remember events only: the source whose ingest token the tap presented instead of the
   *  requester's, for a remember made in a shared channel under member tokens with live ingestion (gbrain-tap.ts). */
  write_source?: string;
  /** internal-task addition, gbrain events only and only when the upstream carries provider (gbrain-tap.ts): "provider" for QM
   *  core's memory-provider client, told by its bearer token, "model" for every other call. */
  caller?: 'provider' | 'model';
  /** internal-task addition, provider calls only: the member the call named, exactly as sent: arg is the actor tool argument
   *  (acting_user) or null, header the x-qm-actor request header or null (always null at QM b6786d67, whose provider client
   *  sends no headers; M2b adds it). */
  provider_actor?: { arg: unknown; header: string | null };
  /** internal-task addition, provider tools/call events only: recall (QM's per-turn recall, which carries the provider's maxCharsArg),
   *  query (the model's own memory search through the provider, which does not), write (a write tool, such as QM's explicit
   *  capture through the provider's write operation; no delivery is recorded), or unknown (the cell named no max_chars_arg). */
  provider_op?: 'recall' | 'query' | 'write' | 'unknown';
  /** C4 gate 4 deviation, provider recall events only, present when the tap trimmed the recall's question before forwarding
   *  (trimProviderQuestion in gbrain-tap.ts): the length QM sent, the length of the Current message part alone (trim only,
   *  capped), the member's own text between our preamble's markers (null when absent), the length gbrain got, and which
   *  part was kept. */
  question_trim?: { original_chars: number; trim_only_chars: number; member_text_chars: number | null; sent_chars: number; kept: 'member_text' | 'current_message' | 'head' };
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
