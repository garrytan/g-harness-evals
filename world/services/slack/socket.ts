// Socket-Mode-style event delivery. The harness calls apps.connections.open with its app-level token, gets a
// ws:// URL, connects, receives {"type":"hello"} and then one envelope per message event in any channel the
// bot belongs to. It acknowledges each envelope by sending {"envelope_id": ...}. Envelopes are not replayed:
// an event delivered while no client is connected is lost, as it is with real Socket Mode, so the runner
// waits for the bot's connection before driving actor messages.

import type { ServerWebSocket } from 'bun';
import type { Message } from '../../types.ts';
import type { WorldService } from '../world.ts';
import { APP_ID, messageView } from './slack.ts';

export interface SocketData { ticket: string }

export class SocketHub {
  private clients = new Set<ServerWebSocket<SocketData>>();
  private envelopeSeq = 0;
  readonly unacked = new Map<string, number>();

  constructor(private readonly service: WorldService) {
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
      if (ack.envelope_id) this.unacked.delete(ack.envelope_id);
    } catch {
      // not an acknowledgement; ignored
    }
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
      const envelope = {
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
      };
      const text = JSON.stringify(envelope);
      for (const ws of this.clients) {
        this.unacked.set(envelopeId, eventTime);
        ws.send(text);
      }
    }
  }
}
