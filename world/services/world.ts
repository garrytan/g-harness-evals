// The world's state and access rules, shared by the Slack mock and the world-MCP tools so both surfaces
// behave identically. Every operation takes the authenticated actor, checks scope, logs to the event log and
// only then changes state.

import { readFileSync } from 'node:fs';
import type { CalendarEvent, Channel, Mail, MailParty, Member, Message, Split, World, WorldFile } from '../types.ts';
import { SimClock } from './clock/clock.ts';
import { EventLog } from './events.ts';

export type Via = 'slack' | 'mcp';

export class WorldError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export interface PendingAction {
  id: string;
  requested_by: string;
  action: string;
  authorization: string;
  details: unknown;
  channel: { dm: string } | { thread: { channel: string; ts: string } } | null;
  requested_at: string;
  status: 'pending';
}

export interface WorldOptions {
  world: World;
  split: Split;
  trialId: string;
  clock: SimClock;
  log: EventLog;
  bot?: { id: string; name: string; handle: string };
}

export function loadWorld(path: string): World {
  return JSON.parse(readFileSync(path, 'utf8')) as World;
}

function inSplit(record: { split: Split }, split: Split): boolean {
  return split === 'both' || record.split === 'both' || record.split === split;
}

export class WorldService {
  readonly split: Split;
  readonly today: string;
  readonly clock: SimClock;
  readonly log: EventLog;
  readonly members: Member[];
  readonly channels: Channel[];
  readonly messages: Message[];
  readonly files: WorldFile[];
  readonly calendar: CalendarEvent[];
  readonly mail: Mail[];
  readonly pending: PendingAction[] = [];
  readonly bot: Member | null;
  readonly teams: World['teams'];
  readonly accounts: World['accounts'];
  private fenced = false;
  private listeners: ((m: Message) => void)[] = [];
  private counters = { event: 0, mail: 0, pending: 0, dm: 0 };

  constructor(opts: WorldOptions) {
    const w = opts.world;
    this.split = opts.split;
    this.today = w.today;
    this.clock = opts.clock;
    this.log = opts.log;
    this.teams = w.teams;
    this.accounts = w.accounts.filter((a) => inSplit(a, opts.split));
    this.members = w.members.filter((m) => inSplit(m, opts.split)).map((m) => ({ ...m }));
    this.channels = w.channels.filter((c) => inSplit(c, opts.split)).map((c) => ({ ...c, members: [...c.members] }));
    const channelIds = new Set(this.channels.map((c) => c.id));
    this.messages = w.messages.filter((m) => channelIds.has(m.channel)).map((m) => ({ ...m }));
    this.files = w.files.filter((f) => inSplit(f, opts.split));
    this.calendar = w.calendar.filter((e) => inSplit(e, opts.split)).map((e) => ({ ...e }));
    this.mail = w.mail.filter((m) => inSplit(m, opts.split)).map((m) => ({ ...m }));
    this.bot = null;
    if (opts.bot) {
      this.bot = {
        id: opts.bot.id,
        slack_id: 'U' + opts.bot.id.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(10, '0').slice(0, 10),
        name: opts.bot.name,
        first: opts.bot.name,
        handle: opts.bot.handle,
        email: `${opts.bot.handle}@pemberline.com`,
        role: 'assistant under test',
        kind: 'agent',
        org: 'pemberline',
        team: null,
        cluster: null,
        org_wide: false,
        is_admin: false,
        split: 'both',
        note: 'the harness being evaluated; a member of every loaded channel',
      };
      this.members.push(this.bot);
      for (const c of this.channels) if (c.kind !== 'dm') c.members.push(this.bot.id);
    }
  }

  // ---- lookups ----

  member(idOrHandleOrSlackId: string): Member | undefined {
    const key = idOrHandleOrSlackId.replace(/^@/, '');
    return this.members.find((m) => m.id === key || m.slack_id === key || m.handle === key || m.email === key);
  }

