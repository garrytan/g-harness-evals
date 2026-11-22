// Socket-Mode-style event delivery. The harness calls apps.connections.open with its app-level token, gets a
// ws:// URL, connects, receives {"type":"hello"} and then one envelope per message event in any channel the
// bot belongs to. It acknowledges each envelope by sending {"envelope_id": ...}.
// Redelivery follows Slack's Events API: an envelope not acknowledged within the ack window is sent again with
// retry_attempt 1 and retry_reason "timeout", then again after one minute (attempt 2) and five minutes (attempt 3),
// and then dropped; a retry whose message falls in an expired turn window is dropped too. The retry keeps the envelope_id and the payload's event_id, so a harness that dedupes on either
// sees the same event. An event raised while no client is connected is still not queued, so the runner waits for the
// bot's connection before driving actor messages. Delays are wall time and configurable.

import type { ServerWebSocket } from 'bun';
import type { Message } from '../../types.ts';
import { inExpiredWindow, type WorldService } from '../world.ts';
import { APP_ID, messageView } from './slack.ts';

export interface SocketData { ticket: string }

/** Wall-clock delay before each retry, measured from the attempt before it: the 3 s ack window, then 1 min, then 5 min. */
export const SLACK_RETRY_DELAYS_MS = [3_000, 60_000, 300_000];

interface Pending {
  envelope: { envelope_id: string; retry_attempt: number; retry_reason: string } & Record<string, unknown>;
  eventTime: number;
  ts: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export class SocketHub {
  private clients = new Set<ServerWebSocket<SocketData>>();
  private envelopeSeq = 0;
  private readonly retryDelaysMs: number[];
  readonly unacked = new Map<string, Pending>();
  /** Envelopes sent again with retry_attempt above 0, and envelopes given up after the last retry. */
  redelivered = 0;
  dropped = 0;

  constructor(private readonly service: WorldService, opts: { retryDelaysMs?: number[] } = {}) {
    this.retryDelaysMs = opts.retryDelaysMs ?? SLACK_RETRY_DELAYS_MS;
    service.onMessage((m) => this.deliver(m));
  }

  get connections(): number {
    return this.clients.size;
  }

  open(ws: ServerWebSocket<SocketData>): void {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', num_connections: this.clients.size, debug_info: { host: 'world-mock' }, connection_info: { app_id: APP_ID } }));
  }

  close(ws: ServerWebSocket<SocketData>): void {
    this.clients.delete(ws);
  }

  message(_ws: ServerWebSocket<SocketData>, raw: string | Buffer): void {
    try {
      const ack = JSON.parse(String(raw)) as { envelope_id?: string };
      if (ack.envelope_id) this.settle(ack.envelope_id);
    } catch {
      // not an acknowledgement; ignored
    }
  }

  /** Send every un-acknowledged envelope's next attempt now instead of waiting for its timer. Returns how many were sent. */
  redeliverNow(): number {
    if (!this.clients.size) return 0;
    let sent = 0;
    for (const id of [...this.unacked.keys()]) if (this.retry(id)) sent += 1;
    return sent;
  }

  /** Clear every retry timer; the server calls this when it stops. */
  stop(): void {
    for (const p of this.unacked.values()) if (p.timer) clearTimeout(p.timer);
    this.unacked.clear();
  }

  private settle(envelopeId: string): void {
    const p = this.unacked.get(envelopeId);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    this.unacked.delete(envelopeId);
  }

  private send(p: Pending): void {
    const text = JSON.stringify(p.envelope);
    for (const ws of this.clients) ws.send(text);
    const delay = this.retryDelaysMs[p.envelope.retry_attempt] ?? this.retryDelaysMs[0] ?? 0;
    const t = setTimeout(() => { if (this.unacked.get(p.envelope.envelope_id) === p) this.retry(p.envelope.envelope_id); }, delay);
    (t as { unref?: () => void }).unref?.();
    p.timer = t;
  }

  private retry(envelopeId: string): boolean {
    const p = this.unacked.get(envelopeId);
    if (!p) return false;
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    if (p.envelope.retry_attempt >= this.retryDelaysMs.length) {
      this.unacked.delete(envelopeId);
      this.dropped += 1;
      return false;
    }
    if (!this.clients.size || inExpiredWindow(p.ts, this.service.expiredWindows())) { this.unacked.delete(envelopeId); this.dropped += 1; return false; }
    p.envelope = { ...p.envelope, retry_attempt: p.envelope.retry_attempt + 1, retry_reason: 'timeout' };
    this.redelivered += 1;
    this.send(p);
    return true;
  }

  private deliver(m: Message): void {
    const bot = this.service.bot;
    if (!bot) return;
    const channel = this.service.channel(m.channel);
    if (!channel || !channel.members.includes(bot.id)) return;
    const base = messageView(this.service, m);
    const eventTime = Math.floor(Number(m.ts));
    const events: Record<string, unknown>[] = [{
      ...base, channel: channel.id, channel_type: channel.kind === 'dm' ? 'im' : 'channel', event_ts: m.ts,
    }];
    if (m.author !== bot.id && (m.text.includes(`<@${bot.slack_id}>`) || m.text.includes(`@${bot.handle}`))) {
      events.push({ ...base, type: 'app_mention', channel: channel.id, event_ts: m.ts });
    }
    for (const event of events) {
      this.envelopeSeq += 1;
      const envelopeId = `env-${this.service.log.trialId}-${this.envelopeSeq}`;
      const p: Pending = {
        envelope: {
          envelope_id: envelopeId,
          type: 'events_api',
          accepts_response_payload: false,
          retry_attempt: 0,
          retry_reason: '',
          payload: {
            token: '',
            team_id: 'T0PEMBERLINE',
            api_app_id: APP_ID,
            type: 'event_callback',
            event_id: `Ev${this.envelopeSeq.toString(36).toUpperCase().padStart(8, '0')}`,
            event_time: eventTime,
            event,
            authorizations: [{ team_id: 'T0PEMBERLINE', user_id: bot.slack_id, is_bot: true }],
          },
        },
        eventTime,
        ts: m.ts,
        timer: null,
      };
      if (!this.clients.size) continue;
      this.unacked.set(envelopeId, p);
      this.send(p);
    }
  }
}