  requireMember(id: string): Member {
    const m = this.member(id);
    if (!m) throw new WorldError('user_not_found', `no member ${id}`);
    return m;
  }

  channel(idOrName: string): Channel | undefined {
    const key = idOrName.replace(/^#/, '');
    return this.channels.find((c) => c.id === key || c.name === key);
  }

  requireChannel(idOrName: string): Channel {
    const c = this.channel(idOrName);
    if (!c) throw new WorldError('channel_not_found', `no channel ${idOrName}`);
    return c;
  }

  isMember(actor: Member, channel: Channel): boolean {
    return channel.members.includes(actor.id);
  }

  canReadFile(actor: Member, file: WorldFile): boolean {
    if (file.owner === actor.id) return true;
    if (file.visibility === 'private') return false;
    if (file.visibility === 'public') return true;
    if (actor.org_wide) return true;
    return file.team !== null && actor.team === file.team;
  }

  onMessage(fn: (m: Message) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  fence(): void {
    this.fenced = true;
    this.log.append({ actor: null, via: 'admin', tool: 'admin.fence', kind: 'admin', args: {}, outcome: 'ok' });
  }

  isFenced(): boolean {
    return this.fenced;
  }

  private assertWritable(): void {
    if (this.fenced) throw new WorldError('fenced', 'the world no longer accepts writes');
  }

  private record(actor: Member, via: Via, tool: string, kind: 'read' | 'write' | 'approval', args: unknown, effect?: Record<string, unknown>): void {
    this.log.append({ actor: actor.id, via, tool, kind, args, outcome: 'ok', ...(effect ? { effect } : {}) });
  }

  private deny(actor: Member, via: Via, tool: string, args: unknown, err: WorldError): never {
    this.log.append({ actor: actor.id, via, tool, kind: 'deny', args, outcome: 'denied', error: err.code });
    throw err;
  }

  // ---- channels and messages ----

  channelsFor(actor: Member, via: Via): Channel[] {
    const out = this.channels.filter((c) => this.isMember(actor, c));
    this.record(actor, via, 'conversations.list', 'read', {}, { count: out.length });
    return out;
  }

  history(actor: Member, via: Via, channelRef: string, opts: { oldest?: string; latest?: string; limit?: number; thread_ts?: string } = {}): Message[] {
    const args = { channel: channelRef, ...opts };
    const channel = this.channel(channelRef);
    if (!channel) this.deny(actor, via, 'conversations.history', args, new WorldError('channel_not_found'));
    if (!this.isMember(actor, channel)) this.deny(actor, via, 'conversations.history', args, new WorldError('not_in_channel'));
    let out = this.messages.filter((m) => m.channel === channel.id);
    if (opts.thread_ts) {
      out = out.filter((m) => m.ts === opts.thread_ts || (m as Message & { thread_ts?: string }).thread_ts === opts.thread_ts);
    }
    if (opts.oldest) out = out.filter((m) => Number(m.ts) >= Number(opts.oldest));
    if (opts.latest) out = out.filter((m) => Number(m.ts) <= Number(opts.latest));
    out.sort((a, b) => Number(a.ts) - Number(b.ts));
    if (opts.limit && out.length > opts.limit) out = out.slice(-opts.limit);
    this.record(actor, via, 'conversations.history', 'read', args, { channel: channel.id, count: out.length });
    return out;
  }

  post(actor: Member, via: Via, channelRef: string, text: string, thread_ts?: string): Message {
    const args = { channel: channelRef, text, ...(thread_ts ? { thread_ts } : {}) };
    const channel = this.channel(channelRef);
    if (!channel) this.deny(actor, via, 'chat.postMessage', args, new WorldError('channel_not_found'));
    if (!this.isMember(actor, channel)) this.deny(actor, via, 'chat.postMessage', args, new WorldError('not_in_channel'));
    if (this.fenced) this.deny(actor, via, 'chat.postMessage', args, new WorldError('fenced'));
    if (!text.trim()) throw new WorldError('no_text');
    const ts = this.clock.nextTs();
    const message: Message & { thread_ts?: string } = {
      id: `m-${ts}`,
      channel: channel.id,
      author: actor.id,
      ts,
      date: this.clock.today(),
      date_basis: 'frontmatter',
      time_text: this.clock.nowIso().slice(11, 16),
      text,
      split: channel.split,
      slug: `live/${this.log.trialId}`,
      ...(thread_ts ? { thread_ts } : {}),
    };
    this.messages.push(message);
    this.record(actor, via, 'chat.postMessage', 'write', args, { channel: channel.id, ts, ...(thread_ts ? { thread_ts } : {}) });
    for (const fn of this.listeners) fn(message);
    return message;
  }

  openDm(actor: Member, via: Via, others: string[]): Channel {
    const args = { users: others };
    const ids = [...new Set([actor.id, ...others.map((o) => {
      const m = this.member(o);
      if (!m) this.deny(actor, via, 'conversations.open', args, new WorldError('user_not_found', `no member ${o}`));
      return m.id;
    })])].sort();
    if (ids.length < 2) this.deny(actor, via, 'conversations.open', args, new WorldError('user_not_found', 'a DM needs another member'));
    const name = `dm:${ids.join('+')}`;
    let channel = this.channels.find((c) => c.kind === 'dm' && [...c.members].sort().join('+') === ids.join('+'));
    if (!channel) {
      this.assertWritable();
      this.counters.dm += 1;
      channel = {
        id: `D${this.log.trialId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}${String(this.counters.dm).padStart(4, '0')}`,
        name,
        kind: 'dm',
        purpose: 'direct message',
        split: 'both',
        cluster: null,
        members: ids,
        source_slugs: [],
        rule: 'opened during the trial',
      };
      this.channels.push(channel);
      this.record(actor, via, 'conversations.open', 'write', args, { channel: channel.id, created: true });
    } else {
      this.record(actor, via, 'conversations.open', 'read', args, { channel: channel.id, created: false });
    }
    return channel;
  }

  search(actor: Member, via: Via, query: string, limit = 20): Message[] {
    const q = query.toLowerCase();
    const visible = new Set(this.channels.filter((c) => this.isMember(actor, c)).map((c) => c.id));
    const out = this.messages
      .filter((m) => visible.has(m.channel) && m.text.toLowerCase().includes(q))
      .sort((a, b) => Number(b.ts) - Number(a.ts))
      .slice(0, limit);
    this.record(actor, via, 'search.messages', 'read', { query, limit }, { count: out.length, channels: [...new Set(out.map((m) => m.channel))] });
    return out;
  }

  // ---- files ----

  listFiles(actor: Member, via: Via, folder?: string): WorldFile[] {
    const prefix = folder ? folder.replace(/^\/+|\/+$/g, '') + '/' : '';
    const out = this.files.filter((f) => f.path.startsWith(prefix) && this.canReadFile(actor, f));
    this.record(actor, via, 'files.list', 'read', { folder: folder ?? null }, { count: out.length });
    return out;
  }

  readFile(actor: Member, via: Via, path: string): WorldFile {
    const key = path.replace(/^\/+/, '');
    const file = this.files.find((f) => f.path === key || f.id === key || f.slug === key);
    if (!file) this.deny(actor, via, 'files.read', { path }, new WorldError('file_not_found'));
    if (!this.canReadFile(actor, file)) this.deny(actor, via, 'files.read', { path }, new WorldError('forbidden', 'not in scope'));
    this.record(actor, via, 'files.read', 'read', { path }, { file: file.id, owner: file.owner, visibility: file.visibility });
    return file;
  }

  // ---- calendar ----

  calendarFor(actor: Member, via: Via, range: { from?: string; to?: string } = {}): CalendarEvent[] {
    const out = this.calendar
      .filter((e) => e.organizer === actor.id || e.attendees.includes(actor.id))
      .filter((e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to))
      .sort((a, b) => a.start.localeCompare(b.start));
    this.record(actor, via, 'calendar.list', 'read', range, { count: out.length });
    return out;
  }

  createEvent(actor: Member, via: Via, input: { title: string; start: string; end: string; attendees?: string[]; notes?: string }): CalendarEvent {
    if (this.fenced) this.deny(actor, via, 'calendar.create', input, new WorldError('fenced'));
    if (Number.isNaN(Date.parse(input.start)) || Number.isNaN(Date.parse(input.end))) throw new WorldError('bad_time', 'start and end must be ISO-8601');
    const attendees = [...new Set([actor.id, ...(input.attendees ?? []).map((a) => this.requireMember(a).id)])];
    this.counters.event += 1;
    const event: CalendarEvent = {
      id: `evt-${this.log.trialId}-${this.counters.event}`,
      title: input.title,
      date: input.start.slice(0, 10),
      body_date: null,
      start: input.start,
      end: input.end,
      organizer: actor.id,
      attendees,
      attendees_text: null,
      accounts: [],
      split: 'both',
      slug: null,
      notes: input.notes ?? '',
    };
    this.calendar.push(event);
    this.record(actor, via, 'calendar.create', 'write', input, { event: event.id, attendees });
    return event;
  }

  // ---- mail ----

  mailFor(actor: Member, via: Via, box: 'inbox' | 'drafts' = 'inbox'): Mail[] {
    const out = this.mail
      .filter((m) => (box === 'drafts' ? m.status === 'draft' && m.from.member === actor.id : m.status === 'received' && m.mailbox_members.includes(actor.id)))
      .sort((a, b) => a.date.localeCompare(b.date));
    this.record(actor, via, 'mail.list', 'read', { box }, { count: out.length });
    return out;
  }

  draftMail(actor: Member, via: Via, input: { to: string[]; cc?: string[]; subject: string; body: string }): Mail {
    if (this.fenced) this.deny(actor, via, 'mail.draft', input, new WorldError('fenced'));
    const party = (raw: string): MailParty => ({ member: this.member(raw)?.id ?? null, raw });
    this.counters.mail += 1;
    const mail: Mail = {
      id: `draft-${this.log.trialId}-${this.counters.mail}`,
      from: { member: actor.id, raw: actor.email },
      to: input.to.map(party),
      cc: (input.cc ?? []).map(party),
      date: this.clock.today(),
      date_header: this.clock.nowIso(),
      subject: input.subject,
      body: input.body,
      mailbox_members: [actor.id],
      accounts: [],
      split: 'both',
      slug: null,
      status: 'draft',
    };
    this.mail.push(mail);
    this.record(actor, via, 'mail.draft', 'write', input, { mail: mail.id, sent: false });
    return mail;
  }

  // ---- approvals ----

  requestApproval(actor: Member, via: Via, input: { action: string; authorization: string; details?: unknown; channel?: PendingAction['channel'] }): PendingAction {
    if (this.fenced) this.deny(actor, via, 'request_approval', input, new WorldError('fenced'));
    this.counters.pending += 1;
    const pending: PendingAction = {
      id: `pending-${this.log.trialId}-${this.counters.pending}`,
      requested_by: actor.id,
      action: input.action,
      authorization: input.authorization,
      details: input.details ?? null,
      channel: input.channel ?? null,
      requested_at: this.clock.nowIso(),
      status: 'pending',
    };
    this.pending.push(pending);
    this.log.append({ actor: actor.id, via, tool: 'request_approval', kind: 'approval', args: input, outcome: 'ok', effect: { pending_action: pending } });
    return pending;
  }

  // ---- snapshot for graders ----

  snapshot(): Record<string, unknown> {
    return {
      trial_id: this.log.trialId,
      split: this.split,
      clock: this.clock.state(),
      now: this.clock.nowIso(),
      fenced: this.fenced,
      channels: this.channels,
      messages: this.messages,
      calendar: this.calendar,
      mail: this.mail,
      pending_actions: this.pending,
      events: this.log.events.length,
    };
  }
}
